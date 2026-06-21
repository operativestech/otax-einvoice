/**
 * matchEngine — Phase 2.2 auto-match scoring
 *
 * Pairs an ERP row with the most likely bank transaction (and optionally an ETA
 * document) within a date window, then classifies the link as one of:
 *
 *   PERFECT  — same amount & date close & (optionally) counterparty matches
 *   WHT      — bank amount = erp * (1 - withholding rate) — common 1%, 3%, 5%
 *   FX       — different currencies but amounts reconcile via an implied rate
 *   MANUAL   — close but nothing above fits; human should review
 *
 * Confidence scoring is heuristic (0-100). Suggestions land in matches table as
 * status SUGGESTED; a human accepts/rejects via the CRUD endpoints.
 */

import pg from 'pg';
import { getOrgTableNames, ensureReconciliationTables } from './orgTables.js';

// ──────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────

export interface ErpRow {
    id: number;
    tx_type: 'AR' | 'AP';
    doc_number: string | null;
    counterparty_id: string | null;
    counterparty_name: string | null;
    issue_date: string | null; // YYYY-MM-DD
    amount: number;
    currency: string;
}

export interface BankRow {
    id: number;
    statement_date: string | null;
    amount: number; // signed (credit +, debit -)
    currency: string;
    description: string | null;
    reference: string | null;
}

interface EtaDoc {
    uuid: string;
    internalId: string | null;
    issuerId: string | null;
    receiverId: string | null;
    dateTimeIssued: string | null;
    total: number | null;
    status: string | null;
}

export interface MatchSuggestion {
    erpTxId: number;
    bankTxId: number | null;
    etaUuid: string | null;
    matchType: 'PERFECT' | 'WHT' | 'FX' | 'MANUAL';
    confidence: number;          // 0-100
    amountDiff: number;          // absolute |erp.amount - bank.amount|
    notes: string;
}

// Common withholding-tax rates in Egypt (approximate rules of thumb).
const WHT_RATES = [0.005, 0.01, 0.015, 0.03, 0.05, 0.10];

// ──────────────────────────────────────────────────────────────
// Utilities
// ──────────────────────────────────────────────────────────────

function daysBetween(a: string | null, b: string | null): number {
    if (!a || !b) return 999;
    const da = new Date(a).getTime();
    const db = new Date(b).getTime();
    return Math.abs(db - da) / (24 * 60 * 60 * 1000);
}

/**
 * Score a single ERP↔Bank candidate. Returns null if they shouldn't be paired.
 *
 * For AR, we expect the bank row to be a CREDIT (positive) matching the ERP amount.
 * For AP, we expect a DEBIT (negative). This means |bank.amount| is compared to erp.amount.
 */
// Exported solely for the unit tests in tests/matchEngine.test.ts. The
// production path goes through runAutoMatch() and shouldn't import this
// directly — the DB plumbing in runAutoMatch is part of the contract.
export function scoreErpBank(erp: ErpRow, bank: BankRow): Omit<MatchSuggestion, 'erpTxId' | 'bankTxId' | 'etaUuid'> | null {
    // Direction check
    const bankSigned = bank.amount;
    const directionOK =
        (erp.tx_type === 'AR' && bankSigned > 0) ||
        (erp.tx_type === 'AP' && bankSigned < 0);

    const bankAbs = Math.abs(bankSigned);
    const erpAbs = Math.abs(erp.amount);
    if (erpAbs < 0.01) return null;

    const rel = Math.abs(erpAbs - bankAbs) / erpAbs;
    const dateDiff = daysBetween(erp.issue_date, bank.statement_date);

    // Skip totally unrelated: >30 days apart and >50% amount diff
    if (dateDiff > 30 && rel > 0.5) return null;

    let matchType: MatchSuggestion['matchType'] = 'MANUAL';
    let confidence = 0;
    let note = '';

    if (rel < 0.002 && erp.currency.toUpperCase() === bank.currency.toUpperCase()) {
        // Amount matches to within 0.2% in same currency
        matchType = 'PERFECT';
        confidence = 92;
        note = 'Amount and currency match exactly';
    } else {
        // Try WHT ratios first
        const wht = WHT_RATES.find(r => {
            const expected = erpAbs * (1 - r);
            return Math.abs(expected - bankAbs) / erpAbs < 0.005;
        });
        if (wht && erp.currency.toUpperCase() === bank.currency.toUpperCase()) {
            matchType = 'WHT';
            confidence = 78;
            note = `Bank appears net of ${(wht * 100).toFixed(1)}% withholding`;
        } else if (erp.currency.toUpperCase() !== bank.currency.toUpperCase()) {
            // Currencies differ → likely FX. Compute implied rate & see if it's plausible (0.01..1000).
            const impliedRate = bankAbs / erpAbs;
            if (impliedRate > 0.005 && impliedRate < 2000) {
                matchType = 'FX';
                confidence = 55;
                note = `Different currencies (${erp.currency} vs ${bank.currency}); implied rate ${impliedRate.toFixed(4)}`;
            } else {
                return null;
            }
        } else if (rel < 0.05) {
            matchType = 'MANUAL';
            confidence = 40;
            note = `Close amounts (within 5%) — needs human review`;
        } else {
            return null;
        }
    }

    // ── Modifiers ──
    if (!directionOK) confidence -= 15; // wrong sign is a strong red flag
    if (dateDiff <= 3) confidence += 5;
    else if (dateDiff <= 7) confidence += 2;
    else if (dateDiff > 14) confidence -= 5;

    // Keep within 0-100
    confidence = Math.max(0, Math.min(100, Math.round(confidence)));

    return {
        matchType,
        confidence,
        amountDiff: Math.abs(erpAbs - bankAbs),
        notes: note,
    };
}

