import React, { useState, useEffect } from 'react';
import { User, Building, Mail, Phone, MapPin, Globe, Shield, Save, Key, AlertCircle, CreditCard, Lock, Check } from 'lucide-react';
import PasswordInput from '../components/PasswordInput';

interface Organization {
    id: number;
    name: string;
    tax_id: string;
    subscription_plan: string | null;
    logo_url: string | null;
    email?: string;
    phone?: string;
    website?: string;
    country?: string;
    governorate?: string;
    city?: string;
    street?: string;
    building_number?: string;
    postal_code?: string;
}

interface UserProfile {
    id: number;
    username: string;
    isDemo: boolean | null;
    isValid: boolean;
    role?: string;
    organization?: Organization;
    registerDate?: string;
    expiryDate?: string;
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

const ProfileSettings: React.FC = () => {
    const [activeTab, setActiveTab] = useState<'profile' | 'organization'>('profile');
    const [user, setUser] = useState<UserProfile | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [successMessage, setSuccessMessage] = useState<string | null>(null);

    // Form states
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');

    // Organization form states
    const [orgForm, setOrgForm] = useState<Organization | null>(null);

    const handleOrgChange = (field: keyof Organization, value: string) => {
        if (orgForm) {
            setOrgForm({ ...orgForm, [field]: value });
        }
    };

    useEffect(() => {
        fetchUserData();
    }, []);

    const fetchUserData = async () => {
        try {
            const headers = getAuthHeaders();
            if (!headers['Authorization']) {
                setError("Not authenticated. Please log in.");
                setLoading(false);
                return;
            }

            const response = await fetch('/api/auth/me', { headers });

            if (!response.ok) throw new Error('Failed to fetch user data');

            const data = await response.json();
            if (data.success) {
                setUser(data.user);
                if (data.user.organization) {
                    setOrgForm(data.user.organization);
                }
            }
        } catch (err: any) {
            setError(err.message || 'Failed to load user data');
        } finally {
            setLoading(false);
        }
    };

    const handlePasswordChange = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setSuccessMessage(null);

        if (!password || !confirmPassword) {
            setError("Password fields cannot be empty");
            return;
        }

        if (password !== confirmPassword) {
            setError("Passwords do not match");
            return;
        }

        if (user?.isDemo) {
            setError("Demo users cannot modify account settings.");
            return;
        }

        try {
            const headers = getAuthHeaders();
            const response = await fetch('/api/auth/change-password', {
                method: 'PUT',
                headers,
                body: JSON.stringify({ password })
            });

            const data = await response.json();
            if (data.success) {
                setSuccessMessage("Password updated successfully!");
                setPassword('');
                setConfirmPassword('');
                setTimeout(() => setSuccessMessage(null), 4000);
            } else {
                throw new Error(data.message || 'Failed to update password');
            }
        } catch (err: any) {
            setError(err.message || 'Failed to update password');
        }
    };

    const handleOrgUpdate = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setSuccessMessage(null);

        if (user?.isDemo) {
            setError("Demo users cannot modify organization settings.");
            return;
        }

