import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Mail, Lock, User, Shield, Loader2, AlertTriangle } from 'lucide-react';
import PasswordInput from '../components/PasswordInput';

interface AcceptInviteProps {
    onLogin: (user: any) => void;
}

const AcceptInvitation: React.FC<AcceptInviteProps> = ({ onLogin }) => {
    const { token } = useParams<{ token: string }>();
    const navigate = useNavigate();
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [invitation, setInvitation] = useState<{ email: string; orgName: string; roleName: string } | null>(null);
    const [name, setName] = useState('');
    const [password, setPassword] = useState('');
    const [success, setSuccess] = useState(false);

    const API_URL = (() => {
        const hostname = window.location.hostname;
        if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname.startsWith('192.168.') || hostname.startsWith('10.')) return '/api';
        return 'https://e-invoice-545y.onrender.com/api';
    })();

    useEffect(() => {
        if (token) fetchInvitation();
    }, [token]);

    const fetchInvitation = async () => {
        try {
            const res = await fetch(`${API_URL}/auth/invite/${token}`);
            const data = await res.json();
            if (data.success) {
                setInvitation(data.invitation);
                setName(data.invitation.email.split('@')[0]);
            } else {
                setError(data.message || 'Invalid invitation');
            }
        } catch {
            setError('Failed to load invitation');
        } finally {
            setLoading(false);
        }
    };

    const handleAccept = async () => {
        if (!password || password.length < 6) { setError('Password must be at least 6 characters'); return; }
        setSubmitting(true);
        setError(null);
        try {
            const res = await fetch(`${API_URL}/auth/invite/${token}/accept`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password, name }),
            });
            const data = await res.json();
            if (data.success && data.token) {
                onLogin({
                    ...data.user,
                    name: data.user.username,
                    role: data.user.roles?.[0]?.displayName || 'User',
                    avatar: '',
                    token: data.token,
                });
                setSuccess(true);
                setTimeout(() => navigate('/dashboard'), 1500);
            } else {
                setError(data.message || 'Failed to accept invitation');
            }
        } catch {
            setError('Failed to accept invitation');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-xl border border-gray-100 w-full max-w-md overflow-hidden">
                <div className="bg-slate-900 px-6 py-5 text-center">
                    <div className="flex items-center justify-center gap-2 mb-2">
                        <div className="bg-blue-600 p-1.5 rounded-lg"><Shield size={20} className="text-white" /></div>
                        <span className="text-white font-bold text-xl">OTax</span>
                    </div>
                    <p className="text-slate-400 text-sm">Accept Invitation</p>
                </div>

                <div className="p-6">
                    {loading ? (
                        <div className="flex items-center justify-center py-12">
                            <Loader2 size={32} className="animate-spin text-blue-500" />
                        </div>
                    ) : error && !invitation ? (
                        <div className="text-center py-8">
                            <div className="w-14 h-14 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                                <AlertTriangle size={24} className="text-red-600" />
                            </div>
                            <h3 className="font-bold text-slate-800">{error}</h3>
                            <Link to="/login" className="text-blue-600 text-sm font-semibold mt-4 inline-block">Go to Login</Link>
                        </div>
                    ) : success ? (
                        <div className="text-center py-8">
                            <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
                                <span className="text-3xl">🎉</span>
                            </div>
                            <h3 className="text-lg font-bold text-slate-800">Welcome!</h3>
                            <p className="text-sm text-slate-500 mt-1">Redirecting to dashboard...</p>
                        </div>
                    ) : invitation ? (
                        <div className="space-y-4">
                            {error && <div className="p-3 bg-red-50 border border-red-100 rounded-xl text-red-600 text-sm font-medium">{error}</div>}

                            <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 text-center">
                                <p className="text-sm text-slate-600">You've been invited to join</p>
                                <p className="text-lg font-bold text-slate-800 mt-1">{invitation.orgName}</p>
                                <p className="text-sm text-blue-600 font-medium mt-1">as {invitation.roleName}</p>
                            </div>

                            <div>
                                <label className="text-xs font-bold text-slate-500 uppercase block mb-1">Email</label>
                                <div className="relative">
                                    <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                    <input type="email" value={invitation.email} disabled
                                        className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm bg-slate-50 text-slate-600" />
                                </div>
                            </div>
                            <div>
                                <label className="text-xs font-bold text-slate-500 uppercase block mb-1">Display Name</label>
                                <div className="relative">
                                    <User size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                    <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Your Name"
                                        className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500" />
                                </div>
                            </div>
                            <div>
                                <label className="text-xs font-bold text-slate-500 uppercase block mb-1">Set Password</label>
                                <div className="relative">
                                    <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                    <PasswordInput value={password} onChange={e => setPassword(e.target.value)} placeholder="Min 6 characters"
                                        className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500" />
                                </div>
                            </div>

                            <button onClick={handleAccept} disabled={submitting}
                                className="w-full bg-blue-600 text-white py-3 rounded-xl font-semibold text-sm hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
                                {submitting ? <Loader2 size={18} className="animate-spin" /> : 'Accept & Join'}
                            </button>
                        </div>
                    ) : null}
                </div>
            </div>
        </div>
    );
};

export default AcceptInvitation;
