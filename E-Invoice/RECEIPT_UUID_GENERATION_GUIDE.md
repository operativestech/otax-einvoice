# Receipt UUID Generation Guide

## Overview

Receipt UUID is a **unique key on system level** that is generated based on receipt content according to the Egyptian Tax Authority (ETA) receipt base schema. This document explains the complete procedure for generating a valid receipt UUID.

---

## UUID Generation Procedure

### Step-by-Step Process

1. **Include All Key Fields**
   - Ensure the receipt object includes ALL required fields
   - **CRITICAL**: Include the UUID of the previous receipt issued by the same POS device
   - This creates a chain of receipts for audit trail purposes

2. **Handle Return Receipts**
   - If `receiptType` is "return", you MUST include `referenceUUID`
   - The `referenceUUID` should point to the original receipt being returned

3. **Empty UUID Field**
   - The receipt object must have an **empty** or **null** UUID field during generation
   - The UUID will be calculated and then populated

4. **Serialize and Normalize**
   - Serialize the receipt object using ETA's serialization algorithm
   - Flatten all properties into a single-line text string
   - Follow the exact serialization rules (see below)

5. **Create SHA256 Hash**
   - Hash the normalized text using SHA256 algorithm
   - This produces an array of 32 bytes

6. **Convert to Hexadecimal**
   - Convert the 32-byte hash to a hexadecimal string
   - Result: 64-character hexadecimal string

7. **Use as Receipt UUID**
   - The 64-character hex string becomes the receipt UUID
   - Update the receipt object with this UUID

---

## Document Serialization Algorithm

### Key Principles

The ETA serialization approach ensures that:
- Network transfer doesn't affect the hash
- JSON/XML differences don't change the signature
- Only significant data (field names and values) is used
- Different platforms produce identical results

### Serialization Rules for JSON

1. **Process Recursively**
   - Start from the root element of the document
   - For eReceipt: Receipts are grouped into batches
   - Serialization applies to the **entire batch**
   - Only JSON format is supported for receipts

2. **Property Name Conversion**
   - Convert ALL property names to **culture-invariant UPPERCASE**
   - Example: `"receiptNumber"` → `"RECEIPTNUMBER"`

3. **Property Value Preservation**
   - Take values **exactly as they appear** in the input
   - DO NOT modify formatting
   - Example: `0.0` stays as `"0.0"` (NOT `"0"` or `"0.00"`)

4. **Quoting Rules**
   - Enclose property names in double quotes `"`
   - Enclose simple type values in double quotes `"`
   - Objects are NOT quoted (only their contents)

5. **Array Handling (JSON-Specific)**
   - Prefix entire array with the array property name
   - Prefix EACH array element with the array property name
   - Example for `taxableItems` array:
     ```
     "TAXABLEITEMS""TAXABLEITEMS"<item1>"TAXABLEITEMS"<item2>...
     ```

6. **Quote Escaping**
   - In JSON, double quotes in values are already escaped as `\"`
   - No additional escaping needed

---

## Pseudo Code Implementation

### JSON Serialization Function

```javascript
function Serialize(documentStructure) {
    // Base case: simple value
    if (documentStructure is simple value type) {
        return '"' + documentStructure.value + '"'
    }

    var serializedString = ""
    
    foreach element in the structure:
        
        // Handle non-array elements
        if (element is not array type) {
            serializeString.Append('"' + element.name.uppercase + '"')
            serializeString.Append(Serialize(element.value))
        }

        // Handle array elements
        if (element is of array type) {
            // Prefix with array name
            serializeString.Append('"' + element.name.uppercase + '"')
            
            foreach arrayElement in element:
                // JSON: Each element is also prefixed with array name
                serializeString.Append('"' + element.name.uppercase + '"')
                serializeString.Append(Serialize(arrayElement.value))
            end foreach
        }

    end foreach

    return serializedString
}
```

---

## TypeScript Implementation

### Complete Receipt UUID Generator

