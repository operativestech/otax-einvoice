import { readFileSync } from 'fs';
import { serializeInvoice } from './server/etaSerialization.js';
import crypto from 'crypto';

console.log("=== ANALYZING LATEST INVOICE ===\n");

// Load the invoice
const xmlContent = readFileSync('e:/E-Invoice/E-Invoice/invoices/FZFQJZ329RBH2SKHR6BMP0FK10.xml', 'utf8');
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

// Get internal ID and timestamp
const internalIdMatch = xmlContent.match(/<internalId>(.*?)<\/internalId>/);
const dateIssuedMatch = xmlContent.match(/<dateTimeIssued>(.*?)<\/dateTimeIssued>/);
console.log(`Internal ID: ${internalIdMatch ? internalIdMatch[1] : 'unknown'}`);
console.log(`Date Issued: ${dateIssuedMatch ? dateIssuedMatch[1] : 'unknown'}`);
console.log("");

// Extract message-digest from signature
const sigB64 = doc.signatures[0].value;
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

console.log("=== HASH COMPARISON ===");
console.log(`Message-Digest from signature: ${digestFromSig}`);
console.log(`Our calculated hash:           ${ourHash}`);
console.log("");

if (digestFromSig === ourHash) {
    console.log("✅ HASHES MATCH!");
    console.log("");
    console.log("Our canonicalization is correct, but ETA is still calculating a different hash.");
    console.log("This means the JSON sent to ETA is being modified somewhere.");
    console.log("");
    console.log("=== DEBUGGING STEPS ===");
    console.log("1. Check if the server was restarted after the Buffer fix");
    console.log("2. Verify the axios request is actually sending a Buffer");
    console.log("3. Check if there's a proxy or middleware modifying the request");
    console.log("");
    console.log("=== NEXT ACTION ===");
    console.log("Add logging to see what's actually being sent to ETA:");
    console.log("console.log('Payload type:', typeof payload);");
    console.log("console.log('Payload is Buffer:', Buffer.isBuffer(payload));");
    console.log("console.log('First 200 bytes:', payload.slice(0, 200).toString('utf8'));");
} else {
    console.log("❌ HASHES DON'T MATCH!");
    console.log("There's an issue with our canonicalization.");
}

console.log("");
console.log("=== CANONICAL STRING CHECK ===");
console.log("First 400 chars:");
console.log(canonical.substring(0, 400));
console.log("");
if (canonical.includes('"INVOICELINES""INVOICELINES"')) {
    console.log("✅ Using PLURAL array keys");
} else {
    console.log("❌ Not using PLURAL array keys");
}
