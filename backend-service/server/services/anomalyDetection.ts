/**
 * anomalyDetection — robust statistical scoring of "unusual" invoices.
 *
 * Replaces the naive z-score-with-mean approach. Key improvements:
 *
 *   1. Modified Z-score (MAD-based) — uses median + median absolute deviation
 *      instead of mean + stddev. Far more robust to the presence of other
 *      outliers in the same customer's history (the original z-score gets
 *      pulled by the very thing it's trying to flag).
 *
 *   2. Log-space transform — invoice amounts in B2B traffic are roughly
 *      log-normal (a customer billing 10x more is normal-ish; 100x is the
 *      anomaly). Working in log space normalises the scale and makes the
 *      threshold meaningful regardless of customer size.
 *
 *   3. Velocity flag — the same customer being billed many times in a short
 *      window is a fraud indicator that pure-amount checks miss. We surface
 *      it as an additional anomaly kind.
 *
 *   4. Off-hours flag — invoices issued on a weekend (Friday/Saturday in
 *      Egypt) for orgs that essentially never bill on those days. Statistical
 *      rather than hard-coded — we compute the org's weekend ratio first.
 */

export interface InvoiceForScoring {
    uuid: string;
    internalId: string;
    receiverId: string;
    receiverName: string | null;
    dateTimeIssued: string;
    total: number;
}

export interface CustomerStats {
    receiverId: string;
    historyCount: number;
    median: number;
    mad: number;          // median absolute deviation
    logMedian: number;    // median of log10(amount + 1)
    logMad: number;       // mad of the log series
}

export interface ScoreContext {
    /** Org-wide median used to flag big-ticket new-customer invoices. */
    orgMedian: number;
    /** Org-wide ratio of weekend invoices (Fri/Sat). 0 = never bills weekends. */
    weekendRatio: number;
    /** Per-customer history bundled into a Map keyed by receiverId. */
    customerStats: Map<string, CustomerStats>;
    /** Per-customer recent invoice timestamps (sorted ascending) for velocity. */
    customerRecentTimes: Map<string, number[]>;
}

export interface Anomaly {
    uuid: string;
    internalId: string;
    receiverId: string;
    receiverName: string | null;
    dateTimeIssued: string;
    total: number;
    kind: 'amount_outlier' | 'new_customer_big_ticket' | 'velocity' | 'off_hours';
    severity: number;     // 0..1
    reason: string;
    stats: Record<string, any>;
}

const MAD_THRESHOLD = 3.5;        // standard cutoff for modified z-score
const NEW_CUSTOMER_RATIO = 3.0;   // first invoice > 3× org median
const VELOCITY_WINDOW_HOURS = 4;  // ≥3 invoices to same customer within 4h
const VELOCITY_COUNT = 3;
const WEEKEND_HEAVY_RATIO = 0.05; // <5% historical weekend invoices = unusual

/** Robust median + MAD. Returns mad=0 when all values are identical. */
export function robustStats(values: number[]): { median: number; mad: number } {
    if (values.length === 0) return { median: 0, mad: 0 };
    const sorted = values.slice().sort((a, b) => a - b);
    const median = sorted.length % 2 === 0
        ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
        : sorted[(sorted.length - 1) / 2];
    const deviations = values.map(v => Math.abs(v - median));
    const sortedDevs = deviations.sort((a, b) => a - b);
    const mad = sortedDevs.length % 2 === 0
        ? (sortedDevs[sortedDevs.length / 2 - 1] + sortedDevs[sortedDevs.length / 2]) / 2
        : sortedDevs[(sortedDevs.length - 1) / 2];
    return { median, mad };
}

/** Modified z-score: 0.6745 * (x - median) / MAD. The 0.6745 makes it
 *  comparable to a standard z-score under normality. Returns 0 when MAD=0
 *  (degenerate input). */
export function modifiedZ(value: number, median: number, mad: number): number {
    if (mad === 0) return 0;
    return 0.6745 * (value - median) / mad;
}

