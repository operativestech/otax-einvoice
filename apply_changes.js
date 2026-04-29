const fs = require('fs');
const path = require('path');

console.log('=== Applying all changes to disk ===\n');

// 1. Fix server.ts - backtick closing + add download-uts route
const serverPath = path.join('e:/app/OTax New App/backend-service/server/server.ts');
let server = fs.readFileSync(serverPath, 'utf8');

// Fix 1a: Replace escaped backtick with real closing backtick (line ~805)
// The AGENT_CODE_EMBEDDED closing should be ` not \`
const oldClosing = "main();\r\n\\`;";
const newClosing = "main();\r\n`;";
if (server.includes(oldClosing)) {
    server = server.replace(oldClosing, newClosing);
    console.log('[server.ts] ✅ Fixed AGENT_CODE_EMBEDDED closing backtick');
} else if (server.includes("main();\r\n`;")) {
    console.log('[server.ts] ⏩ Backtick already fixed');
} else {
    console.log('[server.ts] ⚠️ Could not find backtick pattern');
}

// Fix 1b: Add download-uts route after download-agent route
const downloadUtsRoute = `
// 0.055 Download UniversalTokenSigner (UTS) Release
app.get('/api/bridge/download-uts', async (req, res) => {
    try {
        const archiver = await import('archiver');
        const fs = await import('fs');
        const path = await import('path');
        const url = await import('url');
        
        const __filename = url.fileURLToPath(import.meta.url);
        const __dirname = path.dirname(__filename);
        
        // Look for UTS release files
        const possiblePaths = [
            path.join(__dirname, '..', 'uts-release'),
            path.join(__dirname, '..', '..', 'UniversalTokenSigner', 'bin', 'Release', 'net8.0-windows'),
        ];
        
        let utsDir = '';
        for (const p of possiblePaths) {
            if (fs.existsSync(p) && fs.existsSync(path.join(p, 'UniversalTokenSigner.exe'))) {
                utsDir = p;
                break;
            }
        }
        
        if (!utsDir) {
            return res.status(404).json({ success: false, message: 'UTS release files not found on server' });
        }
        
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', 'attachment; filename=UniversalTokenSigner.zip');
        
        const archive = archiver.default('zip', { zlib: { level: 9 } });
        archive.on('error', (err) => { throw err; });
        archive.pipe(res);
        
        // Add all files from the UTS release directory
        const files = fs.readdirSync(utsDir);
        for (const file of files) {
            const filePath = path.join(utsDir, file);
            const stat = fs.statSync(filePath);
            if (stat.isFile() && !file.endsWith('.pdb')) {
                archive.file(filePath, { name: file });
            }
        }
        
        await archive.finalize();
    } catch (err) {
        console.error('[UTS Download] Error:', err.message);
        if (!res.headersSent) {
            res.status(500).json({ success: false, message: 'Failed to create UTS download: ' + err.message });
        }
    }
});
`;

if (!server.includes('download-uts')) {
    // Insert after the download-agent route closing
    const marker = "    res.send(agentScript);\r\n});";
    const idx = server.indexOf(marker);
    if (idx !== -1) {
        const insertPoint = idx + marker.length;
        server = server.slice(0, insertPoint) + '\r\n' + downloadUtsRoute + server.slice(insertPoint);
        console.log('[server.ts] ✅ Added download-uts route');
    } else {
        console.log('[server.ts] ⚠️ Could not find download-agent closing to insert download-uts');
    }
} else {
    console.log('[server.ts] ⏩ download-uts route already exists');
}

fs.writeFileSync(serverPath, server, 'utf8');
console.log('[server.ts] 💾 Saved to disk\n');

// 2. Fix agent.ts - disable UTS signing, use legacy only
const agentPath = path.join('e:/app/OTax New App/backend-service/agent/agent.ts');
let agent = fs.readFileSync(agentPath, 'utf8');

const oldSignDoc = `async function signDocument(payload: any, reqId: string) {
    // Try UTS first (universal, supports all token types)
    if (utsAvailable) {
        try {
            return await signDocumentViaUTS(payload);
        } catch (e: any) {
            console.warn(\`[Agent] ⚠️ UTS signing failed: \${e.message}\`);
            if (signerValid) {
                console.log('[Agent] Falling back to legacy EInvoicingSigner.exe...');
            } else {
                throw new Error(\`UTS signing failed and legacy signer is not available: \${e.message}\`);
            }
        }
    }

    // Fallback to legacy
    if (!signerValid) {
        throw new Error('No signer available. Start UniversalTokenSigner or install EInvoicingSigner.exe.');
    }
    return await signDocumentLegacy(payload, reqId);
}`;

