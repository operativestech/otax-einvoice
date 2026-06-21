# Database Setup Instructions

## Issue: LoginDb.credentials table doesn't exist

The error shows that the `credentials` table is not in your database. We need to create it.

## Solution: Run this SQL in your PostgreSQL database

### Option 1: Using pgAdmin or DBeaver

1. Connect to your database:
   - Host: `postgresql-17417-0.cloudclusters.net`
   - Port: `17417`
   - Database: `LoginDb`
   - User: `admin`
   - Password: `admin123$456`

2. Run this SQL:

```sql
-- Create LoginDb schema if it doesn't exist
CREATE SCHEMA IF NOT EXISTS "LoginDb";

-- Create credentials table
CREATE TABLE IF NOT EXISTS "LoginDb".credentials (
    id SERIAL PRIMARY KEY,
    username VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    hwid VARCHAR(255),
    "isValid" BOOLEAN DEFAULT true,
    "isDemo" BOOLEAN DEFAULT false,
    "registerDate" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    "expiryDate" TIMESTAMP,
    "configHash" VARCHAR(255)
);

-- Create clients_info_new table
CREATE TABLE IF NOT EXISTS "LoginDb".clients_info_new (
    id SERIAL PRIMARY KEY,
    uid INTEGER NOT NULL REFERENCES "LoginDb".credentials(id) ON DELETE CASCADE,
    property_name VARCHAR(255) NOT NULL,
    property_value TEXT,
    "nonAdminEdit" BOOLEAN DEFAULT false,
    modify_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create index for better performance
CREATE INDEX IF NOT EXISTS idx_clients_info_uid ON "LoginDb".clients_info_new(uid);

-- Verify tables were created
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'LoginDb';
```

### Option 2: Using psql command line

```bash
psql "postgresql://admin:admin123$456@postgresql-17417-0.cloudclusters.net:17417/LoginDb" -f prisma/migrations/create_credentials_table.sql
```

### Option 3: Let Prisma create all tables

Run this command to let Prisma create ALL the RBAC tables:

```bash
npx prisma db push --accept-data-loss
```

**Warning:** This will create all tables but may drop existing data if there are conflicts.

## After Creating Tables

Once the tables are created, run the seed script to create admin and demo users:

```bash
npx tsx prisma/seed.ts
```

This will create:
- **Admin user**: username `admin`, password `admin123`
- **Demo user**: username `demo`, password `demo123`

## Verify

Check that users were created:

```sql
SELECT id, username, "isDemo", "isValid" 
FROM "LoginDb".credentials;
```

Expected output:
```
 id | username | isDemo | isValid 
----+----------+--------+---------
  1 | admin    | f      | t
  2 | demo     | t      | t
```

## Then Test Login

```bash
curl -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}'
```
