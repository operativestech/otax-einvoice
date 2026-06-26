import WebSocket from 'ws';
import { exec } from 'child_process';
import util from 'util';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import os from 'os';
import http from 'http';
import { fileURLToPath } from 'url';

const execPromise = util.promisify(exec);

// Define __dirname for ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================
// CONFIGURATION
// ============================================
const AGENT_VERSION = '3.0.0';
const DEFAULT_CLOUD_URL = 'wss://e-invoice-545y.onrender.com';
const DEFAULT_COMPANY_ID = 'default';
const RECONNECT_INTERVAL = 5000;    // 5 seconds
const HEARTBEAT_INTERVAL = 30000;   // 30 seconds
const MAX_RECONNECT_DELAY = 60000;  // Max 60 seconds between retries

// UTS (UniversalTokenSigner) Configuration
const UTS_PORT = 7777;
const UTS_BASE_URL = `http://127.0.0.1:${UTS_PORT}`;
const UTS_TIMEOUT = 30000; // 30s for signing operations

// Configuration file
const CONFIG_FILE = path.join(__dirname, 'agent_config.json');

// Pathing logic for signer
const getSignerDir = () => {
    const localPath = path.join(__dirname, 'EInvoicingSigner');
    const parentPath = path.resolve(__dirname, '..', 'EInvoicingSigner');
    if (fs.existsSync(localPath)) return localPath;
    return parentPath;
};

const SIGNER_DIR = getSignerDir();
const TEMP_DIR = path.join(SIGNER_DIR, 'temp');
const SIGNER_EXE = path.join(SIGNER_DIR, 'EInvoicingSigner.exe');

// ============================================
// STATE
// ============================================
let socket: WebSocket | null = null;
let heartbeatTimer: NodeJS.Timer | null = null;
let reconnectAttempts = 0;
let isConnected = false;
let lastSignTime: Date | null = null;
let totalSigned = 0;
let signerValid = false;
let utsAvailable = false;
let utsSecret = '';

// ============================================
// CONFIG MANAGEMENT
// ============================================
interface AgentConfig {
    nodeId: string;
    companyId: string;
    cloudUrl: string;
    agentName: string;
    utsPort?: number;
    utsSecret?: string;
}

function getAgentConfig(): AgentConfig {
    let config: any = {};
    if (fs.existsSync(CONFIG_FILE)) {
        try {
            config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
        } catch (e) {
            console.error('[Agent] Config Error:', e);
        }
    }

    let changed = false;

    if (!config.nodeId) {
        config.nodeId = crypto.randomUUID();
        changed = true;
    }
    if (!config.companyId) {
        config.companyId = DEFAULT_COMPANY_ID;
        changed = true;
    }
    if (!config.cloudUrl) {
        config.cloudUrl = DEFAULT_CLOUD_URL;
        changed = true;
    }
    if (!config.agentName) {
        config.agentName = os.hostname();
        changed = true;
    }

    if (changed) {
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
        console.log('[Agent] Config saved:', CONFIG_FILE);
    }

    return config;
}

const agentConfig = getAgentConfig();

// ============================================
// UTS HTTP HELPERS
// ============================================
function utsRequest(method: string, urlPath: string, body?: any): Promise<any> {
    return new Promise((resolve, reject) => {
        const url = new URL(urlPath, UTS_BASE_URL);
        const postData = body ? JSON.stringify(body) : undefined;

        const options: http.RequestOptions = {
            hostname: '127.0.0.1',
            port: agentConfig.utsPort || UTS_PORT,
            path: url.pathname,
            method,
            headers: {
                'X-UTS-Secret': utsSecret,
                ...(postData ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) } : {})
            },
            timeout: UTS_TIMEOUT,
        };

        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode === 403) {
                    reject(new Error('UTS rejected request (invalid secret). Check UTS API Secret.'));
                    return;
                }
                if (res.statusCode && res.statusCode >= 400) {
                    reject(new Error(`UTS error ${res.statusCode}: ${data.substring(0, 300)}`));
                    return;
                }
                try {
                    resolve(JSON.parse(data));
                } catch {
                    resolve(data);
                }
            });
        });

        req.on('error', (err) => reject(err));
        req.on('timeout', () => { req.destroy(); reject(new Error('UTS request timed out')); });

        if (postData) req.write(postData);
        req.end();
    });
}

