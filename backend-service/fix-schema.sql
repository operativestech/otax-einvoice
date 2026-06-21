-- Run this SQL directly in your database client (pgAdmin, DBeaver, etc.)
-- Or save as fix-schema.sql and run: psql -h postgresql-17417-0.cloudclusters.net -p 17417 -U admin -d LoginDb -f fix-schema.sql

-- Step 1: Create LoginDb schema
CREATE SCHEMA IF NOT EXISTS "otaxdb";

-- Step 2: Move credentials table from public to LoginDb
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_name = 'credentials'
    ) THEN
        ALTER TABLE public.credentials SET SCHEMA "otaxdb";
        RAISE NOTICE 'Moved credentials table to LoginDb schema';
    ELSE
        RAISE NOTICE 'credentials table not found in public schema';
    END IF;
END $$;

-- Step 3: Move clients_info_new table from public to LoginDb  
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_name = 'clients_info_new'
    ) THEN
        ALTER TABLE public.clients_info_new SET SCHEMA "otaxdb";
        RAISE NOTICE 'Moved clients_info_new table to LoginDb schema';
    ELSE
        RAISE NOTICE 'clients_info_new table not found in public schema';
    END IF;
END $$;

-- Step 4: Verify tables are in LoginDb schema
SELECT 
    table_schema, 
    table_name,
    'SUCCESS - Table is in correct schema' as status
FROM information_schema.tables 
WHERE table_schema = 'LoginDb' 
AND table_name IN ('credentials', 'clients_info_new')
ORDER BY table_name;

-- Step 5: Show existing users
SELECT 
    id, 
    username, 
    "isDemo", 
    "isValid",
    'User found in LoginDb.credentials' as status
FROM "otaxdb".credentials
LIMIT 10;
