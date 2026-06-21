import { serialize, serializeInvoice } from './server/etaSerialization.js';

// Test case 1: Simple object
const obj1 = {
    name: "Test",
    value: 100
};

console.log("=== TEST 1: Simple Object ===");
console.log(serialize(obj1));
console.log("Expected: \"NAME\"\"Test\"\"VALUE\"\"100\"");
console.log("");

// Test case 2: Object with array
const obj2 = {
    items: [
        { id: 1, name: "Item1" },
        { id: 2, name: "Item2" }
    ]
};

console.log("=== TEST 2: Array of Objects ===");
console.log(serialize(obj2));
console.log("Expected (PHP logic): \"ITEMS\"\"ITEMS\"{...}\"ITEMS\"{...}");
console.log("");

// Test case 3: Nested object
const obj3 = {
    issuer: {
        type: "B",
        id: "123",
        address: {
            street: "Main St",
            city: "Cairo"
        }
    }
};

console.log("=== TEST 3: Nested Object ===");
const result3 = serialize(obj3);
console.log(result3);
console.log("");

// Test case 4: Check if ADDRESS comes before TYPE
const issuerPart = result3.split('"ISSUER"')[1];
const addressIdx = issuerPart.indexOf('"ADDRESS"');
const typeIdx = issuerPart.indexOf('"TYPE"');
console.log(`ADDRESS index: ${addressIdx}, TYPE index: ${typeIdx}`);
console.log(addressIdx < typeIdx ? "✅ ADDRESS before TYPE" : "❌ TYPE before ADDRESS");
