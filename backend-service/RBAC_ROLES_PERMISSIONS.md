# OTax SaaS — Roles, Permissions & Access Control

## Overview

OTax uses a **3-tier role hierarchy** for multi-tenant SaaS access control:

```
Super Admin (Platform Level)
  └── Org Admin (Organization Level)
        └── Users (manager, accountant, viewer)
```

---

## 🎭 Roles

| # | Role | Display Name | System Role | Description |
|---|------|-------------|:-----------:|-------------|
| 1 | `super_admin` | Super Administrator | ✅ | Platform-level admin — manages all organizations, users, and platform settings |
| 2 | `org_admin` | Organization Admin | ✅ | Organization-level admin — manages users and settings within their own organization |
| 3 | `admin` | Administrator | ✅ | Legacy admin role (backward compatibility) — similar to org_admin |
| 4 | `manager` | Manager | ❌ | Can manage invoices and view reports within their organization |
| 5 | `accountant` | Accountant | ❌ | Can create and manage invoices within their organization |
| 6 | `viewer` | Viewer | ❌ | Read-only access to invoices and reports within their organization |

---

## 🔐 Permissions (29 Total)

### Dashboard Module
| Permission | Description |
|-----------|-------------|
| `dashboard.view` | Access to main dashboard |

### Invoices Module
| Permission | Description |
|-----------|-------------|
| `invoices.view` | View invoice list and details |
| `invoices.create` | Create new invoices |
| `invoices.edit` | Edit existing invoices |
| `invoices.delete` | Delete invoices |
| `invoices.cancel` | Cancel submitted invoices |

### Reports Module
| Permission | Description |
|-----------|-------------|
| `reports.view` | Access reports section |
| `reports.export` | Export reports to PDF/Excel |

### Settings Module
| Permission | Description |
|-----------|-------------|
| `settings.view` | Access settings page |
| `settings.edit` | Modify system settings |

### User Management Module
| Permission | Description |
|-----------|-------------|
| `users.view` | View user list in organization |
| `users.create` | Create new users in organization |
| `users.edit` | Edit user details in organization |
| `users.delete` | Delete users from organization |
| `users.manage_roles` | Assign/remove roles from users |

### Master Data Module
| Permission | Description |
|-----------|-------------|
| `masterdata.view` | Access master data |
| `masterdata.edit` | Modify master data |

### ERP Module
| Permission | Description |
|-----------|-------------|
| `erp.view` | Access ERP connector |
| `erp.configure` | Configure ERP connections |

### Organization Management Module *(Super Admin Only)*
| Permission | Description |
|-----------|-------------|
| `organizations.view` | View all organizations on the platform |
| `organizations.create` | Create new organizations |
| `organizations.edit` | Edit organization details |
| `organizations.delete` | Delete organizations |
| `organizations.manage` | Manage org subscriptions, plans, and activation |

### Org-Scoped User Management *(Org Admin)*
| Permission | Description |
|-----------|-------------|
| `org_users.view` | View users in own organization |
| `org_users.create` | Create users in own organization |
| `org_users.edit` | Edit users in own organization |
| `org_users.delete` | Delete users from own organization |

---

## 🔗 Role → Permission Matrix

| Permission | Super Admin | Org Admin | Admin (Legacy) | Manager | Accountant | Viewer |
|------------|:-----------:|:---------:|:--------------:|:-------:|:----------:|:------:|
| **Dashboard** | | | | | | |
| `dashboard.view` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Invoices** | | | | | | |
| `invoices.view` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `invoices.create` | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| `invoices.edit` | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| `invoices.delete` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `invoices.cancel` | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| **Reports** | | | | | | |
| `reports.view` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `reports.export` | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| **Settings** | | | | | | |
| `settings.view` | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| `settings.edit` | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| **User Management** | | | | | | |
| `users.view` | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| `users.create` | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| `users.edit` | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| `users.delete` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `users.manage_roles` | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| **Master Data** | | | | | | |
| `masterdata.view` | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ |
| `masterdata.edit` | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| **ERP** | | | | | | |
| `erp.view` | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| `erp.configure` | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| **Org Users (Org-Scoped)** | | | | | | |
| `org_users.view` | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| `org_users.create` | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| `org_users.edit` | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| `org_users.delete` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Organization Management** | | | | | | |
| `organizations.view` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `organizations.create` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `organizations.edit` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `organizations.delete` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `organizations.manage` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |

---

## 👥 Default Users

| Username | Password | Role | Organization | Purpose |
|----------|----------|------|-------------|---------|
| `admin` | `admin123` | Super Admin | OTax Platform | Platform management — full access |
| `orgadmin` | `orgadmin123` | Org Admin | Sample Company | Organization management — manages users within the org |
| `demo` | `demo123` | Viewer | Sample Company | Demo/read-only access — cannot modify data |

> ⚠️ **Change all default passwords before deploying to production!**

---

## 🏢 Default Organizations

| Organization | Tax ID | Plan | Max Users | Max Invoices/Month | Storage |
|-------------|--------|------|:---------:|:------------------:|:-------:|
| OTax Platform | PLATFORM-001 | Enterprise | 999 | 999,999 | 100 GB |
| Sample Company | SAMPLE-ORG-001 | Professional | 10 | 500 | 10 GB |

---

## 📋 Subscription Plans

| Plan | Max Users | Max Invoices/Month | Storage | Price/Month |
|------|:---------:|:------------------:|:-------:|:-----------:|
| Free | 3 | 50 | 1 GB | $0 |
| Starter | 5 | 200 | 5 GB | $199 |
| Professional | 15 | 1,000 | 20 GB | $499 |
| Enterprise | 999 | 999,999 | 100 GB | $999 |

---

## 🔒 Access Control Rules

### Super Admin
- Bypasses **all** permission checks
- Can access **any** organization via `?orgId=` query parameter
- Can create, edit, delete, activate/deactivate organizations
- Can manage subscriptions and plans for any organization
- Can add/remove users in any organization

### Org Admin
- Can manage users **only within their own organization**
- Cannot access organization management (create/delete orgs)
- Cannot change their own organization's subscription plan or tax ID
- Subject to subscription limits (max users, max invoices)

### Standard Users (Manager, Accountant, Viewer)
- Access restricted to their own organization's data
- Cannot manage users or roles
- Subject to subscription limits
- Viewer role is read-only (cannot create, edit, or delete anything)

### Demo Users
- Blocked from all write operations (POST, PUT, DELETE)
- Can only view data (GET requests)

---

## 📱 Sidebar Navigation

| # | Item | Icon | Path | Required Permission |
|---|------|------|------|-------------------|
| 1 | Dashboard | LayoutDashboard | `/` | `dashboard.view` |
| 2 | Invoices | FileText | `/invoices` | `invoices.view` |
| 3 | Create Invoice | FilePlus | `/invoice-excel` | `invoices.create` |
| 4 | Reports | BarChart3 | `/reports` | `reports.view` |
| 5 | Master Data | Database | `/master-data` | `masterdata.view` |
| 6 | ERP Connector | Link | `/erp-connector` | `erp.view` |
| 7 | Settings | Settings | `/settings` | `settings.view` |
| 8 | User Management | Users | `/admin/users` | `org_users.view` |
| 9 | Organizations | Building2 | `/super-admin` | `organizations.view` |

> Sidebar items are shown/hidden based on the user's permissions. Only Super Admins see "Organizations".

---

*Document generated for OTax SaaS Platform — Last updated: February 2026*
