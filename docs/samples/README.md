# Sample CSV files for Reconciliation

جاهزين للرفع من `/reconciliation` → Upload tab.

| ملف | الصفحة | ماذا يحتوي |
|---|---|---|
| `erp-sample.csv` | ERP upload | 5 AR + 3 AP — مع AR/AP types، currencies مختلفة (EGP + USD)، مواعيد، statuses متنوعة |
| `bank-sample.csv` | Bank upload | حركات مع `amount` signed (موجب = إيداع، سالب = سحب) |
| `bank-sample-credit-debit.csv` | Bank upload | نفس الحركات بس عمودين منفصلين `credit` و `debit` بدل `amount` |

## إزاي تستخدمهم للاختبار

1. روح `/reconciliation` → Upload tab
2. ارفع `erp-sample.csv` في الـ ERP card
3. ارفع `bank-sample.csv` في الـ Bank card (حط label مثلاً "NBE — Main")
4. روح **Matches** tab
5. حدد التاريخ: `2026-03-01` → `2026-03-31`
6. اضغط **Run Auto-Match**

## النتايج المتوقعة

| ERP Doc | Bank Transaction | Match Type | Confidence | سبب |
|---|---|---|---|---|
| INV-2026-0001 (12500.50 EGP) | TX20260305-001 (+12500.50 EGP) | PERFECT | ~97% | نفس المبلغ + نفس اليوم |
| INV-2026-0002 (3200 EGP) | TX20260312-002 (+3200 EGP) | PERFECT | ~97% | نفس المبلغ + نفس اليوم |
| INV-2026-0003 (1000 EGP) | TX20260310-003 (+970 EGP) | WHT | ~80% | 3% خصم ضريبي = 970 |
| INV-2026-0004 (5000 USD) | TX20260315-004 (+155000 EGP) | FX | ~60% | عملات مختلفة، سعر صرف 31.0 |
| BILL-2026-1001 (875.25 EGP) | TX20260320-006 (-875.25 EGP) | PERFECT | ~97% | AP ضد debit = صح |
| BILL-2026-1002 (6700 EGP) | TX20260322-007 (-6700 EGP) | PERFECT | ~97% | |
| INV-2026-0005, BILL-2026-1003 | — | (skipped) | — | مافيش bank row مقابل |
| — | FEE-202603 (-150 EGP) | — | — | مافيش ERP row مقابل |

## ملاحظات

- الـ `bank-sample-credit-debit.csv` يفترض نفس النتايج بالضبط — يختبر الـ fallback للـ credit/debit split
- لو تريد تجرب WHT اختبار آخر، عدّل `1000` في ERP إلى `10000` و `970` في Bank إلى `9500` (5% WHT)
- لو تريد تجرب FAILED auto-match، ارفع ERP بـ dates خارج الـ window اللي هتحدده في Run Auto-Match
