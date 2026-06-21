# E-Invoice Hash Mismatch (4043) - Final Diagnostic Guide

## Current Status
The 4043 error persists despite implementing:
- ✅ Property order (Address → Type → ID → Name)
- ✅ Array key repetition (INVOICELINES""INVOICELINES)
- ✅ Natural number formatting
- ✅ Detached signature with DigestedData OID

## Critical Test

Run this command to verify the property order is preserved:

```bash
npx tsx test_builder_order.ts
```

Expected output:
```
✅ SUCCESS: Issuer ADDRESS comes BEFORE TYPE (Matches mrkindy/V1.0)
✅ SUCCESS: Array Keys are REPEATED (Matches V1.0)
✅ SUCCESS: Numbers are NATURAL (No trailing zeros)
```

## If Test Fails

If you see "❌ TYPE before ADDRESS", it means the `etaBuilder.ts` changes are not being loaded. 

**Solution:**
1. Stop the Node server completely
2. Delete any cached .js files: `del /S server\*.js`
3. Restart the server
4. Submit a NEW invoice (not retry an old one)

## If Test Passes But Error Persists

This means there's a subtle difference between our canonicalization and the ETA portal's. 

**Next Steps:**
1. Get the EXACT canonical string the portal is using
2. Compare it character-by-character with ours

To get our canonical string for the latest invoice:
```bash
npx tsx debug_failed_invoice.ts
```

## Possible Remaining Issues

1. **Empty String Handling**: The PHP code doesn't skip empty strings, but we might be
2. **Decimal Precision**: Some numbers might need exactly 2 decimal places
3. **Date Format**: The portal might be reformatting dates
4. **Character Encoding**: UTF-8 vs other encodings for Arabic text

## Manual Verification

Create a minimal test invoice with:
- No Arabic characters
- Simple round numbers (100, 200, etc.)
- No optional fields
- Single line item

This will help isolate the issue.

## Contact

If the issue persists, we need to:
1. Get a working example from mrkindy repository
2. Compare byte-by-byte with our output
3. Check if ETA has updated their V1.0 specification

---

**Last Updated**: 2026-01-14
**Files Modified**: 
- server/etaBuilder.ts
- server/etaSerialization.ts
- EtaSigner/Program.cs
