/**
 * Test script to verify XML generation and signature process
 */

import { buildXMLFromJSON, canonicalizeXML } from './xmlBuilder.js';
import { serializeETA } from './etaSerialization.js';
import fs from 'fs/promises';

async function testXMLGeneration() {
    console.log('=== Testing XML Generation ===\n');

    // Load the valid invoice JSON for comparison
    const validInvoice = JSON.parse(await fs.readFile('./invoices/valid.json', 'utf8'));

    // Extract the document field (it's XML in the valid one)
    console.log('Valid invoice document type:', typeof validInvoice.document);
    console.log('Valid invoice document starts with:', validInvoice.document.substring(0, 100));

    // Create a test invoice object (without signatures first)
    const testInvoice = {
        issuer: {
            type: "B",
            id: "562067566",
            name: "اوبراتفزلحلولتكنولوجياالمعلومات",
            address: {
                buildingNumber: "22",
                room: "0",
                floor: "0",
                street: "البرجالشمالى-ابراجالنايلسيتى-كورنيشالنيلالساحل,",
                landmark: "0",
                additionalInformation: "0",
                governate: "Cairo",
                regionCity: "0",
                postalCode: "0",
                country: "EG",
                branchID: "0"
            }
        },
        receiver: {
            type: "P",
            id: "29909041402358",
            name: "essam",
            address: {
                buildingNumber: "1",
                room: "1",
                floor: "1",
                street: "Egypt",
                landmark: "1",
                additionalInformation: "",
                governate: "Egypt",
                regionCity: "Egypt",
                postalCode: "0",
                country: "EG"
            }
        },
        documentType: "I",
        documentTypeVersion: "1.0",
        dateTimeIssued: "2026-01-06T00:00:00Z",
        taxpayerActivityCode: "6209",
        internalID: "test-001",
        purchaseOrderReference: "",
        purchaseOrderDescription: "",
        salesOrderReference: "101",
        salesOrderDescription: "101",
        proformaInvoiceNumber: "",
        payment: {
            bankName: "",
            bankAddress: "",
            bankAccountNo: "",
            bankAccountIBAN: "",
            swiftCode: "",
            terms: ""
        },
        delivery: {
            approach: "",
            packaging: "",
            exportPort: "",
            countryOfOrigin: "",
            grossWeight: 1,
            netWeight: 1,
            terms: ""
        },
        invoiceLines: [
            {
                description: "Support for one legal entity",
                itemType: "GS1",
                itemCode: "99999999",
                unitType: "EA",
                quantity: 1,
                unitValue: {
                    currencySold: "EGP",
                    amountSold: 0,
                    amountEGP: 100,
                    currencyExchangeRate: 0
                },
                salesTotal: 100,
                discount: {
                    rate: 0,
                    amount: 0
                },
                taxableItems: [
                    {
                        taxType: "T1",
                        amount: 14,
                        subType: "V009",
                        rate: 14
                    }
                ],
                internalCode: "Techsupport",
                itemsDiscount: 0,
                netTotal: 100,
                totalTaxableFees: 0,
                valueDifference: 0,
                total: 114
            }
        ],
        totalSalesAmount: 100,
        totalDiscountAmount: 0,
        netAmount: 100,
        taxTotals: [
            {
                taxType: "T1",
                amount: 14
            }
        ],
        totalAmount: 114,
        totalItemsDiscountAmount: 0,
        extraDiscountAmount: 0
    };

    console.log('\n=== Generating XML ===');
    const xml = buildXMLFromJSON(testInvoice);
    console.log('Generated XML (first 500 chars):');
    console.log(xml.substring(0, 500));

    console.log('\n=== Canonicalizing XML ===');
    const canonical = canonicalizeXML(xml);
    console.log('Canonical XML (first 500 chars):');
    console.log(canonical.substring(0, 500));

    console.log('\n=== Testing serializeETA ===');
    const serialized = serializeETA(testInvoice);
    console.log('Serialized (first 500 chars):');
    console.log(serialized.substring(0, 500));

    console.log('\n=== Comparison ===');
    console.log('XML length:', xml.length);
    console.log('Canonical length:', canonical.length);
    console.log('Serialized length:', serialized.length);

    // Save outputs for inspection
    await fs.writeFile('./test_output_xml.txt', xml, 'utf8');
    await fs.writeFile('./test_output_canonical.txt', canonical, 'utf8');
    await fs.writeFile('./test_output_serialized.txt', serialized, 'utf8');

    console.log('\n✓ Test outputs saved to test_output_*.txt files');
}

testXMLGeneration().catch(console.error);
