param(
    [Parameter(Mandatory = $true)]
    [string]$Thumbprint,
    
    [Parameter(Mandatory = $true)]
    [string]$JsonFilePath,
    
    [Parameter(Mandatory = $true)]
    [string]$SerializedFilePath,
    
    [Parameter(Mandatory = $true)]
    [string]$OutputFilePath,
    
    [Parameter(Mandatory = $false)]
    [string]$Pin
)

try {
    # Load required .NET assemblies for cryptographic operations
    Add-Type -AssemblyName System.Security
    
    # Load the certificate from the Windows Certificate Store
    $cert = Get-ChildItem -Path Cert:\CurrentUser\My | Where-Object { $_.Thumbprint -eq $Thumbprint }
    
    if (-not $cert) {
        throw "Certificate with thumbprint $Thumbprint not found in Cert:\CurrentUser\My"
    }
    
    # Read the serialized content to sign (This is the canonicalized ETA string)
    $serializedContent = [System.IO.File]::ReadAllText($SerializedFilePath, [System.Text.Encoding]::UTF8)
    $serializedBytes = [System.Text.Encoding]::UTF8.GetBytes($serializedContent)
    
    # Create ContentInfo (Standard Constructor - Let .NET handle OID defaults)
    # This matches the method used in Step 31 which resulted in a successful submission.
    $contentInfo = New-Object Security.Cryptography.Pkcs.ContentInfo -ArgumentList (, $serializedBytes)
    
    # Use Reflection to FORCE the (ContentInfo, bool) constructor with unwrapped object
    $cmsType = [Security.Cryptography.Pkcs.SignedCms]
    $ctor = $cmsType.GetConstructor(( [Type[]]@([Security.Cryptography.Pkcs.ContentInfo], [bool]) ))
    
    # Check if $contentInfo is wrapped in PSObject and unwrap it if necessary
    $realContentInfo = if ($contentInfo -is [System.Management.Automation.PSObject]) { $contentInfo.PSObject.BaseObject } else { $contentInfo }
    
    $signedCms = $ctor.Invoke(( $realContentInfo, $true ))
    
    if (-not $signedCms.Detached) {
        Write-Error "CRITICAL: SignedCms is NOT DETACHED. This will fail ETA validation."
        exit 1
    }
    
    # Create a CmsSigner
    $cmsSigner = New-Object Security.Cryptography.Pkcs.CmsSigner -ArgumentList $cert
    # Use ExcludeRoot to reduce signature size (Root CA is usually trusted by ETA)
    $cmsSigner.IncludeOption = [Security.Cryptography.X509Certificates.X509IncludeOption]::ExcludeRoot
    
    # Set the digest algorithm to SHA256 (required by ETA)
    $cmsSigner.DigestAlgorithm = New-Object System.Security.Cryptography.Oid("2.16.840.1.101.3.4.2.1") # SHA256
    
    # === ADD MANDATORY CAdES-BES ATTRIBUTES ===
    
    # 1. Signing Time
    $signingTime = New-Object System.Security.Cryptography.Pkcs.Pkcs9SigningTime
    $cmsSigner.SignedAttributes.Add($signingTime)
    
    # 2. ESS Signing Certificate V2 (Mandatory per ITIDA)
    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    $certHash = $sha256.ComputeHash($cert.RawData)
    $hashHex = ($certHash | ForEach-Object { $_.ToString("X2") }) -join ""
    
    # Construct exact ASN.1 DER structure expected by ITIDA:
    # 30 35 (Seq 53)
    #   30 33 (Seq 51)
    #     30 31 (Seq 49)
    #       30 0D (Seq 13 - AlgID)
    #         06 09 60 86 48 01 65 03 04 02 01 (SHA256 OID)
    #         05 00 (Null Params)
    #       04 20 (Octet String 32)
    #         [HASH]
    $essv2Hex = "303530333031300D060960864801650304020105000420" + $hashHex
    $essv2Bytes = [byte[]]($essv2Hex -split '(..)' | Where-Object { $_ } | ForEach-Object { [byte]"0x$_" })
    
    $essOid = New-Object System.Security.Cryptography.Oid("1.2.840.113549.1.9.16.2.47")
    $essAttr = New-Object System.Security.Cryptography.CryptographicAttributeObject -ArgumentList $essOid, (New-Object System.Security.Cryptography.AsnEncodedData -ArgumentList $essOid, $essv2Bytes)
    $cmsSigner.SignedAttributes.Add($essAttr)
    
    # === HANDLE PIN ===
    if (-not [string]::IsNullOrEmpty($Pin)) {
        try {
            if ($cert.HasPrivateKey) {
                # Force CSP login if possible (this is token dependent)
                $privKey = $cert.PrivateKey
                if ($privKey -is [System.Security.Cryptography.RSACryptoServiceProvider]) {
                    $cspParams = New-Object System.Security.Cryptography.CspParameters
                    $cspParams.ProviderType = $privKey.CspKeyContainerInfo.ProviderType
                    $cspParams.KeyContainerName = $privKey.CspKeyContainerInfo.KeyContainerName
                    $cspParams.ProviderName = $privKey.CspKeyContainerInfo.ProviderName
                    $cspParams.Flags = [System.Security.Cryptography.CspProviderFlags]::UseExistingKey
                    $securePin = ConvertTo-SecureString $Pin -AsPlainText -Force
                    $cspParams.KeyPassword = $securePin
                    # Initialize provider with PIN to unlock the token
                    $null = New-Object System.Security.Cryptography.RSACryptoServiceProvider($cspParams)
                }
            }
        }
        catch {}
    }
    
    # Sign the content
    # This will use the SerializedBytes via ContentInfo
    $signedCms.ComputeSignature($cmsSigner)
    

    # Get the signed data
    $signedBytes = $signedCms.Encode()
    
    # CRITICAL FIX: Even though SignedCms.Detached = true, the Encode() method
    # sometimes still includes the content. We need to manually ensure it's detached.
    # Using byte-level hex matching (works with .NET Framework 4.x / PowerShell 5.1)
    
    try {
        # Convert to hex for easier pattern matching
        $hexString = ($signedBytes | ForEach-Object { $_.ToString("X2") }) -join ""
        
        # Look for the data OID (1.2.840.113549.1.7.1) which indicates embedded content
        # OID encoding: 06 09 2A 86 48 86 F7 0D 01 07 01
        $dataOidPattern = "06092A864886F70D010701"
        
        if ($hexString -match $dataOidPattern) {
            Write-Host "DEBUG_CONTENT_FOUND: Signature contains embedded content (data OID found)"
            
            # Find the position of the data OID
            $dataOidIndex = $hexString.IndexOf($dataOidPattern)
            
            if ($dataOidIndex -gt 0) {
                # The content follows the OID as [0] EXPLICIT (tag A0)
                # We need to find and remove the A0 tag and its content
                
                $afterOidIndex = $dataOidIndex + $dataOidPattern.Length
                $afterOidHex = $hexString.Substring($afterOidIndex)
                
                # Check if next tag is A0 (context-specific [0])
                if ($afterOidHex.StartsWith("A0")) {
                    Write-Host "DEBUG_REMOVING_CONTENT: Found A0 tag after data OID"
                    
                    # Read the length of the A0 content
                    $lengthByte = [Convert]::ToByte($afterOidHex.Substring(2, 2), 16)
                    
                    $contentLength = 0
                    $lengthBytes = 2 # "A0" tag (1 byte) + length byte (1 byte) = 2 bytes in hex = 4 chars
                    
                    if ($lengthByte -lt 128) {
                        # Short form length
                        $contentLength = $lengthByte
                        $lengthBytes = 4 # A0 + length byte
                    }
                    else {
                        # Long form length
                        $numLengthBytes = $lengthByte - 128
                        $lengthHex = $afterOidHex.Substring(4, $numLengthBytes * 2)
                        $contentLength = [Convert]::ToInt32($lengthHex, 16)
                        $lengthBytes = 4 + ($numLengthBytes * 2) # A0 + length indicator + length bytes
                    }
                    
                    # Calculate total bytes to remove (tag + length + content)
                    $totalRemoveChars = $lengthBytes + ($contentLength * 2)
                    
                    # Build new hex string without the embedded content
                    $beforeContent = $hexString.Substring(0, $afterOidIndex)
                    $afterContent = $afterOidHex.Substring($totalRemoveChars)
                    $newHexString = $beforeContent + $afterContent
                    
                    # Convert back to bytes
                    $newBytes = [byte[]]($newHexString -split '(..)' | Where-Object { $_ } | ForEach-Object { [Convert]::ToByte($_, 16) })
                    
                    $signedBytes = $newBytes
                    Write-Host "DEBUG_CONTENT_REMOVED: Removed $($totalRemoveChars / 2) bytes of embedded content"
                    Write-Host "DEBUG_NEW_SIZE: $($signedBytes.Length) bytes"
                }
                else {
                    Write-Host "DEBUG_NO_A0_TAG: Content might already be detached"
                }
            }
        }
        else {
            Write-Host "DEBUG_NO_DATA_OID: Signature appears to be detached already"
        }
    }
    catch {
        Write-Host "DEBUG_PARSE_FAILED: $($_.Exception.Message) - Using original signature"
        # If parsing fails, use the original signature
    }
    
    # Explicitly ensure NO line breaks in Base64 string
    $signedBase64 = [System.Convert]::ToBase64String($signedBytes, [Base64FormattingOptions]::None)
    
    # DEBUG LOGS
    Write-Host "DEBUG_SIZE:$($signedBytes.Length)"
    Write-Host "DEBUG_DETACHED:$($signedCms.Detached)"
    Write-Host "DEBUG_OID:$($signedCms.ContentInfo.ContentType.Value)"
    
    # Write only the signature to stdout so Node.js can capture it
    Write-Host "SIGNATURE:$signedBase64"
    exit 0
    
}
catch {
    Write-Error "ERROR: $($_.Exception.Message)"
    Write-Error "Details: $($_.ScriptStackTrace)"
    exit 1
}