        try {
            const headers = getAuthHeaders();
            const response = await fetch('/api/admin/organization', {
                method: 'PUT',
                headers,
                body: JSON.stringify(orgForm)
            });

            const data = await response.json();
            if (data.success) {
                setSuccessMessage("Organization details updated successfully!");
                setTimeout(() => setSuccessMessage(null), 4000);
            } else {
                throw new Error(data.message || 'Failed to update organization');
            }
        } catch (err: any) {
            setError(err.message || 'Failed to update organization');
        }
    };

    if (loading) {
        return (
            <div className="flex justify-center items-center h-[60vh]">
                <div className="relative w-12 h-12">
                    <div className="absolute inset-0 rounded-full border-4 border-blue-500/20"></div>
                    <div className="absolute inset-0 rounded-full border-4 border-t-blue-600 animate-spin"></div>
                </div>
            </div>
        );
    }

    return (
        <div className="max-w-4xl mx-auto space-y-6">
            
            {/* Header */}
            <div>
                <h1 className="text-2xl font-bold text-slate-800">Profile Settings</h1>
                <p className="text-sm text-slate-500 mt-1">Manage your personal security credentials and organization metadata</p>
            </div>

            {/* Notification messages */}
            {error && (
                <div className="bg-red-50/70 backdrop-blur-sm text-red-700 px-4 py-3 rounded-xl border border-red-100 flex items-center gap-2 text-sm shadow-sm transition-all duration-300">
                    <AlertCircle size={18} className="shrink-0" />
                    <span className="font-medium">{error}</span>
                </div>
            )}

            {successMessage && (
                <div className="bg-emerald-50/70 backdrop-blur-sm text-emerald-800 px-4 py-3 rounded-xl border border-emerald-100 flex items-center gap-2 text-sm shadow-sm transition-all duration-300">
                    <Check size={18} className="shrink-0" />
                    <span className="font-semibold">{successMessage}</span>
                </div>
            )}

            {/* Glass panel container */}
            <div className="glass-panel overflow-hidden">
                
                {/* Modern Tabs */}
                <div className="flex border-b border-slate-200/50 bg-slate-50/60 shrink-0">
                    <button
                        onClick={() => { setError(null); setActiveTab('profile'); }}
                        className={`flex-1 py-4 px-6 text-xs uppercase tracking-wider font-bold flex items-center justify-center gap-2.5 transition-all duration-200 border-b-2 ${activeTab === 'profile'
                            ? 'border-blue-600 text-blue-600 bg-white/70'
                            : 'border-transparent text-slate-500 hover:text-slate-800 hover:bg-slate-100/30'
                            }`}
                    >
                        <User size={16} /> My Account
                    </button>
                    <button
                        onClick={() => { setError(null); setActiveTab('organization'); }}
                        className={`flex-1 py-4 px-6 text-xs uppercase tracking-wider font-bold flex items-center justify-center gap-2.5 transition-all duration-200 border-b-2 ${activeTab === 'organization'
                            ? 'border-blue-600 text-blue-600 bg-white/70'
                            : 'border-transparent text-slate-500 hover:text-slate-800 hover:bg-slate-100/30'
                            }`}
                    >
                        <Building size={16} /> Organization Profile
                    </button>
                </div>

                {/* Tab Contents */}
                <div className="p-6 sm:p-8">
                    {activeTab === 'profile' && (
                        <div className="space-y-8">
                            
                            {/* User Avatar details */}
                            <div className="flex flex-col sm:flex-row items-center gap-5 pb-6 border-b border-slate-100">
                                <div className="w-20 h-20 bg-gradient-to-tr from-blue-500 to-indigo-600 text-white rounded-2xl flex items-center justify-center text-3xl font-extrabold shadow-[0_8px_20px_rgba(37,99,235,0.2)]">
                                    {user?.username?.[0]?.toUpperCase() || 'U'}
                                </div>
                                <div className="text-center sm:text-left space-y-1">
                                    <h3 className="text-lg font-bold text-slate-800">{user?.username}</h3>
                                    <p className="text-xs text-slate-500 font-semibold uppercase tracking-wide">{user?.role || 'Organization User'}</p>
                                    
                                    <div className="flex items-center justify-center sm:justify-start gap-1.5 pt-1.5">
                                        <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${user?.isValid ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                                            {user?.isValid ? 'ACTIVE ACCOUNT' : 'SUSPENDED'}
                                        </span>
                                        {user?.isDemo && (
                                            <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-100 text-amber-700">
                                                DEMO MODE
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* Security / Password Form */}
                            <div className="space-y-4">
                                <div className="flex items-center gap-2">
                                    <Lock size={18} className="text-slate-400" />
                                    <h4 className="text-sm font-bold text-slate-800 uppercase tracking-wider">Security & Password</h4>
                                </div>
                                <p className="text-xs text-slate-400">Keep your system account safe by configuring a strong password.</p>
                                
                                <form onSubmit={handlePasswordChange} className="max-w-md space-y-4 pt-2">
                                    <div className="space-y-1">
                                        <label className="block text-[11px] font-bold text-slate-400 uppercase">New Password</label>
                                        <PasswordInput
                                            value={password}
                                            onChange={(e) => setPassword(e.target.value)}
                                            className="w-full px-3 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 focus:outline-none text-sm transition-all"
                                            placeholder="••••••••"
                                        />
                                    </div>
                                    <div className="space-y-1">
                                        <label className="block text-[11px] font-bold text-slate-400 uppercase">Confirm Password</label>
                                        <PasswordInput
                                            value={confirmPassword}
                                            onChange={(e) => setConfirmPassword(e.target.value)}
                                            className="w-full px-3 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 focus:outline-none text-sm transition-all"
                                            placeholder="••••••••"
                                        />
                                    </div>
                                    <button 
                                        type="submit" 
                                        disabled={user?.isDemo || !password}
                                        className="bg-blue-600 text-white px-4 py-2.5 rounded-xl hover:bg-blue-700 disabled:opacity-50 transition-all font-semibold text-xs flex items-center gap-2 shadow-md shadow-blue-200"
                                    >
                                        <Save size={14} /> Update Account Password
                                    </button>
                                </form>
                            </div>
                        </div>
                    )}

                    {activeTab === 'organization' && (
                        <div>
                            {!user?.organization ? (
                                <div className="text-center py-12 text-slate-400">
                                    <Building size={48} className="mx-auto mb-3 opacity-20" />
                                    <p className="font-semibold text-sm">No organization linked</p>
                                    <p className="text-xs mt-1">Contact your system administrator to associate your profile.</p>
                                </div>
                            ) : (
                                <form onSubmit={handleOrgUpdate} className="space-y-6">
                                    
                                    {/* Primary Info */}
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                        <div className="space-y-1">
                                            <label className="block text-[11px] font-bold text-slate-400 uppercase">Company Legal Name</label>
                                            <input
                                                type="text"
                                                value={orgForm?.name || ''}
                                                onChange={(e) => handleOrgChange('name', e.target.value)}
                                                readOnly={user?.isDemo}
                                                className="w-full px-3 py-2.5 border border-gray-200 rounded-xl bg-slate-50/50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-semibold text-slate-700"
                                            />
                                        </div>
                                        <div className="space-y-1">
                                            <label className="block text-[11px] font-bold text-slate-400 uppercase">Tax Registration ID</label>
                                            <input
                                                type="text"
                                                value={orgForm?.tax_id || ''}
                                                readOnly
                                                className="w-full px-3 py-2.5 border border-gray-200 rounded-xl bg-slate-100 text-sm cursor-not-allowed text-slate-400 font-semibold"
                                            />
                                        </div>
                                    </div>

                                    {/* Subscription plan */}
                                    <div className="border-t border-slate-100 pt-6 space-y-3">
                                        <div className="flex items-center gap-2">
                                            <CreditCard size={18} className="text-slate-400" />
                                            <h4 className="text-sm font-bold text-slate-800 uppercase tracking-wider">Subscription & Limits</h4>
                                        </div>
                                        <div className="bg-gradient-to-br from-blue-50/60 to-indigo-50/60 border border-blue-100/50 rounded-2xl p-4">
                                            <div className="flex flex-col sm:flex-row gap-4 items-center justify-between">
                                                <div className="w-full sm:max-w-xs space-y-1">
                                                    <label className="block text-[10px] font-bold text-blue-800 uppercase">Tier Selection</label>
                                                    <select
                                                        value={orgForm?.subscription_plan || 'starter'}
                                                        onChange={(e) => handleOrgChange('subscription_plan', e.target.value)}
                                                        disabled={user?.isDemo}
                                                        className="w-full px-3 py-2 border border-blue-200 rounded-xl bg-white text-xs font-bold text-slate-700 focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                                                    >
                                                        <option value="starter">Starter Plan ($49/mo)</option>
                                                        <option value="pro">Pro Plan ($99/mo)</option>
                                                        <option value="enterprise">Enterprise Plan ($299/mo)</option>
                                                    </select>
                                                </div>
                                                <div className="text-[10px] text-blue-600 bg-white/80 border border-blue-100 rounded-xl p-3 max-w-xs font-medium leading-relaxed">
                                                    Limits, usage statistics, and direct billing billing operations are managed from the primary payment portal.
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Address & Metadata */}
                                    <div className="border-t border-slate-100 pt-6 space-y-4">
                                        <div className="flex items-center gap-2">
                                            <MapPin size={18} className="text-slate-400" />
                                            <h4 className="text-sm font-bold text-slate-800 uppercase tracking-wider">Address & Communications</h4>
                                        </div>
                                        
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                            <div className="space-y-1">
                                                <label className="block text-[11px] font-bold text-slate-400 uppercase">Street Name</label>
                                                <input
                                                    type="text"
                                                    value={orgForm?.street || ''}
                                                    onChange={(e) => handleOrgChange('street', e.target.value)}
                                                    readOnly={user?.isDemo}
                                                    className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                                                    placeholder="12 El Maadi St."
                                                />
                                            </div>
                                            <div className="space-y-1">
                                                <label className="block text-[11px] font-bold text-slate-400 uppercase">City</label>
                                                <input
                                                    type="text"
                                                    value={orgForm?.city || ''}
                                                    onChange={(e) => handleOrgChange('city', e.target.value)}
                                                    readOnly={user?.isDemo}
                                                    className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                                                    placeholder="Cairo"
                                                />
                                            </div>
                                            <div className="space-y-1">
                                                <label className="block text-[11px] font-bold text-slate-400 uppercase">Company Email</label>
                                                <div className="relative">
                                                    <Mail size={14} className="absolute left-3 top-3.5 text-slate-400" />
                                                    <input
                                                        type="email"
                                                        value={orgForm?.email || ''}
                                                        onChange={(e) => handleOrgChange('email', e.target.value)}
                                                        readOnly={user?.isDemo}
                                                        className="w-full pl-9 pr-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                                                        placeholder="info@company.com"
                                                    />
                                                </div>
                                            </div>
                                            <div className="space-y-1">
                                                <label className="block text-[11px] font-bold text-slate-400 uppercase">Website URL</label>
                                                <div className="relative">
                                                    <Globe size={14} className="absolute left-3 top-3.5 text-slate-400" />
                                                    <input
                                                        type="text"
                                                        value={orgForm?.website || ''}
                                                        onChange={(e) => handleOrgChange('website', e.target.value)}
                                                        readOnly={user?.isDemo}
                                                        className="w-full pl-9 pr-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                                                        placeholder="https://company.com"
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    {!user?.isDemo && (
                                        <div className="flex justify-end pt-4 border-t border-slate-100">
                                            <button 
                                                type="submit" 
                                                className="bg-blue-600 text-white px-6 py-2.5 rounded-xl hover:bg-blue-700 transition-all font-semibold text-xs flex items-center gap-2 shadow-md shadow-blue-200"
                                            >
                                                <Save size={14} /> Save Organization Changes
                                            </button>
                                        </div>
                                    )}
                                </form>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default ProfileSettings;
