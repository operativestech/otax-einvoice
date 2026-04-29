# OTax Project Audit — Docs vs Reality

> **Date:** March 14, 2026  
> **Scope:** Comparing the 4 spec documents against the actual codebase

> [!IMPORTANT]
> The 4 documentation files describe an **idealized architecture** (`/api/otax/*`, Prisma ORM, modular controllers, 44 endpoints). The actual project evolved differently — monolithic `server.ts` + route files, raw `pg` Pool, `clients_info_new` settings table. **This is normal for a rapidly-evolving product.** The docs are aspirational blueprints, not an exact mirror of what was built.

---

## Architecture Comparison

| Aspect | Docs Say | Actual |
|--------|----------|--------|
| API Prefix | `/api/otax/*` | `/api/*` |
| DB Access | Prisma ORM, factory pattern | Raw `pg.Pool`, direct SQL |
| Auth | ETA OAuth 2.0 per-company | JWT (username/password) + `clients_info_new` for ETA creds |
| Structure | 11 controller files, service layer | Monolithic `server.ts` (5949 lines) + 6 route files |
| DB Schema | 12 tables via Prisma schema | Dynamic org tables + `credentials` + `clients_info_new` |
| Frontend | Next.js + shadcn + Zustand + React Query | Vite + React + vanilla CSS + `useState` |

---

## Feature-by-Feature Status

### ✅ DONE — Fully Implemented (33)

| # | Feature | Where in Code |
|---|---------|---------------|
| 1 | **Auth: Login / Signup / Logout** | `authRoutes.ts`, `Login.tsx`, `Signup.tsx` |
| 2 | **Auth: OTP Verification** | `authRoutes.ts` → `/verify-otp`, `/resend-otp` |
| 3 | **Auth: Forgot/Reset Password** | `authRoutes.ts` → `/forgot-password`, `/reset-password` |
| 4 | **Auth: Invite / Join Org** | `authRoutes.ts` → `/invite`, `/join-org`, `/invite/:token/accept` |
| 5 | **Dashboard (Summary View)** | `Dashboard.tsx`, `apiService.getDashboardSummary()` |
| 6 | **Document List (Invoice Mgmt)** | `Invoices.tsx`, `etaRoutes.ts` → `/local/documents` |
| 7 | **Document Detail View** | `etaRoutes.ts` → `/documents/:uuid/details` |
| 8 | **Document Search (ETA Portal)** | `etaRoutes.ts` → `/documents/search` |
| 9 | **Download PDF** | `etaRoutes.ts` → `/documents/:uuid/pdf` |
| 10 | **Submit Invoice (Excel Upload)** | `InvoiceExcel.tsx`, `server.ts` → `/api/excel/submit` |
| 11 | **Submit Invoice (Manual Entry)** | `ManualInvoice.tsx` — **redesigned today** (Header + Lines + Send to ETA) |
| 12 | **Submit via New ETA Route** | `etaRoutes.ts` → `/documents/submit` |
| 13 | **Portal Sync (Pull from ETA)** | `etaRoutes.ts` → `/sync/start`, `/sync/status`, `/sync/delta` |
| 14 | **ETA Test Connection** | `etaRoutes.ts` → `/test-connection` |
| 15 | **Item Codes (Search/Submit/Sync)** | `etaRoutes.ts` → `/codes/search`, `/codes`, `/codes/sync`, `/codes/my-requests` |
| 16 | **Digital Signatures (Agent Bridge)** | `signingRoutes.ts` — PFX upload, agent bridge, test |
| 17 | **Settings / Company Info** | `Settings.tsx`, `admin.ts` → `/me`, `/organization` |
| 18 | **User Management / Roles** | `UserManagement.tsx`, `admin.ts` → `/users`, `/roles`, `/permissions` |
| 19 | **Super Admin Panel** | `SuperAdminOrganizations.tsx`, `SuperAdminRoles.tsx`, etc. |
| 20 | **Setup Wizard (Onboarding)** | `Wizard.tsx` — 6 steps |
| 21 | **ETA Notifications** | `etaRoutes.ts` → `/notifications` |
| 22 | **Document Types / Versions** | `etaRoutes.ts` → `/document-types`, `/document-types/:id/versions/:vid` |
| 23 | **ETA Packages** | `etaRoutes.ts` → `/packages/request`, `/packages/:id` |
| 24 | **Reports Page** | `Reports.tsx` |
| 25 | **Live Console (Real-time logs)** | WebSocket + `live-console-log` custom events |
| 26 | **ERP Connector Page** | `ERPConnector.tsx` |
| 27 | **Master Data Page** | `MasterData.tsx` |
| 28 | **Profile Settings** | `ProfileSettings.tsx` |
| 29 | **Customer Portal** | `CustomerPortal.tsx` |
| 30 | **ETA Reference** | `ETAReference.tsx` |
| 31 | **Export to ETA** | `ExportToETA.tsx` |
| 32 | **System Health Page** | `SystemHealth.tsx` |
| 33 | **Activity Logs & Login History** | `admin.ts` → `/activity-logs`, `/login-history` |
| 34 | **Cancel/Reject Document** | `etaRoutes.ts` → `/documents/:uuid/cancel`, `/reject`, `/decline-rejection`, `/decline-cancellation` + frontend context menu + bulk cancel |
| 35 | **Batch Submit with Job Tracking** | `server.ts` → `POST /api/excel/batch-submit` (async, returns jobId) + `GET /api/excel/batch-status/:jobId` (polling) + frontend progress bar |
| 36 | **Reports: Gap Analysis** | `server.ts` → `GET /api/reports/gap-analysis` (monthly Sent vs Received comparison) + `Reports.tsx` Gap Analysis tab with summary cards + breakdown table |
| 37 | **Reports: Statistics** | `server.ts` → `GET /api/reports/statistics` (invoicesByStatus, invoicesByMonth, topReceivers, topIssuers, growth rate) + `Reports.tsx` Statistics tab with charts and tables |
| 38 | **Sync: History/Progress** | `etaRoutes.ts` → `GET /api/eta/sync/history` + in-memory sync history tracking (per-org, auto-records start/complete/error) + `Settings.tsx` 'Last synced' indicator + collapsible history table |

