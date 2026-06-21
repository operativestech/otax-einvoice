# EInvoicingSigner - Temporary Files

This folder contains temporary working files generated during the signing process:

- `SourceDocumentJson.json` - Input: Unsigned invoice document
- `FullSignedDocument.json` - Output: Signed invoice with signature
- `Cades.txt` - Signature value (Base64 encoded)
- `CanonicalString.txt` - Serialized document for hashing

**These files are automatically created and overwritten with each signing operation.**

Do not manually edit these files.
