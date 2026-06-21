-- ============================================================================
-- E-Invoice Issuer Configuration Check and Setup
-- ============================================================================
-- This script helps you check and configure the required issuer information
-- for E-Invoice submission to the Egyptian Tax Authority (ETA)
-- ============================================================================

-- STEP 1: Check Current Issuer Configuration
-- ----------------------------------------------------------------------------
-- Run this query to see what issuer information is currently configured

SELECT 
    property_name,
    property_value,
    CASE 
        WHEN property_value IS NULL OR TRIM(property_value) = '' THEN '❌ MISSING'
        ELSE '✅ OK'
    END as status
FROM "otaxdb".clients_info_new
WHERE uid = (SELECT id FROM "otaxdb".credentials LIMIT 1)
AND property_name IN (
    'issuer_id',
    'issuer_name',
    'issuer_governorate',
    'issuer_street',
    'issuer_country',
    'issuer_branchId',
    'issuer_buildingNumber',
    'issuer_floor',
    'user_type',
    'tax_payer_activity_code'
)
ORDER BY property_name;

-- ============================================================================
-- STEP 2: Insert/Update Required Issuer Information
-- ----------------------------------------------------------------------------
-- IMPORTANT: Replace the values below with your actual company information
-- ============================================================================

-- Get the user ID and HWID (needed for inserts)
-- Run this first to get your uid and hwid:
SELECT id as uid, hwid FROM "otaxdb".credentials LIMIT 1;

-- After getting uid and hwid from above, replace <YOUR_UID> and <YOUR_HWID> below
-- Then run each INSERT/UPDATE statement

-- ----------------------------------------------------------------------------
-- REQUIRED FIELDS (MUST BE FILLED)
-- ----------------------------------------------------------------------------

-- 1. Issuer ID (Tax Registration Number) - 9 digits
INSERT INTO "otaxdb".clients_info_new (uid, hwid, property_name, property_value, "nonAdminEdit", modify_date)
VALUES (<YOUR_UID>, '<YOUR_HWID>', 'issuer_id', '123456789', true, NOW())
ON CONFLICT (uid, property_name) 
DO UPDATE SET property_value = '123456789', modify_date = NOW();

-- 2. Issuer Name (Company Legal Name)
INSERT INTO "otaxdb".clients_info_new (uid, hwid, property_name, property_value, "nonAdminEdit", modify_date)
VALUES (<YOUR_UID>, '<YOUR_HWID>', 'issuer_name', 'Your Company Name Ltd', true, NOW())
ON CONFLICT (uid, property_name) 
DO UPDATE SET property_value = 'Your Company Name Ltd', modify_date = NOW();

-- 3. Issuer Governate (e.g., Cairo, Giza, Alexandria)
INSERT INTO "otaxdb".clients_info_new (uid, hwid, property_name, property_value, "nonAdminEdit", modify_date)
VALUES (<YOUR_UID>, '<YOUR_HWID>', 'issuer_governorate', 'Cairo', true, NOW())
ON CONFLICT (uid, property_name) 
DO UPDATE SET property_value = 'Cairo', modify_date = NOW();

-- 4. Issuer Street
INSERT INTO "otaxdb".clients_info_new (uid, hwid, property_name, property_value, "nonAdminEdit", modify_date)
VALUES (<YOUR_UID>, '<YOUR_HWID>', 'issuer_street', 'Tahrir Street', true, NOW())
ON CONFLICT (uid, property_name) 
DO UPDATE SET property_value = 'Tahrir Street', modify_date = NOW();

-- ----------------------------------------------------------------------------
-- OPTIONAL FIELDS (Recommended to fill)
-- ----------------------------------------------------------------------------

-- 5. Issuer Country (Default: EG)
INSERT INTO "otaxdb".clients_info_new (uid, hwid, property_name, property_value, "nonAdminEdit", modify_date)
VALUES (<YOUR_UID>, '<YOUR_HWID>', 'issuer_country', 'EG', true, NOW())
ON CONFLICT (uid, property_name) 
DO UPDATE SET property_value = 'EG', modify_date = NOW();

