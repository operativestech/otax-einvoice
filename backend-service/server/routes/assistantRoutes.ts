/**
 * Assistant Routes — conversational AI grounded in the user's own data.
 *
 * Uses Gemini (via @google/genai) with function-calling. The model may invoke
 * any of the tools below to fetch live numbers from the caller's org:
 *
 *   - get_invoice_summary(dateFrom, dateTo)
 *   - get_reconciliation_summary()
 *   - get_signing_queue_stats()
 *   - get_top_counterparties(direction, limit)
 *   - list_recent_failed_signatures(limit)
 *
 * When GEMINI_API_KEY is not set, the endpoint falls back to a keyword matcher
 * so the chatbot is still useful (ETA error codes, navigation) offline.
 *
 * Mounted at: POST /api/assistant/chat
 */

import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import pg from 'pg';
import { authenticate, authorize } from '../middleware/auth.js';
import { assistantLimiter } from '../middleware/rateLimit.js';
import { getOrgTableNames } from '../services/orgTables.js';

const router = Router();
const prisma = new PrismaClient();

function getPool(req: Request): pg.Pool { return (req as any).app.get('pool'); }

async function resolveOrg(req: Request): Promise<{ orgId: number; orgName: string } | null> {
    const user = (req as any).user;
    let orgId = user?.organizationId || null;
    if (!orgId) {
        const first = await prisma.organizations.findFirst({ where: { is_active: true }, orderBy: { id: 'asc' } });
        if (!first) return null;
        orgId = first.id;
    }
    const org = await prisma.organizations.findUnique({ where: { id: orgId } });
    if (!org) return null;
    return { orgId, orgName: org.name };
}

// ──────────────────────────────────────────────────────────────────────
// Tool implementations
// ──────────────────────────────────────────────────────────────────────

async function getInvoiceSummary(pool: pg.Pool, orgId: number, orgName: string, dateFrom?: string, dateTo?: string) {
    const t = getOrgTableNames(orgId, orgName);
    const where: string[] = [];
    const params: any[] = [];
    if (dateFrom) { params.push(dateFrom); where.push(`"dateTimeIssued" >= $${params.length}`); }
    if (dateTo) { params.push(dateTo); where.push(`"dateTimeIssued" <= $${params.length}`); }
    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';

    try {
        const res = await pool.query(
            `SELECT status, direction, COUNT(*)::int AS count, COALESCE(SUM(total), 0)::float AS total
             FROM "InvoicesDb"."${t.documents}" ${whereSql}
             GROUP BY status, direction`,
            params
        );
        return { rows: res.rows, dateFrom: dateFrom || null, dateTo: dateTo || null };
    } catch (e: any) {
        return { error: e.message, rows: [] };
    }
}

async function getReconciliationSummary(pool: pg.Pool, orgId: number, orgName: string) {
    const t = getOrgTableNames(orgId, orgName);
    try {
        const [byStatus, erp, bank, amt] = await Promise.all([
            pool.query(`SELECT status, COUNT(*)::int AS count FROM "InvoicesDb"."${t.matches}" GROUP BY status`).catch(() => ({ rows: [] })),
            pool.query(`SELECT COUNT(*)::int AS total FROM "InvoicesDb"."${t.erp_transactions}"`).catch(() => ({ rows: [{ total: 0 }] })),
            pool.query(`SELECT COUNT(*)::int AS total FROM "InvoicesDb"."${t.bank_statements}"`).catch(() => ({ rows: [{ total: 0 }] })),
            pool.query(
                `SELECT COALESCE(SUM(ABS(e.amount)), 0)::float AS total
                 FROM "InvoicesDb"."${t.matches}" m
                 JOIN "InvoicesDb"."${t.erp_transactions}" e ON e.id = m.erp_tx_id
                 WHERE m.status = 'ACCEPTED'`
            ).catch(() => ({ rows: [{ total: 0 }] })),
        ]);
        return {
            byStatus: byStatus.rows,
            erpTotalRows: erp.rows[0]?.total || 0,
            bankTotalRows: bank.rows[0]?.total || 0,
            acceptedMatchedAmount: amt.rows[0]?.total || 0,
        };
    } catch (e: any) {
        return { error: e.message };
    }
}

async function getSigningQueueStats(pool: pg.Pool, orgId: number) {
    const r = await pool.query(
        `SELECT status, COUNT(*)::int AS count
         FROM "otaxdb".signing_queue WHERE org_id = $1 GROUP BY status`,
        [orgId]
    );
    const out: Record<string, number> = { queued: 0, processing: 0, signed: 0, failed: 0 };
    for (const row of r.rows) out[String(row.status).toLowerCase()] = row.count;
    return out;
}

