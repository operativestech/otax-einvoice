
import React, { useState, useEffect } from 'react';
import { Lock, Shield, Plus, ChevronDown, ChevronRight, Check, X, Users } from 'lucide-react';

const API_URL = (() => {
    const hostname = window.location.hostname;
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname.startsWith('192.168.') || hostname.startsWith('10.')) return '/api';
    return 'https://e-invoice-545y.onrender.com/api';
})();

interface Permission {
    id: number;
    name: string;
    displayName: string;
    module: string;
    action: string;
}

interface Role {
    id: number;
    name: string;
    displayName: string;
    description: string | null;
    isSystem: boolean;
    permissionCount: number;
    userCount: number;
    permissions: Permission[];
}

const SuperAdminRoles: React.FC = () => {
    const [roles, setRoles] = useState<Role[]>([]);
    const [allPermissions, setAllPermissions] = useState<Permission[]>([]);
    const [grouped, setGrouped] = useState<Record<string, Permission[]>>({});
    const [loading, setLoading] = useState(true);
    const [expandedRole, setExpandedRole] = useState<number | null>(null);
    const [editingRole, setEditingRole] = useState<number | null>(null);
    const [selectedPerms, setSelectedPerms] = useState<number[]>([]);
    const [showCreate, setShowCreate] = useState(false);
    const [newName, setNewName] = useState('');
    const [newDisplayName, setNewDisplayName] = useState('');
    const [newDesc, setNewDesc] = useState('');
    const [saving, setSaving] = useState(false);

    const token = localStorage.getItem('token');

    const fetchData = async () => {
        try {
            const [rolesRes, permsRes] = await Promise.all([
                fetch(`${API_URL}/super-admin/roles`, { headers: { Authorization: `Bearer ${token}` } }),
                fetch(`${API_URL}/super-admin/permissions`, { headers: { Authorization: `Bearer ${token}` } }),
            ]);
            const rolesData = await rolesRes.json();
            const permsData = await permsRes.json();
            if (rolesData.success) setRoles(rolesData.roles);
            if (permsData.success) {
                setAllPermissions(permsData.permissions);
                setGrouped(permsData.grouped);
            }
        } catch (err) {
            console.error('Failed to load roles:', err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchData(); }, []);

    const startEditPermissions = (role: Role) => {
        setEditingRole(role.id);
        setSelectedPerms(role.permissions.map(p => p.id));
    };

    const togglePerm = (id: number) => {
        setSelectedPerms(prev => prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id]);
    };

    const savePermissions = async () => {
        if (!editingRole) return;
        setSaving(true);
        try {
            await fetch(`${API_URL}/super-admin/roles/${editingRole}/permissions`, {
                method: 'PUT',
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ permissionIds: selectedPerms }),
            });
            setEditingRole(null);
            fetchData();
        } catch (err) {
            console.error('Save failed:', err);
        } finally {
            setSaving(false);
        }
    };

    const createRole = async () => {
        if (!newName || !newDisplayName) return;
        setSaving(true);
        try {
            await fetch(`${API_URL}/super-admin/roles`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: newName, displayName: newDisplayName, description: newDesc, permissionIds: selectedPerms }),
            });
            setShowCreate(false);
            setNewName(''); setNewDisplayName(''); setNewDesc(''); setSelectedPerms([]);
            fetchData();
        } catch (err) {
            console.error('Create failed:', err);
        } finally {
            setSaving(false);
        }
    };

    const moduleColors: Record<string, string> = {
        dashboard: 'bg-blue-100 text-blue-700',
        invoices: 'bg-green-100 text-green-700',
        reports: 'bg-purple-100 text-purple-700',
        settings: 'bg-orange-100 text-orange-700',
        users: 'bg-pink-100 text-pink-700',
        roles: 'bg-indigo-100 text-indigo-700',
        organization: 'bg-teal-100 text-teal-700',
        eta: 'bg-cyan-100 text-cyan-700',
        masterdata: 'bg-amber-100 text-amber-700',
        erp: 'bg-lime-100 text-lime-700',
        audit: 'bg-rose-100 text-rose-700',
        org_users: 'bg-violet-100 text-violet-700',
        super_admin: 'bg-red-100 text-red-700',
    };

    if (loading) {
        return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" /></div>;
    }

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2"><Lock className="text-blue-600" /> Roles & Permissions</h1>
                    <p className="text-slate-500 text-sm mt-1">Manage user roles and their access permissions</p>
                </div>
                <button onClick={() => { setShowCreate(true); setSelectedPerms([]); }} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-blue-700 flex items-center gap-2">
                    <Plus size={16} /> Create Role
                </button>
            </div>

            {/* Create Role Modal */}
            {showCreate && (
                <div className="bg-white rounded-xl border-2 border-blue-200 p-5">
                    <h3 className="font-bold text-slate-800 mb-4">Create New Role</h3>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                        <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Role name (e.g. accountant)" className="border rounded-lg px-3 py-2 text-sm" />
                        <input value={newDisplayName} onChange={e => setNewDisplayName(e.target.value)} placeholder="Display name (e.g. Accountant)" className="border rounded-lg px-3 py-2 text-sm" />
                        <input value={newDesc} onChange={e => setNewDesc(e.target.value)} placeholder="Description (optional)" className="border rounded-lg px-3 py-2 text-sm" />
                    </div>
                    <p className="text-xs font-semibold text-slate-500 mb-2 uppercase">Select Permissions:</p>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 mb-4 max-h-60 overflow-y-auto">
                        {Object.entries(grouped).map(([module, perms]) => (
                            <div key={module} className="space-y-1">
                                <p className={`text-xs font-bold px-2 py-1 rounded ${moduleColors[module] || 'bg-gray-100 text-gray-700'}`}>{module.toUpperCase()}</p>
                                {perms.map(p => (
                                    <label key={p.id} className="flex items-center gap-2 text-xs text-slate-600 px-2 cursor-pointer hover:bg-gray-50 rounded">
                                        <input type="checkbox" checked={selectedPerms.includes(p.id)} onChange={() => togglePerm(p.id)} className="rounded border-gray-300" />
                                        {p.displayName}
                                    </label>
                                ))}
                            </div>
                        ))}
                    </div>
                    <div className="flex gap-2">
                        <button onClick={createRole} disabled={saving} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-blue-700">
                            {saving ? 'Creating...' : 'Create Role'}
                        </button>
                        <button onClick={() => setShowCreate(false)} className="bg-gray-200 text-gray-700 px-4 py-2 rounded-lg text-sm hover:bg-gray-300">Cancel</button>
                    </div>
                </div>
            )}

            {/* Roles List */}
            <div className="space-y-3">
                {roles.map(role => (
                    <div key={role.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                        <div
                            className="flex items-center justify-between p-4 cursor-pointer hover:bg-gray-50"
                            onClick={() => setExpandedRole(expandedRole === role.id ? null : role.id)}
                        >
                            <div className="flex items-center gap-3">
                                <Shield size={20} className={role.isSystem ? 'text-amber-500' : 'text-blue-500'} />
                                <div>
                                    <h3 className="font-bold text-slate-800">{role.displayName}</h3>
                                    <p className="text-xs text-slate-400">{role.name} {role.isSystem && '(system)'}</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-4">
                                <div className="flex items-center gap-1 text-xs text-slate-500"><Users size={14} /> {role.userCount} users</div>
                                <div className="flex items-center gap-1 text-xs text-slate-500"><Lock size={14} /> {role.permissionCount} perms</div>
                                {expandedRole === role.id ? <ChevronDown size={16} className="text-slate-400" /> : <ChevronRight size={16} className="text-slate-400" />}
                            </div>
                        </div>

                        {expandedRole === role.id && (
                            <div className="border-t border-gray-100 p-4 bg-gray-50">
                                {editingRole === role.id ? (
                                    <>
                                        <p className="text-xs font-semibold text-slate-500 mb-2 uppercase">Edit Permissions:</p>
                                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 mb-4 max-h-60 overflow-y-auto">
                                            {Object.entries(grouped).map(([module, perms]) => (
                                                <div key={module} className="space-y-1">
                                                    <p className={`text-xs font-bold px-2 py-1 rounded ${moduleColors[module] || 'bg-gray-100'}`}>{module.toUpperCase()}</p>
                                                    {perms.map(p => (
                                                        <label key={p.id} className="flex items-center gap-2 text-xs text-slate-600 px-2 cursor-pointer hover:bg-white rounded">
                                                            <input type="checkbox" checked={selectedPerms.includes(p.id)} onChange={() => togglePerm(p.id)} className="rounded border-gray-300" />
                                                            {p.displayName}
                                                        </label>
                                                    ))}
                                                </div>
                                            ))}
                                        </div>
                                        <div className="flex gap-2">
                                            <button onClick={savePermissions} disabled={saving} className="bg-green-600 text-white px-3 py-1.5 rounded text-xs font-semibold hover:bg-green-700 flex items-center gap-1">
                                                <Check size={12} /> {saving ? 'Saving...' : 'Save'}
                                            </button>
                                            <button onClick={() => setEditingRole(null)} className="bg-gray-200 text-gray-700 px-3 py-1.5 rounded text-xs hover:bg-gray-300 flex items-center gap-1">
                                                <X size={12} /> Cancel
                                            </button>
                                        </div>
                                    </>
                                ) : (
                                    <>
                                        <div className="flex items-center justify-between mb-3">
                                            <p className="text-xs font-semibold text-slate-500 uppercase">Current Permissions ({role.permissionCount})</p>
                                            <button onClick={() => startEditPermissions(role)} className="text-blue-600 text-xs font-semibold hover:text-blue-800">Edit Permissions</button>
                                        </div>
                                        <div className="flex flex-wrap gap-1.5">
                                            {role.permissions.length > 0 ? role.permissions.map(p => (
                                                <span key={p.id} className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${moduleColors[p.module] || 'bg-gray-100 text-gray-600'}`}>
                                                    {p.displayName}
                                                </span>
                                            )) : (
                                                <span className="text-xs text-slate-400">No permissions assigned</span>
                                            )}
                                        </div>
                                    </>
                                )}
                            </div>
                        )}
                    </div>
                ))}

                {roles.length === 0 && (
                    <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-slate-400">
                        No roles found. Create one to get started.
                    </div>
                )}
            </div>
        </div>
    );
};

export default SuperAdminRoles;
