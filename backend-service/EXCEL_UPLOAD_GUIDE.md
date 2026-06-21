# E-Invoice Excel Upload Guide

## Overview
This guide explains how to properly format your Excel file for bulk invoice submission to the Egyptian Tax Authority (ETA) portal.

## Required Configuration

### 1. Database Settings (Company/Issuer Information)
Before uploading any Excel file, you MUST configure your company information in **Settings > Company Info**. The following fields are REQUIRED:

| Setting Name | Database Column | Required | Description |
|--------------|----------------|----------|-------------|
| **Issuer ID** | `issuer_id` | ✅ Yes | Your Tax Registration Number (9 digits) |
| **Issuer Name** | `issuer_name` | ✅ Yes | Your Company Legal Name |
| **Issuer Governate** | `issuer_governorate` | ✅ Yes | Your company's governate (e.g., Cairo, Giza) |
| **Issuer Street** | `issuer_street` | ✅ Yes | Your company's street address |
| **Issuer Country** | `issuer_country` | Optional | Default: EG (Egypt) |
| **Issuer Branch ID** | `issuer_branchId` | Optional | Default: 0 |
| **Issuer Building Number** | `issuer_buildingNumber` | Optional | Default: 0 |
| **Issuer Floor** | `issuer_floor` | Optional | Default: 0 |
| **User Type** | `user_type` | Optional | B (Business) or P (Person) |
| **Activity Code** | `tax_payer_activity_code` | Optional | Default: 0000 |

**⚠️ IMPORTANT:** If these settings are not configured, you will get validation errors like:
```
Document validation failed: Missing issuer.id, Missing issuer.name
```

---

## Excel File Format

### Required Sheets
Your Excel file MUST contain exactly **2 sheets** with these names:
1. **header** - Contains invoice header information (one row per invoice)
2. **detail** - Contains invoice line items (multiple rows per invoice)

---

### Sheet 1: `header`

This sheet contains one row per invoice with the following columns:

#### Required Columns

| Column Name | Type | Required | Description | Example |
|-------------|------|----------|-------------|---------|
| **INTERNAL_ID** | Text | ✅ Yes | Unique invoice identifier | inv-042 |
| **RECEIVER_ID** | Text | ✅ Yes | Customer's Tax Registration Number | 213456789 |
| **RECEIVER_NAME** | Text | ✅ Yes | Customer's Legal Name | assam |
| **DATETIMEISSUED** | Date/Number | ✅ Yes | Invoice issue date | 2026-01-06 or 46026 (Excel serial) |
| **RECEIVER_COUNTRY** | Text | Optional | Customer's country code | EG |
| **RECEIVER_TYPE** | Text | Optional | B (Business) or P (Person) | B |
| **DOCUMENTTYPE** | Text | Optional | I (Invoice), C (Credit Note), D (Debit Note) | I |

#### Optional Address Columns

| Column Name | Description | Default |
|-------------|-------------|---------|
| RECEIVER_GOVERNATE | Customer's governate | - |
| RECEIVER_REGIONCITY | Customer's region/city | - |
| RECEIVER_STREET | Customer's street address | - |
| RECEIVER_BUILDINGNUMBER | Customer's building number | 0 |
| RECEIVER_POSTALCODE | Customer's postal code | 0 |
| RECEIVER_FLOOR | Customer's floor | - |
| RECEIVER_ROOM | Customer's room | - |
| RECEIVER_LANDMARK | Customer's landmark | - |
| RECEIVER_ADDITIONALINFORMATION | Additional address info | - |

#### Optional Payment/Delivery Columns

| Column Name | Description | Default |
|-------------|-------------|---------|
| PURCHASEORDERREFERENCE | PO reference number | - |
| PURCHASEORDERDESCRIPTION | PO description | - |
| SALESORDERREFERENCE | Sales order reference | - |
| SALESORDERDESCRIPTION | Sales order description | - |
| PAYMENT_BANKNAME | Bank name | - |
| PAYMENT_BANKADDRESS | Bank address | - |
| PAYMENT_BANKACCOUNTNO | Bank account number | - |
| PAYMENT_BANKACCOUNTIBAN | Bank IBAN | - |
| PAYMENT_SWIFTCODE | SWIFT code | - |
| PAYMENT_TERMS | Payment terms | - |
| DELIVERY_APPROACH | Delivery approach | - |
| DELIVERY_PACKAGING | Packaging type | - |
| DELIVERY_GROSSWEIGHT | Gross weight | 1 |
| DELIVERY_NETWEIGHT | Net weight | 1 |
| EXTRADISCOUNTAMOUNT | Invoice-level discount | 0 |

---

### Sheet 2: `detail`

This sheet contains invoice line items (multiple rows can have the same INTERNAL_ID).

#### Required Columns

| Column Name | Type | Required | Description | Example |
|-------------|------|----------|-------------|---------|
| **INTERNAL_ID** | Text | ✅ Yes | Must match header INTERNAL_ID | inv-042 |
| **DESCRIPTION** | Text | ✅ Yes | Item description | Support for one legal entity of OTax solution From 01 1 2026 To 30 6 2026 |
| **ITEMCODE** | Text | ✅ Yes | Item code (GS1/EGS code) | 9999999 |
| **QUANTITY** | Number | ✅ Yes | Item quantity | 1 |
| **AMOUNT** | Number | ✅ Yes | Unit price (before tax) | 100.00 |

