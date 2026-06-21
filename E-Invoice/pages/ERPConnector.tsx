/**
 * ERP Connector — the customer-facing page where they trigger imports from
 * their configured ERP and review past runs.
 *
 * Three actions:
 *   1. Test Connection → /api/admin/erp/test-connection
 *   2. Preview          → /api/admin/erp/preview-invoices (read-only)
 *   3. Import Now       → /api/admin/erp/import-now (real fetch + submit)
 *
 * History panel shows the last 50 runs with status + counts. Empty state
 * points the user to Settings → ERP Server when nothing is configured.
 */

import React, { useEffect, useState, useCallback } from 'react';
import {
  Zap, Calendar, Play, Eye, RefreshCw, AlertCircle, CheckCircle2,
  Loader2, Settings as SettingsIcon, ChevronRight,
} from 'lucide-react';
import { API_URL } from '../services/apiService';
import { useTranslation } from '../i18n';
import { Link } from 'react-router-dom';
import { confirmDialog } from '../components/ConfirmDialog';

interface RunRow {
  id: number;
  started_at: string;
  finished_at: string | null;
  status: 'running' | 'success' | 'partial' | 'failed' | 'busy';
  provider: string | null;
  fetched_count: number;
  submitted_count: number;
  failed_count: number;
  skipped_count: number;
  triggered_by: 'manual' | 'scheduled';
  error_message: string | null;
}

interface RunInvoiceRow {
  external_id: string;
  internal_id: string | null;
  status: 'submitted' | 'failed' | 'skipped';
  eta_uuid: string | null;
  error_message: string | null;
  first_seen_at: string;
  last_seen_at: string;
}

interface ConnTestResult {
  ok: boolean;
  message: string;
  details?: Record<string, any>;
  provider?: string;
}

const todayISO = () => new Date().toISOString().slice(0, 10);
const daysAgoISO = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

