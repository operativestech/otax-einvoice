# EInvoicingSigner Directory

This directory contains the digital signature tool for Egyptian Tax Authority e-invoices.

## Contents

### Executable Files
- `EInvoicingSigner.exe` - Main signer application (.NET 7.0)
- `SubmitInvoices.bat` - Launcher script (configured with PIN and issuer)

### Dependencies
- `BouncyCastle.Crypto.dll` - Cryptographic library
- `Newtonsoft.Json.dll` - JSON parsing
- `Pkcs11Interop.dll` - Hardware token interface
- `System.Security.Cryptography.Pkcs.dll` - CAdES signature support
- `EInvoicingSigner.dll` - Main application library
- `*.deps.json`, `*.runtimeconfig.json` - .NET runtime configuration
- `runtimes/` - Platform-specific dependencies

### Working Files
- `temp/` - Temporary files created during signing process
  - `SourceDocumentJson.json` - Input document
  - `FullSignedDocument.json` - Signed output
  - `Cades.txt` - Signature value
  - `CanonicalString.txt` - Serialized document

## Configuration

Edit `SubmitInvoices.bat` to set:
- Token PIN
- Certificate issuer name

## Usage

The signer is automatically called by the Node.js backend via `csharpSignerIntegration.ts`.

For manual testing:
```cmd
SubmitInvoices.bat
```

## Requirements

- .NET 7.0 Desktop Runtime (x64)
- Hardware USB token with certificate
- Token drivers installed (ePass2003 or similar)

## Troubleshooting

If signing fails:
1. Verify token is connected
2. Check PIN is correct
3. Confirm certificate issuer name matches
4. Ensure .NET 7.0 is installed
5. Check `temp/` folder for error details
