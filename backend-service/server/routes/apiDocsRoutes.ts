/**
 * Public API documentation page — static HTML served at /api/docs.
 *
 * Kept as a single-file inline template so there's no separate build step
 * for docs. The content is intentionally minimal: auth, a curl example, and
 * a grouped endpoint reference. Integrators should be able to get started
 * in under 5 minutes without opening anything else.
 */

import { Router, Request, Response } from 'express';

const router = Router();

const DOC_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>OTax API Documentation</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #e2e8f0; margin: 0; padding: 32px 24px; line-height: 1.55; }
  .wrap { max-width: 920px; margin: 0 auto; }
  h1 { font-size: 32px; margin: 0 0 4px; color: white; letter-spacing: -0.5px; }
  .sub { color: #94a3b8; margin-bottom: 32px; font-size: 14px; }
  h2 { font-size: 20px; color: white; margin: 40px 0 12px; padding-bottom: 8px; border-bottom: 1px solid #334155; }
  h3 { color: #cbd5e1; margin: 24px 0 8px; font-size: 15px; }
  p, li { color: #cbd5e1; font-size: 14px; }
  code, pre { font-family: 'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, Consolas, monospace; }
  code { background: #1e293b; padding: 2px 6px; border-radius: 4px; font-size: 13px; color: #fde68a; }
  pre { background: #020617; border: 1px solid #334155; padding: 14px 18px; border-radius: 10px; overflow-x: auto; font-size: 13px; color: #a5f3fc; margin: 12px 0; }
  .endpoint { background: #1e293b; border: 1px solid #334155; border-radius: 10px; padding: 12px 16px; margin: 8px 0; display: flex; align-items: flex-start; gap: 12px; }
  .method { font-family: monospace; font-weight: 700; padding: 3px 8px; border-radius: 4px; font-size: 11px; letter-spacing: 0.5px; flex-shrink: 0; margin-top: 2px; }
  .m-get  { background: #0e7490; color: white; }
  .m-post { background: #15803d; color: white; }
  .m-put  { background: #c2410c; color: white; }
  .m-del  { background: #991b1b; color: white; }
  .path { font-family: monospace; font-size: 13px; color: #fbbf24; }
  .desc { color: #94a3b8; font-size: 12px; display: block; margin-top: 2px; }
  .scope { display: inline-block; font-size: 10px; font-weight: 700; padding: 1px 6px; border-radius: 3px; margin-left: 8px; text-transform: uppercase; }
  .s-read  { background: #1e3a8a; color: #dbeafe; }
  .s-write { background: #92400e; color: #fef3c7; }
  .s-admin { background: #7f1d1d; color: #fee2e2; }
  .kbd { display: inline-block; background: #334155; border: 1px solid #475569; border-radius: 4px; padding: 1px 6px; font-family: monospace; font-size: 12px; color: #cbd5e1; }
  a { color: #60a5fa; }
  .note { background: #0c4a6e; border-left: 3px solid #0ea5e9; padding: 12px 16px; border-radius: 6px; margin: 16px 0; color: #bae6fd; font-size: 13px; }
</style>
</head>
<body>
<div class="wrap">
  <h1>OTax API</h1>
  <div class="sub">REST API for programmatic access to your Egyptian e-invoicing data. Base URL: <code>__BASE_URL__/api</code></div>

  <h2>Authentication</h2>
  <p>All endpoints require one of two credentials:</p>
  <ul>
    <li><strong>API Key</strong> (recommended for server-to-server): send it in the <code>X-API-Key</code> header. Create a key in <code>Settings → API Keys</code>.</li>
    <li><strong>JWT token</strong> (used by the web portal): send it in the <code>Authorization: Bearer &lt;token&gt;</code> header.</li>
  </ul>
  <p>Each API key is scoped <span class="scope s-read">read</span>, <span class="scope s-write">write</span>, or <span class="scope s-admin">admin</span>. Scopes are cumulative: write includes read, admin includes write.</p>

  <h3>Quick start</h3>
  <pre>curl __BASE_URL__/api/reports/vat-summary \\
  -H "X-API-Key: otax_live_YOUR_KEY"</pre>

  <div class="note">
    <strong>Rate limits:</strong> 60 requests / minute per key on most endpoints; 10/min on ETA submit paths. You'll get HTTP 429 on throttling.
  </div>

  <h2>Reports</h2>
  <div class="endpoint"><span class="method m-get">GET</span><div><span class="path">/reports/vat-summary?dateFrom=YYYY-MM-DD&dateTo=YYYY-MM-DD</span><span class="scope s-read">read</span><span class="desc">Monthly VAT breakdown — Output, Input, Net Payable.</span></div></div>
  <div class="endpoint"><span class="method m-get">GET</span><div><span class="path">/reports/top-customers?limit=50</span><span class="scope s-read">read</span><span class="desc">Top N customers ranked by total billed.</span></div></div>
  <div class="endpoint"><span class="method m-get">GET</span><div><span class="path">/reports/top-products?limit=50</span><span class="scope s-read">read</span><span class="desc">Top selling items with qty / revenue aggregates.</span></div></div>
  <div class="endpoint"><span class="method m-get">GET</span><div><span class="path">/reports/rejected?grouped=true</span><span class="scope s-read">read</span><span class="desc">Rejection reasons aggregated, or a flat list of rejected invoices.</span></div></div>
  <div class="endpoint"><span class="method m-get">GET</span><div><span class="path">/reports/trends</span><span class="scope s-read">read</span><span class="desc">Monthly time series of revenue + tax, Sent vs Received.</span></div></div>
  <div class="endpoint"><span class="method m-get">GET</span><div><span class="path">/reports/by-activity</span><span class="scope s-read">read</span><span class="desc">Totals grouped by ETA taxpayer activity code.</span></div></div>
  <div class="endpoint"><span class="method m-get">GET</span><div><span class="path">/reports/late-submissions?thresholdHours=48</span><span class="scope s-read">read</span><span class="desc">Sent invoices whose submission lag exceeds the threshold.</span></div></div>
  <div class="endpoint"><span class="method m-get">GET</span><div><span class="path">/reports/forecast</span><span class="scope s-read">read</span><span class="desc">Linear-regression VAT forecast for the next month.</span></div></div>
  <div class="endpoint"><span class="method m-get">GET</span><div><span class="path">/reports/anomalies?lookbackDays=30</span><span class="scope s-read">read</span><span class="desc">Statistical anomalies among recent invoice amounts.</span></div></div>
  <div class="endpoint"><span class="method m-get">GET</span><div><span class="path">/reports/archive?dateFrom=…&amp;dateTo=…</span><span class="scope s-read">read</span><span class="desc">Downloadable ZIP of every invoice in range (JSON + manifest.csv).</span></div></div>
  <div class="endpoint"><span class="method m-get">GET</span><div><span class="path">/reports/duplicates?mode=all|valid</span><span class="scope s-read">read</span><span class="desc">Internal IDs appearing more than once.</span></div></div>

  <h2>Invoices</h2>
  <div class="endpoint"><span class="method m-get">GET</span><div><span class="path">/invoices?dateFrom=…&amp;direction=Sent&amp;status=Valid</span><span class="scope s-read">read</span><span class="desc">Filtered list of invoice headers.</span></div></div>
  <div class="endpoint"><span class="method m-get">GET</span><div><span class="path">/reports/invoice/:uuid/full</span><span class="scope s-read">read</span><span class="desc">One invoice with all lines, in a ready-to-render shape.</span></div></div>
  <div class="endpoint"><span class="method m-post">POST</span><div><span class="path">/excel/submit</span><span class="scope s-write">write</span><span class="desc">Submit a batch of invoices. Body: <code>{ headers: […], details: […] }</code>.</span></div></div>

  <h2>Master Data</h2>
  <div class="endpoint"><span class="method m-get">GET</span><div><span class="path">/master-data/customers?q=…&amp;pageNo=1&amp;pageSize=50</span><span class="scope s-read">read</span><span class="desc">Customer directory (auto-populated from invoices).</span></div></div>
  <div class="endpoint"><span class="method m-post">POST</span><div><span class="path">/master-data/customers</span><span class="scope s-write">write</span><span class="desc">Add a manual customer.</span></div></div>

  <h2>Admin</h2>
  <div class="endpoint"><span class="method m-get">GET</span><div><span class="path">/admin/api-keys</span><span class="scope s-admin">admin</span><span class="desc">List API keys (value hidden).</span></div></div>
  <div class="endpoint"><span class="method m-post">POST</span><div><span class="path">/admin/api-keys</span><span class="scope s-admin">admin</span><span class="desc">Create a new API key. Returns the plaintext once.</span></div></div>
  <div class="endpoint"><span class="method m-del">DEL</span><div><span class="path">/admin/api-keys/:id</span><span class="scope s-admin">admin</span><span class="desc">Revoke an API key.</span></div></div>
  <div class="endpoint"><span class="method m-get">GET</span><div><span class="path">/admin/branches</span><span class="scope s-read">read</span><span class="desc">List registered branches.</span></div></div>
  <div class="endpoint"><span class="method m-post">POST</span><div><span class="path">/admin/branches</span><span class="scope s-admin">admin</span><span class="desc">Register a branch.</span></div></div>

  <h2>Response format</h2>
  <p>Success:</p>
  <pre>{ "success": true, "rows": [...], "totals": {...} }</pre>
  <p>Error:</p>
  <pre>{ "success": false, "message": "..." }</pre>
  <p>HTTP status codes are standard: 200 OK, 400 bad request, 401 unauthenticated, 403 forbidden, 404 not found, 429 rate-limited, 500 server error.</p>

  <h2>Support</h2>
  <p>Questions? Email <a href="mailto:otax.tech@gmail.com">otax.tech@gmail.com</a>.</p>
</div>
</body>
</html>`;

router.get('/', (req: Request, res: Response) => {
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const html = DOC_HTML.replace(/__BASE_URL__/g, baseUrl);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
});

export default router;
