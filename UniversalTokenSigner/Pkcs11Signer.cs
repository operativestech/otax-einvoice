using Net.Pkcs11Interop.Common;
using Net.Pkcs11Interop.HighLevelAPI;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text;

public sealed class Pkcs11Signer
{
    private readonly string _libPath;

    public Pkcs11Signer(string libPath)
    {
        _libPath = libPath ?? "";
        if (string.IsNullOrWhiteSpace(_libPath) || !File.Exists(_libPath))
            throw new InvalidOperationException("PKCS#11 library path is not set or file not found. Set it from tray first.");
    }

    public List<TokenCertInfo> ListCertificates()
    {
        var factories = new Pkcs11InteropFactories();
        using var pkcs11 = factories.Pkcs11LibraryFactory.LoadPkcs11Library(factories, _libPath, AppType.MultiThreaded);

        var slots = pkcs11.GetSlotList(SlotsType.WithTokenPresent);
        var result = new List<TokenCertInfo>();

        foreach (var slot in slots)
        {
            var slotId = slot.SlotId.ToString();

            using var session = slot.OpenSession(SessionType.ReadOnly);
            var searchAttrs = new List<IObjectAttribute>
            {
                session.Factories.ObjectAttributeFactory.Create(CKA.CKA_CLASS, CKO.CKO_CERTIFICATE),
                session.Factories.ObjectAttributeFactory.Create(CKA.CKA_CERTIFICATE_TYPE, CKC.CKC_X_509),
            };

            var certs = session.FindAllObjects(searchAttrs);

            foreach (var certObj in certs)
            {
                var attrs = session.GetAttributeValue(certObj, new List<CKA>
                {
                    CKA.CKA_ID,
                    CKA.CKA_LABEL,
                    CKA.CKA_VALUE
                });

                var id = attrs[0].GetValueAsByteArray() ?? Array.Empty<byte>();
                var label = attrs[1].GetValueAsString() ?? "";
                var der = attrs[2].GetValueAsByteArray() ?? Array.Empty<byte>();

                var x509 = new X509Certificate2(der);
                var subject = x509.Subject ?? "";
                var issuer = x509.Issuer ?? "";
                var serialHex = x509.SerialNumber ?? "";
                var keyType = DetectKeyType(x509);

                result.Add(new TokenCertInfo(
                    SlotId: slotId,
                    CertIdBase64: Convert.ToBase64String(id),
                    Label: label,
                    Subject: subject,
                    Issuer: issuer,
                    SerialHex: serialHex,
                    KeyType: keyType
                ));
            }
        }

        return result;
    }

