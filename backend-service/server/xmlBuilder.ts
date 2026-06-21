/**
 * ETA XML Document Builder
 * Converts JSON invoice structure to ETA-compliant XML format
 */

export function buildXMLFromJSON(jsonDoc: any): string {
    const escapeXML = (str: string): string => {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');
    };

    const buildElement = (name: string, value: any, indent: string = ''): string => {
        if (value === null || value === undefined || value === '') {
            return `${indent}<${name}/>\n`;
        }

        if (typeof value === 'object' && !Array.isArray(value)) {
            let xml = `${indent}<${name}>\n`;
            for (const key in value) {
                xml += buildElement(key, value[key], indent + '  ');
            }
            xml += `${indent}</${name}>\n`;
            return xml;
        }

        if (Array.isArray(value)) {
            let xml = `${indent}<${name}>\n`;
            for (const item of value) {
                // For arrays, each item gets wrapped in singular form
                const singularName = getSingularName(name);
                xml += buildElement(singularName, item, indent + '  ');
            }
            xml += `${indent}</${name}>\n`;
            return xml;
        }

        // Simple value
        return `${indent}<${name}>${escapeXML(String(value))}</${name}>\n`;
    };

    const getSingularName = (plural: string): string => {
        const mapping: Record<string, string> = {
            'invoiceLines': 'invoiceLine',
            'taxableItems': 'taxableItem',
            'taxTotals': 'taxTotal',
            'signatures': 'signature',
            'references': 'reference',   // C/D/EC/ED notes link to the originating invoice(s)
        };
        return mapping[plural] || plural.replace(/s$/, '');
    };

    // Build the complete XML document
    let xml = '<document>\n';

    // Process each top-level element in the order ETA's XML sample expects.
    // Additions 2026-04-18:
    //   - serviceDeliveryDate (REQUIRED for export types EI/EC/ED)
    //   - references          (REQUIRED for Debit / Credit / Export-Debit / Export-Credit notes)
    const orderedKeys = [
        'issuer',
        'receiver',
        'documentType',
        'documentTypeVersion',
        'dateTimeIssued',
        'serviceDeliveryDate',
        'taxpayerActivityCode',
        'internalID',
        'purchaseOrderReference',
        'purchaseOrderDescription',
        'salesOrderReference',
        'salesOrderDescription',
        'proformaInvoiceNumber',
        'references',
        'payment',
        'delivery',
        'invoiceLines',
        'totalSalesAmount',
        'totalDiscountAmount',
        'netAmount',
        'taxTotals',
        'totalAmount',
        'totalItemsDiscountAmount',
        'extraDiscountAmount',
        'signatures'
    ];

    for (const key of orderedKeys) {
        if (jsonDoc.hasOwnProperty(key)) {
            xml += buildElement(key, jsonDoc[key], '');
        }
    }

    xml += '</document>';

    return xml;
}

/**
 * Canonicalize XML for ETA signature
 * This removes formatting but preserves structure
 */
export function canonicalizeXML(xml: string): string {
    // Remove XML declaration if present
    xml = xml.replace(/<\?xml[^?]*\?>/g, '');

    // Remove whitespace between tags
    xml = xml.replace(/>\s+</g, '><');

    // Trim
    xml = xml.trim();

    return xml;
}
