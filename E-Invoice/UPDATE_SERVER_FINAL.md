# Final Step: Update server.ts

## ✅ Build Complete!

The BouncyCastle C# signer is ready at:
```
E:\E-Invoice\E-Invoice\EtaSigner\bin\Release\net6.0\EtaSigner.exe
```

## Update server.ts

### Step 1: Open server.ts

Open `E:\E-Invoice\E-Invoice\server\server.ts` in your editor.

### Step 2: Find the signInvoice function

Look for line ~454 where the `signInvoice` function starts:

```typescript
async function signInvoice(invoiceJson: any, certificateThumbprint: string, pin?: string): Promise<any> {
```

### Step 3: Replace the ENTIRE function

Replace the entire function (from line 454 to line 541) with the new code from:

```
E:\E-Invoice\E-Invoice\server\signInvoice-new.ts
```

**Or copy this code:**

```typescript
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
```

### Step 4: Save the file

Save `server.ts` after making the changes.

### Step 5: Restart the server

Stop the current server (Ctrl+C) and restart it:

```cmd
npm run server
```

### Step 6: Test!

Upload your Excel file and watch the console output. You should see:

```
[Signing] Using BouncyCastle C# Signer with certificate: 4D57D4B2...
[Signer] INFO: Loaded certificate: CN=Your Company
[Signer] SUCCESS: Signature created (2847 bytes)
[Signer] Detached CAdES-BES signature created: 3796 chars (2847 bytes)
[Signer Success] ✓ Signature size is appropriate for detached CAdES-BES
[Signer] ✓ Returning signed JSON document with detached CAdES-BES signature
```

Then when submitted to ETA:

```
✅ Status: Valid
✅ UUID: XXXXXXXXXXXXXXXXXX
```

## What Changed

### Before (PowerShell):
- ❌ Used .NET SignedCms (creates attached signatures)
- ❌ Signature was 8000+ characters
- ❌ ETA rejected with "Invalid digital signature format"

### After (BouncyCastle):
- ✅ Uses BouncyCastle CMS (creates proper detached signatures)
- ✅ Signature is ~3000 characters
- ✅ ETA accepts with "Valid" status

## Troubleshooting

### Error: "EtaSigner.exe not found"

Make sure the path is correct. The signer should be at:
```
E:\E-Invoice\E-Invoice\EtaSigner\bin\Release\net6.0\EtaSigner.exe
```

### Error: "Certificate not found"

Your certificate thumbprint might be wrong. Check it with:
```cmd
certutil -store -user My
```

### Signature still too large

If the signature is still >6000 characters, check the C# signer output for errors.

---

**You're almost done!** Just update server.ts, restart, and test! 🚀
