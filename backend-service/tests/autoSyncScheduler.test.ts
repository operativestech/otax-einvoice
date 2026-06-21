/**
 * Smoke tests for the auto-sync scheduler's "is this run due now?" gate.
 *
 * Why this matters: getting `isDueNow` wrong means we either spam ETA every
 * tick (rate-limit ban) or never sync at all (silent data drift). The
 * function is a pure decision tree on row state + clock, so it's the cheapest
 * thing in the codebase to lock down with deterministic tests.
 */

import { describe, it, expect } from 'vitest';
import { isDueNow } from '../server/services/autoSyncScheduler.js';

// Helper: build an AutoSyncRow with sensible defaults so each test only sets
// the fields it's actually exercising.
function row(overrides: Partial<{
    eta_sync_mode: string | null;
    eta_sync_interval: number | null;
    eta_sync_times: string[] | null;
    eta_last_auto_sync_at: Date | null;
    eta_auto_sync: boolean | null;
}> = {}) {
    return {
        organization_id: 1,
        eta_sync_mode: null,
        eta_sync_interval: null,
        eta_sync_times: null,
        eta_last_auto_sync_at: null,
        eta_auto_sync: null,
        ...overrides,
    };
}

describe('isDueNow — mode "off"', () => {
    it('never fires when mode is off', () => {
        expect(isDueNow(row({ eta_sync_mode: 'off' }), new Date())).toBe(false);
        expect(isDueNow(row({ eta_sync_mode: null }), new Date())).toBe(false);
    });
});

describe('isDueNow — mode "interval"', () => {
    const NOW = new Date('2026-04-26T10:00:00Z');

    it('fires when no previous run is recorded', () => {
        expect(isDueNow(row({ eta_sync_mode: 'interval', eta_sync_interval: 60 }), NOW)).toBe(true);
    });

    it('fires when the interval has elapsed', () => {
        // 65 minutes ago, interval 60 minutes
        const last = new Date(NOW.getTime() - 65 * 60_000);
        expect(isDueNow(row({ eta_sync_mode: 'interval', eta_sync_interval: 60, eta_last_auto_sync_at: last }), NOW)).toBe(true);
    });

    it('does NOT fire when the interval has not yet elapsed', () => {
        const last = new Date(NOW.getTime() - 30 * 60_000);
        expect(isDueNow(row({ eta_sync_mode: 'interval', eta_sync_interval: 60, eta_last_auto_sync_at: last }), NOW)).toBe(false);
    });

    it('clamps absurdly small intervals to a 5-minute floor', () => {
        // interval=1 should be treated as 5 → so 4 minutes since last run is NOT due
        const last = new Date(NOW.getTime() - 4 * 60_000);
        expect(isDueNow(row({ eta_sync_mode: 'interval', eta_sync_interval: 1, eta_last_auto_sync_at: last }), NOW)).toBe(false);
    });

    it('clamps absurdly large intervals to a 24-hour ceiling', () => {
        // interval=100000 should be treated as 1440 → 1500 minutes since last run IS due
        const last = new Date(NOW.getTime() - 1500 * 60_000);
        expect(isDueNow(row({ eta_sync_mode: 'interval', eta_sync_interval: 100_000, eta_last_auto_sync_at: last }), NOW)).toBe(true);
    });

    it('refuses to re-fire within the 2-minute dedup window even if interval is tiny', () => {
        // last run 1 minute ago, interval 60 → would otherwise be way past due
        const last = new Date(NOW.getTime() - 60_000);
        expect(isDueNow(row({ eta_sync_mode: 'interval', eta_sync_interval: 60, eta_last_auto_sync_at: last }), NOW)).toBe(false);
    });
});

describe('isDueNow — mode "times"', () => {
    it('fires at the start of an HH:MM that matches the schedule', () => {
        // Construct "now" with explicit local hour:minute = 09:30
        const now = new Date();
        now.setHours(9, 30, 0, 0);
        const r = row({
            eta_sync_mode: 'times',
            eta_sync_times: ['09:30', '14:00'],
            // pretend last run was 3 minutes ago so we clear the dedup window
            eta_last_auto_sync_at: new Date(now.getTime() - 3 * 60_000),
        });
        expect(isDueNow(r, now)).toBe(true);
    });

    it('does NOT fire on a non-matching minute', () => {
        const now = new Date();
        now.setHours(9, 31, 0, 0);
        const r = row({
            eta_sync_mode: 'times',
            eta_sync_times: ['09:30'],
            eta_last_auto_sync_at: new Date(now.getTime() - 60 * 60_000),
        });
        expect(isDueNow(r, now)).toBe(false);
    });

    it('returns false with empty times array', () => {
        const now = new Date();
        now.setHours(9, 30, 0, 0);
        expect(isDueNow(row({ eta_sync_mode: 'times', eta_sync_times: [] }), now)).toBe(false);
        expect(isDueNow(row({ eta_sync_mode: 'times', eta_sync_times: null }), now)).toBe(false);
    });

    it('still respects the 2-minute dedup window', () => {
        const now = new Date();
        now.setHours(9, 30, 0, 0);
        const r = row({
            eta_sync_mode: 'times',
            eta_sync_times: ['09:30'],
            eta_last_auto_sync_at: new Date(now.getTime() - 30_000), // 30 sec ago
        });
        expect(isDueNow(r, now)).toBe(false);
    });

    it('ignores malformed time entries instead of throwing', () => {
        const now = new Date();
        now.setHours(9, 30, 0, 0);
        const r = row({
            eta_sync_mode: 'times',
            eta_sync_times: ['09:30', 'not-a-time', '99:99', ':30'],
            eta_last_auto_sync_at: new Date(now.getTime() - 5 * 60_000),
        });
        expect(isDueNow(r, now)).toBe(true);
    });
});
