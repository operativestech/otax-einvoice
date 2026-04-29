# تقرير مراجعة مشروع OTax — مقارنة الوثائق بالواقع

> **التاريخ:** 14 مارس 2026
> **النطاق:** مقارنة الـ 4 ملفات توثيق مع الكود الفعلي الموجود في المشروع

> [!IMPORTANT]
> الـ 4 ملفات بتوصف **معمارية مثالية** (`/api/otax/*`، Prisma ORM، 44 endpoint). المشروع الفعلي اتطوّر بشكل مختلف — `server.ts` واحد كبير + route files، قاعدة بيانات بـ `pg` Pool مباشرة. **ده طبيعي لمنتج بيتطور بسرعة.** الوثائق كانت خطة طموحة مش مرآة حرفية.

---

## مقارنة المعمارية

| الجانب | الوثائق بتقول | الواقع الفعلي |
|--------|--------------|--------------|
| بداية الـ API | `/api/otax/*` | `/api/*` |
| قاعدة البيانات | Prisma ORM مع factory pattern | `pg.Pool` مباشر، SQL خام |
| المصادقة | ETA OAuth 2.0 لكل شركة | JWT (يوزر + باسورد) + `clients_info_new` لبيانات ETA |
| هيكلة الباك | 11 ملف controller + service layer | `server.ts` واحد (5949 سطر) + 6 ملفات routes |
| هيكلة الفرونت | Next.js + shadcn + Zustand + React Query | Vite + React + CSS عادي + `useState` |
| الجداول | 12 جدول ثابت في Prisma | جداول ديناميكية لكل شركة (`org_*_documents`) |

---

## حالة كل Feature بالتفصيل

### ✅ خلصان بالكامل (33 حاجة)

| # | الميزة | مكانها في الكود |
|---|--------|----------------|
| 1 | **تسجيل الدخول / الاشتراك / تسجيل الخروج** | `authRoutes.ts`، `Login.tsx`، `Signup.tsx` |
| 2 | **التحقق بـ OTP** | `authRoutes.ts` → `/verify-otp`، `/resend-otp` |
| 3 | **نسيت كلمة السر / إعادة تعيين** | `authRoutes.ts` → `/forgot-password`، `/reset-password` |
| 4 | **دعوة مستخدم / الانضمام لمنظمة** | `authRoutes.ts` → `/invite`، `/join-org`، `/invite/:token/accept` |
| 5 | **لوحة التحكم (Dashboard)** | `Dashboard.tsx`، `/api/dashboard/summary` |
| 6 | **قائمة الفواتير (إدارة المستندات)** | `Invoices.tsx`، `etaRoutes.ts` → `/local/documents` |
| 7 | **تفاصيل الفاتورة** | `etaRoutes.ts` → `/documents/:uuid/details` |
| 8 | **البحث في بوابة ETA** | `etaRoutes.ts` → `/documents/search` |
| 9 | **تحميل PDF** | `etaRoutes.ts` → `/documents/:uuid/pdf` |
| 10 | **رفع فاتورة من Excel** | `InvoiceExcel.tsx`، `server.ts` → `/api/excel/submit` |
| 11 | **إدخال فاتورة يدوي** | `ManualInvoice.tsx` — **تم إعادة تصميمه اليوم** (Header + Lines + Send to ETA) |
| 12 | **إرسال فاتورة عبر ETA Route جديد** | `etaRoutes.ts` → `/documents/submit` |
| 13 | **مزامنة البوابة (سحب من ETA)** | `etaRoutes.ts` → `/sync/start`، `/sync/status`، `/sync/delta` |
| 14 | **اختبار اتصال ETA** | `etaRoutes.ts` → `/test-connection` |
| 15 | **أكواد الأصناف (بحث/إنشاء/مزامنة)** | `etaRoutes.ts` → `/codes/search`، `/codes`، `/codes/sync`، `/codes/my-requests` |
| 16 | **التوقيع الإلكتروني (الـ Agent Bridge)** | `signingRoutes.ts` — رفع PFX، Agent Bridge، اختبار |
| 17 | **الإعدادات / بيانات الشركة** | `Settings.tsx`، `admin.ts` → `/me`، `/organization` |
| 18 | **إدارة المستخدمين والأدوار** | `UserManagement.tsx`، `admin.ts` → `/users`، `/roles`، `/permissions` |
| 19 | **لوحة السوبر أدمن** | `SuperAdminOrganizations.tsx`، `SuperAdminRoles.tsx`، إلخ |
| 20 | **معالج الإعداد (Wizard)** | `Wizard.tsx` — 6 خطوات |
| 21 | **إشعارات ETA** | `etaRoutes.ts` → `/notifications` |
| 22 | **أنواع المستندات** | `etaRoutes.ts` → `/document-types`، `/document-types/:id/versions/:vid` |
| 23 | **حزم ETA** | `etaRoutes.ts` → `/packages/request`، `/packages/:id` |
| 24 | **صفحة التقارير** | `Reports.tsx` |
| 25 | **الـ Live Console (لوج حي)** | WebSocket + أحداث `live-console-log` |
| 26 | **ربط ERP** | `ERPConnector.tsx` |
| 27 | **البيانات الأساسية** | `MasterData.tsx` |
| 28 | **إعدادات الملف الشخصي** | `ProfileSettings.tsx` |
| 29 | **بوابة العملاء** | `CustomerPortal.tsx` |
| 30 | **مرجع ETA** | `ETAReference.tsx` |
| 31 | **تصدير إلى ETA** | `ExportToETA.tsx` |
| 32 | **صحة النظام** | `SystemHealth.tsx` |
| 33 | **سجلات النشاط وتاريخ الدخول** | `admin.ts` → `/activity-logs`، `/login-history` |
| 34 | **إلغاء / رفض فاتورة** | `etaRoutes.ts` → `/documents/:uuid/cancel`، `/reject`، `/decline-rejection`، `/decline-cancellation` + أزرار في الفرونت + إلغاء جماعي |
| 35 | **رفع دفعة مع تتبع المهام** | `server.ts` → `POST /api/excel/batch-submit` (async، يرجع jobId فوراً) + `GET /api/excel/batch-status/:jobId` (polling) + progress bar في الفرونت |
| 36 | **تقارير: تحليل الفجوات** | `server.ts` → `GET /api/reports/gap-analysis` (مقارنة شهرية مبعوثة vs مستلمة) + تاب Gap Analysis في `Reports.tsx` مع كروت ملخص + جدول تفصيلي |
| 37 | **تقارير: الإحصائيات** | `server.ts` → `GET /api/reports/statistics` (حسب الحالة، الشهر، أكتر 10 عملاء/موردين، نسبة النمو) + تاب Statistics في `Reports.tsx` |
| 38 | **المزامنة: سجل وتقدم** | `etaRoutes.ts` → `GET /api/eta/sync/history` + تتبع سجل المزامنات (per-org, auto-records) + `Settings.tsx` مؤشر 'آخر مزامنة' + جدول سجلات |

