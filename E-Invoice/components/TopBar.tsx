
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Bell, User, LogOut, ChevronDown, Circle, FileSignature, AlertTriangle, Languages, Check, FileSpreadsheet, Mail, AlertCircle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { User as UserType } from '../types';
import { API_URL } from '../services/apiService';
import { useTranslation } from '../i18n';

// ── Notification feed types — mirrors the backend's NotificationRow ────
interface NotifRow {
  id: number;
  kind: string;
  title: string;
  message: string | null;
  href: string | null;
  metadata: any | null;
  read_at: string | null;
  created_at: string;
}

// Pick an icon + accent colour for the row based on the `kind` string.
// Keep this list in sync with the kinds the backend emits (notificationsFeed.ts
// + scheduledReportsWorker.ts).
function notifVisuals(kind: string): { Icon: any; tint: string; bg: string } {
  switch (kind) {
    case 'report_sent':       return { Icon: FileSpreadsheet, tint: 'text-blue-600',   bg: 'bg-blue-50' };
    case 'sync_failed':       return { Icon: AlertTriangle,   tint: 'text-rose-600',   bg: 'bg-rose-50' };
    case 'invoice_rejected':  return { Icon: AlertCircle,     tint: 'text-amber-600',  bg: 'bg-amber-50' };
    case 'email_sent':        return { Icon: Mail,            tint: 'text-emerald-600',bg: 'bg-emerald-50' };
    default:                  return { Icon: Bell,            tint: 'text-slate-500',  bg: 'bg-slate-50' };
  }
}

// Tight relative-time formatter — "5m", "2h", "3d", "12 Apr".
function relTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (isNaN(t)) return '';
  const diffSec = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (diffSec < 60)        return `${diffSec}s`;
  if (diffSec < 3600)      return `${Math.floor(diffSec / 60)}m`;
  if (diffSec < 86_400)    return `${Math.floor(diffSec / 3600)}h`;
  if (diffSec < 30 * 86_400) return `${Math.floor(diffSec / 86_400)}d`;
  return new Date(iso).toLocaleDateString();
}

interface TopBarProps {
  user: UserType | null;
  isOnline: boolean;
  onLogout: () => void;
  onToggleNetwork: () => void;
  companyName: string;
}

