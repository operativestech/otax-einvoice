import React, { useState, useEffect } from 'react';
import { User, Building, Mail, Phone, MapPin, Globe, Shield, Save, Key, AlertCircle, CreditCard } from 'lucide-react';
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
            const token = localStorage.getItem('token');
            if (!token) return;

            const response = await fetch('/api/auth/me', {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            if (!response.ok) throw new Error('Failed to fetch user data');

            const data = await response.json();
            if (data.success) {
                setUser(data.user);
                if (data.user.organization) {
                    setOrgForm(data.user.organization);
                }
            }
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const handlePasswordChange = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setSuccessMessage(null);

        if (password !== confirmPassword) {
            setError("Passwords don't match");
            return;
        }

        // Call API to update password (implement if needed)
        setSuccessMessage("Password update functionality requires backend endpoint.");
    };

    const handleOrgUpdate = async (e: React.FormEvent) => {
        e.preventDefault();
        if (user?.isDemo) {
            setError("Demo users cannot modify organization settings.");
            return;
        }

        try {
            const token = localStorage.getItem('token');
            const response = await fetch('/api/admin/organization', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(orgForm)
            });

            const data = await response.json();
            if (data.success) {
                setSuccessMessage("Organization details updated successfully!");
                setTimeout(() => setSuccessMessage(null), 3000);
            } else {
                throw new Error(data.message);
            }
        } catch (err: any) {
            setError(err.message || 'Failed to update organization');
        }
    };

    if (loading) {
        return <div className="flex justify-center items-center h-screen">Loading...</div>;
    }

    return (
        <div className="p-6 max-w-6xl mx-auto space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-slate-800">Profile Settings</h1>
                    <p className="text-slate-500">Manage your account and organization details</p>
                </div>
            </div>

            {error && (
                <div className="bg-red-50 text-red-600 p-4 rounded-lg flex items-center gap-2">
                    <AlertCircle size={20} />
                    {error}
                </div>
            )}

            {successMessage && (
                <div className="bg-green-50 text-green-600 p-4 rounded-lg flex items-center gap-2">
                    <Shield size={20} />
                    {successMessage}
                </div>
            )}

            {/* Tabs */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                <div className="flex border-b border-gray-200">
                    <button
                        onClick={() => setActiveTab('profile')}
                        className={`flex-1 py-4 px-6 text-sm font-semibold flex items-center justify-center gap-2 transition-colors ${activeTab === 'profile'
                            ? 'bg-blue-50 text-blue-600 border-b-2 border-blue-600'
                            : 'text-slate-600 hover:bg-gray-50'
                            }`}
                    >
                        <User size={18} /> My Profile
                    </button>
                    <button
                        onClick={() => setActiveTab('organization')}
                        className={`flex-1 py-4 px-6 text-sm font-semibold flex items-center justify-center gap-2 transition-colors ${activeTab === 'organization'
                            ? 'bg-blue-50 text-blue-600 border-b-2 border-blue-600'
                            : 'text-slate-600 hover:bg-gray-50'
                            }`}
                    >
                        <Building size={18} /> Organization Info
                    </button>
                </div>

                <div className="p-6">
                    {activeTab === 'profile' && (
                        <div className="space-y-8">
                            <div className="flex items-center gap-6">
                                <div className="w-24 h-24 bg-blue-100 rounded-full flex items-center justify-center text-blue-600 text-3xl font-bold">
                                    {user?.username?.[0]?.toUpperCase() || 'U'}
                                </div>
                                <div>
                                    <h3 className="text-xl font-bold text-slate-800">{user?.username}</h3>
                                    <p className="text-slate-500 capitalize">{user?.role || 'User'}</p>
                                    <div className="flex items-center gap-2 mt-2">
                                        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${user?.isValid ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                                            {user?.isValid ? 'Active Account' : 'Inactive'}
                                        </span>
                                        {user?.isDemo && (
                                            <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-orange-100 text-orange-700">
                                                Demo Mode
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </div>

                            <div className="border-t border-gray-200 pt-8">
                                <h3 className="text-lg font-semibold text-slate-800 mb-4 flex items-center gap-2">
                                    <Key size={20} className="text-slate-400" /> Security
                                </h3>
                                <form onSubmit={handlePasswordChange} className="max-w-md space-y-4">
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 mb-1">New Password</label>
                                        <PasswordInput
                                            value={password}
                                            onChange={(e) => setPassword(e.target.value)}
                                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                            placeholder="••••••••"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 mb-1">Confirm Password</label>
                                        <PasswordInput
                                            value={confirmPassword}
                                            onChange={(e) => setConfirmPassword(e.target.value)}
                                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                            placeholder="••••••••"
                                        />
                                    </div>
                                    <button type="submit" className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2">
                                        <Save size={16} /> Update Password
                                    </button>
                                </form>
                            </div>
                        </div>
                    )}

                    {activeTab === 'organization' && (
                        <div>
                            {!user?.organization ? (
                                <div className="text-center py-12 text-slate-500">
                                    <Building size={48} className="mx-auto mb-4 text-slate-300" />
                                    <p>No organization information linked to your account.</p>
                                </div>
                            ) : (
                                <form onSubmit={handleOrgUpdate} className="space-y-6">
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                        <div>
                                            <label className="block text-sm font-medium text-slate-700 mb-1">Company Name</label>
                                            <input
                                                type="text"
                                                value={orgForm?.name || ''}
                                                onChange={(e) => handleOrgChange('name', e.target.value)}
                                                readOnly={user?.isDemo}
                                                className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-50 focus:bg-white transition-colors"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-slate-700 mb-1">Tax ID</label>
                                            <input
                                                type="text"
                                                value={orgForm?.tax_id || ''}
                                                readOnly
                                                className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-100 cursor-not-allowed"
                                            />
                                        </div>
                                    </div>


                                    <div className="border-t border-gray-200 pt-6">
                                        <h4 className="text-sm font-semibold text-slate-800 mb-4 flex items-center gap-2 uppercase tracking-wide">
                                            <CreditCard size={16} className="text-blue-500" /> Subscription Plan
                                        </h4>
                                        <div className="bg-blue-50 border border-blue-100 rounded-xl p-4">
                                            <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
                                                <div className="flex-1">
                                                    <label className="block text-sm font-medium text-slate-700 mb-1">Current Plan</label>
                                                    <select
                                                        value={orgForm?.subscription_plan || 'starter'}
                                                        onChange={(e) => handleOrgChange('subscription_plan', e.target.value)}
                                                        className="w-full px-4 py-2 border border-blue-200 rounded-lg bg-white text-slate-700 focus:ring-2 focus:ring-blue-500 outline-none"
                                                    >
                                                        <option value="starter">Starter Plan ($49/mo)</option>
                                                        <option value="pro">Pro Plan ($99/mo)</option>
                                                        <option value="enterprise">Enterprise Plan ($299/mo)</option>
                                                    </select>
                                                </div>
                                                <div className="text-xs text-blue-600 bg-blue-100 px-3 py-2 rounded-lg max-w-xs">
                                                    Manage your billing cycle and limits from the Billing Portal (Coming Soon).
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="border-t border-gray-200 pt-6">
                                        <h4 className="text-sm font-semibold text-slate-800 mb-4 flex items-center gap-2 uppercase tracking-wide">
                                            <MapPin size={16} className="text-blue-500" /> Address & Contact
                                        </h4>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                            <div>
                                                <label className="block text-sm font-medium text-slate-700 mb-1">Address</label>
                                                <input
                                                    type="text"
                                                    value={orgForm?.street || ''}
                                                    onChange={(e) => handleOrgChange('street', e.target.value)}
                                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                                                    placeholder="Street Address"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-sm font-medium text-slate-700 mb-1">City</label>
                                                <input
                                                    type="text"
                                                    value={orgForm?.city || ''}
                                                    onChange={(e) => handleOrgChange('city', e.target.value)}
                                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                                                    placeholder="City"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
                                                <div className="relative">
                                                    <Mail size={16} className="absolute left-3 top-3 text-gray-400" />
                                                    <input
                                                        type="email"
                                                        value={orgForm?.email || ''}
                                                        onChange={(e) => handleOrgChange('email', e.target.value)}
                                                        className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg"
                                                        placeholder="company@example.com"
                                                    />
                                                </div>
                                            </div>
                                            <div>
                                                <label className="block text-sm font-medium text-slate-700 mb-1">Website</label>
                                                <div className="relative">
                                                    <Globe size={16} className="absolute left-3 top-3 text-gray-400" />
                                                    <input
                                                        type="text"
                                                        value={orgForm?.website || ''}
                                                        onChange={(e) => handleOrgChange('website', e.target.value)}
                                                        className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg"
                                                        placeholder="www.example.com"
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    {!user?.isDemo && (
                                        <div className="flex justify-end pt-4">
                                            <button type="submit" className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2 shadow-sm">
                                                <Save size={18} /> Save Organization Changes
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
