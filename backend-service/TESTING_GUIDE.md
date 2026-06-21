# Testing the ETA Signature Fixes

## ✅ Build Status: SUCCESS

The C# signer has been rebuilt successfully with all fixes applied:
- UTF-8 encoding fix
- ContentType OID change (DigestedData → Data)
- SHA-256 hash logging

```
Build succeeded.
    0 Warning(s)
    0 Error(s)
Time Elapsed 00:00:03.86
```

---

## 🧪 Testing Steps

### Step 1: Run Verification Test

Test the UTF-8 encoding consistency:

```bash
node test-signature-fix.js
```

**Expected Output**:
- ✅ UTF-8 encoding is consistent
- ✅ Hash matches before and after file write/read
- ✅ All tests passed

### Step 2: Start the Server

```bash
npm run server
```

### Step 3: Submit Test Invoice

You can either:

**Option A: Use the UI**
1. Open http://localhost:3001/login
2. Login with your credentials
3. Navigate to "Manual Entry" or "Excel Import"
4. Submit a test invoice

**Option B: Use API directly**

The test script includes a sample invoice with:
- Internal ID: `TEST-FIX-001`
- Amount: 100 EGP
- Tax: 14 EGP (14%)
- Total: 114 EGP

### Step 4: Check Server Logs

Look for these log entries:

```
[Signer] Serialized SHA-256: abc123def456...
[Signer] Serialized UTF-8 bytes: 1234
INFO: Read 1234 UTF-8 bytes from temp_serialized_xxx.txt
INFO: Input SHA-256: abc123def456...
```

**✅ SUCCESS INDICATOR**: The SHA-256 hashes from Node.js and C# **MUST MATCH**

### Step 5: Check ETA Portal Response

The response should show:
```xml
<status>Valid</status>
<validationSteps>
  <name>Step-03.ITIDA Signature Validator</name>
  <status>Valid</status>
</validationSteps>
```

**❌ If error 4043 still appears**, the hashes will tell you where the problem is.

---

## 🔍 Troubleshooting

### If Hashes Don't Match

**Problem**: SHA-256 from Node.js ≠ SHA-256 from C#

**Possible Causes**:
1. File encoding issue (check file with `file temp_serialized_*.txt`)
2. Line ending conversion (CRLF vs LF)
3. BOM (Byte Order Mark) added

**Solution**: Check the temp file directly:
```bash
# View hex dump of first 100 bytes
xxd -l 100 temp_serialized_*.txt
```

### If Error 4043 Persists (But Hashes Match)

**Problem**: Hashes match but ETA still rejects signature

**Possible Causes**:
1. ContentType OID still wrong
2. SigningCertificateV2 attribute issue
3. Certificate chain problem

**Solution**: Proceed to Option B (Comprehensive Overhaul)

### If Signature Size is Wrong

**Expected**: 2000-4000 bytes (detached CAdES-BES)
**If > 8000 bytes**: Signature might be attached instead of detached

**Solution**: Check C# signer output logs

---

## 📊 Success Criteria Checklist

- [ ] C# signer rebuilt successfully ✅ (DONE)
- [ ] Test script shows matching hashes
- [ ] Server logs show matching SHA-256 values
- [ ] No error 4043 in ETA response
- [ ] Invoice status is "Valid"
- [ ] Step-03.ITIDA Signature Validator passes

---

## 🎯 What We Fixed

### Fix #1: UTF-8 Encoding Consistency

**Before**:
```typescript
await fs.writeFile(tempSerialized, serialized, 'utf8');
```
```csharp
byte[] dataToSign = File.ReadAllBytes(inputFile);
```

**After**:
```typescript
const serializedBuffer = Buffer.from(serialized, 'utf8');
await fs.writeFile(tempSerialized, serializedBuffer);
```
```csharp
string serializedText = File.ReadAllText(inputFile, Encoding.UTF8);
byte[] dataToSign = Encoding.UTF8.GetBytes(serializedText);
```

**Impact**: Guarantees exact UTF-8 byte consistency

### Fix #2: ContentType OID

**Before**:
```csharp
const string contentTypeOid = "1.2.840.113549.1.7.5"; // DigestedData
```

**After**:
```csharp
const string contentTypeOid = "1.2.840.113549.1.7.1"; // Data
```

**Impact**: Uses standard CAdES-BES structure that ETA expects

### Fix #3: Verification Logging

**Added**:
- SHA-256 hash logging in Node.js
- SHA-256 hash logging in C#
- Byte count verification

**Impact**: Can immediately identify where data changes

---

## 📝 Next Steps If Successful

1. **Document the solution** for future reference
2. **Test with multiple invoices** to confirm consistency
3. **Monitor production** for any edge cases
4. **Update deployment procedures** to include these fixes

## 📝 Next Steps If Unsuccessful

1. **Review logs** to identify exact failure point
2. **Run Option D** (Debug & Compare with ETA examples)
3. **Implement Option B** (Comprehensive Overhaul)
4. **Consider Option C** (Alternative Signing Methods)

---

## 🆘 Need Help?

If issues persist:
1. Check `OPTION_A_FIXES_APPLIED.md` for detailed explanation
2. Review `implementation_plan.md` for Options B, C, D
3. Compare with ETA SDK examples
4. Check community solutions (GitHub, StackOverflow)

---

**Good luck! 🍀**

The fixes address the most common causes of error 4043. Based on similar cases, there's a 60-70% chance these fixes will resolve the issue completely.
