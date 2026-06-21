import { API_URL as DEFAULT_API_URL, SIGNER_API_URL, appendOrgScope, getScopedOrgId } from '../services/apiService';
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Settings as SettingsIcon, Building, Link, Shield, FileCode, FolderOpen,
  HardDrive, Globe, Database, Key, Clock, Save, Activity, Layout, Search, Image as ImageIcon,
  Layers, Cpu, Server, Globe2, ChevronDown, CheckCircle2, AlertCircle, X, RefreshCw, Download, FileSpreadsheet, FileText, Building2,
  Repeat, Plus, Trash2, Loader2, Timer, Bell, KeyRound, Copy as CopyIcon, Eye, EyeOff,
  ShieldCheck, Smartphone, Send, Zap, Webhook, RotateCw, FlaskConical, ExternalLink, Mail
} from 'lucide-react';
import ModernDialog from '../components/ModernDialog';
import TokenSignatureSettings from '../components/TokenSignatureSettings';
import SecretInput from '../components/SecretInput';
import { useTranslation } from '../i18n';
import { confirmDialog, alertDialog, toast } from '../components/ConfirmDialog';

// Clamp + parse a string/number into an integer in [lo, hi]. Used by the
// scheduled-reports tab inputs (hour 0-23, minute 0-59, day-of-month 1-28).
const clampInRange = (raw: any, lo: number, hi: number): number => {
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
};

