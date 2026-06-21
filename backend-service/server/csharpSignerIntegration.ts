import { exec } from 'child_process';
import { promisify } from 'util';
import { promises as fs } from 'fs';
import path from 'path';

const execPromise = promisify(exec);

// Path to the downloaded C# signer
const SIGNER_DIR = path.join(process.cwd(), 'EInvoicingSigner');
const TEMP_DIR = path.join(SIGNER_DIR, 'temp');
const SIGNER_EXE = path.join(SIGNER_DIR, 'EInvoicingSigner.exe');
const INPUT_FILE = path.join(TEMP_DIR, 'SourceDocumentJson.json');
const OUTPUT_FILE = path.join(TEMP_DIR, 'FullSignedDocument.json');

export async function signInvoiceWithCsharpSigner(
    document: any,
    pin: string,
    certIssuer: string = ""
): Promise<any> {
    try {
        console.log('[C# Signer] Preparing to sign...');

        // Detect if certIssuer is actually a thumbprint (hex hash) — ignore it
        if (certIssuer && /^[0-9A-Fa-f]{30,}$/.test(certIssuer)) {
            console.log(`[C# Signer] Ignoring certIssuer — looks like a thumbprint`);
            certIssuer = '';
        }

        // Auto-detect certificate issuer if not provided
        // Generic: works with ANY CA (MCDR, Egypt Trust, ITIDA, or any future CA)
        if (!certIssuer) {
            try {
                const { stdout } = await execPromise(
                    `powershell -NoProfile -Command "chcp 65001 >$null; $certs = Get-ChildItem 'Cert:\\\\CurrentUser\\\\My' | Where-Object { $_.HasPrivateKey -and -not $_.PrivateKey }; if (!$certs) { $certs = Get-ChildItem 'Cert:\\\\CurrentUser\\\\My' | Where-Object { $_.HasPrivateKey } }; if ($certs) { $c = @($certs)[0]; if ($c.Issuer -match 'CN=([^,]+)') { $Matches[1] } else { $c.Issuer } }"`,
                    { timeout: 10000 }
                );
                if (stdout && stdout.trim()) {
                    certIssuer = stdout.trim();
                    console.log(`[C# Signer] Auto-detected issuer: "${certIssuer}"`);
                }
            } catch (e) {
                console.warn('[C# Signer] Issuer auto-detection failed');
            }
            if (!certIssuer) {
                throw new Error('No signing certificate found. Ensure USB token is plugged in.');
            }
        }

        // Ensure temp directory exists
        await fs.mkdir(TEMP_DIR, { recursive: true });

        // 1. Write the source document
        await fs.writeFile(INPUT_FILE, JSON.stringify(document, null, 2), 'utf8');

        // 1.1 Write the canonical string (Needed for BouncyCastle Signer)
        try {
            const { serializeInvoice } = await import('./etaSerialization.js');
            const canonical = serializeInvoice(document);
            await fs.writeFile(path.join(TEMP_DIR, 'CanonicalString.txt'), canonical, 'utf8');
        } catch (e: any) {
            console.warn('[C# Signer] Serialization module load failed.');
        }

        // A. CLEANUP OLD OUPUT
        try { await fs.unlink(OUTPUT_FILE); } catch (e) { }

        // B. WRAP IN POWERSHELL FOR UNICODE SAFETY
        // We use chcp 65001 to ensure UTF-8 handling of Arabic characters in certIssuer
        const psCommand = `powershell -NoProfile -ExecutionPolicy Bypass -Command "chcp 65001 >$null; & \\"${SIGNER_EXE}\\" \\"${TEMP_DIR}\\" \\"${pin}\\" \\"${certIssuer}\\""`;

        console.log(`[C# Signer] Executing via PowerShell: ${psCommand}`);

        // 3. Execute
        const { stdout, stderr } = await execPromise(psCommand, {
            cwd: SIGNER_DIR,
            timeout: 60000
        });

        if (stdout) console.log('[C# Signer] Stdout:', stdout);
        if (stderr) console.error('[C# Signer] Stderr:', stderr);

        // 4. Read the signed output
        if (!await fileExists(OUTPUT_FILE)) {
            throw new Error(`Signed output file not found. \nStdout: ${stdout}\nStderr: ${stderr}`);
        }

        const signedContent = await fs.readFile(OUTPUT_FILE, 'utf8');
        const signedWrapper = JSON.parse(signedContent);

        // The signer wraps the document in {"documents": [...]}
        let signedDoc;
        if (signedWrapper.documents && Array.isArray(signedWrapper.documents) && signedWrapper.documents.length > 0) {
            signedDoc = signedWrapper.documents[0];
        } else {
            signedDoc = signedWrapper;
        }

        // Verify signature presence and length
        if (!signedDoc.signatures || signedDoc.signatures.length === 0) {
            throw new Error('Document was processed but has no signatures.');
        }

        const sig = signedDoc.signatures[0].value;
        if (sig.length < 100) {
            throw new Error(`INVALID SIGNATURE: "${sig}" - This usually means the token was not detected or PIN was wrong.`);
        }

        console.log(`[C# Signer] ✓ Signature generated: ${sig.length} chars`);

        return signedDoc;

    } catch (error: any) {
        console.error('[C# Signer] Error:', error.message);
        throw new Error(`C# Signer failed: ${error.message}`);
    }
}

async function fileExists(path: string): Promise<boolean> {
    try {
        await fs.access(path);
        return true;
    } catch {
        return false;
    }
}