const ERPConnector: React.FC = () => {
  const { t } = useTranslation();
  const [since, setSince] = useState(daysAgoISO(7));
  const [until, setUntil] = useState(todayISO());
  const [limit, setLimit] = useState(100);

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<ConnTestResult | null>(null);

  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState<any[] | null>(null);

  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [reimport, setReimport] = useState(false);
  const [alreadyImportedIds, setAlreadyImportedIds] = useState<Set<string>>(new Set());

  const [runs, setRuns] = useState<RunRow[]>([]);
  const [runsLoading, setRunsLoading] = useState(false);
  const [expandedRunId, setExpandedRunId] = useState<number | null>(null);
  const [runDetail, setRunDetail] = useState<Record<number, RunInvoiceRow[]>>({});
  const [detailLoading, setDetailLoading] = useState(false);

  // Auto-import schedule
  const [scheduleMode, setScheduleMode] = useState<'off' | 'interval'>('off');
  const [scheduleMinutes, setScheduleMinutes] = useState<number>(60);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [scheduleSaving, setScheduleSaving] = useState(false);
  const [scheduleProvider, setScheduleProvider] = useState<string | null>(null);

  const authHeaders = (): Record<string, string> => {
    const userStr = localStorage.getItem('invoice_user');
    const token = userStr ? JSON.parse(userStr).token : null;
    return token ? { Authorization: `Bearer ${token}` } : {};
  };

  const loadRuns = useCallback(async () => {
    setRunsLoading(true);
    try {
      const r = await fetch(`${API_URL}/admin/erp/runs`, { headers: authHeaders() });
      const d = await r.json();
      if (d.success) setRuns(d.rows || []);
    } catch { /* silent */ }
    finally { setRunsLoading(false); }
  }, []);

  const loadSchedule = useCallback(async () => {
    try {
      const r = await fetch(`${API_URL}/admin/erp/schedule`, { headers: authHeaders() });
      const d = await r.json();
      if (d.success) {
        setScheduleMode(d.mode || 'off');
        setScheduleMinutes(d.intervalMinutes || 60);
        setLastSyncedAt(d.lastSyncedAt || null);
        setScheduleProvider(d.provider || null);
      }
    } catch { /* silent */ }
  }, []);

  const saveSchedule = async () => {
    setScheduleSaving(true);
    try {
      const r = await fetch(`${API_URL}/admin/erp/schedule`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ mode: scheduleMode, intervalMinutes: scheduleMinutes }),
      });
      const d = await r.json();
      if (!r.ok || !d.success) throw new Error(d.message || `HTTP ${r.status}`);
    } catch (e: any) {
      setImportMsg(`❌ ${e.message}`);
    } finally {
      setScheduleSaving(false);
    }
  };

  const resetPointer = async () => {
    const ok = await confirmDialog({
      title: t('erpconn.resetPointer'),
      message: t('erpconn.confirmResetPointer'),
      confirmLabel: t('erpconn.resetPointer'),
      tone: 'warning',
    });
    if (!ok) return;
    try {
      await fetch(`${API_URL}/admin/erp/reset-pointer`, { method: 'POST', headers: authHeaders() });
      await loadSchedule();
    } catch { /* silent */ }
  };

  useEffect(() => { loadRuns(); loadSchedule(); }, [loadRuns, loadSchedule]);

  const testConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const r = await fetch(`${API_URL}/admin/erp/test-connection`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
      });
      const d = await r.json();
      setTestResult({ ok: !!d.ok, message: d.message || '', details: d.details, provider: d.provider });
    } catch (e: any) {
      setTestResult({ ok: false, message: e.message });
    } finally {
      setTesting(false);
    }
  };

  const runPreview = async () => {
    setPreviewing(true);
    setPreview(null);
    setAlreadyImportedIds(new Set());
    try {
      const r = await fetch(`${API_URL}/admin/erp/preview-invoices`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ limit: 5, since, until }),
      });
      const d = await r.json();
      if (!r.ok || !d.success) throw new Error(d.message || `HTTP ${r.status}`);
      setPreview(d.invoices || []);
      setAlreadyImportedIds(new Set<string>(Array.isArray(d.alreadyImported) ? d.alreadyImported : []));
    } catch (e: any) {
      setPreview([]);
      setTestResult({ ok: false, message: e.message });
    } finally {
      setPreviewing(false);
    }
  };

  /** Drill-down: per-invoice rows for a single run. Caches in-memory so the
   *  user can collapse/re-expand without re-fetching. */
  const toggleRunDetail = async (runId: number) => {
    if (expandedRunId === runId) { setExpandedRunId(null); return; }
    setExpandedRunId(runId);
    if (runDetail[runId]) return;
    setDetailLoading(true);
    try {
      const r = await fetch(`${API_URL}/admin/erp/runs/${runId}`, { headers: authHeaders() });
      const d = await r.json();
      if (d.success) setRunDetail(prev => ({ ...prev, [runId]: d.invoices || [] }));
    } finally {
      setDetailLoading(false);
    }
  };

  const runImport = async () => {
    const ok = await confirmDialog({
      title: t('erpconn.importNow'),
      message: t('erpconn.confirmImport').replace('{n}', String(limit)),
      confirmLabel: t('erpconn.importNow'),
      tone: 'default',
    });
    if (!ok) return;
    setImporting(true);
    setImportMsg(null);
    try {
      // Empty `since` → backend resumes from the last-synced pointer.
      // Non-empty → user is overriding the window.
      const body: any = { limit, until, reimport };
      if (since) body.since = since;
      const r = await fetch(`${API_URL}/admin/erp/import-now`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      const fetched = d.fetchedCount || 0;
      const submitted = d.submittedCount || 0;
      const failed = d.failedCount || 0;
      const skipped = d.skippedCount || 0;
      if (d.status === 'busy') {
        setImportMsg(`⏳ ${t('erpconn.busy')}`);
      } else if (d.success || d.status === 'partial') {
        const skipNote = skipped > 0 ? ` · ${skipped} ${t('erpconn.skipped')}` : '';
        setImportMsg(`✅ ${t('erpconn.imported')}: ${submitted}/${fetched}${failed ? ` · ${failed} ${t('erpconn.failed')}` : ''}${skipNote}`);
      } else {
        setImportMsg(`❌ ${d.message || 'Import failed'}`);
      }
      await loadRuns();
    } catch (e: any) {
      setImportMsg(`❌ ${e.message}`);
    } finally {
      setImporting(false);
    }
  };

  const statusBadge = (s: RunRow['status']) => {
    const cls = s === 'success' ? 'bg-emerald-100 text-emerald-700'
      : s === 'partial' ? 'bg-amber-100 text-amber-700'
      : s === 'failed' ? 'bg-rose-100 text-rose-700'
      : 'bg-blue-100 text-blue-700';
    return <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase ${cls}`}>{s}</span>;
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-3">
            <Zap className="text-blue-600" /> {t('erpconn.title')}
          </h1>
          <p className="text-slate-500 text-sm">{t('erpconn.subtitle')}</p>
        </div>
        <Link to="/settings/erpserver"
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-bold text-slate-600 bg-white border border-gray-200 rounded-xl hover:bg-gray-50">
          <SettingsIcon size={14} /> {t('erpconn.openSettings')} <ChevronRight size={12} />
        </Link>
      </div>

      {/* Auto-import schedule */}
      <section className="bg-gradient-to-br from-violet-50 to-blue-50 border border-violet-100 rounded-2xl p-5 space-y-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
              <Calendar size={14} className="text-violet-600" /> {t('erpconn.scheduleTitle')}
            </h3>
            <p className="text-[11px] text-slate-600 mt-0.5">{t('erpconn.scheduleSubtitle')}</p>
          </div>
          {!scheduleProvider && (
            <span className="text-[10px] font-bold bg-amber-100 text-amber-800 px-2 py-1 rounded-full uppercase">
              {t('erpconn.noProvider')}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <select value={scheduleMode} onChange={e => setScheduleMode(e.target.value as any)}
            className="px-3 py-2 border border-violet-200 bg-white rounded-lg text-sm font-bold">
            <option value="off">{t('erpconn.scheduleOff')}</option>
            <option value="interval">{t('erpconn.scheduleInterval')}</option>
          </select>
          {scheduleMode === 'interval' && (
            <>
              <span className="text-xs text-slate-600">{t('erpconn.every')}</span>
              <input type="number" min={5} max={1440} value={scheduleMinutes}
                onChange={e => setScheduleMinutes(parseInt(e.target.value) || 60)}
                className="w-24 px-3 py-2 border border-violet-200 bg-white rounded-lg text-sm" />
              <span className="text-xs text-slate-600">{t('erpconn.minutes')}</span>
            </>
          )}
          <button onClick={saveSchedule} disabled={scheduleSaving || !scheduleProvider}
            className="ml-auto flex items-center gap-2 px-4 py-2 bg-violet-600 text-white rounded-lg text-sm font-bold hover:bg-violet-700 disabled:opacity-50">
            {scheduleSaving ? <Loader2 size={14} className="animate-spin" /> : null}
            {t('erpconn.saveSchedule')}
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-600">
          <span>{t('erpconn.lastSyncedAt')}: <strong>{lastSyncedAt ? new Date(lastSyncedAt).toLocaleString() : t('autosync.never')}</strong></span>
          {lastSyncedAt && (
            <button onClick={resetPointer} className="text-rose-600 hover:underline font-semibold">
              {t('erpconn.resetPointer')}
            </button>
          )}
        </div>
      </section>

      {/* Date filter + 3 actions */}
      <section className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">{t('reports.dateFrom')}</label>
            <input type="date" value={since} onChange={e => setSince(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
          </div>
          <div>
            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">{t('reports.dateTo')}</label>
            <input type="date" value={until} onChange={e => setUntil(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
          </div>
          <div>
            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">{t('erpconn.batchLimit')}</label>
            <input type="number" min={1} max={1000} value={limit} onChange={e => setLimit(parseInt(e.target.value) || 100)}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button onClick={testConnection} disabled={testing}
            className="flex items-center gap-2 px-4 py-2 bg-slate-700 text-white rounded-xl text-sm font-bold hover:bg-slate-800 disabled:opacity-50">
            {testing ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
            {t('erpconn.testConnection')}
          </button>
          <button onClick={runPreview} disabled={previewing}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-bold hover:bg-blue-700 disabled:opacity-50">
            {previewing ? <Loader2 size={14} className="animate-spin" /> : <Eye size={14} />}
            {t('erpconn.preview')}
          </button>
          <button onClick={runImport} disabled={importing}
            className="flex items-center gap-2 px-5 py-2 bg-emerald-600 text-white rounded-xl text-sm font-bold hover:bg-emerald-700 disabled:opacity-50 shadow-md">
            {importing ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
            {t('erpconn.importNow')}
          </button>
          <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer ml-2"
            title={t('erpconn.reimportHint')}>
            <input type="checkbox" checked={reimport} onChange={e => setReimport(e.target.checked)}
              className="w-4 h-4 accent-emerald-600" />
            {t('erpconn.reimport')}
          </label>
          {importMsg && (
            <span className={`text-sm font-semibold flex items-center ${
              importMsg.startsWith('❌') ? 'text-rose-600' :
              importMsg.startsWith('⏳') ? 'text-amber-600' : 'text-emerald-600'
            }`}>
              {importMsg}
            </span>
          )}
        </div>

        <div className="text-[11px] text-slate-500 flex items-start gap-2 bg-slate-50 border border-slate-100 rounded-lg px-3 py-2">
          <AlertCircle size={12} className="mt-0.5 flex-shrink-0 text-slate-400" />
          <span>{t('erpconn.howItWorks')}</span>
        </div>

        {/* Test result panel */}
        {testResult && (
          <div className={`mt-3 p-4 rounded-xl border ${testResult.ok ? 'bg-emerald-50 border-emerald-100' : 'bg-rose-50 border-rose-100'}`}>
            <div className="flex items-start gap-2">
              {testResult.ok ? <CheckCircle2 size={16} className="text-emerald-600 mt-0.5" /> : <AlertCircle size={16} className="text-rose-600 mt-0.5" />}
              <div className="flex-1 min-w-0">
                <div className={`text-sm font-bold ${testResult.ok ? 'text-emerald-800' : 'text-rose-800'}`}>
                  {testResult.message}
                </div>
                {testResult.provider && (
                  <div className="text-[11px] text-slate-500 mt-0.5">{t('erpconn.provider')}: <code className="font-mono">{testResult.provider}</code></div>
                )}
                {testResult.details && (
                  <pre className="mt-2 text-[10px] bg-white/60 border border-gray-100 p-2 rounded font-mono overflow-x-auto">
                    {JSON.stringify(testResult.details, null, 2)}
                  </pre>
                )}
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Preview output */}
      {preview !== null && (
        <section className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-800">{t('erpconn.preview')} ({preview.length})</h3>
            <span className="text-[10px] text-slate-400">{t('erpconn.previewNote')}</span>
          </div>
          {preview.length === 0 ? (
            <div className="p-8 text-center text-slate-400 text-sm">{t('erpconn.noPreview')}</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-[10px] font-bold text-slate-500 uppercase">
                <tr>
                  <th className="text-left px-4 py-2">{t('reports.internalId')}</th>
                  <th className="text-left px-4 py-2">{t('reports.issueDate')}</th>
                  <th className="text-left px-4 py-2">{t('reports.customerCol')}</th>
                  <th className="text-right px-4 py-2">{t('reports.qty')}</th>
                  <th className="text-right px-4 py-2">{t('reports.totalCol')}</th>
                </tr>
              </thead>
              <tbody>
                {preview.map((inv: any) => {
                  const total = (inv.lines || []).reduce((sum: number, l: any) =>
                    sum + (Number(l.QUANTITY || 0) * Number(l.AMOUNT || 0) - Number(l.DIS_AMOUNT || 0)), 0);
                  const dup = alreadyImportedIds.has(String(inv.externalId));
                  return (
                    <tr key={inv.externalId || inv.INTERNAL_ID} className={`border-t border-gray-50 ${dup ? 'bg-amber-50/40' : ''}`}>
                      <td className="px-4 py-2 font-mono text-xs font-semibold">
                        <div className="flex items-center gap-2">
                          <span>{inv.INTERNAL_ID}</span>
                          {dup && (
                            <span className="text-[9px] font-bold bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded uppercase">
                              {t('erpconn.alreadyImported')}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-2 text-xs">{inv.DATE_TIME_ISSUED ? new Date(inv.DATE_TIME_ISSUED).toLocaleDateString() : '—'}</td>
                      <td className="px-4 py-2 text-xs">{inv.RECEIVER_NAME || inv.RECEIVER_ID || '—'}</td>
                      <td className="px-4 py-2 text-right font-mono">{(inv.lines || []).length}</td>
                      <td className="px-4 py-2 text-right font-mono font-bold">{total.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
      )}

      {/* Run history */}
      <section className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2"><Calendar size={14} /> {t('erpconn.history')}</h3>
          <button onClick={loadRuns} className="text-xs text-slate-500 hover:text-slate-700 flex items-center gap-1">
            <RefreshCw size={12} /> {t('common.reload')}
          </button>
        </div>
        {runsLoading && <div className="p-8 text-center text-slate-400"><Loader2 size={20} className="animate-spin mx-auto" /></div>}
        {!runsLoading && runs.length === 0 && (
          <div className="p-8 text-center text-slate-400 text-sm">{t('erpconn.noRuns')}</div>
        )}
        {!runsLoading && runs.length > 0 && (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-[10px] font-bold text-slate-500 uppercase">
              <tr>
                <th className="text-left px-4 py-2">{t('erpconn.startedAt')}</th>
                <th className="text-left px-4 py-2">{t('erpconn.provider')}</th>
                <th className="text-center px-4 py-2">{t('erpconn.trigger')}</th>
                <th className="text-center px-4 py-2">{t('common.status')}</th>
                <th className="text-right px-4 py-2">{t('erpconn.fetched')}</th>
                <th className="text-right px-4 py-2">{t('erpconn.submitted')}</th>
                <th className="text-right px-4 py-2">{t('erpconn.skipped')}</th>
                <th className="text-right px-4 py-2">{t('erpconn.failed')}</th>
                <th className="text-left px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {runs.map(run => {
                const expanded = expandedRunId === run.id;
                const detail = runDetail[run.id] || [];
                return (
                  <React.Fragment key={run.id}>
                    <tr className={`border-t border-gray-50 cursor-pointer hover:bg-slate-50/50 ${expanded ? 'bg-slate-50' : ''}`}
                      onClick={() => toggleRunDetail(run.id)}>
                      <td className="px-4 py-2 text-xs">{new Date(run.started_at).toLocaleString()}</td>
                      <td className="px-4 py-2 text-xs font-mono">{run.provider || '—'}</td>
                      <td className="px-4 py-2 text-center">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase ${
                          run.triggered_by === 'scheduled' ? 'bg-violet-100 text-violet-700' : 'bg-slate-100 text-slate-600'
                        }`}>{run.triggered_by || 'manual'}</span>
                      </td>
                      <td className="px-4 py-2 text-center">{statusBadge(run.status)}</td>
                      <td className="px-4 py-2 text-right font-mono">{run.fetched_count}</td>
                      <td className="px-4 py-2 text-right font-mono text-emerald-700">{run.submitted_count || ''}</td>
                      <td className="px-4 py-2 text-right font-mono text-slate-400">{run.skipped_count || ''}</td>
                      <td className="px-4 py-2 text-right font-mono text-rose-700">{run.failed_count || ''}</td>
                      <td className="px-4 py-2 text-[10px] text-slate-400 text-right">
                        {expanded ? '▼' : '▶'}
                      </td>
                    </tr>
                    {expanded && (
                      <tr className="border-t border-gray-50">
                        <td colSpan={9} className="bg-slate-50/40 px-4 py-3">
                          {run.error_message && (
                            <div className="mb-2 text-xs text-rose-700 bg-rose-50 border border-rose-100 rounded p-2 flex items-start gap-2">
                              <AlertCircle size={12} className="mt-0.5 flex-shrink-0" />
                              {run.error_message}
                            </div>
                          )}
                          {detailLoading && !runDetail[run.id] && (
                            <div className="py-4 text-center"><Loader2 size={16} className="animate-spin mx-auto text-slate-400" /></div>
                          )}
                          {!detailLoading && detail.length === 0 && !run.error_message && (
                            <div className="text-xs text-slate-400 py-2 text-center">{t('erpconn.noPerInvoice')}</div>
                          )}
                          {detail.length > 0 && (
                            <div className="max-h-72 overflow-y-auto">
                              <table className="w-full text-[11px]">
                                <thead className="bg-white/60 text-[9px] font-bold text-slate-400 uppercase sticky top-0">
                                  <tr>
                                    <th className="text-left px-2 py-1">{t('reports.internalId')}</th>
                                    <th className="text-left px-2 py-1">External ID</th>
                                    <th className="text-center px-2 py-1">{t('common.status')}</th>
                                    <th className="text-left px-2 py-1">ETA UUID</th>
                                    <th className="text-left px-2 py-1">{t('erpconn.error')}</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {detail.map(inv => (
                                    <tr key={inv.external_id} className="border-t border-gray-100">
                                      <td className="px-2 py-1 font-mono text-[10px]">{inv.internal_id || '—'}</td>
                                      <td className="px-2 py-1 font-mono text-[10px] text-slate-500">{inv.external_id}</td>
                                      <td className="px-2 py-1 text-center">
                                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase ${
                                          inv.status === 'submitted' ? 'bg-emerald-100 text-emerald-700' :
                                          inv.status === 'failed' ? 'bg-rose-100 text-rose-700' :
                                          'bg-slate-100 text-slate-500'
                                        }`}>{inv.status}</span>
                                      </td>
                                      <td className="px-2 py-1 font-mono text-[9px] text-slate-500">{inv.eta_uuid?.slice(0, 12) || '—'}</td>
                                      <td className="px-2 py-1 text-rose-600 truncate max-w-[300px]" title={inv.error_message || ''}>
                                        {inv.error_message || '—'}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
};

export default ERPConnector;
