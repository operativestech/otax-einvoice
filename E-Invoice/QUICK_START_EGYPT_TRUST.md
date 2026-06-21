# 🚀 QUICK START - Egypt Trust EInvoiceSignerApp

## Step 1: Download Required Files (5 min)

### Download 1: Egypt Trust Activation
**Link**: https://egypttrust.com/uploads/2021/01/Egypt_Trust_Activation.zip

1. Download the ZIP file
2. Extract it
3. Run `Egypt_Trust_Activation.msi`
4. During installation, select **"Private CSP"**
5. **Note**: You will see a Windows Security Warning for "Egypt_RootCA_G1". **Click Yes** - this is required.
6. Complete installation

### Download 2: EInvoiceSignerApp
**You need to contact Egypt Trust support to get this file**, or check if you have it from when you got your token.

**Alternative**: Check your email from Egypt Trust when you received your token - they usually send setup files.

---

## Step 2: Setup (10 min)

### 2.1 Get Your Certificate Serial Number

1. Open **ePass2003 Token Manager** (installed in Step 1)
2. Connect your USB token
3. Enter PIN: `09761969`
4. **Copy the certificate serial number** (long number/hex string)

### 2.2 Create EInvoiceSignerApp Folder

```cmd
mkdir E:\E-Invoice\EInvoiceSignerApp
```

### 2.3 Configure (If you have EInvoiceSignerApp)

If you have the EInvoiceSignerApp files:

1. Extract to `E:\E-Invoice\EInvoiceSignerApp`
2. Edit `EInvoiceSignerApp.exe.config`
3. Find: `<add key="HardwareToken:CertificateSerialNumber" value="" />`
4. Add your serial number between the quotes
5. Save

---

## Step 3: Test (5 min)

### 3.1 Create Test Invoice

Create `E:\E-Invoice\EInvoiceSignerApp\input.json`:

```json
{
  "issuer": {
    "type": "B",
    "id": "562067566",
    "name": "اوبراتفز لحلول تكنولوجيا المعلومات",
    "address": {
      "country": "EG",
      "governate": "Cairo",
      "regionCity": "0",
      "street": "البرج الشمالى",
      "buildingNumber": "22",
      "postalCode": "0",
      "floor": "0",
      "room": "0",
      "landmark": "0",
      "additionalInformation": "0",
      "branchID": "0"
    }
  },
  "receiver": {
    "type": "P",
    "id": "29909041402358",
    "name": "Test Customer",
    "address": {
      "country": "EG",
      "governate": "Cairo",
      "regionCity": "Cairo",
      "street": "Test St",
      "buildingNumber": "1",
      "postalCode": "0",
      "floor": "1",
      "room": "1",
      "landmark": "1",
      "additionalInformation": ""
    }
  },
  "documentType": "I",
  "documentTypeVersion": "1.0",
  "dateTimeIssued": "2026-01-16T18:00:00Z",
  "taxpayerActivityCode": "6209",
  "internalID": "TEST-001",
  "invoiceLines": [
    {
      "description": "Test Item",
      "itemType": "GS1",
      "itemCode": "99999999",
      "unitType": "EA",
      "quantity": 1,
      "internalCode": "TEST",
      "salesTotal": 100,
      "total": 114,
      "valueDifference": 0,
      "totalTaxableFees": 0,
      "netTotal": 100,
      "itemsDiscount": 0,
      "unitValue": {
        "currencySold": "EGP",
        "amountEGP": 100,
        "amountSold": 0,
        "currencyExchangeRate": 0
      },
      "discount": {
        "rate": 0,
        "amount": 0
      },
      "taxableItems": [
        {
          "taxType": "T1",
          "amount": 14,
          "subType": "V009",
          "rate": 14
        }
      ]
    }
  ],
  "totalDiscountAmount": 0,
  "totalSalesAmount": 100,
  "netAmount": 100,
  "taxTotals": [
    {
      "taxType": "T1",
      "amount": 14
    }
  ],
  "totalAmount": 114,
  "extraDiscountAmount": 0,
  "totalItemsDiscountAmount": 0
}
```

### 3.2 Run Signer

```cmd
cd E:\E-Invoice\EInvoiceSignerApp
EInvoiceSignerApp.exe
```

**Enter PIN when prompted**: `09761969`

### 3.3 Check Result

```cmd
notepad output.json
```

**Look for**: `"signatures"` array with a long Base64 string (~5500 characters)

**Success**: If you see the signature, it works! ✅

---

## Step 4: Integrate with Your App (Already Done!)

I've already updated your code:
- ✅ Created `server/egyptTrustSigner.ts`
- ✅ Updated `server.ts` to use it
- ✅ Ready to test!

---

## Step 5: Test End-to-End (5 min)

### 5.1 Restart Server

```cmd
cd e:\E-Invoice\E-Invoice
npm run server
```

### 5.2 Submit Invoice

1. Open browser: `http://localhost:3000`
2. Import Excel or create manual invoice
3. Click Submit

### 5.3 Watch Logs

Look for:
```
[Egypt Trust Signer] Writing document to input.json...
[Egypt Trust Signer] Signing with hardware token...
[Egypt Trust Signer] ✓ Document signed successfully
[Egypt Trust Signer] Signature size: ~5500 chars (~4125 bytes)
[Egypt Trust Signer] ✓ Signature looks valid (includes full chain)
```

### 5.4 Check Result

Check `invoices/` folder for latest XML:

**SUCCESS**:
```xml
<status>Valid</status>
```

**NO error 4062!**
**NO error 4043!**

---

## If You Don't Have EInvoiceSignerApp

**Contact Egypt Trust Support**:
- Phone: Check your token documentation
- Email: support@egypttrust.com
- Request: "EInvoiceSignerApp for e-invoicing"

**OR**

**Alternative Solution**: Use the manual portal upload workflow temporarily:
1. Export invoice JSON from your app
2. Upload to ETA portal manually (like invoice #642)
3. Portal signs it for you
4. Download result

---

## Troubleshooting

### "EInvoiceSignerApp.exe not found"
**You need to get this from Egypt Trust**. Contact their support.

### "Certificate not found"
**Fix**: Verify serial number in config matches ePass2003 Token Manager

### "PIN rejected"
**Fix**: 
- Verify PIN is `09761969`
- Check if token is locked (too many wrong attempts)

### "Driver not found"
**Fix**: Reinstall `Egypt_Trust_Activation.msi`

---

## Summary

**What's Done**:
- ✅ Code integration complete
- ✅ Ready to use Egypt Trust signer

**What You Need**:
- ⏳ Download Egypt_Trust_Activation.msi (5 min)
- ⏳ Get EInvoiceSignerApp from Egypt Trust
- ⏳ Configure and test (10 min)

**Total Time**: 20-30 minutes once you have the files

**Let me know when you have the files and I'll help you test!** 🚀
