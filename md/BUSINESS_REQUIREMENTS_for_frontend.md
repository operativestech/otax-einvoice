# OTax - Business Requirements Document (BRD)

**Project Name:** OTax - Egyptian Tax Authority Integration System  
**Document Version:** 1.0  
**Date:** January 22, 2026  
**Prepared For:** Frontend Engineering Team  
**Status:** Production Backend Ready

---

## Executive Summary

### Business Problem

Egyptian businesses are required by law to submit e-invoices to the Egyptian Tax Authority (ETA) portal. The current process involves:

1. **Manual Portal Access** - Staff manually logs into ETA portal to submit invoices
2. **Data Re-entry** - Invoice data from ERP systems must be re-keyed into ETA portal
3. **No Reconciliation** - Difficult to match ERP transactions with ETA submissions
4. **Limited Visibility** - No centralized view of submission status and tax compliance
5. **Error-Prone** - Manual processes lead to submission errors and rejections

**Business Impact:**
- ⏱️ **Time Loss:** 2-4 hours daily on manual invoice submission
- 💰 **Cost:** Late submission penalties (up to 50,000 EGP per violation)
- 📊 **Compliance Risk:** Missing or incorrect submissions = tax authority audits
- 🔍 **Poor Visibility:** Hard to track submission status and reconcile with accounting

### Solution Overview

OTax is a **unified tax compliance platform** that:
- **Automates** e-invoice submission to ETA portal
- **Synchronizes** submitted documents back from ETA
- **Reconciles** ETA submissions with ERP and bank transactions
- **Reports** gaps between ERP liability and ETA portal liability
- **Manages** digital signatures for bulk document signing

### Expected Business Value

| Metric | Current | Target | Impact |
|--------|---------|--------|--------|
| **Time to submit 100 invoices** | 4 hours | 5 minutes | 98% reduction |
| **Submission error rate** | 15% | <2% | 87% reduction |
| **Reconciliation time** | 8 hours/month | 30 minutes | 94% reduction |
| **Late submission incidents** | 3-5/month | 0 | 100% elimination |
| **Tax compliance confidence** | 60% | 95% | 35% improvement |

---

## Business Objectives

### Primary Objectives

1. **Automate Tax Compliance**
   - Eliminate manual data entry into ETA portal
   - Reduce submission time by 95%
   - Achieve <2% error rate in submissions

2. **Ensure Regulatory Compliance**
   - 100% of invoices submitted to ETA on time
   - Complete digital signature workflow
   - Full audit trail of all submissions

3. **Improve Financial Visibility**
   - Real-time view of tax liability vs. ERP
   - Identify and resolve discrepancies within 24 hours
   - Monthly gap analysis reports for finance team

4. **Streamline Reconciliation**
   - Automatic matching of ETA, ERP, and Bank records
   - Reduce reconciliation time by 90%
   - Clear visibility into unmatched transactions

### Secondary Objectives

- Enable multi-company management (for accounting firms)
- Provide dashboards for management reporting
- Support batch operations for high-volume periods
- Integrate with existing ERP systems

---

## Target Users

### 1. Accountant / Tax Staff (Primary User)

**Profile:**
- Responsible for daily invoice processing
- Works 8am-5pm during business hours
- Usually has basic computer skills
- Needs to submit 50-200 invoices per month

**Goals:**
- Submit invoices quickly without errors
- Track submission status easily
- Know which invoices are approved/rejected
- Reconcile ETA with company records monthly

**Pain Points:**
- Manually copying data from ERP to ETA portal
- Portal crashes during high-traffic periods
- Difficult to track which invoices were submitted
- Reconciliation takes entire day each month

**User Journey:**
1. Morning: Check for new invoices from ERP
2. Create/validate invoices in OTax
3. Submit batch to ETA portal
4. Monitor submission status
5. Download approved invoices for accounting
6. Monthly: Run reconciliation report

### 2. Finance Manager (Secondary User)

**Profile:**
- Reviews financial reports
- Makes strategic tax decisions
- Interacts with tax authority
- Needs monthly/quarterly overviews

**Goals:**
- Understand tax liability vs. ETA submissions
- Identify and fix discrepancies
- Ensure compliance before audits
- Report to executive management

**Pain Points:**
- No clear view of ERP vs. ETA differences
- Find out about submission errors too late
- Difficult to explain gaps to auditors
- Manual reports take days to prepare

