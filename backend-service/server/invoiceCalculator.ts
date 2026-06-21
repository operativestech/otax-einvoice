/**
 * Invoice Calculator - Egyptian Tax Authority (ETA) Invoice Calculations
 * Handles all tax calculations according to ETA specifications
 * IMPORTANT: Taxes are calculated in CASCADE (each tax is calculated on net + previous taxes)
 */

/**
 * A ready-to-submit taxable item in the ETA shape. When the caller provides
 * `taxableItems` on a line, we use it verbatim (just compute `amount`) and
 * skip the legacy tax_V001/V003/V009/W007 path entirely.
 */
export interface TaxableItemInput {
    taxType: string;   // 'T1' .. 'T20'
    subType: string;   // 'V001', 'W007', 'Tb01', …
    rate: number;      // percentage (0..200)
}

interface InvoiceLineItem {
    description: string;
    itemType: string;
    itemCode: string;
    itemInternalCode: string;
    unitType: string;
    quantity: number;
    currencySold: string;
    amount: number; // Unit price
    currencyExchangeRate: number;
    disRate: number; // Discount rate (%)
    disAmount: number; // Discount amount
    /**
     * NEW (preferred): full list of taxable items in ETA shape. When present,
     * drives the line's tax calculation directly — every (taxType, subType, rate)
     * triple emits a corresponding taxableItem in the submission. VAT (T1) and
     * the two Schedule tax types (T2, T3) cascade as per ETA spec; T4 (WHT) is
     * SUBTRACTED from the final payable total.
     */
    taxableItems?: TaxableItemInput[];
    // ── Legacy 4-tax fields. Kept for backward compat with existing Excel files
    //    that don't yet know about `taxableItems`. Ignored if `taxableItems` is set.
    tax_V001?: number;
    tax_V003?: number;
    tax_V009?: number;
    tax_W007?: number;
}

interface InvoiceHeader {
    internalId: string;
    receiverType: string;
    receiverId: string;
    receiverName: string;
    receiverCountry: string;
    receiverGovernate: string;
    receiverRegionCity: string;
    receiverStreet: string;
    receiverBuildingNumber: string;
    receiverPostalCode: string;
    receiverFloor: string;
    receiverRoom: string;
    receiverLandmark: string;
    receiverAdditionalInformation: string;
    documentType: string;
    /** '0.9' for I/D/C, '1.0' for EI/ED/EC. */
    documentTypeVersion?: string;
    dateTimeIssued: string;
    /** ETA activity code (ISIC4). Falls back to the issuer's default if absent. */
    taxpayerActivityCode?: string;
    /** Required for Export docs (EI/ED/EC). Format YYYY-MM-DD. */
    serviceDeliveryDate?: string;
    /** Required for Debit/Credit notes (D/C/ED/EC). UUIDs of original invoices. */
    references?: string[];
    proformaInvoiceNumber?: string;
    purchaseOrderReference?: string;
    purchaseOrderDescription?: string;
    salesOrderReference?: string;
    salesOrderDescription?: string;
    paymentBankName?: string;
    paymentBankAddress?: string;
    paymentBankAccountNo?: string;
    paymentBankAccountIban?: string;
    paymentSwiftCode?: string;
    paymentTerms?: string;
    deliveryApproach?: string;
    deliveryPackaging?: string;
    deliveryDateValidity?: string;
    deliveryExportPort?: string;
    deliveryCountryOfOrigin?: string;
    deliveryGrossWeight?: number;
    deliveryNetWeight?: number;
    deliveryTerms?: string;
    extraDiscountAmount: number;
}

interface CalculatedLine extends InvoiceLineItem {
    salesTotal: number;
    netTotal: number;
    taxableItems: Array<{
        taxType: string;
        subType: string;
        rate: number;
        amount: number;
    }>;
    totalTaxAmount: number;
    total: number;
}

interface CalculatedInvoice {
    header: InvoiceHeader;
    lines: CalculatedLine[];
    totalSalesAmount: number;
    totalDiscountAmount: number;
    netAmount: number;
    taxTotals: Array<{
        taxType: string;
        amount: number;
    }>;
    extraDiscountAmount: number;
    totalAmount: number;
}

