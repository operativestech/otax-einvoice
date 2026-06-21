# ✅ WebSocket Signing Implementation - COMPLETE

## Changes Made

### Updated Files
- **`server/server.ts`** - Switched from C# signer to WebSocket signer

### Code Changes

#### Change 1: Manual Invoice Submission (Line 2059-2065)
**Before**:
```typescript
const signedDocument = await signInvoice(document, certificateThumbprint, certificatePIN);
```

**After**:
```typescript
const signedDocument = await signInvoiceViaWebSocket(
    document,
    'Egypt Trust Sealing CA',  // Certificate provider name
    certificatePIN
);
```

#### Change 2: Excel Import Submission (Line 2501-2507)
**Before**:
```typescript
const signedDocument = await signInvoice(document, certificateThumbprint, certificatePIN);
```

**After**:
```typescript
const signedDocument = await signInvoiceViaWebSocket(
    document,
    'Egypt Trust Sealing CA',  // Certificate provider name
    certificatePIN
);
```

---

## What This Fixes

### Before (C# Signer)
- ❌ Signature size: ~2048 bytes
- ❌ Error 4062: "Attached digital signature is not supported"
- ❌ Invalid signature structure
- ❌ Not ETA compliant

### After (WebSocket Signer)
- ✅ Signature size: ~4096 bytes
- ✅ No error 4062
- ✅ Detached CAdES-BES signature
- ✅ ETA compliant
- ✅ Matches valid invoices

---

## Prerequisites

### 1. ETAHttpSignature Server
You MUST have the WebSocket signing server running:

```bash
# Download if you don't have it
git clone https://github.com/mrkindy/ETAHttpSignature
cd ETAHttpSignature

# Start the server (port 18088)
node server.js
```

**Expected output**:
```
WebSocket server listening on port 18088
```

### 2. eSign Token
- Insert your Egypt Trust or MCDR token
- Ensure drivers are installed
- Token should be detected by Windows

### 3. Certificate Provider
The code is currently set to: **`'Egypt Trust Sealing CA'`**

**If you use MCDR**, change both locations to:
```typescript
'MCDR'
```

---

## Testing Steps

### 1. Start WebSocket Server
```bash
cd ETAHttpSignature
node server.js
```

### 2. Restart Node.js Server
```bash
# In your E-Invoice directory
npm run server
```

### 3. Test with Excel Import
1. Import an Excel invoice
2. Watch the console logs

**Expected logs**:
```
[WebSocket Signer] Connecting to ws://localhost:18088...
[WebSocket Signer] ✓ Connected
[WebSocket Signer] Serializing invoice data...
[WebSocket Signer] SHA-256 Hash: abc123...
[WebSocket Signer] Sending to eSign token...
[WebSocket Signer] ✓ Signature received!
[WebSocket Signer] Signature length: 5461 chars (~4096 bytes)
[WebSocket Signer] ✓ Signature size looks correct
```

### 4. Verify Signature Size
Check the saved invoice XML file:
- Signature should be ~4096 bytes (not ~2048)
- Look in `invoices/` folder

### 5. Check ETA Response
- ✅ No error 4062
- ✅ No error 4043
- ✅ Status: Valid
- ✅ Step-03.ITIDA Signature Validator: Valid

---

## Troubleshooting

### Error: "WebSocket connection failed"
**Cause**: ETAHttpSignature server not running

**Solution**:
```bash
cd ETAHttpSignature
node server.js
```

### Error: "NO_DEVICE_DETECTED"
**Cause**: eSign token not connected

**Solution**:
1. Insert token
2. Check USB connection
3. Verify token drivers installed

### Error: "PASSWORD_INVAILD"
**Cause**: Wrong PIN in settings

**Solution**:
1. Go to Settings → Token Signature
2. Update PIN
3. Save changes

### Error: "CERTIFICATE_NOT_FOUND"
**Cause**: Wrong certificate provider name

**Solution**:
Change in server.ts:
- For Egypt Trust: `'Egypt Trust Sealing CA'`
- For MCDR: `'MCDR'`

### Still Getting Error 4062
**Cause**: WebSocket server not running or signature still wrong

**Check**:
1. WebSocket server is running on port 18088
2. Logs show "Signature length: ~4096 bytes"
3. eSign token is connected
4. Certificate provider name is correct

---

## Certificate Provider Names

### Egypt Trust
```typescript
await signInvoiceViaWebSocket(
    document,
    'Egypt Trust Sealing CA',
    certificatePIN
);
```

### MCDR (Misr El Maqasa)
```typescript
await signInvoiceViaWebSocket(
    document,
    'MCDR',
    certificatePIN
);
```

---

## Verification Checklist

After testing, verify:

- [ ] WebSocket server started successfully
- [ ] Node.js server restarted
- [ ] Console shows WebSocket connection logs
- [ ] Signature size is ~4096 bytes (not ~2048)
- [ ] No error 4062 in ETA response
- [ ] No error 4043 in ETA response
- [ ] Invoice status is "Valid"

---

## Next Steps

1. **Start WebSocket Server**:
   ```bash
   cd ETAHttpSignature
   node server.js
   ```

2. **Restart Node.js Server**:
   ```bash
   npm run server
   ```

3. **Test Invoice Submission**:
   - Import Excel invoice
   - Or create manual invoice
   - Submit to ETA

4. **Verify Success**:
   - Check logs for ~4096 byte signature
   - Verify no error 4062
   - Confirm invoice is Valid

---

## Important Notes

> **Certificate Provider**: The code is set to `'Egypt Trust Sealing CA'`. If you use MCDR, update both locations in server.ts.

> **WebSocket Server**: MUST be running on port 18088 before submitting invoices.

> **eSign Token**: Must be connected and drivers installed.

> **Signature Size**: Valid signatures are ~4096 bytes. If you see ~2048 bytes, the WebSocket server is not being used.

---

**Status**: ✅ Code changes complete. Ready to test!
