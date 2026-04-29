# Hardware-Token Signing Integration for Egypt ETA Portal Submissions

**Executive summary.** The entity["organization","Egyptian Tax Authority","tax administration egypt"] eInvoicing/eReceipt APIs expect taxpayer systems to submit documents (typically JSON, sometimes XML) that include a **Base64-encoded CAdES-BES** signature created over a canonicalized representation of the document and produced using the taxpayer’s **eSeal X.509 certificate**. The ETA SDK describes a deterministic five-step process: build unsigned document → canonicalize → SHA‑256 → sign using CAdES‑BES → embed Base64 CAdES‑BES into the document payload before submission. citeturn1search0turn2search0turn2search1

The entity["organization","Information Technology Industry Development Agency","egypt etida regulator"] (ITIDA) signature profile used by ETA is unusually strict. ITIDA’s “Digital Signature Format for E‑Invoice System” mandates a detached CMS SignedData container with **eContentType = DigestData**, **no encapsulated content**, **no unsigned attributes**, and **exactly four signed attributes**: `ContentType`, `MessageDigest`, `SigningTime`, and `SigningCertificateV2` (ESSCertIDv2). It also locks algorithms to **SHA‑256** and **sha256WithRSAEncryption**. citeturn0search0

ETA’s validation library reinforces these constraints by explicitly rejecting **encapsulated content**, disallowing **CAdES‑T/C/X/XL**, and stating that “CMS signature” (i.e., non‑conforming CMS/PKCS#7 structures) is not accepted—only valid CAdES‑BES is allowed. It also enforces trust-chain and revocation checks, including that chains must reach the **Egypt Root CA**. citeturn0search1

For a cloud web app, the central architectural implication is that “pure browser” APIs cannot reliably access an existing national‑PKI smartcard/USB token and produce an ITIDA‑conformant CAdES‑BES structure. The pattern that aligns with official Egyptian portal tooling is a **local signer** installed on the user machine that the browser triggers; ITIDA’s Web‑Sign Client is a desktop application installed once on Windows, launched from the portal, which performs token signing with user review, certificate selection, and PIN entry. citeturn3search4turn3search3

Assumptions (explicit): user OS distro, token vendor/model, and application language are unspecified; the design should center on **PKCS#11** with OS token stack fallbacks (Windows CNG/CAPI, macOS CryptoTokenKit) and provide consistent signing UX on Windows/Linux/macOS where feasible. citeturn5search0turn20search4turn20search1

## ETA and ITIDA signing requirements and accepted standards

ETA eInvoicing/eReceipt submission (for invoices/receipts) requires CAdES‑BES signatures in the document payload, not PDF-visible signatures. The Invoice v1.0 schema defines a `signatures` element with `type` (Issuer “I”, ServiceProvider “S”) and `value` (Base64‑encoded CAdES‑BES structure containing signer certificate, the signed hash, and signature value) and states SHA‑256 hashing is used for the “elements to sign.” citeturn2search1

**Accepted vs. non-accepted formats.** For ETA API submission, the documented accepted signature format is **CAdES‑BES**. ITIDA’s validation library rejects other CAdES levels (T/C/X/XL) and rejects generic CMS signatures, indicating the signature must conform to the ITIDA CAdES‑BES profile rather than being an arbitrary PKCS#7/CMS SignedData blob. citeturn0search1turn0search0  
PAdES (PDF) and XAdES (XML) are not described as acceptable for the `signatures.value` field for eInvoice submission; ETA instead consumes a Base64 CAdES‑BES signature for the canonicalized JSON/XML invoice content. citeturn2search1turn1search0turn0search0

**Canonicalization and hashing.** ETA’s “Document Serialization Approach” defines a deterministic serialization algorithm for JSON/XML to avoid signature instability due to whitespace/newlines or platform serialization differences. ETA then applies **SHA‑256** to the UTF‑8 bytes of this canonical representation, producing a 32‑byte digest that is signed. citeturn2search0turn1search0

**ITIDA CAdES‑BES profile: structure, attributes, and algorithms.** ITIDA’s signature creation guide specifies CMS SignedData requirements for ETA eInvoice signatures, including: no encapsulated content (`eContent` should not be present), only signer certificate in the certificates set, and unsigned attributes must not be present. It explicitly restricts hash algorithm support to **SHA‑256** and signature algorithm to **sha256WithRSAEncryption** (RSA PKCS#1 v1.5 + SHA‑256). citeturn0search0

The four **mandatory signed attributes** (and their OIDs) required by ITIDA include ContentType, MessageDigest, SigningTime, and ESS signing-certificate-v2 (SigningCertificateV2 / ESSCertIDv2). ITIDA references CMS (RFC 3852), CAdES (RFC 5126), and ESS SigningCertificateV2 (RFC 5035) as the standards basis, but constrains the implementation to a strict subset. citeturn0search0turn25search0turn5search1turn5search2

**Detached DigestData and PKCS#7/CMS nuance.** CMS is defined in IETF RFC 3852 (and updated by RFC 5652) and provides SignedData as a generic container. CAdES (RFC 5126) profiles CMS for advanced signatures. ETA’s profile uses CMS mechanics but requires exact values (notably `eContentType = DigestData`) and disallows “encapsulated” content and non‑BES levels. citeturn25search0turn25search1turn5search1turn0search0turn0search1

**Certificate format: eSeal X.509 and identity binding.** ETA’s “Getting started” overview explicitly includes “Getting eSeal X.509 certificate that needs to be configured in ERP and POS system that is submitting digitally signed documents.” citeturn2search7turn24search5  
ITIDA/ETA materials on e-seal indicate that e-sealing certificates include a taxpayer identity field (Tax ID) to differentiate taxpayer companies, and ETA’s self-registration procedure requires an eSeal certificate containing the taxpayer registration ID. citeturn4search0turn3search3  
ITIDA’s e-signature page describes the ecosystem: digital signature for natural persons and electronic seal for legal persons, with services obtained from ITIDA‑licensed providers under Law No. 15 of 2004. citeturn4search2

**Revocation and trust-chain constraints: Egypt Root CA + OCSP/CRL.** ETA’s validation library includes explicit error codes for: self-signed certificates not allowed (“should be signed from Egypt Root CA”), certificate chains not reaching Egypt Root CA (certificate not trusted), and failing revocation checks via OCSP and CRL. citeturn0search1  
The entity["organization","Egyptian Root CA","national root ca egypt"] CPS describes OCSP/CRL services and relying-party guidance; the CP describes the certification hierarchy and certificate services for electronic signatures/seals, including OCSP responders and CRL signers. citeturn0search2turn4search6

**Timestamping: ecosystem availability vs ETA acceptance.** Egypt Root CA CPS describes a public timestamp service based on RFC 3161 transported over HTTP. citeturn0search2turn25search6  
However, ETA validation explicitly rejects CAdES‑T and higher, so embedding RFC 3161 timestamps in the CAdES container (as unsigned attributes) would be rejected under the published rules; ETA instead expects BES-level signatures including SigningTime as a signed attribute. citeturn0search1turn0search0

**Transport/API constraints: OAuth2, headers, rate limits, endpoints.** ETA’s APIs use OAuth 2.0 client-credentials flow with `POST /connect/token`, Basic authorization (client ID + secret), and token lifetime defaults (commonly 1 hour); tokens should be cached for their lifetime. citeturn24search0turn2search2  
ETA standard headers include `correlationId` for tracing and `X-Rate-Limit-*` headers describing server rate limits. citeturn1search1  
ETA publishes governance/rate-limiting rules (including handling of HTTP 429 with Retry‑After and HTTP 503 overload), and provides throttling specifications per API. citeturn1search2turn1search5  
For preprod environment configuration, the ETA Integration Toolkit sample config contains Identity Service and API base URLs (e.g., `https://id.preprod.eta.gov.eg/connect/token`, `https://api.preprod.invoicing.eta.gov.eg`). citeturn24search1

## Browser-to-token access methods

A key constraint is that the browser must produce an **ETA‑conformant CAdES‑BES** using an existing **hardware token/smartcard** certificate. Most browser APIs are not designed for this. Below, “ETA‑conformant” means meeting ITIDA structure requirements (DigestData, 4 signed attrs, SHA‑256, sha256WithRSAEncryption, detached, no unsigned attrs) and ETA validation constraints (no CAdES‑T, no encapsulated content, trust-chain to Egypt Root CA). citeturn0search0turn0search1

**WebCrypto (SubtleCrypto).** WebCrypto can compute SHA‑256 digests and generate signatures using a `CryptoKey`, but it does not provide a standardized mechanism to access an existing national-PKI token key directly (PKCS#11/CNG/CTK integration is outside the WebCrypto model). WebCrypto signing requires a key already usable as a `CryptoKey`. citeturn19search0turn19search4turn19search12  
Pros: no install; runs in browser; good for digest/canonicalization verification. Cons: cannot reliably use existing eSeal token keys; does not assemble CMS/CAdES structures by itself; still requires CAdES container generation that matches ITIDA constraints. ETA‑conformant CAdES‑BES with existing token: generally **not feasible**. citeturn0search0turn5search0

**WebAuthn (passkeys/FIDO2).** WebAuthn creates and uses scoped credentials for user authentication, with origin-bound access and user consent flows. It is designed for authentication assertions rather than producing a CMS/CAdES signature containing an X.509 eSeal chain. citeturn19search1  
Pros: strong origin binding; good for authenticating users to your cloud app. Cons: does not produce ITIDA CAdES‑BES; keys aren’t the same as ITIDA-trusted eSeal certs; cannot by default embed SigningCertificateV2/ESSCertIDv2 and other CMS signed attributes in the required form. ETA‑conformant CAdES‑BES with existing token: **not viable** (use it for login/auth, not invoice signing). citeturn19search1turn0search0

**WebUSB.** WebUSB is an API to access USB devices from web pages with permission prompts, mainly on Chromium-based implementations. citeturn19search2  
Pros: can talk to certain USB peripherals without native drivers. Cons: most signature tokens/smartcards are accessed via OS smartcard stacks and PKCS#11 modules, not via vendor-neutral WebUSB protocols; implementing token APDUs/protocols in JS is brittle and vendor-specific. ETA‑conformant CAdES‑BES with existing national-PKI token: **rarely feasible**. citeturn19search2turn5search0turn18view0

**WebHID.** WebHID provides access to HID devices; it is selectively enabled in Chromium-family browsers. citeturn19search3turn19search11  
Pros: useful for some HID-class devices. Cons: signature tokens are typically not HID-signing devices; enterprise policies may disable it; does not solve CMS/CAdES container creation. ETA‑conformant CAdES‑BES with existing token: **not viable** in most real deployments. citeturn19search3turn0search0

**Native helper app (desktop signer).** This is the pattern used by official ITIDA portal tooling: Web‑Sign Client is installed once, browsers prompt the user to open it after clicking sign, then it lists available certificates, allows review, and prompts for smart token PIN. citeturn3search4turn3search3  
Pros: can access token via PKCS#11/OS APIs; can enforce ITIDA signature profile precisely; can implement secure UI for PIN and consent; works across browsers. Cons: install/updates; endpoint security (if exposed via localhost) must be hardened; official ITIDA client is Windows 8/10 limited, implying cross-platform support is your responsibility. citeturn3search4turn20search4turn20search1  
ETA‑conformant CAdES‑BES with existing token: **yes**, and this is the most realistic route. citeturn0search0turn3search4

**Browser extension + native messaging.** Chrome/Chromium extensions can message a native host (stdin/stdout) if the host is registered and allowlisted; Mozilla documents similar “native messaging” for WebExtensions. citeturn5search3turn5search23  
Pros: strong origin binding / allowlisting in host manifest; avoids exposing a generic localhost port; good UX integration and permissions. Cons: extension deployment overhead; multiple browser ecosystems; native host still requires install and signing. ETA‑conformant CAdES‑BES: **yes**, typically the best security posture for web-triggered signing. citeturn5search3turn0search0turn0search1

**Localhost agent (HTTP/HTTPS/WebSocket).** Many real solutions implement a local service listening on loopback (e.g., WebSocket). ITIDA Web‑Sign Client is effectively a local app launched by the portal. citeturn3search4turn7view1  
Pros: no extension required; compatible with all browsers via loopback. Cons: localhost services are commonly targeted by cross-site attacks unless strict origin/challenge hardening is applied; firewall/proxy issues; TLS on localhost is tricky. ETA‑conformant CAdES‑BES: **yes** if implemented correctly and hardened. citeturn7view1turn0search0turn0search1

**Middleware/backends (token access) used by helper apps.**  
- PKCS#11 is standardized by entity["organization","OASIS","standards consortium"] as an ANSI C API for tokens and HSMs. citeturn5search0  
- OpenSC provides open-source PKCS#11/MiniDriver smart card middleware across Windows/macOS/Linux. citeturn6view0  
- pcsc-lite provides a PC/SC (WinSCard) API implementation for Unix-like systems and documents supported OS and a BSD-like license; it explicitly notes macOS uses CryptoTokenKit and that building pcsc-lite on macOS is typically unnecessary. citeturn18view0  
- Windows smart cards can be accessed through CNG Smart Card KSP/minidrivers via entity["company","Microsoft","software company"] APIs. citeturn20search4turn20search0  
- macOS token access is supported by entity["company","Apple","consumer electronics company"] CryptoTokenKit. citeturn20search1  

## Open-source projects and libraries

The following table enumerates candidate open-source components for a production solution. “Maturity” is assessed primarily from repository activity/usage signals and project longevity; “Example usage” is brief and oriented toward your integration problem.

| Project | Language | License | Platforms | Token standards / capability | Maturity | Example usage | Egypt-specific notes |
|---|---:|---|---|---|---|---|---|
| OpenSC | C | LGPL‑2.1 | Win/macOS/Linux | PKCS#11 module + smart card tools, Windows MiniDriver support | High | Use OpenSC tooling to validate token visibility and PKCS#11 module behavior | Strong cross-platform token middleware base. citeturn6view0 |
| pcsc-lite | C | BSD-like (plus some files under other licenses) | Linux/Unix; macOS uses CTK | PC/SC stack (`pcscd`/WinSCard-like API) | High | Install pcsc-lite + vendor/OpenSC PKCS#11 module on Linux to access smartcards | Official site includes license text and supported OS notes. citeturn18view0 |
| p11-kit | C | BSD‑3‑Clause | Linux/Unix | PKCS#11 module discovery & coordination | High | Avoid hardcoding PKCS#11 module paths via standard module config | Useful on Linux for module enumeration/coordination. citeturn8view0turn12view0 |
| SoftHSMv2 | C | BSD‑2‑Clause | Win/macOS/Linux builds | Software PKCS#11 “token” emulator (CI/testing) | High | Run CI tests signing via PKCS#11 without physical tokens | Essential for automated tests; not for production key storage. citeturn13view0turn9view1 |
| pkcs11js | Node (C++/N-API) | MIT | Win/macOS/Linux | Direct PKCS#11 2.40 interface from Node | Medium–High | Build a local agent that loads vendor PKCS#11 module and calls C_Sign | Good for local signer service in Node. citeturn7view0turn6view1 |
| node-webcrypto-p11 | TypeScript | MIT | Win/macOS/Linux | WebCrypto-like interface backed by PKCS#11 | Medium | Implement token-based operations via WebCrypto semantics in Node | Still requires explicit CMS/CAdES assembly meeting ITIDA rules. citeturn9view2turn13view1 |
| webcrypto-local | TypeScript | MIT | Win/macOS/Linux | Local service exposing PKCS#11 over “webcrypto-socket” + security policy | Medium | Use as a blueprint for secure “local agent” protocol design | Includes peer approval/security-policy model relevant to localhost risks. citeturn9view3turn13view2 |
| Pkcs11Interop | C# | Apache‑2.0 | Win/macOS/Linux | .NET wrapper for PKCS#11 modules | High | Implement a .NET signer that loads vendor PKCS#11 module, finds cert/key, performs sign | Strong choice for self-contained cross-platform signer apps. citeturn14view0 |
| DSS | Java | LGPL‑2.1 | Cross-platform (JVM) | High-level AdES creation/validation (CAdES/PAdES/XAdES) | High | Use AdES abstractions but constrain output to ITIDA BES profile | Must ensure it emits exactly ETA-required attributes/structure (no extra unsigned attrs). citeturn7view2 |
| Bouncy Castle | Java/C# | Bouncy Castle License (MIT-like) | Cross-platform | Low-level CMS building blocks | High | Construct CMS SignedData with exact signed attributes and detached payload | Best when you need byte-level control for ITIDA constraints. citeturn20search2turn20search7 |
| LibreSign | PHP | AGPL‑3.0 | Server app | Document signing workflows (PDF-oriented) | Medium | Reference for workflow UX; not an ETA invoice signer | Not directly helpful for ETA JSON/XML signing profile. citeturn15view0 |
| JSignPdf | Java | MPL‑2.0 and LGPL‑2.1 (project docs) | Cross-platform (JVM) | PDF signing (PAdES-like workflows) | Medium | PDF signing utilities and PKCS#11 configs | Useful only if you also sign PDF artifacts; ETA submission signature is CAdES in JSON/XML. citeturn16view0turn2search1 |
| mrkindy/ETAHttpSignature | C# | MIT | Windows-focused | Local WebSocket signer returning `cades` | Medium | Connect to `ws://localhost:18088` and send serialized data; receive Base64 CAdES | Egypt-specific reference pattern for web-to-local signing. citeturn7view1 |
| mrkindy/EgyptianEInvoice | PHP | MIT | Server-side | ETA integration SDK + example WebSocket signer integration | Medium | Shows integration with local token signer tool and ETA API usage patterns | Egypt-specific; explicitly links to ETAHttpSignature. citeturn15view2 |
| mostafaism1/eta-einvoice-signer | Java | **License unclear** (no license shown) | Cross-platform (JVM) | Supports PKCS#11 hardware and PKCS#12 file keystore | Medium | Self-hosted signer endpoint; config supports hardware token or PKCS#12 | Treat as reference; absence of license implies no reuse rights by default. citeturn22view0turn23view0 |
| AH3laly/Egypt-ETA-E-Invoice-Signer | .NET | **License unclear** (no license shown) | Windows-focused | CLI serialization + signing utility | Medium | Useful for debugging canonicalization/signature mismatch | Treat as reference; verify licensing before reuse. citeturn22view1turn23view1 |

## Integration architectures and implementation options

A compliant system must preserve three invariants: (a) canonicalization per ETA algorithm, (b) CAdES‑BES per ITIDA profile, and (c) certificate trust/identity constraints (eSeal, Egypt Root CA chain, revocation checks). citeturn2search0turn0search0turn0search1turn2search1

image_group{"layout":"carousel","aspect_ratio":"16:9","query":["PKCS#11 smart card token architecture diagram","CAdES CMS SignedData structure diagram","browser extension native messaging architecture diagram"],"num_per_query":1}

**Option: Pure web (“no install”).** This is generally infeasible for ETA eSeal token signing. WebCrypto/WebAuthn do not provide a standardized path to invoke an existing token private key and then assemble ITIDA’s exact CMS/CAdES structure (DigestData, required signed attrs, no unsigned attrs). Even if you could sign bytes, the regulated certificate and signature structure requirements remain. citeturn19search0turn19search1turn0search0turn0search1

**Option: Browser extension + native messaging (recommended for security).** The web app messages an extension; the extension messages a local native host which performs token signing and returns Base64 CAdES‑BES. This avoids exposing a generic localhost port and enables strict allowlisting of the calling extension/origin in the native host manifest. citeturn5search3turn5search23turn0search0turn0search1

```mermaid
sequenceDiagram
  participant U as User
  participant W as Cloud Web App (Browser)
  participant S as Cloud Backend
  participant X as Browser Extension
  participant H as Native Messaging Host (Local Signer)
  participant T as Hardware Token/Smartcard
  participant E as ETA APIs

  U->>W: Approve invoice; click "Sign & Submit"
  W->>S: Request canonical payload for document
  S->>S: Canonicalize (ETA serialization) + SHA-256
  S-->>W: canonicalString (or hash) + docId + nonce
  W->>X: postMessage(signRequest)
  X->>H: NativeMessaging(signRequest)
  H->>H: Verify allowlisted extension + nonce freshness
  H->>T: Cert selection + PIN entry; perform RSA signing
  T-->>H: Signature value
  H-->>X: Base64(CAdES-BES) + cert fingerprint
  X-->>W: Signature result
  W->>S: Upload signature
  S->>E: OAuth2 token + Submit Documents
  E-->>S: submissionId + correlationId
  S-->>W: Status + tracking
```

**Option: Localhost agent (HTTP/HTTPS/WebSocket).** A local signer listens on loopback; the browser initiates signing. This matches Egypt-specific open-source precedent (`ws://localhost:18088`) and is conceptually similar to ITIDA’s Web‑Sign Client being invoked from a portal (desktop app installed once, used for token signing). citeturn7view1turn3search4

```mermaid
sequenceDiagram
  participant U as User
  participant W as Cloud Web App (Browser)
  participant S as Cloud Backend
  participant A as Local Signer Agent (localhost)
  participant T as Hardware Token/Smartcard
  participant E as ETA APIs

  U->>W: Click "Sign"
  W->>S: Request canonical payload
  S-->>W: canonicalString + serverNonce
  W->>A: WS/HTTPS signRequest(canonicalString, serverNonce)
  A->>A: Check Origin + nonce + show consent UI
  A->>T: Prompt PIN; sign per ITIDA profile
  T-->>A: Signature value
  A-->>W: Base64(CAdES-BES)
  W->>S: POST signature
  S->>E: Submit signed documents
  E-->>S: submissionId + correlationId
```

**Server-side components (common to both native approaches).** ETA’s recommended integration practices emphasize caching access tokens, using callback endpoints (preferred) or polling (secondary), and avoiding anti-patterns like reauth on every call or excessive document-level status checks during submission processing. citeturn2search2turn24search0turn1search2  
A practical backend stack therefore includes: document builder + schema validation, canonicalization service (single source of truth), signature pre-validation (parse CMS, check required attributes, check detached requirements), ETA API client with OAuth2 token cache, rate-limit aware retry/backoff logic (429/503 handling), and callback endpoints (`/notifications/documents`, `/notifications/receipts`) if you implement the recommended callback flow. citeturn2search2turn1search2turn1search5

**Canonicalization placement (server vs client).** Canonicalization is deterministic but easy to get subtly wrong. Server-side canonicalization strongly reduces divergence risk—especially around numeric formatting and serialization edge cases—because you maintain a single audited implementation of ETA’s algorithm. ETA explicitly frames canonicalization as the solution to serialization differences between platforms/tools. citeturn2search0turn1search0

**Packaging signed output for ETA (JSON).** After obtaining Base64 CAdES‑BES from the local signer, embed it as issuer signature in the document’s `signatures` array and submit via “Submit Documents.” citeturn2search1turn2search3

```json
{
  "documents": [
    {
      "documentType": "i",
      "documentTypeVersion": "1.0",
      "...": "...",
      "signatures": [
        { "type": "I", "value": "<BASE64_CADES_BES>" }
      ]
    }
  ]
}
```

**Command examples (PKCS#11 device sanity checks).** In production you’ll use PKCS#11 via code, but `pkcs11-tool` is invaluable for debugging module paths, IDs, and supported mechanisms:

```bash
# List slots (readers/tokens)
pkcs11-tool --module /path/to/pkcs11.so --list-slots

# List certificates visible to PKCS#11
pkcs11-tool --module /path/to/pkcs11.so --list-objects --type cert

# Sign a file using RSA-PKCS mechanism with a private key ID
pkcs11-tool --module /path/to/pkcs11.so --sign --id $ID --mechanism RSA-PKCS \
  --input-file data --output-file data.sig
```

The command form and `--mechanism` usage are documented in the pkcs11-tool manual (including signing examples). citeturn21search5turn21search1  
For ETA you typically need a SHA‑256 + RSA signature; many tokens expose an integrated mechanism like `SHA256-RSA-PKCS` (token hashes internally) or expect “raw RSA” over a DigestInfo block; your signer must match token capabilities while still producing ITIDA’s required `signatureAlgorithm` OID and signed attributes. citeturn21search3turn0search0

**CAdES‑BES creation (implementation reality).** Most CMS libraries generate “reasonable defaults” with extra attributes or different content types; ETA requires you to set exact OIDs and omit forbidden fields. ITIDA’s required `eContentType = DigestData` and “no encapsulated content” plus “no unsigned attributes” are the most common pitfalls when using generic CMS builders. citeturn0search0turn0search1

**Implementation-ready minimal local signer pseudocode (Node + PKCS#11).** The minimal viable signer must: (1) accept ETA canonical string, (2) produce `MessageDigest = SHA-256(canonicalBytes)`, (3) build SignedAttributes exactly as ITIDA requires including SigningCertificateV2(ESSCertIDv2) with SHA‑256 cert hash, (4) DER‑encode SignedAttributes per CMS signing rules, (5) call token `C_Sign` for `sha256WithRSAEncryption` semantics, and (6) assemble final SignedData with `DigestData` content type and no eContent, then Base64 encode. The structure requirements are defined by ITIDA and enforced by ETA validation. citeturn0search0turn0search1turn7view0turn5search0

```javascript
// PSEUDOCODE (shape of a production implementation)
// Dependencies: pkcs11js (token access), ASN.1/CMS builder (e.g., pkijs/asn1js) to craft strict SignedData.
//
// Input: canonicalString, pkcs11ModulePath, tokenPin, certSelector
// Output: base64CadesBes

import pkcs11js from "pkcs11js";
import { sha256 } from "./hash";              // implement using Node crypto
import { buildItidaSignedAttrs, assembleSignedData } from "./itida-cades"; // must match ITIDA profile

export async function signEtaCanonical({ canonicalString, pkcs11ModulePath, tokenPin, certSelector }) {
  const canonicalBytes = Buffer.from(canonicalString, "utf8");
  const messageDigest = sha256(canonicalBytes);

  const pkcs11 = new pkcs11js.PKCS11();
  pkcs11.load(pkcs11ModulePath);
  pkcs11.C_Initialize();

  try {
    const slot = findSlotWithToken(pkcs11);
    const session = pkcs11.C_OpenSession(slot, pkcs11js.CKF_SERIAL_SESSION | pkcs11js.CKF_RW_SESSION);
    pkcs11.C_Login(session, pkcs11js.CKU_USER, tokenPin);

    // Locate signer certificate + private key (by label/ID/issuer name)
    const { signerCertDer, privateKeyHandle } = findKeypair(session, certSelector);

    const certHash = sha256(signerCertDer);

    // Build SignedAttributes:
    // contentType=DigestData OID, messageDigest, signingTime (UTC), signingCertificateV2(certHash)
    const signedAttrsDer = buildItidaSignedAttrs({
      messageDigest,
      certHash,
      signingTimeUtc: new Date()
    });

    // CMS signature is computed over DER-encoded SignedAttributes as per CMS rules
    // Choose mechanism depending on token support:
    // - CKM_SHA256_RSA_PKCS (token does hash internally) OR
    // - CKM_RSA_PKCS over DigestInfo(SHA-256(signedAttrsDer))
    const signatureValue = pkcs11.C_SignInit(session, { mechanism: pkcs11js.CKM_SHA256_RSA_PKCS }, privateKeyHandle)
      && pkcs11.C_Sign(session, signedAttrsDer, Buffer.alloc(4096));

    const cmsDer = assembleSignedData({
      eContentTypeOid: "1.2.840.113549.1.7.5",   // DigestData
      signerCertDer,
      signedAttrsDer,
      signatureAlgorithmOid: "1.2.840.113549.1.1.11", // sha256WithRSAEncryption
      signatureValue,
      encapsulateContent: false,  // MUST be detached per ITIDA
      includeUnsignedAttrs: false  // MUST be absent per ITIDA
    });

    return Buffer.from(cmsDer).toString("base64");
  } finally {
    try { pkcs11.C_Finalize(); } catch (e) { /* ignore */ }
  }
}
```

This pseudocode is aligned with the PKCS#11 API model and pkcs11js’s purpose (“direct interaction with the PKCS#11 API … tested with a variety of devices”) and with ITIDA’s fixed CAdES‑BES requirements for content type, attributes, and algorithms. citeturn7view0turn0search0turn0search1

## Security considerations and hardening

**Key protection and throughput expectations.** ITIDA/ETA device guidance stresses that, for hardware tokens, “key is generated inside the token” and remains secured as part of the hardware device; it also provides performance expectations (~1.5 signatures/sec for smart token) and contrasts with HSM categories (up to ~10,000 tx/sec). citeturn3search2  
This implies (a) your design must never attempt to export private keys, and (b) if a customer’s transaction volumes exceed token throughput, you should offer an HSM-based alternative deployment. citeturn3search2

**User consent and human-verifiable signing.** ITIDA’s Web‑Sign Client manual requires “Review Data,” certificate selection, and PIN entry for signing. This is a strong UX precedent: do not sign in the background; show the user what they are signing (or a trustworthy summary plus hash) and require an explicit “Sign” action and PIN entry. citeturn3search4

**Mitigating localhost abuse (if you use a localhost agent).** Egypt-specific reference implementations use WebSocket loopback services; this pattern is functional but increases exposure to cross-site localhost hijacking unless defended. At minimum, enforce: strict Origin allowlist, per-session challenge nonce issued by your backend, short-lived request IDs, and user-visible consent per request. The existence of a WebSocket signer example for ETA integration demonstrates feasibility but not secure-by-default deployment. citeturn7view1turn3search4

**Why extension + native messaging is usually safer.** Native messaging ties a local host to a specific extension and uses manifest allowlisting; Chrome’s documentation describes the model (host registered, started as a separate process, communicating through stdin/stdout), and MDN documents the analogous capability for Mozilla WebExtensions. citeturn5search3turn5search23  
This substantially reduces the “any website can call localhost and request a signature” attack class, provided you also implement request-level authorization/nonce checks in the host. citeturn5search3turn5search11

**TLS, CORS, and origin checks.** ETA APIs are server-to-server from your cloud backend; your browser should not hold ETA client secrets. ETA standard headers and governance documents emphasize correlation IDs and robust handling of rate limits (429/503). Implement secure logging with correlation IDs and do not log secrets or PINs. citeturn1search1turn1search2turn1search5turn24search0

**OCSP/CRL validation and trust anchoring.** ETA validation errors show that chain building and revocation checks are enforced and that missing issuer certificates can cause failures requiring installing issuer certs on the machine. Treat this as an operational requirement: bundle or guide installation of necessary intermediate certificates for your users’ eSeal chains where appropriate, and implement preflight certificate chain and revocation checks in your backend (and optionally in the local signer) to catch failures early. citeturn0search1turn0search2turn4search6

**Timestamping and forensic posture.** Egypt Root CA provides an RFC 3161 timestamp service, and the CPS describes timestamping as evidence that data existed at a specified time. citeturn0search2turn25search6  
However, ETA validation disallows CAdES‑T, so your forensic strategy should rely on: strict audit logs (canonical string hash, signature Base64, signer cert fingerprint), ETA submission IDs, and correlationId traces, rather than embedding timestamp tokens in the CAdES container unless ETA changes acceptance rules. citeturn0search1turn1search1turn2search2

**Legal ecosystem alignment and accredited providers.** ITIDA’s e-signature page states oversight and regulation are under ITIDA per Law No. 15 of 2004 and that services (digital signature and electronic seal) must be obtained from licensed service providers. Operationally, your onboarding and compliance documentation should assume ITIDA-licensed certificate issuance and token activation processes. citeturn4search2turn0search2

## Implementation checklist and recommended stacks

**Implementation checklist (high priority).**  
Build your MVP around testable conformance gates:

- Implement ETA JSON/XML canonical serialization exactly once (prefer backend) and create golden tests from ETA SDK examples; treat serialization drift as a critical defect category. citeturn2search0turn1search0  
- Produce ITIDA-conformant CAdES‑BES: DigestData content type, no eContent, exactly four signed attributes, SHA‑256 and sha256WithRSAEncryption, no unsigned attrs, only signer certificate included. citeturn0search0turn0search1  
- Validate signatures pre-submission by parsing CMS and confirming attribute presence/absence and detached requirements; map errors to the ITIDA validation library categories to accelerate debugging. citeturn0search1turn0search0  
- Implement OAuth2 client credentials login, cache tokens for ~60 minutes, and follow ETA integration practices (callback preferred; polling second) and API governance/backoff behavior. citeturn24search0turn2search2turn1search2  
- Implement rate-limit-aware retriable submission pipelines (503/429) and capture correlationId; avoid anti-patterns (reauth each call, repeated resubmissions). citeturn1search2turn1search5turn2search2  
- Add token/hardware test mode using SoftHSM2 to enable CI regression tests for PKCS#11 flows without physical devices. citeturn13view0turn5search0  

**Recommended primary stack (security-first web deployment).**  
- Browser: extension + native messaging. citeturn5search3turn5search23  
- Local signer: .NET (self-contained) using Pkcs11Interop for token access + a CMS builder you control (Bouncy Castle .NET or explicit ASN.1 assembly) to guarantee ITIDA structure invariants. citeturn14view0turn20search2turn0search0  
- Backend: canonicalization + submission service, using ETA’s OAuth2 login and integration practices (token cache, callback endpoints). citeturn24search0turn2search2turn2search0

**Alternative stack A (fast PoC, then harden).**  
- Local WebSocket signer on localhost (as in Egypt-specific open-source precedent), with immediate implementation of Origin allowlists + server-issued one-time nonces + user consent UI. citeturn7view1turn3search4turn2search2

**Alternative stack B (enterprise volume mode).**  
- Add HSM signing (PKCS#11) deployment option for high-volume issuers; the official hardware device guidance includes throughput comparisons and HSM categories. citeturn3search2turn5search0

**Effort and risks (engineering estimate, not a guarantee).**  
A Windows-first PoC that signs and submits test invoices typically falls in the 2–4 week range for an experienced team; productionizing cross-platform token support, installer/signing, extension deployment, and conformance/regression harnesses often pushes into 8–14+ weeks. Key risks are (a) token driver availability across Linux/macOS, (b) subtle CAdES profile mismatches causing ETA rejection, and (c) localhost security hardening complexity if you avoid an extension. These risks are rooted in documented ETA/ITIDA strictness and the Windows-only assumptions visible in official Web‑Sign Client/self-registration materials. citeturn0search1turn3search4turn3search3turn0search0

## References and prioritized sources

Primary/official ETA–ITIDA sources (highest priority):
- ITIDA: Digital Signature Format for E‑Invoice System (strict CAdES‑BES profile, required attrs, algorithms, DigestData, detached). citeturn0search0  
- ITIDA: Digital Signature Validation Library (explicit rejections, trust chain and revocation failures, Egypt Root CA requirement). citeturn0search1  
- ETA SDK: Signature creation steps and embedding Base64 CAdES‑BES into JSON/XML for submission. citeturn1search0turn2search3  
- ETA SDK: Document Serialization Approach (canonicalization algorithm rationale and rules). citeturn2search0  
- ETA SDK: Invoice v1.0 schema and signature validation expectations (issuer signature, RSA, approved certs). citeturn2search1  
- ETA SDK: Login as taxpayer system (OAuth2 client credentials, Basic auth, token lifetime). citeturn24search0  
- ETA SDK: Standard headers, governance/rate limiting, and standard error responses (correlationId, X‑Rate‑Limit, 429/503). citeturn1search1turn1search2turn1search5  
- ITIDA Web‑Sign Client manual and ETA self‑registration steps (official “web triggers desktop signer” model; Windows constraint; certificate selection/PIN). citeturn3search4turn3search3  
- ETA/ITIDA: Cryptographic Hardware Devices guidance (token vs HSM throughput and deployment). citeturn3search2  
- ETA/ITIDA: E‑Seal solution overview (Tax ID field notion and eSeal concept in ETA context). citeturn4search0  

Egypt Root CA and PKI governance:
- Egypt Root CA CPS (OCSP/CRL services and RFC 3161 timestamp service details). citeturn0search2  
- Egypt Root CA CP (policy for certificate services including seals and validation services). citeturn4search6  
- ITIDA e-signature/e-seal overview (licensed service providers, regulatory authority, Law No. 15 of 2004). citeturn4search2  

Core standards (primary specs):
- CMS: IETF RFC 3852 and RFC 5652. citeturn25search0turn25search1  
- CAdES profile: RFC 5126. citeturn5search1  
- ESS SigningCertificateV2 / ESSCertIDv2: RFC 5035. citeturn5search2  
- PKCS#11: OASIS PKCS#11 v2.40 base spec. citeturn5search0  
- RFC 3161 time-stamp protocol and PKCS#12: RFC 7292. citeturn25search6turn25search2  

Open-source repos and platform integration docs:
- OpenSC (LGPL‑2.1). citeturn6view0  
- pcsc-lite (license excerpt + supported OS notes on official site). citeturn18view0  
- p11-kit license text (BSD‑3‑Clause). citeturn12view0turn8view0  
- SoftHSMv2 license text (BSD‑2‑Clause). citeturn13view0  
- pkcs11js (MIT). citeturn7view0  
- node-webcrypto-p11 (MIT). citeturn13view1turn9view2  
- webcrypto-local (MIT). citeturn13view2turn9view3  
- Pkcs11Interop (Apache‑2.0). citeturn14view0  
- DSS (LGPL‑2.1). citeturn7view2  
- Bouncy Castle licensing + CMS generator references. citeturn20search2turn20search7  
- Chrome and Mozilla native messaging docs. citeturn5search3turn5search23  
- WebCrypto, WebAuthn, WebUSB, WebHID specs/docs. citeturn19search0turn19search1turn19search2turn19search3  
- Windows smart card minidrivers and Apple CryptoTokenKit docs. citeturn20search4turn20search1  
- Egypt-specific open-source example (ETAHttpSignature MIT; EgyptianEInvoice MIT) and examples of no-license repos (treat as reference-only). citeturn7view1turn15view2turn23view0turn23view1