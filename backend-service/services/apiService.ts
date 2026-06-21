// Dynamically determine API URL based on current host
// Production backend is on Render, local backend is on :3001
const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const API_BASE = isLocal
    ? `${window.location.protocol}//${window.location.hostname}:3001`
    : 'https://e-invoice-545y.onrender.com';

const API_URL = `${API_BASE}/api`;

// The signer MUST always be local because it talks to the physical USB token
const SIGNER_API_URL = 'http://localhost:3001/api/signer';

// Save for other components to use
localStorage.setItem('API_BASE_URL', API_BASE);
localStorage.setItem('API_URL', API_URL);


export const apiService = {
    async login(username, password) {
        const response = await fetch(`${API_URL}/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password }),
        });
        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.message || 'Login failed');
        }
        return response.json();
    },

    async signup(username, password, companyData) {
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
        const user = JSON.parse(localStorage.getItem('invoice_user') || '{}');
        const response = await fetch(`${API_URL}/dashboard/summary?period=${period}`, {
            headers: { 'X-User-ID': user.id || '' }
        });
        if (!response.ok) throw new Error('Failed to fetch dashboard stats');
        return response.json();
    },

    async getInvoices() {
        const user = JSON.parse(localStorage.getItem('invoice_user') || '{}');
        const response = await fetch(`${API_URL}/invoices`, {
            headers: { 'X-User-ID': user.id || '' }
        });
        if (!response.ok) throw new Error('Failed to fetch invoices');
        return response.json();
    },

    async getInvoiceDetails(uuid: string) {
        const user = JSON.parse(localStorage.getItem('invoice_user') || '{}');
        const response = await fetch(`${API_URL}/invoices/${uuid}/details`, {
            headers: { 'X-User-ID': user.id || '' }
        });
        if (!response.ok) throw new Error('Failed to fetch document details');
        return response.json();
    }
};
