# E-Invoice Project Architecture

## Project Overview

This is a complete E-Invoice management system for Egyptian Tax Authority (ETA) compliance, featuring:

- **Frontend**: React-based web interface for invoice management
- **Backend**: Node.js/Express API server
- **Digital Signature**: Hardware token integration for CAdES-BES signatures
- **Database**: SQLite for local data storage

---

## Directory Structure

```
E-Invoice/
├── client/                    # React frontend application
│   ├── public/               # Static assets
│   └── src/                  # React components and logic
│
├── server/                    # Node.js backend
│   ├── csharpSignerIntegration.ts    # Hardware token signer integration
│   ├── etaBuilder.ts                  # ETA document builder
│   ├── etaSerialization.ts            # ETA-compliant serialization
│   ├── invoiceCalculator.ts           # Tax and total calculations
│   ├── server.ts                      # Main Express server
│   └── ...
│
├── EInvoicingSigner/          # C# digital signature tool
│   ├── EInvoicingSigner.exe          # Signer executable
│   ├── SubmitInvoices.bat            # Signer launcher script
│   ├── SourceDocumentJson.json       # Input (unsigned document)
│   └── FullSignedDocument.json       # Output (signed document)
│
├── invoices/                  # Submitted invoice XML files
├── uploads/                   # Excel import uploads
├── database.db               # SQLite database
└── .env                      # Environment configuration
```

---

## Key Components

### 1. Frontend (React)

**Location**: `client/src/`

**Key Features**:
- Invoice creation and management
- Excel import for bulk invoices
- Real-time submission status
- Company settings management
- AI assistant for ETA guidance

**Main Components**:
- `App.tsx` - Main application entry
- `InvoiceForm.tsx` - Manual invoice creation
- `ExcelImport.tsx` - Bulk import interface
- `Settings.tsx` - Company configuration

### 2. Backend (Node.js/Express)

**Location**: `server/`

**Key Modules**:

#### `server.ts`
- Main Express server
- API endpoints for invoice CRUD
- ETA submission orchestration
- Authentication and session management

#### `csharpSignerIntegration.ts`
- **Purpose**: Interface with hardware token signer
- **Function**: `signInvoiceWithCsharpSigner(document, pin, issuer)`
- **Process**:
  1. Write unsigned document to `SourceDocumentJson.json`
  2. Execute `EInvoicingSigner.exe` with token PIN
  3. Read signed document from `FullSignedDocument.json`
  4. Extract signature and return signed document

#### `etaBuilder.ts`
- **Purpose**: Build ETA-compliant document structure
- **Function**: `buildETADocument(invoice, issuer)`
- **Features**:
  - Proper field ordering
  - Data type formatting
  - Address structure validation

#### `etaSerialization.ts`
- **Purpose**: Canonical serialization for signature generation
- **Functions**:
  - `serializeETA(document)` - JSON serialization
  - `serializeInvoice(document)` - General serialization
- **Rules**:
  - Uppercase keys
  - Plural array keys
  - Natural number formatting
  - Specific quote escaping

#### `invoiceCalculator.ts`
- **Purpose**: Calculate taxes and totals
- **Function**: `calculateInvoice(invoice)`
- **Calculations**:
  - Line item totals
  - Tax amounts (T1, T2, etc.)
  - Discounts
  - Net and gross totals

### 3. Digital Signature System

**Location**: `EInvoicingSigner/`

**Components**:

#### `EInvoicingSigner.exe`
- C# .NET 7.0 application
- Uses `Pkcs11Interop` for hardware token access
- Uses `BouncyCastle` for CAdES-BES signature generation
- Includes full certificate chain (Signer + Intermediate + Root)

#### `SubmitInvoices.bat`
- Launcher script
- Passes token PIN and certificate issuer name
- Configured per installation

**Signature Flow**:
1. Document serialized to canonical format
2. SHA-256 hash calculated
3. Hash signed with private key on token
4. CAdES-BES structure created with:
   - Signature value
   - Signing certificate
   - Certificate chain
   - Signing time
   - Certificate hash (SigningCertificateV2)

---

## Data Flow

### Invoice Submission Flow

