import axios from 'axios';

// Configuration for the ETA Signer service
const SIGNER_URL = 'http://localhost:8080/eta-einvoice-signer';
const SIGNER_USERNAME = 'admin';  // Update this
const SIGNER_PASSWORD = 'password';  // Update this

export async function signInvoiceWithETAService(
    document: any,
    pin: string,
    certIssuer: string = 'MCDR CA 2022'
): Promise<any> {
    try {
        console.log('[ETA Signer Service] Preparing to sign document...');

        // The service expects: { "documents": [document1, document2, ...] }
        const payload = {
            documents: [document]
        };

        // Call the signing service with Basic Auth
        const response = await axios.post(SIGNER_URL, payload, {
            auth: {
                username: SIGNER_USERNAME,
                password: SIGNER_PASSWORD
            },
            headers: {
                'Content-Type': 'application/json'
            },
            timeout: 30000 // 30 second timeout
        });

        console.log('[ETA Signer Service] ✓ Response received');

        // The service returns: { "documents": [signedDoc1, signedDoc2, ...] }
        if (response.data && response.data.documents && response.data.documents.length > 0) {
            const signedDocument = response.data.documents[0];

            // Check signature
            if (signedDocument.signatures && signedDocument.signatures.length > 0) {
                const sigLength = signedDocument.signatures[0].value.length;
                const sigBytes = Math.floor(sigLength * 0.75);
                console.log(`[ETA Signer Service] Signature size: ${sigLength} chars (~${sigBytes} bytes)`);

                if (sigLength < 4000) {
                    console.warn('[ETA Signer Service] WARNING: Signature seems small!');
                } else {
                    console.log('[ETA Signer Service] ✓ Signature size looks good');
                }
            }

            return signedDocument;
        } else {
            throw new Error('Invalid response from signing service');
        }

    } catch (error: any) {
        if (error.code === 'ECONNREFUSED') {
            console.error('[ETA Signer Service] Connection refused - is the service running?');
            throw new Error('ETA Signer Service is not running. Please start it first.');
        } else if (error.response) {
            console.error('[ETA Signer Service] Error response:', error.response.status, error.response.data);
            throw new Error(`ETA Signer Service error: ${error.response.status}`);
        } else {
            console.error('[ETA Signer Service] Failed:', error.message);
            throw new Error(`ETA Signer Service failed: ${error.message}`);
        }
    }
}