```typescript
import crypto from 'crypto';

/**
 * Serialize receipt object according to ETA JSON serialization rules
 */
function serializeReceipt(obj: any): string {
    // Simple value - return quoted
    if (obj === null || obj === undefined) {
        return '';
    }
    
    if (typeof obj !== 'object') {
        return `"${String(obj)}"`;
    }
    
    let serialized = '';
    
    // Process all keys in order (DO NOT SORT - maintain schema order)
    const keys = Object.keys(obj);
    
    for (const key of keys) {
        const value = obj[key];
        
        // Skip null, undefined, empty strings, and empty arrays
        if (value === null || value === undefined || value === '' || 
            (Array.isArray(value) && value.length === 0)) {
            continue;
        }
        
        const upperKey = `"${key.toUpperCase()}"`;
        
        if (Array.isArray(value)) {
            // Array: prefix with array name
            serialized += upperKey;
            
            // Each element is also prefixed with array name (JSON rule)
            for (const item of value) {
                serialized += upperKey;
                if (typeof item === 'object' && item !== null) {
                    serialized += serializeReceipt(item);
                } else {
                    serialized += `"${String(item)}"`;
                }
            }
        } else if (value instanceof Date) {
            // Dates: ISO format without milliseconds
            serialized += upperKey;
            serialized += `"${value.toISOString().replace(/\.\d{3}Z$/, 'Z')}"`;
        } else if (typeof value === 'object') {
            // Nested object
            serialized += upperKey;
            serialized += serializeReceipt(value);
        } else {
            // Simple value - preserve exact format
            serialized += upperKey;
            serialized += `"${String(value)}"`;
        }
    }
    
    return serialized;
}

/**
 * Generate receipt UUID from receipt object
 */
export function generateReceiptUUID(receipt: any): string {
    // Step 1: Ensure receipt has empty UUID
    const receiptCopy = { ...receipt, uuid: '' };
    
    // Step 2: Serialize and normalize
    const serialized = serializeReceipt(receiptCopy);
    
    // Step 3: Create SHA256 hash
    const hash = crypto.createHash('sha256');
    hash.update(serialized, 'utf8');
    
    // Step 4: Convert to hexadecimal (64 characters)
    const uuid = hash.digest('hex');
    
    return uuid;
}

/**
 * Validate and prepare receipt for UUID generation
 */
export function prepareReceiptForUUID(receipt: any, previousReceiptUUID?: string): any {
    // Ensure all required fields are present
    const preparedReceipt = { ...receipt };
    
    // Include previous receipt UUID if provided
    if (previousReceiptUUID) {
        preparedReceipt.previousReceiptUUID = previousReceiptUUID;
    }
    
    // For return receipts, ensure referenceUUID is present
    if (receipt.receiptType === 'return' && !receipt.referenceUUID) {
        throw new Error('Return receipts must include referenceUUID');
    }
    
    // Generate and set UUID
    const uuid = generateReceiptUUID(preparedReceipt);
    preparedReceipt.uuid = uuid;
    
    return preparedReceipt;
}
```

---

## Usage Example

### Basic Receipt

```typescript
// Sample receipt object
const receipt = {
    header: {
        dateTimeIssued: '2026-01-13T21:45:18Z',
        receiptNumber: 'RCP-001',
        uuid: '', // Empty during generation
        previousReceiptUUID: 'abc123...', // UUID of previous receipt from same POS
        currency: 'EGP',
        exchangeRate: 1.0
    },
    documentType: {
        receiptType: 'sale',
        typeVersion: '1.0'
    },
    seller: {
        rin: '123456789',
        companyTradeName: 'My Store',
        branchCode: '0',
        branchAddress: {
            country: 'EG',
            governate: 'Cairo',
            regionCity: 'Nasr City',
            street: 'Main St',
            buildingNumber: '123'
        },
        deviceSerialNumber: 'POS-001',
        activityCode: '1234'
    },
    buyer: {
        type: 'P',
        id: '12345678901234',
        name: 'Customer Name'
    },
    itemData: [
        {
            internalCode: 'ITEM-001',
            description: 'Product 1',
            itemType: 'GS1',
            itemCode: '1234567890123',
            unitType: 'EA',
            quantity: 2.0,
            unitPrice: 100.0,
            netSale: 200.0,
            totalSale: 200.0,
            total: 200.0
        }
    ],
    totalSales: 200.0,
    totalCommercialDiscount: 0.0,
    netAmount: 200.0,
    feesAmount: 0.0,
    totalAmount: 200.0,
    taxTotals: [
        {
            taxType: 'T1',
            amount: 0.0
        }
    ],
    paymentMethod: 'C',
    adjustment: 0.0
};

// Generate UUID
const receiptWithUUID = prepareReceiptForUUID(receipt, 'previous-uuid-here');
console.log('Generated UUID:', receiptWithUUID.uuid);
```

