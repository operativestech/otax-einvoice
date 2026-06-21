
import { Buffer } from 'buffer';

const b64 = "MIIFPAYJKoZIhvcNAQcCoIIFLTCCBSkCAQExDzANBglghkgBZQMEAgEFADALBgkqhkiG9w0BBwGgggMQMIIDDDCCAfSgAwIBAgIIZ7ZQgjH8Iq4wDQYJKoZIhvcNAQELBQAwFDESMBAGA1UEAxMJbG9jYWxob3N0MB4XDTI2MDExMjE0MDc1MVoXDTI3MDExMjE0MDc1MVowFDESMBAGA1UEAxMJbG9jYWxob3N0MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAyehClqo3AhgLoM5cJfg68dvQBi+I92utJWvwnspw2nh+WbjumX4aACNvjj5Yve1EDaccZ2NLaZnPZnCggySnjkP89s6z0tvvJbN9dNfQGyb784wsSHvPr9NorfbAwK1VXowXogbg182eqNI5B6ITIAFFuHrzcOPzUA8OahLc/dnmxLdKjpp8ZiPZwdNzyVSFBezeveKusRp98oN0cBoe7++UUMjBXoMyUSTcOpVsdMgWJiXfTn94VxzCYScHqhA0L9496G7D5m8o+vhWow1LdquuaaWnqnwrFo73Yy/JE7EiHtovPbq7pZ5e4GI3AH2DoBWSZ4hSv+wXJy3vj0v/jQIDAQABo2IwYDAMBgNVHRMBAf8EAjAAMA4GA1UdDwEB/wQEAwIFoDAWBgNVHSUBAf8EDDAKBggrBgEFBQcDATAXBgNVHREBAf8EDTALgglsb2NhbGhvc3QwDwYKKwYBBAGCN1QBAQQBAjANBgkqhkiG9w0BAQsFAAOCAQEAIVkQfO2M/jTVAFMAfLf5ltZkEV8xxvmz4GO8vB4Mlg7jYT2cVF9+wZOJpob0YKqTh/AG+cW3iPPeQmseKAk4WG4SJ1q+pWgtBOgs8DiF1FuxHxawBEbAxsbVc4PD2aVzKUaPWpskqw/yWBjEl2AApc1MkPg6k6XPAkNh20kx8+/RPjG6HeMk0YWNkcwdGWWTYIE1Pz9LL0/tJm0qauy6ZGdCZvxwhqz6fA0iRTocKKurj2/W3HpEJdzn8YfdZg8I+2Nvi/RjpKM4hiOzYz5VBeNfslnQGULFUXR04nh61ZZK18JVlgEK5fu9dRDs6vzW8pBbgLTWateC7FTXLphDTTGCAfAwggHsAgEBMCAwFDESMBAGA1UEAxMJbG9jYWxob3N0AghntlCCMfwirjANBglghkgBZQMEAgEFAKCBojAYBgkqhkiG9w0BCQMxCwYJKoZIhvcNAQcBMBwGCSqGSIb3DQEJBTEPFw0yNjAxMTMyMDIxMjhaMC8GCSqGSIb3DQEJBDEiBCAuXpAXwYdXQtav1gB7oX8dCvbSN2cJ5rjAtgziR5r/njA3BgsqhkiG9w0BCRACLzEoMCYwJDAiBCCb08Ad3MHtpjzyXRZh0TDca+aw5mR0mRgVIFJq9ihDEDANBgkqhkiG9w0BAQsFAASCAQCHlf7JEUPKC6jY9V/r/KiwXbIKTjlVzTJ0mosBwD+D7AG6mmQreLJ0AgYoE707DGeuf5c0fGA3aGUeIENStjsOeDIj+HT8DZ9EXtVUzAVtEa/kNO9MxCYfGemOnnvZCtE6sCOGs17UbxL5XSuXQLOxhVF9VY/J9luXJJ2FeU50MqjVpomSmUO1ACGhAlz5MThIjBEpKlF+ux0FjM1WQp2MkM+xG/2B3/bY/YhZjZ0AEIfeIwTLOSaGYQo3n01JYGnBHtynvvLlTbRBeJdbJj7HJI2kbTczoouxmi28PB9GZKodNGNKNJVUrzNl+grG6wYp8UGF1Hzbl+NCqJgjdsw9";
const buf = Buffer.from(b64, 'base64');

// Detached signature often has the content type followed by NO data.
// In hex, look for 1.2.840.113549.1.7.1 (Data) OID: 06 09 2A 86 48 86 F7 0D 01 07 01
const dataOid = Buffer.from([0x06, 0x09, 0x2A, 0x86, 0x48, 0x86, 0xF7, 0x0D, 0x01, 0x07, 0x01]);
const index = buf.indexOf(dataOid);

if (index !== -1) {
    console.log("Found Data OID at", index);
    // Check if there is a [0] tag after it (indicating content)
    const afterOid = buf.slice(index + dataOid.length);
    if (afterOid.length > 0 && afterOid[0] === 0xA0) {
        console.log("Found [0] tag after OID - might be ATTACHED if content follows.");
        // If it's 0xA0 0x80 (indefinite) or 0xA0 followed by some length
        // In a detached signature, this tag should be ABSENT or have 0 length.
    } else {
        console.log("No [0] tag after OID. Likely DETACHED.");
    }
}

// Check for localhost in cert
const hex = buf.toString('utf8');
if (hex.includes('localhost')) {
    console.log("CERTIFICATE CONTAINS 'localhost' - WRONG CERTIFICATE!");
}
