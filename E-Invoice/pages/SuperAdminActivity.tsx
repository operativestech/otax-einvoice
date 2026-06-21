
import React, { useState, useEffect } from 'react';
import { ClipboardList, LogIn, Activity, ChevronLeft, ChevronRight, Filter } from 'lucide-react';

const API_URL = (() => {
    const hostname = window.location.hostname;
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname.startsWith('192.168.') || hostname.startsWith('10.')) return '/api';
    return 'https://e-invoice-545y.onrender.com/api';
})();

interface ActivityLog {
    id: number;
    userId: number;
    username: string;
    action: string;
    module: string | null;
    resourceType: string | null;
    resourceId: string | null;
    details: string | null;
    ipAddress: string | null;
    status: string | null;
    createdAt: string;
}

interface LoginLog {
    id: number;
    userId: number;
    username: string;
    loginTime: string;
    ipAddress: string | null;
    browser: string | null;
    os: string | null;
    status: string | null;
}

const SuperAdminActivity: React.FC = () => {
    const [tab, setTab] = useState<'activity' | 'logins'>('activity');
    const [activityLogs, setActivityLogs] = useState<ActivityLog[]>([]);
    const [loginLogs, setLoginLogs] = useState<LoginLog[]>([]);
    const [activityPage, setActivityPage] = useState(1);
    const [loginPage, setLoginPage] = useState(1);
    const [activityTotal, setActivityTotal] = useState(0);
    const [loginTotal, setLoginTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const [actionFilter, setActionFilter] = useState('');

    const token = localStorage.getItem('token');
    const limit = 25;

    const fetchActivity = async (page: number) => {
        setLoading(true);
        try {
            const params = new URLSearchParams({ page: page.toString(), limit: limit.toString() });
            if (actionFilter) params.set('action', actionFilter);
            const res = await fetch(`${API_URL}/super-admin/activity-logs?${params}`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            const data = await res.json();
            if (data.success) {
                setActivityLogs(data.logs);
                setActivityTotal(data.pagination.total);
            }
        } catch (err) {
            console.error('Failed to load activity logs:', err);
        } finally {
            setLoading(false);
        }
    };

    const fetchLogins = async (page: number) => {
        setLoading(true);
        try {
            const res = await fetch(`${API_URL}/super-admin/login-history?page=${page}&limit=${limit}`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            const data = await res.json();
            if (data.success) {
                setLoginLogs(data.logs);
                setLoginTotal(data.pagination.total);
            }
        } catch (err) {
            console.error('Failed to load login history:', err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (tab === 'activity') fetchActivity(activityPage);
        else fetchLogins(loginPage);
    }, [tab, activityPage, loginPage, actionFilter]);

    const formatDate = (d: string) => {
        if (!d) return '–';
        return new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    };

    const actionColors: Record<string, string> = {
        login: 'bg-green-100 text-green-700',
        logout: 'bg-gray-100 text-gray-700',
        organization_created: 'bg-blue-100 text-blue-700',
        organization_updated: 'bg-yellow-100 text-yellow-700',
        organization_deleted: 'bg-red-100 text-red-700',
        user_created: 'bg-emerald-100 text-emerald-700',
        user_updated: 'bg-orange-100 text-orange-700',
        user_deleted: 'bg-red-100 text-red-700',
        role_created: 'bg-indigo-100 text-indigo-700',
        subscription_updated: 'bg-purple-100 text-purple-700',
        eta_settings_updated: 'bg-cyan-100 text-cyan-700',
        signing_method_changed: 'bg-teal-100 text-teal-700',
    };

    const totalPages = tab === 'activity' ? Math.ceil(activityTotal / limit) : Math.ceil(loginTotal / limit);
    const currentPage = tab === 'activity' ? activityPage : loginPage;
    const setPage = tab === 'activity' ? setActivityPage : setLoginPage;

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2"><ClipboardList className="text-blue-600" /> Activity Logs</h1>
                <p className="text-slate-500 text-sm mt-1">Monitor all platform activity and user logins</p>
            </div>

            {/* Tabs */}
            <div className="flex gap-2">
                <button
                    onClick={() => setTab('activity')}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${tab === 'activity' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 border border-gray-200 hover:bg-gray-50'}`}
                >
                    <Activity size={16} /> Activity Log
                    <span className="bg-white/20 px-1.5 py-0.5 rounded text-xs">{activityTotal}</span>
                </button>
                <button
                    onClick={() => setTab('logins')}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${tab === 'logins' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 border border-gray-200 hover:bg-gray-50'}`}
                >
                    <LogIn size={16} /> Login History
                    <span className="bg-white/20 px-1.5 py-0.5 rounded text-xs">{loginTotal}</span>
                </button>
            </div>

            {/* Filter (activity only) */}
            {tab === 'activity' && (
                <div className="flex items-center gap-2">
                    <Filter size={14} className="text-slate-400" />
                    <select value={actionFilter} onChange={e => { setActionFilter(e.target.value); setActivityPage(1); }} className="border rounded-lg px-3 py-1.5 text-sm text-slate-600 bg-white">
                        <option value="">All Actions</option>
                        <option value="login">Login</option>
                        <option value="organization_created">Org Created</option>
                        <option value="organization_updated">Org Updated</option>
                        <option value="user_created">User Created</option>
                        <option value="role_created">Role Created</option>
                        <option value="subscription_updated">Subscription Updated</option>
                        <option value="eta_settings_updated">ETA Updated</option>
                    </select>
                </div>
            )}

            {/* Table */}
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                {loading ? (
                    <div className="flex items-center justify-center h-32"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600" /></div>
                ) : tab === 'activity' ? (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead className="bg-gray-50 text-left">
                                <tr>
                                    <th className="px-4 py-3 font-semibold text-slate-600">Time</th>
                                    <th className="px-4 py-3 font-semibold text-slate-600">User</th>
                                    <th className="px-4 py-3 font-semibold text-slate-600">Action</th>
                                    <th className="px-4 py-3 font-semibold text-slate-600">Module</th>
                                    <th className="px-4 py-3 font-semibold text-slate-600">Resource</th>
                                    <th className="px-4 py-3 font-semibold text-slate-600">IP</th>
                                </tr>
                            </thead>
                            <tbody>
                                {activityLogs.map(log => (
                                    <tr key={log.id} className="border-t border-gray-100 hover:bg-gray-50">
                                        <td className="px-4 py-2.5 text-xs text-slate-500 whitespace-nowrap">{formatDate(log.createdAt)}</td>
                                        <td className="px-4 py-2.5 font-medium text-slate-700">{log.username}</td>
                                        <td className="px-4 py-2.5">
                                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${actionColors[log.action] || 'bg-gray-100 text-gray-600'}`}>
                                                {log.action.replace(/_/g, ' ').toUpperCase()}
                                            </span>
                                        </td>
                                        <td className="px-4 py-2.5 text-xs text-slate-500">{log.module || '–'}</td>
                                        <td className="px-4 py-2.5 text-xs text-slate-500">{log.resourceType ? `${log.resourceType} #${log.resourceId}` : '–'}</td>
                                        <td className="px-4 py-2.5 text-xs text-slate-400 font-mono">{log.ipAddress || '–'}</td>
                                    </tr>
                                ))}
                                {activityLogs.length === 0 && (
                                    <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400">No activity logs found</td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead className="bg-gray-50 text-left">
                                <tr>
                                    <th className="px-4 py-3 font-semibold text-slate-600">Login Time</th>
                                    <th className="px-4 py-3 font-semibold text-slate-600">User</th>
                                    <th className="px-4 py-3 font-semibold text-slate-600">IP Address</th>
                                    <th className="px-4 py-3 font-semibold text-slate-600">Browser</th>
                                    <th className="px-4 py-3 font-semibold text-slate-600">OS</th>
                                    <th className="px-4 py-3 font-semibold text-slate-600">Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                {loginLogs.map(log => (
                                    <tr key={log.id} className="border-t border-gray-100 hover:bg-gray-50">
                                        <td className="px-4 py-2.5 text-xs text-slate-500 whitespace-nowrap">{formatDate(log.loginTime)}</td>
                                        <td className="px-4 py-2.5 font-medium text-slate-700">{log.username}</td>
                                        <td className="px-4 py-2.5 text-xs text-slate-400 font-mono">{log.ipAddress || '–'}</td>
                                        <td className="px-4 py-2.5 text-xs text-slate-500">{log.browser || '–'}</td>
                                        <td className="px-4 py-2.5 text-xs text-slate-500">{log.os || '–'}</td>
                                        <td className="px-4 py-2.5"><span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-green-100 text-green-700">{log.status || 'active'}</span></td>
                                    </tr>
                                ))}
                                {loginLogs.length === 0 && (
                                    <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400">No login history found</td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
                <div className="flex items-center justify-between">
                    <p className="text-xs text-slate-400">
                        Page {currentPage} of {totalPages} ({tab === 'activity' ? activityTotal : loginTotal} records)
                    </p>
                    <div className="flex gap-1">
                        <button onClick={() => setPage(Math.max(1, currentPage - 1))} disabled={currentPage === 1} className="px-3 py-1.5 rounded border border-gray-200 text-xs hover:bg-gray-50 disabled:opacity-40"><ChevronLeft size={14} /></button>
                        <button onClick={() => setPage(Math.min(totalPages, currentPage + 1))} disabled={currentPage === totalPages} className="px-3 py-1.5 rounded border border-gray-200 text-xs hover:bg-gray-50 disabled:opacity-40"><ChevronRight size={14} /></button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default SuperAdminActivity;
