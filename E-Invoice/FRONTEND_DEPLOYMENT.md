# Frontend Environment Variables (AWS Amplify)

When deploying this frontend to AWS Amplify, you must set the following environment variables:

## Required

- **VITE_API_URL**: The URL of your deployed backend (e.g., your Render URL).
  - Example: `https://my-app-backend.onrender.com`
  - *Note*: Ensure this URL does not end with a slash `/` unless your code expects it.

## Build Settings for AWS Amplify

- **Build Command**: `npm run build`
- **Output Directory**: `dist` (Vite's default output folder)
- **Framework**: Web / React