async function getTopCounterparties(pool: pg.Pool, orgId: number, orgName: string, direction: string = 'Sent', limit: number = 5) {
    const t = getOrgTableNames(orgId, orgName);
    const col = direction === 'Sent' ? '"receiverId"' : '"issuerId"';
    const nameCol = direction === 'Sent' ? '"receiverName"' : '"issuerName"';
    try {
        const r = await pool.query(
            `SELECT ${col} AS counterparty_id, ${nameCol} AS counterparty_name,
                    COUNT(*)::int AS count, COALESCE(SUM(total), 0)::float AS total
             FROM "InvoicesDb"."${t.documents}"
             WHERE direction = $1 AND ${col} IS NOT NULL
             GROUP BY ${col}, ${nameCol}
             ORDER BY total DESC
             LIMIT $2`,
            [direction, Math.max(1, Math.min(limit, 50))]
        );
        return { direction, rows: r.rows };
    } catch (e: any) {
        return { error: e.message, rows: [] };
    }
}

async function listRecentFailedSignatures(pool: pg.Pool, orgId: number, limit: number = 5) {
    try {
        const r = await pool.query(
            `SELECT id, internal_id, attempts, last_error, finished_at
             FROM "otaxdb".signing_queue
             WHERE org_id = $1 AND status = 'FAILED'
             ORDER BY finished_at DESC NULLS LAST
             LIMIT $2`,
            [orgId, Math.max(1, Math.min(limit, 20))]
        );
        return { rows: r.rows };
    } catch (e: any) {
        return { error: e.message, rows: [] };
    }
}

const TOOL_IMPLS: Record<string, (pool: pg.Pool, orgId: number, orgName: string, args: any) => Promise<any>> = {
    get_invoice_summary: (pool, oid, on, a) => getInvoiceSummary(pool, oid, on, a?.dateFrom, a?.dateTo),
    get_reconciliation_summary: (pool, oid, on) => getReconciliationSummary(pool, oid, on),
    get_signing_queue_stats: (pool, oid) => getSigningQueueStats(pool, oid),
    get_top_counterparties: (pool, oid, on, a) => getTopCounterparties(pool, oid, on, a?.direction, a?.limit),
    list_recent_failed_signatures: (pool, oid, on, a) => listRecentFailedSignatures(pool, oid, a?.limit),
};

// Function declarations exposed to the model. Keep descriptions short but precise.
const FUNCTION_DECLARATIONS = [
    {
        name: 'get_invoice_summary',
        description: "Counts and totals of the organization's invoices, grouped by status and direction (Sent/Received). Use when the user asks about invoice counts, totals, or breakdowns.",
        parameters: {
            type: 'object',
            properties: {
                dateFrom: { type: 'string', description: "Start date in YYYY-MM-DD; optional." },
                dateTo: { type: 'string', description: "End date in YYYY-MM-DD; optional." },
            },
        },
    },
    {
        name: 'get_reconciliation_summary',
        description: 'Counts of suggested/accepted/rejected matches, plus total matched amount and ERP/Bank row totals. Use for questions about reconciliation, matching, or unmatched invoices.',
        parameters: { type: 'object', properties: {} },
    },
    {
        name: 'get_signing_queue_stats',
        description: 'Number of signing jobs by status (queued/processing/signed/failed). Use when asked about signing progress or failed sign jobs.',
        parameters: { type: 'object', properties: {} },
    },
    {
        name: 'get_top_counterparties',
        description: 'Top receivers (direction=Sent) or top issuers (direction=Received) by total invoice amount.',
        parameters: {
            type: 'object',
            properties: {
                direction: { type: 'string', enum: ['Sent', 'Received'] },
                limit: { type: 'integer', description: 'Max rows (1-50).' },
            },
        },
    },
    {
        name: 'list_recent_failed_signatures',
        description: 'Recent FAILED signing jobs with their error messages. Use when user asks why signing failed or wants to see errors.',
        parameters: {
            type: 'object',
            properties: { limit: { type: 'integer' } },
        },
    },
];

// ──────────────────────────────────────────────────────────────────────
// Fallback — keyword matcher when Gemini is not available
// ──────────────────────────────────────────────────────────────────────

const ETA_ERROR_HINTS: Record<string, string> = {
    '4062': 'Attached digital signature is not supported. The signature must be detached (CAdES-BES format).',
    '4090': 'Duplicated ID — this invoice internal ID has already been submitted to ETA.',
    '4105': 'Invalid signature — the digital signature verification failed. Check your certificate and signing process.',
    '5000': 'Signature verification failed — ETA could not validate the signature.',
    '4000': 'Invalid document structure — check your invoice JSON/XML format.',
    '4001': 'Missing required field.',
    '4010': 'Invalid tax ID for issuer or receiver.',
    '4020': 'Invalid date format — dates must be ISO 8601 (YYYY-MM-DDTHH:mm:ssZ).',
};

