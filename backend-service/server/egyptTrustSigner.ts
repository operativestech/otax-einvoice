import { exec } from 'child_process';
import { promisify } from 'util';
import { promises as fs } from 'fs';
import path from 'path';

const execPromise = promisify(exec);

// EInvoiceSignerApp paths
const SIGNER_PATH = 'E:\\E-Invoice\\EInvoiceSignerApp';
const SIGNER_EXE = path.join(SIGNER_PATH, 'EInvoiceSignerApp.exe');
const INPUT_FILE = path.join(SIGNER_PATH, 'input.json');
const OUTPUT_FILE = path.join(SIGNER_PATH, 'output.json');

export async function signInvoiceWithEgyptTrust(
    document: any,
    pin: string
): Promise<any> {
    try {
        console.log('[Egypt Trust Signer] Writing document to input.json...');

        // Write unsigned document
        await fs.writeFile(INPUT_FILE, JSON.stringify(document, null, 2), 'utf8');

        // Call signer
        const command = `"${SIGNER_EXE}"`;
        console.log('[Egypt Trust Signer] Signing with hardware token...');
        console.log('[Egypt Trust Signer] Please enter PIN when prompted...');

        const { stdout, stderr } = await execPromise(command, {
            cwd: SIGNER_PATH,
            timeout: 60000 // 60 seconds for PIN entry
        });

        if (stderr) {
            console.error('[Egypt Trust Signer] Error:', stderr);
        }
        if (stdout) {
            console.log('[Egypt Trust Signer] Output:', stdout);
        }

        // Read signed document
        const signedJson = await fs.readFile(OUTPUT_FILE, 'utf8');
        const signedDocument = JSON.parse(signedJson);

        console.log('[Egypt Trust Signer] ✓ Document signed successfully');

        // Verify signature
        if (signedDocument.signatures && signedDocument.signatures.length > 0) {
            const sigLength = signedDocument.signatures[0].value.length;
            const sigBytes = Math.floor(sigLength * 0.75);
            console.log(`[Egypt Trust Signer] Signature size: ${sigLength} chars (~${sigBytes} bytes)`);

            if (sigLength > 4000) {
                console.log('[Egypt Trust Signer] ✓ Signature looks valid (includes full chain)');
            } else {
                console.warn('[Egypt Trust Signer] WARNING: Signature seems small - may be missing chain');
            }
        } else {
            throw new Error('No signature found in output');
        }

        return signedDocument;

    } catch (error: any) {
        console.error('[Egypt Trust Signer] Failed:', error.message);
        throw new Error(`Egypt Trust signing failed: ${error.message}`);
    }
}
