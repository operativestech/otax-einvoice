import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Mail, Lock, Shield, Loader2, ChevronLeft, KeyRound } from 'lucide-react';
import PasswordInput from '../components/PasswordInput';
import { useTranslation } from '../i18n';

const ForgotPassword: React.FC = () => {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const [step, setStep] = useState<'email' | 'otp' | 'done'>('email');
    const [email, setEmail] = useState('');
    const [otp, setOtp] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const API_URL = (() => {
        const hostname = window.location.hostname;
        if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname.startsWith('192.168.') || hostname.startsWith('10.')) return '/api';
        return 'https://e-invoice-545y.onrender.com/api';
    })();

    const handleSendOTP = async () => {
        if (!email) { setError(t('forgot.errEmail')); return; }
        setLoading(true);
        setError(null);
        try {
            const res = await fetch(`${API_URL}/auth/forgot-password`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email }),
            });
            const data = await res.json();
            if (data.success) {
                setStep('otp');
            } else {
                setError(data.message);
            }
        } catch {
            setError(t('forgot.errSendFail'));
        } finally {
            setLoading(false);
        }
    };

    const handleResetPassword = async () => {
        if (!otp || otp.length !== 6) { setError(t('forgot.errCode')); return; }
        if (!newPassword || newPassword.length < 6) { setError(t('forgot.errPwdShort')); return; }
        if (newPassword !== confirmPassword) { setError(t('forgot.errMismatch')); return; }

        setLoading(true);
        setError(null);
        try {
            const res = await fetch(`${API_URL}/auth/reset-password`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, code: otp, newPassword }),
            });
            const data = await res.json();
            if (data.success) {
                setStep('done');
            } else {
                setError(data.message);
            }
        } catch {
            setError(t('forgot.errResetFail'));
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
                    <p className="text-slate-400 text-sm">{t('forgot.brandSubtitle')}</p>
                </div>

                <div className="p-6">
                    {error && (
                        <div className="mb-4 p-3 bg-red-50 border border-red-100 rounded-xl text-red-600 text-sm font-medium">{error}</div>
                    )}

                    {/* Step: Enter Email */}
                    {step === 'email' && (
                        <div className="space-y-4">
                            <div className="text-center mb-4">
                                <div className="w-14 h-14 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-3">
                                    <KeyRound size={24} className="text-blue-600" />
                                </div>
                                <h3 className="text-lg font-bold text-slate-800">{t('forgot.title')}</h3>
                                <p className="text-sm text-slate-500 mt-1">{t('forgot.subtitle')}</p>
                            </div>
                            <div>
                                <label className="text-xs font-bold text-slate-500 uppercase block mb-1">{t('forgot.email')}</label>
                                <div className="relative">
                                    <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                    <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder={t('forgot.emailPh')}
                                        className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                                        onKeyDown={e => e.key === 'Enter' && handleSendOTP()} />
                                </div>
                            </div>
                            <button onClick={handleSendOTP} disabled={loading}
                                className="w-full bg-blue-600 text-white py-3 rounded-xl font-semibold text-sm hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
                                {loading ? <Loader2 size={18} className="animate-spin" /> : t('forgot.sendCode')}
                            </button>
                        </div>
                    )}

                    {/* Step: Enter OTP + New Password */}
                    {step === 'otp' && (
                        <div className="space-y-4">
                            <div className="text-center mb-4">
                                <div className="w-14 h-14 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-3">
                                    <Mail size={24} className="text-blue-600" />
                                </div>
                                <h3 className="text-lg font-bold text-slate-800">{t('forgot.checkInbox')}</h3>
                                <p className="text-sm text-slate-500 mt-1">{t('forgot.codeSentTo')} <strong>{email}</strong></p>
                            </div>
                            <div>
                                <label className="text-xs font-bold text-slate-500 uppercase block mb-1">{t('forgot.codeLabel')}</label>
                                <input type="text" value={otp} onChange={e => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder={t('forgot.codePh')} maxLength={6}
                                    className="w-full text-center text-xl font-bold tracking-[0.4em] border-2 border-gray-200 rounded-xl py-3 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500" />
                            </div>
                            <div>
                                <label className="text-xs font-bold text-slate-500 uppercase block mb-1">{t('forgot.newPwd')}</label>
                                <div className="relative">
                                    <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                    <PasswordInput value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder={t('forgot.newPwdPh')}
                                        className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500" />
                                </div>
                            </div>
                            <div>
                                <label className="text-xs font-bold text-slate-500 uppercase block mb-1">{t('forgot.confirmPwd')}</label>
                                <div className="relative">
                                    <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                    <PasswordInput value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} placeholder={t('forgot.confirmPwdPh')}
                                        className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500" />
                                </div>
                            </div>
                            <button onClick={handleResetPassword} disabled={loading}
                                className="w-full bg-blue-600 text-white py-3 rounded-xl font-semibold text-sm hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
                                {loading ? <Loader2 size={18} className="animate-spin" /> : t('forgot.resetPwd')}
                            </button>
                        </div>
                    )}

                    {/* Step: Success */}
                    {step === 'done' && (
                        <div className="text-center space-y-4 py-4">
                            <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto">
                                <span className="text-2xl">✅</span>
                            </div>
                            <h3 className="text-lg font-bold text-slate-800">{t('forgot.successTitle')}</h3>
                            <p className="text-sm text-slate-500">{t('forgot.successMsg')}</p>
                            <button onClick={() => navigate('/login')}
                                className="w-full bg-blue-600 text-white py-3 rounded-xl font-semibold text-sm hover:bg-blue-700 transition-colors">
                                {t('forgot.signInNow')}
                            </button>
                        </div>
                    )}

                    {/* Back Link */}
                    <div className="mt-6 text-center">
                        <Link to="/login" className="text-sm text-slate-400 hover:text-blue-600 flex items-center justify-center gap-1">
                            <ChevronLeft size={16} /> {t('forgot.backLogin')}
                        </Link>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ForgotPassword;
