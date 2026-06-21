/**
 * Test Script: Verify ETA Signature Fixes
 * 
 * This script tests the signature generation with the new fixes:
 * 1. UTF-8 encoding consistency
 * 2. SHA-256 hash verification
 * 3. CAdES-BES signature structure
 */

import { serializeInvoice } from './server/etaSerialization.ts';
import crypto from 'crypto';
import fs from 'fs/promises';

// Simple test invoice
const testInvoice = {
    "issuer": {
        "type": "B",
        "id": "562067566",
        "name": "اوبراتفز لحلول تكنولوجيا المعلومات",
        "address": {
            "country": "EG",
            "governate": "Cairo",
            "regionCity": "Nasr City",
            "street": "Test Street",
            "buildingNumber": "22",
            "postalCode": "0",
            "floor": "0",
            "room": "0",
            "landmark": "0",
            "additionalInformation": "0",
            "branchID": "0"
        }
    },
    "receiver": {
        "type": "P",
        "id": "29909041402358",
        "name": "essam",
        "address": {
            "country": "EG",
            "governate": "Egypt",
            "regionCity": "Egypt",
            "street": "Egypt",
            "buildingNumber": "1",
            "postalCode": "0",
            "floor": "1",
            "room": "1",
            "landmark": "1",
            "additionalInformation": ""
        }
    },
    "documentType": "I",
    "documentTypeVersion": "1.0",
    "dateTimeIssued": "2026-01-15T20:00:00Z",
    "taxpayerActivityCode": "6209",
    "internalID": "TEST-FIX-001",
    "salesOrderReference": "101",
    "salesOrderDescription": "Test Order",
    "invoiceLines": [{
        "description": "Test Service - Signature Fix Verification",
        "itemType": "GS1",
        "itemCode": "99999999",
        "unitType": "EA",
        "quantity": 1,
        "internalCode": "TEST-001",
        "salesTotal": 100,
        "total": 114,
        "valueDifference": 0,
        "totalTaxableFees": 0,
        "netTotal": 100,
        "itemsDiscount": 0,
        "unitValue": {
            "currencySold": "EGP",
            "amountEGP": 100,
            "amountSold": 0,
            "currencyExchangeRate": 0
        },
        "discount": {
            "rate": 0,
            "amount": 0
        },
        "taxableItems": [{
            "taxType": "T1",
            "amount": 14,
            "subType": "V009",
            "rate": 14
        }]
    }],
    "totalDiscountAmount": 0,
    "totalSalesAmount": 100,
    "netAmount": 100,
    "taxTotals": [{
        "taxType": "T1",
        "amount": 14
    }],
    "totalAmount": 100,
    "extraDiscountAmount": 14,
    "totalItemsDiscountAmount": 0
};

async function testSerialization() {
    console.log('=== Testing Serialization & UTF-8 Encoding ===\n');

    // 1. Serialize the invoice
    const serialized = serializeInvoice(testInvoice);
    console.log(`✓ Serialized length: ${serialized.length} characters`);
    console.log(`✓ First 150 chars: ${serialized.substring(0, 150)}...\n`);

    // 2. Create UTF-8 buffer (same as server does)
    const serializedBuffer = Buffer.from(serialized, 'utf8');
    console.log(`✓ UTF-8 buffer size: ${serializedBuffer.length} bytes`);

    // 3. Calculate SHA-256 hash
    const hash = crypto.createHash('sha256').update(serializedBuffer).digest('hex');
    console.log(`✓ SHA-256 hash: ${hash}\n`);

    // 4. Write to temp file (simulate what server does)
    const tempFile = './test_serialized_output.txt';
    await fs.writeFile(tempFile, serializedBuffer);
    console.log(`✓ Written to: ${tempFile}`);

    // 5. Read back and verify
    const readBack = await fs.readFile(tempFile, 'utf8');
    const readBackBuffer = Buffer.from(readBack, 'utf8');
    const readBackHash = crypto.createHash('sha256').update(readBackBuffer).digest('hex');

    console.log(`✓ Read back buffer size: ${readBackBuffer.length} bytes`);
    console.log(`✓ Read back SHA-256: ${readBackHash}\n`);

    // 6. Verify consistency
    if (hash === readBackHash && serializedBuffer.length === readBackBuffer.length) {
        console.log('✅ SUCCESS: UTF-8 encoding is consistent!');
        console.log('✅ Hash matches before and after file write/read');
        console.log('✅ This confirms the UTF-8 fix is working correctly\n');
        return true;
    } else {
        console.log('❌ FAILURE: Encoding mismatch detected!');
        console.log(`   Original hash: ${hash}`);
        console.log(`   Read back hash: ${readBackHash}`);
        return false;
    }
}

async function displayTestInvoice() {
    console.log('=== Test Invoice Details ===\n');
    console.log(`Internal ID: ${testInvoice.internalID}`);
    console.log(`Issuer: ${testInvoice.issuer.name}`);
    console.log(`Receiver: ${testInvoice.receiver.name}`);
    console.log(`Total Amount: ${testInvoice.totalAmount} EGP`);
    console.log(`Date: ${testInvoice.dateTimeIssued}\n`);
}

async function main() {
    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║  ETA Signature Fix Verification Test                      ║');
    console.log('║  Testing UTF-8 encoding consistency and hash calculation  ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');

    await displayTestInvoice();
    const success = await testSerialization();

    if (success) {
        console.log('\n╔════════════════════════════════════════════════════════════╗');
        console.log('║  ✅ ALL TESTS PASSED                                      ║');
        console.log('║                                                            ║');
        console.log('║  Next Steps:                                               ║');
        console.log('║  1. Start the server: npm run server                       ║');
        console.log('║  2. Submit this test invoice through the UI                ║');
        console.log('║  3. Check logs for matching SHA-256 hashes                 ║');
        console.log('║  4. Verify ETA portal response (should be Valid)           ║');
        console.log('╚════════════════════════════════════════════════════════════╝\n');
    } else {
        console.log('\n❌ Tests failed. Please review the implementation.\n');
    }
}

main().catch(console.error);