const TopBar: React.FC<TopBarProps> = ({ user, isOnline, onLogout, onToggleNetwork, companyName }) => {
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const isSuperAdmin = user?.isSuperAdmin || false;
  const { lang, setLang, t } = useTranslation();

  // ── Signing Queue stats (polls every 30s) ──
  const [queueStats, setQueueStats] = useState<{ queued: number; failed: number } | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Notifications feed (Facebook-style bell) ──
  // Polls every 30s for the unread count. The full list is fetched lazily
  // when the user clicks the bell so the TopBar doesn't carry the data
  // until it's actually needed.
  const [notifOpen, setNotifOpen]       = useState(false);
  const [notifRows, setNotifRows]       = useState<NotifRow[]>([]);
  const [notifUnread, setNotifUnread]   = useState(0);
  const [notifLoading, setNotifLoading] = useState(false);
  const notifTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const notifPanelRef = useRef<HTMLDivElement | null>(null);

  const fetchNotifs = useCallback(async () => {
    try {
      const userStr = localStorage.getItem('invoice_user');
      const token = userStr ? JSON.parse(userStr).token : localStorage.getItem('token');
      if (!token) return;
      const res = await fetch(`${API_URL}/notifications?limit=30`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      if (data.success) {
        setNotifRows(Array.isArray(data.rows) ? data.rows : []);
        setNotifUnread(Number(data.unread || 0));
      }
    } catch { /* silent */ }
  }, []);

  // Light unread-count poll (no full payload) — just bumps the badge.
  useEffect(() => {
    if (!user) return;
    fetchNotifs();
    notifTimerRef.current = setInterval(fetchNotifs, 30_000);
    return () => { if (notifTimerRef.current) clearInterval(notifTimerRef.current); };
  }, [user, fetchNotifs]);

  // Click-outside handler to close the dropdown.
  useEffect(() => {
    if (!notifOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (notifPanelRef.current && !notifPanelRef.current.contains(e.target as Node)) {
        setNotifOpen(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [notifOpen]);

  // Open bell → refresh + show panel.
  const toggleNotifPanel = () => {
    if (!notifOpen) {
      setNotifLoading(true);
      void fetchNotifs().finally(() => setNotifLoading(false));
    }
    setNotifOpen(o => !o);
  };

  // Click a row: mark read, then open the linked page in a NEW TAB so the
  // user keeps their current OTax session intact (no jarring navigation).
  const onNotifClick = async (row: NotifRow) => {
    try {
      const userStr = localStorage.getItem('invoice_user');
      const token = userStr ? JSON.parse(userStr).token : localStorage.getItem('token');
      if (token && !row.read_at) {
        await fetch(`${API_URL}/notifications/${row.id}/read`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        }).catch(() => { /* best effort */ });
      }
    } catch { /* silent */ }

    // Optimistic UI: mark this row read locally + decrement badge.
    setNotifRows(prev => prev.map(r => r.id === row.id ? { ...r, read_at: new Date().toISOString() } : r));
    if (!row.read_at) setNotifUnread(n => Math.max(0, n - 1));

    // Open the deep-link in a new tab. Falls back to /notifications when
    // the row didn't carry an explicit href.
    const target = row.href || '/notifications';
    window.open(target, '_blank', 'noopener,noreferrer');
  };

  const onMarkAllRead = async () => {
    try {
      const userStr = localStorage.getItem('invoice_user');
      const token = userStr ? JSON.parse(userStr).token : localStorage.getItem('token');
      if (token) {
        await fetch(`${API_URL}/notifications/read-all`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        });
      }
    } catch { /* silent */ }
    const now = new Date().toISOString();
    setNotifRows(prev => prev.map(r => r.read_at ? r : { ...r, read_at: now }));
    setNotifUnread(0);
  };

  useEffect(() => {
    if (!user || isSuperAdmin) return;
    const load = async () => {
      try {
        const userStr = localStorage.getItem('invoice_user');
        const token = userStr ? JSON.parse(userStr).token : localStorage.getItem('token');
        if (!token) return;
        const res = await fetch(`${API_URL}/signing/queue/stats`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const data = await res.json();
        if (data.success) setQueueStats({ queued: data.queued || 0, failed: data.failed || 0 });
      } catch { /* silent — indicator is best-effort */ }
    };
    load();
    timerRef.current = setInterval(load, 30_000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [user, isSuperAdmin]);

  return (
    <header className="bg-white border-b border-gray-200 h-16 flex items-center justify-between px-6 z-30 shadow-sm shrink-0">
      <div className="flex items-center gap-4">
        {isSuperAdmin ? (
          <>
            <h2 className="text-xl font-semibold text-slate-800">⚡ OTax Admin Panel</h2>
          </>
        ) : (
          <>
            <h2 className="text-xl font-semibold text-slate-800">{companyName}</h2>
            <div className="h-6 w-px bg-gray-200 mx-2" />
            <button
              onClick={onToggleNetwork}
              className="flex items-center gap-2 px-3 py-1 rounded-full bg-gray-100 hover:bg-gray-200 transition-colors"
            >
              <Circle size={10} className={isOnline ? 'fill-green-500 text-green-500' : 'fill-red-500 text-red-500'} />
              <span className="text-xs font-medium uppercase tracking-wider text-slate-600">
                ETA: {isOnline ? 'Online' : 'Offline'}
              </span>
            </button>
          </>
        )}
      </div>

      <div className="flex items-center gap-6">
        {!isSuperAdmin && queueStats && (queueStats.queued > 0 || queueStats.failed > 0) && (
          <Link
            to="/settings/tokensign"
            title={`Signing queue — ${queueStats.queued} pending${queueStats.failed ? `, ${queueStats.failed} failed` : ''}`}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-semibold transition-colors ${
              queueStats.failed > 0
                ? 'bg-red-50 border-red-200 text-red-700 hover:bg-red-100'
                : 'bg-amber-50 border-amber-200 text-amber-700 hover:bg-amber-100'
            }`}
          >
            {queueStats.failed > 0 ? <AlertTriangle size={14} /> : <FileSignature size={14} />}
            <span>
              {queueStats.queued > 0 && `${queueStats.queued} queued`}
              {queueStats.queued > 0 && queueStats.failed > 0 && ' · '}
              {queueStats.failed > 0 && `${queueStats.failed} failed`}
            </span>
          </Link>
        )}
        {/* ── Notification bell + dropdown ──────────────────────────── */}
        <div className="relative" ref={notifPanelRef}>
          <button
            type="button"
            onClick={toggleNotifPanel}
            className="relative p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
            title={t('notifFeed.title')}
            aria-label={t('notifFeed.title')}
          >
            <Bell size={20} className="text-slate-500 hover:text-blue-600 transition-colors" />
            {notifUnread > 0 && (
              // Red unread badge — caps at "9+" so it never overflows the icon.
              <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 bg-red-500 text-white text-[10px] font-bold flex items-center justify-center rounded-full border-2 border-white">
                {notifUnread > 9 ? '9+' : notifUnread}
              </span>
            )}
          </button>

          {notifOpen && (
            // Wide dropdown — Facebook-style. Sits to the left so it doesn't
            // clip the right edge of the viewport on narrow displays.
            <div className="absolute right-0 mt-2 w-[360px] max-w-[92vw] bg-white border border-gray-200 rounded-2xl shadow-xl overflow-hidden z-50 animate-in fade-in slide-in-from-top-2 duration-150">
              {/* Header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-gradient-to-b from-gray-50 to-white">
                <div className="flex items-center gap-2">
                  <Bell size={14} className="text-slate-600" />
                  <span className="text-sm font-bold text-slate-800">{t('notifFeed.title')}</span>
                  {notifUnread > 0 && (
                    <span className="text-[10px] font-bold text-red-700 bg-red-50 border border-red-100 px-1.5 py-0.5 rounded-full">
                      {notifUnread} {t('notifFeed.new')}
                    </span>
                  )}
                </div>
                {notifUnread > 0 && (
                  <button
                    onClick={onMarkAllRead}
                    className="text-[11px] font-bold text-blue-600 hover:text-blue-700 flex items-center gap-1"
                  >
                    <Check size={11} /> {t('notifFeed.markAll')}
                  </button>
                )}
              </div>

              {/* Body */}
              <div className="max-h-[420px] overflow-y-auto">
                {notifLoading && (
                  <div className="text-center py-6 text-slate-400 text-xs">{t('common.loading')}</div>
                )}
                {!notifLoading && notifRows.length === 0 && (
                  <div className="text-center py-10 text-slate-400 text-sm flex flex-col items-center gap-2">
                    <Bell size={28} className="text-slate-300" />
                    <span>{t('notifFeed.empty')}</span>
                  </div>
                )}
                {!notifLoading && notifRows.map(row => {
                  const v = notifVisuals(row.kind);
                  const unread = !row.read_at;
                  return (
                    <button
                      key={row.id}
                      onClick={() => onNotifClick(row)}
                      className={`w-full text-left px-3 py-2.5 flex items-start gap-2.5 border-b border-gray-50 last:border-b-0 transition-colors ${
                        unread ? 'bg-blue-50/40 hover:bg-blue-50' : 'hover:bg-gray-50'
                      }`}
                    >
                      {/* Icon disc — colour matches the kind. */}
                      <div className={`shrink-0 w-9 h-9 rounded-full flex items-center justify-center ${v.bg}`}>
                        <v.Icon size={16} className={v.tint} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <p className={`text-xs leading-snug line-clamp-2 ${unread ? 'font-bold text-slate-900' : 'font-medium text-slate-700'}`}>
                            {row.title}
                          </p>
                          {unread && <span className="shrink-0 w-2 h-2 bg-blue-600 rounded-full mt-1" />}
                        </div>
                        {row.message && (
                          <p className="text-[11px] text-slate-500 line-clamp-1 mt-0.5">{row.message}</p>
                        )}
                        <p className="text-[10px] text-slate-400 font-mono mt-0.5">{relTime(row.created_at)}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Language toggle — single-click flip between EN and AR. Flips HTML dir so
            the layout mirrors correctly without a global CSS rebuild. */}
        <button
          type="button"
          onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold bg-white hover:bg-gray-50 border border-gray-200 rounded-lg transition-colors"
          title={lang === 'ar' ? 'Switch to English' : 'التبديل إلى العربية'}
        >
          <Languages size={14} className="text-slate-500" />
          <span className="font-mono tracking-wider">{lang === 'ar' ? 'EN' : 'ع'}</span>
        </button>

        <div className="relative">
          <button
            onClick={() => setIsDropdownOpen(!isDropdownOpen)}
            className="flex items-center gap-3 hover:bg-gray-50 p-1 rounded-lg transition-colors"
          >
            <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center font-bold">
              {user?.name?.[0] || 'U'}
            </div>
            <div className="hidden md:block text-left">
              <p className="text-sm font-semibold text-slate-800">{user?.name || user?.username || 'Guest User'}</p>
              <p className="text-xs text-slate-500">{user?.role || 'User'}</p>
            </div>
            <ChevronDown size={16} className={`text-slate-400 transition-transform ${isDropdownOpen ? 'rotate-180' : ''}`} />
          </button>

          {isDropdownOpen && (
            <div className="absolute right-0 mt-2 w-48 bg-white border border-gray-200 rounded-xl shadow-lg py-2 overflow-hidden">
              <button
                onClick={() => {
                  setIsDropdownOpen(false);
                  window.location.href = '/profile';
                }}
                className="w-full px-4 py-2 text-sm text-slate-700 hover:bg-gray-50 flex items-center gap-2"
              >
                <User size={16} /> Profile Settings
              </button>
              <div className="h-px bg-gray-100 my-1" />
              <button
                onClick={onLogout}
                className="w-full px-4 py-2 text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
              >
                <LogOut size={16} /> Sign Out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};

export default TopBar;
