import React, { useState } from 'react';
import { Calendar, Search, ArrowRight, UploadCloud, Database, RefreshCw, CheckCircle2, AlertCircle, FileText, Filter } from 'lucide-react';
import ModernDialog from '../components/ModernDialog';

interface InvoiceSummary {
    id: string;
    internalId: string;
    date: string;
    customerName: string;
    totalAmount: number;
    status: 'pending' | 'ready' | 'submitted' | 'error';
    errorMessage?: string;
    submissionId?: string;
}

const ExportToETA: React.FC = () => {
    const [dateFrom, setDateFrom] = useState('');
    const [dateTo, setDateTo] = useState('');
    const [isFetching, setIsFetching] = useState(false);
    const [invoices, setInvoices] = useState<InvoiceSummary[]>([]);
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Dialog State
    const [dialogOpen, setDialogOpen] = useState(false);
    const [dialogType, setDialogType] = useState<'success' | 'error' | 'info'>('info');
    const [dialogTitle, setDialogTitle] = useState('');
    const [dialogMessage, setDialogMessage] = useState('');

    const handleFetch = async () => {
        if (!dateFrom || !dateTo) {
            setDialogType('error');
            setDialogTitle('Missing Dates');
            setDialogMessage('Please select both "From" and "To" dates to fetch invoices.');
            setDialogOpen(true);
            return;
        }

        setIsFetching(true);
        setInvoices([]); // Clear previous

        try {
            // Simulate API call to fetch from DB configured in settings
            // In real implementation: await fetch(`/api/erp/pull?from=${dateFrom}&to=${dateTo}`);

            await new Promise(resolve => setTimeout(resolve, 1500)); // Fake delay

            // Mock Data
            const mockData: InvoiceSummary[] = Array.from({ length: 5 }).map((_, i) => ({
                id: `INV-${Date.now()}-${i}`,
                internalId: `ERP-2024-${1000 + i}`,
                date: dateFrom,
                customerName: `Customer ${String.fromCharCode(65 + i)} Ltd`,
                totalAmount: Math.floor(Math.random() * 50000) + 1000,
                status: 'ready',
            }));

            setInvoices(mockData);

        } catch (error: any) {
            setDialogType('error');
            setDialogTitle('Fetch Failed');
            setDialogMessage(error.message || 'Failed to connect to the database. Please check your Connection Settings.');
            setDialogOpen(true);
        } finally {
            setIsFetching(false);
        }
    };

    const handleSubmit = async () => {
        if (selectedIds.length === 0) return;

        setIsSubmitting(true);
        try {
            // Simulate submission loop
            for (const id of selectedIds) {
                await new Promise(resolve => setTimeout(resolve, 800)); // Simulate processing per invoice
                setInvoices(prev => prev.map(inv =>
                    inv.id === id ? { ...inv, status: 'submitted', submissionId: `UUID-${Math.random().toString(36).substr(2, 9)}` } : inv
                ));
            }

            setDialogType('success');
            setDialogTitle('Submission Complete');
            setDialogMessage(`Successfully submitted ${selectedIds.length} invoices to ETA.`);
            setDialogOpen(true);
            setSelectedIds([]);

        } catch (error) {
            setDialogType('error');
            setDialogTitle('Submission Error');
            setDialogMessage('An error occurred during bulk submission.');
            setDialogOpen(true);
        } finally {
            setIsSubmitting(false);
        }
    };

    const toggleSelectAll = () => {
        if (selectedIds.length === invoices.length) {
            setSelectedIds([]);
        } else {
            setSelectedIds(invoices.map(inv => inv.id));
        }
    };

    const toggleSelect = (id: string) => {
        if (selectedIds.includes(id)) {
            setSelectedIds(selectedIds.filter(i => i !== id));
        } else {
            setSelectedIds([...selectedIds, id]);
        }
    };

    return (
        <div className="p-6 max-w-7xl mx-auto space-y-6">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
                        <UploadCloud className="text-blue-600" /> Export to ETA
                    </h1>
                    <p className="text-slate-500">Pull invoices from your connected database and submit them to Tax Authority</p>
                </div>
            </div>

            {/* Control Panel */}
            <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-200">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-6 items-end">
                    <div className="space-y-2">
                        <label className="text-sm font-bold text-slate-600 flex items-center gap-2">
                            <Calendar size={16} /> From Date
                        </label>
                        <input
                            type="date"
                            value={dateFrom}
                            onChange={(e) => setDateFrom(e.target.value)}
                            className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-blue-500 transition-all font-medium text-slate-700"
                        />
                    </div>
                    <div className="space-y-2">
                        <label className="text-sm font-bold text-slate-600 flex items-center gap-2">
                            <Calendar size={16} /> To Date
                        </label>
                        <input
                            type="date"
                            value={dateTo}
                            onChange={(e) => setDateTo(e.target.value)}
                            className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-blue-500 transition-all font-medium text-slate-700"
                        />
                    </div>
                    <div className="space-y-2">
                        <label className="text-sm font-bold text-slate-600 flex items-center gap-2">
                            <Database size={16} /> Source
                        </label>
                        <div className="w-full bg-blue-50 border border-blue-100 text-blue-700 rounded-xl px-4 py-2.5 font-medium text-sm flex items-center gap-2">
                            <CheckCircle2 size={16} /> Configured DB
                        </div>
                    </div>
                    <button
                        onClick={handleFetch}
                        disabled={isFetching}
                        className={`h-[46px] w-full rounded-xl font-bold text-white flex items-center justify-center gap-2 shadow-lg transition-all ${isFetching ? 'bg-slate-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700 hover:shadow-blue-200'
                            }`}
                    >
                        {isFetching ? (
                            <>
                                <RefreshCw className="animate-spin" size={18} /> Pulling Data...
                            </>
                        ) : (
                            <>
                                <Search size={18} /> Fetch Invoices
                            </>
                        )}
                    </button>
                </div>
            </div>

            {/* Results Area */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden min-h-[400px] flex flex-col">
                {/* Toolbar */}
                {invoices.length > 0 && (
                    <div className="p-4 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
                        <div className="flex items-center gap-4">
                            <div className="flex items-center gap-2">
                                <input
                                    type="checkbox"
                                    checked={selectedIds.length === invoices.length && invoices.length > 0}
                                    onChange={toggleSelectAll}
                                    className="w-5 h-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                                />
                                <span className="text-sm font-semibold text-slate-600">{selectedIds.length} Selected</span>
                            </div>
                            <div className="h-4 w-px bg-gray-300 mx-2" />
                            <div className="flex items-center gap-2 text-sm text-slate-500">
                                <Filter size={14} />
                                <span>Total: <span className="font-bold text-slate-800">{invoices.length}</span></span>
                            </div>
                        </div>

                        <button
                            onClick={handleSubmit}
                            disabled={selectedIds.length === 0 || isSubmitting}
                            className={`px-6 py-2 rounded-xl font-bold text-sm flex items-center gap-2 transition-all ${selectedIds.length === 0
                                    ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                                    : 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-md shadow-emerald-100'
                                }`}
                        >
                            {isSubmitting ? <RefreshCw className="animate-spin" size={16} /> : <UploadCloud size={16} />}
                            Submit Selected to ETA
                        </button>
                    </div>
                )}

                {/* Empty State */}
                {invoices.length === 0 && !isFetching && (
                    <div className="flex-1 flex flex-col items-center justify-center text-slate-400 p-12">
                        <div className="w-24 h-24 bg-gray-50 rounded-full flex items-center justify-center mb-4">
                            <FileText size={48} className="text-gray-300" />
                        </div>
                        <h3 className="text-lg font-bold text-slate-600">No Invoices Fetched</h3>
                        <p className="text-sm">Select dates above and click Fetch to pull data.</p>
                    </div>
                )}

                {/* Data Table */}
                {invoices.length > 0 && (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left">
                            <thead className="bg-gray-50 text-slate-500 text-xs uppercase font-bold tracking-wider">
                                <tr>
                                    <th className="w-12 p-4"></th>
                                    <th className="p-4">Internal ID</th>
                                    <th className="p-4">Date</th>
                                    <th className="p-4">Customer</th>
                                    <th className="p-4 text-right">Amount (EGP)</th>
                                    <th className="p-4 text-center">Status</th>
                                    <th className="p-4 text-center">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {invoices.map((inv) => (
                                    <tr key={inv.id} className="hover:bg-blue-50/30 transition-colors">
                                        <td className="p-4">
                                            <input
                                                type="checkbox"
                                                checked={selectedIds.includes(inv.id)}
                                                onChange={() => toggleSelect(inv.id)}
                                                disabled={inv.status === 'submitted'}
                                                className="w-5 h-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                                            />
                                        </td>
                                        <td className="p-4 font-mono font-medium text-slate-700">{inv.internalId}</td>
                                        <td className="p-4 text-slate-600">{inv.date}</td>
                                        <td className="p-4 font-medium text-slate-800">{inv.customerName}</td>
                                        <td className="p-4 text-right font-mono font-bold text-slate-700">
                                            {inv.totalAmount.toLocaleString('en-EG', { style: 'currency', currency: 'EGP' })}
                                        </td>
                                        <td className="p-4 text-center">
                                            {inv.status === 'ready' && <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-700">Ready</span>}
                                            {inv.status === 'submitted' && <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-700"><CheckCircle2 size={12} /> Submitted</span>}
                                            {inv.status === 'error' && <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-red-100 text-red-700"><AlertCircle size={12} /> Error</span>}
                                        </td>
                                        <td className="p-4 text-center">
                                            {inv.submissionId ? (
                                                <span className="text-xs font-mono text-emerald-600">{inv.submissionId}</span>
                                            ) : (
                                                <span className="text-xs text-gray-400">-</span>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            <ModernDialog
                isOpen={dialogOpen}
                type={dialogType}
                title={dialogTitle}
                message={dialogMessage}
                onCancel={() => setDialogOpen(false)}
                onConfirm={() => setDialogOpen(false)}
            />
        </div>
    );
};

export default ExportToETA;
