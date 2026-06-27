
import React from 'react';
import { Link } from 'react-router-dom';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  AreaChart, Area, PieChart, Pie, Cell
} from 'recharts';
import { FileCheck, FileX, Send, LayoutPanelLeft, TrendingUp, TrendingDown, CheckCircle, AlertCircle, XCircle, Download, Upload, GitCompare, FileSignature, ArrowRight, Receipt, Users, Clock, XOctagon, GripVertical, Eye, EyeOff, Save, RotateCcw, X, Loader2, CheckCircle2, Minus, Plus, Maximize2 } from 'lucide-react';
import { KPIData } from '../types';

import { apiService, API_URL } from '../services/apiService';
import { useTranslation } from '../i18n';
import { confirmDialog } from '../components/ConfirmDialog';

// ── Helper used by the small widgets below. Kept here rather than a new util
//    because this is literal fire-and-forget fetching.
const getAuthHeaders = (): Record<string, string> => {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  try {
    const user = JSON.parse(localStorage.getItem('invoice_user') || '{}');
    if (user.token) headers['Authorization'] = `Bearer ${user.token}`;
  } catch { /* ignore */ }
  return headers;
};

// ── Reconciliation Summary widget ────────────────────────────────────────
const ReconciliationWidget: React.FC = () => {
  const { t } = useTranslation();
  const [data, setData] = React.useState<{ suggested: number; accepted: number; erpRate: number; bankRate: number; totalAmount: number } | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await fetch(`${API_URL}/reconciliation/summary`, { headers: getAuthHeaders() });
        const d = await res.json();
        if (!mounted || !d.success) return;
        const suggested = d.byStatus?.find((s: any) => s.status === 'SUGGESTED')?.count || 0;
        const accepted = d.byStatus?.find((s: any) => s.status === 'ACCEPTED')?.count || 0;
        const erpRate = d.erp?.total > 0 ? Math.round(((d.erp.total - d.erp.unmatched) / d.erp.total) * 100) : 0;
        const bankRate = d.bank?.total > 0 ? Math.round(((d.bank.total - d.bank.unmatched) / d.bank.total) * 100) : 0;
        setData({ suggested, accepted, erpRate, bankRate, totalAmount: d.totalAcceptedAmount || 0 });
      } catch { /* silent */ }
      finally { if (mounted) setLoading(false); }
    })();
    return () => { mounted = false; };
  }, []);

  return (
    <div className="glass-panel p-6 h-full flex flex-col hover:-translate-y-1 hover:shadow-lg transition-all duration-300">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-bold text-slate-800 flex items-center gap-2"><GitCompare size={18} className="text-blue-600" /> {t('dashboard.reconciliation')}</h3>
        <Link to="/reconciliation" className="text-xs text-blue-600 font-semibold hover:underline flex items-center gap-1">
          {t('common.open')} <ArrowRight size={12} />
        </Link>
      </div>
      {loading && <div className="text-center text-slate-400 py-4 text-sm">{t('common.loading')}</div>}
      {!loading && data && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-amber-50 border border-amber-100 rounded-xl p-3">
              <div className="text-[10px] font-bold text-amber-700 uppercase tracking-wider">{t('dashboard.recon.suggested')}</div>
              <div className="text-xl font-black text-amber-900">{data.suggested}</div>
            </div>
            <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-3">
              <div className="text-[10px] font-bold text-emerald-700 uppercase tracking-wider">{t('dashboard.recon.accepted')}</div>
              <div className="text-xl font-black text-emerald-900">{data.accepted}</div>
            </div>
          </div>
          <div className="space-y-2">
            <div>
              <div className="flex justify-between text-xs text-slate-600 mb-1"><span>{t('dashboard.recon.erpCov')}</span><span className="font-bold">{data.erpRate}%</span></div>
              <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${data.erpRate}%` }} />
              </div>
            </div>
            <div>
              <div className="flex justify-between text-xs text-slate-600 mb-1"><span>{t('dashboard.recon.bankCov')}</span><span className="font-bold">{data.bankRate}%</span></div>
              <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${data.bankRate}%` }} />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ── Signing Queue widget ─────────────────────────────────────────────────
