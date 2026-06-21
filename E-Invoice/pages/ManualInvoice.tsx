
import React, { useState, useEffect, useRef } from 'react';
import { Plus, Trash2, Send, ShieldCheck, User, Hash, FileText, MapPin, ChevronDown, ChevronUp, RefreshCw, CheckCircle2, AlertCircle, X, Search, Loader2, Users, BookUser, Percent, Link2, CreditCard, Truck, Building2 } from 'lucide-react';
import { API_URL } from '../services/apiService';
import { TAX_CATALOG, getTaxType, defaultTaxableItem, TaxableItem } from '../utils/etaTaxTypes';
import { useTranslation } from '../i18n';
import { alertDialog } from '../components/ConfirmDialog';

/* ───────── ETA Document Type catalog ─────────
 * All 6 codes the ETA portal accepts for the `documentType` header field.
 * Version auto-follows the type: regular = 0.9, export = 1.0. `needsRefs`
 * means this type requires `references` (link to the original invoice);
 * `export` means this type requires `serviceDeliveryDate`.
 */
const DOCUMENT_TYPES = [
  { code: 'I',  label: 'Invoice',            nameAr: 'فاتورة',          version: '0.9', needsRefs: false, export: false },
  { code: 'D',  label: 'Debit Note',         nameAr: 'إشعار مدين',       version: '0.9', needsRefs: true,  export: false },
  { code: 'C',  label: 'Credit Note',        nameAr: 'إشعار دائن',       version: '0.9', needsRefs: true,  export: false },
  { code: 'EI', label: 'Export Invoice',     nameAr: 'فاتورة تصدير',     version: '1.0', needsRefs: false, export: true  },
  { code: 'ED', label: 'Export Debit Note',  nameAr: 'إشعار مدين تصدير', version: '1.0', needsRefs: true,  export: true  },
  { code: 'EC', label: 'Export Credit Note', nameAr: 'إشعار دائن تصدير', version: '1.0', needsRefs: true,  export: true  },
] as const;

/* ───────── Master Data customer shape (subset we care about) ───────── */
interface MdCustomer {
  id: number;
  tax_id: string;
  name: string | null;
  party_type: string | null;
  country: string | null;
  governate: string | null;
  region_city: string | null;
  street: string | null;
  building_number: string | null;
  postal_code: string | null;
  floor?: string | null;
  room?: string | null;
  landmark?: string | null;
  additional_info?: string | null;
  phone?: string | null;
  email?: string | null;
  tags?: string[];
  invoice_count?: number;
}

/* ───────── Types ───────── */
interface InvoiceLine {
  id: string;
  description: string;
  itemType: string;
  itemCode: string;
  itemInternalCode: string;
  unitType: string;
  quantity: number;
  amount: number;
  currencySold: string;
  /** For non-EGP currencies the rate used to convert to EGP. Ignored for EGP. */
  currencyExchangeRate: number;
  disRate: number;
  disAmount: number;
  /**
   * Full list of ETA tax items applied to this line. Each item is
   * (taxType, subType, rate). Amounts are computed server-side so we leave
   * `amount` undefined here. Replaces the old fixed tax_V001/V003/V009/W007
   * columns so every T1–T20 code + subtype combination becomes possible.
   */
  taxableItems: TaxableItem[];
}

interface InvoiceHeader {
  internalId: string;
  documentType: string;
  /** '0.9' for I/D/C, '1.0' for EI/ED/EC — auto-filled from DOCUMENT_TYPES. */
  documentTypeVersion: string;
  dateTimeIssued: string;
  /** ETA taxpayer activity code (e.g. 4620). Defaults from org settings. */
  taxpayerActivityCode: string;
  /** Required for export types (EI/ED/EC). Format YYYY-MM-DD. */
  serviceDeliveryDate: string;
  /** Required for D/C/ED/EC — UUID(s) of the original invoice(s) being adjusted. */
  references: string[];
  receiverType: string;
  receiverId: string;
  receiverName: string;
  receiverCountry: string;
  receiverGovernate: string;
  receiverRegionCity: string;
  receiverStreet: string;
  receiverBuildingNumber: string;
  receiverPostalCode: string;
  receiverFloor: string;
  receiverRoom: string;
  receiverLandmark: string;
  receiverAdditionalInformation: string;
  extraDiscountAmount: number;
  purchaseOrderReference: string;
  purchaseOrderDescription: string;
  salesOrderReference: string;
  salesOrderDescription: string;
  proformaInvoiceNumber: string;
  // ── Payment block (optional, ETA `payment`) ──
  paymentBankName: string;
  paymentBankAddress: string;
  paymentBankAccountNo: string;
  paymentBankAccountIban: string;
  paymentSwiftCode: string;
  paymentTerms: string;
  // ── Delivery block (optional, ETA `delivery`). countryOfOrigin is a 2-letter ISO code. ──
  deliveryApproach: string;
  deliveryPackaging: string;
  deliveryDateValidity: string;
  deliveryExportPort: string;
  deliveryCountryOfOrigin: string;
  deliveryGrossWeight: number;
  deliveryNetWeight: number;
  deliveryTerms: string;
}

const defaultLine = (): InvoiceLine => ({
  id: Date.now().toString() + Math.random().toString(36).slice(2),
  description: '',
  itemType: 'GS1',
  itemCode: '',
  itemInternalCode: '',
  unitType: 'EA',
  quantity: 1,
  amount: 0,
  currencySold: 'EGP',
  currencyExchangeRate: 0,
  disRate: 0,
  disAmount: 0,
  // Default = 14% VAT (most common). User can add/remove more taxes.
  taxableItems: [defaultTaxableItem()],
});

const now = () => {
  const d = new Date();
  return d.toISOString().slice(0, 16); // for datetime-local input
};