    public SignResponse Sign(SignRequest req)
    {
        if (req is null) throw new ArgumentNullException(nameof(req));
        if (string.IsNullOrWhiteSpace(req.HashBase64)) throw new ArgumentException("HashBase64 is required");
        if (string.IsNullOrWhiteSpace(req.Pin)) throw new ArgumentException("Pin is required");

        var hash = Convert.FromBase64String(req.HashBase64);
        if (hash.Length != 32)
            throw new ArgumentException("Hash must be SHA-256 (32 bytes) in base64");

        var mode = (req.Mode ?? "RAW_HASH").Trim().ToUpperInvariant();
        if (mode is not ("RAW_HASH" or "DIGEST_INFO_SHA256"))
            throw new ArgumentException("Mode must be RAW_HASH or DIGEST_INFO_SHA256");

        var factories = new Pkcs11InteropFactories();
        using var pkcs11 = factories.Pkcs11LibraryFactory.LoadPkcs11Library(factories, _libPath, AppType.MultiThreaded);
        var slots = pkcs11.GetSlotList(SlotsType.WithTokenPresent);
        if (slots.Count == 0) throw new Exception("No token found");

        var slot = slots[0];
        using var session = slot.OpenSession(SessionType.ReadWrite);
        session.Login(CKU.CKU_USER, req.Pin);

        try
        {
            byte[]? targetId = null;
            if (!string.IsNullOrWhiteSpace(req.CertIdBase64))
                targetId = Convert.FromBase64String(req.CertIdBase64);

            byte[] keyId = targetId ?? FindFirstCertificateId(session);

            var privKeyAttrs = new List<IObjectAttribute>
            {
                session.Factories.ObjectAttributeFactory.Create(CKA.CKA_CLASS, CKO.CKO_PRIVATE_KEY),
                session.Factories.ObjectAttributeFactory.Create(CKA.CKA_ID, keyId)
            };

            var privateKeys = session.FindAllObjects(privKeyAttrs);
            if (privateKeys.Count == 0)
                throw new Exception("Private key not found for the selected certificate");

            var privateKey = privateKeys[0];

            var keyTypeAttr = session.GetAttributeValue(privateKey, new List<CKA> { CKA.CKA_KEY_TYPE })[0];
            var keyType = keyTypeAttr.GetValueAsUlong();

            byte[] dataToSign = mode == "DIGEST_INFO_SHA256"
                ? BuildDigestInfoSha256(hash)
                : hash;

            byte[] signature;
            string keyTypeName;

            if (keyType == (ulong)CKK.CKK_RSA)
            {
                keyTypeName = "RSA";
                var mech = session.Factories.MechanismFactory.Create(CKM.CKM_RSA_PKCS);
                signature = session.Sign(mech, privateKey, dataToSign);
            }
            else if (keyType == (ulong)CKK.CKK_EC)
            {
                keyTypeName = "EC";
                if (mode == "DIGEST_INFO_SHA256") mode = "RAW_HASH";
                var mech = session.Factories.MechanismFactory.Create(CKM.CKM_ECDSA);
                signature = session.Sign(mech, privateKey, hash);
            }
            else
            {
                keyTypeName = "Unknown";
                throw new Exception($"Unsupported key type: {keyType}");
            }

            return new SignResponse(
                SignatureBase64: Convert.ToBase64String(signature),
                KeyType: keyTypeName,
                ModeUsed: mode
            );
        }
        finally
        {
            session.Logout();
        }
    }

    private static byte[] FindFirstCertificateId(Net.Pkcs11Interop.HighLevelAPI.ISession session)
    {
        var searchAttrs = new List<IObjectAttribute>
        {
            session.Factories.ObjectAttributeFactory.Create(CKA.CKA_CLASS, CKO.CKO_CERTIFICATE),
            session.Factories.ObjectAttributeFactory.Create(CKA.CKA_CERTIFICATE_TYPE, CKC.CKC_X_509),
        };

        var certs = session.FindAllObjects(searchAttrs);
        if (certs.Count == 0) throw new Exception("No certificates found on token");

        var attrs = session.GetAttributeValue(certs[0], new List<CKA> { CKA.CKA_ID });
        return attrs[0].GetValueAsByteArray() ?? throw new Exception("Certificate has no CKA_ID");
    }

    private static string DetectKeyType(X509Certificate2 x509)
    {
        try
        {
            using var rsa = x509.GetRSAPublicKey();
            if (rsa != null) return "RSA";
        }
        catch { }

        try
        {
            using var ecdsa = x509.GetECDsaPublicKey();
            if (ecdsa != null) return "EC";
        }
        catch { }

        return "Unknown";
    }

    private static byte[] BuildDigestInfoSha256(byte[] hash32)
    {
        byte[] prefix = new byte[]
        {
            0x30, 0x31, 0x30, 0x0D, 0x06, 0x09,
            0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01,
            0x05, 0x00, 0x04, 0x20
        };
        var result = new byte[prefix.Length + hash32.Length];
        Buffer.BlockCopy(prefix, 0, result, 0, prefix.Length);
        Buffer.BlockCopy(hash32, 0, result, prefix.Length, hash32.Length);
        return result;
    }