async function probeUTS(): Promise<boolean> {
    try {
        // First read the UTS secret from settings file
        const utsSettingsPath = path.join(
            process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
            'UniversalTokenSigner', 'settings.json'
        );

        if (fs.existsSync(utsSettingsPath)) {
            const settings = JSON.parse(fs.readFileSync(utsSettingsPath, 'utf8'));
            utsSecret = settings.ApiSecret || '';
            console.log('[Agent] UTS settings found, secret loaded.');
        } else {
            console.log('[Agent] UTS settings file not found. Skipping UTS.');
            return false;
        }

        const status = await utsRequest('GET', '/status');
        console.log(`[Agent] ✅ UTS connected! Version: ${status.version || '?'}, PKCS11: ${status.pkcs11Dll || 'not set'}`);
        return true;
    } catch (e: any) {
        console.warn(`[Agent] ⚠️ UTS not available: ${e.message}`);
        return false;
    }
}

// ============================================
// SIGNER PRE-VALIDATION (Legacy + UTS)
// ============================================
function validateLegacySigner(): boolean {
    const requiredFiles = [
        'EInvoicingSigner.exe',
        'EInvoicingSigner.dll',
        'BouncyCastle.Cryptography.dll',
        'Pkcs11Interop.dll',
    ];

    const missing: string[] = [];
    for (const file of requiredFiles) {
        if (!fs.existsSync(path.join(SIGNER_DIR, file))) {
            missing.push(file);
        }
    }

    if (missing.length > 0) {
        console.warn('[Agent] Legacy signer incomplete — missing: ' + missing.join(', '));
        return false;
    }

    console.log('✓ Legacy signer validation passed.');
    return true;
}

// ============================================
// DISPLAY BANNER
// ============================================
function showBanner() {
    console.log('');
    console.log('╔══════════════════════════════════════════════════╗');
    console.log(`║       🔐 OTax Signing Agent v${AGENT_VERSION}            ║`);
    console.log('╠══════════════════════════════════════════════════╣');
    console.log(`║  PC Name:    ${agentConfig.agentName.padEnd(36)}║`);
    console.log(`║  Node ID:    ${agentConfig.nodeId.substring(0, 36).padEnd(36)}║`);
    console.log(`║  Company:    ${agentConfig.companyId.padEnd(36)}║`);
    console.log(`║  Cloud URL:  ${agentConfig.cloudUrl.substring(0, 36).padEnd(36)}║`);
    console.log(`║  UTS:        ${(utsAvailable ? '✅ Connected (port ' + (agentConfig.utsPort || UTS_PORT) + ')' : '⚠️ Not available').padEnd(36)}║`);
    console.log(`║  Legacy:     ${(signerValid ? '✅ Found' : '❌ Not Found').padEnd(36)}║`);
    console.log('╠══════════════════════════════════════════════════╣');
    console.log('║  Status: Connecting...                           ║');
    console.log('╚══════════════════════════════════════════════════╝');
    console.log('');
}

