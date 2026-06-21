/**
 * forecasting — Holt-Winters exponential smoothing for monthly VAT projection.
 *
 * Why this beats the plain linear-regression we used before:
 *   1. Seasonal awareness — Ramadan / end-of-fiscal-quarter spikes show up as
 *      a 12-month cycle. With ≥24 months of data we capture it; with less, we
 *      gracefully fall back to non-seasonal Holt.
 *   2. Recency weighting — exponential smoothing puts more weight on recent
 *      observations, so a one-off spike from 18 months ago doesn't drag the
 *      next-month estimate.
 *   3. Trend damping — pure linear extrapolation can predict absurd values
 *      far in the future. Damped trend pulls the slope back toward zero so
 *      the forecast doesn't run away.
 *
 * No external ML dependency — implemented in pure JS (~120 lines). For a
 * proper production model we'd reach for Prophet or ARIMA, but those want a
 * Python sidecar; this is good enough for tax-figure projection where users
 * mostly want a "ballpark" number.
 */

interface ForecastResult {
    method: 'holt_winters_seasonal' | 'holt_linear' | 'simple_exponential';
    projection: number;          // next-period forecast
    level: number;               // smoothed level at the last observation
    trend: number;               // smoothed trend at the last observation
    fitted: number[];            // one-step-ahead in-sample fit (for stddev)
    rmse: number;                // in-sample RMSE → confidence band
}

const ALPHA = 0.5;   // level smoothing
const BETA  = 0.2;   // trend smoothing
const GAMMA = 0.3;   // seasonal smoothing
const PHI   = 0.92;  // trend damping (1 = no damping, <1 dampens)
const SEASON_LENGTH = 12;
const MIN_FOR_SEASONAL = 24;
const MIN_FOR_TREND = 4;

/**
 * Forecast the next period given a chronologically-ordered series. Returns
 * null if the series is too short to extract any signal (≤2 points).
 */
export function forecast(values: number[]): ForecastResult | null {
    const n = values.length;
    if (n < 3) return null;

    if (n >= MIN_FOR_SEASONAL) return holtWintersSeasonal(values);
    if (n >= MIN_FOR_TREND)    return holtLinear(values);
    return simpleExponential(values);
}

/** Holt-Winters with additive seasonal component + damped trend.
 *  Best when we have ≥2 full seasonal cycles in the input. */
function holtWintersSeasonal(values: number[]): ForecastResult {
    const n = values.length;
    // Initial level = mean of the first season
    const firstSeasonMean = values.slice(0, SEASON_LENGTH).reduce((a, b) => a + b, 0) / SEASON_LENGTH;
    let level = firstSeasonMean;
    // Initial trend = slope between the two seasons (avg)
    let trend = 0;
    for (let i = 0; i < SEASON_LENGTH; i++) {
        trend += (values[i + SEASON_LENGTH] - values[i]) / SEASON_LENGTH;
    }
    trend /= SEASON_LENGTH;
    // Initial seasonal indices = (value - levelOfThatSeason) for the first cycle
    const seasonal: number[] = new Array(SEASON_LENGTH);
    for (let i = 0; i < SEASON_LENGTH; i++) seasonal[i] = values[i] - firstSeasonMean;

    const fitted: number[] = [];
    for (let i = 0; i < n; i++) {
        const seasonIdx = i % SEASON_LENGTH;
        const yHat = level + trend + seasonal[seasonIdx];
        fitted.push(yHat);

        const prevLevel = level;
        level    = ALPHA * (values[i] - seasonal[seasonIdx]) + (1 - ALPHA) * (level + trend);
        trend    = BETA * (level - prevLevel) + (1 - BETA) * PHI * trend;
        seasonal[seasonIdx] = GAMMA * (values[i] - level) + (1 - GAMMA) * seasonal[seasonIdx];
    }
    const nextSeasonIdx = n % SEASON_LENGTH;
    const projection = Math.max(0, level + PHI * trend + seasonal[nextSeasonIdx]);
    return { method: 'holt_winters_seasonal', projection, level, trend, fitted, rmse: rmseOf(values, fitted) };
}

/** Holt linear (no seasonality) with damped trend. Best for 4-23 months. */
function holtLinear(values: number[]): ForecastResult {
    const n = values.length;
    let level = values[0];
    let trend = values[1] - values[0];

    const fitted: number[] = [values[0]];
    for (let i = 1; i < n; i++) {
        const prevLevel = level;
        const prevTrend = trend;
        const yHat = prevLevel + prevTrend;
        fitted.push(yHat);
        level = ALPHA * values[i] + (1 - ALPHA) * (prevLevel + prevTrend);
        trend = BETA * (level - prevLevel) + (1 - BETA) * PHI * prevTrend;
    }
    return { method: 'holt_linear', projection: Math.max(0, level + PHI * trend), level, trend, fitted, rmse: rmseOf(values, fitted) };
}

/** Single exponential smoothing — level only, no trend. For 3-month series.
 *  Conservative: projection = current level. */
function simpleExponential(values: number[]): ForecastResult {
    const n = values.length;
    let level = values[0];
    const fitted: number[] = [values[0]];
    for (let i = 1; i < n; i++) {
        fitted.push(level);
        level = ALPHA * values[i] + (1 - ALPHA) * level;
    }
    return { method: 'simple_exponential', projection: Math.max(0, level), level, trend: 0, fitted, rmse: rmseOf(values, fitted) };
}

function rmseOf(actuals: number[], fitted: number[]): number {
    const n = Math.min(actuals.length, fitted.length);
    if (n === 0) return 0;
    let sse = 0;
    for (let i = 0; i < n; i++) sse += (actuals[i] - fitted[i]) ** 2;
    return Math.sqrt(sse / n);
}
