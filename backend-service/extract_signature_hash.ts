import { readFileSync } from 'fs';
import { execSync } from 'child_process';
import { writeFileSync } from 'fs';

// Extract the signature from the XML
const xmlContent = readFileSync('e:/E-Invoice/E-Invoice/invoices/A6ZQDG15X6AGRS3G69ZRAYEK10.xml', 'utf8');

const match = xmlContent.match(/<document>({[^<]+})<\/document>/);
if (!match) {
    console.error('Could not extract JSON');
    process.exit(1);
}

let jsonStr = match[1]
    .replace(/&#34;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');

const doc = JSON.parse(jsonStr);
const signatureB64 = doc.signatures[0].value;

console.log("=== SIGNATURE ANALYSIS ===");
console.log(`Signature length: ${signatureB64.length} chars`);
console.log("");

// Save signature to file
writeFileSync('temp_sig.b64', signatureB64);

// Try to extract message-digest using openssl
try {
    // Decode base64 and save as DER
    const sigBuffer = Buffer.from(signatureB64, 'base64');
    writeFileSync('temp_sig.der', sigBuffer);

    console.log(`Signature binary size: ${sigBuffer.length} bytes`);
    console.log("");

    // Try to parse with openssl
    try {
        const asn1Output = execSync('openssl asn1parse -inform DER -in temp_sig.der', { encoding: 'utf8' });
        console.log("=== ASN.1 Structure (first 2000 chars) ===");
        console.log(asn1Output.substring(0, 2000));
    } catch (e: any) {
        console.log("Could not parse ASN.1:", e.message);
    }

} catch (e: any) {
    console.error("Error:", e.message);
}

console.log("");
console.log("=== EXPECTED HASH ===");
console.log("From our canonicalization: 414cffda414c0432c6f4dff96d0856779300ef87b5672b38a77446622600fca9");
console.log("");
console.log("The message-digest in the signature should match this hash.");
console.log("If it doesn't, there's a mismatch in what we're signing vs what we're sending.");
