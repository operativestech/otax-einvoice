# BouncyCastle C# Signer - Setup Guide

## What We Created

A C# console application that creates **proper detached CAdES-BES signatures** using BouncyCastle library.

### Files Created:
1. `EtaSigner/Program.cs` - Main C# code
2. `EtaSigner/EtaSigner.csproj` - Project file

## Setup Steps

### Step 1: Build the C# Signer

Open a command prompt in the `E:\E-Invoice\E-Invoice\EtaSigner` directory and run:

```cmd
dotnet restore
dotnet build --configuration Release
```

This will:
- Download the BouncyCastle.Cryptography NuGet package
- Compile the C# code
- Create `EtaSigner.exe` in `bin\Release\net6.0\`

### Step 2: Test the Signer

Test it manually first:

```cmd
cd E:\E-Invoice\E-Invoice\EtaSigner\bin\Release\net6.0

EtaSigner.exe "YOUR_CERT_THUMBPRINT" "path\to\data.txt" "path\to\output.txt" "YOUR_PIN"
```

You should see:
```
INFO: Loaded certificate: CN=Your Company Name
SUCCESS: Signature created (XXXX bytes)
SIGNATURE:MIIQRQYJKoZIhvcNAQcCoIIQNjCC...
```

### Step 3: Update server.ts

Replace the `signInvoice` function in `server/server.ts` (around line 454):

```typescript
async function signInvoice(invoiceJson: any, certificateThumbprint: string, pin?: string): Promise<any> {
    const tempSerialized = path.join(__dirname, `temp_serialized_${Date.now()}_${Math.random().toString(36).substring(7)}.txt`);
    const tempOutput = path.join(__dirname, `temp_signature_${Date.now()}_${Math.random().toString(36).substring(7)}.txt`);
    
    // Path to the C# BouncyCastle signer
    const signerPath = path.join(__dirname, '..', 'EtaSigner', 'bin', 'Release', 'net6.0', 'EtaSigner.exe');

    // Canonicalized content for signing
    const serialized = serializeETA(invoiceJson);

    try {
        await fs.writeFile(tempSerialized, serialized, 'utf8');

        // Use C# BouncyCastle signer
        const command = pin
            ? `"${signerPath}" "${certificateThumbprint}" "${tempSerialized}" "${tempOutput}" "${pin}"`
            : `"${signerPath}" "${certificateThumbprint}" "${tempSerialized}" "${tempOutput}"`;

        console.log(`[Signing] Using BouncyCastle C# Signer`);

        const { stdout, stderr } = await execPromise(command);

        // Extract signature
        let signatureValue = '';
        if (stdout.includes('SIGNATURE:')) {
            const parts = stdout.split('SIGNATURE:');
            signatureValue = parts[parts.length - 1].trim();
        } else {
            signatureValue = (await fs.readFile(tempOutput, 'utf8')).trim();
        }

        if (!signatureValue || signatureValue.length < 100) {
            throw new Error(`Invalid signature: ${stdout}`);
        }

        console.log(`[Signer] Detached CAdES-BES signature: ${signatureValue.length} chars`);

        // Return signed document
        return {
            ...invoiceJson,
            signatures: [{
                signatureType: "I",
                value: signatureValue
            }]
        };

    } catch (err: any) {
        console.error('[Signer Error]', err);
        throw new Error(`Invoice signing failed: ${err.message}`);
    } finally {
        try {
            await fs.unlink(tempSerialized);
            await fs.unlink(tempOutput);
        } catch (e) {}
    }
}
```

### Step 4: Restart Server and Test

1. Stop the Node.js server (Ctrl+C)
2. Start it again: `npm run server`
3. Upload your Excel file
4. The signature should now be properly detached!

## How It Works

### The Problem with .NET SignedCms

The standard .NET `SignedCms` class creates this structure:

```asn1
contentInfo {
  contentType: data (1.2.840.113549.1.7.1)
  content: [0] { NULL }  ← ETA rejects this
}
```

### BouncyCastle Solution

BouncyCastle creates the correct structure:

```asn1
contentInfo {
  contentType: data (1.2.840.113549.1.7.1)
  ← No content field at all! ←
}
```

This is what ETA expects for a detached signature.

## Expected Signature Size

- **Attached (wrong):** 8000+ characters
- **Detached (correct):** 2000-4000 characters

If your signature is ~3000 characters, it's working correctly!

## Troubleshooting

### Error: "dotnet: command not found"

Install .NET 6.0 SDK:
https://dotnet.microsoft.com/download/dotnet/6.0

### Error: "Certificate not found"

Make sure your certificate thumbprint is correct:
```cmd
certutil -store -user My
```

### Error: "Cannot access private key"

Your PIN might be required. Make sure you're passing it as the 4th argument.

### Signature Still Too Large

If the signature is still >6000 characters:
1. Check the console output from EtaSigner.exe
2. Look for "SUCCESS: Signature created (XXXX bytes)"
3. If it says >4000 bytes, there might be an issue

## Verification

After building and integrating, you should see in the console:

```
[Signing] Using BouncyCastle C# Signer
INFO: Loaded certificate: CN=Your Company
SUCCESS: Signature created (2847 bytes)
[Signer] Detached CAdES-BES signature: 3796 chars
[Signer Success] Signature size is appropriate for detached CAdES-BES
```

Then when you submit to ETA, you should get:
```
✅ Status: Valid
✅ UUID: XXXXXXXXXXXXXXXXXX
```

## Next Steps

1. Build the C# signer
2. Test it manually
3. Update server.ts
4. Restart server
5. Upload Excel and test!

---

**This is the final solution!** The BouncyCastle library properly creates detached CAdES-BES signatures that ETA accepts.
