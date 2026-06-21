import forge from 'node-forge';
import { Pkcs11Crypto } from '@peculiar/webcrypto-pkcs11';
import crypto from 'crypto';

// PKCS#11 Configuration
const PKCS11_LIB = 'C:\\Windows\\System32\\eps2003csp11.dll';  // MCDR token driver
const TOKEN_PIN = '09761969';  // Will be passed from settings

export async function signInvoiceWithHardwareToken(
    document: any,
    pin: string,
    certIssuer: string = 'MCDR CA 2022'
): Promise<any> {
    try {
        console.log('[Hardware Token Signer] Initializing PKCS#11...');

        // Initialize PKCS#11
        const pkcs11 = new Pkcs11Crypto({
            library: PKCS11_LIB,
            name: "MCDR Token",
            slot: 0,
            readWrite: true,
            pin: pin
        });

        // Get certificate and private key from token
        const keys = await pkcs11.keyStorage.keys();
        if (keys.length === 0) {
            throw new Error('No keys found on hardware token');
        }

        console.log(`[Hardware Token Signer] Found ${keys.length} keys on token`);

        // Serialize the document (ETA format)
        const { serializeInvoice } = await import('./etaSerialization.js');
        const serialized = serializeInvoice(document);
        const dataToSign = Buffer.from(serialized, 'utf8');

        console.log(`[Hardware Token Signer] Serialized: ${serialized.length} chars`);
        console.log(`[Hardware Token Signer] SHA-256: ${crypto.createHash('sha256').update(dataToSign).digest('hex')}`);

        // Create detached CAdES-BES signature using node-forge
        const signature = await createCAdESSignature(dataToSign, keys[0], pkcs11, certIssuer);

        // Add signature to document
        const signedDocument = {
            ...document,
            signatures: [{
                signatureType: 'I',
                value: signature
            }]
        };

        console.log(`[Hardware Token Signer] ✓ Signature created: ${signature.length} chars (~${Math.floor(signature.length * 0.75)} bytes)`);

        if (signature.length < 4000) {
            console.warn('[Hardware Token Signer] WARNING: Signature seems small!');
        } else {
            console.log('[Hardware Token Signer] ✓ Signature size looks good');
        }

        return signedDocument;

    } catch (error: any) {
        console.error('[Hardware Token Signer] Error:', error.message);
        throw new Error(`Hardware token signing failed: ${error.message}`);
    }
}

async function createCAdESSignature(
    data: Buffer,
    privateKey: any,
    pkcs11: Pkcs11Crypto,
    certIssuer: string
): Promise<string> {

    // Get certificate from Windows store (for the public cert)
    const { execSync } = await import('child_process');
    const certData = execSync(`certutil -store -user My "${certIssuer}"`, { encoding: 'utf8' });

    // Parse certificate
    // This is a simplified version - in production, you'd extract the actual cert from certutil output

    // Create PKCS#7 structure using node-forge
    const p7 = forge.pkcs7.createSignedData();

    // Add content (detached)
    p7.content = forge.util.createBuffer(data.toString('binary'));

    // Create signer
    const md = forge.md.sha256.create();
    md.update(data.toString('binary'));

    // Sign using hardware token
    const signature = await pkcs11.subtle.sign(
        {
            name: "RSASSA-PKCS1-v1_5",
            hash: { name: "SHA-256" }
        },
        privateKey,
        data
    );

    // Add signer info to PKCS#7
    p7.addSigner({
        key: privateKey,
        certificate: null, // We'll add this separately
        digestAlgorithm: forge.pki.oids.sha256,
        authenticatedAttributes: [
            {
                type: forge.pki.oids.contentType,
                value: forge.pki.oids.data
            },
            {
                type: forge.pki.oids.messageDigest,
                value: md.digest().getBytes()
            },
            {
                type: forge.pki.oids.signingTime,
                value: new Date()
            }
        ]
    });

    // Convert to DER and Base64
    const der = forge.asn1.toDer(p7.toAsn1()).getBytes();
    return forge.util.encode64(der);
}
