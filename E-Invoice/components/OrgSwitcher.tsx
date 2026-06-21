
import React, { useState, useEffect, useRef } from 'react';
import { Building2, ChevronDown, X } from 'lucide-react';
import { API_URL } from '../services/apiService';

interface Org {
    id: number;
    name: string;
    tax_id: string;
    is_active: boolean;
}

interface OrgSwitcherProps {
    isSuperAdmin: boolean;
}

const OrgSwitcher: React.FC<OrgSwitcherProps> = ({ isSuperAdmin }) => {
    const [orgs, setOrgs] = useState<Org[]>([]);
    const [selectedOrg, setSelectedOrg] = useState<Org | null>(null);
    const [isOpen, setIsOpen] = useState(false);
    const [search, setSearch] = useState('');
    const ref = useRef<HTMLDivElement>(null);

    // Close dropdown on outside click
    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) setIsOpen(false);
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    // Load selected org from localStorage
    useEffect(() => {
        const stored = localStorage.getItem('super_admin_scoped_org');
        if (stored) {
            try { setSelectedOrg(JSON.parse(stored)); } catch { }
        }
    }, []);

    // Fetch orgs list when dropdown opens
    useEffect(() => {
        if (!isOpen || orgs.length > 0) return;
        const fetchOrgs = async () => {
            try {
                const userStr = localStorage.getItem('invoice_user');
                const token = userStr ? JSON.parse(userStr).token : null;
                const resp = await fetch(`${API_URL}/super-admin/organizations`, {
                    headers: {
                        'Content-Type': 'application/json',
                        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
                    }
                });
                const data = await resp.json();
                if (data.success && data.organizations) {
                    setOrgs(data.organizations);
                }
            } catch (e) {
                console.error('[OrgSwitcher] Failed to fetch orgs:', e);
            }
        };
        fetchOrgs();
    }, [isOpen]);

    if (!isSuperAdmin) return null;

    const selectOrg = (org: Org) => {
        setSelectedOrg(org);
        localStorage.setItem('super_admin_scoped_org', JSON.stringify(org));
        setIsOpen(false);
        setSearch('');
        // Reload the page so all components pick up the new org context
        window.location.reload();
    };

    const clearOrg = (e: React.MouseEvent) => {
        e.stopPropagation();
        setSelectedOrg(null);
        localStorage.removeItem('super_admin_scoped_org');
        window.location.reload();
    };

    const filtered = orgs.filter(o =>
        o.name.toLowerCase().includes(search.toLowerCase()) ||
        o.tax_id?.includes(search)
    );

    return (
        <div ref={ref} className="relative">
            <button
                onClick={() => setIsOpen(!isOpen)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-bold transition-all border ${selectedOrg
                        ? 'bg-amber-50 border-amber-200 text-amber-700 hover:bg-amber-100'
                        : 'bg-gray-100 border-gray-200 text-slate-600 hover:bg-gray-200'
                    }`}
            >
                <Building2 size={14} />
                <span className="max-w-[160px] truncate">
                    {selectedOrg ? selectedOrg.name : 'Select Organization'}
                </span>
                {selectedOrg ? (
                    <X size={14} className="hover:text-red-500 shrink-0" onClick={clearOrg} />
                ) : (
                    <ChevronDown size={14} className={`transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                )}
            </button>

            {isOpen && (
                <div className="absolute top-full mt-2 left-0 w-72 bg-white border border-gray-200 rounded-xl shadow-xl z-50 overflow-hidden">
                    <div className="p-2 border-b border-gray-100">
                        <input
                            type="text"
                            placeholder="Search organizations..."
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className="w-full px-3 py-2 text-xs bg-gray-50 border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-amber-300"
                            autoFocus
                        />
                    </div>
                    <div className="max-h-60 overflow-y-auto">
                        {filtered.length === 0 ? (
                            <div className="p-4 text-center text-xs text-slate-400">
                                {orgs.length === 0 ? 'Loading...' : 'No organizations found'}
                            </div>
                        ) : (
                            filtered.map(org => (
                                <button
                                    key={org.id}
                                    onClick={() => selectOrg(org)}
                                    className={`w-full text-left px-4 py-2.5 text-xs hover:bg-amber-50 transition-colors flex items-center justify-between ${selectedOrg?.id === org.id ? 'bg-amber-50 font-bold text-amber-700' : 'text-slate-700'
                                        }`}
                                >
                                    <div>
                                        <div className="font-semibold">{org.name}</div>
                                        <div className="text-[10px] text-slate-400 font-mono">{org.tax_id}</div>
                                    </div>
                                    {!org.is_active && (
                                        <span className="text-[9px] bg-red-100 text-red-500 px-1.5 py-0.5 rounded font-bold">Inactive</span>
                                    )}
                                </button>
                            ))
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default OrgSwitcher;
