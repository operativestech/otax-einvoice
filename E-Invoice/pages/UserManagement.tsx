import React, { useState, useEffect, useMemo } from 'react';
import { Users, Plus, Trash2, Shield, Search, Loader2, X, Check, Mail, Send, Copy, Clock, UserPlus, Layers, Eye } from 'lucide-react';
import PasswordInput from '../components/PasswordInput';
import { confirmDialog } from '../components/ConfirmDialog';

interface UserData {
    id: number;
    username: string;
    email?: string;
    email_verified?: boolean;
    isValid: boolean;
    isDemo: boolean;
    registerDate: string;
    expiryDate: string;
    roles: { id: number; name: string; displayName: string }[];
}

interface PermissionData {
    id: number;
    name: string;
    displayName: string;
    module?: string;
    action?: string;
}

interface RoleData {
    id: number;
    name: string;
    displayName: string;
    description?: string;
    permissions?: PermissionData[];
}

interface InvitationData {
    id: number;
    email: string;
    role_name: string;
    status: string;
    expires_at: string;
    created_at: string;
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

// Map permission names → user-facing pages they unlock.
// Mirrors the permission gates in components/Sidebar.tsx so admins see what they're granting.
const PERMISSION_TO_PAGES: Record<string, string[]> = {
    'dashboard.view': ['Dashboard'],
    'invoices.view': ['Invoices'],
    'invoices.create': ['Export to ETA', 'Import (Excel)', 'Manual Invoice'],
    'reports.view': ['Reports', 'Export Packages', 'Reconciliation'],
    'reports.export': ['Export Reports'],
    'masterdata.view': ['Master Data'],
    'masterdata.edit': ['Edit Master Data'],
    'settings.view': ['Settings'],
    'settings.edit': ['Edit Settings'],
    'org_users.view': ['User Management'],
    'org_users.create': ['Invite/Add Users'],
    'org_users.edit': ['Edit Users'],
    'org_users.delete': ['Delete Users'],
    'packages.view': ['Export Packages'],
    'packages.manage': ['Request Packages'],
    'reconciliation.view': ['Reconciliation'],
    'reconciliation.manage': ['Manage Reconciliation'],
    'signing.view': ['Signing Queue'],
    'signing.manage': ['Manage Signing Queue'],
    'assistant.use': ['AI Assistant'],
};

const RoleColor = (name: string) =>
    name === 'super_admin' ? 'bg-amber-100 text-amber-700'
        : name === 'org_admin' ? 'bg-blue-100 text-blue-700'
            : name === 'admin' ? 'bg-purple-100 text-purple-700'
                : 'bg-slate-100 text-slate-600';

// Renders a radio list of roles. When a role is selected, its permissions appear as
// toggleable checkboxes — defaulting to all checked. Admin can uncheck specific ones to
// grant a customized subset of the role's permissions to this user.
const RolePicker: React.FC<{
    roles: RoleData[];
    selectedRoleId: number | null;
    onSelect: (roleId: number) => void;
    selectedPermissionIds: number[];
    onPermissionsChange: (ids: number[]) => void;
    accent?: 'blue' | 'emerald';
    name: string;
}> = ({ roles, selectedRoleId, onSelect, selectedPermissionIds, onPermissionsChange, accent = 'blue', name }) => {
    const accentRing = accent === 'emerald' ? 'focus:ring-emerald-500/20 focus:border-emerald-500' : 'focus:ring-blue-500/20 focus:border-blue-500';
    const accentCheck = accent === 'emerald' ? 'text-emerald-600' : 'text-blue-600';

    const selectedRole = useMemo(() => roles.find(r => r.id === selectedRoleId) || null, [roles, selectedRoleId]);

    // Pages unlocked by the currently *checked* permissions
    const grantedPages = useMemo(() => {
        if (!selectedRole) return [];
        const checkedSet = new Set(selectedPermissionIds);
        const pageSet = new Set<string>();
        (selectedRole.permissions || []).forEach(p => {
            if (checkedSet.has(p.id)) {
                (PERMISSION_TO_PAGES[p.name] || []).forEach(page => pageSet.add(page));
            }
        });
        return Array.from(pageSet).sort();
    }, [selectedRole, selectedPermissionIds]);

    const togglePermission = (permId: number) => {
        if (selectedPermissionIds.includes(permId)) {
            onPermissionsChange(selectedPermissionIds.filter(id => id !== permId));
        } else {
            onPermissionsChange([...selectedPermissionIds, permId]);
        }
    };

    const allChecked = !!selectedRole && (selectedRole.permissions || []).every(p => selectedPermissionIds.includes(p.id));
    const noneChecked = selectedPermissionIds.length === 0;

    const checkAll = () => {
        if (!selectedRole) return;
        onPermissionsChange((selectedRole.permissions || []).map(p => p.id));
    };
    const checkNone = () => onPermissionsChange([]);

    return (
        <div className="space-y-2">
            <label className="text-xs font-bold text-slate-500 uppercase block">Role & permissions</label>
            <p className="text-[10px] text-slate-400 -mt-1">Pick one role, then fine-tune which pages this specific user can access.</p>
            <div className={`max-h-72 overflow-y-auto border border-gray-200 rounded-xl p-2 space-y-1.5 bg-slate-50/40 ${accentRing}`}>
                {roles.length === 0 && (
                    <div className="text-xs text-slate-400 py-3 text-center">No roles available</div>
                )}
                {roles.map(r => {
                    const checked = selectedRoleId === r.id;
                    return (
                        <div
                            key={r.id}
                            className={`rounded-lg border transition-colors ${checked ? 'bg-white border-blue-200 shadow-sm' : 'border-transparent hover:bg-white/70'}`}
                        >
                            <label className="flex gap-2 p-2 cursor-pointer">
                                <input
                                    type="radio"
                                    name={name}
                                    checked={checked}
                                    onChange={() => onSelect(r.id)}
                                    className={`mt-0.5 ${accentCheck}`}
                                />
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${RoleColor(r.name)}`}>
                                            {r.displayName}
                                        </span>
                                        <span className="text-[10px] text-slate-400">{r.name}</span>
                                    </div>
                                    {r.description && (
                                        <p className="text-[10px] text-slate-500 mt-0.5 truncate">{r.description}</p>
                                    )}
                                </div>
                            </label>

                            {/* Per-permission checkboxes — only the selected role expands its list */}
                            {checked && r.permissions && r.permissions.length > 0 && (
                                <div className="px-3 pb-3 pt-1 border-t border-slate-100">
                                    <div className="flex items-center justify-between mb-2">
                                        <span className="text-[10px] font-bold uppercase text-slate-500">
                                            Allowed permissions ({selectedPermissionIds.length} / {r.permissions.length})
                                        </span>
                                        <div className="flex gap-1">
                                            <button
                                                type="button"
                                                onClick={checkAll}
                                                disabled={allChecked}
                                                className="text-[10px] font-semibold text-blue-600 hover:underline disabled:text-slate-300 disabled:no-underline"
                                            >
                                                All
                                            </button>
                                            <span className="text-[10px] text-slate-300">|</span>
                                            <button
                                                type="button"
                                                onClick={checkNone}
                                                disabled={noneChecked}
                                                className="text-[10px] font-semibold text-slate-500 hover:underline disabled:text-slate-300 disabled:no-underline"
                                            >
                                                None
                                            </button>
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
                                        {r.permissions.map(p => {
                                            const isOn = selectedPermissionIds.includes(p.id);
                                            return (
                                                <label
                                                    key={p.id}
                                                    className={`flex items-start gap-1.5 px-2 py-1 rounded-md cursor-pointer text-[11px] transition-colors ${isOn ? 'bg-slate-50' : 'hover:bg-slate-50'}`}
                                                >
                                                    <input
                                                        type="checkbox"
                                                        checked={isOn}
                                                        onChange={() => togglePermission(p.id)}
                                                        className={`mt-0.5 ${accentCheck}`}
                                                    />
                                                    <span className={`flex-1 ${isOn ? 'text-slate-700' : 'text-slate-400'}`}>
                                                        {p.displayName || p.name}
                                                    </span>
                                                </label>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            {selectedRoleId !== null && (
                <div className={`mt-2 p-3 rounded-xl border ${accent === 'emerald' ? 'bg-emerald-50/50 border-emerald-100' : 'bg-blue-50/50 border-blue-100'}`}>
                    <div className="flex items-center gap-2 mb-1.5">
                        <Eye size={12} className={accent === 'emerald' ? 'text-emerald-600' : 'text-blue-600'} />
                        <span className="text-[10px] font-bold uppercase text-slate-600">Pages this user will see</span>
                    </div>
                    {grantedPages.length === 0 ? (
                        <p className="text-[10px] text-slate-500">No pages — uncheck fewer permissions or pick a different role.</p>
                    ) : (
                        <div className="flex flex-wrap gap-1">
                            {grantedPages.map(page => (
                                <span key={page} className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${accent === 'emerald' ? 'bg-white text-emerald-700 border border-emerald-200' : 'bg-white text-blue-700 border border-blue-200'}`}>
                                    {page}
                                </span>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

const UserManagement: React.FC = () => {
    const [activeTab, setActiveTab] = useState<'users' | 'invitations'>('users');
    const [users, setUsers] = useState<UserData[]>([]);
    const [roles, setRoles] = useState<RoleData[]>([]);
    const [invitations, setInvitations] = useState<InvitationData[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [showInviteModal, setShowInviteModal] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [successMsg, setSuccessMsg] = useState<string | null>(null);

    // Create form state
    const [newUsername, setNewUsername] = useState('');
    const [newEmail, setNewEmail] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [newRoleId, setNewRoleId] = useState<number | null>(null);
    const [newPermissionIds, setNewPermissionIds] = useState<number[]>([]);

    // Invite form state
    const [inviteEmail, setInviteEmail] = useState('');
    const [inviteRoleId, setInviteRoleId] = useState<number | null>(null);
    const [invitePermissionIds, setInvitePermissionIds] = useState<number[]>([]);
    const [inviteSending, setInviteSending] = useState(false);

    // Org join code
    const [orgJoinCode, setOrgJoinCode] = useState<string | null>(null);
    const [codeCopied, setCodeCopied] = useState(false);

    const fetchUsers = async () => {
        try {
            setLoading(true);
            const res = await fetch(`${API_URL}/admin/users`, { headers: getAuthHeaders() });
            const data = await res.json();
            if (data.success) setUsers(data.users || []);
        } catch (err: any) {
            setError('Failed to load users');
        } finally {
            setLoading(false);
        }
    };

    const fetchRoles = async () => {
        try {
            const res = await fetch(`${API_URL}/admin/roles`, { headers: getAuthHeaders() });
            const data = await res.json();
            if (data.success) setRoles(data.roles || []);
        } catch { }
    };

    const fetchInvitations = async () => {
        try {
            const res = await fetch(`${API_URL}/auth/invitations`, { headers: getAuthHeaders() });
            const data = await res.json();
            if (data.success) setInvitations(data.invitations || []);
        } catch { }
    };

    const fetchOrgJoinCode = () => {
        try {
            const userStr = localStorage.getItem('invoice_user');
            if (userStr) {
                const user = JSON.parse(userStr);
                if (user.organization?.org_join_code) {
                    setOrgJoinCode(user.organization.org_join_code);
                }
            }
        } catch { }
    };

    useEffect(() => {
        fetchUsers();
        fetchRoles();
        fetchInvitations();
        fetchOrgJoinCode();
    }, []);

    // Default the role selection to "viewer" (or first role) once roles load
    useEffect(() => {
        if (roles.length === 0) return;
        const defaultRole = roles.find(r => r.name === 'viewer') || roles[0];
        if (inviteRoleId === null) {
            setInviteRoleId(defaultRole.id);
            setInvitePermissionIds((defaultRole.permissions || []).map(p => p.id));
        }
    }, [roles]);

    // When a role is picked in either modal, default-check ALL its permissions.
    // The admin can then uncheck specific ones to customize.
    const selectRoleForCreate = (roleId: number) => {
        setNewRoleId(roleId);
        const r = roles.find(x => x.id === roleId);
        setNewPermissionIds((r?.permissions || []).map(p => p.id));
    };
    const selectRoleForInvite = (roleId: number) => {
        setInviteRoleId(roleId);
        const r = roles.find(x => x.id === roleId);
        setInvitePermissionIds((r?.permissions || []).map(p => p.id));
    };

    const handleCreateUser = async () => {
        if ((!newUsername && !newEmail) || !newPassword) {
            setError('Username/email and password are required');
            return;
        }
        if (newRoleId === null) {
            setError('Please select a role for the user');
            return;
        }
        const role = roles.find(r => r.id === newRoleId);
        const allRolePermIds = (role?.permissions || []).map(p => p.id);
        const isCustomized =
            newPermissionIds.length !== allRolePermIds.length ||
            !allRolePermIds.every(id => newPermissionIds.includes(id));
        // Only enforce "at least one permission" when the role actually has permissions to pick.
        // If the role has zero permissions defined, fall through and use whatever the backend defaults to.
        if (allRolePermIds.length > 0 && newPermissionIds.length === 0) {
            setError('Pick at least one page this user can access');
            return;
        }
        try {
            const res = await fetch(`${API_URL}/admin/users`, {
                method: 'POST',
                headers: getAuthHeaders(),
                body: JSON.stringify({
                    username: newUsername || undefined,
                    email: newEmail || undefined,
                    password: newPassword,
                    roleIds: [newRoleId],
                    ...(isCustomized ? { permissionIds: newPermissionIds } : {}),
                }),
            });
            const data = await res.json();
            if (data.success) {
                setSuccessMsg('User created successfully');
                setShowCreateModal(false);
                setNewUsername('');
                setNewEmail('');
                setNewPassword('');
                setNewRoleId(null);
                setNewPermissionIds([]);
                fetchUsers();
            } else {
                setError(data.message || 'Failed to create user');
            }
        } catch {
            setError('Failed to create user');
        }
    };

    const handleSendInvite = async () => {
        if (!inviteEmail || !/\S+@\S+\.\S+/.test(inviteEmail)) {
            setError('Please enter a valid email address');
            return;
        }
        if (inviteRoleId === null) {
            setError('Please select a role for the invited user');
            return;
        }
        const selectedRole = roles.find(r => r.id === inviteRoleId);
        const allRolePermIds = (selectedRole?.permissions || []).map(p => p.id);
        // Only enforce "at least one permission" when the role actually has permissions defined.
        if (allRolePermIds.length > 0 && invitePermissionIds.length === 0) {
            setError('Pick at least one page this user can access');
            return;
        }
        const isCustomized =
            invitePermissionIds.length !== allRolePermIds.length ||
            !allRolePermIds.every(id => invitePermissionIds.includes(id));
        setInviteSending(true);
        try {
            const res = await fetch(`${API_URL}/auth/invite`, {
                method: 'POST',
                headers: getAuthHeaders(),
                body: JSON.stringify({
                    email: inviteEmail,
                    roleIds: [inviteRoleId],
                    // Backwards-compat — older backends only read roleName
                    roleName: selectedRole?.name || 'viewer',
                    ...(isCustomized ? { permissionIds: invitePermissionIds } : {}),
                }),
            });
            const data = await res.json();
            if (data.success) {
                // Surface SMTP failures explicitly — the invite is still saved on the server.
                const emailFailed = data.emailStatus === 'failed';
                if (emailFailed) {
                    setError(data.message || `Invitation saved but email could not be delivered to ${inviteEmail}`);
                } else {
                    setSuccessMsg(`Invitation email sent to ${inviteEmail}`);
                }
                setShowInviteModal(false);
                setInviteEmail('');
                const defaultRole = roles.find(r => r.name === 'viewer') || roles[0];
                if (defaultRole) {
                    setInviteRoleId(defaultRole.id);
                    setInvitePermissionIds((defaultRole.permissions || []).map(p => p.id));
                } else {
                    setInviteRoleId(null);
                    setInvitePermissionIds([]);
                }
                fetchInvitations();
            } else {
                setError(data.message || 'Failed to send invitation');
            }
        } catch {
            setError('Failed to send invitation');
        } finally {
            setInviteSending(false);
        }
    };

    const handleToggleActive = async (userId: number, currentlyActive: boolean) => {
        try {
            const res = await fetch(`${API_URL}/admin/users/${userId}`, {
                method: 'PUT',
                headers: getAuthHeaders(),
                body: JSON.stringify({ isValid: !currentlyActive }),
            });
            const data = await res.json();
            if (data.success) {
                setSuccessMsg(`User ${currentlyActive ? 'deactivated' : 'activated'}`);
                fetchUsers();
            }
        } catch {
            setError('Failed to update user');
        }
    };

    const handleDeleteUser = async (userId: number) => {
        const ok = await confirmDialog({
            title: 'Delete user',
            message: 'Are you sure you want to delete this user? This action cannot be undone.',
            confirmLabel: 'Delete',
            tone: 'danger',
        });
        if (!ok) return;
        try {
            const res = await fetch(`${API_URL}/admin/users/${userId}`, {
                method: 'DELETE',
                headers: getAuthHeaders(),
            });
            const data = await res.json();
            if (data.success) {
                setSuccessMsg('User deleted');
                fetchUsers();
            } else {
                setError(data.message || 'Failed to delete user');
            }
        } catch {
            setError('Failed to delete user');
        }
    };

    const handleCopyJoinCode = () => {
        if (orgJoinCode) {
            navigator.clipboard.writeText(orgJoinCode);
            setCodeCopied(true);
            setTimeout(() => setCodeCopied(false), 2000);
        }
    };

    // Filter users by search
    const filteredUsers = users.filter(u =>
        u.username?.toLowerCase().includes(search.toLowerCase()) ||
        u.email?.toLowerCase().includes(search.toLowerCase())
    );

    // Auto-dismiss messages
    useEffect(() => {
        if (successMsg) {
            const t = setTimeout(() => setSuccessMsg(null), 3000);
            return () => clearTimeout(t);
        }
    }, [successMsg]);

    useEffect(() => {
        if (error) {
            const t = setTimeout(() => setError(null), 5000);
            return () => clearTimeout(t);
        }
    }, [error]);

    return (
        <div className="max-w-6xl mx-auto">
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-3">
                        <Users className="text-blue-600" size={28} />
                        User Management
                    </h1>
                    <p className="text-sm text-slate-500 mt-1">Manage users and invitations in your organization</p>
                </div>
                <div className="flex gap-2">
                    <button
                        onClick={() => { setError(null); setShowInviteModal(true); }}
                        className="flex items-center gap-2 bg-emerald-600 text-white px-4 py-2 rounded-xl font-semibold text-sm hover:bg-emerald-700 transition-colors shadow-lg shadow-emerald-200"
                    >
                        <Mail size={16} /> Invite User
                    </button>
                    <button
                        onClick={() => { setError(null); setShowCreateModal(true); }}
                        className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-xl font-semibold text-sm hover:bg-blue-700 transition-colors shadow-lg shadow-blue-200"
                    >
                        <Plus size={16} /> Add User
                    </button>
                </div>
            </div>

            {/* Org Join Code Banner */}
            {orgJoinCode && (
                <div className="mb-4 p-3 bg-blue-50 border border-blue-100 rounded-xl flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <UserPlus size={18} className="text-blue-600" />
                        <div>
                            <p className="text-xs font-bold text-slate-700">Organization Join Code</p>
                            <p className="text-[10px] text-slate-500">Share this code with employees to let them join your org via signup</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <code className="bg-white border border-blue-200 px-3 py-1.5 rounded-lg text-sm font-bold text-blue-700 tracking-widest">{orgJoinCode}</code>
                        <button onClick={handleCopyJoinCode} className="p-1.5 hover:bg-blue-100 rounded-lg transition-colors text-blue-600" title="Copy code">
                            {codeCopied ? <Check size={16} /> : <Copy size={16} />}
                        </button>
                    </div>
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

            {/* Tabs */}
            <div className="flex gap-1 mb-4 bg-slate-100 p-1 rounded-xl w-fit">
                <button
                    onClick={() => setActiveTab('users')}
                    className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-colors ${activeTab === 'users' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                >
                    <Users size={14} className="inline mr-1.5" />Users ({users.length})
                </button>
                <button
                    onClick={() => setActiveTab('invitations')}
                    className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-colors ${activeTab === 'invitations' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                >
                    <Mail size={14} className="inline mr-1.5" />Invitations ({invitations.length})
                </button>
            </div>

            {/* Search */}
            <div className="relative mb-4">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                    type="text"
                    placeholder={activeTab === 'users' ? "Search users..." : "Search invitations..."}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-xl bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                />
            </div>

            {/* Users Tab */}
            {activeTab === 'users' && (
                <div className="glass-panel overflow-hidden">
                    {loading ? (
                        <div className="flex items-center justify-center py-20">
                            <Loader2 size={32} className="animate-spin text-blue-500" />
                        </div>
                    ) : filteredUsers.length === 0 ? (
                        <div className="text-center py-20 text-slate-400">
                            <Users size={48} className="mx-auto mb-3 opacity-30" />
                            <p className="font-medium">No users found</p>
                        </div>
                    ) : (
                        <table className="w-full">
                            <thead className="bg-slate-50 border-b border-gray-100">
                                <tr>
                                    <th className="text-left py-2.5 px-4 text-[10px] font-bold text-slate-500 uppercase tracking-wider">User</th>
                                    <th className="text-left py-2.5 px-4 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Email</th>
                                    <th className="text-left py-2.5 px-4 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Roles</th>
                                    <th className="text-center py-2.5 px-4 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Status</th>
                                    <th className="text-left py-2.5 px-4 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Registered</th>
                                    <th className="text-right py-2.5 px-4 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-50">
                                {filteredUsers.map((u) => (
                                    <tr key={u.id} className="hover:bg-blue-50/30 transition-colors">
                                        <td className="py-2.5 px-4">
                                            <div className="flex items-center gap-2">
                                                <div className="w-7 h-7 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center font-bold text-xs">
                                                    {u.username?.[0]?.toUpperCase() || '?'}
                                                </div>
                                                <span className="font-semibold text-xs text-slate-800">{u.username}</span>
                                            </div>
                                        </td>
                                        <td className="py-2.5 px-4">
                                            <div className="flex items-center gap-1">
                                                <span className="text-xs text-slate-500">{u.email || '—'}</span>
                                                {u.email_verified && <Check size={12} className="text-emerald-500" />}
                                            </div>
                                        </td>
                                        <td className="py-2.5 px-4">
                                            <div className="flex flex-wrap gap-1">
                                                {u.roles.map(r => (
                                                    <span key={r.id} className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${RoleColor(r.name)}`}>
                                                        {r.displayName}
                                                    </span>
                                                ))}
                                                {u.roles.length === 0 && <span className="text-[10px] text-slate-400">No role</span>}
                                            </div>
                                        </td>
                                        <td className="py-2.5 px-4 text-center">
                                            <span className={`inline-block w-2 h-2 rounded-full ${u.isValid ? 'bg-emerald-500' : 'bg-red-400'}`} />
                                            <span className={`text-[10px] font-medium ml-1 ${u.isValid ? 'text-emerald-600' : 'text-red-500'}`}>
                                                {u.isValid ? 'Active' : 'Inactive'}
                                            </span>
                                        </td>
                                        <td className="py-2.5 px-4">
                                            <span className="text-[10px] text-slate-500">
                                                {u.registerDate ? new Date(u.registerDate).toLocaleDateString() : '—'}
                                            </span>
                                        </td>
                                        <td className="py-2.5 px-4">
                                            <div className="flex items-center justify-end gap-1">
                                                <button
                                                    onClick={() => handleToggleActive(u.id, u.isValid)}
                                                    className={`p-1 rounded-lg transition-colors ${u.isValid ? 'hover:bg-red-50 text-red-400 hover:text-red-600' : 'hover:bg-emerald-50 text-emerald-400 hover:text-emerald-600'}`}
                                                    title={u.isValid ? 'Deactivate' : 'Activate'}
                                                >
                                                    <Shield size={14} />
                                                </button>
                                                <button
                                                    onClick={() => handleDeleteUser(u.id)}
                                                    className="p-1 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-600 transition-colors"
                                                    title="Delete user"
                                                >
                                                    <Trash2 size={14} />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            )}

            {/* Invitations Tab */}
            {activeTab === 'invitations' && (
                <div className="glass-panel overflow-hidden">
                    {invitations.length === 0 ? (
                        <div className="text-center py-16 text-slate-400">
                            <Mail size={48} className="mx-auto mb-3 opacity-30" />
                            <p className="font-medium text-sm">No invitations sent yet</p>
                            <p className="text-xs mt-1">Click "Invite User" to send an email invitation</p>
                        </div>
                    ) : (
                        <table className="w-full">
                            <thead className="bg-slate-50 border-b border-gray-100">
                                <tr>
                                    <th className="text-left py-2.5 px-4 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Email</th>
                                    <th className="text-left py-2.5 px-4 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Role</th>
                                    <th className="text-center py-2.5 px-4 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Status</th>
                                    <th className="text-left py-2.5 px-4 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Sent</th>
                                    <th className="text-left py-2.5 px-4 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Expires</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-50">
                                {invitations.map((inv) => (
                                    <tr key={inv.id} className="hover:bg-blue-50/30 transition-colors">
                                        <td className="py-2.5 px-4">
                                            <div className="flex items-center gap-2">
                                                <Mail size={14} className="text-slate-400" />
                                                <span className="text-xs font-medium text-slate-800">{inv.email}</span>
                                            </div>
                                        </td>
                                        <td className="py-2.5 px-4">
                                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">{inv.role_name}</span>
                                        </td>
                                        <td className="py-2.5 px-4 text-center">
                                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${inv.status === 'pending' ? 'bg-amber-100 text-amber-700' :
                                                inv.status === 'accepted' ? 'bg-emerald-100 text-emerald-700' :
                                                    'bg-red-100 text-red-600'
                                                }`}>
                                                {inv.status.charAt(0).toUpperCase() + inv.status.slice(1)}
                                            </span>
                                        </td>
                                        <td className="py-2.5 px-4">
                                            <span className="text-[10px] text-slate-500">{new Date(inv.created_at).toLocaleDateString()}</span>
                                        </td>
                                        <td className="py-2.5 px-4">
                                            <div className="flex items-center gap-1">
                                                <Clock size={12} className="text-slate-400" />
                                                <span className="text-[10px] text-slate-500">{new Date(inv.expires_at).toLocaleDateString()}</span>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            )}

            {/* Create User Modal */}
            {showCreateModal && (
                <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4 overflow-y-auto" onClick={() => setShowCreateModal(false)}>
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6 my-8" onClick={e => e.stopPropagation()}>
                        <h2 className="text-lg font-bold text-slate-800 mb-1 flex items-center gap-2">
                            <Plus size={20} className="text-blue-600" /> Create New User
                        </h2>
                        <p className="text-xs text-slate-500 mb-4">Create a user account directly with a chosen access level</p>

                        <div className="space-y-3">
                            <div>
                                <label className="text-xs font-bold text-slate-500 uppercase block mb-1">Username</label>
                                <input
                                    type="text"
                                    value={newUsername}
                                    onChange={e => setNewUsername(e.target.value)}
                                    className="w-full border border-gray-200 rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                                    placeholder="Enter username (optional if email provided)"
                                />
                            </div>
                            <div>
                                <label className="text-xs font-bold text-slate-500 uppercase block mb-1">Email</label>
                                <input
                                    type="email"
                                    value={newEmail}
                                    onChange={e => setNewEmail(e.target.value)}
                                    className="w-full border border-gray-200 rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                                    placeholder="user@company.com"
                                />
                            </div>
                            <div>
                                <label className="text-xs font-bold text-slate-500 uppercase block mb-1">Password</label>
                                <PasswordInput
                                    value={newPassword}
                                    onChange={e => setNewPassword(e.target.value)}
                                    className="w-full border border-gray-200 rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                                    placeholder="Enter password"
                                />
                            </div>

                            <RolePicker
                                roles={roles}
                                selectedRoleId={newRoleId}
                                onSelect={selectRoleForCreate}
                                selectedPermissionIds={newPermissionIds}
                                onPermissionsChange={setNewPermissionIds}
                                accent="blue"
                                name="create-user-role"
                            />
                        </div>

                        {(() => {
                            const role = roles.find(r => r.id === newRoleId);
                            const totalPerms = (role?.permissions || []).length;
                            const needsPerms = totalPerms > 0 && newPermissionIds.length === 0;
                            return needsPerms ? (
                                <p className="mt-3 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                                    Check at least one permission above so this user has access to something.
                                </p>
                            ) : null;
                        })()}

                        <div className="flex gap-3 mt-5">
                            <button
                                onClick={() => setShowCreateModal(false)}
                                className="flex-1 py-2 rounded-xl border border-gray-200 text-slate-600 font-medium text-sm hover:bg-gray-50 transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleCreateUser}
                                disabled={(() => {
                                    const role = roles.find(r => r.id === newRoleId);
                                    const totalPerms = (role?.permissions || []).length;
                                    return totalPerms > 0 && newPermissionIds.length === 0;
                                })()}
                                className="flex-1 py-2 rounded-xl bg-blue-600 text-white font-semibold text-sm hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                            >
                                <Layers size={14} /> Create User
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Invite User Modal */}
            {showInviteModal && (
                <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4 overflow-y-auto" onClick={() => setShowInviteModal(false)}>
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6 my-8" onClick={e => e.stopPropagation()}>
                        <h2 className="text-lg font-bold text-slate-800 mb-1 flex items-center gap-2">
                            <Mail size={20} className="text-emerald-600" /> Invite User by Email
                        </h2>
                        <p className="text-xs text-slate-500 mb-4">They'll receive an email with a link to join your organization. Pick what they can access.</p>

                        <div className="space-y-3">
                            <div>
                                <label className="text-xs font-bold text-slate-500 uppercase block mb-1">Email Address</label>
                                <input
                                    type="email"
                                    value={inviteEmail}
                                    onChange={e => setInviteEmail(e.target.value)}
                                    className="w-full border border-gray-200 rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                                    placeholder="employee@company.com"
                                />
                            </div>

                            <RolePicker
                                roles={roles}
                                selectedRoleId={inviteRoleId}
                                onSelect={selectRoleForInvite}
                                selectedPermissionIds={invitePermissionIds}
                                onPermissionsChange={setInvitePermissionIds}
                                accent="emerald"
                                name="invite-user-role"
                            />
                        </div>

                        {(() => {
                            const role = roles.find(r => r.id === inviteRoleId);
                            const totalPerms = (role?.permissions || []).length;
                            const needsPerms = totalPerms > 0 && invitePermissionIds.length === 0;
                            return needsPerms ? (
                                <p className="mt-3 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                                    Check at least one permission above so this user has access to something.
                                </p>
                            ) : null;
                        })()}

                        <div className="flex gap-3 mt-5">
                            <button
                                onClick={() => setShowInviteModal(false)}
                                className="flex-1 py-2 rounded-xl border border-gray-200 text-slate-600 font-medium text-sm hover:bg-gray-50 transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleSendInvite}
                                disabled={inviteSending || (() => {
                                    const role = roles.find(r => r.id === inviteRoleId);
                                    const totalPerms = (role?.permissions || []).length;
                                    return totalPerms > 0 && invitePermissionIds.length === 0;
                                })()}
                                className="flex-1 py-2 rounded-xl bg-emerald-600 text-white font-semibold text-sm hover:bg-emerald-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                            >
                                {inviteSending ? <Loader2 size={16} className="animate-spin" /> : <Send size={14} />}
                                {inviteSending ? 'Sending...' : 'Send Invitation'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default UserManagement;
