# OTax Backend - Complete API Documentation

**Version:** 1.0 (Production Validated)  
**Last Updated:** January 22, 2026  
**Status:** ✅ Production Ready

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Authentication](#authentication)
4. [API Endpoints](#api-endpoints)
5. [Database Schema](#database-schema)
6. [Configuration](#configuration)
7. [Deployment](#deployment)
8. [Testing & Validation](#testing--validation)

---

## Overview

The OTax backend is a comprehensive Egyptian Tax Authority (ETA) integration system providing full e-invoicing capabilities, multi-pass reconciliation, digital signature workflows, and AI-powered analytics.

### Key Features

- **44 Production API Endpoints** across 11 controllers
- **ETA API v1.0 Integration** (validated with production)
- **OAuth 2.0 Authentication** with auto-refresh
- **Multi-pass Reconciliation Engine** (Perfect, WHT, FX, Manual)
- **Digital Signature Workflow** (USB token support)
- **Batch Operations** (100+ documents)
- **AI Database Views** (4 optimized views)
- **Gap Analysis Reporting**

### Production Validation

✅ **Successfully tested with real ETA production API**
- 24 documents synced from production portal
- 100% success rate
- Documents ranging from 1.14 to 2,220 EGP
- Auth: `https://id.eta.gov.eg`
- API: `https://api.invoicing.eta.gov.eg`

---

## Architecture

### Technology Stack

- **Runtime:** Node.js v18+
- **Framework:** Express.js
- **Database:** PostgreSQL (Render Cloud)
- **ORM:** Prisma
- **Authentication:** OAuth 2.0 (ETA Identity Service)
- **API Version:** ETA API v1.0

### Directory Structure

```
server/
├── src/
│   ├── controllers/otax/     # API controllers (11 files)
│   ├── routes/otax/          # Route definitions
│   ├── services/otax/        # ETA API service
│   ├── config/               # Database factory
│   └── middleware/           # Request middleware
├── prisma/
│   ├── otax.prisma          # Database schema
│   └── migrations/          # SQL migrations
└── sync-eta-production.js   # Production sync script
```

### Database: `otax_sv1`

**Connection:** PostgreSQL on Render  
**Tables:** 12  
**Views:** 4 AI-optimized views  
**Access:** Via Prisma client factory

---

## Authentication

### ETA OAuth 2.0 Flow

**Auth Endpoint:** `https://id.eta.gov.eg/connect/token`

#### Request

```http
POST /connect/token HTTP/1.1
Host: id.eta.gov.eg
Content-Type: application/x-www-form-urlencoded

grant_type=client_credentials
&client_id=YOUR_CLIENT_ID
&client_secret=YOUR_CLIENT_SECRET
&scope=InvoicingAPI
```

#### Response

```json
{
  "access_token": "eyJhbGciOiJSUzI1NiIs...",
  "token_type": "Bearer",
  "expires_in": 3600,
  "refresh_token": "def5020..."
}
```

### Token Management Strategy

**Critical:** ETA tokens have SHORT lifetimes

**Backend Controllers:** Use cached token with auto-refresh (5 min before expiry)  
**Sync Scripts:** Fresh token per API request (recommended for reliability)

---

## API Endpoints

### Base URL

**Production:** `https://your-domain.com/api/otax`  
**Local Dev:** `http://localhost:5000/api/otax`

All endpoints require authentication unless noted.

---

### 1. Authentication (4 endpoints)

#### 1.1 Login as Taxpayer

```http
POST /api/otax/auth/login
Content-Type: application/json

{
  "client_id": "d04b9e2d-46ff-40b5-9ddb-9e42f7fc6964",
  "client_secret": "941bf94b-f92d-4be3-a50e-3c3501775155",
  "environment": "production"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Authentication successful",
  "data": {
    "access_token": "eyJhbGci...",
    "expires_at": "2026-01-22T10:00:00Z",
    "environment": "production"
  }
}
```

#### 1.2 Refresh Token

```http
POST /api/otax/auth/refresh
Content-Type: application/json

{
  "company_id": "uuid-here"
}
```

#### 1.3 Get Auth Status

```http
GET /api/otax/auth/status/:company_id
```

#### 1.4 Logout

```http
POST /api/otax/auth/logout
Content-Type: application/json

{
  "company_id": "uuid-here"
}
```

---

### 2. Document Management (9 endpoints)

#### 2.1 Submit Document

```http
POST /api/otax/documents/submit
Content-Type: application/json

{
  "company_id": "uuid-here",
  "documents": [{
    "internalId": "INV-2026-001",
    "documentType": "I",
    "dateTimeIssued": "2026-01-22T10:00:00Z",
    "receiver": {
      "name": "Client Company",
      "type": "B",
      "id": "200000002"
    },
    "totalAmount": 1140.00,
    "invoiceLines": [{
      "description": "Product A",
      "quantity": 10,
      "unitPrice": 100,
      "taxRate": 14,
      "totalAmount": 1140
    }]
  }]
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "submissionId": "XYE60M8ENDWA7V9T...",
    "acceptedDocuments": [{
      "uuid": "42S512YACQBRSRHY...",
      "internalId": "INV-2026-001",
      "status": "SUBMITTED"
    }]
  }
}
```

#### 2.2 Get Document Status

```http
GET /api/otax/documents/:uuid/status?company_id=uuid-here
```

**Response:**
```json
{
  "success": true,
  "data": {
    "uuid": "42S512YACQBRSRHY...",
    "status": "VALID",
    "submissionDate": "2026-01-22T10:00:00Z",
    "validationDate": "2026-01-22T10:05:00Z"
  }
}
```

#### 2.3 Get Document Details

```http
GET /api/otax/documents/:uuid/details?company_id=uuid-here
```

#### 2.4 Download PDF

```http
GET /api/otax/documents/:uuid/pdf?company_id=uuid-here
```

#### 2.5 Cancel Document

```http
PUT /api/otax/documents/:uuid/cancel
Content-Type: application/json

{
  "company_id": "uuid-here",
  "reason": "Cancelled by issuer"
}
```

#### 2.6 Reject Document

```http
PUT /api/otax/documents/:uuid/reject
Content-Type: application/json

{
  "company_id": "uuid-here",
  "reason": "Rejected by receiver"
}
```

#### 2.7 Get Recent Documents

```http
GET /api/otax/documents/recent?company_id=uuid-here&limit=50
```

#### 2.8 Search Documents (Recommended)

```http
GET /api/otax/documents/search?company_id=uuid-here&submission_date_from=2026-01-01T00:00:00Z&submission_date_to=2026-01-30T23:59:59Z&direction=Sent&page_size=100
```

**Query Parameters:**
- `submission_date_from` (ISO 8601, required)
- `submission_date_to` (ISO 8601, required, max 30 days from start)
- `direction`: `Sent` | `Received` (case-sensitive)
- `document_type`: `i` | `c` | `d`
- `status`: [Valid](file:///d:/MicroMind_Suite/Web_App/server/src/services/otax/eta-api.service.js#105-177) | `Invalid` | `Cancelled`
- `page_size`: 1-100
- `continuation_token`: For pagination

**Response:**
```json
{
  "success": true,
  "data": {
    "documents": [{
      "uuid": "42S512YACQBRSRHY...",
      "internalId": "INV-2026-001",
      "typeName": "i",
      "status": "Valid",
      "total": 1140.00,
      "receiverName": "Client Company",
      "dateTimeIssued": "2026-01-22T10:00:00Z"
    }],
    "pagination": {
      "total_results": 24,
      "page_size": 100,
      "continuation_token": "1674529517710|Y4RWK...",
      "has_more": false
    }
  }
}
```

#### 2.9 Get by Invoice Number

```http
GET /api/otax/documents/by-invoice/:invoiceNumber?company_id=uuid-here
```

---

### 3. Portal Sync (3 endpoints)

#### 3.1 Pull Documents from ETA

```http
POST /api/otax/sync/documents
Content-Type: application/json

{
  "company_id": "uuid-here",
  "date_from": "2026-01-01",
  "date_to": "2026-01-30"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Synced 24 documents from ETA",
  "data": {
    "total": 24,
    "new": 18,
    "updated": 6,
    "errors": 0
  }
}
```

#### 3.2 Get Notifications

```http
GET /api/otax/sync/notifications?company_id=uuid-here
```

#### 3.3 Full Reconciliation

```http
POST /api/otax/sync/reconcile
Content-Type: application/json

{
  "company_id": "uuid-here"
}
```

---

### 4. Batch Operations (3 endpoints)

#### 4.1 Batch Submit Documents

```http
POST /api/otax/batch/submit
Content-Type: application/json

{
  "company_id": "uuid-here",
  "documents": [/* array of 100+ documents */]
}
```

**Response:**
```json
{
  "success": true,
  "message": "Batch job created",
  "data": {
    "job_id": "550e8400-e29b-41d4-a716-446655440000",
    "total_documents": 150,
    "status": "PROCESSING"
  }
}
```

#### 4.2 Get Batch Status

```http
GET /api/otax/batch/:jobId/status
```

**Response:**
```json
{
  "success": true,
  "data": {
    "job_id": "550e8400...",
    "status": "COMPLETED",
    "progress": {
      "percentage": 100,
      "total": 150,
      "processed": 150,
      "submitted": 147,
      "failed": 3
    },
    "duration_seconds": 245
  }
}
```

#### 4.3 List Batch Jobs

```http
GET /api/otax/batch/jobs?company_id=uuid-here
```

---

### 5. Reconciliation (5 endpoints)

#### 5.1 Get Unmatched Items

```http
GET /api/otax/reconciliation/unmatched?company_id=uuid-here
```

**Response:**
```json
{
  "success": true,
  "data": {
    "erp": {
      "count": 15,
      "transactions": [...]
    },
    "bank": {
      "count": 8,
      "transactions": [...]
    },
    "eta": {
      "count": 12,
      "documents": [...]
    }
  }
}
```

#### 5.2 Auto-Match (AI Multi-Pass)

```http
POST /api/otax/reconciliation/auto-match
Content-Type: application/json

{
  "company_id": "uuid-here"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Auto-match completed: 35 matches created",
  "summary": {
    "perfect_matches": 25,
    "wht_matches": 5,
    "fx_matches": 3,
    "manual_review": 2
  }
}
```

**Matching Algorithm:**
- **Pass 1 (Perfect):** Exact amount + date ±3 days → 100% confidence
- **Pass 2 (WHT):** 5% withholding tax variance → 85% confidence
- **Pass 3 (FX):** ≤2% currency variance → 75% confidence
- **Pass 4 (Manual):** Requires review → 50% confidence

#### 5.3 Create Manual Match

```http
POST /api/otax/reconciliation/matches
Content-Type: application/json

{
  "erp_transaction_id": "uuid",
  "bank_transaction_id": "uuid",
  "eta_document_id": "uuid",
  "variance_amount": 100.00,
  "variance_reason": "WHT_5%"
}
```

#### 5.4 Approve Match

```http
PUT /api/otax/reconciliation/matches/:id/approve
Content-Type: application/json

{
  "approved_by": "user-id"
}
```

#### 5.5 Reject Match

```http
PUT /api/otax/reconciliation/matches/:id/reject
```

---

### 6. Digital Signature (4 endpoints)

#### 6.1 Queue for Signing

```http
POST /api/otax/signature/queue
Content-Type: application/json

{
  "company_id": "uuid-here",
  "document_ids": ["uuid1", "uuid2", "uuid3"]
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "batch_hash": "a3f8d9e1c2b4...",
    "total_queued": 3
  }
}
```

#### 6.2 Receive Signatures (from Local Bridge)

```http
POST /api/otax/signature/receive
Content-Type: application/json

{
  "batch_hash": "a3f8d9e1c2b4...",
  "signatures": [{
    "document_id": "uuid1",
    "signature_base64": "MIIB..."
  }]
}
```

#### 6.3 Get Queue Status

```http
GET /api/otax/signature/queue/:batchHash
```

#### 6.4 Get Pending Signatures

```http
GET /api/otax/signature/pending?company_id=uuid-here
```

---

### 7. Reports (2 endpoints)

#### 7.1 Gap Analysis

```http
GET /api/otax/reports/gap-analysis?company_id=uuid-here&date_from=2026-01-01&date_to=2026-01-31
```

**Response:**
```json
{
  "success": true,
  "data": {
    "portal_liability": 125000.00,
    "erp_liability": 123500.00,
    "gap": 1500.00,
    "gap_percentage": 1.21,
    "tax_gap": 210.00,
    "discrepancies": [{
      "type": "AMOUNT_MISMATCH",
      "eta_uuid": "...",
      "eta_amount": 1140.00,
      "erp_amount": 1000.00,
      "difference": 140.00
    }]
  }
}
```

#### 7.2 Statistics

```http
GET /api/otax/reports/statistics?company_id=uuid-here&period=30
```

---

### 8. Other Endpoints

#### 8.1 Taxpayer Info

```http
GET /api/otax/taxpayer/info/:taxNumber?company_id=uuid-here
```

#### 8.2 Activity Metrics

```http
GET /api/otax/taxpayer/activity?company_id=uuid-here
```

#### 8.3 Submit Code (EGS/GS1)

```http
POST /api/otax/codes/submit
```

#### 8.4 Search Published Codes

```http
GET /api/otax/codes/search?code_type=GS1
```

#### 8.5 ERP Transaction Sync

```http
POST /api/otax/transactions/sync
```

#### 8.6 Bank Statement Upload

```http
POST /api/otax/bank/upload
```

#### 8.7 Health Check

```http
GET /api/otax/health
```

**Response:**
```json
{
  "success": true,
  "service": "OTax",
  "database": "otax_sv1",
  "timestamp": "2026-01-22T08:00:00Z"
}
```

---

## Database Schema

### Tables (12)

#### `taxpayer_companies`
Company registration and ETA credentials

```sql
- id (UUID, PK)
- company_name (VARCHAR)
- tax_registration_number (VARCHAR, UNIQUE)
- eta_client_id (VARCHAR)
- eta_client_secret (VARCHAR)
- eta_access_token (TEXT)
- eta_refresh_token (TEXT)
- eta_token_expires_at (TIMESTAMP)
- environment (VARCHAR) -- 'production' | 'sandbox'
- is_active (BOOLEAN)
- created_at, updated_at
```

#### `eta_documents`
eInvoices, Credit/Debit Notes, eReceipts

```sql
- id (UUID, PK)
- company_id (UUID, FK)
- eta_uuid (VARCHAR, UNIQUE)
- internal_id (VARCHAR)
- document_type (VARCHAR) -- I, C, D, R
- date_time_issued (TIMESTAMP)
- receiver_name (VARCHAR)
- total_amount (DECIMAL)
- status (VARCHAR) -- VALID, SUBMITTED, REJECTED, CANCELLED
- submitted_at, validated_at
```

#### `document_line_items`
Invoice line items with tax details

#### `erp_transactions`
AR/AP from external ERP systems

#### `bank_transactions`
Bank statement data

#### `reconciliation_matches`
3-way matching (ERP/Bank/ETA)

#### `variance_rules`
Smart reconciliation tolerances

#### `code_registry`
EGS/GS1 code management

#### `signing_queue`
USB token batch signing workflow

#### `portal_sync_logs`
ETA sync history

### AI Views (4)

#### `VW_AI_OTAX_SUMMARY`
High-level company metrics

```sql
SELECT company_name, valid_documents, total_valid_amount,
       total_tax_collected, docs_last_30_days
FROM VW_AI_OTAX_SUMMARY
WHERE company_id = '...';
```

#### `VW_AI_OTAX_UNMATCHED`
Reconciliation candidates from ERP, Bank, ETA

#### `VW_AI_OTAX_RECENT_ACTIVITY`
Last 30 days timeline of all activities

#### `VW_AI_OTAX_DOCUMENT_DETAILS`
Detailed document view with line items summary

---

## Configuration

### Environment Variables

```env
# Database
OTAX_DATABASE_URL=postgresql://user:pass@host:5432/otax_sv1

# ETA Production (Recommended)
ETA_ENVIRONMENT=production
ETA_API_URL=https://api.invoicing.eta.gov.eg
ETA_AUTH_URL=https://id.eta.gov.eg/connect/token

# ETA Sandbox (Testing Only)
# ETA_ENVIRONMENT=sandbox
# ETA_API_URL=https://api.preprod.invoicing.eta.gov.eg

# Server
PORT=5000
NODE_ENV=production
```

### Company Setup

```javascript
// Create company with ETA credentials
const company = await db.taxpayerCompany.create({
  data: {
    company_name: "Your Company Name",
    tax_registration_number: "123456789",
    eta_client_id: "YOUR_PRODUCTION_CLIENT_ID",
    eta_client_secret: "YOUR_PRODUCTION_CLIENT_SECRET",
    environment: "production", // or "sandbox"
    is_active: true
  }
});
```

---

## Deployment

### Prerequisites

- Node.js 18+
- PostgreSQL database
- ETA production credentials

### Installation

```bash
cd server
npm install

# Generate Prisma client
npx prisma generate --schema=./prisma/otax.prisma

# Run migrations
npx prisma migrate deploy --schema=./prisma/otax.prisma

# Seed database
node prisma/seed.otax.js
```

### Running

```bash
# Development
npm run dev

# Production
npm start
```

### Sync Documents from ETA

```bash
# One-time sync (last 7 days)
node sync-eta-production.js

# Scheduled sync (cron job)
0 */6 * * * cd /path/to/server && node sync-eta-production.js
```

---

## Testing & Validation

### Production Validation Results

**Test Date:** January 22, 2026  
**Environment:** ETA Production  
**Endpoint:** `https://api.invoicing.eta.gov.eg`

**Results:**
- ✅ Authentication successful
- ✅ 24 documents retrieved
- ✅ 100% success rate (0 failures)
- ✅ Document range: 1.14 - 2,220 EGP
- ✅ Both SENT and RECEIVED documents
- ✅ Duration: 19 seconds
- ✅ Database storage validated
- ✅ AI views populated with real data

### API Version Compatibility

| Endpoint Type | Version | Status |
|--------------|---------|--------|
| Authentication | OAuth 2.0 | ✅ Validated |
| Document Submission | v1.0 | ✅ Validated |
| Document Search | v1.0 | ✅ Validated |
| Code Management | v1.0 | ✅ Ready |
| Notifications | v1.0 | ✅ Ready |

### Known Limitations

1. **Token Lifetime:** ETA tokens expire quickly
   - **Solution:** Fresh token per request in sync operations
   - **Backend:** Auto-refresh 5 minutes before expiry

2. **Date Range:** Max 30-day window per search
   - **Solution:** Implement date chunking for longer periods

3. **Rate Limits:** Production has higher limits than sandbox
   - **Solution:** 3-second delay between paginated requests

4. **Page Size:** Max 100 documents per request
   - **Solution:** Use continuation token pagination

---

## Support & Maintenance

### Error Codes

| Code | Meaning | Solution |
|------|---------|----------|
| 401 | Unauthorized | Refresh token or re-authenticate |
| 403 | Forbidden | Check company permissions |
| 503 | Service Unavailable | Retry with exponential backoff |
| 5039 | Rate Limit | Wait and retry (3-5 seconds) |

### Monitoring

Check sync logs:
```sql
SELECT * FROM portal_sync_logs 
ORDER BY completed_at DESC 
LIMIT 10;
```

Check unmatched items:
```sql
SELECT * FROM VW_AI_OTAX_UNMATCHED 
WHERE company_id = '...';
```

### Backup

```bash
# Backup database
pg_dump otax_sv1 > backup_$(date +%Y%m%d).sql

# Restore
psql otax_sv1 < backup_20260122.sql
```

---

## Appendix

### API Response Format

All endpoints follow this structure:

```json
{
  "success": true|false,
  "message": "Optional description",
  "data": { /* Response payload */ },
  "error": "Error message if success=false"
}
```

### Date Format

All dates use ISO 8601:
```
2026-01-22T10:00:00Z
```

### Currency

All amounts in Egyptian Pounds (EGP) with 2 decimal places.

---

**Documentation Version:** 1.0  
**Backend Version:** Production  
**Last Validated:** January 22, 2026