/**
 * Try to also link an ETA document into the suggestion (doesn't change the ERP↔Bank
 * pairing but boosts confidence if counterparty and amount match).
 */
function pickEtaUuid(erp: ErpRow, etaDocs: EtaDoc[]): { uuid: string; confidenceBoost: number; note: string } | null {
    if (!erp.counterparty_id) return null;
    const candidates = etaDocs.filter(d => {
        const otherParty = erp.tx_type === 'AR' ? d.receiverId : d.issuerId;
        return otherParty && otherParty === erp.counterparty_id;
    });
    if (candidates.length === 0) return null;

    // Narrow by amount proximity (±2%)
    const amountMatches = candidates.filter(d => {
        if (!d.total) return false;
        return Math.abs(d.total - Math.abs(erp.amount)) / Math.abs(erp.amount) < 0.02;
    });
    const pool = amountMatches.length > 0 ? amountMatches : candidates;

    // Pick closest by date
    let best: EtaDoc | null = null;
    let bestGap = Infinity;
    for (const d of pool) {
        const g = daysBetween(erp.issue_date, d.dateTimeIssued);
        if (g < bestGap) { bestGap = g; best = d; }
    }
    if (!best) return null;

    const boost = amountMatches.length > 0 && bestGap <= 5 ? 6 : 3;
    return {
        uuid: best.uuid,
        confidenceBoost: boost,
        note: amountMatches.length > 0
            ? `ETA doc ${best.internalId || best.uuid.slice(0, 8)} matched by counterparty + amount`
            : `ETA doc ${best.internalId || best.uuid.slice(0, 8)} matched by counterparty only`,
    };
}

// ──────────────────────────────────────────────────────────────
// Main entry: runAutoMatch
// ──────────────────────────────────────────────────────────────

export interface AutoMatchParams {
    orgId: number;
    orgName: string;
    dateFrom: string;   // ISO date
    dateTo: string;
    minConfidence?: number;  // skip suggestions below this (default 30)
}

export interface AutoMatchResult {
    dateFrom: string;
    dateTo: string;
    erpRowsConsidered: number;
    bankRowsConsidered: number;
    etaDocsConsidered: number;
    suggestionsInserted: number;
    skipped: number;
}

