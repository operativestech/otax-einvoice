# 🚨 URGENT: Server Restart Required!

## The Code Has Been Updated - You MUST Restart the Server!

### Why?
The validation logic has been completely rewritten. The old code is still running in memory. You need to restart the server for the changes to take effect.

### How to Restart:

#### Option 1: Terminal Restart (Recommended)
1. Go to the terminal where the server is running
2. Press `Ctrl + C` to stop the server
3. Wait for it to fully stop
4. Run: `npm run server`
5. Wait for "Server running on port 3001" message

#### Option 2: If Running Both (Frontend + Backend)
1. Press `Ctrl + C` in the terminal
2. Run: `npm run all`

### ✅ Verification Checklist

After restarting, you should see these NEW log messages when uploading:

```
[VALIDATION] Checking document structure for inv-043...
[DEBUG] Document Structure for inv-043:
  - issuer.id: "..." (type: string)
  - issuer.name: "..." (type: string)
  - receiver.id: "..." (type: string)
  - receiver.name: "..." (type: string)
  - dateTimeIssued: "..." (type: string)
  - invoiceLines: X lines
```

### ❌ If You DON'T See These Logs
The server is still running the old code. Make sure you:
1. Fully stopped the old process (Ctrl+C)
2. Started a new process
3. Waited for it to fully start

### 🔍 What to Look For in Console

When you upload your Excel file, you should see:

1. **Early Validation (NEW):**
   ```
   [EXCEL DATA ERROR] inv-043: [array of errors if any]
   ```

2. **Issuer Validation (NEW):**
   ```
   [ISSUER CONFIG ERROR] inv-043: [array of errors if any]
   ```

3. **Document Structure Debug (NEW):**
   ```
   [DEBUG] Document Structure for inv-043:
     - issuer.id: "123456789" (type: string)
     - issuer.name: "Your Company" (type: string)
     ...
   ```

4. **Validation Result:**
   ```
   [VALIDATION] Document structure OK for inv-043
   ```
   OR
   ```
   [VALIDATION FAILED] inv-043: [array of errors]
   [DEBUG] Full issuerData: { ... }
   [DEBUG] Full calculated.header: { ... }
   ```

### 📋 Important Debug Information

If you still get errors AFTER restarting, please share:

1. **The FULL console output** from when you click "Send to ETA"
2. **Look for these specific lines:**
   - `[DEBUG] Document Structure for inv-043:`
   - `[DEBUG] Full issuerData:`
   - `[DEBUG] Full calculated.header:`

These will show us the ACTUAL values being validated!

### 🎯 Expected Behavior After Restart

#### If Issuer Data is Missing:
```
Error: Issuer configuration incomplete:
- Issuer ID (Tax Registration Number) is missing. Please configure it in Settings > Company Info.
```

#### If Receiver Data is Missing:
```
Error: Excel data incomplete for invoice inv-043:
- Receiver ID (Tax Registration Number) is missing in Excel header sheet
```

#### If Document Has '0' Values:
```
Error: Document validation failed: Missing issuer.id, Missing issuer.name
[DEBUG] Full issuerData: {
  "id": "0",    ← This means empty in database
  "name": "0",  ← This means empty in database
  ...
}
```

### 🔧 Quick Test

After restarting, the error message should be DIFFERENT and more specific. If you're still getting the exact same generic error, the server hasn't reloaded the new code.

---

**RESTART THE SERVER NOW!** ⚡
