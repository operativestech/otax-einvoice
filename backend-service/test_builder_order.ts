import { buildETADocument } from './server/etaBuilder.js';
import { serializeInvoice } from './server/etaSerialization.js';

// Mock Data simulating what the Server passes to the Builder
const calculated = {
    header: {
        documentType: "I",
        documentTypeVersion: "1.0",
        dateTimeIssued: "2023-10-26T12:00:00Z",
        receiverType: "B",
        receiverId: "999999999",
        receiverName: "Receiver Co",
        receiverCountry: "EG",
        receiverGovernate: "Cairo",
        receiverRegionCity: "Nasr City",
        receiverStreet: "Street 1",
        receiverBuildingNumber: "10",
        netAmount: 100,
        totalSalesAmount: 100,
        totalDiscountAmount: 0,
        totalAmount: 114,
        taxTotals: [{ taxType: "T1", amount: 14 }]
    },
    lines: [
        {
            description: "Item 1",
            itemType: "GS1",
            itemCode: "1000",
            unitType: "EA",
            quantity: 1,
            amount: 100,
            salesTotal: 100,
            total: 114,
            netTotal: 100,
            taxableItems: [{ taxType: "T1", amount: 14, subType: "V009", rate: 14 }]
        }
    ]
};

const issuerData = {
    type: "B",
    id: "111111111",
    name: "Issuer Co",
    country: "EG",
    governate: "Cairo",
    regionCity: "Maadi",
    street: "Street 2",
    buildingNumber: "5"
};

// 1. Build the Object using the App's Logic
const doc = buildETADocument(calculated, issuerData);

// 2. Serialize using the App's Logic
const serialized = serializeInvoice(doc);

console.log("--- START CANONICAL STRING ---");
console.log(serialized);
console.log("--- END CANONICAL STRING ---");

// Verification Checks
console.log("\n--- VERIFICATION CHECKS ---");

// Check Issuer Address Order
const issuerPart = serialized.split('"ISSUER"')[1].split('"RECEIVER"')[0];
const addressIndex = issuerPart.indexOf('"ADDRESS"');
const typeIndex = issuerPart.indexOf('"TYPE"');

if (addressIndex < typeIndex) {
    console.log("✅ SUCCESS: Issuer ADDRESS comes BEFORE TYPE (Matches mrkindy/V1.0)");
} else {
    console.log("❌ FAIL: Issuer ADDRESS comes AFTER TYPE");
}

// Check Array Repetition
if (serialized.includes('"INVOICELINES""INVOICELINES"')) {
    console.log("✅ SUCCESS: Array Keys are REPEATED (Matches V1.0)");
} else {
    console.log("❌ FAIL: Array Keys are NOT repeated");
}

// Check Number Formatting
if (serialized.includes('"100"') && !serialized.includes('"100.00000"')) {
    console.log("✅ SUCCESS: Numbers are NATURAL (No trailing zeros)");
} else {
    console.log("❌ FAIL: Numbers have trailing zeros or wrong format");
}
