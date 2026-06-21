-- Create all RBAC tables in LoginDb schema
-- Run this SQL in your database client

-- 1. Roles table
CREATE TABLE IF NOT EXISTS "otaxdb".roles (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) UNIQUE NOT NULL,
    display_name VARCHAR(255) NOT NULL,
    description TEXT,
    is_system BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. Permissions table
CREATE TABLE IF NOT EXISTS "otaxdb".permissions (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) UNIQUE NOT NULL,
    display_name VARCHAR(255) NOT NULL,
    description TEXT,
    module VARCHAR(255) NOT NULL,
    action VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. User Roles junction table
CREATE TABLE IF NOT EXISTS "otaxdb".user_roles (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES "otaxdb".credentials(id) ON DELETE CASCADE,
    role_id INTEGER NOT NULL REFERENCES "otaxdb".roles(id) ON DELETE CASCADE,
    assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    assigned_by INTEGER,
    UNIQUE(user_id, role_id)
);

-- 4. Role Permissions junction table
CREATE TABLE IF NOT EXISTS "otaxdb".role_permissions (
    id SERIAL PRIMARY KEY,
    role_id INTEGER NOT NULL REFERENCES "otaxdb".roles(id) ON DELETE CASCADE,
    permission_id INTEGER NOT NULL REFERENCES "otaxdb".permissions(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(role_id, permission_id)
);

-- 5. Sidebar Items
CREATE TABLE IF NOT EXISTS "otaxdb".sidebar_items (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) UNIQUE NOT NULL,
    display_name VARCHAR(255) NOT NULL,
    icon VARCHAR(255),
    path VARCHAR(500) NOT NULL,
    parent_id INTEGER REFERENCES "otaxdb".sidebar_items(id),
    "order" INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    required_permission VARCHAR(255)
);

-- 6. User Sidebar Permissions
CREATE TABLE IF NOT EXISTS "otaxdb".user_sidebar_permissions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    sidebar_item_id INTEGER NOT NULL REFERENCES "otaxdb".sidebar_items(id) ON DELETE CASCADE,
    is_visible BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_by INTEGER,
    UNIQUE(user_id, sidebar_item_id)
);

