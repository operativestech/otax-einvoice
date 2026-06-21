# E-Invoice System - Quick Start Guide

## For New Developers

This guide will get you up and running with the E-Invoice system in 30 minutes.

---

## Prerequisites

Before you begin, ensure you have:

- [x] Windows 10/11
- [x] Node.js v14+ installed
- [x] Git installed
- [x] Hardware USB token with certificate
- [x] Token PIN
- [x] ETA API credentials (Client ID & Secret)

---

## Step 1: Clone and Install (5 min)

```bash
# Clone the repository
cd e:\E-Invoice
git clone <your-repo-url> E-Invoice
cd E-Invoice

# Install dependencies
npm install

# Install client dependencies
cd client
npm install
cd ..
```

---

## Step 2: Setup Digital Signature (15 min)

### 2.1 Install Token Drivers

1. Download: https://egypttrust.com/uploads/2021/01/Egypt_Trust_Activation.zip
2. Run `Egypt_Trust_Activation.msi`
3. Select "Private CSP" during installation
4. Click "Yes" on security warning for Egypt_RootCA_G1

### 2.2 Install .NET 7.0

1. Download: https://dotnet.microsoft.com/download/dotnet/7.0
2. Install "Desktop Runtime x64"

### 2.3 Setup Signer

```bash
# Clone signer repository
git clone https://github.com/ahmadabousetta/Egypt-tax-invoice-api.git temp_signer

# Copy signer files
xcopy temp_signer\c#_signer\publish\* EInvoicingSigner\ /E /Y

# Clean up
rmdir /s /q temp_signer
```

### 2.4 Get Certificate Info

```bash
# Find your certificate issuer
certutil -user -store My
```

Look for your certificate and note the **Issuer CN** (e.g., "MCDR CA 2022")

### 2.5 Configure Signer

Create `EInvoicingSigner\SubmitInvoices.bat`:

```batch
@echo off
set "app_dir=%~dp0"
set "app_dir=%app_dir:~0,-1%"
call "%app_dir%\EInvoicingSigner.exe" "%app_dir%" YOUR_PIN "YOUR_ISSUER"
pause
```

Replace:
- `YOUR_PIN` with your token PIN
- `YOUR_ISSUER` with your certificate issuer name

---

## Step 3: Configure Environment (5 min)

Create `.env` file in project root:

```env
# Server
PORT=3000
NODE_ENV=development

# Database
DATABASE_PATH=./database.db

# ETA API
ETA_CLIENT_ID=your_client_id_here
ETA_CLIENT_SECRET=your_client_secret_here
ETA_ENVIRONMENT=preprod

# Certificate
CERTIFICATE_PIN=09761969
CERTIFICATE_ISSUER=MCDR CA 2022

# Session
SESSION_SECRET=change_this_to_random_string
```

---

## Step 4: Initialize Database (2 min)

```bash
# The database will be created automatically on first run
# Just make sure the path exists
mkdir database 2>nul
```

---

## Step 5: Start the Application (3 min)

### Development Mode

```bash
# Terminal 1: Start backend
npm run server

# Terminal 2: Start frontend
cd client
npm start
```

### Production Mode

```bash
# Build frontend
cd client
npm run build
cd ..

# Start server (serves both API and frontend)
npm run server
```

---

## Step 6: First Login

1. Open browser: `http://localhost:3000`
2. Click "Sign Up"
3. Create account
4. Fill in company information
5. Save settings

---

## Step 7: Test Invoice Submission

### Manual Invoice

1. Click "Create Invoice"
2. Fill in customer details
3. Add invoice lines
4. Click "Submit to ETA"
5. Check status (should be "Valid")

### Excel Import

1. Prepare Excel file with columns:
   - Customer Name, Tax ID, Item Description, Quantity, Price, etc.
2. Click "Import from Excel"
3. Upload file
4. Review and submit

---

## Verification Checklist

After setup, verify:

- [ ] Server starts without errors
- [ ] Frontend loads at http://localhost:3000
- [ ] Can create user account
- [ ] Can save company settings
- [ ] Signer generates signature (~5,500 chars)
- [ ] Invoice submits to ETA successfully
- [ ] Invoice status shows "Valid"
- [ ] No error 4062 or 4043

---

## Common Issues

### "Cannot find module"
```bash
# Reinstall dependencies
rm -rf node_modules
npm install
```

### "Port already in use"
```bash
# Change PORT in .env
PORT=3001
```

### "Signer not found"
```bash
# Verify signer path
dir EInvoicingSigner\EInvoicingSigner.exe
```

### "No device detected"
```bash
# Check certificate issuer name
certutil -user -store My
# Update SubmitInvoices.bat with correct issuer
```

---

## Project Structure

```
E-Invoice/
├── client/              # React frontend
├── server/              # Node.js backend
├── EInvoicingSigner/    # Digital signature tool
├── invoices/            # Submitted invoices (XML)
├── uploads/             # Excel uploads
├── database.db          # SQLite database
└── .env                 # Configuration
```

---

## Next Steps

1. **Read Documentation**
   - `DIGITAL_SIGNATURE_SETUP.md` - Detailed signature setup
   - `PROJECT_ARCHITECTURE.md` - System architecture
   - `README.md` - Project overview

2. **Customize**
   - Update company branding in frontend
   - Configure tax rates in `invoiceCalculator.ts`
   - Add custom invoice templates

3. **Deploy**
   - Set up production server
   - Configure SSL certificate
   - Set up backup system

---

## Getting Help

- **Documentation**: Check the `/docs` folder
- **Logs**: Check console output for errors
- **ETA Portal**: https://invoicing.eta.gov.eg
- **Token Manager**: ePass2003 Token Manager

---

## Development Tips

### Hot Reload

Frontend has hot reload enabled. Backend requires restart for changes.

### Debugging

```bash
# Enable debug mode
NODE_ENV=development npm run server
```

### Database Inspection

```bash
# Install SQLite browser
# Open database.db to inspect data
```

---

**Ready to start building!** 🚀

For detailed information, see:
- `DIGITAL_SIGNATURE_SETUP.md`
- `PROJECT_ARCHITECTURE.md`