**User Journey:**
1. Weekly: Review submission statistics
2. Monthly: Run gap analysis report
3. Investigate discrepancies
4. Approve reconciliation matches
5. Export reports for auditors

### 3. IT Administrator (Tertiary User)

**Profile:**
- Manages company systems
- Handles ETA credentials
- Troubleshoots integration issues

**Goals:**
- Configure system integration
- Monitor system health
- Manage user access
- Ensure data security

---

## Business Process Flows

### Process 1: Daily Invoice Submission

**Current Process (Manual):**
1. Accountant exports invoices from ERP to Excel (15 min)
2. Opens ETA portal website (5 min - sometimes slow)
3. Manually enters each invoice data (3 min × 20 invoices = 60 min)
4. Clicks submit for each invoice (1 min × 20 = 20 min)
5. Waits for validation (5 min)
6. Downloads approved invoices (10 min)
7. Marks as submitted in spreadsheet (10 min)

**Total Time:** ~2 hours for 20 invoices

**With OTax (Automated):**
1. System auto-syncs new invoices from ERP (automatic)
2. Accountant reviews list in OTax dashboard (2 min)
3. Selects all, clicks "Submit Batch" (1 min)
4. System submits to ETA in background (automatic)
5. Accountant receives notification when done (automatic)
6. Downloads approved invoices if needed (1 min)

**Total Time:** ~5 minutes for 50+ invoices

### Process 2: Monthly Reconciliation

**Current Process (Manual):**
1. Export ETA submissions from portal (30 min)
2. Export ERP sales from accounting system (15 min)
3. Export bank transactions from bank portal (30 min)
4. Open 3 Excel files side-by-side (5 min)
5. Manually match transactions (6 hours)
6. Create variance report (1 hour)
7. Investigate mismatches (2 hours)

**Total Time:** ~10 hours

**With OTax (Automated):**
1. Click "Reconciliation" tab (immediate)
2. Click "Auto-Match" button (1 min)
3. System matches 90% automatically (automatic)
4. Review suggested matches (10 min)
5. Approve/reject matches (5 min)
6. Generate gap analysis report (1 min)
7. Investigate remaining 10% (30 min)

**Total Time:** ~45 minutes

### Process 3: Month-End Gap Analysis

**Business Need:**
Finance manager needs to ensure all company sales invoices are properly submitted to ETA and match with bank collections.

**Current Process:**
- Finance asks accountant: "Are all invoices submitted?"
- Accountant spends day checking
- Finds 5-10 missing or mismatched invoices
- Manually corrects and resubmits
- Updates finance manager via email

**With OTax:**
- Finance manager opens Gap Analysis report
- Sees: "Portal Liability: 125,000 EGP | ERP Liability: 123,500 EGP | Gap: 1,500 EGP (1.2%)"
- Drills down into 8 specific discrepancies
- Assigns to accountant to resolve
- Tracks resolution in real-time

---

## Functional Requirements

### FR-1: Authentication & Company Setup

**Business Need:** Secure access to ETA integration using company credentials

**Requirements:**
- [ ] Users can login with ETA client ID and secret
- [ ] System stores credentials securely
- [ ] Support for production and sandbox environments
- [ ] Session management (auto-logout after inactivity)
- [ ] Display company name after successful login

**Acceptance Criteria:**
- Login succeeds with valid ETA credentials
- Invalid credentials show clear error message
- User remains logged in for entire work session
- Credentials are never visible in plain text

**Business Priority:** P0 (Blocker)

---

### FR-2: Document Management Dashboard

**Business Need:** Central view of all e-invoices and their status

**Requirements:**
- [ ] Display list of all documents (invoices, credit notes, debit notes)
- [ ] Show key info: Invoice #, Date, Customer, Amount, Status
- [ ] Filter by date range (last 7 days, 30 days, custom)
- [ ] Filter by status (Valid, Submitted, Rejected, Cancelled)
- [ ] Filter by direction (Sent by us, Received by us)
- [ ] Search by invoice number
- [ ] Sort by any column
- [ ] Pagination (20-50 per page)

**Acceptance Criteria:**
- Accountant can find any invoice within 10 seconds
- Table shows accurate real-time status from ETA
- Filters work independently and in combination
- Page loads in <2 seconds with 1000+ documents

**Business Priority:** P0 (Blocker)

---

### FR-3: Document Detail & Actions

**Business Need:** View full invoice details and perform actions

