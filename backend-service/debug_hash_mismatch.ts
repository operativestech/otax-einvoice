import fs from 'fs';
import crypto from 'crypto';

const xmlPath = 'e:/E-Invoice/E-Invoice/invoices/Z0Z200EPRTA2DEGH9SS6QXEK10.xml';
if (!fs.existsSync(xmlPath)) {
    console.error(`File not found: ${xmlPath}`);
    process.exit(1);
}
const xml = fs.readFileSync(xmlPath, 'utf8');

// 1. Extract JSON content
const jsonMatch = xml.match(/<document>({.*?})<\/document>/s);
if (!jsonMatch) {
    console.error("Could not find JSON string inside <document> tags");
    process.exit(1);
}
let jsonStr = jsonMatch[1].replace(/&#34;/g, '"');
const doc = JSON.parse(jsonStr);

// 2. Find the SHA256 Message-Digest in the Base64 signature
// The Message-Digest attribute is an OID 1.2.840.113549.1.9.4 (Hex: 06 09 2A 86 48 86 F7 0D 01 09 04)
// followed by a SET containing an OCTET STRING of 32 bytes.
const signature = doc.signatures[0].value;
const sigBuf = Buffer.from(signature, 'base64');
const oid = Buffer.from([0x06, 0x09, 0x2A, 0x86, 0x48, 0x86, 0xF7, 0x0D, 0x01, 0x09, 0x04]);
const oidPos = sigBuf.indexOf(oid);

if (oidPos === -1) {
    console.error("Could not find Message-Digest OID in signature");
    process.exit(1);
}

// The value follows the OID. Usually: OID (11 bytes) | SET Tag (1 byte) | SET Length (1 byte) | OCTET STRING Tag (1 byte) | OCTET STRING Length (1 byte, 0x20) | SHA256 (32 bytes)
const digestPos = oidPos + 11 + 2 + 2;
const portalDigest = sigBuf.slice(digestPos, digestPos + 32).toString('hex');
console.log("Portal Expected Digest (from Signature):", portalDigest);

// 3. Try to match the digest by varying serialization
function getSingularName(plural) {
    const mapping = { 'invoiceLines': 'invoiceLine', 'taxableItems': 'taxableItem', 'taxTotals': 'taxTotal', 'signatures': 'signature' };
    return mapping[plural] || (plural.endsWith('s') ? plural.slice(0, -1) : plural);
}

function serialize(obj, type = 'JSON', numFormat = 'natural') {
    if (obj === null || obj === undefined) return '';
    if (typeof obj !== 'object' || obj instanceof Date) {
        let valueStr = '';
        if (obj instanceof Date) {
            valueStr = obj.toISOString().replace(/\.\d{3}Z$/, 'Z');
        } else if (typeof obj === 'number') {
            if (numFormat === 'natural') valueStr = Number(obj.toPrecision(12)).toString();
            else if (numFormat === 'fixed5') valueStr = obj.toFixed(5);
            else if (numFormat === 'fixed2') valueStr = obj.toFixed(2);
        } else {
            // Check if we should trim or not. SDK says "without processing" which usually means NO TRIM.
            valueStr = String(obj);
        }
        if (type === 'XML') valueStr = valueStr.replace(/"/g, '\\"');
        return `"${valueStr}"`;
    }
    let serialized = '';
    const keys = Object.keys(obj);
    for (const key of keys) {
        if (key.toUpperCase() === 'SIGNATURES') continue;
        const value = obj[key];
        if (value === null || value === undefined || (Array.isArray(value) && value.length === 0)) continue;
        const upperKey = `"${key.toUpperCase()}"`;
        if (Array.isArray(value)) {
            serialized += upperKey;
            for (const item of value) {
                if (type === 'JSON') serialized += upperKey;
                else serialized += `"${getSingularName(key).toUpperCase()}"`;
                serialized += serialize(item, type, numFormat);
            }
        } else {
            serialized += upperKey;
            serialized += serialize(value, type, numFormat);
        }
    }
    return serialized;
}

const tryFormat = (name, format) => {
    const can = '"DOCUMENT"' + serialize(doc, 'XML', format);
    const dig = crypto.createHash('sha256').update(can, 'utf8').digest('hex');
    const match = dig === portalDigest;
    console.log(`${name.padEnd(25)}: ${dig} ${match ? '✅ MATCH!' : ''}`);
    return match;
};

tryFormat('Natural (Current)', 'natural');
tryFormat('Fixed 5 Decimals', 'fixed5');
tryFormat('Fixed 2 Decimals', 'fixed2');

// Try with property reordering check
console.log("\nChecking for subtle order issues...");
// ... if none match, we might need to check the "issuer" / "receiver" order again.
