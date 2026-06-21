import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Building2, Mail, Lock, User, Globe, ChevronRight, ChevronLeft, Shield, Loader2 } from 'lucide-react';
import PasswordInput from '../components/PasswordInput';
import { apiService } from '../services/apiService';

interface SignupProps {
    onLogin: (user: any) => void;
}

const plans = [
    { id: 'free', name: 'Free', price: '$0', users: '3 users', invoices: '50 inv/mo', color: 'border-slate-200 bg-white', selected: 'border-blue-500 bg-blue-50 ring-2 ring-blue-200' },
    { id: 'starter', name: 'Starter', price: '$29', users: '5 users', invoices: '200 inv/mo', color: 'border-slate-200 bg-white', selected: 'border-blue-500 bg-blue-50 ring-2 ring-blue-200' },
    { id: 'professional', name: 'Professional', price: '$79', users: '15 users', invoices: '1,000 inv/mo', color: 'border-slate-200 bg-white', selected: 'border-blue-500 bg-blue-50 ring-2 ring-blue-200', badge: 'Popular' },
    { id: 'enterprise', name: 'Enterprise', price: '$199', users: 'Unlimited', invoices: 'Unlimited', color: 'border-slate-200 bg-white', selected: 'border-blue-500 bg-blue-50 ring-2 ring-blue-200' },
];