-- 6. Issuer Branch ID (Default: 0)
INSERT INTO "otaxdb".clients_info_new (uid, hwid, property_name, property_value, "nonAdminEdit", modify_date)
VALUES (<YOUR_UID>, '<YOUR_HWID>', 'issuer_branchId', '0', true, NOW())
ON CONFLICT (uid, property_name) 
DO UPDATE SET property_value = '0', modify_date = NOW();

-- 7. Issuer Building Number
INSERT INTO "otaxdb".clients_info_new (uid, hwid, property_name, property_value, "nonAdminEdit", modify_date)
VALUES (<YOUR_UID>, '<YOUR_HWID>', 'issuer_buildingNumber', '123', true, NOW())
ON CONFLICT (uid, property_name) 
DO UPDATE SET property_value = '123', modify_date = NOW();

-- 8. Issuer Floor
INSERT INTO "otaxdb".clients_info_new (uid, hwid, property_name, property_value, "nonAdminEdit", modify_date)
VALUES (<YOUR_UID>, '<YOUR_HWID>', 'issuer_floor', '5', true, NOW())
ON CONFLICT (uid, property_name) 
DO UPDATE SET property_value = '5', modify_date = NOW();

-- 9. User Type (B = Business, P = Person)
INSERT INTO "LoginDb".clients_info_new (uid, hwid, property_name, property_value, "nonAdminEdit", modify_date)
VALUES (<YOUR_UID>, '<YOUR_HWID>', 'user_type', 'B', true, NOW())
ON CONFLICT (uid, property_name) 
DO UPDATE SET property_value = 'B', modify_date = NOW();

-- 10. Tax Payer Activity Code (4 digits, default: 0000)
INSERT INTO "LoginDb".clients_info_new (uid, hwid, property_name, property_value, "nonAdminEdit", modify_date)
VALUES (<YOUR_UID>, '<YOUR_HWID>', 'tax_payer_activity_code', '0000', true, NOW())
ON CONFLICT (uid, property_name) 
DO UPDATE SET property_value = '0000', modify_date = NOW();

-- ============================================================================
-- STEP 3: Verify Configuration
-- ----------------------------------------------------------------------------
-- Run this query again to verify all required fields are now populated
-- ============================================================================

SELECT 
    property_name,
    property_value,
    CASE 
        WHEN property_value IS NULL OR TRIM(property_value) = '' THEN '❌ MISSING'
        ELSE '✅ OK'
    END as status
FROM "LoginDb".clients_info_new
WHERE uid = (SELECT id FROM "LoginDb".credentials LIMIT 1)
AND property_name IN (
    'issuer_id',
    'issuer_name',
    'issuer_governorate',
    'issuer_street',
    'issuer_country',
    'issuer_branchId',
    'issuer_buildingNumber',
    'issuer_floor',
    'user_type',
    'tax_payer_activity_code'
)
ORDER BY property_name;

-- ============================================================================
-- EXPECTED RESULT
-- ============================================================================
-- All required fields should show ✅ OK:
-- - issuer_id
-- - issuer_name
-- - issuer_governorate
-- - issuer_street
--
-- After this is complete, you can upload your Excel file and submit invoices!
-- ============================================================================

-- ============================================================================
-- QUICK REFERENCE: Egyptian Governorates
-- ============================================================================
-- Use one of these values for issuer_governorate:
-- Cairo, Giza, Alexandria, Dakahlia, Red Sea, Beheira, Fayoum, Gharbiya,
-- Ismailia, Menofia, Minya, Qaliubiya, New Valley, Suez, Aswan, Assiut,
-- Beni Suef, Port Said, Damietta, Sharkia, South Sinai, Kafr El Sheikh,
-- Matrouh, Luxor, Qena, North Sinai, Sohag
-- ============================================================================