---

### ⚠️ ناقص جزئياً (5 حاجات)

| # | الميزة | اللي خلص | اللي ناقص |
|---|--------|---------|----------|






---

### ❌ مش موجود خالص (10 حاجات)

| # | الميزة من الوثائق | الأولوية | ملاحظات |
|---|-------------------|----------|--------|
| 1 | **لوحة المطابقة (Reconciliation)** | P1 عالية | عرض 3 أعمدة (ERP/بنك/ETA)، محرك Auto-Match، مطابقة يدوية، قبول/رفض. **مفيش endpoints ولا صفحة** |
| 2 | **مزامنة معاملات ERP** | P1 عالية | استيراد AR/AP من نظام ERP. مش موجود |
| 3 | **رفع كشف حساب بنكي** | P1 عالية | رفع ملفات CSV للبنك. مش موجود |
| 4 | **محرك المطابقة التلقائي (AI)** | P1 عالية | خوارزمية Perfect/WHT/FX/Manual. مش موجود |
| 5 | **CRUD المطابقات** | P1 عالية | إنشاء/قبول/رفض. مش موجود |
| 6 | **تقرير تحليل الفجوات** | P1 عالية | مقارنة البوابة vs ERP. مفيش منطق حساب |
| 7 | **نظام طابور التوقيع** | P2 متوسطة | حالياً مباشر عبر bridge/PFX بدون طابور |
| 8 | **استعلام بيانات دافع الضرائب** | منخفضة | مش موجود |
| 9 | **قواعد بيانات AI (4 views)** | منخفضة | مفيش SQL views |
| 10 | **تصدير إلى Excel/PDF** | P2 متوسطة | مش متنفّذ |

---

## لوحة النتائج

| الفئة | خلصان ✅ | جزئي ⚠️ | ناقص ❌ | الإجمالي |
|-------|---------|---------|---------|----------|
| **المصادقة والمستخدمين** | 10 | 0 | 0 | **10** |
| **المستندات والفواتير** | 9 | 0 | 0 | **9** |
| **مزامنة البوابة** | 4 | 0 | 0 | **4** |
| **عمليات الدفعات** | 2 | 0 | 0 | **2** |
| **المطابقة** | 0 | 0 | 5 | **5** |
| **التقارير والتحليلات** | 3 | 0 | 2 | **5** |
| **التوقيع الإلكتروني** | 3 | 0 | 1 | **4** |
| **أخرى** | 7 | 0 | 2 | **9** |
| **الإجمالي** | **38** | **0** | **10** | **48** |

> **نسبة الإنجاز: ~79% خلصان بالكامل، 0% جزئي، 21% ناقص**

---

## حاجات إضافية اتبنت مش في الوثائق (12 ميزة)

| الميزة | مكانها |
|--------|--------|
| جداول ديناميكية لكل شركة | `orgTables.ts` |
| معالج إعداد SaaS (6 خطوات) | `Wizard.tsx` |
| OTax Agent Bridge (توقيع عن بُعد بـ WebSocket) | `bridgeService`، `signingRoutes.ts` |
| توقيع PFX سحابي (بدون USB) | `pfxSigner.ts` |
| إدارة Super Admin متعددة المنظمات | `superAdmin.ts`، 4 صفحات |
| بوابة العملاء | `CustomerPortal.tsx` |
| صفحة ربط ERP | `ERPConnector.tsx` |
| صفحة البيانات الأساسية | `MasterData.tsx` |
| نظام Lead capture | `leads.ts` |
| تحقق OTP وإيميل | `authRoutes.ts` |
| خطط الاشتراك وحدودها | `superAdmin.ts` → `/plans` |
| منشئ لوحات التحكم | `DashboardCreator.tsx` |

---

## الخطوات المقترحة القادمة (بأولوية)

1. **أزرار إلغاء / رفض فاتورة** — سهلة وسريعة
2. **تقرير تحليل الفجوات (Gap Analysis)** — حساب في الباك + رسم بياني
3. **تصدير إلى Excel/PDF** من صفحة التقارير
4. **لوحة المطابقة (Reconciliation)** — أكبر ميزة ناقصة
5. **نظام مهام غير متزامن للدفعات** — محتاج جدول مهام + polling
6. **تحديث الـ 4 وثائق** لتعكس اللي اتبنى فعلاً
