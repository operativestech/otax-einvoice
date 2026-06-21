# Using the Working Desktop App Signer

## The Solution

Instead of trying to recreate the signing logic, we'll use the **working `OperativesDataSign.exe`** from your old desktop app!

## How to Use It

### Step 1: Test the Old Signer

First, let's test if `OperativesDataSign.exe` works from command line:

```cmd
cd "E:\E-Invoice\E-Invoice\old desktop app"
OperativesDataSign.exe --help
```

Or try signing a test file to see what parameters it needs.

### Step 2: Find the Command Line Arguments

We need to figure out how to call it. Common patterns:

```cmd
OperativesDataSign.exe <inputFile> <outputFile> <thumbprint> <pin>
```

Or:

```cmd
OperativesDataSign.exe -input <file> -output <file> -cert <thumbprint> -pin <pin>
```

### Step 3: Update server.ts

Once we know the command, we'll update `signInvoice` to call it:

```typescript
async function signInvoice(invoiceJson: any, certificateThumbprint: string, pin?: string): Promise<any> {
    const tempSerialized = path.join(__dirname, `temp_serialized_${Date.now()}.txt`);
    const tempOutput = path.join(__dirname, `temp_signature_${Date.now()}.txt`);
    
    // Path to the working signer
    const signerPath = path.join(__dirname, '..', 'old desktop app', 'OperativesDataSign.exe');

    // Canonicalized content
    const serialized = serializeETA(invoiceJson);

    try {
        await fs.writeFile(tempSerialized, serialized, 'utf8');

        // Call the working signer
        const command = `"${signerPath}" "${tempSerialized}" "${tempOutput}" "${certificateThumbprint}" "${pin}"`;

        const { stdout, stderr } = await execPromise(command);

        // Read the signature
        const signatureValue = (await fs.readFile(tempOutput, 'utf8')).trim();

        // Return signed document
        return {
            ...invoiceJson,
            signatures: [{
                signatureType: "I",
                value: signatureValue
            }]
        };

    } catch (err: any) {
        throw new Error(`Signing failed: ${err.message}`);
    } finally {
        try {
            await fs.unlink(tempSerialized);
            await fs.unlink(tempOutput);
        } catch (e) {}
    }
}
```

## Next Steps

1. **Test `OperativesDataSign.exe` manually** to find the correct command line arguments
2. **Share the command** that works
3. **I'll update server.ts** to use it
4. **Test and celebrate!** 🎉

This is the **BEST solution** because:
- ✅ It already works with ETA
- ✅ It already handles your certificate correctly
- ✅ It already creates proper detached signatures
- ✅ No need to reinvent the wheel!

---

**Please test `OperativesDataSign.exe` and share how to call it!**
