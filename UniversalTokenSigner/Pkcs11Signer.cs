using Net.Pkcs11Interop.Common;
using Net.Pkcs11Interop.HighLevelAPI;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using System.IO;
using System.Collections.Generic;
using System.Linq;
using Org.BouncyCastle.Asn1;
using Org.BouncyCastle.Asn1.Cms;
using Org.BouncyCastle.Asn1.Ess;
using Org.BouncyCastle.Asn1.Pkcs;
using Org.BouncyCastle.Asn1.X509;
using Org.BouncyCastle.Cms;
using Org.BouncyCastle.Crypto;
using Org.BouncyCastle.Security;
using Org.BouncyCastle.Utilities.Collections;

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

            // 2. Load private key handle
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

            // 3. Setup BouncyCastle CAdES-BES signature structure
            var parser = new Org.BouncyCastle.X509.X509CertificateParser();
            var bcCert = parser.ReadCertificate(certDer);

            var dataBytes = Encoding.UTF8.GetBytes(req.SerializedData);
            var content = new CmsProcessableByteArray(dataBytes);

            var gen = new CmsSignedDataGenerator();

            // Build attributes table (Mandatory for ETA)
            var signedAttributes = new Org.BouncyCastle.Asn1.Cms.AttributeTable(new Dictionary<DerObjectIdentifier, object>
            {
                { CmsAttributes.SigningTime, new Org.BouncyCastle.Asn1.Cms.Attribute(CmsAttributes.SigningTime, new DerSet(new Org.BouncyCastle.Asn1.Cms.Time(DateTime.UtcNow))) },
                { CmsAttributes.ContentType, new Org.BouncyCastle.Asn1.Cms.Attribute(CmsAttributes.ContentType, new DerSet(new DerObjectIdentifier("1.2.840.113549.1.7.1"))) }
            });

            // Add ESSCertIDv2 (SigningCertificateV2)
            byte[] certHash = SHA256.HashData(certDer);
            var essCertIdv2 = new EssCertIDv2(certHash);
            var signingCertV2 = new SigningCertificateV2(new[] { essCertIdv2 });
            
            var attrOid = new DerObjectIdentifier("1.2.840.113549.1.9.16.2.47");
            var attrValue = new DerSet(signingCertV2);
            
            var dict = signedAttributes.ToDictionary();
            dict.Add(attrOid, new Org.BouncyCastle.Asn1.Cms.Attribute(attrOid, attrValue));
            signedAttributes = new Org.BouncyCastle.Asn1.Cms.AttributeTable(dict);

            var signedAttrGen = new DefaultSignedAttributeTableGenerator(signedAttributes);

            // Determine Signature Algorithm OID
            string signatureAlgorithmOid = keyType == (ulong)CKK.CKK_RSA
                ? "1.2.840.113549.1.1.11" // sha256WithRSAEncryption
                : "1.2.840.10045.4.3.2"; // ecdsa-with-SHA256

            // Initialize custom signature factory that signs using PKCS#11 in the background
            var signatureFactory = new Pkcs11SignatureFactory(session, privateKey, keyType, signatureAlgorithmOid);

            var signerInfoGenBuilder = new SignerInfoGeneratorBuilder()
                .WithSignedAttributeGenerator(signedAttrGen);

            var signerInfoGenerator = signerInfoGenBuilder.Build(signatureFactory, bcCert);
            gen.AddSignerInfoGenerator(signerInfoGenerator);

            // Add certificate chain (includes end cert + intermediates/root if available)
            var certList = new List<Org.BouncyCastle.X509.X509Certificate> { bcCert };
            try
            {
                using var chain = new X509Chain();
                chain.ChainPolicy.RevocationMode = X509RevocationMode.NoCheck;
                chain.ChainPolicy.UrlRetrievalTimeout = TimeSpan.FromSeconds(3);
                
                // Call Build but ignore the return value (which is false if Root CA is not locally trusted/installed).
                // We still want to extract whatever intermediate CA certificates were found in the chain!
                chain.Build(x509);
                
                foreach (var element in chain.ChainElements)
                {
                    if (element.Certificate.Thumbprint != x509.Thumbprint)
                    {
                        var parserChain = new Org.BouncyCastle.X509.X509CertificateParser();
                        var bcChainCert = parserChain.ReadCertificate(element.Certificate.RawData);
                        if (!certList.Contains(bcChainCert))
                        {
                            certList.Add(bcChainCert);
                        }
                    }
                }
            }
            catch { }

            // Hardcoded fallback for intermediate CAs (e.g. MCDR) if chain building completely fails
            // and only the leaf certificate is present in the list.
            if (certList.Count == 1)
            {
                string issuerDN = x509.Issuer;
                if (issuerDN.Contains("MCDR CA 2022"))
                {
                    try
                    {
                        string mcdrCertBase64 = "MIIHITCCBQmgAwIBAgIIK7BWlZZ5WhIwDQYJKoZIhvcNAQELBQAwSDELMAkGA1UEBhMCRUcx" +
                            "DjAMBgNVBAoMBUlUSURBMQ8wDQYDVQQLDAZSb290Q0ExGDAWBgNVBAMMD0VneXB0X1Jvb3RD" +
                            "QV9HMTAeFw0yMiA5MDcxMDQyMTFaFw0yODA5MDUxMDQyMTFaMIGAMQswCQYDVQQGEwJFRzE7" +
                            "MDkGA1UEChMyTWlzciBmb3IgQ2VudHJhbCBDbGVhcmluZywgRGVwb3NpdG9yeSBhbmQgUmVn" +
                            "aXN0cnkxHTAbBgNVBAsTFENlcnRpZnlpbmcgQXV0aG9yaXR5MRUwEwYDVQQDEwxNQ0RSIENB" +
                            "IDIwMjIwggIiMA0GCSqGSIb3DQEBAQUAA4ICDwAwggIKAoICAQDBhCrA/UTuQCwIhDMz/ZAX" +
                            "37RD+UBClRrRGrhuRNMiUjlHo4nC8oUscxd5c/O7lbqDvIPOyy/i8uMGsZMLx1I1mSFSn4ts" +
                            "cY8bZMMajrJzELWgChiI1/qZL89mBEyh1MOZ3Ns7djU/fBvLFq0e82KRqyqP78kAe4DB2Mzf" +
                            "tNdNaStVOLT0ztqnLGAcwEw++SjeQre5DNpkYUS+bIpaFXPY2iDyL69ULQepYCnoEPUA86UT" +
                            "WT8gXF04QgNrc5iJXBDJQOtIguFR8wopjlAvNhVD5CaV6Tihmi/8dUpdtM4Yqy2bnJNCAZ6n" +
                            "XT04xq5bvBr9yMvpd3phcstk3boo0QbgaAmXS1d2odhrexbjkyfR9oQODwX6dh6qvKho/R8d" +
                            "6D2J+WU5H0LoBbW1OjuZWHsDGKtORazwB35SgS1zrTMGbx7D5eEuktT1i7Q5I4Watnn4tVFw" +
                            "c8lFGZEie4LJBbX+Zwx0fwutyVUrr16FlbFWH/T1RvyxFIdV9leY1TZov+TDRJ4niJO/UEys" +
                            "wUFoWG7rJMGqxusvoNPhefsUlJ8+gBTtwc2LINXPL8Vy37r+OAGmJ22dADSzSDDEEOXEFvpQ" +
                            "LDEfXATrtxGMUiw8hQSh9UhmqwRTLjs+LNJbeQGImU6eeXd1LRx+OW+UKrNaKnfziGEb8lEu" +
                            "rnfbgFn96/7a5kQIDAQABo4IB1DCCAdAwDwYDVR0TAQH/BAUwAwEB/zAfBgNVHSMEGDAWgBRs" +
                            "DB6ujozsrNqT09gxXK3zEETTMzA8BggrBgEFBQcBAQQwMC4wLAYIKwYBBQUHMAGGIGh0dHA6" +
                            "Ly93d3cucm9vdGNhLmdvdi5lZy9vY3NwLUcxMFQGA1UdIARNMEswSQYKKwYBBAGChHcBAjA7" +
                            "MDkGCCsGAQUFBwIBFi1odHRwOi8vcm9vdGNhLml0aWRhLmdvdi5lZy9ob21lX2ZpbGVzL0NQ" +
                            "Uy5wZGYwgdgGA1UdHwSB0DCBzTApoCegJYYjaHR0cDovL3d3dy5yb290Y2EuZ292LmVnL0NS" +
                            "TC1HMS5jcmwwL6AtoCuGKWh0dHA6Ly93d3cucm9vdGNhLml0aWRhLmdvdi5lZy9DUkwtRzEu" +
                            "Y3JsMG+gbaBrhmlsZGFwOi8vbGRhcC5yb290Y2EuZ292LmVnL2NuPUVneXB0X1Jvb3RDQV9H" +
                            "MTAsb3U9Um9vdENBLG89SVRJREEsYz1FRz9DZXJ0aWZpY2F0ZVJldm9jYXRpb25MaXN0O2Jp" +
                            "bmFyeT9iYXNlMB0GA1UdDgQWBBSRgjJZjYA8+vBVaz00CNvjFTuIZzAOBgNVHQ8BAf8EBAMC" +
                            "AYYwDQYJKoZIhvcNAQELBQADggIBALuA0ucmJ5xVfR5QsoY0ScrJWPWJvkD8zDAV9PmY9mhN" +
                            "9mWSFGE03FTBDnWFVc111+h+w4RcJkdDw/QAwSEMpDTFOevuWDA4fNEhr79dD5HESlAIhJXx" +
                            "0dMr6ymyCAS8QG0H3Tb7XodPYdPDjAFjHDyTONzj8NU1qn2dfYgSaFObFW7npQQoULjErz9t" +
                            "17feBIxKX5AolO4S3REPOg+UlClC+6VEIcBkMhntkye8UFNFpUL9aB965nbsmkA3NBqHR015" +
                            "qCMISKqdCb1NrjV3HCUA3ytoOki1AT+GmaNbaXZG50S4KqZlw4Ftu4n2r70zyiD7RraP5mqu" +
                            "atwG2WXrUXHz2uzNV/MP39Tf1h4LuGjYjM0QOVlzwkcei3Je0OcQbzrSRAoOEYjq4zQDln5V" +
                            "VfT0XQKO8GNCfeB+epnAuKsYfQ3kHSf3KUj3X2e1HgmiAMIuch+dtqswvb39qSN+sds2Knvl" +
                            "Lv0+5USyXUFkJstAGOkQe5nrZ1NAidVO+xpNJ7TVfVBiT0kTG92WPTOXLTDdNG+HpQruvVnH" +
                            "Gr97qQXVWuTjqw+AhrzxykjllFbeIq3qViUXYOORihnimgzbG99x/zw9UdZsg5SsdbnWrVtC" +
                            "GovOejE8H92ZbP6h6RIzmrb4GYEUWL0B1LiN9uDAuIsHjfwHI7OEKX4Qj57WxNTUMYIBwTCC";
                        var parserChain = new Org.BouncyCastle.X509.X509CertificateParser();
                        byte[] mcdrDer = Convert.FromBase64String(mcdrCertBase64);
                        certList.Add(parserChain.ReadCertificate(mcdrDer));
                        Console.WriteLine("[UTS] Incomplete chain detected. Manually appended MCDR CA 2022 intermediate certificate.");
                    }
                    catch (Exception ex)
                    {
                        Console.WriteLine("[UTS] Failed to append manual MCDR CA certificate: " + ex.Message);
                    }
                }
            }

            var store = CollectionUtilities.CreateStore(certList);
            gen.AddCertificates(store);

            // Generate Detached CMS SignedData
            CmsSignedData signedData = gen.Generate(content, false);
            byte[] finalCms = signedData.GetEncoded();

            // CRITICAL: Ensure the CMS is truly detached by stripping any encapsulated content.
            // Some implementations may still embed the content even with encapsulate=false.
            // ETA error 4062 ("Attached digital signature is not supported") occurs when content is present.
            finalCms = StripEncapsulatedContent(finalCms);

            return new SignDocumentCadesResponse(
                SignatureBase64: Convert.ToBase64String(finalCms),
                KeyType: keyType == (ulong)CKK.CKK_RSA ? "RSA" : "EC",
                HashBase64: Convert.ToBase64String(SHA256.HashData(dataBytes)),
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
    /// Ensures the CMS SignedData is truly detached by removing any encapsulated content
    /// from the EncapsulatedContentInfo structure. ETA requires a detached signature where
    /// eContent is ABSENT. This method parses the DER-encoded CMS and removes the [0] EXPLICIT
    /// tagged content after the data OID (1.2.840.113549.1.7.1) if present.
    /// </summary>
    private static byte[] StripEncapsulatedContent(byte[] cmsBytes)
    {
        try
        {
            // Parse the CMS structure using BouncyCastle ASN.1
            var asn1 = Asn1Object.FromByteArray(cmsBytes);
            var contentInfo = Org.BouncyCastle.Asn1.Cms.ContentInfo.GetInstance(asn1);
            var signedData = Org.BouncyCastle.Asn1.Cms.SignedData.GetInstance(contentInfo.Content);

            // Check if encapContentInfo has content (eContent present)
            var encapContent = signedData.EncapContentInfo;
            if (encapContent.Content != null)
            {
                // Rebuild with empty encapContentInfo (detached)
                var detachedEncapContent = new Org.BouncyCastle.Asn1.Cms.ContentInfo(
                    encapContent.ContentType, null);

                var detachedSignedData = new Org.BouncyCastle.Asn1.Cms.SignedData(
                    signedData.DigestAlgorithms,
                    detachedEncapContent,
                    signedData.Certificates,
                    signedData.CRLs,
                    signedData.SignerInfos);

                var detachedContentInfo = new Org.BouncyCastle.Asn1.Cms.ContentInfo(
                    contentInfo.ContentType, detachedSignedData);

                byte[] result = detachedContentInfo.GetEncoded();
                Console.WriteLine($"[UTS] Stripped {cmsBytes.Length - result.Length} bytes of encapsulated content. New size: {result.Length}");
                return result;
            }

            // Already detached
            return cmsBytes;
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[UTS] Warning: Could not verify detached state: {ex.Message}. Using original.");
            return cmsBytes;
        }
    }
}