---

### ⚠️ PARTIALLY DONE (5)

| # | Feature | Done | Missing |
|---|---------|------|---------|






---

### ❌ NOT DONE — Missing Entirely (10)

| # | Feature | Priority | Notes |
|---|---------|----------|-------|
| 1 | **Reconciliation Dashboard** | P1 High | 3-column unmatched view (ERP/Bank/ETA), Auto-Match AI, Manual Match, Approve/Reject. **No backend, no frontend** |
| 2 | **ERP Transaction Sync** | P1 High | Import AR/AP from external ERP. No endpoint |
| 3 | **Bank Statement Upload** | P1 High | Upload bank CSV statements. No endpoint |
| 4 | **Auto-Match Engine (AI Multi-Pass)** | P1 High | Perfect/WHT/FX/Manual matching algorithm. Not implemented |
| 5 | **Reconciliation Matches CRUD** | P1 High | Create/Approve/Reject matches. No endpoints |
| 6 | **Gap Analysis Report** | P1 High | Portal vs ERP liability comparison. No calculation logic |
| 7 | **Digital Signature Queue** | P2 Medium | `/signature/queue`, `/receive`, `/pending` — current implementation uses direct bridge/PFX, no queue |
| 8 | **Taxpayer Info Lookup** | Low | `/taxpayer/info/:taxNumber`. No endpoint |
| 9 | **AI Database Views (4)** | Low | `VW_AI_OTAX_SUMMARY`, `VW_AI_OTAX_UNMATCHED`, etc. No SQL views |
| 10 | **Export to Excel/PDF** | P2 Medium | Export reports. Not implemented |

---

## Summary Scoreboard

| Category | Done ✅ | Partial ⚠️ | Missing ❌ | Total |
|----------|--------|-----------|-----------|-------|
| **Auth & Users** | 10 | 0 | 0 | **10** |
| **Documents & Invoices** | 9 | 0 | 0 | **9** |
| **Portal Sync** | 4 | 0 | 0 | **4** |
| **Batch Operations** | 2 | 0 | 0 | **2** |
| **Reconciliation** | 0 | 0 | 5 | **5** |
| **Reports & Analytics** | 3 | 0 | 2 | **5** |
| **Digital Signatures** | 3 | 0 | 1 | **4** |
| **Other (Codes, Health…)** | 7 | 0 | 2 | **9** |
| **TOTAL** | **38** | **0** | **10** | **48** |

> **Completion: ~79% fully done, 0% partial, 21% missing**

---

## Extra Features Built (Not in Docs — 12)

| Feature | Location |
|---------|----------|
| Dynamic multi-tenant org tables | `orgTables.ts` |
| SaaS onboarding wizard (6-step) | `Wizard.tsx` |
| OTax Agent Bridge (WebSocket remote signing) | `bridgeService`, `signingRoutes.ts` |
| PFX Cloud Signing (no USB) | `pfxSigner.ts` |
| Super Admin multi-org management | `superAdmin.ts`, 4 pages |
| Customer Portal | `CustomerPortal.tsx` |
| ERP Connector page | `ERPConnector.tsx` |
| Master Data page | `MasterData.tsx` |
| Lead capture | `leads.ts` |
| OTP & email verification | `authRoutes.ts` |
| Subscription plans & limits | `superAdmin.ts` → `/plans` |
| Dashboard Creator | `DashboardCreator.tsx` |

---

## Recommended Next Steps

1. **Cancel / Reject buttons** on Invoice Detail — quick win
2. **Gap Analysis Report** — backend calculation + frontend chart
3. **Export to Excel/PDF** from Reports
4. **Reconciliation Dashboard (Phase 3)** — biggest missing feature
5. **Async Batch Job System** — needs job table + polling
6. **Update the 4 docs** to reflect actual architecture
