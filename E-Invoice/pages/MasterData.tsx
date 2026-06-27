
import React, { useState, useEffect, useCallback } from 'react';
import { Users, Tag, Search, Plus, ExternalLink, Database, Filter, MapPin, X, Loader2, Edit, CheckCircle, XCircle, Clock, AlertCircle, RefreshCw, Trash2, Download, Package, ArrowLeft, ArrowRight, Mail, Phone, FileSpreadsheet } from 'lucide-react';
import { API_URL } from '../services/apiService';
import { exportExcel, fmtDate, num } from '../utils/export';
import { useTranslation } from '../i18n';
import { confirmDialog, alertDialog } from '../components/ConfirmDialog';

// Helpers
const getAuthHeaders = (): Record<string, string> => {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const userStr = localStorage.getItem('invoice_user');
  if (userStr) {
    try {
      const user = JSON.parse(userStr);
      if (user.token) headers['Authorization'] = `Bearer ${user.token}`;
    } catch { }
  }
  return headers;
};

const getStatusBadge = (status: string) => {
  const styles: Record<string, string> = {
    Approved: 'bg-emerald-50 text-emerald-700',
    Submitted: 'bg-amber-50 text-amber-700',
    Rejected: 'bg-red-50 text-red-700',
    Active: 'bg-emerald-50 text-emerald-700',
  };
  const icons: Record<string, React.ReactNode> = {
    Approved: <CheckCircle size={10} />,
    Submitted: <Clock size={10} />,
    Rejected: <XCircle size={10} />,
    Active: <CheckCircle size={10} />,
  };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold ${styles[status] || 'bg-gray-50 text-gray-700'}`}>
      {icons[status] || <AlertCircle size={10} />} {status}
    </span>
  );
};

// ──────────────────────────────────────────────────────────────────────
// Customers view — auto-populated from every invoice (unique by tax_id).
// Shows: big searchable table + tag editor modal. Each row comes with
// invoice_count, total_amount, last_seen_at so you can spot top customers.
// ──────────────────────────────────────────────────────────────────────

interface CustomerRow {
  id: number;
  tax_id: string;
  name: string | null;
  party_type: string | null;
  country: string | null;
  governate: string | null;
  region_city: string | null;
  street: string | null;
  phone: string | null;
  email: string | null;
  tags: string[];
  notes: string | null;
  directions: string[];
  invoice_count: number;
  total_amount: number;
  first_seen_at: string | null;
  last_seen_at: string | null;
  manually_added: boolean;
}

const CustomersView: React.FC<{ onBack: () => void }> = ({ onBack }) => {
  const [rows, setRows] = useState<CustomerRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [pageNo, setPageNo] = useState(1);
  const [pageSize] = useState(25);
  const [q, setQ] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [directionFilter, setDirectionFilter] = useState<'' | 'Sent' | 'Received'>('');
  const [stats, setStats] = useState<{ totalCustomers: number; manuallyAdded: number; autoFromInvoices: number; topTags: Array<{ tag: string; n: number }> } | null>(null);
  const [selected, setSelected] = useState<CustomerRow | null>(null);
  const [backfilling, setBackfilling] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const qs = new URLSearchParams({ pageNo: String(pageNo), pageSize: String(pageSize) });
      if (q.trim()) qs.set('q', q.trim());
      if (tagFilter) qs.set('tag', tagFilter);
      if (directionFilter) qs.set('direction', directionFilter);
      const res = await fetch(`${API_URL}/master-data/customers?${qs.toString()}`, { headers: getAuthHeaders() });
      const d = await res.json();
      if (!d.success) throw new Error(d.message || 'Load failed');
      setRows(d.items || []);
      setTotal(d.total || 0);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }, [pageNo, pageSize, q, tagFilter, directionFilter]);

  const loadStats = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/master-data/customers/stats`, { headers: getAuthHeaders() });
      const d = await res.json();
      if (d.success) setStats(d);
    } catch { /* silent */ }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadStats(); }, [loadStats]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const handleBackfill = async () => {
    const ok = await confirmDialog({
      title: 'Rebuild master data',
      message: 'Scan all invoices and rebuild the customer master table?\n\nManual entries are preserved.',
      confirmLabel: 'Rebuild',
      tone: 'warning',
    });
    if (!ok) return;
    setBackfilling(true);
    try {
      const res = await fetch(`${API_URL}/master-data/customers/backfill`, { method: 'POST', headers: getAuthHeaders() });
      const d = await res.json();
      if (!d.success) throw new Error(d.message || 'Backfill failed');
      await alertDialog({
        title: 'Backfill complete',
        message: `Processed ${d.processed} invoices · ${d.uniqueCustomers} unique customers now in master.`,
        tone: 'success',
      });
      setPageNo(1);
      await load();
      await loadStats();
    } catch (e: any) {
      await alertDialog({ title: 'Backfill failed', message: 'Backfill failed: ' + e.message, tone: 'danger' });
    } finally {
      setBackfilling(false);
    }
  };

  const handleExport = () => {
    if (rows.length === 0) { void alertDialog({ title: 'Nothing to export', message: 'No rows on this page to export.', tone: 'info' }); return; }
    const sheet = rows.map(r => ({
      'Tax ID': r.tax_id,
      'Name': r.name || '',
      'Type': r.party_type || '',
      'Country': r.country || '',
      'Governate': r.governate || '',
      'City': r.region_city || '',
      'Phone': r.phone || '',
      'Email': r.email || '',
      'Directions': (r.directions || []).join(', '),
      'Tags': (r.tags || []).join(', '),
      'Notes': r.notes || '',
      'Invoice Count': num(r.invoice_count),
      'Total Amount': num(r.total_amount),
      'First Seen': fmtDate(r.first_seen_at),
      'Last Seen': fmtDate(r.last_seen_at),
      'Source': r.manually_added ? 'Manual' : 'Auto',
    }));
    exportExcel('Customers-MasterData', [{ name: 'Customers', rows: sheet }]);
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="p-2 rounded-lg hover:bg-gray-100 transition-colors">
          <ArrowLeft size={18} className="text-slate-600" />
        </button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
            <Users size={22} className="text-emerald-600" /> Customers Master
          </h1>
          <p className="text-slate-500 text-sm">Every customer you've ever invoiced (or been invoiced by). Unique by tax ID — duplicates are prevented automatically.</p>
        </div>
      </div>

      {/* Stats strip */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="soft-card p-4">
            <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Total Customers</div>
            <div className="text-2xl font-black text-slate-900 mt-1">{stats.totalCustomers}</div>
          </div>
          <div className="soft-card p-4">
            <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">From Invoices</div>
            <div className="text-2xl font-black text-emerald-700 mt-1">{stats.autoFromInvoices}</div>
          </div>
          <div className="soft-card p-4">
            <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Manually Added</div>
            <div className="text-2xl font-black text-blue-700 mt-1">{stats.manuallyAdded}</div>
          </div>
          <div className="soft-card p-4">
            <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Tags in Use</div>
            <div className="text-2xl font-black text-violet-700 mt-1">{stats.topTags.length}</div>
          </div>
        </div>
      )}

      {/* Controls */}
      <div className="glass-panel p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-1">Search</label>
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input value={q} onChange={e => { setQ(e.target.value); setPageNo(1); }} placeholder="Name, tax ID, phone, email…"
                className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500/30" />
            </div>
          </div>
          <div>
            <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-1">Direction</label>
            <select value={directionFilter} onChange={e => { setDirectionFilter(e.target.value as any); setPageNo(1); }}
              className="px-3 py-2 border border-gray-200 rounded-lg text-sm">
              <option value="">All</option>
              <option value="Sent">Customers (Sent)</option>
              <option value="Received">Suppliers (Received)</option>
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-1">Tag</label>
            <select value={tagFilter} onChange={e => { setTagFilter(e.target.value); setPageNo(1); }}
              className="px-3 py-2 border border-gray-200 rounded-lg text-sm min-w-[140px]">
              <option value="">All tags</option>
              {(stats?.topTags || []).map(t => (<option key={t.tag} value={t.tag}>{t.tag} ({t.n})</option>))}
            </select>
          </div>
          <button onClick={load} disabled={loading}
            className="flex items-center gap-1 px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm font-semibold hover:bg-gray-50 disabled:opacity-50">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
          <button onClick={handleExport}
            className="flex items-center gap-1 px-3 py-2 bg-emerald-600 text-white rounded-lg text-sm font-semibold hover:bg-emerald-700">
            <FileSpreadsheet size={14} /> Export
          </button>
          <button onClick={handleBackfill} disabled={backfilling}
            className="flex items-center gap-1 px-3 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50" title="Scan existing invoices and fill the master table">
            {backfilling ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} Backfill
          </button>
        </div>
      </div>

      {err && <div className="p-3 bg-red-50 border border-red-100 rounded-lg text-sm text-red-700 flex items-center gap-2"><AlertCircle size={14} /> {err}</div>}

      {/* Table */}
      <div className="glass-panel overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50/80">
                <th className="px-3 py-2 text-left text-[11px] font-bold text-slate-500 uppercase">Tax ID</th>
                <th className="px-3 py-2 text-left text-[11px] font-bold text-slate-500 uppercase">Name</th>
                <th className="px-3 py-2 text-left text-[11px] font-bold text-slate-500 uppercase">Type</th>
                <th className="px-3 py-2 text-left text-[11px] font-bold text-slate-500 uppercase">Location</th>
                <th className="px-3 py-2 text-left text-[11px] font-bold text-slate-500 uppercase">Contact</th>
                <th className="px-3 py-2 text-left text-[11px] font-bold text-slate-500 uppercase">Tags</th>
                <th className="px-3 py-2 text-right text-[11px] font-bold text-slate-500 uppercase">Invoices</th>
                <th className="px-3 py-2 text-right text-[11px] font-bold text-slate-500 uppercase">Total</th>
                <th className="px-3 py-2 text-left text-[11px] font-bold text-slate-500 uppercase">Last Seen</th>
                <th className="px-3 py-2 text-right text-[11px] font-bold text-slate-500 uppercase">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {loading && <tr><td colSpan={10} className="px-3 py-8 text-center text-slate-400">Loading…</td></tr>}
              {!loading && rows.length === 0 && (
                <tr><td colSpan={10} className="px-3 py-12 text-center text-slate-400">
                  <Users size={36} className="mx-auto mb-2 text-slate-300" />
                  <div>No customers yet.</div>
                  <div className="text-xs mt-1">Click <strong>Backfill</strong> to scan your existing invoices, or they'll auto-populate as you sync new ones.</div>
                </td></tr>
              )}
              {rows.map(r => (
                <tr key={r.id} className="hover:bg-gray-50/50">
                  <td className="px-3 py-2 font-mono text-xs">{r.tax_id}</td>
                  <td className="px-3 py-2 text-slate-800">{r.name || '—'}</td>
                  <td className="px-3 py-2">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                      r.party_type === 'B' ? 'bg-blue-50 text-blue-700' :
                      r.party_type === 'P' ? 'bg-violet-50 text-violet-700' :
                      r.party_type === 'F' ? 'bg-amber-50 text-amber-700' : 'bg-slate-50 text-slate-600'
                    }`}>{r.party_type || '—'}</span>
                    {r.directions?.map(d => (
                      <span key={d} className="ml-1 text-[10px] text-slate-500">{d === 'Sent' ? '↗' : '↙'}</span>
                    ))}
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-600">
                    {[r.region_city, r.governate, r.country].filter(Boolean).join(', ') || '—'}
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-600">
                    {r.phone && <div className="flex items-center gap-1"><Phone size={10} /> {r.phone}</div>}
                    {r.email && <div className="flex items-center gap-1"><Mail size={10} /> {r.email}</div>}
                    {!r.phone && !r.email && '—'}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1 max-w-xs">
                      {(r.tags || []).length === 0 && <span className="text-slate-300 text-xs">—</span>}
                      {(r.tags || []).slice(0, 4).map(t => (
                        <span key={t} className="text-[10px] font-semibold bg-violet-50 text-violet-700 px-2 py-0.5 rounded-full">{t}</span>
                      ))}
                      {(r.tags || []).length > 4 && <span className="text-[10px] text-slate-400">+{r.tags.length - 4}</span>}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right font-mono">{r.invoice_count}</td>
                  <td className="px-3 py-2 text-right font-mono text-emerald-700">{Number(r.total_amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                  <td className="px-3 py-2 text-xs text-slate-500">{fmtDate(r.last_seen_at)}</td>
                  <td className="px-3 py-2 text-right">
                    <button onClick={() => setSelected(r)}
                      className="inline-flex items-center gap-1 px-2 py-1 text-xs text-blue-600 hover:bg-blue-50 rounded">
                      <Edit size={12} /> Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-2 border-t border-gray-100 text-sm">
            <div className="text-slate-500">Page {pageNo} of {totalPages} · {total} customers</div>
            <div className="flex gap-2">
              <button onClick={() => setPageNo(p => Math.max(1, p - 1))} disabled={pageNo === 1}
                className="px-3 py-1 border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-gray-50">← Prev</button>
              <button onClick={() => setPageNo(p => Math.min(totalPages, p + 1))} disabled={pageNo === totalPages}
                className="px-3 py-1 border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-gray-50">Next →</button>
            </div>
          </div>
        )}
      </div>

      {/* Edit modal */}
      {selected && <EditCustomerModal customer={selected} onClose={() => setSelected(null)} onSaved={() => { setSelected(null); load(); loadStats(); }} />}
    </div>
  );
};

const EditCustomerModal: React.FC<{ customer: CustomerRow; onClose: () => void; onSaved: () => void }> = ({ customer, onClose, onSaved }) => {
  const [tags, setTags] = useState<string[]>(customer.tags || []);
  const [newTag, setNewTag] = useState('');
  const [notes, setNotes] = useState(customer.notes || '');
  const [phone, setPhone] = useState(customer.phone || '');
  const [email, setEmail] = useState(customer.email || '');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const addTag = () => {
    const t = newTag.trim();
    if (!t) return;
    if (tags.includes(t)) { setNewTag(''); return; }
    setTags([...tags, t]);
    setNewTag('');
  };

  const save = async () => {
    setSaving(true);
    setErr(null);
    try {
      const res = await fetch(`${API_URL}/master-data/customers/${customer.id}`, {
        method: 'PATCH',
        headers: getAuthHeaders(),
        body: JSON.stringify({ tags, notes, phone, email }),
      });
      const d = await res.json();
      if (!d.success) throw new Error(d.message || 'Save failed');
      onSaved();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg" onClick={e => e.stopPropagation()}>
        <div className="p-5 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h3 className="font-bold text-slate-800">{customer.name || customer.tax_id}</h3>
            <div className="text-xs text-slate-500 font-mono">Tax ID: {customer.tax_id}</div>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg"><X size={16} /></button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-600 uppercase mb-1">Tags</label>
            <div className="flex flex-wrap gap-1.5 mb-2 min-h-[28px] p-2 border border-gray-200 rounded-lg bg-gray-50/50">
              {tags.length === 0 && <span className="text-xs text-slate-400">No tags yet</span>}
              {tags.map(t => (
                <span key={t} className="flex items-center gap-1 text-xs font-semibold bg-violet-100 text-violet-800 px-2 py-0.5 rounded-full">
                  {t}
                  <button onClick={() => setTags(tags.filter(x => x !== t))} className="hover:bg-violet-200 rounded-full"><X size={10} /></button>
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <input value={newTag} onChange={e => setNewTag(e.target.value)} onKeyDown={e => e.key === 'Enter' && addTag()}
                placeholder="Add a tag (e.g. VIP, Wholesale, Delinquent)"
                className="flex-1 px-3 py-1.5 border border-gray-200 rounded-lg text-sm" />
              <button onClick={addTag} className="px-3 py-1.5 bg-violet-600 text-white rounded-lg text-sm font-semibold hover:bg-violet-700">Add</button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-600 uppercase mb-1">Phone</label>
              <input value={phone} onChange={e => setPhone(e.target.value)} className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-600 uppercase mb-1">Email</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-sm" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-600 uppercase mb-1">Notes</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
          </div>

          <div className="grid grid-cols-2 gap-3 text-xs text-slate-500 bg-gray-50 rounded-lg p-3">
            <div><strong>Invoices:</strong> {customer.invoice_count}</div>
            <div><strong>Total:</strong> {Number(customer.total_amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</div>
            <div><strong>First Seen:</strong> {fmtDate(customer.first_seen_at)}</div>
            <div><strong>Last Seen:</strong> {fmtDate(customer.last_seen_at)}</div>
          </div>

          {err && <div className="text-sm text-red-600 flex items-center gap-1"><AlertCircle size={14} /> {err}</div>}
        </div>

        <div className="p-4 border-t border-gray-100 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm font-semibold hover:bg-gray-50">Cancel</button>
          <button onClick={save} disabled={saving}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1">
            {saving && <Loader2 size={14} className="animate-spin" />} Save
          </button>
        </div>
      </div>
    </div>
  );
};

const MasterData: React.FC = () => {
  const { t } = useTranslation();
  const [view, setView] = useState<'menu' | 'items' | 'customers'>('menu');
  // Items-only view (Customers tab removed)
  const [items, setItems] = useState<any[]>([]);
  const [localCodes, setLocalCodes] = useState<any[]>([]);
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchType, setSearchType] = useState<'EGS' | 'GS1'>('EGS');
  const [showModal, setShowModal] = useState(false);
  const [editItem, setEditItem] = useState<any>(null);
  const [modalLoading, setModalLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  // Form state for creating/editing item
  const [formData, setFormData] = useState({
    codeType: 'EGS',
    parentCode: '',
    itemCode: '',
    codeName: '',
    codeNameAr: '',
    activeFrom: new Date().toISOString().split('T')[0],
    activeTo: '',
    description: '',
    descriptionAr: '',
    requestReason: '',
  });

  // Load data on mount
  useEffect(() => {
    loadLocalCodes();
    loadMyCodeRequests();
  }, []);

  // Load locally synced codes from DB
  const loadLocalCodes = async () => {
    try {
      const res = await fetch(`${API_URL}/eta/codes/local`, {
        headers: getAuthHeaders(),
      });
      const data = await res.json();
      if (data.success) {
        setLocalCodes(data.data || []);
      }
    } catch (err: any) {
      console.warn('Failed to load local codes:', err.message);
    }
  };

  const loadMyCodeRequests = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/eta/codes/search?codeType=${searchType}&pageSize=100`, {
        headers: getAuthHeaders(),
      });
      const data = await res.json();
      if (data.success) {
        setItems(data.result || data.data || []);
      } else {
        setItems([]);
      }
    } catch (err: any) {
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  // Sync codes from ETA portal to local DB
  const handleSyncFromPortal = async () => {
    setSyncing(true);
    setSyncMessage(null);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/eta/codes/sync`, {
        method: 'POST',
        headers: getAuthHeaders(),
      });
      const data = await res.json();
      if (data.success) {
        setSyncMessage(data.message || `Synced ${data.synced} codes`);
        loadLocalCodes(); // Refresh local codes
        loadMyCodeRequests(); // Also refresh portal codes
      } else {
        setError(data.message || 'Sync failed');
      }
    } catch (err: any) {
      setError(err.message || 'Sync failed');
    } finally {
      setSyncing(false);
    }
  };

  // Delete a local code
  const handleDeleteLocal = async (itemCode: string) => {
    const ok = await confirmDialog({
      title: 'Delete item code',
      message: `Remove item code "${itemCode}" from local database?`,
      confirmLabel: 'Remove',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      const res = await fetch(`${API_URL}/eta/codes/local/${encodeURIComponent(itemCode)}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      });
      const data = await res.json();
      if (data.success) {
        loadLocalCodes();
      }
    } catch (err: any) {
      console.error('Delete error:', err);
    }
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(
        `${API_URL}/eta/codes/search?codeType=${searchType}&codeLookupValue=${encodeURIComponent(searchQuery)}`,
        { headers: getAuthHeaders() }
      );
      const data = await res.json();
      if (data.success) {
        setSearchResults(data.result || data.data || []);
      }
    } catch (err: any) {
      console.error('Search error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateCode = async () => {
    setModalLoading(true);
    try {
      const payload = {
        items: [{
          codeType: formData.codeType,
          parentCode: formData.parentCode || undefined,
          itemCode: formData.itemCode,
          codeName: formData.codeName,
          codeNameAr: formData.codeNameAr || undefined,
          activeFrom: formData.activeFrom,
          activeTo: formData.activeTo || undefined,
          description: formData.description || undefined,
          descriptionAr: formData.descriptionAr || undefined,
          requestReason: formData.requestReason || undefined,
        }],
      };

      const res = await fetch(`${API_URL}/eta/codes`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (data.success) {
        setShowModal(false);
        resetForm();
        loadMyCodeRequests();
      } else {
        await alertDialog({ title: 'Create failed', message: data.message || 'Failed to create code', tone: 'danger' });
      }
    } catch (err: any) {
      await alertDialog({ title: 'Error', message: err.message, tone: 'danger' });
    } finally {
      setModalLoading(false);
    }
  };

  const handleUpdateCode = async () => {
    if (!editItem) return;
    setModalLoading(true);
    try {
      const res = await fetch(`${API_URL}/eta/codes/${editItem.codeUsageRequestId || editItem.id}`, {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          codeType: formData.codeType,
          itemCode: formData.itemCode,
          codeName: formData.codeName,
          codeNameAr: formData.codeNameAr,
          activeFrom: formData.activeFrom,
          activeTo: formData.activeTo,
          description: formData.description,
          requestReason: formData.requestReason,
        }),
      });

      const data = await res.json();
      if (data.success) {
        setShowModal(false);
        setEditItem(null);
        resetForm();
        loadMyCodeRequests();
      } else {
        await alertDialog({ title: 'Update failed', message: data.message || 'Failed to update code', tone: 'danger' });
      }
    } catch (err: any) {
      await alertDialog({ title: 'Error', message: err.message, tone: 'danger' });
    } finally {
      setModalLoading(false);
    }
  };

  const resetForm = () => {
    setFormData({
      codeType: 'EGS',
      parentCode: '',
      itemCode: '',
      codeName: '',
      codeNameAr: '',
      activeFrom: new Date().toISOString().split('T')[0],
      activeTo: '',
      description: '',
      descriptionAr: '',
      requestReason: '',
    });
  };

  const openEditModal = (item: any) => {
    setEditItem(item);
    setFormData({
      codeType: item.codeType || item.code_type || 'EGS',
      parentCode: item.parentCode || item.parent_code || '',
      itemCode: item.itemCode || item.item_code || '',
      codeName: item.codeName || item.code_name || '',
      codeNameAr: item.codeNameAr || item.code_name_ar || '',
      activeFrom: (item.activeFrom || item.active_from)?.split('T')[0] || '',
      activeTo: (item.activeTo || item.active_to)?.split('T')[0] || '',
      description: item.description || '',
      descriptionAr: item.descriptionAr || item.description_ar || '',
      requestReason: item.requestReason || '',
    });
    setShowModal(true);
  };

  const openCreateModal = () => {
    setEditItem(null);
    resetForm();
    setShowModal(true);
  };

  // ── Landing menu: pick which master-data area to open ──
  if (view === 'menu') {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-3">
            <Database className="text-blue-600" /> {t('masterdata.title')}
          </h1>
          <p className="text-slate-500 text-sm">Pick which master data you want to manage.</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <button onClick={() => setView('items')}
            className="text-left glass-panel p-6 hover:-translate-y-0.5 transition-all group">
            <div className="flex items-start justify-between mb-3">
              <div className="p-3 bg-blue-50 rounded-2xl group-hover:bg-blue-100 transition-colors">
                <Package size={24} className="text-blue-600" />
              </div>
              <ArrowRight size={18} className="text-slate-300 group-hover:text-blue-600 transition-colors" />
            </div>
            <h3 className="text-lg font-bold text-slate-800 mb-1">Items (GS1 / EGS)</h3>
            <p className="text-sm text-slate-500">Manage GS1 barcodes and Egyptian EGS item codes — request new ones from ETA, sync approvals, reuse existing codes.</p>
          </button>

          <button onClick={() => setView('customers')}
            className="text-left glass-panel p-6 hover:-translate-y-0.5 transition-all group">
            <div className="flex items-start justify-between mb-3">
              <div className="p-3 bg-emerald-50 rounded-2xl group-hover:bg-emerald-100 transition-colors">
                <Users size={24} className="text-emerald-600" />
              </div>
              <ArrowRight size={18} className="text-slate-300 group-hover:text-emerald-600 transition-colors" />
            </div>
            <h3 className="text-lg font-bold text-slate-800 mb-1">Customers</h3>
            <p className="text-sm text-slate-500">Grows automatically with every invoice — unique by tax ID. Tag customers, add notes, and export to Excel.</p>
          </button>
        </div>
      </div>
    );
  }

  // ── Customers view ──
  if (view === 'customers') {
    return <CustomersView onBack={() => setView('menu')} />;
  }

  // ── Items view (existing UI, unchanged) ──
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => setView('menu')} className="p-2 rounded-lg hover:bg-gray-100 transition-colors">
            <ArrowLeft size={18} className="text-slate-600" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-3">
              <Package className="text-blue-600" /> Items (GS1 / EGS)
            </h1>
            <p className="text-slate-500 text-sm">Maintain local cache of item mappings</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleSyncFromPortal}
            disabled={syncing}
            className="bg-emerald-600 text-white px-5 py-2 rounded-xl text-sm font-bold hover:bg-emerald-700 transition-all shadow-md flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {syncing ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
            {syncing ? 'Syncing...' : 'Sync from Portal'}
          </button>
          <button
            onClick={openCreateModal}
            className="bg-blue-600 text-white px-6 py-2 rounded-xl text-sm font-bold hover:bg-blue-700 transition-all shadow-md flex items-center gap-2"
          >
            <Plus size={18} /> Add Item Code
          </button>
        </div>
      </div>

      {/* Sync success message */}
      {syncMessage && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-sm text-emerald-700 flex items-center gap-2">
          <CheckCircle size={16} /> {syncMessage}
          <button onClick={() => setSyncMessage(null)} className="ml-auto p-0.5 hover:bg-emerald-100 rounded">
            <X size={14} />
          </button>
        </div>
      )}

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="flex border-b border-gray-100 bg-gray-50/50">
          <div className="px-8 py-4 text-sm font-bold flex items-center gap-2 text-blue-600 border-b-2 border-blue-600 bg-white">
            <Tag size={18} /> Item Mapping (GS1/EGS)
          </div>
        </div>

        {/* Search bar */}
        <div className="p-4 border-b border-gray-50 flex items-center gap-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              placeholder="Search item codes..."
              className="w-full pl-10 pr-4 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <select
            value={searchType}
            onChange={(e) => setSearchType(e.target.value as 'EGS' | 'GS1')}
            className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none"
          >
            <option value="EGS">EGS</option>
            <option value="GS1">GS1</option>
          </select>
          <button
            onClick={handleSearch}
            className="p-2 border border-gray-200 rounded-xl text-slate-400 hover:bg-gray-50"
          >
            <Filter size={18} />
          </button>
        </div>

        {/* Error message */}
        {error && (
          <div className="mx-4 mt-4 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700 flex items-center gap-2">
            <AlertCircle size={16} /> {error}
            <button onClick={() => setError(null)} className="ml-auto p-0.5 hover:bg-red-100 rounded">
              <X size={14} />
            </button>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="p-12 flex items-center justify-center gap-3 text-slate-400">
            <Loader2 size={20} className="animate-spin" /> Loading...
          </div>
        )}

        <div className="overflow-x-auto">
          <>
            {/* ── Synced Local Codes Section ── */}
            <div className="border-b border-gray-100">
              <div className="px-6 py-3 bg-emerald-50/50 flex items-center justify-between">
                <span className="text-[10px] font-bold text-emerald-600 uppercase tracking-widest flex items-center gap-2">
                  <Database size={12} /> Synced Item Codes ({localCodes.length})
                </span>
                <button
                  onClick={loadLocalCodes}
                  className="text-emerald-600 hover:text-emerald-700 p-1"
                  title="Refresh local codes"
                >
                  <RefreshCw size={12} />
                </button>
              </div>

              {localCodes.length > 0 ? (
                <table className="w-full text-left">
                  <thead>
                    <tr className="bg-emerald-50/30 text-[10px] font-bold text-emerald-600 uppercase tracking-widest">
                      <th className="px-6 py-3">Item Code</th>
                      <th className="px-6 py-3">Name (EN)</th>
                      <th className="px-6 py-3">Name (AR)</th>
                      <th className="px-6 py-3">Type</th>
                      <th className="px-6 py-3">Status</th>
                      <th className="px-6 py-3">Synced At</th>
                      <th className="px-6 py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50 text-sm">
                    {localCodes.map((c: any, i) => (
                      <tr key={i} className="hover:bg-emerald-50/20 group">
                        <td className="px-6 py-3 font-mono text-xs text-blue-600">{c.item_code}</td>
                        <td className="px-6 py-3 font-bold text-slate-800">{c.code_name || '-'}</td>
                        <td className="px-6 py-3 text-slate-600" dir="rtl">{c.code_name_ar || '-'}</td>
                        <td className="px-6 py-3">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${c.code_type === 'EGS' ? 'bg-indigo-50 text-indigo-700' : 'bg-amber-50 text-amber-700'}`}>
                            {c.code_type || 'EGS'}
                          </span>
                        </td>
                        <td className="px-6 py-3">{getStatusBadge(c.status || 'Submitted')}</td>
                        <td className="px-6 py-3 text-xs text-slate-400">
                          {c.synced_at ? new Date(c.synced_at).toLocaleDateString('en-GB') : '-'}
                        </td>
                        <td className="px-6 py-3 text-right flex items-center justify-end gap-1">
                          <button
                            onClick={() => openEditModal(c)}
                            className="p-1.5 opacity-0 group-hover:opacity-100 text-slate-400 hover:text-blue-600 transition-all"
                            title="Edit"
                          >
                            <Edit size={14} />
                          </button>
                          <button
                            onClick={() => handleDeleteLocal(c.item_code)}
                            className="p-1.5 opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-500 transition-all"
                            title="Remove from local DB"
                          >
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="px-6 py-8 text-center text-slate-400 text-sm">
                  No item codes synced yet. Click <strong>"Sync from Portal"</strong> to pull codes from the ETA portal.
                </div>
              )}
            </div>

            {/* ── Search Results Section ── */}
            {searchResults.length > 0 && (
              <div className="border-b border-gray-100">
                <div className="px-6 py-3 bg-blue-50">
                  <span className="text-[10px] font-bold text-blue-600 uppercase tracking-widest">
                    Search Results ({searchResults.length})
                  </span>
                </div>
                <table className="w-full text-left">
                  <thead>
                    <tr className="bg-blue-50/50 text-[10px] font-bold text-blue-500 uppercase tracking-widest">
                      <th className="px-6 py-3">Code</th>
                      <th className="px-6 py-3">Name</th>
                      <th className="px-6 py-3">Type</th>
                      <th className="px-6 py-3">Description</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50 text-sm">
                    {searchResults.slice(0, 10).map((r: any, i) => (
                      <tr key={i} className="hover:bg-blue-50/30">
                        <td className="px-6 py-3 font-mono text-xs text-blue-600">{r.codeLookupValue || r.itemCode}</td>
                        <td className="px-6 py-3 font-bold text-slate-800">{r.codeNamePrimaryLang || r.codeName}</td>
                        <td className="px-6 py-3">
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-50 text-indigo-700">
                            {r.codeTypeName || searchType}
                          </span>
                        </td>
                        <td className="px-6 py-3 text-slate-500 text-xs">{r.codeDescriptionPrimaryLang || r.description || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* ── My Code Requests (from Portal) ── */}
            <div className="px-6 py-3 bg-gray-50/50">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                Published Codes - Portal ({items.length})
              </span>
            </div>
            <table className="w-full text-left">
              <thead>
                <tr className="bg-gray-50 text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                  <th className="px-6 py-4">Item Code</th>
                  <th className="px-6 py-4">Code Name</th>
                  <th className="px-6 py-4">Type</th>
                  <th className="px-6 py-4">Status</th>
                  <th className="px-6 py-4">Active From</th>
                  <th className="px-6 py-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 text-sm">
                {!loading && items.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-6 py-12 text-center text-slate-400 text-sm">
                      No item codes registered yet. Click "Add Item Code" to create your first EGS code.
                    </td>
                  </tr>
                )}
                {items.map((it: any, i) => (
                  <tr key={i} className="hover:bg-gray-50 group">
                    <td className="px-6 py-4 font-mono text-xs text-blue-600">{it.codeLookupValue || it.itemCode || '-'}</td>
                    <td className="px-6 py-4 font-bold text-slate-800">{it.codeNamePrimaryLang || it.codeName || '-'}</td>
                    <td className="px-6 py-4">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${(it.codeTypeName || it.codeType) === 'EGS' ? 'bg-indigo-50 text-indigo-700' : 'bg-amber-50 text-amber-700'}`}>
                        {it.codeTypeName || it.codeType || searchType}
                      </span>
                    </td>
                    <td className="px-6 py-4">{getStatusBadge(it.status || it.activeStatus || 'Active')}</td>
                    <td className="px-6 py-4 text-xs text-slate-500">{(it.activeFrom || it.activationDate)?.split('T')[0] || '-'}</td>
                    <td className="px-6 py-4 text-right flex items-center justify-end gap-1">
                      {(it.status === 'Submitted' || !it.status) && (
                        <button
                          onClick={() => openEditModal(it)}
                          className="p-1.5 opacity-0 group-hover:opacity-100 text-slate-400 hover:text-blue-600 transition-all"
                          title="Edit (only while Submitted)"
                        >
                          <Edit size={16} />
                        </button>
                      )}
                      <button className="p-1.5 opacity-0 group-hover:opacity-100 text-slate-400 hover:text-blue-600 transition-all">
                        <ExternalLink size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        </div>
      </div>

      {/* ── Create/Edit Item Code Modal ── */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-6 border-b border-gray-100">
              <h3 className="text-lg font-bold text-slate-800">
                {editItem ? 'Update Item Code' : 'Register New Item Code'}
              </h3>
              <button onClick={() => { setShowModal(false); setEditItem(null); }} className="p-1 hover:bg-gray-100 rounded-lg">
                <X size={20} className="text-slate-400" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              {/* Code Type */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-500 uppercase">Code Type</label>
                  <select
                    value={formData.codeType}
                    onChange={(e) => setFormData({ ...formData, codeType: e.target.value })}
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="EGS">EGS (Internal Code)</option>
                    <option value="GS1">GS1 (Standard Code)</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-500 uppercase">Item Code *</label>
                  <input
                    type="text"
                    value={formData.itemCode}
                    onChange={(e) => setFormData({ ...formData, itemCode: e.target.value })}
                    placeholder="e.g. EG-100023456-001"
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              {/* Parent Code */}
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-500 uppercase">Parent Code (GS1 Reference)</label>
                <input
                  type="text"
                  value={formData.parentCode}
                  onChange={(e) => setFormData({ ...formData, parentCode: e.target.value })}
                  placeholder="Optional GS1 parent code"
                  className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* Code Names */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-500 uppercase">Code Name (English) *</label>
                  <input
                    type="text"
                    value={formData.codeName}
                    onChange={(e) => setFormData({ ...formData, codeName: e.target.value })}
                    placeholder="Product name in English"
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-500 uppercase">Code Name (Arabic)</label>
                  <input
                    type="text"
                    dir="rtl"
                    value={formData.codeNameAr}
                    onChange={(e) => setFormData({ ...formData, codeNameAr: e.target.value })}
                    placeholder="اسم المنتج بالعربية"
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              {/* Descriptions */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-500 uppercase">Description (English)</label>
                  <textarea
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    placeholder="Optional description"
                    rows={2}
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-500 uppercase">Description (Arabic)</label>
                  <textarea
                    dir="rtl"
                    value={formData.descriptionAr}
                    onChange={(e) => setFormData({ ...formData, descriptionAr: e.target.value })}
                    placeholder="وصف اختياري"
                    rows={2}
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                  />
                </div>
              </div>

              {/* Active dates */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-500 uppercase">Active From *</label>
                  <input
                    type="date"
                    value={formData.activeFrom}
                    onChange={(e) => setFormData({ ...formData, activeFrom: e.target.value })}
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-500 uppercase">Active To</label>
                  <input
                    type="date"
                    value={formData.activeTo}
                    onChange={(e) => setFormData({ ...formData, activeTo: e.target.value })}
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              {/* Request Reason */}
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-500 uppercase">Request Reason</label>
                <input
                  type="text"
                  value={formData.requestReason}
                  onChange={(e) => setFormData({ ...formData, requestReason: e.target.value })}
                  placeholder="Why are you registering this code?"
                  className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 p-6 border-t border-gray-100">
              <button
                onClick={() => { setShowModal(false); setEditItem(null); }}
                className="px-5 py-2 rounded-xl text-sm font-bold text-slate-600 hover:bg-gray-100 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={editItem ? handleUpdateCode : handleCreateCode}
                disabled={modalLoading || !formData.itemCode || !formData.codeName || !formData.activeFrom}
                className="px-6 py-2 rounded-xl text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 transition-colors shadow-md disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {modalLoading && <Loader2 size={14} className="animate-spin" />}
                {editItem ? 'Update Code' : 'Submit Code Request'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MasterData;
