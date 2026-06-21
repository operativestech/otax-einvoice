import { readFileSync } from 'fs';
import { serializeInvoice } from './server/etaSerialization.js';
import crypto from 'crypto';

console.log("=== SIGNATURE ANALYSIS (Node.js) ===\n");

// Load FAILED invoice
const failedXml = readFileSync('e:/E-Invoice/E-Invoice/invoices/A6ZQDG15X6AGRS3G69ZRAYEK10.xml', 'utf8');
const match = failedXml.match(/<document>({[^<]+})<\/document>/);
if (!match) {
    console.error('Could not extract JSON');
    process.exit(1);
}

let failedJsonStr = match[1]
    .replace(/&#34;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');

const failedDoc = JSON.parse(failedJsonStr);
const failedSigB64 = failedDoc.signatures[0].value;

console.log("FAILED Invoice:");
console.log(`  Signature length: ${failedSigB64.length} chars`);
console.log(`  Signature (first 100 chars): ${failedSigB64.substring(0, 100)}...`);
console.log("");

// Decode signature
const sigBuffer = Buffer.from(failedSigB64, 'base64');
console.log(`  Signature binary size: ${sigBuffer.length} bytes`);
console.log("");

// Look for message-digest OID (1.2.840.113549.1.9.4)
// In hex: 06 09 2A 86 48 86 F7 0D 01 09 04
const oidHex = '06092a864886f70d010904';
const sigHex = sigBuffer.toString('hex');

const oidIndex = sigHex.indexOf(oidHex);
if (oidIndex !== -1) {
    console.log("✅ Found message-digest OID at position:", oidIndex / 2);

    // The hash should follow shortly after the OID
    // Look for OCTET STRING (04) followed by length (20 for SHA256 = 32 bytes)
    const afterOid = sigHex.substring(oidIndex + oidHex.length);

    // Look for pattern: 04 20 (OCTET STRING, length 32)
    const octetStringIndex = afterOid.indexOf('0420');
    if (octetStringIndex !== -1) {
        const hashStart = octetStringIndex + 4; // Skip "0420"
        const hashHex = afterOid.substring(hashStart, hashStart + 64); // 32 bytes = 64 hex chars

        console.log(`  Message-Digest from signature: ${hashHex}`);
        console.log("");
    } else {
        console.log("  Could not find OCTET STRING pattern after OID");
        console.log(`  Data after OID (first 200 chars): ${afterOid.substring(0, 200)}`);
        console.log("");
    }
} else {
    console.log("❌ Could not find message-digest OID in signature");
    console.log("");
}

// Calculate our hash
const failedDocForHash = JSON.parse(failedJsonStr);
delete failedDocForHash.signatures;
const canonical = serializeInvoice(failedDocForHash);
const ourHash = crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');

console.log("=== OUR CALCULATION ===");
console.log(`Our calculated hash: ${ourHash}`);
console.log("");

console.log("=== COMPARISON ===");
console.log("If these match, our canonicalization is correct!");
console.log("If they don't match, we need to adjust our canonicalization logic.");
