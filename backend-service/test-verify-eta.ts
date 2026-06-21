import { serializeInvoice } from './server/etaSerialization.js';
import crypto from 'crypto';

// This is the official sample doc from the file you provided (without-serliaze.txt converted to JSON)
const doc = {
    "issuer": {
        "type": "B",
        "id": "113317713",
        "name": "Issuer",
        "address": {
            "buildingNumber": "40",
            "room": "123",
            "floor": "16",
            "street": "Street",
            "landmark": "Landmark",
            "additionalInformation": "Info",
            "governate": "Cairo",
            "regionCity": "Nasr City",
            "postalCode": "098607",
            "country": "EG",
            "branchID": "1"
        }
    },
    "receiver": {
        "type": "B",
        "id": "730913562",
        "name": "Receiver",
        "address": {
            "buildingNumber": "15",
            "room": "110",
            "floor": "8",
            "street": "Street",
            "landmark": "Landmark",
            "additionalInformation": "Info",
            "governate": "Beheira",
            "regionCity": "Damanhour",
            "postalCode": "098661",
            "country": "EG"
        }
    },
    "documentType": "I",
    "documentTypeVersion": "0.9",
    "dateTimeIssued": "2020-10-29T17:30:22Z",
    "taxpayerActivityCode": "4620",
    "internalID": "IID0",
    "purchaseOrderReference": "1230",
    "purchaseOrderDescription": "Desc",
    "salesOrderReference": "1452",
    "salesOrderDescription": "Desc",
    "proformaInvoiceNumber": "1485",
    "payment": {
        "bankName": "Bank",
        "bankAddress": "Address",
        "bankAccountNo": "1234567",
        "bankAccountIBAN": "",
        "swiftCode": "",
        "terms": "Terms"
    },
    "delivery": {
        "approach": "Air",
        "packaging": "Pack",
        "dateValidity": "2020-06-22T17:30:22Z",
        "exportPort": "Port",
        "countryOfOrigin": "LS",
        "grossWeight": 123.45,
        "netWeight": 122.87,
        "terms": "Terms"
    },
    "invoiceLines": [
        {
            "description": "Computer",
            "itemType": "GPC",
            "itemCode": "6221218058490",
            "unitType": "EA",
            "quantity": 5,
            "unitValue": {
                "currencySold": "EUR",
                "amountSold": 10.00,
                "amountEGP": 189.40,
                "currencyExchangeRate": 18.94
            },
            "salesTotal": 947.00,
            "discount": {
                "rate": 7,
                "amount": 66.29
            },
            "taxableItems": [
                {
                    "taxType": "T1",
                    "amount": 272.07,
                    "subType": "V001",
                    "rate": 14
                }
            ],
            "internalCode": "IC0",
            "itemsDiscount": 5.00,
            "netTotal": 880.71,
            "totalTaxableFees": 817.42,
            "valueDifference": 7.00,
            "total": 2969.89
        }
    ],
    "totalSalesAmount": 947.00,
    "totalDiscountAmount": 66.29,
    "netAmount": 880.71,
    "taxTotals": [
        {
            "taxType": "T1",
            "amount": 272.07
        }
    ],
    "totalAmount": 2964.89,
    "totalItemsDiscountAmount": 5.00,
    "extraDiscountAmount": 5.00
};

console.log("Starting ETA XML Canonicalization Test...");

const result = serializeInvoice(doc);
console.log("Canonical Prefix:", result.substring(0, 500));
console.log("Line Item Order Check:", result.substring(result.indexOf("INVOICELINE"), result.indexOf("INVOICELINE") + 300));
console.log("Summary Totals Order Check:", result.substring(result.lastIndexOf("TOTALSALESAMOUNT")));

const hash = crypto.createHash('sha256').update(result, 'utf8').digest('hex');
console.log("Canonical Hash (SHA256):", hash);
