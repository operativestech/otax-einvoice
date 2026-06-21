/**
 * Smoke tests for the anomaly-detection scoring engine.
 *
 * We're locking the headline behaviours — modified-z-score outlier flag,
 * new-customer big-ticket flag, velocity flag, off-hours flag — so a future
 * refactor can't silently regress them. The exact severity numbers are not
 * asserted (they're tuning knobs).
 */

import { describe, it, expect } from 'vitest';
import {
    robustStats,
    modifiedZ,
    scoreInvoice,
    type ScoreContext,
    type InvoiceForScoring,
    type CustomerStats,
} from '../server/services/anomalyDetection.js';

describe('robustStats', () => {
    it('returns 0/0 for empty input', () => {
        expect(robustStats([])).toEqual({ median: 0, mad: 0 });
    });

    it('computes median + MAD on a typical series', () => {
        // Series: 1, 2, 3, 4, 5 — median 3, deviations 2,1,0,1,2 → MAD 1
        const r = robustStats([1, 2, 3, 4, 5]);
        expect(r.median).toBe(3);
        expect(r.mad).toBe(1);
    });

    it('is unmoved by a single huge outlier (this is the point)', () => {
        // 1,2,3,4,5,1000 — mean+stddev would be wrecked; median stays close to 3
        const r = robustStats([1, 2, 3, 4, 5, 1000]);
        expect(r.median).toBeLessThan(10);
    });

    it('returns mad=0 when all values are identical', () => {
        expect(robustStats([7, 7, 7, 7]).mad).toBe(0);
    });
});

describe('modifiedZ', () => {
    it('is zero for the median itself', () => {
        expect(modifiedZ(100, 100, 10)).toBe(0);
    });

    it('returns 0 when MAD is 0 (would otherwise divide by zero)', () => {
        expect(modifiedZ(100, 50, 0)).toBe(0);
    });

    it('flags values well above the standard threshold', () => {
        // Standard cutoff is 3.5 — modifiedZ = 0.6745 * (x - median) / mad
        // (200 - 100)/10 = 10 MADs → modifiedZ = 6.745, comfortably above 3.5
        const z = modifiedZ(200, 100, 10);
        expect(z).toBeGreaterThanOrEqual(3.5);
    });

    it('does not flag values just below the standard threshold', () => {
        // 5 MADs above → modifiedZ = 3.37, just below the 3.5 cutoff
        const z = modifiedZ(150, 100, 10);
        expect(z).toBeLessThan(3.5);
    });
});

// ─── scoreInvoice ────────────────────────────────────────────────────────

function ctx(overrides: Partial<ScoreContext> = {}): ScoreContext {
    return {
        orgMedian: 1000,
        weekendRatio: 0.2,
        customerStats: new Map(),
        customerRecentTimes: new Map(),
        ...overrides,
    };
}

function inv(p: Partial<InvoiceForScoring> = {}): InvoiceForScoring {
    return {
        uuid: 'u1',
        internalId: 'INV-1',
        receiverId: 'C1',
        receiverName: 'Test Co',
        dateTimeIssued: '2026-04-15T10:00:00Z',  // Wednesday
        total: 1000,
        ...p,
    };
}

const STATS = (overrides: Partial<CustomerStats> = {}): CustomerStats => ({
    receiverId: 'C1',
    historyCount: 10,
    median: 1000,
    mad: 100,
    logMedian: Math.log10(1000),
    logMad: 0.05,
    ...overrides,
});

