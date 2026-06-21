/**
 * ETAService — Central ETA (Egyptian Tax Authority) API Service
 *
 * Wraps all 19 ETA e-invoicing endpoints into a single, org-aware service class.
 * Handles token caching, environment switching (Prod/PreProd), and error handling.
 */

import axios, { AxiosInstance } from 'axios';
import { buildXMLFromJSON } from '../xmlBuilder.js';

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

export interface ETACredentials {
    clientId: string;
    clientSecret: string;
    environment: 'Prod' | 'PreProd';
}

export interface SearchDocumentsParams {
    dateFrom?: string;
    dateTo?: string;
    direction?: 'Sent' | 'Received';
    status?: string;
    documentType?: string;
    receiverType?: string;
    receiverId?: string;
    issuerId?: string;
    internalId?: string;
    pageNo?: number;
    pageSize?: number;
}

export interface SearchResult {
    result: ETADocument[];
    metadata: {
        totalCount: number;
        totalPages: number;
        currentPage: number;
    };
}

export interface ETADocument {
    uuid: string;
    submissionId?: string;
    longId?: string;
    internalId?: string;
    typeName?: string;
    typeVersionName?: string;
    issuerId?: string;
    issuerName?: string;
    receiverId?: string;
    receiverName?: string;
    dateTimeIssued?: string;
    dateTimeReceived?: string;
    totalSales?: number;
    totalDiscount?: number;
    netAmount?: number;
    total?: number;
    status?: string;
    cancelRequestDate?: string;
    rejectRequestDate?: string;
    declineCancelRequestDate?: string;
}

export interface DocumentDetails {
    uuid: string;
    submissionId?: string;
    longId?: string;
    internalId?: string;
    typeName?: string;
    typeVersionName?: string;
    issuerId?: string;
    issuerName?: string;
    receiverId?: string;
    receiverName?: string;
    dateTimeIssued?: string;
    dateTimeReceived?: string;
    totalSales?: number;
    totalDiscount?: number;
    netAmount?: number;
    total?: number;
    status?: string;
    documentBody?: any; // Full document JSON
    validationResults?: any;
    invoiceLines?: InvoiceLine[];
}

export interface InvoiceLine {
    description?: string;
    itemType?: string;
    itemCode?: string;
    internalCode?: string;
    unitType?: string;
    quantity?: number;
    salesTotal?: number;
    total?: number;
    valueDifference?: number;
    totalTaxableFees?: number;
    netTotal?: number;
    itemsDiscount?: number;
    unitValue?: {
        currencySold?: string;
        amountEGP?: number;
        amountSold?: number;
        currencyExchangeRate?: number;
    };
    discount?: {
        rate?: number;
        amount?: number;
    };
    taxableItems?: TaxableItem[];
}

export interface TaxableItem {
    taxType: string;
    amount: number;
    subType: string;
    rate: number;
}

export interface SubmissionResult {
    submissionId: string;
    acceptedDocuments: { uuid: string; longId: string; internalId: string; hashKey: string }[];
    rejectedDocuments: { internalId: string; error: any }[];
}

export interface SubmissionDetails {
    submissionId: string;
    submissionDate: string;
    status: string;
    documentCount: number;
    documents: any[];
}

export interface NotificationParams {
    dateFrom?: string;
    dateTo?: string;
    type?: string;
    language?: 'ar' | 'en';
    status?: string;
    channel?: string;
    pageNo?: number;
    pageSize?: number;
}

export interface CodeUsageItem {
    codeType: string;
    parentCode?: string;
    itemCode: string;
    codeName: string;
    codeNameAr?: string;
    activeFrom: string;
    activeTo?: string;
    description?: string;
    descriptionAr?: string;
    requestReason?: string;
}

export interface SearchCodeParams {
    codeLookupValue?: string;
    pageSize?: number;
    pageNo?: number;
}

