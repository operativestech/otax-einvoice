import React, { useState, useEffect } from 'react';
import { Building2, Plus, Search, Loader2, X, Check, Users, FileText, ToggleLeft, ToggleRight, ChevronDown, ChevronUp, BarChart3, Settings, AlertTriangle } from 'lucide-react';
import PasswordInput from '../components/PasswordInput';
import { confirmDialog } from '../components/ConfirmDialog';

interface OrgSubscription {
    plan: string;
    max_users: number;
    max_invoices_per_month: number;
    max_storage_gb: number;
    status: string;
}

interface OrgData {
    id: number;
    name: string;
    tax_id: string;
    email?: string;
    phone?: string;
    country?: string;
    city?: string;
    is_active: boolean;
    subscription_plan?: string;
    created_at?: string;
    userCount: number;
    documentCount: number;
    subscription?: OrgSubscription;
}

const getAuthHeaders = () => {
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

const API_URL = (() => {
    const hostname = window.location.hostname;
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname.startsWith('192.168.') || hostname.startsWith('10.')) return '/api';
    return 'https://e-invoice-545y.onrender.com/api';
})();

// Usage bar component
const UsageBar: React.FC<{ used: number; max: number; label: string; unit?: string }> = ({ used, max, label, unit = '' }) => {
    const pct = max > 0 ? Math.min((used / max) * 100, 100) : 0;
    const isWarning = pct > 80;
    const isDanger = pct > 95;

    return (
        <div>
            <div className="flex justify-between items-center mb-1">
                <span className="text-xs font-medium text-slate-600">{label}</span>
                <span className={`text-xs font-bold ${isDanger ? 'text-red-600' : isWarning ? 'text-amber-600' : 'text-slate-700'}`}>
                    {used}{unit} / {max}{unit}
                </span>
            </div>
            <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                <div
                    className={`h-full rounded-full transition-all duration-500 ${isDanger ? 'bg-red-500' : isWarning ? 'bg-amber-500' : 'bg-blue-500'}`}
                    style={{ width: `${pct}%` }}
                />
            </div>
        </div>
    );
};

