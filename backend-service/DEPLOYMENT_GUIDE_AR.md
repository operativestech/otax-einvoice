# دليل النشر ومتغيرات البيئة (Deployment & Environment Variables Guide)

هذا الملف يحتوي على كافة المعلومات اللازمة لنشر المشروع بنجاح، مقسماً إلى جزئين: الخلفية (Backend) والواجهة الأمامية (Frontend).

---

## 🚀 أولاً: الخلفية (Backend) - للنشر على Render

يتم نشر هذا الجزء من الفرع المسمى **`backend`**.

### 1. إعدادات البناء (Build Settings)
عند إنشاء "Web Service" جديد على Render، استخدم الإعدادات التالية:

- **Build Command:** `npm install && npm run build`
- **Start Command:** `npm start`

### 2. متغيرات البيئة المطلوبة (Environment Variables)
يجب إضافة هذه المتغيرات في قسم "Environment" في لوحة تحكم Render:

| اسم المتغير (Key) | الوصف | مثال للقيمة (Value) |
| :--- | :--- | :--- |
| **`DATABASE_URL`** | **(مطلوب)** رابط الاتصال بقاعدة بيانات PostgreSQL. يمكن الحصول عليه من مزود الخدمة (مثل Neon, Railway, Supabase). | `postgresql://user:pass@host:5432/dbname?sslmode=require` |
| **`JWT_SECRET`** | **(مطلوب)** نص سري عشوائي ومعقد يستخدم لتشفير توكن الدخول وتأمين الجلسات. | `my-super-complex-secret-key-2026` |
| **`GOOGLE_API_KEY`** | (اختياري) مفتاح API لخدمات Google Gemini (الذكاء الاصطناعي). | `AIzaSy...` |
| **`PORT`** | (اختياري) يقوم Render بضبطه تلقائياً. لا تقم بإضافته يدوياً إلا إذا كنت تعرف ما تفعل. | `10000` (افتراضي) |

---

## 💻 ثانياً: الواجهة الأمامية (Frontend) - للنشر على AWS Amplify

يتم نشر هذا الجزء من الفرع المسمى **`frontend`**.

### 1. إعدادات البناء (Build Settings)
سيقوم AWS Amplify باكتشاف هذه الإعدادات تلقائياً، ولكن للتأكد:

- **Framework:** Web / React
- **Build Command:** `npm run build`
- **Output Directory:** `dist`

### 2. متغيرات البيئة المطلوبة (Environment Variables)
يجب إضافة هذا المتغير في إعدادات التطبيق على AWS Amplify:

| اسم المتغير (Key) | الوصف | مثال للقيمة (Value) |
| :--- | :--- | :--- |
| **`VITE_API_URL`** | **(مهم جداً)** رابط السيرفر (Backend) الذي قمت بنشره في الخطوة الأولى على Render. هذا الرابط يخبر الفرونت إند أين يرسل البيانات. | `https://my-backend-app.onrender.com` |

**⚠️ ملاحظات هامة للفرونت إند:**
1.  تأكد من **عدم** وضع علامة `/` في نهاية رابط الـ `VITE_API_URL`.
2.  بعد إضافة المتغيرات في AWS Amplify، قد تحتاج إلى عمل **Re-deploy** مرة أخرى لكي يتم تفعيل الرابط الجديد.

---

## 🔗 ملخص الروابط (GitHub Branches)

- **كود الباك إند (لـ Render):**
  [https://github.com/otax-tech/E-Invoice/tree/backend](https://github.com/otax-tech/E-Invoice/tree/backend)

- **كود الفرونت إند (لـ AWS Amplify):**
  [https://github.com/otax-tech/E-Invoice/tree/frontend](https://github.com/otax-tech/E-Invoice/tree/frontend)
