# E-Invoice Digital Signature Setup Guide

## Overview

This guide explains how to set up digital signature generation for Egyptian Tax Authority (ETA) e-invoices using a hardware USB token.

---

## Prerequisites

### 1. Hardware & Software Requirements

- **Hardware USB Token** (e.g., MCDR CA 2022, Egypt Trust)
- **Windows OS** (Windows 10/11)
- **.NET 7.0 Runtime** (Desktop Runtime x64)
- **Node.js** (v14 or higher)
- **Git** (for cloning the signer repository)

### 2. Certificate Information

You need to know:
- **Token PIN**: Your hardware token PIN (e.g., `09761969`)
- **Certificate Issuer Name**: The name of your certificate authority (e.g., `MCDR CA 2022`)

---

## Installation Steps

### Step 1: Install Token Drivers

1. **Download Egypt Trust Activation Package**
   - Link: https://egypttrust.com/uploads/2021/01/Egypt_Trust_Activation.zip
   - Extract and run `Egypt_Trust_Activation.msi`
   - During installation, select **"Private CSP"**
   - When prompted with security warning for "Egypt_RootCA_G1", click **Yes**

2. **Verify Installation**
   - Open **ePass2003 Token Manager** (installed with activation package)
   - Connect your USB token
   - Enter your PIN
   - Confirm you can see your certificate

---

### Step 2: Install .NET 7.0 Runtime

1. **Download .NET 7.0 Desktop Runtime (x64)**
   - Link: https://dotnet.microsoft.com/en-us/download/dotnet/thank-you/runtime-7.0.20-windows-x64-installer
   - Run the installer
   - Complete installation

---

### Step 3: Download and Setup EInvoicingSigner

1. **Clone the Repository**
   ```cmd
   cd e:\E-Invoice\E-Invoice
   git clone https://github.com/ahmadabousetta/Egypt-tax-invoice-api.git temp_signer
   ```

2. **Copy Signer Files**
   ```cmd
   xcopy temp_signer\c#_signer\publish\* EInvoicingSigner\ /E /Y
   ```

3. **Clean Up**
   ```cmd
   rmdir /s /q temp_signer
   ```

---

### Step 4: Get Your Certificate Issuer Name

1. **Run Command**
   ```cmd
   certutil -user -store My
   ```

2. **Find Your Certificate**
   - Look for the certificate with your company name
   - Copy the **Issuer** line (e.g., `CN=MCDR CA 2022, OU=...`)
   - Extract the **CN** value (e.g., `MCDR CA 2022`)

---

### Step 5: Configure the Signer

1. **Create Batch File**
   
   Create `e:\E-Invoice\E-Invoice\EInvoicingSigner\SubmitInvoices.bat`:
   ```batch
   @echo off
   set "app_dir=%~dp0"
   set "app_dir=%app_dir:~0,-1%"
   
   call "%app_dir%\EInvoicingSigner.exe" "%app_dir%" YOUR_PIN "YOUR_ISSUER_NAME"
   pause
   ```

2. **Update Values**
   - Replace `YOUR_PIN` with your token PIN (e.g., `09761969`)
   - Replace `YOUR_ISSUER_NAME` with your certificate issuer (e.g., `MCDR CA 2022`)

---

### Step 6: Test the Signer

1. **Create Test Input**
   
   Create `e:\E-Invoice\E-Invoice\EInvoicingSigner\SourceDocumentJson.json`:
   ```json
   {
     "issuer": {"type": "B", "id": "123", "name": "Test"},
     "receiver": {"type": "B", "id": "456", "name": "Test Receiver"},
     "documentType": "I",
     "documentTypeVersion": "1.0",
     "dateTimeIssued": "2026-01-16T00:00:00Z",
     "taxpayerActivityCode": "1234",
     "internalID": "TEST-001",
     "invoiceLines": []
   }
   ```

2. **Run the Signer**
   ```cmd
   cd e:\E-Invoice\E-Invoice\EInvoicingSigner
   SubmitInvoices.bat
   ```

3. **Verify Output**
   - Check `FullSignedDocument.json` was created
   - Verify it contains a `signatures` array
   - Signature value should be ~5,500 characters long

---

## Integration with Node.js Application

The integration is already complete in your project:

### Files Involved

1. **`server/csharpSignerIntegration.ts`**
   - Handles communication with the C# signer
   - Writes input JSON, executes signer, reads output

2. **`server/server.ts`**
   - Calls `signInvoiceWithCsharpSigner()` during invoice submission
   - Used in both manual and Excel import flows

### How It Works

1. **Invoice Created** → Node.js builds ETA document
2. **Document Sent to Signer** → Written to `SourceDocumentJson.json`
3. **Signer Executes** → `EInvoicingSigner.exe` signs with hardware token
4. **Signature Retrieved** → Read from `FullSignedDocument.json`
5. **Invoice Submitted** → Sent to ETA with valid signature

---

## Troubleshooting

### "No device detected"
**Cause**: Certificate issuer name doesn't match  
**Fix**: Verify issuer name with `certutil -user -store My`

### ".NET 7.0 required"
**Cause**: .NET 7.0 not installed  
**Fix**: Install .NET 7.0 Desktop Runtime from link above

### "Certificate not found"
**Cause**: Token not connected or PIN incorrect  
**Fix**: 
- Ensure USB token is connected
- Verify PIN is correct
- Check token manager shows certificate

### "Signature too small"
**Cause**: Signer couldn't access token  
**Fix**: 
- Restart computer
- Reconnect token
- Verify drivers installed correctly

---

## Configuration Reference

### Environment Variables (in `.env`)

```env
# Certificate Configuration
CERTIFICATE_PIN=09761969
CERTIFICATE_ISSUER=MCDR CA 2022
```

### Signer Paths

- **Signer Directory**: `e:\E-Invoice\E-Invoice\EInvoicingSigner`
- **Input File**: `SourceDocumentJson.json`
- **Output File**: `FullSignedDocument.json`
- **Signature Cache**: `Cades.txt`

---

## Maintenance

### Updating the Signer

If a new version is released:

1. Download new version from repository
2. Backup current `EInvoicingSigner` folder
3. Replace files (keep `SubmitInvoices.bat`)
4. Test with sample invoice

### Certificate Renewal

When your certificate expires:

1. Obtain new certificate from provider
2. Install on token via token manager
3. Update `CERTIFICATE_ISSUER` if issuer name changed
4. Test signing process

---

## Security Notes

- **Never share your PIN** or commit it to version control
- **Private keys remain on token** and are never exposed
- **Signature is hardware-backed** and cannot be forged
- **Keep token secure** - it's your legal identity

---

## Success Criteria

✅ Token drivers installed  
✅ .NET 7.0 installed  
✅ EInvoicingSigner configured  
✅ Test signing produces ~5,500 char signature  
✅ Node.js integration working  
✅ ETA accepts invoices with "Valid" status  
✅ No error 4062 (signature not supported)  
✅ No error 4043 (hash mismatch)

---

## Support

For issues:
1. Check troubleshooting section above
2. Verify all prerequisites installed
3. Test signer standalone before integration
4. Check server logs for detailed error messages

---

**Last Updated**: 2026-01-16  
**Version**: 1.0