// ============================================
// WEBSOCKET CONNECTION
// ============================================
function connect() {
    const url = agentConfig.cloudUrl;
    console.log(`[Agent] Connecting to: ${url} (attempt ${reconnectAttempts + 1})...`);

    try {
        socket = new WebSocket(url, {
            headers: {
                'X-Agent-NodeId': agentConfig.nodeId,
                'X-Agent-Company': agentConfig.companyId,
            },
        });
    } catch (err: any) {
        console.error(`[Agent] Failed to create WebSocket: ${err.message}`);
        scheduleReconnect();
        return;
    }

    socket.on('open', () => {
        isConnected = true;
        reconnectAttempts = 0;
        console.log('');
        console.log('✅ [Agent] CONNECTED to Cloud Server!');
        console.log('   Registering as signing node...');

        // Register with version info
        socket?.send(JSON.stringify({
            type: 'register_agent',
            companyId: agentConfig.companyId,
            nodeId: agentConfig.nodeId,
            agentName: agentConfig.agentName,
            agentVersion: AGENT_VERSION,
            signerReady: signerValid,
            platform: `${os.platform()} ${os.release()}`,
        }));

        // Start heartbeat
        startHeartbeat();
    });

    socket.on('message', async (data) => {
        try {
            const msg = JSON.parse(data.toString());

            if (msg.type === 'registered') {
                console.log('✅ [Agent] Successfully registered! Ready to sign.');
                console.log(`   Waiting for signing requests from cloud...`);
                console.log('');
            } else if (msg.type === 'request') {
                await handleRequest(msg);
            } else if (msg.type === 'error') {
                console.error(`❌ [Agent] Cloud Error: ${msg.message}`);
                if (msg.message?.includes('locked')) {
                    console.error('');
                    console.error('   ⚠️  This company is locked to another PC.');
                    console.error('   To move signing here, reset the node in OTax Settings.');
                    console.error('');
                }
            } else if (msg.type === 'pong') {
                // Heartbeat acknowledged
            } else if (msg.type === 'info') {
                console.log(`   ℹ️  ${msg.message}`);
            }
        } catch (e: any) {
            console.error('[Agent] Message parse error:', e.message);
        }
    });

    socket.on('close', (code, reason) => {
        isConnected = false;
        stopHeartbeat();
        console.warn(`[Agent] Disconnected (code: ${code}). Will auto-reconnect...`);
        socket = null;
        scheduleReconnect();
    });

    socket.on('error', (err) => {
        console.error(`[Agent] WebSocket Error: ${err.message}`);
        // Don't reconnect here — 'close' event will fire after error
    });
}

function scheduleReconnect() {
    reconnectAttempts++;
    // Exponential backoff: 5s, 10s, 20s, 40s, max 60s
    const delay = Math.min(RECONNECT_INTERVAL * Math.pow(2, reconnectAttempts - 1), MAX_RECONNECT_DELAY);
    console.log(`[Agent] Reconnecting in ${(delay / 1000).toFixed(0)}s... (attempt ${reconnectAttempts})`);
    setTimeout(connect, delay);
}

// ============================================
// HEARTBEAT (Keep Connection Alive)
// ============================================
function startHeartbeat() {
    stopHeartbeat();
    heartbeatTimer = setInterval(() => {
        if (socket && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({
                type: 'heartbeat',
                companyId: agentConfig.companyId,
                nodeId: agentConfig.nodeId,
                agentVersion: AGENT_VERSION,
                uptime: process.uptime(),
                totalSigned,
                lastSignTime: lastSignTime?.toISOString(),
                memoryMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
            }));
        }
    }, HEARTBEAT_INTERVAL);
}

function stopHeartbeat() {
    if (heartbeatTimer) {
        clearInterval(heartbeatTimer as any);
        heartbeatTimer = null;
    }
}

// ============================================
// REQUEST HANDLER
// ============================================
async function handleRequest(msg: any) {
    const { reqId, cmd, data } = msg;
    const startTime = Date.now();

    try {
        let payload = null;

        if (cmd === 'list_certs') {
            console.log('[Agent] 📋 Listing certificates...');
            payload = await listCertificates();
            console.log(`[Agent] ✅ Found ${(payload as any[]).length} certificates`);
        } else if (cmd === 'sign') {
            console.log('[Agent] 🔐 Signing document...');
            payload = await signDocument(data, reqId);
            totalSigned++;
            lastSignTime = new Date();
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            console.log(`[Agent] ✅ Signed successfully in ${elapsed}s (total: ${totalSigned})`);
        } else {
            throw new Error(`Unknown command: ${cmd}`);
        }

        sendResponse(reqId, true, payload);
    } catch (e: any) {
        console.error(`[Agent] ❌ Command '${cmd}' failed: ${e.message}`);
        sendResponse(reqId, false, null, e.message);
    }
}

