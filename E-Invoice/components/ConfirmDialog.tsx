/**
 * Centralised in-app dialog system — replaces the ugly browser-native
 * `confirm()` / `alert()` popups with a styled card centered on the screen.
 *
 * Architecture:
 *   - One `<DialogHost />` mounts at the App root and renders the modal.
 *   - Anywhere in the app you import `confirmDialog()` / `alertDialog()` and
 *     `await` the result. They return a Promise so the call site reads almost
 *     identically to the native API:
 *
 *       if (!(await confirmDialog({ message: 'Delete?' }))) return;
 *       await alertDialog({ message: 'Saved.' });
 *
 *   - Communication is a module-level singleton listener (the host registers
 *     itself on mount). No React context required, so non-component modules
 *     (utils/export.ts) can call it too.
 *
 * Tones: default | danger | warning | success | info — drives icon + button
 * color. `alertDialog()` defaults to `info`; `confirmDialog()` to `default`.
 *
 * Keyboard: Enter = confirm, Escape = cancel. Click on the backdrop also
 * cancels. Focus is trapped on the primary action.
 */

import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, Info, HelpCircle, X } from 'lucide-react';

export type DialogTone = 'default' | 'danger' | 'warning' | 'success' | 'info';

export interface DialogOptions {
    title?: string;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
    tone?: DialogTone;
    /** Internal flag — set by alertDialog() to hide the Cancel button. */
    alertOnly?: boolean;
}

type Resolver = (value: boolean) => void;
type Listener = (opts: DialogOptions, resolve: Resolver) => void;

// Module-level singleton — set when the host mounts, cleared on unmount.
let activeListener: Listener | null = null;

/** Show a confirm dialog. Resolves to `true` on OK, `false` on Cancel/ESC/backdrop. */
export function confirmDialog(opts: DialogOptions): Promise<boolean> {
    return new Promise((resolve) => {
        if (!activeListener) {
            // Host hasn't mounted yet (e.g. very early bootstrap) — fall back
            // to native so we don't lose the prompt.
            resolve(window.confirm(opts.message));
            return;
        }
        activeListener({ ...opts, alertOnly: false }, resolve);
    });
}

/** Show an alert dialog. Resolves when the user dismisses it (always `true`). */
export function alertDialog(opts: DialogOptions): Promise<void> {
    return new Promise((resolve) => {
        if (!activeListener) {
            window.alert(opts.message);
            resolve();
            return;
        }
        activeListener({ ...opts, alertOnly: true }, () => resolve());
    });
}

// ── Tone → visual styling ────────────────────────────────────────────────
function toneVisuals(tone: DialogTone) {
    switch (tone) {
        case 'danger':
            return {
                Icon: AlertCircle,
                iconBg: 'bg-rose-100',
                iconFg: 'text-rose-600',
                primaryBtn: 'bg-rose-600 hover:bg-rose-700',
            };
        case 'warning':
            return {
                Icon: AlertTriangle,
                iconBg: 'bg-amber-100',
                iconFg: 'text-amber-600',
                primaryBtn: 'bg-amber-600 hover:bg-amber-700',
            };
        case 'success':
            return {
                Icon: CheckCircle2,
                iconBg: 'bg-emerald-100',
                iconFg: 'text-emerald-600',
                primaryBtn: 'bg-emerald-600 hover:bg-emerald-700',
            };
        case 'info':
            return {
                Icon: Info,
                iconBg: 'bg-blue-100',
                iconFg: 'text-blue-600',
                primaryBtn: 'bg-blue-600 hover:bg-blue-700',
            };
        default:
            return {
                Icon: HelpCircle,
                iconBg: 'bg-blue-100',
                iconFg: 'text-blue-600',
                primaryBtn: 'bg-blue-600 hover:bg-blue-700',
            };
    }
}