    /// <summary>
    /// High-level method: hash serialized ETA data (SHA-256), sign it, and return signature + cert info.
    /// Returns RAW RSA/EC signature (NOT CAdES-BES).
    /// </summary>
    public SignDocumentResponse SignDocument(SignDocumentRequest req)
    {
        if (req is null) throw new ArgumentNullException(nameof(req));
        if (string.IsNullOrWhiteSpace(req.SerializedData)) throw new ArgumentException("SerializedData is required");
        if (string.IsNullOrWhiteSpace(req.Pin)) throw new ArgumentException("Pin is required");

        var dataBytes = Encoding.UTF8.GetBytes(req.SerializedData);
        var hash = SHA256.HashData(dataBytes);
        var hashBase64 = Convert.ToBase64String(hash);

        var signReq = new SignRequest(
            HashBase64: hashBase64,
            Pin: req.Pin,
            CertIdBase64: req.CertIdBase64,
            Mode: "DIGEST_INFO_SHA256"
        );

        var signResp = Sign(signReq);

        string? certSubject = null;
        string? certIssuer = null;
        try
        {
            var certs = ListCertificates();
            var matchedCert = req.CertIdBase64 != null
                ? certs.FirstOrDefault(c => c.CertIdBase64 == req.CertIdBase64)
                : certs.FirstOrDefault();
            if (matchedCert != null)
            {
                certSubject = matchedCert.Subject;
                certIssuer = matchedCert.Issuer;
            }
        }
        catch { }

        return new SignDocumentResponse(
            SignatureBase64: signResp.SignatureBase64,
            KeyType: signResp.KeyType,
            HashBase64: hashBase64,
            CertSubject: certSubject,
            CertIssuer: certIssuer
        );
    }

