/**
 * Rate limiters — per-user (by auth'd user id) with IP fallback.
 *
 * The project has several classes of traffic with different risk profiles:
 *   - Generic API chatter             → apiLimiter (lenient)
 *   - ETA portal calls (they'll throttle us if we hammer)  → etaLimiter
 *   - Bulk scoring jobs (auto-match)  → bulkLimiter (strict, expensive on DB)
 *   - AI chat (paid per-token)        → assistantLimiter (strict, paid)
 *
 * If a caller is authenticated, we key by `user.id` so multiple browsers / devices
 * of the same user share the quota. Otherwise we fall back to the source IP.
 */

import rateLimit, { ipKeyGenerator, type Options } from 'express-rate-limit';

/**
 * Key strategy: authenticated user first (multi-device shares quota), then fall
 * back to `ipKeyGenerator` which correctly normalizes IPv4 + IPv6 per
 * express-rate-limit v7's recommendation.
 */
function keyFromUserOrIp(req: any, res: any): string {
    const uid = req.user?.id;
    if (uid) return `u:${uid}`;
    return ipKeyGenerator(req.ip || req.socket?.remoteAddress || 'unknown');
}

function build(opts: Partial<Options>): ReturnType<typeof rateLimit> {
    return rateLimit({
        standardHeaders: 'draft-7', // RateLimit-* headers
        legacyHeaders: false,
        keyGenerator: keyFromUserOrIp,
        message: { success: false, message: 'Too many requests — please slow down and retry shortly.' },
        ...opts,
    });
}

// Generic baseline — catches everything mounted under /api (handlers pick narrower ones on top).
export const apiLimiter = build({
    windowMs: 60_000,
    max: 300, // 300 req/min per user/IP — plenty for interactive UI
});

// ETA-facing routes: auto-match, sync, package requests, doc submission.
// Keep this tight: ETA will block the integrator if we misbehave.
export const etaLimiter = build({
    windowMs: 60_000,
    max: 60,
});

// Heavy jobs (auto-match, XLSX imports): 10 per minute is usually enough for
// month-end batches and still keeps the DB responsive.
export const bulkLimiter = build({
    windowMs: 60_000,
    max: 10,
});

// Paid LLM calls — prevent runaway costs.
export const assistantLimiter = build({
    windowMs: 60_000,
    max: 20,
});
