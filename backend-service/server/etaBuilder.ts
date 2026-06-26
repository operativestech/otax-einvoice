export function buildETADocument(calculated: any, issuerData: any): any {
    const toStr = (val: any): string => (val === null || val === undefined) ? "" : String(val);
    const num = (val: any): number => {
        const n = parseFloat(val);
        return isNaN(n) ? 0 : n;
    };

    const formatETADate = (dateInput: any): string => {
        const date = new Date(dateInput);
        return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}T${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}:${String(date.getUTCSeconds()).padStart(2, '0')}Z`;
    };

    const normalizeType = (type: string): string => {
        const t = toStr(type).toUpperCase();
        if (t.startsWith('B')) return 'B';
        if (t.startsWith('P')) return 'P';
        if (t.startsWith('F')) return 'F';
        return 'B';
    };

    const normalizeCountryCode = (countryInput: any, defaultVal: string = 'EG'): string => {
        const c = toStr(countryInput).trim().toUpperCase();
        if (!c) return defaultVal;
        if (c === 'EGYPT' || c === 'مصر' || c === 'EGPT' || c === 'EG_') return 'EG';
        if (c === 'UNITED STATES' || c === 'USA' || c === 'US') return 'US';
        if (c === 'SAUDI ARABIA' || c === 'SAUDI' || c === 'SA') return 'SA';
        if (c === 'UNITED ARAB EMIRATES' || c === 'UAE' || c === 'AE') return 'AE';
        if (c.length === 2) return c;
        if (c === 'EGY') return 'EG';
        if (c === 'USA') return 'US';
        if (c === 'ARE') return 'AE';
        if (c === 'SAU') return 'SA';
        if (c.startsWith('EG')) return 'EG';
        return c.length > 2 ? c.substring(0, 2) : defaultVal;
    };

    // CRITICAL: Property order MUST match mrkindy/EgyptianEInvoice exactly for the hash to match
    const doc: any = {
        issuer: {
            address: {
                country: normalizeCountryCode(issuerData.country || "EG"),
                governate: toStr(issuerData.governate || ""),
                regionCity: toStr(issuerData.regionCity || ""),
                street: toStr(issuerData.street || ""),
                buildingNumber: toStr(issuerData.buildingNumber || ""),
                postalCode: toStr(issuerData.postalCode || ""),
                floor: toStr(issuerData.floor || ""),
                room: toStr(issuerData.room || ""),
                landmark: toStr(issuerData.landmark || ""),
                additionalInformation: toStr(issuerData.additionalInformation || ""),
                branchID: toStr(issuerData.branchID || "0")
            },
            type: normalizeType(issuerData.type),
            id: toStr(issuerData.id),
            name: toStr(issuerData.name)
        },
        receiver: {
            address: {
                country: normalizeCountryCode(calculated.header.receiverCountry || "EG"),
                governate: toStr(calculated.header.receiverGovernate || ""),
                regionCity: toStr(calculated.header.receiverRegionCity || ""),
                street: toStr(calculated.header.receiverStreet || ""),
                buildingNumber: toStr(calculated.header.receiverBuildingNumber || ""),
                postalCode: toStr(calculated.header.receiverPostalCode || ""),
                floor: toStr(calculated.header.receiverFloor || ""),
                room: toStr(calculated.header.receiverRoom || ""),
                landmark: toStr(calculated.header.receiverLandmark || ""),
                additionalInformation: toStr(calculated.header.receiverAdditionalInformation || "")
            },
            type: normalizeType(calculated.header.receiverType),
            id: toStr(calculated.header.receiverId),
            name: toStr(calculated.header.receiverName)
        },
        documentType: toStr(calculated.header.documentType),
        documentTypeVersion: toStr(calculated.header.documentTypeVersion || "1.0"),
        invoiceLines: (calculated.lines || []).map((line: any) => ({
            description: toStr(line.description),
            itemType: toStr(line.itemType),
            itemCode: toStr(line.itemCode),
            unitType: toStr(line.unitType || "EA"),
            quantity: num(line.quantity),
            internalCode: toStr(line.itemInternalCode || ""),
            salesTotal: num(line.salesTotal),
            total: num(line.total),
            valueDifference: num(line.valueDifference || 0),
            totalTaxableFees: num(line.totalTaxableFees || 0),
            netTotal: num(line.netTotal),
            itemsDiscount: num(line.itemsDiscount || 0),
            unitValue: {
                currencySold: toStr(line.currencySold || "EGP"),
                amountEGP: num(line.amount),
                amountSold: line.currencySold !== 'EGP' ? num(line.amount / (line.currencyExchangeRate || 1)) : 0,
                currencyExchangeRate: num(line.currencyExchangeRate || 0)
            },
            discount: {
                rate: num(line.disRate || 0),
                amount: num(line.disAmount || 0)
            },
            taxableItems: (line.taxableItems || []).map((tax: any) => ({
                taxType: toStr(tax.taxType),
                amount: num(tax.amount),
                subType: toStr(tax.subType),
                rate: num(tax.rate)
            }))
        })),
        dateTimeIssued: formatETADate(calculated.header.dateTimeIssued),
        // Prefer an explicit taxpayer activity code from the invoice header
        // (allows per-invoice override), fall back to the org's default issuer code.
        taxpayerActivityCode: toStr(calculated.header.taxpayerActivityCode || issuerData.activityCode || "0000"),
        internalID: toStr(calculated.header.internalId),
        // Required for Export documents (EI/ED/EC) per ETA spec. Date-only (YYYY-MM-DD).
        ...(calculated.header.serviceDeliveryDate ? { serviceDeliveryDate: toStr(calculated.header.serviceDeliveryDate) } : {}),
        // Required for Debit/Credit notes (D/C/ED/EC) — UUIDs of the original
        // invoice(s) being adjusted. ETA rejects these doctypes without references.
        ...(Array.isArray(calculated.header.references) && calculated.header.references.length > 0
            ? { references: calculated.header.references.map((r: any) => toStr(r)).filter(Boolean) }
            : {}),
        // Optional fields added only if they have values to preserve order
        ...(calculated.header.purchaseOrderReference ? { purchaseOrderReference: toStr(calculated.header.purchaseOrderReference) } : {}),
        ...(calculated.header.purchaseOrderDescription ? { purchaseOrderDescription: toStr(calculated.header.purchaseOrderDescription) } : {}),
        ...(calculated.header.salesOrderReference ? { salesOrderReference: toStr(calculated.header.salesOrderReference) } : {}),
        ...(calculated.header.salesOrderDescription ? { salesOrderDescription: toStr(calculated.header.salesOrderDescription) } : {}),
        ...(calculated.header.proformaInvoiceNumber ? { proformaInvoiceNumber: toStr(calculated.header.proformaInvoiceNumber) } : {}),

        // Payment block — optional per ETA spec, included only when any field
        // is present. Property order matches the Postman sample so document
        // hashes stay stable for signing.
        ...((calculated.header.paymentBankName || calculated.header.paymentBankAddress
            || calculated.header.paymentBankAccountNo || calculated.header.paymentBankAccountIban
            || calculated.header.paymentSwiftCode || calculated.header.paymentTerms) ? {
            payment: {
                bankName:        toStr(calculated.header.paymentBankName        || ''),
                bankAddress:     toStr(calculated.header.paymentBankAddress     || ''),
                bankAccountNo:   toStr(calculated.header.paymentBankAccountNo   || ''),
                bankAccountIBAN: toStr(calculated.header.paymentBankAccountIban || ''),
                swiftCode:       toStr(calculated.header.paymentSwiftCode       || ''),
                terms:           toStr(calculated.header.paymentTerms           || ''),
            }
        } : {}),

        // Delivery block — optional, same conditional-emit strategy. Numeric
        // fields default to 0 (not ''), matching the ETA JSON schema.
        ...((calculated.header.deliveryApproach || calculated.header.deliveryPackaging
            || calculated.header.deliveryDateValidity || calculated.header.deliveryExportPort
            || calculated.header.deliveryCountryOfOrigin || calculated.header.deliveryGrossWeight
            || calculated.header.deliveryNetWeight || calculated.header.deliveryTerms) ? {
            delivery: {
                approach:        toStr(calculated.header.deliveryApproach        || ''),
                packaging:       toStr(calculated.header.deliveryPackaging       || ''),
                dateValidity:    toStr(calculated.header.deliveryDateValidity    || ''),
                exportPort:      toStr(calculated.header.deliveryExportPort      || ''),
                countryOfOrigin: normalizeCountryCode(calculated.header.deliveryCountryOfOrigin || '', ''),
                grossWeight:     num(calculated.header.deliveryGrossWeight),
                netWeight:       num(calculated.header.deliveryNetWeight),
                terms:           toStr(calculated.header.deliveryTerms           || ''),
            }
        } : {}),

        totalDiscountAmount: num(calculated.totalDiscountAmount),
        totalSalesAmount: num(calculated.totalSalesAmount),
        netAmount: num(calculated.netAmount),
        taxTotals: (calculated.taxTotals || []).map((tax: any) => ({
            taxType: toStr(tax.taxType),
            amount: num(tax.amount)
        })),
        totalAmount: num(calculated.totalAmount),
        extraDiscountAmount: num(calculated.extraDiscountAmount || 0),
        totalItemsDiscountAmount: num(calculated.totalItemsDiscountAmount || 0)
    };

    return doc;
}