function keywordFallback(message: string): string {
    const lower = message.toLowerCase();
    const errMatch = lower.match(/\b(40\d{2}|50\d{2})\b/);
    if (errMatch) {
        return ETA_ERROR_HINTS[errMatch[0]] || `Error code ${errMatch[0]} — see ETA documentation for details.`;
    }
    if (/(reconcil|match|mismatch)/i.test(lower)) return 'Reconciliation lives at /reconciliation. You can upload ERP and bank CSVs, then run Auto-Match.';
    if (/(sign|certificate|شهادة|توقيع)/i.test(lower)) return 'Signing uses either a PFX cert (uploaded in Settings) or the local USB token via the OTax Agent.';
    if (/(dashboard|لوحة)/i.test(lower)) return 'Dashboard shows KPIs, recent activity, reconciliation coverage, and signing queue status.';
    if (/(package|export|تصدير)/i.test(lower)) return 'Open /export-packages to request a Summary/Full package from ETA (JSON or XML) for a date range.';
    return "I can help with ETA error codes (4062, 4090, 4105…), reconciliation, signing, and exports. Ask a specific question, e.g. 'how many invoices last month?'.";
}

// ──────────────────────────────────────────────────────────────────────
// The endpoint
// ──────────────────────────────────────────────────────────────────────

router.post('/chat', authenticate, authorize('assistant.use'), assistantLimiter, async (req: Request, res: Response) => {
    const pool = getPool(req);
    const message = String(req.body?.message || '').trim();
    if (!message) return res.status(400).json({ success: false, message: 'message is required' });

    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;

    // If no API key, answer with the keyword matcher.
    if (!apiKey) {
        return res.json({ success: true, response: keywordFallback(message), mode: 'keyword' });
    }

    const org = await resolveOrg(req);
    if (!org) return res.status(400).json({ success: false, message: 'No organization found' });

    try {
        const { GoogleGenAI, Type } = await import('@google/genai');
        const ai = new GoogleGenAI({ apiKey });

        // Convert our declaration types to the SDK's enum-based Type system.
        const mapType = (t: string): any => {
            switch (t) {
                case 'string': return Type.STRING;
                case 'integer': return Type.INTEGER;
                case 'number': return Type.NUMBER;
                case 'boolean': return Type.BOOLEAN;
                case 'object': return Type.OBJECT;
                default: return Type.STRING;
            }
        };
        const sdkDecls = FUNCTION_DECLARATIONS.map(fd => ({
            name: fd.name,
            description: fd.description,
            parameters: fd.parameters ? {
                type: mapType(fd.parameters.type),
                properties: Object.fromEntries(
                    Object.entries(fd.parameters.properties || {}).map(([k, v]: [string, any]) => [
                        k, { type: mapType(v.type), description: v.description, enum: v.enum }
                    ])
                ),
            } : undefined,
        }));

        const systemInstruction = `You are OTax Smart Assistant. You help the user of an Egyptian e-invoicing SaaS. Current org: "${org.orgName}" (id ${org.orgId}).
Answer in the user's language (Arabic or English — match the question).
When the user asks a question that needs numbers, CALL one of the provided tools. Do NOT fabricate figures. Keep answers concise — 1-3 short sentences unless the user asks for detail.
Today's date is ${new Date().toISOString().slice(0, 10)}.`;

        // Turn 1: ask the model — may return function calls
        const history: any[] = [{ role: 'user', parts: [{ text: message }] }];
        let turn = await ai.models.generateContent({
            model: 'gemini-2.0-flash',
            contents: history,
            config: {
                systemInstruction,
                tools: [{ functionDeclarations: sdkDecls as any }],
            },
        });

        // Handle function calls (possibly multiple rounds; cap at 3 to avoid loops)
        for (let round = 0; round < 3; round++) {
            const calls = (turn as any).functionCalls as Array<{ name: string; args?: any }> | undefined;
            if (!calls || calls.length === 0) break;

            const toolParts: any[] = [];
            for (const call of calls) {
                const impl = TOOL_IMPLS[call.name];
                let result: any;
                if (!impl) result = { error: `Unknown tool ${call.name}` };
                else {
                    try { result = await impl(pool, org.orgId, org.orgName, call.args || {}); }
                    catch (e: any) { result = { error: e.message }; }
                }
                toolParts.push({ functionResponse: { name: call.name, response: result } });
            }

            // Feed tool results back to the model
            history.push({ role: 'model', parts: calls.map(c => ({ functionCall: { name: c.name, args: c.args } })) });
            history.push({ role: 'user', parts: toolParts });

            turn = await ai.models.generateContent({
                model: 'gemini-2.0-flash',
                contents: history,
                config: {
                    systemInstruction,
                    tools: [{ functionDeclarations: sdkDecls as any }],
                },
            });
        }

        const text = (turn as any).text || 'Sorry, I could not produce a response.';
        res.json({ success: true, response: text, mode: 'gemini' });
    } catch (err: any) {
        console.error('[Assistant] Gemini error:', err.message);
        // Graceful fallback if Gemini call fails (rate limit, network, etc.)
        res.json({ success: true, response: keywordFallback(message), mode: 'fallback', error: err.message });
    }
});

export default router;