const SuperAdminOrganizations: React.FC = () => {
    const [organizations, setOrganizations] = useState<OrgData[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState('all');
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [editingLimits, setEditingLimits] = useState<number | null>(null);
    const [expandedOrg, setExpandedOrg] = useState<number | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [successMsg, setSuccessMsg] = useState<string | null>(null);
    const [stats, setStats] = useState<any>(null);

    // Limits edit state
    const [limitsForm, setLimitsForm] = useState({ max_users: 10, max_invoices_per_month: 500, max_storage_gb: 10, plan: 'professional' });

    // Create form
    const [createForm, setCreateForm] = useState({
        name: '', tax_id: '', email: '', phone: '', company_type: 'B',
        country: 'Egypt', governorate: '', city: '',
        subscription_plan: 'free', admin_username: '', admin_password: '',
    });

    const fetchOrgs = async () => {
        try {
            setLoading(true);
            const params = new URLSearchParams();
            if (search) params.set('search', search);
            if (statusFilter !== 'all') params.set('status', statusFilter);
            const res = await fetch(`${API_URL}/super-admin/organizations?${params}`, { headers: getAuthHeaders() });
            const data = await res.json();
            if (data.success) setOrganizations(data.organizations || []);
        } catch {
            setError('Failed to load organizations');
        } finally {
            setLoading(false);
        }
    };

    const fetchStats = async () => {
        try {
            const res = await fetch(`${API_URL}/super-admin/stats`, { headers: getAuthHeaders() });
            const data = await res.json();
            if (data.success) setStats(data.stats);
        } catch { }
    };

    useEffect(() => { fetchOrgs(); fetchStats(); }, []);
    useEffect(() => { fetchOrgs(); }, [search, statusFilter]);

    const handleToggleActive = async (orgId: number) => {
        try {
            const res = await fetch(`${API_URL}/super-admin/organizations/${orgId}/toggle-active`, {
                method: 'PUT', headers: getAuthHeaders(),
            });
            const data = await res.json();
            if (data.success) { setSuccessMsg(data.message); fetchOrgs(); fetchStats(); }
            else setError(data.message);
        } catch { setError('Failed to toggle organization status'); }
    };

    const handleUpdateLimits = async (orgId: number) => {
        try {
            const res = await fetch(`${API_URL}/super-admin/organizations/${orgId}/subscription`, {
                method: 'PUT', headers: getAuthHeaders(),
                body: JSON.stringify(limitsForm),
            });
            const data = await res.json();
            if (data.success) {
                setSuccessMsg('Subscription limits updated');
                setEditingLimits(null);
                fetchOrgs();
            } else setError(data.message || 'Failed to update');
        } catch { setError('Failed to update limits'); }
    };

    const handleCreateOrg = async () => {
        if (!createForm.name || !createForm.tax_id || !createForm.admin_username || !createForm.admin_password) {
            setError('Organization name, Tax ID, admin username and password are required');
            return;
        }
        try {
            const res = await fetch(`${API_URL}/super-admin/organizations`, {
                method: 'POST', headers: getAuthHeaders(),
                body: JSON.stringify(createForm),
            });
            const data = await res.json();
            if (data.success) {
                setSuccessMsg(`Organization "${createForm.name}" created with admin: ${createForm.admin_username}`);
                setShowCreateModal(false);
                setCreateForm({ name: '', tax_id: '', email: '', phone: '', company_type: 'B', country: 'Egypt', governorate: '', city: '', subscription_plan: 'free', admin_username: '', admin_password: '' });
                fetchOrgs(); fetchStats();
            } else setError(data.message || 'Failed to create organization');
        } catch { setError('Failed to create organization'); }
    };

    const handleDeleteOrg = async (orgId: number, orgName: string) => {
        const ok = await confirmDialog({
            title: 'Delete organization',
            message: `Are you sure you want to delete "${orgName}"?\n\nThis will permanently delete all users and data for this org.`,
            confirmLabel: 'Delete',
            tone: 'danger',
        });
        if (!ok) return;
        try {
            const res = await fetch(`${API_URL}/super-admin/organizations/${orgId}`, {
                method: 'DELETE', headers: getAuthHeaders(),
            });
            const data = await res.json();
            if (data.success) { setSuccessMsg('Organization deleted'); fetchOrgs(); fetchStats(); }
            else setError(data.message || 'Failed to delete');
        } catch { setError('Failed to delete organization'); }
    };

    const openLimitsEditor = (org: OrgData) => {
        setLimitsForm({
            max_users: org.subscription?.max_users || 10,
            max_invoices_per_month: org.subscription?.max_invoices_per_month || 500,
            max_storage_gb: org.subscription?.max_storage_gb || 10,
            plan: org.subscription_plan || 'free',
        });
        setEditingLimits(org.id);
    };

    // Auto-dismiss messages
    useEffect(() => { if (successMsg) { const t = setTimeout(() => setSuccessMsg(null), 3000); return () => clearTimeout(t); } }, [successMsg]);
    useEffect(() => { if (error) { const t = setTimeout(() => setError(null), 5000); return () => clearTimeout(t); } }, [error]);

    const planColors: Record<string, string> = {
        free: 'bg-slate-100 text-slate-600',
        starter: 'bg-green-100 text-green-700',
        professional: 'bg-blue-100 text-blue-700',
        enterprise: 'bg-purple-100 text-purple-700',
    };

    return (
        <div className="max-w-7xl mx-auto">
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-3">
                        <Building2 className="text-blue-600" size={28} />
                        Organizations
                    </h1>
                    <p className="text-sm text-slate-500 mt-1">Manage all organizations on the platform</p>
                </div>
                <button
                    onClick={() => setShowCreateModal(true)}
                    className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2.5 rounded-xl font-semibold text-sm hover:bg-blue-700 transition-colors shadow-lg shadow-blue-200"
                >
                    <Plus size={18} /> Add Organization
                </button>
            </div>

            {/* Platform Stats */}
            {stats && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                    {[
                        { label: 'Total Orgs', value: stats.totalOrganizations, icon: <Building2 size={20} />, color: 'bg-blue-100 text-blue-600' },
                        { label: 'Active', value: stats.activeOrganizations, icon: <Check size={20} />, color: 'bg-emerald-100 text-emerald-600' },
                        { label: 'Total Users', value: stats.totalUsers, icon: <Users size={20} />, color: 'bg-purple-100 text-purple-600' },
                        { label: 'Total Invoices', value: stats.totalDocuments, icon: <FileText size={20} />, color: 'bg-blue-100 text-blue-600' },
                    ].map((card, i) => (
                        <div key={i} className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
                            <div className="flex items-center gap-3">
                                <div className={`w-10 h-10 ${card.color} rounded-lg flex items-center justify-center`}>{card.icon}</div>
                                <div>
                                    <p className="text-2xl font-bold text-slate-800">{card.value ?? 0}</p>
                                    <p className="text-xs text-slate-500">{card.label}</p>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Messages */}
            {error && (
                <div className="mb-4 p-3 bg-red-50 border border-red-100 rounded-xl text-red-600 text-sm font-medium flex items-center gap-2">
                    <X size={16} /> {error}
                </div>
            )}
            {successMsg && (
                <div className="mb-4 p-3 bg-emerald-50 border border-emerald-100 rounded-xl text-emerald-600 text-sm font-medium flex items-center gap-2">
                    <Check size={16} /> {successMsg}
                </div>
            )}

            {/* Search & Filter */}
            <div className="flex gap-3 mb-4">
                <div className="relative flex-1">
                    <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input type="text" placeholder="Search organizations..." value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-xl bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                    />
                </div>
                <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
                    className="border border-gray-200 rounded-xl px-4 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20">
                    <option value="all">All Status</option>
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                </select>
            </div>

            {/* Organizations Table */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                {loading ? (
                    <div className="flex items-center justify-center py-20">
                        <Loader2 size={32} className="animate-spin text-blue-500" />
                    </div>
                ) : organizations.length === 0 ? (
                    <div className="text-center py-20 text-slate-400">
                        <Building2 size={48} className="mx-auto mb-3 opacity-30" />
                        <p className="font-medium">No organizations found</p>
                    </div>
                ) : (
                    <table className="w-full">
                        <thead className="bg-slate-50 border-b border-gray-100">
                            <tr>
                                <th className="w-8"></th>
                                <th className="text-left py-3 px-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Organization</th>
                                <th className="text-left py-3 px-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Tax ID</th>
                                <th className="text-center py-3 px-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Plan</th>
                                <th className="text-center py-3 px-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Users</th>
                                <th className="text-center py-3 px-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Invoices</th>
                                <th className="text-center py-3 px-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Status</th>
                                <th className="text-right py-3 px-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                            {organizations.map((org) => {
                                const isExpanded = expandedOrg === org.id;
                                const maxUsers = org.subscription?.max_users || 999;
                                const maxInvoices = org.subscription?.max_invoices_per_month || 999;
                                const userPct = (org.userCount / maxUsers) * 100;

                                return (
                                    <React.Fragment key={org.id}>
                                        {/* Main Row */}
                                        <tr className={`hover:bg-blue-50/30 transition-colors cursor-pointer ${isExpanded ? 'bg-blue-50/20' : ''}`}
                                            onClick={() => setExpandedOrg(isExpanded ? null : org.id)}>
                                            <td className="pl-3 py-3">
                                                <button className="text-slate-400 hover:text-slate-600 transition-colors">
                                                    {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                                                </button>
                                            </td>
                                            <td className="py-3 px-4">
                                                <div className="flex items-center gap-3">
                                                    <div className="w-9 h-9 bg-blue-100 text-blue-600 rounded-lg flex items-center justify-center font-bold text-sm">
                                                        {org.name?.[0]?.toUpperCase() || '?'}
                                                    </div>
                                                    <div>
                                                        <span className="font-semibold text-sm text-slate-800 block">{org.name}</span>
                                                        {org.email && <span className="text-[11px] text-slate-400">{org.email}</span>}
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="py-3 px-4">
                                                <span className="text-sm text-slate-600 font-mono">{org.tax_id}</span>
                                            </td>
                                            <td className="py-3 px-4 text-center">
                                                <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full uppercase ${planColors[org.subscription_plan || 'free'] || planColors.free}`}>
                                                    {org.subscription_plan || 'Free'}
                                                </span>
                                            </td>
                                            <td className="py-3 px-4 text-center">
                                                <div className="flex items-center justify-center gap-1">
                                                    <span className={`text-sm font-semibold ${userPct > 90 ? 'text-red-600' : 'text-slate-700'}`}>{org.userCount}</span>
                                                    <span className="text-[10px] text-slate-400">/ {maxUsers}</span>
                                                    {userPct > 90 && <AlertTriangle size={12} className="text-red-500" />}
                                                </div>
                                            </td>
                                            <td className="py-3 px-4 text-center">
                                                <span className="text-sm font-semibold text-slate-700">{org.documentCount}</span>
                                            </td>
                                            <td className="py-3 px-4 text-center">
                                                <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${org.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                                                    <span className={`w-1.5 h-1.5 rounded-full ${org.is_active ? 'bg-emerald-500' : 'bg-red-400'}`} />
                                                    {org.is_active ? 'Active' : 'Inactive'}
                                                </span>
                                            </td>
                                            <td className="py-3 px-4" onClick={e => e.stopPropagation()}>
                                                <div className="flex items-center justify-end gap-1">
                                                    <button onClick={() => openLimitsEditor(org)}
                                                        className="p-1.5 rounded-lg hover:bg-blue-50 text-slate-400 hover:text-blue-600 transition-colors" title="Edit Limits">
                                                        <Settings size={16} />
                                                    </button>
                                                    <button onClick={() => handleToggleActive(org.id)}
                                                        className={`p-1.5 rounded-lg transition-colors ${org.is_active ? 'hover:bg-red-50 text-slate-400 hover:text-red-600' : 'hover:bg-emerald-50 text-slate-400 hover:text-emerald-600'}`}
                                                        title={org.is_active ? 'Deactivate' : 'Activate'}>
                                                        {org.is_active ? <ToggleRight size={18} className="text-emerald-500" /> : <ToggleLeft size={18} />}
                                                    </button>
                                                    <button onClick={() => handleDeleteOrg(org.id, org.name)}
                                                        className="p-1.5 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-600 transition-colors" title="Delete">
                                                        <X size={16} />
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>

                                        {/* Expanded Detail Row */}
                                        {isExpanded && (
                                            <tr>
                                                <td colSpan={8} className="bg-slate-50/50 px-6 py-4 border-b border-gray-100">
                                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                                        {/* Usage Stats */}
                                                        <div className="bg-white rounded-xl border border-gray-100 p-4">
                                                            <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3 flex items-center gap-2">
                                                                <BarChart3 size={14} /> Usage & Limits
                                                            </h4>
                                                            <div className="space-y-3">
                                                                <UsageBar used={org.userCount} max={maxUsers} label="Users" />
                                                                <UsageBar used={org.documentCount} max={maxInvoices} label="Invoices / Month" />
                                                                <UsageBar used={0} max={org.subscription?.max_storage_gb || 10} label="Storage" unit=" GB" />
                                                            </div>
                                                        </div>

                                                        {/* Subscription Info */}
                                                        <div className="bg-white rounded-xl border border-gray-100 p-4">
                                                            <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3 flex items-center gap-2">
                                                                <FileText size={14} /> Subscription
                                                            </h4>
                                                            <div className="space-y-2 text-sm">
                                                                <div className="flex justify-between">
                                                                    <span className="text-slate-500">Plan</span>
                                                                    <span className={`font-bold text-xs px-2 py-0.5 rounded-full ${planColors[org.subscription_plan || 'free']}`}>
                                                                        {(org.subscription_plan || 'free').toUpperCase()}
                                                                    </span>
                                                                </div>
                                                                <div className="flex justify-between">
                                                                    <span className="text-slate-500">Max Users</span>
                                                                    <span className="font-semibold text-slate-800">{maxUsers}</span>
                                                                </div>
                                                                <div className="flex justify-between">
                                                                    <span className="text-slate-500">Max Invoices/mo</span>
                                                                    <span className="font-semibold text-slate-800">{maxInvoices.toLocaleString()}</span>
                                                                </div>
                                                                <div className="flex justify-between">
                                                                    <span className="text-slate-500">Storage</span>
                                                                    <span className="font-semibold text-slate-800">{org.subscription?.max_storage_gb || 10} GB</span>
                                                                </div>
                                                                <div className="flex justify-between">
                                                                    <span className="text-slate-500">Status</span>
                                                                    <span className={`font-semibold ${org.subscription?.status === 'active' ? 'text-emerald-600' : 'text-slate-600'}`}>
                                                                        {org.subscription?.status || 'active'}
                                                                    </span>
                                                                </div>
                                                            </div>
                                                        </div>

                                                        {/* Org Details */}
                                                        <div className="bg-white rounded-xl border border-gray-100 p-4">
                                                            <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3 flex items-center gap-2">
                                                                <Building2 size={14} /> Details
                                                            </h4>
                                                            <div className="space-y-2 text-sm">
                                                                <div className="flex justify-between">
                                                                    <span className="text-slate-500">Tax ID</span>
                                                                    <span className="font-mono font-semibold text-slate-800">{org.tax_id}</span>
                                                                </div>
                                                                {org.email && (
                                                                    <div className="flex justify-between">
                                                                        <span className="text-slate-500">Email</span>
                                                                        <span className="text-slate-800">{org.email}</span>
                                                                    </div>
                                                                )}
                                                                {org.phone && (
                                                                    <div className="flex justify-between">
                                                                        <span className="text-slate-500">Phone</span>
                                                                        <span className="text-slate-800">{org.phone}</span>
                                                                    </div>
                                                                )}
                                                                <div className="flex justify-between">
                                                                    <span className="text-slate-500">Location</span>
                                                                    <span className="text-slate-800">{[org.city, org.country].filter(Boolean).join(', ') || '—'}</span>
                                                                </div>
                                                                <div className="flex justify-between">
                                                                    <span className="text-slate-500">Created</span>
                                                                    <span className="text-slate-800">{org.created_at ? new Date(org.created_at).toLocaleDateString() : '—'}</span>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </td>
                                            </tr>
                                        )}
                                    </React.Fragment>
                                );
                            })}
                        </tbody>
                    </table>
                )}
            </div>

            {/* Edit Limits Modal */}
            {editingLimits && (
                <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={() => setEditingLimits(null)}>
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6" onClick={e => e.stopPropagation()}>
                        <h2 className="text-lg font-bold text-slate-800 mb-1 flex items-center gap-2">
                            <Settings size={20} className="text-blue-600" /> Edit Subscription Limits
                        </h2>
                        <p className="text-xs text-slate-500 mb-4">
                            {organizations.find(o => o.id === editingLimits)?.name}
                        </p>

                        <div className="space-y-4">
                            <div>
                                <label className="text-xs font-bold text-slate-500 uppercase block mb-1">Plan</label>
                                <select value={limitsForm.plan} onChange={e => setLimitsForm({ ...limitsForm, plan: e.target.value })}
                                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500">
                                    <option value="free">Free</option>
                                    <option value="starter">Starter</option>
                                    <option value="professional">Professional</option>
                                    <option value="enterprise">Enterprise</option>
                                </select>
                            </div>
                            <div>
                                <label className="text-xs font-bold text-slate-500 uppercase block mb-1">Max Users</label>
                                <input type="number" value={limitsForm.max_users} onChange={e => setLimitsForm({ ...limitsForm, max_users: Number(e.target.value) })}
                                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500" />
                            </div>
                            <div>
                                <label className="text-xs font-bold text-slate-500 uppercase block mb-1">Max Invoices / Month</label>
                                <input type="number" value={limitsForm.max_invoices_per_month} onChange={e => setLimitsForm({ ...limitsForm, max_invoices_per_month: Number(e.target.value) })}
                                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500" />
                            </div>
                            <div>
                                <label className="text-xs font-bold text-slate-500 uppercase block mb-1">Max Storage (GB)</label>
                                <input type="number" value={limitsForm.max_storage_gb} onChange={e => setLimitsForm({ ...limitsForm, max_storage_gb: Number(e.target.value) })}
                                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500" />
                            </div>
                        </div>

                        <div className="flex gap-3 mt-6">
                            <button onClick={() => setEditingLimits(null)}
                                className="flex-1 py-2.5 rounded-xl border border-gray-200 text-slate-600 font-medium text-sm hover:bg-gray-50 transition-colors">
                                Cancel
                            </button>
                            <button onClick={() => handleUpdateLimits(editingLimits)}
                                className="flex-1 py-2.5 rounded-xl bg-blue-600 text-white font-semibold text-sm hover:bg-blue-700 transition-colors">
                                Save Limits
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Create Organization Modal */}
            {showCreateModal && (
                <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 overflow-y-auto py-8" onClick={() => setShowCreateModal(false)}>
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 p-6" onClick={e => e.stopPropagation()}>
                        <h2 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
                            <Building2 size={20} className="text-blue-600" /> Create New Organization
                        </h2>

                        <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-2">
                            {/* Org Details */}
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="text-xs font-bold text-slate-500 uppercase block mb-1">Organization Name *</label>
                                    <input type="text" value={createForm.name} onChange={e => setCreateForm({ ...createForm, name: e.target.value })}
                                        className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500" placeholder="Company Name" />
                                </div>
                                <div>
                                    <label className="text-xs font-bold text-slate-500 uppercase block mb-1">Tax ID *</label>
                                    <input type="text" value={createForm.tax_id} onChange={e => setCreateForm({ ...createForm, tax_id: e.target.value })}
                                        className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500" placeholder="000-000-000" />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="text-xs font-bold text-slate-500 uppercase block mb-1">Email</label>
                                    <input type="email" value={createForm.email} onChange={e => setCreateForm({ ...createForm, email: e.target.value })}
                                        className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500" placeholder="admin@company.com" />
                                </div>
                                <div>
                                    <label className="text-xs font-bold text-slate-500 uppercase block mb-1">Phone</label>
                                    <input type="text" value={createForm.phone} onChange={e => setCreateForm({ ...createForm, phone: e.target.value })}
                                        className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500" placeholder="+20 xxx xxx xxxx" />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="text-xs font-bold text-slate-500 uppercase block mb-1">Country</label>
                                    <input type="text" value={createForm.country} onChange={e => setCreateForm({ ...createForm, country: e.target.value })}
                                        className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500" placeholder="Egypt" />
                                </div>
                                <div>
                                    <label className="text-xs font-bold text-slate-500 uppercase block mb-1">City</label>
                                    <input type="text" value={createForm.city} onChange={e => setCreateForm({ ...createForm, city: e.target.value })}
                                        className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500" placeholder="Cairo" />
                                </div>
                            </div>

                            {/* Plan Selection */}
                            <div>
                                <label className="text-xs font-bold text-slate-500 uppercase block mb-1">Subscription Plan</label>
                                <select value={createForm.subscription_plan} onChange={e => setCreateForm({ ...createForm, subscription_plan: e.target.value })}
                                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500">
                                    <option value="free">Free — 3 users, 50 inv/mo</option>
                                    <option value="starter">Starter — 5 users, 200 inv/mo</option>
                                    <option value="professional">Professional — 15 users, 1,000 inv/mo</option>
                                    <option value="enterprise">Enterprise — 999 users, unlimited inv</option>
                                </select>
                            </div>

                            {/* Org Admin Account */}
                            <div className="border-t border-gray-100 pt-4 mt-2">
                                <p className="text-xs font-bold text-blue-600 uppercase mb-3 flex items-center gap-1.5">
                                    <Users size={14} /> Organization Admin (First User)
                                </p>
                                <p className="text-[11px] text-slate-400 mb-3">This user will be the org_admin for this organization and can manage users within it.</p>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="text-xs font-bold text-slate-500 uppercase block mb-1">Admin Username *</label>
                                        <input type="text" value={createForm.admin_username} onChange={e => setCreateForm({ ...createForm, admin_username: e.target.value })}
                                            className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500" placeholder="orgadmin" />
                                    </div>
                                    <div>
                                        <label className="text-xs font-bold text-slate-500 uppercase block mb-1">Admin Password *</label>
                                        <PasswordInput value={createForm.admin_password} onChange={e => setCreateForm({ ...createForm, admin_password: e.target.value })}
                                            className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500" placeholder="••••••••" />
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="flex gap-3 mt-6">
                            <button onClick={() => setShowCreateModal(false)}
                                className="flex-1 py-2.5 rounded-xl border border-gray-200 text-slate-600 font-medium text-sm hover:bg-gray-50 transition-colors">
                                Cancel
                            </button>
                            <button onClick={handleCreateOrg}
                                className="flex-1 py-2.5 rounded-xl bg-blue-600 text-white font-semibold text-sm hover:bg-blue-700 transition-colors">
                                Create Organization
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default SuperAdminOrganizations;
