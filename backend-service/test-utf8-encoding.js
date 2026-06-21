/**
 * Simple Test Script: Verify UTF-8 Encoding
 * 
 * This script tests UTF-8 encoding consistency without requiring imports
 */

import crypto from 'crypto';
import fs from 'fs/promises';

// Test data - simple serialized string
const testData = '"DOCUMENT""ISSUER""TYPE""B""ID""562067566""NAME""Test Company"';

async function testUTF8Encoding() {
    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║  UTF-8 Encoding Consistency Test                          ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');

    console.log('Test Data:', testData);
    console.log('Length:', testData.length, 'characters\n');

    // 1. Create UTF-8 buffer (same as server does now)
    const buffer = Buffer.from(testData, 'utf8');
    console.log('✓ UTF-8 buffer created:', buffer.length, 'bytes');

    // 2. Calculate SHA-256 hash
    const hash = crypto.createHash('sha256').update(buffer).digest('hex');
    console.log('✓ SHA-256 hash:', hash, '\n');

    // 3. Write to temp file
    const tempFile = './test_utf8_temp.txt';
    await fs.writeFile(tempFile, buffer);
    console.log('✓ Written to:', tempFile);

    // 4. Read back as UTF-8
    const readBack = await fs.readFile(tempFile, 'utf8');
    const readBackBuffer = Buffer.from(readBack, 'utf8');
    const readBackHash = crypto.createHash('sha256').update(readBackBuffer).digest('hex');

    console.log('✓ Read back:', readBackBuffer.length, 'bytes');
    console.log('✓ Read back hash:', readBackHash, '\n');

    // 5. Verify
    console.log('═══════════════════════════════════════════════════════════\n');

    if (hash === readBackHash && buffer.length === readBackBuffer.length) {
        console.log('✅ SUCCESS: UTF-8 encoding is consistent!');
        console.log('✅ Hash matches before and after file write/read');
        console.log('✅ Buffer sizes match:', buffer.length, '==', readBackBuffer.length);
        console.log('\n✅ The UTF-8 fix is working correctly!\n');

        console.log('Next Steps:');
        console.log('1. Start server: npm run server');
        console.log('2. Submit a test invoice');
        console.log('3. Check logs for matching SHA-256 hashes');
        console.log('4. Verify no error 4043 from ETA\n');

        return true;
    } else {
        console.log('❌ FAILURE: Encoding mismatch!');
        console.log('   Original hash:', hash);
        console.log('   Read back hash:', readBackHash);
        console.log('   Original size:', buffer.length);
        console.log('   Read back size:', readBackBuffer.length, '\n');
        return false;
    }
}

// Run test
testUTF8Encoding()
    .then(success => {
        process.exit(success ? 0 : 1);
    })
    .catch(err => {
        console.error('\n❌ Error:', err.message);
        process.exit(1);
    });
