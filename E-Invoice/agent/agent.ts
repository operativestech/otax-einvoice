import WebSocket from 'ws';
import { exec } from 'child_process';
import util from 'util';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import os from 'os';
import { fileURLToPath } from 'url';

const execPromise = util.promisify(exec);

// Define __dirname for ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Constants
const CLOUD_URL = 'wss://e-invoice-545y.onrender.com';
const COMPANY_ID = 'default';
const RECONNECT_INTERVAL = 3000;

// Pathing logic that works for both dev and downloaded mode
const getSignerDir = () => {
    const localPath = path.join(__dirname, 'EInvoicingSigner');
    const parentPath = path.resolve(__dirname, '..', 'EInvoicingSigner');
    if (fs.existsSync(localPath)) return localPath;
    return parentPath;
};

const SIGNER_DIR = getSignerDir();
const TEMP_DIR = path.join(SIGNER_DIR, 'temp');
const SIGNER_EXE = path.join(SIGNER_DIR, 'EInvoicingSigner.exe');
const INPUT_FILE = path.join(TEMP_DIR, 'SourceDocumentJson.json');
const CANONICAL_FILE = path.join(TEMP_DIR, 'CanonicalString.txt');
const OUTPUT_FILE = path.join(TEMP_DIR, 'FullSignedDocument.json');

let socket: WebSocket | null = null;

// Configuration
const CONFIG_FILE = path.join(__dirname, 'agent_config.json');

function getAgentConfig() {
    let config: any = {};
    if (fs.existsSync(CONFIG_FILE)) {
        try {
            config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
        } catch (e) {
            console.error('[Agent] Config Error:', e);
        }
    }

    if (!config.nodeId) {
        config.nodeId = crypto.randomUUID();
        config.companyId = COMPANY_ID;
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
        console.log('[Agent] Generated new Node ID:', config.nodeId);
    }
    return config;
}

const agentConfig = getAgentConfig();

function connect() {
    console.log(`[Agent] Connecting to Cloud: ${CLOUD_URL}... (Node: ${agentConfig.nodeId})`);
    socket = new WebSocket(CLOUD_URL);

    socket.on('open', () => {
        console.log('[Agent] Connected!');
        // Register with persistent ID
        socket?.send(JSON.stringify({
            type: 'register_agent',
            companyId: agentConfig.companyId || COMPANY_ID,
            nodeId: agentConfig.nodeId,
            agentName: os.hostname() // Send PC Name (e.g., DESKTOP-55)
        }));
    });

    socket.on('message', async (data) => {
        try {
            const msg = JSON.parse(data.toString());
            console.log('[Agent] Received:', msg.type);

            if (msg.type === 'request') {
                handleRequest(msg);
            } else if (msg.type === 'registered') {
                console.log('✅ Agent successfully registered and active in Cloud!');
            } else if (msg.type === 'error') {
                console.error('❌ Cloud Error:', msg.message);
                if (msg.message.includes('locked')) {
                    console.error('CRITICAL: This company is already locked to another Signing PC.');
                    console.error('If you want to move the signer to this PC, use the "Reset Node" button in the web dashboard.');
                }
            }
        } catch (e) {
            console.error('[Agent] Message Error:', e);
        }
    });

    socket.on('close', () => {
        console.warn('[Agent] Disconnected. Reconnecting in 5s...');
        socket = null;
        setTimeout(connect, RECONNECT_INTERVAL);
    });

    socket.on('error', (err) => {
        console.error('[Agent] Connection Error:', err.message);
    });
}

async function handleRequest(msg: any) {
    const { reqId, cmd, data } = msg;

    try {
        let payload = null;

        if (cmd === 'list_certs') {
            payload = await listCertificates();
        } else if (cmd === 'sign') {
            payload = await signDocument(data);
        } else {
            throw new Error(`Unknown command: ${cmd}`);
        }

        sendResponse(reqId, true, payload);
    } catch (e: any) {
        console.error('[Agent] Command Failed:', e.message);
        sendResponse(reqId, false, null, e.message);
    }
}

function sendResponse(reqId: string, success: boolean, payload: any, error: string | null = null) {
    if (!socket) return;
    socket.send(JSON.stringify({
        type: 'response',
        reqId,
        success,
        payload,
        error
    }));
}

// ------------------------------------
// Local Logic (Certificates & Signing)
// ------------------------------------

async function listCertificates() {
    console.log('[Agent] Listing Certificates via PowerShell...');
    const psCommand = 'powershell -NoProfile -Command "Get-ChildItem -Path Cert:\\CurrentUser\\My | Select-Object Thumbprint, Subject, Issuer, NotAfter, FriendlyName | ConvertTo-Json -Compress"';
    const { stdout } = await execPromise(psCommand);

    // Parse output... (Reusing robust logic)
    const certs = [];
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
                    NotAfter: p.NotAfter
                });
            }
        }
    }
    return certs;
}