```
1. User Creates Invoice (Frontend)
   ↓
2. POST /api/invoices (Backend)
   ↓
3. Calculate Totals (invoiceCalculator.ts)
   ↓
4. Build ETA Document (etaBuilder.ts)
   ↓
5. Sign Document (csharpSignerIntegration.ts)
   ├─ Write to SourceDocumentJson.json
   ├─ Execute EInvoicingSigner.exe
   ├─ Read from FullSignedDocument.json
   └─ Extract signature
   ↓
6. Submit to ETA API
   ├─ POST /api/v1/documentsubmissions
   ├─ Receive UUID
   └─ Save XML response
   ↓
7. Return Status to Frontend
```

### Excel Import Flow

```
1. User Uploads Excel (Frontend)
   ↓
2. POST /api/upload-excel (Backend)
   ↓
3. Parse Excel Rows
   ↓
4. For Each Row:
   ├─ Validate Data
   ├─ Calculate Totals
   ├─ Build ETA Document
   ├─ Sign Document
   ├─ Submit to ETA
   └─ Log Result
   ↓
5. Return Summary to Frontend
```

---

## API Endpoints

### Invoice Management

- `GET /api/invoices` - List all invoices
- `POST /api/invoices` - Create and submit invoice
- `GET /api/invoices/:id` - Get invoice details
- `PUT /api/invoices/:id` - Update invoice
- `DELETE /api/invoices/:id` - Delete invoice

### Company Settings

- `GET /api/company` - Get company information
- `POST /api/company` - Update company information

### Excel Import

- `POST /api/upload-excel` - Upload and process Excel file

### Authentication

- `POST /api/signup` - Register new user
- `POST /api/login` - User login
- `POST /api/logout` - User logout

---

## Database Schema

### Tables

#### `users`
- `id` - Primary key
- `username` - Unique username
- `password` - Hashed password
- `email` - Email address
- `created_at` - Registration timestamp

#### `company_info`
- `id` - Primary key
- `user_id` - Foreign key to users
- `company_name` - Company name (Arabic)
- `tax_id` - Tax registration number
- `activity_code` - ETA activity code
- `address_*` - Address fields
- `created_at` - Creation timestamp

#### `invoices`
- `id` - Primary key
- `user_id` - Foreign key to users
- `internal_id` - Internal invoice number
- `uuid` - ETA submission UUID
- `status` - Submission status
- `document` - JSON invoice data
- `xml_response` - ETA XML response
- `created_at` - Creation timestamp

---

## Environment Configuration

### `.env` File

```env
# Server Configuration
PORT=3000
NODE_ENV=production

# Database
DATABASE_PATH=./database.db

# ETA API Configuration
ETA_CLIENT_ID=your_client_id
ETA_CLIENT_SECRET=your_client_secret
ETA_ENVIRONMENT=production

# Certificate Configuration
CERTIFICATE_PIN=09761969
CERTIFICATE_ISSUER=MCDR CA 2022

# Session Secret
SESSION_SECRET=your_random_secret_here
```

---

## Security Considerations

### Digital Signature Security

- **Private keys never leave token**: Hardware-backed security
- **PIN required for each signature**: User authentication
- **Certificate chain validation**: Ensures trust path to root CA
- **CAdES-BES compliance**: Industry-standard signature format

### Application Security

- **Password hashing**: bcrypt with salt
- **Session management**: Secure HTTP-only cookies
- **SQL injection prevention**: Parameterized queries
- **Input validation**: Server-side validation for all inputs

---

## Deployment

### Development

```bash
# Install dependencies
npm install

# Start development server
npm run dev
```

### Production

```bash
# Build frontend
cd client
npm run build

# Start production server
npm run server
```

---

## Monitoring and Logging

### Server Logs

- Console output for all operations
- Error logging with stack traces
- Invoice submission tracking

### Invoice Status Tracking

- XML responses saved to `invoices/` folder
- Status field in database
- UUID for ETA portal lookup

---

## Troubleshooting

### Common Issues

1. **Signature Error 4062**
   - Check certificate issuer name
   - Verify token connected
   - Confirm PIN correct

2. **Hash Mismatch 4043**
   - Verify serialization logic
   - Check document structure
   - Ensure no extra fields

3. **Database Locked**
   - Close other connections
   - Check file permissions
   - Restart server

---

## Future Enhancements

- [ ] Multi-user support with role-based access
- [ ] Invoice templates
- [ ] Batch submission queue
- [ ] Advanced reporting and analytics
- [ ] Mobile application
- [ ] API documentation (Swagger)

---

**Last Updated**: 2026-01-16  
**Version**: 1.0
