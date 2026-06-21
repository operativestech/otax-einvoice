import React, { useState, useEffect, useCallback } from 'react';
import { GitCompare, UploadCloud, Loader2, Landmark, FileSpreadsheet, History, AlertCircle, CheckCircle2, Trash2, RefreshCw, Zap, Check, X, Calendar, PieChart, TrendingUp, Download } from 'lucide-react';
import { API_URL } from '../services/apiService';
import { exportExcel, fmtDate, num } from '../utils/export';
import { confirmDialog, alertDialog } from '../components/ConfirmDialog';

// ─── Types ───────────────────────────────────────────────────────────────

type Side = 'erp' | 'bank';

interface ErpRow {
  id: number;
  tx_type: 'AR' | 'AP';
  doc_number: string | null;
  counterparty_id: string | null;
  counterparty_name: string | null;
  issue_date: string | null;
  due_date: string | null;
  amount: number;
  currency: string;
  status: string | null;
  external_ref: string | null;
  import_batch_id: string;
  imported_at: string;
}

interface BankRow {
  id: number;
  bank_account: string | null;
  statement_date: string | null;
  value_date: string | null;
  amount: number;
  currency: string;
  description: string | null;
  reference: string | null;
  balance_after: number | null;
  import_batch_id: string;
  imported_at: string;
}

interface BatchRow {
  side: 'ERP' | 'BANK';
  import_batch_id: string;
  rows: number;
  imported_at: string;
  bank_account?: string | null;
}

interface MatchRow {
  id: number;
  erp_tx_id: number | null;
  bank_tx_id: number | null;
  eta_uuid: string | null;
  match_type: 'PERFECT' | 'WHT' | 'FX' | 'MANUAL';
  confidence: number;
  amount_diff: number | null;
  status: 'SUGGESTED' | 'ACCEPTED' | 'REJECTED';
  notes: string | null;
  created_at: string;
  reviewed_at: string | null;
  // joined
  erp_tx_type: 'AR' | 'AP' | null;
  erp_doc_number: string | null;
  erp_counterparty_name: string | null;
  erp_counterparty_id: string | null;
  erp_issue_date: string | null;
  erp_amount: number | null;
  erp_currency: string | null;
  bank_statement_date: string | null;
  bank_amount: number | null;
  bank_currency: string | null;
  bank_description: string | null;
  bank_reference: string | null;
  bank_account: string | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────

const getAuthHeaders = (): Record<string, string> => {
  const headers: Record<string, string> = {};
  const userStr = localStorage.getItem('invoice_user');
  if (userStr) {
    try {
      const user = JSON.parse(userStr);
      if (user.token) headers['Authorization'] = `Bearer ${user.token}`;
      if (user.id) headers['X-User-ID'] = String(user.id);
    } catch { /* ignore */ }
  }
  return headers;
};

// Headers for JSON fetch (auth + content-type)
const getJsonHeaders = () => ({ ...getAuthHeaders(), 'Content-Type': 'application/json' });

const formatMoney = (v: number | null, ccy = 'EGP') => {
  if (v === null || v === undefined) return '—';
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v) + ' ' + ccy;
};

const shortBatch = (id: string) => id?.slice(0, 8) || '';

// ─── Upload Card ─────────────────────────────────────────────────────────

interface UploadCardProps {
  side: Side;
  onUploaded: () => void;
}