// ── Custom BouncyCastle Signature Factory using PKCS11 ───────────────────────

public class Pkcs11SignatureFactory : ISignatureFactory
{
    private readonly Net.Pkcs11Interop.HighLevelAPI.ISession _session;
    private readonly IObjectHandle _privateKey;
    private readonly ulong _keyType;
    private readonly string _algorithm;

    public Pkcs11SignatureFactory(Net.Pkcs11Interop.HighLevelAPI.ISession session, IObjectHandle privateKey, ulong keyType, string algorithm)
    {
        _session = session;
        _privateKey = privateKey;
        _keyType = keyType;
        _algorithm = algorithm;
    }

    public object AlgorithmDetails => new AlgorithmIdentifier(new DerObjectIdentifier(_algorithm));

    public IStreamCalculator<IBlockResult> CreateCalculator()
    {
        return new Pkcs11StreamCalculator(_session, _privateKey, _keyType);
    }
}

public class Pkcs11StreamCalculator : IStreamCalculator<IBlockResult>
{
    private readonly MemoryStream _ms = new MemoryStream();
    private readonly Net.Pkcs11Interop.HighLevelAPI.ISession _session;
    private readonly IObjectHandle _privateKey;
    private readonly ulong _keyType;

    public Pkcs11StreamCalculator(Net.Pkcs11Interop.HighLevelAPI.ISession session, IObjectHandle privateKey, ulong keyType)
    {
        _session = session;
        _privateKey = privateKey;
        _keyType = keyType;
    }