const Signup: React.FC<SignupProps> = ({ onLogin }) => {
    const navigate = useNavigate();
    const [step, setStep] = useState(1);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Step 1: Account
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [name, setName] = useState('');

    // Step 2: Organization
    const [orgName, setOrgName] = useState('');
    const [taxId, setTaxId] = useState('');
    const [companyType, setCompanyType] = useState('B');
    const [country, setCountry] = useState('Egypt');
    const [city, setCity] = useState('');

    // Step 3: Plan
    const [selectedPlan, setSelectedPlan] = useState('free');

    // Step 4: OTP
    const [otp, setOtp] = useState('');
    const [otpSent, setOtpSent] = useState(false);
    const [signupEmail, setSignupEmail] = useState('');

    const API_URL = (() => {
        const hostname = window.location.hostname;
        if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname.startsWith('192.168.') || hostname.startsWith('10.')) return '/api';
        return 'https://e-invoice-545y.onrender.com/api';
    })();

    const validateStep1 = () => {
        if (!email || !password || !name) { setError('All fields are required'); return false; }
        if (!/\S+@\S+\.\S+/.test(email)) { setError('Please enter a valid email'); return false; }
        if (password.length < 6) { setError('Password must be at least 6 characters'); return false; }
        if (password !== confirmPassword) { setError('Passwords do not match'); return false; }
        return true;
    };

    const validateStep2 = () => {
        if (!orgName || !taxId) { setError('Organization name and Tax ID are required'); return false; }
        return true;
    };

    const handleNext = () => {
        setError(null);
        if (step === 1 && !validateStep1()) return;
        if (step === 2 && !validateStep2()) return;
        if (step < 4) setStep(step + 1);
    };

    const handleBack = () => {
        setError(null);
        if (step > 1) setStep(step - 1);
    };

    // Submit signup (step 3 → step 4)
    const handleSignup = async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch(`${API_URL}/auth/signup`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password, name, orgName, taxId, companyType, country, city, plan: selectedPlan }),
            });
            const data = await res.json();
            if (data.success) {
                setSignupEmail(data.email);
                setOtpSent(true);
                setStep(4);
            } else {
                setError(data.message || 'Signup failed');
            }
        } catch (err: any) {
            setError(err.message || 'Signup failed. Is the server running?');
        } finally {
            setLoading(false);
        }
    };

    // Verify OTP (step 4)
    const handleVerifyOTP = async () => {
        if (!otp || otp.length !== 6) { setError('Please enter the 6-digit code'); return; }
        setLoading(true);
        setError(null);
        try {
            const res = await fetch(`${API_URL}/auth/verify-otp`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: signupEmail || email, code: otp, type: 'signup_verify' }),
            });
            const data = await res.json();
            if (data.success && data.token) {
                // Auto-login
                const displayRole = data.user.isOrgAdmin ? 'Org Admin' : 'User';
                onLogin({
                    ...data.user,
                    name: data.user.username,
                    role: displayRole,
                    avatar: '',
                    token: data.token,
                });
                navigate('/dashboard');
            } else {
                setError(data.message || 'Verification failed');
            }
        } catch (err: any) {
            setError(err.message || 'Verification failed');
        } finally {
            setLoading(false);
        }
    };

    const handleResendOTP = async () => {
        try {
            await fetch(`${API_URL}/auth/resend-otp`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: signupEmail || email, type: 'signup_verify' }),
            });
            setError(null);
        } catch { }
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 flex items-center justify-center p-2 overflow-y-auto">
            <div className="bg-white rounded-2xl shadow-xl border border-gray-100 w-full max-w-lg overflow-hidden my-auto">
                {/* Header */}
                <div className="bg-slate-900 px-5 py-3 text-center">
                    <div className="flex items-center justify-center gap-2 mb-1">
                        <div className="bg-blue-600 p-1 rounded-lg"><Shield size={16} className="text-white" /></div>
                        <span className="text-white font-bold text-lg">OTax</span>
                    </div>
                    <p className="text-slate-400 text-xs">Create your account</p>
                </div>

                {/* Progress Steps */}
                <div className="px-5 py-2.5 border-b border-gray-100">
                    <div className="flex items-center justify-between">
                        {['Account', 'Organization', 'Plan', 'Verify'].map((label, i) => (
                            <div key={i} className="flex items-center gap-2">
                                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold transition-colors ${i + 1 < step ? 'bg-emerald-500 text-white'
                                    : i + 1 === step ? 'bg-blue-600 text-white'
                                        : 'bg-slate-100 text-slate-400'
                                    }`}>
                                    {i + 1 < step ? '✓' : i + 1}
                                </div>
                                <span className={`text-xs font-medium hidden sm:inline ${i + 1 === step ? 'text-blue-600' : 'text-slate-400'}`}>{label}</span>
                                {i < 3 && <div className={`w-6 h-0.5 ${i + 1 < step ? 'bg-emerald-400' : 'bg-slate-200'}`} />}
                            </div>
                        ))}
                    </div>
                </div>

                <div className="p-4 pb-5">
                    {error && (
                        <div className="mb-3 p-2.5 bg-red-50 border border-red-100 rounded-xl text-red-600 text-xs font-medium">{error}</div>
                    )}

                    {/* Step 1: Account */}
                    {step === 1 && (
                        <div className="space-y-3">
                            <div>
                                <label className="text-xs font-bold text-slate-500 uppercase block mb-1">Full Name</label>
                                <div className="relative">
                                    <User size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                    <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Your Name"
                                        className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500" />
                                </div>
                            </div>
                            <div>
                                <label className="text-xs font-bold text-slate-500 uppercase block mb-1">Email</label>
                                <div className="relative">
                                    <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                    <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@company.com"
                                        className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500" />
                                </div>
                            </div>
                            <div>
                                <label className="text-xs font-bold text-slate-500 uppercase block mb-1">Password</label>
                                <div className="relative">
                                    <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                    <PasswordInput value={password} onChange={e => setPassword(e.target.value)} placeholder="Min 6 characters"
                                        className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500" />
                                </div>
                            </div>
                            <div>
                                <label className="text-xs font-bold text-slate-500 uppercase block mb-1">Confirm Password</label>
                                <div className="relative">
                                    <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                    <PasswordInput value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} placeholder="Confirm password"
                                        className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500" />
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Step 2: Organization */}
                    {step === 2 && (
                        <div className="space-y-3">
                            <div>
                                <label className="text-xs font-bold text-slate-500 uppercase block mb-1">Organization Name</label>
                                <div className="relative">
                                    <Building2 size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                    <input type="text" value={orgName} onChange={e => setOrgName(e.target.value)} placeholder="Your Company Name"
                                        className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500" />
                                </div>
                            </div>
                            <div>
                                <label className="text-xs font-bold text-slate-500 uppercase block mb-1">Tax Registration ID</label>
                                <input type="text" value={taxId} onChange={e => setTaxId(e.target.value)} placeholder="e.g. 000-000-000"
                                    className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500" />
                            </div>
                            <div>
                                <label className="text-xs font-bold text-slate-500 uppercase block mb-1">Company Type</label>
                                <select value={companyType} onChange={e => setCompanyType(e.target.value)}
                                    className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white">
                                    <option value="B">B - Business</option>
                                    <option value="P">P - Person</option>
                                </select>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="text-xs font-bold text-slate-500 uppercase block mb-1">Country</label>
                                    <div className="relative">
                                        <Globe size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                        <input type="text" value={country} onChange={e => setCountry(e.target.value)} placeholder="Egypt"
                                            className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500" />
                                    </div>
                                </div>
                                <div>
                                    <label className="text-xs font-bold text-slate-500 uppercase block mb-1">City</label>
                                    <input type="text" value={city} onChange={e => setCity(e.target.value)} placeholder="Cairo"
                                        className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500" />
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Step 3: Plan */}
                    {step === 3 && (
                        <div className="space-y-3">
                            <p className="text-sm text-slate-600 mb-2">Choose your subscription plan:</p>
                            {plans.map(p => (
                                <button key={p.id} onClick={() => setSelectedPlan(p.id)}
                                    className={`w-full text-left p-4 rounded-xl border-2 transition-all ${selectedPlan === p.id ? p.selected : p.color}`}>
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <div className="flex items-center gap-2">
                                                <span className="font-bold text-slate-800">{p.name}</span>
                                                {p.badge && <span className="bg-blue-100 text-blue-700 text-[10px] font-bold px-2 py-0.5 rounded-full">{p.badge}</span>}
                                            </div>
                                            <p className="text-xs text-slate-500 mt-0.5">{p.users} • {p.invoices}</p>
                                        </div>
                                        <span className="text-lg font-bold text-slate-800">{p.price}<span className="text-xs text-slate-400">/mo</span></span>
                                    </div>
                                </button>
                            ))}
                        </div>
                    )}

                    {/* Step 4: OTP Verification */}
                    {step === 4 && (
                        <div className="text-center space-y-4">
                            <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto">
                                <Mail size={28} className="text-blue-600" />
                            </div>
                            <div>
                                <h3 className="text-lg font-bold text-slate-800">Check your email</h3>
                                <p className="text-sm text-slate-500 mt-1">We sent a 6-digit code to <strong>{signupEmail || email}</strong></p>
                            </div>
                            <div>
                                <input type="text" value={otp} onChange={e => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                                    placeholder="000000" maxLength={6}
                                    className="w-48 mx-auto text-center text-2xl font-bold tracking-[0.5em] border-2 border-gray-200 rounded-xl py-3 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500" />
                            </div>
                            <button onClick={handleVerifyOTP} disabled={loading || otp.length !== 6}
                                className="w-full bg-blue-600 text-white py-3 rounded-xl font-semibold text-sm hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
                                {loading ? <Loader2 size={18} className="animate-spin" /> : 'Verify & Continue'}
                            </button>
                            <p className="text-xs text-slate-400">
                                Didn't receive it?{' '}
                                <button onClick={handleResendOTP} className="text-blue-600 font-semibold hover:underline">Resend Code</button>
                            </p>
                        </div>
                    )}

                    {/* Navigation Buttons (steps 1-3) */}
                    {step < 4 && (
                        <div className="flex gap-3 mt-4">
                            {step > 1 ? (
                                <button onClick={handleBack}
                                    className="flex-1 py-2.5 rounded-xl border border-gray-200 text-slate-600 font-medium text-sm hover:bg-gray-50 transition-colors flex items-center justify-center gap-1">
                                    <ChevronLeft size={16} /> Back
                                </button>
                            ) : <div className="flex-1" />}

                            {step < 3 ? (
                                <button onClick={handleNext}
                                    className="flex-1 bg-blue-600 text-white py-2.5 rounded-xl font-semibold text-sm hover:bg-blue-700 transition-colors flex items-center justify-center gap-1">
                                    Next <ChevronRight size={16} />
                                </button>
                            ) : (
                                <button onClick={handleSignup} disabled={loading}
                                    className="flex-1 bg-blue-600 text-white py-2.5 rounded-xl font-semibold text-sm hover:bg-blue-700 transition-colors flex items-center justify-center gap-2 disabled:opacity-50">
                                    {loading ? <Loader2 size={18} className="animate-spin" /> : <>Create Account <ChevronRight size={16} /></>}
                                </button>
                            )}
                        </div>
                    )}

                    {/* Footer links */}
                    <div className="mt-4 text-center space-y-1 text-xs">
                        <p className="text-slate-400">
                            Already have an account? <Link to="/login" className="text-blue-600 font-semibold hover:underline">Sign In</Link>
                        </p>
                        <p className="text-slate-400">
                            Have an org code? <Link to="/join-org" className="text-blue-600 font-semibold hover:underline">Join Organization</Link>
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Signup;