async function signDocument(payload: any) {
    // payload standard from server bridge is { document, serialized, pin, certificateIssuer, certificateName }
    const { document, serialized, pin, certificateIssuer, certificateName } = payload;

    // Favor certificateName (Thumbprint) for lookup
    const thumbprint = certificateName || "";
    const certIdentifier = certificateName || certificateIssuer || "MCDR CA 2022";

    // Check if signer executable exists
    let finalSignerExe = SIGNER_EXE;
    if (!fs.existsSync(finalSignerExe)) {
        const altSigner = path.join(SIGNER_DIR, 'EtaSigner.exe');
        if (fs.existsSync(altSigner)) {
            finalSignerExe = altSigner;
        } else {
            throw new Error('Signer executable not found at: ' + SIGNER_EXE);
        }
    }

    console.log('[Agent] Signer Path: ' + finalSignerExe);

    try {
        if (!fs.existsSync(TEMP_DIR)) {
            fs.mkdirSync(TEMP_DIR, { recursive: true });
        }

        // Cleanup old output
        if (fs.existsSync(OUTPUT_FILE)) {
            try { fs.unlinkSync(OUTPUT_FILE); } catch (e) { }
        }

        fs.writeFileSync(INPUT_FILE, JSON.stringify(document, null, 2), 'utf8');
        if (payload.serialized) fs.writeFileSync(CANONICAL_FILE, payload.serialized, 'utf8');

        // --- ENHANCED: RESOLVE IDENTIFIER ---
        let subjectToUse = certIdentifier;
        if (thumbprint && thumbprint.length > 30) {
            try {
                console.log('[Agent] Mapping Thumbprint via PowerShell...');
                const lookupCmd = 'powershell -NoProfile -Command "chcp 65001 >$null; (Get-Item \'Cert:\\CurrentUser\\My\\' + thumbprint + '\').Subject"';
                const { stdout: subOut } = await execPromise(lookupCmd);
                if (subOut && subOut.trim()) {
                    subjectToUse = subOut.trim();
                    console.log('[Agent] Mapped to Subject: ' + subjectToUse);
                }
            } catch (e) {
                console.warn('[Agent] Thumbprint mapping failed, using thumbprint as identifier.');
            }
        }

        // --- NEW: ROBUST ENCODED COMMAND FOR UNICODE SAFETY ---
        const rawCommand = 'chcp 65001 >$null; & "' + finalSignerExe + '" "' + TEMP_DIR + '" "' + pin + '" "' + subjectToUse + '"';
        const base64Command = Buffer.from(rawCommand, 'utf16le').toString('base64');
        const psCommand = 'powershell -NoProfile -ExecutionPolicy Bypass -Command "chcp 65001 >$null" ; powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand ' + base64Command;

        console.log('[Agent] Executing via Secure Unicode Bridge...');

        // 3. Execute
        let stdout = '';
        let stderr = '';
        try {
            const result = await execPromise(psCommand, {
                cwd: SIGNER_DIR,
                timeout: 60000
            });
            stdout = result.stdout;
            stderr = result.stderr;
        } catch (execErr: any) {
            stdout = execErr.stdout || '';
            stderr = execErr.stderr || '';
            console.error('[Agent Helper] Signer Process Failed (Exit Code ' + execErr.code + ')');
        }

        if (stdout) console.log('[Agent Helper] Stdout:', stdout);
        if (stderr) console.error('[Agent Helper] Stderr:', stderr);

        // 4. Read the signed output
        if (!fs.existsSync(OUTPUT_FILE)) {
            const diags = '\n\n[Signer Output]:\n' + (stdout || 'No output') + '\n\n[Signer Error]:\n' + (stderr || 'No errors');
            throw new Error('Signed output file not found. Check your USB Token and PIN.' + diags);
        }

        const signedContent = fs.readFileSync(OUTPUT_FILE, 'utf8');
        const signedWrapper = JSON.parse(signedContent);

        let signedDoc;
        if (signedWrapper.documents && Array.isArray(signedWrapper.documents) && signedWrapper.documents.length > 0) {
            signedDoc = signedWrapper.documents[0];
        } else {
            signedDoc = signedWrapper;
        }

        // Verify signature presence and VALIDITY
        if (!signedDoc.signatures || signedDoc.signatures.length === 0) {
            throw new Error('Document was processed but has no signatures.');
        }

        const sig = signedDoc.signatures[0].value;

        // CRITICAL CHECK: If signature is too short, it's an error message
        if (sig.length < 100) {
            throw new Error('INVALID SIGNATURE RETURNED: "' + sig + '"\n\nThis usually means the hardware token was not found or the PIN was incorrect.');
        }

        console.log('[Agent] ✓ Signing Successful. Signature length: ' + sig.length);
        return signedDoc;

    } catch (e: any) {
        console.error('[Agent] Signing Failed:', e.message);
        throw new Error(e.message);
    }
}

// Start
connect();