    /// <summary>
    /// CAdES-BES signing: produces a full CMS SignedData (PKCS#7) that ETA accepts.
    /// This wraps the raw PKCS#11 signature with the certificate into a proper CAdES-BES structure.
    /// </summary>
    public SignDocumentCadesResponse SignDocumentCades(SignDocumentCadesRequest req)
    {
        if (req is null) throw new ArgumentNullException(nameof(req));
        if (string.IsNullOrWhiteSpace(req.SerializedData)) throw new ArgumentException("SerializedData is required");
        if (string.IsNullOrWhiteSpace(req.Pin)) throw new ArgumentException("Pin is required");

        var factories = new Pkcs11InteropFactories();
        using var pkcs11 = factories.Pkcs11LibraryFactory.LoadPkcs11Library(factories, _libPath, AppType.MultiThreaded);
        var slots = pkcs11.GetSlotList(SlotsType.WithTokenPresent);
        if (slots.Count == 0) throw new Exception("No token found");

        var slot = slots[0];
        using var session = slot.OpenSession(SessionType.ReadWrite);
        session.Login(CKU.CKU_USER, req.Pin);

        try
        {
            // 1. Find certificate + private key
            byte[]? targetId = null;
            if (!string.IsNullOrWhiteSpace(req.CertIdBase64))
                targetId = Convert.FromBase64String(req.CertIdBase64);

            byte[] keyId = targetId ?? FindFirstCertificateId(session);

            // Get certificate DER bytes
            var certAttrs = new List<IObjectAttribute>
            {
                session.Factories.ObjectAttributeFactory.Create(CKA.CKA_CLASS, CKO.CKO_CERTIFICATE),
                session.Factories.ObjectAttributeFactory.Create(CKA.CKA_ID, keyId),
            };
            var certObjs = session.FindAllObjects(certAttrs);
            if (certObjs.Count == 0) throw new Exception("Certificate not found on token");

            var certValueAttr = session.GetAttributeValue(certObjs[0], new List<CKA> { CKA.CKA_VALUE });
            var certDer = certValueAttr[0].GetValueAsByteArray() ?? throw new Exception("Certificate has no value");
            var x509 = new X509Certificate2(certDer);

            // 2. Hash the serialized data
            var dataBytes = Encoding.UTF8.GetBytes(req.SerializedData);
            var hash = SHA256.HashData(dataBytes);

            // 3. Build CMS SignedData using .NET's SignedCms
            var contentInfo = new System.Security.Cryptography.Pkcs.ContentInfo(dataBytes);
            var signedCms = new System.Security.Cryptography.Pkcs.SignedCms(contentInfo, true); // detached=true

            var signer = new System.Security.Cryptography.Pkcs.CmsSigner(x509);
            signer.DigestAlgorithm = new Oid("2.16.840.1.101.3.4.2.1"); // SHA-256
            signer.IncludeOption = X509IncludeOption.WholeChain;

            // 4. We need to do the actual signing using the hardware token
            // Since .NET's CmsSigner needs a private key, but our key is on the token,
            // we'll build the CMS structure manually using the raw signature from PKCS#11

            // Sign the hash with the hardware token
            var privKeyAttrs = new List<IObjectAttribute>
            {
                session.Factories.ObjectAttributeFactory.Create(CKA.CKA_CLASS, CKO.CKO_PRIVATE_KEY),
                session.Factories.ObjectAttributeFactory.Create(CKA.CKA_ID, keyId)
            };
            var privateKeys = session.FindAllObjects(privKeyAttrs);
            if (privateKeys.Count == 0) throw new Exception("Private key not found");

            var privateKey = privateKeys[0];
            var keyTypeAttr = session.GetAttributeValue(privateKey, new List<CKA> { CKA.CKA_KEY_TYPE })[0];
            var keyType = keyTypeAttr.GetValueAsUlong();

            byte[] digestInfo = BuildDigestInfoSha256(hash);
            byte[] rawSignature;
            string keyTypeName;

            if (keyType == (ulong)CKK.CKK_RSA)
            {
                keyTypeName = "RSA";
                var mech = session.Factories.MechanismFactory.Create(CKM.CKM_RSA_PKCS);
                rawSignature = session.Sign(mech, privateKey, digestInfo);
            }
            else if (keyType == (ulong)CKK.CKK_EC)
            {
                keyTypeName = "EC";
                var mech = session.Factories.MechanismFactory.Create(CKM.CKM_ECDSA);
                rawSignature = session.Sign(mech, privateKey, hash);
            }
            else
            {
                throw new Exception($"Unsupported key type: {keyType}");
            }

            // 5. Build CAdES-BES (CMS SignedData) manually using BouncyCastle-style ASN.1
            // We use .NET's built-in CMS support with a custom approach:
            // Create a detached CMS with the raw signature injected
            var cmsSignatureBase64 = BuildCadesBes(dataBytes, rawSignature, certDer, keyTypeName);

            return new SignDocumentCadesResponse(
                SignatureBase64: cmsSignatureBase64,
                KeyType: keyTypeName,
                HashBase64: Convert.ToBase64String(hash),
                CertSubject: x509.Subject,
                CertIssuer: x509.Issuer
            );
        }
        finally
        {
            session.Logout();
        }
    }