const SigningQueueWidget: React.FC = () => {
  const { t } = useTranslation();
  const [stats, setStats] = React.useState<{ queued: number; processing: number; failed: number; signed: number } | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const res = await fetch(`${API_URL}/signing/queue/stats`, { headers: getAuthHeaders() });
        const d = await res.json();
        if (!mounted || !d.success) return;
        setStats({ queued: d.queued || 0, processing: d.processing || 0, failed: d.failed || 0, signed: d.signed || 0 });
      } catch { /* silent */ }
      finally { if (mounted) setLoading(false); }
    };
    load();
    const t = setInterval(load, 30_000);
    return () => { mounted = false; clearInterval(t); };
  }, []);

  return (
    <div className="glass-panel p-6 h-full flex flex-col hover:-translate-y-1 hover:shadow-lg transition-all duration-300">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-bold text-slate-800 flex items-center gap-2"><FileSignature size={18} className="text-violet-600" /> {t('dashboard.signingQueue')}</h3>
        <Link to="/settings/tokensign" className="text-xs text-blue-600 font-semibold hover:underline flex items-center gap-1">
          {t('common.open')} <ArrowRight size={12} />
        </Link>
      </div>
      {loading && <div className="text-center text-slate-400 py-4 text-sm">{t('common.loading')}</div>}
      {!loading && stats && (
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-amber-50 border border-amber-100 rounded-xl p-3">
            <div className="text-[10px] font-bold text-amber-700 uppercase tracking-wider">{t('dashboard.queue.queued')}</div>
            <div className="text-xl font-black text-amber-900">{stats.queued}</div>
          </div>
          <div className="bg-blue-50 border border-blue-100 rounded-xl p-3">
            <div className="text-[10px] font-bold text-blue-700 uppercase tracking-wider">{t('dashboard.queue.processing')}</div>
            <div className="text-xl font-black text-blue-900">{stats.processing}</div>
          </div>
          <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-3">
            <div className="text-[10px] font-bold text-emerald-700 uppercase tracking-wider">{t('dashboard.queue.signed')}</div>
            <div className="text-xl font-black text-emerald-900">{stats.signed}</div>
          </div>
          <div className={`${stats.failed > 0 ? 'bg-red-50 border-red-100' : 'bg-gray-50 border-gray-100'} border rounded-xl p-3`}>
            <div className={`text-[10px] font-bold uppercase tracking-wider ${stats.failed > 0 ? 'text-red-700' : 'text-slate-500'}`}>{t('dashboard.queue.failed')}</div>
            <div className={`text-xl font-black ${stats.failed > 0 ? 'text-red-900' : 'text-slate-400'}`}>{stats.failed}</div>
          </div>
        </div>
      )}
    </div>
  );
};

