import { readFileSync } from 'fs';
import { serializeInvoice } from './server/etaSerialization.js';
import crypto from 'crypto';

console.log("=== ANALYZING INVOICE inv-069 ===\n");

// Load the invoice
const xmlContent = readFileSync('e:/E-Invoice/E-Invoice/invoices/QVXRVJ14NDRHTFR6C9DSN0FK10.xml', 'utf8');
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
const sigB64 = doc.signatures[0].value;

// Extract message-digest from signature
const sigBuffer = Buffer.from(sigB64, 'base64');
const sigHex = sigBuffer.toString('hex');
const oidHex = '06092a864886f70d010904';
const oidIndex = sigHex.indexOf(oidHex);

let digestFromSig = 'NOT FOUND';
if (oidIndex !== -1) {
    const afterOid = sigHex.substring(oidIndex + oidHex.length);
    const octetStringIndex = afterOid.indexOf('0420');
    if (octetStringIndex !== -1) {
        const hashStart = octetStringIndex + 4;
        digestFromSig = afterOid.substring(hashStart, hashStart + 64);
    }
}

// Calculate our hash
const docForHash = JSON.parse(jsonStr);
delete docForHash.signatures;
const canonical = serializeInvoice(docForHash);
const ourHash = crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');

console.log("Message-Digest from signature:", digestFromSig);
console.log("Our calculated hash:          ", ourHash);
console.log("");

if (digestFromSig === ourHash) {
    console.log("✅ HASHES MATCH! Our canonicalization is correct.");
    console.log("");
    console.log("=== PROBLEM ANALYSIS ===");
    console.log("Since our hash matches the signature, the issue is:");
    console.log("The ETA portal is calculating a DIFFERENT hash from the JSON we send.");
    console.log("");
    console.log("This means the JSON sent to ETA is different from what we signed.");
    console.log("Possible causes:");
    console.log("1. Unicode escaping (\\uXXXX) is being applied by axios");
    console.log("2. JSON.stringify is modifying the data");
    console.log("3. The server code changes weren't applied");
} else {
    console.log("❌ HASHES DON'T MATCH!");
    console.log("Our canonicalization is incorrect.");
}

console.log("");
console.log("=== CANONICAL STRING ANALYSIS ===");
console.log("First 600 chars:");
console.log(canonical.substring(0, 600));
console.log("");
console.log("Array key check:");
if (canonical.includes('"INVOICELINES""INVOICELINES"')) {
    console.log("✅ Using PLURAL array keys (JSON format)");
} else if (canonical.includes('"INVOICELINES""INVOICELINE"')) {
    console.log("❌ Using SINGULAR array keys (XML format) - WRONG for JSON!");
}
