
import React, { useState, useEffect } from 'react';
import { CreditCard, Building2, Users, FileText, HardDrive, Edit2, Check, X } from 'lucide-react';

const API_URL = (() => {
    const hostname = window.location.hostname;
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname.startsWith('192.168.') || hostname.startsWith('10.')) return '/api';
    return 'https://e-invoice-545y.onrender.com/api';
})();

interface Plan {
    id: string;
    name: string;
    max_users: number;
    max_invoices_per_month: number;
    max_storage_gb: number;
    price_per_month: number;
    features: string[];
}

interface OrgSubscription {
    id: number;
    orgName: string;
    orgId: number;
    plan: string;
    status: string;
    max_users: number;
    max_invoices_per_month: number;
    starts_at: string;
    expires_at: string | null;
}

const SuperAdminPlans: React.FC = () => {
    const [plans, setPlans] = useState<Plan[]>([]);
    const [orgs, setOrgs] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [editingOrg, setEditingOrg] = useState<number | null>(null);
    const [editPlan, setEditPlan] = useState('');
    const [editMaxUsers, setEditMaxUsers] = useState(0);
    const [editMaxInvoices, setEditMaxInvoices] = useState(0);
    const [saving, setSaving] = useState(false);

    const token = localStorage.getItem('token');

    const fetchData = async () => {
        try {
            const [plansRes, orgsRes] = await Promise.all([
                fetch(`${API_URL}/super-admin/plans`, { headers: { Authorization: `Bearer ${token}` } }),
                fetch(`${API_URL}/super-admin/organizations?limit=100`, { headers: { Authorization: `Bearer ${token}` } }),
            ]);
            const plansData = await plansRes.json();
            const orgsData = await orgsRes.json();
            if (plansData.success) setPlans(plansData.plans);
            if (orgsData.success) setOrgs(orgsData.organizations || []);
        } catch (err) {
            console.error('Failed to load plans:', err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchData(); }, []);

    const startEdit = (org: any) => {
        setEditingOrg(org.id);
        setEditPlan(org.subscription?.plan || 'free');
        setEditMaxUsers(org.subscription?.max_users || 3);
        setEditMaxInvoices(org.subscription?.max_invoices_per_month || 50);
    };

    const saveSub = async (orgId: number) => {
        setSaving(true);
        try {
            await fetch(`${API_URL}/super-admin/organizations/${orgId}/subscription`, {
                method: 'PUT',
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ plan: editPlan, max_users: editMaxUsers, max_invoices_per_month: editMaxInvoices }),
            });
            setEditingOrg(null);
            fetchData();
        } catch (err) {
            console.error('Save failed:', err);
        } finally {
            setSaving(false);
        }
    };

    const planColors: Record<string, string> = {
        free: 'bg-gray-100 text-gray-700',
        starter: 'bg-blue-100 text-blue-700',
        professional: 'bg-purple-100 text-purple-700',
        enterprise: 'bg-amber-100 text-amber-700',
    };

    if (loading) {
        return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" /></div>;
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div>
                <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2"><CreditCard className="text-blue-600" /> Plans & Pricing</h1>
                <p className="text-slate-500 text-sm mt-1">Manage subscription plans and organization limits</p>
            </div>

            {/* Plans Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {plans.map(plan => (
                    <div key={plan.id} className="bg-white rounded-xl border border-gray-200 p-5 hover:shadow-md transition-shadow">
                        <div className="flex items-center justify-between mb-3">
                            <h3 className="font-bold text-lg text-slate-800">{plan.name}</h3>
                            <span className={`text-xs font-bold px-2 py-1 rounded-full ${planColors[plan.id] || 'bg-gray-100'}`}>{plan.id.toUpperCase()}</span>
                        </div>
                        <div className="text-3xl font-bold text-blue-600 mb-4">
                            {plan.price_per_month === 0 ? 'Free' : `${plan.price_per_month} EGP`}
                            {plan.price_per_month > 0 && <span className="text-sm text-slate-400 font-normal">/month</span>}
                        </div>
                        <div className="space-y-2 text-sm text-slate-600">
                            <div className="flex items-center gap-2"><Users size={14} /> {plan.max_users} users</div>
                            <div className="flex items-center gap-2"><FileText size={14} /> {plan.max_invoices_per_month.toLocaleString()} invoices/mo</div>
                            <div className="flex items-center gap-2"><HardDrive size={14} /> {plan.max_storage_gb} GB storage</div>
                        </div>
                        <div className="mt-4 pt-3 border-t border-gray-100">
                            <p className="text-xs text-slate-400 font-semibold uppercase mb-2">Features</p>
                            <ul className="space-y-1">
                                {plan.features.map((f, i) => (
                                    <li key={i} className="text-xs text-slate-500 flex items-center gap-1"><Check size={12} className="text-green-500 shrink-0" /> {f}</li>
                                ))}
                            </ul>
                        </div>
                    </div>
                ))}
            </div>

            {/* Organizations Subscriptions */}
            <div className="bg-white rounded-xl border border-gray-200">
                <div className="p-4 border-b border-gray-100">
                    <h2 className="font-bold text-slate-800 flex items-center gap-2"><Building2 size={18} /> Organization Subscriptions</h2>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="bg-gray-50 text-left">
                            <tr>
                                <th className="px-4 py-3 font-semibold text-slate-600">Organization</th>
                                <th className="px-4 py-3 font-semibold text-slate-600">Plan</th>
                                <th className="px-4 py-3 font-semibold text-slate-600">Max Users</th>
                                <th className="px-4 py-3 font-semibold text-slate-600">Max Invoices</th>
                                <th className="px-4 py-3 font-semibold text-slate-600">Status</th>
                                <th className="px-4 py-3 font-semibold text-slate-600">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {orgs.map(org => (
                                <tr key={org.id} className="border-t border-gray-100 hover:bg-gray-50">
                                    <td className="px-4 py-3 font-medium text-slate-800">{org.name}</td>
                                    {editingOrg === org.id ? (
                                        <>
                                            <td className="px-4 py-3">
                                                <select value={editPlan} onChange={e => setEditPlan(e.target.value)} className="border rounded px-2 py-1 text-xs">
                                                    {plans.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                                                </select>
                                            </td>
                                            <td className="px-4 py-3"><input type="number" value={editMaxUsers} onChange={e => setEditMaxUsers(+e.target.value)} className="border rounded px-2 py-1 w-20 text-xs" /></td>
                                            <td className="px-4 py-3"><input type="number" value={editMaxInvoices} onChange={e => setEditMaxInvoices(+e.target.value)} className="border rounded px-2 py-1 w-24 text-xs" /></td>
                                            <td className="px-4 py-3"><span className="text-xs px-2 py-1 rounded-full bg-green-100 text-green-700">{org.subscription?.status || 'active'}</span></td>
                                            <td className="px-4 py-3 flex gap-1">
                                                <button onClick={() => saveSub(org.id)} disabled={saving} className="bg-green-600 text-white px-2 py-1 rounded text-xs hover:bg-green-700"><Check size={12} /></button>
                                                <button onClick={() => setEditingOrg(null)} className="bg-gray-200 text-gray-700 px-2 py-1 rounded text-xs hover:bg-gray-300"><X size={12} /></button>
                                            </td>
                                        </>
                                    ) : (
                                        <>
                                            <td className="px-4 py-3"><span className={`text-xs font-bold px-2 py-1 rounded-full ${planColors[org.subscription_plan] || planColors[org.subscription?.plan] || 'bg-gray-100'}`}>{org.subscription_plan || org.subscription?.plan || 'free'}</span></td>
                                            <td className="px-4 py-3 text-slate-600">{org.subscription?.max_users || '–'}</td>
                                            <td className="px-4 py-3 text-slate-600">{org.subscription?.max_invoices_per_month?.toLocaleString() || '–'}</td>
                                            <td className="px-4 py-3"><span className={`text-xs px-2 py-1 rounded-full ${org.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>{org.is_active ? 'Active' : 'Inactive'}</span></td>
                                            <td className="px-4 py-3">
                                                <button onClick={() => startEdit(org)} className="text-blue-600 hover:text-blue-800 p-1"><Edit2 size={14} /></button>
                                            </td>
                                        </>
                                    )}
                                </tr>
                            ))}
                            {orgs.length === 0 && (
                                <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400">No organizations found</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

export default SuperAdminPlans;