export interface DocumentPackageParams {
    dateFrom: string;                // ISO8601, e.g. "2026-04-01T00:00:00Z"
    dateTo: string;
    type?: 'Summary' | 'Full';       // ETA default: Summary
    format?: 'JSON' | 'XML';
    truncateIfExceeded?: boolean;
    statuses?: Array<'Valid' | 'Cancelled' | 'Rejected' | 'Submitted'>;
    documentTypeNames?: string[];    // e.g. ["I", "C", "D"]
    receiverSenderId?: string;
    receiverSenderType?: '0' | '1' | '2'; // 0=all, 1=sent, 2=received (per ETA)
    branchNumber?: string;
    productsInternalCodes?: string[];
    itemCodes?: Array<{ codeValue: string; codeType: string }>;
}

/**
 * Turn an axios error from an ETA call into a readable Error that includes
 * HTTP status + whatever ETA returned in the response body (often a JSON with `error`).
 */
function wrapEtaError(op: string, err: any): Error {
    const status = err?.response?.status;
    const data = err?.response?.data;
    const detail = typeof data === 'string' ? data : (data ? JSON.stringify(data) : err?.message || 'unknown');
    return new Error(`ETA ${op} failed${status ? ` (HTTP ${status})` : ''}: ${detail}`);
}

/**
 * Build the <submission> envelope ETA expects for XML document submission:
 *   <?xml version="1.0" encoding="UTF-8"?>
 *   <submission>
 *     <documents>
 *       <document>...</document>
 *       <document>...</document>
 *     </documents>
 *   </submission>
 *
 * Each document is already-signed JSON (same shape used for JSON submit) — we delegate
 * the per-document XML layout to buildXMLFromJSON which preserves ETA's ordered fields.
 */