describe('scoreInvoice — amount outlier', () => {
    it('flags an invoice ≥3.5 modified-σ above the customer history', () => {
        const customerStats = new Map<string, CustomerStats>([['C1', STATS()]]);
        // 100,000 EGP vs customer median of 1,000 → log10 difference = 2 → way over 3.5σ in log space
        const flags = scoreInvoice(inv({ total: 100000 }), ctx({ customerStats }));
        expect(flags.find(f => f.kind === 'amount_outlier')).toBeTruthy();
    });

    it('does NOT flag a typical invoice', () => {
        const customerStats = new Map<string, CustomerStats>([['C1', STATS()]]);
        const flags = scoreInvoice(inv({ total: 1100 }), ctx({ customerStats }));
        expect(flags.find(f => f.kind === 'amount_outlier')).toBeUndefined();
    });

    it('does NOT flag when the customer has fewer than 5 prior invoices', () => {
        const customerStats = new Map<string, CustomerStats>([['C1', STATS({ historyCount: 3 })]]);
        const flags = scoreInvoice(inv({ total: 100000 }), ctx({ customerStats }));
        expect(flags.find(f => f.kind === 'amount_outlier')).toBeUndefined();
    });
});

describe('scoreInvoice — new-customer big-ticket', () => {
    it('flags a first invoice that is >3× org median', () => {
        // No history for C1 → "new customer" path
        const flags = scoreInvoice(inv({ total: 5000 }), ctx({ orgMedian: 1000 }));
        expect(flags.find(f => f.kind === 'new_customer_big_ticket')).toBeTruthy();
    });

    it('does NOT flag a normal-sized first invoice', () => {
        const flags = scoreInvoice(inv({ total: 1500 }), ctx({ orgMedian: 1000 }));
        expect(flags.find(f => f.kind === 'new_customer_big_ticket')).toBeUndefined();
    });

    it('does NOT trigger when org median is unknown (zero)', () => {
        const flags = scoreInvoice(inv({ total: 1000000 }), ctx({ orgMedian: 0 }));
        expect(flags.find(f => f.kind === 'new_customer_big_ticket')).toBeUndefined();
    });
});

describe('scoreInvoice — velocity', () => {
    it('flags ≥3 invoices to the same customer in a 4-hour window', () => {
        const now = new Date('2026-04-15T10:00:00Z').getTime();
        const recentTimes = new Map([['C1', [now - 1000, now - 60_000, now - 1_800_000, now]]]);  // 4 within 30 min
        const flags = scoreInvoice(inv({ total: 1000 }), ctx({ customerRecentTimes: recentTimes }));
        expect(flags.find(f => f.kind === 'velocity')).toBeTruthy();
    });

    it('does NOT flag spread-out invoices', () => {
        const now = new Date('2026-04-15T10:00:00Z').getTime();
        const day = 24 * 60 * 60 * 1000;
        const recentTimes = new Map([['C1', [now - 30 * day, now - 14 * day, now]]]);
        const flags = scoreInvoice(inv({ total: 1000 }), ctx({ customerRecentTimes: recentTimes }));
        expect(flags.find(f => f.kind === 'velocity')).toBeUndefined();
    });
});

describe('scoreInvoice — off-hours', () => {
    it('flags a Friday invoice for orgs that rarely bill on weekends', () => {
        // 2026-04-17 is a Friday
        const flags = scoreInvoice(
            inv({ dateTimeIssued: '2026-04-17T10:00:00Z' }),
            ctx({ weekendRatio: 0.01 })
        );
        expect(flags.find(f => f.kind === 'off_hours')).toBeTruthy();
    });

    it('does NOT flag weekday invoices', () => {
        // 2026-04-15 is a Wednesday
        const flags = scoreInvoice(
            inv({ dateTimeIssued: '2026-04-15T10:00:00Z' }),
            ctx({ weekendRatio: 0.01 })
        );
        expect(flags.find(f => f.kind === 'off_hours')).toBeUndefined();
    });

    it('does NOT flag weekend invoices for orgs that bill on weekends regularly', () => {
        const flags = scoreInvoice(
            inv({ dateTimeIssued: '2026-04-17T10:00:00Z' }),
            ctx({ weekendRatio: 0.30 })
        );
        expect(flags.find(f => f.kind === 'off_hours')).toBeUndefined();
    });
});
