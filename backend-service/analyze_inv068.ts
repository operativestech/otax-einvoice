import { readFileSync } from 'fs';
import { serializeInvoice } from './server/etaSerialization.js';
import crypto from 'crypto';

// Extract JSON from the XML file
const xmlContent = readFileSync('e:/E-Invoice/E-Invoice/invoices/A6ZQDG15X6AGRS3G69ZRAYEK10.xml', 'utf8');

// Find the document JSON (it's HTML-encoded in the XML)
const match = xmlContent.match(/<document>({[^<]+})<\/document>/);
if (!match) {
    console.error('Could not extract JSON from XML');
    process.exit(1);
}

// Decode HTML entities
let jsonStr = match[1]
    .replace(/&#34;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');

const doc = JSON.parse(jsonStr);

// Remove signatures
delete doc.signatures;

// Serialize
const canonical = serializeInvoice(doc);
const hash = crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');

console.log("=== INVOICE: inv-068 ===");
console.log(`Submission Time: 2026-01-14T13:22:52 (BEFORE UTF-8 fix was applied)`);
console.log("");

console.log("=== CANONICAL STRING (First 600 chars) ===");
console.log(canonical.substring(0, 600));
console.log("");

console.log("=== CANONICAL STRING (Last 400 chars) ===");
console.log(canonical.substring(canonical.length - 400));
console.log("");

console.log("=== HASH ===");
console.log(hash);
console.log("");

console.log("=== STRUCTURE CHECKS ===");

// Check property order
const issuerPart = canonical.split('"ISSUER"')[1]?.split('"RECEIVER"')[0] || "";
const addressIdx = issuerPart.indexOf('"ADDRESS"');
const typeIdx = issuerPart.indexOf('"TYPE"');
console.log(addressIdx < typeIdx ? "✅ ADDRESS before TYPE" : "❌ TYPE before ADDRESS");

// Check array keys
if (canonical.includes('"INVOICELINES""INVOICELINES"')) {
    console.log("✅ Array keys: PLURAL repetition");
} else if (canonical.includes('"INVOICELINES""INVOICELINE"')) {
    console.log("❌ Array keys: SINGULAR");
}

// Check numbers
const hasNaturalNumbers = !canonical.includes('.00000"') && !canonical.includes('.0000"');
console.log(hasNaturalNumbers ? "✅ Natural numbers" : "❌ Fixed decimal numbers");

// Extract a sample of the Arabic text to see if it's UTF-8 or escaped
const arabicMatch = canonical.match(/"NAME""([^"]+)"/);
if (arabicMatch) {
    console.log("");
    console.log("=== ARABIC TEXT SAMPLE ===");
    console.log(`Issuer Name in canonical: ${arabicMatch[1].substring(0, 50)}...`);
    console.log(`Contains \\u escapes: ${arabicMatch[1].includes('\\u') ? '❌ YES (WRONG)' : '✅ NO (CORRECT)'}`);
}

console.log("");
console.log("=== CRITICAL INFO ===");
console.log("This invoice was submitted BEFORE the UTF-8 fix was applied.");
console.log("The server must be restarted and a NEW invoice submitted to test the fix.");