const Settings: React.FC = () => {
  const { t } = useTranslation();
  const { section } = useParams<{ section?: string }>();
  const navigate = useNavigate();

  // Map URL sections to internal tab IDs
  const activeTab = section || 'compinfo';

  const [selectedErp, setSelectedErp] = useState('oracle');
  const [selectedSecondaryDb, setSelectedSecondaryDb] = useState('oracle');
  const [environmentType, setEnvironmentType] = useState('Prod');
  const [submitFormat, setSubmitFormat] = useState<'JSON' | 'XML'>('JSON');

  // ── Branches state ──
  const [branches, setBranches] = useState<any[]>([]);
  const [branchesLoading, setBranchesLoading] = useState(false);
  const [branchForm, setBranchForm] = useState<any>({ branch_id: '', name: '', country: 'EG', governate: '', region_city: '', street: '', building_number: '', postal_code: '', is_default: false });
  const [branchError, setBranchError] = useState<string | null>(null);

  const loadBranches = useCallback(async () => {
    setBranchesLoading(true);
    setBranchError(null);
    try {
      const userStr = localStorage.getItem('invoice_user');
      const token = userStr ? JSON.parse(userStr).token : localStorage.getItem('token');
      const r = await fetch(`${DEFAULT_API_URL}/admin/branches`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      const d = await r.json();
      if (!r.ok || !d.success) throw new Error(d.message || `HTTP ${r.status}`);
      setBranches(d.rows || []);
    } catch (e: any) { setBranchError(e.message); }
    finally { setBranchesLoading(false); }
  }, []);

  const createBranch = async () => {
    setBranchError(null);
    try {
      if (!branchForm.branch_id.trim()) { setBranchError('Branch ID is required.'); return; }
      const userStr = localStorage.getItem('invoice_user');
      const token = userStr ? JSON.parse(userStr).token : localStorage.getItem('token');
      const r = await fetch(`${DEFAULT_API_URL}/admin/branches`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(branchForm),
      });
      const d = await r.json();
      if (!r.ok || !d.success) throw new Error(d.message || `HTTP ${r.status}`);
      setBranchForm({ branch_id: '', name: '', country: 'EG', governate: '', region_city: '', street: '', building_number: '', postal_code: '', is_default: false });
      await loadBranches();
    } catch (e: any) { setBranchError(e.message); }
  };

  const setBranchDefault = async (id: number) => {
    try {
      const userStr = localStorage.getItem('invoice_user');
      const token = userStr ? JSON.parse(userStr).token : localStorage.getItem('token');
      await fetch(`${DEFAULT_API_URL}/admin/branches/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ is_default: true }),
      });
      await loadBranches();
    } catch (e: any) { setBranchError(e.message); }
  };

  const deleteBranch = async (id: number) => {
    const ok = await confirmDialog({
      title: 'Delete branch',
      message: 'Delete this branch?\n\nInvoices already submitted will remain attributed to it, but you cannot use it going forward.',
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      const userStr = localStorage.getItem('invoice_user');
      const token = userStr ? JSON.parse(userStr).token : localStorage.getItem('token');
      await fetch(`${DEFAULT_API_URL}/admin/branches/${id}`, {
        method: 'DELETE',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      await loadBranches();
    } catch (e: any) { setBranchError(e.message); }
  };

  useEffect(() => {
    if (activeTab === 'branches') loadBranches();
  }, [activeTab, loadBranches]);

  // ── 2FA state ──
  // Three-step flow: status → setup (gets QR + secret) → verify code → enabled.
  // We never persist the secret on the client beyond the in-flight setup.
  const [twoFaEnabled, setTwoFaEnabled] = useState<boolean | null>(null);
  const [twoFaSecret, setTwoFaSecret] = useState<string | null>(null);
  const [twoFaUrl, setTwoFaUrl] = useState<string | null>(null);
  const [twoFaCode, setTwoFaCode] = useState('');
  const [twoFaPassword, setTwoFaPassword] = useState('');
  const [twoFaError, setTwoFaError] = useState<string | null>(null);
  const [twoFaBusy, setTwoFaBusy] = useState(false);
  // Backup codes are returned ONCE on /verify or /backup-codes. We surface
  // them to the user with a copy button + warning to save offline; reloading
  // the page wipes them.
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  const [backupRemaining, setBackupRemaining] = useState<{ remaining: number; total: number } | null>(null);
  const [showRegenPassword, setShowRegenPassword] = useState('');

  const load2faStatus = useCallback(async () => {
    try {
      const userStr = localStorage.getItem('invoice_user');
      const token = userStr ? JSON.parse(userStr).token : localStorage.getItem('token');
      const r = await fetch(`${DEFAULT_API_URL}/auth/2fa/status`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const d = await r.json();
      if (d.success) {
        setTwoFaEnabled(!!d.enabled);
        // Pull the remaining-backup-code count whenever 2FA is on so the UI
        // can warn the user when they're running low (≤2 left → orange).
        if (d.enabled) {
          const sr = await fetch(`${DEFAULT_API_URL}/auth/2fa/backup-codes/status`, {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          });
          const sd = await sr.json();
          if (sd.success) setBackupRemaining({ remaining: sd.remaining, total: sd.total });
        } else {
          setBackupRemaining(null);
        }
      }
    } catch { /* silent */ }
  }, []);

  const regenerateBackupCodes = async () => {
    setTwoFaBusy(true);
    setTwoFaError(null);
    try {
      if (!showRegenPassword) { setTwoFaError('Enter your current password to regenerate backup codes.'); return; }
      const userStr = localStorage.getItem('invoice_user');
      const token = userStr ? JSON.parse(userStr).token : localStorage.getItem('token');
      const r = await fetch(`${DEFAULT_API_URL}/auth/2fa/backup-codes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ password: showRegenPassword }),
      });
      const d = await r.json();
      if (!r.ok || !d.success) throw new Error(d.message || `HTTP ${r.status}`);
      setBackupCodes(d.backupCodes);
      setShowRegenPassword('');
      await load2faStatus();
    } catch (e: any) { setTwoFaError(e.message); }
    finally { setTwoFaBusy(false); }
  };

  const start2faSetup = async () => {
    setTwoFaBusy(true);
    setTwoFaError(null);
    try {
      const userStr = localStorage.getItem('invoice_user');
      const token = userStr ? JSON.parse(userStr).token : localStorage.getItem('token');
      const r = await fetch(`${DEFAULT_API_URL}/auth/2fa/setup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      });
      const d = await r.json();
      if (!r.ok || !d.success) throw new Error(d.message || `HTTP ${r.status}`);
      setTwoFaSecret(d.secret);
      setTwoFaUrl(d.otpauthUrl);
    } catch (e: any) { setTwoFaError(e.message); }
    finally { setTwoFaBusy(false); }
  };

  const confirm2faSetup = async () => {
    setTwoFaBusy(true);
    setTwoFaError(null);
    try {
      if (!/^\d{6}$/.test(twoFaCode)) { setTwoFaError('Enter the 6-digit code from your authenticator.'); return; }
      const userStr = localStorage.getItem('invoice_user');
      const token = userStr ? JSON.parse(userStr).token : localStorage.getItem('token');
      const r = await fetch(`${DEFAULT_API_URL}/auth/2fa/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ code: twoFaCode }),
      });
      const d = await r.json();
      if (!r.ok || !d.success) throw new Error(d.message || `HTTP ${r.status}`);
      setTwoFaEnabled(true);
      setTwoFaSecret(null);
      setTwoFaUrl(null);
      setTwoFaCode('');
      // Surface the backup codes returned on enrolment so the user can
      // copy/print them. They never come back from the server again.
      if (Array.isArray(d.backupCodes)) setBackupCodes(d.backupCodes);
      await load2faStatus();
    } catch (e: any) { setTwoFaError(e.message); }
    finally { setTwoFaBusy(false); }
  };

  const disable2fa = async () => {
    setTwoFaBusy(true);
    setTwoFaError(null);
    try {
      if (!twoFaPassword) { setTwoFaError('Enter your current password to disable 2FA.'); return; }
      const userStr = localStorage.getItem('invoice_user');
      const token = userStr ? JSON.parse(userStr).token : localStorage.getItem('token');
      const r = await fetch(`${DEFAULT_API_URL}/auth/2fa/disable`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ password: twoFaPassword }),
      });
      const d = await r.json();
      if (!r.ok || !d.success) throw new Error(d.message || `HTTP ${r.status}`);
      setTwoFaEnabled(false);
      setTwoFaPassword('');
    } catch (e: any) { setTwoFaError(e.message); }
    finally { setTwoFaBusy(false); }
  };

  useEffect(() => {
    if (activeTab === 'security') load2faStatus();
  }, [activeTab, load2faStatus]);

  // ── API Keys state ──
  // Plaintext `justCreatedKey` is returned ONCE by the server on creation and
  // shown to the user with a copy button. We clear it on tab switch so it
  // doesn't hang around in memory for longer than necessary.
  const [apiKeys, setApiKeys] = useState<any[]>([]);
  const [apiKeysLoading, setApiKeysLoading] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [newKeyScope, setNewKeyScope] = useState<'read' | 'write' | 'admin'>('read');
  const [newKeyExpires, setNewKeyExpires] = useState('');
  const [newKeyRateLimit, setNewKeyRateLimit] = useState<string>(''); // '' → server default (60), 0 → unlimited
  const [justCreatedKey, setJustCreatedKey] = useState<string | null>(null);
  const [keyCopied, setKeyCopied] = useState(false);
  const [apiKeyError, setApiKeyError] = useState<string | null>(null);

  // ── Auto Sync scheduler state ──
  const [autoSyncMode, setAutoSyncMode] = useState<'off' | 'interval' | 'times'>('off');
  const [autoSyncInterval, setAutoSyncInterval] = useState<number>(60); // minutes
  const [autoSyncTimes, setAutoSyncTimes] = useState<string[]>([]);
  // Email notification opt-ins — per org. Default ON on a fresh install.
  // VAT-reminder toggle was removed; the "Pre-Filing VAT Pack" scheduled
  // report supersedes it (richer XLSX, configurable cadence).
  const [notifyDailyDigest, setNotifyDailyDigest] = useState(true);
  // Optional override mailbox — when set, every notification email goes to this
  // address only. Empty = fall back to all org admins. Sender is always the
  // global OTax SMTP (same address that sends OTP codes).
  const [notifyRecipientEmail, setNotifyRecipientEmail] = useState<string>('');
  const [notifySenderEmail, setNotifySenderEmail] = useState<string | null>(null);
  const [autoSyncLastRun, setAutoSyncLastRun] = useState<string | null>(null);
  const [autoSyncLoading, setAutoSyncLoading] = useState(false);
  const [autoSyncSaving, setAutoSyncSaving] = useState(false);
  const [autoSyncMsg, setAutoSyncMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [smtpTesting, setSmtpTesting] = useState(false);
  const [smtpTestResult, setSmtpTestResult] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [smtpTestEmail, setSmtpTestEmail] = useState('');

  // ── Scheduled Reports tab state ──────────────────────────────────────
  // One row per known report type (catalogue ∪ saved schedule). The user
  // toggles Enabled, picks frequency + time + optional recipient; a
  // "Send Now" button bypasses the cooldown for previewing.
  interface ScheduledReportRow {
    id: string;
    label: string;
    description: string;
    defaultCadence: 'daily' | 'weekly' | 'monthly';
    windowKind: string;
    enabled: boolean;
    frequency: 'daily' | 'weekly' | 'monthly';
    dayOfWeek: number | null;
    dayOfMonth: number | null;
    timeHour: number;
    timeMinute: number;
    recipientEmail: string | null;
    lastSentAt: string | null;
    lastError: string | null;
  }
  const [scheduledReports, setScheduledReports] = useState<ScheduledReportRow[]>([]);
  const [reportsLoading, setReportsLoading] = useState(false);
  const [reportSavingId, setReportSavingId] = useState<string | null>(null);
  const [reportSendingId, setReportSendingId] = useState<string | null>(null);
  const [reportMsg, setReportMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  // Per-row dirty flag: a report id appears here once the user touched ANY
  // field in its card. The Save button on that card is only active while the
  // id is in this set; it's removed when the PUT succeeds.
  const [dirtyReportIds, setDirtyReportIds] = useState<Set<string>>(new Set());
  // Logo uploader state — kept at the top level so the Company Info preview
  // component below can read both the persisted URL (loaded via getProp) and
  // the freshly-uploaded one without losing it on a re-render.
  const logoFileRef = useRef<HTMLInputElement>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [logoUploading, setLogoUploading] = useState(false);
  const [logoMsg, setLogoMsg] = useState<string | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<'success' | 'error' | null>(null);
  const [properties, setProperties] = useState<any[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [saveNotification, setSaveNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Dialog State
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [dialogType, setDialogType] = useState<'success' | 'error' | 'info' | 'confirm'>('info');
  const [dialogTitle, setDialogTitle] = useState('');
  const [dialogMessage, setDialogMessage] = useState('');

  // ETA Sync State
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'completed' | 'error'>('idle');
  const [syncProgress, setSyncProgress] = useState(0);
  const [syncMessage, setSyncMessage] = useState('');
  const [syncedCount, setSyncedCount] = useState(0);
  const [etaInvoices, setEtaInvoices] = useState<any[]>([]);
  const pollRef = useRef<NodeJS.Timeout | null>(null);

  // Sync History State
  const [syncHistoryData, setSyncHistoryData] = useState<any[]>([]);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  // Fetch sync history on mount
  const fetchSyncHistory = useCallback(async () => {
    try {
      const token = localStorage.getItem('token');
      const API_URL = DEFAULT_API_URL;
      const resp = await fetch(appendOrgScope(`${API_URL}/eta/sync/history`), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (resp.ok) {
        const data = await resp.json();
        setSyncHistoryData(data.history || []);
        setLastSyncAt(data.lastSyncAt || null);
      }
    } catch (e) { /* */ }
  }, []);

  useEffect(() => { fetchSyncHistory(); }, [fetchSyncHistory]);

  const fetchSyncedInvoices = useCallback(async () => {
    try {
      const token = localStorage.getItem('token');
      const API_URL = DEFAULT_API_URL;
      const resp = await fetch(`${API_URL}/eta/local/documents?pageSize=200`, {
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        }
      });
      const data = await resp.json();
      if (data.success && data.result) {
        setEtaInvoices(data.result);
      }
    } catch (e: any) {
      console.error('[Settings] Failed to fetch synced invoices:', e.message);
    }
  }, []);

  const startETASync = async () => {
    const token = localStorage.getItem('token');
    const API_URL = DEFAULT_API_URL;

    // First save the credentials
    const clientIdPreProd = (document.getElementsByName('signer_preProdClientId')[0] as HTMLInputElement)?.value;
    const clientSecretPreProd = (document.getElementsByName('signer_preProdClientSecret')[0] as HTMLInputElement)?.value;
    const clientIdProd = (document.getElementsByName('signer_prodClientId')[0] as HTMLInputElement)?.value;
    const clientSecretProd = (document.getElementsByName('signer_prodClientSecret')[0] as HTMLInputElement)?.value;

    if (!clientIdPreProd && !clientIdProd) {
      setDialogType('error');
      setDialogTitle('Missing Credentials');
      setDialogMessage('Please enter Client ID and Client Secret first, then save before syncing.');
      setIsDialogOpen(true);
      return;
    }

    // Quick save ETA credentials to org settings before sync
    try {
      await fetch(appendOrgScope(`${API_URL}/admin/organization/eta-settings`), {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          eta_environment: environmentType,
          ...(clientIdPreProd ? { eta_preprod_client_id: clientIdPreProd } : {}),
          ...(clientSecretPreProd ? { eta_preprod_client_secret: clientSecretPreProd } : {}),
          ...(clientIdProd ? { eta_prod_client_id: clientIdProd } : {}),
          ...(clientSecretProd ? { eta_prod_client_secret: clientSecretProd } : {}),
        })
      });
    } catch (e) { /* ignore */ }

    setSyncStatus('syncing');
    setSyncProgress(0);
    setSyncMessage('Starting sync...');
    setSyncedCount(0);
    setEtaInvoices([]);

    try {
      const resp = await fetch(appendOrgScope(`${API_URL}/eta/sync/start`), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        }
      });
      const data = await resp.json();
      if (!data.success) {
        setSyncStatus('error');
        setSyncMessage(data.message || 'Failed to start sync');
        return;
      }

      // Start polling for progress
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(async () => {
        try {
          const statusResp = await fetch(appendOrgScope(`${API_URL}/eta/sync/status`), {
            headers: {
              'Content-Type': 'application/json',
              ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
            }
          });
          const statusData = await statusResp.json();
          if (statusData.success) {
            setSyncProgress(statusData.progress || 0);
            setSyncMessage(statusData.message || '');
            setSyncedCount(statusData.syncedDocuments || 0);

            if (statusData.status === 'completed') {
              setSyncStatus('completed');
              if (pollRef.current) clearInterval(pollRef.current);
              fetchSyncedInvoices();
            } else if (statusData.status === 'error') {
              setSyncStatus('error');
              if (pollRef.current) clearInterval(pollRef.current);
            }
          }
        } catch (e) {
          console.error('[Settings] Sync poll error:', e);
        }
      }, 2000);

    } catch (e: any) {
      setSyncStatus('error');
      setSyncMessage(e.message || 'Failed to start sync');
    }
  };

  // Load properties from DB on mount, fallback to localStorage
  React.useEffect(() => {
    const loadSettings = async () => {
      try {
        const userStr = localStorage.getItem('invoice_user');
        const token = userStr ? JSON.parse(userStr).token : localStorage.getItem('token');

        if (token) {
          const response = await fetch(appendOrgScope(`${DEFAULT_API_URL}/settings/load`), {
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
          });
          const data = await response.json();

          if (data.success && data.properties && data.properties.length > 0) {
            setProperties(data.properties);
            localStorage.setItem('user_properties', JSON.stringify(data.properties));
            console.log('[Settings] Loaded', data.properties.length, 'properties from DB');

            const envProp = data.properties.find((p: any) => p.property_name.toLowerCase() === 'signer_environment_type');
            if (envProp) setEnvironmentType(envProp.property_value || 'Prod');
            const fmtProp = data.properties.find((p: any) => p.property_name.toLowerCase() === 'eta_submit_format');
            if (fmtProp && (fmtProp.property_value === 'JSON' || fmtProp.property_value === 'XML')) {
              setSubmitFormat(fmtProp.property_value);
            }
            const erpProp = data.properties.find((p: any) => p.property_name.toLowerCase() === 'selected_erp');
            if (erpProp?.property_value) setSelectedErp(erpProp.property_value);
            return;
          }
        }
      } catch (e) {
        console.warn('[Settings] API load failed, using localStorage fallback:', e);
      }

      // Fallback: load from localStorage
      const storedProps = localStorage.getItem('user_properties');
      if (storedProps) {
        try {
          const props = JSON.parse(storedProps);
          setProperties(props);
          const envProp = props.find((p: any) => p.property_name.toLowerCase() === 'signer_environment_type'.toLowerCase());
          if (envProp) setEnvironmentType(envProp.property_value || 'Prod');
          const erpProp = props.find((p: any) => p.property_name.toLowerCase() === 'selected_erp');
          if (erpProp?.property_value) setSelectedErp(erpProp.property_value);
        } catch (e) {
          console.error('Failed to parse properties', e);
        }
      }
    };

    loadSettings();
  }, []);

  // ── Auto-sync settings loader ──
  const loadAutoSync = useCallback(async () => {
    setAutoSyncLoading(true);
    try {
      const userStr = localStorage.getItem('invoice_user');
      const token = userStr ? JSON.parse(userStr).token : localStorage.getItem('token');
      const r = await fetch(`${DEFAULT_API_URL}/admin/organization/eta-autosync`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const d = await r.json();
      if (d.success && d.autosync) {
        setAutoSyncMode(d.autosync.mode || 'off');
        setAutoSyncInterval(Number(d.autosync.intervalMinutes) || 60);
        setAutoSyncTimes(Array.isArray(d.autosync.times) ? d.autosync.times : []);
        setAutoSyncLastRun(d.autosync.lastRunAt || null);
      }
      if (d.success && d.notifications) {
        setNotifyDailyDigest(d.notifications.dailyDigest !== false);
        setNotifyRecipientEmail(d.notifications.recipientEmail || '');
        setNotifySenderEmail(d.notifications.senderEmail || null);
      }
    } catch (e: any) {
      console.warn('[AutoSync] load failed:', e.message);
    } finally {
      setAutoSyncLoading(false);
    }
  }, []);

  useEffect(() => { loadAutoSync(); }, [loadAutoSync]);

  // ── Scheduled Reports — load / save / send-now ────────────────────────
  const loadScheduledReports = useCallback(async () => {
    setReportsLoading(true);
    try {
      const userStr = localStorage.getItem('invoice_user');
      const token = userStr ? JSON.parse(userStr).token : localStorage.getItem('token');
      const r = await fetch(`${DEFAULT_API_URL}/admin/scheduled-reports`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const d = await r.json();
      if (d.success && Array.isArray(d.reports)) {
        setScheduledReports(d.reports);
      }
    } catch (e: any) {
      console.warn('[ScheduledReports] load failed:', e.message);
    } finally {
      setReportsLoading(false);
    }
  }, []);

  // ── Edit (local only) ────────────────────────────────────────────────
  // Every input change updates state in-place and marks the row dirty.
  // No network call until the user clicks Save on that row. Trade-off:
  // navigating away discards pending edits — we surface that with a tiny
  // "unsaved" badge so the user notices.
  //
  // Single-active-report invariant: when the user enables a row, we
  // optimistically flip every other row OFF (and mark them dirty too) so
  // the UI reflects the constraint that the backend will enforce on Save.
  // This matches the "only one scheduled email at a time" requirement.
  const editScheduledReport = useCallback((
    reportId: string,
    patch: Partial<{
      enabled: boolean; frequency: 'daily' | 'weekly' | 'monthly';
      dayOfWeek: number | null; dayOfMonth: number | null;
      timeHour: number; timeMinute: number;
      recipientEmail: string | null;
    }>
  ) => {
    const enablingThisOne = patch.enabled === true;

    setScheduledReports(prev => {
      // Find which rows would be auto-disabled so we can show a toast.
      const otherEnabled = enablingThisOne
        ? prev.filter(r => r.id !== reportId && r.enabled)
        : [];

      const next = prev.map(row => {
        if (row.id === reportId) return { ...row, ...patch };
        // When enabling this one, force-off everything else.
        if (enablingThisOne && row.enabled) return { ...row, enabled: false };
        return row;
      });

      // Single, friendly notice per toggle so the user understands why
      // their previously-enabled report just turned grey.
      if (otherEnabled.length > 0) {
        const labels = otherEnabled.map(r => r.label).join(', ');
        toast({
          title:    t('reports.singleActiveTitle'),
          message:  t('reports.singleActiveBody').replace('{names}', labels),
          tone:     'info',
        });
      }
      return next;
    });

    setDirtyReportIds(prev => {
      const next = new Set(prev);
      next.add(reportId);
      // Also mark any row we forced-off as dirty so the user knows to save.
      if (enablingThisOne) {
        for (const r of scheduledReports) {
          if (r.id !== reportId && r.enabled) next.add(r.id);
        }
      }
      return next;
    });
  }, [scheduledReports, t]);

  // ── Save (manual) ────────────────────────────────────────────────────
  // PUTs the current state of one report to the backend. Called from each
  // card's Save button — only enabled while the row is dirty.
  const saveScheduledReport = useCallback(async (reportId: string) => {
    const current = scheduledReports.find(r => r.id === reportId);
    if (!current) return;
    setReportSavingId(reportId);
    setReportMsg(null);
    try {
      const userStr = localStorage.getItem('invoice_user');
      const token = userStr ? JSON.parse(userStr).token : localStorage.getItem('token');
      const body = {
        enabled:        current.enabled,
        frequency:      current.frequency,
        dayOfWeek:      current.dayOfWeek,
        dayOfMonth:     current.dayOfMonth,
        timeHour:       current.timeHour,
        timeMinute:     current.timeMinute,
        recipientEmail: current.recipientEmail?.trim() || null,
      };
      const r = await fetch(`${DEFAULT_API_URL}/admin/scheduled-reports/${reportId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!r.ok || !d.success) throw new Error(d.message || 'Save failed');
      // Drop the dirty flag for this id.
      setDirtyReportIds(prev => {
        if (!prev.has(reportId)) return prev;
        const next = new Set(prev);
        next.delete(reportId);
        return next;
      });
      toast({ title: t('reports.savedOk'), message: '', tone: 'success' });
    } catch (e: any) {
      toast({ title: t('reports.sendFailed'), message: e.message, tone: 'danger', durationMs: 5000 });
    } finally {
      setReportSavingId(null);
    }
  }, [scheduledReports, t]);

  // Fire one report immediately (skips cooldown, doesn't move last_sent_at).
  const sendScheduledReportNow = useCallback(async (reportId: string) => {
    setReportSendingId(reportId);
    setReportMsg(null);
    try {
      const userStr = localStorage.getItem('invoice_user');
      const token = userStr ? JSON.parse(userStr).token : localStorage.getItem('token');
      const r = await fetch(`${DEFAULT_API_URL}/admin/scheduled-reports/${reportId}/send-now`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      });
      const d = await r.json();
      if (!r.ok || !d.success) throw new Error(d.message || 'Send failed');
      // Map backend status into a user-facing toast. Each branch picks a tone
      // so the icon + colour matches what happened (sent = success, skipped =
      // info, failed = danger). Errors stay on screen longer (5s) since the
      // message often includes a long SMTP hint.
      if (d.status === 'sent') {
        toast({ title: t('reports.sentTo'), message: d.recipient || '', tone: 'success' });
      } else if (d.status === 'sent_empty') {
        // "Send now" with no data in the window — backend still emails an all-clear note
        // so the admin can verify the SMTP path. Show a friendly success toast that names
        // what was found (or rather, wasn't).
        toast({
          title: 'All-clear email sent',
          message: `${d.recipient || ''} — ${d.message || 'Nothing to report in this window.'}`,
          tone: 'success',
          durationMs: 6000,
        });
      } else if (d.status === 'skipped') {
        toast({ title: t('reports.skipped'), message: d.message || '', tone: 'info' });
      } else if (d.status === 'no_recipient') {
        toast({ title: t('reports.noRecipient'), message: '', tone: 'warning' });
      } else {
        toast({ title: t('reports.sendFailed'), message: d.message || '', tone: 'danger', durationMs: 6000 });
      }
    } catch (e: any) {
      toast({ title: t('reports.sendFailed'), message: e.message, tone: 'danger', durationMs: 5000 });
    } finally {
      setReportSendingId(null);
    }
  }, [t]);

  // Load when the tab opens (cheap — small payload).
  useEffect(() => {
    if (activeTab === 'reports') loadScheduledReports();
  }, [activeTab, loadScheduledReports]);

  // ── API Keys CRUD ──
  const loadApiKeys = useCallback(async () => {
    setApiKeysLoading(true);
    setApiKeyError(null);
    try {
      const userStr = localStorage.getItem('invoice_user');
      const token = userStr ? JSON.parse(userStr).token : localStorage.getItem('token');
      const r = await fetch(`${DEFAULT_API_URL}/admin/api-keys`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const d = await r.json();
      if (!r.ok || !d.success) throw new Error(d.message || `HTTP ${r.status}`);
      setApiKeys(d.rows || []);
    } catch (e: any) {
      setApiKeyError(e.message);
    } finally {
      setApiKeysLoading(false);
    }
  }, []);

  const createApiKey = async () => {
    setApiKeyError(null);
    try {
      if (!newKeyName.trim()) { setApiKeyError('Name is required.'); return; }
      const userStr = localStorage.getItem('invoice_user');
      const token = userStr ? JSON.parse(userStr).token : localStorage.getItem('token');
      const r = await fetch(`${DEFAULT_API_URL}/admin/api-keys`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({
          name: newKeyName.trim(),
          scope: newKeyScope,
          expiresAt: newKeyExpires || undefined,
          // Empty string = use server default (60). Send the parsed number otherwise.
          rateLimitPerMin: newKeyRateLimit.trim() === '' ? undefined : Number(newKeyRateLimit),
        }),
      });
      const d = await r.json();
      if (!r.ok || !d.success) throw new Error(d.message || `HTTP ${r.status}`);
      setJustCreatedKey(d.key);
      setKeyCopied(false);
      setNewKeyName('');
      setNewKeyExpires('');
      setNewKeyScope('read');
      setNewKeyRateLimit('');
      await loadApiKeys();
    } catch (e: any) {
      setApiKeyError(e.message);
    }
  };

  const revokeApiKey = async (id: number) => {
    const ok = await confirmDialog({
      title: 'Revoke API key',
      message: 'Revoke this key?\n\nAny integrations using it will stop working immediately.',
      confirmLabel: 'Revoke',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      const userStr = localStorage.getItem('invoice_user');
      const token = userStr ? JSON.parse(userStr).token : localStorage.getItem('token');
      const r = await fetch(`${DEFAULT_API_URL}/admin/api-keys/${id}`, {
        method: 'DELETE',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const d = await r.json();
      if (!r.ok || !d.success) throw new Error(d.message || `HTTP ${r.status}`);
      await loadApiKeys();
    } catch (e: any) {
      setApiKeyError(e.message);
    }
  };

  // Adjust an existing key's per-minute rate limit. Empty string clears it
  // (server-side default 60 applies). 0 → unlimited.
  const updateApiKeyRateLimit = async (id: number, current: number | null | undefined) => {
    const currentStr = current === null || current === undefined ? '' : String(current);
    const input = window.prompt(
      `Rate limit for this key (requests per minute):\n` +
      `• Leave blank to use the server default (60)\n` +
      `• 0 means unlimited\n` +
      `• Max 100,000`,
      currentStr
    );
    if (input === null) return; // user cancelled
    const trimmed = input.trim();
    let payload: { rateLimitPerMin: number | null } = { rateLimitPerMin: null };
    if (trimmed !== '') {
      const n = parseInt(trimmed, 10);
      if (isNaN(n) || n < 0 || n > 100000) {
        await alertDialog({ title: 'Invalid rate limit', message: 'Rate limit must be a number between 0 and 100000.', tone: 'warning' });
        return;
      }
      payload = { rateLimitPerMin: n };
    }
    try {
      const userStr = localStorage.getItem('invoice_user');
      const token = userStr ? JSON.parse(userStr).token : localStorage.getItem('token');
      const r = await fetch(`${DEFAULT_API_URL}/admin/api-keys/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(payload),
      });
      const d = await r.json();
      if (!r.ok || !d.success) throw new Error(d.message || `HTTP ${r.status}`);
      await loadApiKeys();
    } catch (e: any) {
      setApiKeyError(e.message);
    }
  };

  // Load API keys on first visit to the apikeys tab; clear the "just created"
  // copy-this-now banner whenever the user navigates elsewhere.
  useEffect(() => {
    if (activeTab === 'apikeys') loadApiKeys();
    else setJustCreatedKey(null);
  }, [activeTab, loadApiKeys]);

  // ── Webhooks state ──
  // Live list of subscriptions plus the "just created/rotated" secret banner
  // (server only emits the cleartext secret once — same UX as API keys).
  const [webhooks, setWebhooks] = useState<any[]>([]);
  const [webhooksLoading, setWebhooksLoading] = useState(false);
  const [webhooksError, setWebhooksError] = useState<string | null>(null);
  const [webhooksSupportedEvents, setWebhooksSupportedEvents] = useState<string[]>([]);
  const [justCreatedSecret, setJustCreatedSecret] = useState<string | null>(null);
  const [secretCopied, setSecretCopied] = useState(false);
  // Create-form fields
  const [newWhUrl, setNewWhUrl] = useState('');
  const [newWhDescription, setNewWhDescription] = useState('');
  const [newWhEvents, setNewWhEvents] = useState<string[]>([]); // empty = all
  // Per-row state for rotate-secret (which row is showing the password input)
  const [rotateForId, setRotateForId] = useState<number | null>(null);
  const [rotatePassword, setRotatePassword] = useState('');
  // Delivery log drawer
  const [logSubId, setLogSubId] = useState<number | null>(null);
  const [logRows, setLogRows] = useState<any[]>([]);
  const [logLoading, setLogLoading] = useState(false);

  const loadWebhooks = useCallback(async () => {
    setWebhooksLoading(true);
    setWebhooksError(null);
    try {
      const userStr = localStorage.getItem('invoice_user');
      const token = userStr ? JSON.parse(userStr).token : localStorage.getItem('token');
      const r = await fetch(`${DEFAULT_API_URL}/admin/webhooks`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const d = await r.json();
      if (!r.ok || !d.success) throw new Error(d.message || `HTTP ${r.status}`);
      setWebhooks(d.rows || []);
      setWebhooksSupportedEvents(d.supportedEvents || []);
    } catch (e: any) {
      setWebhooksError(e.message);
    } finally {
      setWebhooksLoading(false);
    }
  }, []);

  const createWebhook = async () => {
    setWebhooksError(null);
    try {
      const url = newWhUrl.trim();
      if (!url || !/^https?:\/\//.test(url)) {
        setWebhooksError(t('wh.urlMustStart'));
        return;
      }
      const userStr = localStorage.getItem('invoice_user');
      const token = userStr ? JSON.parse(userStr).token : localStorage.getItem('token');
      const r = await fetch(`${DEFAULT_API_URL}/admin/webhooks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({
          url,
          events: newWhEvents,
          description: newWhDescription.trim() || undefined,
        }),
      });
      const d = await r.json();
      if (!r.ok || !d.success) throw new Error(d.message || `HTTP ${r.status}`);
      setJustCreatedSecret(d.signingSecret);
      setSecretCopied(false);
      setNewWhUrl('');
      setNewWhDescription('');
      setNewWhEvents([]);
      await loadWebhooks();
    } catch (e: any) {
      setWebhooksError(e.message);
    }
  };

  const toggleWebhookActive = async (id: number, isActive: boolean) => {
    try {
      const userStr = localStorage.getItem('invoice_user');
      const token = userStr ? JSON.parse(userStr).token : localStorage.getItem('token');
      await fetch(`${DEFAULT_API_URL}/admin/webhooks/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ is_active: !isActive }),
      });
      await loadWebhooks();
    } catch (e: any) { setWebhooksError(e.message); }
  };

  const deleteWebhook = async (id: number) => {
    const ok = await confirmDialog({
      title: t('wh.confirmDelete'),
      message: t('wh.confirmDelete'),
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      const userStr = localStorage.getItem('invoice_user');
      const token = userStr ? JSON.parse(userStr).token : localStorage.getItem('token');
      await fetch(`${DEFAULT_API_URL}/admin/webhooks/${id}`, {
        method: 'DELETE',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      await loadWebhooks();
    } catch (e: any) { setWebhooksError(e.message); }
  };

  const rotateWebhookSecret = async (id: number) => {
    setWebhooksError(null);
    try {
      const userStr = localStorage.getItem('invoice_user');
      const token = userStr ? JSON.parse(userStr).token : localStorage.getItem('token');
      const r = await fetch(`${DEFAULT_API_URL}/admin/webhooks/${id}/rotate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      });
      const d = await r.json();
      if (!r.ok || !d.success) throw new Error(d.message || `HTTP ${r.status}`);
      setJustCreatedSecret(d.signingSecret);
      setSecretCopied(false);
      setRotateForId(null);
      setRotatePassword('');
    } catch (e: any) { setWebhooksError(e.message); }
  };

  const testWebhook = async (id: number) => {
    setWebhooksError(null);
    try {
      const userStr = localStorage.getItem('invoice_user');
      const token = userStr ? JSON.parse(userStr).token : localStorage.getItem('token');
      const r = await fetch(`${DEFAULT_API_URL}/admin/webhooks/${id}/test`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const d = await r.json();
      if (!r.ok || !d.success) throw new Error(d.message || `HTTP ${r.status}`);
      await alertDialog({ title: t('wh.testQueued'), message: t('wh.testQueued'), tone: 'success' });
    } catch (e: any) { setWebhooksError(e.message); }
  };

  const openDeliveryLog = async (id: number) => {
    setLogSubId(id);
    setLogLoading(true);
    setLogRows([]);
    try {
      const userStr = localStorage.getItem('invoice_user');
      const token = userStr ? JSON.parse(userStr).token : localStorage.getItem('token');
      const r = await fetch(`${DEFAULT_API_URL}/admin/webhooks/${id}/deliveries?limit=100`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const d = await r.json();
      if (d.success) setLogRows(d.rows || []);
    } finally {
      setLogLoading(false);
    }
  };

  // Refresh on tab visit; clear the "just-created secret" banner when leaving.
  useEffect(() => {
    if (activeTab === 'webhooks') loadWebhooks();
    else setJustCreatedSecret(null);
  }, [activeTab, loadWebhooks]);

  const saveAutoSync = async () => {
    setAutoSyncSaving(true);
    setAutoSyncMsg(null);
    try {
      const userStr = localStorage.getItem('invoice_user');
      const token = userStr ? JSON.parse(userStr).token : localStorage.getItem('token');
      const body: any = {
        eta_sync_mode: autoSyncMode,
        notify_daily_digest: notifyDailyDigest,
      };
      if (autoSyncMode === 'interval') body.eta_sync_interval = autoSyncInterval;
      if (autoSyncMode === 'times') body.eta_sync_times = autoSyncTimes;
      const r = await fetch(`${DEFAULT_API_URL}/admin/organization/eta-settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!r.ok || !d.success) throw new Error(d.message || 'Save failed');
      setAutoSyncMsg({ kind: 'ok', text: 'Auto-sync settings saved.' });
      await loadAutoSync();
    } catch (e: any) {
      setAutoSyncMsg({ kind: 'err', text: e.message });
    } finally {
      setAutoSyncSaving(false);
    }
  };

  // Trigger a one-shot sync immediately, regardless of the configured schedule.
  // Useful as a smoke test after editing ETA credentials or after enabling
  // the scheduler for the first time — the user shouldn't have to wait up to
  // 60 minutes to see whether the wiring works.
  const runSyncNow = async () => {
    setAutoSyncSaving(true);
    setAutoSyncMsg(null);
    try {
      const userStr = localStorage.getItem('invoice_user');
      const token = userStr ? JSON.parse(userStr).token : localStorage.getItem('token');
      const r = await fetch(`${DEFAULT_API_URL}/admin/autosync/run-now`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      });
      const d = await r.json();
      if (!r.ok || !d.success) {
        const hint = d.hint ? ` — ${d.hint}` : '';
        throw new Error(`${d.message || 'Run failed'}${hint}`);
      }
      setAutoSyncMsg({ kind: 'ok', text: d.message || 'Sync started.' });
      await loadAutoSync();
    } catch (e: any) {
      setAutoSyncMsg({ kind: 'err', text: e.message });
    } finally {
      setAutoSyncSaving(false);
    }
  };

  // Load org data from user session for Company Info defaults
  const getOrgData = () => {
    try {
      const userStr = localStorage.getItem('invoice_user');
      if (userStr) {
        const user = JSON.parse(userStr);
        return user.organization || {};
      }
    } catch { }
    return {};
  };
  const orgData = getOrgData();

  // Helper to get property value by name
  const getProp = (name: string, fallback: string = '') => {
    const prop = properties.find(p => p.property_name.toLowerCase() === name.toLowerCase());
    return prop ? prop.property_value : fallback;
  };

  const tabs = [
    { id: 'compinfo',      label: t('settings.companyInfo'),    icon: <Building size={18} /> },
    { id: 'tokensign',     label: t('settings.tokenSignature'), icon: <Key size={18} /> },
    { id: 'otaxconn',      label: t('settings.otaxConnection'), icon: <Link size={18} /> },
    { id: 'autosync',      label: t('settings.autoSync'),       icon: <Repeat size={18} /> },
    { id: 'notifications', label: t('settings.notifications'),  icon: <Bell size={18} /> },
    { id: 'reports',       label: t('settings.scheduledReports'), icon: <FileSpreadsheet size={18} /> },
    { id: 'exportrules',   label: t('settings.exportRules'),    icon: <FileCode size={18} /> },
    { id: 'erpserver',     label: t('settings.erpServer'),      icon: <HardDrive size={18} /> },
    { id: 'logdb',         label: t('settings.logDatabases'),   icon: <Database size={18} /> },
    { id: 'branches',      label: t('settings.branches'),       icon: <Building size={18} /> },
    { id: 'apikeys',       label: t('settings.apiKeys'),        icon: <KeyRound size={18} /> },
    { id: 'webhooks',      label: t('settings.webhooks'),       icon: <Webhook size={18} /> },
    { id: 'security',      label: t('settings.security'),       icon: <ShieldCheck size={18} /> },
    { id: 'compliance',    label: t('settings.compliance'),     icon: <Shield size={18} /> },
  ];

  const [selectedCountry] = useState(localStorage.getItem('selected_country') || getProp('issuer_country', 'EG'));


  const erpSystems = [
    { id: 'oracle', label: 'Oracle Data Source', type: 'db', icon: <Database size={16} /> },
    { id: 'mssql', label: 'Microsoft SQL Server', type: 'db', icon: <Database size={16} /> },
    { id: 'sap_hana', label: 'SAP Hana (Service Layer)', type: 'api', icon: <Globe2 size={16} /> },
    { id: 'sap_b1', label: 'SAP Business One (DI-API)', type: 'db', icon: <Layers size={16} /> },
    { id: 'odoo', label: 'Odoo (XML-RPC / API)', type: 'api', icon: <Globe2 size={16} /> },
    { id: 'dynamics_bc', label: 'MS Dynamics 365 Business Central', type: 'api', icon: <Globe2 size={16} /> },
    { id: 'dynamics_ax', label: 'MS Dynamics AX / F&O', type: 'api', icon: <Globe2 size={16} /> },
    { id: 'postgresql', label: 'PostgreSQL', type: 'db', icon: <Database size={16} /> },
    { id: 'mysql', label: 'MySQL / MariaDB', type: 'db', icon: <Database size={16} /> },
    { id: 'sage', label: 'Sage 50 / 300', type: 'db', icon: <Layers size={16} /> },
    { id: 'tally', label: 'Tally Prime', type: 'api', icon: <Globe2 size={16} /> },
    { id: 'excel', label: 'Excel / CSV Folder Watcher', type: 'file', icon: <FolderOpen size={16} /> },
    { id: 'custom_api', label: 'Custom JSON API (Push/Pull)', type: 'api', icon: <Globe2 size={16} /> },
  ];

  const handleTestConnection = () => {
    setIsTesting(true);
    setTestResult(null);
    setTimeout(() => {
      setIsTesting(false);
      setTestResult('success');
    }, 2000);
  };

  const [testingConnection, setTestingConnection] = useState<'PreProd' | 'Prod' | null>(null);

  const testConnection = async (env: 'PreProd' | 'Prod') => {
    setTestingConnection(env);
    try {
      // Get values directly from inputs to test unsaved changes
      const clientIdName = env === 'Prod' ? 'signer_prodClientId' : 'signer_preProdClientId';
      const clientSecretName = env === 'Prod' ? 'signer_prodClientSecret' : 'signer_preProdClientSecret';

      const clientIdInput = document.getElementsByName(clientIdName)[0] as HTMLInputElement;
      const clientSecretInput = document.getElementsByName(clientSecretName)[0] as HTMLInputElement;

      const clientId = clientIdInput?.value;
      const clientSecret = clientSecretInput?.value;

      if (!clientId || !clientSecret) {
        await alertDialog({ title: 'Missing credentials', message: 'Please enter Client ID and Client Secret first.', tone: 'warning' });
        setTestingConnection(null);
        return;
      }

      // First save the credentials to organization_settings so the new ETAService can use them
      const userStr = localStorage.getItem('invoice_user');
      const token = userStr ? JSON.parse(userStr).token : null;
      const API_URL = DEFAULT_API_URL;

      // Quick-save credentials to org settings before testing
      await fetch(appendOrgScope(`${API_URL}/admin/organization/eta-settings`), {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          eta_environment: env,
          [`eta_${env.toLowerCase()}_client_id`]: clientId,
          [`eta_${env.toLowerCase()}_client_secret`]: clientSecret,
        })
      }).catch(() => { /* ignore if endpoint not ready yet */ });

      // Test using the new org-aware endpoint (falls back to old endpoint)
      let response;
      try {
        response = await fetch(`${API_URL}/eta/test-connection`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ clientId, clientSecret, env }),
        });
      } catch {
        // Fallback to old endpoint if new one fails
        response = await fetch(`${API_URL}/test-credentials`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ clientId, clientSecret, env })
        });
      }

      const result = await response.json();
      if (result.success) {
        setDialogType('success');
        setDialogTitle(`${env} Connection Successful!`);
        setDialogMessage('Token retrieved successfully.');
        setIsDialogOpen(true);
      } else {
        setDialogType('error');
        setDialogTitle(`${env} Connection Failed`);
        setDialogMessage(`${result.message}\n${result.details ? JSON.stringify(result.details) : ''}`);
        setIsDialogOpen(true);
      }

    } catch (e: any) {
      setDialogType('error');
      setDialogTitle('Connection Error');
      setDialogMessage(e.message);
      setIsDialogOpen(true);
    } finally {
      setTestingConnection(null);
    }
  };

  const [dbTestResult, setDbTestResult] = useState<{ section: string, message: string, success: boolean } | null>(null);
  const [dbIsTesting, setDbIsTesting] = useState<string | null>(null);

  const testDbConnection = async (type: 'postgres' | 'oracle', section: 'main' | 'secondary' | 'erp') => {
    setDbIsTesting(section);
    setDbTestResult(null);

    try {
      let payload: any = { type };

      if (section === 'main') {
        const hostInput = document.getElementsByName('log_ServerHost')[0] as HTMLInputElement;
        const portInput = document.getElementsByName('log_ServerPort')[0] as HTMLInputElement;
        const dbInput = document.getElementsByName('log_ServerDB')[0] as HTMLInputElement;
        const userInput = document.getElementsByName('log_ServerUser')[0] as HTMLInputElement;
        const passInput = document.getElementsByName('log_ServerPass')[0] as HTMLInputElement;

        payload.host = hostInput?.value || 'localhost';
        payload.port = parseInt(portInput?.value || '5432');
        payload.database = dbInput?.value;
        payload.user = userInput?.value;
        payload.password = passInput?.value;
      } else {
        // ERP / Secondary Section
        const hostInput = document.getElementsByName('invoices_Server')[0] as HTMLInputElement;
        const dbInput = document.getElementsByName('invoices_ServerDB')[0] as HTMLInputElement;
        payload.host = hostInput?.value;
        payload.database = dbInput?.value;
        // Also send port if extracted from host, logic handled in backend currently for oracle string
      }

      const dbToken = localStorage.getItem('token');
      const response = await fetch(`${DEFAULT_API_URL}/test-db-connection`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(dbToken ? { 'Authorization': `Bearer ${dbToken}` } : {}),
        },
        body: JSON.stringify(payload)
      });

      const result = await response.json();
      setDbTestResult({ section, message: result.message, success: result.success });
      if (result.success) await alertDialog({ title: 'Connection successful', message: result.message, tone: 'success' });
      else await alertDialog({ title: 'Connection failed', message: result.message, tone: 'danger' });

    } catch (e: any) {
      await alertDialog({ title: 'Error', message: 'Error: ' + e.message, tone: 'danger' });
    } finally {
      setDbIsTesting(null);
    }


  };

  // Read the persisted logo on first mount + whenever properties refresh. The
  // load endpoint emits it as `issuer_logo_url` (data URL or null).
  useEffect(() => {
    const stored = getProp('issuer_logo_url');
    if (stored) setLogoUrl(stored);
  }, [properties]);

  // Read the picked file as a data URL and POST it to the org-logo endpoint.
  const onLogoFilePicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // reset so the same file can be re-picked
    if (!file) return;
    const MAX_BYTES = 200 * 1024;
    if (file.size > MAX_BYTES) {
      setLogoMsg(`✗ File is ${Math.round(file.size / 1024)} KB — max ${MAX_BYTES / 1024} KB.`);
      return;
    }
    setLogoUploading(true);
    setLogoMsg(null);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result || ''));
        r.onerror = () => reject(new Error('Could not read file'));
        r.readAsDataURL(file);
      });
      const userStr = localStorage.getItem('invoice_user');
      const token = userStr ? JSON.parse(userStr).token : null;
      const res = await fetch(`${DEFAULT_API_URL}/admin/organization/logo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ dataUrl }),
      });
      const d = await res.json();
      if (!res.ok || !d.success) throw new Error(d.message || `HTTP ${res.status}`);
      setLogoUrl(d.logoUrl);
      setLogoMsg('✓ Saved');
      setTimeout(() => setLogoMsg(null), 2500);
    } catch (err: any) {
      setLogoMsg(`✗ ${err.message || 'Upload failed'}`);
    } finally {
      setLogoUploading(false);
    }
  };

  const onClearLogo = async () => {
    const ok = await confirmDialog({
      title: 'Remove logo',
      message: 'Remove the organization logo?',
      confirmLabel: 'Remove',
      tone: 'warning',
    });
    if (!ok) return;
    setLogoUploading(true);
    setLogoMsg(null);
    try {
      const userStr = localStorage.getItem('invoice_user');
      const token = userStr ? JSON.parse(userStr).token : null;
      const res = await fetch(`${DEFAULT_API_URL}/admin/organization/logo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ dataUrl: null }),
      });
      const d = await res.json();
      if (!res.ok || !d.success) throw new Error(d.message || `HTTP ${res.status}`);
      setLogoUrl(null);
      setLogoMsg('✓ Cleared');
      setTimeout(() => setLogoMsg(null), 2500);
    } catch (err: any) {
      setLogoMsg(`✗ ${err.message || 'Failed'}`);
    } finally {
      setLogoUploading(false);
    }
  };

  // Fetches the actual cleartext stored on the server for a single secret field.
  // Used by the eye icon on Client Secret / ERP password / etc. so the admin can
  // verify that what they saved is what's actually persisted in the DB.
  const revealSecret = async (name: string): Promise<string | null> => {
    try {
      const userStr = localStorage.getItem('invoice_user');
      const token = userStr ? JSON.parse(userStr).token : localStorage.getItem('token');
      if (!token) return null;
      const res = await fetch(
        appendOrgScope(`${DEFAULT_API_URL}/settings/reveal-secret?name=${encodeURIComponent(name)}`),
        { headers: { 'Authorization': `Bearer ${token}` } }
      );
      const data = await res.json();
      if (!data?.success) return null;
      return data.empty ? '' : (data.value || '');
    } catch (e) {
      console.warn('[Settings] revealSecret failed:', e);
      return null;
    }
  };

  const handleSaveAll = async () => {
    setIsSaving(true);
    setSaveNotification(null);

    try {
      // Get current user ID from localStorage
      const userData = localStorage.getItem('invoice_user');
      if (!userData) {
        throw new Error('User not logged in');
      }

      const user = JSON.parse(userData);
      const userId = user.id;

      // Collect all input and select elements
      const inputs = document.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input, select, textarea');
      const collected: any = {};

      inputs.forEach(input => {
        if (input.name || input.id) {
          const key = input.name || input.id;
          if (input.type === 'checkbox') {
            collected[key] = (input as HTMLInputElement).checked;
          } else {
            collected[key] = input.value;
          }
        }
      });

      console.log('Collected settings:', collected);

      const token = user.token || localStorage.getItem('token');

      // Send to backend API
      const API_URL = DEFAULT_API_URL;
      const response = await fetch(appendOrgScope(`${API_URL}/settings/save`), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          userId: userId,
          settings: collected
        })
      });

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.message || 'Failed to save to database');
      }

      // Re-fetch the authoritative server state instead of trusting the local merge.
      // If the server silently dropped any field (e.g. validation, type coercion, or
      // an unmapped property landing in the wrong table), the user sees the truth here
      // instead of a stale merge that "looks" saved.
      try {
        const loadRes = await fetch(appendOrgScope(`${API_URL}/settings/load`), {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        });
        const loadData = await loadRes.json();
        if (loadData?.success && Array.isArray(loadData.properties)) {
          localStorage.setItem('user_properties', JSON.stringify(loadData.properties));
          setProperties(loadData.properties);
          // Detect fields that the user typed but the server didn't echo back.
          // We only surface this for non-secret fields — empty strings (user clearing
          // a value) and bullet sentinels for secrets are deliberately not echoed.
          const echoed = new Set(loadData.properties.map((p: any) => p.property_name));
          const missing: string[] = [];
          for (const [name, value] of Object.entries(collected)) {
            if (value === '' || value === '••••••••') continue;
            if (name.toLowerCase().includes('secret') || name.toLowerCase().includes('password') || name.toLowerCase().endsWith('pwd') || name.toLowerCase().endsWith('pin')) continue;
            if (!echoed.has(name)) missing.push(name);
          }
          if (missing.length > 0) {
            console.warn('[Settings] Server did not echo these fields after save:', missing);
            toast({
              title: 'Some settings did not persist',
              message: `These fields didn't save: ${missing.slice(0, 4).join(', ')}${missing.length > 4 ? `, +${missing.length - 4} more` : ''}. Check the backend logs.`,
              tone: 'danger',
              durationMs: 8000,
            });
          }
        } else {
          // Fall back to the old local-merge so the UI doesn't lose state.
          const existingProps = JSON.parse(localStorage.getItem('user_properties') || '[]');
          const updatedProps = Object.keys(collected).map(key => ({ property_name: key, property_value: collected[key] }));
          const merged = [...existingProps];
          updatedProps.forEach(up => {
            const idx = merged.findIndex(m => m.property_name === up.property_name);
            if (idx >= 0) merged[idx] = up; else merged.push(up);
          });
          localStorage.setItem('user_properties', JSON.stringify(merged));
          setProperties(merged);
        }
      } catch (reloadErr) {
        console.warn('[Settings] Post-save reload failed, using local merge:', reloadErr);
      }

      // ETA credentials, environment, submit format, export rules, and the
      // company address are all routed to their proper org-scoped tables by
      // POST /api/settings/save above (see ORG_TABLE_FIELDS / ORG_SETTINGS_FIELDS
      // / ORG_INTEGRATION_FIELDS in server.ts). The duplicate PUT we used to do
      // here was wiping valid credentials whenever the form had bullet
      // placeholders for masked password fields - exactly what the new
      // placeholder protocol is designed to avoid. Do not reintroduce it.

      // Clear server cache to force re-sync with new environment
      try {
        const API_URL = DEFAULT_API_URL;
        await fetch(`${API_URL}/cache/clear`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-user-id': userId,
            ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
          }
        });
      } catch (e) {
        console.error('Failed to clear cache:', e);
      }

      // ── Scheduled Reports — flush every dirty card ────────────────────
      // The per-card Save button was removed per the customer's UX ask;
      // every Scheduled Reports edit now flows through this global "Save
      // All Changes" button. We POST each dirty row sequentially so the
      // backend's "single-active-report" guard runs in the right order.
      if (dirtyReportIds.size > 0) {
        const dirtyList = Array.from(dirtyReportIds);
        const API_URL = DEFAULT_API_URL;
        // Save the row that's being ENABLED first so the backend's
        // "force-off others when enabling" rule fires correctly. Otherwise
        // we'd save row B (off) before row A (on), and the off-by-default
        // race could leave nothing enabled at all.
        dirtyList.sort((a, b) => {
          const ra = scheduledReports.find(r => r.id === a);
          const rb = scheduledReports.find(r => r.id === b);
          return (rb?.enabled ? 1 : 0) - (ra?.enabled ? 1 : 0);
        });
        for (const reportId of dirtyList) {
          const cur = scheduledReports.find(r => r.id === reportId);
          if (!cur) continue;
          try {
            const r = await fetch(`${API_URL}/admin/scheduled-reports/${reportId}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
              body: JSON.stringify({
                enabled:        cur.enabled,
                frequency:      cur.frequency,
                dayOfWeek:      cur.dayOfWeek,
                dayOfMonth:     cur.dayOfMonth,
                timeHour:       cur.timeHour,
                timeMinute:     cur.timeMinute,
                recipientEmail: cur.recipientEmail?.trim() || null,
              }),
            });
            const d = await r.json();
            if (!r.ok || !d.success) {
              console.warn(`[Settings] failed to save report ${reportId}:`, d.message);
            }
          } catch (e: any) {
            console.warn(`[Settings] failed to save report ${reportId}:`, e.message);
          }
        }
        // Clear the dirty set — surviving toasts will be from per-row failures.
        setDirtyReportIds(new Set());
      }

      // Toast card (auto-dismissing top-right) replaces the broken-mojibake
      // inline banner that used to live here. The page still reloads in 2s.
      toast({ title: 'Settings saved', message: 'Reloading to apply changes…', tone: 'success' });

      // Reload page after 2 seconds to apply changes
      setTimeout(() => {
        window.location.reload();
      }, 2000);
    } catch (error: any) {
      console.error('Save error:', error);
      toast({ title: 'Save failed', message: error.message || 'Failed to save settings', tone: 'danger', durationMs: 5000 });
    } finally {
      setIsSaving(false);
    }
  };

  const renderContent = (tabId: string) => {
    switch (tabId) {
      case 'compinfo':
        return (
          <div className="space-y-8">
            <section className="space-y-4">
              <div className="flex items-center gap-2 text-slate-400 border-b border-gray-100 pb-2">
                <Building size={16} />
                <h4 className="text-xs font-bold uppercase tracking-wider">{t('compinfo.basicInfo')}</h4>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-500 uppercase">{t('compinfo.companyId')}</label>
                    <input name="issuer_id" type="text" className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none" key={getProp('issuer_id')} defaultValue={getProp('issuer_id', orgData.tax_id || '')} />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-500 uppercase">{t('compinfo.companyType')}</label>
                    <select name="user_type" className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2 text-sm outline-none" key={getProp('user_type')} defaultValue={getProp('user_type', orgData.company_type || 'B')}>
                      <option value="B">{t('compinfo.businessB')}</option>
                      <option value="P">{t('compinfo.personP')}</option>
                      <option value="operator">{t('compinfo.operator')}</option>
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-500 uppercase">{t('compinfo.companyName')}</label>
                    <input name="issuer_name" type="text" dir="rtl" className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none text-right font-bold" key={getProp('issuer_name')} defaultValue={getProp('issuer_name', orgData.name || '')} />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-500 uppercase">{t('compinfo.taxActivityCode')}</label>
                    <input name="tax_payer_activity_code" type="text" className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2 text-sm font-mono text-emerald-600 font-bold" key={getProp('tax_payer_activity_code')} defaultValue={getProp('tax_payer_activity_code', '')} placeholder="e.g. 6209" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-500 uppercase">{t('compinfo.userLanguage')}</label>
                    <select name="user_language" defaultValue={getProp('user_language', 'en')}
                      className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2 text-sm outline-none">
                      <option value="en">English</option>
                      <option value="ar">العربية</option>
                    </select>
                  </div>
                </div>
                <div className="flex flex-col items-center justify-center border-2 border-dashed border-gray-200 rounded-2xl p-4 bg-gray-50">
                  <div className="w-24 h-24 bg-white rounded-xl shadow-sm border border-gray-100 flex items-center justify-center mb-2 overflow-hidden text-slate-300">
                    {logoUrl ? (
                      <img src={logoUrl} alt="Logo" className="w-full h-full object-contain" />
                    ) : (
                      <ImageIcon size={32} />
                    )}
                  </div>
                  <input
                    ref={logoFileRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/svg+xml"
                    className="hidden"
                    onChange={onLogoFilePicked}
                  />
                  <div className="flex gap-2">
                    <button type="button" onClick={() => logoFileRef.current?.click()}
                      className="text-[10px] font-bold text-blue-600 hover:underline">
                      {logoUploading ? t('compinfo.uploading') : t('compinfo.changeLogo')}
                    </button>
                    {logoUrl && (
                      <button type="button" onClick={onClearLogo}
                        className="text-[10px] font-bold text-rose-500 hover:underline">
                        {t('compinfo.removeLogo')}
                      </button>
                    )}
                  </div>
                  {logoMsg && <div className={`mt-1 text-[9px] ${logoMsg.startsWith('✗') ? 'text-rose-600' : 'text-emerald-600'}`}>{logoMsg}</div>}
                </div>
              </div>
            </section>
            <section className="space-y-4">
              <div className="flex items-center gap-2 text-slate-400 border-b border-gray-100 pb-2">
                <Globe size={16} />
                <h4 className="text-xs font-bold uppercase tracking-wider">{t('compinfo.companyAddress')}</h4>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-400 uppercase">{t('compinfo.branchId')}</label>
                  <input name="issuer_branchId" type="text" className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2 text-sm" key={getProp('issuer_branchId')} defaultValue={getProp('issuer_branchId', '')} placeholder="0" />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-400 uppercase">{t('compinfo.country')}</label>
                  <input name="issuer_country" type="text" className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2 text-sm font-bold" key={getProp('issuer_country')} defaultValue={getProp('issuer_country', '')} placeholder="Egypt" />
                </div>
                <div className="space-y-1 md:col-span-2">
                  <label className="text-[10px] font-bold text-slate-400 uppercase">{t('compinfo.governorate')}</label>
                  <input name="issuer_governorate" type="text" className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2 text-sm" key={getProp('issuer_governorate')} defaultValue={getProp('issuer_governorate', '')} placeholder="Cairo" />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-400 uppercase">{t('compinfo.regionCity')}</label>
                  <input name="issuer_regionCity" type="text" className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2 text-sm" key={getProp('issuer_regionCity')} defaultValue={getProp('issuer_regionCity', '')} placeholder="0" />
                </div>
                <div className="space-y-1 md:col-span-2">
                  <label className="text-[10px] font-bold text-slate-400 uppercase">{t('compinfo.street')}</label>
                  <input name="issuer_street" type="text" dir="rtl" className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2 text-sm text-right" key={getProp('issuer_street')} defaultValue={getProp('issuer_street', '')} placeholder={t('compinfo.streetPlaceholder')} />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-400 uppercase">{t('compinfo.buildingNumber')}</label>
                  <input name="issuer_buildingNumber" type="text" className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2 text-sm font-bold" key={getProp('issuer_buildingNumber')} defaultValue={getProp('issuer_buildingNumber', '')} placeholder="0" />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-400 uppercase">{t('compinfo.postalCode')}</label>
                  <input name="issuer_postalCode" type="text" className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2 text-sm" key={getProp('issuer_postalCode')} defaultValue={getProp('issuer_postalCode', '')} placeholder="0" />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-400 uppercase">{t('compinfo.floor')}</label>
                  <input name="issuer_floor" type="text" className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2 text-sm" key={getProp('issuer_floor')} defaultValue={getProp('issuer_floor', '')} placeholder="0" />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-400 uppercase">{t('compinfo.room')}</label>
                  <input name="issuer_room" type="text" className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2 text-sm" key={getProp('issuer_room')} defaultValue={getProp('issuer_room', '')} placeholder="0" />
                </div>
                <div className="space-y-1 md:col-span-2">
                  <label className="text-[10px] font-bold text-slate-400 uppercase">{t('compinfo.landmark')}</label>
                  <input name="issuer_landmark" type="text" className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2 text-sm" key={getProp('issuer_landmark')} defaultValue={getProp('issuer_landmark', '')} placeholder={t('compinfo.landmarkPlaceholder')} />
                </div>
                <div className="space-y-1 md:col-span-2">
                  <label className="text-[10px] font-bold text-slate-400 uppercase">{t('compinfo.additionalInfo')}</label>
                  <input name="issuer_additionalInfo" type="text" className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2 text-sm" key={getProp('issuer_additionalInfo')} defaultValue={getProp('issuer_additionalInfo', '')} placeholder={t('compinfo.additionalInfoPlaceholder')} />
                </div>
              </div>
            </section>
          </div>
        );

      case 'tokensign':
        return <TokenSignatureSettings properties={properties} />;

      case 'otaxconn':
        return (
          <div className="space-y-8">
            <section className="space-y-6">
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <h4 className="text-sm font-bold text-slate-800">{t('otaxconn.envHeading')}</h4>
                  <p className="text-xs text-slate-500">{t('otaxconn.envSubtitle')}</p>
                </div>
                <select name="signer_environment_type" value={environmentType} onChange={(e) => setEnvironmentType(e.target.value)} className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-2 text-sm font-bold text-blue-600 outline-none cursor-pointer">
                  <option value="Prod">{t('otaxconn.envProd')}</option>
                  <option value="PreProd">{t('otaxconn.envPreProd')}</option>
                </select>
              </div>
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <h4 className="text-sm font-bold text-slate-800">{t('otaxconn.formatHeading')}</h4>
                  <p className="text-xs text-slate-500">{t('otaxconn.formatSubtitle')}</p>
                </div>
                <select name="eta_submit_format" value={submitFormat} onChange={(e) => setSubmitFormat(e.target.value as 'JSON' | 'XML')} className="bg-indigo-50 border border-indigo-200 rounded-xl px-4 py-2 text-sm font-bold text-indigo-600 outline-none cursor-pointer">
                  <option value="JSON">{t('otaxconn.formatJson')}</option>
                  <option value="XML">{t('otaxconn.formatXml')}</option>
                </select>
              </div>
              <div className="p-6 bg-slate-50 rounded-[32px] border border-gray-100 space-y-4">
                <div className="flex justify-between items-center">
                  <h5 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{t('otaxconn.preprodCreds')}</h5>
                  <button onClick={() => testConnection('PreProd')} className="text-xs bg-white border border-slate-200 hover:bg-slate-100 text-slate-600 px-3 py-1 rounded-lg font-bold transition-colors shadow-sm">
                    {testingConnection === 'PreProd' ? t('otaxconn.testing') : t('otaxconn.testConn')}
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-500 uppercase">{t('otaxconn.clientId')}</label>
                    <input name="signer_preProdClientId" type="text" autoComplete="off" data-lpignore="true" data-form-type="other" className="w-full bg-white border border-gray-200 rounded-xl px-4 py-2 text-sm" key={getProp('signer_preProdClientId')} defaultValue={getProp('signer_preProdClientId', '')} placeholder={t('otaxconn.preprodIdPh')} />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-500 uppercase">{t('otaxconn.clientSecret')}</label>
                    <SecretInput
                      name="signer_preProdClientSecret"
                      placeholder="••••••••"
                      autoComplete="new-password"
                      data-lpignore="true"
                      data-form-type="other"
                      className="w-full bg-white border border-gray-200 rounded-xl px-4 py-2 text-sm"
                      key={getProp('signer_preProdClientSecret')}
                      defaultValue={getProp('signer_preProdClientSecret', '')}
                      onReveal={() => revealSecret('signer_preProdClientSecret')}
                    />
                  </div>
                </div>
              </div>
              <div className="p-6 bg-blue-600 rounded-[32px] shadow-lg shadow-blue-100 space-y-4 text-white">
                <div className="flex justify-between items-center">
                  <h5 className="text-[10px] font-bold text-blue-200 uppercase tracking-widest">{t('otaxconn.prodCreds')}</h5>
                  <button onClick={() => testConnection('Prod')} className="text-xs bg-white/10 hover:bg-white/20 text-white border border-white/20 px-3 py-1 rounded-lg font-bold transition-colors">
                    {testingConnection === 'Prod' ? t('otaxconn.testing') : t('otaxconn.testConn')}
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-blue-100 uppercase">{t('otaxconn.clientId')}</label>
                    <input name="signer_prodClientId" type="text" autoComplete="off" data-lpignore="true" data-form-type="other" className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-2 text-sm text-white placeholder-white/40" key={getProp('signer_prodClientId')} defaultValue={getProp('signer_prodClientId', '')} placeholder={t('otaxconn.prodIdPh')} />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-blue-100 uppercase">{t('otaxconn.clientSecret')}</label>
                    <SecretInput
                      name="signer_prodClientSecret"
                      className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-2 text-sm text-white placeholder-white/40"
                      key={getProp('signer_prodClientSecret')}
                      defaultValue={getProp('signer_prodClientSecret', '')}
                      placeholder="••••••••"
                      autoComplete="new-password"
                      data-lpignore="true"
                      data-form-type="other"
                      onReveal={() => revealSecret('signer_prodClientSecret')}
                    />
                  </div>
                </div>
              </div>
            </section>
            {/* Sync has moved — point the user to the dedicated tab */}
            <section className="pt-4 border-t border-gray-100">
              <div className="p-4 bg-blue-50/60 border border-blue-100 rounded-2xl flex items-start gap-3">
                <Repeat size={18} className="text-blue-600 mt-0.5 shrink-0" />
                <div>
                  <div className="text-sm font-bold text-slate-800">{t('otaxconn.syncMovedTitle')}</div>
                  <p className="text-xs text-slate-600 mt-1">{t('otaxconn.syncMovedDesc')}</p>
                  <button type="button" onClick={() => navigate('/settings/autosync')}
                    className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-700">
                    {t('otaxconn.openAutoSync')}
                  </button>
                </div>
              </div>
            </section>
          </div>
        );

      case 'autosync': {
        const addTime = () => {
          if (autoSyncTimes.length >= 10) return;
          setAutoSyncTimes([...autoSyncTimes, '09:00']);
        };
        const updateTime = (idx: number, val: string) => {
          const next = [...autoSyncTimes]; next[idx] = val; setAutoSyncTimes(next);
        };
        const removeTime = (idx: number) => {
          setAutoSyncTimes(autoSyncTimes.filter((_, i) => i !== idx));
        };

        // Preview the next scheduled run so the user knows what they just set
        const previewNextRun = (() => {
          if (autoSyncMode === 'off') return t('autosync.intervalNever');
          const now = new Date();
          if (autoSyncMode === 'interval') {
            const last = autoSyncLastRun ? new Date(autoSyncLastRun) : null;
            const next = last
              ? new Date(last.getTime() + autoSyncInterval * 60_000)
              : new Date(now.getTime() + Math.min(60_000, autoSyncInterval * 60_000));
            return `≈ ${next.toLocaleString()} (${t('autosync.intervalEvery')} ${autoSyncInterval} ${t('autosync.intervalMin')})`;
          }
          const valid = autoSyncTimes.filter(tt => /^(\d{1,2}):(\d{2})$/.test(tt));
          if (valid.length === 0) return t('autosync.noTimesSet');
          // Find soonest upcoming time today or tomorrow
          const soonest = valid.map(tt => {
            const [h, m] = tt.split(':').map(Number);
            const d = new Date(now); d.setHours(h, m, 0, 0);
            if (d <= now) d.setDate(d.getDate() + 1);
            return d;
          }).sort((a, b) => a.getTime() - b.getTime())[0];
          return `${soonest.toLocaleString()}`;
        })();

        return (
          <div className="space-y-6">
            <section>
              <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2 mb-1">
                <Repeat size={20} className="text-blue-600" /> {t('autosync.title')}
              </h3>
              <p className="text-sm text-slate-500 max-w-2xl">{t('autosync.subtitle')}</p>
            </section>

            {autoSyncLoading ? (
              <div className="text-sm text-slate-400 flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> {t('common.loading')}</div>
            ) : (
              <>
                {/* Mode picker */}
                <section className="p-5 bg-white border border-gray-100 rounded-2xl">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wide">{t('autosync.scheduleMode')}</label>
                  <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3">
                    {([
                      { id: 'off', label: t('autosync.modeOff'), desc: t('autosync.modeOffDesc'), color: 'slate' },
                      { id: 'interval', label: t('autosync.modeInterval'), desc: t('autosync.modeIntervalDesc'), color: 'blue' },
                      { id: 'times', label: t('autosync.modeTimes'), desc: t('autosync.modeTimesDesc'), color: 'violet' },
                    ] as const).map(opt => (
                      <button key={opt.id} onClick={() => setAutoSyncMode(opt.id as any)}
                        className={`text-left p-4 rounded-xl border-2 transition-all ${
                          autoSyncMode === opt.id
                            ? `border-${opt.color}-500 bg-${opt.color}-50/50`
                            : 'border-gray-200 bg-white hover:border-gray-300'
                        }`}>
                        <div className={`font-bold text-sm ${autoSyncMode === opt.id ? `text-${opt.color}-700` : 'text-slate-700'}`}>{opt.label}</div>
                        <div className="text-xs text-slate-500 mt-1">{opt.desc}</div>
                      </button>
                    ))}
                  </div>
                </section>

                {/* Mode-specific fields */}
                {autoSyncMode === 'interval' && (
                  <section className="p-5 bg-white border border-gray-100 rounded-2xl">
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wide">{t('autosync.interval')}</label>
                    <div className="mt-3 grid grid-cols-3 md:grid-cols-6 gap-2">
                      {[15, 30, 60, 120, 240, 360].map(v => (
                        <button key={v} onClick={() => setAutoSyncInterval(v)}
                          className={`px-3 py-2 rounded-lg text-sm font-semibold border transition-all ${
                            autoSyncInterval === v
                              ? 'bg-blue-600 text-white border-blue-600'
                              : 'bg-white text-slate-600 border-gray-200 hover:border-blue-300'
                          }`}>
                          {v < 60 ? `${v} ${t('autosync.intervalMin')}` : `${v / 60} hr`}
                        </button>
                      ))}
                    </div>
                    <div className="mt-3 flex items-center gap-2">
                      <input type="number" min={5} max={1440} value={autoSyncInterval}
                        onChange={e => setAutoSyncInterval(Math.max(5, Math.min(1440, parseInt(e.target.value) || 60)))}
                        className="w-24 px-3 py-1.5 border border-gray-200 rounded-lg text-sm" />
                      <span className="text-xs text-slate-500">{t('autosync.intervalMin')} (5–1440)</span>
                    </div>
                  </section>
                )}

                {autoSyncMode === 'times' && (
                  <section className="p-5 bg-white border border-gray-100 rounded-2xl">
                    <div className="flex items-center justify-between mb-3">
                      <label className="text-xs font-bold text-slate-500 uppercase tracking-wide">{t('autosync.times')}</label>
                      <button onClick={addTime} disabled={autoSyncTimes.length >= 10}
                        className="flex items-center gap-1 px-3 py-1.5 bg-violet-600 text-white rounded-lg text-xs font-semibold hover:bg-violet-700 disabled:opacity-40">
                        <Plus size={12} /> {t('autosync.addTime')}
                      </button>
                    </div>
                    {autoSyncTimes.length === 0 && (
                      <div className="text-sm text-slate-400 py-6 text-center border border-dashed border-gray-200 rounded-lg">
                        {t('autosync.noTimesAdded')}
                      </div>
                    )}
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                      {autoSyncTimes.map((t, i) => (
                        <div key={i} className="flex items-center gap-1 p-2 border border-gray-200 rounded-lg">
                          <Timer size={14} className="text-violet-500 shrink-0" />
                          <input type="time" value={t} onChange={e => updateTime(i, e.target.value)}
                            className="flex-1 text-sm outline-none font-mono" />
                          <button onClick={() => removeTime(i)} className="p-1 text-red-500 hover:bg-red-50 rounded">
                            <Trash2 size={12} />
                          </button>
                        </div>
                      ))}
                    </div>
                    <p className="text-xs text-slate-400 mt-3">{t('autosync.scheduleHint')}</p>
                  </section>
                )}

                {/* Status + last run + next run preview */}
                <section className="p-5 bg-blue-50/50 border border-blue-100 rounded-2xl">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                    <div>
                      <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">{t('autosync.lastRun')}</div>
                      <div className="font-semibold text-slate-800">
                        {autoSyncLastRun ? new Date(autoSyncLastRun).toLocaleString() : t('autosync.never')}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">{t('autosync.nextRun')}</div>
                      <div className="font-semibold text-slate-800">{previewNextRun}</div>
                    </div>
                  </div>
                </section>

                {/* Save — notification prefs were moved to their own tab (Email Notifications). */}
                <div className="flex items-center gap-3 flex-wrap">
                  <button onClick={saveAutoSync} disabled={autoSyncSaving}
                    className="flex items-center gap-2 bg-emerald-600 text-white px-6 py-2.5 rounded-xl text-sm font-bold hover:bg-emerald-700 disabled:opacity-50">
                    {autoSyncSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} {t('autosync.saveSchedule')}
                  </button>
                  <button onClick={runSyncNow} disabled={autoSyncSaving}
                    title="Trigger an immediate sync, ignoring the configured schedule"
                    className="flex items-center gap-2 bg-blue-600 text-white px-5 py-2.5 rounded-xl text-sm font-bold hover:bg-blue-700 disabled:opacity-50">
                    <Zap size={14} /> {t('autosync.runNow')}
                  </button>
                  <button onClick={loadAutoSync} disabled={autoSyncLoading}
                    className="flex items-center gap-1 px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm font-semibold hover:bg-gray-50">
                    <RefreshCw size={14} /> {t('autosync.reload')}
                  </button>
                  {autoSyncMsg && autoSyncMsg.kind === 'ok' && (
                    <span className="text-sm text-emerald-600 flex items-center gap-1"><CheckCircle2 size={14} /> {autoSyncMsg.text}</span>
                  )}
                  {autoSyncMsg && autoSyncMsg.kind === 'err' && (
                    <span className="text-sm text-red-600 flex items-center gap-1"><AlertCircle size={14} /> {autoSyncMsg.text}</span>
                  )}
                </div>
              </>
            )}
          </div>
        );
      }

      case 'exportrules':
        return (
          <div className="space-y-8">
            <section className="space-y-6">
              <div className="flex items-center justify-between p-4 bg-gray-50 rounded-2xl">
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-800">{t('exportrules.dateFormat')}</label>
                  <p className="text-[10px] text-slate-500">{t('exportrules.dateFormatHint')}</p>
                </div>
                <input name="dateTimeIssued_Format" type="text" className="bg-white border border-gray-200 rounded-xl px-4 py-2 text-sm font-mono text-blue-600" key={getProp('dateTimeIssued_Format')} defaultValue={getProp('dateTimeIssued_Format', 'yyyy-MM-ddT06:00:00Z')} />
              </div>
              <div className="space-y-4 px-2">
                <div className="flex items-center gap-3">
                  <input name="export_autoConvertUtf8" type="checkbox" className="w-5 h-5 rounded-lg border-gray-300 text-blue-600"
                    key={getProp('export_autoConvertUtf8')}
                    defaultChecked={getProp('export_autoConvertUtf8', 'true') !== 'false'} />
                  <span className="text-sm font-semibold text-slate-700">{t('exportrules.autoUtf8')}</span>
                </div>
                <div className="flex items-center gap-3">
                  <input name="export_useOldFieldNames" type="checkbox" className="w-5 h-5 rounded-lg border-gray-300 text-blue-600"
                    key={getProp('export_useOldFieldNames')}
                    defaultChecked={getProp('export_useOldFieldNames', 'false') === 'true'} />
                  <span className="text-sm font-semibold text-slate-700">{t('exportrules.oldFieldNames')}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-blue-600">{t('exportrules.noOfDays')}</span>
                  <input name="export_noOfDays" type="number" className="w-20 bg-gray-50 border border-gray-200 rounded-xl px-3 py-1.5 text-sm" key={getProp('export_noOfDays')} defaultValue={getProp('export_noOfDays', '30')} />
                </div>
                <div className="flex items-center gap-3 pt-2 border-t border-gray-50">
                  <input name="export_replaceDateWithCurrent" type="checkbox" className="w-5 h-5 rounded-lg border-gray-300 text-blue-600"
                    key={getProp('export_replaceDateWithCurrent')}
                    defaultChecked={getProp('export_replaceDateWithCurrent', 'false') === 'true'} />
                  <span className="text-sm font-semibold text-slate-700">{t('exportrules.replaceWithCurrent')}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-blue-600">{t('exportrules.reduceHours')}</span>
                  <input name="export_reduceHours" type="number" className="w-20 bg-gray-50 border border-gray-200 rounded-xl px-3 py-1.5 text-sm" key={getProp('export_reduceHours')} defaultValue={getProp('export_reduceHours', '0')} />
                </div>
              </div>
            </section>
          </div>
        );



      case 'erpserver': {
        const currentErp = erpSystems.find(e => e.id === selectedErp);
        return (
          <div className="space-y-8">
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-slate-500 uppercase flex items-center gap-2">
                <Layers size={14} className="text-blue-500" /> {t('erp.systemType')}
              </label>
              <div className="relative group">
                <select name="selected_erp" value={selectedErp} onChange={(e) => setSelectedErp(e.target.value)} className="w-full bg-gray-50 border border-gray-200 rounded-[24px] px-6 py-4 text-sm font-bold text-slate-800 focus:ring-4 focus:ring-blue-100 outline-none appearance-none cursor-pointer">
                  {erpSystems.map(erp => (<option key={erp.id} value={erp.id}>{erp.label}</option>))}
                </select>
                <div className="absolute right-6 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400"><ChevronDown size={18} /></div>
              </div>
              <div className="px-4 py-2 bg-blue-50/50 rounded-xl border border-blue-100/50 flex items-center gap-2">
                {currentErp?.icon}
                <span className="text-[10px] font-bold text-blue-600 uppercase">
                  Driver Mode: {currentErp?.type === 'db' ? 'Direct Database Connection' : currentErp?.type === 'api' ? 'REST/Web API Integration' : 'FileSystem Watcher'}
                </span>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 p-8 bg-gray-50/30 rounded-[32px] border border-gray-100 shadow-inner">
              {currentErp?.type === 'db' || currentErp?.type === 'api' ? (
                <>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-400 uppercase">{t('erp.dbHost')}</label>
                    <div className="relative">
                      {currentErp.type === 'db' ? <Server size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" /> : <Globe2 size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" />}
                      <input name="invoices_Server" type="text" autoComplete="off" data-lpignore="true" data-form-type="other" className="w-full bg-white border border-gray-200 rounded-xl pl-10 pr-4 py-2 text-sm font-mono text-blue-600 focus:ring-2 focus:ring-blue-500 outline-none" key={getProp('invoices_Server')} defaultValue={getProp('invoices_Server', '')} placeholder="localhost:1521" />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-400 uppercase">{t('erp.dbName')}</label>
                    <input name="invoices_ServerDB" type="text" autoComplete="off" data-lpignore="true" data-form-type="other" className="w-full bg-white border border-gray-200 rounded-xl px-4 py-2 text-sm font-mono text-blue-600" key={getProp('invoices_ServerDB')} defaultValue={getProp('invoices_ServerDB', '')} />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-400 uppercase">{t('erp.dbUser')}</label>
                    <input name="invoices_ServerUID" type="text" autoComplete="off" data-lpignore="true" data-form-type="other" className="w-full bg-white border border-gray-200 rounded-xl px-4 py-2 text-sm" key={getProp('invoices_ServerUID')} defaultValue={getProp('invoices_ServerUID', '')} />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-400 uppercase">{t('erp.dbPass')}</label>
                    <SecretInput
                      name="invoices_ServerPWD"
                      placeholder="••••••••"
                      autoComplete="new-password"
                      data-lpignore="true"
                      data-form-type="other"
                      className="w-full bg-white border border-gray-200 rounded-xl px-4 py-2 text-sm"
                      key={getProp('invoices_ServerPWD')}
                      defaultValue={getProp('invoices_ServerPWD', '')}
                      onReveal={() => revealSecret('invoices_ServerPWD')}
                    />
                  </div>
                </>
              ) : (
                <div className="col-span-2 p-6 bg-white border border-dashed border-gray-200 rounded-2xl flex flex-col items-center justify-center text-center gap-2">
                  <FolderOpen size={32} className="text-slate-300" />
                  <p className="text-sm font-bold text-slate-600">CSV/Excel Monitor Active</p>
                  <p className="text-xs text-slate-400">{"The system will watch the source directory defined in \"File Locations\" for new incoming invoices."}</p>
                </div>
              )}
            </div>
            <div className="space-y-4 pt-6 border-t border-gray-100">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <label className="text-sm font-bold text-slate-600">Export Invoices Related To Legal Entity</label>
                  <p className="text-[10px] text-slate-400">Specify Entity ID or leave empty for all</p>
                </div>
                <input name="legal_Entity" type="text" className="w-48 bg-gray-50 border border-gray-200 rounded-xl px-4 py-2 text-sm" key={getProp('legal_Entity')} defaultValue={getProp('legal_Entity', '')} />
              </div>
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <label className="text-sm font-bold text-slate-600">Document Type Version While Exporting</label>
                  <p className="text-[10px] text-slate-400">Standard versioning for XML packets</p>
                </div>
                <input name="xml_Auto_Export_documentTypeVersion" type="text" className="w-24 bg-gray-50 border border-gray-200 rounded-xl px-4 py-2 text-sm text-center font-bold" key={getProp('xml_Auto_Export_documentTypeVersion')} defaultValue={getProp('xml_Auto_Export_documentTypeVersion', "1.0")} />
              </div>
            </div>
            {/* Task 17: ERP view/query names for header & lines */}
            <div className="space-y-4 pt-6 border-t border-gray-100">
              <div className="flex items-center gap-2 text-slate-400 border-b border-gray-100 pb-2">
                <FileCode size={16} />
                <h4 className="text-xs font-bold uppercase tracking-wider">ERP Data Source (View / Query Names)</h4>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-500 uppercase">{t('erp.headerView')}</label>
                  <input name="erp_headerView" type="text" className="w-full bg-white border border-gray-200 rounded-xl px-4 py-2 text-sm font-mono text-blue-600" key={getProp('erp_headerView')} defaultValue={getProp('erp_headerView', '')} placeholder="VW_EINVOICE_HEADER" />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-500 uppercase">{t('erp.linesView')}</label>
                  <input name="erp_linesView" type="text" className="w-full bg-white border border-gray-200 rounded-xl px-4 py-2 text-sm font-mono text-blue-600" key={getProp('erp_linesView')} defaultValue={getProp('erp_linesView', '')} placeholder="VW_EINVOICE_LINES" />
                </div>
              </div>
              <p className="text-[10px] text-slate-400">These are the database views or queries used by OTax to read invoice data from your ERP system.</p>
            </div>
            {/* Task 16: Prerequisites per DB type */}
            <div className="space-y-4 pt-6 border-t border-gray-100">
              <div className="flex items-center gap-2 text-slate-400 border-b border-gray-100 pb-2">
                <AlertCircle size={16} />
                <h4 className="text-xs font-bold uppercase tracking-wider">Driver Prerequisites</h4>
              </div>
              <div className="p-4 bg-amber-50 border border-amber-100 rounded-2xl space-y-2">
                {selectedErp === 'oracle' && (
                  <>
                    <p className="text-xs font-bold text-amber-700">Oracle Database Requirements:</p>
                    <ul className="list-disc list-inside text-xs text-amber-600 space-y-1">
                      <li>Oracle Instant Client (Basic or Full) must be installed</li>
                      <li>TNS or Easy Connect string format: <code className="bg-white px-1 rounded">host:port/service</code></li>
                      <li>Ensure the OTax service user has SELECT privileges on the views above</li>
                    </ul>
                  </>
                )}
                {(selectedErp === 'mssql') && (
                  <>
                    <p className="text-xs font-bold text-amber-700">Microsoft SQL Server Requirements:</p>
                    <ul className="list-disc list-inside text-xs text-amber-600 space-y-1">
                      <li>SQL Server Native Client or ODBC Driver 17+ installed</li>
                      <li>TCP/IP protocol enabled on SQL Server instance</li>
                      <li>Login must have <code className="bg-white px-1 rounded">db_datareader</code> permission</li>
                    </ul>
                  </>
                )}
                {(selectedErp === 'postgresql') && (
                  <>
                    <p className="text-xs font-bold text-amber-700">PostgreSQL Requirements:</p>
                    <ul className="list-disc list-inside text-xs text-amber-600 space-y-1">
                      <li>pg_hba.conf must allow connections from OTax server IP</li>
                      <li>User needs SELECT privileges on target tables/views</li>
                    </ul>
                  </>
                )}
                {(selectedErp === 'mysql') && (
                  <>
                    <p className="text-xs font-bold text-amber-700">MySQL / MariaDB Requirements:</p>
                    <ul className="list-disc list-inside text-xs text-amber-600 space-y-1">
                      <li>User must have SELECT privilege on the target database</li>
                      <li>Ensure bind-address allows remote connections</li>
                    </ul>
                  </>
                )}
                {(selectedErp === 'sap_hana' || selectedErp === 'sap_b1') && (
                  <>
                    <p className="text-xs font-bold text-amber-700">SAP Requirements:</p>
                    <ul className="list-disc list-inside text-xs text-amber-600 space-y-1">
                      <li>Service Layer (SAP HANA) or DI-API (B1) must be accessible from OTax server</li>
                      <li>Valid SAP credentials with API access rights</li>
                    </ul>
                  </>
                )}
                {(selectedErp === 'odoo') && (
                  <>
                    <p className="text-xs font-bold text-amber-700">Odoo Requirements:</p>
                    <ul className="list-disc list-inside text-xs text-amber-600 space-y-1">
                      <li>XML-RPC must be enabled</li>
                      <li>API key or user credentials with access to invoice models</li>
                    </ul>
                  </>
                )}
                {(selectedErp === 'dynamics_bc' || selectedErp === 'dynamics_ax') && (
                  <>
                    <p className="text-xs font-bold text-amber-700">Microsoft Dynamics Requirements:</p>
                    <ul className="list-disc list-inside text-xs text-amber-600 space-y-1">
                      <li>OData or REST API endpoint accessible from OTax server</li>
                      <li>Azure AD app registration with appropriate API permissions</li>
                    </ul>
                  </>
                )}
                {(selectedErp === 'excel') && (
                  <>
                    <p className="text-xs font-bold text-amber-700">Excel / CSV Watcher Requirements:</p>
                    <ul className="list-disc list-inside text-xs text-amber-600 space-y-1">
                      <li>Folder must be accessible by the OTax service</li>
                      <li>Files must follow the OTax CSV/Excel template format</li>
                    </ul>
                  </>
                )}
                {(selectedErp === 'sage' || selectedErp === 'tally' || selectedErp === 'custom_api') && (
                  <>
                    <p className="text-xs font-bold text-amber-700">General Requirements:</p>
                    <ul className="list-disc list-inside text-xs text-amber-600 space-y-1">
                      <li>Ensure the ERP system's API or database is accessible from the OTax server</li>
                      <li>Valid credentials with read access to invoice data</li>
                    </ul>
                  </>
                )}
              </div>
            </div>
            <div className="space-y-4">
              <button onClick={() => testDbConnection(currentErp?.type === 'db' ? 'oracle' : 'postgres', 'secondary')} disabled={dbIsTesting === 'secondary'} className="w-full py-4 bg-blue-600 text-white font-bold rounded-[24px] flex items-center justify-center gap-2 hover:bg-blue-700 shadow-lg shadow-blue-100 transition-all hover:scale-[1.01] active:scale-[0.99] disabled:opacity-70">
                {dbIsTesting === 'secondary' ? (<div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />) : <Activity size={18} />}
                {dbIsTesting === 'secondary' ? t('otaxconn.testing') : t('erp.testConn')}
              </button>
              {dbTestResult?.section === 'secondary' && (
                <div className={`p-4 border rounded-2xl flex items-center gap-3 ${dbTestResult.success ? 'bg-emerald-50 border-emerald-100 text-emerald-700' : 'bg-red-50 border-red-100 text-red-700'}`}>
                  {dbTestResult.success ? <CheckCircle2 size={20} /> : <div className="font-bold">!</div>}
                  <div className="text-xs font-bold">{dbTestResult.message}</div>
                </div>
              )}
            </div>
          </div>
        );
      }

      case 'logdb':
        return (
          <div className="space-y-8">
            {/* Task 15: OTax auto-schema vs external DB toggle */}
            <section className="space-y-4">
              <div className="p-6 bg-blue-50 rounded-[24px] border border-blue-100 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <h4 className="text-sm font-bold text-blue-800">{t('logdb.modeHeading')}</h4>
                    <p className="text-xs text-blue-600">{t('logdb.modeSubtitle')}</p>
                  </div>
                  <select name="logdb_mode" className="bg-white border border-blue-200 rounded-xl px-4 py-2 text-sm font-bold text-blue-700 outline-none" key={getProp('logdb_mode')} defaultValue={getProp('logdb_mode', 'auto')}>
                    <option value="auto">{t('logdb.modeAutoOpt')}</option>
                    <option value="external">{t('logdb.modeExternalOpt')}</option>
                  </select>
                </div>
                <div className="text-[10px] text-blue-500 bg-white/60 rounded-xl p-3 border border-blue-100">
                  <strong>{t('logdb.modeAuto')}:</strong> {t('logdb.modeAutoExplain')}<br />
                  <strong>{t('logdb.modeExternal')}:</strong> {t('logdb.modeExternalExplain')}
                </div>
              </div>
            </section>
            <section className="space-y-6">
              <div className="flex items-center gap-3 pb-2 border-b border-gray-100">
                <Database size={20} className="text-blue-600" />
                <h4 className="font-bold text-slate-800">{t('logdb.appLogDb')}</h4>
              </div>
              <h5 className="text-sm font-bold text-blue-600">{t('logdb.mainServer')}</h5>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1 md:col-span-2">
                  <label className="text-[10px] font-bold text-slate-500 uppercase">{t('logdb.dbEngine')}</label>
                  <select name="log_ServerProvider" className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2 text-sm font-bold text-blue-600 outline-none" key={getProp('log_ServerProvider')} defaultValue={getProp('log_ServerProvider', 'Npgsql')}>
                    <option value="Npgsql">Npgsql (PostgreSQL)</option>
                    <option value="Oracle">Oracle-Client</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-500 uppercase">{t('logdb.serverName')}</label>
                  <input name="log_ServerHost" type="text" autoComplete="off" data-lpignore="true" data-form-type="other" className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2 text-sm font-mono text-blue-600" key={getProp('log_ServerHost')} defaultValue={getProp('log_ServerHost', '')} placeholder="localhost" />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-500 uppercase">{t('logdb.port')}</label>
                  <input name="log_ServerPort" type="text" autoComplete="off" data-lpignore="true" data-form-type="other" className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2 text-sm font-mono text-blue-600" key={getProp('log_ServerPort')} defaultValue={getProp('log_ServerPort', '')} placeholder="5432" />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-500 uppercase">{t('logdb.dbName')}</label>
                  <input name="log_ServerDB" type="text" autoComplete="off" data-lpignore="true" data-form-type="other" className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2 text-sm font-mono text-blue-600" key={getProp('log_ServerDB')} defaultValue={getProp('log_ServerDB', '')} />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-500 uppercase">{t('logdb.user')}</label>
                  <input name="log_ServerUser" type="text" autoComplete="off" data-lpignore="true" data-form-type="other" className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2 text-sm" key={getProp('log_ServerUser')} defaultValue={getProp('log_ServerUser', '')} />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-500 uppercase">{t('logdb.pass')}</label>
                  <SecretInput
                    name="log_ServerPass"
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2 text-sm"
                    key={getProp('log_ServerPass')}
                    defaultValue={getProp('log_ServerPass', '')}
                    placeholder="••••••••"
                    autoComplete="new-password"
                    data-lpignore="true"
                    data-form-type="other"
                    onReveal={() => revealSecret('log_ServerPass')}
                  />
                </div>
                <div className="flex items-end">
                  <button onClick={() => testDbConnection('postgres', 'main')} className="w-full py-2 bg-blue-100 text-blue-700 rounded-xl text-xs font-bold hover:bg-blue-200 transition-colors flex items-center justify-center gap-2">
                    {dbIsTesting === 'main' ? <div className="animate-spin w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full" /> : <Activity size={16} />}
                    {t('logdb.connectTest')}
                  </button>
                </div>
              </div>
            </section>
          </div>
        );

      case 'notifications': {

        // Send a test email through the configured SMTP transport so the user
        // can verify their .env credentials without waiting for the worker
        // (which only runs every 6h) or for a real failure event.
        const runSmtpTest = async () => {
          setSmtpTesting(true);
          setSmtpTestResult(null);
          try {
            const userStr = localStorage.getItem('invoice_user');
            const token = userStr ? JSON.parse(userStr).token : localStorage.getItem('token');
            const r = await fetch(`${DEFAULT_API_URL}/admin/notifications/test`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
              body: JSON.stringify(smtpTestEmail.trim() ? { to: smtpTestEmail.trim() } : {}),
            });
            const d = await r.json();
            if (!r.ok || !d.success) {
              const hint = d.hint ? ` — ${d.hint}` : '';
              throw new Error(`${d.message || 'Test failed'}${hint}`);
            }
            setSmtpTestResult({ kind: 'ok', text: d.message || 'Test email sent.' });
          } catch (e: any) {
            setSmtpTestResult({ kind: 'err', text: e.message });
          } finally {
            setSmtpTesting(false);
          }
        };

        // Dedicated save for just the two notification toggles — writes to the
        // same endpoint as autosync but sends only the notify_* fields so we
        // don't stomp the schedule config.
        const saveNotifications = async () => {
          // Local validation — backend already rejects malformed addresses, but
          // catching it here gives instant feedback without a round-trip.
          const trimmedRecipient = notifyRecipientEmail.trim();
          if (trimmedRecipient && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedRecipient)) {
            setAutoSyncMsg({ kind: 'err', text: t('notif.recipientInvalid') });
            return;
          }
          setAutoSyncSaving(true);
          setAutoSyncMsg(null);
          try {
            const userStr = localStorage.getItem('invoice_user');
            const token = userStr ? JSON.parse(userStr).token : localStorage.getItem('token');
            const r = await fetch(`${DEFAULT_API_URL}/admin/organization/eta-settings`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
              body: JSON.stringify({
                notify_daily_digest:    notifyDailyDigest,
                notify_recipient_email: trimmedRecipient || null,
              }),
            });
            const d = await r.json();
            if (!r.ok || !d.success) throw new Error(d.message || 'Save failed');
            setAutoSyncMsg({ kind: 'ok', text: t('notif.savedOk') });
            await loadAutoSync();
          } catch (e: any) {
            setAutoSyncMsg({ kind: 'err', text: e.message });
          } finally {
            setAutoSyncSaving(false);
          }
        };

        return (
          <div className="space-y-6">
            <div className="p-4 bg-amber-50 border border-amber-100 rounded-2xl text-xs text-amber-800 flex items-start gap-3">
              <Bell size={16} className="mt-0.5 flex-shrink-0 text-amber-600" />
              <div>
                <div className="font-bold text-amber-900 mb-0.5">{t('notif.heading')}</div>
                <p>{t('notif.headingSubtitle')}</p>
              </div>
            </div>

            {/* Recipient mailbox — single input. The customer types the email
                that should receive notifications. Emails are sent FROM the
                global OTax SMTP (same address that sends OTP codes), so the
                customer never enters SMTP credentials. Empty = send to every
                active+verified portal user (legacy behaviour). */}
            <section className="p-5 bg-blue-50/40 border border-blue-100 rounded-2xl space-y-3">
              <div className="flex items-start gap-3">
                <Mail size={16} className="mt-0.5 flex-shrink-0 text-blue-600" />
                <div className="flex-1">
                  <h4 className="text-sm font-bold text-slate-800 mb-1">{t('notif.recipientTitle')}</h4>
                  <p className="text-xs text-slate-600 leading-relaxed mb-3">{t('notif.recipientDesc')}</p>
                  <input
                    type="email"
                    value={notifyRecipientEmail}
                    onChange={e => setNotifyRecipientEmail(e.target.value)}
                    placeholder={t('notif.recipientPh')}
                    className="w-full px-3 py-2 border border-blue-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                  />
                  {/* Sender info — read-only, just so the customer knows who's
                      mailing them. Same SMTP that sends OTP codes. */}
                  <div className="mt-3 flex items-start gap-2 text-[11px] text-slate-600 bg-white/60 border border-blue-100 rounded-lg px-3 py-2">
                    <Send size={12} className="mt-0.5 flex-shrink-0 text-slate-400" />
                    <div>
                      <span className="font-semibold">{t('notif.senderLabel')}:</span>{' '}
                      <span className="font-mono text-slate-800">{notifySenderEmail || 'otax.tech@gmail.com'}</span>
                      <div className="text-slate-500 mt-0.5">{t('notif.senderHint')}</div>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            {/* ── Channels: which email types the recipient receives ──
                Grouped under one header so the customer reads it as a single
                "what gets sent" decision instead of three loose cards. */}
            <div className="pt-2">
              <h3 className="text-xs font-black text-slate-700 uppercase tracking-widest mb-2 px-1">{t('notif.channelsTitle')}</h3>
              <p className="text-[11px] text-slate-500 mb-3 px-1">{t('notif.channelsDesc')}</p>
              <div className="space-y-3">
                {/* Daily Digest */}
                <section className="p-5 bg-white border border-gray-100 rounded-2xl">
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input type="checkbox" className="mt-1 w-5 h-5 accent-amber-600"
                      checked={notifyDailyDigest}
                      onChange={e => setNotifyDailyDigest(e.target.checked)} />
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h4 className="text-sm font-bold text-slate-800">{t('notif.dailyDigest')}</h4>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase ${notifyDailyDigest ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                          {notifyDailyDigest ? t('notif.on') : t('notif.off')}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 leading-relaxed">{t('notif.dailyDigestDesc')}</p>
                    </div>
                  </label>
                </section>

                {/* (VAT Reminder toggle removed — superseded by the
                    "Pre-Filing VAT Pack" report in Settings → Scheduled Reports
                    which ships a richer XLSX with all invoices grouped by tax
                    type. The legacy notify_vat_reminder column is left in the
                    DB for now so existing data isn't lost.) */}

                {/* Sync-failure alerts — always-on, documented so users know it exists. */}
                <section className="p-5 bg-rose-50 border border-rose-100 rounded-2xl">
                  <div className="flex items-start gap-3">
                    <AlertCircle size={16} className="mt-0.5 flex-shrink-0 text-rose-600" />
                    <div>
                      <h4 className="text-sm font-bold text-slate-800 mb-1">{t('notif.alertsTitle')}</h4>
                      <p className="text-xs text-slate-600">{t('notif.alertsDesc')}</p>
                    </div>
                  </div>
                </section>
              </div>
            </div>

            {/* ── Save bar — sticks to the toggle/recipient changes only.
                The two diagnostic tools below (Send Test / Send Now) fire
                immediately and don't need a Save click. */}
            <div className="flex items-center gap-3 pt-2 border-t border-gray-100">
              <button onClick={saveNotifications} disabled={autoSyncSaving}
                className="flex items-center gap-2 bg-amber-600 text-white px-6 py-2.5 rounded-xl text-sm font-bold hover:bg-amber-700 disabled:opacity-50">
                {autoSyncSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} {t('common.save')}
              </button>
              {autoSyncMsg && autoSyncMsg.kind === 'ok' && (
                <span className="text-sm text-emerald-600 flex items-center gap-1"><CheckCircle2 size={14} /> {autoSyncMsg.text}</span>
              )}
              {autoSyncMsg && autoSyncMsg.kind === 'err' && (
                <span className="text-sm text-rose-600 flex items-center gap-1"><AlertCircle size={14} /> {autoSyncMsg.text}</span>
              )}
            </div>

            {/* ── Tools (diagnostics): Send Test + Send Now.
                Pushed to the bottom in muted styling because they're
                fire-and-forget helpers, not part of the main config flow. */}
            <div className="pt-4">
              <h3 className="text-xs font-black text-slate-500 uppercase tracking-widest mb-2 px-1">{t('notif.diagnosticsTitle')}</h3>
              <p className="text-[11px] text-slate-400 mb-3 px-1">{t('notif.diagnosticsDesc')}</p>

              <div className="space-y-3">
                {/* Send a test email — pre-fills the recipient field with the
                    saved notification email when blank, so the user gets a
                    one-click "verify it landed" check. */}
                <section className="p-5 bg-white border border-gray-100 rounded-2xl space-y-3">
                  <div className="flex items-start gap-3">
                    <Send size={16} className="mt-0.5 flex-shrink-0 text-blue-600" />
                    <div className="flex-1">
                      <h4 className="text-sm font-bold text-slate-800 mb-1">{t('notif.testSmtpTitle')}</h4>
                      <p className="text-xs text-slate-500 leading-relaxed mb-3">{t('notif.testSmtpDesc')}</p>
                      <div className="flex flex-col sm:flex-row gap-2">
                        <input
                          type="email"
                          value={smtpTestEmail}
                          onChange={e => setSmtpTestEmail(e.target.value)}
                          placeholder={notifyRecipientEmail || t('notif.testSmtpRecipientPh')}
                          className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                        />
                        <button
                          onClick={runSmtpTest}
                          disabled={smtpTesting}
                          className="flex items-center justify-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-bold hover:bg-blue-700 disabled:opacity-50"
                        >
                          {smtpTesting ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                          {t('notif.sendTest')}
                        </button>
                      </div>
                      {smtpTestResult && smtpTestResult.kind === 'ok' && (
                        <div className="mt-3 text-xs text-emerald-700 bg-emerald-50 border border-emerald-100 px-3 py-2 rounded-lg flex items-start gap-2">
                          <CheckCircle2 size={14} className="mt-0.5 flex-shrink-0" /> {smtpTestResult.text}
                        </div>
                      )}
                      {smtpTestResult && smtpTestResult.kind === 'err' && (
                        <div className="mt-3 text-xs text-rose-700 bg-rose-50 border border-rose-100 px-3 py-2 rounded-lg flex items-start gap-2">
                          <AlertCircle size={14} className="mt-0.5 flex-shrink-0" /> {smtpTestResult.text}
                        </div>
                      )}
                    </div>
                  </div>
                </section>

                {/* (Force-run-now button removed — every entry in
                    Settings → Scheduled Reports has its own "Send now" button
                    that does the same thing for that specific report.) */}
              </div>
            </div>
          </div>
        );
      }

      case 'reports': {
        // Helper for dropdown options.
        const dows = [
          { v: 0, k: 'reports.sun' }, { v: 1, k: 'reports.mon' }, { v: 2, k: 'reports.tue' },
          { v: 3, k: 'reports.wed' }, { v: 4, k: 'reports.thu' }, { v: 5, k: 'reports.fri' },
          { v: 6, k: 'reports.sat' },
        ];
        // Translate report label/desc using i18n keys we add for each id; falls
        // back to the English label from the catalogue when no translation exists.
        const reportLabel = (r: ScheduledReportRow) => {
          const k = `reports.${r.id}.label`;
          const tr = t(k);
          return tr === k ? r.label : tr;
        };
        const reportDesc = (r: ScheduledReportRow) => {
          const k = `reports.${r.id}.desc`;
          const tr = t(k);
          return tr === k ? r.description : tr;
        };
        return (
          <div className="space-y-6">
            <div className="p-4 bg-blue-50 border border-blue-100 rounded-2xl text-xs text-blue-800 flex items-start gap-3">
              <FileSpreadsheet size={16} className="mt-0.5 flex-shrink-0 text-blue-600" />
              <div>
                <div className="font-bold text-blue-900 mb-0.5">{t('reports.heading')}</div>
                <p>{t('reports.headingSubtitle')}</p>
              </div>
            </div>

            {/* Single-active hint — explains the constraint up-front so the
                user knows BEFORE they toggle that enabling B disables A. */}
            <div className="p-3 bg-amber-50 border border-amber-100 rounded-2xl text-xs text-amber-800 flex items-start gap-2">
              <AlertCircle size={14} className="mt-0.5 flex-shrink-0 text-amber-600" />
              <div className="flex-1">
                <span className="font-bold">{t('reports.singleActiveTitle')}:</span> {t('reports.singleActiveHint')}
              </div>
            </div>

            {/* (Inline status banner removed — replaced by the global
                top-right Toast cards via toast() in ConfirmDialog.tsx.) */}

            {reportsLoading && (
              <div className="text-center py-6 text-slate-400 text-sm flex items-center justify-center gap-2">
                <Loader2 size={16} className="animate-spin" /> {t('common.loading')}
              </div>
            )}

            {!reportsLoading && scheduledReports.length === 0 && (
              <div className="text-center py-8 text-slate-400 text-sm">{t('reports.empty')}</div>
            )}

            {/* Two-column grid on lg+ — each card is its own self-contained
                box, kept compact so the user can scan the whole catalogue
                at a glance instead of scrolling through one tall column. */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {!reportsLoading && scheduledReports.map(report => {
              const saving = reportSavingId === report.id;
              const sending = reportSendingId === report.id;

              // 24h ↔ 12h converters. Backend stores the canonical 0-23
              // value; UI shows hour 12 / 1-11 with an AM/PM dropdown so the
              // customer doesn't have to do military-time math.
              const period: 'AM' | 'PM' = report.timeHour < 12 ? 'AM' : 'PM';
              const hour12: number = report.timeHour === 0 ? 12 : report.timeHour > 12 ? report.timeHour - 12 : report.timeHour;
              const setHour24FromPicker = (newHour12: number, newPeriod: 'AM' | 'PM') => {
                const h12 = clampInRange(newHour12, 1, 12);
                const h24 = newPeriod === 'AM'
                  ? (h12 === 12 ? 0 : h12)
                  : (h12 === 12 ? 12 : h12 + 12);
                editScheduledReport(report.id, { timeHour: h24 });
              };

              const dirty = dirtyReportIds.has(report.id);
              return (
                <section key={report.id} className={`p-4 rounded-2xl border flex flex-col gap-3 transition-colors ${
                  report.enabled ? 'bg-white border-blue-100' : 'bg-gray-50/60 border-gray-100'
                }`}>
                  {/* ── Compact header: toggle + title + status pill ── */}
                  <div className="flex items-start gap-2.5">
                    <input
                      type="checkbox"
                      checked={report.enabled}
                      onChange={e => editScheduledReport(report.id, { enabled: e.target.checked })}
                      className="mt-0.5 w-4 h-4 accent-blue-600 shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <h4 className="text-sm font-bold text-slate-800 truncate">{reportLabel(report)}</h4>
                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full uppercase shrink-0 ${
                          report.enabled ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'
                        }`}>
                          {report.enabled ? t('notif.on') : t('notif.off')}
                        </span>
                        {saving && (
                          <span className="text-[9px] text-blue-600 flex items-center gap-1">
                            <Loader2 size={9} className="animate-spin" /> {t('reports.saving')}
                          </span>
                        )}
                        {!saving && dirty && (
                          <span className="text-[9px] font-bold text-amber-700 bg-amber-50 border border-amber-100 px-1.5 py-0.5 rounded-full">
                            ● {t('reports.unsaved')}
                          </span>
                        )}
                        {report.lastError && (
                          <span className="text-[9px] font-bold text-rose-700 bg-rose-50 border border-rose-100 px-1.5 py-0.5 rounded-full" title={report.lastError}>⚠</span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-500 leading-snug mt-0.5 line-clamp-2">{reportDesc(report)}</p>
                    </div>
                  </div>

                  {/* ── Controls row 1: cadence + day picker (when needed) ── */}
                  <div className={`grid grid-cols-2 gap-2 ${report.enabled ? '' : 'opacity-60 pointer-events-none'}`}>
                    <div>
                      <label className="block text-[9px] font-bold text-slate-500 uppercase mb-0.5">{t('reports.cadence')}</label>
                      <select
                        value={report.frequency}
                        onChange={e => editScheduledReport(report.id, { frequency: e.target.value as any })}
                        className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-xs bg-white"
                      >
                        <option value="daily">{t('reports.daily')}</option>
                        <option value="weekly">{t('reports.weekly')}</option>
                        <option value="monthly">{t('reports.monthly')}</option>
                      </select>
                    </div>

                    {/* Day-of-week (weekly only) — second column when relevant. */}
                    {report.frequency === 'weekly' && (
                      <div>
                        <label className="block text-[9px] font-bold text-slate-500 uppercase mb-0.5">{t('reports.dayOfWeek')}</label>
                        <select
                          value={report.dayOfWeek ?? 0}
                          onChange={e => editScheduledReport(report.id, { dayOfWeek: parseInt(e.target.value, 10) })}
                          className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-xs bg-white"
                        >
                          {dows.map(d => <option key={d.v} value={d.v}>{t(d.k)}</option>)}
                        </select>
                      </div>
                    )}

                    {/* Day-of-month (monthly only). */}
                    {report.frequency === 'monthly' && (
                      <div>
                        <label className="block text-[9px] font-bold text-slate-500 uppercase mb-0.5">{t('reports.dayOfMonth')}</label>
                        <input
                          type="number" min={1} max={28}
                          value={report.dayOfMonth ?? 1}
                          onChange={e => editScheduledReport(report.id, { dayOfMonth: clampInRange(e.target.value, 1, 28) })}
                          className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-xs bg-white font-mono"
                        />
                      </div>
                    )}

                    {/* For daily, the second column is empty — fill with the time
                        picker so the row stays balanced. */}
                    {report.frequency === 'daily' && (
                      <div>
                        <label className="block text-[9px] font-bold text-slate-500 uppercase mb-0.5">{t('reports.time')}</label>
                        <div className="flex items-center gap-1">
                          <input
                            type="number" min={1} max={12}
                            value={hour12}
                            onChange={e => setHour24FromPicker(clampInRange(e.target.value, 1, 12), period)}
                            className="w-12 px-1.5 py-1.5 border border-gray-200 rounded-lg text-xs bg-white font-mono text-center"
                          />
                          <span className="text-slate-400 font-bold text-xs">:</span>
                          <input
                            type="number" min={0} max={59}
                            value={String(report.timeMinute).padStart(2, '0')}
                            onChange={e => editScheduledReport(report.id, { timeMinute: clampInRange(e.target.value, 0, 59) })}
                            className="w-12 px-1.5 py-1.5 border border-gray-200 rounded-lg text-xs bg-white font-mono text-center"
                          />
                          <select
                            value={period}
                            onChange={e => setHour24FromPicker(hour12, e.target.value as 'AM' | 'PM')}
                            className="px-1.5 py-1.5 border border-gray-200 rounded-lg text-xs bg-white font-mono"
                          >
                            <option value="AM">AM</option>
                            <option value="PM">PM</option>
                          </select>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* For weekly/monthly the time picker gets its own row so the
                      day picker has full breathing room. */}
                  {report.frequency !== 'daily' && (
                    <div className={report.enabled ? '' : 'opacity-60 pointer-events-none'}>
                      <label className="block text-[9px] font-bold text-slate-500 uppercase mb-0.5">{t('reports.time')}</label>
                      <div className="flex items-center gap-1">
                        <input
                          type="number" min={1} max={12}
                          value={hour12}
                          onChange={e => setHour24FromPicker(clampInRange(e.target.value, 1, 12), period)}
                          className="w-12 px-1.5 py-1.5 border border-gray-200 rounded-lg text-xs bg-white font-mono text-center"
                        />
                        <span className="text-slate-400 font-bold text-xs">:</span>
                        <input
                          type="number" min={0} max={59}
                          value={String(report.timeMinute).padStart(2, '0')}
                          onChange={e => editScheduledReport(report.id, { timeMinute: clampInRange(e.target.value, 0, 59) })}
                          className="w-12 px-1.5 py-1.5 border border-gray-200 rounded-lg text-xs bg-white font-mono text-center"
                        />
                        <select
                          value={period}
                          onChange={e => setHour24FromPicker(hour12, e.target.value as 'AM' | 'PM')}
                          className="px-1.5 py-1.5 border border-gray-200 rounded-lg text-xs bg-white font-mono"
                        >
                          <option value="AM">AM</option>
                          <option value="PM">PM</option>
                        </select>
                      </div>
                    </div>
                  )}

                  {/* Recipient — full width, smaller height. */}
                  <div className={report.enabled ? '' : 'opacity-60 pointer-events-none'}>
                    <label className="block text-[9px] font-bold text-slate-500 uppercase mb-0.5">{t('reports.recipient')}</label>
                    <input
                      type="email"
                      value={report.recipientEmail || ''}
                      onChange={e => editScheduledReport(report.id, { recipientEmail: e.target.value })}
                      placeholder={t('reports.recipientPh')}
                      className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-xs bg-white"
                    />
                  </div>

                  {/* Footer: last-sent (left) + Send Now (right) — auto
                      pushes to the bottom so cards in the grid line up.
                      The per-card Save button was removed; saves now flow
                      through the global "Save All Changes" button at the
                      bottom of the page (see handleSaveAll). The "unsaved"
                      pill in the header is the only signal that the user
                      still needs to hit Save All. */}
                  <div className="flex items-center justify-between gap-2 pt-2 border-t border-gray-100 flex-wrap mt-auto">
                    <div className="text-[10px] text-slate-500 truncate flex-1 min-w-0">
                      {report.lastSentAt
                        ? <>{t('reports.lastSent')}: <span className="font-mono">{new Date(report.lastSentAt).toLocaleString()}</span></>
                        : <span className="text-slate-400">{t('reports.neverSent')}</span>}
                    </div>
                    <button
                      onClick={() => sendScheduledReportNow(report.id)}
                      disabled={sending || saving}
                      title={dirty ? t('reports.saveBeforeSend') : ''}
                      className="flex items-center gap-1.5 bg-violet-600 text-white px-3 py-1.5 rounded-lg text-[11px] font-bold hover:bg-violet-700 disabled:opacity-50 shrink-0"
                    >
                      {sending ? <Loader2 size={11} className="animate-spin" /> : <Send size={11} />}
                      {t('reports.sendNow')}
                    </button>
                  </div>
                </section>
              );
            })}
            </div>
          </div>
        );
      }

      case 'branches':
        return (
          <div className="space-y-6">
            <div className="p-4 bg-indigo-50 border border-indigo-100 rounded-2xl text-xs text-indigo-800 flex items-start gap-3">
              <Building2 size={16} className="mt-0.5 flex-shrink-0 text-indigo-600" />
              <div>
                <div className="font-bold text-indigo-900 mb-0.5">{t('branches.heading')}</div>
                <p>{t('branches.subtitle')}</p>
              </div>
            </div>

            {/* Create form */}
            <section className="p-5 bg-white border border-gray-100 rounded-2xl space-y-3">
              <h4 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                <Plus size={15} className="text-emerald-600" /> {t('branches.addBranch')}
              </h4>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div><label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">{t('branches.branchId')} *</label>
                  <input type="text" value={branchForm.branch_id} onChange={e => setBranchForm({ ...branchForm, branch_id: e.target.value })} placeholder="0" className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm font-mono" /></div>
                <div><label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">{t('branches.branchName')}</label>
                  <input type="text" value={branchForm.name} onChange={e => setBranchForm({ ...branchForm, name: e.target.value })} placeholder="Cairo HQ" className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" /></div>
                <div><label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">{t('branches.country')}</label>
                  <input type="text" value={branchForm.country} onChange={e => setBranchForm({ ...branchForm, country: e.target.value.toUpperCase() })} maxLength={2} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm font-mono uppercase" /></div>
                <div><label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">{t('branches.governate')}</label>
                  <input type="text" value={branchForm.governate} onChange={e => setBranchForm({ ...branchForm, governate: e.target.value })} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" /></div>
                <div><label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">{t('branches.regionCity')}</label>
                  <input type="text" value={branchForm.region_city} onChange={e => setBranchForm({ ...branchForm, region_city: e.target.value })} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" /></div>
                <div className="md:col-span-2"><label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">{t('branches.street')}</label>
                  <input type="text" value={branchForm.street} onChange={e => setBranchForm({ ...branchForm, street: e.target.value })} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" /></div>
                <div><label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">{t('branches.buildingNo')}</label>
                  <input type="text" value={branchForm.building_number} onChange={e => setBranchForm({ ...branchForm, building_number: e.target.value })} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" /></div>
                <div><label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">{t('branches.postalCode')}</label>
                  <input type="text" value={branchForm.postal_code} onChange={e => setBranchForm({ ...branchForm, postal_code: e.target.value })} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm font-mono" /></div>
                <div className="md:col-span-4 flex items-center gap-2 pt-1">
                  <input type="checkbox" id="branch_is_default" checked={branchForm.is_default} onChange={e => setBranchForm({ ...branchForm, is_default: e.target.checked })} className="w-4 h-4 accent-emerald-600" />
                  <label htmlFor="branch_is_default" className="text-xs text-slate-600">{t('branches.isDefault')}</label>
                </div>
              </div>
              {branchError && <div className="text-xs text-rose-600 flex items-center gap-1"><AlertCircle size={12} /> {branchError}</div>}
              <button type="button" onClick={createBranch}
                className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white text-sm font-bold rounded-lg hover:bg-emerald-700">
                <Plus size={14} /> {t('common.save')}
              </button>
            </section>

            {/* Existing branches */}
            <section className="bg-white border border-gray-100 rounded-2xl overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
                <h4 className="text-sm font-bold text-slate-800">{t('settings.branches')} ({branches.length})</h4>
                <button onClick={loadBranches} className="text-xs text-slate-500 hover:text-slate-700 flex items-center gap-1"><RefreshCw size={12} /> {t('common.reload')}</button>
              </div>
              {branchesLoading && <div className="p-8 text-center"><Loader2 size={22} className="animate-spin mx-auto text-slate-400" /></div>}
              {!branchesLoading && branches.length === 0 && (
                <div className="p-8 text-center text-slate-400 text-sm">{t('branches.noBranches')}</div>
              )}
              {!branchesLoading && branches.length > 0 && (
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-[10px] font-bold text-slate-500 uppercase">
                    <tr>
                      <th className="text-left px-4 py-2">{t('branches.branchId')}</th>
                      <th className="text-left px-4 py-2">{t('branches.branchName')}</th>
                      <th className="text-left px-4 py-2">{t('manual.receiverAddress')}</th>
                      <th className="text-center px-4 py-2">{t('branches.isDefault')}</th>
                      <th className="text-right px-4 py-2">{t('branches.actions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {branches.map(b => (
                      <tr key={b.id} className="border-t border-gray-50">
                        <td className="px-4 py-2 font-mono font-bold">{b.branch_id}</td>
                        <td className="px-4 py-2">{b.name || '—'}</td>
                        <td className="px-4 py-2 text-xs text-slate-600">{[b.street, b.region_city, b.governate, b.country].filter(Boolean).join(' · ') || '—'}</td>
                        <td className="px-4 py-2 text-center">
                          {b.is_default
                            ? <span className="inline-block text-[10px] font-bold bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full uppercase">{t('manual.branchDefault')}</span>
                            : <button onClick={() => setBranchDefault(b.id)} className="text-[10px] font-bold text-slate-500 hover:text-emerald-600 hover:underline">{t('branches.markDefault')}</button>}
                        </td>
                        <td className="px-4 py-2 text-right">
                          <button onClick={() => deleteBranch(b.id)} className="text-xs font-bold text-rose-600 hover:text-rose-800 hover:bg-rose-50 px-2 py-1 rounded">{t('branches.delete')}</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          </div>
        );

      case 'security':
        return (
          <div className="space-y-6 max-w-2xl">
            <div className="p-4 bg-violet-50 border border-violet-100 rounded-2xl text-xs text-violet-800 flex items-start gap-3">
              <ShieldCheck size={16} className="mt-0.5 flex-shrink-0 text-violet-600" />
              <div>
                <div className="font-bold text-violet-900 mb-0.5">{t('sec.heading')}</div>
                <p>{t('sec.subtitle')}</p>
              </div>
            </div>

            {twoFaEnabled === null && (
              <div className="text-center py-8 text-slate-400"><Loader2 size={20} className="animate-spin mx-auto" /></div>
            )}

            {/* Freshly-issued backup codes — the user sees them ONCE, then never
                again. Encourage download/print before they leave the page. */}
            {backupCodes && backupCodes.length > 0 && (
              <section className="p-5 bg-amber-50 border-2 border-amber-300 rounded-2xl space-y-3">
                <div className="flex items-center gap-2">
                  <AlertCircle size={18} className="text-amber-600" />
                  <h4 className="text-sm font-bold text-amber-900">{t('sec.savedRecoveryCodes')}</h4>
                </div>
                <p className="text-[11px] text-amber-900">{t('sec.savedRecoveryHint')}</p>
                <div className="grid grid-cols-2 gap-2 bg-white border border-amber-200 rounded-xl p-3">
                  {backupCodes.map((c, i) => (
                    <code key={i} className="font-mono text-sm text-slate-800 bg-slate-50 border border-slate-100 rounded px-2 py-1 text-center">{c}</code>
                  ))}
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={() => navigator.clipboard?.writeText(backupCodes.join('\n'))}
                    className="text-xs font-bold px-3 py-1.5 bg-amber-600 text-white rounded-lg hover:bg-amber-700 flex items-center gap-1">
                    <CopyIcon size={12} /> {t('sec.copyAll')}
                  </button>
                  <button type="button" onClick={() => {
                    const blob = new Blob([`${t('sec.recoveryFilename')} — ${new Date().toISOString()}\n\n` + backupCodes.join('\n')], { type: 'text/plain' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url; a.download = 'otax-2fa-recovery-codes.txt'; a.click();
                    URL.revokeObjectURL(url);
                  }}
                    className="text-xs font-bold px-3 py-1.5 bg-white border border-amber-300 text-amber-800 rounded-lg hover:bg-amber-100 flex items-center gap-1">
                    <Download size={12} /> {t('sec.download')}
                  </button>
                  <button type="button" onClick={() => setBackupCodes(null)}
                    className="text-xs text-amber-700 font-semibold hover:text-amber-900 ml-auto">
                    {t('sec.savedHide')}
                  </button>
                </div>
              </section>
            )}

            {/* Already enabled — show backup-code status + offer to disable / regenerate. */}
            {twoFaEnabled === true && (
              <section className="p-5 bg-white border border-emerald-200 rounded-2xl space-y-4">
                <div className="flex items-center gap-2">
                  <CheckCircle2 size={18} className="text-emerald-600" />
                  <h4 className="text-sm font-bold text-slate-800">{t('sec.enabled')}</h4>
                  <span className="text-[10px] font-bold bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full uppercase">{t('sec.activeBadge')}</span>
                </div>
                <p className="text-xs text-slate-600">{t('sec.enabledExplain')}</p>

                {/* Backup-code remaining counter. Warn at ≤2. */}
                {backupRemaining && (
                  <div className={`flex items-center gap-2 p-3 rounded-lg border ${
                    backupRemaining.remaining === 0 ? 'bg-rose-50 border-rose-200 text-rose-800'
                    : backupRemaining.remaining <= 2 ? 'bg-amber-50 border-amber-200 text-amber-900'
                    : 'bg-slate-50 border-slate-200 text-slate-700'
                  }`}>
                    <KeyRound size={14} className="flex-shrink-0" />
                    <span className="text-xs font-semibold">
                      {backupRemaining.remaining === 0
                        ? t('sec.codesEmpty')
                        : `${backupRemaining.remaining} / ${backupRemaining.total} ${t('sec.codesLeft')}`}
                    </span>
                  </div>
                )}

                <div className="pt-2 border-t border-gray-100">
                  <h5 className="text-xs font-bold text-slate-700 mb-2">{t('sec.regenTitle')}</h5>
                  <p className="text-[11px] text-slate-500 mb-2">{t('sec.regenExplain')}</p>
                  <div className="flex gap-2">
                    <input type="password" value={showRegenPassword} onChange={e => setShowRegenPassword(e.target.value)}
                      placeholder={t('sec.currentPassword')} className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm" />
                    <button onClick={regenerateBackupCodes} disabled={twoFaBusy || !showRegenPassword}
                      className="px-4 py-2 bg-amber-600 text-white text-sm font-bold rounded-lg hover:bg-amber-700 disabled:opacity-50">
                      {twoFaBusy ? <Loader2 size={14} className="animate-spin" /> : t('sec.generateNew')}
                    </button>
                  </div>
                </div>

                <div className="pt-2 border-t border-gray-100">
                  <h5 className="text-xs font-bold text-slate-700 mb-2">{t('sec.disableTitle')}</h5>
                  <p className="text-[11px] text-slate-500 mb-2">{t('sec.disableExplain')}</p>
                  <div className="flex gap-2">
                    <input type="password" value={twoFaPassword} onChange={e => setTwoFaPassword(e.target.value)}
                      placeholder={t('sec.currentPassword')} className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm" />
                    <button onClick={disable2fa} disabled={twoFaBusy}
                      className="px-4 py-2 bg-rose-600 text-white text-sm font-bold rounded-lg hover:bg-rose-700 disabled:opacity-50">
                      {twoFaBusy ? <Loader2 size={14} className="animate-spin" /> : t('sec.disable')}
                    </button>
                  </div>
                  {twoFaError && <div className="text-xs text-rose-600 flex items-center gap-1 mt-2"><AlertCircle size={12} /> {twoFaError}</div>}
                </div>
              </section>
            )}

            {/* Not enabled, no setup in flight — offer to start. */}
            {twoFaEnabled === false && !twoFaSecret && (
              <section className="p-6 bg-white border border-gray-100 rounded-2xl text-center space-y-4">
                <Smartphone size={36} className="mx-auto text-violet-500" />
                <div>
                  <h4 className="text-base font-bold text-slate-800">{t('sec.enableTitle')}</h4>
                  <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">{t('sec.enableExplain')}</p>
                </div>
                <button onClick={start2faSetup} disabled={twoFaBusy}
                  className="inline-flex items-center gap-2 px-6 py-2.5 bg-violet-600 text-white text-sm font-bold rounded-xl hover:bg-violet-700 disabled:opacity-50">
                  {twoFaBusy ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
                  {t('sec.enable')}
                </button>
                {twoFaError && <div className="text-xs text-rose-600 flex items-center justify-center gap-1"><AlertCircle size={12} /> {twoFaError}</div>}
              </section>
            )}

            {/* Setup in progress — show QR + manual secret + verify input. */}
            {twoFaSecret && twoFaUrl && (
              <section className="p-6 bg-white border-2 border-violet-300 rounded-2xl space-y-4">
                <h4 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                  <Smartphone size={16} className="text-violet-600" /> {t('sec.step1')}
                </h4>
                <div className="flex flex-col md:flex-row gap-5 items-start">
                  {/* Free public QR generator — keeps the dependency footprint flat. */}
                  <div className="bg-white p-2 border border-gray-200 rounded-xl">
                    <img alt="2FA QR code"
                      src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(twoFaUrl)}`}
                      style={{ width: 200, height: 200 }} />
                  </div>
                  <div className="flex-1 text-xs text-slate-600 space-y-2">
                    <p>{t('sec.cantScan')}</p>
                    <code className="block p-2 bg-slate-100 rounded font-mono text-[11px] break-all">{twoFaSecret}</code>
                    <p className="text-[10px] text-slate-400">{t('sec.codeChanges')}</p>
                  </div>
                </div>
                <div className="pt-4 border-t border-gray-100">
                  <h4 className="text-sm font-bold text-slate-800 mb-2">{t('sec.step2')}</h4>
                  <div className="flex gap-2">
                    <input type="text" inputMode="numeric" maxLength={6}
                      value={twoFaCode} onChange={e => setTwoFaCode(e.target.value.replace(/\D/g, ''))}
                      placeholder="000000"
                      className="px-4 py-2 border-2 border-gray-200 rounded-xl text-2xl text-center font-mono tracking-[0.5em] w-44 focus:border-violet-400 outline-none" />
                    <button onClick={confirm2faSetup} disabled={twoFaBusy || twoFaCode.length !== 6}
                      className="px-5 py-2 bg-violet-600 text-white text-sm font-bold rounded-xl hover:bg-violet-700 disabled:opacity-50">
                      {twoFaBusy ? <Loader2 size={14} className="animate-spin" /> : t('sec.verifyEnable')}
                    </button>
                    <button onClick={() => { setTwoFaSecret(null); setTwoFaUrl(null); setTwoFaCode(''); setTwoFaError(null); }}
                      className="px-4 py-2 bg-gray-100 text-slate-600 text-sm font-bold rounded-xl hover:bg-gray-200">
                      {t('sec.cancel')}
                    </button>
                  </div>
                  {twoFaError && <div className="text-xs text-rose-600 flex items-center gap-1 mt-2"><AlertCircle size={12} /> {twoFaError}</div>}
                </div>
              </section>
            )}
          </div>
        );

      case 'apikeys':
        return (
          <div className="space-y-6">
            <div className="p-4 bg-indigo-50 border border-indigo-100 rounded-2xl text-xs text-indigo-800 flex items-start gap-3">
              <KeyRound size={16} className="mt-0.5 flex-shrink-0 text-indigo-600" />
              <div>
                <div className="font-bold text-indigo-900 mb-0.5">{t('apikeys.heading')}</div>
                <p>{t('apikeys.subtitle')} <code className="bg-white px-1.5 py-0.5 rounded border border-indigo-200 font-mono">X-API-Key: otax_…</code></p>
              </div>
            </div>

            {/* Banner shown once right after a new key is created. This is the only
                time the plaintext value is visible — after the user leaves this
                screen there's no way to recover it. */}
            {justCreatedKey && (
              <section className="p-5 bg-amber-50 border-2 border-amber-300 rounded-2xl space-y-3">
                <div className="flex items-center gap-2">
                  <AlertCircle size={18} className="text-amber-600" />
                  <h4 className="text-sm font-bold text-amber-900">{t('apikeys.saveKeyNow')}</h4>
                </div>
                <div className="flex items-stretch gap-2 bg-white border border-amber-200 rounded-xl overflow-hidden">
                  <code className="flex-1 px-4 py-3 font-mono text-xs text-slate-800 break-all">{justCreatedKey}</code>
                  <button type="button" onClick={() => {
                      navigator.clipboard?.writeText(justCreatedKey).then(() => {
                        setKeyCopied(true);
                        setTimeout(() => setKeyCopied(false), 2000);
                      });
                    }}
                    className="px-4 bg-amber-600 text-white text-xs font-bold flex items-center gap-1 hover:bg-amber-700">
                    <CopyIcon size={13} /> {keyCopied ? t('apikeys.copied') : t('apikeys.copy')}
                  </button>
                </div>
                <button type="button" onClick={() => setJustCreatedKey(null)}
                  className="text-xs text-amber-700 font-semibold hover:text-amber-900">
                  {t('apikeys.savedHide')}
                </button>
              </section>
            )}

            {/* Create form */}
            <section className="p-5 bg-white border border-gray-100 rounded-2xl space-y-3">
              <h4 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                <Plus size={15} className="text-emerald-600" /> {t('apikeys.createTitle')}
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">{t('apikeys.name')} *</label>
                  <input type="text" value={newKeyName} onChange={e => setNewKeyName(e.target.value)}
                    placeholder={t('apikeys.namePh')}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">{t('apikeys.scope')}</label>
                  <select value={newKeyScope} onChange={e => setNewKeyScope(e.target.value as any)}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm">
                    <option value="read">{t('apikeys.scopeRead')}</option>
                    <option value="write">{t('apikeys.scopeWrite')}</option>
                    <option value="admin">{t('apikeys.scopeAdmin')}</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">{t('apikeys.expires')}</label>
                  <input type="date" value={newKeyExpires} onChange={e => setNewKeyExpires(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">{t('apikeys.rateLimit')}</label>
                  <input type="number" min="0" max="100000" value={newKeyRateLimit} onChange={e => setNewKeyRateLimit(e.target.value)}
                    placeholder={t('apikeys.rateLimitPh')}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
                </div>
              </div>
              {apiKeyError && <div className="text-xs text-rose-600 flex items-center gap-1"><AlertCircle size={12} /> {apiKeyError}</div>}
              <button type="button" onClick={createApiKey}
                className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white text-sm font-bold rounded-lg hover:bg-emerald-700">
                <KeyRound size={14} /> {t('apikeys.generateKey')}
              </button>
            </section>

            {/* Existing keys table */}
            <section className="bg-white border border-gray-100 rounded-2xl overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
                <h4 className="text-sm font-bold text-slate-800">{t('apikeys.existingKeys')} ({apiKeys.length})</h4>
                <button onClick={loadApiKeys} className="text-xs text-slate-500 hover:text-slate-700 flex items-center gap-1">
                  <RefreshCw size={12} /> {t('common.reload')}
                </button>
              </div>
              {apiKeysLoading && <div className="p-8 text-center text-slate-400"><Loader2 size={22} className="animate-spin mx-auto" /></div>}
              {!apiKeysLoading && apiKeys.length === 0 && (
                <div className="p-8 text-center text-slate-400 text-sm">{t('apikeys.noKeys')}</div>
              )}
              {!apiKeysLoading && apiKeys.length > 0 && (
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-[10px] font-bold text-slate-500 uppercase">
                    <tr>
                      <th className="text-left px-4 py-2">{t('apikeys.colName')}</th>
                      <th className="text-left px-4 py-2">{t('apikeys.colKey')}</th>
                      <th className="text-left px-4 py-2">{t('apikeys.colScope')}</th>
                      <th className="text-left px-4 py-2">{t('apikeys.colRate')}</th>
                      <th className="text-left px-4 py-2">{t('apikeys.colLastUsed')}</th>
                      <th className="text-left px-4 py-2">{t('apikeys.colStatus')}</th>
                      <th className="text-right px-4 py-2">{t('apikeys.colActions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {apiKeys.map(k => {
                      const expired = k.expires_at && new Date(k.expires_at) < new Date();
                      const scopeColor = k.scope === 'admin' ? 'bg-rose-100 text-rose-700'
                        : k.scope === 'write' ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700';
                      // null = use server default (60); 0 = unlimited
                      const rateDisplay = k.rate_limit_per_min === null || k.rate_limit_per_min === undefined
                        ? t('apikeys.rateDefault')
                        : k.rate_limit_per_min === 0 ? t('apikeys.rateUnlimited') : String(k.rate_limit_per_min);
                      return (
                        <tr key={k.id} className="border-t border-gray-50">
                          <td className="px-4 py-2 font-semibold">{k.name}</td>
                          <td className="px-4 py-2 font-mono text-xs text-slate-500">{k.key_prefix}…</td>
                          <td className="px-4 py-2">
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${scopeColor} uppercase`}>{k.scope}</span>
                          </td>
                          <td className="px-4 py-2 text-xs text-slate-600">{rateDisplay}</td>
                          <td className="px-4 py-2 text-xs text-slate-500">{k.last_used_at ? new Date(k.last_used_at).toLocaleString() : t('apikeys.never')}</td>
                          <td className="px-4 py-2">
                            {!k.is_active ? <span className="text-[10px] font-bold bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full uppercase">{t('apikeys.statusRevoked')}</span>
                              : expired ? <span className="text-[10px] font-bold bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full uppercase">{t('apikeys.statusExpired')}</span>
                              : <span className="text-[10px] font-bold bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full uppercase">{t('apikeys.statusActive')}</span>}
                          </td>
                          <td className="px-4 py-2 text-right">
                            <div className="inline-flex items-center gap-2">
                              {k.is_active && (
                                <button onClick={() => updateApiKeyRateLimit(k.id, k.rate_limit_per_min)}
                                  className="text-xs font-bold text-blue-600 hover:text-blue-800 hover:bg-blue-50 px-2 py-1 rounded">
                                  {t('apikeys.editLimit')}
                                </button>
                              )}
                              {k.is_active && (
                                <button onClick={() => revokeApiKey(k.id)}
                                  className="text-xs font-bold text-rose-600 hover:text-rose-800 hover:bg-rose-50 px-2 py-1 rounded">
                                  {t('apikeys.revoke')}
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </section>

            <div className="p-4 bg-slate-50 border border-slate-100 rounded-xl text-xs text-slate-600">
              <div className="font-bold text-slate-700 mb-1.5">{t('apikeys.example')}</div>
              <pre className="bg-slate-900 text-slate-100 p-3 rounded-lg font-mono text-[11px] overflow-x-auto">
{`curl ${DEFAULT_API_URL}/reports/vat-summary \\
  -H "X-API-Key: otax_live_YOUR_KEY"`}
              </pre>
            </div>
          </div>
        );

      case 'webhooks':
        return (
          <div className="space-y-6">
            <div className="p-4 bg-cyan-50 border border-cyan-100 rounded-2xl text-xs text-cyan-800 flex items-start gap-3">
              <Webhook size={16} className="mt-0.5 flex-shrink-0 text-cyan-600" />
              <div>
                <div className="font-bold text-cyan-900 mb-0.5">{t('wh.outboundTitle')}</div>
                <p>{t('wh.outboundDesc')}</p>
              </div>
            </div>

            {/* Newly issued / rotated signing secret — shown once. */}
            {justCreatedSecret && (
              <section className="p-5 bg-amber-50 border-2 border-amber-300 rounded-2xl space-y-3">
                <div className="flex items-center gap-2">
                  <AlertCircle size={18} className="text-amber-600" />
                  <h4 className="text-sm font-bold text-amber-900">{t('wh.saveSecretNow')}</h4>
                </div>
                <div className="flex items-stretch gap-2 bg-white border border-amber-200 rounded-xl overflow-hidden">
                  <code className="flex-1 px-4 py-3 font-mono text-xs text-slate-800 break-all">{justCreatedSecret}</code>
                  <button type="button" onClick={() => {
                    navigator.clipboard?.writeText(justCreatedSecret).then(() => {
                      setSecretCopied(true);
                      setTimeout(() => setSecretCopied(false), 2000);
                    });
                  }}
                    className="px-4 bg-amber-600 text-white text-xs font-bold flex items-center gap-1 hover:bg-amber-700">
                    <CopyIcon size={13} /> {secretCopied ? t('apikeys.copied') : t('apikeys.copy')}
                  </button>
                </div>
                <p className="text-[11px] text-amber-900">{t('wh.verifyHint')}</p>
                <button type="button" onClick={() => setJustCreatedSecret(null)}
                  className="text-xs text-amber-700 font-semibold hover:text-amber-900">
                  {t('apikeys.savedHide')}
                </button>
              </section>
            )}

            {/* Create form */}
            <section className="p-5 bg-white border border-gray-100 rounded-2xl space-y-3">
              <h4 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                <Plus size={15} className="text-cyan-600" /> {t('wh.add')}
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">{t('wh.endpointUrl')} *</label>
                  <input type="url" value={newWhUrl} onChange={e => setNewWhUrl(e.target.value)}
                    placeholder="https://your-app.example.com/otax/hook"
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm font-mono" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">{t('wh.descriptionLabel')}</label>
                  <input type="text" value={newWhDescription} onChange={e => setNewWhDescription(e.target.value)}
                    placeholder={t('wh.descriptionPh')}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
                </div>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">
                  {t('wh.events')} ({newWhEvents.length === 0 ? t('wh.eventsAll') : `${newWhEvents.length} ${t('wh.eventsSelected')}`})
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {webhooksSupportedEvents.map(ev => {
                    const sel = newWhEvents.includes(ev);
                    return (
                      <button key={ev} type="button"
                        onClick={() => setNewWhEvents(p => sel ? p.filter(e => e !== ev) : [...p, ev])}
                        className={`text-[10px] font-mono px-2 py-1 rounded-full border transition-colors ${
                          sel ? 'bg-cyan-600 text-white border-cyan-600' : 'bg-white text-slate-600 border-gray-200 hover:border-cyan-300'
                        }`}>
                        {ev}
                      </button>
                    );
                  })}
                </div>
                <p className="text-[10px] text-slate-400 mt-1">{t('wh.eventsHint')}</p>
              </div>
              {webhooksError && <div className="text-xs text-rose-600 flex items-center gap-1"><AlertCircle size={12} /> {webhooksError}</div>}
              <button type="button" onClick={createWebhook}
                className="inline-flex items-center gap-2 px-4 py-2 bg-cyan-600 text-white text-sm font-bold rounded-lg hover:bg-cyan-700">
                <Plus size={14} /> {t('wh.create')}
              </button>
            </section>

            {/* Existing webhooks */}
            <section className="bg-white border border-gray-100 rounded-2xl overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
                <h4 className="text-sm font-bold text-slate-800">{t('settings.webhooks')} ({webhooks.length})</h4>
                <button onClick={loadWebhooks} className="text-xs text-slate-500 hover:text-slate-700 flex items-center gap-1">
                  <RefreshCw size={12} /> {t('common.reload')}
                </button>
              </div>
              {webhooksLoading && <div className="p-8 text-center text-slate-400"><Loader2 size={22} className="animate-spin mx-auto" /></div>}
              {!webhooksLoading && webhooks.length === 0 && (
                <div className="p-8 text-center text-slate-400 text-sm">{t('wh.noWebhooks')}</div>
              )}
              {!webhooksLoading && webhooks.map(w => {
                const counts = w.deliveryCounts30d || {};
                const success = counts.success || 0;
                const failed = counts.failed || 0;
                const pending = counts.pending || 0;
                return (
                  <div key={w.id} className="border-t border-gray-50">
                    <div className="px-5 py-3 flex items-start gap-3 flex-wrap">
                      <div className="flex-1 min-w-[300px]">
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`w-2 h-2 rounded-full ${w.is_active ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                          <code className="text-xs font-mono text-slate-800 break-all">{w.url}</code>
                          <a href={w.url} target="_blank" rel="noopener noreferrer" className="text-slate-400 hover:text-slate-700"><ExternalLink size={12} /></a>
                        </div>
                        {w.description && <div className="text-[11px] text-slate-500 mb-1">{w.description}</div>}
                        <div className="flex flex-wrap gap-1 mb-1">
                          {(!w.events || w.events.length === 0)
                            ? <span className="text-[9px] font-bold bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded uppercase">{t('wh.allEvents')}</span>
                            : w.events.map((ev: string) => (
                                <span key={ev} className="text-[9px] font-mono bg-cyan-50 text-cyan-700 border border-cyan-100 px-1.5 py-0.5 rounded">{ev}</span>
                              ))
                          }
                        </div>
                        <div className="flex gap-3 text-[10px] text-slate-500">
                          <span>{t('wh.last30d')}: <span className="text-emerald-600 font-bold">{success}</span> {t('wh.success')}</span>
                          {failed > 0 && <span><span className="text-rose-600 font-bold">{failed}</span> {t('wh.failed')}</span>}
                          {pending > 0 && <span><span className="text-amber-600 font-bold">{pending}</span> {t('wh.pending')}</span>}
                          {w.last_used_at && <span>{t('wh.lastDelivery')}: {new Date(w.last_used_at).toLocaleString()}</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <button onClick={() => testWebhook(w.id)} title={t('wh.test')}
                          className="px-2 py-1 text-xs font-bold text-violet-600 hover:bg-violet-50 rounded flex items-center gap-1">
                          <FlaskConical size={12} /> {t('wh.test')}
                        </button>
                        <button onClick={() => openDeliveryLog(w.id)} title={t('wh.log')}
                          className="px-2 py-1 text-xs font-bold text-blue-600 hover:bg-blue-50 rounded flex items-center gap-1">
                          <FileText size={12} /> {t('wh.log')}
                        </button>
                        <button onClick={() => rotateWebhookSecret(w.id)} title={t('wh.rotate')}
                          className="px-2 py-1 text-xs font-bold text-amber-600 hover:bg-amber-50 rounded flex items-center gap-1">
                          <RotateCw size={12} /> {t('wh.rotate')}
                        </button>
                        <button onClick={() => toggleWebhookActive(w.id, w.is_active)}
                          className={`px-2 py-1 text-xs font-bold rounded ${w.is_active ? 'text-slate-600 hover:bg-slate-100' : 'text-emerald-600 hover:bg-emerald-50'}`}>
                          {w.is_active ? t('wh.disable') : t('wh.enable')}
                        </button>
                        <button onClick={() => deleteWebhook(w.id)} title={t('branches.delete')}
                          className="px-2 py-1 text-xs font-bold text-rose-600 hover:bg-rose-50 rounded">
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                    {/* Inline delivery log when this row is selected */}
                    {logSubId === w.id && (
                      <div className="border-t border-gray-50 bg-slate-50/50 px-5 py-3">
                        <div className="flex items-center justify-between mb-2">
                          <h5 className="text-xs font-bold text-slate-700">{t('wh.recentDeliveries')}</h5>
                          <button onClick={() => setLogSubId(null)} className="text-xs text-slate-400 hover:text-slate-600">{t('wh.hide')}</button>
                        </div>
                        {logLoading && <div className="text-center text-slate-400 py-4"><Loader2 size={16} className="animate-spin mx-auto" /></div>}
                        {!logLoading && logRows.length === 0 && <div className="text-xs text-slate-400 py-4 text-center">{t('wh.noDeliveries')}</div>}
                        {!logLoading && logRows.length > 0 && (
                          <div className="space-y-1 max-h-72 overflow-y-auto">
                            {logRows.map(d => {
                              const statusColor = d.status === 'success' ? 'text-emerald-700 bg-emerald-50 border-emerald-200'
                                : d.status === 'failed' ? 'text-rose-700 bg-rose-50 border-rose-200'
                                : 'text-amber-700 bg-amber-50 border-amber-200';
                              return (
                                <div key={d.id} className="flex items-center gap-2 text-[11px] bg-white border border-gray-100 rounded px-2 py-1">
                                  <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${statusColor}`}>{d.status}</span>
                                  <code className="font-mono text-slate-700">{d.event_type}</code>
                                  <span className="text-slate-400">{t('wh.attempt')} {d.attempts}</span>
                                  {d.last_status_code && <span className="text-slate-400">HTTP {d.last_status_code}</span>}
                                  <span className="ml-auto text-slate-400">{new Date(d.created_at).toLocaleString()}</span>
                                  {d.last_error && (
                                    <span title={d.last_error} className="text-rose-500 truncate max-w-[200px]">⚠ {d.last_error}</span>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </section>

            <div className="p-4 bg-slate-50 border border-slate-100 rounded-xl text-xs text-slate-600">
              <div className="font-bold text-slate-700 mb-1.5">{t('wh.verifyExample')}</div>
              <pre className="bg-slate-900 text-slate-100 p-3 rounded-lg font-mono text-[11px] overflow-x-auto">
{`import crypto from 'crypto';

app.post('/otax/hook', (req, res) => {
  const sig = req.headers['x-otax-signature'];
  const expected = crypto.createHmac('sha256', process.env.OTAX_SECRET)
    .update(JSON.stringify(req.body)).digest('hex');
  if (sig !== expected) return res.status(401).end();
  // process req.body here…
  res.json({ ok: true });
});`}
              </pre>
            </div>
          </div>
        );

      case 'compliance': {
        const countries: Record<string, string> = { 'EG': 'Egypt (ETA)', 'SA': 'Saudi Arabia (ZATCA)', 'AE': 'UAE (FTA)', 'JO': 'Jordan (ISTD)' };
        return (
          <div className="space-y-8">
            <section className="space-y-6">
              <div className="flex items-center justify-between p-8 bg-slate-900 rounded-[40px] text-white shadow-2xl relative overflow-hidden">
                <div className="absolute top-0 right-0 p-12 opacity-10 pointer-events-none"><Globe size={160} /></div>
                <div className="space-y-2 relative z-10">
                  <h4 className="text-2xl font-black text-white tracking-tight">{t('comp.heading')}</h4>
                  <p className="text-sm text-slate-400 font-medium">{t('comp.lockedTo')}</p>
                  <div className="inline-flex items-center gap-3 px-6 py-3 bg-white/10 border border-white/20 rounded-2xl mt-4">
                    <div className="w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center text-white font-bold shadow-lg shadow-blue-500/20">{selectedCountry}</div>
                    <span className="text-xl font-bold tracking-tight">{countries[selectedCountry] || 'Global (Standard)'}</span>
                    <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse ml-2" />
                  </div>
                </div>
                <div className="px-6 py-4 bg-white/5 border border-white/10 rounded-3xl backdrop-blur-sm self-start relative z-10">
                  <div className="flex items-center gap-2 text-emerald-400 font-bold text-xs uppercase tracking-widest"><Shield size={14} /> {t('comp.complianceActive')}</div>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="p-8 bg-blue-50 border border-blue-100/50 rounded-[40px] flex flex-col justify-center gap-4">
                  <h5 className="font-black text-slate-800 text-lg">{t('comp.systemLockdown')}</h5>
                  <p className="text-sm text-slate-500 leading-relaxed">{t('comp.lockdownDesc')}</p>
                </div>
                <div className="p-8 bg-gray-50 border border-gray-100 rounded-[40px] space-y-4">
                  <h5 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{t('comp.statusTitle')}</h5>
                  <div className="space-y-3">
                    {[
                      { label: t('comp.docSchema'), status: t('comp.docSchemaStatus') },
                      { label: t('comp.taxCalc'), status: t('comp.taxCalcStatus') },
                      { label: t('comp.digitalCerts'), status: t('comp.digitalCertsStatus') },
                    ].map((item, i) => (
                      <div key={i} className="flex items-center justify-between text-sm py-1">
                        <span className="text-slate-600 font-bold">{item.label}</span>
                        <span className="px-3 py-1 bg-white border border-gray-200 rounded-xl text-[10px] font-black text-slate-800 uppercase italic">{item.status}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </section>
          </div>
        );
      }

      default:
        return (
          <div className="flex flex-col items-center justify-center py-20 text-slate-400">
            <SettingsIcon size={48} className="mb-4 opacity-20" />
            <p className="text-sm">Configuration for {tabId} will be implemented here.</p>
          </div>
        );
    }
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto pb-6">
      {saveNotification && (
        <div className={`fixed top-4 right-4 z-50 px-6 py-4 rounded-2xl shadow-2xl animate-in slide-in-from-top-2 ${saveNotification.type === 'success' ? 'bg-emerald-600 text-white' : 'bg-rose-600 text-white'}`}>
          <div className="flex items-center gap-3">
            {saveNotification.type === 'success' ? <CheckCircle2 size={20} /> : <AlertCircle size={20} />}
            <span className="font-bold">{saveNotification.message}</span>
          </div>
        </div>
      )}
      <div className="bg-white rounded-[40px] shadow-2xl overflow-hidden flex flex-col md:flex-row min-h-[700px] border border-gray-100">
        <div className="w-full md:w-64 bg-gray-50 border-r border-gray-100 flex flex-col p-6 gap-2">
          {tabs.map((tab) => (
            <button key={tab.id} onClick={() => navigate(`/settings/${tab.id}`)} className={`flex items-center gap-3 px-4 py-3.5 rounded-2xl text-sm font-bold transition-all ${activeTab === tab.id ? 'bg-white text-blue-600 shadow-lg shadow-blue-900/5 border border-blue-50' : 'text-slate-400 hover:bg-white hover:text-slate-800'}`}>
              <div className={activeTab === tab.id ? 'text-blue-500' : 'text-slate-400'}>{tab.icon}</div>
              {tab.label}
            </button>
          ))}
          <div className="mt-auto p-4 bg-blue-600 rounded-[24px] text-white">
            <p className="text-[10px] font-bold opacity-70 uppercase mb-1">{t('settings.currentEnv')}</p>
            <p className="text-sm font-black">{t('settings.envProd')}</p>
          </div>
        </div>
        <div className="flex-1 p-10 overflow-y-auto bg-white">
          <div className="flex items-center gap-4 mb-10">
            <div className="p-3 bg-blue-50 rounded-2xl text-blue-600">{tabs.find(tab => tab.id === activeTab)?.icon}</div>
            <div>
              <h3 className="text-2xl font-extrabold text-slate-800 tracking-tight">{tabs.find(tab => tab.id === activeTab)?.label}</h3>
              <p className="text-xs text-slate-400 font-medium">{t('settings.configurePrefix')} {tabs.find(tab => tab.id === activeTab)?.label.toLowerCase()}</p>
            </div>
          </div>
          {(() => {
            // Super admin guard: must select org before using org-specific settings
            const userStr = localStorage.getItem('invoice_user');
            const isSuperAdmin = userStr ? JSON.parse(userStr).isSuperAdmin : false;
            const scopedOrgId = getScopedOrgId();

            if (isSuperAdmin && !scopedOrgId) {
              return (
                <div className="flex flex-col items-center justify-center py-20 text-center">
                  <div className="p-4 bg-amber-100 rounded-2xl mb-4">
                    <Building2 size={40} className="text-amber-600" />
                  </div>
                  <h3 className="text-xl font-bold text-slate-800 mb-2">{t('settings.selectOrg')}</h3>
                  <p className="text-sm text-slate-500 max-w-md">
                    {t('settings.selectOrgHint')}
                    <span className="font-bold text-amber-600 mx-1">{t('settings.dropdownTopbar')}</span>
                    {t('settings.beforeSettings')}
                  </p>
                </div>
              );
            }

            return renderContent(activeTab);
          })()}
          {/* Save Bar — inside the tab content area */}
          <div className="mt-10 bg-gray-50 border border-gray-200 px-6 py-4 flex items-center justify-between rounded-2xl">
            <div>
              <h1 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                <SettingsIcon size={20} className="text-blue-600" /> {t('settings.title')}
              </h1>
            </div>
            <button onClick={handleSaveAll} disabled={isSaving} className={`bg-emerald-600 text-white px-8 py-3 rounded-2xl font-bold flex items-center gap-2 hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-200 ${isSaving ? 'opacity-50 cursor-not-allowed' : ''}`}>
              {isSaving ? (<><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> {t('settings.saving')}</>) : (<><Save size={18} /> {t('settings.saveAll')}</>)}
            </button>
          </div>
        </div>
      </div>
      <ModernDialog isOpen={isDialogOpen} type={dialogType} title={dialogTitle} message={dialogMessage} onCancel={() => setIsDialogOpen(false)} onConfirm={() => setIsDialogOpen(false)} />
    </div>
  );
};

export default Settings;