/* ───────── Component ───────── */
const ManualInvoice: React.FC = () => {
  const { t } = useTranslation();
  /* ── Header State ── */
  const [header, setHeader] = useState<InvoiceHeader>({
    internalId: '',
    documentType: 'I',
    documentTypeVersion: '0.9',
    dateTimeIssued: now(),
    taxpayerActivityCode: '',
    serviceDeliveryDate: '',
    references: [],
    receiverType: 'B',
    receiverId: '',
    receiverName: '',
    receiverCountry: 'EG',
    receiverGovernate: '',
    receiverRegionCity: '',
    receiverStreet: '',
    receiverBuildingNumber: '',
    receiverPostalCode: '',
    receiverFloor: '',
    receiverRoom: '',
    receiverLandmark: '',
    receiverAdditionalInformation: '',
    extraDiscountAmount: 0,
    purchaseOrderReference: '',
    purchaseOrderDescription: '',
    salesOrderReference: '',
    salesOrderDescription: '',
    proformaInvoiceNumber: '',
    paymentBankName: '',
    paymentBankAddress: '',
    paymentBankAccountNo: '',
    paymentBankAccountIban: '',
    paymentSwiftCode: '',
    paymentTerms: '',
    deliveryApproach: '',
    deliveryPackaging: '',
    deliveryDateValidity: '',
    deliveryExportPort: '',
    deliveryCountryOfOrigin: '',
    deliveryGrossWeight: 0,
    deliveryNetWeight: 0,
    deliveryTerms: '',
  });

  /** The ETA rules for the currently-selected document type. Drives which
   *  extra fields show up in the header. */
  const currentDocType = DOCUMENT_TYPES.find(d => d.code === header.documentType) || DOCUMENT_TYPES[0];

  /* ── Lines State ── */
  const [lines, setLines] = useState<InvoiceLine[]>([defaultLine()]);

  /* ── UI State ── */
  const [isLoading, setIsLoading] = useState(false);
  const [showAddress, setShowAddress] = useState(false);
  const [showOptional, setShowOptional] = useState(false);
  const [showPayment, setShowPayment] = useState(false);
  const [showDelivery, setShowDelivery] = useState(false);

  // ── Branches — loaded once on mount. Empty array = single-branch org
  //    (we just don't show the selector). ──
  const [branches, setBranches] = useState<any[]>([]);
  const [selectedBranchId, setSelectedBranchId] = useState<string>('');
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const user = JSON.parse(localStorage.getItem('invoice_user') || '{}');
        const token = user.token || localStorage.getItem('token');
        const r = await fetch(`${API_URL}/admin/branches`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
        const d = await r.json();
        if (cancelled || !d.success) return;
        setBranches(d.rows || []);
        const def = (d.rows || []).find((b: any) => b.is_default);
        if (def) setSelectedBranchId(def.branch_id);
      } catch { /* non-fatal */ }
    })();
    return () => { cancelled = true; };
  }, []);

  // Auto-expand the Delivery section on export document types — the ETA spec
  // strongly recommends delivery info for EI/ED/EC.
  useEffect(() => {
    if (currentDocType.export) setShowDelivery(true);
  }, [currentDocType.export]);
  const [showResultModal, setShowResultModal] = useState(false);
  const [submissionResult, setSubmissionResult] = useState<any>(null);

  /* ── Taxpayer Lookup State ── */
  const [isVerifying, setIsVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<
    | { kind: 'ok'; name?: string; type?: string; status?: string }
    | { kind: 'err'; message: string }
    | null
  >(null);

  /* ── Master Data Customer Picker State ──
   * Two UX paths:
   *   1. Type in the Tax ID field → debounced suggestion dropdown under the input.
   *   2. Click "Browse Master Data" → full modal with search over ALL customers.
   */
  const [mdSuggestions, setMdSuggestions] = useState<MdCustomer[]>([]);
  const [mdSuggestOpen, setMdSuggestOpen] = useState(false);
  const [mdSuggestLoading, setMdSuggestLoading] = useState(false);
  const [showBrowser, setShowBrowser] = useState(false);
  const [browserQuery, setBrowserQuery] = useState('');
  const [browserRows, setBrowserRows] = useState<MdCustomer[]>([]);
  const [browserLoading, setBrowserLoading] = useState(false);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  /** Shared fetch helper for master-data/customers */
  const fetchMdCustomers = async (q: string, signal?: AbortSignal): Promise<MdCustomer[]> => {
    const user = JSON.parse(localStorage.getItem('invoice_user') || '{}');
    const token = user.token || localStorage.getItem('token') || '';
    const qs = new URLSearchParams();
    if (q) qs.set('q', q);
    qs.set('pageSize', '20');
    qs.set('sortBy', 'last_seen');
    qs.set('sortDir', 'desc');
    const r = await fetch(`${API_URL}/master-data/customers?${qs.toString()}`, {
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      signal,
    });
    const d = await r.json();
    if (!r.ok || !d.success) throw new Error(d.message || `HTTP ${r.status}`);
    return (d.items as MdCustomer[]) || [];
  };

  /* Debounced search triggered by the Tax ID field */
  useEffect(() => {
    if (!mdSuggestOpen) return;
    const rin = header.receiverId.trim();
    // No input → clear suggestions
    if (!rin) { setMdSuggestions([]); return; }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const ctrl = new AbortController();
    debounceRef.current = setTimeout(async () => {
      setMdSuggestLoading(true);
      try {
        const items = await fetchMdCustomers(rin, ctrl.signal);
        setMdSuggestions(items);
      } catch { /* ignored — search is best-effort */ }
      finally { setMdSuggestLoading(false); }
    }, 250);
    return () => { ctrl.abort(); if (debounceRef.current) clearTimeout(debounceRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [header.receiverId, mdSuggestOpen]);

  /* Populate header fields from a picked customer. Overwrites only empty fields
   * for optional address bits, but always overwrites receiverId/Name/Type — those
   * are the "identity" fields the user just picked. */
  const applyCustomer = (c: MdCustomer) => {
    setHeader(prev => ({
      ...prev,
      receiverId: c.tax_id || prev.receiverId,
      receiverName: c.name || prev.receiverName,
      receiverType: (c.party_type && ['B', 'P', 'F'].includes(c.party_type)) ? c.party_type : prev.receiverType,
      receiverCountry: c.country || prev.receiverCountry,
      receiverGovernate: c.governate || prev.receiverGovernate,
      receiverRegionCity: c.region_city || prev.receiverRegionCity,
      receiverStreet: c.street || prev.receiverStreet,
      receiverBuildingNumber: c.building_number || prev.receiverBuildingNumber,
      receiverPostalCode: c.postal_code || prev.receiverPostalCode,
      receiverFloor: c.floor || prev.receiverFloor,
      receiverRoom: c.room || prev.receiverRoom,
      receiverLandmark: c.landmark || prev.receiverLandmark,
      receiverAdditionalInformation: c.additional_info || prev.receiverAdditionalInformation,
    }));
    // If the customer has address, reveal the panel so the user can see what landed.
    if (c.country || c.governate || c.street) setShowAddress(true);
    setMdSuggestOpen(false);
    setMdSuggestions([]);
    setVerifyResult(null);
    setShowBrowser(false);
  };

  /* Opens the full picker — fetches the latest list right away. */
  const openBrowser = async () => {
    setShowBrowser(true);
    setBrowserLoading(true);
    try {
      const items = await fetchMdCustomers('');
      setBrowserRows(items);
    } catch (e: any) {
      await alertDialog({ title: 'Master Data load failed', message: 'Failed to load Master Data customers: ' + e.message, tone: 'danger' });
    } finally {
      setBrowserLoading(false);
    }
  };

  /* Debounced re-fetch inside the browser modal as the user types. */
  useEffect(() => {
    if (!showBrowser) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setBrowserLoading(true);
      try {
        const items = await fetchMdCustomers(browserQuery);
        setBrowserRows(items);
      } catch { /* ignored */ }
      finally { setBrowserLoading(false); }
    }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [browserQuery, showBrowser]);

  const verifyReceiver = async () => {
    const rin = header.receiverId.trim();
    if (!rin) { setVerifyResult({ kind: 'err', message: 'Enter a Tax ID first.' }); return; }
    setIsVerifying(true);
    setVerifyResult(null);
    try {
      const user = JSON.parse(localStorage.getItem('invoice_user') || '{}');
      const token = user.token || localStorage.getItem('token') || '';
      const res = await fetch(`${API_URL}/eta/taxpayer/${encodeURIComponent(rin)}`, {
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setVerifyResult({ kind: 'err', message: data.message || `Lookup failed (HTTP ${res.status})` });
        return;
      }
      const t = data.taxpayer || {};
      // ETA responses vary: try common shapes (name, taxpayerName, type, registrationStatus)
      const name = t.name || t.taxpayerName || t.companyName || t.issuerName;
      const type = t.type || t.taxpayerType;
      const status = t.registrationStatus || t.status;
      setVerifyResult({ kind: 'ok', name, type, status });
      // Auto-fill name if empty
      if (name && !header.receiverName) setH('receiverName', name);
      if (type && ['B', 'P', 'F'].includes(type) && !header.receiverName) setH('receiverType', type);
    } catch (err: any) {
      setVerifyResult({ kind: 'err', message: err.message || 'Network error' });
    } finally {
      setIsVerifying(false);
    }
  };

  /* ── Helper: update header field ── */
  const setH = (field: keyof InvoiceHeader, value: any) =>
    setHeader(prev => ({ ...prev, [field]: value }));

  /* ── Helper: line CRUD ── */
  const addLine = () => setLines(prev => [...prev, defaultLine()]);
  const removeLine = (id: string) => {
    if (lines.length > 1) setLines(prev => prev.filter(l => l.id !== id));
  };
  const updateLine = (id: string, field: keyof InvoiceLine, value: any) =>
    setLines(prev => prev.map(l => (l.id === id ? { ...l, [field]: value } : l)));

  /* ── Tax-item CRUD per line ── */
  const addTaxItem = (lineId: string) =>
    setLines(prev => prev.map(l => l.id === lineId ? { ...l, taxableItems: [...l.taxableItems, defaultTaxableItem()] } : l));
  const removeTaxItem = (lineId: string, idx: number) =>
    setLines(prev => prev.map(l => l.id === lineId ? { ...l, taxableItems: l.taxableItems.filter((_, i) => i !== idx) } : l));
  const updateTaxItem = (lineId: string, idx: number, patch: Partial<TaxableItem>) =>
    setLines(prev => prev.map(l => l.id === lineId ? {
      ...l,
      taxableItems: l.taxableItems.map((t, i) => i === idx ? { ...t, ...patch } : t),
    } : l));

  /** When the user picks a new taxType, reset the subType to the first valid
   *  subtype of that type and prefill its default rate. */
  const onTaxTypeChange = (lineId: string, idx: number, newType: string) => {
    const t = getTaxType(newType);
    const firstSub = t?.subtypes[0];
    updateTaxItem(lineId, idx, {
      taxType: newType,
      subType: firstSub?.code || '',
      rate: firstSub?.defaultRate ?? 0,
    });
  };

  /** When the user picks a new subtype, prefill its default rate so they rarely
   *  have to type a number themselves. */
  const onSubTypeChange = (lineId: string, idx: number, newSub: string) => {
    const line = lines.find(l => l.id === lineId);
    if (!line) return;
    const item = line.taxableItems[idx];
    const t = getTaxType(item.taxType);
    const sub = t?.subtypes.find(s => s.code === newSub);
    updateTaxItem(lineId, idx, { subType: newSub, rate: sub?.defaultRate ?? item.rate });
  };

  /* ── Calculations ──
   * Mirrors the backend's cascade math (invoiceCalculator.ts). WHT is
   * SUBTRACTED from the final total; percentage taxes compound on
   * (net + prior taxes). Amounts here are for the live preview only — the
   * server recomputes on submit. */
  const calcLineTotals = (line: InvoiceLine) => {
    const salesTotal = line.quantity * line.amount;
    const discountAmount = line.disAmount || salesTotal * (line.disRate / 100);
    const netTotal = salesTotal - discountAmount;
    let runningTax = 0;
    let withheld = 0;
    for (const ti of line.taxableItems) {
      const t = getTaxType(ti.taxType);
      if (!t) continue;
      const base = t.base === 'net+t2' ? (netTotal + runningTax) : netTotal;
      const amt = base * (ti.rate / 100);
      if (t.isWithholding) withheld += amt; else runningTax += amt;
    }
    const lineTotal = netTotal + runningTax - withheld;
    return { salesTotal, discountAmount, netTotal, totalTax: runningTax, withholdingTax: withheld, lineTotal };
  };

  const subtotal = lines.reduce((acc, l) => acc + l.quantity * l.amount, 0);
  const totalDiscount = lines.reduce((acc, l) => {
    const s = l.quantity * l.amount;
    return acc + (l.disAmount || s * (l.disRate / 100));
  }, 0);
  const netAmount = subtotal - totalDiscount - header.extraDiscountAmount;
  const totalTax = lines.reduce((acc, l) => acc + calcLineTotals(l).totalTax, 0);
  const grandTotal = netAmount + totalTax;

  /* ── Submit to ETA ── */
  const handleSendToETA = async () => {
    // Basic validation
    if (!header.receiverId.trim()) {
      await alertDialog({ title: 'Missing field', message: 'Please enter Receiver Tax ID', tone: 'warning' });
      return;
    }
    if (!header.receiverName.trim()) {
      await alertDialog({ title: 'Missing field', message: 'Please enter Receiver Name', tone: 'warning' });
      return;
    }
    if (lines.some(l => !l.description.trim() || !l.itemCode.trim() || l.amount <= 0)) {
      await alertDialog({ title: 'Incomplete line items', message: 'Please fill all line items: Description, Item Code, and Unit Price must not be empty', tone: 'warning' });
      return;
    }
    // ETA-specific validation — document-type-conditional fields.
    if (currentDocType.needsRefs && header.references.filter(r => r.trim()).length === 0) {
      await alertDialog({ title: 'Reference required', message: `${currentDocType.label} requires at least one reference UUID (the original invoice it amends).`, tone: 'warning' });
      return;
    }
    if (currentDocType.export && !header.serviceDeliveryDate) {
      await alertDialog({ title: 'Missing field', message: 'Export documents require a Service Delivery Date.', tone: 'warning' });
      return;
    }

    setIsLoading(true);

    try {
      const user = JSON.parse(localStorage.getItem('invoice_user') || '{}');
      const token = localStorage.getItem('token');

      // Build Excel-compatible payload. The backend accepts the classic Excel
      // column names + the new fields we added (TAXABLE_ITEMS JSON, DOCUMENTTYPEVERSION,
      // TAXPAYERACTIVITYCODE, SERVICEDELIVERYDATE, REFERENCES). Old fields stay
      // for backward compatibility with batch Excel imports.
      const cleanRefs = header.references.map(r => r.trim()).filter(Boolean);
      const headerPayload = {
        INTERNAL_ID: header.internalId || `MAN-${Date.now()}`,
        DOCUMENTTYPE: header.documentType,
        DOCUMENTTYPEVERSION: header.documentTypeVersion,
        TAXPAYERACTIVITYCODE: header.taxpayerActivityCode || '',
        SERVICEDELIVERYDATE: header.serviceDeliveryDate || '',
        REFERENCES: cleanRefs,
        DATETIMEISSUED: header.dateTimeIssued ? new Date(header.dateTimeIssued).toISOString() : new Date().toISOString(),
        RECEIVER_TYPE: header.receiverType,
        RECEIVER_ID: header.receiverId,
        RECEIVER_NAME: header.receiverName,
        RECEIVER_COUNTRY: header.receiverCountry,
        RECEIVER_GOVERNATE: header.receiverGovernate,
        RECEIVER_REGIONCITY: header.receiverRegionCity,
        RECEIVER_STREET: header.receiverStreet,
        RECEIVER_BUILDINGNUMBER: header.receiverBuildingNumber,
        RECEIVER_POSTALCODE: header.receiverPostalCode || '0',
        RECEIVER_FLOOR: header.receiverFloor,
        RECEIVER_ROOM: header.receiverRoom,
        RECEIVER_LANDMARK: header.receiverLandmark,
        RECEIVER_ADDITIONALINFORMATION: header.receiverAdditionalInformation,
        EXTRADISCOUNTAMOUNT: header.extraDiscountAmount || 0,
        PURCHASEORDERREFERENCE: header.purchaseOrderReference,
        PURCHASEORDERDESCRIPTION: header.purchaseOrderDescription,
        SALESORDERREFERENCE: header.salesOrderReference,
        SALESORDERDESCRIPTION: header.salesOrderDescription,
        PROFORMAINVOICENUMBER: header.proformaInvoiceNumber,
        // Multi-branch — backend overrides issuer address with the picked branch.
        ISSUER_BRANCH_ID: selectedBranchId,
        // Payment block — backend conditionally emits the `payment` object only
        // when at least one of these is populated.
        PAYMENT_BANKNAME:        header.paymentBankName,
        PAYMENT_BANKADDRESS:     header.paymentBankAddress,
        PAYMENT_BANKACCOUNTNO:   header.paymentBankAccountNo,
        PAYMENT_BANKACCOUNTIBAN: header.paymentBankAccountIban,
        PAYMENT_SWIFTCODE:       header.paymentSwiftCode,
        PAYMENT_TERMS:           header.paymentTerms,
        // Delivery block — same conditional-emit logic on the backend.
        DELIVERY_APPROACH:        header.deliveryApproach,
        DELIVERY_PACKAGING:       header.deliveryPackaging,
        DELIVERY_DATEVALIDITY:    header.deliveryDateValidity,
        DELIVERY_EXPORTPORT:      header.deliveryExportPort,
        DELIVERY_COUNTRYOFORIGIN: header.deliveryCountryOfOrigin,
        DELIVERY_GROSSWEIGHT:     header.deliveryGrossWeight || 0,
        DELIVERY_NETWEIGHT:       header.deliveryNetWeight   || 0,
        DELIVERY_TERMS:           header.deliveryTerms,
      };

      const detailPayload = lines.map(l => ({
        INTERNAL_ID: headerPayload.INTERNAL_ID,
        DESCRIPTION: l.description,
        ITEMTYPE: l.itemType,
        ITEMCODE: l.itemCode,
        ITEM_INTERNAL_CODE: l.itemInternalCode || l.itemCode,
        UNITTYPE: l.unitType,
        QUANTITY: l.quantity,
        CURRENCYSOLD: l.currencySold,
        AMOUNT: l.amount,
        CURRENCYEXCHANGERATE: l.currencyExchangeRate || 0,
        DIS_RATE: l.disRate,
        DIS_AMOUNT: l.disAmount,
        // New: full ETA-compliant taxable items array. Backend uses this when
        // present; otherwise it falls back to the legacy tax_V001/V003/V009/W007 fields.
        TAXABLE_ITEMS: l.taxableItems.map(ti => ({ taxType: ti.taxType, subType: ti.subType, rate: ti.rate })),
      }));

      // Live console log
      window.dispatchEvent(new CustomEvent('live-console-log', {
        detail: { message: `📤 Sending manual invoice ${headerPayload.INTERNAL_ID} to ETA Portal…`, type: 'info' }
      }));

      const response = await fetch(`${API_URL}/excel/submit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-ID': user.id || '',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ headers: [headerPayload], details: detailPayload }),
      });

      const result = await response.json();

      if (result.success) {
        const summary = result.summary;

        // Log failed invoices to Live Console
        if (summary?.failed > 0 && summary?.results) {
          const failedInvoices = summary.results.filter((r: any) => r.status === 'Failed');
          failedInvoices.forEach((inv: any) => {
            window.dispatchEvent(new CustomEvent('live-console-log', {
              detail: { message: `❌ Invoice ${inv.internalId} Failed: ${inv.error}`, type: 'error' }
            }));
            if (inv.etaResponse?.error?.details) {
              inv.etaResponse.error.details.forEach((d: any) => {
                window.dispatchEvent(new CustomEvent('live-console-log', {
                  detail: { message: `   ↳ ${d.target ? '[' + d.target + '] ' : ''}${d.message || d.code}`, type: 'warning' }
                }));
              });
            }
          });
        }

        setSubmissionResult({ success: true, summary });
        setShowResultModal(true);
      } else {
        setSubmissionResult({
          success: false,
          message: result.message || 'Submission failed',
          details: result,
        });
        setShowResultModal(true);
      }
    } catch (err: any) {
      console.error('[Manual Submit Error]', err);
      setSubmissionResult({
        success: false,
        message: 'Network error: ' + (err.message || String(err)),
        isNetworkError: true,
      });
      setShowResultModal(true);
    } finally {
      setIsLoading(false);
    }
  };

  /* ── Shared input classes ── */
  const inputCls = 'w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all';
  const labelCls = 'text-[10px] font-bold text-slate-400 uppercase tracking-wider';
  const sectionTitleCls = 'font-bold text-slate-800 flex items-center gap-2 text-base';

  /* ═══════════════════════ RENDER ═══════════════════════ */
  return (
    <div className="space-y-6 max-w-[1400px] mx-auto">

      {/* ── Page Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-3">
            <FileText className="text-blue-600" />
            Manual Invoice Entry
          </h1>
          <p className="text-slate-500 text-sm">Create an electronic invoice manually and submit directly to ETA Portal</p>
        </div>
        <button
          onClick={handleSendToETA}
          disabled={isLoading}
          className="flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white rounded-2xl text-sm font-bold shadow-xl disabled:opacity-50 disabled:animate-pulse transition-all"
        >
          {isLoading ? <RefreshCw className="animate-spin" size={18} /> : <Send size={18} />}
          {isLoading ? 'Signing & Sending…' : 'Send to ETA Portal'}
        </button>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-4 gap-6">

        {/* ═══════════ LEFT: Header + Lines (3 cols) ═══════════ */}
        <div className="xl:col-span-3 space-y-6">

          {/* ── SECTION 1: Invoice Header ── */}
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 space-y-5">
            <h3 className={sectionTitleCls}>
              <Hash size={18} className="text-blue-500" /> {t('manual.invoiceHeader')}
            </h3>

            {/* Branch selector — shown only when the org has ≥1 registered branch.
                Picking a branch makes the backend swap the issuer address to match. */}
            {branches.length > 0 && (
              <div className="mb-4 flex items-center gap-3 p-3 bg-indigo-50/40 border border-indigo-100 rounded-xl">
                <Building2 size={18} className="text-indigo-600 flex-shrink-0" />
                <div className="flex-1">
                  <label className={`${labelCls} mb-0.5`}>{t('manual.issuingBranch')}</label>
                  <select value={selectedBranchId} onChange={e => setSelectedBranchId(e.target.value)}
                    className="w-full max-w-md bg-white border border-indigo-200 rounded-lg px-3 py-1.5 text-sm font-semibold text-slate-800 focus:ring-2 focus:ring-indigo-400 outline-none">
                    {branches.map(b => (
                      <option key={b.id} value={b.branch_id}>
                        {b.name ? `${b.name} ` : ''}
                        — {t('manual.branchPrefix')} {b.branch_id}
                        {b.governate ? ` · ${b.governate}` : ''}
                        {b.is_default ? `  (${t('manual.branchDefault')})` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            {/* Row 1: Core fields */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="space-y-1">
                <label className={labelCls}>{t('manual.internalId')}</label>
                <input type="text" value={header.internalId} onChange={e => setH('internalId', e.target.value)} placeholder={t('manual.internalIdAuto')} className={inputCls} />
              </div>
              <div className="space-y-1">
                <label className={labelCls}>{t('manual.documentType')}</label>
                <select value={header.documentType} onChange={e => {
                  const next = DOCUMENT_TYPES.find(d => d.code === e.target.value);
                  setHeader(prev => ({
                    ...prev,
                    documentType: e.target.value,
                    documentTypeVersion: next?.version || '0.9',
                    // Reset refs + serviceDeliveryDate when switching away from a type that needed them
                    references: next?.needsRefs ? prev.references : [],
                    serviceDeliveryDate: next?.export ? prev.serviceDeliveryDate : '',
                  }));
                }} className={inputCls}>
                  {DOCUMENT_TYPES.map(d => (
                    <option key={d.code} value={d.code}>{d.label} ({d.code}) — {d.nameAr}</option>
                  ))}
                </select>
                <p className="text-[9px] text-slate-400 pl-1">{t('manual.docVersion')}: <span className="font-mono font-bold text-slate-500">{currentDocType.version}</span></p>
              </div>
              <div className="space-y-1">
                <label className={labelCls}>{t('manual.dateTimeIssued')}</label>
                <input type="datetime-local" value={header.dateTimeIssued} onChange={e => setH('dateTimeIssued', e.target.value)} className={inputCls} />
              </div>
              <div className="space-y-1">
                <label className={labelCls}>{t('manual.activityCode')}</label>
                <input type="text" value={header.taxpayerActivityCode} onChange={e => setH('taxpayerActivityCode', e.target.value)} placeholder="e.g. 4620" className={inputCls} />
              </div>
              <div className="space-y-1">
                <label className={labelCls}>{t('manual.extraDiscount')} (EGP)</label>
                <input type="number" min={0} step="0.01" value={header.extraDiscountAmount} onChange={e => setH('extraDiscountAmount', parseFloat(e.target.value) || 0)} className={inputCls} />
              </div>
              {currentDocType.export && (
                <div className="space-y-1">
                  <label className={labelCls}>{t('manual.serviceDeliveryDate')} *</label>
                  <input type="date" value={header.serviceDeliveryDate} onChange={e => setH('serviceDeliveryDate', e.target.value)}
                    className={`${inputCls} ${!header.serviceDeliveryDate ? 'border-amber-300' : ''}`} />
                </div>
              )}
              <div className="space-y-1">
                <label className={labelCls}>{t('manual.proforma')}</label>
                <input type="text" value={header.proformaInvoiceNumber} onChange={e => setH('proformaInvoiceNumber', e.target.value)} placeholder={t('manual.optShort')} className={inputCls} />
              </div>
            </div>

            {/* References — only for Debit/Credit notes (incl. export variants) */}
            {currentDocType.needsRefs && (
              <div className="border-t border-gray-100 pt-4">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-xs font-bold text-slate-500 uppercase flex items-center gap-2">
                    <Link2 size={14} className="text-rose-500" />
                    {t('manual.references')} *
                    <span className="text-[10px] font-normal text-slate-400 normal-case">— {t('manual.refsHint')}</span>
                  </h4>
                  <button type="button" onClick={() => setH('references', [...header.references, ''])}
                    className="text-xs font-bold text-rose-600 hover:text-rose-700 flex items-center gap-1">
                    <Plus size={12} /> {t('manual.addReference')}
                  </button>
                </div>
                {header.references.length === 0 && (
                  <button type="button" onClick={() => setH('references', [''])}
                    className="w-full py-3 border-2 border-dashed border-rose-200 rounded-xl text-xs text-rose-600 font-bold hover:bg-rose-50 transition-colors">
                    {t('manual.addRefBlank')}
                  </button>
                )}
                {header.references.map((ref, i) => (
                  <div key={i} className="flex gap-2 mb-2">
                    <input type="text" value={ref}
                      onChange={e => setH('references', header.references.map((r, j) => j === i ? e.target.value : r))}
                      placeholder="e.g. 5Z40TP7SXAKADVH8WX71PXNE10"
                      className={`${inputCls} font-mono text-xs`} />
                    <button type="button" onClick={() => setH('references', header.references.filter((_, j) => j !== i))}
                      className="flex-shrink-0 px-2 text-rose-500 hover:bg-rose-50 rounded-lg"><Trash2 size={14} /></button>
                  </div>
                ))}
              </div>
            )}

            {/* Row 2: Receiver */}
            <div className="border-t border-gray-100 pt-4">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-xs font-bold text-slate-500 uppercase flex items-center gap-2">
                  <User size={14} className="text-blue-500" /> {t('manual.receiverInfo')}
                </h4>
                {/* Pull from Master Data — opens the full browser modal */}
                <button
                  type="button"
                  onClick={openBrowser}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 border border-indigo-200 text-indigo-700 rounded-lg text-[11px] font-bold hover:bg-indigo-100 transition-colors"
                  title={t('manual.pickFromMaster')}
                >
                  <BookUser size={13} /> {t('manual.pickFromMaster')}
                </button>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="space-y-1">
                  <label className={labelCls}>{t('manual.receiverType')}</label>
                  <select value={header.receiverType} onChange={e => setH('receiverType', e.target.value)} className={inputCls}>
                    <option value="B">{t('manual.businessB')}</option>
                    <option value="P">{t('manual.personP')}</option>
                    <option value="F">{t('manual.foreignerF')}</option>
                  </select>
                </div>
                <div className="space-y-1 relative">
                  <label className={labelCls}>{t('manual.receiverTaxId')} *</label>
                  <div className="flex gap-1">
                    <input
                      type="text"
                      value={header.receiverId}
                      onChange={e => { setH('receiverId', e.target.value); setVerifyResult(null); setMdSuggestOpen(true); }}
                      onFocus={() => setMdSuggestOpen(true)}
                      onBlur={() => { setTimeout(() => setMdSuggestOpen(false), 200); /* let onClick fire first */ }}
                      placeholder={t('manual.taxIdPlaceholder')}
                      className={`${inputCls} ${!header.receiverId ? 'border-amber-300' : ''}`}
                    />
                    <button
                      type="button"
                      onClick={verifyReceiver}
                      disabled={isVerifying || !header.receiverId.trim()}
                      title={t('manual.verifyTaxIdTitle')}
                      className="flex-shrink-0 px-2.5 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center gap-1"
                    >
                      {isVerifying ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
                    </button>
                  </div>

                  {/* Master Data suggestion dropdown */}
                  {mdSuggestOpen && (mdSuggestLoading || mdSuggestions.length > 0) && (
                    <div className="absolute z-20 mt-1 w-full max-w-md bg-white border border-gray-200 rounded-lg shadow-lg max-h-64 overflow-y-auto">
                      <div className="px-3 py-1.5 bg-indigo-50/60 border-b border-indigo-100 text-[10px] font-bold text-indigo-700 uppercase flex items-center gap-1">
                        <Users size={11} /> {t('manual.mdMatches')}
                        {mdSuggestLoading && <Loader2 size={10} className="animate-spin ml-1" />}
                      </div>
                      {mdSuggestions.length === 0 && !mdSuggestLoading && (
                        <div className="px-3 py-3 text-xs text-slate-400">{t('manual.mdNoMatch')}</div>
                      )}
                      {mdSuggestions.map(c => (
                        <button
                          key={c.id}
                          type="button"
                          onMouseDown={e => e.preventDefault() /* stop blur before click */}
                          onClick={() => applyCustomer(c)}
                          className="w-full text-left px-3 py-2 hover:bg-indigo-50 transition-colors border-b border-gray-50 last:border-b-0"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <div className="text-sm font-bold text-slate-800 truncate">{c.name || '—'}</div>
                              <div className="text-[11px] text-slate-500 font-mono">{c.tax_id}</div>
                            </div>
                            <div className="text-right flex-shrink-0">
                              {c.party_type && <div className="text-[9px] font-bold text-slate-400 uppercase">{c.party_type}</div>}
                              {!!c.invoice_count && <div className="text-[10px] text-emerald-600 font-semibold">{c.invoice_count} {c.invoice_count === 1 ? t('manual.invoiceWord') : t('manual.invoicesWord')}</div>}
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}

                  {verifyResult && verifyResult.kind === 'ok' && (
                    <div className="text-[11px] mt-1 text-emerald-700 flex items-center gap-1">
                      <CheckCircle2 size={11} />
                      <span>
                        {verifyResult.name || t('manual.registered')}
                        {verifyResult.type ? ` · ${verifyResult.type}` : ''}
                        {verifyResult.status ? ` · ${verifyResult.status}` : ''}
                      </span>
                    </div>
                  )}
                  {verifyResult && verifyResult.kind === 'err' && (
                    <div className="text-[11px] mt-1 text-amber-700 flex items-center gap-1">
                      <AlertCircle size={11} /> {verifyResult.message}
                    </div>
                  )}
                </div>
                <div className="md:col-span-2 space-y-1">
                  <label className={labelCls}>{t('manual.receiverName')} *</label>
                  <input type="text" value={header.receiverName} onChange={e => setH('receiverName', e.target.value)} placeholder={t('manual.namePlaceholder')} className={`${inputCls} ${!header.receiverName ? 'border-amber-300' : ''}`} />
                </div>
              </div>
            </div>

            {/* Row 3: Address (collapsible) */}
            <div className="border-t border-gray-100 pt-3">
              <button onClick={() => setShowAddress(!showAddress)} className="flex items-center gap-2 text-xs font-bold text-blue-600 hover:text-blue-800 transition-colors">
                <MapPin size={14} />
                {t('manual.receiverAddress')}
                {showAddress ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>
              {showAddress && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-3 animate-fadeIn">
                  <div className="space-y-1">
                    <label className={labelCls}>{t('manual.country')}</label>
                    <input type="text" value={header.receiverCountry} onChange={e => setH('receiverCountry', e.target.value)} className={inputCls} />
                  </div>
                  <div className="space-y-1">
                    <label className={labelCls}>{t('manual.governate')}</label>
                    <input type="text" value={header.receiverGovernate} onChange={e => setH('receiverGovernate', e.target.value)} placeholder="e.g. Cairo" className={inputCls} />
                  </div>
                  <div className="space-y-1">
                    <label className={labelCls}>{t('manual.regionCity')}</label>
                    <input type="text" value={header.receiverRegionCity} onChange={e => setH('receiverRegionCity', e.target.value)} className={inputCls} />
                  </div>
                  <div className="space-y-1">
                    <label className={labelCls}>{t('manual.street')}</label>
                    <input type="text" value={header.receiverStreet} onChange={e => setH('receiverStreet', e.target.value)} className={inputCls} />
                  </div>
                  <div className="space-y-1">
                    <label className={labelCls}>{t('manual.buildingNo')}</label>
                    <input type="text" value={header.receiverBuildingNumber} onChange={e => setH('receiverBuildingNumber', e.target.value)} className={inputCls} />
                  </div>
                  <div className="space-y-1">
                    <label className={labelCls}>{t('manual.postalCode')}</label>
                    <input type="text" value={header.receiverPostalCode} onChange={e => setH('receiverPostalCode', e.target.value)} className={inputCls} />
                  </div>
                  <div className="space-y-1">
                    <label className={labelCls}>{t('manual.floor')}</label>
                    <input type="text" value={header.receiverFloor} onChange={e => setH('receiverFloor', e.target.value)} className={inputCls} />
                  </div>
                  <div className="space-y-1">
                    <label className={labelCls}>{t('manual.room')}</label>
                    <input type="text" value={header.receiverRoom} onChange={e => setH('receiverRoom', e.target.value)} className={inputCls} />
                  </div>
                </div>
              )}
            </div>

            {/* Row 4: Optional fields (collapsible) */}
            <div className="border-t border-gray-100 pt-3">
              <button onClick={() => setShowOptional(!showOptional)} className="flex items-center gap-2 text-xs font-bold text-slate-400 hover:text-slate-600 transition-colors">
                {t('manual.optional')}
                {showOptional ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>
              {showOptional && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-3 animate-fadeIn">
                  <div className="space-y-1">
                    <label className={labelCls}>{t('manual.poRef')}</label>
                    <input type="text" value={header.purchaseOrderReference} onChange={e => setH('purchaseOrderReference', e.target.value)} className={inputCls} />
                  </div>
                  <div className="space-y-1">
                    <label className={labelCls}>{t('manual.poDesc')}</label>
                    <input type="text" value={header.purchaseOrderDescription} onChange={e => setH('purchaseOrderDescription', e.target.value)} className={inputCls} />
                  </div>
                  <div className="space-y-1">
                    <label className={labelCls}>{t('manual.salesOrderRef')}</label>
                    <input type="text" value={header.salesOrderReference} onChange={e => setH('salesOrderReference', e.target.value)} className={inputCls} />
                  </div>
                  <div className="space-y-1">
                    <label className={labelCls}>{t('manual.salesOrderDesc')}</label>
                    <input type="text" value={header.salesOrderDescription} onChange={e => setH('salesOrderDescription', e.target.value)} className={inputCls} />
                  </div>
                </div>
              )}
            </div>

            {/* Row 5: Payment info (collapsible) — ETA `payment` block.
                All fields optional; backend only emits `payment` when ≥1 is populated. */}
            <div className="border-t border-gray-100 pt-3">
              <button onClick={() => setShowPayment(!showPayment)} className="flex items-center gap-2 text-xs font-bold text-emerald-600 hover:text-emerald-700 transition-colors">
                <CreditCard size={14} />
                {t('manual.payment')}
                {showPayment ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>
              {showPayment && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-3 animate-fadeIn">
                  <div className="space-y-1">
                    <label className={labelCls}>{t('manual.bankName')}</label>
                    <input type="text" value={header.paymentBankName} onChange={e => setH('paymentBankName', e.target.value)} placeholder="e.g. NBE" className={inputCls} />
                  </div>
                  <div className="space-y-1 md:col-span-2">
                    <label className={labelCls}>{t('manual.bankAddress')}</label>
                    <input type="text" value={header.paymentBankAddress} onChange={e => setH('paymentBankAddress', e.target.value)} placeholder={t('manual.bankBranchAddress')} className={inputCls} />
                  </div>
                  <div className="space-y-1">
                    <label className={labelCls}>{t('manual.swiftCode')}</label>
                    <input type="text" value={header.paymentSwiftCode} onChange={e => setH('paymentSwiftCode', e.target.value)} placeholder="e.g. NBEGEGCX" className={inputCls} />
                  </div>
                  <div className="space-y-1">
                    <label className={labelCls}>{t('manual.accountNumber')}</label>
                    <input type="text" value={header.paymentBankAccountNo} onChange={e => setH('paymentBankAccountNo', e.target.value)} className={inputCls} />
                  </div>
                  <div className="space-y-1 md:col-span-2">
                    <label className={labelCls}>{t('manual.iban')}</label>
                    <input type="text" value={header.paymentBankAccountIban} onChange={e => setH('paymentBankAccountIban', e.target.value)} placeholder="EG..." className={`${inputCls} font-mono`} />
                  </div>
                  <div className="space-y-1 md:col-span-4">
                    <label className={labelCls}>{t('manual.paymentTerms')}</label>
                    <input type="text" value={header.paymentTerms} onChange={e => setH('paymentTerms', e.target.value)} placeholder={t('manual.paymentTermsHint')} className={inputCls} />
                  </div>
                </div>
              )}
            </div>

            {/* Row 6: Delivery info (collapsible) — ETA `delivery` block.
                `countryOfOrigin` is a 2-letter ISO code; `grossWeight`/`netWeight` are decimals.
                Auto-expanded when the user picks an Export document type. */}
            <div className="border-t border-gray-100 pt-3">
              <button onClick={() => setShowDelivery(!showDelivery)} className="flex items-center gap-2 text-xs font-bold text-indigo-600 hover:text-indigo-700 transition-colors">
                <Truck size={14} />
                {t('manual.delivery')}
                {currentDocType.export && <span className="text-[10px] text-indigo-400 font-normal normal-case">{t('manual.delivExportNote')}</span>}
                {showDelivery ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>
              {showDelivery && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-3 animate-fadeIn">
                  <div className="space-y-1">
                    <label className={labelCls}>{t('manual.delivApproach')}</label>
                    <input type="text" value={header.deliveryApproach} onChange={e => setH('deliveryApproach', e.target.value)} placeholder={t('manual.delivApproachHint')} className={inputCls} />
                  </div>
                  <div className="space-y-1">
                    <label className={labelCls}>{t('manual.delivPackaging')}</label>
                    <input type="text" value={header.deliveryPackaging} onChange={e => setH('deliveryPackaging', e.target.value)} className={inputCls} />
                  </div>
                  <div className="space-y-1">
                    <label className={labelCls}>{t('manual.delivExportPort')}</label>
                    <input type="text" value={header.deliveryExportPort} onChange={e => setH('deliveryExportPort', e.target.value)} placeholder={t('manual.delivExportPortHint')} className={inputCls} />
                  </div>
                  <div className="space-y-1">
                    <label className={labelCls}>{t('manual.delivCountryOrigin')}</label>
                    <input type="text" value={header.deliveryCountryOfOrigin} onChange={e => setH('deliveryCountryOfOrigin', e.target.value.toUpperCase())} placeholder="EG" maxLength={2} className={`${inputCls} uppercase font-mono`} />
                  </div>
                  <div className="space-y-1">
                    <label className={labelCls}>{t('manual.grossWeight')}</label>
                    <input type="number" min={0} step="0.01" value={header.deliveryGrossWeight} onChange={e => setH('deliveryGrossWeight', parseFloat(e.target.value) || 0)} className={inputCls} />
                  </div>
                  <div className="space-y-1">
                    <label className={labelCls}>{t('manual.netWeight')}</label>
                    <input type="number" min={0} step="0.01" value={header.deliveryNetWeight} onChange={e => setH('deliveryNetWeight', parseFloat(e.target.value) || 0)} className={inputCls} />
                  </div>
                  <div className="space-y-1">
                    <label className={labelCls}>{t('manual.dateValidity')}</label>
                    <input type="datetime-local" value={header.deliveryDateValidity} onChange={e => setH('deliveryDateValidity', e.target.value)} className={inputCls} />
                  </div>
                  <div className="space-y-1 md:col-span-4">
                    <label className={labelCls}>{t('manual.delivTerms')}</label>
                    <input type="text" value={header.deliveryTerms} onChange={e => setH('deliveryTerms', e.target.value)} placeholder={t('manual.delivTermsHint')} className={inputCls} />
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* ── SECTION 2: Invoice Lines ── */}
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
            <div className="flex items-center justify-between mb-4">
              <h3 className={sectionTitleCls}>
                <FileText size={18} className="text-emerald-500" /> {t('manual.invoiceLines')}
              </h3>
              <button onClick={addLine} className="flex items-center gap-1 text-xs font-bold text-emerald-600 hover:text-emerald-700 bg-emerald-50 px-4 py-2 rounded-xl transition-colors">
                <Plus size={14} /> {t('manual.addLine')}
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left min-w-[900px]">
                <thead>
                  <tr className="border-b-2 border-gray-100">
                    <th className="pb-3 text-[10px] font-bold text-slate-400 uppercase w-8">#</th>
                    <th className="pb-3 text-[10px] font-bold text-slate-400 uppercase">{t('manual.lineDescription')}</th>
                    <th className="pb-3 text-[10px] font-bold text-slate-400 uppercase">{t('manual.lineItemCode')}</th>
                    <th className="pb-3 text-[10px] font-bold text-slate-400 uppercase">{t('manual.lineUnit')}</th>
                    <th className="pb-3 text-[10px] font-bold text-slate-400 uppercase text-right">{t('manual.quantity')}</th>
                    <th className="pb-3 text-[10px] font-bold text-slate-400 uppercase text-right">{t('manual.unitPrice')}</th>
                    <th className="pb-3 text-[10px] font-bold text-slate-400 uppercase text-right">{t('manual.discount')}</th>
                    <th className="pb-3 text-[10px] font-bold text-slate-400 uppercase min-w-[240px]">{t('manual.taxes')}</th>
                    <th className="pb-3 text-[10px] font-bold text-slate-400 uppercase text-right bg-emerald-50 rounded-t-lg">{t('manual.lineTotal')}</th>
                    <th className="pb-3 text-[10px] font-bold text-slate-400 uppercase text-right w-10"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {lines.map((line, idx) => {
                    const lt = calcLineTotals(line);
                    return (
                      <tr key={line.id} className="group hover:bg-blue-50/30 transition-colors">
                        <td className="py-3 pr-1 text-xs font-bold text-slate-300">{idx + 1}</td>
                        <td className="py-3 pr-2">
                          <input type="text" value={line.description} onChange={e => updateLine(line.id, 'description', e.target.value)} placeholder={t('manual.lineDescPlaceholder')}
                            className="w-full min-w-[140px] bg-gray-50 border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:ring-1 focus:ring-blue-500 outline-none" />
                        </td>
                        <td className="py-3 pr-2">
                          <input type="text" value={line.itemCode} onChange={e => updateLine(line.id, 'itemCode', e.target.value)} placeholder={t('manual.itemCodePlaceholder')}
                            className="w-28 bg-gray-50 border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:ring-1 focus:ring-blue-500 outline-none" />
                        </td>
                        <td className="py-3 pr-2">
                          <select value={line.unitType} onChange={e => updateLine(line.id, 'unitType', e.target.value)}
                            className="w-16 bg-gray-50 border border-gray-200 rounded-lg px-1 py-1.5 text-xs outline-none">
                            <option value="EA">EA</option>
                            <option value="KGM">KGM</option>
                            <option value="MTR">MTR</option>
                            <option value="LTR">LTR</option>
                            <option value="PCE">PCE</option>
                            <option value="SET">SET</option>
                            <option value="HR">HR</option>
                            <option value="DAY">DAY</option>
                          </select>
                        </td>
                        <td className="py-3 pr-2">
                          <input type="number" min={1} step="1" value={line.quantity} onChange={e => updateLine(line.id, 'quantity', parseFloat(e.target.value) || 0)}
                            className="w-16 bg-gray-50 border border-gray-200 rounded-lg px-2 py-1.5 text-xs text-right focus:ring-1 focus:ring-blue-500 outline-none" />
                        </td>
                        <td className="py-3 pr-2">
                          <input type="number" min={0} step="0.01" value={line.amount} onChange={e => updateLine(line.id, 'amount', parseFloat(e.target.value) || 0)}
                            className="w-24 bg-gray-50 border border-gray-200 rounded-lg px-2 py-1.5 text-xs text-right focus:ring-1 focus:ring-blue-500 outline-none" />
                        </td>
                        <td className="py-3 pr-2">
                          <input type="number" min={0} max={100} step="0.01" value={line.disRate} onChange={e => updateLine(line.id, 'disRate', parseFloat(e.target.value) || 0)}
                            className="w-16 bg-gray-50 border border-gray-200 rounded-lg px-2 py-1.5 text-xs text-right focus:ring-1 focus:ring-blue-500 outline-none" />
                        </td>
                        <td className="py-3 pr-2 align-top">
                          {/* Dynamic tax items per line — full ETA T1..T20 support with
                              proper subtypes (V001, W003, Tb01, …) per the ETA SDK. */}
                          <div className="flex flex-col gap-1.5 min-w-[260px]">
                            {line.taxableItems.length === 0 && (
                              <div className="text-[10px] text-slate-400 italic py-1">{t('manual.noTaxesYet')}</div>
                            )}
                            {line.taxableItems.map((ti, tIdx) => {
                              const taxType = getTaxType(ti.taxType);
                              const isWHT = !!taxType?.isWithholding;
                              return (
                                <div key={tIdx} className={`flex items-center gap-1 p-1 rounded-md border ${isWHT ? 'bg-rose-50/50 border-rose-100' : 'bg-blue-50/40 border-blue-100'}`}>
                                  <select value={ti.taxType} onChange={e => onTaxTypeChange(line.id, tIdx, e.target.value)}
                                    className="w-14 bg-white border border-gray-200 rounded px-1 py-1 text-[10px] font-mono font-bold outline-none"
                                    title={taxType?.name || ''}>
                                    {TAX_CATALOG.map(t => <option key={t.code} value={t.code} title={t.name}>{t.code}</option>)}
                                  </select>
                                  <select value={ti.subType} onChange={e => onSubTypeChange(line.id, tIdx, e.target.value)}
                                    className="min-w-[80px] bg-white border border-gray-200 rounded px-1 py-1 text-[10px] font-mono outline-none"
                                    title={taxType?.subtypes.find(s => s.code === ti.subType)?.name || ''}>
                                    {(taxType?.subtypes || []).map(s => (
                                      <option key={s.code} value={s.code} title={s.name}>{s.code}</option>
                                    ))}
                                  </select>
                                  <input type="number" min={0} max={200} step="0.01" value={ti.rate}
                                    onChange={e => updateTaxItem(line.id, tIdx, { rate: parseFloat(e.target.value) || 0 })}
                                    className="w-14 bg-white border border-gray-200 rounded px-1 py-1 text-[10px] text-right outline-none"
                                    title={t('manual.ratePct')} />
                                  <Percent size={10} className="text-slate-400" />
                                  <button type="button" onClick={() => removeTaxItem(line.id, tIdx)}
                                    className="flex-shrink-0 p-0.5 text-slate-300 hover:text-rose-500 rounded"
                                    title={t('manual.removeTax')}>
                                    <X size={11} />
                                  </button>
                                </div>
                              );
                            })}
                            <button type="button" onClick={() => addTaxItem(line.id)}
                              className="text-[10px] font-bold text-blue-600 hover:text-blue-700 flex items-center gap-0.5 self-start">
                              <Plus size={10} /> {t('manual.addTax')}
                            </button>
                          </div>
                        </td>
                        <td className="py-3 pr-2 bg-emerald-50/50">
                          <span className="text-sm font-bold text-emerald-700 block text-right">
                            {lt.lineTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </span>
                        </td>
                        <td className="py-3 text-right">
                          <button onClick={() => removeLine(line.id)}
                            className="p-1.5 text-slate-300 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-colors opacity-0 group-hover:opacity-100">
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Add line button (bottom) */}
            <button onClick={addLine} className="mt-4 w-full border-2 border-dashed border-gray-200 hover:border-emerald-400 rounded-xl py-3 text-sm font-semibold text-slate-400 hover:text-emerald-600 transition-all flex items-center justify-center gap-2">
              <Plus size={16} /> {t('manual.addLine')}
            </button>
          </div>
        </div>

        {/* ═══════════ RIGHT: Summary Sidebar (1 col) ═══════════ */}
        <div className="space-y-6">
          {/* Totals Card */}
          <div className="bg-slate-900 text-white p-6 rounded-2xl shadow-lg sticky top-6">
            <h3 className="font-bold mb-5 opacity-70 text-sm uppercase tracking-wider">{t('manual.invoiceSummary')}</h3>
            <div className="space-y-3">
              <div className="flex justify-between text-sm">
                <span className="opacity-60">{t('manual.subtotal')}</span>
                <span>{subtotal.toLocaleString(undefined, { minimumFractionDigits: 2 })} EGP</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="opacity-60">{t('manual.lineDiscounts')}</span>
                <span className="text-orange-400">-{totalDiscount.toLocaleString(undefined, { minimumFractionDigits: 2 })} EGP</span>
              </div>
              {header.extraDiscountAmount > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="opacity-60">{t('manual.extraDiscount')}</span>
                  <span className="text-rose-400">-{header.extraDiscountAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })} EGP</span>
                </div>
              )}
              <div className="flex justify-between text-sm">
                <span className="opacity-60">{t('manual.netAmount')}</span>
                <span>{netAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })} EGP</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="opacity-60">{t('manual.totalTax')}</span>
                <span className="text-purple-400">+{totalTax.toLocaleString(undefined, { minimumFractionDigits: 2 })} EGP</span>
              </div>
              <div className="h-px bg-slate-700 my-3" />
              <div className="flex justify-between text-xl font-bold">
                <span>{t('manual.grandTotal')}</span>
                <span className="text-blue-400">{grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })} EGP</span>
              </div>
            </div>

            {/* Line count */}
            <div className="mt-5 bg-slate-800 rounded-xl p-3 flex justify-between items-center">
              <span className="text-xs opacity-60">{t('manual.lineItems')}</span>
              <span className="text-lg font-bold text-emerald-400">{lines.length}</span>
            </div>

            {/* Validation hint */}
            <div className="mt-4 flex items-center gap-2 bg-slate-800 p-3 rounded-xl border border-slate-700">
              <ShieldCheck className="text-emerald-400 flex-shrink-0" size={16} />
              <span className="text-[10px] leading-tight opacity-70">{t('manual.serverValidates')}</span>
            </div>
          </div>

          {/* Quick Actions */}
          <div className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100 space-y-3">
            <button
              onClick={handleSendToETA}
              disabled={isLoading}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white rounded-xl text-sm font-bold shadow-lg disabled:opacity-50 transition-all"
            >
              {isLoading ? <RefreshCw className="animate-spin" size={16} /> : <Send size={16} />}
              {isLoading ? `${t('common.loading')}` : t('manual.sendToEta')}
            </button>
          </div>
        </div>
      </div>

      {/* ═══════════ MASTER DATA CUSTOMER BROWSER MODAL ═══════════ */}
      {showBrowser && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-[28px] shadow-2xl max-w-3xl w-full max-h-[85vh] overflow-hidden flex flex-col">
            <div className="p-5 bg-gradient-to-r from-indigo-600 to-indigo-700 text-white flex items-center justify-between">
              <div className="flex items-center gap-3">
                <BookUser size={22} />
                <div>
                  <h3 className="font-black text-lg">{t('manual.pickCustomerTitle')}</h3>
                  <p className="text-[11px] text-indigo-100">{t('manual.pickCustomerSub')}</p>
                </div>
              </div>
              <button onClick={() => setShowBrowser(false)} className="text-white/80 hover:text-white hover:bg-white/20 rounded-full p-2 transition-all">
                <X size={18} />
              </button>
            </div>
            <div className="p-4 border-b border-gray-100">
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={browserQuery}
                  onChange={e => setBrowserQuery(e.target.value)}
                  placeholder={t('manual.searchCustomerPh')}
                  className="w-full pl-9 pr-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                  autoFocus
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto">
              {browserLoading && (
                <div className="p-12 text-center text-slate-400 flex flex-col items-center gap-2">
                  <Loader2 size={28} className="animate-spin" />
                  <p className="text-sm">{t('manual.loadingCustomers')}</p>
                </div>
              )}
              {!browserLoading && browserRows.length === 0 && (
                <div className="p-12 text-center text-slate-400">
                  <Users size={32} className="mx-auto mb-2 opacity-50" />
                  <p className="text-sm">{t('manual.noCustomersFound')}</p>
                  <p className="text-xs mt-1">{t('manual.noCustomersHint')}</p>
                </div>
              )}
              {!browserLoading && browserRows.length > 0 && (
                <div className="divide-y divide-gray-50">
                  {browserRows.map(c => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => applyCustomer(c)}
                      className="w-full text-left px-5 py-3 hover:bg-indigo-50/50 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-bold text-slate-800 truncate">{c.name || '—'}</span>
                            {c.party_type && <span className="text-[9px] font-bold px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded uppercase">{c.party_type}</span>}
                          </div>
                          <div className="text-[11px] text-slate-500 font-mono mt-0.5">{c.tax_id}</div>
                          {(c.governate || c.region_city || c.street) && (
                            <div className="text-[11px] text-slate-400 mt-0.5 truncate">
                              {[c.governate, c.region_city, c.street].filter(Boolean).join(' · ')}
                            </div>
                          )}
                          {c.tags && c.tags.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1">
                              {c.tags.slice(0, 4).map(t => (
                                <span key={t} className="text-[9px] bg-emerald-50 text-emerald-700 border border-emerald-100 px-1.5 py-0.5 rounded">{t}</span>
                              ))}
                            </div>
                          )}
                        </div>
                        <div className="text-right flex-shrink-0 text-[11px]">
                          {!!c.invoice_count && <div className="text-emerald-600 font-bold">{c.invoice_count}</div>}
                          <div className="text-slate-400">{c.invoice_count === 1 ? t('manual.invoiceWord') : t('manual.invoicesWord')}</div>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="p-3 border-t border-gray-100 bg-gray-50 text-[11px] text-slate-500 text-center">
              {t('manual.showingUpTo20')}
            </div>
          </div>
        </div>
      )}

      {/* ═══════════ RESULT MODAL ═══════════ */}
      {showResultModal && submissionResult && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-[28px] shadow-2xl max-w-2xl w-full max-h-[85vh] overflow-hidden">
            {/* Modal Header */}
            <div className={`p-6 ${submissionResult.success ? 'bg-gradient-to-r from-emerald-600 to-emerald-700' : 'bg-gradient-to-r from-rose-600 to-rose-700'} text-white`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {submissionResult.success ? <CheckCircle2 size={28} /> : <AlertCircle size={28} />}
                  <div>
                    <h3 className="text-xl font-black">
                      {submissionResult.success ? t('manual.submissionDone') : t('manual.submissionFailed')}
                    </h3>
                    {submissionResult.summary && (
                      <p className="text-sm mt-1 opacity-90">
                        {t('manual.success')}: {submissionResult.summary.success || 0} | {t('manual.failedLabel')}: {submissionResult.summary.failed || 0}
                      </p>
                    )}
                  </div>
                </div>
                <button onClick={() => setShowResultModal(false)} className="text-white/80 hover:text-white hover:bg-white/20 rounded-full p-2 transition-all">
                  <X size={22} />
                </button>
              </div>
            </div>

            {/* Modal Content */}
            <div className="p-6 overflow-y-auto" style={{ maxHeight: 'calc(85vh - 160px)' }}>
              {submissionResult.success && submissionResult.summary ? (
                <div className="space-y-5">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-emerald-50 border-2 border-emerald-300 rounded-2xl p-5 text-center">
                      <p className="text-emerald-700 text-sm font-bold uppercase mb-1">✅ {t('manual.successful')}</p>
                      <p className="text-4xl font-black text-emerald-900">{submissionResult.summary.success || 0}</p>
                    </div>
                    <div className="bg-rose-50 border-2 border-rose-300 rounded-2xl p-5 text-center">
                      <p className="text-rose-700 text-sm font-bold uppercase mb-1">❌ {t('manual.failedLabel')}</p>
                      <p className="text-4xl font-black text-rose-900">{submissionResult.summary.failed || 0}</p>
                    </div>
                  </div>

                  {/* Failed details */}
                  {submissionResult.summary.failed > 0 && submissionResult.summary.results && (
                    <div className="space-y-3">
                      <h4 className="text-base font-black text-slate-900 flex items-center gap-2">
                        <AlertCircle className="text-rose-600" size={18} /> {t('manual.errorDetails')}
                      </h4>
                      {submissionResult.summary.results
                        .filter((r: any) => r.status === 'Failed')
                        .map((inv: any, idx: number) => (
                          <div key={idx} className="bg-rose-50 border border-rose-200 rounded-xl p-4">
                            <p className="font-bold text-rose-900 mb-1">{t('manual.invoiceLabel')}: {inv.internalId}</p>
                            <p className="text-sm text-rose-700">{inv.error}</p>
                            {inv.errorDetails && (
                              <pre className="mt-2 text-[10px] text-slate-600 bg-white p-2 rounded-lg overflow-x-auto whitespace-pre-wrap">
                                {typeof inv.errorDetails === 'string' ? inv.errorDetails.substring(0, 500) : JSON.stringify(inv.errorDetails, null, 2).substring(0, 500)}
                              </pre>
                            )}
                          </div>
                        ))}
                    </div>
                  )}

                  {submissionResult.summary.success > 0 && (
                    <div className="bg-emerald-50 border-2 border-emerald-300 rounded-xl p-4 flex items-center gap-3">
                      <CheckCircle2 className="text-emerald-600" size={20} />
                      <p className="text-emerald-900 font-bold text-sm">{t('manual.submittedOk')}</p>
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="bg-rose-50 border-2 border-rose-200 rounded-xl p-5">
                    <p className="text-rose-900 font-semibold whitespace-pre-wrap text-sm">{submissionResult.message}</p>
                  </div>
                  {submissionResult.isNetworkError && (
                    <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                      <p className="text-amber-900 text-sm">💡 <strong>{t('manual.networkTip')}</strong></p>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-5 bg-slate-50 border-t border-slate-200 flex justify-end gap-3">
              <button onClick={() => setShowResultModal(false)} className="px-5 py-2.5 bg-slate-200 hover:bg-slate-300 text-slate-800 rounded-xl font-bold transition-all text-sm">
                {t('common.close')}
              </button>
              {submissionResult.success && submissionResult.summary?.success > 0 && (
                <button
                  onClick={() => {
                    setShowResultModal(false);
                    setHeader(prev => ({ ...prev, internalId: '', receiverId: '', receiverName: '' }));
                    setLines([defaultLine()]);
                  }}
                  className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold transition-all flex items-center gap-2 text-sm"
                >
                  <RefreshCw size={16} /> {t('manual.newInvoice')}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ManualInvoice;
