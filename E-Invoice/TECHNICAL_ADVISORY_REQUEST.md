# E-Invoice Digital Signature Technical Report

**Project:** Egyptian Tax Authority (ETA) E-Invoicing Integration  
**Issue:** Invalid Digital Signature Error (Code 4062)  
**Date:** January 13, 2026  
**Status:** ⚠️ **BLOCKED** - Requires Technical Advisory

---

## Executive Summary

We are unable to submit e-invoices to the Egyptian Tax Authority (ETA) due to a persistent digital signature validation error. Despite multiple implementation attempts using industry-standard cryptographic libraries, the ETA validator consistently rejects our signatures with error **4062: "Attached digital signature is not supported"**.

**Critical Finding:** We have a working legacy application (`OperativesDataSign.exe`) that successfully signs invoices and passes ETA validation. However, we cannot replicate its exact behavior in our new Node.js-based system.

---

## Technical Background

### System Architecture
- **Backend:** Node.js/TypeScript server
- **Frontend:** Web application for invoice management
- **Certificate Storage:** Hardware token (CNG - Cryptography Next Generation)
- **Certificate Provider:** Misr for Central Clearing, Depository and Registry (MCDR)
- **Certificate Details:**
  - Thumbprint: `4D57D4B2A434E71665118691C0D04A830812D3A2`
  - Subject: OPERATIVES (اوبراتفز لحلول تكنولوجيا المعلومات)
  - Tax ID: VATEG-562067566

### ETA Requirements
The Egyptian Tax Authority requires:
1. **Signature Format:** CAdES-BES (CMS Advanced Electronic Signature - Basic Electronic Signature)
2. **Signature Type:** **Detached** (eContent field must be NULL/absent)
3. **Encoding:** DER (Distinguished Encoding Rules) - NOT BER
4. **Hash Algorithm:** SHA-256
5. **Mandatory Signed Attributes:**
   - `content-type` (OID: 1.2.840.113549.1.7.5)
   - `message-digest` (SHA-256 hash of canonicalized invoice)
   - `signing-certificate-v2` (SHA-256 hash of signer certificate)
   - `signing-time` (UTC timestamp)

---

## Problem History

### Initial Errors (Resolved)
1. ✅ **ISFX305:** "Submitter Taxpayer mismatch" - Fixed by using correct certificate
2. ✅ **BER Encoding:** Signatures were using Indefinite Length encoding - Fixed by forcing DER

### Current Error (Unresolved)
❌ **Error 4062:** "Attached digital signature is not supported"

**Error Details:**
```
Step-03.ITIDA Signature Validator - Invalid Digital Signature
• 4062: Attached digital signature is not supported.
```

---

## Implementation Attempts

### Attempt 1: PowerShell with .NET SignedCms
**Approach:** Used Windows built-in `System.Security.Cryptography.Pkcs.SignedCms`  
**Result:** ❌ Failed - Generated attached signatures  
**Issue:** .NET's SignedCms does not provide sufficient control over ASN.1 structure

### Attempt 2: C# with BouncyCastle (Standard Generator)
**Approach:** Created `EtaSigner.exe` using BouncyCastle's `CmsSignedDataGenerator`  
**Code:**
```csharp
var generator = new CmsSignedDataGenerator();
// ... add signer, certificates, attributes ...
CmsSignedData signedData = generator.Generate(content, false); // false = detached
```
**Result:** ❌ Failed - Still rejected as "attached"  
**Progress:** 
- ✅ Correct DER encoding (signature starts with `MIIJE...`)
- ✅ Correct certificate used
- ❌ ETA still sees it as "attached"

### Attempt 3: C# with Custom ISignatureFactory
**Approach:** Implemented custom signature factory for hardware token support  
**Result:** ❌ Failed - Same error 4062  
**Note:** Successfully handles CNG keys but signature structure still rejected

### Attempt 4: Manual ASN.1 Reconstruction
**Approach:** Added code to detect and reconstruct SignedData with explicit NULL content  
**Code:**
```csharp
if (encapContentInfo.Content != null) {
    // Manually reconstruct with NULL content
    var detachedSignedData = new SignedData(
        digestAlgorithms,
        new ContentInfo(contentType, null), // NULL!
        certificates,
        crls,
        signerInfos
    );
}
```
**Result:** ❌ Failed - Error persists  
**Finding:** `encapContentInfo.Content` is already null, suggesting the issue is elsewhere

---

## Signature Analysis

### Valid Signature (from old desktop app)
**File:** `PYTQW90VVB4CBYR6NECXTHEK10.xml`  
**Status:** ✅ **Valid** - Accepted by ETA  
**Signature Start:** `MIIQRQYJKoZIhvcNAQcC...`  
**Length:** ~4165 bytes (base64)  
**Encoding:** DER (Definite Length)

### Invalid Signature (from our new signer)
**File:** `DDYGMN0A5ZWGT7M00G1C0WEK10.xml`  
**Status:** ❌ **Invalid** - Rejected by ETA (Error 4062)  
**Signature Start:** `MIIJEQYJKoZIhvcNAQcC...`  
**Length:** ~2300 bytes (base64)  
**Encoding:** DER (Definite Length)

### Key Observations
1. Both use DER encoding (start with `MII...`)
2. Both have same OID for signedData (`YJKoZIhvcNAQcC`)
3. Valid signature is **significantly larger** (~1800 bytes difference)
4. Size difference suggests valid signature may include:
   - Full certificate chain (not just signer certificate)
   - Additional attributes or structures
   - Different ASN.1 structure organization

---

## Working Solution (Legacy App)

