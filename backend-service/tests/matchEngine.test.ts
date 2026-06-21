/**
 * Smoke tests for the reconciliation match-engine scoring function.
 *
 * `scoreErpBank` is the heart of Phase 2.2 — it decides whether an ERP row
 * and a bank row should be paired, and labels the link as PERFECT, WHT, FX,
 * or MANUAL. The runtime path (runAutoMatch) walks ERP × Bank candidates and
 * keeps the best score per ERP row, so any drift in the classifier flips
 * suggestions silently. We freeze the headline cases here.
 */

import { describe, it, expect } from 'vitest';
import { scoreErpBank, type ErpRow, type BankRow } from '../server/services/matchEngine.js';

function erp(p: Partial<ErpRow> = {}): ErpRow {
    return {
        id: 1,
        tx_type: 'AR',
        doc_number: 'INV-001',
        counterparty_id: '100200300',
        counterparty_name: 'Sample Customer',
        issue_date: '2026-04-01',
        amount: 1000,
        currency: 'EGP',
        ...p,
    };
}

function bank(p: Partial<BankRow> = {}): BankRow {
    return {
        id: 1,
        statement_date: '2026-04-01',
        amount: 1000,
        currency: 'EGP',
        description: 'Wire from customer',
        reference: 'TRX-1',
        ...p,
    };
}

describe('scoreErpBank — PERFECT classification', () => {
    it('returns PERFECT with high confidence on exact-amount + same-date + same-currency', () => {
        const s = scoreErpBank(erp(), bank());
        expect(s).not.toBeNull();
        expect(s!.matchType).toBe('PERFECT');
        expect(s!.confidence).toBeGreaterThanOrEqual(90);
        expect(s!.amountDiff).toBe(0);
    });

    it('still labels PERFECT when amounts differ by <0.2%', () => {
        // 1000 vs 1001.5 is 0.15% off — within the perfect tolerance
        const s = scoreErpBank(erp({ amount: 1000 }), bank({ amount: 1001.5 }));
        expect(s).not.toBeNull();
        expect(s!.matchType).toBe('PERFECT');
    });

    it('AR direction: positive bank credit pairs with AR receivable', () => {
        const s = scoreErpBank(erp({ tx_type: 'AR', amount: 1000 }), bank({ amount: 1000 }));
        expect(s!.matchType).toBe('PERFECT');
        // No direction penalty
        expect(s!.confidence).toBeGreaterThan(90);
    });

    it('AP direction: negative bank debit pairs with AP payable', () => {
        const s = scoreErpBank(erp({ tx_type: 'AP', amount: 1000 }), bank({ amount: -1000 }));
        expect(s!.matchType).toBe('PERFECT');
        expect(s!.confidence).toBeGreaterThan(90);
    });

    it('penalises wrong direction (AR + debit) but still reports the match', () => {
        const s = scoreErpBank(erp({ tx_type: 'AR', amount: 1000 }), bank({ amount: -1000 }));
        // Same magnitude → still PERFECT classification but with a 15-point hit
        expect(s).not.toBeNull();
        expect(s!.matchType).toBe('PERFECT');
        expect(s!.confidence).toBeLessThan(85);
    });
});

describe('scoreErpBank — WHT (withholding) classification', () => {
    it('detects 1% withholding (1000 → 990)', () => {
        const s = scoreErpBank(erp({ amount: 1000 }), bank({ amount: 990 }));
        expect(s).not.toBeNull();
        expect(s!.matchType).toBe('WHT');
        expect(s!.notes).toMatch(/withholding/i);
    });

    it('detects 5% withholding (1000 → 950)', () => {
        const s = scoreErpBank(erp({ amount: 1000 }), bank({ amount: 950 }));
        expect(s!.matchType).toBe('WHT');
    });

    it('detects 0.5% withholding (1000 → 995)', () => {
        const s = scoreErpBank(erp({ amount: 1000 }), bank({ amount: 995 }));
        expect(s!.matchType).toBe('WHT');
    });

    it('does NOT flag WHT when currencies differ — falls through to FX', () => {
        const s = scoreErpBank(
            erp({ amount: 1000, currency: 'EGP' }),
            bank({ amount: 990, currency: 'USD' })
        );
        expect(s!.matchType).toBe('FX');
    });
});

describe('scoreErpBank — FX classification', () => {
    it('detects different currencies with a plausible implied rate', () => {
        // 1000 EGP ↔ 32 USD → implied rate 0.032 (within 0.005..2000 band)
        const s = scoreErpBank(
            erp({ amount: 1000, currency: 'EGP' }),
            bank({ amount: 32, currency: 'USD' })
        );
        expect(s).not.toBeNull();
        expect(s!.matchType).toBe('FX');
        expect(s!.notes).toMatch(/implied rate/i);
    });

    it('rejects FX with an absurd implied rate', () => {
        // 1000 EGP ↔ 0.001 USD → rate 0.000001, below the 0.005 floor
        const s = scoreErpBank(
            erp({ amount: 1000, currency: 'EGP' }),
            bank({ amount: 0.001, currency: 'USD' })
        );
        expect(s).toBeNull();
    });
});

describe('scoreErpBank — MANUAL / null classification', () => {
    it('returns MANUAL when amounts are within 5% but not WHT/PERFECT', () => {
        const s = scoreErpBank(erp({ amount: 1000 }), bank({ amount: 1030 }));
        expect(s).not.toBeNull();
        expect(s!.matchType).toBe('MANUAL');
        // confidence is intentionally low — needs human review
        expect(s!.confidence).toBeLessThan(60);
    });

    it('rejects pairs with >50% amount diff and >30 day gap', () => {
        const s = scoreErpBank(
            erp({ amount: 1000, issue_date: '2026-01-01' }),
            bank({ amount: 100, statement_date: '2026-04-01' })
        );
        expect(s).toBeNull();
    });

    it('rejects when ERP amount is effectively zero', () => {
        expect(scoreErpBank(erp({ amount: 0 }), bank({ amount: 0 }))).toBeNull();
        expect(scoreErpBank(erp({ amount: 0.005 }), bank({ amount: 100 }))).toBeNull();
    });
});

describe('scoreErpBank — date proximity bonuses/penalties', () => {
    it('boosts confidence when bank date is within 3 days of issue date', () => {
        const tight = scoreErpBank(
            erp({ amount: 1000, issue_date: '2026-04-01' }),
            bank({ amount: 1000, statement_date: '2026-04-02' })
        );
        const looser = scoreErpBank(
            erp({ amount: 1000, issue_date: '2026-04-01' }),
            bank({ amount: 1000, statement_date: '2026-04-20' })
        );
        expect(tight!.confidence).toBeGreaterThan(looser!.confidence);
    });

    it('clamps confidence into 0-100', () => {
        const s = scoreErpBank(erp(), bank());
        expect(s!.confidence).toBeGreaterThanOrEqual(0);
        expect(s!.confidence).toBeLessThanOrEqual(100);
    });
});
