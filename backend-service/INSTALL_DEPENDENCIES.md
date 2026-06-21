# 🔧 Manual Installation Guide - RBAC Dependencies

## Issue
The packages `bcryptjs`, `jsonwebtoken`, and `@prisma/client` are not installed, causing the server to fail.

## Solution: Install Packages Manually

### Option 1: Install All at Once
Open a **NEW** command prompt and run:

```bash
cd "E:\app\OTax New App\E-Invoice"
npm install bcryptjs jsonwebtoken @prisma/client
npm install --save-dev @types/bcryptjs @types/jsonwebtoken prisma
```

### Option 2: Install One by One
If the above fails, install each package separately:

```bash
npm install bcryptjs
npm install jsonwebtoken
npm install @prisma/client
npm install --save-dev @types/bcryptjs
npm install --save-dev @types/jsonwebtoken
npm install --save-dev prisma
```

### Option 3: Clear npm cache first
If installations keep failing:

```bash
npm cache clean --force
npm install bcryptjs jsonwebtoken @prisma/client
```

## After Installation

### 1. Generate Prisma Client
```bash
npx prisma generate
```

### 2. Run Seed Script
```bash
npx tsx prisma/seed.ts
```

This creates:
- Admin user (username: `admin`, password: `admin123`)
- Demo user (username: `demo`, password: `demo123`)
- All roles and permissions

### 3. Start Server
```bash
npm run server
```

### 4. Test Login
Go to: `http://localhost:3000/login`
- Username: `admin`
- Password: `admin123`

## Verify Installation

Check if packages are installed:
```bash
npm list bcryptjs
npm list jsonwebtoken
npm list @prisma/client
```

All should show version numbers, not "UNMET DEPENDENCY"

## Troubleshooting

### If npm is slow or hanging:
1. Check your internet connection
2. Try using a different npm registry:
   ```bash
   npm config set registry https://registry.npmjs.org/
   ```

### If you get permission errors:
Run command prompt as Administrator

### If packages still won't install:
Check `package.json` - the dependencies should be added automatically. If not, add them manually:

```json
{
  "dependencies": {
    "@prisma/client": "^6.0.0",
    "bcryptjs": "^2.4.3",
    "jsonwebtoken": "^9.0.2"
  },
  "devDependencies": {
    "@types/bcryptjs": "^2.4.6",
    "@types/jsonwebtoken": "^9.0.6",
    "prisma": "^6.0.0"
  }
}
```

Then run:
```bash
npm install
```

## Quick Test Without Installation

If you want to test the system works, you can temporarily comment out the admin routes in `server/server.ts`:

```typescript
// Temporarily disable admin routes
// import adminRoutes from './routes/admin.js';
// app.use('/api/admin', adminRoutes);
// app.use('/api/auth', adminRoutes);
```

This will let the server start with the old login system while you fix the dependencies.
