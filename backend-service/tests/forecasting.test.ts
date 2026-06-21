/**
 * Smoke tests for the Holt-Winters forecasting helper. We're not testing the
 * exact projection number (the maths is well-known and intentionally smoothed),
 * just the regime selection — too short → null, short → linear, long →
 * seasonal — and a sanity check on directionality.
 */

import { describe, it, expect } from 'vitest';
import { forecast } from '../server/services/forecasting.js';

describe('forecast — regime selection', () => {
    it('returns null for fewer than 3 points', () => {
        expect(forecast([])).toBeNull();
        expect(forecast([10])).toBeNull();
        expect(forecast([10, 20])).toBeNull();
    });

    it('uses simple_exponential for 3 points', () => {
        const r = forecast([100, 110, 120])!;
        expect(r.method).toBe('simple_exponential');
        expect(r.projection).toBeGreaterThan(0);
    });

    it('uses holt_linear for 4–23 points', () => {
        const series = Array.from({ length: 12 }, (_, i) => 100 + i * 5);
        const r = forecast(series)!;
        expect(r.method).toBe('holt_linear');
        // Trend should be positive on a strictly-increasing input
        expect(r.trend).toBeGreaterThan(0);
        // Projection should be ≥ the last observation when the trend is up
        expect(r.projection).toBeGreaterThanOrEqual(series[series.length - 1] - r.rmse);
    });

    it('uses holt_winters_seasonal for ≥24 points', () => {
        // Two full seasonal cycles with a clear annual sine pattern + slight upward trend
        const series = Array.from({ length: 24 }, (_, i) =>
            1000 + 100 * Math.sin((i / 12) * 2 * Math.PI) + i * 5
        );
        const r = forecast(series)!;
        expect(r.method).toBe('holt_winters_seasonal');
        expect(r.projection).toBeGreaterThan(0);
        // RMSE should be much less than the overall variance — the seasonal model
        // is supposed to fit better than the mean.
        const mean = series.reduce((a, b) => a + b, 0) / series.length;
        const totalVariance = series.reduce((a, b) => a + (b - mean) ** 2, 0) / series.length;
        expect(r.rmse).toBeLessThan(Math.sqrt(totalVariance));
    });
});

describe('forecast — clamping', () => {
    it('never projects negative values', () => {
        // Sharp downward series — naive linear extrapolation would go negative
        const series = Array.from({ length: 6 }, (_, i) => Math.max(0, 100 - i * 30));
        const r = forecast(series)!;
        expect(r.projection).toBeGreaterThanOrEqual(0);
    });

    it('handles zero-only history without throwing', () => {
        const r = forecast([0, 0, 0, 0, 0])!;
        expect(r.projection).toBe(0);
        expect(r.rmse).toBe(0);
    });

    it('handles a constant series with zero RMSE', () => {
        const r = forecast([500, 500, 500, 500, 500, 500])!;
        expect(Math.abs(r.projection - 500)).toBeLessThan(1);
        expect(r.rmse).toBeLessThan(1);
    });
});
