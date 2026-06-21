# ETA "Invalid Structured Submission" Troubleshooting

## ✅ GREAT PROGRESS!

You've moved from validation errors to ETA submission! This means:
- ✅ Issuer data is configured correctly
- ✅ Receiver data is in the Excel correctly
- ✅ Document is being built and signed
- ✅ Document is being sent to ETA

## ❌ Current Issue: "Invalid structured submission"

This error from ETA means the document structure has an issue. Common causes:

### 1. **Missing Required Fields**
ETA requires certain fields that might be missing or empty:
- `issuer.address.branchID` - Must be "0" or valid branch ID
- `receiver.address.country` - Must be valid country code (e.g., "EG")
- `documentTypeVersion` - Must be "1.0" or "0.9"
- `taxpayerActivityCode` - Must be 4 digits (e.g., "0000")

### 2. **Wrong Field Types**
- Numbers sent as strings (or vice versa)
- Dates in wrong format (must be ISO: `2026-01-06T00:00:00Z`)
- Boolean values as strings

### 3. **Invalid Values**
- Empty strings where not allowed
- "0" in fields that don't accept it
- Negative values where not allowed

### 4. **Missing Nested Objects**
- `unitValue` object must have all required fields
- `taxableItems` array must not be empty
- Each tax item must have required fields

## 🔍 Debug Steps

### Step 1: Check Console Output

Look for this in your server console:

```
[DOC PRE-SIGN] inv-043 JSON preview: {...
```

This shows the EXACT document being sent to ETA. **Please share this output!**

### Step 2: Check These Specific Fields

The document should have:

```json
{
  "issuer": {
    "type": "B",
    "id": "123456789",  // ← Must be 9 digits
    "name": "Your Company",
    "address": {
      "branchID": "0",  // ← Required!
      "country": "EG",
      "governate": "Cairo",
      "regionCity": "0",  // ← Can be "0"
      "street": "Your Street",
      "buildingNumber": "0",
      "postalCode": "0",
      "floor": "0",
      "room": "0",
      "landmark": "0",
      "additionalInformation": "0"
    }
  },
  "receiver": {
    "type": "B",
    "id": "213456789",  // ← Must be 9 digits
    "name": "Customer Name",
    "address": {
      "country": "EG",  // ← Required!
      "governate": "Cairo",
      "regionCity": "0",
      "street": "Street",
      "buildingNumber": "0",
      "postalCode": "0",
      "floor": "0",
      "room": "0",
      "landmark": "0",
      "additionalInformation": "0"
    }
  },
  "documentType": "I",
  "documentTypeVersion": "1.0",  // ← Required!
  "dateTimeIssued": "2026-01-06T00:00:00Z",  // ← Must be ISO format
  "taxpayerActivityCode": "0000",  // ← Required! 4 digits
  "internalID": "inv-043",
  "invoiceLines": [
    {
      "description": "Item description",
      "itemType": "GS1",
      "itemCode": "9999999",
      "unitType": "EA",
      "quantity": 1,
      "unitValue": {
        "currencySold": "EGP",
        "amountEGP": 100.00,
        "amountSold": 0,  // ← 0 if currency is EGP
        "currencyExchangeRate": 0  // ← 0 if currency is EGP
      },
      "salesTotal": 100.00,
      "discount": {
        "rate": 0,
        "amount": 0
      },
      "taxableItems": [  // ← Must not be empty!
        {
          "taxType": "T1",
          "amount": 14.00,
          "subType": "V009",
          "rate": 14
        }
      ],
      "netTotal": 100.00,
      "total": 114.00
    }
  ],
  "totalSalesAmount": 100.00,
  "totalDiscountAmount": 0,
  "netAmount": 100.00,
  "taxTotals": [  // ← Must match taxableItems
    {
      "taxType": "T1",
      "amount": 14.00
    }
  ],
  "totalAmount": 114.00,
  "extraDiscountAmount": 0,
  "totalItemsDiscountAmount": 0,
  "signatures": [  // ← Added by signing
    {
      "signatureType": "I",
      "value": "base64signature..."
    }
  ]
}
```

### Step 3: Common Issues to Check

#### Issue: Tax Registration Number Format
```
❌ "id": "0"           // Empty/default value
❌ "id": "12345"       // Too short
✅ "id": "123456789"   // Correct: 9 digits
```

#### Issue: Date Format
```
❌ "dateTimeIssued": "2026-01-06"                    // Missing time
❌ "dateTimeIssued": "2026-01-06T00:00:00.000Z"      // Has milliseconds
✅ "dateTimeIssued": "2026-01-06T00:00:00Z"          // Correct
```

#### Issue: Tax Items
```
❌ "taxableItems": []                    // Empty array
✅ "taxableItems": [{ ... }]             // At least one item
```

#### Issue: Unit Value
```
❌ "unitValue": { "amountEGP": 100 }     // Missing other fields
✅ "unitValue": {
     "currencySold": "EGP",
     "amountEGP": 100.00,
     "amountSold": 0,
     "currencyExchangeRate": 0
   }
```

## 🎯 Next Steps

1. **Share the console output** - Look for `[DOC PRE-SIGN]` in your server console
2. **Check the debug_steps.txt file** - It might have the full document JSON
3. **Restart the server** if you haven't already (to get the latest fix)

## 📝 What Changed

I just fixed the `signInvoice` function to return JSON instead of XML wrapper. Now the payload sent to ETA is:

```json
{
  "documents": [
    {
      "issuer": { ... },
      "receiver": { ... },
      ...
      "signatures": [ ... ]
    }
  ]
}
```

Instead of the wrong format:
```json
{
  "documents": [
    {
      "document": "<xml>...</xml>"  // ❌ Wrong!
    }
  ]
}
```

## 🔄 Action Required

**Please restart the server and try again**, then share the console output showing the `[DOC PRE-SIGN]` log!

---

**Status**: Waiting for console output to diagnose the specific structural issue
