-- SaaS Multi-Tenant: Add Organizations and Update Existing Tables
-- Run this SQL to add organization support

-- 1. Create Organizations table (Companies/Tenants)
CREATE TABLE IF NOT EXISTS "LoginDb".organizations (
    id SERIAL PRIMARY KEY,
    name VARCHAR(500) NOT NULL,
    tax_id VARCHAR(50) UNIQUE NOT NULL,
    company_type VARCHAR(50),
    
    -- Contact Info
    email VARCHAR(255),
    phone VARCHAR(50),
    website VARCHAR(255),
    
    -- Address
    country VARCHAR(100),
    governorate VARCHAR(100),
    city VARCHAR(100),
    street VARCHAR(500),
    building_number VARCHAR(50),
    postal_code VARCHAR(20),
    
    -- Branding
    logo_url TEXT,
    primary_color VARCHAR(20) DEFAULT '#1e40af',
    
    -- Settings
    language VARCHAR(10) DEFAULT 'en',
    timezone VARCHAR(50) DEFAULT 'Africa/Cairo',
    currency VARCHAR(10) DEFAULT 'EGP',
    
    -- Status
    is_active BOOLEAN DEFAULT true,
    subscription_plan VARCHAR(50) DEFAULT 'free', -- free, basic, premium, enterprise
    subscription_expires_at TIMESTAMP,
    
    -- Metadata
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by INTEGER
);

CREATE INDEX IF NOT EXISTS idx_org_tax_id ON "LoginDb".organizations(tax_id);
CREATE INDEX IF NOT EXISTS idx_org_active ON "LoginDb".organizations(is_active);

-- 2. Add organizationId to credentials (users)
ALTER TABLE "LoginDb".credentials 
ADD COLUMN IF NOT EXISTS organization_id INTEGER REFERENCES "LoginDb".organizations(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_credentials_org ON "LoginDb".credentials(organization_id);

-- 3. Organization Settings (per company)
CREATE TABLE IF NOT EXISTS "LoginDb".organization_settings (
    id SERIAL PRIMARY KEY,
    organization_id INTEGER UNIQUE NOT NULL REFERENCES "LoginDb".organizations(id) ON DELETE CASCADE,
    
    -- ETA Settings
    eta_environment VARCHAR(20) DEFAULT 'PreProd',
    eta_client_id TEXT,
    eta_client_secret TEXT,
    eta_auto_sync BOOLEAN DEFAULT true,
    eta_sync_interval INTEGER DEFAULT 300,
    
    -- Invoice Settings
    invoice_prefix VARCHAR(20),
    invoice_start_number INTEGER DEFAULT 1,
    default_payment_terms INTEGER DEFAULT 30,
    
    -- Notification Settings
    email_notifications BOOLEAN DEFAULT true,
    sms_notifications BOOLEAN DEFAULT false,
    webhook_url TEXT,
    
    -- Custom Fields (JSON)
    custom_settings TEXT,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 4. Organization Subscriptions
CREATE TABLE IF NOT EXISTS "LoginDb".organization_subscriptions (
    id SERIAL PRIMARY KEY,
    organization_id INTEGER NOT NULL REFERENCES "LoginDb".organizations(id) ON DELETE CASCADE,
    
    plan VARCHAR(50) NOT NULL, -- free, basic, premium, enterprise
    status VARCHAR(50) DEFAULT 'active', -- active, expired, cancelled, suspended
    
    -- Limits
    max_users INTEGER DEFAULT 5,
    max_invoices_per_month INTEGER DEFAULT 100,
    max_storage_gb INTEGER DEFAULT 5,
    
    -- Billing
    price_per_month DECIMAL(10,2),
    billing_cycle VARCHAR(20) DEFAULT 'monthly', -- monthly, yearly
    
    -- Dates
    starts_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP,
    cancelled_at TIMESTAMP,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_org_sub_org ON "LoginDb".organization_subscriptions(organization_id);
CREATE INDEX IF NOT EXISTS idx_org_sub_status ON "LoginDb".organization_subscriptions(status);

-- 5. Update ETA Credentials to be per organization
ALTER TABLE "LoginDb".eta_credentials 
ADD COLUMN IF NOT EXISTS organization_id INTEGER REFERENCES "LoginDb".organizations(id) ON DELETE CASCADE;

-- Remove user_id unique constraint and add organization_id unique
ALTER TABLE "LoginDb".eta_credentials DROP CONSTRAINT IF EXISTS eta_credentials_user_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_eta_creds_org_unique ON "LoginDb".eta_credentials(organization_id) WHERE organization_id IS NOT NULL;

-- 6. Update ETA Sync Status to be per organization
ALTER TABLE "LoginDb".eta_sync_status 
ADD COLUMN IF NOT EXISTS organization_id INTEGER REFERENCES "LoginDb".organizations(id) ON DELETE CASCADE;

-- 7. Organization Invitations (for inviting users to join)
CREATE TABLE IF NOT EXISTS "LoginDb".organization_invitations (
    id SERIAL PRIMARY KEY,
    organization_id INTEGER NOT NULL REFERENCES "LoginDb".organizations(id) ON DELETE CASCADE,
    
    email VARCHAR(255) NOT NULL,
    role_id INTEGER REFERENCES "LoginDb".roles(id),
    
    token VARCHAR(255) UNIQUE NOT NULL,
    status VARCHAR(50) DEFAULT 'pending', -- pending, accepted, expired, cancelled
    
    invited_by INTEGER REFERENCES "LoginDb".credentials(id),
    accepted_by INTEGER REFERENCES "LoginDb".credentials(id),
    
    expires_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    accepted_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_org_inv_org ON "LoginDb".organization_invitations(organization_id);
CREATE INDEX IF NOT EXISTS idx_org_inv_token ON "LoginDb".organization_invitations(token);

-- 8. Organization Audit Logs (company-specific)
CREATE TABLE IF NOT EXISTS "LoginDb".organization_audit_logs (
    id SERIAL PRIMARY KEY,
    organization_id INTEGER NOT NULL REFERENCES "LoginDb".organizations(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES "LoginDb".credentials(id),
    
    action VARCHAR(255) NOT NULL,
    resource_type VARCHAR(100),
    resource_id VARCHAR(100),
    details TEXT,
    
    ip_address VARCHAR(50),
    user_agent TEXT,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_org_audit_org ON "LoginDb".organization_audit_logs(organization_id);
CREATE INDEX IF NOT EXISTS idx_org_audit_user ON "LoginDb".organization_audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_org_audit_created ON "LoginDb".organization_audit_logs(created_at);

-- 9. Create a default organization for existing data
INSERT INTO "LoginDb".organizations (name, tax_id, is_active, subscription_plan)
VALUES ('Default Organization', '000000000', true, 'enterprise')
ON CONFLICT (tax_id) DO NOTHING;

-- 10. Assign existing users to default organization
UPDATE "LoginDb".credentials 
SET organization_id = (SELECT id FROM "LoginDb".organizations WHERE tax_id = '000000000')
WHERE organization_id IS NULL;

-- Verify
SELECT 
    o.id,
    o.name,
    o.tax_id,
    COUNT(c.id) as user_count
FROM "LoginDb".organizations o
LEFT JOIN "LoginDb".credentials c ON c.organization_id = o.id
GROUP BY o.id, o.name, o.tax_id;
