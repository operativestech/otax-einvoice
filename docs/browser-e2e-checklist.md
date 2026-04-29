# Browser E2E Checklist — OTax

> قائمة مرجعية لاختبار كل الـ features اليدوية من المتصفح قبل الـ production.
> الهدف: نمشّي flow حقيقي على كل feature تم بناؤها في Phase 1-5.

## تشغيل البيئة محلياً

**Terminal 1 — Backend:**
```bash
cd "E:/app/OTax New App/backend-service"
npm run dev
```
تتأكد من الـ log:
```
[Server] Backend listening at http://0.0.0.0:3001
[DB Init] Schema verification completed successfully.
[Indexes] Backfilled document indexes for N active orgs.
[SigningWorker] starting (interval: 15000ms, bridge: yes)
```

**Terminal 2 — Frontend:**
```bash
cd "E:/app/OTax New App/E-Invoice"
npm run dev
```
افتح `http://localhost:5173` (أو اللي بيطلع في الـ log).

---

## ✅ Checklist الكامل

### 1. Login + Session
- [ ] Login بحساب Mohamed Essam (portal_users.id=1)
- [ ] تأكد الاسم والشركة ظاهرين في الـ TopBar
- [ ] افتح DevTools → Network → تأكد الـ JWT token في localStorage

### 2. Dashboard
- [ ] الـ 8 KPIs ظاهرين بأرقام فعلية (مش 0)
- [ ] الـ Area chart بيعرض آخر 7 أيام
- [ ] الـ Pie chart (Status Distribution) موجود
- [ ] **Reconciliation widget** (جديد) ظاهر تحت — بيعرض Suggested/Accepted + bars
- [ ] **Signing Queue widget** (جديد) ظاهر — 4 tiles (Queued/Processing/Signed/Failed)
- [ ] الضغط على Link "Open" في أي widget بينقلك للصفحة الصح

### 3. Invoices List
- [ ] الفواتير بتظهر في جدول
- [ ] الـ filters شغّالة (date, status, direction)
- [ ] الضغط على uuid بيفتح details

### 4. **Export Packages** (Feature جديد)
ادخل على `/export-packages`:
- [ ] الصفحة بتفتح بدون errors
- [ ] Date range default = الشهر اللي فات
- [ ] Type dropdown: Summary / Full
- [ ] Format dropdown: JSON / XML
- [ ] Status chips: Valid / Cancelled / Rejected / Submitted (كلهم clickable)
- [ ] Document type chips: I / C / D / EI / EC / ED
- [ ] Intermediary checkbox بيظهر Representee RIN field
- [ ] اضغط **Submit Request** بدون تحديد أي status → رسالة خطأ "Pick at least one status"
- [ ] اختار Valid فقط + Submit → طلب بينجح ويظهر rid
- [ ] الجدول يعرض الصف بـ status: **Submitted**
- [ ] اضغط **Refresh** → الجدول يحدّث
- [ ] اضغط **Download** على صف Submitted → لو ETA لسه بتبني ZIP، alert: "Package is still being prepared"
- [ ] بعد دقيقة-دقيقتين اضغط Download تاني → الـ ZIP ينزل فعلاً
- [ ] الـ ZIP يفتح في Windows Explorer ويحتوي على ملف JSON/XML داخله

### 5. **Reconciliation** (Feature جديد — أهم واحد)
#### Upload tab
- [ ] ادخل على `/reconciliation`
- [ ] 5 tabs ظاهرين: Upload / ERP Rows / Bank Rows / Matches / Summary / Batches
- [ ] Upload tab مفتوح بـ 2 cards (ERP + Bank)

**ERP Upload:**
- [ ] جهّز CSV تجريبي — استعمل example من `docs/reconciliation-import.md`
- [ ] اضغط "Choose File" واختاره
- [ ] اضغط Upload → success message مع batch ID + inserted count
- [ ] تحقق من skipped rows (لو في)

**Bank Upload:**
- [ ] نفس الخطوات مع bank CSV
- [ ] تأكد ملء "Bank Account Label" زي "NBE — Main"
- [ ] Upload → ينجح

#### ERP Rows tab
- [ ] الصفوف اللي رفعتها بتظهر
- [ ] **Export Excel** button شغّال — ينزّل ملف .xlsx يفتح في Excel بدون أخطاء

#### Bank Rows tab
- [ ] الصفوف بتظهر
- [ ] الـ amount بالأحمر للـ negative (سحب) وأخضر للإيداع
- [ ] **Export Excel** شغّال

#### Matches tab
- [ ] حدد date range يغطي الـ uploads
- [ ] اضغط **Run Auto-Match**
- [ ] بعد ثواني تظهر suggestions في 3-column cards (ERP / Bank / ETA)
- [ ] كل card فيها confidence badge ولون حسب النوع (PERFECT / WHT / FX / MANUAL)
- [ ] الـ filter tabs: Suggested / Accepted / Rejected
- [ ] اضغط **Accept** على match → يتنقل تلقائياً لتاب Accepted
- [ ] اضغط **Reject** على آخر → يتنقل لتاب Rejected
- [ ] **Export Excel** ينزّل كل matches في الـ filter الحالي