function sendResponse(reqId: string, success: boolean, payload: any, error: string | null = null) {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
        console.error('[Agent] Cannot send response — not connected!');
        return;
    }
    socket.send(JSON.stringify({
        type: 'response',
        reqId,
        success,
        payload,
        error,
    }));
}

// ============================================
// CERTIFICATE LISTING (UTS-first, legacy fallback)
// ============================================
async function listCertificatesViaUTS(): Promise<any[]> {
    const tokenCerts = await utsRequest('GET', '/tokens') as any[];
    // Map UTS cert format to the format the bridge/dashboard expects
    return tokenCerts.map(c => ({
        Thumbprint: c.certIdBase64 || c.CertIdBase64 || '',
        Subject: c.subject || c.Subject || '',
        Issuer: c.issuer || c.Issuer || '',
        IssuerCN: extractCN(c.issuer || c.Issuer || ''),
        FriendlyName: c.label || c.Label || c.subject || c.Subject || '',
        NotAfter: '',
        KeyType: c.keyType || c.KeyType || 'Unknown',
        Source: 'UTS_PKCS11',
    }));
}

function extractCN(issuer: string): string {
    const match = issuer.match(/CN=([^,]+)/);
    return match ? match[1].trim() : issuer;
}

async function listCertificatesLegacy(): Promise<any[]> {
    const certs: any[] = [];

    // 1. List certificates from Windows cert store
    try {
        const psCommand = `powershell -NoProfile -Command "Get-ChildItem -Path Cert:\\\\CurrentUser\\\\My | Select-Object Thumbprint, Subject, Issuer, NotAfter, FriendlyName | ConvertTo-Json -Compress"`;
        const { stdout } = await execPromise(psCommand, { timeout: 15000 });
        if (stdout && stdout.trim()) {
            let parsed = JSON.parse(stdout);
            if (!Array.isArray(parsed)) parsed = [parsed];
            for (const p of parsed) {
                if (p.Thumbprint) {
                    certs.push({
                        Thumbprint: p.Thumbprint,
                        Subject: p.Subject,
                        Issuer: typeof p.Issuer === 'string' ? p.Issuer : (p.Issuer?.Name || ''),
                        FriendlyName: p.FriendlyName || p.Subject || '',
                        NotAfter: p.NotAfter,
                        Source: 'WindowsStore',
                    });
                }
            }
        }
    } catch (e) {
        console.warn('[Agent] Windows cert store scan failed');
    }

    // 2. Detect PKCS11 USB token certificate
    try {
        const pkcs11Dll = path.join(SIGNER_DIR, 'eps2003csp11.dll');
        if (fs.existsSync(pkcs11Dll)) {
            const psSmartCard = `powershell -NoProfile -Command "chcp 65001 >$null; Get-ChildItem -Path Cert:\\CurrentUser\\My | Where-Object { $_.HasPrivateKey } | ForEach-Object { $issuerCN = ''; if ($_.Issuer -match 'CN=([^,]+)') { $issuerCN = $Matches[1] }; @{ Thumbprint=$_.Thumbprint; Subject=$_.Subject; Issuer=$_.Issuer; IssuerCN=$issuerCN; NotAfter=$_.NotAfter.ToString('o'); FriendlyName=$_.FriendlyName } } | ConvertTo-Json -Compress"`;
            const { stdout: pkOut } = await execPromise(psSmartCard, { timeout: 15000 }).catch(() => ({ stdout: '' }));

            if (pkOut && pkOut.trim()) {
                let parsed = JSON.parse(pkOut);
                if (!Array.isArray(parsed)) parsed = [parsed];
                for (const p of parsed) {
                    if (p.Thumbprint && !certs.find(c => c.Thumbprint === p.Thumbprint)) {
                        certs.push({
                            Thumbprint: p.Thumbprint, Subject: p.Subject, Issuer: p.Issuer,
                            IssuerCN: p.IssuerCN, FriendlyName: p.FriendlyName || '',
                            NotAfter: p.NotAfter, Source: 'SmartCard',
                        });
                    }
                }
            }

            const hasEtaCert = certs.some(c =>
                (c.Issuer && (c.Issuer.includes('MCDR') || c.Issuer.includes('Egypt Trust') || c.Issuer.includes('ITIDA'))) ||
                (c.Subject && c.Subject.includes('VATEG'))
            );
            if (!hasEtaCert) {
                certs.unshift({
                    Thumbprint: 'PKCS11_TOKEN',
                    Subject: 'USB Token Certificate (PKCS11 - auto-detect)',
                    Issuer: 'CN=MCDR CA 2022 (auto-detected from USB token)',
                    IssuerCN: 'MCDR CA 2022',
                    FriendlyName: 'USB Token - ETA Signing Certificate',
                    NotAfter: '', Source: 'PKCS11Token',
                });
            }
        }
    } catch (e) {
        console.warn('[Agent] PKCS11 token scan failed:', (e as Error).message);
    }

    return certs;
}

