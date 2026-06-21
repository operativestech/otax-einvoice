# Install Certificate Chain for ETA E-Invoicing
# Run this as Administrator

param(
    [Parameter(Mandatory = $true)]
    [string]$Thumbprint
)

Write-Host "=== Certificate Chain Installer ===" -ForegroundColor Cyan
Write-Host "Thumbprint: $Thumbprint" -ForegroundColor Yellow

try {
    # Find the certificate
    Write-Host "`nSearching for certificate..." -ForegroundColor Yellow
    $cert = Get-ChildItem -Path Cert:\CurrentUser\My | Where-Object { $_.Thumbprint -eq $Thumbprint }
    
    if (-not $cert) {
        throw "Certificate with thumbprint $Thumbprint not found in CurrentUser\My store"
    }
    
    Write-Host "✓ Found certificate: $($cert.Subject)" -ForegroundColor Green
    
    # Build the certificate chain
    Write-Host "`nBuilding certificate chain..." -ForegroundColor Yellow
    $chain = New-Object System.Security.Cryptography.X509Certificates.X509Chain
    $chain.ChainPolicy.RevocationMode = [System.Security.Cryptography.X509Certificates.X509RevocationMode]::NoCheck
    $buildResult = $chain.Build($cert)
    
    Write-Host "Chain build result: $buildResult" -ForegroundColor $(if ($buildResult) { "Green" } else { "Yellow" })
    Write-Host "Chain elements found: $($chain.ChainElements.Count)" -ForegroundColor Cyan
    
    # Display the chain
    Write-Host "`nCertificate Chain:" -ForegroundColor Cyan
    for ($i = 0; $i -lt $chain.ChainElements.Count; $i++) {
        $element = $chain.ChainElements[$i]
        $indent = "  " * $i
        Write-Host "$indent└─ $($element.Certificate.Subject)" -ForegroundColor White
        Write-Host "$indent   Issuer: $($element.Certificate.Issuer)" -ForegroundColor Gray
        Write-Host "$indent   Thumbprint: $($element.Certificate.Thumbprint)" -ForegroundColor Gray
    }
    
    # Install certificates
    Write-Host "`n=== Installing Certificates ===" -ForegroundColor Cyan
    
    $installed = 0
    foreach ($element in $chain.ChainElements) {
        $certToInstall = $element.Certificate
        
        # Skip the end-entity certificate (your certificate)
        if ($certToInstall.Thumbprint -eq $cert.Thumbprint) {
            Write-Host "⊘ Skipping end-entity certificate" -ForegroundColor Gray
            continue
        }
        
        # Determine if this is a root or intermediate CA
        $isRoot = $certToInstall.Subject -eq $certToInstall.Issuer
        
        if ($isRoot) {
            # Install to Trusted Root Certification Authorities
            Write-Host "`nInstalling ROOT CA: $($certToInstall.Subject)" -ForegroundColor Yellow
            $storeName = "Root"
            $storeLocation = "LocalMachine"
        }
        else {
            # Install to Intermediate Certification Authorities
            Write-Host "`nInstalling INTERMEDIATE CA: $($certToInstall.Subject)" -ForegroundColor Yellow
            $storeName = "CA"
            $storeLocation = "LocalMachine"
        }
        
        try {
            $store = New-Object System.Security.Cryptography.X509Certificates.X509Store($storeName, $storeLocation)
            $store.Open([System.Security.Cryptography.X509Certificates.OpenFlags]::ReadWrite)
            
            # Check if already installed
            $existing = $store.Certificates | Where-Object { $_.Thumbprint -eq $certToInstall.Thumbprint }
            if ($existing) {
                Write-Host "  ⊘ Already installed" -ForegroundColor Gray
            }
            else {
                $store.Add($certToInstall)
                Write-Host "  ✓ Installed successfully" -ForegroundColor Green
                $installed++
            }
            
            $store.Close()
        }
        catch {
            Write-Host "  ✗ Failed: $($_.Exception.Message)" -ForegroundColor Red
            Write-Host "  → Try running PowerShell as Administrator" -ForegroundColor Yellow
        }
    }
    
    # Verify the chain again
    Write-Host "`n=== Verification ===" -ForegroundColor Cyan
    $chain2 = New-Object System.Security.Cryptography.X509Certificates.X509Chain
    $chain2.ChainPolicy.RevocationMode = [System.Security.Cryptography.X509Certificates.X509RevocationMode]::NoCheck
    $verifyResult = $chain2.Build($cert)
    
    if ($verifyResult) {
        Write-Host "✓ Certificate chain is now valid!" -ForegroundColor Green
        Write-Host "`nYou can now sign invoices with this certificate." -ForegroundColor Cyan
    }
    else {
        Write-Host "⚠ Chain validation still has issues:" -ForegroundColor Yellow
        foreach ($status in $chain2.ChainStatus) {
            Write-Host "  - $($status.StatusInformation)" -ForegroundColor Yellow
        }
        Write-Host "`nThis might be OK - try signing an invoice to test." -ForegroundColor Cyan
    }
    
    Write-Host "`n=== Summary ===" -ForegroundColor Cyan
    Write-Host "Certificates installed: $installed" -ForegroundColor White
    Write-Host "Total chain elements: $($chain.ChainElements.Count)" -ForegroundColor White
    
}
catch {
    Write-Host "`n✗ Error: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host $_.ScriptStackTrace -ForegroundColor Gray
    exit 1
}
