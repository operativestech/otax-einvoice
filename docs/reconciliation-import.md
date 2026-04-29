# Reconciliation — CSV / Excel Import Guide

> دليل رفع بيانات ERP وكشوف البنك لوحدة المطابقة في OTax.
>
> الصفحة: **`/reconciliation`** → تاب **Upload**
> الحدّ الأقصى لكل ملف: **10 MB** و **50,000 صف**. الملفات الأكبر اتقسم.

---

## 1) ملف ERP Transactions (AR / AP)

### الأعمدة المتوقعة (بالإنجليزي أو مرادفاتها)

الـ parser بيعمل **fuzzy matching** — يعني اسم العمود case-insensitive ويتجاهل الـ spaces / underscores / dashes.

| الحقل في الـ DB | أسماء الأعمدة المقبولة (أي واحد) | إلزامي؟ | ملاحظات |
|---|---|---|---|
| `tx_type` | `type` / `tx_type` / `direction` | ✅ | القيمة: `AR` (مبيعات) أو `AP` (مشتريات). كمان بيقبل: `SALE`, `INVOICE` → AR ؛ `PURCHASE`, `BILL` → AP |
| `amount` | `amount` / `total` / `grand_total` / `net_amount` | ✅ | رقم موجب. فواصل الآلاف (،) والعملة بتتشال تلقائياً |
| `doc_number` | `doc_number` / `invoice_number` / `bill_number` / `document_number` / `reference_number` | ⏳ اختياري | رقم الفاتورة في الـ ERP |
| `counterparty_id` | `counterparty_id` / `tax_id` / `vendor_id` / `customer_id` / `party_tax_id` | ⏳ اختياري | الـ Tax ID للعميل/المورد (مهم جداً للـ auto-match) |
| `counterparty_name` | `counterparty_name` / `customer_name` / `vendor_name` / `party_name` / `name` | ⏳ اختياري | اسم العميل/المورد |
| `issue_date` | `issue_date` / `invoice_date` / `date` / `doc_date` | ⏳ اختياري | تاريخ الفاتورة |
| `due_date` | `due_date` / `payment_due_date` / `maturity_date` | ⏳ اختياري | تاريخ الاستحقاق |
| `currency` | `currency` / `ccy` | ⏳ اختياري | default `EGP` |
| `status` | `status` / `payment_status` / `state` | ⏳ اختياري | مثل `Open`, `Paid`, `Partial` |
| `external_ref` | `external_ref` / `reference` / `ref` / `notes` | ⏳ اختياري | أي ملاحظة حرة |

### مثال CSV

```csv
type,doc_number,counterparty_id,counterparty_name,issue_date,due_date,amount,currency,status
AR,INV-1001,555555555,Acme Corp,2026-03-05,2026-04-05,12500.50,EGP,Open
AR,INV-1002,666666666,Globex Ltd,2026-03-10,,1000,EGP,Paid
AP,BILL-2001,444444444,Office Supplies Co,2026-03-20,2026-04-20,875.25,EGP,Open
```

### الصفوف اللي الـ parser بيرفضها ويعرّفك عن رقمها

- نوع مش معروف (مش AR/AP/SALE/INVOICE/PURCHASE/BILL)
- `amount` فاضي أو مش رقم
- سطر كله فاضي

---

## 2) ملف Bank Statement

### الأعمدة المتوقعة

| الحقل في الـ DB | أسماء الأعمدة المقبولة | إلزامي؟ | ملاحظات |
|---|---|---|---|
| `statement_date` | `date` / `statement_date` / `posting_date` / `transaction_date` | ✅ | تاريخ الحركة في البنك |
| `amount` (signed) | `amount` / `signed_amount` | ✅ أو استبدله بـ credit+debit | موجب = إيداع، سالب = سحب |
| credit/debit (بديل) | `credit`/`deposit`/`in` و `debit`/`withdrawal`/`out` | ✅ لو `amount` مش موجود | الـ parser يحسب `amount = credit − debit` |
| `value_date` | `value_date` / `effective_date` | ⏳ اختياري | |
| `description` | `description` / `details` / `narrative` / `memo` | ⏳ اختياري | نص حر (المفيد للمطابقة بالنية — بعدين في WHT detection) |
| `reference` | `reference` / `ref` / `transaction_id` | ⏳ اختياري | ترميز العملية |
| `balance_after` | `balance` / `balance_after` / `running_balance` | ⏳ اختياري | الرصيد بعد العملية |
| `currency` | `currency` / `ccy` | ⏳ اختياري | default `EGP` |

### مثال CSV — بعمود `amount` واحد

```csv
date,description,reference,amount,balance
2026-03-05,Wire transfer from Acme Corp,TX001,12500.50,125000.50
2026-03-10,Globex partial payment,TX002,970.00,125970.50
2026-03-12,Office Supplies payment,TX003,-875.25,125095.25
```

### مثال CSV — بـ credit/debit منفصلين

```csv
date,description,reference,credit,debit,balance
2026-03-05,Wire transfer from Acme Corp,TX001,12500.50,,125000.50
2026-03-12,Office Supplies payment,TX003,,875.25,124125.25
```

### الـ Bank Account Label

