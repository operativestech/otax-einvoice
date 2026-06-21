
import React, { useState, useEffect, useCallback } from 'react';
import { Download, FileSpreadsheet, Calendar, Filter, ArrowUpDown, Loader2, Search, ChevronLeft, ChevronRight, TrendingUp, BarChart3, PieChart, DollarSign, GitCompare, AlertTriangle, ArrowUp, ArrowDown, Copy, ArrowLeft, Layers, ChevronDown as ChevronDownIcon, Users, Package, XOctagon, Activity, Clock, Receipt, Archive as ArchiveIcon, Sparkles, ShieldAlert } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { API_URL } from '../services/apiService';
import { exportExcel as exportSheets, num as numExp } from '../utils/export';
import { useTranslation } from '../i18n';
import { alertDialog } from '../components/ConfirmDialog';

interface Invoice {
  uuid: string;
  internalId: string;
  typeName: string;
  typeVersionName: string;
  status: string;
  direction: string;
  dateTimeIssued: string;
  dateTimeReceived: string;
  issuerId: string;
  issuerName: string;
  receiverId: string;
  receiverName: string;
  totalSales: number;
  totalDiscount: number;
  netAmount: number;
  total: number;
  currency: string;
  environment: string;
}

interface TaxBreakdownItem {
  taxType: string;
  subType: string;
  doc_count: number;
  line_count: number;
  avg_rate: number;
  total_amount: number;
}

interface TaxSummary {
  total_docs: number;
  total_sales: number;
  total_discount: number;
  total_net: number;
  total_amount: number;
  total_tax: number;
  sent_count: number;
  received_count: number;
  sent_total: number;
  received_total: number;
}

interface DuplicateGroup {
  internalId: string;
  totalCount?: number;   // total rows regardless of status (mode='all')
  validCount: number;    // rows with status='Valid'
  totalAmount: number;
  invoices: Array<{
    internalId: string;
    uuid: string;
    dateTimeIssued: string;
    receiverName: string | null;
    receiverId: string | null;
    totalSales: number;
    total: number;
    status: string;
    direction: string;
  }>;
}

type DupMode = 'all' | 'valid';

const getAuthHeaders = (): Record<string, string> => {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const userStr = localStorage.getItem('invoice_user');
  if (userStr) {
    try {
      const user = JSON.parse(userStr);
      if (user.token) headers['Authorization'] = `Bearer ${user.token}`;
      if (user.id) headers['X-User-ID'] = String(user.id);
    } catch (e) { /* */ }
  }
  return headers;
};

const STATUS_OPTIONS = ['All', 'Valid', 'Invalid', 'Rejected', 'Cancelled', 'Submitted'];
const DIRECTION_OPTIONS = ['All', 'Sent', 'Received'];
const ROWS_PER_PAGE = 25;

const statusColors: Record<string, string> = {
  Valid: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  Invalid: 'bg-red-50 text-red-700 border-red-200',
  Rejected: 'bg-amber-50 text-amber-700 border-amber-200',
  Cancelled: 'bg-slate-100 text-slate-600 border-slate-200',
  Submitted: 'bg-blue-50 text-blue-700 border-blue-200',
};

// ETA Tax Type labels
const TAX_TYPE_LABELS: Record<string, string> = {
  T1: 'Value added tax / ضريبة القيمة المضافة',
  T2: 'Table tax (percentage) / ضريبة الجدول (نسبية)',
  T3: 'Table tax (fixed) / ضريبة الجدول (قطعية)',
  T4: 'Withholding tax (WHT) / ضريبة الخصم والتحصيل',
  T5: 'Stamping tax (percentage) / ضريبة دمغة نسبية',
  T6: 'Stamping tax (amount) / ضريبة دمغة مقطوعة',
  T7: 'Entertainment tax / رسم تنمية',
  T8: 'Medical insurance / تأمين صحي',
  T9: 'Resource development fee / رسم تنمية الموارد',
  T10: 'Municipality fees / رسوم المحليات',
  T11: 'Service charge / رسوم الخدمة',
  T12: 'Other / ضرائب أخرى',
};