// ─── Toast system ────────────────────────────────────────────────────────
//
// Distinct from the modal dialogs above. A toast is a small floating card
// in the top-right that auto-dismisses after a few seconds — used for
// "Settings saved" / "Layout saved" feedback that doesn't need the user
// to click anything. Multiple toasts stack vertically.
//
// Usage anywhere:
//
//   import { toast } from '../components/ConfirmDialog';
//   toast({ title: 'Saved', message: 'Schedule updated.', tone: 'success' });

export interface ToastOptions {
    title?:      string;
    message:     string;
    tone?:       DialogTone;
    /** ms before auto-dismiss; default 3000. Set to 0 to keep it pinned. */
    durationMs?: number;
}

interface ActiveToast {
    id:   number;
    opts: ToastOptions;
}

let toastListener: ((opts: ToastOptions, id: number) => void) | null = null;
let nextToastId = 1;

/** Fire a toast. No-op fallback to console if `<ToastHost />` isn't mounted yet. */
export function toast(opts: ToastOptions): void {
    if (!toastListener) {
        console.log(`[Toast:${opts.tone || 'default'}] ${opts.title || ''} ${opts.message}`);
        return;
    }
    toastListener(opts, nextToastId++);
}

export const ToastHost: React.FC = () => {
    const [toasts, setToasts] = useState<ActiveToast[]>([]);
    const timersRef = useRef<Record<number, ReturnType<typeof setTimeout>>>({});

    useEffect(() => {
        toastListener = (opts, id) => {
            setToasts(prev => [...prev, { id, opts }]);
            const duration = opts.durationMs ?? 3000;
            if (duration > 0) {
                timersRef.current[id] = setTimeout(() => {
                    setToasts(prev => prev.filter(t => t.id !== id));
                    delete timersRef.current[id];
                }, duration);
            }
        };
        return () => {
            toastListener = null;
            for (const id of Object.keys(timersRef.current)) clearTimeout(timersRef.current[Number(id)]);
        };
    }, []);

    const dismiss = (id: number) => {
        if (timersRef.current[id]) {
            clearTimeout(timersRef.current[id]);
            delete timersRef.current[id];
        }
        setToasts(prev => prev.filter(t => t.id !== id));
    };

    if (toasts.length === 0) return null;
    return (
        <div className="fixed top-4 right-4 z-[10000] flex flex-col gap-2 pointer-events-none max-w-[calc(100vw-2rem)]">
            {toasts.map(t => {
                const v = toneVisuals(t.opts.tone || 'success');
                return (
                    <div
                        key={t.id}
                        className="pointer-events-auto bg-white rounded-2xl shadow-2xl border border-gray-100 w-[320px] sm:w-[360px] overflow-hidden animate-in slide-in-from-right-4 fade-in duration-200"
                    >
                        <div className="p-4 flex items-start gap-3">
                            <div className={`shrink-0 w-10 h-10 rounded-xl flex items-center justify-center ${v.iconBg}`}>
                                <v.Icon className={v.iconFg} size={20} />
                            </div>
                            <div className="flex-1 min-w-0">
                                {t.opts.title && (
                                    <h4 className="text-sm font-bold text-slate-800 leading-snug">{t.opts.title}</h4>
                                )}
                                <p className={`text-xs text-slate-600 leading-relaxed whitespace-pre-line ${t.opts.title ? 'mt-0.5' : ''}`}>
                                    {t.opts.message}
                                </p>
                            </div>
                            <button
                                onClick={() => dismiss(t.id)}
                                aria-label="Dismiss"
                                className="shrink-0 p-1 text-slate-400 hover:text-slate-700 hover:bg-gray-100 rounded"
                            >
                                <X size={14} />
                            </button>
                        </div>
                    </div>
                );
            })}
        </div>
    );
};

/**
 * Mounts once at the App root. Listens for confirmDialog/alertDialog calls
 * via the module-level singleton and renders a single modal at a time.
 */