#### Optional Item Columns

| Column Name | Description | Default |
|-------------|-------------|---------|
| ITEMTYPE | Item type (GS1, EGS) | GS1 |
| ITEM_INTERNAL_CODE | Your internal item code | - |
| UNITTYPE | Unit type (EA, KG, etc.) | EA |
| CURRENCYSOLD | Currency code | EGP |
| CURRENCYEXCHANGERATE | Exchange rate if not EGP | 0 |
| DIS_RATE | Discount rate (%) | 0 |
| DIS_AMOUNT | Discount amount | 0 |

#### Tax Columns

| Column Name | Description | Default |
|-------------|-------------|---------|
| tax_V001 | VAT/Table Tax (%) | 0 |
| tax_V003 | Entertainment Tax (%) | 0 |
| tax_V009 | Other Tax (%) | 0 |
| tax_W007 | Withholding Tax (%) | 0 |

---

## Example Excel Structure

### Header Sheet Example:

| INTERNAL_ID | RECEIVER_TYPE | RECEIVER_ID | RECEIVER_NAME | RECEIVER_COUNTRY | DATETIMEISSUED | DOCUMENTTYPE |
|-------------|---------------|-------------|---------------|------------------|----------------|--------------|
| inv-042 | B | 213456789 | assam | EG | 2026-01-06 | I |

### Detail Sheet Example:

| INTERNAL_ID | DESCRIPTION | ITEMTYPE | ITEMCODE | QUANTITY | AMOUNT | CURRENCYSOLD | tax_V001 |
|-------------|-------------|----------|----------|----------|--------|--------------|----------|
| inv-042 | Support for one legal entity of OTax solution From 01 1 2026 To 30 6 2026 | GS1 | 9999999 | 1 | 100.00 | EGP | 14 |

---

## Common Errors and Solutions

### Error: "Missing issuer.id, Missing issuer.name"
**Cause:** Company information not configured in database settings.

**Solution:** 
1. Go to **Settings > Company Info**
2. Fill in all required fields:
   - Issuer ID (Tax Registration Number)
   - Issuer Name (Company Name)
   - Issuer Governate
   - Issuer Street

---

### Error: "Missing receiver.id, Missing receiver.name"
**Cause:** Excel header sheet is missing required receiver columns or they are empty.

**Solution:**
1. Open your Excel file
2. Check the **header** sheet
3. Ensure these columns exist and have values:
   - RECEIVER_ID
   - RECEIVER_NAME
   - DATETIMEISSUED

---

### Error: "Missing or empty invoiceLines"
**Cause:** Excel detail sheet is missing or has no matching rows for the invoice.

**Solution:**
1. Check the **detail** sheet exists
2. Ensure INTERNAL_ID in detail sheet matches INTERNAL_ID in header sheet
3. Ensure at least one line item exists for each invoice

---

### Error: "Excel file must contain 'header' and 'detail' sheets"
**Cause:** Sheet names are incorrect.

**Solution:**
1. Rename your sheets to exactly: **header** and **detail** (lowercase)
2. Do NOT use spaces or special characters

---

## Data Flow

```
┌─────────────────────────────────────────────────────────────┐
│ 1. Upload Excel File (.xlsx)                                │
│    - Must have 'header' and 'detail' sheets                 │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ 2. Parse Excel                                               │
│    - Extract header rows (invoice headers)                   │
│    - Extract detail rows (invoice line items)                │
│    - Group details by INTERNAL_ID                            │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ 3. Validate Data                                             │
│    - Check receiver data from Excel ✅                       │
│    - Check issuer data from database settings ✅             │
│    - Check invoice lines exist ✅                            │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ 4. Calculate Invoices                                        │
│    - Calculate taxes per line                                │
│    - Calculate totals                                        │
│    - Apply discounts                                         │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ 5. Build ETA Document                                        │
│    - Combine issuer data (from DB) + receiver data (Excel)   │
│    - Format according to ETA specifications                  │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ 6. Sign Document                                             │
│    - Use certificate from settings                           │
│    - Generate digital signature                              │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ 7. Submit to ETA Portal                                      │
│    - Send signed document to ETA API                         │
│    - Receive submission result                               │
└─────────────────────────────────────────────────────────────┘
```

---

## Checklist Before Submission

- [ ] Company information configured in Settings > Company Info
  - [ ] Issuer ID (Tax Registration Number)
  - [ ] Issuer Name
  - [ ] Issuer Governate
  - [ ] Issuer Street
- [ ] Excel file has exactly 2 sheets: `header` and `detail`
- [ ] Header sheet has required columns:
  - [ ] INTERNAL_ID
  - [ ] RECEIVER_ID
  - [ ] RECEIVER_NAME
  - [ ] DATETIMEISSUED
- [ ] Detail sheet has required columns:
  - [ ] INTERNAL_ID
  - [ ] DESCRIPTION
  - [ ] ITEMCODE
  - [ ] QUANTITY
  - [ ] AMOUNT
- [ ] Each INTERNAL_ID in header has at least one matching row in detail
- [ ] All dates are in valid format (YYYY-MM-DD or Excel serial number)
- [ ] All numeric fields contain valid numbers

---

## Need Help?

If you continue to experience issues:
1. Check the browser console for detailed error messages
2. Review the validation errors displayed in the UI
3. Verify your Excel file matches the format exactly
4. Ensure all required database settings are configured