const UploadCard: React.FC<UploadCardProps> = ({ side, onUploaded }) => {
  const [file, setFile] = useState<File | null>(null);
  const [bankAccount, setBankAccount] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<
    | null
    | { kind: 'ok'; inserted: number; skipped: number; skippedRows?: { row: number; reason: string }[]; batchId: string }
    | { kind: 'err'; message: string }
  >(null);

  const title = side === 'erp' ? 'Upload ERP Transactions' : 'Upload Bank Statement';
  const hint = side === 'erp'
    ? 'CSV / Excel with columns like type (AR or AP), amount, doc_number, counterparty_id, counterparty_name, issue_date.'
    : 'CSV / Excel with columns like date, amount (or credit/debit), description, reference.';

  const downloadTemplate = () => {
    const today = new Date().toISOString().slice(0, 10);
    if (side === 'erp') {
      exportExcel(`ERP-Transactions-Template`, [{
        name: 'ERP Transactions',
        rows: [
          {
            type: 'AR',
            doc_number: 'INV-2026-0001',
            counterparty_id: '100200300',
            counterparty_name: 'Sample Customer Co.',
            issue_date: today,
            due_date: today,
            amount: 1000.00,
            currency: 'EGP',
            status: 'unpaid',
            external_ref: 'PO-12345',
          },
          {
            type: 'AP',
            doc_number: 'BILL-2026-0001',
            counterparty_id: '400500600',
            counterparty_name: 'Sample Vendor Ltd.',
            issue_date: today,
            due_date: today,
            amount: 500.00,
            currency: 'EGP',
            status: 'paid',
            external_ref: 'GRN-998',
          },
        ],
      }]);
    } else {
      exportExcel(`Bank-Statement-Template`, [{
        name: 'Bank Statement',
        rows: [
          {
            date: today,
            value_date: today,
            description: 'Wire transfer from customer (use signed amount: positive = credit, negative = debit)',
            reference: 'TRX-001',
            amount: 1000.00,
            credit: '',
            debit: '',
            currency: 'EGP',
            balance: 25000.00,
          },
          {
            date: today,
            value_date: today,
            description: 'Supplier payment (signed amount, negative)',
            reference: 'TRX-002',
            amount: -500.00,
            credit: '',
            debit: '',
            currency: 'EGP',
            balance: 24500.00,
          },
          {
            date: today,
            value_date: today,
            description: 'Alternative: leave amount blank and use credit/debit columns instead',
            reference: 'TRX-003',
            amount: '',
            credit: 750.00,
            debit: '',
            currency: 'EGP',
            balance: 25250.00,
          },
        ],
      }]);
    }
  };

  const submit = async () => {
    if (!file) { setResult({ kind: 'err', message: 'Pick a file first.' }); return; }
    setSubmitting(true);
    setResult(null);
    try {
      const form = new FormData();
      form.append('file', file);
      if (side === 'bank' && bankAccount.trim()) form.append('bank_account', bankAccount.trim());

      const res = await fetch(`${API_URL}/reconciliation/imports/${side}`, {
        method: 'POST',
        headers: getAuthHeaders(), // DO NOT set Content-Type for multipart — browser adds it
        body: form,
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || `HTTP ${res.status}`);
      setResult({
        kind: 'ok',
        inserted: data.insertedCount,
        skipped: data.skippedCount,
        skippedRows: data.skipped,
        batchId: data.batchId,
      });
      setFile(null);
      onUploaded();
    } catch (err: any) {
      setResult({ kind: 'err', message: err.message });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h2 className="font-semibold text-slate-800 flex items-center gap-2">
            {side === 'erp' ? <FileSpreadsheet size={16} className="text-blue-600" /> : <Landmark size={16} className="text-emerald-600" />}
            {title}
          </h2>
          <p className="text-xs text-slate-500 mt-1 max-w-xl">{hint}</p>
        </div>
        <button
          type="button"
          onClick={downloadTemplate}
          title="Download a sample Excel template with the expected columns"
          className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
        >
          <Download size={13} /> Download Template
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="md:col-span-2">
          <label className="block text-xs font-semibold text-slate-600 mb-1">File (.csv / .xlsx / .xls)</label>
          <input
            type="file"
            accept=".csv,.xlsx,.xls,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={e => { setFile(e.target.files?.[0] || null); setResult(null); }}
            className="block w-full text-sm text-slate-700 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-blue-50 file:text-blue-700 file:font-semibold hover:file:bg-blue-100"
          />
        </div>
        {side === 'bank' && (
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Bank Account Label (optional)</label>
            <input type="text" value={bankAccount} onChange={e => setBankAccount(e.target.value)} placeholder="e.g. NBE — Main"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500" />
          </div>
        )}
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button onClick={submit} disabled={submitting || !file}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${side === 'erp' ? 'bg-blue-600 hover:bg-blue-700' : 'bg-emerald-600 hover:bg-emerald-700'} text-white disabled:opacity-40`}>
          {submitting ? <Loader2 size={14} className="animate-spin" /> : <UploadCloud size={14} />}
          Upload
        </button>
        {result && result.kind === 'ok' && (
          <div className="text-sm text-emerald-700 flex items-center gap-1">
            <CheckCircle2 size={14} />
            Inserted {result.inserted} rows{result.skipped ? ` · skipped ${result.skipped}` : ''}. Batch <code className="font-mono text-xs">{shortBatch(result.batchId)}</code>
          </div>
        )}
        {result && result.kind === 'err' && (
          <div className="text-sm text-red-600 flex items-center gap-1"><AlertCircle size={14} /> {result.message}</div>
        )}
      </div>

      {result && result.kind === 'ok' && result.skippedRows && result.skippedRows.length > 0 && (
        <details className="mt-3 text-xs text-slate-600">
          <summary className="cursor-pointer font-semibold">Skipped rows ({result.skippedRows.length})</summary>
          <ul className="mt-2 space-y-1 max-h-32 overflow-y-auto">
            {result.skippedRows.map((s, i) => (
              <li key={i}><span className="font-mono">row {s.row}</span>: {s.reason}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
};

// ─── Rows Table ──────────────────────────────────────────────────────────

const ExportButton: React.FC<{ onClick: () => void; disabled?: boolean }> = ({ onClick, disabled }) => (
  <button onClick={onClick} disabled={disabled}
    className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-40 transition-all">
    <Download size={14} /> Export Excel
  </button>
);

const ErpTable: React.FC<{ rows: ErpRow[]; loading: boolean }> = ({ rows, loading }) => {
  const handleExport = () => {
    exportExcel('ERP-Transactions', [{
      name: 'ERP Transactions',
      rows: rows.map(r => ({
        'Type': r.tx_type,
        'Doc #': r.doc_number || '',
        'Counterparty ID': r.counterparty_id || '',
        'Counterparty Name': r.counterparty_name || '',
        'Issue Date': fmtDate(r.issue_date),
        'Due Date': fmtDate(r.due_date),
        'Amount': num(r.amount),
        'Currency': r.currency,
        'Status': r.status || '',
        'Reference': r.external_ref || '',
        'Batch ID': r.import_batch_id,
        'Imported At': fmtDate(r.imported_at),
      })),
    }]);
  };
  return (
  <div>
    <div className="flex items-center justify-end px-4 py-2 border-b border-gray-50">
      <ExportButton onClick={handleExport} disabled={rows.length === 0} />
    </div>
    <div className="overflow-x-auto">
    <table className="w-full text-left text-sm">
      <thead>
        <tr className="bg-gray-50/80">
          <th className="px-3 py-2 text-[11px] font-bold text-slate-500 uppercase">Type</th>
          <th className="px-3 py-2 text-[11px] font-bold text-slate-500 uppercase">Doc #</th>
          <th className="px-3 py-2 text-[11px] font-bold text-slate-500 uppercase">Counterparty</th>
          <th className="px-3 py-2 text-[11px] font-bold text-slate-500 uppercase">Issue Date</th>
          <th className="px-3 py-2 text-[11px] font-bold text-slate-500 uppercase text-right">Amount</th>
          <th className="px-3 py-2 text-[11px] font-bold text-slate-500 uppercase">Status</th>
          <th className="px-3 py-2 text-[11px] font-bold text-slate-500 uppercase">Batch</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-50">
        {loading && <tr><td colSpan={7} className="px-3 py-8 text-center text-slate-400">Loading…</td></tr>}
        {!loading && rows.length === 0 && <tr><td colSpan={7} className="px-3 py-8 text-center text-slate-400">No rows yet.</td></tr>}
        {rows.map(r => (
          <tr key={r.id} className="hover:bg-gray-50/50">
            <td className="px-3 py-2">
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${r.tx_type === 'AR' ? 'bg-blue-50 text-blue-700' : 'bg-violet-50 text-violet-700'}`}>{r.tx_type}</span>
            </td>
            <td className="px-3 py-2 font-mono text-xs">{r.doc_number || '—'}</td>
            <td className="px-3 py-2 text-slate-700">{r.counterparty_name || r.counterparty_id || '—'}</td>
            <td className="px-3 py-2 text-slate-600">{r.issue_date || '—'}</td>
            <td className="px-3 py-2 text-right font-mono">{formatMoney(r.amount, r.currency)}</td>
            <td className="px-3 py-2 text-xs text-slate-600">{r.status || '—'}</td>
            <td className="px-3 py-2 font-mono text-xs text-slate-400">{shortBatch(r.import_batch_id)}</td>
          </tr>
        ))}
      </tbody>
    </table>
    </div>
  </div>
);
};