function buildSubmissionXml(documents: any[]): string {
    const docsXml = documents.map(d => buildXMLFromJSON(d)).join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>\n<submission>\n  <documents>\n${docsXml}\n  </documents>\n</submission>`;
}

/**
 * Build the request body shape ETA expects for POST /documentPackages/requests.
 * Fills in sensible defaults and keeps the wire format consistent across callers.
 */
function buildPackageRequestBody(params: DocumentPackageParams): any {
    return {
        type: params.type || 'Summary',
        format: params.format || 'JSON',
        truncateifexceeded: params.truncateIfExceeded ?? false,
        queryParameters: {
            dateFrom: params.dateFrom,
            dateTo: params.dateTo,
            statuses: params.statuses && params.statuses.length > 0 ? params.statuses : ['Valid'],
            productsInternalCodes: params.productsInternalCodes || [],
            receiverSenderId: params.receiverSenderId || '',
            receiverSenderType: params.receiverSenderType || '0',
            branchNumber: params.branchNumber || '',
            itemCodes: params.itemCodes && params.itemCodes.length > 0 ? params.itemCodes : [],
            documentTypeNames: params.documentTypeNames || [],
        } as Record<string, any>,
    };
}

// ──────────────────────────────────────────────
// Token Cache (per org, 50-min TTL)
// ──────────────────────────────────────────────

interface CachedToken {
    token: string;
    expiresAt: number; // unix ms
}

const tokenCache = new Map<string, CachedToken>();
const TOKEN_TTL_MS = 50 * 60 * 1000; // 50 minutes (tokens last ~60 min)

function getCacheKey(credentials: ETACredentials): string {
    return `${credentials.environment}_${credentials.clientId}`;
}

// ──────────────────────────────────────────────
// ETA Hosts
// ──────────────────────────────────────────────

function getHosts(env: 'Prod' | 'PreProd') {
    const isProd = env === 'Prod';
    return {
        id: isProd ? 'https://id.eta.gov.eg' : 'https://id.preprod.eta.gov.eg',
        api: isProd ? 'https://api.invoicing.eta.gov.eg' : 'https://api.preprod.invoicing.eta.gov.eg',
    };
}

// ──────────────────────────────────────────────
// ETAService Class
// ──────────────────────────────────────────────

export class ETAService {
    private credentials: ETACredentials;
    private hosts: { id: string; api: string };
    private orgId: number;

    constructor(orgId: number, credentials: ETACredentials) {
        this.orgId = orgId;
        this.credentials = credentials;
        this.hosts = getHosts(credentials.environment);
    }

    // ─── Auth ────────────────────────────────────

    async getToken(): Promise<string> {
        const cacheKey = getCacheKey(this.credentials);
        const cached = tokenCache.get(cacheKey);

        if (cached && cached.expiresAt > Date.now()) {
            return cached.token;
        }

        try {
            console.log(`[ETA-Service] Org ${this.orgId}: Requesting new token (${this.credentials.environment})...`);
            const response = await axios.post(
                `${this.hosts.id}/connect/token`,
                new URLSearchParams({
                    grant_type: 'client_credentials',
                    client_id: this.credentials.clientId,
                    client_secret: this.credentials.clientSecret,
                    scope: 'InvoicingAPI',
                }),
                { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
            );

            const token = response.data.access_token;
            tokenCache.set(cacheKey, {
                token,
                expiresAt: Date.now() + TOKEN_TTL_MS,
            });

            console.log(`[ETA-Service] Org ${this.orgId}: Token obtained & cached ✅`);
            return token;
        } catch (err: any) {
            console.error(`[ETA-Service] Org ${this.orgId}: Auth failed`, err.response?.data || err.message);
            throw new Error(`ETA authentication failed: ${JSON.stringify(err.response?.data || err.message)}`);
        }
    }

    private async api(): Promise<AxiosInstance> {
        const token = await this.getToken();
        return axios.create({
            baseURL: `${this.hosts.api}/api/v1.0`,
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
        });
    }

    // ─── Documents: Search & Fetch ────────────────

    /** #2: Search ETA documents (paginated, filterable) */
    async searchDocuments(params: SearchDocumentsParams): Promise<SearchResult> {
        const client = await this.api();
        const queryParams = new URLSearchParams();

        if (params.dateFrom) queryParams.set('submissionDateFrom', params.dateFrom);
        if (params.dateTo) queryParams.set('submissionDateTo', params.dateTo);
        if (params.direction) queryParams.set('direction', params.direction);
        if (params.status) queryParams.set('status', params.status);
        if (params.documentType) queryParams.set('documentType', params.documentType);
        if (params.receiverId) queryParams.set('receiverType', params.receiverType || '');
        if (params.receiverId) queryParams.set('receiverId', params.receiverId);
        if (params.issuerId) queryParams.set('issuerId', params.issuerId);
        if (params.internalId) queryParams.set('internalId', params.internalId);
        queryParams.set('pageNo', String(params.pageNo || 1));
        queryParams.set('pageSize', String(params.pageSize || 100));

        const response = await client.get(`/documents/search?${queryParams.toString()}`);
        return response.data;
    }

    /** #3: Get full document details including validation results + lines */
    async getDocumentDetails(uuid: string): Promise<DocumentDetails> {
        const client = await this.api();
        const response = await client.get(`/documents/${uuid}/details`);

        const data = response.data;

        // Debug: log response shape once
        console.log(`[ETA-Details] uuid=${uuid} top-keys: ${JSON.stringify(Object.keys(data))}`);

        // The ETA details API can return invoice lines in multiple possible locations:
        // 1. data.document.invoiceLines (most common for details endpoint)
        // 2. data.original.invoiceLines  
        // 3. data.transformed.invoiceLines
        // 4. data.invoiceLines (direct)
        const doc = data.document || data.original || data.transformed || data || {};

        if (doc && typeof doc === 'object') {
            console.log(`[ETA-Details] doc-keys: ${JSON.stringify(Object.keys(doc).slice(0, 15))}`);
        }

        const invoiceLines = doc.invoiceLines || data.invoiceLines || [];
        console.log(`[ETA-Details] invoiceLines count: ${invoiceLines.length}`);

        return {
            ...data,
            documentBody: doc,
            invoiceLines,
        };
    }

    /** #4: Get raw document */
    async getDocument(uuid: string): Promise<any> {
        const client = await this.api();
        const response = await client.get(`/documents/${uuid}/raw`);
        return response.data;
    }

    /** #5: Get document PDF printout */
    async getDocumentPrintout(uuid: string): Promise<Buffer> {
        const token = await this.getToken();
        const response = await axios.get(
            `${this.hosts.api}/api/v1.0/documents/${uuid}/pdf`,
            {
                headers: { Authorization: `Bearer ${token}` },
                responseType: 'arraybuffer',
            }
        );
        return Buffer.from(response.data);
    }

    // ─── Documents: Actions ──────────────────────

    /** #6: Submit signed documents to ETA as JSON. */
    async submitDocuments(documents: any[]): Promise<SubmissionResult> {
        const client = await this.api();
        try {
            const response = await client.post('/documentsubmissions', { documents });
            return response.data;
        } catch (err: any) {
            throw wrapEtaError('submitDocuments', err);
        }
    }

    /**
     * Submit signed documents as XML.
     * ETA accepts XML at the same endpoint with Content-Type: application/xml.
     * The body is a <submission><documents><document>...</document></documents></submission> envelope.
     */
    async submitDocumentsXml(documents: any[]): Promise<SubmissionResult> {
        const token = await this.getToken();
        const xmlBody = buildSubmissionXml(documents);
        try {
            const response = await axios.post(
                `${this.hosts.api}/api/v1/documentsubmissions`,
                xmlBody,
                {
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'Content-Type': 'application/xml',
                        Accept: 'application/json',
                    },
                }
            );
            return response.data;
        } catch (err: any) {
            throw wrapEtaError('submitDocumentsXml', err);
        }
    }

    /** #7: Cancel an issued document */
    async cancelDocument(uuid: string, reason: string): Promise<any> {
        const client = await this.api();
        const response = await client.put(`/documents/state/${uuid}/state`, {
            status: 'cancelled',
            reason,
        });
        return response.data;
    }

    /** #8: Reject a received document */
    async rejectDocument(uuid: string, reason: string): Promise<any> {
        const client = await this.api();
        const response = await client.put(`/documents/state/${uuid}/state`, {
            status: 'rejected',
            reason,
        });
        return response.data;
    }

    /** #9: Decline a rejection (issuer declines receiver's rejection) */
    async declineRejection(uuid: string): Promise<any> {
        const client = await this.api();
        const response = await client.put(`/documents/state/${uuid}/decline/rejection`);
        return response.data;
    }

    /** #10: Decline a cancellation (receiver declines issuer's cancellation) */
    async declineCancellation(uuid: string): Promise<any> {
        const client = await this.api();
        const response = await client.put(`/documents/state/${uuid}/decline/cancelation`);
        return response.data;
    }

    // ─── Submissions ─────────────────────────────

    /** #11: Get submission batch details */
    async getSubmission(submissionId: string, pageNo = 1, pageSize = 100): Promise<SubmissionDetails> {
        const client = await this.api();
        const response = await client.get(
            `/documentsubmissions/${submissionId}?pageNo=${pageNo}&pageSize=${pageSize}`
        );
        return response.data;
    }

    // ─── Notifications ───────────────────────────

    /** #12: Get ETA notifications for the taxpayer */
    async getNotifications(params: NotificationParams = {}): Promise<any> {
        const client = await this.api();
        const queryParams = new URLSearchParams();

        if (params.dateFrom) queryParams.set('dateFrom', params.dateFrom);
        if (params.dateTo) queryParams.set('dateTo', params.dateTo);
        if (params.type) queryParams.set('type', params.type);
        if (params.language) queryParams.set('language', params.language);
        if (params.status) queryParams.set('status', params.status);
        if (params.channel) queryParams.set('channel', params.channel);
        queryParams.set('pageNo', String(params.pageNo || 1));
        queryParams.set('pageSize', String(params.pageSize || 50));

        const response = await client.get(`/notifications/taxpayer?${queryParams.toString()}`);
        return response.data;
    }

    // ─── Document Packages (Bulk Export) ─────────

    /**
     * Request a document package (Summary or Full, JSON or XML) for bulk export.
     * Endpoint: POST /api/v1/documentPackages/requests
     * Returns ETA's requestId (rid) used later to download the package.
     *
     * Timeout is 2 minutes — wide date ranges (e.g. multi-year Full exports) can
     * take ETA 30-60+ seconds server-side before it even returns the requestId.
     * ETA's own gateway returns 504 at ~60s, so anything above that is doomed
     * regardless of what we set here.
     */
    async requestPackage(params: DocumentPackageParams): Promise<any> {
        const token = await this.getToken();
        const body = buildPackageRequestBody(params);
        try {
            const response = await axios.post(
                `${this.hosts.api}/api/v1/documentPackages/requests`,
                body,
                {
                    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                    timeout: 120_000,
                }
            );
            return response.data;
        } catch (err: any) {
            throw wrapEtaError('requestPackage', err);
        }
    }

    /**
     * Request a package on behalf of a represented taxpayer (for intermediaries/accountants).
     * Same endpoint as requestPackage, with representedTaxpayerFilterType + representeeRin added.
     */
    async requestIntermediaryPackage(
        params: DocumentPackageParams & { representedTaxpayerFilterType: '0' | '1' | '2'; representeeRin?: string }
    ): Promise<any> {
        const token = await this.getToken();
        const body = buildPackageRequestBody(params);
        body.queryParameters.representedTaxpayerFilterType = params.representedTaxpayerFilterType;
        if (params.representeeRin) body.queryParameters.representeeRin = params.representeeRin;
        try {
            const response = await axios.post(
                `${this.hosts.api}/api/v1/documentPackages/requests`,
                body,
                {
                    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                    timeout: 120_000,
                }
            );
            return response.data;
        } catch (err: any) {
            throw wrapEtaError('requestIntermediaryPackage', err);
        }
    }

    /**
     * Download a prepared document package as a ZIP buffer.
     * Endpoint: GET /api/v1/documentPackages/:rid
     *
     * Note: ETA builds packages asynchronously. A 400 with a ValidationError typically
     * means "not yet built" — the caller should retry after a few minutes.
     */
    async getPackage(rid: string): Promise<Buffer> {
        const token = await this.getToken();
        try {
            const response = await axios.get(
                `${this.hosts.api}/api/v1/documentPackages/${rid}`,
                {
                    headers: { Authorization: `Bearer ${token}` },
                    responseType: 'arraybuffer',
                }
            );
            return Buffer.from(response.data);
        } catch (err: any) {
            // ETA returns an error body as arraybuffer — convert it so wrapEtaError can format it.
            if (err?.response?.data && err.response.data instanceof ArrayBuffer) {
                try { err.response.data = JSON.parse(Buffer.from(err.response.data).toString('utf8')); } catch { /* leave as-is */ }
            } else if (err?.response?.data && Buffer.isBuffer(err.response.data)) {
                try { err.response.data = JSON.parse(err.response.data.toString('utf8')); } catch { /* leave as-is */ }
            }
            throw wrapEtaError('getPackage', err);
        }
    }

    // ─── Item Codes (EGS / GS1) ─────────────────

    /** #15: Create EGS code usage request */
    async createEGSCode(items: CodeUsageItem[]): Promise<any> {
        const client = await this.api();
        const response = await client.post('/codetypes/requests/codes', { items });
        return response.data;
    }

    /** #16: Search published codes (GS1 + EGS) */
    async searchPublishedCodes(codeType: string, params: SearchCodeParams = {}): Promise<any> {
        const client = await this.api();
        const queryParams = new URLSearchParams();
        if (params.codeLookupValue) queryParams.set('codeLookupValue', params.codeLookupValue);
        queryParams.set('pageNo', String(params.pageNo || 1));
        queryParams.set('pageSize', String(params.pageSize || 50));

        const response = await client.get(`/codetypes/${codeType}/codes?${queryParams.toString()}`);
        return response.data;
    }

    /** #17: Get code details by item code */
    async getCodeDetails(codeType: string, itemCode: string): Promise<any> {
        const client = await this.api();
        const response = await client.get(`/codetypes/${codeType}/codes/${itemCode}`);
        return response.data;
    }

    /** #18: Search my EGS code usage requests */
    async searchMyCodeRequests(params: {
        active?: boolean;
        status?: string;
        pageNo?: number;
        pageSize?: number;
    } = {}): Promise<any> {
        const client = await this.api();
        const queryParams = new URLSearchParams();
        if (params.active !== undefined) queryParams.set('Active', String(params.active));
        if (params.status) queryParams.set('Status', params.status);
        queryParams.set('pageNo', String(params.pageNo || 1));
        queryParams.set('pageSize', String(params.pageSize || 50));

        const response = await client.get(`/codetypes/requests/my?${queryParams.toString()}`);
        return response.data;
    }

    /** #19: Update an existing EGS code request (only if status = Submitted) */
    async updateEGSCode(requestId: string, data: Partial<CodeUsageItem>): Promise<any> {
        const client = await this.api();
        const response = await client.put(`/codetypes/requests/codes/${requestId}`, data);
        return response.data;
    }

    // ─── Document Types ──────────────────────────

    /** #2: Get all document types (Invoice, Credit, Debit) */
    async getDocumentTypes(): Promise<any> {
        const client = await this.api();
        const response = await client.get('/documenttypes');
        return response.data;
    }

    /** #3: Get specific document type details */
    async getDocumentType(typeId: string): Promise<any> {
        const client = await this.api();
        const response = await client.get(`/documenttypes/${typeId}`);
        return response.data;
    }

    /** #4: Get document type version details */
    async getDocumentTypeVersion(typeId: string, versionId: string): Promise<any> {
        const client = await this.api();
        const response = await client.get(`/documenttypes/${typeId}/versions/${versionId}`);
        return response.data;
    }

    // ─── Recent Documents ────────────────────────

    /** #17: Get recent documents (faster than search) */
    async getRecentDocuments(params: {
        pageNo?: number;
        pageSize?: number;
        direction?: 'Sent' | 'Received';
    } = {}): Promise<any> {
        const client = await this.api();
        const queryParams = new URLSearchParams();
        if (params.direction) queryParams.set('direction', params.direction);
        queryParams.set('pageNo', String(params.pageNo || 1));
        queryParams.set('pageSize', String(params.pageSize || 50));
        const response = await client.get(`/documents/recent?${queryParams.toString()}`);
        return response.data;
    }

    // ─── Code Reuse ──────────────────────────────

    /** #9: Request code reuse (use an existing published code) */
    async requestCodeReuse(items: { codeType: string; itemCode: string; codeName: string }[]): Promise<any> {
        const client = await this.api();
        const response = await client.put('/codetypes/requests/codeusages', { items });
        return response.data;
    }

    /** #13: Update a published code */
    async updatePublishedCode(codeType: string, itemCode: string, data: any): Promise<any> {
        const client = await this.api();
        const response = await client.put(`/codetypes/${codeType}/codes/${itemCode}`, data);
        return response.data;
    }

    // ─── Package Requests ────────────────────────

    /**
     * List all prior document-package requests for this taxpayer (paged).
     * Endpoint: GET /api/v1/documentPackages/requests
     */
    async getPackageRequests(params: { pageNo?: number; pageSize?: number } = {}): Promise<any> {
        const token = await this.getToken();
        const queryParams = new URLSearchParams();
        queryParams.set('pageNo', String(params.pageNo || 1));
        queryParams.set('pageSize', String(params.pageSize || 50));
        try {
            const response = await axios.get(
                `${this.hosts.api}/api/v1/documentPackages/requests?${queryParams.toString()}`,
                { headers: { Authorization: `Bearer ${token}` } }
            );
            return response.data;
        } catch (err: any) {
            throw wrapEtaError('getPackageRequests', err);
        }
    }

    // ─── Taxpayer Info Lookup ────────────────────

    /**
     * Look up an Egyptian taxpayer by Registration/Tax ID (RIN).
     * Endpoint: GET /api/v1/taxpayer/info/:rin
     *
     * Useful for verifying receiver data before invoice submission (name, type,
     * registration status). ETA returns 404 or ValidationError for unregistered IDs.
     */
    async getTaxpayerInfo(rin: string): Promise<any> {
        const token = await this.getToken();
        try {
            const response = await axios.get(
                `${this.hosts.api}/api/v1/taxpayer/info/${encodeURIComponent(rin)}`,
                { headers: { Authorization: `Bearer ${token}` } }
            );
            return response.data;
        } catch (err: any) {
            throw wrapEtaError('getTaxpayerInfo', err);
        }
    }

    // ─── Test Connection ─────────────────────────

    /** Quick test: get a token to verify credentials work */
    async testConnection(): Promise<{ success: boolean; message: string }> {
        try {
            await this.getToken();
            return { success: true, message: `Successfully connected to ETA (${this.credentials.environment})` };
        } catch (err: any) {
            return { success: false, message: err.message || 'Connection failed' };
        }
    }
}

// ──────────────────────────────────────────────
// Utility: Create an ETAService from org settings
// ──────────────────────────────────────────────

export function createETAServiceFromSettings(orgId: number, settings: any): ETAService | null {
    const env = settings.eta_environment || 'PreProd';
    let clientId: string | null = null;
    let clientSecret: string | null = null;
    let actualEnv = env;

    if (env === 'Prod') {
        clientId = settings.eta_prod_client_id || settings.eta_client_id;
        clientSecret = settings.eta_prod_client_secret || settings.eta_client_secret;
    } else {
        clientId = settings.eta_preprod_client_id || settings.eta_client_id;
        clientSecret = settings.eta_preprod_client_secret || settings.eta_client_secret;
    }

    // Cross-environment fallback: if selected env has no creds, try the other
    if (!clientId || !clientSecret) {
        if (env === 'Prod') {
            // Try PreProd creds
            const fallbackId = settings.eta_preprod_client_id;
            const fallbackSecret = settings.eta_preprod_client_secret;
            if (fallbackId && fallbackSecret) {
                console.warn(`[ETA-Service] Org ${orgId}: No Prod credentials, falling back to PreProd`);
                clientId = fallbackId;
                clientSecret = fallbackSecret;
                actualEnv = 'PreProd';
            }
        } else {
            // Try Prod creds
            const fallbackId = settings.eta_prod_client_id;
            const fallbackSecret = settings.eta_prod_client_secret;
            if (fallbackId && fallbackSecret) {
                console.warn(`[ETA-Service] Org ${orgId}: No PreProd credentials, falling back to Prod`);
                clientId = fallbackId;
                clientSecret = fallbackSecret;
                actualEnv = 'Prod';
            }
        }
    }

    if (!clientId || !clientSecret) {
        console.warn(`[ETA-Service] Org ${orgId}: No ${env} credentials configured`);
        return null;
    }

    return new ETAService(orgId, {
        clientId,
        clientSecret,
        environment: actualEnv as 'Prod' | 'PreProd',
    });
}

// ──────────────────────────────────────────────
// Utility: Clear token cache for an org
// ──────────────────────────────────────────────

export function clearTokenCache(credentials?: ETACredentials): void {
    if (credentials) {
        tokenCache.delete(getCacheKey(credentials));
    } else {
        tokenCache.clear();
    }
}
