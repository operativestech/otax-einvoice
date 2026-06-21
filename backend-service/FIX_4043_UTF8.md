# Critical Fix for 4043 Error - JSON_UNESCAPED_UNICODE

## Root Cause Found

The mrkindy repository commit 012e77f reveals the issue:

**When sending JSON to ETA API, Arabic characters MUST be sent as UTF-8, NOT escaped as \\uXXXX**

The PHP fix:
```php
$options['body'] = json_encode(json_decode($json), JSON_UNESCAPED_UNICODE);
```

## The Problem in Your Code

When you use `axios.post(url, jsonObject)`, axios will:
1. Call `JSON.stringify(jsonObject)` 
2. By default, escape Unicode characters as `\\uXXXX`

This means:
- Your local hash is calculated on: `"اوبراتفزلحلولتكنولوجياالمعلومات"`
- But ETA receives: `"\\u0627\\u0648\\u0628\\u0631\\u0627\\u062a\\u0641\\u0632..."`
- ETA calculates hash on the RECEIVED string (with escapes)
- **Hashes don't match → 4043 error**

## The Solution

You need to send the JSON as a **string** with proper UTF-8 encoding, not let axios serialize it.

### Option 1: Use transformRequest (Recommended)

```typescript
const etaResponse = await axios.post(
    `${hosts.api}/api/v1.0/documentsubmissions`,
    { documents: [signedInvoiceJson] },
    {
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json; charset=utf-8'
        },
        transformRequest: [(data) => {
            // Manually stringify with proper UTF-8 encoding
            return JSON.stringify(data);
        }]
    }
);
```

### Option 2: Send as String Directly

```typescript
const jsonString = JSON.stringify({ documents: [signedInvoiceJson] });
const etaResponse = await axios.post(
    `${hosts.api}/api/v1.0/documentsubmissions`,
    jsonString,
    {
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json; charset=utf-8'
        }
    }
);
```

## Verification

After applying the fix:
1. The JSON sent to ETA will contain raw UTF-8 Arabic characters
2. ETA's hash calculation will match yours
3. The 4043 error should be resolved

## Next Steps

1. Find where you call `axios.post` to submit invoices to ETA
2. Apply one of the fixes above
3. Restart the server
4. Submit a new invoice
5. Verify success

---

**Important**: This is THE fix from the mrkindy repository that resolved the 4043 error for them.