function isWeekendISO(iso: string): boolean {
    const d = new Date(iso);
    const dow = d.getDay(); // 0 = Sun ... 5 = Fri, 6 = Sat (Egypt's weekend)
    return dow === 5 || dow === 6;
}

/** Score one invoice against the precomputed context. Returns 0..N anomaly
 *  records (a single invoice can trigger multiple kinds). */
export function scoreInvoice(inv: InvoiceForScoring, ctx: ScoreContext): Anomaly[] {
    const out: Anomaly[] = [];
    const stats = ctx.customerStats.get(inv.receiverId);

    // 1. Amount outlier (MAD modified z-score, log-transformed)
    if (stats && stats.historyCount >= 5 && stats.logMad > 0) {
        const logAmount = Math.log10(Math.max(1, inv.total));
        const z = modifiedZ(logAmount, stats.logMedian, stats.logMad);
        if (Math.abs(z) >= MAD_THRESHOLD) {
            out.push({
                ...invoiceFields(inv),
                kind: 'amount_outlier',
                severity: Math.min(1, Math.abs(z) / 7),
                reason: `Amount is ${z.toFixed(1)} robust-σ ${z > 0 ? 'above' : 'below'} this customer's typical (${formatEgp(Math.pow(10, stats.logMedian))}) over ${stats.historyCount} prior invoices.`,
                stats: { modifiedZ: z, customerMedian: stats.median, customerMad: stats.mad, historyCount: stats.historyCount },
            });
        }
    } else if ((!stats || stats.historyCount <= 1) && ctx.orgMedian > 0 && inv.total > NEW_CUSTOMER_RATIO * ctx.orgMedian) {
        // 2. New customer, big-ticket first invoice
        out.push({
            ...invoiceFields(inv),
            kind: 'new_customer_big_ticket',
            severity: Math.min(1, (inv.total / ctx.orgMedian - NEW_CUSTOMER_RATIO) / 10),
            reason: `New customer's first invoice is ${(inv.total / ctx.orgMedian).toFixed(1)}× the organisation median (${formatEgp(ctx.orgMedian)}).`,
            stats: { orgMedian: ctx.orgMedian, ratio: inv.total / ctx.orgMedian },
        });
    }

    // 3. Velocity — same customer, multiple invoices in a short window
    const times = ctx.customerRecentTimes.get(inv.receiverId);
    if (times && times.length >= VELOCITY_COUNT) {
        const now = new Date(inv.dateTimeIssued).getTime();
        const windowMs = VELOCITY_WINDOW_HOURS * 60 * 60 * 1000;
        const inWindow = times.filter(t => Math.abs(t - now) <= windowMs).length;
        if (inWindow >= VELOCITY_COUNT) {
            out.push({
                ...invoiceFields(inv),
                kind: 'velocity',
                severity: Math.min(1, (inWindow - VELOCITY_COUNT + 1) / 5),
                reason: `${inWindow} invoices to the same customer within a ${VELOCITY_WINDOW_HOURS}-hour window — unusual pace.`,
                stats: { invoicesInWindow: inWindow, windowHours: VELOCITY_WINDOW_HOURS },
            });
        }
    }

    // 4. Off-hours — weekend issue date for orgs that rarely bill on weekends
    if (ctx.weekendRatio < WEEKEND_HEAVY_RATIO && isWeekendISO(inv.dateTimeIssued)) {
        out.push({
            ...invoiceFields(inv),
            kind: 'off_hours',
            severity: 0.3 + (WEEKEND_HEAVY_RATIO - ctx.weekendRatio) * 6,
            reason: `Issued on a weekend; this organisation only bills on weekends ${(ctx.weekendRatio * 100).toFixed(1)}% of the time.`,
            stats: { weekendRatio: ctx.weekendRatio },
        });
    }

    return out;
}

function invoiceFields(inv: InvoiceForScoring) {
    return {
        uuid: inv.uuid,
        internalId: inv.internalId,
        receiverId: inv.receiverId,
        receiverName: inv.receiverName,
        dateTimeIssued: inv.dateTimeIssued,
        total: inv.total,
    };
}

function formatEgp(n: number): string {
    return `${Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 })} EGP`;
}
