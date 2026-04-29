using System;

public sealed record TokenCertInfo(
    string SlotId,
    string CertIdBase64,
    string Label,
    string Subject,
    string Issuer,
    string SerialHex,
    string KeyType // "RSA" | "EC" | "Unknown"
);

public sealed record SignRequest(
    string HashBase64,        // SHA-256 hash (32 bytes) base64
    string Pin,               // token pin
    string? CertIdBase64,     // optional: choose cert by CKA_ID
    string Mode               // "RAW_HASH" | "DIGEST_INFO_SHA256"
);

public sealed record SignResponse(
    string SignatureBase64,
    string KeyType,
    string ModeUsed
);

// ── ETA Document-Level Signing ──────────────────────

public sealed record SignDocumentRequest(
    string SerializedData,     // canonical/serialized string to sign
    string Pin,                // token PIN
    string? CertIdBase64       // optional: choose cert by CKA_ID
);

public sealed record SignDocumentResponse(
    string SignatureBase64,    // raw signature base64
    string KeyType,            // "RSA" | "EC"
    string HashBase64,         // SHA-256 hash that was signed (for verification)
    string? CertSubject,       // certificate subject (for logging)
    string? CertIssuer         // certificate issuer (for logging)
);

// ── CAdES-BES Document Signing (ETA-compatible CMS PKCS#7) ──

public sealed record SignDocumentCadesRequest(
    string SerializedData,     // canonical/serialized string to sign
    string Pin,                // token PIN
    string? CertIdBase64       // optional: choose cert by CKA_ID
);

public sealed record SignDocumentCadesResponse(
    string SignatureBase64,    // CMS SignedData (CAdES-BES) in base64 — ETA-ready
    string KeyType,            // "RSA" | "EC"
    string HashBase64,         // SHA-256 hash that was signed
    string? CertSubject,       // certificate subject
    string? CertIssuer         // certificate issuer
);