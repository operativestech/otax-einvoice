import React, { useState, useEffect, useCallback } from 'react';
import {
    Key, Eye, EyeOff, CheckCircle2, AlertCircle, ShieldCheck,
    Wifi, WifiOff, RefreshCw, Download, Cpu, XCircle, Loader2
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
    
    const getAuthToken = () => {
        try {
            const userStr = localStorage.getItem('invoice_user');
            if (userStr) {
                const user = JSON.parse(userStr);
                if (user.token) return user.token;
            }
        } catch (e) {}
        return localStorage.getItem('token') || '';
    };

    const token = getAuthToken();
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
                    const firstCert = data.certificates[0];
                    setSelectedCert(firstCert);
                    if (!savedThumbprint) {
                        setSavedThumbprint(firstCert.Thumbprint);
                    }
                } else {
                    setSelectedCert(null);
                    setScanError('Agent is connected but no USB token was detected. Please insert your token into the computer.');
                }
            } else {
                throw new Error(data.message || 'No certificates found');
            }
        } catch (e: any) {
            setScanError('Failed to read certificate from signing agent. Make sure the USB token is inserted.');
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
            setStatusMessage({ type: 'error', text: 'Please make sure the USB token is connected to the computer first.' });
            return;
        }
        if (!pin.trim()) {
            setStatusMessage({ type: 'error', text: 'Please enter the token PIN code.' });
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
                setStatusMessage({ type: 'success', text: '✓ Token activated successfully! Ready to sign invoices.' });
                // Automatically run signature test
                runSignatureTest();
            } else {
                throw new Error(data.message || 'Failed to register');
            }
        } catch (e: any) {
            setStatusMessage({ type: 'error', text: 'Failed to save configuration: ' + e.message });
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
                setTestResult({ success: true, message: '✓ Connection and signing are working! Token is connected and ready.' });
            } else {
                setTestResult({ success: false, message: 'Signature test failed: Please verify your PIN code and that the token is inserted.' });
            }
        } catch (e: any) {
            setTestResult({ success: false, message: 'Connection error: ' + e.message });
        } finally {
            setIsTesting(false);
        }
    };

    const handleResetNode = async () => {
        const ok = await confirmDialog({
            title: 'Reset Signing Device',
            message: 'Do you want to disconnect the current signing device and allow linking another one?',
            confirmLabel: 'Reset',
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
                setStatusMessage({ type: 'success', text: 'Reset successful. You can now run the Agent on a new computer.' });
                checkAgentStatus();
            }
        } catch (e: any) {
            setStatusMessage({ type: 'error', text: 'Reset failed: ' + e.message });
        }
    };

    // Determine overall readiness state
    const isFullyConfigured = agentOnline === true && savedThumbprint && savedPin;

    return (
        <div className="space-y-6 animate-in fade-in duration-300">
            {/* Hidden Inputs for Form Sync */}
            <input type="hidden" name="signer_CurrentCertName" key={`thumb-${savedThumbprint}`} defaultValue={savedThumbprint} />
            <input type="hidden" name="signer_CurrentCertPIN" key={`pin-${savedPin}`} defaultValue={savedPin} />

            {/* ── MAIN STATUS CARD ── */}
            <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">

                {/* Header with Connection Status */}
                <div className="p-6 flex items-center justify-between border-b border-slate-50">
                    <div className="flex items-center gap-3">
                        <div className={`w-11 h-11 rounded-2xl flex items-center justify-center transition-all duration-500 ${
                            agentOnline === true
                                ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-200'
                                : 'bg-slate-100 text-slate-400'
                        }`}>
                            <Key size={20} />
                        </div>
                        <div>
                            <h3 className="text-base font-bold text-slate-800">
                                USB Token Signature
                            </h3>
                            <p className="text-xs text-slate-400 mt-0.5">
                                Connect your e-signature USB token to sign invoices
                            </p>
                        </div>
                    </div>

                    {/* Live Status Badge */}
                    <div className="flex items-center gap-2">
                        {agentOnline === null ? (
                            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-50 text-slate-400 rounded-full text-xs font-semibold border border-slate-100">
                                <Loader2 size={12} className="animate-spin" />
                                Checking...
                            </div>
                        ) : agentOnline === true ? (
                            <div className="flex items-center gap-1.5 px-3.5 py-2 bg-emerald-50 text-emerald-700 rounded-full text-xs font-bold border border-emerald-200 shadow-sm transition-all duration-500">
                                <CheckCircle2 size={14} className="text-emerald-500" />
                                Agent Connected
                            </div>
                        ) : (
                            <div className="flex items-center gap-1.5 px-3.5 py-2 bg-amber-50 text-amber-700 rounded-full text-xs font-bold border border-amber-200">
                                <WifiOff size={14} className="text-amber-400" />
                                Agent Offline
                            </div>
                        )}
                        <button
                            onClick={checkAgentStatus}
                            disabled={checkingAgent}
                            className="p-2 hover:bg-slate-50 rounded-xl transition-all text-slate-400 hover:text-slate-600 disabled:opacity-50"
                            title="Refresh Status"
                        >
                            <RefreshCw size={15} className={checkingAgent ? 'animate-spin' : ''} />
                        </button>
                    </div>
                </div>

                {/* ── CASE 1: AGENT IS OFFLINE ── */}
                {agentOnline === false && (
                    <div className="p-6 space-y-5">
                        {/* Offline Status Banner */}
                        <div className="p-5 bg-gradient-to-r from-slate-50 to-blue-50/30 rounded-2xl border border-slate-100 space-y-4">
                            <div className="flex gap-4 items-start">
                                <div className="w-12 h-12 bg-amber-100 text-amber-600 rounded-2xl flex items-center justify-center flex-shrink-0">
                                    <WifiOff size={22} />
                                </div>
                                <div className="space-y-1.5">
                                    <h4 className="font-bold text-slate-800 text-sm">OTax Agent is not running</h4>
                                    <p className="text-xs text-slate-500 leading-relaxed">
                                        To enable USB token signing, download and install the OTax Agent on the computer connected to your USB token.
                                        Once running, any user in your organization can submit signed invoices automatically from anywhere.
                                    </p>
                                </div>
                            </div>

                            {/* Download Button */}
                            <div className="flex flex-wrap gap-3 pt-1">
                                <a
                                    href={`${DEFAULT_API_URL}/bridge/download-installer?companyId=${taxId}`}
                                    download={`OTax-Agent-Setup-${taxId}.exe`}
                                    className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm rounded-xl transition-all shadow-lg shadow-blue-200 active:scale-[0.98] hover:shadow-xl hover:shadow-blue-200"
                                >
                                    <Download size={16} />
                                    Download OTax Agent Installer (.exe)
                                </a>
                                {agentInfo && (
                                    <button
                                        onClick={handleResetNode}
                                        className="px-5 py-3 bg-red-50 hover:bg-red-100 text-red-600 font-bold text-sm rounded-xl transition-all"
                                    >
                                        Reset Linked Computer
                                    </button>
                                )}
                            </div>
                        </div>

                        {/* Setup Steps */}
                        <div className="p-4 bg-slate-50/50 rounded-2xl border border-slate-100">
                            <h5 className="text-xs font-bold text-slate-700 mb-3 flex items-center gap-1.5">
                                <span className="text-base">📋</span> Quick Setup Steps
                            </h5>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                {[
                                    { step: 1, text: 'Download the installer file (.exe) above.' },
                                    { step: 2, text: 'Insert the USB token into the computer.' },
                                    { step: 3, text: 'Run the installer — it will auto-setup everything.' },
                                    { step: 4, text: 'This page will automatically detect the connection.' },
                                ].map(({ step, text }) => (
                                    <div key={step} className="flex items-start gap-2.5 p-2">
                                        <span className="w-5 h-5 bg-blue-100 text-blue-600 rounded-lg text-[10px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
                                            {step}
                                        </span>
                                        <p className="text-[11px] text-slate-600 leading-relaxed">{text}</p>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                )}

                {/* ── CASE 2: AGENT IS ONLINE ── */}
                {agentOnline === true && (
                    <div className="p-6 space-y-5">

                        {/* Big Success Indicator - Agent is connected */}
                        <div className="relative overflow-hidden p-5 bg-gradient-to-r from-emerald-50 to-teal-50/40 rounded-2xl border border-emerald-100">
                            {/* Background decoration */}
                            <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-100/40 rounded-full -translate-y-6 translate-x-6" />
                            <div className="absolute bottom-0 left-0 w-16 h-16 bg-teal-100/30 rounded-full translate-y-4 -translate-x-4" />

                            <div className="relative flex items-center gap-4">
                                <div className="w-14 h-14 bg-emerald-500 text-white rounded-2xl flex items-center justify-center shadow-lg shadow-emerald-200 flex-shrink-0">
                                    <CheckCircle2 size={28} />
                                </div>
                                <div>
                                    <h4 className="font-bold text-emerald-800 text-sm">OTax Agent is Connected</h4>
                                    <p className="text-xs text-emerald-600 mt-0.5">
                                        The signing agent is running and ready to process invoices.
                                    </p>
                                    {agentInfo?.node_id && (
                                        <p className="text-[10px] text-emerald-500/70 mt-1 font-mono">
                                            Node: {agentInfo.node_id.substring(0, 12)}...
                                        </p>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Auto-scanning loader */}
                        {loadingCerts && (
                            <div className="p-8 text-center flex flex-col items-center justify-center gap-3">
                                <div className="w-8 h-8 border-3 border-blue-200 border-t-blue-600 rounded-full animate-spin"></div>
                                <p className="text-xs text-slate-500 font-semibold">Scanning for USB token certificates...</p>
                            </div>
                        )}

                        {/* Scan Error or No Token Connected */}
                        {!loadingCerts && scanError && (
                            <div className="p-5 bg-amber-50/50 border border-amber-100 rounded-2xl flex items-start gap-3">
                                <AlertCircle className="text-amber-500 mt-0.5 flex-shrink-0" size={18} />
                                <div className="space-y-1">
                                    <p className="text-xs font-bold text-amber-800">USB Token Not Detected</p>
                                    <p className="text-[11px] text-amber-700">{scanError}</p>
                                    <button
                                        onClick={scanCertificates}
                                        className="mt-2 text-xs font-bold text-blue-600 hover:text-blue-700 underline"
                                    >
                                        Rescan for USB Token
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* Certificate Detected & Configuration Form */}
                        {!loadingCerts && !scanError && (selectedCert || savedThumbprint) && (
                            <div className="space-y-4">
                                {/* Certificate Info */}
                                <div className="p-4 bg-blue-50/40 border border-blue-100 rounded-2xl flex items-center gap-3">
                                    <div className="w-9 h-9 bg-blue-500 text-white rounded-xl flex items-center justify-center">
                                        <Cpu size={16} />
                                    </div>
                                    <div>
                                        <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Certificate Detected</p>
                                        <p className="text-xs font-bold text-slate-800">
                                            {selectedCert?.FriendlyName || selectedCert?.Subject || agentInfo?.cert_subject || 'Certificate registered'}
                                        </p>
                                    </div>
                                    <div className="ml-auto">
                                        <CheckCircle2 size={18} className="text-blue-500" />
                                    </div>
                                </div>

                                {/* PIN Input field */}
                                <div className="space-y-2 max-w-md">
                                    <label className="text-xs font-bold text-slate-600">Token PIN Code</label>
                                    <div className="relative">
                                        <input
                                            type={showPin ? 'text' : 'password'}
                                            value={pin}
                                            onChange={(e) => setPin(e.target.value)}
                                            placeholder="e.g. 12345678"
                                            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 pr-12 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                                        />
                                        <button
                                            type="button"
                                            onClick={() => setShowPin(!showPin)}
                                            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                                        >
                                            {showPin ? <EyeOff size={16} /> : <Eye size={16} />}
                                        </button>
                                    </div>
                                </div>

                                {/* Action Buttons */}
                                <div className="flex flex-wrap gap-2 pt-1">
                                    <button
                                        onClick={handleSaveConfig}
                                        disabled={saving || !pin}
                                        className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold text-sm rounded-xl transition-all shadow-md shadow-blue-100 flex items-center gap-2"
                                    >
                                        {saving ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <CheckCircle2 size={16} />}
                                        Save & Activate Token
                                    </button>

                                    <button
                                        onClick={runSignatureTest}
                                        disabled={isTesting || !savedThumbprint}
                                        className="px-6 py-2.5 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white font-bold text-sm rounded-xl transition-all shadow-md shadow-violet-100 flex items-center gap-2"
                                    >
                                        {isTesting ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <ShieldCheck size={16} />}
                                        Test Signature
                                    </button>

                                    <button
                                        onClick={handleResetNode}
                                        className="px-5 py-2.5 bg-slate-50 hover:bg-red-50 text-slate-500 hover:text-red-600 font-semibold text-sm rounded-xl transition-all border border-slate-200 hover:border-red-200"
                                    >
                                        Reset Device
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {/* ── Status Messages ── */}
                {(statusMessage || testResult) && (
                    <div className="px-6 pb-5 space-y-3">
                        {statusMessage && (
                            <div className={`p-4 rounded-2xl text-xs font-semibold flex items-start gap-2 ${
                                statusMessage.type === 'success'
                                    ? 'bg-emerald-50 text-emerald-800 border border-emerald-100'
                                    : 'bg-red-50 text-red-800 border border-red-100'
                            }`}>
                                {statusMessage.type === 'success'
                                    ? <CheckCircle2 size={14} className="text-emerald-500 mt-0.5 flex-shrink-0" />
                                    : <XCircle size={14} className="text-red-500 mt-0.5 flex-shrink-0" />
                                }
                                {statusMessage.text}
                            </div>
                        )}

                        {testResult && (
                            <div className={`p-4 rounded-2xl text-xs font-semibold flex items-start gap-2 ${
                                testResult.success
                                    ? 'bg-emerald-50 text-emerald-800 border border-emerald-100'
                                    : 'bg-red-50 text-red-800 border border-red-100'
                            }`}>
                                {testResult.success
                                    ? <ShieldCheck size={14} className="text-emerald-500 mt-0.5 flex-shrink-0" />
                                    : <AlertCircle size={14} className="text-red-500 mt-0.5 flex-shrink-0" />
                                }
                                {testResult.message}
                            </div>
                        )}
                    </div>
                )}

                {/* ── Fully Configured Success Strip ── */}
                {isFullyConfigured && (
                    <div className="px-6 pb-5">
                        <div className="p-3 bg-gradient-to-r from-emerald-500 to-teal-500 rounded-xl text-white text-center">
                            <p className="text-xs font-bold flex items-center justify-center gap-2">
                                <ShieldCheck size={16} />
                                Token is active — Invoices will be signed automatically
                            </p>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default TokenSignatureSettings;
