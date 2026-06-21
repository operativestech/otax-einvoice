import React, { useEffect, useState, useCallback } from 'react';
import { Download, Package, Loader2, RefreshCw, AlertCircle, CheckCircle2, Clock, XCircle, Calendar } from 'lucide-react';
import { API_URL } from '../services/apiService';
import { confirmDialog, alertDialog } from '../components/ConfirmDialog';
import { useTranslation } from '../i18n';

// ─── Types ───────────────────────────────────────────────────────────────

type PackageType = 'Summary' | 'Full';
// XLSX is a LOCAL export — we don't ask ETA for it, we build it from the
// per-org documents table. JSON / XML go through the ETA package flow.
type PackageFormat = 'JSON' | 'XML' | 'XLSX';
type DocStatus = 'Valid' | 'Cancelled' | 'Rejected' | 'Submitted';

interface PackageRequestRow {
  id: number;
  rid: string | null;
  type: PackageType;
  format: PackageFormat;
  date_from: string;
  date_to: string;
  statuses: string[] | null;
  document_types: string[] | null;
  is_intermediary: boolean;
  representee_rin: string | null;
  status: 'Pending' | 'Submitted' | 'Ready' | 'Failed' | 'Downloaded';
  error_message: string | null;
  created_at: string;
  downloaded_at: string | null;
}

const ALL_STATUSES: DocStatus[] = ['Valid', 'Cancelled', 'Rejected', 'Submitted'];
const ALL_DOC_TYPES = ['I', 'C', 'D', 'EI', 'EC', 'ED'];

