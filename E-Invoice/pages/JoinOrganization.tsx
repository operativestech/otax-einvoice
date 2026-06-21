import React, { useState, useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Building2, Mail, Lock, User, Shield, Loader2, ChevronLeft, Search } from 'lucide-react';
import PasswordInput from '../components/PasswordInput';

interface JoinOrgProps {
    onLogin: (user: any) => void;
}

const JoinOrganization: React.FC<JoinOrgProps> = ({ onLogin }) => {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const [step, setStep] = useState<'code' | 'register' | 'verify'>('code');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [joinCode, setJoinCode] = useState(searchParams.get('code') || '');
    const [orgInfo, setOrgInfo] = useState<{ name: string; id: number } | null>(null);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [name, setName] = useState('');
    const [otp, setOtp] = useState('');

    const API_URL = (() => {
        const hostname = window.location.hostname;
        if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname.startsWith('192.168.') || hostname.startsWith('10.')) return '/api';
        return 'https://e-invoice-545y.onrender.com/api';
    })();

    // Auto-lookup if code in URL
    useEffect(() => {
        if (joinCode && joinCode.length >= 6) lookupOrg();
    }, []);

    const lookupOrg = async () => {
        if (!joinCode) { setError('Please enter your organization code'); return; }
        setLoading(true);
        setError(null);
        try {
            const res = await fetch(`${API_URL}/auth/org-info/${joinCode}`);
            const data = await res.json();
            if (data.success) {
                setOrgInfo(data.org);
                setStep('register');
            } else {
                setError(data.message || 'Organization not found');
            }
        } catch {
            setError('Failed to find organization');
        } finally {
            setLoading(false);
        }
    };

    const handleJoin = async () => {
        if (!email || !password || !name) { setError('All fields are required'); return; }
        if (!/\S+@\S+\.\S+/.test(email)) { setError('Please enter a valid email'); return; }
        if (password.length < 6) { setError('Password must be at least 6 characters'); return; }

        setLoading(true);
        setError(null);
        try {
            const res = await fetch(`${API_URL}/auth/join-org`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ joinCode, email, password, name }),
            });
            const data = await res.json();
            if (data.success) {
                setStep('verify');
            } else {
                setError(data.message || 'Failed to join organization');
            }
        } catch {
            setError('Failed to join organization');
        } finally {
            setLoading(false);
        }
    };

    const handleVerifyOTP = async () => {
        if (!otp || otp.length !== 6) { setError('Please enter the 6-digit code'); return; }
        setLoading(true);
        setError(null);
        try {
            const res = await fetch(`${API_URL}/auth/verify-otp`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, code: otp, type: 'signup_verify' }),
            });
            const data = await res.json();
            if (data.success && data.token) {
                onLogin({
                    ...data.user,
                    name: data.user.username,
                    role: 'User',
                    avatar: '',
                    token: data.token,
                });
                navigate('/dashboard');
            } else {
                setError(data.message || 'Verification failed');
            }
        } catch {
            setError('Verification failed');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-xl border border-gray-100 w-full max-w-md overflow-hidden">
                {/* Header */}
                <div className="bg-slate-900 px-6 py-5 text-center">
                    <div className="flex items-center justify-center gap-2 mb-2">
                        <div className="bg-blue-600 p-1.5 rounded-lg"><Shield size={20} className="text-white" /></div>
                        <span className="text-white font-bold text-xl">OTax</span>
                    </div>
                    <p className="text-slate-400 text-sm">Join an existing organization</p>
                </div>

                <div className="p-6">
                    {error && (
                        <div className="mb-4 p-3 bg-red-50 border border-red-100 rounded-xl text-red-600 text-sm font-medium">{error}</div>
                    )}

                    {/* Step: Enter Org Code */}
                    {step === 'code' && (
                        <div className="space-y-4">
                            <div className="text-center mb-4">
                                <div className="w-14 h-14 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-3">
                                    <Building2 size={24} className="text-blue-600" />
                                </div>
                                <h3 className="text-lg font-bold text-slate-800">Enter Organization Code</h3>
                                <p className="text-sm text-slate-500 mt-1">Ask your admin for the organization join code</p>
                            </div>
                            <div>
                                <label className="text-xs font-bold text-slate-500 uppercase block mb-1">Organization Code</label>
                                <div className="relative">
                                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                    <input type="text" value={joinCode} onChange={e => setJoinCode(e.target.value.toUpperCase())} placeholder="e.g. A1B2C3D4"
                                        className="w-full pl-10 pr-4 py-3 border-2 border-gray-200 rounded-xl text-sm font-mono font-bold tracking-widest text-center uppercase focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                                        onKeyDown={e => e.key === 'Enter' && lookupOrg()} maxLength={12} />
                                </div>
                            </div>
                            <button onClick={lookupOrg} disabled={loading || !joinCode}
                                className="w-full bg-blue-600 text-white py-3 rounded-xl font-semibold text-sm hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
                                {loading ? <Loader2 size={18} className="animate-spin" /> : 'Find Organization'}
                            </button>
                        </div>
                    )}

                    {/* Step: Register */}
                    {step === 'register' && orgInfo && (
                        <div className="space-y-4">
                            {/* Org info banner */}
                            <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 flex items-center gap-3">
                                <div className="w-10 h-10 bg-blue-600 text-white rounded-lg flex items-center justify-center font-bold text-lg">
                                    {orgInfo.name[0]}
                                </div>
                                <div>
                                    <p className="font-semibold text-sm text-slate-800">Joining: {orgInfo.name}</p>
                                    <p className="text-xs text-slate-500">You'll be added as a team member</p>
                                </div>
                            </div>

                            <div>
                                <label className="text-xs font-bold text-slate-500 uppercase block mb-1">Full Name</label>
                                <div className="relative">
                                    <User size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                    <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Your Name"
                                        className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500" />
                                </div>
                            </div>
                            <div>
                                <label className="text-xs font-bold text-slate-500 uppercase block mb-1">Email</label>
                                <div className="relative">
                                    <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                    <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@company.com"
                                        className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500" />
                                </div>
                            </div>
                            <div>
                                <label className="text-xs font-bold text-slate-500 uppercase block mb-1">Password</label>
                                <div className="relative">
                                    <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                    <PasswordInput value={password} onChange={e => setPassword(e.target.value)} placeholder="Min 6 characters"
                                        className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500" />
                                </div>
                            </div>

                            <div className="flex gap-3">
                                <button onClick={() => { setStep('code'); setOrgInfo(null); }}
                                    className="flex-1 py-2.5 rounded-xl border border-gray-200 text-slate-600 font-medium text-sm hover:bg-gray-50 transition-colors flex items-center justify-center gap-1">
                                    <ChevronLeft size={16} /> Back
                                </button>
                                <button onClick={handleJoin} disabled={loading}
                                    className="flex-1 bg-blue-600 text-white py-2.5 rounded-xl font-semibold text-sm hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
                                    {loading ? <Loader2 size={18} className="animate-spin" /> : 'Join & Verify'}
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Step: OTP Verify */}
                    {step === 'verify' && (
                        <div className="text-center space-y-4">
                            <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto">
                                <Mail size={28} className="text-blue-600" />
                            </div>
                            <div>
                                <h3 className="text-lg font-bold text-slate-800">Check your email</h3>
                                <p className="text-sm text-slate-500 mt-1">We sent a 6-digit code to <strong>{email}</strong></p>
                            </div>
                            <div>
                                <input type="text" value={otp} onChange={e => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                                    placeholder="000000" maxLength={6}
                                    className="w-48 mx-auto text-center text-2xl font-bold tracking-[0.5em] border-2 border-gray-200 rounded-xl py-3 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500" />
                            </div>
                            <button onClick={handleVerifyOTP} disabled={loading || otp.length !== 6}
                                className="w-full bg-blue-600 text-white py-3 rounded-xl font-semibold text-sm hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
                                {loading ? <Loader2 size={18} className="animate-spin" /> : 'Verify & Join'}
                            </button>
                        </div>
                    )}

                    {/* Footer */}
                    <div className="mt-6 text-center space-y-2 text-sm">
                        <p className="text-slate-400">
                            Already have an account? <Link to="/login" className="text-blue-600 font-semibold hover:underline">Sign In</Link>
                        </p>
                        <p className="text-slate-400">
                            Don't have a code? <Link to="/signup" className="text-blue-600 font-semibold hover:underline">Create Organization</Link>
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default JoinOrganization;
