-- SQL Script to Update LoginDb.credentials table for RBAC system
-- Run this in your PostgreSQL database

-- First, check if the credentials table exists in LoginDb schema
-- If it doesn't exist, create it

CREATE SCHEMA IF NOT EXISTS "otaxdb";

-- Create or update the credentials table
CREATE TABLE IF NOT EXISTS "otaxdb".credentials (
    id SERIAL PRIMARY KEY,
    username VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    hwid VARCHAR(255),
    "isValid" BOOLEAN DEFAULT true,
    "isDemo" BOOLEAN DEFAULT false,
    "registerDate" TIMESTAMP,
    "expiryDate" TIMESTAMP,
    "configHash" VARCHAR(255)
);

-- If the table already exists but is missing columns, add them
DO $$ 
BEGIN
    -- Add isDemo column if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'LoginDb' 
        AND table_name = 'credentials' 
        AND column_name = 'isDemo'
    ) THEN
        ALTER TABLE "otaxdb".credentials ADD COLUMN "isDemo" BOOLEAN DEFAULT false;
    END IF;

    -- Add isValid column if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'LoginDb' 
        AND table_name = 'credentials' 
        AND column_name = 'isValid'
    ) THEN
        ALTER TABLE "otaxdb".credentials ADD COLUMN "isValid" BOOLEAN DEFAULT true;
    END IF;

    -- Add registerDate column if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'LoginDb' 
        AND table_name = 'credentials' 
        AND column_name = 'registerDate'
    ) THEN
        ALTER TABLE "otaxdb".credentials ADD COLUMN "registerDate" TIMESTAMP;
    END IF;

    -- Add expiryDate column if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'LoginDb' 
        AND table_name = 'credentials' 
        AND column_name = 'expiryDate'
    ) THEN
        ALTER TABLE "otaxdb".credentials ADD COLUMN "expiryDate" TIMESTAMP;
    END IF;

    -- Add configHash column if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'LoginDb' 
        AND table_name = 'credentials' 
        AND column_name = 'configHash'
    ) THEN
        ALTER TABLE "otaxdb".credentials ADD COLUMN "configHash" VARCHAR(255);
    END IF;

    -- Add hwid column if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'LoginDb' 
        AND table_name = 'credentials' 
        AND column_name = 'hwid'
    ) THEN
        ALTER TABLE "otaxdb".credentials ADD COLUMN "hwid" VARCHAR(255);
    END IF;
END $$;

-- Create clients_info_new table if it doesn't exist
CREATE TABLE IF NOT EXISTS "otaxdb".clients_info_new (
    id SERIAL PRIMARY KEY,
    uid INTEGER NOT NULL,
    property_name VARCHAR(255) NOT NULL,
    property_value TEXT,
    "nonAdminEdit" BOOLEAN,
    modify_date TIMESTAMP,
    FOREIGN KEY (uid) REFERENCES "otaxdb".credentials(id) ON DELETE CASCADE
);

-- Create index on uid for better performance
CREATE INDEX IF NOT EXISTS idx_clients_info_uid ON "otaxdb".clients_info_new(uid);

-- Display current structure
SELECT 
    column_name, 
    data_type, 
    is_nullable,
    column_default
FROM information_schema.columns 
WHERE table_schema = 'LoginDb' 
AND table_name = 'credentials'
ORDER BY ordinal_position;
