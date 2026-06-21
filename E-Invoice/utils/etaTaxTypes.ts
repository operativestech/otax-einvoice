/**
 * ETA Tax Type Catalog — aligned with https://sdk.invoicing.eta.gov.eg/codes/tax-types/
 *
 * This is the shared source of truth for the Manual Invoice UI (and anywhere
 * else we need to reason about Egyptian ETA tax codes). It covers:
 *
 *   taxType (T1 – T20)           — what the tax is
 *   subType (V001, W003, Tb01…)  — the specific rate/category inside that type
 *
 * The backend calculator consumes the (taxType, subType, rate) triples we emit
 * so fidelity here matters: the ETA portal rejects submissions whose subType
 * doesn't belong to the declared taxType.
 */

export interface TaxSubtype {
  /** e.g. 'V001', 'W003', 'Tb01' — exact string ETA expects in `taxableItem.subType`. */
  code: string;
  /** Short English name shown in the dropdown. */
  name: string;
  /** Arabic name (informational, shown beneath the English one). */
  nameAr?: string;
  /** Typical rate (%) pre-filled when the user picks this subtype. */
  defaultRate?: number;
}

export interface TaxType {
  /** 'T1' – 'T20' */
  code: string;
  name: string;
  nameAr?: string;
  /**
   * How is the tax amount computed. Informational for the UI; the backend
   * does the actual cascade math based on `taxType`.
   *   'net'        — on net total
   *   'net+t2'     — on (net + T2)
   *   'final'      — fixed amount per unit (not percentage-based)
   */
  base?: 'net' | 'net+t2' | 'final';
  /** Withholding taxes are SUBTRACTED from the final payable amount. */
  isWithholding?: boolean;
  subtypes: TaxSubtype[];
}

/**
 * Full ETA tax-type catalog (T1 – T20).
 *
 * T1 (VAT) and T4 (WHT) are the two that matter operationally for 99% of
 * taxpayers; their subtype lists are exhaustive. The rest are rarely used
 * day-to-day — we expose them so specialised taxpayers (tobacco, cars,
 * entertainment, utilities) can submit without hand-crafting the payload.
 */
