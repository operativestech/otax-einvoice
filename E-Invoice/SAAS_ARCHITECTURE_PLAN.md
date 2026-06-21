# 🏢 SaaS Multi-Tenant Architecture Plan

## Current Issue:
The system treats all users globally without company isolation. We need to add **Organizations/Companies** as the top-level entity.

## New Architecture:

### 1. **Organizations (Companies)**
- Each company is an organization
- Has company info (tax ID, name, address, logo, etc.)
- Has subscription/plan information
- Has ETA credentials per organization

### 2. **Users belong to Organizations**
- Each user belongs to ONE organization
- Users have roles WITHIN their organization
- Admin of Company A cannot see Company B's data

### 3. **Data Isolation**
- Invoices belong to organizations
- ETA sync is per organization
- Settings are per organization
- Audit logs are per organization

## Database Changes Needed:

### New Tables:
1. **organizations** - Company/tenant information
2. **organization_settings** - Company-specific settings
3. **organization_subscriptions** - Billing/plan info

### Modified Tables:
1. **credentials** - Add `organizationId`
2. **user_roles** - Roles are scoped to organization
3. **eta_credentials** - Per organization, not per user
4. **synced_invoices** - Belong to organization
5. **eta_sync_status** - Per organization

### Key Concepts:
- **Organization Admin** - Can manage users within their company
- **Super Admin** - Platform admin (manages all organizations)
- **Organization Isolation** - Row-level security ensures data separation

## Implementation Steps:
1. Create organization tables
2. Migrate existing data to default organization
3. Update all queries to filter by organizationId
4. Add organization context to authentication
5. Update UI to show organization info
6. Add organization switcher (if user belongs to multiple orgs)

Would you like me to implement this SaaS architecture?
