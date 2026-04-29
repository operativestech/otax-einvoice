# ETA SDK R3.0 — Postman Collection Coverage Audit

> Last updated: 2026-04-18
> Reference: `Egyptian eInvoicing SDK R3.0` Postman collection
> Conclusion: **Full B2B coverage (Common + eInvoicing). e-Receipts parked by product decision.**

---

## Section 1 — Common (12 endpoints — 12/12 ✅)

| # | Postman request | Our implementation |
|---|---|---|
| 1 | `POST /connect/token` | `etaService.getToken()` → 50-min token cache |
| 2 | `GET /api/v1/documenttypes` | `etaService.getDocumentTypes()` · route `GET /api/eta/document-types` |
| 3 | `GET /api/v1/documenttypes/:id` | `etaService.getDocumentType()` · route `GET /api/eta/document-types/:id` |
| 4 | `GET /api/v1/documenttypes/:id/versions/:vid` | `etaService.getDocumentTypeVersion()` · route `GET /api/eta/document-types/:id/versions/:vid` |
| 5 | `GET /api/v1/notifications/taxpayer` | `etaService.getNotifications()` · route `GET /api/eta/notifications` |
| 6 | `POST /api/v1.0/codetypes/requests/codes` (Create EGS) | `etaService.createEGSCode()` · route `POST /api/eta/codes` |
| 7 | `GET /api/v1.0/codetypes/requests/my` | `etaService.searchMyCodeRequests()` · route `GET /api/eta/codes/my-requests` |
| 8 | `PUT /api/v1.0/codetypes/requests/codeusages` (Reuse) | `etaService.requestCodeReuse()` · route `PUT /api/eta/codes/reuse` |
| 9 | `GET /api/v1.0/codetypes/:codeType/codes` (Search) | `etaService.searchPublishedCodes()` · route `GET /api/eta/codes/search` |
| 10 | `GET /api/v1.0/codetypes/:codeType/codes/:itemCode` | `etaService.getCodeDetails()` · route `GET /api/eta/codes/:codeType/:itemCode` |
| 11 | `PUT /api/v1.0/codetypes/requests/codes/:reqId` | `etaService.updateEGSCode()` · route `PUT /api/eta/codes/requests/:id` |
| 12 | `PUT /api/v1.0/codetypes/:codeType/codes/:itemCode` | `etaService.updatePublishedCode()` · route `PUT /api/eta/codes/:codeType/:itemCode` |

---

## Section 2 — eInvoicing (20 endpoints — 20/20 ✅)

### Submit Regular Documents

| Postman request | Our implementation |
|---|---|
| JSON — Submit Invoice (I) | `etaService.submitDocuments([doc])` (`POST /api/eta/documents/submit`) |
| JSON — Submit Debit Note (D) | same |
| JSON — Submit Credit Note (C) | same |
| XML — Submit Invoice (I) | `etaService.submitDocumentsXml([doc])` — `Content-Type: application/xml` |
| XML — Submit Debit Note (D) | same |
| XML — Submit Credit Note (C) | same |

The route `POST /api/eta/documents/submit` picks JSON or XML via `body.format` override → `organization_settings.eta_submit_format` → default JSON.

### Submit Export Documents (EI / EC / ED)

| Postman request | Our implementation |
|---|---|
| JSON — Submit Export Invoice (EI) | `submitDocuments([doc])` — same endpoint, `documentType: 'EI'` |
| JSON — Submit Export Debit Note (ED) | same, `documentType: 'ED'` |
| JSON — Submit Export Credit Note (EC) | same, `documentType: 'EC'` |
| XML — Submit Export Invoice (EI) | `submitDocumentsXml([doc])` |
| XML — Submit Export Debit Note (ED) | same |
| XML — Submit Export Credit Note (EC) | same |

### Document state + read APIs