export const DialogHost: React.FC = () => {
    const [state, setState] = useState<{ opts: DialogOptions; resolve: Resolver } | null>(null);
    const primaryBtnRef = useRef<HTMLButtonElement>(null);

    // Register the listener — late mount means earlier calls fall back to
    // native, but in practice the App tree is established before any user
    // action can fire.
    useEffect(() => {
        activeListener = (opts, resolve) => setState({ opts, resolve });
        return () => { activeListener = null; };
    }, []);

    // Auto-focus the primary action so Enter immediately confirms.
    useEffect(() => {
        if (state) {
            const t = setTimeout(() => primaryBtnRef.current?.focus(), 30);
            return () => clearTimeout(t);
        }
    }, [state]);

    // Keyboard shortcuts.
    useEffect(() => {
        if (!state) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') close(false);
            else if (e.key === 'Enter') {
                // Avoid double-fire when the focused button already handles Enter.
                if (document.activeElement === primaryBtnRef.current) return;
                close(true);
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [state]);

    const close = (value: boolean) => {
        if (!state) return;
        const r = state.resolve;
        setState(null);
        r(value);
    };

    if (!state) return null;
    const { opts } = state;

    const tone: DialogTone = opts.tone || (opts.alertOnly ? 'info' : 'default');
    const v = toneVisuals(tone);
    const okLabel = opts.confirmLabel || (opts.alertOnly ? 'OK' : 'Confirm');
    const cancelLabel = opts.cancelLabel || 'Cancel';

    return (
        <div
            // Top-most z-index so it floats above sidebar, modals, charts, everything.
            className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-in fade-in duration-150"
            onClick={() => close(false)}
            role="dialog"
            aria-modal="true"
        >
            <div
                onClick={(e) => e.stopPropagation()}
                className="relative bg-white rounded-3xl shadow-2xl border border-gray-100 max-w-md w-full overflow-hidden animate-in zoom-in-95 fade-in duration-200"
            >
                {/* Header strip — subtle gradient accent in the tone color. */}
                <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-transparent via-current to-transparent opacity-30" style={{ color: 'inherit' }} />

                {/* Body */}
                <div className="p-6 sm:p-7">
                    <div className="flex items-start gap-4">
                        <div className={`shrink-0 w-12 h-12 rounded-2xl flex items-center justify-center ${v.iconBg}`}>
                            <v.Icon className={v.iconFg} size={24} />
                        </div>
                        <div className="flex-1 min-w-0 pt-1">
                            {opts.title && (
                                <h3 className="text-lg font-bold text-slate-800 leading-snug">{opts.title}</h3>
                            )}
                            <p className={`text-sm text-slate-600 leading-relaxed whitespace-pre-line ${opts.title ? 'mt-1.5' : ''}`}>
                                {opts.message}
                            </p>
                        </div>
                        {/* Always-visible close (X). Acts as cancel. */}
                        <button
                            type="button"
                            onClick={() => close(false)}
                            aria-label="Close"
                            className="shrink-0 -mt-1 -mr-1 p-1.5 text-slate-400 hover:text-slate-700 hover:bg-gray-100 rounded-lg transition-colors"
                        >
                            <X size={16} />
                        </button>
                    </div>
                </div>

                {/* Footer with action buttons */}
                <div className="px-6 sm:px-7 pb-6 sm:pb-7 flex items-center justify-end gap-2">
                    {!opts.alertOnly && (
                        <button
                            type="button"
                            onClick={() => close(false)}
                            className="px-5 py-2.5 bg-white border border-gray-200 text-slate-700 rounded-xl text-sm font-bold hover:bg-gray-50 transition-colors"
                        >
                            {cancelLabel}
                        </button>
                    )}
                    <button
                        ref={primaryBtnRef}
                        type="button"
                        onClick={() => close(true)}
                        className={`px-5 py-2.5 ${v.primaryBtn} text-white rounded-xl text-sm font-bold shadow-md transition-colors`}
                    >
                        {okLabel}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default DialogHost;
