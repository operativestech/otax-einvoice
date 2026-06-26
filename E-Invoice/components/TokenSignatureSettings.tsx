import React, { useState, useEffect, useCallback } from 'react';
import {
    Key, Eye, EyeOff, CheckCircle2, AlertCircle, ShieldCheck,
    Wifi, WifiOff, RefreshCw, Download, Cpu
} from 'lucide-react';
import { API_URL as DEFAULT_API_URL } from '../services/apiService';
import { confirmDialog } from './ConfirmDialog';

interface TokenSignatureSettingsProps {
    properties: any[];
}

const TokenSignatureSettings: React.FC<TokenSignatureSettingsProps> = ({ properties }) => {
    const getProp = (name: string, fallback: string = '') => {
        const prop = properties.find(p => p.property_name.toLowerCase() === name.toLowerCase());
        return prop ? prop.property_value : fallback;
    };

    const taxId = getProp('issuer_id', 'default');
    const token = localStorage.getItem('token');
    const authHeaders = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };

    // ── State ──
    const [agentOnline, setAgentOnline] = useState<boolean | null>(null);
    const [agentInfo, setAgentInfo] = useState<any>(null);
    const [checkingAgent, setCheckingAgent] = useState(false);
    const [loadingCerts, setLoadingCerts] = useState(false);
    const [certificates, setCertificates] = useState<any[]>([]);
    const [selectedCert, setSelectedCert] = useState<any>(null);
    const [pin, setPin] = useState(getProp('signer_CurrentCertPIN', ''));
    const [showPin, setShowPin] = useState(false);
    const [saving, setSaving] = useState(false);
    const [scanError, setScanError] = useState('');
    const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
    const [isTesting, setIsTesting] = useState(false);
    const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

    // Hidden inputs values
    const [savedThumbprint, setSavedThumbprint] = useState(getProp('signer_CurrentCertName', ''));
    const [savedPin, setSavedPin] = useState(getProp('signer_CurrentCertPIN', ''));

    // Check Agent Status
    const checkAgentStatus = useCallback(async () => {
        setCheckingAgent(true);
        try {
            const res = await fetch(`${DEFAULT_API_URL}/signing/agent-status?companyId=${taxId}`, { headers: authHeaders });
            const data = await res.json();
            const online = data.success && data.online;
            setAgentOnline(online);
            if (data.node) {
                setAgentInfo(data.node);
                if (data.node.cert_thumbprint) {
                    setSavedThumbprint(data.node.cert_thumbprint);
                }
                if (data.node.cert_pin) {
                    setSavedPin(data.node.cert_pin);
                    setPin(data.node.cert_pin);
                }
            }
        } catch {
            setAgentOnline(false);
        } finally {
            setCheckingAgent(false);
        }
    }, [taxId]);

    // Scan Certificates
    const scanCertificates = useCallback(async () => {
        if (agentOnline !== true) return;
        setLoadingCerts(true);
        setScanError('');
        try {
            const res = await fetch(`${DEFAULT_API_URL}/bridge/list-certs?companyId=${taxId}`);
            if (!res.ok) throw new Error('Failed to connect to agent');
            const data = await res.json();
            if (data.success && Array.isArray(data.certificates)) {
                setCertificates(data.certificates);
                if (data.certificates.length > 0) {
                    // Auto-select the first certificate
                    const firstCert = data.certificates[0];
                    setSelectedCert(firstCert);
                    // Update current input fields if empty
                    if (!savedThumbprint) {
                        setSavedThumbprint(firstCert.Thumbprint);
                    }
                } else {
                    setSelectedCert(null);
                    setScanError('متصل بالـ Agent ولكن لم يتم العثور على توكن USB. يرجى إدخال التوكن في الجهاز.');
                }
            } else {
                throw new Error(data.message || 'No certificates found');
            }
        } catch (e: any) {
            setScanError('فشل الاتصال ببرنامج التوقيع لقراءة الشهادة. تأكد من إدخال التوكن.');
            setSelectedCert(null);
        } finally {
            setLoadingCerts(false);
        }
    }, [agentOnline, taxId, savedThumbprint]);

    // Initial check
    useEffect(() => {
        checkAgentStatus();
        const interval = setInterval(checkAgentStatus, 6000);
        return () => clearInterval(interval);
    }, [checkAgentStatus]);

    // Auto scan when Agent goes Online
    useEffect(() => {
        if (agentOnline === true) {
            scanCertificates();
        } else {
            setCertificates([]);
            setSelectedCert(null);
        }
    }, [agentOnline, scanCertificates]);

    // Save PIN and Register Certificate
    const handleSaveConfig = async () => {
        const certToRegister = selectedCert || (savedThumbprint ? { Thumbprint: savedThumbprint, Subject: agentInfo?.cert_subject || 'Registered Cert' } : null);
        if (!certToRegister) {
            setStatusMessage({ type: 'error', text: 'الرجاء التأكد من توصيل التوكن بالكمبيوتر أولاً لكي يتم التعرف عليه.' });
            return;
        }
        if (!pin.trim()) {
            setStatusMessage({ type: 'error', text: 'الرجاء إدخال كود PIN الخاص بالتوكن.' });
            return;
        }

        setSaving(true);
        setStatusMessage(null);
        try {
            const res = await fetch(`${DEFAULT_API_URL}/bridge/register-cert`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    companyId: taxId,
                    thumbprint: certToRegister.Thumbprint,
                    subject: certToRegister.FriendlyName || certToRegister.Subject,
                    pin: pin
                }),
            });
            const data = await res.json();
            if (data.success) {
                setSavedThumbprint(certToRegister.Thumbprint);
                setSavedPin(pin);
                setStatusMessage({ type: 'success', text: '✓ تم حفظ البيانات وتفعيل التوكن بنجاح! جاهز الآن لتوقيع الفواتير.' });
                // Automatically run signature test
                runSignatureTest();
            } else {
                throw new Error(data.message || 'Failed to register');
            }
        } catch (e: any) {
            setStatusMessage({ type: 'error', text: 'فشل حفظ البيانات: ' + e.message });
        } finally {
            setSaving(false);
        }
    };

    // Run Test
    const runSignatureTest = async () => {
        setIsTesting(true);
        setTestResult(null);
        try {
            const res = await fetch(`${DEFAULT_API_URL}/signing/test?companyId=${taxId}`, { headers: authHeaders });
            const data = await res.json();
            if (data.success) {
                setTestResult({ success: true, message: '✓ التوصيل والتوقيع يعملان بنجاح! التوكن متصل وجاهز للعمل.' });
            } else {
                setTestResult({ success: false, message: 'فشل اختبار التوقيع: تأكد من صحة كود الـ PIN ومن إدخال التوكن بالكمبيوتر.' });
            }
        } catch (e: any) {
            setTestResult({ success: false, message: 'خطأ في الاتصال: ' + e.message });
        } finally {
            setIsTesting(false);
        }
    };

    const handleResetNode = async () => {
        const ok = await confirmDialog({
            title: 'إعادة ضبط جهاز التوقيع',
            message: 'هل تريد فصل جهاز التوقيع الحالي وإتاحة ربط جهاز آخر؟',
            confirmLabel: 'إعادة ضبط',
            tone: 'warning',
        });
        if (!ok) return;
        try {
            const res = await fetch(`${DEFAULT_API_URL}/bridge/reset-node`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ companyId: taxId }),
            });
            const data = await res.json();
            if (data.success) {
                setStatusMessage({ type: 'success', text: 'تمت إعادة الضبط بنجاح. يمكنك الآن تشغيل الـ Agent على الجهاز الجديد.' });
                checkAgentStatus();
            }
        } catch (e: any) {
            setStatusMessage({ type: 'error', text: 'فشل إعادة الضبط: ' + e.message });
        }
    };

    return (
        <div className="space-y-6 animate-in fade-in duration-300" dir="rtl">
            {/* Hidden Inputs for Form Sync */}
            <input type="hidden" name="signer_CurrentCertName" key={`thumb-${savedThumbprint}`} defaultValue={savedThumbprint} />
            <input type="hidden" name="signer_CurrentCertPIN" key={`pin-${savedPin}`} defaultValue={savedPin} />

            <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm space-y-4">
                <div className="flex items-center justify-between pb-4 border-b border-slate-50">
                    <div className="space-y-1">
                        <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                            <Key className="text-blue-500" size={22} />
                            توقيع فواتير الضرائب بالتوكن (USB Token Signature)
                        </h3>
                        <p className="text-xs text-slate-500">
                            قم بتوصيل توكن التوقيع الإلكتروني (USB) بجهاز الكمبيوتر الرئيسي لتفعيل إرسال الفواتير.
                        </p>
                    </div>
                    {/* Status Badge */}
                    <div className="flex items-center gap-2">
                        {agentOnline === true ? (
                            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 text-emerald-700 rounded-full text-xs font-bold border border-emerald-100 shadow-sm animate-pulse">
                                <span className="w-2 h-2 bg-emerald-500 rounded-full"></span>
                                الـ Agent متصل ومستعد
                            </div>
                        ) : (
                            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 text-amber-700 rounded-full text-xs font-bold border border-amber-100">
                                <span className="w-2 h-2 bg-amber-400 rounded-full"></span>
                                الـ Agent غير متصل
                            </div>
                        )}
                        <button
                            onClick={checkAgentStatus}
                            disabled={checkingAgent}
                            className="p-2 hover:bg-slate-50 rounded-xl transition-all text-slate-400 hover:text-slate-600 disabled:opacity-50"
                            title="تحديث الحالة"
                        >
                            <RefreshCw size={16} className={checkingAgent ? 'animate-spin' : ''} />
                        </button>
                    </div>
                </div>

                {/* ── CASE 1: AGENT IS OFFLINE ── */}
                {agentOnline === false && (
                    <div className="p-6 bg-slate-50 rounded-2xl border border-slate-100 space-y-4 text-center md:text-right">
                        <div className="flex flex-col md:flex-row gap-4 items-center md:items-start">
                            <div className="w-12 h-12 bg-amber-100 text-amber-600 rounded-2xl flex items-center justify-center flex-shrink-0">
                                <WifiOff size={24} />
                            </div>
                            <div className="space-y-1">
                                <h4 className="font-bold text-slate-800 text-sm">برنامج OTax Agent لا يعمل على هذا الجهاز</h4>
                                <p className="text-xs text-slate-500 leading-relaxed">
                                    لتفعيل التوقيع بالتوكن، يرجى تحميل تطبيق OTax Agent وتشغيله على الكمبيوتر الرئيسي المتصل به الـ USB Token. بمجرد تشغيله، سيتمكن أي مستخدم في شركتك من إرسال الفواتير موقعة تلقائياً من أي مكان.
                                </p>
                            </div>
                        </div>

                        <div className="pt-2 flex flex-col md:flex-row gap-3 justify-center md:justify-start">
                            <a
                                href={`${DEFAULT_API_URL}/bridge/download-installer?companyId=${taxId}`}
                                download={`OTax-Agent-Setup-${taxId}.exe`}
                                className="inline-flex items-center justify-center gap-2 px-5 py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm rounded-xl transition-all shadow-md active:scale-95"
                            >
                                <Download size={16} />
                                تحميل OTax Agent Installer (.exe)
                            </a>
                            {agentInfo && (
                                <button
                                    onClick={handleResetNode}
                                    className="px-5 py-3 bg-red-50 hover:bg-red-100 text-red-600 font-bold text-sm rounded-xl transition-all"
                                >
                                    إعادة ضبط ربط الكمبيوتر
                                </button>
                            )}
                        </div>

                        <div className="border-t border-slate-200/60 pt-4 mt-2 text-right">
                            <h5 className="text-xs font-bold text-slate-700 mb-2">📋 خطوات التشغيل البسيطة:</h5>
                            <ol className="list-decimal list-inside space-y-1 text-[11px] text-slate-500">
                                <li>قم بتحميل ملف التثبيت أعلاه (.exe).</li>
                                <li>قم بتوصيل فلاشة التوكن (USB) بالكمبيوتر.</li>
                                <li>افتح برنامج التثبيت واضغط على زر **"بدء التثبيت التلقائي"**.</li>
                                <li>سيقوم البرنامج بتنزيل وتثبيت كافة البرامج والمتطلبات تلقائياً وتشغيل الخدمة بالخلفية.</li>
                            </ol>
                        </div>
                    </div>
                )}

                {/* ── CASE 2: AGENT IS ONLINE ── */}
                {agentOnline === true && (
                    <div className="space-y-4">
                        {/* Auto-scanning loader */}
                        {loadingCerts && (
                            <div className="p-8 text-center flex flex-col items-center justify-center gap-3">
                                <div className="w-8 h-8 border-3 border-blue-200 border-t-blue-600 rounded-full animate-spin"></div>
                                <p className="text-xs text-slate-500 font-semibold">جاري البحث التلقائي عن توكن USB متصل بالكمبيوتر...</p>
                            </div>
                        )}

                        {/* Scan Error or No Token Connected */}
                        {!loadingCerts && scanError && (
                            <div className="p-5 bg-amber-50/50 border border-amber-100 rounded-2xl flex items-start gap-3">
                                <AlertCircle className="text-amber-500 mt-0.5 flex-shrink-0" size={18} />
                                <div className="space-y-1">
                                    <p className="text-xs font-bold text-amber-800">لم يتم اكتشاف توكن التوقيع الإلكتروني</p>
                                    <p className="text-[11px] text-amber-700">{scanError}</p>
                                    <button
                                        onClick={scanCertificates}
                                        className="mt-2 text-xs font-bold text-blue-600 hover:text-blue-700 underline"
                                    >
                                        إعادة فحص التوكن المتصل
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* Certificate Detected & Configuration Form */}
                        {!loadingCerts && !scanError && (selectedCert || savedThumbprint) && (
                            <div className="space-y-4">
                                <div className="p-4 bg-emerald-50/40 border border-emerald-100 rounded-2xl flex items-center gap-3">
                                    <div className="w-8 h-8 bg-emerald-500 text-white rounded-xl flex items-center justify-center">
                                        <Cpu size={16} />
                                    </div>
                                    <div>
                                        <p className="text-[10px] text-slate-400 font-bold">توكن متصل ومكتشف</p>
                                        <p className="text-xs font-bold text-slate-800">
                                            {selectedCert?.FriendlyName || selectedCert?.Subject || agentInfo?.cert_subject || 'تم تسجيل الشهادة بنجاح'}
                                        </p>
                                    </div>
                                </div>

                                {/* PIN Input field */}
                                <div className="space-y-2 max-w-md">
                                    <label className="text-xs font-bold text-slate-600">أدخل كود PIN الخاص بالتوكن</label>
                                    <div className="relative">
                                        <input
                                            type={showPin ? 'text' : 'password'}
                                            value={pin}
                                            onChange={(e) => setPin(e.target.value)}
                                            placeholder="مثال: 12345678"
                                            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 pl-12 text-sm text-right focus:outline-none focus:ring-2 focus:ring-blue-500"
                                        />
                                        <button
                                            type="button"
                                            onClick={() => setShowPin(!showPin)}
                                            className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                                        >
                                            {showPin ? <EyeOff size={16} /> : <Eye size={16} />}
                                        </button>
                                    </div>
                                </div>

                                <div className="flex flex-wrap gap-2 pt-2">
                                    <button
                                        onClick={handleSaveConfig}
                                        disabled={saving || !pin}
                                        className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold text-sm rounded-xl transition-all shadow-md shadow-blue-100 flex items-center gap-2"
                                    >
                                        {saving ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <CheckCircle2 size={16} />}
                                        حفظ وتفعيل التوكن
                                    </button>

                                    <button
                                        onClick={runSignatureTest}
                                        disabled={isTesting || !savedThumbprint}
                                        className="px-6 py-2.5 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white font-bold text-sm rounded-xl transition-all shadow-md shadow-violet-100 flex items-center gap-2"
                                    >
                                        {isTesting ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <ShieldCheck size={16} />}
                                        اختبار الاتصال بالتوكن
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {/* ── Status Messages ── */}
                {statusMessage && (
                    <div className={`p-4 rounded-2xl text-xs font-semibold ${statusMessage.type === 'success' ? 'bg-emerald-50 text-emerald-800 border border-emerald-100' : 'bg-red-50 text-red-800 border border-red-100'}`}>
                        {statusMessage.text}
                    </div>
                )}

                {/* Test Result Indicator */}
                {testResult && (
                    <div className={`p-4 rounded-2xl text-xs font-semibold ${testResult.success ? 'bg-emerald-50 text-emerald-800 border border-emerald-100' : 'bg-red-50 text-red-800 border border-red-100'}`}>
                        {testResult.message}
                    </div>
                )}
            </div>
        </div>
    );
};

export default TokenSignatureSettings;
