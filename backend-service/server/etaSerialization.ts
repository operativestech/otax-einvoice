/**
 * ETA Egypt e-Invoicing & e-Receipt Serialization Algorithm
 * Based on: https://sdk.invoicing.eta.gov.eg/document-serialization-approach/
 */

function getSingularName(plural: string): string {
    const mapping: Record<string, string> = {
        'invoiceLines': 'invoiceLine',
        'taxableItems': 'taxableItem',
        'taxTotals': 'taxTotal',
        'signatures': 'signature',
        'lineItems': 'lineItem',
        'receipts': 'receipt'
    };
    if (mapping[plural]) return mapping[plural];
    if (plural.endsWith('s')) return plural.slice(0, -1);
    return plural;
}

function escapeXMLQuotes(str: string): string {
    return str.replace(/"/g, '\\"');
}

/**
 * Natural number formatting for ETA.
 * Rule: Values should be taken "without any processing", just like those are in the input document.
 * Step 494 diagnostic proved that "Natural" formatting matches the Portal's expected digest.
 */
function formatNumber(num: number): string {
    // Number(num.toPrecision(12)).toString() is the "Natural" representation.
    // It removes trailing zeros (10.50 -> "10.5", 5.00 -> "5").
    // This matches how the ETA Portal V1.0 processes numeric values from JSON.
    return Number(num.toPrecision(12)).toString();
}

export function serialize(obj: any, type: 'JSON' | 'XML' = 'JSON'): string {
    if (obj === null || obj === undefined) return '';

    if (typeof obj !== 'object' || obj instanceof Date) {
        let valueStr = '';
        if (obj instanceof Date) {
            valueStr = obj.toISOString().replace(/\.\d{3}Z$/, 'Z');
        } else if (typeof obj === 'number') {
            valueStr = formatNumber(obj);
        } else {
            valueStr = String(obj);
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
            // Official ETA SDK Rule:
            // JSON: Repeat PLURAL parent key for each array element
            // XML: Use SINGULAR child key for each array element
            serialized += upperKey; // Parent key once
            if (type === 'JSON') {
                // JSON: "INVOICELINES""INVOICELINES"<item1>"INVOICELINES"<item2>
                for (const item of value) {
                    serialized += upperKey; // Repeat parent (plural) key
                    serialized += serialize(item, type);
                }
            } else {
                // XML: "INVOICELINES""INVOICELINE"<item1>"INVOICELINE"<item2>
                const singularKey = `"${getSingularName(key).toUpperCase()}"`;
                for (const item of value) {
                    serialized += singularKey; // Use singular child key
                    serialized += serialize(item, type);
                }
            }
        } else if (typeof value === 'object') {
            serialized += upperKey;
            serialized += serialize(value, type);
        } else {
            serialized += upperKey;
            serialized += serialize(value, type);
        }
    }
    return serialized;
}

export function serializeInvoice(obj: any): string {
    // CRITICAL: Even though we submit JSON to ETA API, the e-Invoice signature verification 
    // on the ETA server expects the canonical string to use XML array key formatting 
    // (e.g. "INVOICELINES""INVOICELINE"<item> instead of repeating "INVOICELINES").
    return '"DOCUMENT"' + serialize(obj, 'XML');
}

export function serializeReceiptBatch(batch: any): string {
    return serialize(batch, 'JSON');
}

export function serializeETA(obj: any): string {
    return serializeInvoice(obj);
}

export const serializeETALegacy = serializeInvoice;
