import { execSync, exec } from 'child_process';
import { promisify } from 'util';
import { promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';

const execPromise = promisify(exec);

// Temp dir for PFX signing operations
const SIGNER_DIR = path.join(process.cwd(), 'EInvoicingSigner');
const TEMP_DIR = path.join(SIGNER_DIR, 'temp');
const SIGNER_EXE = path.join(SIGNER_DIR, 'EInvoicingSigner.exe');

/**
 * Sign an invoice document using a PFX certificate stored in the database.
 * 
 * Flow:
 * 1. Write PFX bytes to a temp file
 * 2. Write unsigned document JSON to temp file
 * 3. Call EInvoicingSigner.exe with the PFX path + password
 * 4. Read signed output
 * 5. Clean up temp PFX file
 */
export async function signWithPFX(
    document: any,
    pfxBuffer: Buffer,
    pfxPassword: string,
    certificateIssuer: string = 'MCDR CA 2022'
): Promise<any> {
    const sessionId = crypto.randomUUID().substring(0, 8);
    const sessionDir = path.join(TEMP_DIR, `pfx_${sessionId}`);

    try {
        console.log(`[PFX Signer] Session ${sessionId}: Starting...`);

        // Create session temp directory
        await fs.mkdir(sessionDir, { recursive: true });

        // 1. Write PFX to temp file
        const pfxPath = path.join(sessionDir, 'cert.pfx');
        await fs.writeFile(pfxPath, pfxBuffer);
        console.log(`[PFX Signer] Session ${sessionId}: PFX written (${pfxBuffer.length} bytes)`);

        // 2. Write unsigned document
        const inputFile = path.join(sessionDir, 'SourceDocumentJson.json');
        await fs.writeFile(inputFile, JSON.stringify(document, null, 2), 'utf8');

        // 3. Write canonical string
        try {
            const { serializeInvoice } = await import('../etaSerialization.js');
            const canonical = serializeInvoice(document);
            await fs.writeFile(path.join(sessionDir, 'CanonicalString.txt'), canonical, 'utf8');
            console.log(`[PFX Signer] Session ${sessionId}: Canonical string (${canonical.length} chars)`);
        } catch (e: any) {
            console.warn(`[PFX Signer] Session ${sessionId}: Serialization warning: ${e.message}`);
        }

        // 4. Clean old output
        const outputFile = path.join(sessionDir, 'FullSignedDocument.json');
        try { await fs.unlink(outputFile); } catch (e) { }

        // 5. Execute EInvoicingSigner.exe with PFX mode
        // The signer supports: EInvoicingSigner.exe <workDir> <PIN> <certIssuer> [pfxPath] [pfxPassword]
        const psCommand = `powershell -NoProfile -ExecutionPolicy Bypass -Command "chcp 65001 >$null; & \\"${SIGNER_EXE}\\" \\"${sessionDir}\\" \\"${pfxPassword}\\" \\"${certificateIssuer}\\" \\"${pfxPath}\\" \\"${pfxPassword}\\""`;

        console.log(`[PFX Signer] Session ${sessionId}: Executing signer...`);
        const { stdout, stderr } = await execPromise(psCommand, {
            cwd: SIGNER_DIR,
            timeout: 60000,
        });

        if (stdout) console.log(`[PFX Signer] Session ${sessionId} stdout:`, stdout.substring(0, 200));
        if (stderr) console.error(`[PFX Signer] Session ${sessionId} stderr:`, stderr.substring(0, 200));

        // 6. Read signed output
        if (!await fileExists(outputFile)) {
            throw new Error(`Signed output not found.\nStdout: ${stdout}\nStderr: ${stderr}`);
        }

        const signedContent = await fs.readFile(outputFile, 'utf8');
        const signedWrapper = JSON.parse(signedContent);

        let signedDoc;
        if (signedWrapper.documents && Array.isArray(signedWrapper.documents) && signedWrapper.documents.length > 0) {
            signedDoc = signedWrapper.documents[0];
        } else {
            signedDoc = signedWrapper;
        }

        // Verify signature
        if (!signedDoc.signatures || signedDoc.signatures.length === 0) {
            throw new Error('Document processed but has no signatures.');
        }

        const sig = signedDoc.signatures[0].value;
        if (sig.length < 100) {
            throw new Error(`Invalid signature: "${sig.substring(0, 50)}..." - PFX password may be wrong or certificate expired.`);
        }

        console.log(`[PFX Signer] Session ${sessionId}: ✓ Signature created (${sig.length} chars)`);
        return signedDoc;

    } catch (error: any) {
        console.error(`[PFX Signer] Session ${sessionId}: Error:`, error.message);
        throw new Error(`PFX signing failed: ${error.message}`);
    } finally {
        // 7. ALWAYS clean up temp PFX (security!)
        try {
            await fs.rm(sessionDir, { recursive: true, force: true });
            console.log(`[PFX Signer] Session ${sessionId}: Temp cleaned up`);
        } catch (e) {
            console.error(`[PFX Signer] Session ${sessionId}: Failed to clean temp:`, e);
        }
    }
}

/**
 * Validate a PFX file — check if it can be opened with the given password
 * and extract certificate metadata.
 */
export async function validatePFX(
    pfxBuffer: Buffer,
    pfxPassword: string
): Promise<{
    valid: boolean;
    subject?: string;
    issuer?: string;
    thumbprint?: string;
    expiresAt?: Date;
    error?: string;
}> {
    const sessionId = crypto.randomUUID().substring(0, 8);
    const tempPfx = path.join(TEMP_DIR, `validate_${sessionId}.pfx`);

    try {
        await fs.mkdir(TEMP_DIR, { recursive: true });
        await fs.writeFile(tempPfx, pfxBuffer);

        // Use PowerShell to read PFX certificate info
        const psScript = `
            try {
                $pfx = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2("${tempPfx.replace(/\\/g, '\\\\')}", "${pfxPassword}", [System.Security.Cryptography.X509Certificates.X509KeyStorageFlags]::Exportable)
                $result = @{
                    Subject = $pfx.Subject
                    Issuer = $pfx.Issuer
                    Thumbprint = $pfx.Thumbprint
                    NotAfter = $pfx.NotAfter.ToString("yyyy-MM-ddTHH:mm:ss")
                    HasPrivateKey = $pfx.HasPrivateKey
                }
                $pfx.Dispose()
                ConvertTo-Json $result
            } catch {
                ConvertTo-Json @{ Error = $_.Exception.Message }
            }
        `;

        const { stdout } = await execPromise(
            `powershell -NoProfile -ExecutionPolicy Bypass -Command "${psScript.replace(/"/g, '\\"')}"`,
            { timeout: 15000 }
        );

        const result = JSON.parse(stdout.trim());

        if (result.Error) {
            return { valid: false, error: result.Error };
        }

        if (!result.HasPrivateKey) {
            return { valid: false, error: 'PFX file does not contain a private key. Cannot sign with this certificate.' };
        }

        return {
            valid: true,
            subject: result.Subject,
            issuer: result.Issuer,
            thumbprint: result.Thumbprint,
            expiresAt: new Date(result.NotAfter),
        };

    } catch (error: any) {
        return { valid: false, error: `Failed to validate PFX: ${error.message}` };
    } finally {
        try { await fs.unlink(tempPfx); } catch (e) { }
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