    public Stream Stream => _ms;

    public IBlockResult GetResult()
    {
        byte[] attrBytes = _ms.ToArray();
        byte[] hash = SHA256.HashData(attrBytes);

        byte[] signature;
        if (_keyType == (ulong)CKK.CKK_RSA)
        {
            byte[] digestInfo = BuildDigestInfoSha256(hash);
            var mech = _session.Factories.MechanismFactory.Create(CKM.CKM_RSA_PKCS);
            signature = _session.Sign(mech, _privateKey, digestInfo);
        }
        else if (_keyType == (ulong)CKK.CKK_EC)
        {
            var mech = _session.Factories.MechanismFactory.Create(CKM.CKM_ECDSA);
            signature = _session.Sign(mech, _privateKey, hash);
        }
        else
        {
            throw new NotSupportedException("Unsupported key type for PKCS11 signing: " + _keyType);
        }

        return new SimpleBlockResult(signature);
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
}

public class SimpleBlockResult : IBlockResult
{
    private readonly byte[] _result;

    public SimpleBlockResult(byte[] result)
    {
        _result = result;
    }

    public byte[] Collect() => _result;

    public int Collect(byte[] destination, int offset)
    {
        Buffer.BlockCopy(_result, 0, destination, offset, _result.Length);
        return _result.Length;
    }

    public int Collect(Span<byte> destination)
    {
        _result.CopyTo(destination);
        return _result.Length;
    }

    public int GetMaxResultLength() => _result.Length;
}