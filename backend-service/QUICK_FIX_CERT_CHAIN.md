# Quick Fix: Certificate Chain Error

## Error You Got
```
A certificate chain could not be built to a trusted root authority
```

## What This Means
Windows doesn't trust your certificate because the CA (Certificate Authority) certificates are not installed.

## Quick Fix Steps

### Step 1: Run Certificate Chain Installer

**Open PowerShell as Administrator** and run:

```powershell
cd E:\E-Invoice\E-Invoice\server
.\installCertificateChain.ps1 -Thumbprint "254265F6AF042223990D0E4DB39489BA9AB15DE9"
```

**Expected Output**:
```
=== Certificate Chain Installer ===
✓ Found certificate: CN=...
Chain elements found: 3
Installing ROOT CA: Egypt_RootCA_G1
  ✓ Installed successfully
Installing INTERMEDIATE CA: MCDR CA 2022
  ✓ Installed successfully
✓ Certificate chain is now valid!
```

### Step 2: Verify Installation

1. Open E-Pass PKI Manager
2. Double-click your certificate
3. Go to "Certification Path" tab
4. All certificates should show ✓ (green checkmark)

### Step 3: Test Again

Go back to your app and try submitting the invoice again!

## If Script Fails

### Manual Installation:

1. **Download CA Certificates**:
   - Egypt Root CA: https://www.rootca.gov.eg/
   - MCDR CA: https://www.mcsd.com.eg/repository/

2. **Install Root CA**:
   - Double-click `Egypt_RootCA_G1.cer`
   - Click "Install Certificate"
   - Choose "Local Machine"
   - Place in "Trusted Root Certification Authorities"

3. **Install Intermediate CA**:
   - Double-click `MCDRC A2022.cer`
   - Choose "Local Machine"
   - Place in "Intermediate Certification Authorities"

## After Installation

Try submitting your invoice again. The error should be gone!

If you still get errors, check:
- E-Pass is running
- USB token is connected
- Certificate shows in E-Pass with green checkmark
- PIN is correct
