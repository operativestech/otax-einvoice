import { readFileSync } from 'fs';
import { execSync } from 'child_process';
import { writeFileSync } from 'fs';
import { serializeInvoice } from './server/etaSerialization.js';
import crypto from 'crypto';

console.log("=== COMPARING VALID vs FAILED INVOICE ===\n");

// Load VALID invoice
const validData = JSON.parse(readFileSync('e:/E-Invoice/E-Invoice/invoices/valid.json', 'utf8'));
// The valid invoice has XML in the document field, need to parse it differently
console.log("VALID Invoice:");
console.log(`  Internal ID: ${validData.internalId}`);
console.log(`  Status: ${validData.status}`);
console.log(`  Validation: ${validData.validationResults.status}`);
console.log("");

// Load FAILED invoice
const failedXml = readFileSync('e:/E-Invoice/E-Invoice/invoices/A6ZQDG15X6AGRS3G69ZRAYEK10.xml', 'utf8');
const match = failedXml.match(/<document>({[^<]+})<\/document>/);
if (!match) {
    console.error('Could not extract JSON from failed invoice');
    process.exit(1);
}

let failedJsonStr = match[1]
    .replace(/&#34;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');

const failedDoc = JSON.parse(failedJsonStr);

console.log("FAILED Invoice:");
console.log(`  Internal ID: inv-068`);
console.log(`  Status: Invalid`);
console.log(`  Error: 4043 - message-digest mismatch`);
console.log("");

// Extract signatures
const validSigB64 = "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";
const failedSigB64 = failedDoc.signatures[0].value;

console.log("=== SIGNATURE COMPARISON ===");
console.log(`Valid signature length: ${validSigB64.length} chars`);
console.log(`Failed signature length: ${failedSigB64.length} chars`);
console.log("");

// Save both signatures for analysis
writeFileSync('temp_valid_sig.der', Buffer.from(validSigB64, 'base64'));
writeFileSync('temp_failed_sig.der', Buffer.from(failedSigB64, 'base64'));

console.log("=== EXTRACTING MESSAGE-DIGEST FROM SIGNATURES ===\n");

// Try to extract message-digest from both signatures using openssl
try {
    console.log("VALID Invoice Signature:");
    const validAsn1 = execSync('openssl asn1parse -inform DER -in temp_valid_sig.der', { encoding: 'utf8' });

    // Look for message-digest attribute (OID 1.2.840.113549.1.9.4)
    const validDigestMatch = validAsn1.match(/1\.2\.840\.113549\.1\.9\.4[\s\S]*?OCTET STRING.*?\n.*?:([0-9A-F\s:]+)/);
    if (validDigestMatch) {
        const digestHex = validDigestMatch[1].replace(/[\s:]/g, '').toLowerCase();
        console.log(`  Message-Digest (from signature): ${digestHex}`);
    }
    console.log("");

    console.log("FAILED Invoice Signature:");
    const failedAsn1 = execSync('openssl asn1parse -inform DER -in temp_failed_sig.der', { encoding: 'utf8' });

    const failedDigestMatch = failedAsn1.match(/1\.2\.840\.113549\.1\.9\.4[\s\S]*?OCTET STRING.*?\n.*?:([0-9A-F\s:]+)/);
    if (failedDigestMatch) {
        const digestHex = failedDigestMatch[1].replace(/[\s:]/g, '').toLowerCase();
        console.log(`  Message-Digest (from signature): ${digestHex}`);
    }
    console.log("");

} catch (e: any) {
    console.log("Could not extract message-digest:", e.message);
}

console.log("=== OUR CALCULATED HASH (Failed Invoice) ===");
const failedDocForHash = JSON.parse(failedJsonStr);
delete failedDocForHash.signatures;
const canonical = serializeInvoice(failedDocForHash);
const ourHash = crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
console.log(`Our calculated hash: ${ourHash}`);
console.log("");

console.log("=== CONCLUSION ===");
console.log("If the message-digest from the FAILED signature matches our calculated hash,");
console.log("then our canonicalization is correct and the issue is elsewhere.");
console.log("If they don't match, we need to adjust our canonicalization.");
