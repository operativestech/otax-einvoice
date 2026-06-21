
import React, { useState, useEffect, useCallback } from 'react';
import {
    Key, Search, Eye, EyeOff, X, CheckCircle2, AlertCircle, ShieldCheck, Shield,
    Fingerprint, Wifi, WifiOff,
    RefreshCw, Info, Download, Clock, Cpu
} from 'lucide-react';
import { API_URL as DEFAULT_API_URL } from '../services/apiService';
import { useTranslation } from '../i18n';
import { confirmDialog, alertDialog } from './ConfirmDialog';

interface TokenSignatureSettingsProps {
    properties: any[];
}

const TokenSignatureSettings: React.FC<TokenSignatureSettingsProps> = ({ properties }) => {
    const { t } = useTranslation();
    const getProp = (name: string, fallback: string = '') => {
        const prop = properties.find(p => p.property_name.toLowerCase() === name.toLowerCase());
        return prop ? prop.property_value : fallback;
    };

    const taxId = getProp('issuer_id', 'default');
    const token = localStorage.getItem('token');
    const authHeaders = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };

    // ── State ──
    const [isLoading, setIsLoading] = useState(true);

    // Agent state
    const [agentOnline, setAgentOnline] = useState<boolean | null>(null);
    const [agentInfo, setAgentInfo] = useState<any>(null);
    const [checkingAgent, setCheckingAgent] = useState(false);
    const [resettingNode, setResettingNode] = useState(false);
    const [lastChecked, setLastChecked] = useState<Date | null>(null);

    // Certificate scan state
    const [loadingCerts, setLoadingCerts] = useState(false);
    const [showCertModal, setShowCertModal] = useState(false);
    const [availableCertificates, setAvailableCertificates] = useState<any[]>([]);
    const [selectedCertIndex, setSelectedCertIndex] = useState<number | null>(null);
    const [pinInput, setPinInput] = useState('');
    const [showPinModal, setShowPinModal] = useState(false);
    const [showModalPin, setShowModalPin] = useState(false);
    const [registering, setRegistering] = useState(false);
    const [scanError, setScanError] = useState('');

    // Saved values
    const savedThumbprint = getProp('signer_CurrentCertName', '');
    const savedPin = getProp('signer_CurrentCertPIN', '');

    // Test
    const [isTesting, setIsTesting] = useState(false);
    const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

    // Notification
    const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

    // PIN display
    const [showPin, setShowPin] = useState(false);

    // ── Load initial data ──
    useEffect(() => {
        loadSigningMethod();
    }, []);

    const loadSigningMethod = async () => {
        setIsLoading(true);
        try {
            const res = await fetch(`${DEFAULT_API_URL}/signing/method`, { headers: authHeaders });
            if (res.ok) {
                const data = await res.json();
                if (data.success) {
                    setAgentInfo(data.agent);
                    setAgentOnline(data.agent?.online ?? null);
                }
            }
        } catch (e) {
            console.error('Failed to load signing method:', e);
        } finally {
            setIsLoading(false);
        }
    };

    // ── Periodically check agent status (every 5s) ──
    const checkAgentStatus = useCallback(async () => {
        setCheckingAgent(true);
        try {
            const res = await fetch(`${DEFAULT_API_URL}/signing/agent-status?companyId=${taxId}`, { headers: authHeaders });
            const data = await res.json();
            setAgentOnline(data.success && data.online);
            if (data.node) {
                setAgentInfo(data.node);
            }
            setLastChecked(new Date());
        } catch {
            setAgentOnline(false);
        } finally {
            setCheckingAgent(false);
        }
    }, [taxId]);

    useEffect(() => {
        checkAgentStatus();
        const interval = setInterval(checkAgentStatus, 5000); // 5 seconds
        return () => clearInterval(interval);
    }, [checkAgentStatus]);

    // ── Test signing ──
    const handleTestSigning = async () => {
        setIsTesting(true);
        setTestResult(null);
        try {
            const res = await fetch(`${DEFAULT_API_URL}/signing/test?companyId=${taxId}`, {
                headers: authHeaders,
            });
            const data = await res.json();
            if (data.agentOnline) {
                setTestResult({ success: true, message: '✅ Agent is connected and ready to sign invoices.' });
            } else {
                setTestResult({ success: false, message: '❌ OTax Agent is NOT connected. Please make sure the agent is running on the Master PC.' });
            }
        } catch (e: any) {
            setTestResult({ success: false, message: 'Connection error: ' + e.message });
        } finally {
            setIsTesting(false);
        }
    };

    // ── Scan certificates (Agent mode) ──
    const handleScanCerts = async () => {
        setLoadingCerts(true);
        setScanError('');
        try {
            const response = await fetch(`${DEFAULT_API_URL}/bridge/list-certs?companyId=${taxId}`);
            if (!response.ok) {
                const errResult = await response.json().catch(() => ({}));
                throw new Error(errResult.message || 'Failed to connect to signing service');
            }
            const result = await response.json();
            if (result.success && Array.isArray(result.certificates)) {
                if (result.certificates.length === 0) {
                    setScanError('Connected to agent but no certificates found. Please insert your USB token.');
                } else {
                    setAvailableCertificates(result.certificates);
                    setShowCertModal(true);
                }
            } else {
                throw new Error(result.message || 'Failed to list certificates');
            }
        } catch (e: any) {
            setScanError(e.message || 'Could not reach signing service.');
            setAgentOnline(false);
        } finally {
            setLoadingCerts(false);
        }
    };

    const handleSelectCert = (index: number) => {
        setSelectedCertIndex(index);
        setPinInput('');
        setShowPinModal(true);
    };

    const handleConfirmPin = async () => {
        if (selectedCertIndex === null) return;
        const cert = availableCertificates[selectedCertIndex];
        if (!pinInput.trim()) { await alertDialog({ title: 'PIN required', message: 'Please enter your certificate PIN.', tone: 'warning' }); return; }

        setRegistering(true);
        try {
            await fetch(`${DEFAULT_API_URL}/bridge/register-cert`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ companyId: taxId, thumbprint: cert.Thumbprint, subject: cert.FriendlyName || cert.Subject, pin: pinInput }),
            });
            const nameInput = document.getElementsByName('signer_CurrentCertName')[0] as HTMLInputElement;
            const pinField = document.getElementsByName('signer_CurrentCertPIN')[0] as HTMLInputElement;
            if (nameInput) nameInput.value = cert.Thumbprint;
            if (pinField) pinField.value = pinInput;
            setShowPinModal(false);
            setShowCertModal(false);
            setSelectedCertIndex(null);
            showNotification('success', `Certificate registered! PIN saved securely. Thumbprint: ${cert.Thumbprint.substring(0, 16)}...`);
        } catch (e: any) {
            showNotification('error', 'Failed to register certificate: ' + e.message);
        } finally {
            setRegistering(false);
        }
    };

    const handleResetNode = async () => {
        const ok = await confirmDialog({
            title: 'Reset signing PC',
            message: 'This will disconnect the current signing PC and allow a new one to connect.',
            confirmLabel: 'Reset',
            tone: 'warning',
        });
        if (!ok) return;
        setResettingNode(true);
        try {
            const res = await fetch(`${DEFAULT_API_URL}/bridge/reset-node`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ companyId: taxId }),
            });
            const data = await res.json();
            if (data.success) {
                showNotification('success', 'Node reset. Re-run the Agent on the new PC.');
                checkAgentStatus();
            } else {
                showNotification('error', 'Reset failed: ' + (data.message || 'Unknown error'));
            }
        } catch (e: any) {
            showNotification('error', 'Reset failed: ' + e.message);
        } finally {
            setResettingNode(false);
        }
    };

    const showNotification = (type: 'success' | 'error', message: string) => {
        setNotification({ type, message });
        setTimeout(() => setNotification(null), 5000);
    };

    if (isLoading) {
        return (
            <div className="flex items-center justify-center py-20">
                <div className="w-8 h-8 border-3 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
            </div>
        );
    }

    return (
        <div className="space-y-6 animate-in fade-in duration-300">

            {/* Hidden inputs for Settings.tsx form serialization.
                `key` forces a remount whenever the DB-loaded value arrives async,
                so the uncontrolled input picks up the new defaultValue. */}
            <input type="hidden" name="signer_CurrentCertName" key={`thumb-${savedThumbprint}`} defaultValue={savedThumbprint} />
            <input type="hidden" name="signer_CurrentCertPIN" key={`pin-${savedPin}`} defaultValue={savedPin} />

            {/* ── Notification Toast ── */}
            {notification && (
                <div className={`fixed top-6 right-6 z-50 flex items-center gap-3 px-5 py-3 rounded-2xl shadow-2xl text-sm font-semibold animate-in slide-in-from-right duration-300 ${notification.type === 'success' ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'}`}>
                    {notification.type === 'success' ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
                    {notification.message}
                    <button onClick={() => setNotification(null)} className="ml-2 opacity-70 hover:opacity-100"><X size={14} /></button>
                </div>
            )}

            {/* ══════════════════════════════════════════════ */}
            {/* ── AGENT STATUS (Live Sync) ──                 */}
            {/* ══════════════════════════════════════════════ */}
            <div className={`p-6 rounded-3xl border-2 transition-all ${agentOnline === true
                ? 'bg-gradient-to-r from-emerald-50 to-green-50 border-emerald-200'
                : 'bg-gradient-to-r from-amber-50 to-orange-50 border-amber-200'
                }`}>
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shadow-lg ${agentOnline === true
                            ? 'bg-emerald-600 shadow-emerald-200'
                            : 'bg-amber-500 shadow-amber-200'
                            }`}>
                            {agentOnline === true ? (
                                <Wifi size={22} className="text-white" />
                            ) : (
                                <WifiOff size={22} className="text-white" />
                            )}
                        </div>
                        <div>
                            <div className="flex items-center gap-2">
                                <p className={`text-base font-bold ${agentOnline === true ? 'text-emerald-800' : 'text-amber-800'}`}>
                                    {checkingAgent ? 'Checking...' : agentOnline === true ? 'OTax Agent Connected ✓' : 'OTax Agent Offline'}
                                </p>
                                {agentOnline === true && (
                                    <span className="relative flex h-2.5 w-2.5">
                                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
                                    </span>
                                )}
                            </div>
                            <p className="text-[11px] text-slate-500">
                                {agentOnline === true
                                    ? t('tokensig.agentOnline')
                                    : t('tokensig.agentOffline')}
                            </p>
                            {lastChecked && (
                                <p className="text-[9px] text-slate-400 flex items-center gap-1 mt-0.5">
                                    <Clock size={9} />
                                    {t('tokensig.lastChecked')}: {lastChecked.toLocaleTimeString()}
                                </p>
                            )}
                        </div>
                    </div>
                    <button
                        onClick={checkAgentStatus}
                        disabled={checkingAgent}
                        className="text-xs font-bold text-slate-500 hover:text-slate-700 px-3 py-1.5 hover:bg-white/50 rounded-lg transition-colors"
                    >
                        <RefreshCw size={16} className={checkingAgent ? 'animate-spin' : ''} />
                    </button>
                </div>

                {/* Agent Info — when online */}
                {agentOnline === true && agentInfo && (
                    <div className="mt-4 pt-4 border-t border-emerald-200 grid grid-cols-2 md:grid-cols-4 gap-3">
                        {agentInfo.agent_name && (
                            <div>
                                <p className="text-[10px] font-bold text-emerald-500 uppercase flex items-center gap-1"><Cpu size={10} /> {t('tokensig.pcName')}</p>
                                <p className="text-xs text-emerald-800 font-semibold">{agentInfo.agent_name}</p>
                            </div>
                        )}
                        {agentInfo.node_id && (
                            <div>
                                <p className="text-[10px] font-bold text-emerald-500 uppercase">{t('tokensig.nodeId')}</p>
                                <p className="text-xs text-emerald-800 font-mono">{agentInfo.node_id.substring(0, 16)}...</p>
                            </div>
                        )}
                        {agentInfo.last_seen && (
                            <div>
                                <p className="text-[10px] font-bold text-emerald-500 uppercase flex items-center gap-1"><Clock size={10} /> {t('tokensig.lastHeartbeat')}</p>
                                <p className="text-xs text-emerald-800 font-semibold">{new Date(agentInfo.last_seen).toLocaleString()}</p>
                            </div>
                        )}
                        {agentInfo.cert_subject && (
                            <div>
                                <p className="text-[10px] font-bold text-emerald-500 uppercase">{t('tokensig.certificate')}</p>
                                <p className="text-xs text-emerald-800 font-semibold">{agentInfo.cert_subject}</p>
                            </div>
                        )}
                    </div>
                )}

                {/* Download Setup — when offline */}
                {agentOnline === false && (
                    <div className="mt-4 pt-4 border-t border-amber-200 space-y-3">
                        <div className="flex flex-wrap gap-3">
                            <a
                                href={`${DEFAULT_API_URL}/bridge/download-setup?companyId=${taxId}`}
                                download="OTax-Agent-Setup.zip"
                                className="inline-flex items-center gap-2 px-5 py-2.5 bg-amber-600 text-white font-bold text-sm rounded-xl hover:bg-amber-700 transition-all shadow-md active:scale-[0.97]"
                            >
                                <Download size={16} />
                                {t('tokensig.downloadSetup')}
                            </a>
                            <button
                                onClick={handleResetNode}
                                disabled={resettingNode}
                                className="inline-flex items-center gap-2 px-5 py-2.5 bg-red-100 text-red-700 font-bold text-sm rounded-xl hover:bg-red-200 transition-all border border-red-200 disabled:opacity-50"
                            >
                                {resettingNode ? t('tokensig.resetting') : t('tokensig.resetNode')}
                            </button>
                        </div>
                        <div className="text-[11px] text-amber-700 space-y-2">
                            <p className="font-bold">📋 Prerequisites (on the signing PC):</p>
                            <ul className="list-disc list-inside space-y-0.5 text-amber-600">
                                <li><b>Node.js v18+</b> — <a href="https://nodejs.org" target="_blank" rel="noopener" className="underline">nodejs.org</a></li>
                                <li><b>USB Token driver</b> (ePass2003) installed</li>
                                <li><b>.NET 8 Runtime</b> — <a href="https://dotnet.microsoft.com/download/dotnet/8.0" target="_blank" rel="noopener" className="underline">dotnet.microsoft.com</a></li>
                            </ul>
                            <p className="font-bold mt-2">🔧 Installation Steps:</p>
                            <ol className="list-decimal list-inside space-y-0.5 text-amber-600">
                                <li>Click <b>Reset Node</b> if locked to another PC</li>
                                <li>Click <b>Download OTax Setup</b> — saves a ZIP file</li>
                                <li>Extract the ZIP to any folder (e.g. C:\OTaxAgent)</li>
                                <li>Open <b>README.txt</b> inside for detailed instructions</li>
                                <li>Right-click <b>setup_agent.bat</b> → Run as Administrator</li>
                                <li>Wait for "Setup Complete!" — agent runs in background ✓</li>
                            </ol>
                        </div>
                    </div>
                )}
            </div>

            {/* ══════════════════════════════════════════════ */}
            {/* ── CERTIFICATE CONFIGURATION (Agent mode) ──   */}
            {/* ══════════════════════════════════════════════ */}
            <div className="space-y-4">
                {/* Scan for Certificates */}
                <section className="p-6 bg-white border border-gray-100 rounded-3xl shadow-sm space-y-4">
                    <div className="flex items-center gap-2">
                        <div className="w-7 h-7 bg-blue-100 rounded-lg flex items-center justify-center text-blue-600 font-bold text-xs">1</div>
                        <h4 className="text-sm font-bold text-slate-800">{t('tokensig.detectToken')}</h4>
                    </div>
                    <p className="text-xs text-slate-500 pl-9">{t('tokensig.insertAndScan')}</p>
                    <div className="pl-9">
                        <button
                            onClick={handleScanCerts}
                            disabled={loadingCerts}
                            className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 text-white font-bold text-sm rounded-2xl hover:bg-blue-700 transition-all shadow-lg shadow-blue-100 disabled:opacity-60 active:scale-[0.97]"
                        >
                            {loadingCerts ? (
                                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            ) : (
                                <Search size={16} />
                            )}
                            {loadingCerts ? t('tokensig.scanning') : t('tokensig.scan')}
                        </button>
                        {scanError && (
                            <div className="mt-3 flex items-start gap-2 p-3 bg-red-50 border border-red-100 rounded-xl text-xs text-red-700">
                                <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
                                <div>
                                    <p className="font-semibold">{scanError}</p>
                                    {scanError.includes('Agent') && (
                                        <p className="mt-1 text-red-500">{t('tokensig.agentNotRunning')}</p>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                </section>

                {/* Selected Certificate */}
                <section className="p-6 bg-white border border-gray-100 rounded-3xl shadow-sm space-y-4">
                    <div className="flex items-center gap-2">
                        <div className="w-7 h-7 bg-indigo-100 rounded-lg flex items-center justify-center text-indigo-600 font-bold text-xs">2</div>
                        <h4 className="text-sm font-bold text-slate-800">{t('tokensig.selectedCert')}</h4>
                    </div>
                    <div className="pl-9 space-y-3">
                        <div className="space-y-1">
                            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{t('tokensig.thumbprint')}</label>
                            <div className="flex items-center gap-2">
                                <Fingerprint size={14} className="text-slate-300" />
                                <input type="text" readOnly value={savedThumbprint} placeholder={t('tokensig.noCertSelected')}
                                    className="flex-1 bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-sm font-mono text-slate-600 cursor-default" />
                            </div>
                        </div>
                        {savedThumbprint && (
                            <div className="flex items-center gap-2 text-xs text-emerald-600">
                                <CheckCircle2 size={14} />
                                <span className="font-semibold">{t('tokensig.certActive')}</span>
                            </div>
                        )}
                    </div>
                </section>

                {/* PIN — Auto-saved */}
                <section className="p-6 bg-white border border-gray-100 rounded-3xl shadow-sm space-y-4">
                    <div className="flex items-center gap-2">
                        <div className="w-7 h-7 bg-emerald-100 rounded-lg flex items-center justify-center text-emerald-600 font-bold text-xs">3</div>
                        <h4 className="text-sm font-bold text-slate-800">{t('tokensig.pinTitle')}</h4>
                    </div>
                    <div className="pl-9 space-y-3">
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{t('tokensig.tokenPin')}</label>
                        <div className="relative mt-1 max-w-sm">
                            <input
                                name="signer_CurrentCertPIN_display"
                                type={showPin ? 'text' : 'password'}
                                key={`pin-display-${savedPin}`}
                                defaultValue={savedPin}
                                placeholder={t('tokensig.pinPlaceholder')}
                                className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 pr-12 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                                onBlur={(e) => {
                                    const hidden = document.getElementsByName('signer_CurrentCertPIN')[0] as HTMLInputElement;
                                    if (hidden) hidden.value = e.target.value;
                                }}
                            />
                            <button type="button" onClick={() => setShowPin(!showPin)}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                                {showPin ? <EyeOff size={16} /> : <Eye size={16} />}
                            </button>
                        </div>
                        {savedPin && (
                            <div className="flex items-start gap-2 p-3 bg-emerald-50 border border-emerald-100 rounded-xl text-xs text-emerald-700">
                                <Info size={14} className="mt-0.5 flex-shrink-0" />
                                <div>
                                    <p className="font-semibold">{t('tokensig.pinSaved')}</p>
                                    <p className="text-emerald-600">{t('tokensig.pinSavedHint')}</p>
                                </div>
                            </div>
                        )}
                    </div>
                </section>
            </div>

            {/* ══════════════════════════════════════════════ */}
            {/* ── TEST SIGNING BUTTON ──                      */}
            {/* ══════════════════════════════════════════════ */}
            <section className="p-6 bg-white border border-gray-100 rounded-3xl shadow-sm">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-violet-100 rounded-xl flex items-center justify-center">
                            <Shield size={20} className="text-violet-600" />
                        </div>
                        <div>
                            <h4 className="text-sm font-bold text-slate-800">{t('tokensig.testSigning')}</h4>
                            <p className="text-[10px] text-slate-500">{t('tokensig.testSigningDesc')}</p>
                        </div>
                    </div>
                    <button
                        onClick={handleTestSigning}
                        disabled={isTesting}
                        className="inline-flex items-center gap-2 px-6 py-2.5 bg-violet-600 text-white font-bold text-sm rounded-xl hover:bg-violet-700 transition-all shadow-lg shadow-violet-100 disabled:opacity-50"
                    >
                        {isTesting ? (
                            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        ) : (
                            <Shield size={14} />
                        )}
                        {isTesting ? t('tokensig.testing') : t('tokensig.runTest')}
                    </button>
                </div>
                {testResult && (
                    <div className={`mt-4 p-3 rounded-xl text-sm ${testResult.success ? 'bg-emerald-50 border border-emerald-200 text-emerald-700' : 'bg-red-50 border border-red-200 text-red-700'}`}>
                        <div className="flex items-start gap-2">
                            {testResult.success ? <CheckCircle2 size={16} className="mt-0.5" /> : <AlertCircle size={16} className="mt-0.5" />}
                            <span className="font-semibold">{testResult.message}</span>
                        </div>
                    </div>
                )}
            </section>

            {/* ═══════════════════════════════════════════════════ */}
            {/* Certificate Selection Modal                        */}
            {/* ═══════════════════════════════════════════════════ */}
            {showCertModal && (
                <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50">
                    <div className="bg-white rounded-3xl shadow-2xl w-[520px] max-h-[80vh] overflow-hidden animate-in zoom-in-95 duration-200">
                        <div className="flex items-center justify-between p-5 border-b border-gray-100">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center">
                                    <ShieldCheck size={20} className="text-blue-600" />
                                </div>
                                <div>
                                    <h3 className="font-bold text-slate-800">{t('tokensig.selectCertModal')}</h3>
                                    <p className="text-xs text-slate-500">{availableCertificates.length} certificate{availableCertificates.length !== 1 ? 's' : ''} found</p>
                                </div>
                            </div>
                            <button onClick={() => setShowCertModal(false)} className="w-8 h-8 rounded-lg hover:bg-gray-100 flex items-center justify-center text-slate-400">
                                <X size={18} />
                            </button>
                        </div>
                        <div className="p-4 max-h-[50vh] overflow-y-auto space-y-2">
                            {availableCertificates.map((cert, idx) => (
                                <button key={idx} onClick={() => handleSelectCert(idx)}
                                    className="w-full text-left p-4 rounded-2xl border border-gray-100 hover:border-blue-300 hover:bg-blue-50/50 transition-all group">
                                    <div className="flex items-start justify-between">
                                        <div className="space-y-1 flex-1 min-w-0">
                                            <p className="text-sm font-bold text-slate-800 truncate">{cert.FriendlyName || cert.Subject || 'Unnamed'}</p>
                                            <p className="text-[10px] font-mono text-slate-400 truncate">{cert.Thumbprint}</p>
                                            {cert.NotAfter && <p className="text-[10px] text-slate-400">{t('tokensig.expires')}: {new Date(cert.NotAfter).toLocaleDateString()}</p>}
                                        </div>
                                        <span className="text-xs font-bold text-blue-600 opacity-0 group-hover:opacity-100 transition-opacity mt-1">{t('tokensig.select')}</span>
                                    </div>
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {/* PIN Entry Modal */}
            {showPinModal && selectedCertIndex !== null && (
                <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-[60]">
                    <div className="bg-white rounded-3xl shadow-2xl w-[420px] overflow-hidden animate-in zoom-in-95 duration-200">
                        <div className="p-6 space-y-5">
                            <div className="text-center space-y-2">
                                <div className="w-14 h-14 bg-emerald-100 rounded-2xl flex items-center justify-center mx-auto">
                                    <Key size={24} className="text-emerald-600" />
                                </div>
                                <h3 className="font-bold text-slate-800 text-lg">{t('tokensig.enterPin')}</h3>
                                <p className="text-xs text-slate-500">
                                    For: <span className="font-semibold text-slate-700">{availableCertificates[selectedCertIndex]?.FriendlyName || 'Selected Certificate'}</span>
                                </p>
                                <p className="text-[10px] text-emerald-600 font-semibold">PIN will be saved securely — you won't need to enter it again.</p>
                            </div>
                            <div className="relative">
                                <input
                                    type={showModalPin ? 'text' : 'password'}
                                    value={pinInput}
                                    onChange={(e) => setPinInput(e.target.value)}
                                    placeholder="Enter PIN"
                                    autoFocus
                                    className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 pr-12 text-center text-lg font-mono tracking-widest focus:ring-2 focus:ring-emerald-500 outline-none"
                                    onKeyDown={(e) => e.key === 'Enter' && handleConfirmPin()}
                                />
                                <button type="button" onClick={() => setShowModalPin(!showModalPin)}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                                    {showModalPin ? <EyeOff size={16} /> : <Eye size={16} />}
                                </button>
                            </div>
                            <div className="flex gap-3">
                                <button onClick={() => { setShowPinModal(false); setSelectedCertIndex(null); }}
                                    className="flex-1 py-3 bg-gray-100 text-slate-600 font-bold text-sm rounded-xl hover:bg-gray-200 transition-colors">
                                    Cancel
                                </button>
                                <button onClick={handleConfirmPin} disabled={registering || !pinInput.trim()}
                                    className="flex-1 py-3 bg-emerald-600 text-white font-bold text-sm rounded-xl hover:bg-emerald-700 transition-colors shadow-lg shadow-emerald-100 disabled:opacity-50 flex items-center justify-center gap-2">
                                    {registering ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <CheckCircle2 size={16} />}
                                    {registering ? 'Saving...' : 'Confirm & Save'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default TokenSignatureSettings;
