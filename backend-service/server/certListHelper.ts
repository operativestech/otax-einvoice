import { exec } from 'child_process';
import { promisify } from 'util';

const execPromise = promisify(exec);

export interface Certificate {
    Thumbprint: string;
    Subject: string;
    Issuer: string | null;
    FriendlyName: string;
    NotAfter: string | null;
    Store: string;
}

/**
 * List certificates using certutil (more reliable for smart cards/hardware tokens)
 */
export async function listCertificatesViaCertutil(): Promise<Certificate[]> {
    console.log('[CertList] Starting certificate enumeration...');
    const certs: Certificate[] = [];

    // 1. Try PowerShell (Preferred for structured output)
    try {
        console.log('[PowerShell] Querying Cert:\\CurrentUser\\My...');
        const psCommand = 'powershell -NoProfile -Command "Get-ChildItem -Path Cert:\\CurrentUser\\My | Select-Object Thumbprint, Subject, Issuer, NotAfter, FriendlyName | ConvertTo-Json -Compress"';
        const { stdout } = await execPromise(psCommand);

        if (stdout && stdout.trim()) {
            let parsed = JSON.parse(stdout);
            if (!Array.isArray(parsed)) parsed = [parsed];

            for (const p of parsed) {
                if (p.Thumbprint) {
                    certs.push({
                        Thumbprint: p.Thumbprint,
                        Subject: p.Subject || '',
                        Issuer: typeof p.Issuer === 'string' ? p.Issuer : (p.Issuer?.Name || ''),
                        FriendlyName: p.FriendlyName || p.Subject || '',
                        NotAfter: p.NotAfter ? p.NotAfter.toString() : null,
                        Store: 'CurrentUser (PowerShell)'
                    });
                }
            }
            console.log(`[PowerShell] Found ${certs.length} certificates via PowerShell.`);
            if (certs.length > 0) return certs;
        }
    } catch (err: any) {
        console.warn('[PowerShell] Failed to list certificates:', err.message);
    }

    // 2. Fallback to certutil (Existing Logic)
    try {
        console.log('[certutil] Falling back to certutil -user -store My...');

        // Use certutil to access user's personal certificate store
        const { stdout, stderr } = await execPromise('certutil -store -user My');

        if (stderr) {
            console.warn('[certutil Stderr]', stderr);
        }

        // Parse certutil output
        const certBlocks = stdout.split('================ Certificate');

        for (let i = 1; i < certBlocks.length; i++) {
            const block = certBlocks[i];

            // Extract Thumbprint (Cert Hash)
            const thumbprintMatch = block.match(/Cert Hash\(sha1\):\s*([a-fA-F0-9\s]+)/);
            const thumbprint = thumbprintMatch ? thumbprintMatch[1].replace(/\s/g, '').toUpperCase() : null;

            // Extract Subject
            const subjectMatch = block.match(/Subject:\s*(.+?)(?:\r?\n)/);
            const subject = subjectMatch ? subjectMatch[1].trim() : null;

            // Extract Issuer
            const issuerMatch = block.match(/Issuer:\s*(.+?)(?:\r?\n)/);
            const issuer = issuerMatch ? issuerMatch[1].trim() : null;

            // Extract NotAfter (expiry)
            const notAfterMatch = block.match(/NotAfter:\s*(.+?)(?:\r?\n)/);
            const notAfter = notAfterMatch ? notAfterMatch[1].trim() : null;

            // Extract Friendly Name (if exists)
            const friendlyMatch = block.match(/Friendly name:\s*(.+?)(?:\r?\n)/);
            const friendlyName = friendlyMatch ? friendlyMatch[1].trim() : null;

            if (thumbprint && subject) {
                // Avoid duplicates if PowerShell found some (unlikely if we are here, but good practice)
                if (!certs.find(c => c.Thumbprint === thumbprint)) {
                    certs.push({
                        Thumbprint: thumbprint,
                        Subject: subject,
                        Issuer: issuer,
                        FriendlyName: friendlyName || subject,
                        NotAfter: notAfter,
                        Store: 'CurrentUser (certutil)'
                    });
                }
            }
        }

        console.log(`[certutil] Found ${certs.length} certificates via certutil.`);
        return certs;

    } catch (err: any) {
        console.error('[certutil Error]', err);
        throw new Error(`Failed to list certificates: ${err.message}`);
    }
}
