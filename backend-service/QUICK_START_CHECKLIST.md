# 🚀 Quick Start Checklist - E-Invoice Excel Upload

## ✅ Pre-Flight Checklist

Before uploading your Excel file, complete these steps:

### 1️⃣ Database Configuration (REQUIRED)

Run this query to check if issuer data is configured:

```sql
SELECT 
    property_name,
    property_value,
    CASE 
        WHEN property_value IS NULL OR TRIM(property_value) = '' THEN '❌ MISSING'
        ELSE '✅ OK'
    END as status
FROM "LoginDb".clients_info_new
WHERE uid = (SELECT id FROM "LoginDb".credentials LIMIT 1)
AND property_name IN ('issuer_id', 'issuer_name', 'issuer_governorate', 'issuer_street')
ORDER BY property_name;
```

**Expected Result:** All 4 fields should show `✅ OK`

If any show `❌ MISSING`, use `setup_issuer_config.sql` to configure them.

---

### 2️⃣ Excel File Format (REQUIRED)

#### ✅ File Structure
- [ ] File is `.xlsx` or `.xls` format
- [ ] Contains exactly 2 sheets
- [ ] First sheet named: `header` (lowercase)
- [ ] Second sheet named: `detail` (lowercase)

#### ✅ Header Sheet Columns
- [ ] INTERNAL_ID (unique invoice ID)
- [ ] RECEIVER_ID (customer tax number)
- [ ] RECEIVER_NAME (customer name)
- [ ] DATETIMEISSUED (invoice date)

#### ✅ Detail Sheet Columns
- [ ] INTERNAL_ID (matches header)
- [ ] DESCRIPTION (item description)
- [ ] ITEMCODE (item code)
- [ ] QUANTITY (item quantity)
- [ ] AMOUNT (unit price)

#### ✅ Data Quality
- [ ] No empty INTERNAL_ID values
- [ ] No empty RECEIVER_ID values
- [ ] No empty RECEIVER_NAME values
- [ ] All dates are valid (YYYY-MM-DD or Excel serial)
- [ ] All numbers are valid (no text in number columns)
- [ ] Each invoice in header has at least 1 line in detail

---

### 3️⃣ Server Status (REQUIRED)

- [ ] Backend server is running on port 3001
- [ ] No errors in server console
- [ ] Database connection is working

---

## 🎯 Upload Process

### Step 1: Upload Excel
1. Open the E-Invoice application
2. Navigate to "Invoice from Excel"
3. Click "Upload Excel File"
4. Select your prepared Excel file
5. Click "Parse and Review Data"

### Step 2: Review Parsed Data
- Check the invoice count matches your Excel
- Check the line items count is correct
- Review the data preview

### Step 3: Calculate
- Click "Calculate All Invoices"
- Review the calculated totals
- Check tax calculations are correct

### Step 4: Submit
- Click "Send to ETA Portal"
- Wait for submission to complete
- Review the results

---

## 🔍 Troubleshooting Guide

### Error: "Missing issuer.id, Missing issuer.name"

**Problem:** Issuer data not configured in database

**Solution:**
1. Run the check query from Step 1️⃣ above
2. Use `setup_issuer_config.sql` to configure
3. Restart the server
4. Try again

---

### Error: "Missing receiver.id, Missing receiver.name"

**Problem:** Excel header sheet missing required columns or empty values

**Solution:**
1. Open your Excel file
2. Check the `header` sheet has these columns:
   - RECEIVER_ID
   - RECEIVER_NAME
3. Ensure all rows have values in these columns
4. Save and re-upload

---

### Error: "Missing or empty invoiceLines"

**Problem:** No matching detail rows for invoice

**Solution:**
1. Open your Excel file
2. Check the `detail` sheet exists
3. Ensure INTERNAL_ID in detail matches header
4. Ensure at least one row exists per invoice
5. Save and re-upload

---

### Error: "Excel file must contain 'header' and 'detail' sheets"

**Problem:** Sheet names are incorrect

**Solution:**
1. Open your Excel file
2. Rename sheets to exactly: `header` and `detail` (lowercase)
3. Save and re-upload

---

### Error: "Date Time Issued is missing"

**Problem:** DATETIMEISSUED column is empty or invalid

**Solution:**
1. Open your Excel file
2. Check the `header` sheet has DATETIMEISSUED column
3. Ensure all rows have valid dates
4. Format: YYYY-MM-DD (e.g., 2026-01-06)
5. Save and re-upload

---

## 📋 Sample Data

### Sample Header Row:
```
INTERNAL_ID: inv-001
RECEIVER_TYPE: B
RECEIVER_ID: 213456789
RECEIVER_NAME: ABC Company Ltd
RECEIVER_COUNTRY: EG
RECEIVER_GOVERNATE: Cairo
RECEIVER_STREET: Tahrir Street
DATETIMEISSUED: 2026-01-06
DOCUMENTTYPE: I
```

### Sample Detail Row:
```
INTERNAL_ID: inv-001
DESCRIPTION: Professional Services - January 2026
ITEMTYPE: GS1
ITEMCODE: 9999999
ITEM_INTERNAL_CODE: SRV-001
UNITTYPE: EA
QUANTITY: 1
CURRENCYSOLD: EGP
AMOUNT: 1000.00
tax_V001: 14
```

---

## 🎓 Additional Resources

- **EXCEL_UPLOAD_GUIDE.md** - Complete Excel format guide
- **setup_issuer_config.sql** - Database configuration script
- **ISSUE_RESOLUTION.md** - Detailed troubleshooting guide

---

## ✨ Success Indicators

You'll know everything is working when:

1. ✅ Upload completes without errors
2. ✅ Parse shows correct invoice and line counts
3. ✅ Calculate shows totals for all invoices
4. ✅ Submit returns "Success: X, Failed: 0"
5. ✅ Invoices appear in ETA portal

---

## 🆘 Still Having Issues?

1. Check server console for detailed error logs
2. Check browser console (F12) for frontend errors
3. Review the error message carefully - it now tells you exactly what's missing
4. Verify all checklist items above are complete
5. Try with a single invoice first to isolate the issue

---

**Last Updated:** 2026-01-12
**Version:** 2.0 (Enhanced Validation)
