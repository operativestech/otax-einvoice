async function signInvoice(invoiceJson: any, certificateThumbprint: string, pin?: string): Promise<any> {
    const tempSerialized = path.join(__dirname, `temp_serialized_${Date.now()}_${Math.random().toString(36).substring(7)}.txt`);
    const tempOutput = path.join(__dirname, `temp_signature_${Date.now()}_${Math.random().toString(36).substring(7)}.txt`);

    // Path to the C# BouncyCastle signer
    const signerPath = path.join(__dirname, '..', 'EtaSigner', 'bin', 'Release', 'net6.0', 'EtaSigner.exe');

    // Canonicalized content for signing (ETA requires canonicalization)
    const serialized = serializeETA(invoiceJson);

    try {
        await fs.writeFile(tempSerialized, serialized, 'utf8');

        // Use C# BouncyCastle signer for proper detached CAdES-BES signature
        const command = pin
            ? `"${signerPath}" "${certificateThumbprint}" "${tempSerialized}" "${tempOutput}" "${pin}"`
            : `"${signerPath}" "${certificateThumbprint}" "${tempSerialized}" "${tempOutput}"`;

        console.log(`[Signing] Using BouncyCastle C# Signer with certificate: ${certificateThumbprint.substring(0, 8)}... ${pin ? '(with PIN)' : ''}`);

        const { stdout, stderr } = await execPromise(command);

        // Log any info/success messages from C# signer
        if (stdout) {
            const lines = stdout.split('\n');
            lines.forEach(line => {
                if (line.includes('INFO:') || line.includes('SUCCESS:')) {
                    console.log(`[Signer] ${line.trim()}`);
                }
            });
        }

        // Parse signature from output
        let signatureValue = '';
        if (stdout.includes('SIGNATURE:')) {
            const parts = stdout.split('SIGNATURE:');
            signatureValue = parts[parts.length - 1].trim();
        } else {
            // Try reading from output file
            try {
                signatureValue = (await fs.readFile(tempOutput, 'utf8')).trim();
            } catch (e) {
                throw new Error(`Failed to extract signature: ${stdout}`);
            }
        }

        if (!signatureValue || signatureValue.length < 100) {
            throw new Error(`Invalid signature received: ${stdout}`);
        }

        // Log signature info
        const sigBytes = Math.round(signatureValue.length * 0.75);
        console.log(`[Signer] Detached CAdES-BES signature created: ${signatureValue.length} chars (${sigBytes} bytes)`);

        // Detached signatures should be 2-4KB typically
        if (signatureValue.length > 8000) {
            console.warn(`[Signer Warning] Signature is large (${signatureValue.length} chars). Might still be attached!`);
        } else {
            console.log(`[Signer Success] ✓ Signature size is appropriate for detached CAdES-BES`);
        }

        // Add signature to the invoice JSON
        const signedInvoiceJson = {
            ...invoiceJson,
            signatures: [
                {
                    signatureType: "I",
                    value: signatureValue
                }
            ]
        };

        console.log('[Signer] ✓ Returning signed JSON document with detached CAdES-BES signature');
        return signedInvoiceJson;

    } catch (err: any) {
        console.error('[Signer Error]', err);
        throw new Error(`Invoice signing failed: ${err.message}`);
    } finally {
        // Clean up temp files
        try {
            await fs.unlink(tempSerialized);
            await fs.unlink(tempOutput);
        } catch (cleanupErr) {
            // Ignore cleanup errors
        }
    }
}