### Old Desktop Application
**Executable:** `E:\E-Invoice\E-Invoice\old desktop app\OperativesDataSign.exe`  
**Framework:** .NET Framework 4.6.1  
**Dependencies:** BouncyCastle.Crypto.dll  
**Status:** ✅ **Produces valid signatures accepted by ETA**

### Why It Works
- Uses same BouncyCastle library
- Handles hardware tokens correctly
- Generates signatures in exact format ETA expects
- **Proven solution** - currently in production use

### Challenge
- Source code not available
- Cannot easily determine exact signing logic
- Decompilation would be complex and time-consuming

---

## Technical Questions for Advisory

### Question 1: Signature Structure
**Q:** What is the exact ASN.1 structure difference between our signatures and the valid ones?  
**Context:** Both appear to be detached (eContent is null in our code), both use DER encoding, but ETA still rejects ours.  
**Need:** ASN.1 decoder analysis or ETA's exact specification for the SignedData structure.

### Question 2: Certificate Chain
**Q:** Does ETA require the full certificate chain in the signature, or only the signer certificate?  
**Context:** Valid signatures are ~1800 bytes larger than ours. This could be due to including intermediate CA certificates.  
**Current Implementation:** We only include the signer certificate.

### Question 3: BouncyCastle Version
**Q:** Which specific version of BouncyCastle is compatible with ETA's validator?  
**Context:** We're using BouncyCastle.Cryptography 2.4.0 (latest). The old app uses an older version.  
**Concern:** API changes between versions might affect ASN.1 structure generation.

### Question 4: ContentInfo Structure
**Q:** What should be the exact value of the `eContent` field in the `EncapsulatedContentInfo`?  
**Options:**
- Completely absent (field not present in ASN.1)
- Present but NULL (explicit NULL tag)
- Present but empty (zero-length OCTET STRING)

**Context:** BouncyCastle's `Generate(content, false)` might be creating option 2 or 3, while ETA expects option 1.

### Question 5: Alternative Approaches
**Q:** Should we:
- **Option A:** Use the old `OperativesDataSign.exe` by calling it from Node.js?
- **Option B:** Continue debugging BouncyCastle implementation?
- **Option C:** Use a commercial e-invoicing SDK/service?
- **Option D:** Contact ETA or MCDR for their recommended signing tool?

---

## Recommended Next Steps

### Immediate Actions (This Week)
1. **Decompile `OperativesDataSign.exe`** to examine its exact signing logic
2. **Contact MCDR** (certificate provider) for their recommended signing SDK
3. **Contact ETA Support** for:
   - Official signing tool/SDK
   - Detailed ASN.1 structure specification
   - Sample code or reference implementation

### Short-term Solution (If Needed Urgently)
**Integrate old desktop app:**
- Call `OperativesDataSign.exe` from Node.js server
- Pass invoice data as file
- Read generated signature
- Continue with submission

**Pros:**
- ✅ Guaranteed to work (proven solution)
- ✅ Fast implementation (~1-2 hours)
- ✅ No more debugging needed

**Cons:**
- ❌ Dependency on legacy executable
- ❌ Not ideal architecture
- ❌ Harder to maintain long-term

### Long-term Solution
**Proper implementation:**
- Obtain official ETA signing SDK or specification
- Implement using recommended libraries/tools
- Full control and maintainability

---

## Code Repository

All implementation attempts and documentation are in:
```
E:\E-Invoice\E-Invoice\
├── EtaSigner\              # C# BouncyCastle signer
│   └── Program.cs          # Main signing logic
├── server\
│   └── server.ts           # Node.js server with signInvoice function
├── old desktop app\
│   └── OperativesDataSign.exe  # Working legacy signer
└── invoices\               # Test invoices (valid and invalid)
```

---

## Technical Specifications

### Environment
- **OS:** Windows 10/11
- **.NET SDK:** 6.0
- **Node.js:** Latest LTS
- **BouncyCastle:** 2.4.0 (NuGet: BouncyCastle.Cryptography)

### Certificate Details
```
Subject: OPERATIVES اوبراتفز لحلول تكنولوجيا المعلومات
Issuer: CN=MCDR CA 2022
Serial: 49a144babe02ff01bdac6ffe74343c4f
Thumbprint: 4D57D4B2A434E71665118691C0D04A830812D3A2
Tax ID: VATEG-562067566
Valid: 2024-08-08 to 2027-08-08
Key Storage: Hardware Token (CNG)
```

---

## Request for Advisory

**We need guidance on:**

1. **Root Cause Analysis:** Why is ETA rejecting our signatures as "attached" when the eContent field appears to be null?

2. **Implementation Direction:** Should we continue with BouncyCastle or switch to a different approach?

3. **ETA Specifications:** Can you help us obtain the official technical specification for CAdES-BES signatures from ETA?

4. **Immediate Solution:** Is using the old `OperativesDataSign.exe` acceptable as a temporary solution while we work on a proper implementation?

5. **Best Practices:** What is the industry-standard approach for e-invoicing signature generation in Egypt?

---

## Contact Information

**Developer:** [Your Name]  
**Project:** E-Invoice Integration  
**Timeline:** Urgent - System needs to be operational  
**Availability:** Available for immediate consultation

---

**Attachments:**
- Sample valid invoice: `PYTQW90VVB4CBYR6NECXTHEK10.xml`
- Sample invalid invoice: `DDYGMN0A5ZWGT7M00G1C0WEK10.xml`
- Source code: `EtaSigner/Program.cs`
- Error logs and documentation in project folder

---

*This document summarizes 8+ hours of debugging and multiple implementation attempts. We are at a critical decision point and need expert guidance to proceed.*