/**
 * Calculate a single invoice line item
 * IMPORTANT: Taxes are calculated in CASCADE order:
 * 1. Table Tax (T2) on Net
 * 2. VAT (T1) on (Net + T2)
 * 3. Entertainment (T7) on (Net + T2 + T1)
 * 4. Withholding (T4) on (Net + T2 + T1)
 * 5. Other fees (T20) on everything
 */
export function calculateInvoiceLine(line: InvoiceLineItem): CalculatedLine {
    // Step 1: Handle currency conversion
    let unitPriceEGP = line.amount;
    if (line.currencySold && line.currencySold.toUpperCase() !== 'EGP' && line.currencyExchangeRate > 0) {
        unitPriceEGP = line.amount * line.currencyExchangeRate;
    }

    // Step 2: Calculate sales total
    const salesTotal = parseFloat((line.quantity * unitPriceEGP).toFixed(5));

    // Step 3: Calculate discount
    let lineDiscountAmount = line.disAmount || 0;
    if (line.disRate && line.disRate > 0) {
        lineDiscountAmount = salesTotal * (line.disRate / 100);
    }
    const netTotal = parseFloat((salesTotal - lineDiscountAmount).toFixed(5));

    // Step 4: Calculate Taxes
    //
    // If the caller supplied an explicit `taxableItems` array (new path), we use
    // it verbatim. Otherwise we fall back to the legacy 4-tax mapping so old
    // Excel files keep working.
    //
    // Cascade order (ETA spec):
    //   1. T2 / T3 (Schedule tax) on Net
    //   2. T1 (VAT)              on (Net + T2)
    //   3. Everything else        on (Net + T2) [same base as VAT]
    //   4. T4 (Withholding) — computed on Net, SUBTRACTED from final total
    const taxableItems: Array<{
        taxType: string;
        subType: string;
        rate: number;
        amount: number;
    }> = [];

    let totalTaxAmount = 0;
    let finalTotal = netTotal;

    if (Array.isArray(line.taxableItems) && line.taxableItems.length > 0) {
        // ── NEW PATH: explicit per-line taxableItems ──
        // Sort so schedule taxes (T2/T3) compute first, VAT (T1) next, others last,
        // WHT (T4) processed at the end so the base is already finalised.
        const order = (t: string) =>
            t === 'T2' || t === 'T3' ? 0
          : t === 'T1' ? 1
          : t === 'T4' ? 3
          : 2;
        const sorted = [...line.taxableItems].sort((a, b) => order(a.taxType) - order(b.taxType));

        let scheduleTaxTotal = 0;  // T2 + T3 (bases for VAT and others)
        for (const ti of sorted) {
            const rate = Number(ti.rate) || 0;
            const typeCode = String(ti.taxType || '').toUpperCase();
            const subCode = String(ti.subType || '').trim();
            if (!typeCode || rate < 0) continue;

            let base: number;
            if (typeCode === 'T2' || typeCode === 'T3') {
                base = netTotal;
            } else {
                base = netTotal + scheduleTaxTotal;
            }
            const amount = parseFloat((base * (rate / 100)).toFixed(5));

            taxableItems.push({ taxType: typeCode, subType: subCode, rate, amount });

            if (typeCode === 'T4') {
                // Withholding: reported but SUBTRACTED from payable
                totalTaxAmount += amount;
                finalTotal -= amount;
            } else {
                totalTaxAmount += amount;
                finalTotal += amount;
                if (typeCode === 'T2' || typeCode === 'T3') scheduleTaxTotal += amount;
            }
        }
    } else {
        // ── LEGACY PATH: fixed 4-tax mapping (backward compat with old Excel files) ──
        // NOTE: the historical names here are misleading. The actual ETA semantics:
        //   tax_V001 → T1 V001 (standard VAT 14%)
        //   tax_V003 → T1 V003 (zero-rated product)
        //   tax_V009 → T1 V009 (export zero-rated)
        //   tax_W007 → T4 W007 (professional withholding)
        // Prior code mis-mapped tax_V001 as T2 and tax_V003 as T7. We correct that
        // here so legacy Excel submissions generate valid ETA payloads.
        const t1Subs: Array<[keyof InvoiceLineItem, string]> = [
            ['tax_V001', 'V001'],
            ['tax_V003', 'V003'],
            ['tax_V009', 'V009'],
        ];
        for (const [field, sub] of t1Subs) {
            const rate = Number(line[field]) || 0;
            if (rate > 0) {
                const amt = parseFloat((netTotal * (rate / 100)).toFixed(5));
                taxableItems.push({ taxType: 'T1', subType: sub, rate, amount: amt });
                totalTaxAmount += amt;
                finalTotal += amt;
            }
        }
        if (line.tax_W007 && line.tax_W007 > 0) {
            const t4Amount = parseFloat((netTotal * (line.tax_W007 / 100)).toFixed(5));
            taxableItems.push({ taxType: 'T4', subType: 'W007', rate: line.tax_W007, amount: t4Amount });
            totalTaxAmount += t4Amount;
            finalTotal -= t4Amount;
        }
    }

    return {
        ...line,
        salesTotal,
        netTotal,
        taxableItems,
        totalTaxAmount: parseFloat(totalTaxAmount.toFixed(5)),
        total: parseFloat(finalTotal.toFixed(5))
    };
}

