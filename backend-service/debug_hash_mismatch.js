const fs = require('fs');
const crypto = require('crypto');
const forge = require('node-forge');

const xmlPath = 'e:/E-Invoice/E-Invoice/invoices/Z0Z200EPRTA2DEGH9SS6QXEK10.xml';
const xml = fs.readFileSync(xmlPath, 'utf8');

// Extract JSON
const jsonMatch = xml.match(/<document>({.*?})<\/document>/s);
if (!jsonMatch) {
    console.error("Could not find JSON in XML");
    process.exit(1);
}
let jsonStr = jsonMatch[1];
// Unescape XML entities
jsonStr = jsonStr.replace(/&#34;/g, '"');
const doc = JSON.parse(jsonStr);

// Extract Signature
const sigMatch = xml.match(/"value":"(.*?)"/);
if (!sigMatch) {
    console.error("Could not find signature in XML");
    process.exit(1);
}
const sigBase64 = sigMatch[1];

// Extract Digest from Signature (CMS Message-Digest attribute)
function getMessageDigestFromSignature(base64) {
    const der = Buffer.from(base64, 'base64');
    const asn1 = forge.asn1.fromDer(der.toString('binary'));

    // Structure: ContentInfo -> SignedData -> SignerInfos -> SignerInfo -> Attributes -> Attribute (Message-Digest)
    // This is simplified extraction logic
    const content = asn1.value[1].value[0]; // SignedData
    const signerInfos = content.value[4]; // SignerInfos
    const signerInfo = signerInfos.value[0]; // First SignerInfo
    const authenticatedAttributes = signerInfo.value[3]; // [0] Attributes

    for (let attr of authenticatedAttributes.value) {
        const oid = forge.asn1.derToOid(attr.value[0].value);
        if (oid === '1.2.840.113549.1.9.4') { // message-digest
            return Buffer.from(attr.value[1].value[0].value, 'binary').toString('hex');
        }
    }
    return null;
}

const portalDigest = getMessageDigestFromSignature(sigBase64);
console.log("Portal Digest (from signature):", portalDigest);

// --- Serialization logic from server ---
function getSingularName(plural) {
    const mapping = {
        'invoiceLines': 'invoiceLine',
        'taxableItems': 'taxableItem',
        'taxTotals': 'taxTotal',
        'signatures': 'signature'
    };
    return mapping[plural] || (plural.endsWith('s') ? plural.slice(0, -1) : plural);
}

function escapeXMLQuotes(str) {
    return str.replace(/"/g, '\\"');
}

function formatNumber(num, fixed = null) {
    if (fixed !== null) return num.toFixed(fixed);
    if (Number.isInteger(num)) return num.toString();
    return Number(num.toPrecision(12)).toString();
}

function serialize(obj, type = 'JSON', fixed = null) {
    if (obj === null || obj === undefined) return '';
    if (typeof obj !== 'object' || obj instanceof Date) {
        let valueStr = '';
        if (obj instanceof Date) {
            valueStr = obj.toISOString().replace(/\.\d{3}Z$/, 'Z');
        } else if (typeof obj === 'number') {
            valueStr = formatNumber(obj, fixed);
        } else {
            valueStr = String(obj).trim();
        }
        if (type === 'XML') valueStr = escapeXMLQuotes(valueStr);
        return `"${valueStr}"`;
    }

    let serialized = '';
    const keys = Object.keys(obj);
    for (const key of keys) {
        const value = obj[key];
        if (key.toUpperCase() === 'SIGNATURES') continue;
        if (value === null || value === undefined || (Array.isArray(value) && value.length === 0)) continue;

        const upperKey = `"${key.toUpperCase()}"`;
        if (Array.isArray(value)) {
            serialized += upperKey;
            for (const item of value) {
                if (type === 'JSON') {
                    serialized += upperKey;
                } else {
                    const singularKey = `"${getSingularName(key).toUpperCase()}"`;
                    serialized += singularKey;
                }
                serialized += serialize(item, type, fixed);
            }
        } else {
            serialized += upperKey;
            serialized += serialize(value, type, fixed);
        }
    }
    return serialized;
}

// Test with current logic
const canonicalCurrent = '"DOCUMENT"' + serialize(doc, 'XML');
const digestCurrent = crypto.createHash('sha256').update(canonicalCurrent, 'utf8').digest('hex');
console.log("Current Local Digest         :", digestCurrent);
console.log("Match Current?               :", portalDigest === digestCurrent);

// Test with forced 5 decimal places (Common ETA requirement)
const canonicalFixed5 = '"DOCUMENT"' + serialize(doc, 'XML', 5);
const digestFixed5 = crypto.createHash('sha256').update(canonicalFixed5, 'utf8').digest('hex');
console.log("Fixed 5 Decimal Digest       :", digestFixed5);
console.log("Match Fixed 5?               :", portalDigest === digestFixed5);

// Test with forced 2 decimal places
const canonicalFixed2 = '"DOCUMENT"' + serialize(doc, 'XML', 2);
const digestFixed2 = crypto.createHash('sha256').update(canonicalFixed2, 'utf8').digest('hex');
console.log("Fixed 2 Decimal Digest       :", digestFixed2);
console.log("Match Fixed 2?               :", portalDigest === digestFixed2);

// Let's also check if property order is correct in my script vs what was signed
// (Assuming the forge parser preserves order)
