import axios from 'axios';

const testInvoice = {
    headers: [
        {
            INTERNAL_ID: "TEST-AUTO-004", // New ID
            DATETIMEISSUED: new Date().toISOString(),
            RECEIVER_TYPE: "B",
            RECEIVER_NAME: "Test Receiver Factory",
            RECEIVER_ID: "401342674",
            RECEIVER_COUNTRY: "EG",
            RECEIVER_GOVERNATE: "Cairo",
            RECEIVER_REGIONCITY: "Nasr City",
            RECEIVER_STREET: "Test Street 1",
            RECEIVER_BUILDINGNUMBER: "1",
            PAYMENT_TERMS: "Cash",
            DOCUMENTTYPE: "I"
        }
    ],
    details: [
        {
            INTERNAL_ID: "TEST-AUTO-004",
            DESCRIPTION: "Test Item Service",
            ITEMTYPE: "GS1",
            ITEMCODE: "6221122334455",
            ITEM_INTERNAL_CODE: "ITM-001",
            UNITTYPE: "EA",
            QUANTITY: 1,
            AMOUNT: 100,
            CURRENCYSOLD: "EGP",
            CURRENCYEXCHANGERATE: 1
        }
    ]
};

async function sendTest() {
    try {
        console.log('Sending Test Invoice to Localhost (Default User)...');
        // No x-user-id header, triggering fallback in server
        const response = await axios.post('http://localhost:3001/api/excel/submit', testInvoice, {
            headers: {
                'Content-Type': 'application/json'
            }
        });
        console.log('------------------------------------------------');
        console.log('✅ SUCCESS RESPONSE:');
        console.log(JSON.stringify(response.data, null, 2));
        console.log('------------------------------------------------');
    } catch (error: any) {
        console.log('------------------------------------------------');
        console.error('❌ ERROR RESPONSE:');
        if (error.response) {
            console.error(JSON.stringify(error.response.data, null, 2));
        } else {
            console.error(error.message);
        }
        console.log('------------------------------------------------');
    }
}

sendTest();
