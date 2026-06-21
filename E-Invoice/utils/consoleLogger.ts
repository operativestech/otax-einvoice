/**
 * Live Operations Console logger.
 *
 * Two ways to get events into the console strip at the bottom of the app:
 *
 *   1. Explicit: call `logEvent('Something happened', 'info')` from any page.
 *      Use this for high-signal events like "Invoice submitted" that deserve
 *      a human-friendly message.
 *
 *   2. Automatic: the fetch interceptor (installed once by `installFetchInterceptor`
 *      in App.tsx) watches every HTTP call to `/api/*` and logs mutations
 *      (POST / PUT / PATCH / DELETE) plus any error response on ANY method.
 *      This gives the user a "nothing slips through" feeling — even obscure
 *      deletes that the page author forgot to log show up here.
 *
 * The channel is a `window` CustomEvent named `live-console-log`; LiveConsole.tsx
 * listens and renders the stream.
 */

export type LogType = 'info' | 'success' | 'warning' | 'error';

/** Dispatch one console entry. Safe to call before the listener is mounted — events are simply dropped. */
export function logEvent(message: string, type: LogType = 'info'): void {
    try {
        window.dispatchEvent(new CustomEvent('live-console-log', { detail: { message, type } }));
    } catch { /* SSR / test env — no-op */ }
}

// ──────────────────────────────────────────────────────────────────────
// Fetch interceptor
// ──────────────────────────────────────────────────────────────────────

/** Map an API path like `/api/admin/branches/5` to a friendlier "Branches" label. */
function prettifyPath(path: string): string {
    // strip query + trailing slashes, keep the first 3 segments max
    const clean = path.split('?')[0].replace(/\/+$/, '');
    const m = clean.match(/\/api\/([^/]+)(?:\/([^/]+))?(?:\/([^/]+))?/);
    if (!m) return clean;

    const segment = (m[2] && !/^\d+$/.test(m[2])) ? `${m[1]}/${m[2]}` : m[1];
    const labels: Record<string, string> = {
        'admin/api-keys':       'API Keys',
        'admin/branches':       'Branches',
        'admin/organization':   'Organization',
        'admin/users':          'User Management',
        'admin/invitations':    'Invitations',
        'master-data/customers':'Customers',
        'reports/archive':      'Archive ZIP',
        'reports':              'Reports',
        'reconciliation':       'Reconciliation',
        'signing':              'Signing',
        'assistant':            'Assistant',
        'settings':             'Settings',
        'eta':                  'ETA',
        'excel':                'Excel',
        'invoices':             'Invoices',
        'auth':                 'Auth',
        'master-data':          'Master Data',
    };
    return labels[segment] || labels[m[1]] || m[1];
}

/** Emoji prefix that helps the user scan the stream at a glance. */
function iconFor(method: string, ok: boolean): string {
    if (!ok) return '❌';
    switch (method) {
        case 'POST':   return '➕';
        case 'PUT':
        case 'PATCH':  return '✏️';
        case 'DELETE': return '🗑️';
        default:       return '📡';
    }
}

let installed = false;

/**
 * Wrap window.fetch so every call to the app's API emits a console entry.
 * Call once, at app startup.
 *
 * Safety:
 *   - Only logs calls whose URL contains `/api/`, so third-party fetches
 *     (Google fonts, GA, etc.) stay invisible.
 *   - Errors during event dispatch are swallowed — the wrapper must never
 *     break the original fetch contract.
 *   - The original `fetch` is preserved via closure and re-awaited as normal.
 */
export function installFetchInterceptor(): void {
    if (installed || typeof window === 'undefined' || typeof window.fetch !== 'function') return;
    installed = true;

    const originalFetch = window.fetch.bind(window);

    // Paths where seeing a POST every few seconds would flood the console
    // (heartbeats, polls, search-as-you-type). These still log on ERROR.
    const QUIET_PATHS = [
        '/api/signing/queue/stats',
        '/api/signing/agent-status',
        '/api/health',
        '/api/dashboard',
        '/api/auth/verify',
        '/api/assistant/chat',
        '/api/master-data/customers', // typeahead
        '/api/cache/clear',
    ];

    const shouldSuppress = (url: string, method: string): boolean => {
        if (method === 'GET') return true;   // never auto-log plain GET success
        return QUIET_PATHS.some(p => url.includes(p));
    };

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const url = typeof input === 'string' ? input : (input instanceof URL ? input.toString() : input.url);
        const method = (init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();

        const started = performance.now();
        let response: Response;
        try {
            response = await originalFetch(input as any, init);
        } catch (err: any) {
            // Network-level failure (offline, CORS, DNS, etc.) — always log.
            if (url.includes('/api/')) {
                logEvent(`❌ ${method} ${prettifyPath(url)} — ${err?.message || 'network error'}`, 'error');
            }
            throw err;
        }

        if (!url.includes('/api/')) return response;

        const duration = Math.round(performance.now() - started);
        const ok = response.ok;
        const label = prettifyPath(url);
        const icon = iconFor(method, ok);

        if (!ok) {
            // Always log failures, regardless of the quiet-list.
            logEvent(`${icon} ${method} ${label} → HTTP ${response.status} (${duration}ms)`, 'error');

            // Session-expired handling. If a single 401 arrives while we have a
            // token in localStorage, count it; once we've seen ≥3 across the
            // app, the token is definitely stale → clear the session and
            // bounce the user to /login. We avoid acting on the very first 401
            // because some endpoints (login, public docs) legitimately 401.
            if (response.status === 401 && !url.includes('/auth/')) {
                handle401();
            }
        } else if (!shouldSuppress(url, method)) {
            logEvent(`${icon} ${method} ${label} (${duration}ms)`, method === 'DELETE' ? 'warning' : 'success');
        }
        return response;
    };
}

// ──────────────────────────────────────────────────────────────────────
// 401 watchdog — counts unauthenticated responses and forces a relogin
// when the user's token is clearly stale (≥3 fails in 10s).
// ──────────────────────────────────────────────────────────────────────

let auth401Count = 0;
let auth401Reset: ReturnType<typeof setTimeout> | null = null;
let alreadyBounced = false;

function handle401() {
    if (alreadyBounced) return;
    // Don't bounce if there's no token to begin with — that just means
    // the user is on the login page already.
    try {
        const u = JSON.parse(localStorage.getItem('invoice_user') || '{}');
        if (!u?.token) return;
    } catch { return; }

    auth401Count++;
    if (auth401Reset) clearTimeout(auth401Reset);
    auth401Reset = setTimeout(() => { auth401Count = 0; }, 10_000);

    if (auth401Count >= 3) {
        alreadyBounced = true;
        logEvent('🔒 Session expired — please sign in again.', 'warning');
        try {
            localStorage.removeItem('invoice_user');
            localStorage.removeItem('token');
            localStorage.removeItem('user_properties');
        } catch {}
        // Soft redirect — don't disturb the location stack so the user can
        // come back to the same page after re-login.
        if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
            window.location.href = '/login';
        }
    }
}
