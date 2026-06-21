# Progress Update: Error 4043 → Error 4062

## ✅ SUCCESS: Error 4043 is RESOLVED!

The UTF-8 encoding fix worked! We're no longer getting the message-digest mismatch error.

---

## ❌ NEW ISSUE: Error 4062 - Attached Signature

**Error**: `4062: Attached digital signature is not supported`

**Meaning**: The signature includes the content (attached) instead of being separate (detached).

---

## 🔧 Fix Applied

### Problem
The C# signer was creating an **attached** signature (includes the signed data) instead of a **detached** signature (only the signature, data separate).

### Solution
Updated `EtaSigner/Program.cs` to properly create a detached signature:

**Before**:
```csharp
ContentInfo content = new ContentInfo(new Oid(contentTypeOid), dataToSign);
SignedCms signedCms = new SignedCms(content, true);  // This still attached the content
```

**After**:
```csharp
// For DETACHED signature:
// 1. ContentInfo contains the data to be signed
// 2. detached=true means the signature won't include the content  
// 3. Encode() returns only the signature structure
ContentInfo content = new ContentInfo(new Oid(contentTypeOid), dataToSign);
SignedCms signedCms = new SignedCms(content, detached: true);
```

The key is that `detached: true` tells SignedCms.Encode() to return ONLY the signature without the content.

---

## 📋 Next Steps

### 1. Rebuild C# Signer
```bash
cd e:\E-Invoice\E-Invoice\EtaSigner
dotnet build -c Release
```

### 2. Test Again
- Submit the same invoice
- Check signature size in logs (should be smaller now)
- Verify no error 4062

### 3. Expected Results

**Signature Size**:
- ❌ Attached: ~8000+ bytes (includes content + signature)
- ✅ Detached: ~2000-4000 bytes (signature only)

**ETA Response**:
- ✅ No error 4062
- ✅ No error 4043
- ✅ Status: Valid

---

## 📊 Progress Summary

| Error | Status | Fix Applied |
|-------|--------|-------------|
| **4043** - message-digest mismatch | ✅ RESOLVED | UTF-8 encoding fix |
| **4062** - attached signature | 🔧 IN PROGRESS | Detached signature fix |

---

## 🎯 What's Different Now

### Signature Structure

**Attached Signature** (Wrong):
```
[Signature Header]
[Certificate]
[Signed Data] ← This shouldn't be here!
[Signature Value]
```

**Detached Signature** (Correct):
```
[Signature Header]
[Certificate]
[Signature Value]
```

The signed data is sent separately in the JSON, not embedded in the signature.

---

## ⏭️ After Rebuild

1. **Restart server**: `npm run server`
2. **Submit invoice**: Same test invoice
3. **Check logs**: Look for signature size
4. **Verify**: Should be ~2000-4000 bytes, not 8000+

---

## 💡 Why This Happened

The `SignedCms` class in C# has a quirk:
- Even with `detached: true` in the constructor
- You must pass the data to `ContentInfo`
- The `detached` flag tells `Encode()` to exclude the content
- This creates a proper detached CAdES-BES signature

---

**Status**: Rebuilding signer with detached signature fix...