const Reports: React.FC = () => {
  const { t } = useTranslation();
  // Filter state
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [direction, setDirection] = useState('All');
  const [status, setStatus] = useState('All');

  // Data state
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [taxBreakdown, setTaxBreakdown] = useState<TaxBreakdownItem[]>([]);
  const [taxSummary, setTaxSummary] = useState<TaxSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [hasSearched, setHasSearched] = useState(false);
  const [activeTab, setActiveTab] = useState<'invoices' | 'tax' | 'gap' | 'stats'>('invoices');

  // Gap Analysis state
  const [gapData, setGapData] = useState<{ months: any[]; totals: any } | null>(null);

  // Statistics state
  const [statsData, setStatsData] = useState<any>(null);

  // ── Report selector: 'menu' lands on the report picker. Each other value
  //    opens a dedicated report view, each with its own date-range filter +
  //    generate button + Excel export. All of them hit per-org endpoints.
  const [reportView, setReportView] = useState<
    | 'menu'           // landing — categorized tile grid
    | 'main'           // existing invoices + gap + stats
    | 'duplicates'     // existing duplicate report
    | 'vat'            // VAT Return Summary (Input / Output / Net)
    | 'customers'      // Top Customers
    | 'products'       // Top Products / Items
    | 'rejected'       // Rejected / Invalid invoices + reasons
    | 'trends'         // Time trends (revenue + tax over months)
    | 'activity'       // Tax by taxpayer activity code
    | 'late'           // Late submissions (issue → submission lag)
    | 'archive'        // Bulk ZIP download of invoices in a date range
    | 'forecast'       // Linear-regression VAT forecast for next month
    | 'anomalies'      // Statistical anomaly detection on invoice amounts
  >('menu');

  // ── Forecast + Anomaly state ──
  const [forecastData, setForecastData]  = useState<any | null>(null);
  const [anomalyData, setAnomalyData]    = useState<any | null>(null);
  const [anomalyLookback, setAnomalyLookback] = useState<number>(30);

  // ── Archive ZIP state ──
  const [archiveDirection, setArchiveDirection] = useState<'All' | 'Sent' | 'Received'>('All');
  const [archiveStatus, setArchiveStatus] = useState<string>('All');
  const [archiving, setArchiving] = useState(false);
  const [archiveMsg, setArchiveMsg] = useState<string | null>(null);

  // ── State per new report. Kept separate so we don't re-fetch when switching back. ──
  const [vatData, setVatData] = useState<{ rows: any[]; totals: any } | null>(null);
  const [customersData, setCustomersData] = useState<any[] | null>(null);
  const [productsData, setProductsData] = useState<any[] | null>(null);
  const [rejectedData, setRejectedData] = useState<{ rows: any[]; grouped: boolean } | null>(null);
  const [rejectedMode, setRejectedMode] = useState<'grouped' | 'list'>('grouped');
  const [trendsData, setTrendsData] = useState<any[] | null>(null);
  const [activityData, setActivityData] = useState<any[] | null>(null);
  const [lateData, setLateData] = useState<{ rows: any[]; thresholdHours: number } | null>(null);
  const [lateThreshold, setLateThreshold] = useState(48);
  const [loadingReport, setLoadingReport] = useState<string | null>(null);
  const [reportError, setReportError] = useState<string | null>(null);

  // ── Duplication report state ──
  const [dupData, setDupData] = useState<DuplicateGroup[] | null>(null);
  const [dupLoading, setDupLoading] = useState(false);
  const [dupError, setDupError] = useState<string | null>(null);
  const [expandedDupId, setExpandedDupId] = useState<string | null>(null);
  // 'all'   → every internalId that repeats (any status)
  // 'valid' → only groups where all rows are Valid
  const [dupMode, setDupMode] = useState<DupMode>('valid');

  const fetchDuplicates = useCallback(async () => {
    setDupLoading(true);
    setDupError(null);
    try {
      const qs = new URLSearchParams();
      if (dateFrom) qs.set('dateFrom', dateFrom);
      if (dateTo) qs.set('dateTo', dateTo);
      qs.set('mode', dupMode);
      const res = await fetch(`${API_URL}/reports/duplicates?${qs.toString()}`, { headers: getAuthHeaders() });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || `HTTP ${res.status}`);
      setDupData(data.rows || []);
    } catch (e: any) {
      setDupError(e.message);
    } finally {
      setDupLoading(false);
    }
  }, [dateFrom, dateTo, dupMode]);

  const exportDuplicates = async () => {
    if (!dupData || dupData.length === 0) {
      await alertDialog({ title: 'Nothing to export', message: 'No duplicate invoices to export. Click Generate first.', tone: 'info' });
      return;
    }

    // Sheet 1 — one row per duplicated Internal ID (summary)
    const summaryRows = dupData.map(g => ({
      'Internal ID (الرقم الداخلي)': g.internalId,
      'Total Count (إجمالي التكرار)': g.totalCount ?? g.validCount,
      'Valid Count (عدد الـ Valid)': g.validCount,
      'Total Amount (الإجمالي)': Number(g.totalAmount || 0),
    }));

    // Sheet 2 — one row per invoice (full detail)
    const detailRows: any[] = [];
    for (const g of dupData) {
      for (const inv of g.invoices) {
        detailRows.push({
          'Internal ID (الرقم الداخلي)': g.internalId,
          'Total Count': g.totalCount ?? g.validCount,
          'Valid Count': g.validCount,
          'UUID': inv.uuid,
          'Date Issued (تاريخ الإصدار)': formatDate(inv.dateTimeIssued),
          'Direction (الاتجاه)': inv.direction,
          'Receiver (المستلم)': inv.receiverName || inv.receiverId || '—',
          'Total Sales (إجمالي المبيعات)': Number(inv.totalSales || 0),
          'Total (الإجمالي)': Number(inv.total || 0),
          'Status (الحالة)': inv.status,
        });
      }
    }

    try {
      exportSheets('Duplicate-Invoices', [
        { name: 'Summary', rows: summaryRows },
        { name: 'Details', rows: detailRows },
      ]);
    } catch (e: any) {
      await alertDialog({ title: 'Export failed', message: 'Export failed: ' + e.message, tone: 'danger' });
    }
  };

  // ═══════════════════════════════════════════════════════════════════════
  // Shared fetch helper for the new reports. Every report accepts the same
  // dateFrom/dateTo + optional extras (e.g. thresholdHours for late-submissions).
  // ═══════════════════════════════════════════════════════════════════════

  async function fetchReportEndpoint<T = any>(path: string, extras?: Record<string, string>): Promise<T> {
    const qs = new URLSearchParams();
    if (dateFrom) qs.set('dateFrom', dateFrom);
    if (dateTo)   qs.set('dateTo', dateTo);
    if (extras)   Object.entries(extras).forEach(([k, v]) => qs.set(k, v));
    const res = await fetch(`${API_URL}/reports/${path}?${qs.toString()}`, { headers: getAuthHeaders() });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.message || `HTTP ${res.status}`);
    return data as T;
  }

  const runReport = async (id: string, fn: () => Promise<void>) => {
    setLoadingReport(id);
    setReportError(null);
    try { await fn(); } catch (e: any) { setReportError(e.message || String(e)); }
    finally { setLoadingReport(null); }
  };

  const loadVAT      = () => runReport('vat',       async () => setVatData((await fetchReportEndpoint('vat-summary')) as any));
  const loadCustomers= () => runReport('customers', async () => setCustomersData(((await fetchReportEndpoint('top-customers')) as any).rows));
  const loadProducts = () => runReport('products',  async () => setProductsData(((await fetchReportEndpoint('top-products')) as any).rows));
  const loadTrends   = () => runReport('trends',    async () => setTrendsData(((await fetchReportEndpoint('trends')) as any).rows));
  const loadActivity = () => runReport('activity',  async () => setActivityData(((await fetchReportEndpoint('by-activity')) as any).rows));
  const loadRejected = () => runReport('rejected',  async () => {
    const data: any = await fetchReportEndpoint('rejected', { grouped: String(rejectedMode === 'grouped') });
    setRejectedData({ rows: data.rows, grouped: !!data.grouped });
  });
  const loadLate     = () => runReport('late',      async () => {
    const data: any = await fetchReportEndpoint('late-submissions', { thresholdHours: String(lateThreshold) });
    setLateData({ rows: data.rows, thresholdHours: data.thresholdHours });
  });

  const loadForecast = () => runReport('forecast',  async () => setForecastData(await fetchReportEndpoint('forecast')));
  const loadAnomalies = () => runReport('anomalies', async () => setAnomalyData(await fetchReportEndpoint('anomalies', { lookbackDays: String(anomalyLookback) })));

  /** Download the archive ZIP via a streaming fetch + blob save-as.
   *  We avoid `window.open` because we need auth headers on the request. */
  const downloadArchive = async () => {
    setArchiving(true);
    setArchiveMsg(null);
    try {
      const qs = new URLSearchParams();
      if (dateFrom) qs.set('dateFrom', dateFrom);
      if (dateTo)   qs.set('dateTo', dateTo);
      if (archiveDirection !== 'All') qs.set('direction', archiveDirection);
      if (archiveStatus    !== 'All') qs.set('status',    archiveStatus);

      const res = await fetch(`${API_URL}/reports/archive?${qs.toString()}`, { headers: getAuthHeaders() });
      if (!res.ok) {
        // Error responses are JSON (not ZIP) — bubble up the message.
        const maybeJson = await res.json().catch(() => null);
        throw new Error(maybeJson?.message || `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const stamp = new Date().toISOString().slice(0, 10);
      a.download = `OTax-Archive-${stamp}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setArchiveMsg('✅ Archive downloaded. Check your browser downloads.');
    } catch (e: any) {
      setArchiveMsg('❌ ' + (e.message || String(e)));
    } finally {
      setArchiving(false);
    }
  };

  // ── Shared Excel exporters for each new report ──
  const exportVAT = () => {
    if (!vatData) return;
    const rows = vatData.rows.map(r => ({
      'Month': r.month,
      'Output VAT Base (Sent Net)':   Number(r.outputBase || 0),
      'Output VAT (Collected)':       Number(r.outputVat || 0),
      'Input VAT Base (Received Net)': Number(r.inputBase || 0),
      'Input VAT (Paid)':              Number(r.inputVat || 0),
      'Net VAT Payable':               Number(r.netPayable || 0),
      'Sent #': r.sentCount, 'Received #': r.receivedCount,
    }));
    const totalsRow = {
      'Month': 'TOTAL',
      'Output VAT Base (Sent Net)':    vatData.totals?.outputBase || 0,
      'Output VAT (Collected)':        vatData.totals?.outputVat || 0,
      'Input VAT Base (Received Net)': vatData.totals?.inputBase || 0,
      'Input VAT (Paid)':              vatData.totals?.inputVat || 0,
      'Net VAT Payable':               vatData.totals?.netPayable || 0,
      'Sent #': vatData.totals?.sentCount, 'Received #': vatData.totals?.receivedCount,
    };
    exportSheets('VAT-Return-Summary', [{ name: 'VAT Summary', rows: [...rows, totalsRow] }]);
  };

  const exportCustomers = () => {
    if (!customersData) return;
    exportSheets('Top-Customers', [{
      name: 'Top Customers',
      rows: customersData.map((c, i) => ({
        'Rank': i + 1,
        'Customer Name': c.receiverName || '—',
        'Tax ID': c.receiverId,
        'Invoice Count': Number(c.count),
        'Total (EGP)': Number(c.total_amount),
        'Avg (EGP)': Number(c.avg_amount),
        'First Seen': c.first_seen ? formatDate(c.first_seen) : '',
        'Last Seen':  c.last_seen  ? formatDate(c.last_seen)  : '',
      })),
    }]);
  };

  const exportProducts = () => {
    if (!productsData) return;
    exportSheets('Top-Products', [{
      name: 'Top Products',
      rows: productsData.map((p, i) => ({
        'Rank': i + 1,
        'Item Code': p.itemCode,
        'Description': p.description || '—',
        'Item Type': p.item_type || '',
        'Line Count': Number(p.line_count),
        'Invoices': Number(p.invoice_count),
        'Total Qty': Number(p.total_qty),
        'Net Revenue (EGP)': Number(p.total_net),
        'Total (EGP)': Number(p.total_amount),
      })),
    }]);
  };

  const exportRejected = () => {
    if (!rejectedData) return;
    if (rejectedData.grouped) {
      exportSheets('Rejected-Reasons', [{
        name: 'Top Reasons',
        rows: rejectedData.rows.map((r, i) => ({
          'Rank': i + 1,
          'Rejection Reason': r.reason,
          'Count': Number(r.count),
          'Total Amount (EGP)': Number(r.total_amount),
        })),
      }]);
    } else {
      exportSheets('Rejected-Invoices', [{
        name: 'Rejected Invoices',
        rows: rejectedData.rows.map(r => ({
          'UUID': r.uuid,
          'Internal ID': r.internalId,
          'Direction': r.direction,
          'Date Issued': r.dateTimeIssued ? formatDate(r.dateTimeIssued) : '',
          'Date Received': r.dateTimeReceived ? formatDate(r.dateTimeReceived) : '',
          'Receiver': r.receiverName || r.receiverId,
          'Status': r.status,
          'Total (EGP)': Number(r.total || 0),
          'Reason': r.rejectionReasons || r.documentStatusReason || '',
        })),
      }]);
    }
  };

  const exportTrends = () => {
    if (!trendsData) return;
    exportSheets('Time-Trends', [{
      name: 'Monthly Trends',
      rows: trendsData.map(r => ({
        'Month': r.month,
        'Sent Revenue (EGP)':     Number(r.sent_revenue     || 0),
        'Received Revenue (EGP)': Number(r.received_revenue || 0),
        'Sent Tax (EGP)':         Number(r.sent_tax         || 0),
        'Received Tax (EGP)':     Number(r.received_tax     || 0),
        'Sent Count':     Number(r.sent_count     || 0),
        'Received Count': Number(r.received_count || 0),
      })),
    }]);
  };

  const exportActivity = () => {
    if (!activityData) return;
    exportSheets('Tax-By-Activity', [{
      name: 'Tax by Activity',
      rows: activityData.map((a, i) => ({
        'Rank': i + 1,
        'Activity Code': a.activity_code,
        'Invoice Count': Number(a.count),
        'Total Amount (EGP)': Number(a.total_amount),
        'Total Tax (EGP)': Number(a.total_tax),
      })),
    }]);
  };

  const exportLate = () => {
    if (!lateData) return;
    exportSheets('Late-Submissions', [{
      name: 'Late Submissions',
      rows: lateData.rows.map(r => ({
        'Internal ID': r.internalId,
        'UUID': r.uuid,
        'Date Issued':   r.dateTimeIssued   ? formatDate(r.dateTimeIssued)   : '',
        'Date Received': r.dateTimeReceived ? formatDate(r.dateTimeReceived) : '',
        'Lag (hours)': Number(r.lag_hours || 0).toFixed(1),
        'Lag (days)':  (Number(r.lag_hours || 0) / 24).toFixed(2),
        'Receiver': r.receiverName || '',
        'Total (EGP)': Number(r.total || 0),
        'Status': r.status,
      })),
    }]);
  };

  // Exports for the two newer tabs — reuses shared utility so column widths auto-size.
  const exportGapAnalysis = () => {
    if (!gapData) return;
    const monthRows = (gapData.months || []).map((m: any) => ({
      'Month': m.month || '',
      'ERP Count': numExp(m.erp_count),
      'ETA Count': numExp(m.eta_count),
      'Gap (ERP − ETA)': numExp((m.erp_count || 0) - (m.eta_count || 0)),
      'ERP Amount': numExp(m.erp_amount),
      'ETA Amount': numExp(m.eta_amount),
      'Amount Gap': numExp((m.erp_amount || 0) - (m.eta_amount || 0)),
    }));
    const totalsRow: Record<string, any> = { Metric: 'Totals' };
    if (gapData.totals) {
      totalsRow['ERP Count'] = numExp((gapData.totals as any).erp_count);
      totalsRow['ETA Count'] = numExp((gapData.totals as any).eta_count);
      totalsRow['ERP Amount'] = numExp((gapData.totals as any).erp_amount);
      totalsRow['ETA Amount'] = numExp((gapData.totals as any).eta_amount);
    }
    exportSheets('Gap-Analysis', [
      { name: 'Monthly Gap', rows: monthRows },
      { name: 'Totals', rows: [totalsRow] },
    ]);
  };

  const exportStatistics = () => {
    if (!statsData) return;
    const sheets: Array<{ name: string; rows: any[] }> = [];
    // Flexible: whatever keys the API returns (byStatus, byMonth, topCustomers, etc.)
    for (const [key, val] of Object.entries(statsData)) {
      if (Array.isArray(val) && val.length > 0 && typeof val[0] === 'object') {
        sheets.push({ name: key, rows: val as any[] });
      }
    }
    if (sheets.length === 0) sheets.push({ name: 'Statistics', rows: [statsData] });
    exportSheets('Statistics', sheets);
  };

  // Set default dates: last 30 days
  useEffect(() => {
    const today = new Date();
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(today.getDate() - 30);
    setDateTo(today.toISOString().split('T')[0]);
    setDateFrom(thirtyDaysAgo.toISOString().split('T')[0]);
  }, []);

  const buildParams = useCallback(() => {
    const params = new URLSearchParams();
    if (dateFrom) params.set('dateFrom', dateFrom);
    if (dateTo) params.set('dateTo', dateTo);
    if (direction !== 'All') params.set('direction', direction);
    if (status !== 'All') params.set('status', status);
    return params.toString();
  }, [dateFrom, dateTo, direction, status]);

  const fetchReport = useCallback(async () => {
    setLoading(true);
    setError('');
    setPage(1);
    try {
      const qs = buildParams();
      const headers = getAuthHeaders();

      // Fetch invoices, tax summary, and gap analysis in parallel
      const [invoicesRes, taxRes, gapRes] = await Promise.all([
        fetch(`${API_URL}/reports/invoices?${qs}`, { headers }),
        fetch(`${API_URL}/reports/tax-summary?${qs}`, { headers }),
        fetch(`${API_URL}/reports/gap-analysis?${qs}`, { headers }),
      ]);

      if (!invoicesRes.ok) throw new Error('Failed to fetch invoices');
      const invoicesData = await invoicesRes.json();
      setInvoices(invoicesData.invoices || []);

      if (taxRes.ok) {
        const taxData = await taxRes.json();
        setTaxBreakdown(taxData.taxBreakdown || []);
        setTaxSummary(taxData.summary || null);
      }

      if (gapRes.ok) {
        const gapResult = await gapRes.json();
        setGapData({ months: gapResult.months || [], totals: gapResult.totals || {} });
      }

      // Fetch statistics
      try {
        const statsRes = await fetch(`${API_URL}/reports/statistics?${qs}`, { headers });
        if (statsRes.ok) {
          const statsResult = await statsRes.json();
          setStatsData(statsResult.stats || null);
        }
      } catch (e) { /* */ }

      setHasSearched(true);
    } catch (err: any) {
      setError(err.message || 'Failed to load report');
      setInvoices([]);
    } finally {
      setLoading(false);
    }
  }, [buildParams]);

  const formatDate = (d: string) => {
    if (!d) return '—';
    try { return new Date(d).toLocaleDateString('en-GB'); }
    catch { return d; }
  };

  const formatAmount = (n: number) => {
    if (n === undefined || n === null) return '0.00';
    return Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const getTypeName = (t: string) => {
    if (!t) return 'Invoice';
    const upper = t.toUpperCase();
    if (upper.includes('CREDIT') || upper.startsWith('C')) return 'Credit Note';
    if (upper.includes('DEBIT') || upper.startsWith('D')) return 'Debit Note';
    return 'Invoice';
  };

  // ── Excel Export ──
  const exportToExcel = async () => {
    if (invoices.length === 0) return;
    setExporting(true);

    try {
      // @ts-ignore — dynamic CDN import works at runtime
      const XLSX = await import(/* @vite-ignore */ 'https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs');

      // Sheet 1: Invoices
      const invRows = invoices.map((inv, idx) => ({
        '#': idx + 1,
        'UUID / الرقم الموحد': inv.uuid || '',
        'Internal ID / الرقم الداخلي': inv.internalId || '',
        'Type / النوع': getTypeName(inv.typeName),
        'Version / الإصدار': inv.typeVersionName || '1.0',
        'Status / الحالة': inv.status || '',
        'Direction / الاتجاه': inv.direction || '',
        'Date Issued / تاريخ الإصدار': formatDate(inv.dateTimeIssued),
        'Date Received / تاريخ الاستلام': formatDate(inv.dateTimeReceived),
        'Issuer Name / اسم الراسل': inv.issuerName || '',
        'Issuer ID / رقم تسجيل الراسل': inv.issuerId || '',
        'Receiver Name / اسم المستلم': inv.receiverName || '',
        'Receiver ID / رقم تسجيل المستلم': inv.receiverId || '',
        'Total Sales / إجمالي المبيعات': Number(inv.totalSales || 0),
        'Discount / الخصم': Number(inv.totalDiscount || 0),
        'Net Amount / صافي المبلغ': Number(inv.netAmount || 0),
        'Total / الإجمالي': Number(inv.total || 0),
      }));

      const ws1 = XLSX.utils.json_to_sheet(invRows);
      ws1['!cols'] = Object.keys(invRows[0] || {}).map(key => ({ wch: Math.max(key.length, 15) }));

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws1, 'Invoices');

      // Sheet 2: Tax Summary
      if (taxSummary) {
        const summaryRows = [
          { 'Metric / البيان': 'Total Documents / إجمالي المستندات', 'Value / القيمة': Number(taxSummary.total_docs || 0) },
          { 'Metric / البيان': 'Total Sales / إجمالي المبيعات', 'Value / القيمة': Number(taxSummary.total_sales || 0) },
          { 'Metric / البيان': 'Total Discount / إجمالي الخصم', 'Value / القيمة': Number(taxSummary.total_discount || 0) },
          { 'Metric / البيان': 'Net Amount / صافي المبلغ', 'Value / القيمة': Number(taxSummary.total_net || 0) },
          { 'Metric / البيان': 'Total Tax / إجمالي الضرائب', 'Value / القيمة': Number(taxSummary.total_tax || 0) },
          { 'Metric / البيان': 'Total Amount / الإجمالي', 'Value / القيمة': Number(taxSummary.total_amount || 0) },
          { 'Metric / البيان': '', 'Value / القيمة': '' },
          { 'Metric / البيان': 'Sent Count / عدد المبعوثة', 'Value / القيمة': Number(taxSummary.sent_count || 0) },
          { 'Metric / البيان': 'Sent Total / إجمالي المبعوثة', 'Value / القيمة': Number(taxSummary.sent_total || 0) },
          { 'Metric / البيان': 'Received Count / عدد المستلمة', 'Value / القيمة': Number(taxSummary.received_count || 0) },
          { 'Metric / البيان': 'Received Total / إجمالي المستلمة', 'Value / القيمة': Number(taxSummary.received_total || 0) },
        ];
        const ws2 = XLSX.utils.json_to_sheet(summaryRows);
        ws2['!cols'] = [{ wch: 40 }, { wch: 20 }];
        XLSX.utils.book_append_sheet(wb, ws2, 'Summary');
      }

      // Sheet 3: Tax Breakdown (if available)
      if (taxBreakdown.length > 0) {
        const taxRows = taxBreakdown.map(t => ({
          'Tax Type / نوع الضريبة': `${t.taxType} — ${TAX_TYPE_LABELS[t.taxType] || t.taxType}`,
          'Sub Type / الفئة': t.subType || '—',
          'Avg Rate / متوسط النسبة': `${t.avg_rate}%`,
          'Documents / المستندات': Number(t.doc_count),
          'Lines / البنود': Number(t.line_count),
          'Total Amount / إجمالي المبلغ': Number(t.total_amount),
        }));
        const ws3 = XLSX.utils.json_to_sheet(taxRows);
        ws3['!cols'] = [{ wch: 45 }, { wch: 15 }, { wch: 18 }, { wch: 15 }, { wch: 12 }, { wch: 20 }];
        XLSX.utils.book_append_sheet(wb, ws3, 'Tax Breakdown');
      }

      const orgName = (() => { try { return JSON.parse(localStorage.getItem('invoice_user') || '{}').companyName || 'Report'; } catch { return 'Report'; } })();
      XLSX.writeFile(wb, `ETA - ${orgName} - ${new Date().toISOString().split('T')[0]}.xlsx`);
    } catch (err: any) {
      console.error('Excel export error:', err);
      // CSV fallback
      try {
        const headers = ['#', 'UUID', 'Internal ID', 'Type', 'Status', 'Direction', 'Date Issued', 'Issuer', 'Receiver', 'Total Sales', 'Discount', 'Net', 'Total'];
        const csvRows = [headers.join(',')];
        invoices.forEach((inv, idx) => {
          csvRows.push([idx + 1, `"${inv.uuid}"`, `"${inv.internalId || ''}"`, getTypeName(inv.typeName), inv.status, inv.direction, formatDate(inv.dateTimeIssued), `"${inv.issuerName || ''}"`, `"${inv.receiverName || ''}"`, inv.totalSales || 0, inv.totalDiscount || 0, inv.netAmount || 0, inv.total || 0].join(','));
        });
        const blob = new Blob(['\ufeff' + csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `ETA-Report-${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
        URL.revokeObjectURL(url);
      } catch { await alertDialog({ title: 'Export failed', message: 'Failed to export.', tone: 'danger' }); }
    } finally {
      setExporting(false);
    }
  };

  // Pagination
  const totalPages = Math.ceil(invoices.length / ROWS_PER_PAGE);
  const paginatedInvoices = invoices.slice((page - 1) * ROWS_PER_PAGE, page * ROWS_PER_PAGE);

  // Tax percentage bar helper
  const taxPercentage = taxSummary ? ((Number(taxSummary.total_tax) / Math.max(Number(taxSummary.total_net), 1)) * 100) : 0;

  // ── Landing menu: categorised grid of every report we offer ──
  if (reportView === 'menu') {
    // Small reusable tile so the menu stays readable.
    type ReportView = 'menu' | 'main' | 'duplicates' | 'vat' | 'customers' | 'products' | 'rejected' | 'trends' | 'activity' | 'late' | 'archive' | 'forecast' | 'anomalies';
    const Tile: React.FC<{
      view: ReportView;
      title: string;
      desc: string;
      icon: React.ReactNode;
      color: string;     // tailwind palette name (blue | emerald | …) — used for the icon bg
      badge?: React.ReactNode;
    }> = ({ view, title, desc, icon, color, badge }) => (
      <button onClick={() => setReportView(view)}
        className="text-left bg-white border border-gray-100 rounded-2xl p-5 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all group">
        <div className="flex items-start justify-between mb-3">
          <div className={`p-2.5 bg-${color}-50 rounded-xl group-hover:bg-${color}-100 transition-colors`}>
            {icon}
          </div>
          {badge}
        </div>
        <h3 className="text-base font-bold text-slate-800 mb-1">{title}</h3>
        <p className="text-xs text-slate-500 leading-relaxed">{desc}</p>
      </button>
    );

    const Section: React.FC<{ title: string; subtitle: string; children: React.ReactNode }> = ({ title, subtitle, children }) => (
      <div className="space-y-3">
        <div className="flex items-baseline gap-2">
          <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wide">{title}</h2>
          <p className="text-xs text-slate-400">{subtitle}</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">{children}</div>
      </div>
    );

    return (
      <div className="space-y-8 max-w-6xl">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">{t('reports.title')}</h1>
          <p className="text-slate-500 text-sm">{t('reports.menuSubtitle')}</p>
        </div>

        <Section title={t('reports.coreReports')} subtitle={t('reports.coreSub')}>
          <Tile view="main" color="blue" icon={<BarChart3 size={20} className="text-blue-600" />}
            title={t('reports.invoicesReport')}
            desc={t('reports.invoicesDesc')}
            badge={invoices.length > 0 ? <span className="text-[10px] font-semibold bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full">{invoices.length} {t('reports.loaded')}</span> : null}
          />
          <Tile view="duplicates" color="amber" icon={<Copy size={20} className="text-amber-600" />}
            title={t('reports.duplicates')}
            desc={t('reports.duplicatesDesc')}
            badge={dupData && dupData.length > 0 ? <span className="text-[10px] font-semibold bg-amber-50 text-amber-700 px-2 py-0.5 rounded-full">{dupData.length} {t('reports.groups')}</span> : null}
          />
          <Tile view="vat" color="emerald" icon={<Receipt size={20} className="text-emerald-600" />}
            title={t('reports.vatSummary')}
            desc={t('reports.vatSummaryDesc')}
          />
        </Section>

        <Section title={t('reports.analytics')} subtitle={t('reports.analyticsSub')}>
          <Tile view="customers" color="violet" icon={<Users size={20} className="text-violet-600" />}
            title={t('reports.topCustomers')}
            desc={t('reports.topCustomersDesc')}
          />
          <Tile view="products" color="indigo" icon={<Package size={20} className="text-indigo-600" />}
            title={t('reports.topProducts')}
            desc={t('reports.topProductsDesc')}
          />
          <Tile view="trends" color="cyan" icon={<TrendingUp size={20} className="text-cyan-600" />}
            title={t('reports.trends')}
            desc={t('reports.trendsDesc')}
          />
          <Tile view="activity" color="fuchsia" icon={<Activity size={20} className="text-fuchsia-600" />}
            title={t('reports.taxByActivity')}
            desc={t('reports.activityDesc')}
          />
        </Section>

        <Section title={t('reports.errors')} subtitle={t('reports.errorsSub')}>
          <Tile view="rejected" color="rose" icon={<XOctagon size={20} className="text-rose-600" />}
            title={t('reports.rejected')}
            desc={t('reports.rejectedDesc')}
          />
          <Tile view="late" color="orange" icon={<Clock size={20} className="text-orange-600" />}
            title={t('reports.lateSubmissions')}
            desc={t('reports.lateDesc')}
          />
        </Section>

        <Section title={t('reports.smartReports')} subtitle={t('reports.smartReportsSub')}>
          <Tile view="forecast" color="purple" icon={<Sparkles size={20} className="text-purple-600" />}
            title={t('reports.vatForecast')}
            desc={t('reports.forecastDesc')}
          />
          <Tile view="anomalies" color="red" icon={<ShieldAlert size={20} className="text-red-600" />}
            title={t('reports.anomalyDetection')}
            desc={t('reports.anomalyDesc')}
          />
        </Section>

        <Section title={t('reports.exportBackup')} subtitle={t('reports.exportBackupSub')}>
          <Tile view="archive" color="slate" icon={<ArchiveIcon size={20} className="text-slate-600" />}
            title={t('reports.archive')}
            desc={t('reports.archiveDesc')}
          />
        </Section>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Shared "Report Shell" — header + date filter + Generate + Export. Keeps
  // all new report views visually consistent and avoids copy-paste.
  // ═══════════════════════════════════════════════════════════════════════
  const ReportShell: React.FC<{
    title: string;
    icon: React.ReactNode;
    color: string;                    // 'emerald' | 'violet' | …
    subtitle?: string;
    onGenerate: () => void;
    onExport?: () => void;
    hasData: boolean;
    loadingKey: string;               // key used in loadingReport state
    extraFilters?: React.ReactNode;   // optional extra controls beside dates
    children: React.ReactNode;
  }> = ({ title, icon, color, subtitle, onGenerate, onExport, hasData, loadingKey, extraFilters, children }) => (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <button onClick={() => setReportView('menu')} className="p-2 rounded-lg hover:bg-gray-100 transition-colors">
          <ArrowLeft size={18} className="text-slate-600" />
        </button>
        <div className={`p-2 bg-${color}-50 rounded-xl`}>{icon}</div>
        <div>
          <h1 className="text-xl font-bold text-slate-800">{title}</h1>
          {subtitle && <p className="text-slate-500 text-xs">{subtitle}</p>}
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
        <div className="flex items-end gap-3 flex-wrap">
          <div>
            <label className="block text-[10px] font-semibold text-slate-500 mb-1 uppercase tracking-wide">{t('reports.dateFrom')}</label>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="px-3 py-2 border border-gray-200 rounded-lg text-sm" />
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-slate-500 mb-1 uppercase tracking-wide">{t('reports.dateTo')}</label>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="px-3 py-2 border border-gray-200 rounded-lg text-sm" />
          </div>
          {extraFilters}
          <button onClick={onGenerate} disabled={loadingReport === loadingKey}
            className={`flex items-center gap-2 bg-${color}-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-${color}-700 disabled:opacity-50`}>
            {loadingReport === loadingKey ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
            {t('reports.generate')}
          </button>
          {hasData && onExport && (
            <button onClick={onExport}
              className="flex items-center gap-2 bg-emerald-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-emerald-700">
              <FileSpreadsheet size={14} /> {t('reports.export')}
            </button>
          )}
        </div>
        {reportError && <div className="mt-3 text-sm text-red-600 flex items-center gap-1"><AlertTriangle size={14} /> {reportError}</div>}
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        {loadingReport === loadingKey && <div className="p-12 text-center text-slate-400"><Loader2 size={24} className="animate-spin mx-auto mb-2" /> {t('common.loading')}</div>}
        {loadingReport !== loadingKey && !hasData && (
          <div className="p-12 text-center text-slate-400">
            <Filter size={28} className="mx-auto mb-2 opacity-50" />
            <p className="text-sm">{t('reports.clickGenerate')}</p>
          </div>
        )}
        {loadingReport !== loadingKey && hasData && children}
      </div>
    </div>
  );

  // ── VAT Return Summary ──
  if (reportView === 'vat') {
    return (
      <ReportShell title={t('reports.vatSummary')} subtitle={t('reports.vatSubtitle')}
        icon={<Receipt size={20} className="text-emerald-600" />} color="emerald"
        onGenerate={loadVAT} onExport={exportVAT} hasData={!!vatData && vatData.rows.length > 0} loadingKey="vat">
        {vatData && vatData.rows.length > 0 && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3 p-5 bg-gradient-to-br from-emerald-50 to-emerald-100/30 border-b border-gray-100">
              <div><div className="text-[10px] font-bold text-emerald-600 uppercase">{t('reports.outputVatSent')}</div>
                <div className="text-xl font-black text-slate-800">{formatAmount(vatData.totals.outputVat)}</div></div>
              <div><div className="text-[10px] font-bold text-blue-600 uppercase">{t('reports.inputVatReceived')}</div>
                <div className="text-xl font-black text-slate-800">{formatAmount(vatData.totals.inputVat)}</div></div>
              <div><div className="text-[10px] font-bold text-rose-600 uppercase">{t('reports.netVatPayable')}</div>
                <div className={`text-xl font-black ${vatData.totals.netPayable >= 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                  {formatAmount(vatData.totals.netPayable)}</div>
                <div className="text-[9px] text-slate-400">{vatData.totals.netPayable >= 0 ? t('reports.youOweEta') : t('reports.refundable')}</div></div>
              <div><div className="text-[10px] font-bold text-slate-500 uppercase">{t('reports.invoicesShort')}</div>
                <div className="text-xl font-black text-slate-800">{vatData.totals.sentCount} / {vatData.totals.receivedCount}</div>
                <div className="text-[9px] text-slate-400">{t('reports.sentReceived')}</div></div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-[10px] font-bold text-slate-500 uppercase">
                  <tr>
                    <th className="text-left px-4 py-2">{t('reports.month')}</th>
                    <th className="text-right px-4 py-2">{t('reports.outputBase')}</th>
                    <th className="text-right px-4 py-2 bg-emerald-50">{t('reports.outputVat')}</th>
                    <th className="text-right px-4 py-2">{t('reports.inputBase')}</th>
                    <th className="text-right px-4 py-2 bg-blue-50">{t('reports.inputVat')}</th>
                    <th className="text-right px-4 py-2 bg-rose-50">{t('reports.netPayable')}</th>
                  </tr>
                </thead>
                <tbody>
                  {vatData.rows.map(r => (
                    <tr key={r.month} className="border-t border-gray-50 hover:bg-gray-50/60">
                      <td className="px-4 py-2 font-mono font-semibold">{r.month}</td>
                      <td className="px-4 py-2 text-right font-mono">{formatAmount(r.outputBase)}</td>
                      <td className="px-4 py-2 text-right font-mono bg-emerald-50/40 text-emerald-700 font-semibold">{formatAmount(r.outputVat)}</td>
                      <td className="px-4 py-2 text-right font-mono">{formatAmount(r.inputBase)}</td>
                      <td className="px-4 py-2 text-right font-mono bg-blue-50/40 text-blue-700 font-semibold">{formatAmount(r.inputVat)}</td>
                      <td className={`px-4 py-2 text-right font-mono font-bold ${r.netPayable >= 0 ? 'text-rose-700' : 'text-emerald-700'}`}>{formatAmount(r.netPayable)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </ReportShell>
    );
  }

  // ── Top Customers ──
  if (reportView === 'customers') {
    return (
      <ReportShell title={t('reports.topCustomers')} subtitle={t('reports.topCustomersSubtitle')}
        icon={<Users size={20} className="text-violet-600" />} color="violet"
        onGenerate={loadCustomers} onExport={exportCustomers} hasData={!!customersData && customersData.length > 0} loadingKey="customers">
        {customersData && customersData.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-[10px] font-bold text-slate-500 uppercase">
                <tr>
                  <th className="text-left px-4 py-2 w-12">#</th>
                  <th className="text-left px-4 py-2">{t('reports.customer')}</th>
                  <th className="text-left px-4 py-2">{t('reports.taxId')}</th>
                  <th className="text-right px-4 py-2">{t('reports.invoices')}</th>
                  <th className="text-right px-4 py-2">{t('reports.totalAmt')} (EGP)</th>
                  <th className="text-right px-4 py-2">{t('reports.average')} (EGP)</th>
                  <th className="text-left px-4 py-2">{t('reports.lastSeen')}</th>
                </tr>
              </thead>
              <tbody>
                {customersData.map((c, i) => (
                  <tr key={c.receiverId} className="border-t border-gray-50 hover:bg-violet-50/30">
                    <td className="px-4 py-2 font-mono font-bold text-violet-600">{i + 1}</td>
                    <td className="px-4 py-2 font-semibold text-slate-800">{c.receiverName || '—'}</td>
                    <td className="px-4 py-2 font-mono text-xs text-slate-500">{c.receiverId}</td>
                    <td className="px-4 py-2 text-right font-mono">{Number(c.count).toLocaleString()}</td>
                    <td className="px-4 py-2 text-right font-mono font-bold text-slate-800">{formatAmount(c.total_amount)}</td>
                    <td className="px-4 py-2 text-right font-mono text-slate-500">{formatAmount(c.avg_amount)}</td>
                    <td className="px-4 py-2 text-xs text-slate-500">{c.last_seen ? formatDate(c.last_seen) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ReportShell>
    );
  }

  // ── Top Products ──
  if (reportView === 'products') {
    return (
      <ReportShell title={t('reports.topProducts')} subtitle={t('reports.topProductsSubtitle')}
        icon={<Package size={20} className="text-indigo-600" />} color="indigo"
        onGenerate={loadProducts} onExport={exportProducts} hasData={!!productsData && productsData.length > 0} loadingKey="products">
        {productsData && productsData.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-[10px] font-bold text-slate-500 uppercase">
                <tr>
                  <th className="text-left px-4 py-2 w-12">#</th>
                  <th className="text-left px-4 py-2">{t('reports.itemCode')}</th>
                  <th className="text-left px-4 py-2">{t('reports.description')}</th>
                  <th className="text-right px-4 py-2">{t('reports.qty')}</th>
                  <th className="text-right px-4 py-2">{t('reports.invoices')}</th>
                  <th className="text-right px-4 py-2">{t('reports.outputBase')} (EGP)</th>
                  <th className="text-right px-4 py-2">{t('reports.totalAmt')} (EGP)</th>
                </tr>
              </thead>
              <tbody>
                {productsData.map((p, i) => (
                  <tr key={p.itemCode} className="border-t border-gray-50 hover:bg-indigo-50/30">
                    <td className="px-4 py-2 font-mono font-bold text-indigo-600">{i + 1}</td>
                    <td className="px-4 py-2 font-mono text-xs font-semibold">{p.itemCode}</td>
                    <td className="px-4 py-2 text-slate-700 truncate max-w-[280px]" title={p.description}>{p.description || '—'}</td>
                    <td className="px-4 py-2 text-right font-mono">{Number(p.total_qty).toLocaleString()}</td>
                    <td className="px-4 py-2 text-right font-mono text-slate-500">{Number(p.invoice_count).toLocaleString()}</td>
                    <td className="px-4 py-2 text-right font-mono">{formatAmount(p.total_net)}</td>
                    <td className="px-4 py-2 text-right font-mono font-bold text-slate-800">{formatAmount(p.total_amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ReportShell>
    );
  }

  // ── Rejected Invoices ──
  if (reportView === 'rejected') {
    return (
      <ReportShell title={t('reports.rejectedTitle')} subtitle={t('reports.rejectedSubtitle')}
        icon={<XOctagon size={20} className="text-rose-600" />} color="rose"
        onGenerate={loadRejected} onExport={exportRejected} hasData={!!rejectedData && rejectedData.rows.length > 0} loadingKey="rejected"
        extraFilters={
          <div>
            <label className="block text-[10px] font-semibold text-slate-500 mb-1 uppercase tracking-wide">{t('reports.dupGroupBy')}</label>
            <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden bg-gray-50">
              <button type="button" onClick={() => { setRejectedMode('grouped'); setRejectedData(null); }}
                className={`px-3 py-2 text-xs font-semibold ${rejectedMode === 'grouped' ? 'bg-rose-600 text-white' : 'text-slate-600 hover:bg-white'}`}>
                {t('reports.errorReason')}
              </button>
              <button type="button" onClick={() => { setRejectedMode('list'); setRejectedData(null); }}
                className={`px-3 py-2 text-xs font-semibold ${rejectedMode === 'list' ? 'bg-rose-600 text-white' : 'text-slate-600 hover:bg-white'}`}>
                {t('reports.dupShowAll')}
              </button>
            </div>
          </div>
        }>
        {rejectedData && rejectedData.rows.length > 0 && (
          <div className="overflow-x-auto">
            {rejectedData.grouped ? (
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-[10px] font-bold text-slate-500 uppercase">
                  <tr>
                    <th className="text-left px-4 py-2 w-12">#</th>
                    <th className="text-left px-4 py-2">{t('reports.errorReason')}</th>
                    <th className="text-right px-4 py-2">{t('reports.count')}</th>
                    <th className="text-right px-4 py-2">{t('reports.affectedAmount')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rejectedData.rows.map((r, i) => (
                    <tr key={i} className="border-t border-gray-50 hover:bg-rose-50/30">
                      <td className="px-4 py-2 font-mono font-bold text-rose-600">{i + 1}</td>
                      <td className="px-4 py-2 text-xs text-slate-700 max-w-[500px]" title={r.reason}>{r.reason}</td>
                      <td className="px-4 py-2 text-right font-mono font-bold">{Number(r.count).toLocaleString()}</td>
                      <td className="px-4 py-2 text-right font-mono">{formatAmount(r.total_amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-[10px] font-bold text-slate-500 uppercase">
                  <tr>
                    <th className="text-left px-4 py-2">{t('reports.internalId')}</th>
                    <th className="text-left px-4 py-2">{t('common.date')}</th>
                    <th className="text-left px-4 py-2">{t('reports.direction')}</th>
                    <th className="text-left px-4 py-2">{t('manual.receiverName')}</th>
                    <th className="text-right px-4 py-2">{t('reports.totalAmt')}</th>
                    <th className="text-left px-4 py-2">{t('common.status')}</th>
                    <th className="text-left px-4 py-2">{t('reports.errorReason')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rejectedData.rows.map((r, i) => (
                    <tr key={i} className="border-t border-gray-50 hover:bg-rose-50/30">
                      <td className="px-4 py-2 font-mono text-xs font-semibold">{r.internalId}</td>
                      <td className="px-4 py-2 text-xs">{r.dateTimeIssued ? formatDate(r.dateTimeIssued) : '—'}</td>
                      <td className="px-4 py-2 text-xs">{r.direction}</td>
                      <td className="px-4 py-2 text-xs">{r.receiverName || r.receiverId}</td>
                      <td className="px-4 py-2 text-right font-mono">{formatAmount(r.total)}</td>
                      <td className="px-4 py-2"><span className="text-[10px] font-bold text-rose-700 bg-rose-50 px-2 py-0.5 rounded-full">{r.status}</span></td>
                      <td className="px-4 py-2 text-[11px] text-slate-600 max-w-[300px] truncate" title={r.rejectionReasons || r.documentStatusReason}>
                        {r.rejectionReasons || r.documentStatusReason || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </ReportShell>
    );
  }

  // ── Time Trends (line chart) ──
  if (reportView === 'trends') {
    const chartData = (trendsData || []).map(r => ({
      month: r.month,
      sentRevenue: Number(r.sent_revenue || 0),
      receivedRevenue: Number(r.received_revenue || 0),
      sentTax: Number(r.sent_tax || 0),
      receivedTax: Number(r.received_tax || 0),
    }));
    return (
      <ReportShell title={t('reports.trendsTitle')} subtitle={t('reports.trendsSubtitle')}
        icon={<TrendingUp size={20} className="text-cyan-600" />} color="cyan"
        onGenerate={loadTrends} onExport={exportTrends} hasData={!!trendsData && trendsData.length > 0} loadingKey="trends">
        {trendsData && trendsData.length > 0 && (
          <div className="p-4">
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="#f1f5f9" strokeDasharray="3 3" />
                  <XAxis dataKey="month" stroke="#94a3b8" fontSize={11} />
                  <YAxis stroke="#94a3b8" fontSize={11} tickFormatter={(v) => (v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v))} />
                  <Tooltip formatter={(v: any) => Number(v).toLocaleString('en-US', { maximumFractionDigits: 0 })} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line type="monotone" dataKey="sentRevenue"     name="Sent Revenue"     stroke="#06b6d4" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="receivedRevenue" name="Received Revenue" stroke="#6366f1" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="sentTax"         name="Sent Tax"         stroke="#10b981" strokeWidth={1.5} strokeDasharray="5 5" dot={false} />
                  <Line type="monotone" dataKey="receivedTax"     name="Received Tax"     stroke="#f59e0b" strokeWidth={1.5} strokeDasharray="5 5" dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="overflow-x-auto mt-4">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 text-[10px] font-bold text-slate-500 uppercase">
                  <tr>
                    <th className="text-left px-3 py-2">Month</th>
                    <th className="text-right px-3 py-2">Sent Rev</th>
                    <th className="text-right px-3 py-2">Received Rev</th>
                    <th className="text-right px-3 py-2">Sent Tax</th>
                    <th className="text-right px-3 py-2">Received Tax</th>
                    <th className="text-right px-3 py-2">Sent #</th>
                    <th className="text-right px-3 py-2">Received #</th>
                  </tr>
                </thead>
                <tbody>
                  {trendsData.map((r, i) => (
                    <tr key={i} className="border-t border-gray-50">
                      <td className="px-3 py-1.5 font-mono">{r.month}</td>
                      <td className="px-3 py-1.5 text-right font-mono">{formatAmount(r.sent_revenue)}</td>
                      <td className="px-3 py-1.5 text-right font-mono">{formatAmount(r.received_revenue)}</td>
                      <td className="px-3 py-1.5 text-right font-mono">{formatAmount(r.sent_tax)}</td>
                      <td className="px-3 py-1.5 text-right font-mono">{formatAmount(r.received_tax)}</td>
                      <td className="px-3 py-1.5 text-right font-mono">{Number(r.sent_count || 0)}</td>
                      <td className="px-3 py-1.5 text-right font-mono">{Number(r.received_count || 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </ReportShell>
    );
  }

  // ── Tax by Activity Code ──
  if (reportView === 'activity') {
    return (
      <ReportShell title={t('reports.activityTitle')} subtitle={t('reports.activitySubtitle')}
        icon={<Activity size={20} className="text-fuchsia-600" />} color="fuchsia"
        onGenerate={loadActivity} onExport={exportActivity} hasData={!!activityData && activityData.length > 0} loadingKey="activity">
        {activityData && activityData.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-[10px] font-bold text-slate-500 uppercase">
                <tr>
                  <th className="text-left px-4 py-2 w-12">#</th>
                  <th className="text-left px-4 py-2">Activity Code</th>
                  <th className="text-right px-4 py-2">Invoices</th>
                  <th className="text-right px-4 py-2">Total Amount</th>
                  <th className="text-right px-4 py-2">Total Tax</th>
                  <th className="text-right px-4 py-2">Effective Rate</th>
                </tr>
              </thead>
              <tbody>
                {activityData.map((a, i) => {
                  const effectiveRate = Number(a.total_amount) > 0 ? (Number(a.total_tax) / Number(a.total_amount)) * 100 : 0;
                  return (
                    <tr key={a.activity_code} className="border-t border-gray-50 hover:bg-fuchsia-50/30">
                      <td className="px-4 py-2 font-mono font-bold text-fuchsia-600">{i + 1}</td>
                      <td className="px-4 py-2 font-mono font-semibold">{a.activity_code}</td>
                      <td className="px-4 py-2 text-right font-mono">{Number(a.count).toLocaleString()}</td>
                      <td className="px-4 py-2 text-right font-mono font-bold">{formatAmount(a.total_amount)}</td>
                      <td className="px-4 py-2 text-right font-mono text-emerald-700">{formatAmount(a.total_tax)}</td>
                      <td className="px-4 py-2 text-right font-mono text-slate-500">{effectiveRate.toFixed(2)}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </ReportShell>
    );
  }

  // ── Late Submissions ──
  if (reportView === 'late') {
    return (
      <ReportShell title={t('reports.lateTitle')} subtitle={t('reports.lateSubtitle')}
        icon={<Clock size={20} className="text-orange-600" />} color="orange"
        onGenerate={loadLate} onExport={exportLate} hasData={!!lateData && lateData.rows.length > 0} loadingKey="late"
        extraFilters={
          <div>
            <label className="block text-[10px] font-semibold text-slate-500 mb-1 uppercase tracking-wide">Threshold (hours)</label>
            <input type="number" min={1} max={720} value={lateThreshold}
              onChange={e => setLateThreshold(parseInt(e.target.value) || 48)}
              className="px-3 py-2 border border-gray-200 rounded-lg text-sm w-24" />
          </div>
        }>
        {lateData && lateData.rows.length > 0 && (
          <div className="overflow-x-auto">
            <div className="px-5 py-3 bg-orange-50/60 border-b border-orange-100 text-xs text-orange-800">
              <strong>{lateData.rows.length}</strong> invoice(s) with a lag &gt; <strong>{lateData.thresholdHours}h</strong> ({(lateData.thresholdHours / 24).toFixed(1)} days).
            </div>
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-[10px] font-bold text-slate-500 uppercase">
                <tr>
                  <th className="text-left px-4 py-2">Internal ID</th>
                  <th className="text-left px-4 py-2">Issued</th>
                  <th className="text-left px-4 py-2">Received by ETA</th>
                  <th className="text-right px-4 py-2">Lag</th>
                  <th className="text-left px-4 py-2">Receiver</th>
                  <th className="text-right px-4 py-2">Total</th>
                  <th className="text-left px-4 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {lateData.rows.map((r, i) => (
                  <tr key={i} className="border-t border-gray-50 hover:bg-orange-50/30">
                    <td className="px-4 py-2 font-mono text-xs font-semibold">{r.internalId}</td>
                    <td className="px-4 py-2 text-xs">{r.dateTimeIssued ? formatDate(r.dateTimeIssued) : '—'}</td>
                    <td className="px-4 py-2 text-xs">{r.dateTimeReceived ? formatDate(r.dateTimeReceived) : '—'}</td>
                    <td className="px-4 py-2 text-right font-mono font-bold text-orange-700">{Number(r.lag_hours).toFixed(1)}h</td>
                    <td className="px-4 py-2 text-xs">{r.receiverName || '—'}</td>
                    <td className="px-4 py-2 text-right font-mono">{formatAmount(r.total)}</td>
                    <td className="px-4 py-2"><span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">{r.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ReportShell>
    );
  }

  // ── VAT Forecast view ──
  if (reportView === 'forecast') {
    return (
      <ReportShell title={t('reports.vatForecast')} subtitle={t('reports.forecastDesc')}
        icon={<Sparkles size={20} className="text-purple-600" />} color="purple"
        onGenerate={loadForecast} onExport={undefined as any} hasData={!!forecastData} loadingKey="forecast">
        {forecastData && (
          <div className="p-5">
            {forecastData.forecast ? (
              <>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-5">
                  <div className="p-4 bg-emerald-50 border border-emerald-100 rounded-xl">
                    <div className="text-[10px] font-bold text-emerald-700 uppercase">{t('reports.outputProj')}</div>
                    <div className="text-2xl font-black text-emerald-900 font-mono">{formatAmount(forecastData.forecast.outputVat)}</div>
                    <div className="text-[10px] text-emerald-600">
                      ±{formatAmount(forecastData.forecast.confidence.outputStddev)} · {t('reports.slope')} {forecastData.forecast.slopeOutput >= 0 ? '↑' : '↓'} {Math.abs(forecastData.forecast.slopeOutput).toFixed(0)}/{t('reports.month_')}
                    </div>
                  </div>
                  <div className="p-4 bg-blue-50 border border-blue-100 rounded-xl">
                    <div className="text-[10px] font-bold text-blue-700 uppercase">{t('reports.inputProj')}</div>
                    <div className="text-2xl font-black text-blue-900 font-mono">{formatAmount(forecastData.forecast.inputVat)}</div>
                    <div className="text-[10px] text-blue-600">
                      ±{formatAmount(forecastData.forecast.confidence.inputStddev)} · {t('reports.slope')} {forecastData.forecast.slopeInput >= 0 ? '↑' : '↓'} {Math.abs(forecastData.forecast.slopeInput).toFixed(0)}/{t('reports.month_')}
                    </div>
                  </div>
                  <div className={`p-4 border rounded-xl ${forecastData.forecast.netPayable >= 0 ? 'bg-rose-50 border-rose-100' : 'bg-emerald-50 border-emerald-100'}`}>
                    <div className={`text-[10px] font-bold uppercase ${forecastData.forecast.netPayable >= 0 ? 'text-rose-700' : 'text-emerald-700'}`}>
                      {forecastData.forecast.netPayable >= 0 ? t('reports.netPayable') : t('reports.refundable')}
                    </div>
                    <div className={`text-2xl font-black font-mono ${forecastData.forecast.netPayable >= 0 ? 'text-rose-900' : 'text-emerald-900'}`}>
                      {formatAmount(Math.abs(forecastData.forecast.netPayable))}
                    </div>
                    <div className="text-[10px] text-slate-500">{forecastData.forecast.month}</div>
                  </div>
                </div>
                <div className="text-xs text-slate-500 mb-3">
                  <strong>{t('reports.forecastMethod')}:</strong> {forecastData.forecast.method}. {t('reports.accuracyMore')}
                  {' '}{t('reports.trailingMonths')}: <strong>{forecastData.history.length}</strong>.
                </div>
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-[10px] font-bold text-slate-500 uppercase">
                    <tr>
                      <th className="text-left px-4 py-2">{t('reports.month')}</th>
                      <th className="text-right px-4 py-2">{t('reports.outputVat')}</th>
                      <th className="text-right px-4 py-2">{t('reports.inputVat')}</th>
                      <th className="text-right px-4 py-2">{t('reports.netCol')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {forecastData.history.map((h: any) => (
                      <tr key={h.month} className="border-t border-gray-50">
                        <td className="px-4 py-2 font-mono">{h.month}</td>
                        <td className="px-4 py-2 text-right font-mono">{formatAmount(h.outputVat)}</td>
                        <td className="px-4 py-2 text-right font-mono">{formatAmount(h.inputVat)}</td>
                        <td className={`px-4 py-2 text-right font-mono font-bold ${h.netVat >= 0 ? 'text-rose-700' : 'text-emerald-700'}`}>{formatAmount(h.netVat)}</td>
                      </tr>
                    ))}
                    <tr className="border-t-2 border-purple-200 bg-purple-50/50">
                      <td className="px-4 py-2 font-mono font-bold text-purple-800">{forecastData.forecast.month} {t('reports.projected')}</td>
                      <td className="px-4 py-2 text-right font-mono font-bold text-purple-800">{formatAmount(forecastData.forecast.outputVat)}</td>
                      <td className="px-4 py-2 text-right font-mono font-bold text-purple-800">{formatAmount(forecastData.forecast.inputVat)}</td>
                      <td className="px-4 py-2 text-right font-mono font-bold text-purple-900">{formatAmount(forecastData.forecast.netPayable)}</td>
                    </tr>
                  </tbody>
                </table>
              </>
            ) : (
              <div className="p-6 text-center text-amber-700 bg-amber-50 border border-amber-100 rounded-xl">
                <AlertTriangle size={28} className="mx-auto mb-2" />
                <p className="text-sm font-bold">{forecastData.message || t('reports.notEnoughHistory')}</p>
              </div>
            )}
          </div>
        )}
      </ReportShell>
    );
  }

  // ── Anomaly Detection view ──
  if (reportView === 'anomalies') {
    return (
      <ReportShell title={t('reports.anomalyDetection')} subtitle={t('reports.anomalyDesc')}
        icon={<ShieldAlert size={20} className="text-red-600" />} color="red"
        onGenerate={loadAnomalies} onExport={undefined as any} hasData={!!anomalyData} loadingKey="anomalies"
        extraFilters={
          <div>
            <label className="block text-[10px] font-semibold text-slate-500 mb-1 uppercase tracking-wide">{t('reports.lookbackDays')}</label>
            <input type="number" min={1} max={365} value={anomalyLookback}
              onChange={e => setAnomalyLookback(parseInt(e.target.value) || 30)}
              className="px-3 py-2 border border-gray-200 rounded-lg text-sm w-24" />
          </div>
        }>
        {anomalyData && (
          <>
            <div className="px-5 py-3 bg-red-50/60 border-b border-red-100 text-xs text-red-800 flex items-center justify-between">
              <div>
                {t('reports.scanned')} <strong>{anomalyData.totalScanned}</strong> {t('reports.invoicesFromLast')} <strong>{anomalyData.lookbackDays}</strong> {t('reports.days')}.
              </div>
              <div>
                {t('reports.flagged')}: <strong className="text-red-900">{anomalyData.anomalies?.length || 0}</strong>
              </div>
            </div>
            {(!anomalyData.anomalies || anomalyData.anomalies.length === 0) ? (
              <div className="p-12 text-center text-emerald-600">
                <ShieldAlert size={32} className="mx-auto mb-2 opacity-50" />
                <p className="font-semibold">{t('reports.anomaliesNone')}</p>
                <p className="text-xs text-slate-500 mt-1">{t('reports.allInLine')}</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-[10px] font-bold text-slate-500 uppercase">
                    <tr>
                      <th className="text-left px-4 py-2">{t('reports.severity')}</th>
                      <th className="text-left px-4 py-2">{t('reports.internalId')}</th>
                      <th className="text-left px-4 py-2">{t('common.date')}</th>
                      <th className="text-left px-4 py-2">{t('reports.customerCol')}</th>
                      <th className="text-right px-4 py-2">{t('reports.totalCol')}</th>
                      <th className="text-left px-4 py-2">{t('reports.reasonCol')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {anomalyData.anomalies.map((a: any) => {
                      const sev = Number(a.severity || 0);
                      const sevColor = sev > 0.66 ? 'bg-red-500' : sev > 0.33 ? 'bg-amber-500' : 'bg-yellow-400';
                      return (
                        <tr key={a.uuid} className="border-t border-gray-50 hover:bg-red-50/20">
                          <td className="px-4 py-2">
                            <div className="w-16 h-2 bg-gray-100 rounded-full overflow-hidden">
                              <div className={`h-full ${sevColor}`} style={{ width: `${Math.round(sev * 100)}%` }} />
                            </div>
                            <div className="text-[10px] text-slate-400 mt-0.5">{(sev * 100).toFixed(0)}%</div>
                          </td>
                          <td className="px-4 py-2 font-mono text-xs font-semibold">{a.internalId}</td>
                          <td className="px-4 py-2 text-xs">{a.dateTimeIssued ? formatDate(a.dateTimeIssued) : '—'}</td>
                          <td className="px-4 py-2 text-xs">{a.receiverName || a.receiverId}</td>
                          <td className="px-4 py-2 text-right font-mono font-bold">{formatAmount(a.total)}</td>
                          <td className="px-4 py-2 text-[11px] text-slate-600 max-w-[400px]">{a.reason}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </ReportShell>
    );
  }

  // ── Archive ZIP download view ──
  if (reportView === 'archive') {
    return (
      <div className="space-y-5">
        <div className="flex items-center gap-3">
          <button onClick={() => setReportView('menu')} className="p-2 rounded-lg hover:bg-gray-100 transition-colors">
            <ArrowLeft size={18} className="text-slate-600" />
          </button>
          <div className="p-2 bg-slate-100 rounded-xl"><ArchiveIcon size={20} className="text-slate-700" /></div>
          <div>
            <h1 className="text-xl font-bold text-slate-800">{t('reports.archiveTitle')}</h1>
            <p className="text-slate-500 text-xs">{t('reports.archiveSubtitle2')}</p>
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div>
              <label className="block text-[10px] font-semibold text-slate-500 mb-1 uppercase tracking-wide">{t('reports.dateFrom')}</label>
              <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-slate-500 mb-1 uppercase tracking-wide">{t('reports.dateTo')}</label>
              <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-slate-500 mb-1 uppercase tracking-wide">{t('reports.directionLabel')}</label>
              <select value={archiveDirection} onChange={e => setArchiveDirection(e.target.value as any)} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm">
                <option>All</option><option>Sent</option><option>Received</option>
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-slate-500 mb-1 uppercase tracking-wide">{t('reports.statusLabel')}</label>
              <select value={archiveStatus} onChange={e => setArchiveStatus(e.target.value)} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm">
                {STATUS_OPTIONS.map(s => <option key={s}>{s}</option>)}
              </select>
            </div>
          </div>

          <div className="p-4 bg-slate-50 border border-slate-100 rounded-xl text-xs text-slate-600 space-y-1">
            <div className="flex items-center gap-1 font-bold text-slate-800"><Filter size={12} /> {t('reports.archiveYouGet')}</div>
            <ul className="list-disc list-inside space-y-0.5 ml-1">
              <li><span className="font-mono text-slate-500">/invoices/sent/*.json</span> — {t('reports.archiveSent')}</li>
              <li><span className="font-mono text-slate-500">/invoices/received/*.json</span> — {t('reports.archiveReceived')}</li>
              <li><span className="font-mono text-slate-500">/manifest.csv</span> — {t('reports.archiveManifest')}</li>
              <li><span className="font-mono text-slate-500">/README.txt</span> — {t('reports.archiveReadme')}</li>
            </ul>
            <div className="mt-2 pt-2 border-t border-slate-200 text-[11px] text-slate-500">
              {t('reports.archiveCap')}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button onClick={downloadArchive} disabled={archiving}
              className="flex items-center gap-2 bg-slate-800 text-white px-5 py-2.5 rounded-xl text-sm font-bold hover:bg-slate-900 disabled:opacity-50">
              {archiving ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
              {archiving ? t('reports.archiveBuilding') : t('reports.archiveDownloadZip')}
            </button>
            {archiveMsg && (
              <span className={`text-sm font-semibold ${archiveMsg.startsWith('❌') ? 'text-rose-600' : 'text-emerald-600'}`}>
                {archiveMsg}
              </span>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── Duplication report view ──
  if (reportView === 'duplicates') {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <button onClick={() => setReportView('menu')} className="p-2 rounded-lg hover:bg-gray-100 transition-colors">
            <ArrowLeft size={18} className="text-slate-600" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
              <Copy size={22} className="text-amber-600" /> Duplicate Invoices
            </h1>
            <p className="text-slate-500 text-sm">
              {dupMode === 'all'
                ? <>Every invoice whose <strong>Internal ID</strong> appears more than once, <strong>regardless of status</strong>. Useful for spotting any repeated number the portal has seen.</>
                : <>Invoices with status <strong>Valid</strong> whose internal ID appears more than once. IDs that mix Valid with other statuses are hidden.</>}
            </p>
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
          <div className="flex items-end gap-3 flex-wrap">
            {/* Mode toggle — two options the user explicitly asked for */}
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">Mode</label>
              <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden bg-gray-50">
                <button
                  type="button"
                  onClick={() => setDupMode('all')}
                  className={`px-3 py-2 text-xs font-semibold transition-colors ${dupMode === 'all' ? 'bg-amber-600 text-white' : 'text-slate-600 hover:bg-white'}`}
                  title="All uploaded invoice numbers — any status"
                >
                  All statuses
                </button>
                <button
                  type="button"
                  onClick={() => setDupMode('valid')}
                  className={`px-3 py-2 text-xs font-semibold transition-colors ${dupMode === 'valid' ? 'bg-amber-600 text-white' : 'text-slate-600 hover:bg-white'}`}
                  title="Only groups whose rows are all Valid"
                >
                  Valid only
                </button>
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">Date From</label>
              <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="px-3 py-2 border border-gray-200 rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">Date To</label>
              <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="px-3 py-2 border border-gray-200 rounded-lg text-sm" />
            </div>
            <button onClick={fetchDuplicates} disabled={dupLoading}
              className="flex items-center gap-2 bg-amber-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-amber-700 disabled:opacity-50">
              {dupLoading ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
              Generate
            </button>
            {dupData && dupData.length > 0 && (
              <button onClick={exportDuplicates}
                className="flex items-center gap-2 bg-emerald-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-emerald-700">
                <FileSpreadsheet size={14} /> Export Excel
              </button>
            )}
            {dupData && (
              <div className="ml-auto text-sm text-slate-600">
                <strong className="text-slate-800">{dupData.length}</strong> duplicated IDs · <strong className="text-slate-800">{dupData.reduce((s, g) => s + (g.totalCount ?? g.validCount), 0)}</strong> total rows
              </div>
            )}
          </div>
          {dupError && <div className="mt-3 text-sm text-red-600 flex items-center gap-1"><AlertTriangle size={14} /> {dupError}</div>}
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          {dupLoading && <div className="p-8 text-center text-slate-400">Loading…</div>}
          {!dupLoading && !dupData && (
            <div className="p-12 text-center text-slate-400">
              <Copy size={40} className="mx-auto mb-3 text-slate-300" />
              <p>Click <strong>Generate</strong> to scan for duplicates.</p>
            </div>
          )}
          {!dupLoading && dupData && dupData.length === 0 && (
            <div className="p-12 text-center text-emerald-600">
              <Layers size={40} className="mx-auto mb-3" />
              <p className="font-semibold">No duplicate invoices found.</p>
              <p className="text-sm text-slate-500 mt-1">
                {dupMode === 'all'
                  ? 'Every invoice has a unique internal ID in the selected range.'
                  : 'Every Valid invoice has a unique internal ID in the selected range.'}
              </p>
            </div>
          )}
          {!dupLoading && dupData && dupData.length > 0 && (
            <div className="divide-y divide-gray-50">
              {dupData.map(g => {
                const expanded = expandedDupId === g.internalId;
                const total = g.totalCount ?? g.validCount;
                return (
                  <div key={g.internalId}>
                    <button onClick={() => setExpandedDupId(expanded ? null : g.internalId)}
                      className="w-full flex items-center justify-between px-5 py-3 hover:bg-gray-50 transition-colors text-left">
                      <div className="flex items-center gap-3">
                        <ChevronDownIcon size={16} className={`text-slate-400 transition-transform ${expanded ? 'rotate-180' : ''}`} />
                        <div>
                          <div className="font-mono font-semibold text-slate-800">{g.internalId}</div>
                          <div className="text-xs text-slate-500">
                            {dupMode === 'all'
                              ? <>{total} total copies · <span className="text-emerald-700 font-semibold">{g.validCount} Valid</span> · total {g.totalAmount.toLocaleString('en-US', { minimumFractionDigits: 2 })} EGP</>
                              : <>{g.validCount} valid copies · total {g.totalAmount.toLocaleString('en-US', { minimumFractionDigits: 2 })} EGP</>}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {dupMode === 'all' && (
                          <span className="text-xs font-bold bg-emerald-100 text-emerald-800 px-2 py-1 rounded-full" title="Valid rows">
                            Valid × {g.validCount}
                          </span>
                        )}
                        <span className="text-xs font-bold bg-amber-100 text-amber-800 px-2 py-1 rounded-full" title="Total rows with this ID">
                          × {total}
                        </span>
                      </div>
                    </button>
                    {expanded && (
                      <div className="bg-gray-50/50 px-5 py-3 border-t border-gray-100">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-slate-500 uppercase tracking-wider">
                              <th className="text-left font-semibold py-1">UUID</th>
                              <th className="text-left font-semibold py-1">Date</th>
                              <th className="text-left font-semibold py-1">Direction</th>
                              <th className="text-left font-semibold py-1">Receiver</th>
                              <th className="text-right font-semibold py-1">Total</th>
                              <th className="text-left font-semibold py-1">Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {g.invoices.map(inv => {
                              const statusClass = inv.status === 'Valid'
                                ? 'text-emerald-700 bg-emerald-50'
                                : inv.status === 'Cancelled'
                                  ? 'text-slate-600 bg-slate-100'
                                  : inv.status === 'Rejected'
                                    ? 'text-amber-700 bg-amber-50'
                                    : inv.status === 'Invalid'
                                      ? 'text-red-700 bg-red-50'
                                      : 'text-blue-700 bg-blue-50';
                              return (
                                <tr key={inv.uuid} className="border-t border-gray-100">
                                  <td className="py-1.5 font-mono text-[11px]">{inv.uuid.slice(0, 18)}…</td>
                                  <td className="py-1.5">{formatDate(inv.dateTimeIssued)}</td>
                                  <td className="py-1.5">{inv.direction || '—'}</td>
                                  <td className="py-1.5">{inv.receiverName || inv.receiverId || '—'}</td>
                                  <td className="py-1.5 text-right font-mono">{Number(inv.total || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                                  <td className="py-1.5"><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${statusClass}`}>{inv.status}</span></td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Main invoices/tax/gap/stats report view ──
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => setReportView('menu')} className="p-2 rounded-lg hover:bg-gray-100 transition-colors">
          <ArrowLeft size={18} className="text-slate-600" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-slate-800">{t('reports.invoicesAndTax')}</h1>
          <p className="text-slate-500 text-sm">Generate filtered reports, analyze taxes, and export to Excel</p>
        </div>
      </div>

      {/* Filters Card */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
        <div className="flex items-center gap-2 mb-5">
          <Filter size={18} className="text-blue-600" />
          <h3 className="font-bold text-slate-800">{t('reports.reportFilters')}</h3>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
          {/* Date From */}
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">Date From</label>
            <div className="relative">
              <Calendar size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                className="w-full pl-10 pr-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 transition-all bg-gray-50/50" />
            </div>
          </div>

          {/* Date To */}
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">Date To</label>
            <div className="relative">
              <Calendar size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                className="w-full pl-10 pr-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 transition-all bg-gray-50/50" />
            </div>
          </div>

          {/* Direction */}
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">Direction</label>
            <div className="relative">
              <ArrowUpDown size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <select value={direction} onChange={e => setDirection(e.target.value)}
                className="w-full pl-10 pr-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 transition-all bg-gray-50/50 appearance-none cursor-pointer">
                {DIRECTION_OPTIONS.map(d => <option key={d} value={d}>{d === 'All' ? 'All Directions' : d === 'Sent' ? '↑ Sent (مبعوثه)' : '↓ Received (مستلمه)'}</option>)}
              </select>
            </div>
          </div>

          {/* Status */}
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">Status</label>
            <select value={status} onChange={e => setStatus(e.target.value)}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 transition-all bg-gray-50/50 appearance-none cursor-pointer">
              {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s === 'All' ? 'All Statuses' : s}</option>)}
            </select>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-3">
          <button onClick={fetchReport} disabled={loading}
            className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 disabled:opacity-60 transition-all shadow-sm hover:shadow-md">
            {loading ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
            {loading ? 'Loading...' : 'Generate Report'}
          </button>
          {invoices.length > 0 && (
            <button onClick={exportToExcel} disabled={exporting}
              className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 text-white rounded-xl text-sm font-semibold hover:bg-emerald-700 disabled:opacity-60 transition-all shadow-sm hover:shadow-md">
              {exporting ? <Loader2 size={16} className="animate-spin" /> : <FileSpreadsheet size={16} />}
              {exporting ? 'Exporting...' : 'Export Excel'}
            </button>
          )}
        </div>
      </div>

      {/* Tax Analysis Section */}
      {hasSearched && taxSummary && (
        <div className="space-y-4">
          {/* Financial Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-7 h-7 bg-blue-50 rounded-lg flex items-center justify-center"><BarChart3 size={14} className="text-blue-600" /></div>
              </div>
              <p className="text-[10px] font-bold text-slate-400 uppercase">Total Sales</p>
              <p className="text-lg font-bold text-slate-800">{formatAmount(taxSummary.total_sales)}</p>
            </div>
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-7 h-7 bg-amber-50 rounded-lg flex items-center justify-center"><DollarSign size={14} className="text-amber-600" /></div>
              </div>
              <p className="text-[10px] font-bold text-slate-400 uppercase">Discount</p>
              <p className="text-lg font-bold text-amber-600">{formatAmount(taxSummary.total_discount)}</p>
            </div>
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-7 h-7 bg-slate-50 rounded-lg flex items-center justify-center"><TrendingUp size={14} className="text-slate-600" /></div>
              </div>
              <p className="text-[10px] font-bold text-slate-400 uppercase">Net Amount</p>
              <p className="text-lg font-bold text-slate-700">{formatAmount(taxSummary.total_net)}</p>
            </div>
            <div className="bg-white rounded-xl shadow-sm border border-red-100 p-4 bg-gradient-to-br from-white to-red-50/30">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-7 h-7 bg-red-50 rounded-lg flex items-center justify-center"><PieChart size={14} className="text-red-600" /></div>
              </div>
              <p className="text-[10px] font-bold text-red-400 uppercase">Total Tax</p>
              <p className="text-lg font-bold text-red-700">{formatAmount(taxSummary.total_tax)}</p>
              <p className="text-[10px] text-red-400 mt-0.5">{taxPercentage.toFixed(1)}% of net</p>
            </div>
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-7 h-7 bg-emerald-50 rounded-lg flex items-center justify-center"><TrendingUp size={14} className="text-emerald-600" /></div>
              </div>
              <p className="text-[10px] font-bold text-slate-400 uppercase">Total Amount</p>
              <p className="text-lg font-bold text-emerald-700">{formatAmount(taxSummary.total_amount)}</p>
            </div>
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-7 h-7 bg-violet-50 rounded-lg flex items-center justify-center"><ArrowUpDown size={14} className="text-violet-600" /></div>
              </div>
              <p className="text-[10px] font-bold text-slate-400 uppercase">Sent / Received</p>
              <p className="text-sm font-bold text-slate-700 mt-1">
                <span className="text-blue-600">{taxSummary.sent_count}</span>
                <span className="text-slate-300 mx-1">/</span>
                <span className="text-green-600">{taxSummary.received_count}</span>
              </p>
              <p className="text-[10px] text-slate-400 mt-0.5">
                {formatAmount(taxSummary.sent_total)} / {formatAmount(taxSummary.received_total)}
              </p>
            </div>
          </div>

          {/* Tax Breakdown Table (if tax_items data exists) */}
          {taxBreakdown.length > 0 && (
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="p-5 border-b border-gray-100 flex items-center gap-2">
                <PieChart size={18} className="text-red-500" />
                <h3 className="font-bold text-slate-800">{t('reports.taxBreakdownByType')}</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="bg-gray-50/80">
                      <th className="px-5 py-3 text-[11px] font-bold text-slate-500 uppercase">Tax Type / نوع الضريبة</th>
                      <th className="px-5 py-3 text-[11px] font-bold text-slate-500 uppercase">Sub Type</th>
                      <th className="px-5 py-3 text-[11px] font-bold text-slate-500 uppercase text-center">Avg Rate</th>
                      <th className="px-5 py-3 text-[11px] font-bold text-slate-500 uppercase text-center">Documents</th>
                      <th className="px-5 py-3 text-[11px] font-bold text-slate-500 uppercase text-center">Lines</th>
                      <th className="px-5 py-3 text-[11px] font-bold text-slate-500 uppercase text-right">Total Amount</th>
                      <th className="px-5 py-3 text-[11px] font-bold text-slate-500 uppercase" style={{ width: '200px' }}>Share</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {taxBreakdown.map((t, idx) => {
                      const maxAmount = Math.max(...taxBreakdown.map(tb => Number(tb.total_amount)));
                      const barWidth = maxAmount > 0 ? (Number(t.total_amount) / maxAmount) * 100 : 0;
                      return (
                        <tr key={idx} className="hover:bg-blue-50/20 transition-colors">
                          <td className="px-5 py-3">
                            <span className="font-semibold text-slate-700">{t.taxType}</span>
                            <p className="text-[10px] text-slate-400 mt-0.5">{TAX_TYPE_LABELS[t.taxType] || ''}</p>
                          </td>
                          <td className="px-5 py-3 text-slate-500">{t.subType || '—'}</td>
                          <td className="px-5 py-3 text-center">
                            <span className="bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full text-xs font-semibold">{t.avg_rate}%</span>
                          </td>
                          <td className="px-5 py-3 text-center text-slate-600">{t.doc_count}</td>
                          <td className="px-5 py-3 text-center text-slate-600">{t.line_count}</td>
                          <td className="px-5 py-3 text-right font-semibold text-slate-800">{formatAmount(t.total_amount)}</td>
                          <td className="px-5 py-3">
                            <div className="w-full bg-gray-100 rounded-full h-2">
                              <div className="bg-gradient-to-r from-blue-500 to-blue-600 h-2 rounded-full transition-all" style={{ width: `${barWidth}%` }} />
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                    {/* Totals row */}
                    <tr className="bg-gray-50 font-bold">
                      <td className="px-5 py-3 text-slate-800" colSpan={5}>Total / الإجمالي</td>
                      <td className="px-5 py-3 text-right text-slate-800">
                        {formatAmount(taxBreakdown.reduce((sum, t) => sum + Number(t.total_amount), 0))}
                      </td>
                      <td className="px-5 py-3" />
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* If no detailed tax breakdown, show calculated summary */}
          {taxBreakdown.length === 0 && Number(taxSummary.total_tax) > 0 && (
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
              <div className="flex items-center gap-2 mb-4">
                <PieChart size={18} className="text-red-500" />
                <h3 className="font-bold text-slate-800">{t('reports.taxSummary')}</h3>
              </div>
              <div className="bg-gradient-to-r from-red-50 to-orange-50 rounded-xl p-5 border border-red-100">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-semibold text-slate-700">Estimated Total Tax</span>
                  <span className="text-2xl font-bold text-red-700">{formatAmount(taxSummary.total_tax)} <span className="text-xs text-red-400">EGP</span></span>
                </div>
                <div className="w-full bg-red-200/30 rounded-full h-3">
                  <div className="bg-gradient-to-r from-red-500 to-orange-500 h-3 rounded-full transition-all" style={{ width: `${Math.min(taxPercentage, 100)}%` }} />
                </div>
                <div className="flex justify-between mt-2 text-xs text-slate-500">
                  <span>Tax Rate: ~{taxPercentage.toFixed(1)}% of Net Amount</span>
                  <span>Net: {formatAmount(taxSummary.total_net)} → Total: {formatAmount(taxSummary.total_amount)}</span>
                </div>
                <p className="text-[10px] text-slate-400 mt-3 italic">* Calculated from documents (Total - Net Amount). Sync with full invoice details for per-tax-type breakdown.</p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">{error}</div>
      )}

      {/* Tabs: Invoices / Tax */}
      {hasSearched && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-5 pt-4 border-b border-gray-100 flex items-center justify-between">
            <div className="flex gap-1">
              <button onClick={() => { setActiveTab('invoices'); setPage(1); }}
                className={`px-4 py-2.5 text-sm font-semibold rounded-t-lg transition-all ${activeTab === 'invoices' ? 'text-blue-600 border-b-2 border-blue-600 bg-blue-50/50' : 'text-slate-500 hover:text-slate-700'}`}>
                <span className="flex items-center gap-1.5"><FileSpreadsheet size={15} /> Invoices ({invoices.length})</span>
              </button>
              <button onClick={() => setActiveTab('gap')}
                className={`px-4 py-2.5 text-sm font-semibold rounded-t-lg transition-all ${activeTab === 'gap' ? 'text-orange-600 border-b-2 border-orange-600 bg-orange-50/50' : 'text-slate-500 hover:text-slate-700'}`}>
                <span className="flex items-center gap-1.5"><GitCompare size={15} /> Gap Analysis</span>
              </button>
              <button onClick={() => setActiveTab('stats')}
                className={`px-4 py-2.5 text-sm font-semibold rounded-t-lg transition-all ${activeTab === 'stats' ? 'text-violet-600 border-b-2 border-violet-600 bg-violet-50/50' : 'text-slate-500 hover:text-slate-700'}`}>
                <span className="flex items-center gap-1.5"><BarChart3 size={15} /> Statistics</span>
              </button>
            </div>
            {activeTab === 'invoices' && totalPages > 1 && (
              <div className="flex items-center gap-2 text-sm pb-2">
                <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1} className="p-1.5 rounded-lg hover:bg-gray-100 disabled:opacity-30 transition-colors"><ChevronLeft size={16} /></button>
                <span className="text-slate-500">{page} / {totalPages}</span>
                <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="p-1.5 rounded-lg hover:bg-gray-100 disabled:opacity-30 transition-colors"><ChevronRight size={16} /></button>
              </div>
            )}
            {activeTab === 'gap' && gapData && (
              <button onClick={exportGapAnalysis} className="flex items-center gap-1.5 px-3 py-1.5 mb-2 text-sm font-semibold bg-emerald-600 text-white rounded-lg hover:bg-emerald-700">
                <FileSpreadsheet size={14} /> Export Excel
              </button>
            )}
            {activeTab === 'stats' && statsData && (
              <button onClick={exportStatistics} className="flex items-center gap-1.5 px-3 py-1.5 mb-2 text-sm font-semibold bg-emerald-600 text-white rounded-lg hover:bg-emerald-700">
                <FileSpreadsheet size={14} /> Export Excel
              </button>
            )}
          </div>

          {/* Invoices Tab */}
          {activeTab === 'invoices' && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="bg-gray-50/80">
                    <th className="px-4 py-3 text-[11px] font-bold text-slate-500 uppercase">#</th>
                    <th className="px-4 py-3 text-[11px] font-bold text-slate-500 uppercase">Internal ID</th>
                    <th className="px-4 py-3 text-[11px] font-bold text-slate-500 uppercase">Type</th>
                    <th className="px-4 py-3 text-[11px] font-bold text-slate-500 uppercase">Status</th>
                    <th className="px-4 py-3 text-[11px] font-bold text-slate-500 uppercase">Direction</th>
                    <th className="px-4 py-3 text-[11px] font-bold text-slate-500 uppercase">Date Issued</th>
                    <th className="px-4 py-3 text-[11px] font-bold text-slate-500 uppercase">Issuer</th>
                    <th className="px-4 py-3 text-[11px] font-bold text-slate-500 uppercase">Receiver</th>
                    <th className="px-4 py-3 text-[11px] font-bold text-slate-500 uppercase text-right">Net</th>
                    <th className="px-4 py-3 text-[11px] font-bold text-slate-500 uppercase text-right">Tax</th>
                    <th className="px-4 py-3 text-[11px] font-bold text-slate-500 uppercase text-right">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {paginatedInvoices.length === 0 ? (
                    <tr>
                      <td colSpan={11} className="px-4 py-12 text-center text-slate-400">
                        <FileSpreadsheet size={40} className="mx-auto mb-3 opacity-30" />
                        <p className="font-medium">No documents found</p>
                        <p className="text-xs mt-1">Try adjusting your date range or filters</p>
                      </td>
                    </tr>
                  ) : (
                    paginatedInvoices.map((inv, idx) => (
                      <tr key={inv.uuid} className="hover:bg-blue-50/30 transition-colors">
                        <td className="px-4 py-3 text-slate-400 text-xs">{(page - 1) * ROWS_PER_PAGE + idx + 1}</td>
                        <td className="px-4 py-3 font-medium text-slate-700">{inv.internalId || '—'}</td>
                        <td className="px-4 py-3 text-slate-600">{getTypeName(inv.typeName)}</td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider border ${statusColors[inv.status] || 'bg-gray-50 text-gray-600 border-gray-200'}`}>{inv.status}</span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`text-xs font-semibold ${inv.direction === 'Sent' ? 'text-blue-600' : 'text-green-600'}`}>
                            {inv.direction === 'Sent' ? '↑ Sent' : '↓ Received'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-slate-500">{formatDate(inv.dateTimeIssued)}</td>
                        <td className="px-4 py-3 text-slate-600 max-w-[160px] truncate" title={inv.issuerName}>{inv.issuerName || '—'}</td>
                        <td className="px-4 py-3 text-slate-600 max-w-[160px] truncate" title={inv.receiverName}>{inv.receiverName || '—'}</td>
                        <td className="px-4 py-3 text-right text-slate-500 text-xs">{formatAmount(inv.netAmount)}</td>
                        <td className="px-4 py-3 text-right text-red-600 text-xs font-medium">{formatAmount(Number(inv.total) - Number(inv.netAmount))}</td>
                        <td className="px-4 py-3 text-right font-semibold text-slate-800">{formatAmount(inv.total)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* Gap Analysis Tab */}
          {activeTab === 'gap' && (
            <div className="p-6">
              {gapData && gapData.months.length > 0 ? (
                <div className="space-y-6">
                  {/* Summary Cards */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="bg-blue-50 rounded-xl p-4 border border-blue-200">
                      <div className="flex items-center gap-2 mb-2"><ArrowUp size={16} className="text-blue-600" /><span className="text-xs font-bold text-blue-600 uppercase">Sent (Portal)</span></div>
                      <p className="text-2xl font-black text-blue-800">{formatAmount(gapData.totals.sentTotal || 0)}</p>
                      <p className="text-xs text-blue-500 mt-1">{gapData.totals.sentCount || 0} invoices • Tax: {formatAmount(gapData.totals.sentTax || 0)}</p>
                    </div>
                    <div className="bg-green-50 rounded-xl p-4 border border-green-200">
                      <div className="flex items-center gap-2 mb-2"><ArrowDown size={16} className="text-green-600" /><span className="text-xs font-bold text-green-600 uppercase">Received (ERP)</span></div>
                      <p className="text-2xl font-black text-green-800">{formatAmount(gapData.totals.receivedTotal || 0)}</p>
                      <p className="text-xs text-green-500 mt-1">{gapData.totals.receivedCount || 0} invoices • Tax: {formatAmount(gapData.totals.receivedTax || 0)}</p>
                    </div>
                    <div className={`rounded-xl p-4 border ${(gapData.totals.totalGap || 0) === 0 ? 'bg-emerald-50 border-emerald-200' : 'bg-orange-50 border-orange-200'}`}>
                      <div className="flex items-center gap-2 mb-2"><AlertTriangle size={16} className={(gapData.totals.totalGap || 0) === 0 ? 'text-emerald-600' : 'text-orange-600'} /><span className={`text-xs font-bold uppercase ${(gapData.totals.totalGap || 0) === 0 ? 'text-emerald-600' : 'text-orange-600'}`}>Amount Gap</span></div>
                      <p className={`text-2xl font-black ${(gapData.totals.totalGap || 0) === 0 ? 'text-emerald-800' : 'text-orange-800'}`}>{formatAmount(Math.abs(gapData.totals.totalGap || 0))}</p>
                      <p className={`text-xs mt-1 ${(gapData.totals.totalGap || 0) === 0 ? 'text-emerald-500' : 'text-orange-500'}`}>{(gapData.totals.totalGap || 0) > 0 ? 'Sent more than received' : (gapData.totals.totalGap || 0) < 0 ? 'Received more than sent' : 'Balanced ✅'}</p>
                    </div>
                    <div className={`rounded-xl p-4 border ${(gapData.totals.totalTaxGap || 0) === 0 ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'}`}>
                      <div className="flex items-center gap-2 mb-2"><PieChart size={16} className={(gapData.totals.totalTaxGap || 0) === 0 ? 'text-emerald-600' : 'text-red-600'} /><span className={`text-xs font-bold uppercase ${(gapData.totals.totalTaxGap || 0) === 0 ? 'text-emerald-600' : 'text-red-600'}`}>Tax Gap</span></div>
                      <p className={`text-2xl font-black ${(gapData.totals.totalTaxGap || 0) === 0 ? 'text-emerald-800' : 'text-red-800'}`}>{formatAmount(Math.abs(gapData.totals.totalTaxGap || 0))}</p>
                      <p className={`text-xs mt-1 ${(gapData.totals.totalTaxGap || 0) === 0 ? 'text-emerald-500' : 'text-red-500'}`}>Gap: {gapData.totals.gapPercentage || 0}%</p>
                    </div>
                  </div>

                  {/* Monthly Breakdown Table */}
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-gray-50/80">
                          <th className="px-4 py-3 text-[11px] font-bold text-slate-500 uppercase text-left">Month</th>
                          <th className="px-4 py-3 text-[11px] font-bold text-blue-500 uppercase text-center" colSpan={2}>↑ Sent (Portal)</th>
                          <th className="px-4 py-3 text-[11px] font-bold text-green-500 uppercase text-center" colSpan={2}>↓ Received (ERP)</th>
                          <th className="px-4 py-3 text-[11px] font-bold text-orange-500 uppercase text-right">Gap</th>
                          <th className="px-4 py-3 text-[11px] font-bold text-red-500 uppercase text-right">Tax Gap</th>
                          <th className="px-4 py-3 text-[11px] font-bold text-slate-500 uppercase text-right">Gap %</th>
                          <th className="px-4 py-3 text-[11px] font-bold text-slate-500 uppercase" style={{ width: '160px' }}>Visual</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {gapData.months.map((m: any, idx: number) => {
                          const maxVal = Math.max(...gapData.months.map((x: any) => Math.max(x.sent.total, x.received.total)));
                          const sentBar = maxVal > 0 ? (m.sent.total / maxVal) * 100 : 0;
                          const recvBar = maxVal > 0 ? (m.received.total / maxVal) * 100 : 0;
                          const isBalanced = Math.abs(m.gap) < 1;
                          return (
                            <tr key={idx} className="hover:bg-blue-50/20 transition-colors">
                              <td className="px-4 py-3 font-bold text-slate-700">{m.month}</td>
                              <td className="px-4 py-3 text-center text-blue-600 font-medium">{m.sent.count}</td>
                              <td className="px-4 py-3 text-center text-blue-800 font-semibold">{formatAmount(m.sent.total)}</td>
                              <td className="px-4 py-3 text-center text-green-600 font-medium">{m.received.count}</td>
                              <td className="px-4 py-3 text-center text-green-800 font-semibold">{formatAmount(m.received.total)}</td>
                              <td className={`px-4 py-3 text-right font-bold ${isBalanced ? 'text-emerald-600' : 'text-orange-700'}`}>
                                {isBalanced ? '✅ 0' : (m.gap > 0 ? '+' : '') + formatAmount(m.gap)}
                              </td>
                              <td className={`px-4 py-3 text-right font-bold ${Math.abs(m.taxGap) < 1 ? 'text-emerald-600' : 'text-red-700'}`}>
                                {Math.abs(m.taxGap) < 1 ? '0' : (m.taxGap > 0 ? '+' : '') + formatAmount(m.taxGap)}
                              </td>
                              <td className={`px-4 py-3 text-right font-semibold ${isBalanced ? 'text-emerald-500' : Math.abs(m.gapPercentage) > 50 ? 'text-red-600' : 'text-orange-600'}`}>
                                {m.gapPercentage}%
                              </td>
                              <td className="px-4 py-3">
                                <div className="space-y-1">
                                  <div className="flex items-center gap-1">
                                    <span className="text-[9px] text-blue-500 w-4">S</span>
                                    <div className="flex-1 bg-gray-100 rounded-full h-2"><div className="bg-blue-500 h-2 rounded-full transition-all" style={{ width: `${sentBar}%` }} /></div>
                                  </div>
                                  <div className="flex items-center gap-1">
                                    <span className="text-[9px] text-green-500 w-4">R</span>
                                    <div className="flex-1 bg-gray-100 rounded-full h-2"><div className="bg-green-500 h-2 rounded-full transition-all" style={{ width: `${recvBar}%` }} /></div>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                        {/* Totals Row */}
                        <tr className="bg-gray-50 font-bold border-t-2 border-gray-300">
                          <td className="px-4 py-3 text-slate-800">TOTAL</td>
                          <td className="px-4 py-3 text-center text-blue-700">{gapData.totals.sentCount || 0}</td>
                          <td className="px-4 py-3 text-center text-blue-900">{formatAmount(gapData.totals.sentTotal || 0)}</td>
                          <td className="px-4 py-3 text-center text-green-700">{gapData.totals.receivedCount || 0}</td>
                          <td className="px-4 py-3 text-center text-green-900">{formatAmount(gapData.totals.receivedTotal || 0)}</td>
                          <td className={`px-4 py-3 text-right ${Math.abs(gapData.totals.totalGap || 0) < 1 ? 'text-emerald-700' : 'text-orange-800'}`}>
                            {formatAmount(gapData.totals.totalGap || 0)}
                          </td>
                          <td className={`px-4 py-3 text-right ${Math.abs(gapData.totals.totalTaxGap || 0) < 1 ? 'text-emerald-700' : 'text-red-800'}`}>
                            {formatAmount(gapData.totals.totalTaxGap || 0)}
                          </td>
                          <td className="px-4 py-3 text-right text-slate-700">{gapData.totals.gapPercentage || 0}%</td>
                          <td className="px-4 py-3" />
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  <p className="text-[10px] text-slate-400 italic px-2">* Gap = Sent Total − Received Total. A positive gap means you invoiced more than you were invoiced. Tax Gap = Tax on Sent − Tax on Received.</p>
                </div>
              ) : (
                <div className="text-center py-12">
                  <GitCompare size={40} className="mx-auto mb-3 text-slate-300" />
                  <p className="font-medium text-slate-500">No gap analysis data available</p>
                  <p className="text-xs text-slate-400 mt-1">Generate a report with the filters above to see Sent vs Received comparison</p>
                </div>
              )}
            </div>
          )}

          {/* Statistics Tab */}
          {activeTab === 'stats' && (
            <div className="p-6">
              {statsData && statsData.overall ? (
                <div className="space-y-6">
                  {/* Overall Metrics */}
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
                      <p className="text-[10px] font-bold text-slate-400 uppercase">Total Documents</p>
                      <p className="text-2xl font-black text-slate-800">{statsData.overall.totalDocs.toLocaleString()}</p>
                    </div>
                    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
                      <p className="text-[10px] font-bold text-slate-400 uppercase">Total Amount</p>
                      <p className="text-2xl font-black text-emerald-700">{formatAmount(statsData.overall.totalAmount)}</p>
                      <p className="text-[10px] text-slate-400 mt-0.5">EGP</p>
                    </div>
                    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
                      <p className="text-[10px] font-bold text-slate-400 uppercase">Avg Invoice</p>
                      <p className="text-2xl font-black text-blue-700">{formatAmount(statsData.overall.avgValue)}</p>
                    </div>
                    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
                      <p className="text-[10px] font-bold text-slate-400 uppercase">Largest Invoice</p>
                      <p className="text-2xl font-black text-violet-700">{formatAmount(statsData.overall.maxValue)}</p>
                    </div>
                    <div className="bg-white rounded-xl shadow-sm border border-red-100 p-4">
                      <p className="text-[10px] font-bold text-red-400 uppercase">Total Tax</p>
                      <p className="text-2xl font-black text-red-700">{formatAmount(statsData.overall.totalTax)}</p>
                    </div>
                    <div className={`bg-white rounded-xl shadow-sm border p-4 ${statsData.growthRate >= 0 ? 'border-emerald-100' : 'border-red-100'}`}>
                      <p className="text-[10px] font-bold text-slate-400 uppercase">Growth Rate</p>
                      <p className={`text-2xl font-black ${statsData.growthRate >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                        {statsData.growthRate >= 0 ? '+' : ''}{statsData.growthRate}%
                      </p>
                      <p className="text-[10px] text-slate-400 mt-0.5">vs previous period</p>
                    </div>
                  </div>

                  {/* Status Breakdown */}
                  {statsData.invoicesByStatus?.length > 0 && (
                    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
                      <h4 className="font-bold text-slate-800 mb-4 flex items-center gap-2"><PieChart size={16} className="text-violet-500" /> Invoices by Status</h4>
                      <div className="space-y-3">
                        {statsData.invoicesByStatus.map((s: any, idx: number) => {
                          const maxCount = Math.max(...statsData.invoicesByStatus.map((x: any) => x.count));
                          const barWidth = maxCount > 0 ? (s.count / maxCount) * 100 : 0;
                          const colors: Record<string, string> = {
                            Valid: 'bg-emerald-500', Invalid: 'bg-red-500', Rejected: 'bg-amber-500',
                            Cancelled: 'bg-slate-400', Submitted: 'bg-blue-500'
                          };
                          return (
                            <div key={idx} className="flex items-center gap-3">
                              <span className="w-24 text-sm font-semibold text-slate-600 text-right">{s.status}</span>
                              <div className="flex-1 bg-gray-100 rounded-full h-5 relative overflow-hidden">
                                <div className={`h-full rounded-full transition-all ${colors[s.status] || 'bg-gray-500'}`} style={{ width: `${barWidth}%` }} />
                                <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-slate-700">{s.count} docs • {formatAmount(s.total)} EGP</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Monthly Trend */}
                  {statsData.invoicesByMonth?.length > 0 && (
                    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
                      <h4 className="font-bold text-slate-800 mb-4 flex items-center gap-2"><TrendingUp size={16} className="text-blue-500" /> Monthly Trend</h4>
                      <div className="flex items-end gap-1" style={{ height: '160px' }}>
                        {statsData.invoicesByMonth.map((m: any, idx: number) => {
                          const maxTotal = Math.max(...statsData.invoicesByMonth.map((x: any) => x.total));
                          const barHeight = maxTotal > 0 ? (m.total / maxTotal) * 100 : 5;
                          return (
                            <div key={idx} className="flex-1 flex flex-col items-center justify-end h-full group relative">
                              <div className="absolute -top-1 left-1/2 -translate-x-1/2 bg-slate-800 text-white text-[9px] px-2 py-1 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-10">
                                {m.count} docs • {formatAmount(m.total)} EGP
                              </div>
                              <div
                                className="w-full bg-gradient-to-t from-blue-600 to-blue-400 rounded-t-lg transition-all hover:from-blue-700 hover:to-blue-500 cursor-pointer min-h-[4px]"
                                style={{ height: `${barHeight}%` }}
                              />
                              <span className="text-[9px] text-slate-400 mt-1 whitespace-nowrap" style={{ transform: 'rotate(-45deg)', transformOrigin: 'top left', display: 'block', width: '50px' }}>{m.month}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Top Receivers / Issuers */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Top Receivers */}
                    {statsData.topReceivers?.length > 0 && (
                      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                        <div className="p-4 border-b border-gray-100 bg-blue-50/50">
                          <h4 className="font-bold text-slate-800 flex items-center gap-2"><ArrowUp size={14} className="text-blue-500" /> Top 10 Customers (Receivers)</h4>
                        </div>
                        <table className="w-full text-sm">
                          <thead><tr className="bg-gray-50/50"><th className="px-4 py-2 text-left text-[10px] font-bold text-slate-500">#</th><th className="px-4 py-2 text-left text-[10px] font-bold text-slate-500">Name</th><th className="px-4 py-2 text-right text-[10px] font-bold text-slate-500">Docs</th><th className="px-4 py-2 text-right text-[10px] font-bold text-slate-500">Total</th></tr></thead>
                          <tbody className="divide-y divide-gray-50">
                            {statsData.topReceivers.map((r: any, idx: number) => (
                              <tr key={idx} className="hover:bg-blue-50/20">
                                <td className="px-4 py-2 text-slate-400 text-xs">{idx + 1}</td>
                                <td className="px-4 py-2 text-slate-700 font-medium truncate" style={{ maxWidth: '200px' }} title={r.name}>{r.name || r.taxId}</td>
                                <td className="px-4 py-2 text-right text-slate-500">{r.count}</td>
                                <td className="px-4 py-2 text-right font-semibold text-slate-800">{formatAmount(r.total)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {/* Top Issuers */}
                    {statsData.topIssuers?.length > 0 && (
                      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                        <div className="p-4 border-b border-gray-100 bg-green-50/50">
                          <h4 className="font-bold text-slate-800 flex items-center gap-2"><ArrowDown size={14} className="text-green-500" /> Top 10 Suppliers (Issuers)</h4>
                        </div>
                        <table className="w-full text-sm">
                          <thead><tr className="bg-gray-50/50"><th className="px-4 py-2 text-left text-[10px] font-bold text-slate-500">#</th><th className="px-4 py-2 text-left text-[10px] font-bold text-slate-500">Name</th><th className="px-4 py-2 text-right text-[10px] font-bold text-slate-500">Docs</th><th className="px-4 py-2 text-right text-[10px] font-bold text-slate-500">Total</th></tr></thead>
                          <tbody className="divide-y divide-gray-50">
                            {statsData.topIssuers.map((r: any, idx: number) => (
                              <tr key={idx} className="hover:bg-green-50/20">
                                <td className="px-4 py-2 text-slate-400 text-xs">{idx + 1}</td>
                                <td className="px-4 py-2 text-slate-700 font-medium truncate" style={{ maxWidth: '200px' }} title={r.name}>{r.name || r.taxId}</td>
                                <td className="px-4 py-2 text-right text-slate-500">{r.count}</td>
                                <td className="px-4 py-2 text-right font-semibold text-slate-800">{formatAmount(r.total)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="text-center py-12">
                  <BarChart3 size={40} className="mx-auto mb-3 text-slate-300" />
                  <p className="font-medium text-slate-500">No statistics data available</p>
                  <p className="text-xs text-slate-400 mt-1">Generate a report with the filters above to see detailed analytics</p>
                </div>
              )}
            </div>
          )}

          {/* Footer */}
          {invoices.length > 0 && activeTab === 'invoices' && (
            <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-between text-xs text-slate-400">
              <span>Showing {((page - 1) * ROWS_PER_PAGE) + 1}–{Math.min(page * ROWS_PER_PAGE, invoices.length)} of {invoices.length}</span>
              <span>Total: <strong className="text-slate-700">{formatAmount(taxSummary?.total_amount || invoices.reduce((s, i) => s + Number(i.total || 0), 0))} EGP</strong></span>
            </div>
          )}
        </div>
      )}

      {/* Empty state */}
      {!hasSearched && !loading && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-12 text-center">
          <FileSpreadsheet size={48} className="mx-auto mb-4 text-slate-300" />
          <h3 className="font-bold text-slate-700 text-lg mb-2">{t('reports.generateAReport')}</h3>
          <p className="text-slate-400 text-sm max-w-md mx-auto">
            Select a date range and filters above, then click <strong>"Generate Report"</strong> to preview your invoices and tax analysis.
            You can export the results as an Excel file with multiple sheets.
          </p>
        </div>
      )}
    </div>
  );
};

export default Reports;
