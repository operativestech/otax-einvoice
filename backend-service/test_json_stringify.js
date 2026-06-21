// Test to verify JSON.stringify behavior with Arabic text

const testObj = {
    name: "اوبراتفز لحلول تكنولوجيا المعلومات",
    value: 100
};

const stringified = JSON.stringify(testObj);

console.log("=== JSON.stringify() Test ===");
console.log("Original object:", testObj);
console.log("");
console.log("Stringified:");
console.log(stringified);
console.log("");
console.log("Length:", stringified.length);
console.log("");
console.log("Contains \\u escapes:", stringified.includes('\\u') ? "YES (BAD)" : "NO (GOOD)");
console.log("");
console.log("First 100 chars:");
console.log(stringified.substring(0, 100));
console.log("");

// Test what Buffer sees
const buffer = Buffer.from(stringified, 'utf8');
console.log("Buffer length:", buffer.length);
console.log("Buffer (first 50 bytes):", buffer.slice(0, 50).toString('hex'));