export const TAX_CATALOG: TaxType[] = [
  {
    code: 'T1',
    name: 'Value Added Tax (VAT)',
    nameAr: 'ضريبة القيمة المضافة',
    base: 'net+t2',
    subtypes: [
      { code: 'V001', name: 'Standard rate (14%)', nameAr: 'المعدل العام', defaultRate: 14 },
      { code: 'V002', name: 'Other rate',         nameAr: 'معدل آخر',    defaultRate: 5  },
      { code: 'V003', name: 'Zero-rated product', nameAr: 'سلعة خاضعة لمعدل صفر', defaultRate: 0 },
      { code: 'V004', name: 'Zero-rated service', nameAr: 'خدمة خاضعة لمعدل صفر', defaultRate: 0 },
      { code: 'V005', name: 'Exempt product',     nameAr: 'سلعة معفاة',  defaultRate: 0 },
      { code: 'V006', name: 'Exempt service',     nameAr: 'خدمة معفاة',  defaultRate: 0 },
      { code: 'V007', name: 'Non-taxable — other',    nameAr: 'غير خاضعة',       defaultRate: 0 },
      { code: 'V008', name: 'Non-taxable — services', nameAr: 'خدمة غير خاضعة',  defaultRate: 0 },
      { code: 'V009', name: 'Export',             nameAr: 'تصدير',       defaultRate: 0 },
      { code: 'V010', name: 'Special VAT rate',   nameAr: 'معدل خاص',    defaultRate: 5 },
      { code: 'V011', name: 'VAT difference',     nameAr: 'فروقات معدل', defaultRate: 0 },
    ],
  },
  {
    code: 'T2',
    name: 'Schedule Tax — Percentage',
    nameAr: 'ضريبة الجدول النسبية',
    base: 'net',
    subtypes: [
      { code: 'Tb01', name: 'Tobacco',        nameAr: 'تبغ',         defaultRate: 50 },
      { code: 'Tb02', name: 'Alcohol',        nameAr: 'كحوليات',      defaultRate: 200 },
      { code: 'Tb03', name: 'Passenger cars', nameAr: 'سيارات ركاب',  defaultRate: 0 },
      { code: 'Tb04', name: 'Buses / Minibuses', nameAr: 'حافلات',    defaultRate: 0 },
      { code: 'Tb05', name: 'Other',          nameAr: 'أخرى',         defaultRate: 0 },
    ],
  },
  {
    code: 'T3',
    name: 'Schedule Tax — Fixed Amount',
    nameAr: 'ضريبة الجدول القطعية',
    base: 'final',
    subtypes: [
      { code: 'Tf01', name: 'Standard', nameAr: 'قياسى', defaultRate: 0 },
    ],
  },
  {
    code: 'T4',
    name: 'Withholding Tax',
    nameAr: 'خصم وإضافة',
    base: 'net',
    isWithholding: true,
    subtypes: [
      { code: 'W001', name: 'Goods & Equipment (1%)',    nameAr: 'سلع ومعدات',   defaultRate: 1   },
      { code: 'W002', name: 'Goods (0.5%)',              nameAr: 'سلع',          defaultRate: 0.5 },
      { code: 'W003', name: 'Contracting (3%)',          nameAr: 'مقاولات',      defaultRate: 3   },
      { code: 'W004', name: 'Services (5%)',             nameAr: 'خدمات',        defaultRate: 5   },
      { code: 'W005', name: 'Services (3%)',             nameAr: 'خدمات',        defaultRate: 3   },
      { code: 'W006', name: 'Commission (5%)',           nameAr: 'عمولات',       defaultRate: 5   },
      { code: 'W007', name: 'Professional (5%)',         nameAr: 'مهن حرة',      defaultRate: 5   },
      { code: 'W008', name: 'Wages & Salaries',          nameAr: 'أجور',         defaultRate: 2   },
      { code: 'W009', name: 'Other',                     nameAr: 'أخرى',         defaultRate: 0   },
    ],
  },
  {
    code: 'T5',
    name: 'Advertising Tax',
    nameAr: 'ضريبة الإعلانات',
    base: 'net',
    subtypes: [{ code: 'T5', name: 'Standard', nameAr: 'قياسى', defaultRate: 0 }],
  },
  {
    code: 'T6',
    name: 'State Resources Development Fees',
    nameAr: 'رسوم تنمية الموارد',
    base: 'net',
    subtypes: [{ code: 'T6', name: 'Standard', nameAr: 'قياسى', defaultRate: 0 }],
  },
  {
    code: 'T7',
    name: 'Stamp Tax',
    nameAr: 'ضريبة دمغة',
    base: 'net',
    subtypes: [{ code: 'T7', name: 'Standard', nameAr: 'قياسى', defaultRate: 0 }],
  },
  {
    code: 'T8',
    name: 'Entertainment Duty',
    nameAr: 'ضريبة ملاهى',
    base: 'net',
    subtypes: [{ code: 'T8', name: 'Standard', nameAr: 'قياسى', defaultRate: 0 }],
  },
  {
    code: 'T9',
    name: 'Cleaning Fees',
    nameAr: 'رسوم نظافة',
    base: 'net',
    subtypes: [{ code: 'T9', name: 'Standard', nameAr: 'قياسى', defaultRate: 0 }],
  },
  {
    code: 'T10',
    name: 'Municipality Fees',
    nameAr: 'رسوم المحليات',
    base: 'net',
    subtypes: [{ code: 'T10', name: 'Standard', nameAr: 'قياسى', defaultRate: 0 }],
  },
  {
    code: 'T11',
    name: 'Service Charge',
    nameAr: 'رسوم خدمة',
    base: 'net',
    subtypes: [{ code: 'T11', name: 'Standard', nameAr: 'قياسى', defaultRate: 10 }],
  },
  {
    code: 'T12',
    name: 'Other Tax',
    nameAr: 'ضرائب أخرى',
    base: 'net',
    subtypes: [{ code: 'T12', name: 'Other', nameAr: 'أخرى', defaultRate: 0 }],
  },
  // T13 – T20: rarely used local/regional fees. Exposed as generic entries so
  // the UI can still produce a valid payload if the user needs them.
  ...Array.from({ length: 8 }, (_, i) => {
    const idx = 13 + i;
    const code = `T${idx}`;
    return {
      code,
      name: `Tax ${code}`,
      base: 'net' as const,
      subtypes: [{ code, name: 'Standard', defaultRate: 0 }],
    };
  }),
];

/** Look up a tax type by code. */
export const getTaxType = (code: string): TaxType | undefined =>
  TAX_CATALOG.find(t => t.code === code);

/** Look up a specific subtype under a given tax type. */
export const getSubtype = (typeCode: string, subCode: string): TaxSubtype | undefined =>
  getTaxType(typeCode)?.subtypes.find(s => s.code === subCode);

/**
 * A single taxable item on an invoice line — the shape ETA expects inside
 * `invoiceLines[].taxableItems[]`. The front-end stores an array of these
 * per line and POSTs them as-is.
 */
export interface TaxableItem {
  taxType: string;   // e.g. 'T1'
  subType: string;   // e.g. 'V001'
  rate: number;      // percentage; for T3 (fixed) this is ignored by backend
  /** Computed server-side; frontend leaves it 0. */
  amount?: number;
}

/** Default taxable item — 14% VAT, the overwhelmingly common case. */
export const defaultTaxableItem = (): TaxableItem => ({
  taxType: 'T1',
  subType: 'V001',
  rate: 14,
});