**Requirements:**
- [ ] View complete invoice data (header + line items)
- [ ] Download official PDF from ETA
- [ ] View submission history (when submitted, when validated)
- [ ] Cancel invoice (if allowed by ETA)
- [ ] Reject received invoice (if we're the receiver)
- [ ] View validation errors (if rejected)

**Acceptance Criteria:**
- PDF downloads match official ETA format
- Cancel only available for recent invoices (<24 hours)
- User sees confirmation before canceling
- Cancelled invoices marked clearly in list

**Business Priority:** P0 (Blocker)

---

### FR-4: Create & Submit Invoice

**Business Need:** Create new invoices and submit to ETA portal

**Requirements:**
- [ ] Form to enter invoice data:
  - Internal invoice number
  - Document type (Invoice, Credit Note, Debit Note)
  - Issue date
  - Receiver (name, tax number, type: Business/Person/Foreign)
  - Line items (description, quantity, unit price, tax rate)
  - Auto-calculate totals (subtotal, tax, grand total)
- [ ] Validate data before submission (required fields, format)
- [ ] Submit single invoice
- [ ] Show submission progress
- [ ] Display success/error message with details

**Acceptance Criteria:**
- All Egyptian tax rules enforced (14% tax rate, valid tax numbers)
- Calculations are accurate (subtotal + tax = total)
- Clear error messages if submission fails
- Invoice number must be unique
- Successful submission returns ETA UUID

**Business Priority:** P0 (Blocker)

---

### FR-5: Portal Sync

**Business Need:** Pull submitted documents back from ETA portal

**Requirements:**
- [ ] Select date range to sync (max 30 days)
- [ ] Click "Sync Now" button
- [ ] Show progress indicator
- [ ] Display sync results:
  - Total documents retrieved
  - New documents added
  - Existing documents updated
  - Any errors
- [ ] Show last sync timestamp
- [ ] View sync history (past syncs)

**Acceptance Criteria:**
- Sync completes within 1 minute for 100 documents
- No duplicate documents created
- Documents update with latest ETA status
- User can continue working during sync (background process)

**Business Priority:** P1 (High)

---

### FR-6: Batch Submit

**Business Need:** Submit 100+ invoices at once during high-volume periods

**Requirements:**
- [ ] Upload file (Excel/CSV) with invoice data
- [ ] Validate file format and data
- [ ] Preview invoices before submission (first 10 rows)
- [ ] Show total document count and estimated time
- [ ] Submit batch in background
- [ ] Track job progress (percentage complete)
- [ ] Receive notification when complete
- [ ] View results:
  - Successfully submitted
  - Failed with errors
  - Download error report

**Acceptance Criteria:**
- Support up to 500 invoices in single batch
- File upload validates immediately (format check)
- Job completes within 10 minutes for 100 invoices
- Failed invoices include specific error reasons
- User can submit another batch while first is processing

**Business Priority:** P1 (High)

---

### FR-7: Reconciliation Dashboard

**Business Need:** Match ETA invoices with ERP and bank transactions

**Requirements:**
- [ ] Show unmatched items in 3 columns:
  - ERP transactions (not in ETA)
  - Bank transactions (not matched)
  - ETA documents (not in ERP)
- [ ] Display count and total amount for each column
- [ ] Click "Auto-Match" to trigger AI matching
- [ ] Show match results:
  - Perfect matches (100% confidence)
  - WHT matches (5% variance for withholding tax)
  - FX matches (currency variance ≤2%)
  - Manual review needed
- [ ] Display suggested matches table:
  - ERP invoice # ↔ ETA UUID ↔ Bank transaction
  - Match confidence score
  - Variance amount and reason
  - Actions: Approve, Reject
- [ ] Filter matches by confidence level
- [ ] Bulk approve all perfect matches

**Acceptance Criteria:**
- Auto-match runs in <30 seconds for 1000+ records
- Match confidence scores are accurate (validated against manual results)
- Approved matches are removed from unmatched list
- Rejected matches can be re-matched manually
- Finance manager can explain any variance to auditors

**Business Priority:** P1 (High)

---

### FR-8: Gap Analysis Report

**Business Need:** Identify differences between ERP and ETA for compliance

**Requirements:**
- [ ] Select date range (month, quarter, custom)
- [ ] Display key metrics:
  - Portal Liability (total ETA submissions)
  - ERP Liability (total ERP sales)
  - Gap Amount (difference)
  - Gap Percentage
  - Tax Gap (difference in tax amount)
- [ ] Show document counts:
  - ETA documents count
  - ERP transactions count
  - Discrepancy count
- [ ] List all discrepancies:
  - Type (In ETA not in ERP, In ERP not in ETA, Amount Mismatch)
  - Invoice number
  - ETA amount vs ERP amount
  - Difference amount
- [ ] Filter discrepancies by type
- [ ] Export report to Excel/PDF
- [ ] Visualize gap trend over time (chart)

**Acceptance Criteria:**
- Report generates in <5 seconds for 1 month of data
- Calculations are accurate (manually verified)
- Discrepancies link to actual documents for investigation
- Export includes all detail rows
- Finance manager can present to auditors

**Business Priority:** P1 (High)

---

### FR-9: Statistics & Reporting

**Business Need:** Track submission performance and compliance metrics

**Requirements:**
- [ ] Select time period (7, 30, 90 days)
- [ ] Display metrics cards:
  - Total documents submitted
  - Valid documents (%)
  - Rejected documents (%)
  - Pending documents (%)
  - Average submission time
- [ ] Document status breakdown (pie chart)
- [ ] Submission trend over time (line chart)
- [ ] Reconciliation match rate (%)
- [ ] Top rejection reasons (if any)

**Acceptance Criteria:**
- Metrics update in real-time
- Charts are clear and easy to read
- Data matches actual document counts
- Manager can screenshot for presentations

**Business Priority:** P2 (Medium)

---

### FR-10: Digital Signature Workflow

**Business Need:** Bulk sign documents with USB token before submission

**Requirements:**
- [ ] Select multiple documents to sign
- [ ] Generate signature request (batch)
- [ ] Display batch hash for USB token
- [ ] Poll for signature completion
- [ ] Upload signed documents
- [ ] Auto-submit signed documents to ETA

**Acceptance Criteria:**
- Support 50+ documents in single batch
- Integration with local USB token bridge app
- Signed documents submit automatically
- Failed signatures have retry option

**Business Priority:** P2 (Medium)

---

## User Stories

### As an Accountant

**Story 1: Quick Invoice Status Check**
> "As an accountant, I want to quickly see if my submitted invoices were approved or rejected, so I can take action on rejections immediately."

**Acceptance:**
- Dashboard shows status at a glance (color-coded)
- Rejected invoices are highlighted
- I can click to see rejection reason

**Story 2: Bulk Submission Before Deadline**
> "As an accountant, I want to submit all 150 month-end invoices at once, so I don't miss the tax authority deadline."

**Acceptance:**
- Upload Excel file with all invoices
- System validates and shows preview
- Submit happens in background
- I get notified when done (success/failure)

**Story 3: Find Missing Invoice**
> "As an accountant, I want to search for a specific invoice by number, so I can check if it was submitted to ETA."

**Acceptance:**
- Search box in documents page
- Results appear instantly
- Shows submission status clearly

### As a Finance Manager

**Story 4: Monthly Compliance Report**
> "As a finance manager, I want to see a gap analysis report comparing ERP vs ETA, so I can ensure we're compliant before an audit."

**Acceptance:**
- Report shows total liability difference
- Lists specific discrepancies
- I can export for auditors
- Shows trend over past months

**Story 5: Approve Reconciliation Matches**
> "As a finance manager, I want to review and approve suggested transaction matches, so I can be confident in our reconciliation accuracy."

**Acceptance:**
- See all suggested matches
- Confidence score helps decision
- Can approve/reject individually
- Can bulk approve perfect matches

### As an IT Administrator

**Story 6: Configure ETA Integration**
> "As an IT admin, I want to enter our company's ETA credentials securely, so the system can connect to the tax portal."

**Acceptance:**
- Secure login with credentials
- Test connection before saving
- Switch between production/sandbox

---

## Success Criteria

### Quantitative Metrics

| Metric | Target | Measurement Method |
|--------|--------|-------------------|
| **Submission Time** | <5 min for 100 invoices | Time from click "Submit" to completion |
| **Error Rate** | <2% rejection rate | (Rejected / Total Submitted) × 100 |
| **Reconciliation Time** | <30 min monthly | Time from start to approved matches |
| **Gap Closure** | <24 hours | Time from gap identified to resolved |
| **Auto-Match Rate** | >85% | (Auto-matched / Total Transactions) × 100 |
| **User Adoption** | >90% | (Active Users / Total Users) × 100 |
| **Page Load Time** | <2 seconds | Average page load across all pages |
| **Uptime** | >99.5% | Monthly uptime percentage |

### Qualitative Metrics

**User Satisfaction:**
- ✅ "The system is easy to use" (4/5 stars)
- ✅ "I can submit invoices faster than before" (4/5 stars)
- ✅ "I trust the reconciliation results" (4/5 stars)
- ✅ "The reports help me do my job better" (4/5 stars)

**Business Impact:**
- ✅ Zero late submission penalties
- ✅ Finance team confidence in tax compliance
- ✅ Smooth tax audits (no manual reconciliation needed)
- ✅ Accountant stress reduced during month-end

---

## Constraints & Assumptions

### Technical Constraints

1. **ETA API Limitations:**
   - Max 30-day date range per search
   - Rate limits on API calls
   - Token expires quickly (requires refresh strategy)
   - Continuation token pagination (not page numbers)

2. **Browser Requirements:**
   - Modern browsers only (Chrome, Firefox, Edge)
   - JavaScript must be enabled
   - Minimum screen width: 1024px (tablet/desktop)

### Business Constraints

1. **Regulatory Requirements:**
   - All invoices must use ETA-approved format (UBL 2.1)
   - Digital signatures required for certain document types
   - Tax rates and rules per Egyptian Tax Authority

2. **Data Requirements:**
   - Invoice data must come from ERP system
   - Bank data must be uploaded (no direct bank integration)
   - Historical data: 3 months minimum for reconciliation

### Assumptions

1. Users have basic computer literacy
2. ERP system can export invoice data to Excel/CSV
3. Internet connection is stable during submission
4. Company has valid ETA credentials
5. Monthly reconciliation volume: <5000 transactions
6. Average 3-5 users per company

---

## Phased Implementation

### Phase 1: Core Operations (Weeks 1-2)
**Goal:** Enable basic invoice submission

- [x] Authentication (Login/Logout)
- [x] Documents Dashboard (List view)
- [x] Document Detail View
- [x] Create & Submit Single Invoice
- [x] View Submission Status

**Success:** Accountant can submit 1 invoice end-to-end

### Phase 2: Automation (Weeks 3-4)
**Goal:** Enable bulk operations and sync

- [ ] Portal Sync (Pull from ETA)
- [ ] Batch Submit (Upload file)
- [ ] Job Progress Tracking
- [ ] Notifications

**Success:** Accountant can submit 100 invoices in <5 minutes

### Phase 3: Reconciliation (Weeks 5-6)
**Goal:** Automate matching and gap analysis

- [ ] Reconciliation Dashboard
- [ ] Auto-Match Engine (UI)
- [ ] Manual Match Creation
- [ ] Approve/Reject Matches
- [ ] Gap Analysis Report

**Success:** Finance manager completes monthly reconciliation in <30 minutes

### Phase 4: Reporting & Polish (Weeks 7-8)
**Goal:** Management insights and production readiness

- [ ] Statistics Dashboard
- [ ] Export to Excel/PDF
- [ ] Digital Signature Workflow
- [ ] Performance Optimization
- [ ] Error Handling & UX Polish

**Success:** System ready for production with all features

---

## Risks & Mitigation

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|-----------|
| **ETA portal downtime** | High | Medium | Cache data locally, queue submissions for retry |
| **Token expiry during batch** | High | Low | Fresh token per page/request |
| **Large data volume (10k+ invoices)** | Medium | Low | Pagination, lazy loading, virtualized tables |
| **User data entry errors** | Medium | High | Client-side validation, clear error messages |
| **Reconciliation accuracy** | High | Low | Display confidence scores, require manual approval for <85% |

---

## Glossary

**ETA** - Egyptian Tax Authority (government agency)  
**e-Invoice** - Electronic invoice submitted to ETA portal  
**ERP** - Enterprise Resource Planning (accounting system)  
**WHT** - Withholding Tax (5% deducted at source)  
**Gap** - Difference between ERP liability and ETA submissions  
**Reconciliation** - Matching ERP, Bank, and ETA records  
**UBL 2.1** - Universal Business Language format required by ETA  
**UUID** - Unique document identifier from ETA  
**Continuation Token** - ETA's pagination mechanism  

---

## Approval & Sign-Off

**Prepared By:** Technical Team  
**Reviewed By:** Finance Manager  
**Approved By:** Business Owner  

**Next Steps:**
1. Frontend team reviews requirements
2. Creates wireframes/mockups for approval
3. Develops Phase 1 features
4. UAT with real users
5. Production deployment

---

**Document Version:** 1.0  
**Status:** Approved for Development  
**Last Updated:** January 22, 2026
