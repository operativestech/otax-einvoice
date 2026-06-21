import { readFileSync } from 'fs';
import { serializeInvoice } from './server/etaSerialization.js';
import crypto from 'crypto';

// Load the failed invoice JSON
const invoiceData = JSON.parse(readFileSync('e:/E-Invoice/E-Invoice/invoices/J8CFNR2JEXPW6XQWG1W2HSEK10.json', 'utf8'));
const doc = JSON.parse(invoiceData.document);

// Remove signatures before serialization
delete doc.signatures;

// Serialize
const canonical = serializeInvoice(doc);

// Calculate hash
const hash = crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');

console.log("=== CANONICAL STRING (First 500 chars) ===");
console.log(canonical.substring(0, 500));
console.log("\n=== CANONICAL STRING (Last 500 chars) ===");
console.log(canonical.substring(canonical.length - 500));
console.log("\n=== HASH ===");
console.log(hash);
console.log("\n=== LENGTH ===");
console.log(canonical.length);

// Check for issues
console.log("\n=== DIAGNOSTICS ===");
if (canonical.includes('"INVOICELINES""INVOICELINE"')) {
    console.log("⚠️  WARNING: Using SINGULAR key (INVOICELINE) - Should be PLURAL for V1.0");
} else if (canonical.includes('"INVOICELINES""INVOICELINES"')) {
    console.log("✅ Using PLURAL key repetition (INVOICELINES)");
}

if (canonical.includes('.00000"') || canonical.includes('.0"')) {
    console.log("⚠️  WARNING: Numbers have trailing zeros");
} else {
    console.log("✅ Numbers appear to be natural format");
}

// Check property order
const issuerPart = canonical.split('"ISSUER"')[1]?.split('"RECEIVER"')[0] || "";
const addressFirst = issuerPart.indexOf('"ADDRESS"') < issuerPart.indexOf('"TYPE"');
console.log(addressFirst ? "✅ ADDRESS before TYPE" : "⚠️  TYPE before ADDRESS");