const BankTable: React.FC<{ rows: BankRow[]; loading: boolean }> = ({ rows, loading }) => {
  const handleExport = () => {
    exportExcel('Bank-Statements', [{
      name: 'Bank Statements',
      rows: rows.map(r => ({
        'Account': r.bank_account || '',
        'Statement Date': fmtDate(r.statement_date),
        'Value Date': fmtDate(r.value_date),
        'Description': r.description || '',
        'Reference': r.reference || '',
        'Amount': num(r.amount),
        'Currency': r.currency,
        'Balance After': num(r.balance_after),
        'Batch ID': r.import_batch_id,
        'Imported At': fmtDate(r.imported_at),
      })),
    }]);
  };
  return (
  <div>
    <div className="flex items-center justify-end px-4 py-2 border-b border-gray-50">
      <ExportButton onClick={handleExport} disabled={rows.length === 0} />
    </div>
    <div className="overflow-x-auto">
    <table className="w-full text-left text-sm">
      <thead>
        <tr className="bg-gray-50/80">
          <th className="px-3 py-2 text-[11px] font-bold text-slate-500 uppercase">Date</th>
          <th className="px-3 py-2 text-[11px] font-bold text-slate-500 uppercase">Account</th>
          <th className="px-3 py-2 text-[11px] font-bold text-slate-500 uppercase">Description</th>
          <th className="px-3 py-2 text-[11px] font-bold text-slate-500 uppercase">Ref</th>
          <th className="px-3 py-2 text-[11px] font-bold text-slate-500 uppercase text-right">Amount</th>
          <th className="px-3 py-2 text-[11px] font-bold text-slate-500 uppercase text-right">Balance</th>
          <th className="px-3 py-2 text-[11px] font-bold text-slate-500 uppercase">Batch</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-50">
        {loading && <tr><td colSpan={7} className="px-3 py-8 text-center text-slate-400">Loading…</td></tr>}
        {!loading && rows.length === 0 && <tr><td colSpan={7} className="px-3 py-8 text-center text-slate-400">No rows yet.</td></tr>}
        {rows.map(r => (
          <tr key={r.id} className="hover:bg-gray-50/50">
            <td className="px-3 py-2 text-slate-600">{r.statement_date || '—'}</td>
            <td className="px-3 py-2 text-slate-700">{r.bank_account || '—'}</td>
            <td className="px-3 py-2 text-slate-700 max-w-sm truncate" title={r.description || ''}>{r.description || '—'}</td>
            <td className="px-3 py-2 font-mono text-xs">{r.reference || '—'}</td>
            <td className={`px-3 py-2 text-right font-mono ${r.amount < 0 ? 'text-red-600' : 'text-emerald-700'}`}>{formatMoney(r.amount, r.currency)}</td>
            <td className="px-3 py-2 text-right font-mono text-slate-500">{formatMoney(r.balance_after, r.currency)}</td>
            <td className="px-3 py-2 font-mono text-xs text-slate-400">{shortBatch(r.import_batch_id)}</td>
          </tr>
        ))}
      </tbody>
    </table>
    </div>
  </div>
  );
};

// ─── History Tab ─────────────────────────────────────────────────────────

interface HistoryTabProps {
  items: BatchRow[];
  loading: boolean;
  onRefresh: () => void;
  onDelete: (side: Side, batchId: string) => void;
}