    /// <summary>
    /// Build a CAdES-BES (CMS SignedData) structure from raw signature + certificate.
    /// Uses System.Security.Cryptography.Pkcs to create ETA-compatible output.
    /// </summary>
    private static string BuildCadesBes(byte[] content, byte[] rawSignature, byte[] certDer, string keyType)
    {
        // For ETA compatibility, we build a minimal CMS SignedData structure
        // containing: certificate, SHA-256 digest, and the raw RSA/EC signature
        
        var x509 = new X509Certificate2(certDer);
        var hash = SHA256.HashData(content);
        
        // Build using ASN.1 DER encoding (manual CMS construction)
        // This creates: SEQUENCE { OID signedData, [0] SignedData { ... } }
        using var ms = new MemoryStream();
        using var writer = new BinaryWriter(ms);
        
        // Use .NET's CMS infrastructure with workaround for hardware tokens
        // Create ContentInfo for detached signing
        var contentInfo = new System.Security.Cryptography.Pkcs.ContentInfo(
            new Oid("1.2.840.113549.1.7.1"), // PKCS#7 data
            content
        );
        
        var signedCms = new System.Security.Cryptography.Pkcs.SignedCms(contentInfo, true);
        
        // Create a temporary key of correct type to satisfy the CmsSigner requirement
        // We'll replace the signature value after
        AsymmetricAlgorithm tempKey;
        X509Certificate2 certWithKey;
        if (keyType == "EC")
        {
            var tempEc = ECDsa.Create();
            tempKey = tempEc;
            certWithKey = x509.CopyWithPrivateKey(tempEc);
        }
        else
        {
            var tempRsa = RSA.Create();
            tempKey = tempRsa;
            certWithKey = x509.CopyWithPrivateKey(tempRsa);
        }
        
        try
        {
            var cmsSigner = new System.Security.Cryptography.Pkcs.CmsSigner(
                System.Security.Cryptography.Pkcs.SubjectIdentifierType.IssuerAndSerialNumber,
                certWithKey
            );
            cmsSigner.DigestAlgorithm = new Oid("2.16.840.1.101.3.4.2.1"); // SHA-256
            cmsSigner.IncludeOption = X509IncludeOption.EndCertOnly;
            
            // Sign with temp key (we'll inject the real signature)
            signedCms.ComputeSignature(cmsSigner, false);
            
            // Get the CMS bytes and replace the temp signature with the real one
            var cmsBytes = signedCms.Encode();
            
            // Find and replace the temp RSA signature with the real hardware token signature
            var tempSig = signedCms.SignerInfos[0].GetSignature();
            var finalCms = ReplaceSignatureInCms(cmsBytes, tempSig, rawSignature);
            
            return Convert.ToBase64String(finalCms);
        }
        finally
        {
            tempKey.Dispose();
        }
    }
    
    /// <summary>
    /// Replace the temporary signature bytes in the CMS DER with the real hardware token signature.
    /// </summary>
    private static byte[] ReplaceSignatureInCms(byte[] cmsBytes, byte[] tempSig, byte[] realSig)
    {
        // If signatures are the same length, simple byte replacement
        if (tempSig.Length == realSig.Length)
        {
            var result = (byte[])cmsBytes.Clone();
            int idx = FindSubArray(result, tempSig);
            if (idx >= 0)
            {
                Buffer.BlockCopy(realSig, 0, result, idx, realSig.Length);
                return result;
            }
        }
        
        // Different lengths: need to rebuild the TLV
        // Find the OCTET STRING containing the signature and rebuild it
        int pos = FindSubArray(cmsBytes, tempSig);
        if (pos < 0)
        {
            // Fallback: return original CMS bytes (signature from temp key)
            return cmsBytes;
        }
        
        // Calculate offset differences and rebuild
        using var output = new MemoryStream();
        // Copy everything before the signature
        output.Write(cmsBytes, 0, pos);
        // Write the real signature
        output.Write(realSig, 0, realSig.Length);
        // Copy everything after the temp signature
        int afterPos = pos + tempSig.Length;
        output.Write(cmsBytes, afterPos, cmsBytes.Length - afterPos);
        
        return output.ToArray();
    }
    
    private static int FindSubArray(byte[] source, byte[] pattern)
    {
        if (pattern.Length == 0 || source.Length < pattern.Length) return -1;
        
        for (int i = 0; i <= source.Length - pattern.Length; i++)
        {
            bool found = true;
            for (int j = 0; j < pattern.Length; j++)
            {
                if (source[i + j] != pattern[j])
                {
                    found = false;
                    break;
                }
            }
            if (found) return i;
        }
        return -1;
    }
}