### Return Receipt

```typescript
const returnReceipt = {
    header: {
        dateTimeIssued: '2026-01-13T22:00:00Z',
        receiptNumber: 'RCP-002',
        uuid: '',
        previousReceiptUUID: receiptWithUUID.uuid, // Chain to previous receipt
        currency: 'EGP',
        exchangeRate: 1.0
    },
    documentType: {
        receiptType: 'return', // Return type
        typeVersion: '1.0'
    },
    referenceUUID: receiptWithUUID.uuid, // REQUIRED for returns
    // ... rest of receipt data
};

const returnReceiptWithUUID = prepareReceiptForUUID(returnReceipt);
```

---

## Important Notes

### Critical Requirements

1. **Empty UUID During Generation**
   - The UUID field MUST be empty/null when calculating the hash
   - After generation, populate the UUID field with the calculated value

2. **Previous Receipt Chain**
   - Each receipt must reference the previous receipt from the same POS
   - This creates an unbreakable audit chain
   - First receipt from a POS can have null/empty previousReceiptUUID

3. **Return Receipt Reference**
   - Return receipts MUST include `referenceUUID`
   - Points to the original receipt being returned
   - Enables tracking of return transactions

4. **Value Preservation**
   - Never modify numeric formats (0.0 stays 0.0, not 0)
   - Preserve exact string values
   - Maintain date format precision

5. **Batch Processing**
   - Receipts are submitted in batches
   - Each batch is one submission
   - Serialization applies to the entire batch

6. **JSON Only**
   - eReceipt system uses JSON format only
   - XML is not supported for receipts (only for invoices)

### Common Pitfalls to Avoid

❌ **DON'T:**
- Sort object keys alphabetically
- Modify numeric value formats
- Skip the previousReceiptUUID field
- Forget referenceUUID for returns
- Include UUID in the serialization

✅ **DO:**
- Maintain schema order of fields
- Preserve exact value formats
- Include previous receipt UUID
- Set UUID to empty before hashing
- Follow array naming rules exactly

---

## Testing Your Implementation

### Validation Steps

1. **Create Test Receipt**
   - Use a known receipt structure
   - Set UUID to empty

2. **Serialize**
   - Apply serialization algorithm
   - Verify output format matches ETA rules

3. **Generate Hash**
   - Create SHA256 hash of serialized string
   - Convert to 64-character hex string

4. **Verify**
   - UUID should be exactly 64 characters
   - Should be consistent for same input
   - Different receipts should produce different UUIDs

### Example Test

```typescript
// Test serialization consistency
const testReceipt = { /* ... */ };
const uuid1 = generateReceiptUUID(testReceipt);
const uuid2 = generateReceiptUUID(testReceipt);

console.assert(uuid1 === uuid2, 'UUIDs should be identical for same input');
console.assert(uuid1.length === 64, 'UUID should be 64 characters');
console.assert(/^[a-f0-9]{64}$/.test(uuid1), 'UUID should be lowercase hex');
```

---

## References

- [ETA Document Serialization Approach](https://sdk.invoicing.eta.gov.eg/document-serialization-approach/)
- [Egyptian eInvoicing SDK](https://sdk.invoicing.eta.gov.eg/files/Egyptian%20eInvoicing%20SDK.postman_collection.json)
- ETA eReceipt Base Schema Documentation

---

## Integration with Existing Code

Your existing `etaSerialization.ts` file contains the serialization logic for **invoices** (XML-based). For **receipts**, you'll need to:

1. Create a new file: `receiptSerialization.ts`
2. Implement the JSON serialization (not XML)
3. Use the `generateReceiptUUID()` function
4. Integrate with your receipt submission workflow

The key difference:
- **Invoices**: Use XML canonicalization (`serializeETA()`)
- **Receipts**: Use JSON serialization (`serializeReceipt()`)

---

*Last Updated: 2026-01-13*
