/**
 * InvoicePrint — print-friendly A4 invoice view.
 *
 * Opened in a new tab from the Invoices list (/print/invoice/:uuid). Renders
 * a single invoice in a clean, paper-like layout using @media print CSS so the
 * browser's "Save as PDF" produces a usable document without a PDF library.
 *
 * Why not server-side PDF? The browser's native print pipeline is:
 *   - consistent with what the user sees on screen
 *   - free (no puppeteer/headless-chrome in production)
 *   - respects user paper size / margins
 *   - works offline once the page is loaded
 */

import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Printer, Loader2, AlertCircle, ArrowLeft } from 'lucide-react';
import { API_URL } from '../services/apiService';

const getAuthHeaders = (): Record<string, string> => {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  try {
    const user = JSON.parse(localStorage.getItem('invoice_user') || '{}');
    if (user.token) headers['Authorization'] = `Bearer ${user.token}`;
  } catch { /* ignore */ }
  return headers;
};

const fmt = (n: any) =>
  Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtDate = (d: any) => {
  if (!d) return '—';
  try { return new Date(d).toLocaleDateString('en-GB'); } catch { return String(d); }
};

const InvoicePrint: React.FC = () => {
  const { uuid } = useParams<{ uuid: string }>();
  const [data, setData] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const r = await fetch(`${API_URL}/reports/invoice/${uuid}/full`, { headers: getAuthHeaders() });
        const d = await r.json();
        if (!mounted) return;
        if (!r.ok || !d.success) throw new Error(d.message || `HTTP ${r.status}`);
        setData(d);
      } catch (e: any) {
        if (mounted) setError(e.message);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [uuid]);

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 bg-gray-50">
        <Loader2 size={32} className="animate-spin text-blue-600" />
        <p className="text-sm text-slate-500">Loading invoice…</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 bg-gray-50 p-6">
        <AlertCircle size={32} className="text-rose-500" />
        <p className="text-sm text-rose-600 font-semibold">{error || 'Invoice not found'}</p>
        <button onClick={() => window.close()} className="text-xs text-slate-500 hover:text-slate-700">
          Close this tab
        </button>
      </div>
    );
  }

  const { document: doc, lines, organization } = data;

  // Aggregate tax totals across all lines by tax type. We read the flat tax1..tax8
  // columns because they're populated by the sync path and cover both legacy and
  // new invoices.
  const taxTotals: Record<string, number> = {};
  let totalNet = 0;
  for (const l of lines) {
    totalNet += Number(l.netTotal || 0);
    for (let i = 1; i <= 8; i++) {
      const type = l[`tax${i}_type`];
      const amount = Number(l[`tax${i}_amount`] || 0);
      if (type && amount) taxTotals[type] = (taxTotals[type] || 0) + amount;
    }
  }

  return (
    <div className="min-h-screen bg-gray-100 p-6 print:bg-white print:p-0">
      {/* Print / back toolbar — hidden when printing */}
      <div className="print:hidden max-w-[210mm] mx-auto flex items-center justify-between mb-4">
        <button onClick={() => window.close()}
          className="flex items-center gap-1.5 text-sm font-semibold text-slate-600 hover:text-slate-800">
          <ArrowLeft size={14} /> Close
        </button>
        <button onClick={() => window.print()}
          className="flex items-center gap-2 bg-blue-600 text-white px-5 py-2 rounded-lg text-sm font-bold hover:bg-blue-700 shadow-md">
          <Printer size={14} /> Print / Save as PDF
        </button>
      </div>

      {/* A4-ish page. Using mm so print looks identical to preview. */}
      <div className="max-w-[210mm] mx-auto bg-white shadow-lg print:shadow-none" style={{ minHeight: '297mm' }}>
        <div className="p-10 print:p-8">

          {/* ── Header ──────────────────────────────────────────── */}
          <div className="flex items-start justify-between border-b-2 border-slate-800 pb-5">
            <div className="flex-1">
              <div className="text-2xl font-black text-slate-900 mb-1">{organization?.name || '—'}</div>
              <div className="text-xs text-slate-500 space-y-0.5">
                {organization?.tax_id && <div>Tax ID: <span className="font-mono font-bold text-slate-700">{organization.tax_id}</span></div>}
                {(organization?.city || organization?.country) && <div>{[organization.city, organization.country].filter(Boolean).join(', ')}</div>}
              </div>
            </div>
            <div className="text-right">
              <div className="text-3xl font-black text-slate-800 mb-1">INVOICE</div>
              <div className="text-[11px] text-slate-500">
                <div>Internal ID: <span className="font-mono font-bold text-slate-700">{doc.internalId || '—'}</span></div>
                <div className="font-mono text-[9px] text-slate-400 break-all max-w-[260px]">{doc.uuid}</div>
                <div className="mt-1"><span className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold ${
                  doc.status === 'Valid' ? 'bg-emerald-100 text-emerald-700'
                  : doc.status === 'Cancelled' ? 'bg-slate-100 text-slate-600'
                  : doc.status === 'Rejected' ? 'bg-amber-100 text-amber-700'
                  : 'bg-blue-100 text-blue-700'
                }`}>{doc.status}</span></div>
              </div>
            </div>
          </div>

          {/* ── Dates + type row ────────────────────────────────── */}
          <div className="grid grid-cols-3 gap-6 mt-5 text-[11px]">
            <div>
              <div className="font-bold text-slate-400 uppercase text-[9px] mb-0.5">Issue Date</div>
              <div className="font-semibold text-slate-800">{fmtDate(doc.dateTimeIssued)}</div>
            </div>
            <div>
              <div className="font-bold text-slate-400 uppercase text-[9px] mb-0.5">Type</div>
              <div className="font-semibold text-slate-800">{doc.typeName || doc.documentType || '—'}{doc.typeVersionName ? ` v${doc.typeVersionName}` : ''}</div>
            </div>
            <div>
              <div className="font-bold text-slate-400 uppercase text-[9px] mb-0.5">Direction</div>
              <div className="font-semibold text-slate-800">{doc.direction || '—'}</div>
            </div>
          </div>

          {/* ── Parties ─────────────────────────────────────────── */}
          <div className="grid grid-cols-2 gap-5 mt-6">
            <div className="p-4 bg-slate-50 rounded-lg">
              <div className="text-[9px] font-bold text-slate-400 uppercase mb-1">Issuer</div>
              <div className="font-bold text-sm text-slate-800">{doc.issuerName || '—'}</div>
              <div className="text-[11px] text-slate-600 font-mono">{doc.issuerId}</div>
              {doc.issuer_address_governate && (
                <div className="text-[10px] text-slate-500 mt-1.5">
                  {[doc.issuer_address_street, doc.issuer_address_regionCity, doc.issuer_address_governate, doc.issuer_address_country].filter(Boolean).join(' · ')}
                </div>
              )}
            </div>
            <div className="p-4 bg-slate-50 rounded-lg">
              <div className="text-[9px] font-bold text-slate-400 uppercase mb-1">Receiver</div>
              <div className="font-bold text-sm text-slate-800">{doc.receiverName || '—'}</div>
              <div className="text-[11px] text-slate-600 font-mono">{doc.receiverId}</div>
              {doc.receiver_address_governate && (
                <div className="text-[10px] text-slate-500 mt-1.5">
                  {[doc.receiver_address_street, doc.receiver_address_regionCity, doc.receiver_address_governate, doc.receiver_address_country].filter(Boolean).join(' · ')}
                </div>
              )}
            </div>
          </div>

          {/* ── Line items ──────────────────────────────────────── */}
          <div className="mt-7">
            <table className="w-full text-[11px] border-collapse">
              <thead>
                <tr className="bg-slate-800 text-white text-[10px] uppercase">
                  <th className="text-left px-3 py-2 font-bold">Description</th>
                  <th className="text-left px-3 py-2 font-bold">Item Code</th>
                  <th className="text-right px-3 py-2 font-bold">Qty</th>
                  <th className="text-right px-3 py-2 font-bold">Unit Price</th>
                  <th className="text-right px-3 py-2 font-bold">Net</th>
                  <th className="text-right px-3 py-2 font-bold">Total</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l: any, i: number) => (
                  <tr key={l.id || i} className="border-b border-slate-100">
                    <td className="px-3 py-2">
                      <div className="font-semibold">{l.description || '—'}</div>
                      {l.internalCode && <div className="text-[9px] text-slate-400 font-mono">{l.internalCode}</div>}
                    </td>
                    <td className="px-3 py-2 font-mono text-[10px] text-slate-500">{l.itemCode}</td>
                    <td className="px-3 py-2 text-right font-mono">{fmt(l.quantity)}</td>
                    <td className="px-3 py-2 text-right font-mono">{fmt(l.unitPrice || l.amountEGP)}</td>
                    <td className="px-3 py-2 text-right font-mono">{fmt(l.netTotal)}</td>
                    <td className="px-3 py-2 text-right font-mono font-bold">{fmt(l.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* ── Totals box ──────────────────────────────────────── */}
          <div className="flex justify-end mt-6">
            <div className="w-80 text-[11px] space-y-1">
              <div className="flex justify-between"><span className="text-slate-500">Subtotal</span><span className="font-mono">{fmt(doc.totalSales)}</span></div>
              {Number(doc.totalDiscount || 0) > 0 && (
                <div className="flex justify-between"><span className="text-slate-500">Discount</span><span className="font-mono text-rose-600">-{fmt(doc.totalDiscount)}</span></div>
              )}
              <div className="flex justify-between"><span className="text-slate-500">Net Amount</span><span className="font-mono">{fmt(doc.netAmount)}</span></div>
              {Object.entries(taxTotals).map(([type, amount]) => (
                <div key={type} className="flex justify-between">
                  <span className="text-slate-500">Tax {type}</span>
                  <span className="font-mono">{fmt(amount)}</span>
                </div>
              ))}
              {Number(doc.extraDiscountAmount || 0) > 0 && (
                <div className="flex justify-between"><span className="text-slate-500">Extra Discount</span><span className="font-mono text-rose-600">-{fmt(doc.extraDiscountAmount)}</span></div>
              )}
              <div className="flex justify-between pt-2 mt-2 border-t-2 border-slate-800 text-base font-black text-slate-900">
                <span>Total Due</span>
                <span className="font-mono">{fmt(doc.total)} {doc.currency || 'EGP'}</span>
              </div>
            </div>
          </div>

          {/* ── Footer / notes ──────────────────────────────────── */}
          <div className="mt-10 pt-4 border-t border-slate-100 text-[9px] text-slate-400">
            <div>Generated by OTax Platform · {new Date().toLocaleString()} · Environment: {doc.environment || 'PROD'}</div>
            {doc.publicUrl && <div className="mt-1 break-all">Public URL: {doc.publicUrl}</div>}
          </div>
        </div>
      </div>

      {/* Print CSS — removes toolbar, suppresses margins, forces white bg. */}
      <style>{`
        @media print {
          body { background: white !important; }
          @page { size: A4; margin: 10mm; }
        }
      `}</style>
    </div>
  );
};

export default InvoicePrint;
