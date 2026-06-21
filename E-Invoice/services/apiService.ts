const getBaseUrl = () => {
    // If an environment variable is explicitly set, use it.
    if (import.meta.env.VITE_API_URL) return import.meta.env.VITE_API_URL.replace(/\/$/, '');

    // For local development (localhost or local network), utilize the Vite Proxy (/api)
    const hostname = window.location.hostname;
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname.startsWith('192.168.') || hostname.startsWith('10.')) {
        return '/api';
    }

    // Default Production URL (Render)
    return 'https://e-invoice-545y.onrender.com/api';
};

export const API_BASE = getBaseUrl();
export const API_URL = API_BASE;

/**
 * Get the scoped orgId query string for super admin org switching.
 * Returns '?orgId=X' or '&orgId=X' depending on whether URL already has params.
 * Returns '' if no org is scoped (regular user or super admin with no selection).
 */
export const getScopedOrgId = (): number | null => {
    try {
        const stored = localStorage.getItem('super_admin_scoped_org');
        if (stored) {
            const org = JSON.parse(stored);
            return org.id || null;
        }
    } catch { }
    return null;
};

/**
 * Append orgId to a URL if super admin has a scoped org selected.
 */
export const appendOrgScope = (url: string): string => {
    const orgId = getScopedOrgId();
    if (!orgId) return url;
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}orgId=${orgId}`;
};

// Local Signer Service (Configurable for Multi-Device Access)
const getSignerUrl = () => {
    try {
        const storedProps = localStorage.getItem('user_properties');
        if (storedProps) {
            const props = JSON.parse(storedProps);
            const signerUrlProp = props.find((p: any) => p.property_name === 'signer_bridge_url');
            if (signerUrlProp && signerUrlProp.property_value) {
                return signerUrlProp.property_value.replace(/\/$/, '') + '/api/signer';
            }
        }
    } catch (e) {
        console.warn('Failed to load custom signer URL', e);
    }
    return 'http://localhost:3001/api/signer';
};

export const SIGNER_API_URL = getSignerUrl();
export const SIGNER_BRIDGE_BASE = SIGNER_API_URL.replace('/signer', '');

console.log('[API Service] Active API URL:', API_URL);
console.log('[API Service] Signer API URL:', SIGNER_API_URL);

/**
 * Get auth headers with JWT Bearer token
 */
const getAuthHeaders = (): Record<string, string> => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const userStr = localStorage.getItem('invoice_user');
    if (userStr) {
        try {
            const user = JSON.parse(userStr);
            if (user.token) {
                headers['Authorization'] = `Bearer ${user.token}`;
            }
            // Fallback: also send X-User-ID for backward compatibility
            if (user.id) {
                headers['X-User-ID'] = String(user.id);
            }
        } catch (e) {
            console.warn('Failed to parse user from localStorage');
        }
    }
    return headers;
};

export const apiService = {
    async login(username: string, password: string, totpCode?: string) {
        const response = await fetch(`${API_URL}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password, totpCode }),
        });
        if (!response.ok) {
            const err = await response.json();
            // Surface the 2FA-required signal to the caller so it can pivot to the
            // code-entry screen instead of showing a generic "Login failed".
            const e: any = new Error(err.message || 'Login failed');
            e.twoFactorRequired = !!err.twoFactorRequired;
            throw e;
        }
        return response.json();
    },

    async signup(username: string, password: string, companyData: any) {
        const response = await fetch(`${API_URL}/signup`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password, companyData }),
        });
        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.message || 'Signup failed');
        }
        return response.json();
    },

    async checkHealth() {
        const response = await fetch(`${API_URL}/health`);
        return response.json();
    },

    async getDashboardSummary(period = '7days') {
        const headers = getAuthHeaders();
        if (!headers['Authorization'] && !headers['X-User-ID']) {
            console.warn('[API] getDashboardSummary cancelled: No user session found');
            return { success: false, message: 'Not logged in' };
        }

        const response = await fetch(appendOrgScope(`${API_URL}/dashboard/summary?period=${period}`), { headers });

        if (response.status === 401) {
            console.error('[API] Unauthorized access to dashboard summary.');
            throw new Error('Unauthorized');
        }

        if (!response.ok) throw new Error('Failed to fetch dashboard stats');
        return response.json();
    },

    async getInvoices() {
        const headers = getAuthHeaders();
        if (!headers['Authorization'] && !headers['X-User-ID']) return { success: true, invoices: [] };

        const response = await fetch(appendOrgScope(`${API_URL}/invoices`), { headers });
        if (response.status === 401) throw new Error('Unauthorized');
        if (!response.ok) throw new Error('Failed to fetch invoices');
        return response.json();
    },

    async getInvoiceDetails(uuid: string) {
        const headers = getAuthHeaders();
        if (!headers['Authorization']) throw new Error('Unauthorized');

        const response = await fetch(`${API_URL}/invoices/${uuid}/details`, { headers });

        if (response.status === 401) throw new Error('Unauthorized');
        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.message || 'Failed to fetch document details');
        }
        return response.json();
    }
};