/**
 * Calculate complete invoice with all lines
 */
export function calculateInvoice(
    header: InvoiceHeader,
    lines: InvoiceLineItem[]
): CalculatedInvoice {
    // Calculate all lines
    const calculatedLines = lines.map(line => calculateInvoiceLine(line));

    // Sum up totals from all lines
    const totalSalesAmount = calculatedLines.reduce((sum, line) => sum + line.salesTotal, 0);
    const totalDiscountAmount = calculatedLines.reduce(
        (sum, line) => sum + (line.salesTotal - line.netTotal),
        0
    );
    const netAmountBeforeExtraDiscount = calculatedLines.reduce((sum, line) => sum + line.netTotal, 0);

    // Aggregate taxes by type
    const taxMap = new Map<string, number>();
    calculatedLines.forEach(line => {
        line.taxableItems.forEach(tax => {
            const current = taxMap.get(tax.taxType) || 0;
            taxMap.set(tax.taxType, current + tax.amount);
        });
    });

    const taxTotals = Array.from(taxMap.entries()).map(([taxType, amount]) => ({
        taxType,
        amount: parseFloat(amount.toFixed(5))
    }));

    // Calculate total tax amount
    const totalTaxAmount = taxTotals.reduce((sum, tax) => sum + tax.amount, 0);

    // Calculate total BEFORE extra discount (sum of all line totals)
    const totalBeforeExtraDiscount = calculatedLines.reduce((sum, line) => sum + line.total, 0);

    // Apply extra discount AT THE END (after everything including taxes)
    const extraDiscountAmount = header.extraDiscountAmount || 0;
    const totalAmount = totalBeforeExtraDiscount - extraDiscountAmount;

    // Net amount is total sales - line discounts (before taxes and extra discount)
    const netAmount = netAmountBeforeExtraDiscount;

    return {
        header,
        lines: calculatedLines,
        totalSalesAmount: parseFloat(totalSalesAmount.toFixed(5)),
        totalDiscountAmount: parseFloat(totalDiscountAmount.toFixed(5)),
        netAmount: parseFloat(netAmount.toFixed(5)),
        taxTotals,
        extraDiscountAmount: parseFloat(extraDiscountAmount.toFixed(5)),
        totalAmount: parseFloat(totalAmount.toFixed(5))
    };
}

/**
 * Validate invoice data
 */
export function validateInvoice(header: InvoiceHeader, lines: InvoiceLineItem[]): {
    isValid: boolean;
    errors: string[];
} {
    const errors: string[] = [];

    // Validate header
    if (!header.internalId) errors.push('Internal ID is required');
    if (!header.receiverId) errors.push('Receiver ID is required');
    if (!header.receiverName) errors.push('Receiver Name is required');
    if (!header.documentType) errors.push('Document Type is required');
    if (!header.dateTimeIssued) errors.push('Date Time Issued is required');

    // Validate lines
    if (!lines || lines.length === 0) {
        errors.push('Invoice must have at least one line item');
    } else {
        lines.forEach((line, index) => {
            if (!line.description) errors.push(`Line ${index + 1}: Description is required`);
            if (!line.itemCode) errors.push(`Line ${index + 1}: Item Code is required`);
            if (!line.unitType) errors.push(`Line ${index + 1}: Unit Type is required`);
            if (line.quantity <= 0) errors.push(`Line ${index + 1}: Quantity must be greater than 0`);
            if (line.amount < 0) errors.push(`Line ${index + 1}: Amount cannot be negative`);
        });
    }

    return {
        isValid: errors.length === 0,
        errors
    };
}