async function listCertificates(): Promise<any[]> {
    // Try UTS first
    if (!utsAvailable) {
        utsAvailable = await probeUTS();
    }
    if (utsAvailable) {
        try {
            const certs = await listCertificatesViaUTS();
            console.log(`[Agent] UTS returned ${certs.length} certificates from token`);
            return certs;
        } catch (e: any) {
            console.warn(`[Agent] UTS cert listing failed: ${e.message}. Falling back to legacy...`);
        }
    }

    // Fallback to legacy
    const certs = await listCertificatesLegacy();
    console.log(`[Agent] Legacy: found ${certs.length} certificates`);
    return certs;
}

// ============================================
// DOCUMENT SIGNING VIA UTS — CAdES-BES (CMS PKCS#7)
// ============================================
async function signDocumentViaUTS(payload: any): Promise<any> {
    const { document, serialized, pin } = payload;

    if (!serialized) {
        throw new Error('Serialized/canonical data is required for UTS signing');
    }

    console.log('[Agent] 📡 Signing via UTS CAdES-BES (UniversalTokenSigner)...');

    // Use the NEW /sign-document-cades endpoint that produces CMS SignedData (CAdES-BES)
    // This is what ETA requires — a full PKCS#7 CMS structure, NOT a raw RSA signature
    const utsResp = await utsRequest('POST', '/sign-document-cades', {
        serializedData: serialized,
        pin: pin,
        certIdBase64: null, // auto-select first cert
    });

    const signatureBase64 = utsResp.signatureBase64 || utsResp.SignatureBase64;
    if (!signatureBase64 || signatureBase64.length < 500) {
        throw new Error(`UTS CAdES-BES returned invalid signature (${(signatureBase64 || '').length} chars). Expected 2000+ chars for CMS SignedData.`);
    }

    // CAdES-BES signatures should start with 'MI' (Base64 ASN.1 DER)
    if (!signatureBase64.startsWith('MI')) {
        console.warn(`[Agent] ⚠️ UTS signature does not start with 'MI'. Got: '${signatureBase64.substring(0, 8)}...' — may not be valid CAdES-BES`);
    }

    console.log(`[Agent] UTS ✓ CAdES-BES Signature: ${signatureBase64.length} chars, KeyType: ${utsResp.keyType || utsResp.KeyType}`);
    if (utsResp.certIssuer || utsResp.CertIssuer) {
        console.log(`[Agent] UTS cert issuer: ${utsResp.certIssuer || utsResp.CertIssuer}`);
    }

    // Inject CAdES-BES signature into the document (same format ETA expects)
    const signedDoc = JSON.parse(JSON.stringify(document));
    if (!signedDoc.signatures) signedDoc.signatures = [];
    signedDoc.signatures.push({
        signatureType: 'I', // Issuer signature
        type: 'I',
        value: signatureBase64,
    });

    return signedDoc;
}