في صفحة الـ Upload فيه خانة **"Bank Account Label"** اختيارية — مثلاً "NBE — Main" أو "CIB — USD". ده بس label في الواجهة عشان تفرق بين الحسابات لو عندك أكتر من واحد. مش بتتبعت لـ ETA.

---

## 3) صيغ التواريخ المقبولة

الـ parser يحاول كل الصيغ دي بالترتيب:

| Format | مثال | ملاحظات |
|---|---|---|
| ISO 8601 | `2026-03-15` | الأسلم والأفضل |
| ISO مع وقت | `2026-03-15T10:30:00Z` | |
| Excel serial | رقم تلقائي من Excel | لو التاريخ متخزّن كرقم داخل Excel |
| DD/MM/YYYY | `15/03/2026` | الصيغة المصرية المعتادة |
| DD-MM-YYYY | `15-03-2026` | |
| D/M/YY | `15/3/26` | السنوات أقل من 100 بيتحط قدامها 20 |

> ⚠️ لا تخلط صيغتين في نفس الملف. ممكن تدي نتائج عشوائية (مثلاً 03/04/2026 غامض: مارس 4 ولا أبريل 3؟).

---

## 4) إيه اللي بيحصل بعد الرفع؟

1. كل رفع بياخد **Batch ID** (UUID). بيظهر في History tab وبيتحفظ مع كل row.
2. البيانات الأصلية (raw row) بتتخزّن في عمود `raw_data` JSONB — ده بقى محفوظ للـ audit.
3. تقدر **تحذف batch بالكامل** من تاب **Batches** لو غلطت في الرفع.
4. بعد ما ترفع الجهتين (ERP + Bank)، روح تاب **Matches** وضغط **Run Auto-Match** في فترة زمنية.

---

## 5) محرك الـ Auto-Match باختصار

- **PERFECT** (ثقة ≥ 85%): الـ amount متطابق (فرق < 0.2%) + نفس العملة + التاريخ قريب
- **WHT** (ثقة 70-85%): الـ bank amount = ERP × (1 − نسبة خصم). النسب المتوقعة: 0.5%, 1%, 1.5%, 3%, 5%, 10%
- **FX** (ثقة 55-70%): العملات مختلفة لكن الـ implied rate (bank÷erp) معقول (بين 0.005 و 2000)
- **MANUAL** (ثقة 40-60%): أرقام قريبة (فرق < 5%) لكن لا بتناسب أي scenario — محتاجة مراجعة بشرية

الـ engine **لا يقبل** matches ثقتهم أقل من 30% (قابل للتخصيص عبر `minConfidence` في الـ API).

### أمثلة على ترجمة الـ matches

| السيناريو | الـ match الأرجح |
|---|---|
| فاتورة 10,000 EGP ↔ تحويل بنكي 10,000 EGP نفس اليوم | PERFECT 95% |
| فاتورة 10,000 EGP ↔ تحويل 9,700 EGP (3% WHT) | WHT 80% |
| فاتورة 1,000 USD ↔ تحويل 31,000 EGP | FX 60% (implied rate 31.0) |
| فاتورة 10,000 EGP ↔ تحويل 9,950 EGP | MANUAL 45% (فرق 0.5%) |

---

## 6) أشهر الأخطاء وحلولها

| المشكلة | الحل |
|---|---|
| `Unknown type "sales"` | استخدم `AR` أو `INVOICE` بدل `sales` |
| `Missing or unparseable amount` | تأكد إن العمود اسمه `amount` مش `total_amount_egp`، وإنه فيه أرقام |
| `File has X rows — exceeds limit of 50000` | قسّم الملف لشهور أو أرباع سنة |
| كل الـ rows اتسكيبت | غالباً الـ delimiter غلط — CSV في Excel أحياناً بيتخزّن بـ `;` بدل `,`. افتحه بـ Notepad وتأكد |
| التاريخ طلع شهر بدل يوم | ملفك DD/MM بس الـ parser قرا MM/DD. استخدم ISO `2026-03-15` |

---

## 7) الـ API مباشرة (للـ integrations)

```http
POST /api/reconciliation/imports/erp
Authorization: Bearer <JWT>
Content-Type: multipart/form-data
→ field "file" = your.csv or your.xlsx

POST /api/reconciliation/imports/bank
Authorization: Bearer <JWT>
Content-Type: multipart/form-data
→ field "file" = your.csv
→ field "bank_account" = "NBE — Main" (optional label)

POST /api/reconciliation/matches/auto-match
Authorization: Bearer <JWT>
{ "dateFrom": "2026-03-01", "dateTo": "2026-03-31" }
```

Response for uploads:
```json
{
  "success": true,
  "batchId": "4b1a0ad6-cc84-49f7-9941-b7b703159b14",
  "insertedCount": 47,
  "skippedCount": 3,
  "skipped": [{ "row": 14, "reason": "Missing or unparseable amount" }],
  "totalRowsInFile": 50
}
```

---

## 8) الأذونات المطلوبة

| العملية | الإذن |
|---|---|
| قراءة matches, imports, history, summary | `reconciliation.view` |
| رفع ERP/Bank, run auto-match, accept/reject, delete batch | `reconciliation.manage` |

أي مستخدم بدور `org_admin` بيقدر على الاتنين تلقائياً. لو عايز تعمل دور "Viewer" مقيّد بـ `view` فقط، روح صفحة Super Admin → Roles.
