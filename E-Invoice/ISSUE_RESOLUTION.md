# E-Invoice Excel Upload - Issue Resolution

## Problem Summary

You were getting validation errors when trying to submit invoices from Excel:
```
Document validation failed: Missing issuer.id, Missing issuer.name, 
Missing receiver.id, Missing receiver.name, Missing dateTimeIssued, 
Missing or empty invoiceLines
```

## Root Cause

The E-Invoice system requires **TWO sources of data**:

1. **Excel File** → Provides **receiver** (customer) and **invoice line** data
2. **Database Settings** → Provides **issuer** (your company) data

The validation was failing because:
- ❌ **Issuer data** (your company info) was **NOT configured** in the database
- ❌ The Excel file only contains **receiver** data, not issuer data
- ❌ No validation was happening early enough to catch this

## What Was Fixed

### 1. Enhanced Validation (server.ts)
Added comprehensive validation that checks BEFORE attempting to build/sign documents:

#### Issuer Data Validation (from Database)
```typescript
// Now checks for:
- Issuer ID (Tax Registration Number)
- Issuer Name (Company Name)
- Issuer Governate
- Issuer Street
```

#### Receiver Data Validation (from Excel)
```typescript
// Now checks for:
- Receiver ID
- Receiver Name
- Date Time Issued
- Invoice Lines exist
```

### 2. Clear Error Messages
Instead of generic "Missing issuer.id", you now get:
```
Issuer configuration incomplete:
- Issuer ID (Tax Registration Number) is missing. Please configure it in Settings > Company Info.
- Issuer Name (Company Name) is missing. Please configure it in Settings > Company Info.
- Issuer Governate is missing. Please configure it in Settings > Company Info.
- Issuer Street is missing. Please configure it in Settings > Company Info.
```

### 3. Documentation Created
- **EXCEL_UPLOAD_GUIDE.md** - Complete guide on Excel format and requirements
- **setup_issuer_config.sql** - SQL script to configure issuer information

## What You Need to Do NOW

### Step 1: Configure Issuer Information in Database

You have **3 options**:

#### Option A: Use SQL Script (Fastest)
1. Open `setup_issuer_config.sql`
2. Run the first query to get your `uid` and `hwid`
3. Replace `<YOUR_UID>` and `<YOUR_HWID>` in the script
4. Update the values with your actual company information:
   ```sql
   'issuer_id' → Your Tax Registration Number (e.g., '123456789')
   'issuer_name' → Your Company Name (e.g., 'OTax Solutions Ltd')
   'issuer_governorate' → Your Governate (e.g., 'Cairo')
   'issuer_street' → Your Street (e.g., 'Tahrir Street')
   ```
5. Run all the INSERT statements

#### Option B: Use Settings UI (If Available)
1. Go to **Settings > Company Info** in your application
2. Fill in all required fields:
   - Issuer ID (Tax Registration Number)
   - Issuer Name (Company Name)
   - Issuer Governate
   - Issuer Street

#### Option C: Manual Database Insert
Run these queries (replace values with your actual data):

```sql
-- Get your uid and hwid first
SELECT id as uid, hwid FROM "LoginDb".credentials LIMIT 1;

-- Then insert (replace 1 and 'your-hwid' with actual values)
INSERT INTO "LoginDb".clients_info_new (uid, hwid, property_name, property_value, "nonAdminEdit", modify_date)
VALUES 
(1, 'your-hwid', 'issuer_id', '123456789', true, NOW()),
(1, 'your-hwid', 'issuer_name', 'Your Company Name Ltd', true, NOW()),
(1, 'your-hwid', 'issuer_governorate', 'Cairo', true, NOW()),
(1, 'your-hwid', 'issuer_street', 'Your Street Name', true, NOW())
ON CONFLICT (uid, property_name) DO UPDATE 
SET property_value = EXCLUDED.property_value, modify_date = NOW();
```

### Step 2: Verify Excel File Format

Your Excel file should have **2 sheets** named exactly:
- `header` (lowercase)
- `detail` (lowercase)

#### Header Sheet Must Have:
| Column | Example Value | Required |
|--------|---------------|----------|
| INTERNAL_ID | inv-042 | ✅ |
| RECEIVER_ID | 213456789 | ✅ |
| RECEIVER_NAME | assam | ✅ |
| DATETIMEISSUED | 2026-01-06 | ✅ |
| RECEIVER_TYPE | B | Optional |
| RECEIVER_COUNTRY | EG | Optional |

#### Detail Sheet Must Have:
| Column | Example Value | Required |
|--------|---------------|----------|
| INTERNAL_ID | inv-042 | ✅ |
| DESCRIPTION | Support for one legal entity... | ✅ |
| ITEMCODE | 9999999 | ✅ |
| QUANTITY | 1 | ✅ |
| AMOUNT | 100.00 | ✅ |
| tax_V001 | 14 | Optional |

### Step 3: Test Again

1. **Restart your server** (to clear any caches):
   ```bash
   # Stop the server (Ctrl+C)
   # Start it again
   npm run dev
   ```

2. **Upload your Excel file** through the UI

3. **Check for new error messages** - They will now be much more specific!

## Expected Flow After Fix

```
1. Upload Excel ✅
   ↓
2. Parse Excel ✅
   ↓
3. Validate Excel Data (receiver, lines) ✅
   ↓
4. Load Issuer Data from Database ✅
   ↓
5. Validate Issuer Data ✅
   ↓
6. Calculate Invoices ✅
   ↓
7. Build ETA Document (issuer + receiver) ✅
   ↓
8. Sign Document ✅
   ↓
9. Submit to ETA ✅
```

## Troubleshooting

### Still Getting "Missing issuer.id"?
- ✅ Check database settings are saved correctly
- ✅ Restart the server
- ✅ Check you're logged in as the correct user
- ✅ Run the verification query from `setup_issuer_config.sql`

### Still Getting "Missing receiver.id"?
- ✅ Check Excel header sheet has RECEIVER_ID column
- ✅ Check the column has actual values (not empty)
- ✅ Check sheet is named exactly `header` (lowercase)

### Still Getting "Missing invoiceLines"?
- ✅ Check Excel detail sheet exists
- ✅ Check INTERNAL_ID in detail matches header
- ✅ Check sheet is named exactly `detail` (lowercase)

## Files Modified

1. **server/server.ts**
   - Added issuer data validation (lines 2073-2091)
   - Added receiver data validation (lines 2048-2067)
   - Better error messages

2. **EXCEL_UPLOAD_GUIDE.md** (NEW)
   - Complete documentation on Excel format
   - Required fields reference
   - Common errors and solutions

3. **setup_issuer_config.sql** (NEW)
   - SQL script to check current configuration
   - SQL script to insert/update issuer data
   - Verification queries

## Next Steps

1. ✅ Configure issuer information (Step 1 above)
2. ✅ Verify Excel format (Step 2 above)
3. ✅ Test upload (Step 3 above)
4. 📧 If still having issues, share the **exact error message** you receive

## Quick Reference: Required Database Settings

| Setting | Example | Where to Get It |
|---------|---------|-----------------|
| issuer_id | 123456789 | Your Tax Registration Certificate |
| issuer_name | OTax Solutions Ltd | Your Company Registration |
| issuer_governorate | Cairo | Your Company Address |
| issuer_street | Tahrir Street | Your Company Address |

---

**Ready to test?** Follow Step 1 above to configure your issuer information! 🚀
