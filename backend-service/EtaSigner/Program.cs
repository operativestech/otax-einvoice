using System;
using System.IO;
using System.Collections.Generic;
using System.Linq;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using Org.BouncyCastle.Asn1;
using Org.BouncyCastle.Asn1.Cms;
using Org.BouncyCastle.Asn1.Ess;
using Org.BouncyCastle.Asn1.Pkcs;
using Org.BouncyCastle.Cms;
using Org.BouncyCastle.Crypto;
using Org.BouncyCastle.Security;
using Org.BouncyCastle.X509;
using Org.BouncyCastle.X509.Store;
using Org.BouncyCastle.Utilities.Collections;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace EtaSignerApp
{
    class Program
    {
        static void Main(string[] args)
        {
            try
            {
                if (args.Length < 3)
                {
                    Console.Error.WriteLine("Usage: EtaSigner.exe <Directory> <PIN> <CertIssuer>");
                    Environment.Exit(1);
                }

                string workingDir = args[0];
                string pin = args[1];
                string issuerName = args[2];

                string inputFile = Path.Combine(workingDir, "SourceDocumentJson.json");
                string outputFile = Path.Combine(workingDir, "FullSignedDocument.json");

                if (!File.Exists(inputFile))
                {
                    Console.Error.WriteLine($"ERROR: Input file not found: {inputFile}");
                    Environment.Exit(1);
                }

                // 1. Read and parse original JSON
                string jsonContent = File.ReadAllText(inputFile, Encoding.UTF8);
                JObject invoice = JObject.Parse(jsonContent);

                // 2. Find Certificate
                X509Certificate2 signerCert = FindCertificate(issuerName);
                if (signerCert == null)
                {
                    Console.Error.WriteLine($"ERROR: Certificate not found for issuer: {issuerName}");
                    Environment.Exit(1);
                }
                Console.WriteLine($"INFO: Using certificate: {signerCert.Subject}");

                // 3. Serialize (Canonicalize) - Matches the Node.js etaSerialization.ts logic
                // NOTE: For robustness, it's safer if the caller sends the canonical string.
                // But we will re-implement the basic DOCUMENT wrapping if needed or assume caller sent it.
                // Actually, let's assume the caller (Agent/Server) provides the serialized string in "CanonicalString.txt"
                // if they want to be 100% sure of the hash.
                
                string canonicalFile = Path.Combine(workingDir, "CanonicalString.txt");
                byte[] dataToSign = null;
                if (File.Exists(canonicalFile))
                {
                    Console.WriteLine("INFO: Using provided canonical string from CanonicalString.txt");
                    dataToSign = File.ReadAllBytes(canonicalFile);
                }
                else
                {
                    Console.Error.WriteLine("ERROR: CanonicalString.txt missing. Agent must provide the serialized string.");
                    Environment.Exit(1);
                }

                // 4. Sign with BouncyCastle (Proper Detached CAdES-BES)
                byte[] signatureBytes = SignWithBouncyCastle(dataToSign, signerCert, pin);
                string signatureBase64 = Convert.ToBase64String(signatureBytes);

                // 5. Build Signed Document
                var signatureObj = new JObject();
                signatureObj["signatureType"] = "I";
                signatureObj["value"] = signatureBase64;

                var signaturesArray = new JArray();
                signaturesArray.Add(signatureObj);
                invoice["signatures"] = signaturesArray;

                // 6. Save Output
                File.WriteAllText(outputFile, invoice.ToString(Formatting.Indented), Encoding.UTF8);

                Console.WriteLine($"SUCCESS: Signature created ({signatureBytes.Length} bytes)");
                Console.WriteLine($"SIGNATURE:{signatureBase64}");
                Environment.Exit(0);
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"ERROR: {ex.Message}");
                Console.Error.WriteLine(ex.StackTrace);
                Environment.Exit(1);
            }
        }

        static X509Certificate2 FindCertificate(string issuerName)
        {
            using (X509Store store = new X509Store(StoreName.My, StoreLocation.CurrentUser))
            {
                store.Open(OpenFlags.ReadOnly);
                var certs = store.Certificates.Find(X509FindType.FindByTimeValid, DateTime.Now, true);
                
                foreach (var cert in certs)
                {
                    if (cert.Issuer.Contains(issuerName, StringComparison.OrdinalIgnoreCase) || 
                        cert.Subject.Contains(issuerName, StringComparison.OrdinalIgnoreCase))
                    {
                        if (cert.HasPrivateKey) return cert;
                    }
                }
            }
            return null;
        }

        static byte[] SignWithBouncyCastle(byte[] dataToSign, X509Certificate2 signerCert, string pin)
        {
            // Convert .NET cert to BouncyCastle cert
            var bcCert = DotNetUtilities.FromX509Certificate(signerCert);
            var bcKeys = DotNetUtilities.GetKeyPair(signerCert.GetRSAPrivateKey()).Private;

            // Prepare Content
            var content = new CmsProcessableByteArray(dataToSign);

            // Generator setup
            var gen = new CmsSignedDataGenerator();

            // Build Attribute Table for CAdES-BES
            var signedAttributes = new Org.BouncyCastle.Asn1.Cms.AttributeTable(new Dictionary<DerObjectIdentifier, object>
            {
                { CmsAttributes.SigningTime, new Org.BouncyCastle.Asn1.Cms.Attribute(CmsAttributes.SigningTime, new DerSet(new Org.BouncyCastle.Asn1.Cms.Time(DateTime.UtcNow))) },
                { CmsAttributes.ContentType, new Org.BouncyCastle.Asn1.Cms.Attribute(CmsAttributes.ContentType, new DerSet(PkcsObjectIdentifiers.Data)) }
            });

            // Add ESSCertIDv2 (Mandatory for ITIDA)
            using (var sha256 = System.Security.Cryptography.SHA256.Create())
            {
                byte[] certHash = sha256.ComputeHash(signerCert.RawData);
                var essCertIdv2 = new EssCertIDv2(certHash);
                var signingCertV2 = new SigningCertificateV2(new[] { essCertIdv2 });
                
                var attrOid = new DerObjectIdentifier("1.2.840.113549.1.9.16.2.47");
                var attrValue = new DerSet(signingCertV2);
                
                var dict = signedAttributes.ToDictionary();
                dict.Add(attrOid, new Org.BouncyCastle.Asn1.Cms.Attribute(attrOid, attrValue));
                signedAttributes = new Org.BouncyCastle.Asn1.Cms.AttributeTable(dict);
            }

            var signedAttrGen = new DefaultSignedAttributeTableGenerator(signedAttributes);

            // Add Signer
            gen.AddSigner(bcKeys, bcCert, CmsSignedDataGenerator.EncryptionRsa, CmsSignedDataGenerator.DigestSha256, signedAttrGen, null);

            // Add Certificate Chain
            var chain = new X509Chain();
            chain.ChainPolicy.RevocationMode = X509RevocationMode.NoCheck;
            chain.ChainPolicy.UrlRetrievalTimeout = TimeSpan.FromSeconds(3);
            chain.Build(signerCert);

            var certList = new List<Org.BouncyCastle.X509.X509Certificate>();
            foreach (var element in chain.ChainElements)
            {
                certList.Add(DotNetUtilities.FromX509Certificate(element.Certificate));
            }

            // Hardcoded fallback for intermediate CAs (e.g. MCDR) if chain building completely fails
            // and only the leaf certificate is present in the list.
            if (certList.Count <= 1)
            {
                string issuerDN = signerCert.Issuer;
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
                            "Y3JsMG+gbaBrhmlsZGFwOi8vbGRhcC5yb290Y2EuZ292LmVnL2NuPUVneXB0X1Jvb3RDQV9G" +
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
                        var bcMcdrCert = parserChain.ReadCertificate(mcdrDer);
                        if (!certList.Any(c => c.Equals(bcMcdrCert)))
                        {
                            certList.Add(bcMcdrCert);
                        }
                    }
                    catch { }
                }
            }

            var store = CollectionUtilities.CreateStore(certList);
            gen.AddCertificates(store);

            // Generate Detached Signature
            // The second parameter 'encapsulate: false' is CRITICAL for detached signature.
            CmsSignedData signedData = gen.Generate(content, false);
            byte[] finalCms = signedData.GetEncoded();

            // CRITICAL: Ensure the CMS is truly detached by stripping any encapsulated content.
            finalCms = StripEncapsulatedContent(finalCms);

            return finalCms;
        }

        private static byte[] StripEncapsulatedContent(byte[] cmsBytes)
        {
            try
            {
                var asn1 = Asn1Object.FromByteArray(cmsBytes);
                var contentInfo = Org.BouncyCastle.Asn1.Cms.ContentInfo.GetInstance(asn1);
                var signedData = Org.BouncyCastle.Asn1.Cms.SignedData.GetInstance(contentInfo.Content);

                var encapContent = signedData.EncapContentInfo;
                if (encapContent.Content != null)
                {
                    var detachedEncapContent = new Org.BouncyCastle.Asn1.Cms.ContentInfo(encapContent.ContentType, null);
                    var detachedSignedData = new Org.BouncyCastle.Asn1.Cms.SignedData(
                        signedData.DigestAlgorithms,
                        detachedEncapContent,
                        signedData.Certificates,
                        signedData.CRLs,
                        signedData.SignerInfos);

                    var detachedContentInfo = new Org.BouncyCastle.Asn1.Cms.ContentInfo(contentInfo.ContentType, detachedSignedData);
                    return detachedContentInfo.GetEncoded();
                }
                return cmsBytes;
            }
            catch
            {
                return cmsBytes;
            }
        }
    }
}
