import { readFileSync } from 'fs';
import { serializeInvoice } from './server/etaSerialization.js';
import crypto from 'crypto';

// Load the invoice JSON from the XML
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

const docWithSignatures = JSON.parse(jsonStr);
const docForHashing = JSON.parse(jsonStr);
delete docForHashing.signatures;

console.log("=== COMPARISON TEST ===");
console.log("");

// 1. What we HASH
const canonical = serializeInvoice(docForHashing);
const ourHash = crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
console.log("1. HASH WE CALCULATED:");
console.log(ourHash);
console.log("");

// 2. What we SEND to ETA
const jsonSent = JSON.stringify(docWithSignatures);
console.log("2. JSON WE SENT TO ETA (first 500 chars):");
console.log(jsonSent.substring(0, 500));
console.log("");

// 3. What ETA would canonicalize
const etaCanonical = serializeInvoice(docWithSignatures); // WITH signatures
const etaHash = crypto.createHash('sha256').update(etaCanonical, 'utf8').digest('hex');
console.log("3. HASH IF ETA INCLUDES SIGNATURES:");
console.log(etaHash);
console.log("");

// 4. Check if JSON has escaped Unicode
const hasEscapedUnicode = jsonSent.includes('\\u');
console.log("4. JSON HAS ESCAPED UNICODE:");
console.log(hasEscapedUnicode ? "❌ YES (This would cause mismatch)" : "✅ NO");
console.log("");

// 5. Check specific fields
console.log("5. SPECIFIC FIELD CHECKS:");
const parsed = JSON.parse(jsonSent);
console.log(`   - Issuer name: ${parsed.issuer.name.substring(0, 30)}...`);
console.log(`   - Has salesOrderReference: ${!!parsed.salesOrderReference}`);
console.log(`   - Has payment section: ${!!parsed.payment}`);
console.log(`   - Has delivery section: ${!!parsed.delivery}`);
console.log("");

console.log("=== CRITICAL FINDING ===");
if (parsed.payment || parsed.delivery) {
    console.log("⚠️  WARNING: Invoice has PAYMENT or DELIVERY sections");
    console.log("   These sections are NOT in our etaBuilder.ts!");
    console.log("   This could cause a hash mismatch.");
} else {
    console.log("✅ No payment/delivery sections (as expected)");
}