const HistoryTab: React.FC<HistoryTabProps> = ({ items, loading, onRefresh, onDelete }) => (
  <div>
    <div className="px-5 pt-4 pb-2 flex items-center justify-between">
      <h3 className="font-semibold text-slate-800">Batches</h3>
      <button onClick={onRefresh} disabled={loading} className="text-sm text-slate-600 hover:text-blue-600 flex items-center gap-1 disabled:opacity-50">
        <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
      </button>
    </div>
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="bg-gray-50/80">
            <th className="px-4 py-2 text-[11px] font-bold text-slate-500 uppercase">Side</th>
            <th className="px-4 py-2 text-[11px] font-bold text-slate-500 uppercase">Batch ID</th>
            <th className="px-4 py-2 text-[11px] font-bold text-slate-500 uppercase">Account</th>
            <th className="px-4 py-2 text-[11px] font-bold text-slate-500 uppercase text-right">Rows</th>
            <th className="px-4 py-2 text-[11px] font-bold text-slate-500 uppercase">Imported</th>
            <th className="px-4 py-2 text-[11px] font-bold text-slate-500 uppercase text-right">Action</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {loading && <tr><td colSpan={6} className="px-3 py-8 text-center text-slate-400">Loading…</td></tr>}
          {!loading && items.length === 0 && <tr><td colSpan={6} className="px-3 py-8 text-center text-slate-400">No imports yet.</td></tr>}
          {items.map(b => (
            <tr key={`${b.side}-${b.import_batch_id}`} className="hover:bg-gray-50/50">
              <td className="px-4 py-2">
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${b.side === 'ERP' ? 'bg-blue-50 text-blue-700' : 'bg-emerald-50 text-emerald-700'}`}>{b.side}</span>
              </td>
              <td className="px-4 py-2 font-mono text-xs text-slate-700">{b.import_batch_id}</td>
              <td className="px-4 py-2 text-slate-700">{b.bank_account || '—'}</td>
              <td className="px-4 py-2 text-right font-mono">{b.rows}</td>
              <td className="px-4 py-2 text-xs text-slate-500">{new Date(b.imported_at).toLocaleString()}</td>
              <td className="px-4 py-2 text-right">
                <button
                  onClick={async () => {
                    const ok = await confirmDialog({
                      title: 'Delete batch',
                      message: `Delete this ${b.side} batch (${b.rows} rows)?`,
                      confirmLabel: 'Delete',
                      tone: 'danger',
                    });
                    if (ok) onDelete(b.side.toLowerCase() as Side, b.import_batch_id);
                  }}
                  className="inline-flex items-center gap-1 px-2 py-1 text-xs text-red-600 hover:bg-red-50 rounded">
                  <Trash2 size={12} /> Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </div>
);

// ─── Matches Tab ─────────────────────────────────────────────────────────

interface MatchesTabProps {
  items: MatchRow[];
  loading: boolean;
  onRun: (dateFrom: string, dateTo: string, minConfidence: number) => Promise<void>;
  onAccept: (id: number) => void;
  onReject: (id: number) => void;
  onBulkAccept: (ids: number[]) => Promise<void>;
  running: boolean;
  lastRunResult: {
    suggestionsInserted: number;
    erpRowsConsidered: number;
    bankRowsConsidered: number;
    etaDocsConsidered: number;
    skipped: number;
  } | null;
  filter: 'SUGGESTED' | 'ACCEPTED' | 'REJECTED';
  setFilter: (f: 'SUGGESTED' | 'ACCEPTED' | 'REJECTED') => void;
}

const matchTypeStyle: Record<string, string> = {
  PERFECT: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  WHT: 'bg-amber-50 text-amber-700 border-amber-200',
  FX: 'bg-violet-50 text-violet-700 border-violet-200',
  MANUAL: 'bg-slate-50 text-slate-600 border-slate-200',
};

const confBadge = (c: number) => {
  if (c >= 85) return 'bg-emerald-100 text-emerald-700';
  if (c >= 60) return 'bg-amber-100 text-amber-700';
  return 'bg-red-100 text-red-700';
};

const MatchesTab: React.FC<MatchesTabProps> = ({ items, loading, onRun, onAccept, onReject, onBulkAccept, running, lastRunResult, filter, setFilter }) => {
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  // Default 30 mirrors the backend default in runAutoMatch — keeps "Run" reproducible
  // unless the user explicitly tightens the threshold.
  const [minConfidence, setMinConfidence] = useState<number>(30);
  // Threshold for the "Auto-accept high-confidence" button. 85+ historically maps to
  // PERFECT-grade matches (per matchEngine.ts), which is safe to bulk-accept.
  const [autoAcceptThreshold, setAutoAcceptThreshold] = useState<number>(85);
  const [bulkAccepting, setBulkAccepting] = useState(false);

  const highConfidenceCount = items.filter(m => m.status === 'SUGGESTED' && m.confidence >= autoAcceptThreshold).length;
  const handleBulkAccept = async () => {
    const ids = items.filter(m => m.status === 'SUGGESTED' && m.confidence >= autoAcceptThreshold).map(m => m.id);
    if (ids.length === 0) return;
    const ok = await confirmDialog({
      title: 'Bulk accept matches',
      message: `Accept ${ids.length} suggestion(s) with confidence ≥ ${autoAcceptThreshold}%?\n\nThis cannot be undone in bulk.`,
      confirmLabel: 'Accept all',
      tone: 'default',
    });
    if (!ok) return;
    setBulkAccepting(true);
    try { await onBulkAccept(ids); } finally { setBulkAccepting(false); }
  };

  const handleExport = () => {
    exportExcel(`Matches-${filter}`, [{
      name: `Matches ${filter}`,
      rows: items.map(m => ({
        'Match Type': m.match_type,
        'Confidence': m.confidence,
        'Status': m.status,
        'ERP Type': m.erp_tx_type || '',
        'ERP Doc #': m.erp_doc_number || '',
        'ERP Counterparty': m.erp_counterparty_name || m.erp_counterparty_id || '',
        'ERP Date': fmtDate(m.erp_issue_date),
        'ERP Amount': num(m.erp_amount),
        'ERP Currency': m.erp_currency || '',
        'Bank Account': m.bank_account || '',
        'Bank Date': fmtDate(m.bank_statement_date),
        'Bank Description': m.bank_description || '',
        'Bank Reference': m.bank_reference || '',
        'Bank Amount': num(m.bank_amount),
        'Bank Currency': m.bank_currency || '',
        'ETA UUID': m.eta_uuid || '',
        'Amount Diff': num(m.amount_diff),
        'Notes': m.notes || '',
        'Created': fmtDate(m.created_at),
        'Reviewed': fmtDate(m.reviewed_at),
      })),
    }]);
  };

  useEffect(() => {
    const today = new Date();
    const firstOfThisMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const firstOfPrevMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const lastOfPrevMonth = new Date(firstOfThisMonth.getTime() - 24 * 60 * 60 * 1000);
    setDateFrom(firstOfPrevMonth.toISOString().split('T')[0]);
    setDateTo(lastOfPrevMonth.toISOString().split('T')[0]);
  }, []);

  return (
    <div>
      {/* Control bar */}
      <div className="px-5 pt-4 pb-3 border-b border-gray-100 space-y-3">
        <div className="flex items-end gap-3 flex-wrap">
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Date From</label>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
              className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Date To</label>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
              className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm" />
          </div>
          <div className="min-w-[180px]">
            <label className="block text-xs font-semibold text-slate-600 mb-1">
              Min confidence: <span className="font-mono text-blue-600">{minConfidence}%</span>
            </label>
            <input type="range" min="0" max="100" step="5"
              value={minConfidence}
              onChange={e => setMinConfidence(parseInt(e.target.value, 10))}
              className="w-full accent-blue-600" />
          </div>
          <button onClick={() => dateFrom && dateTo && onRun(dateFrom, dateTo, minConfidence)} disabled={running || !dateFrom || !dateTo}
            className="flex items-center gap-2 bg-blue-600 text-white px-4 py-1.5 rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50">
            {running ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
            Run Auto-Match
          </button>
          <div className="ml-auto flex items-center gap-2 text-xs">
            {(['SUGGESTED', 'ACCEPTED', 'REJECTED'] as const).map(s => (
              <button key={s} onClick={() => setFilter(s)}
                className={`px-3 py-1.5 rounded-lg font-semibold border transition-all ${filter === s ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-gray-200 hover:border-blue-300'}`}>
                {s[0] + s.slice(1).toLowerCase()}
              </button>
            ))}
            <ExportButton onClick={handleExport} disabled={items.length === 0} />
          </div>
        </div>
        {filter === 'SUGGESTED' && highConfidenceCount > 0 && (
          <div className="flex items-center gap-3 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2">
            <span className="text-xs text-emerald-800">
              <strong>{highConfidenceCount}</strong> suggestion(s) with confidence ≥
            </span>
            <input type="number" min={50} max={100} step={5}
              value={autoAcceptThreshold}
              onChange={e => setAutoAcceptThreshold(Math.max(50, Math.min(100, parseInt(e.target.value || '85', 10))))}
              className="w-16 px-2 py-1 text-xs border border-gray-200 rounded font-mono" />
            <span className="text-xs text-emerald-800">%</span>
            <button onClick={handleBulkAccept} disabled={bulkAccepting}
              className="ml-auto flex items-center gap-1.5 bg-emerald-600 text-white px-3 py-1 rounded-lg text-xs font-semibold hover:bg-emerald-700 disabled:opacity-50">
              {bulkAccepting ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
              Auto-Accept {highConfidenceCount}
            </button>
          </div>
        )}
        {lastRunResult && (
          <div className="text-xs text-slate-600 bg-blue-50 border border-blue-100 rounded px-3 py-2">
            Last run: {lastRunResult.suggestionsInserted} suggestions from {lastRunResult.erpRowsConsidered} ERP rows × {lastRunResult.bankRowsConsidered} bank rows × {lastRunResult.etaDocsConsidered} ETA docs. Skipped: {lastRunResult.skipped}.
          </div>
        )}
      </div>

      {/* 3-column visual rows */}
      <div className="p-3 space-y-2 max-h-[70vh] overflow-y-auto">
        {loading && <div className="text-center text-slate-400 py-8">Loading…</div>}
        {!loading && items.length === 0 && (
          <div className="text-center text-slate-400 py-12">
            No {filter.toLowerCase()} matches. {filter === 'SUGGESTED' ? 'Run auto-match to generate suggestions.' : ''}
          </div>
        )}
        {items.map(m => (
          <div key={m.id} className="bg-white border border-gray-200 rounded-xl p-3 hover:border-blue-300 transition-colors">
            <div className="flex items-center justify-between gap-2 mb-2">
              <div className="flex items-center gap-2">
                <span className={`text-[11px] font-bold uppercase px-2 py-0.5 rounded-full border ${matchTypeStyle[m.match_type]}`}>{m.match_type}</span>
                <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${confBadge(m.confidence)}`}>{m.confidence}% confidence</span>
                {m.amount_diff !== null && m.amount_diff > 0.01 && (
                  <span className="text-[11px] text-amber-700">Δ {formatMoney(m.amount_diff)}</span>
                )}
              </div>
              {filter === 'SUGGESTED' && (
                <div className="flex gap-1">
                  <button onClick={() => onAccept(m.id)}
                    className="flex items-center gap-1 px-3 py-1 bg-emerald-600 text-white text-xs font-semibold rounded-lg hover:bg-emerald-700">
                    <Check size={12} /> Accept
                  </button>
                  <button onClick={() => onReject(m.id)}
                    className="flex items-center gap-1 px-3 py-1 bg-red-500 text-white text-xs font-semibold rounded-lg hover:bg-red-600">
                    <X size={12} /> Reject
                  </button>
                </div>
              )}
              {filter === 'ACCEPTED' && <span className="text-xs text-emerald-600 flex items-center gap-1"><CheckCircle2 size={12} /> Accepted</span>}
              {filter === 'REJECTED' && <span className="text-xs text-red-600 flex items-center gap-1"><X size={12} /> Rejected</span>}
            </div>
            <div className="grid grid-cols-3 gap-2 text-xs">
              {/* ERP */}
              <div className="bg-blue-50/40 border border-blue-100 rounded-lg p-2">
                <div className="font-bold text-blue-700 flex items-center gap-1 mb-1"><FileSpreadsheet size={11} /> ERP</div>
                {m.erp_tx_id ? (
                  <>
                    <div className="text-slate-700"><strong>{m.erp_tx_type}</strong> · {m.erp_doc_number || '—'}</div>
                    <div className="text-slate-600 truncate" title={m.erp_counterparty_name || ''}>{m.erp_counterparty_name || m.erp_counterparty_id || '—'}</div>
                    <div className="text-slate-500 flex items-center gap-1"><Calendar size={10} /> {m.erp_issue_date || '—'}</div>
                    <div className="font-mono font-semibold">{formatMoney(m.erp_amount, m.erp_currency || 'EGP')}</div>
                  </>
                ) : <div className="text-slate-400">—</div>}
              </div>
              {/* Bank */}
              <div className="bg-emerald-50/40 border border-emerald-100 rounded-lg p-2">
                <div className="font-bold text-emerald-700 flex items-center gap-1 mb-1"><Landmark size={11} /> Bank</div>
                {m.bank_tx_id ? (
                  <>
                    <div className="text-slate-700">{m.bank_account || 'Account'}</div>
                    <div className="text-slate-600 truncate" title={m.bank_description || ''}>{m.bank_description || m.bank_reference || '—'}</div>
                    <div className="text-slate-500 flex items-center gap-1"><Calendar size={10} /> {m.bank_statement_date || '—'}</div>
                    <div className={`font-mono font-semibold ${(m.bank_amount || 0) < 0 ? 'text-red-600' : 'text-emerald-700'}`}>{formatMoney(m.bank_amount, m.bank_currency || 'EGP')}</div>
                  </>
                ) : <div className="text-slate-400">—</div>}
              </div>
              {/* ETA */}
              <div className="bg-violet-50/40 border border-violet-100 rounded-lg p-2">
                <div className="font-bold text-violet-700 flex items-center gap-1 mb-1"><GitCompare size={11} /> ETA</div>
                {m.eta_uuid ? (
                  <>
                    <div className="text-slate-700 font-mono text-[10px] truncate" title={m.eta_uuid}>{m.eta_uuid.slice(0, 16)}…</div>
                    <div className="text-slate-500 text-[10px]">Linked ETA document</div>
                  </>
                ) : <div className="text-slate-400">—</div>}
              </div>
            </div>
            {m.notes && <div className="text-[11px] text-slate-500 mt-2 italic">{m.notes}</div>}
          </div>
        ))}
      </div>
    </div>
  );
};

// ─── Summary Tab ─────────────────────────────────────────────────────────

interface SummaryData {
  byStatus: { status: string; count: number }[];
  byType: { match_type: string; status: string; count: number }[];
  totalAcceptedAmount: number;
  erp: { total: number; unmatched: number };
  bank: { total: number; unmatched: number };
}

const SummaryTab: React.FC = () => {
  const [data, setData] = useState<SummaryData | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const res = await fetch(`${API_URL}/reconciliation/summary`, { headers: getJsonHeaders() });
      const d = await res.json();
      if (!d.success) throw new Error(d.message || 'Load failed');
      setData(d);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const suggested = data?.byStatus.find(s => s.status === 'SUGGESTED')?.count || 0;
  const accepted = data?.byStatus.find(s => s.status === 'ACCEPTED')?.count || 0;
  const rejected = data?.byStatus.find(s => s.status === 'REJECTED')?.count || 0;
  const erpMatchRate = data && data.erp.total > 0 ? Math.round(((data.erp.total - data.erp.unmatched) / data.erp.total) * 100) : 0;
  const bankMatchRate = data && data.bank.total > 0 ? Math.round(((data.bank.total - data.bank.unmatched) / data.bank.total) * 100) : 0;

  const handleExport = () => {
    if (!data) return;
    const statusSheet = [
      { 'Metric': 'Suggested', 'Count': data.byStatus.find(s => s.status === 'SUGGESTED')?.count || 0 },
      { 'Metric': 'Accepted', 'Count': data.byStatus.find(s => s.status === 'ACCEPTED')?.count || 0 },
      { 'Metric': 'Rejected', 'Count': data.byStatus.find(s => s.status === 'REJECTED')?.count || 0 },
      { 'Metric': 'Total Accepted Amount', 'Count': data.totalAcceptedAmount },
      { 'Metric': 'ERP — Total', 'Count': data.erp.total },
      { 'Metric': 'ERP — Unmatched', 'Count': data.erp.unmatched },
      { 'Metric': 'ERP — Match Rate %', 'Count': erpMatchRate },
      { 'Metric': 'Bank — Total', 'Count': data.bank.total },
      { 'Metric': 'Bank — Unmatched', 'Count': data.bank.unmatched },
      { 'Metric': 'Bank — Match Rate %', 'Count': bankMatchRate },
    ];
    const typeSheet = ['PERFECT', 'WHT', 'FX', 'MANUAL'].flatMap(type =>
      ['SUGGESTED', 'ACCEPTED', 'REJECTED'].map(status => ({
        'Match Type': type,
        'Status': status,
        'Count': data.byType.find(r => r.match_type === type && r.status === status)?.count || 0,
      })).filter(r => r.Count > 0)
    );
    exportExcel('Reconciliation-Summary', [
      { name: 'Summary', rows: statusSheet },
      { name: 'By Type × Status', rows: typeSheet },
    ]);
  };

  return (
    <div className="p-5 space-y-4">
      {loading && <div className="text-center text-slate-400 py-8">Loading…</div>}
      {err && <div className="text-red-600 text-sm flex items-center gap-1"><AlertCircle size={14} /> {err}</div>}

      {data && (
        <>
          <div className="flex justify-end">
            <ExportButton onClick={handleExport} disabled={!data} />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-amber-50 border border-amber-100 rounded-xl p-4">
              <div className="text-xs text-amber-700 font-semibold flex items-center gap-1"><Zap size={12} /> Suggested</div>
              <div className="text-2xl font-bold text-amber-900 mt-1">{suggested}</div>
            </div>
            <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-4">
              <div className="text-xs text-emerald-700 font-semibold flex items-center gap-1"><Check size={12} /> Accepted</div>
              <div className="text-2xl font-bold text-emerald-900 mt-1">{accepted}</div>
            </div>
            <div className="bg-red-50 border border-red-100 rounded-xl p-4">
              <div className="text-xs text-red-700 font-semibold flex items-center gap-1"><X size={12} /> Rejected</div>
              <div className="text-2xl font-bold text-red-900 mt-1">{rejected}</div>
            </div>
            <div className="bg-blue-50 border border-blue-100 rounded-xl p-4">
              <div className="text-xs text-blue-700 font-semibold flex items-center gap-1"><TrendingUp size={12} /> Matched Total</div>
              <div className="text-2xl font-bold text-blue-900 mt-1">{formatMoney(data.totalAcceptedAmount)}</div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="bg-white border border-gray-100 rounded-xl p-4">
              <h3 className="font-semibold text-slate-800 flex items-center gap-2 mb-2"><FileSpreadsheet size={14} className="text-blue-600" /> ERP Coverage</h3>
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-600">Matched</span>
                <span className="font-semibold text-slate-800">{data.erp.total - data.erp.unmatched} / {data.erp.total}</span>
              </div>
              <div className="mt-2 h-2 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full bg-blue-500 rounded-full" style={{ width: `${erpMatchRate}%` }} />
              </div>
              <div className="text-xs text-slate-500 mt-1">{erpMatchRate}% matched · {data.erp.unmatched} unmatched</div>
            </div>
            <div className="bg-white border border-gray-100 rounded-xl p-4">
              <h3 className="font-semibold text-slate-800 flex items-center gap-2 mb-2"><Landmark size={14} className="text-emerald-600" /> Bank Coverage</h3>
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-600">Matched</span>
                <span className="font-semibold text-slate-800">{data.bank.total - data.bank.unmatched} / {data.bank.total}</span>
              </div>
              <div className="mt-2 h-2 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${bankMatchRate}%` }} />
              </div>
              <div className="text-xs text-slate-500 mt-1">{bankMatchRate}% matched · {data.bank.unmatched} unmatched</div>
            </div>
          </div>

          <div className="bg-white border border-gray-100 rounded-xl p-4">
            <h3 className="font-semibold text-slate-800 flex items-center gap-2 mb-3"><PieChart size={14} className="text-violet-600" /> Matches by Type × Status</h3>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-slate-500 text-[11px] uppercase">
                  <th className="text-left font-semibold py-1">Type</th>
                  <th className="text-right font-semibold py-1">Suggested</th>
                  <th className="text-right font-semibold py-1">Accepted</th>
                  <th className="text-right font-semibold py-1">Rejected</th>
                </tr>
              </thead>
              <tbody>
                {['PERFECT', 'WHT', 'FX', 'MANUAL'].map(type => {
                  const sug = data.byType.find(r => r.match_type === type && r.status === 'SUGGESTED')?.count || 0;
                  const acc = data.byType.find(r => r.match_type === type && r.status === 'ACCEPTED')?.count || 0;
                  const rej = data.byType.find(r => r.match_type === type && r.status === 'REJECTED')?.count || 0;
                  if (sug + acc + rej === 0) return null;
                  return (
                    <tr key={type} className="border-t border-gray-50">
                      <td className="py-2">
                        <span className={`text-[11px] font-bold uppercase px-2 py-0.5 rounded-full border ${matchTypeStyle[type]}`}>{type}</span>
                      </td>
                      <td className="py-2 text-right font-mono">{sug}</td>
                      <td className="py-2 text-right font-mono text-emerald-700">{acc}</td>
                      <td className="py-2 text-right font-mono text-red-600">{rej}</td>
                    </tr>
                  );
                })}
                {data.byType.length === 0 && (
                  <tr><td colSpan={4} className="py-6 text-center text-slate-400">No matches yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
};

// ─── Main Page ───────────────────────────────────────────────────────────

const Reconciliation: React.FC = () => {
  const [tab, setTab] = useState<'upload' | 'erp-rows' | 'bank-rows' | 'matches' | 'summary' | 'history'>('upload');

  const [erpRows, setErpRows] = useState<ErpRow[]>([]);
  const [erpLoading, setErpLoading] = useState(false);
  const [bankRows, setBankRows] = useState<BankRow[]>([]);
  const [bankLoading, setBankLoading] = useState(false);
  const [batches, setBatches] = useState<BatchRow[]>([]);
  const [batchesLoading, setBatchesLoading] = useState(false);

  const [matches, setMatches] = useState<MatchRow[]>([]);
  const [matchesLoading, setMatchesLoading] = useState(false);
  const [matchFilter, setMatchFilter] = useState<'SUGGESTED' | 'ACCEPTED' | 'REJECTED'>('SUGGESTED');
  const [autoMatchRunning, setAutoMatchRunning] = useState(false);
  const [lastRunResult, setLastRunResult] = useState<any>(null);

  const loadErp = useCallback(async () => {
    setErpLoading(true);
    try {
      const res = await fetch(`${API_URL}/reconciliation/imports/erp?pageSize=100`, { headers: getJsonHeaders() });
      const data = await res.json();
      if (data.success) setErpRows(data.items || []);
    } finally {
      setErpLoading(false);
    }
  }, []);

  const loadBank = useCallback(async () => {
    setBankLoading(true);
    try {
      const res = await fetch(`${API_URL}/reconciliation/imports/bank?pageSize=100`, { headers: getJsonHeaders() });
      const data = await res.json();
      if (data.success) setBankRows(data.items || []);
    } finally {
      setBankLoading(false);
    }
  }, []);

  const loadHistory = useCallback(async () => {
    setBatchesLoading(true);
    try {
      const res = await fetch(`${API_URL}/reconciliation/imports/history`, { headers: getJsonHeaders() });
      const data = await res.json();
      if (data.success) setBatches(data.items || []);
    } finally {
      setBatchesLoading(false);
    }
  }, []);

  const loadMatches = useCallback(async (status: typeof matchFilter) => {
    setMatchesLoading(true);
    try {
      const res = await fetch(`${API_URL}/reconciliation/matches?status=${status}&pageSize=200`, { headers: getJsonHeaders() });
      const data = await res.json();
      if (data.success) setMatches(data.items || []);
    } finally {
      setMatchesLoading(false);
    }
  }, []);

  useEffect(() => { loadHistory(); }, [loadHistory]);
  useEffect(() => {
    if (tab === 'erp-rows') loadErp();
    if (tab === 'bank-rows') loadBank();
    if (tab === 'history') loadHistory();
    if (tab === 'matches') loadMatches(matchFilter);
  }, [tab, matchFilter, loadErp, loadBank, loadHistory, loadMatches]);

  const runAutoMatch = async (dateFrom: string, dateTo: string, minConfidence: number) => {
    setAutoMatchRunning(true);
    setLastRunResult(null);
    try {
      const res = await fetch(`${API_URL}/reconciliation/matches/auto-match`, {
        method: 'POST',
        headers: getJsonHeaders(),
        body: JSON.stringify({ dateFrom, dateTo, minConfidence }),
      });
      const data = await res.json();
      if (data.success) {
        setLastRunResult(data);
        setMatchFilter('SUGGESTED');
        await loadMatches('SUGGESTED');
      } else {
        await alertDialog({ title: 'Auto-match failed', message: data.message || 'Auto-match failed', tone: 'danger' });
      }
    } finally {
      setAutoMatchRunning(false);
    }
  };

  const updateMatchStatus = async (id: number, status: 'ACCEPTED' | 'REJECTED') => {
    const res = await fetch(`${API_URL}/reconciliation/matches/${id}`, {
      method: 'PATCH',
      headers: getJsonHeaders(),
      body: JSON.stringify({ status }),
    });
    const data = await res.json();
    if (data.success) await loadMatches(matchFilter);
    else await alertDialog({ title: 'Update failed', message: data.message || 'Update failed', tone: 'danger' });
  };

  // Bulk-accept: fire PATCH calls in parallel (API is light), then refresh once.
  // The backend has no batch endpoint yet — adding one would mean a new route +
  // permission gate; sequential PATCHes are fine for the typical "accept the
  // ~50 high-confidence rows" workflow.
  const bulkAcceptMatches = async (ids: number[]) => {
    if (ids.length === 0) return;
    const results = await Promise.allSettled(
      ids.map(id =>
        fetch(`${API_URL}/reconciliation/matches/${id}`, {
          method: 'PATCH',
          headers: getJsonHeaders(),
          body: JSON.stringify({ status: 'ACCEPTED' }),
        }).then(r => r.json())
      )
    );
    const failed = results.filter(r => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value?.success)).length;
    if (failed > 0) {
      await alertDialog({
        title: 'Bulk accept finished',
        message: `${ids.length - failed} accepted, ${failed} failed. Reloading list…`,
        tone: 'warning',
      });
    }
    await loadMatches(matchFilter);
  };

  const deleteBatch = async (side: Side, batchId: string) => {
    const res = await fetch(`${API_URL}/reconciliation/imports/${side}/${encodeURIComponent(batchId)}`, {
      method: 'DELETE',
      headers: getJsonHeaders(),
    });
    const data = await res.json();
    if (data.success) {
      await loadHistory();
      if (side === 'erp') loadErp(); else loadBank();
    } else {
      await alertDialog({ title: 'Delete failed', message: data.message || 'Delete failed', tone: 'danger' });
    }
  };

  const refreshAfterUpload = () => {
    loadHistory();
    if (tab === 'erp-rows') loadErp();
    if (tab === 'bank-rows') loadBank();
  };

  const tabs: { id: typeof tab; label: string; icon: React.ReactNode }[] = [
    { id: 'upload', label: 'Upload', icon: <UploadCloud size={15} /> },
    { id: 'erp-rows', label: 'ERP Rows', icon: <FileSpreadsheet size={15} /> },
    { id: 'bank-rows', label: 'Bank Rows', icon: <Landmark size={15} /> },
    { id: 'matches', label: 'Matches', icon: <Zap size={15} /> },
    { id: 'summary', label: 'Summary', icon: <PieChart size={15} /> },
    { id: 'history', label: 'Batches', icon: <History size={15} /> },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
          <GitCompare size={24} className="text-blue-600" /> Reconciliation
        </h1>
        <p className="text-slate-500 text-sm mt-1">
          Upload ERP transactions and bank statements, then auto-match them against ETA documents. PERFECT, WHT (withholding), FX, and manual matches are scored and ranked by confidence.
        </p>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100">
        <div className="px-5 pt-4 border-b border-gray-100">
          <div className="flex gap-1">
            {tabs.map(t => (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={`px-4 py-2.5 text-sm font-semibold rounded-t-lg transition-all flex items-center gap-1.5 ${tab === t.id ? 'text-blue-600 border-b-2 border-blue-600 bg-blue-50/50' : 'text-slate-500 hover:text-slate-700'}`}>
                {t.icon} {t.label}
              </button>
            ))}
          </div>
        </div>

        {tab === 'upload' && (
          <div className="p-5 grid grid-cols-1 lg:grid-cols-2 gap-4">
            <UploadCard side="erp" onUploaded={refreshAfterUpload} />
            <UploadCard side="bank" onUploaded={refreshAfterUpload} />
          </div>
        )}

        {tab === 'erp-rows' && <ErpTable rows={erpRows} loading={erpLoading} />}
        {tab === 'bank-rows' && <BankTable rows={bankRows} loading={bankLoading} />}
        {tab === 'matches' && (
          <MatchesTab
            items={matches}
            loading={matchesLoading}
            onRun={runAutoMatch}
            onAccept={id => updateMatchStatus(id, 'ACCEPTED')}
            onReject={id => updateMatchStatus(id, 'REJECTED')}
            onBulkAccept={bulkAcceptMatches}
            running={autoMatchRunning}
            lastRunResult={lastRunResult}
            filter={matchFilter}
            setFilter={setMatchFilter}
          />
        )}
        {tab === 'summary' && <SummaryTab />}
        {tab === 'history' && <HistoryTab items={batches} loading={batchesLoading} onRefresh={loadHistory} onDelete={deleteBatch} />}
      </div>
    </div>
  );
};

export default Reconciliation;
