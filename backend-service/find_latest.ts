import { readdirSync, statSync } from 'fs';
import { join } from 'path';

const invoicesDir = 'e:/E-Invoice/E-Invoice/invoices';
const xmlFiles = readdirSync(invoicesDir)
    .filter(f => f.endsWith('.xml'))
    .map(f => ({
        name: f,
        path: join(invoicesDir, f),
        time: statSync(join(invoicesDir, f)).mtime
    }))
    .sort((a, b) => b.time.getTime() - a.time.getTime());

console.log("=== LATEST INVOICES ===\n");
xmlFiles.slice(0, 5).forEach((file, i) => {
    console.log(`${i + 1}. ${file.name}`);
    console.log(`   Modified: ${file.time.toISOString()}`);
    console.log("");
});

console.log(`\nMost recent: ${xmlFiles[0].name}`);
console.log(`Please analyze this file with: npx tsx extract_message_digest.ts`);