// ============================================
// DOCUMENT SIGNING VIA LEGACY (EInvoicingSigner.exe)
// ============================================
async function signDocumentLegacy(payload: any, reqId: string): Promise<any> {
    const { document, serialized, pin, certificateIssuer, certificateName } = payload;

    let signerIssuerArg = certificateIssuer || '';
    const thumbprint = certificateName || '';

    // Thumb fingerprint detection: ignore hex hash as issuer
    if (signerIssuerArg && /^[0-9A-Fa-f]{30,}$/.test(signerIssuerArg)) {
        signerIssuerArg = '';
    }

    // Auto-detect issuer
    if (!signerIssuerArg) {
        if (thumbprint && thumbprint.length > 30 && thumbprint !== 'PKCS11_TOKEN') {
            try {
                const issuerLookupCmd = `powershell -NoProfile -Command "chcp 65001 >$null; $cert = Get-Item 'Cert:\\CurrentUser\\My\\${thumbprint}'; if ($cert.Issuer -match 'CN=([^,]+)') { $Matches[1] } else { $cert.Issuer }"`;
                const { stdout: issuerOut } = await execPromise(issuerLookupCmd, { timeout: 10000 });
                if (issuerOut && issuerOut.trim()) signerIssuerArg = issuerOut.trim();
            } catch (e) { }
        }
        if (!signerIssuerArg) {
            try {
                const detectCmd = `powershell -NoProfile -Command "chcp 65001 >$null; $certs = Get-ChildItem 'Cert:\\CurrentUser\\My' | Where-Object { $_.HasPrivateKey }; if ($certs) { $c = @($certs)[0]; if ($c.Issuer -match 'CN=([^,]+)') { $Matches[1] } else { $c.Issuer } } else { '' }"`;
                const { stdout: detectOut } = await execPromise(detectCmd, { timeout: 10000 });
                if (detectOut && detectOut.trim() && !/^[0-9A-Fa-f]{30,}$/.test(detectOut.trim())) signerIssuerArg = detectOut.trim();
            } catch (e) { }
        }
        if (!signerIssuerArg) signerIssuerArg = 'MCDR CA 2022';
    }
    console.log(`[Agent] Legacy signer issuer: "${signerIssuerArg}"`);

    let finalSignerExe = SIGNER_EXE;
    if (!fs.existsSync(finalSignerExe)) {
        const altSigner = path.join(SIGNER_DIR, 'EtaSigner.exe');
        if (fs.existsSync(altSigner)) finalSignerExe = altSigner;
        else throw new Error(`Signer executable not found: ${SIGNER_EXE}`);
    }

    const requestTempDir = path.join(TEMP_DIR, reqId.substring(0, 8));
    if (!fs.existsSync(requestTempDir)) fs.mkdirSync(requestTempDir, { recursive: true });

    const inputFile = path.join(requestTempDir, 'SourceDocumentJson.json');
    const canonicalFile = path.join(requestTempDir, 'CanonicalString.txt');
    const outputFile = path.join(requestTempDir, 'FullSignedDocument.json');

    try {
        try { fs.unlinkSync(outputFile); } catch (e) { }
        fs.writeFileSync(inputFile, JSON.stringify(document, null, 2), 'utf8');
        if (serialized) fs.writeFileSync(canonicalFile, serialized, 'utf8');

        const rawCommand = `chcp 65001 >$null; & "${finalSignerExe}" "${requestTempDir}" "${pin}" "${signerIssuerArg}"`;
        const base64Command = Buffer.from(rawCommand, 'utf16le').toString('base64');
        const psCommand = `powershell -NoProfile -ExecutionPolicy Bypass -Command "chcp 65001 >$null" ; powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${base64Command}`;

        console.log('[Agent] Executing legacy signer...');
        let stdout = '', stderr = '';
        try {
            const result = await execPromise(psCommand, { cwd: SIGNER_DIR, timeout: 60000 });
            stdout = result.stdout; stderr = result.stderr;
        } catch (execErr: any) {
            stdout = execErr.stdout || ''; stderr = execErr.stderr || '';
        }

        if (stdout) console.log('[Agent] Signer output:', stdout.substring(0, 200));
        if (stderr) console.error('[Agent] Signer error:', stderr.substring(0, 200));

        if (!fs.existsSync(outputFile)) {
            throw new Error(`[Signing Failed] Output file not found. USB token plugged in? PIN correct?\nOutput: ${(stdout || 'none').substring(0, 300)}`);
        }

        const signedWrapper = JSON.parse(fs.readFileSync(outputFile, 'utf8'));
        let signedDoc = signedWrapper.documents?.[0] || signedWrapper;

        if (!signedDoc.signatures || signedDoc.signatures.length === 0) {
            throw new Error('No signature generated. Check USB token connection.');
        }

        const sig = signedDoc.signatures[0].value;
        if (sig.length < 100) throw new Error(`Invalid signature (${sig.length} chars).`);

        console.log(`[Agent] ✓ Legacy signature: ${sig.length} chars`);
        return signedDoc;
    } finally {
        try { fs.rmSync(requestTempDir, { recursive: true, force: true }); } catch (e) { }
    }
}