-- 7. Audit Logs
CREATE TABLE IF NOT EXISTS "otaxdb".audit_logs (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    action VARCHAR(255) NOT NULL,
    target_type VARCHAR(255),
    target_id INTEGER,
    details TEXT,
    ip_address VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 8. User Activity Logs
CREATE TABLE IF NOT EXISTS "otaxdb".user_activity_logs (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    username VARCHAR(255) NOT NULL,
    action VARCHAR(255) NOT NULL,
    module VARCHAR(255),
    resource_type VARCHAR(255),
    resource_id VARCHAR(255),
    details TEXT,
    ip_address VARCHAR(50),
    user_agent TEXT,
    status VARCHAR(50) DEFAULT 'success',
    error_message TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_user_activity_user_id ON "otaxdb".user_activity_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_user_activity_action ON "otaxdb".user_activity_logs(action);
CREATE INDEX IF NOT EXISTS idx_user_activity_created_at ON "otaxdb".user_activity_logs(created_at);

-- 9. User Login History
CREATE TABLE IF NOT EXISTS "otaxdb".user_login_history (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    username VARCHAR(255) NOT NULL,
    login_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    logout_time TIMESTAMP,
    ip_address VARCHAR(50),
    user_agent TEXT,
    device VARCHAR(100),
    browser VARCHAR(100),
    os VARCHAR(100),
    location VARCHAR(255),
    session_duration INTEGER,
    status VARCHAR(50) DEFAULT 'active'
);

CREATE INDEX IF NOT EXISTS idx_login_history_user_id ON "otaxdb".user_login_history(user_id);
CREATE INDEX IF NOT EXISTS idx_login_history_login_time ON "otaxdb".user_login_history(login_time);

-- 10. ETA Sync Status
CREATE TABLE IF NOT EXISTS "otaxdb".eta_sync_status (
    id SERIAL PRIMARY KEY,
    user_id INTEGER UNIQUE NOT NULL,
    username VARCHAR(255) NOT NULL,
    environment VARCHAR(20) DEFAULT 'PreProd',
    last_sync_time TIMESTAMP,
    next_sync_time TIMESTAMP,
    sync_status VARCHAR(50) DEFAULT 'pending',
    total_documents INTEGER DEFAULT 0,
    valid_documents INTEGER DEFAULT 0,
    invalid_documents INTEGER DEFAULT 0,
    rejected_documents INTEGER DEFAULT 0,
    cancelled_documents INTEGER DEFAULT 0,
    submitted_documents INTEGER DEFAULT 0,
    last_error TEXT,
    sync_duration INTEGER,
    is_auto_sync BOOLEAN DEFAULT true,
    sync_interval INTEGER DEFAULT 300,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_eta_sync_user_id ON "otaxdb".eta_sync_status(user_id);
CREATE INDEX IF NOT EXISTS idx_eta_sync_last_sync ON "otaxdb".eta_sync_status(last_sync_time);

-- 11. ETA Sync History
CREATE TABLE IF NOT EXISTS "otaxdb".eta_sync_history (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    username VARCHAR(255) NOT NULL,
    environment VARCHAR(20) NOT NULL,
    sync_start_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    sync_end_time TIMESTAMP,
    sync_duration INTEGER,
    status VARCHAR(50) NOT NULL,
    documents_found INTEGER DEFAULT 0,
    documents_added INTEGER DEFAULT 0,
    documents_updated INTEGER DEFAULT 0,
    documents_failed INTEGER DEFAULT 0,
    error_message TEXT,
    error_details TEXT,
    api_calls_count INTEGER DEFAULT 0,
    date_range_from TIMESTAMP,
    date_range_to TIMESTAMP,
    triggered_by VARCHAR(50) DEFAULT 'auto'
);

CREATE INDEX IF NOT EXISTS idx_eta_history_user_id ON "otaxdb".eta_sync_history(user_id);
CREATE INDEX IF NOT EXISTS idx_eta_history_start_time ON "otaxdb".eta_sync_history(sync_start_time);
CREATE INDEX IF NOT EXISTS idx_eta_history_status ON "otaxdb".eta_sync_history(status);

-- 12. ETA Credentials
CREATE TABLE IF NOT EXISTS "otaxdb".eta_credentials (
    id SERIAL PRIMARY KEY,
    user_id INTEGER UNIQUE NOT NULL,
    environment VARCHAR(20) DEFAULT 'PreProd',
    client_id TEXT,
    client_secret TEXT,
    tax_id VARCHAR(50),
    is_active BOOLEAN DEFAULT true,
    last_validated TIMESTAMP,
    validation_status VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_eta_creds_user_id ON "otaxdb".eta_credentials(user_id);

-- 13. User Preferences
CREATE TABLE IF NOT EXISTS "otaxdb".user_preferences (
    id SERIAL PRIMARY KEY,
    user_id INTEGER UNIQUE NOT NULL,
    theme VARCHAR(20) DEFAULT 'light',
    language VARCHAR(10) DEFAULT 'en',
    timezone VARCHAR(50) DEFAULT 'Africa/Cairo',
    date_format VARCHAR(20) DEFAULT 'DD/MM/YYYY',
    currency VARCHAR(10) DEFAULT 'EGP',
    notifications BOOLEAN DEFAULT true,
    email_notifications BOOLEAN DEFAULT true,
    auto_sync BOOLEAN DEFAULT true,
    sync_interval INTEGER DEFAULT 300,
    default_view VARCHAR(50),
    items_per_page INTEGER DEFAULT 50,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Verify tables were created
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'LoginDb'
ORDER BY table_name;