const getAuthHeaders = (): Record<string, string> => {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
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

const toIsoStart = (d: string) => (d ? new Date(d + 'T00:00:00Z').toISOString() : '');
const toIsoEnd = (d: string) => (d ? new Date(d + 'T23:59:59Z').toISOString() : '');

// ─── Small helpers ──────────────────────────────────────────────────────

const statusStyle: Record<string, string> = {
  Pending: 'bg-amber-50 text-amber-700 border-amber-200',
  Submitted: 'bg-amber-50 text-amber-700 border-amber-200',
  Ready: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  Failed: 'bg-red-50 text-red-700 border-red-200',
  Downloaded: 'bg-blue-50 text-blue-700 border-blue-200',
};

const StatusBadge: React.FC<{ status: string }> = ({ status }) => {
  const { t } = useTranslation();
  // Map raw status to translation key.
  const labelKey: Record<string, string> = {
    Pending:    'expkg.statusPending',
    Submitted:  'expkg.statusSubmitted',
    Ready:      'expkg.statusReady',
    Failed:     'expkg.statusFailed',
    Downloaded: 'expkg.statusDownloaded',
  };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-semibold rounded-full border ${statusStyle[status] || 'bg-slate-50 text-slate-600 border-slate-200'}`}>
      {(status === 'Pending' || status === 'Submitted') && <Clock size={12} />}
      {status === 'Ready' && <CheckCircle2 size={12} />}
      {status === 'Failed' && <XCircle size={12} />}
      {status === 'Downloaded' && <Download size={12} />}
      {labelKey[status] ? t(labelKey[status]) : status}
    </span>
  );
};

// ─── Main Page ───────────────────────────────────────────────────────────

const ExportPackages: React.FC = () => {
  const { t } = useTranslation();
  // Form state
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [type, setType] = useState<PackageType>('Summary');
  const [format, setFormat] = useState<PackageFormat>('JSON');
  const [selectedStatuses, setSelectedStatuses] = useState<DocStatus[]>(['Valid']);
  const [selectedTypes, setSelectedTypes] = useState<string[]>(['I', 'C', 'D']);
  const [isIntermediary, setIsIntermediary] = useState(false);
  const [representeeRin, setRepresenteeRin] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitOk, setSubmitOk] = useState<string | null>(null);

  // History state
  const [rows, setRows] = useState<PackageRequestRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);

  // Default date range: last month
  useEffect(() => {
    const today = new Date();
    const firstOfThisMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const firstOfPrevMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const lastOfPrevMonth = new Date(firstOfThisMonth.getTime() - 24 * 60 * 60 * 1000);
    setDateFrom(firstOfPrevMonth.toISOString().split('T')[0]);
    setDateTo(lastOfPrevMonth.toISOString().split('T')[0]);
  }, []);

  const loadHistory = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(`${API_URL}/eta/packages/history?pageSize=50`, { headers: getAuthHeaders() });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || 'Failed to load history');
      setRows(data.items || []);
    } catch (err: any) {
      setLoadError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const toggleStatus = (s: DocStatus) => {
    setSelectedStatuses(curr => curr.includes(s) ? curr.filter(x => x !== s) : [...curr, s]);
  };
  const toggleType = (t: string) => {
    setSelectedTypes(curr => curr.includes(t) ? curr.filter(x => x !== t) : [...curr, t]);
  };

  // Approximate range span in months; used to warn about ETA timeouts on wide windows.
  const rangeMonths = (() => {
    if (!dateFrom || !dateTo) return 0;
    const a = new Date(dateFrom).getTime();
    const b = new Date(dateTo).getTime();
    if (isNaN(a) || isNaN(b) || b < a) return 0;
    return Math.round((b - a) / (1000 * 60 * 60 * 24 * 30.44));
  })();

  // ETA 504s on very wide "Full" ranges. Threshold chosen from real failures we saw.
  const riskyRange = rangeMonths > 12 || (type === 'Full' && rangeMonths > 6);

  const submitRequest = async () => {
    setSubmitError(null);
    setSubmitOk(null);
    if (!dateFrom || !dateTo) { setSubmitError(t('expkg.errPickDates')); return; }
    if (selectedStatuses.length === 0) { setSubmitError(t('expkg.errPickStatus')); return; }
    if (isIntermediary && !representeeRin) { setSubmitError(t('expkg.errRinReq')); return; }

    // Confirmation before a wide-range request — prevents accidental 504s
    if (riskyRange) {
      const ok = await confirmDialog({
        title: t('expkg.confirmWide'),
        message:
          t('expkg.headsRange').replace('{n}', String(rangeMonths)) +
          (type === 'Full' ? t('expkg.headsFull') : '') + '. ' +
          t('expkg.headsMsg'),
        confirmLabel: t('expkg.confirmWideAnyway'),
        tone: 'warning',
      });
      if (!ok) return;
    }

    setSubmitting(true);
    try {
      // XLSX path — build locally. Bypasses ETA entirely so there's no rid to
      // track, no "pending → ready" wait, and no risk of a 504. Doubles as a
      // verification tool: if the user wants to sanity-check what's in Otax
      // vs what ETA says, they can compare JSON-from-ETA with XLSX-from-local.
      if (format === 'XLSX') {
        const qs = new URLSearchParams({
          dateFrom,
          dateTo,
          type,
          statuses: selectedStatuses.join(','),
          documentTypes: selectedTypes.join(','),
        });
        const res = await fetch(`${API_URL}/reports/package-xlsx?${qs.toString()}`, { headers: getAuthHeaders() });
        if (!res.ok) {
          const maybeJson = await res.json().catch(() => null);
          throw new Error(maybeJson?.message || `HTTP ${res.status}`);
        }
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const stamp = new Date().toISOString().slice(0, 10);
        a.download = `OTax-Package-${type}-${stamp}.xlsx`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(url);
        setSubmitOk(t('expkg.xlsxDownloaded').replace('{type}', type));
        return;
      }

      // JSON / XML path — ask ETA to build a package. Async flow (rid → Ready → download).
      const endpoint = isIntermediary ? '/eta/packages/intermediary' : '/eta/packages/request';
      const body: any = {
        dateFrom: toIsoStart(dateFrom),
        dateTo: toIsoEnd(dateTo),
        type,
        format,
        statuses: selectedStatuses,
        documentTypeNames: selectedTypes,
      };
      if (isIntermediary) {
        body.representedTaxpayerFilterType = '1';
        body.representeeRin = representeeRin;
      }

      const res = await fetch(`${API_URL}${endpoint}`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(body),
      });
      const data = await res.json();
      // 504 is a special case — server signals it with `gatewayTimeout: true`
      if (res.status === 504 || data?.gatewayTimeout) {
        throw new Error(data.message || t('expkg.eta504'));
      }
      if (!res.ok || !data.success) throw new Error(data.message || `HTTP ${res.status}`);

      setSubmitOk(t('expkg.requestSubmittedRid').replace('{rid}', data.rid || '(pending)'));
      await loadHistory();
    } catch (err: any) {
      setSubmitError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const downloadPackage = async (row: PackageRequestRow) => {
    if (!row.rid) return;
    setDownloadingId(row.id);
    try {
      const res = await fetch(`${API_URL}/eta/packages/${encodeURIComponent(row.rid)}`, { headers: getAuthHeaders() });
      // ETA builds packages asynchronously — 202 means "still preparing, try later"
      if (res.status === 202) {
        const data = await res.json();
        await alertDialog({ title: t('expkg.notReadyTitle'), message: data.message || 'Package is still being prepared. Try again in a few minutes.', tone: 'info' });
        return;
      }
      if (!res.ok) {
        let errMsg = `HTTP ${res.status}`;
        try { const data = await res.json(); errMsg = data.message || errMsg; } catch { /* ignore */ }
        throw new Error(errMsg);
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `package_${row.rid}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      await loadHistory();
    } catch (err: any) {
      await alertDialog({ title: t('expkg.dlFailTitle'), message: err.message, tone: 'danger' });
    } finally {
      setDownloadingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
          <Package size={24} className="text-blue-600" /> {t('expkg.titleHeader')}
        </h1>
        <p className="text-slate-500 text-sm mt-1">
          {t('expkg.subtitleHeader')}
        </p>
      </div>

      {/* Create Request */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
        <h2 className="font-semibold text-slate-800 mb-4 flex items-center gap-2"><Calendar size={16} /> {t('expkg.create')}</h2>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">{t('expkg.dateFromLbl')}</label>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">{t('expkg.dateToLbl')}</label>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">{t('expkg.packageType')}</label>
            <select value={type} onChange={e => setType(e.target.value as PackageType)}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent">
              <option value="Summary">{t('expkg.summary')}</option>
              <option value="Full">{t('expkg.full')}</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">{t('expkg.format')}</label>
            <select value={format} onChange={e => setFormat(e.target.value as PackageFormat)}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent">
              <option value="JSON">{t('expkg.formatJsonOpt')}</option>
              <option value="XML">{t('expkg.formatXmlOpt')}</option>
              <option value="XLSX">{t('expkg.formatXlsxOpt')}</option>
            </select>
            {format === 'XLSX' && (
              <p className="text-[10px] text-emerald-700 mt-1 leading-snug">
                {t('expkg.xlsxHint')}
              </p>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-2">{t('expkg.statuses')}</label>
            <div className="flex flex-wrap gap-2">
              {ALL_STATUSES.map(s => (
                <button key={s} type="button" onClick={() => toggleStatus(s)}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-full border transition-all ${selectedStatuses.includes(s)
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-slate-600 border-gray-200 hover:border-blue-300'}`}>
                  {t(`expkg.status${s}`)}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-2">{t('expkg.docTypes')}</label>
            <div className="flex flex-wrap gap-2">
              {ALL_DOC_TYPES.map(dt => (
                <button key={dt} type="button" onClick={() => toggleType(dt)}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-full border transition-all ${selectedTypes.includes(dt)
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-slate-600 border-gray-200 hover:border-blue-300'}`}>
                  {dt}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-4 border-t border-gray-100 pt-4">
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={isIntermediary} onChange={e => setIsIntermediary(e.target.checked)}
              className="rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
            <span>{t('expkg.intermediaryFull')}</span>
          </label>
          {isIntermediary && (
            <div className="mt-2 max-w-xs">
              <label className="block text-xs font-semibold text-slate-600 mb-1">{t('expkg.representeeRin')}</label>
              <input type="text" value={representeeRin} onChange={e => setRepresenteeRin(e.target.value)}
                placeholder={t('expkg.representeeRinPh')}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500" />
            </div>
          )}
        </div>

        {/* Wide-range advisory — ETA's gateway times out around 60s for large exports. */}
        {riskyRange && (
          <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800 flex items-start gap-2">
            <AlertCircle size={14} className="mt-0.5 shrink-0" />
            <div>
              <strong>{t('expkg.headsUp')}</strong> {t('expkg.headsRange').replace('{n}', String(rangeMonths))}{type === 'Full' ? t('expkg.headsFull') : ''}. {t('expkg.headsMsg')}
            </div>
          </div>
        )}

        <div className="mt-5 flex items-center gap-3">
          <button onClick={submitRequest} disabled={submitting}
            className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition-all">
            {submitting ? <Loader2 size={16} className="animate-spin" /> : <Package size={16} />}
            {t('expkg.submitBtn')}
          </button>
          {submitError && (
            <div className="text-sm text-red-600 flex items-start gap-1 max-w-2xl">
              <AlertCircle size={14} className="mt-0.5 shrink-0" />
              <span className="break-words">{submitError}</span>
            </div>
          )}
          {submitOk && <span className="text-sm text-emerald-600 flex items-center gap-1"><CheckCircle2 size={14} /> {submitOk}</span>}
        </div>
      </div>

      {/* History */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100">
        <div className="px-5 pt-4 pb-3 flex items-center justify-between border-b border-gray-100">
          <h2 className="font-semibold text-slate-800">{t('expkg.history')}</h2>
          <button onClick={loadHistory} disabled={loading}
            className="flex items-center gap-1.5 text-sm text-slate-600 hover:text-blue-600 disabled:opacity-50">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> {t('expkg.refresh')}
          </button>
        </div>

        {loadError && (
          <div className="m-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 flex items-center gap-2">
            <AlertCircle size={16} /> {loadError}
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="bg-gray-50/80">
                <th className="px-4 py-3 text-[11px] font-bold text-slate-500 uppercase">{t('expkg.colRid')}</th>
                <th className="px-4 py-3 text-[11px] font-bold text-slate-500 uppercase">{t('expkg.colTypeFmt')}</th>
                <th className="px-4 py-3 text-[11px] font-bold text-slate-500 uppercase">{t('expkg.range')}</th>
                <th className="px-4 py-3 text-[11px] font-bold text-slate-500 uppercase">{t('expkg.colFilters')}</th>
                <th className="px-4 py-3 text-[11px] font-bold text-slate-500 uppercase">{t('common.status')}</th>
                <th className="px-4 py-3 text-[11px] font-bold text-slate-500 uppercase">{t('expkg.colCreated')}</th>
                <th className="px-4 py-3 text-[11px] font-bold text-slate-500 uppercase text-right">{t('expkg.colAction')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {rows.length === 0 && !loading && (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-slate-400">
                    {t('expkg.noRuns')}
                  </td>
                </tr>
              )}
              {rows.map(row => (
                <tr key={row.id} className="hover:bg-gray-50/50">
                  <td className="px-4 py-3 font-mono text-xs text-slate-700">
                    {row.rid ? row.rid : <span className="text-slate-400">—</span>}
                    {row.is_intermediary && <span className="ml-2 text-[10px] px-1.5 py-0.5 bg-violet-50 text-violet-700 rounded">{t('expkg.intermediaryBadge')}</span>}
                  </td>
                  <td className="px-4 py-3 text-slate-700">{row.type} / {row.format}</td>
                  <td className="px-4 py-3 text-slate-600 text-xs">
                    {new Date(row.date_from).toISOString().split('T')[0]} → {new Date(row.date_to).toISOString().split('T')[0]}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-600">
                    {row.document_types?.length ? <div><strong>{t('expkg.colTypes')}</strong> {row.document_types.join(', ')}</div> : null}
                    {row.statuses?.length ? <div><strong>{t('expkg.colStatuses')}</strong> {row.statuses.join(', ')}</div> : null}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={row.status} />
                    {row.error_message && <div className="mt-1 text-xs text-red-600 max-w-xs truncate" title={row.error_message}>{row.error_message}</div>}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500">
                    {new Date(row.created_at).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {row.rid && (row.status === 'Submitted' || row.status === 'Ready' || row.status === 'Downloaded') ? (
                      <button onClick={() => downloadPackage(row)} disabled={downloadingId === row.id}
                        className="inline-flex items-center gap-1 px-3 py-1.5 bg-emerald-600 text-white text-xs font-semibold rounded-lg hover:bg-emerald-700 disabled:opacity-50">
                        {downloadingId === row.id ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
                        {t('expkg.download')}
                      </button>
                    ) : (
                      <span className="text-xs text-slate-400">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default ExportPackages;
