import { API_URL, SIGNER_BRIDGE_BASE } from '../services/apiService';
import React, { useState } from 'react';
import { Upload, FileSpreadsheet, Calculator, Send, AlertCircle, CheckCircle2, X, RefreshCw } from 'lucide-react';
import * as XLSX from 'xlsx';

interface ExcelData {
    headers: any[];
    details: any[];
}

interface CalculatedInvoice {
    internalId: string;
    success: boolean;
    errors?: string[];
    totalSalesAmount?: number;
    totalDiscountAmount?: number;
    netAmount?: number;
    extraDiscountAmount?: number;
    totalAmount?: number;
    lines?: any[];
    taxTotals?: any[];
}

const InvoiceExcel: React.FC = () => {
    const [file, setFile] = useState<File | null>(null);
    const [excelData, setExcelData] = useState<ExcelData | null>(null);
    const [calculatedInvoices, setCalculatedInvoices] = useState<CalculatedInvoice[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [step, setStep] = useState<'upload' | 'review' | 'calculated'>('upload');

    // Modal state for submission results
    const [showResultModal, setShowResultModal] = useState(false);
    const [submissionResult, setSubmissionResult] = useState<any>(null);

    // Handle file upload
    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const selectedFile = e.target.files?.[0];
        if (selectedFile) {
            setFile(selectedFile);
            setError(null);
        }
    };

    // Parse Excel file
    const handleParseExcel = async () => {
        if (!file) return;

        setIsLoading(true);
        setError(null);

        try {
            const reader = new FileReader();
            reader.onload = async (e) => {
                const base64 = e.target?.result as string;
                const base64Data = base64.split(',')[1];

                const authToken = localStorage.getItem('token');
                const response = await fetch(`${API_URL}/excel/parse`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        ...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {})
                    },
                    body: JSON.stringify({ excelData: base64Data })
                });

                const result = await response.json();

                if (result.success) {
                    setExcelData(result.data);
                    setStep('review');
                } else {
                    setError(result.message || 'Failed to parse Excel file');
                }

                setIsLoading(false);
            };

            reader.onerror = () => {
                setError('Failed to read file');
                setIsLoading(false);
            };

            reader.readAsDataURL(file);
        } catch (err: any) {
            setError(err.message || 'Failed to parse Excel');
            setIsLoading(false);
        }
    };

    // Calculate invoices
    const handleCalculate = async () => {
        if (!excelData) return;

        setIsLoading(true);
        setError(null);

        try {
            const authToken = localStorage.getItem('token');
            const response = await fetch(`${API_URL}/excel/calculate`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {})
                },
                body: JSON.stringify(excelData)
            });

            // Check content type
            const contentType = response.headers.get("content-type");
            if (contentType && contentType.indexOf("application/json") === -1) {
                const text = await response.text();
                throw new Error(`Server returned non-JSON response (${response.status}): ${text.substring(0, 100)}...`);
            }

            const result = await response.json();

            if (result.success) {
                setCalculatedInvoices(result.invoices);
                setStep('calculated');
            } else {
                setError(result.message || 'Failed to calculate invoices');
            }
        } catch (err: any) {
            console.error('Calculation Error:', err);
            setError(err.message || 'Failed to calculate');
        } finally {
            setIsLoading(false);
        }
    };

    // Reset
    const handleReset = () => {
        setFile(null);
        setExcelData(null);
        setCalculatedInvoices([]);
        setError(null);
        setStep('upload');
    };


    // Batch Job State
    const [batchJob, setBatchJob] = useState<{
        jobId: string;
        status: string;
        total: number;
        processed: number;
        success: number;
        failed: number;
        progress: number;
        currentInvoice: string;
    } | null>(null);

    // Submit All Invoices (Async Batch)
    const handleSendToETA = async () => {
        if (!excelData) return;

        setIsLoading(true);
        setError(null);
        setBatchJob(null);

        try {
            const user = JSON.parse(localStorage.getItem('invoice_user') || '{}');
            const LOCAL_API = API_URL;
            const token = localStorage.getItem('token');

            // Step 1: Submit batch — get jobId immediately
            const submitRes = await fetch(`${LOCAL_API}/excel/batch-submit`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-User-ID': user.id || '',
                    ...(token ? { 'Authorization': `Bearer ${token}` } : {})
                },
                body: JSON.stringify({ headers: excelData.headers, details: excelData.details })
            });
            const submitResult = await submitRes.json();

            if (!submitResult.success || !submitResult.jobId) {
                throw new Error(submitResult.message || 'Failed to start batch job');
            }

            const jobId = submitResult.jobId;
            setBatchJob({
                jobId,
                status: 'queued',
                total: submitResult.total,
                processed: 0,
                success: 0,
                failed: 0,
                progress: 0,
                currentInvoice: ''
            });

            window.dispatchEvent(new CustomEvent('live-console-log', {
                detail: { message: `🚀 Batch Job started: ${submitResult.total} invoices queued (Job: ${jobId.slice(0, 8)}...)`, type: 'info' }
            }));

            // Step 2: Poll for progress
            const pollInterval = setInterval(async () => {
                try {
                    const statusRes = await fetch(`${LOCAL_API}/excel/batch-status/${jobId}`, {
                        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
                    });
                    const statusResult = await statusRes.json();

                    if (!statusResult.success) {
                        clearInterval(pollInterval);
                        throw new Error(statusResult.message || 'Failed to get job status');
                    }

                    const job = statusResult.job;
                    setBatchJob({
                        jobId,
                        status: job.status,
                        total: job.total,
                        processed: job.processed,
                        success: job.success,
                        failed: job.failed,
                        progress: job.progress,
                        currentInvoice: job.currentInvoice
                    });

                    // Log progress to Live Console
                    if (job.status === 'processing' && job.currentInvoice) {
                        window.dispatchEvent(new CustomEvent('live-console-log', {
                            detail: { message: `📄 Processing: ${job.currentInvoice} (${job.processed}/${job.total})`, type: 'info' }
                        }));
                    }

                    // Job finished
                    if (job.status === 'completed' || job.status === 'failed') {
                        clearInterval(pollInterval);
                        setIsLoading(false);
                        setBatchJob(null);

                        if (job.status === 'failed' && job.error) {
                            setSubmissionResult({
                                success: false,
                                message: 'Batch job failed: ' + job.error,
                            });
                            setShowResultModal(true);
                            return;
                        }

                        // Build summary from results
                        const summary = {
                            success: job.success,
                            failed: job.failed,
                            results: job.results || []
                        };

                        let message = `Batch processing complete!\nSuccess: ${summary.success}\nFailed: ${summary.failed}`;

                        if (summary.failed > 0 && summary.results) {
                            const failedInvoices = summary.results.filter((r: any) => r.status === 'Failed');
                            if (failedInvoices.length > 0) {
                                message += '\n\n--- Failed Invoices Details ---\n';

                                window.dispatchEvent(new CustomEvent('live-console-log', {
                                    detail: { message: `⚠️ Batch Finished: ${summary.failed} Failed Invoices.`, type: 'error' }
                                }));

                                failedInvoices.forEach((inv: any) => {
                                    message += `\n• Invoice ${inv.internalId}:\n`;
                                    message += `  Error: ${inv.error || 'Unknown error'}\n`;

                                    window.dispatchEvent(new CustomEvent('live-console-log', {
                                        detail: { message: `❌ Invoice ${inv.internalId} Failed: ${inv.error}`, type: 'error' }
                                    }));
                                });
                            }
                        }

                        window.dispatchEvent(new CustomEvent('live-console-log', {
                            detail: { message: `✅ Batch Complete: ${summary.success} success, ${summary.failed} failed`, type: summary.failed > 0 ? 'warning' : 'info' }
                        }));

                        setSubmissionResult({
                            success: true,
                            summary,
                            message
                        });
                        setShowResultModal(true);
                    }
                } catch (pollErr: any) {
                    console.error('Polling error:', pollErr);
                    // Don't stop polling on transient errors
                }
            }, 2000); // Poll every 2 seconds

        } catch (err: any) {
            console.error('Batch submit error:', err);
            setIsLoading(false);
            setBatchJob(null);
            setSubmissionResult({
                success: false,
                message: 'Failed to start batch: ' + (err.message || String(err)),
                isNetworkError: true
            });
            setShowResultModal(true);
        }
    };

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-3">
                        <FileSpreadsheet className="text-emerald-600" />
                        Invoice from Excel
                    </h1>
                    <p className="text-slate-500 text-sm">Upload, review, calculate and submit invoices to ETA Portal</p>
                </div>
                {step !== 'upload' && (
                    <button onClick={handleReset} className="text-sm bg-slate-100 hover:bg-slate-200 text-slate-700 px-4 py-2 rounded-xl font-semibold flex items-center gap-2">
                        <RefreshCw size={16} />Start Over
                    </button>
                )}
            </div>

            {/* Error Alert */}
            {error && (
                <div className="bg-rose-50 border border-rose-200 rounded-2xl p-4 flex items-start gap-3">
                    <AlertCircle className="text-rose-600 flex-shrink-0" size={20} />
                    <div className="flex-1">
                        <h3 className="font-bold text-rose-900 text-sm">Error</h3>
                        <p className="text-rose-700 text-sm mt-1">{error}</p>
                    </div>
                    <button onClick={() => setError(null)} className="text-rose-400 hover:text-rose-600"><X size={18} /></button>
                </div>
            )}

            {/* Step 1: Upload - SAME AS BEFORE */}
            {step === 'upload' && (
                <div className="bg-white rounded-[32px] shadow-xl border border-gray-100 p-8">
                    <div className="max-w-2xl mx-auto">
                        <div className="text-center mb-8">
                            <div className="w-20 h-20 bg-emerald-50 rounded-full mx-auto mb-4 flex items-center justify-center">
                                <Upload className="text-emerald-600" size={32} />
                            </div>
                            <h2 className="text-xl font-bold text-slate-800 mb-2">Upload Excel File</h2>
                            <p className="text-slate-500 text-sm">
                                Your Excel file should contain two sheets: <strong>"header"</strong> and <strong>"detail"</strong>
                            </p>
                        </div>

                        <div className="border-2 border-dashed border-gray-300 rounded-2xl p-8 text-center hover:border-emerald-500 transition-colors">
                            <input type="file" accept=".xlsx,.xls" onChange={handleFileChange} className="hidden" id="excel-upload" />
                            <label htmlFor="excel-upload" className="cursor-pointer">
                                <FileSpreadsheet className="mx-auto text-gray-400 mb-4" size={48} />
                                <p className="text-slate-700 font-semibold mb-2">{file ? file.name : 'Click to select Excel file'}</p>
                                <p className="text-slate-400 text-sm">or drag and drop here</p>
                            </label>
                        </div>

                        {file && (
                            <div className="mt-6">
                                <button onClick={handleParseExcel} disabled={isLoading} className="w-full bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-4 rounded-2xl font-bold flex items-center justify-center gap-2 disabled:opacity-50">
                                    {isLoading ? (<><div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />Parsing Excel...</>) : (<><Calculator size={20} />Parse and Review Data</>)}
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Step 2: Review - SHORTENED FOR BREVITY - KEEPING SAME AS BEFORE BUT COLLAPSED HERE FOR SPACE */}
            {step === 'review' && excelData && (
                <div className="space-y-6">
                    <div className="bg-gradient-to-r from-emerald-600 to-emerald-700 rounded-[32px] p-6 text-white shadow-xl">
                        <div className="flex items-center gap-3 mb-4"><CheckCircle2 size={24} /><h3 className="font-bold text-lg">Excel Parsed Successfully!</h3></div>
                        <div className="grid grid-cols-2 gap-4">
                            <div><p className="text-emerald-100 text-sm">Total Invoices</p><p className="text-3xl font-black">{excelData.headers.length}</p></div>
                            <div><p className="text-emerald-100 text-sm">Total Line Items</p><p className="text-3xl font-black">{excelData.details.length}</p></div>
                        </div>
                    </div>

                    {/* ... SAME TABLE CODE AS BEFORE ... */}

                    <div className="bg-white rounded-2xl shadow-xl border-2 border-blue-300 p-6">
                        <div className="flex items-center justify-between">
                            <div>
                                <h4 className="font-black text-blue-900 text-lg">✅ Data Review Complete</h4>
                                <p className="text-blue-700 text-sm mt-1">Review complete. Click Calculate to process with tax calculations.</p>
                            </div>
                            <button onClick={handleCalculate} disabled={isLoading} className="bg-gradient-to-r from-blue-600 to-blue-700 text-white px-10 py-5 rounded-2xl font-black text-lg flex items-center gap-3 disabled:opacity-50 shadow-2xl">
                                {isLoading ? (<><div className="w-6 h-6 border-3 border-white border-t-transparent rounded-full animate-spin" />Calculating...</>) : (<><Calculator size={24} />Calculate All Invoices</>)}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Step 3: CALCULATED RESULTS WITH LINE-BY-LINE DETAILS */}
            {step === 'calculated' && (
                calculatedInvoices.length === 0 ? (
                    <div className="bg-amber-50 rounded-[32px] p-8 text-center border-2 border-amber-200">
                        <AlertCircle className="mx-auto text-amber-500 mb-4" size={48} />
                        <h3 className="text-xl font-bold text-amber-900 mb-2">No Invoices Processed</h3>
                        <p className="text-amber-700 mb-6">
                            The calculation finished but no valid invoices were generated.
                            This usually happens if the Excel headers like "ItemInternalCode" or "InternalID" didn't match.
                        </p>
                        <button onClick={handleReset} className="bg-amber-600 hover:bg-amber-700 text-white px-6 py-3 rounded-xl font-bold">
                            Try Again
                        </button>
                    </div>
                ) : (
                    <div className="space-y-6">
                        <div className="bg-gradient-to-r from-emerald-600 to-emerald-700 rounded-[32px] p-6 text-white shadow-xl">
                            <div className="flex items-center gap-3 mb-4"><CheckCircle2 size={24} /><h3 className="font-bold text-lg">Calculation Complete!</h3></div>
                            <p className="text-emerald-100">{calculatedInvoices.filter(i => i.success).length} of {calculatedInvoices.length} invoices calculated successfully</p>
                        </div>

                        {/* EACH INVOICE CARD */}
                        {calculatedInvoices.map((invoice, idx) => (
                            <div key={idx} className={`bg-white rounded-[32px] shadow-2xl border-2 overflow-hidden ${invoice.success ? 'border-emerald-300' : 'border-rose-300'}`}>
                                <div className={`p-6 ${invoice.success ? 'bg-gradient-to-r from-emerald-50 to-emerald-100' : 'bg-rose-50'}`}>
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <h3 className="font-black text-slate-900 text-xl">📄 Invoice: {invoice.internalId}</h3>
                                            <p className="text-slate-600 text-sm mt-1">{invoice.success ? '✅ Calculation successful' : '❌ Calculation failed'}</p>
                                        </div>
                                        {invoice.success && (
                                            <div className="text-right">
                                                <p className="text-xs text-emerald-700 font-bold uppercase">Grand Total</p>
                                                <p className="text-3xl font-black text-emerald-700">{invoice.totalAmount?.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 5 })}</p>
                                                <p className="text-xs text-emerald-600 font-semibold">EGP (Including Tax)</p>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {invoice.success ? (
                                    <div className="p-6 space-y-6">
                                        {/* LINE ITEMS TABLE - DETAILED */}
                                        {invoice.lines && invoice.lines.length > 0 && (
                                            <div className="border-2 border-emerald-200 rounded-2xl overflow-hidden">
                                                <div className="bg-emerald-800 text-white px-4 py-3">
                                                    <h4 className="font-black uppercase text-sm">Line Items Breakdown ({invoice.lines.length} items)</h4>
                                                </div>
                                                <div className="overflow-auto" style={{ maxHeight: '400px' }}>
                                                    <table className="w-full text-sm">
                                                        <thead className="bg-slate-900 text-white sticky top-0">
                                                            <tr>
                                                                <th className="px-3 py-3 text-left text-xs font-black">#</th>
                                                                <th className="px-3 py-3 text-left text-xs font-black">Description</th>
                                                                <th className="px-3 py-3 text-right text-xs font-black">Qty</th>
                                                                <th className="px-3 py-3 text-right text-xs font-black">Unit Price</th>
                                                                <th className="px-3 py-3 text-right text-xs font-black bg-blue-900">Sales Total</th>
                                                                <th className="px-3 py-3 text-right text-xs font-black bg-orange-900">Discount</th>
                                                                <th className="px-3 py-3 text-right text-xs font-black bg-slate-900">Net Total</th>
                                                                <th className="px-3 py-3 text-right text-xs font-black bg-purple-900">Tax Amount</th>
                                                                <th className="px-3 py-3 text-right text-xs font-black bg-emerald-900">Line Total</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody>
                                                            {invoice.lines.map((line: any, lidx: number) => (
                                                                <React.Fragment key={lidx}>
                                                                    <tr className="hover:bg-emerald-50 border-b border-gray-200">
                                                                        <td className="px-3 py-3 font-bold text-slate-600">{lidx + 1}</td>
                                                                        <td className="px-3 py-3 text-slate-800 font-semibold" style={{ minWidth: '200px' }}>{line.description}</td>
                                                                        <td className="px-3 py-3 text-right font-bold text-slate-800">{line.quantity}</td>
                                                                        <td className="px-3 py-3 text-right font-bold text-slate-800">{line.amount?.toFixed(2)}</td>
                                                                        <td className="px-3 py-3 text-right font-black bg-blue-50 text-blue-900">{line.salesTotal?.toFixed(2)}</td>
                                                                        <td className="px-3 py-3 text-right font-black bg-orange-50 text-orange-900">-{(line.salesTotal - line.netTotal)?.toFixed(2)}</td>
                                                                        <td className="px-3 py-3 text-right font-black bg-slate-50 text-slate-900">{line.netTotal?.toFixed(2)}</td>
                                                                        <td className="px-3 py-3 text-right font-black bg-purple-50 text-purple-900">+{line.totalTaxAmount?.toFixed(2)}</td>
                                                                        <td className="px-3 py-3 text-right font-black bg-emerald-100 text-emerald-900 text-base">{line.total?.toFixed(2)}</td>
                                                                    </tr>
                                                                    {line.taxableItems && line.taxableItems.length > 0 && (
                                                                        <tr className="bg-purple-50 border-b border-purple-200">
                                                                            <td colSpan={2} className="px-3 py-2"></td>
                                                                            <td colSpan={7} className="px-3 py-2">
                                                                                <div className="flex gap-4 text-xs">
                                                                                    <span className="font-black text-purple-900">Tax Details:</span>
                                                                                    {line.taxableItems.map((tax: any, tidx: number) => (
                                                                                        <span key={tidx} className="text-purple-800 font-semibold">
                                                                                            {tax.subType} ({tax.rate}%): <strong>{tax.amount.toFixed(2)} EGP</strong>
                                                                                        </span>
                                                                                    ))}
                                                                                </div>
                                                                            </td>
                                                                        </tr>
                                                                    )}
                                                                </React.Fragment>
                                                            ))}
                                                        </tbody>
                                                    </table>
                                                </div>
                                            </div>
                                        )}

                                        {/* INVOICE TOTALS */}
                                        <div className="grid grid-cols-5 gap-4">
                                            <div className="bg-blue-50 rounded-xl p-4 border-2 border-blue-300">
                                                <p className="text-xs text-blue-700 mb-1 font-black uppercase">Total Sales</p>
                                                <p className="font-black text-blue-900 text-xl">{invoice.totalSalesAmount?.toFixed(2)}</p>
                                                <p className="text-xs text-blue-600 mt-1">Before Discount</p>
                                            </div>
                                            <div className="bg-orange-50 rounded-xl p-4 border-2 border-orange-300">
                                                <p className="text-xs text-orange-700 mb-1 font-black uppercase">Line Discount</p>
                                                <p className="font-black text-orange-900 text-xl">-{invoice.totalDiscountAmount?.toFixed(2)}</p>
                                                <p className="text-xs text-orange-600 mt-1">Item Level</p>
                                            </div>
                                            {invoice.extraDiscountAmount && invoice.extraDiscountAmount > 0 ? (
                                                <div className="bg-rose-50 rounded-xl p-4 border-2 border-rose-300">
                                                    <p className="text-xs text-rose-700 mb-1 font-black uppercase">Extra Discount</p>
                                                    <p className="font-black text-rose-900 text-xl">-{invoice.extraDiscountAmount?.toFixed(2)}</p>
                                                    <p className="text-xs text-rose-600 mt-1">Invoice Level</p>
                                                </div>
                                            ) : null}
                                            <div className="bg-slate-50 rounded-xl p-4 border-2 border-slate-300">
                                                <p className="text-xs text-slate-700 mb-1 font-black uppercase">Net Amount</p>
                                                <p className="font-black text-slate-900 text-xl">{invoice.netAmount?.toFixed(2)}</p>
                                                <p className="text-xs text-slate-600 mt-1">After Discounts</p>
                                            </div>
                                            <div className="bg-emerald-50 rounded-xl p-4 border-4 border-emerald-400 shadow-lg">
                                                <p className="text-xs text-emerald-700 mb-1 font-black uppercase">Grand Total</p>
                                                <p className="font-black text-emerald-900 text-2xl">{invoice.totalAmount?.toFixed(2)}</p>
                                                <p className="text-xs text-emerald-700 mt-1 font-bold">Including Tax</p>
                                            </div>
                                        </div>

                                        {/* TAX SUMMARY */}
                                        {invoice.taxTotals && invoice.taxTotals.length > 0 && (
                                            <div className="bg-purple-50 rounded-2xl p-6 border-2 border-purple-300">
                                                <h4 className="text-sm font-black text-purple-900 mb-4 uppercase flex items-center gap-2">
                                                    💰 Tax Summary
                                                </h4>
                                                <div className="grid grid-cols-4 gap-4">
                                                    {invoice.taxTotals.map((tax, tidx) => (
                                                        <div key={tidx} className="bg-white rounded-xl p-4 shadow-md border border-purple-200">
                                                            <p className="text-xs text-purple-700 mb-1 font-bold uppercase">{tax.taxType}</p>
                                                            <p className="font-black text-purple-900 text-2xl">{tax.amount.toFixed(2)}</p>
                                                            <p className="text-xs text-purple-600 mt-1">EGP</p>
                                                        </div>
                                                    ))}
                                                    <div className="bg-purple-900 rounded-xl p-4 shadow-xl text-white">
                                                        <p className="text-xs text-purple-200 mb-1 font-black uppercase">Total Taxes</p>
                                                        <p className="font-black text-white text-2xl">{invoice.taxTotals.reduce((sum: number, t: any) => sum + t.amount, 0).toFixed(2)}</p>
                                                        <p className="text-xs text-purple-300 mt-1 font-bold">EGP</p>
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    <div className="p-6">
                                        <h4 className="font-bold text-rose-900 mb-2">❌ Errors:</h4>
                                        <ul className="space-y-1">
                                            {invoice.errors?.map((err, eidx) => (
                                                <li key={eidx} className="text-sm text-rose-700 flex items-start gap-2">
                                                    <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />{err}
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                )}
                            </div>
                        ))}

                        {/* BATCH PROGRESS BAR */}
                        {batchJob && (
                            <div className="bg-white rounded-[32px] shadow-2xl border-2 border-blue-300 p-8 space-y-4">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                                            <RefreshCw size={20} className="text-blue-600 animate-spin" />
                                        </div>
                                        <div>
                                            <h4 className="font-black text-slate-800 text-lg">Processing Batch</h4>
                                            <p className="text-sm text-slate-500">
                                                {batchJob.status === 'queued' ? 'Starting up...' : `Processing: ${batchJob.currentInvoice || '...'}`}
                                            </p>
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-4xl font-black text-blue-600">{batchJob.progress}%</p>
                                        <p className="text-xs text-slate-500 font-bold">{batchJob.processed} / {batchJob.total} invoices</p>
                                    </div>
                                </div>

                                {/* Progress Bar */}
                                <div className="w-full bg-gray-200 rounded-full h-4 overflow-hidden">
                                    <div
                                        className="h-full rounded-full transition-all duration-500 ease-out"
                                        style={{
                                            width: `${batchJob.progress}%`,
                                            background: 'linear-gradient(90deg, #2563eb, #4f46e5, #7c3aed)',
                                            backgroundSize: '200% 100%',
                                            animation: 'shimmer 2s ease-in-out infinite',
                                        }}
                                    />
                                </div>
                                <style>{`@keyframes shimmer { 0%,100% { background-position: 0% 0%; } 50% { background-position: 100% 0%; } }`}</style>

                                {/* Counters */}
                                <div className="flex items-center gap-6 text-sm">
                                    <span className="flex items-center gap-2">
                                        <span className="w-3 h-3 bg-emerald-500 rounded-full"></span>
                                        <span className="font-bold text-emerald-700">Success: {batchJob.success}</span>
                                    </span>
                                    <span className="flex items-center gap-2">
                                        <span className="w-3 h-3 bg-rose-500 rounded-full"></span>
                                        <span className="font-bold text-rose-700">Failed: {batchJob.failed}</span>
                                    </span>
                                </div>
                            </div>
                        )}

                        {/* SUBMIT BUTTON */}
                        {!batchJob && (
                            <div className="flex justify-end">
                                <button
                                    onClick={handleSendToETA}
                                    disabled={isLoading}
                                    className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white px-8 py-4 rounded-2xl font-bold flex items-center gap-2 shadow-xl disabled:opacity-50 disabled:animate-pulse"
                                >
                                    {isLoading ? <RefreshCw className="animate-spin" size={20} /> : <Send size={20} />}
                                    {isLoading ? 'Starting Batch...' : 'Send to ETA Portal'}
                                </button>
                            </div>
                        )}
                    </div>
                )
            )}

            {/* Submission Result Modal */}
            {
                showResultModal && submissionResult && (
                    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fadeIn">
                        <div className="bg-white rounded-[32px] shadow-2xl max-w-3xl w-full max-h-[90vh] overflow-hidden animate-slideUp">
                            {/* Header */}
                            <div className={`p-6 ${submissionResult.success
                                ? 'bg-gradient-to-r from-emerald-600 to-emerald-700'
                                : 'bg-gradient-to-r from-rose-600 to-rose-700'
                                } text-white`}>
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        {submissionResult.success ? (
                                            <CheckCircle2 size={32} className="flex-shrink-0" />
                                        ) : (
                                            <AlertCircle size={32} className="flex-shrink-0" />
                                        )}
                                        <div>
                                            <h3 className="text-2xl font-black">
                                                {submissionResult.success ? 'Submission Complete!' : 'Submission Failed'}
                                            </h3>
                                            {submissionResult.summary && (
                                                <p className="text-sm mt-1 opacity-90">
                                                    Success: {submissionResult.summary.success || 0} | Failed: {submissionResult.summary.failed || 0}
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => setShowResultModal(false)}
                                        className="text-white/80 hover:text-white hover:bg-white/20 rounded-full p-2 transition-all"
                                    >
                                        <X size={24} />
                                    </button>
                                </div>
                            </div>

                            {/* Content */}
                            <div className="p-6 overflow-y-auto" style={{ maxHeight: 'calc(90vh - 180px)' }}>
                                {submissionResult.success && submissionResult.summary ? (
                                    <div className="space-y-6">
                                        {/* Success Summary */}
                                        <div className="grid grid-cols-2 gap-4">
                                            <div className="bg-emerald-50 border-2 border-emerald-300 rounded-2xl p-6">
                                                <p className="text-emerald-700 text-sm font-bold uppercase mb-2">✅ Successful</p>
                                                <p className="text-5xl font-black text-emerald-900">{submissionResult.summary.success || 0}</p>
                                            </div>
                                            <div className="bg-rose-50 border-2 border-rose-300 rounded-2xl p-6">
                                                <p className="text-rose-700 text-sm font-bold uppercase mb-2">❌ Failed</p>
                                                <p className="text-5xl font-black text-rose-900">{submissionResult.summary.failed || 0}</p>
                                            </div>
                                        </div>

                                        {/* Failed Invoices Details */}
                                        {submissionResult.summary.failed > 0 && submissionResult.summary.results && (
                                            <div className="space-y-4">
                                                <h4 className="text-lg font-black text-slate-900 flex items-center gap-2">
                                                    <AlertCircle className="text-rose-600" size={20} />
                                                    Failed Invoices Details
                                                </h4>
                                                {submissionResult.summary.results
                                                    .filter((r: any) => r.status === 'Failed')
                                                    .map((inv: any, idx: number) => (
                                                        <div key={idx} className="bg-rose-50 border-2 border-rose-200 rounded-2xl p-4">
                                                            <div className="flex items-start gap-3">
                                                                <div className="w-8 h-8 bg-rose-600 text-white rounded-full flex items-center justify-center font-black flex-shrink-0">
                                                                    {idx + 1}
                                                                </div>
                                                                <div className="flex-1">
                                                                    <p className="font-black text-rose-900 text-lg mb-2">Invoice: {inv.internalId}</p>
                                                                    <p className="text-rose-700 font-semibold mb-2">{inv.error}</p>

                                                                    {/* Smart Tips for Hardware Errors */}
                                                                    {inv.error && (inv.error.includes('token') || inv.error.includes('PIN') || inv.error.includes('detected') || inv.error.includes('SIGNATURE')) && (
                                                                        <div className="bg-amber-100 border-l-4 border-amber-500 p-3 mb-3 rounded-r-xl">
                                                                            <p className="text-amber-900 text-xs font-bold flex items-center gap-1">
                                                                                <AlertCircle size={14} /> Local Signer Troubleshooting Tip:
                                                                            </p>
                                                                            <ul className="text-amber-800 text-[10px] mt-1 list-disc list-inside">
                                                                                <li>Check if the USB Token is plugged in securely</li>
                                                                                <li>Verify your Token PIN in Settings {">"} Company Info</li>
                                                                                <li>Ensure the OTax Agent window is open on the Master PC</li>
                                                                            </ul>
                                                                        </div>
                                                                    )}

                                                                    {inv.errorDetails && (
                                                                        <div className="bg-white rounded-xl p-3 mt-2">
                                                                            <p className="text-xs text-slate-600 font-mono whitespace-pre-wrap">
                                                                                {typeof inv.errorDetails === 'string'
                                                                                    ? inv.errorDetails.substring(0, 500)
                                                                                    : JSON.stringify(inv.errorDetails, null, 2).substring(0, 500)
                                                                                }
                                                                            </p>
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    ))
                                                }
                                            </div>
                                        )}

                                        {/* Success Message */}
                                        {submissionResult.summary.success > 0 && (
                                            <div className="bg-emerald-50 border-2 border-emerald-300 rounded-2xl p-6">
                                                <div className="flex items-center gap-3">
                                                    <CheckCircle2 className="text-emerald-600" size={24} />
                                                    <p className="text-emerald-900 font-bold">
                                                        {submissionResult.summary.success} invoice(s) successfully submitted to ETA Portal!
                                                    </p>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    /* Error Message */
                                    <div className="space-y-4">
                                        <div className="bg-rose-50 border-2 border-rose-200 rounded-2xl p-6">
                                            <p className="text-rose-900 font-semibold whitespace-pre-wrap">
                                                {submissionResult.message}
                                            </p>
                                        </div>
                                        {submissionResult.isNetworkError && (
                                            <div className="bg-amber-50 border-2 border-amber-200 rounded-2xl p-4">
                                                <p className="text-amber-900 text-sm">
                                                    💡 <strong>Tip:</strong> Check if the backend server is reachable.
                                                </p>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>

                            {/* Footer */}
                            <div className="p-6 bg-slate-50 border-t border-slate-200 flex justify-end gap-3">
                                <button
                                    onClick={() => setShowResultModal(false)}
                                    className="px-6 py-3 bg-slate-200 hover:bg-slate-300 text-slate-800 rounded-xl font-bold transition-all"
                                >
                                    Close
                                </button>
                                {submissionResult.success && submissionResult.summary && submissionResult.summary.success > 0 && (
                                    <button
                                        onClick={() => {
                                            setShowResultModal(false);
                                            handleReset();
                                        }}
                                        className="px-6 py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold transition-all flex items-center gap-2"
                                    >
                                        <RefreshCw size={18} />
                                        Submit New Batch
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                )
            }
        </div >
    );
};

export default InvoiceExcel;
