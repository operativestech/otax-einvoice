
import React, { useState } from 'react';
import {
    Globe, Shield, FileText, Send, Search, Package, Code, BookOpen,
    ChevronRight, ExternalLink, Copy, Check, Info, FileCode, AlertCircle
} from 'lucide-react';

const ETAReference: React.FC = () => {
    const [activeSection, setActiveSection] = useState('auth');
    const [copiedId, setCopiedId] = useState<string | null>(null);

    const copyToClipboard = (text: string, id: string) => {
        navigator.clipboard.writeText(text);
        setCopiedId(id);
        setTimeout(() => setCopiedId(null), 2000);
    };

    const sections = [
        { id: 'auth', label: 'Authentication', icon: <Shield size={18} /> },
        { id: 'shared', label: 'Common APIs', icon: <Globe size={18} /> },
        { id: 'invoice', label: 'e-Invoicing', icon: <FileText size={18} /> },
        { id: 'receipt', label: 'e-Receipt', icon: <Send size={18} /> },
        { id: 'codes', label: 'Code Tables', icon: <Code size={18} /> },
        { id: 'callbacks', label: 'ERP Callbacks', icon: <ExternalLink size={18} /> },
    ];

    const apiData = {
        auth: [
            { method: 'POST', endpoint: '/connect/token', description: 'تسجيل الدخول – استخراج Access Token (OAuth2) لكل الأنظمة (ERP / POS)' },
            { method: 'POST', endpoint: '/connect/revocation', description: 'إلغاء Token (Logout / Security)' },
        ],
        shared: [
            { method: 'GET', endpoint: '/api/v1.0/documenttypes', description: 'جلب كل أنواع المستندات المدعومة (Invoice – Credit – Debit – Receipt…)' },
            { method: 'GET', endpoint: '/api/v1.0/documenttypes/{id}', description: 'تفاصيل نوع مستند واحد' },
            { method: 'GET', endpoint: '/api/v1.0/documenttypes/{id}/versions/{version}', description: 'جلب Schema & Structure للنسخة' },
            { method: 'GET', endpoint: '/api/v1.0/notifications', description: 'جلب إشعارات النظام السابقة' },
            { method: 'PUT', endpoint: '/ping', description: 'اختبار أن ERP شغال وجاهز يستقبل callbacks' },
            { method: 'POST', endpoint: '/api/v1.0/egs/codeusages', description: 'تسجيل استخدام EGS Code' },
            { method: 'GET', endpoint: '/api/v1.0/egs/codeusages', description: 'استعلام عن أكواد EGS المسجلة' },
            { method: 'GET', endpoint: '/api/v1.0/codetypes/{codeType}/codes', description: 'البحث في Code Tables (Tax, Unit, Currency…)' },
        ],
        invoice: [
            {
                category: 'الإرسال والإدارة', items: [
                    { method: 'POST', endpoint: '/api/v1.0/documentsubmissions', description: 'إرسال فواتير / Credit / Debit / Export' },
                    { method: 'GET', endpoint: '/api/v1.0/submissions/{submissionUUID}', description: 'حالة دفعة الإرسال' },
                    { method: 'PUT', endpoint: '/api/v1.0/documents/state/{uuid}/state', description: 'إلغاء فاتورة (Cancel)' },
                    { method: 'POST', endpoint: '/api/v1.0/documents/{uuid}/rejection', description: 'Reject فاتورة (من المستلم)' },
                ]
            },
            {
                category: 'الاستعلام والبحث', items: [
                    { method: 'GET', endpoint: '/api/v1.0/documents/recent', description: 'جلب أحدث الفواتير' },
                    { method: 'GET', endpoint: '/api/v1.0/documents/search', description: 'بحث متقدم في الفواتير' },
                    { method: 'GET', endpoint: '/api/v1.0/documents/{uuid}/raw', description: 'جلب الفاتورة JSON / XML خام' },
                    { method: 'GET', endpoint: '/api/v1.0/documents/{uuid}/details', description: 'تفاصيل + Validation' },
                    { method: 'GET', endpoint: '/api/v1.0/documents/{uuid}/printout', description: 'تحميل PDF' },
                ]
            },
            {
                category: 'تحميل باقات (Bulk)', items: [
                    { method: 'POST', endpoint: '/api/v1.0/documentpackages/requests', description: 'طلب Package فواتير' },
                    { method: 'GET', endpoint: '/api/v1.0/documentpackages/requests', description: 'متابعة حالة الطلب' },
                    { method: 'GET', endpoint: '/api/v1.0/documentpackages/{packageId}', description: 'تحميل الباقة (ZIP)' },
                ]
            }
        ],
        receipt: [
            {
                category: 'Authentication POS', items: [
                    { method: 'POST', endpoint: '/connect/token', description: 'Token خاص بالـ POS' },
                ]
            },
            {
                category: 'إرسال الإيصالات', items: [
                    { method: 'POST', endpoint: '/api/v1/receipts/submissions', description: 'إرسال إيصال إلكتروني' },
                ]
            },
            {
                category: 'الاستعلام والبحث', items: [
                    { method: 'GET', endpoint: '/api/v1/receipts/recent', description: 'أحدث الإيصالات' },
                    { method: 'GET', endpoint: '/api/v1/receipts/search', description: 'بحث في الإيصالات' },
                    { method: 'GET', endpoint: '/api/v1/receipts/{uuid}/raw', description: 'الإيصال RAW JSON' },
                    { method: 'GET', endpoint: '/api/v1/receipts/{uuid}/details', description: 'تفاصيل + Validation' },
                ]
            },
            {
                category: 'تحميل باقات إيصالات', items: [
                    { method: 'POST', endpoint: '/api/v1/receiptpackages/requests', description: 'طلب باقة إيصالات' },
                    { method: 'GET', endpoint: '/api/v1/receiptpackages/requests', description: 'متابعة الطلب' },
                    { method: 'GET', endpoint: '/api/v1/receiptpackages/{packageId}', description: 'تحميل الباقة ZIP' },
                ]
            }
        ],
        codes: [
            { type: 'CurrencyCodes', usage: 'العملات' },
            { type: 'UnitTypes', usage: 'وحدات القياس' },
            { type: 'TaxTypes', usage: 'أنواع الضرائب' },
            { type: 'TaxSubTypes', usage: 'تفاصيل الضريبة' },
            { type: 'PaymentMethods', usage: 'طرق الدفع' },
            { type: 'CountryCodes', usage: 'الدول' },
            { type: 'DocumentTypes', usage: 'أنواع المستندات' },
        ],
        callbacks: [
            { endpoint: '/api/eta/invoice/notify', description: 'إشعار قبول / رفض / إلغاء فاتورة' },
            { endpoint: '/api/eta/invoice/error', description: 'أخطاء Validation' },
            { endpoint: '/api/eta/invoice/status', description: 'تحديث حالة الفاتورة' },
            { endpoint: '/api/eta/receipt/notify', description: 'إشعار قبول / رفض إيصال' },
            { endpoint: '/api/eta/receipt/error', description: 'أخطاء' },
            { endpoint: '/api/eta/pos/expiry', description: 'انتهاء صلاحية POS' },
        ]
    };

    const getMethodColor = (method: string) => {
        switch (method) {
            case 'GET': return 'bg-emerald-100 text-emerald-700';
            case 'POST': return 'bg-blue-100 text-blue-700';
            case 'PUT': return 'bg-amber-100 text-amber-700';
            case 'DELETE': return 'bg-rose-100 text-rose-700';
            default: return 'bg-gray-100 text-gray-700';
        }
    };

    const renderApiList = (items: any[]) => (
        <div className="space-y-4">
            {items.map((api, idx) => (
                <div key={idx} className="bg-white border border-gray-100 rounded-2xl p-4 hover:shadow-md transition-all group">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                        <div className="flex items-center gap-3">
                            <span className={`px-2.5 py-1 rounded-md text-[10px] font-black uppercase tracking-wider ${getMethodColor(api.method)}`}>
                                {api.method}
                            </span>
                            <code className="text-sm font-bold text-slate-800 font-mono break-all">{api.endpoint}</code>
                        </div>
                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => copyToClipboard(api.endpoint, api.endpoint)}
                                className="p-2 hover:bg-gray-50 rounded-lg text-slate-400 hover:text-blue-600 transition-colors"
                            >
                                {copiedId === api.endpoint ? <Check size={16} className="text-emerald-500" /> : <Copy size={16} />}
                            </button>
                        </div>
                    </div>
                    <p className="mt-2 text-sm text-slate-500 font-medium" dir="rtl">{api.description}</p>
                </div>
            ))}
        </div>
    );

    const renderNestedApiList = (categories: any[]) => (
        <div className="space-y-8">
            {categories.map((cat, idx) => (
                <div key={idx} className="space-y-4">
                    <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                        <div className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                        {cat.category}
                    </h4>
                    {renderApiList(cat.items)}
                </div>
            ))}
        </div>
    );

    return (
        <div className="space-y-8 max-w-6xl mx-auto pb-20">
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
                <div className="space-y-1">
                    <div className="flex items-center gap-3 text-blue-600 mb-2">
                        <div className="p-2 bg-blue-50 rounded-xl">
                            <FileCode size={24} />
                        </div>
                        <span className="text-sm font-bold tracking-widest uppercase">API Documentation</span>
                    </div>
                    <h1 className="text-4xl font-black text-slate-900 tracking-tight">Egyptian ETA <span className="text-blue-600">Reference</span></h1>
                    <p className="text-slate-500 max-w-xl">Comprehensive guide for the Egyptian Tax Authority e-Invoicing and e-Receipt API integration.</p>
                </div>
                <div className="flex items-center gap-4 bg-emerald-50 border border-emerald-100 px-6 py-4 rounded-[32px]">
                    <div className="p-2 bg-emerald-500 rounded-full text-white">
                        <Globe size={18} />
                    </div>
                    <div>
                        <p className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider">SDK Reference</p>
                        <a href="https://sdk.invoicing.eta.gov.eg" target="_blank" rel="noreferrer" className="text-sm font-bold text-slate-800 hover:underline flex items-center gap-2">
                            sdk.invoicing.eta.gov.eg <ExternalLink size={14} />
                        </a>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
                {/* Navigation Sidebar */}
                <div className="lg:col-span-3 space-y-2 sticky top-6">
                    {sections.map(section => (
                        <button
                            key={section.id}
                            onClick={() => setActiveSection(section.id)}
                            className={`w-full flex items-center justify-between p-4 rounded-2xl transition-all ${activeSection === section.id
                                    ? 'bg-blue-600 text-white shadow-xl shadow-blue-200 translate-x-1'
                                    : 'bg-white text-slate-500 hover:bg-slate-50 border border-gray-100'
                                }`}
                        >
                            <div className="flex items-center gap-3">
                                {section.icon}
                                <span className="text-sm font-bold">{section.label}</span>
                            </div>
                            <ChevronRight size={16} className={activeSection === section.id ? 'opacity-100' : 'opacity-0'} />
                        </button>
                    ))}

                    <div className="mt-8 p-6 bg-slate-900 rounded-[32px] text-white relative overflow-hidden group">
                        <div className="absolute top-0 right-0 p-8 transform translate-x-4 -translate-y-4 opacity-10 group-hover:scale-110 transition-transform">
                            <Info size={120} />
                        </div>
                        <h5 className="text-xs font-bold text-blue-400 uppercase mb-4">Implementation Note</h5>
                        <p className="text-[11px] leading-relaxed text-slate-300">
                            Invoices are submitted in batches, not single documents. Always ensure your Callback APIs are ready to receive status updates.
                        </p>
                    </div>
                </div>

                {/* Content Area */}
                <div className="lg:col-span-9 bg-slate-50/50 border border-gray-100 rounded-[48px] p-8 md:p-12 shadow-sm min-h-[600px]">
                    {activeSection === 'auth' && (
                        <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-500">
                            <div className="flex items-center gap-4 mb-8">
                                <div className="w-12 h-12 bg-blue-100 rounded-2xl flex items-center justify-center text-blue-600">
                                    <Shield size={24} />
                                </div>
                                <div>
                                    <h2 className="text-2xl font-bold text-slate-800">Authentication & Identity</h2>
                                    <p className="text-sm text-slate-500">OAuth2 tokens required for all subsequent API calls.</p>
                                </div>
                            </div>
                            {renderApiList(apiData.auth)}
                        </div>
                    )}

                    {activeSection === 'shared' && (
                        <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-500">
                            <div className="flex items-center gap-4 mb-8">
                                <div className="w-12 h-12 bg-emerald-100 rounded-2xl flex items-center justify-center text-emerald-600">
                                    <Globe size={24} />
                                </div>
                                <div>
                                    <h2 className="text-2xl font-bold text-slate-800">Common / Shared APIs</h2>
                                    <p className="text-sm text-slate-500">APIs shared between e-Invoicing and e-Receipt systems.</p>
                                </div>
                            </div>
                            {renderApiList(apiData.shared)}
                        </div>
                    )}

                    {activeSection === 'invoice' && (
                        <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-500">
                            <div className="flex items-center gap-4 mb-8">
                                <div className="w-12 h-12 bg-blue-100 rounded-2xl flex items-center justify-center text-blue-600">
                                    <FileText size={24} />
                                </div>
                                <div>
                                    <h2 className="text-2xl font-bold text-slate-800">e-Invoicing APIs</h2>
                                    <p className="text-sm text-slate-500">For ERP, Oracle, Odoo, and SAP integrations.</p>
                                </div>
                            </div>
                            {renderNestedApiList(apiData.invoice)}
                        </div>
                    )}

                    {activeSection === 'receipt' && (
                        <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-500">
                            <div className="flex items-center gap-4 mb-8">
                                <div className="w-12 h-12 bg-rose-100 rounded-2xl flex items-center justify-center text-rose-600">
                                    <Send size={24} />
                                </div>
                                <div>
                                    <h2 className="text-2xl font-bold text-slate-800">e-Receipt APIs (POS)</h2>
                                    <p className="text-sm text-slate-500">For Retail, Supermarket, and POS systems.</p>
                                </div>
                            </div>
                            {renderNestedApiList(apiData.receipt)}
                        </div>
                    )}

                    {activeSection === 'codes' && (
                        <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-500">
                            <div className="flex items-center gap-4 mb-8">
                                <div className="w-12 h-12 bg-amber-100 rounded-2xl flex items-center justify-center text-amber-600">
                                    <Code size={24} />
                                </div>
                                <div>
                                    <h2 className="text-2xl font-bold text-slate-800">Code Tables</h2>
                                    <p className="text-sm text-slate-500">Vital reference tables for tax, units, and document types.</p>
                                </div>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {apiData.codes.map((code, idx) => (
                                    <div key={idx} className="bg-white border border-gray-100 p-4 rounded-2xl hover:border-amber-200 transition-colors">
                                        <h5 className="font-mono text-sm font-bold text-blue-600">{code.type}</h5>
                                        <p className="text-xs text-slate-500 mt-1" dir="rtl">{code.usage}</p>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {activeSection === 'callbacks' && (
                        <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-500">
                            <div className="flex items-center gap-4 mb-8">
                                <div className="w-12 h-12 bg-slate-100 rounded-2xl flex items-center justify-center text-slate-600">
                                    <ExternalLink size={24} />
                                </div>
                                <div>
                                    <h2 className="text-2xl font-bold text-slate-800">Internal ERP Callbacks</h2>
                                    <p className="text-sm text-slate-500">Endpoints you must implement to handle ETA notifications.</p>
                                </div>
                            </div>
                            <div className="space-y-4">
                                {apiData.callbacks.map((cb, idx) => (
                                    <div key={idx} className="bg-white border-l-4 border-l-blue-500 border-gray-100 p-4 rounded-r-2xl shadow-sm">
                                        <code className="text-sm font-bold text-slate-800">{cb.endpoint}</code>
                                        <p className="mt-2 text-xs text-slate-500" dir="rtl">{cb.description}</p>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Footer Notes */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="p-8 bg-blue-50/50 rounded-[32px] border border-blue-100 space-y-3">
                    <Package className="text-blue-600" />
                    <h4 className="font-bold text-slate-800">Bulk Operations</h4>
                    <p className="text-xs text-slate-600 leading-relaxed">System supports bulk submissions and ZIP package downloads for high-volume transactions.</p>
                </div>
                <div className="p-8 bg-emerald-50/50 rounded-[32px] border border-emerald-100 space-y-3">
                    <BookOpen className="text-emerald-600" />
                    <h4 className="font-bold text-slate-800">Full Validation</h4>
                    <p className="text-xs text-slate-600 leading-relaxed">Every document goes through strict schema and business rule validation before acceptance.</p>
                </div>
                <div className="p-8 bg-amber-50/50 rounded-[32px] border border-amber-100 space-y-3">
                    <AlertCircle className="text-amber-600" />
                    <h4 className="font-bold text-slate-800">Environment Shift</h4>
                    <p className="text-xs text-slate-600 leading-relaxed">Separate certificates and credentials are required for Pre-Production and Production environments.</p>
                </div>
            </div>
        </div>
    );
};

export default ETAReference;
