# Certificate Chain Installation Guide

## Problem
Error: "A certificate chain could not be built to a trusted root authority"

This means Windows doesn't trust the certificate because the CA (Certificate Authority) certificates are missing.

## Solution: Install Certificate Chain

### Method 1: Install via E-Pass (Recommended)

1. **Open E-Pass PKI Manager**
2. **Login with your USB token**
3. **Double-click on your certificate** (the one showing your company name)
4. **Go to "Certification Path" tab**
5. **You should see a chain like**:
   ```
   Egypt_RootCA_G1
   └── MCDR CA 2022
       └── Your Company Certificate
   ```
6. **Install missing certificates**:
   - Click on "Egypt_RootCA_G1"
   - Click "View Certificate"
   - Go to "Details" tab
   - Click "Copy to File"
   - Save as `Egypt_RootCA_G1.cer`
   - Double-click the saved file
   - Click "Install Certificate"
   - Choose "Local Machine"
   - Place in "Trusted Root Certification Authorities"
   - Click Finish

7. **Repeat for MCDR CA 2022**:
   - Same steps but place in "Intermediate Certification Authorities"

### Method 2: Download from Certificate Provider

#### For Egypt Trust:
1. Visit: https://www.egypttrust.com/downloads
2. Download Root CA certificate
3. Download Intermediate CA certificate
4. Install both as described above

#### For Misr El Maqasa (MCDR):
1. Visit: https://www.mcsd.com.eg/repository/
2. Download "MCDR CA 2022.cer"
3. Download "Egypt_RootCA_G1.cer"
4. Install both

### Method 3: Auto-Install via PowerShell (Easiest)

Run this in PowerShell as Administrator:

```powershell
# Get certificate from token
$cert = Get-ChildItem -Path Cert:\CurrentUser\My | Where-Object { $_.Thumbprint -eq "254265F6AF042223990D0E4DB39489BA9AB15DE9" }

# Export the chain
$chain = New-Object System.Security.Cryptography.X509Certificates.X509Chain
$chain.Build($cert)

# Install each certificate in the chain
foreach ($element in $chain.ChainElements) {
    $certToInstall = $element.Certificate
    
    if ($certToInstall.Subject -like "*Root*") {
        # Install root CA
        $store = New-Object System.Security.Cryptography.X509Certificates.X509Store("Root", "LocalMachine")
        $store.Open("ReadWrite")
        $store.Add($certToInstall)
        $store.Close()
        Write-Host "Installed Root CA: $($certToInstall.Subject)"
    }
    elseif ($certToInstall.Subject -ne $cert.Subject) {
        # Install intermediate CA
        $store = New-Object System.Security.Cryptography.X509Certificates.X509Store("CA", "LocalMachine")
        $store.Open("ReadWrite")
        $store.Add($certToInstall)
        $store.Close()
        Write-Host "Installed Intermediate CA: $($certToInstall.Subject)"
    }
}

Write-Host "Certificate chain installation complete!"
```

## Verification

After installing, verify the chain:

1. Open E-Pass
2. Double-click your certificate
3. Go to "Certification Path" tab
4. All certificates should show ✓ (checkmark)
5. No red X or warning icons

## Alternative: Modify PowerShell Script (Temporary Fix)

If you can't install the CA certificates, you can modify the signing script to skip chain validation:

**File**: `server/signWithCertificate.ps1`

Add this line after creating `$cmsSigner` (around line 52):

```powershell
# Skip certificate chain validation (TEMPORARY - not recommended for production)
$cmsSigner.IncludeOption = [Security.Cryptography.X509Certificates.X509IncludeOption]::WholeChain
```

⚠️ **Warning**: This is not recommended for production as it may cause ETA to reject the signature.

## Next Steps

1. Install the certificate chain using Method 3 (PowerShell)
2. Restart E-Pass application
3. Try submitting the invoice again
4. If still failing, check the Certification Path in E-Pass
