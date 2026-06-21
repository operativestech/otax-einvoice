import crypto from 'crypto';
import { serializeReceiptBatch, serialize } from './etaSerialization.js';

/**
 * Interface for Receipt Header
 */
interface ReceiptHeader {
    dateTimeIssued: string;
    receiptNumber: string;
    uuid: string;
    previousReceiptUUID: string;
    [key: string]: any;
}

/**
 * Interface for Receipt
 */
interface Receipt {
    header: ReceiptHeader;
    receiptType: string;
    referenceUUID?: string;
    [key: string]: any;
}

/**
 * Generate Receipt UUID
 * Based on: https://sdk.invoicing.eta.gov.eg/document-serialization-approach/
 * and specific e-Receipt UUID generation procedure.
 */
export function generateReceiptUUID(receipt: Receipt): string {
    // 1. Create a deep copy to avoid modifying original
    const receiptCopy = JSON.parse(JSON.stringify(receipt));

    // 2. Ensure UUID is empty for calculation
    receiptCopy.header.uuid = "";

    // 3. Serialize the receipt object using the "quoted properties" algorithm (JSON style)
    // Note: Individual receipt UUID is based on its own serialization.
    const normalizedText = serialize(receiptCopy, 'JSON');

    // 4. Create SHA256 Hash
    const hash = crypto.createHash('sha256');
    hash.update(normalizedText, 'utf8');

    // 5. Convert to hexadecimal string (64 characters)
    const uuid = hash.digest('hex');

    return uuid;
}

/**
 * Prepares a batch of receipts for submission
 * Every receipt gets a UUID, and then the whole batch is signed.
 */
export function prepareReceiptBatch(receipts: Receipt[]): any {
    // 1. Generate UUID for each receipt (ensuring the chain is correct)
    let lastUUID = receipts[0]?.header?.previousReceiptUUID || "";

    const processedReceipts = receipts.map(r => {
        // Enforce the chain: previousReceiptUUID must be the UUID of the previous receipt
        if (lastUUID) {
            r.header.previousReceiptUUID = lastUUID;
        }

        // Generate the UUID for current receipt
        const uuid = generateReceiptUUID(r);
        r.header.uuid = uuid;

        // Update lastUUID for the next iteration
        lastUUID = uuid;

        return r;
    });

    // 2. Wrap in batch structure
    return {
        receipts: processedReceipts
    };
}

/**
 * Logic to sign the receipt batch
 * Note: Actual signing happens via the Windows Signer tool (C#)
 */
export function getSerializedBatchForSigning(batch: any): string {
    // Serialize the entire batch structure
    return serializeReceiptBatch(batch);
}