// ── VAT Payable (current month) widget ───────────────────────────────────
// Hits /api/reports/vat-summary scoped to the current calendar month and
// highlights the headline Net Payable figure so the admin always knows
// roughly what's owed to ETA right now.
const VatPayableWidget: React.FC = () => {
  const { t } = useTranslation();
  const [data, setData] = React.useState<{ month: string; output: number; input: number; net: number } | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const now = new Date();
        const from = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
        const res = await fetch(`${API_URL}/reports/vat-summary?dateFrom=${from}`, { headers: getAuthHeaders() });
        const d = await res.json();
        if (!mounted || !d.success) return;
        // Current month row, if any. Fall back to the totals (matches when only one row exists).
        const month = from.slice(0, 7);
        const row = (d.rows || []).find((r: any) => r.month === month) || d.totals || null;
        if (row) {
          setData({
            month,
            output: Number(row.outputVat || 0),
            input:  Number(row.inputVat  || 0),
            net:    Number((row.outputVat || 0) - (row.inputVat || 0)),
          });
        } else {
          setData({ month, output: 0, input: 0, net: 0 });
        }
      } catch { /* silent */ }
      finally { if (mounted) setLoading(false); }
    })();
    return () => { mounted = false; };
  }, []);

  const fmt = (n: number) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  const isRefund = data && data.net < 0;

  return (
    <div className="glass-panel p-6 h-full flex flex-col hover:-translate-y-1 hover:shadow-lg transition-all duration-300">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-bold text-slate-800 flex items-center gap-2"><Receipt size={18} className="text-emerald-600" /> {t('dashboard.vatMonth')}</h3>
        <Link to="/reports" className="text-xs text-emerald-600 font-semibold hover:underline flex items-center gap-1">
          {t('common.open')} <ArrowRight size={12} />
        </Link>
      </div>
      {loading && <div className="text-center text-slate-400 py-4 text-sm">{t('common.loading')}</div>}
      {!loading && data && (
        <div className="space-y-3">
          <div className={`p-4 rounded-xl border text-center ${isRefund ? 'bg-emerald-50 border-emerald-100' : 'bg-rose-50 border-rose-100'}`}>
            <div className={`text-[10px] font-bold uppercase tracking-wider ${isRefund ? 'text-emerald-700' : 'text-rose-700'}`}>
              {isRefund ? t('dashboard.refundable') : t('dashboard.netPayable')}
            </div>
            <div className={`text-3xl font-black ${isRefund ? 'text-emerald-800' : 'text-rose-800'} font-mono`}>
              {fmt(Math.abs(data.net))}
            </div>
            <div className="text-[10px] text-slate-500 mt-0.5">EGP · {data.month}</div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-emerald-50/60 border border-emerald-100 rounded-xl p-3">
              <div className="text-[10px] font-bold text-emerald-700 uppercase tracking-wider">{t('dashboard.outputVat')}</div>
              <div className="text-lg font-black text-emerald-900 font-mono">{fmt(data.output)}</div>
            </div>
            <div className="bg-blue-50/60 border border-blue-100 rounded-xl p-3">
              <div className="text-[10px] font-bold text-blue-700 uppercase tracking-wider">{t('dashboard.inputVat')}</div>
              <div className="text-lg font-black text-blue-900 font-mono">{fmt(data.input)}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ── Top Customers mini-widget ─────────────────────────────────────────────
const TopCustomersWidget: React.FC = () => {
  const { t } = useTranslation();
  const [rows, setRows] = React.useState<any[] | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await fetch(`${API_URL}/reports/top-customers?limit=5`, { headers: getAuthHeaders() });
        const d = await res.json();
        if (!mounted || !d.success) return;
        setRows(d.rows || []);
      } catch { /* silent */ }
      finally { if (mounted) setLoading(false); }
    })();
    return () => { mounted = false; };
  }, []);

  const fmt = (n: number) => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
  const max = rows && rows.length > 0 ? Number(rows[0].total_amount || 0) : 0;

  return (
    <div className="glass-panel p-6 h-full flex flex-col hover:-translate-y-1 hover:shadow-lg transition-all duration-300">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-bold text-slate-800 flex items-center gap-2"><Users size={18} className="text-violet-600" /> {t('dashboard.topCustomers')}</h3>
        <Link to="/reports" className="text-xs text-violet-600 font-semibold hover:underline flex items-center gap-1">
          {t('common.open')} <ArrowRight size={12} />
        </Link>
      </div>
      {loading && <div className="text-center text-slate-400 py-4 text-sm">{t('common.loading')}</div>}
      {!loading && rows && rows.length === 0 && (
        <div className="text-center text-slate-400 py-4 text-sm">{t('dashboard.noCustomers')}</div>
      )}
      {!loading && rows && rows.length > 0 && (
        <div className="space-y-2">
          {rows.slice(0, 5).map((c, i) => {
            const pct = max > 0 ? (Number(c.total_amount) / max) * 100 : 0;
            return (
              <div key={c.receiverId || i} className="space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-bold text-slate-800 truncate">{c.receiverName || c.receiverId || '—'}</div>
                    <div className="text-[10px] text-slate-400 font-mono">{c.receiverId} · {c.count} {t('dashboard.invShort')}</div>
                  </div>
                  <div className="text-xs font-mono font-bold text-slate-700">{fmt(c.total_amount)}</div>
                </div>
                <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full bg-violet-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

// ── Compliance Alerts widget — Rejected (24h) + Late submissions ─────────
// Designed to be a "glance" card: if both counters are zero the admin gets
// a calm green state; if anything triggers, the relevant sub-card becomes
// a clickable alert that lands them on the right report.
const AlertsWidget: React.FC = () => {
  const { t } = useTranslation();
  const [rejected, setRejected] = React.useState<{ count: number; total: number } | null>(null);
  const [late, setLate] = React.useState<{ count: number; total: number } | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        // Last-24h rejected — we use the flat list, capped.
        const now = new Date();
        const from = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        const fromStr = from.toISOString().slice(0, 10);
        const [rej, lat] = await Promise.all([
          fetch(`${API_URL}/reports/rejected?grouped=false&dateFrom=${fromStr}`, { headers: getAuthHeaders() }).then(r => r.json()),
          fetch(`${API_URL}/reports/late-submissions?thresholdHours=48`, { headers: getAuthHeaders() }).then(r => r.json()),
        ]);
        if (!mounted) return;
        const rejRows = rej?.rows || [];
        const latRows = lat?.rows || [];
        setRejected({
          count: rejRows.length,
          total: rejRows.reduce((s: number, r: any) => s + Number(r.total || 0), 0),
        });
        setLate({
          count: latRows.length,
          total: latRows.reduce((s: number, r: any) => s + Number(r.total || 0), 0),
        });
      } catch { /* silent */ }
      finally { if (mounted) setLoading(false); }
    })();
    return () => { mounted = false; };
  }, []);

  const fmt = (n: number) => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
  const allClear = rejected && late && rejected.count === 0 && late.count === 0;

  return (
    <div className="glass-panel p-6 h-full flex flex-col hover:-translate-y-1 hover:shadow-lg transition-all duration-300">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-bold text-slate-800 flex items-center gap-2"><AlertCircle size={18} className="text-amber-600" /> {t('dashboard.alerts')}</h3>
      </div>
      {loading && <div className="text-center text-slate-400 py-4 text-sm">{t('common.loading')}</div>}
      {!loading && allClear && (
        <div className="p-5 bg-emerald-50 border border-emerald-100 rounded-xl text-center">
          <CheckCircle className="mx-auto text-emerald-600 mb-1" size={26} />
          <div className="text-sm font-bold text-emerald-800">{t('dashboard.allClear')}</div>
          <div className="text-[11px] text-emerald-600">{t('dashboard.allClearDetail')}</div>
        </div>
      )}
      {!loading && !allClear && (
        <div className="space-y-2">
          <Link to="/reports" className={`flex items-center justify-between gap-3 p-3 rounded-xl border transition-all hover:shadow-sm ${rejected && rejected.count > 0 ? 'bg-rose-50 border-rose-100 hover:border-rose-300' : 'bg-gray-50 border-gray-100'}`}>
            <div className="flex items-center gap-2">
              <XOctagon size={18} className={rejected && rejected.count > 0 ? 'text-rose-600' : 'text-slate-400'} />
              <div>
                <div className="text-xs font-bold text-slate-700">{t('dashboard.rejected24')}</div>
                <div className="text-[10px] text-slate-400">{fmt((rejected?.total) || 0)} EGP</div>
              </div>
            </div>
            <div className={`text-xl font-black ${rejected && rejected.count > 0 ? 'text-rose-700' : 'text-slate-300'}`}>{rejected?.count || 0}</div>
          </Link>
          <Link to="/reports" className={`flex items-center justify-between gap-3 p-3 rounded-xl border transition-all hover:shadow-sm ${late && late.count > 0 ? 'bg-orange-50 border-orange-100 hover:border-orange-300' : 'bg-gray-50 border-gray-100'}`}>
            <div className="flex items-center gap-2">
              <Clock size={18} className={late && late.count > 0 ? 'text-orange-600' : 'text-slate-400'} />
              <div>
                <div className="text-xs font-bold text-slate-700">{t('dashboard.lateSubs')}</div>
                <div className="text-[10px] text-slate-400">{fmt((late?.total) || 0)} EGP</div>
              </div>
            </div>
            <div className={`text-xl font-black ${late && late.count > 0 ? 'text-orange-700' : 'text-slate-300'}`}>{late?.count || 0}</div>
          </Link>
        </div>
      )}
    </div>
  );
};

interface LayoutEntry { id: string; visible: boolean; cols: number; rows: number }

// Default order + sizes — used until /api/dashboard/layout returns. Matches
// WIDGET_CATALOGUE in dashboardLayoutRoutes.ts. Anything new added there
// should also land here so first-paint isn't empty.
//
// Sizing convention:
//   cols 1..12  → CSS-grid column span at lg+; everything stacks full-width on mobile
//   rows 1..4   → vertical multiplier; 1 = content-driven, 2..4 force min-heights
const DEFAULT_LAYOUT: LayoutEntry[] = [
  { id: 'kpis',           visible: true, cols: 12, rows: 1 },
  { id: 'invoiceVolume',  visible: true, cols: 8,  rows: 1 },
  { id: 'statusDist',     visible: true, cols: 4,  rows: 1 },
  { id: 'vatPayable',     visible: true, cols: 4,  rows: 1 },
  { id: 'alerts',         visible: true, cols: 4,  rows: 1 },
  { id: 'topCustomers',   visible: true, cols: 4,  rows: 1 },
  { id: 'reconciliation', visible: true, cols: 6,  rows: 1 },
  { id: 'signingQueue',   visible: true, cols: 6,  rows: 1 },
];

// Tailwind JIT can't pick up dynamic class names like `lg:col-span-${n}`,
// so we bake the full set as a static map. Lookup falls back to span-12.
const COL_SPAN_CLASS: Record<number, string> = {
  1:  'lg:col-span-1',
  2:  'lg:col-span-2',
  3:  'lg:col-span-3',
  4:  'lg:col-span-4',
  5:  'lg:col-span-5',
  6:  'lg:col-span-6',
  7:  'lg:col-span-7',
  8:  'lg:col-span-8',
  9:  'lg:col-span-9',
  10: 'lg:col-span-10',
  11: 'lg:col-span-11',
  12: 'lg:col-span-12',
};

// rows → minHeight in px. rows=1 means "no constraint, let content decide"
// so charts that already have their own h-[300px] sizing keep working as
// they always did.
const ROW_HEIGHT_PX: Record<number, number | undefined> = {
  1: undefined,
  2: 480,
  3: 720,
  4: 960,
};

// Friendly labels for the edit-mode chrome. Falls back to the id so a new
// widget added to the layout API but not here still renders something.
const WIDGET_LABELS_EN: Record<string, string> = {
  kpis:           'KPI cards',
  invoiceVolume:  'Invoice Volume chart',
  statusDist:     'Status Distribution',
  vatPayable:     'VAT Payable (current month)',
  alerts:         'Compliance Alerts',
  topCustomers:   'Top Customers',
  reconciliation: 'Reconciliation Summary',
  signingQueue:   'Signing Queue',
};
const WIDGET_LABELS_AR: Record<string, string> = {
  kpis:           'كروت المؤشرات',
  invoiceVolume:  'رسم حجم الفواتير',
  statusDist:     'توزيع الحالات',
  vatPayable:     'ضريبة القيمة المضافة (الشهر الحالى)',
  alerts:         'تنبيهات الالتزام',
  topCustomers:   'أفضل العملاء',
  reconciliation: 'ملخص التسوية',
  signingQueue:   'طابور التوقيع',
};

const Dashboard: React.FC = () => {
  const { t, lang } = useTranslation();
  const [kpis, setKpis] = React.useState<KPIData[]>([]);
  const [chartData, setChartData] = React.useState<any[]>([]);
  const [pieData, setPieData] = React.useState<any[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isSyncing, setIsSyncing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [period, setPeriod] = React.useState('7days');
  const [layout, setLayout] = React.useState<LayoutEntry[]>(DEFAULT_LAYOUT);

  // ── Inline layout editor state ───────────────────────────────────────────
  // editMode toggles on the drag handles + Save/Cancel chrome. savedLayout
  // is the snapshot we restore to if the user hits Cancel; layoutMsg is a
  // tiny toast (saved/reset/error) shown next to the buttons.
  const [editMode, setEditMode] = React.useState(false);
  const [savedLayout, setSavedLayout] = React.useState<LayoutEntry[]>(DEFAULT_LAYOUT);
  const [layoutSaving, setLayoutSaving] = React.useState(false);
  const [layoutMsg, setLayoutMsg] = React.useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [dragId, setDragId] = React.useState<string | null>(null);

  // Load the user's saved layout. Best-effort — fall back to default order if
  // the endpoint isn't reachable so the page never renders blank.
  React.useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const userStr = localStorage.getItem('invoice_user');
        const token = userStr ? JSON.parse(userStr).token : null;
        const r = await fetch(`${API_URL}/dashboard/layout`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        const d = await r.json();
        if (!mounted || !d.success || !Array.isArray(d.layout)) return;
        setLayout(d.layout);
        setSavedLayout(d.layout);
      } catch { /* keep default */ }
    })();
    return () => { mounted = false; };
  }, []);

  // ── Edit mode handlers ───────────────────────────────────────────────────
  const enterEdit = () => {
    setSavedLayout(layout);   // snapshot for Cancel
    setEditMode(true);
    setLayoutMsg(null);
  };
  const cancelEdit = () => {
    setLayout(savedLayout);
    setEditMode(false);
    setLayoutMsg(null);
  };
  const flashMsg = (kind: 'ok' | 'err', text: string) => {
    setLayoutMsg({ kind, text });
    setTimeout(() => setLayoutMsg(null), 2500);
  };
  const saveLayout = async () => {
    setLayoutSaving(true);
    try {
      const userStr = localStorage.getItem('invoice_user');
      const token = userStr ? JSON.parse(userStr).token : null;
      const r = await fetch(`${API_URL}/dashboard/layout`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ layout }),
      });
      const d = await r.json();
      if (!r.ok || !d.success) throw new Error(d.message || `HTTP ${r.status}`);
      const next = Array.isArray(d.layout) ? d.layout : layout;
      setLayout(next);
      setSavedLayout(next);
      setEditMode(false);
      flashMsg('ok', t('dashLayout.saved'));
    } catch (e: any) {
      flashMsg('err', e.message || 'Save failed');
    } finally {
      setLayoutSaving(false);
    }
  };
  const resetLayout = async () => {
    const ok = await confirmDialog({
      title: t('dashLayout.reset'),
      message: t('dashLayout.confirmReset'),
      confirmLabel: t('dashLayout.reset'),
      cancelLabel: t('dashLayout.cancel'),
      tone: 'warning',
    });
    if (!ok) return;
    setLayoutSaving(true);
    try {
      const userStr = localStorage.getItem('invoice_user');
      const token = userStr ? JSON.parse(userStr).token : null;
      const r = await fetch(`${API_URL}/dashboard/layout/reset`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const d = await r.json();
      if (!r.ok || !d.success) throw new Error(d.message || `HTTP ${r.status}`);
      const next: LayoutEntry[] = Array.isArray(d.layout) ? d.layout : DEFAULT_LAYOUT;
      setLayout(next);
      setSavedLayout(next);
      flashMsg('ok', t('dashLayout.resetOk'));
    } catch (e: any) {
      flashMsg('err', e.message || 'Reset failed');
    } finally {
      setLayoutSaving(false);
    }
  };
  const toggleVisible = (id: string) => {
    setLayout(prev => prev.map(e => e.id === id ? { ...e, visible: !e.visible } : e));
  };
  // ── Resize handlers (clamped). Width is the CSS-grid column span (1-12);
  //    height is a row multiplier (1-4) that translates to a min-height in px.
  const resizeWidth = (id: string, delta: number) => {
    setLayout(prev => prev.map(e => {
      if (e.id !== id) return e;
      const next = Math.max(1, Math.min(12, (e.cols || 12) + delta));
      return { ...e, cols: next };
    }));
  };
  const resizeHeight = (id: string, delta: number) => {
    setLayout(prev => prev.map(e => {
      if (e.id !== id) return e;
      const next = Math.max(1, Math.min(4, (e.rows || 1) + delta));
      return { ...e, rows: next };
    }));
  };

  // HTML5 drag-and-drop — onDragStart records which widget id we're moving;
  // onDragOver allows the drop and reorders live so the user sees movement
  // before they release; onDrop just clears the drag state.
  const handleDragStart = (id: string) => (e: React.DragEvent) => {
    setDragId(id);
    e.dataTransfer.effectAllowed = 'move';
    // Required by Firefox to actually start the drag.
    try { e.dataTransfer.setData('text/plain', id); } catch { /* */ }
  };
  const handleDragOver = (overId: string) => (e: React.DragEvent) => {
    e.preventDefault();
    if (!dragId || dragId === overId) return;
    setLayout(prev => {
      const fromIdx = prev.findIndex(x => x.id === dragId);
      const toIdx   = prev.findIndex(x => x.id === overId);
      if (fromIdx < 0 || toIdx < 0) return prev;
      const next = prev.slice();
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      return next;
    });
  };
  const handleDragEnd = () => setDragId(null);

  React.useEffect(() => {
    let isMounted = true;
    let pollTimer: NodeJS.Timeout;

    const fetchStats = async () => {
      try {
        const data = await apiService.getDashboardSummary(period);

        if (!isMounted) return;

        if (data.success) {
          setKpis(data.kpis);
          setChartData(data.chartData);
          setPieData(data.pieData);
          setIsSyncing(data.isSyncing || false);

          if (data.isSyncing && isMounted) {
            pollTimer = setTimeout(fetchStats, 2000);
          }
        } else {
          setError(data.message || 'Failed to load statistics');
        }
      } catch (err: any) {
        if (!isMounted) return;

        console.error(err);
        if (err.message === 'Unauthorized') {
          setError(t('dashboard.sessionExpired'));
          return;
        }
        setError(t('dashboard.connectionLost'));
        pollTimer = setTimeout(fetchStats, 5000);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };

    fetchStats();

    return () => {
      isMounted = false;
      clearTimeout(pollTimer);
    };
  }, [period]);

  const COLORS = ['#10b981', '#f43f5e', '#f59e0b', '#64748b', '#3b82f6'];

  const getIcon = (name: string) => {
    switch (name) {
      case 'FileCheck': return <FileCheck className="text-emerald-500" />;
      case 'CheckCircle': return <CheckCircle className="text-blue-500" />;
      case 'XCircle': return <XCircle className="text-rose-500" />;
      case 'AlertCircle': return <AlertCircle className="text-amber-500" />;
      case 'Send': return <Send className="text-indigo-500" />;
      case 'Download': return <Download className="text-green-500" />;
      case 'Upload': return <Upload className="text-purple-500" />;
      default: return <LayoutPanelLeft className="text-slate-500" />;
    }
  };

  const getChartTitle = () => {
    switch (period) {
      case 'today': return t('dashboard.volumeToday');
      case '30days': return t('dashboard.volume30');
      case '1year': return t('dashboard.volume1y');
      default: return t('dashboard.volume7');
    }
  };

  const getAccuracyPercentage = () => {
    const successItem = pieData.find(item => item.name === 'Success');
    return successItem ? successItem.value : 0;
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] gap-4">
        <div className="w-12 h-12 border-4 border-blue-100 border-t-blue-600 rounded-full animate-spin" />
        <p className="text-slate-400 font-bold uppercase tracking-widest text-xs">{t('dashboard.fetchingMetrics')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-slate-800 tracking-tight">{t('dashboard.heading')}</h1>
              {isSyncing && (
                <div className="flex items-center gap-2 bg-rose-50 border border-rose-200 px-3 py-1.5 rounded-full animate-pulse">
                  <div className="w-2 h-2 bg-rose-500 rounded-full animate-ping absolute"></div>
                  <div className="w-2 h-2 bg-rose-500 rounded-full"></div>
                  <span className="text-xs font-bold text-rose-700 uppercase tracking-wider">{t('dashboard.syncing')}</span>
                </div>
              )}
            </div>
            <p className="text-slate-500 text-sm">{t('dashboard.headingSubtitle')}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <select
            className="bg-white border border-gray-200 rounded-xl text-sm font-bold px-4 py-2 outline-none cursor-pointer hover:bg-gray-50 transition-all shadow-sm"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            disabled={editMode}
          >
            <option value="today">{t('dashboard.periodToday')}</option>
            <option value="7days">{t('dashboard.period7')}</option>
            <option value="30days">{t('dashboard.period30')}</option>
            <option value="1year">{t('dashboard.period1y')}</option>
          </select>

          {!editMode && (
            <button
              onClick={enterEdit}
              className="bg-white border border-gray-200 px-4 py-2 rounded-xl text-sm font-bold text-slate-700 hover:bg-gray-50 hover:border-blue-300 transition-all shadow-sm flex items-center gap-2"
            >
              <LayoutPanelLeft size={16} /> {t('dashLayout.editLayout')}
            </button>
          )}

          {editMode && (
            <div className="flex items-center gap-2">
              <button
                onClick={resetLayout}
                disabled={layoutSaving}
                className="bg-white border border-gray-200 px-3 py-2 rounded-xl text-xs font-bold text-slate-600 hover:bg-gray-50 transition-all shadow-sm flex items-center gap-1.5 disabled:opacity-50"
              >
                <RotateCcw size={14} /> {t('dashLayout.reset')}
              </button>
              <button
                onClick={cancelEdit}
                disabled={layoutSaving}
                className="bg-white border border-gray-200 px-3 py-2 rounded-xl text-xs font-bold text-slate-600 hover:bg-gray-50 transition-all shadow-sm flex items-center gap-1.5 disabled:opacity-50"
              >
                <X size={14} /> {t('dashLayout.cancel')}
              </button>
              <button
                onClick={saveLayout}
                disabled={layoutSaving}
                className="bg-blue-600 text-white px-4 py-2 rounded-xl text-xs font-bold hover:bg-blue-700 shadow-md transition-all flex items-center gap-1.5 disabled:opacity-50"
              >
                {layoutSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                {layoutSaving ? t('dashLayout.saving') : t('dashLayout.save')}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Edit-mode banner: explains what dragging does + flashes save status. */}
      {editMode && (
        <div className="flex items-center justify-between p-3 bg-blue-50/70 border border-blue-200 rounded-2xl text-sm">
          <div className="flex items-center gap-2 text-blue-800">
            <GripVertical size={16} className="text-blue-500" />
            <span className="font-bold">{t('dashLayout.editing')}</span>
            <span className="text-blue-600">— {t('dashLayout.dragHint')}</span>
          </div>
          {layoutMsg && layoutMsg.kind === 'ok' && (
            <span className="text-xs text-emerald-700 font-bold flex items-center gap-1.5"><CheckCircle2 size={12} /> {layoutMsg.text}</span>
          )}
          {layoutMsg && layoutMsg.kind === 'err' && (
            <span className="text-xs text-rose-700 font-bold flex items-center gap-1.5"><AlertCircle size={12} /> {layoutMsg.text}</span>
          )}
        </div>
      )}
      {/* Toast outside edit mode (shows the post-save success briefly). */}
      {!editMode && layoutMsg && layoutMsg.kind === 'ok' && (
        <div className="flex items-center gap-2 p-3 bg-emerald-50 border border-emerald-100 rounded-2xl text-emerald-700 text-sm font-bold">
          <CheckCircle2 size={16} /> {layoutMsg.text}
        </div>
      )}

      {error && (
        <div className="p-4 bg-rose-50 border border-rose-100 rounded-2xl text-rose-600 text-sm font-bold flex flex-col gap-2 animate-in fade-in slide-in-from-top-2">
          <div className="flex items-center gap-3">
            <AlertCircle size={20} />
            <span>{t('dashboard.etaSyncIssue')}: {error}</span>
          </div>
          {error.includes('authenticate') && (
            <p className="text-[10px] bg-white/50 p-2 rounded-lg ml-8 font-medium">
              {t('dashboard.etaCredsTip')}
            </p>
          )}
        </div>
      )}

      {/* Render widgets on a 12-column CSS grid. Each widget owns its own
          column-span (1-12) and a row multiplier (1-4) that maps to a
          minHeight; charts inside auto-fit because they all use a
          ResponsiveContainer. In edit mode every entry — visible AND hidden —
          gets a draggable wrapper with width/height +/- controls and a
          visibility eye. Widget id ↔ block mapping must stay in sync with
          WIDGET_CATALOGUE in dashboardLayoutRoutes.ts. */}
      {(() => {
        const labels = lang === 'ar' ? WIDGET_LABELS_AR : WIDGET_LABELS_EN;
        const widgetLabel = (id: string) => labels[id] || id;

        // Build the actual widget bodies once so we can reuse them between
        // the normal grid render and the edit-mode list render. Each body
        // is a self-contained card; the wrapper handles the grid placement.
        const renderBody = (id: string): React.ReactNode | null => {
          if (id === 'kpis') {
            return (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8 gap-4 h-full">
                {kpis.map((kpi, i) => (
                  <div key={i} className="soft-card p-5 flex flex-col gap-3 group">
                    <div className="flex items-center justify-between">
                      <div className="p-2.5 bg-gray-50 rounded-2xl group-hover:scale-110 transition-transform">{getIcon(kpi.icon)}</div>
                      <div className={`flex items-center gap-1 text-[10px] font-black ${kpi.trend > 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                        {kpi.trend > 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                        {Math.abs(kpi.trend)}%
                      </div>
                    </div>
                    <div>
                      <p className="text-slate-400 text-[10px] font-black uppercase tracking-widest leading-none mb-1">{kpi.label}</p>
                      <h3 className="text-2xl font-black text-slate-800">{kpi.value}</h3>
                    </div>
                  </div>
                ))}
              </div>
            );
          }
          if (id === 'invoiceVolume') {
            return (
              <div className="bg-white p-8 rounded-[32px] shadow-sm border border-gray-100 h-full flex flex-col">
                <div className="flex items-center justify-between mb-10">
                  <h3 className="font-bold text-slate-800 flex items-center gap-2 text-lg">
                    <TrendingUp size={20} className="text-blue-600" /> {getChartTitle()}
                  </h3>
                </div>
                <div className="flex-1 min-h-[300px]">
                  <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                    <AreaChart data={chartData}>
                      <defs>
                        <linearGradient id="colorCount" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.15} />
                          <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                      <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 11, fontWeight: 'bold' }} />
                      <YAxis axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 11, fontWeight: 'bold' }} />
                      <Tooltip
                        contentStyle={{ backgroundColor: '#1e293b', borderRadius: '16px', border: 'none', color: '#fff' }}
                        itemStyle={{ fontWeight: 'bold', fontSize: '12px' }}
                      />
                      <Area type="monotone" dataKey="count" stroke="#3b82f6" strokeWidth={3} fillOpacity={1} fill="url(#colorCount)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
            );
          }
          if (id === 'statusDist') {
            return (
              <div className="bg-white p-8 rounded-[32px] shadow-sm border border-gray-100 h-full flex flex-col">
                <div className="flex items-center justify-between mb-10">
                  <h3 className="font-bold text-slate-800 text-lg flex items-center gap-2">
                    <CheckCircle size={20} className="text-emerald-500" /> {t('dashboard.statusDist')}
                  </h3>
                </div>
                <div className="h-[250px] relative">
                  <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                    <PieChart>
                      <Pie data={pieData} cx="50%" cy="50%" innerRadius={65} outerRadius={85} paddingAngle={8} dataKey="value" stroke="none">
                        {pieData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color || COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                    <span className="text-3xl font-black text-slate-800">{pieData.find(d => d.name === 'Valid')?.value || 0}%</span>
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{t('dashboard.accuracy')}</span>
                  </div>
                </div>
                <div className="space-y-4 mt-6 overflow-auto">
                  {pieData.map((item, idx) => (
                    <div key={idx} className="flex items-center justify-between text-sm p-3 bg-gray-50 rounded-2xl hover:bg-blue-50 transition-colors">
                      <div className="flex items-center gap-3">
                        <div className="w-3 h-3 rounded-full shadow-sm" style={{ backgroundColor: item.color || COLORS[idx] }} />
                        <span className="text-slate-600 font-bold">{item.name}</span>
                      </div>
                      <span className="font-black text-slate-900">{item.value}%</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          }
          if (id === 'vatPayable')     return <VatPayableWidget />;
          if (id === 'alerts')         return <AlertsWidget />;
          if (id === 'topCustomers')   return <TopCustomersWidget />;
          if (id === 'reconciliation') return <ReconciliationWidget />;
          if (id === 'signingQueue')   return <SigningQueueWidget />;
          return null;
        };

        // Resolve a layout entry's grid-column class + min-height. Defensive
        // about missing values from old saved layouts (treat as full-width
        // span-12, content-driven height).
        const resolvePlacement = (entry: LayoutEntry) => {
          const cols = entry.cols && entry.cols >= 1 && entry.cols <= 12 ? entry.cols : 12;
          const rows = entry.rows && entry.rows >= 1 && entry.rows <= 4  ? entry.rows : 1;
          return {
            colSpanClass: COL_SPAN_CLASS[cols] || 'lg:col-span-12',
            minHeight:    ROW_HEIGHT_PX[rows],   // undefined for rows=1 (auto)
          };
        };

        // Edit-mode chrome wrapper: drag handle + index chip + size controls
        // + eye toggle. The card itself is `draggable`; the GripVertical icon
        // is just an affordance.
        const editWrap = (entry: LayoutEntry, idx: number, body: React.ReactNode) => {
          const { colSpanClass, minHeight } = resolvePlacement(entry);
          const cols = entry.cols ?? 12;
          const rows = entry.rows ?? 1;
          return (
            <div
              key={entry.id}
              draggable
              onDragStart={handleDragStart(entry.id)}
              onDragOver={handleDragOver(entry.id)}
              onDragEnd={handleDragEnd}
              onDrop={handleDragEnd}
              style={{ minHeight }}
              className={`col-span-12 ${colSpanClass} relative rounded-[28px] border-2 border-dashed transition-all flex flex-col ${
                dragId === entry.id
                  ? 'border-blue-500 bg-blue-50/40 opacity-50'
                  : 'border-blue-200 hover:border-blue-400'
              } ${entry.visible ? '' : 'opacity-50'}`}
            >
              {/* Toolbar — drag handle + label on the left, size +/- + eye
                  on the right. e.stopPropagation on each button so clicks
                  don't kick off a drag. */}
              <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-blue-100 bg-blue-50/60 rounded-t-[26px] flex-wrap">
                <div className="flex items-center gap-2 text-blue-700 min-w-0">
                  <GripVertical size={16} className="cursor-grab active:cursor-grabbing shrink-0" />
                  <span className="text-[10px] font-mono font-bold text-blue-500 shrink-0">#{idx + 1}</span>
                  <span className="text-xs font-bold truncate">{widgetLabel(entry.id)}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  {/* Width control */}
                  <div className="flex items-center gap-1 bg-white border border-blue-100 rounded-lg px-1.5 py-0.5 text-[10px] font-bold text-blue-700">
                    <span className="text-[9px] uppercase tracking-wider text-blue-400">W</span>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); resizeWidth(entry.id, -1); }}
                      onDragStart={(e) => e.preventDefault()}
                      disabled={cols <= 1}
                      title="Decrease width"
                      className="p-0.5 hover:bg-blue-50 rounded disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      <Minus size={12} />
                    </button>
                    <span className="w-5 text-center font-mono">{cols}</span>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); resizeWidth(entry.id, +1); }}
                      onDragStart={(e) => e.preventDefault()}
                      disabled={cols >= 12}
                      title="Increase width"
                      className="p-0.5 hover:bg-blue-50 rounded disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      <Plus size={12} />
                    </button>
                  </div>
                  {/* Height control */}
                  <div className="flex items-center gap-1 bg-white border border-blue-100 rounded-lg px-1.5 py-0.5 text-[10px] font-bold text-blue-700">
                    <span className="text-[9px] uppercase tracking-wider text-blue-400">H</span>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); resizeHeight(entry.id, -1); }}
                      onDragStart={(e) => e.preventDefault()}
                      disabled={rows <= 1}
                      title="Decrease height"
                      className="p-0.5 hover:bg-blue-50 rounded disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      <Minus size={12} />
                    </button>
                    <span className="w-5 text-center font-mono">{rows}</span>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); resizeHeight(entry.id, +1); }}
                      onDragStart={(e) => e.preventDefault()}
                      disabled={rows >= 4}
                      title="Increase height"
                      className="p-0.5 hover:bg-blue-50 rounded disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      <Plus size={12} />
                    </button>
                  </div>
                  {/* Visibility */}
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); toggleVisible(entry.id); }}
                    onDragStart={(e) => e.preventDefault()}
                    title={entry.visible ? t('dashLayout.hide') : t('dashLayout.show')}
                    className={`p-1.5 rounded-lg transition-colors ${
                      entry.visible ? 'text-emerald-600 hover:bg-emerald-50' : 'text-slate-400 hover:bg-slate-100'
                    }`}
                  >
                    {entry.visible ? <Eye size={14} /> : <EyeOff size={14} />}
                  </button>
                </div>
              </div>
              {/* Body fills the remaining height. When the user pushed rows
                  up the card grows and charts auto-stretch. */}
              <div className={`flex-1 min-h-0 ${entry.visible ? '' : 'pointer-events-none'}`}>
                {body}
              </div>
            </div>
          );
        };

        // ── Edit mode: render every entry (visible + hidden) on the 12-col
        //    grid. The whole grid is one giant flex/grid container so users
        //    see the actual widget sizes while they're editing.
        if (editMode) {
          return (
            <div className="grid grid-cols-12 gap-6 auto-rows-min">
              {layout.map((entry, idx) => {
                const body = renderBody(entry.id);
                if (!body) return null;
                return editWrap(entry, idx, body);
              })}
            </div>
          );
        }

        // ── Normal mode: only visible widgets, on the same 12-col grid, no
        //    edit chrome. Each widget honors its saved cols/rows. Mobile
        //    stacks everything full-width.
        return (
          <div className="grid grid-cols-12 gap-6 auto-rows-min">
            {layout.filter(e => e.visible).map(entry => {
              const body = renderBody(entry.id);
              if (!body) return null;
              const { colSpanClass, minHeight } = resolvePlacement(entry);
              return (
                <div
                  key={entry.id}
                  className={`col-span-12 ${colSpanClass} flex flex-col`}
                  style={{ minHeight }}
                >
                  {body}
                </div>
              );
            })}
          </div>
        );
      })()}
    </div>
  );
};

export default Dashboard;