const newSignDoc = `async function signDocument(payload: any, reqId: string) {
    // NOTE: UTS currently produces raw RSA signatures, but ETA requires CADES-BES/CMS (PKCS#7).
    // Until UTS supports CMS output, we MUST use the legacy EInvoicingSigner.exe for signing.
    // UTS is still used for certificate listing (/tokens endpoint).
    
    if (!signerValid) {
        throw new Error('No signer available. Legacy EInvoicingSigner.exe is required for signing (CADES-BES format).');
    }
    return await signDocumentLegacy(payload, reqId);
}`;

if (agent.includes('Try UTS first')) {
    agent = agent.replace(oldSignDoc, newSignDoc);
    console.log('[agent.ts] ✅ Disabled UTS signing, using legacy only');
} else if (agent.includes('UTS currently produces raw RSA')) {
    console.log('[agent.ts] ⏩ Already using legacy signing');
} else {
    console.log('[agent.ts] ⚠️ Could not find signDocument function');
}

fs.writeFileSync(agentPath, agent, 'utf8');
console.log('[agent.ts] 💾 Saved to disk\n');

// 3. Fix TokenSignatureSettings.tsx - add UTS download button
const tokenPath = path.join('e:/app/OTax New App/E-Invoice/components/TokenSignatureSettings.tsx');
let tokenFile = fs.readFileSync(tokenPath, 'utf8');

if (!tokenFile.includes('download-uts')) {
    const oldButtons = `<div className="flex gap-3">
                                    <a
                                        href={\`\${DEFAULT_API_URL}/bridge/download-agent?companyId=\${taxId}\`}
                                        download="otax-agent-setup.bat"
                                        className="inline-flex items-center gap-2 px-5 py-2.5 bg-amber-600 text-white font-bold text-sm rounded-xl hover:bg-amber-700 transition-all shadow-md active:scale-[0.97]"
                                    >
                                        <Download size={16} />
                                        Download Agent
                                    </a>
                                    <button
                                        onClick={handleResetNode}`;

    const newButtons = `<div className="flex flex-wrap gap-3">
                                    <a
                                        href={\`\${DEFAULT_API_URL}/bridge/download-agent?companyId=\${taxId}\`}
                                        download="otax-agent-setup.bat"
                                        className="inline-flex items-center gap-2 px-5 py-2.5 bg-amber-600 text-white font-bold text-sm rounded-xl hover:bg-amber-700 transition-all shadow-md active:scale-[0.97]"
                                    >
                                        <Download size={16} />
                                        Download Agent
                                    </a>
                                    <a
                                        href={\`\${DEFAULT_API_URL}/bridge/download-uts\`}
                                        download="UniversalTokenSigner.zip"
                                        className="inline-flex items-center gap-2 px-5 py-2.5 bg-indigo-600 text-white font-bold text-sm rounded-xl hover:bg-indigo-700 transition-all shadow-md active:scale-[0.97]"
                                    >
                                        <Download size={16} />
                                        Download UTS (.exe)
                                    </a>
                                    <button
                                        onClick={handleResetNode}`;

    if (tokenFile.includes('<div className="flex gap-3">')) {
        tokenFile = tokenFile.replace(oldButtons, newButtons);
        console.log('[TokenSignatureSettings.tsx] ✅ Added UTS download button');
    } else {
        console.log('[TokenSignatureSettings.tsx] ⚠️ Could not find buttons div');
    }
} else {
    console.log('[TokenSignatureSettings.tsx] ⏩ UTS button already exists');
}

fs.writeFileSync(tokenPath, tokenFile, 'utf8');
console.log('[TokenSignatureSettings.tsx] 💾 Saved to disk\n');

// 4. Verify agent_config.json has cloud URL
const configPath = path.join('e:/app/OTax New App/backend-service/agent/agent_config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
if (config.cloudUrl !== 'wss://e-invoice-545y.onrender.com') {
    config.cloudUrl = 'wss://e-invoice-545y.onrender.com';
    fs.writeFileSync(configPath, JSON.stringify(config, null, 4), 'utf8');
    console.log('[agent_config.json] ✅ Set to cloud URL');
} else {
    console.log('[agent_config.json] ⏩ Already set to cloud URL');
}

console.log('\n=== All changes applied! ===');
console.log('Now run:');
console.log('  cd /d "e:\\app\\OTax New App\\backend-service" && git add -A && git status --short');