// ============================================
// DOCUMENT SIGNING (UTS-first with CAdES-BES, legacy fallback)
// ============================================
async function signDocument(payload: any, reqId: string) {
    // Strategy: Try UTS first (CAdES-BES via /sign-document-cades endpoint)
    // UTS handles PKCS11 directly — NO system PIN dialog shown!
    // Fallback to legacy EInvoicingSigner.exe if UTS is unavailable

    if (!utsAvailable) {
        utsAvailable = await probeUTS();
    }
    if (utsAvailable) {
        try {
            console.log('[Agent] Attempting UTS CAdES-BES signing (no PIN dialog)...');
            return await signDocumentViaUTS(payload);
        } catch (utsErr: any) {
            console.warn(`[Agent] UTS CAdES-BES signing failed: ${utsErr.message}`);
            if (signerValid) {
                console.log('[Agent] Falling back to legacy EInvoicingSigner.exe...');
            } else {
                throw utsErr; // No fallback available
            }
        }
    }

    if (!signerValid) {
        throw new Error('No signer available. Start UniversalTokenSigner.exe or install EInvoicingSigner files.');
    }
    return await signDocumentLegacy(payload, reqId);
}

// ============================================
// GRACEFUL SHUTDOWN
// ============================================
process.on('SIGINT', () => {
    console.log('\n[Agent] Shutting down gracefully...');
    stopHeartbeat();
    if (socket) {
        socket.close(1000, 'Agent shutting down');
    }
    process.exit(0);
});

process.on('SIGTERM', () => {
    stopHeartbeat();
    if (socket) socket.close(1000, 'Agent terminated');
    process.exit(0);
});

// ============================================
// START
// ============================================
async function main() {
    // 1. Probe UTS
    utsAvailable = await probeUTS();

    // 2. Validate legacy signer (as fallback)
    signerValid = validateLegacySigner();

    if (!utsAvailable && !signerValid) {
        console.error('');
        console.error('╔════════════════════════════════════════════════╗');
        console.error('║  ⚠️  NO SIGNER AVAILABLE                       ║');
        console.error('║  Start UniversalTokenSigner.exe first,         ║');
        console.error('║  or install EInvoicingSigner files.             ║');
        console.error('╚════════════════════════════════════════════════╝');
        console.error('');
    }

    // 3. Show banner and connect
    showBanner();
    connect();
}

main();
