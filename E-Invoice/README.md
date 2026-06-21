# E-Invoice System

Complete E-Invoice management system for Egyptian Tax Authority (ETA) compliance with hardware token digital signature support.

## Features

- ✅ Manual invoice creation
- ✅ Excel bulk import
- ✅ Hardware token digital signatures (CAdES-BES)
- ✅ ETA API integration
- ✅ Real-time submission status
- ✅ Invoice tracking and management

## Quick Start

See `QUICK_START.md` for detailed setup instructions.

## Documentation

- **QUICK_START.md** - Setup guide for new developers
- **DIGITAL_SIGNATURE_SETUP.md** - Digital signature configuration
- **PROJECT_ARCHITECTURE.md** - Technical architecture details

## Requirements

- Node.js v14+
- .NET 7.0 Desktop Runtime
- Hardware USB token with certificate
- Windows 10/11

## Installation

```bash
npm install
cd client && npm install
```

## Running

```bash
# Development
npm run dev

# Production
npm run server
```

## Project Structure

```
E-Invoice/
├── client/              # React frontend
├── server/              # Node.js backend
├── EInvoicingSigner/    # Digital signature tool
│   └── temp/           # Temporary signing files
├── invoices/           # Submitted invoices
└── uploads/            # Excel imports
```

## License

Proprietary - All rights reserved

## Support

For issues and questions, refer to the documentation in the root directory.