#### Summary tab
- [ ] 4 KPI cards: Suggested / Accepted / Rejected / Matched Total
- [ ] ERP Coverage + Bank Coverage bars
- [ ] جدول Matches by Type × Status
- [ ] **Export Excel** ينزّل sheet summary + breakdown

#### Batches tab
- [ ] كل الـ uploads بتظهر (ERP + Bank)
- [ ] اضغط **Delete** على batch → confirmation → يتحذف
- [ ] تأكد إن الـ rows المرتبطة اختفت من ERP Rows / Bank Rows tabs

### 6. **Signing Queue** (Feature جديد)
#### عبر الـ TopBar
- [ ] لو في queued/failed jobs، بيظهر pill أصفر/أحمر جنب الـ Bell icon

#### عبر الـ API (اختياري للـ admin)
- [ ] Enqueue test job عن طريق Postman:
  ```
  POST /api/signing/queue
  Authorization: Bearer <token>
  { "method": "pfx", "document": {...}, "internalId": "TEST-1" }
  ```
- [ ] الـ TopBar يحدّث في خلال 30 ثانية
- [ ] بعد 15 ثانية تقريباً الـ worker يلتقطه ويجرب — لو PFX مش مرفوع، هيعمل FAILED بعد 3 محاولات
- [ ] الـ TopBar pill يتحول لأحمر

### 7. Dashboard widget polling
- [ ] ارجع للـ Dashboard بعد ما عملت matches + queue activity
- [ ] الـ Reconciliation widget بيعرض العدد الجديد
- [ ] الـ Signing Queue widget بيعرض الـ failed count

### 8. **Chatbot / AI Assistant** (Feature جديد)
- [ ] في الـ Dashboard فيه floating button أزرق في الـ bottom-right
- [ ] ضغط عليه → يفتح panel
- [ ] الرسالة الأولى فيها welcome Arabic + English
- [ ] فيه 4 preset chips تحت الـ messages (لو أول مرة)
- [ ] اسأل: "what is error 4062?" → جواب واضح (keyword mode بدون Gemini key)
- [ ] اسأل: "show me reconciliation" → جواب
- [ ] لو ضفت `GEMINI_API_KEY` في .env + restart: اسأل "how many invoices last month?" → رقم حقيقي من DB

### 9. Reports
- [ ] `/reports` بيفتح
- [ ] Invoices tab: Export Excel ينزل ملف
- [ ] Gap Analysis tab: بعد Generate Report → Export Excel ظاهر ويشتغل
- [ ] Statistics tab: Export Excel ظاهر ويشتغل

### 10. Settings
- [ ] `/settings/otaxconn` بيفتح
- [ ] فيه **Submission Format dropdown** جديد: JSON / XML
- [ ] غيّره لـ XML + Save
- [ ] Reload → القيمة محفوظة

### 11. Error Boundary
- [ ] افتح DevTools Console
- [ ] DevTools → Sources → React component tree → force a throw في أي component (مثلاً عبر React DevTools)
- [ ] تتأكد من ظهور الـ ErrorBoundary UI (Try again button)
- [ ] الضغط على "Try again" يرجّع الـ component

### 12. Sidebar + Navigation
- [ ] كل الـ sidebar items تشتغل
- [ ] الـ badge "New" على Reconciliation و Finance Nav
- [ ] الأيقونات صح

### 13. RBAC (advanced)
اختياري — لو عايز تتأكد من الـ RBAC:
- [ ] اعمل user جديد بـ role "viewer" وعند perm `reconciliation.view` فقط
- [ ] Login بيه → يقدر يفتح /reconciliation ويشوف rows
- [ ] يحاول Upload → يلاقي 403 Insufficient permissions

### 14. Rate Limiting (advanced)
- [ ] افتح DevTools Network
- [ ] في Chatbot، كبس prompt × 25 مرة متتالية بسرعة
- [ ] بعد الـ 20th call، الـ Network hit بيرجع **429** status
- [ ] الـ UI هيظهر error message "Too many requests"

---

## أرقام النجاح

| Category | Expected |
|---|---|
| UI loads in all sidebar pages | ✅ |
| Reconciliation CSV → Auto-Match → Accept | works end-to-end |
| Package request → ETA responds → Download | works (may take minutes) |
| Chatbot responds (keyword or Gemini) | ✅ |
| Export Excel from any table | opens in Excel cleanly |
| Error Boundary catches a thrown error | ✅ |

---

## لو لقيت bug

1. خذ screenshot + open DevTools Console + copy error
2. Network tab — لو API call فشل، capture الـ request/response
3. سجّل في `docs/bugs-found.md` (خلق جديد):
   - الخطوة اللي حصل عندها الـ bug
   - الـ expected behavior
   - الـ actual behavior
   - الـ error message من console

بعدين نرجع نصلّحها.
