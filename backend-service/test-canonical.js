import { serializeETA } from './server/etaSerialization.js';

// Test with a simple object matching the ETA structure
const testDoc = {
    issuer: {
        type: "B",
        id: "562067566",
        name: "Test Company"
    },
    taxableItems: [
        {
            taxType: "T1",
            amount: 14,
            subType: "V009",
            rate: 14
        }
    ]
};

console.log("Serialized output:");
console.log(serializeETA(testDoc));