| # | Postman request | Our implementation |
|---|---|---|
| 2 | Cancel Document | `etaService.cancelDocument()` · `PUT /api/eta/documents/:uuid/cancel` |
| 3 | Reject Document | `etaService.rejectDocument()` · `PUT /api/eta/documents/:uuid/reject` |
| 4 | Get Recent Documents | `etaService.getRecentDocuments()` · `GET /api/eta/documents/recent` |
| 5 | Request Document Package | `etaService.requestPackage()` · `POST /api/eta/packages/request` |
| 5.1 | Request Document Package (intermediary) | `etaService.requestIntermediaryPackage()` · `POST /api/eta/packages/intermediary` |
| 6 | Get Package Requests | `etaService.getPackageRequests()` · `GET /api/eta/packages/eta-list` + local `GET /api/eta/packages/history` |
| 7 | Get Document Package (download ZIP) | `etaService.getPackage()` · `GET /api/eta/packages/:id` (returns 202 "Building" while ETA is still preparing) |
| 8 | Get Document (raw JSON) | `etaService.getDocument()` · `GET /api/eta/documents/:uuid/raw` |
| 9 | Get Submission | `etaService.getSubmission()` · `GET /api/eta/submissions/:submissionId` |
| 10 | Get Document Printout (PDF) | `etaService.getDocumentPrintout()` · `GET /api/eta/documents/:uuid/pdf` |
| 11 | Get Document Details | `etaService.getDocumentDetails()` · `GET /api/eta/documents/:uuid/details` |
| 12 | Decline Cancel Document | `etaService.declineCancellation()` · `PUT /api/eta/documents/:uuid/decline-cancellation` |
| 13 | Decline Rejection Document | `etaService.declineRejection()` · `PUT /api/eta/documents/:uuid/decline-rejection` |
| 14 | Search Documents | `etaService.searchDocuments()` · `GET /api/eta/documents/search` |

---

## Section 3 — eReceipt (30+ endpoints — ❌ intentionally skipped)

Per product decision on 2026-04-18 ("شيل فكره الشغل على e-Receipts"), **B2C receipts are out of scope** until the B2B product is declared stable. Applies to:
- POS `/connect/token` flow with `posserial` + `presharedkey` headers
- All 20 industry-specific receipt types (Coffee, Services, Retail, Transportation, Banking, Education, Professional, Shipping, Entertainment, Utilities × Submit/Return)
- Receipt read/search/details/share/recent
- Receipt packages (request/list/download)

The inline skeleton `POST /api/receipts/submit` at `server.ts:5462` stays untouched.

---

## Field-level audit + fix (2026-04-18)

**Gap found and fixed:**

The XML builder at `server/xmlBuilder.ts` previously did not include two fields in its `orderedKeys` list, so they were silently dropped from XML submissions:

| Missing field | Affected document types | Severity |
|---|---|---|
| `serviceDeliveryDate` | EI, EC, ED (all export documents) | HIGH — ETA would reject the submission |
| `references` (array) | C, D, EC, ED (all credit/debit notes referencing an original invoice) | HIGH — referential integrity broken |

**Fix landed**: both keys added to `orderedKeys` in ETA's expected positions. `references` also added to the `getSingularName` mapping so the inner elements render as `<reference>`.

JSON submissions were unaffected — `etaService.submitDocuments()` forwards the document as-is without a field allowlist, so those fields were already making it through.

## Not used by design

Per the audit of the Postman collection, these pieces are present but deliberately not wired:

| Collection feature | Why we skip it |
|---|---|
| `/taxpayer/info/{rin}` | Implemented in `etaService.getTaxpayerInfo` + route `/api/eta/taxpayer/:rin`. Currently gated by ETA — keeps returning an error; the code is ready when they open it. |
| `/system/status` | Not called; our own `/api/health` covers operational status including ETA-dependent health via `etaLimiter` hit patterns. |
| `/delegations` | Delegations are managed through the ETA portal UI — no API need here. |

---

## Conclusion

- **B2B Postman surface: 100% covered** (12 Common + 20 eInvoicing).
- **Both JSON and XML** submission paths work and are user-selectable.
- **All document types** (I, C, D, EI, EC, ED) supported.
- **Field-level bug** (missing `serviceDeliveryDate`, `references` in XML path) **identified and fixed** in this audit.
- **B2C receipts** remain parked by product decision — no coverage gap because no product requirement.