export async function runAutoMatch(pool: pg.Pool, params: AutoMatchParams): Promise<AutoMatchResult> {
    const { orgId, orgName, dateFrom, dateTo } = params;
    const minConfidence = params.minConfidence ?? 30;

    // Safety: with N erp rows × M bank rows this is O(N*M) scoring; refuse to
    // run on absurd volumes so the backend stays responsive. User can narrow
    // the date window or bump the limit if they really need it.
    const MAX_ROWS_PER_SIDE = 25_000;

    await ensureReconciliationTables(pool, orgId, orgName);
    const t = getOrgTableNames(orgId, orgName);

    // ── Load all three datasets in the window ──
    const erpRes = await pool.query(
        `SELECT id, tx_type, doc_number, counterparty_id, counterparty_name, issue_date, amount, currency
         FROM "InvoicesDb"."${t.erp_transactions}"
         WHERE issue_date BETWEEN $1 AND $2
         LIMIT ${MAX_ROWS_PER_SIDE + 1}`,
        [dateFrom, dateTo]
    );
    if (erpRes.rows.length > MAX_ROWS_PER_SIDE) {
        throw new Error(`ERP rows in window (${erpRes.rows.length}) exceed ${MAX_ROWS_PER_SIDE}. Narrow the date range.`);
    }
    const erpRows: ErpRow[] = erpRes.rows.map(normalizeErpRow);

    // Bank rows: expand window a bit (±7 days) — payments can arrive before/after invoice date.
    const expandedFrom = shiftDate(dateFrom, -7);
    const expandedTo = shiftDate(dateTo, 14);
    const bankRes = await pool.query(
        `SELECT id, statement_date, amount, currency, description, reference
         FROM "InvoicesDb"."${t.bank_statements}"
         WHERE statement_date BETWEEN $1 AND $2
         LIMIT ${MAX_ROWS_PER_SIDE + 1}`,
        [expandedFrom, expandedTo]
    );
    if (bankRes.rows.length > MAX_ROWS_PER_SIDE) {
        throw new Error(`Bank rows in window (${bankRes.rows.length}) exceed ${MAX_ROWS_PER_SIDE}. Narrow the date range.`);
    }
    const bankRows: BankRow[] = bankRes.rows.map(normalizeBankRow);

    // ETA docs — capped at 25k as well; counterparty+amount lookup is O(erp*eta).
    const etaDocs: EtaDoc[] = [];
    try {
        const etaRes = await pool.query(
            `SELECT uuid, "internalId", "issuerId", "receiverId", "dateTimeIssued", total, status
             FROM "InvoicesDb"."${t.documents}"
             WHERE "dateTimeIssued" BETWEEN $1 AND $2
             LIMIT ${MAX_ROWS_PER_SIDE}`,
            [dateFrom, dateTo]
        );
        for (const r of etaRes.rows) {
            etaDocs.push({
                uuid: r.uuid,
                internalId: r.internalId,
                issuerId: r.issuerId,
                receiverId: r.receiverId,
                dateTimeIssued: r.dateTimeIssued ? new Date(r.dateTimeIssued).toISOString().slice(0, 10) : null,
                total: r.total ? Number(r.total) : null,
                status: r.status,
            });
        }
    } catch { /* documents table may not exist yet */ }

    // Exclude ERP rows that already have an ACCEPTED match
    const existingRes = await pool.query(
        `SELECT erp_tx_id FROM "InvoicesDb"."${t.matches}" WHERE status = 'ACCEPTED'`
    );
    const alreadyMatched = new Set<number>(existingRes.rows.map((r: any) => Number(r.erp_tx_id)));

    // Wipe prior SUGGESTED rows so we don't accumulate stale suggestions
    await pool.query(`DELETE FROM "InvoicesDb"."${t.matches}" WHERE status = 'SUGGESTED'`);

    // ── Score each ERP row against all bank rows in window; keep the best per ERP row. ──
    let inserted = 0;
    let skipped = 0;

    for (const erp of erpRows) {
        if (alreadyMatched.has(erp.id)) { skipped++; continue; }

        let best: { bank: BankRow; score: Omit<MatchSuggestion, 'erpTxId' | 'bankTxId' | 'etaUuid'> } | null = null;
        for (const bank of bankRows) {
            const s = scoreErpBank(erp, bank);
            if (!s) continue;
            if (!best || s.confidence > best.score.confidence) best = { bank, score: s };
        }

        const etaPick = pickEtaUuid(erp, etaDocs);
        let confidence = best ? best.score.confidence : 0;
        let matchType: MatchSuggestion['matchType'] = best ? best.score.matchType : 'MANUAL';
        let notes = best ? best.score.notes : 'No bank row paired';
        if (etaPick) {
            confidence = Math.min(100, confidence + etaPick.confidenceBoost);
            notes = notes ? `${notes}; ${etaPick.note}` : etaPick.note;
        }

        if (!best && !etaPick) { skipped++; continue; }
        if (confidence < minConfidence) { skipped++; continue; }

        await pool.query(
            `INSERT INTO "InvoicesDb"."${t.matches}"
             (erp_tx_id, bank_tx_id, eta_uuid, match_type, confidence, amount_diff, status, notes, created_at)
             VALUES ($1,$2,$3,$4,$5,$6,'SUGGESTED',$7,NOW())`,
            [
                erp.id,
                best ? best.bank.id : null,
                etaPick ? etaPick.uuid : null,
                matchType,
                confidence,
                best ? best.score.amountDiff : null,
                notes,
            ]
        );
        inserted++;
    }

    return {
        dateFrom,
        dateTo,
        erpRowsConsidered: erpRows.length,
        bankRowsConsidered: bankRows.length,
        etaDocsConsidered: etaDocs.length,
        suggestionsInserted: inserted,
        skipped,
    };
}

// ──────────────────────────────────────────────────────────────
// Row normalization (pg returns numerics as strings / Date objects)
// ──────────────────────────────────────────────────────────────

function normalizeErpRow(r: any): ErpRow {
    return {
        id: Number(r.id),
        tx_type: r.tx_type as 'AR' | 'AP',
        doc_number: r.doc_number,
        counterparty_id: r.counterparty_id,
        counterparty_name: r.counterparty_name,
        issue_date: r.issue_date ? new Date(r.issue_date).toISOString().slice(0, 10) : null,
        amount: Number(r.amount),
        currency: String(r.currency || 'EGP'),
    };
}

function normalizeBankRow(r: any): BankRow {
    return {
        id: Number(r.id),
        statement_date: r.statement_date ? new Date(r.statement_date).toISOString().slice(0, 10) : null,
        amount: Number(r.amount),
        currency: String(r.currency || 'EGP'),
        description: r.description,
        reference: r.reference,
    };
}

function shiftDate(iso: string, days: number): string {
    const d = new Date(iso);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
}
