# Backend Environment Variables (Render)

When deploying this backend to Render, you must set the following environment variables:

## Required

- **DATABASE_URL**: The connection string for your PostgreSQL database (e.g., provided by Supabase, Neon, or Railway).
  - Example: `postgresql://user:password@host:port/database?schema=public`
- **JWT_SECRET**: A secret string used to sign and verify JSON Web Tokens for authentication.
  - Example: `my-super-secret-key-change-this`
- **PORT**: (Optional on Render, auto-assigned) The port the server listens on. Defaults to `3000`.

## Optional / Specific Features

- **GOOGLE_API_KEY**: Required if using AI features (Gemini).
- **ETA_API_URL**: URL for the Egyptian Tax Authority API (if configurable).
- **Other Secrets**: Any other secrets used in `server/server.ts`.

## Build & Start Command for Render

- **Build Command**: `npm install && npm run build` (This runs `npx prisma generate`)
- **Start Command**: `npm start`
