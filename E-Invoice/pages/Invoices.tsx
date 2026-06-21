import React, { useState } from 'react';
import { Search, Filter, Download, FileText, CheckCircle2, XCircle, Clock, MoreVertical, Printer, Info, HelpCircle, AlertCircle, Eye, ChevronLeft, ChevronRight, CalendarDays, ArrowUpDown, ArrowUp, ArrowDown, Trash2, Share2, FileCode, FileJson, RefreshCw, Ban, ShieldAlert, TimerOff } from 'lucide-react';
import { Invoice } from '../types';
import { apiService } from '../services/apiService';
import ModernDialog from '../components/ModernDialog';
import { useTranslation } from '../i18n';
import { alertDialog } from '../components/ConfirmDialog';

const ERROR_MAP: Record<string, { en: string; ar: string }> = {
  '4090': { en: 'Duplicate Internal ID', ar: 'رقم الفاتورة مكرر' },
  '4001': { en: 'Invalid Tax ID Format', ar: 'تنسيق الرقم الضريبي غير صحيح' },
  '4105': { en: 'Item Code Not Found (GS1/EGS)', ar: 'كود الصنف غير موجود في قاعدة بيانات الضرائب' },
  '5000': { en: 'Signature Verification Failed', ar: 'فشل التحقق من التوقيع الإلكتروني' },
};

const Invoices: React.FC = () => {
  const { t } = useTranslation();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedInvoices, setSelectedInvoices] = useState<string[]>([]);
  const [activeError, setActiveError] = useState<{ code: string; internalId: string } | null>(null);

  /* Dialog State */
  const [dialogState, setDialogState] = useState<{
    isOpen: boolean;
    type: 'confirm' | 'success' | 'error' | 'info';
    title: string;
    message: string;
    onConfirm?: () => void;
  }>({
    isOpen: false,
    type: 'info',
    title: '',
    message: ''
  });

  const closeDialog = () => setDialogState(prev => ({ ...prev, isOpen: false }));

  const showConfirm = (title: string, message: string, onConfirm: () => void) => {
    setDialogState({ isOpen: true, type: 'confirm', title, message, onConfirm: () => { onConfirm(); closeDialog(); } });
  };

  const showAlert = (type: 'success' | 'error' | 'info', title: string, message: string) => {
    setDialogState({ isOpen: true, type, title, message, onConfirm: undefined });
  };

  const handleSyncDb = async () => {
    const userStr = localStorage.getItem('invoice_user');
    const user = userStr ? JSON.parse(userStr) : null;
    if (!user?.id) return;

    showAlert('info', 'Synchronization Started', 'The system is fetching all historical data from the Tax Authority in the background. This may take a few minutes. The list will update automatically.');

    try {
      const headers: any = { 'Content-Type': 'application/json' };
      if (user.token) headers['Authorization'] = `Bearer ${user.token}`;
      headers['x-user-id'] = user.id;

      // Try new org-aware sync endpoint first, fallback to old
      let res;
      try {
        res = await fetch('/api/eta/sync/start', {
          method: 'POST',
          headers,
        });
      } catch {
        // Fallback to old endpoint
        res = await fetch('/api/sync/full-refresh', {
          method: 'POST',
          headers: { 'x-user-id': user.id }
        });
      }
      // Backend handles background process
    } catch (e) {
      console.error("Sync Trigger Failed", e);
    }
  };


  /* Menu State */
  const [activeMenu, setActiveMenu] = useState<{ id: string; direction?: string; top: number; left: number } | null>(null);

  // Close menu on generic actions
  React.useEffect(() => {
    const handleClick = () => setActiveMenu(null);
    window.addEventListener('click', handleClick);
    return () => window.removeEventListener('click', handleClick);
  }, []);

  const handleMenuAction = async (action: string, id: string, extra?: string) => {
    setActiveMenu(null);
    const invoice = invoices.find(i => i.id === id);
    if (!invoice) return;

    if (action === 'cancel' || action === 'reject') {
      const verb = action === 'cancel' ? 'cancel' : 'reject';

      showConfirm(
        `Confirm ${action === 'cancel' ? 'Cancellation' : 'Rejection'}`,
        `Are you sure you want to ${verb} Invoice ${invoice.internalId}? This operation cannot be undone.`,
        async () => {
          try {
            const userStr = localStorage.getItem('invoice_user');
            const user = userStr ? JSON.parse(userStr) : null;
            const uid = user?.id;
            if (!uid) { showAlert('error', 'Authentication Error', "User session not found. Please login again."); return; }

            document.body.style.cursor = 'wait';
            // Try new org-aware endpoint, fallback to old
            const headers: any = { 'Content-Type': 'application/json' };
            if (user?.token) headers['Authorization'] = `Bearer ${user.token}`;
            headers['x-user-id'] = uid;

            let res;
            try {
              res = await fetch(`/api/eta/documents/${id}/${action}`, {
                method: 'PUT',
                headers,
                body: JSON.stringify({ reason: `User ${uid} initiated ${action}` }),
              });
            } catch {
              res = await fetch(`/api/documents/${id}/${action}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', 'x-user-id': uid }
              });
            }

            const text = await res.text();
            document.body.style.cursor = 'default';

            let data;
            try {
              data = JSON.parse(text);
            } catch (e) {
              console.error("Non-JSON Server Response:", text);
              showAlert('error', 'System Error', `Server returned invalid response. Check console for details. (Status: ${res.status})`);
              return;
            }

            if (res.ok && data.success) {
              showAlert('success', 'Success', `Document ${verb}${verb.endsWith('e') ? 'd' : 'ed'} successfully.`);
              // Trigger a refresh after a short delay to allow animation to finish
              setTimeout(() => window.location.reload(), 1500);
            } else {
              let errorMsg = data.message || 'Unknown error';
              if (data.details) {
                const detailStr = typeof data.details === 'object' ? JSON.stringify(data.details, null, 2) : String(data.details);
                errorMsg += `\n\nDetails: ${detailStr}`;
              }
              showAlert('error', 'Operation Failed', `Failed to ${verb}: ${errorMsg}`);
            }
          } catch (e: any) {
            document.body.style.cursor = 'default';
            showAlert('error', 'Network Error', `Connection to server failed: ${e.message}`);
          }
        }
      );

    } else if (action === 'public_link') {
      // Try to get the public URL first
      try {
        // Show a loading indicator cursor or toast if possible, but for now just wait
        document.body.style.cursor = 'wait';
        const res = await apiService.getInvoiceDetails(id);
        document.body.style.cursor = 'default';

        if (res.success && res.document && res.document.publicUrl) {
          window.open(res.document.publicUrl);
        } else {
          // Fallback to authenticated view
          window.open(`https://invoicing.eta.gov.eg/documents/${id}`);
        }
      } catch (e) {
        document.body.style.cursor = 'default';
        window.open(`https://invoicing.eta.gov.eg/documents/${id}`);
      }
    } else if (action === 'download') {
      if (extra === 'json') {
        // Download JSON
        const blob = new Blob([JSON.stringify(invoice, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${invoice.internalId}.json`;
        a.click();
      } else if (extra === 'pdf') {
        // Download PDF
        try {
          const userStr = localStorage.getItem('invoice_user');
          const user = userStr ? JSON.parse(userStr) : null;
          const uid = user?.id;
          if (!uid) { showAlert('error', 'Auth Error', "User session missing. Please login."); return; }

          document.body.style.cursor = 'wait';
          const headers: any = {};
          if (user?.token) headers['Authorization'] = `Bearer ${user.token}`;
          headers['x-user-id'] = uid;

          // Try new org-aware endpoint, fallback to old
          let res;
          try {
            res = await fetch(`/api/eta/documents/${id}/pdf`, { headers });
          } catch {
            res = await fetch(`/api/documents/${id}/pdf`, { headers: { 'x-user-id': uid } });
          }

          if (!res.ok) {
            try {
              const err = await res.json();
              throw new Error(err.details || err.message || "Server Error");
            } catch (parseErr) {
              throw new Error(`Server returned status ${res.status}`);
            }
          }

          const blob = await res.blob();
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `${invoice.internalId || id}.pdf`;
          document.body.appendChild(a);
          a.click();
          window.URL.revokeObjectURL(url);
          document.body.removeChild(a);
          document.body.style.cursor = 'default';
        } catch (e: any) {
          console.error(e);
          document.body.style.cursor = 'default';
          showAlert('error', 'Download Failed', `Failed to download PDF: ${e.message}`);
        }
      } else if (extra === 'xml') {
        try {
          const userStr = localStorage.getItem('invoice_user');
          const user = userStr ? JSON.parse(userStr) : null;
          const uid = user?.id;
          if (!uid) { showAlert('error', 'Auth Error', "User session missing. Please login."); return; }

          document.body.style.cursor = 'wait';
          const res = await fetch(`/api/documents/${id}/xml`, {
            headers: { 'x-user-id': uid }
          });

          if (!res.ok) {
            const err = await res.json();
            throw new Error(err.message || "Failed to fetch XML");
          }

          const blob = await res.blob();
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `${invoice.internalId || id}.xml`;
          document.body.appendChild(a);
          a.click();
          window.URL.revokeObjectURL(url);
          document.body.removeChild(a);
          document.body.style.cursor = 'default';
        } catch (e: any) {
          console.error(e);
          document.body.style.cursor = 'default';
          showAlert('error', 'Download Failed', `Failed to download XML: ${e.message}`);
        }
      }
    }
  };

  // Pagination & Filters State
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(5);
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState({
    type: 'All',
    direction: 'All',
    status: 'All',
    dateFrom: '',
    dateTo: '',
    query: ''
  });

  // Derived State
  // Task 12: Multi-value search (comma-separated)
  const filteredInvoices = React.useMemo(() => {
    return invoices.filter(inv => {
      // Search Query — supports comma-separated multi-value
      const rawQuery = filters.query.trim();
      let matchesQuery = true;
      if (rawQuery) {
        const queries = rawQuery.split(',').map(q => q.trim().toLowerCase()).filter(Boolean);
        matchesQuery = queries.some(q =>
          inv.internalId?.toLowerCase().includes(q) ||
          inv.receiverName?.toLowerCase().includes(q) ||
          inv.receiverId?.includes(q) ||
          inv.id?.toLowerCase().includes(q)
        );
      }

      // Type Filter
      const invType = (inv as any).type || 'I';
      const matchesType = filters.type === 'All' || invType === filters.type;

      // Direction Filter
      const invDir = (inv as any).direction || 'Sent';
      const matchesDir = filters.direction === 'All' || invDir === filters.direction;

      // Status Filter (Task 7)
      const matchesStatus = filters.status === 'All' || inv.status === filters.status;

      // Date Filter
      let matchesDate = true;
      if (filters.dateFrom || filters.dateTo) {
        const invDate = new Date(inv.date);
        if (filters.dateFrom && invDate < new Date(filters.dateFrom)) matchesDate = false;
        if (filters.dateTo && invDate > new Date(filters.dateTo)) matchesDate = false;
      }

      return matchesQuery && matchesType && matchesDir && matchesDate && matchesStatus;
    });
  }, [invoices, filters]);

  const totalPages = Math.ceil(filteredInvoices.length / itemsPerPage);
  const paginatedInvoices = filteredInvoices.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  // Reset page when filters change
  React.useEffect(() => {
    setCurrentPage(1);
  }, [filters, itemsPerPage]);

  React.useEffect(() => {
    let pollTimer: NodeJS.Timeout;

    const fetchInvoices = async () => {
      try {
        const data = await apiService.getInvoices();
        if (data.success) {
          setInvoices(data.invoices);
          // If we want it to keep updating while sync is active, we could check a sync flag.
          // For now, let's poll every 5 seconds if invoices are still coming in.
          pollTimer = setTimeout(fetchInvoices, 5000);
        }
      } catch (err) {
        console.error(err);
        pollTimer = setTimeout(fetchInvoices, 10000);
      } finally {
        setIsLoading(false);
      }
    };

    fetchInvoices();
    return () => clearTimeout(pollTimer);
  }, []);

  // Task 9: Check if cancel/reject time is expired
  const isActionExpired = (invoice: Invoice, action: 'cancel' | 'reject'): boolean => {
    const field = action === 'cancel' ? (invoice as any).canbeCancelledUntil : (invoice as any).canbeRejectedUntil;
    if (!field) return false; // if no expiry date, allow action
    return new Date(field) < new Date();
  };

  // Task 10: Export filtered invoices as XLSX
  const handleExportXLSX = () => {
    const rows = filteredInvoices.map(inv => ({
      'Internal ID': inv.internalId,
      'UUID': inv.id,
      'Receiver': inv.receiverName,
      'Receiver Tax ID': inv.receiverId,
      'Date Issued': inv.date,
      'Type': (inv as any).type || 'I',
      'Direction': (inv as any).direction || 'Sent',
      'Total': inv.total,
      'Currency': inv.currency,
      'Status': inv.status,
    }));
    if (rows.length === 0) { showAlert('info', 'No Data', 'No invoices to export.'); return; }
    // Build CSV (XLSX-compatible)
    const headers = Object.keys(rows[0]);
    const csv = [headers.join(','), ...rows.map(r => headers.map(h => `"${String((r as any)[h] ?? '').replace(/"/g, '""')}"`).join(','))].join('\n');
    const BOM = '\uFEFF';
    const blob = new Blob([BOM + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `invoices_export_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
  };

  // Task 11: Bulk cancel
  const handleBulkCancel = async () => {
    if (selectedInvoices.length === 0) return;
    showConfirm(
      'Bulk Cancel',
      `Are you sure you want to cancel ${selectedInvoices.length} selected document(s)? This cannot be undone.`,
      async () => {
        let success = 0, failed = 0;
        for (const id of selectedInvoices) {
          try {
            const userStr = localStorage.getItem('invoice_user');
            const user = userStr ? JSON.parse(userStr) : null;
            const headers: any = { 'Content-Type': 'application/json' };
            if (user?.token) headers['Authorization'] = `Bearer ${user.token}`;
            headers['x-user-id'] = user?.id;
            const res = await fetch(`/api/eta/documents/${id}/cancel`, { method: 'PUT', headers, body: JSON.stringify({ reason: 'Bulk cancel' }) });
            if (res.ok) success++; else failed++;
          } catch { failed++; }
        }
        showAlert('info', 'Bulk Cancel Complete', `${success} cancelled, ${failed} failed.`);
        setSelectedInvoices([]);
        setTimeout(() => window.location.reload(), 1500);
      }
    );
  };

  // Task 11: Bulk download PDF
  const handleBulkDownloadPDF = async () => {
    if (selectedInvoices.length === 0) return;
    const userStr = localStorage.getItem('invoice_user');
    const user = userStr ? JSON.parse(userStr) : null;
    if (!user?.id) return;
    for (const id of selectedInvoices) {
      try {
        const headers: any = {};
        if (user?.token) headers['Authorization'] = `Bearer ${user.token}`;
        headers['x-user-id'] = user.id;
        const res = await fetch(`/api/eta/documents/${id}/pdf`, { headers });
        if (res.ok) {
          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          const inv = invoices.find(i => i.id === id);
          const a = document.createElement('a');
          a.href = url; a.download = `${inv?.internalId || id}.pdf`;
          document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
        }
        await new Promise(r => setTimeout(r, 300)); // rate limit
      } catch (e) { console.error(`PDF download failed for ${id}:`, e); }
    }
  };

  // Task 7: Expanded status badge with cancel/reject request statuses
  const getStatusBadge = (invoice: Invoice) => {
    const { status, errorCode } = invoice;
    switch (status) {
      case 'Valid': return (
        <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 text-xs font-bold border border-emerald-100">
          <CheckCircle2 size={12} /> Valid
        </span>
      );
      case 'Invalid': return (
        <div className="flex flex-col gap-1">
          <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-rose-50 text-rose-700 text-xs font-bold border border-rose-100">
            <XCircle size={12} /> Invalid
          </span>
          {errorCode && (
            <button
              onClick={(e) => { e.stopPropagation(); setActiveError({ code: errorCode, internalId: invoice.internalId }); }}
              className="text-[9px] text-rose-400 hover:text-rose-600 flex items-center gap-1 font-bold underline px-1 text-left"
            >
              <Info size={10} /> View Error
            </button>
          )}
        </div>
      );
      case 'Submitted': return (
        <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-sky-50 text-sky-700 text-xs font-bold border border-sky-100">
          <Clock size={12} /> Submitted
        </span>
      );
      case 'Rejected': return (
        <div className="flex flex-col gap-1">
          <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 text-xs font-bold border border-amber-100">
            <XCircle size={12} /> Rejected
          </span>
          {errorCode && (
            <button
              onClick={(e) => { e.stopPropagation(); setActiveError({ code: errorCode, internalId: invoice.internalId }); }}
              className="text-[9px] text-amber-500 hover:text-amber-700 flex items-center gap-1 font-bold underline px-1 text-left"
            >
              <Info size={10} /> Decode ETA Error
            </button>
          )}
        </div>
      );
      case 'Cancelled': return (
        <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-100 text-slate-700 text-xs font-bold border border-slate-200">
          <XCircle size={12} /> Cancelled
        </span>
      );
      // Task 7: New status types
      case 'CancelRequest': return (
        <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-orange-50 text-orange-700 text-xs font-bold border border-orange-100">
          <Ban size={12} /> Cancel Requested
        </span>
      );
      case 'RejectRequest': return (
        <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-pink-50 text-pink-700 text-xs font-bold border border-pink-100">
          <Ban size={12} /> Reject Requested
        </span>
      );
      case 'DeclinedCancel': return (
        <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-red-50 text-red-700 text-xs font-bold border border-red-100">
          <ShieldAlert size={12} /> Cancel Declined
        </span>
      );
      case 'DeclinedReject': return (
        <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-red-50 text-red-700 text-xs font-bold border border-red-100">
          <ShieldAlert size={12} /> Reject Declined
        </span>
      );
      case 'RequestedCancel': return (
        <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-orange-50 text-orange-700 text-xs font-bold border border-orange-100">
          <TimerOff size={12} /> Pending Cancel
        </span>
      );
      case 'RequestedReject': return (
        <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-pink-50 text-pink-700 text-xs font-bold border border-pink-100">
          <TimerOff size={12} /> Pending Reject
        </span>
      );
      default: return (
        <span className="px-2.5 py-1 rounded-full bg-gray-50 text-gray-700 text-xs font-bold border border-gray-100">
          {status || 'Draft'}
        </span>
      );
    }
  };

  const toggleSelectAll = () => {
    if (selectedInvoices.length === invoices.length) {
      setSelectedInvoices([]);
    } else {
      setSelectedInvoices(invoices.map(inv => inv.id));
    }
  };

  const toggleSelect = (id: string) => {
    if (selectedInvoices.includes(id)) {
      setSelectedInvoices(prev => prev.filter(i => i !== id));
    } else {
      setSelectedInvoices(prev => [...prev, id]);
    }
  };

  const getDocVal = (data: any, key: string) => {
    if (!data) return null;
    // Case-insensitive lookup
    const foundKey = Object.keys(data).find(k => k.toLowerCase() === key.toLowerCase());
    return foundKey ? data[foundKey] : undefined;
  };

  /* New State for Details View */
  const [viewingDoc, setViewingDoc] = useState<{ id: string, data: any, loading: boolean } | null>(null);

  const handleViewDetails = async (uuid: string) => {
    setViewingDoc({ id: uuid, data: null, loading: true });
    try {
      const res = await apiService.getInvoiceDetails(uuid);
      if (res.success) {
        setViewingDoc({ id: uuid, data: res.document, loading: false });
      }
    } catch (err) {
      console.error(err);
      setViewingDoc(null);
      await alertDialog({ title: 'Load failed', message: 'Failed to load document details from ETA.', tone: 'danger' });
    }
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] gap-4">
        <div className="w-12 h-12 border-4 border-blue-100 border-t-blue-600 rounded-full animate-spin" />
        <p className="text-slate-400 font-bold uppercase tracking-widest text-xs font-mono">Loading Database Transactions...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500 relative">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 tracking-tight">Invoice Management</h1>
          <p className="text-slate-500 text-sm">Search, filter and manage your electronic documents</p>
        </div>
        <div className="flex items-center gap-3">
          {/* Task 10: Renamed Export Selection → Export and wired to XLSX */}
          <button onClick={handleExportXLSX} className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-2xl text-sm font-bold hover:bg-blue-700 transition-all shadow-lg shadow-blue-100 hover:scale-[1.02] active:scale-[0.98]">
            <Download size={18} /> Export
          </button>
          <button className="p-3 bg-white border border-gray-200 rounded-2xl text-slate-600 hover:bg-gray-50 transition-all shadow-sm">
            <Printer size={20} />
          </button>
        </div>
      </div>

      <div className="bg-white p-6 rounded-[32px] shadow-sm border border-gray-100 space-y-6">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex-1 min-w-[300px] relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
            {/* Task 12: placeholder updated for comma-separated multi-value search */}
            <input
              type="text"
              placeholder="Search by ID, Customer or Tax No (comma-separated for multiple)..."
              value={filters.query}
              onChange={(e) => setFilters(prev => ({ ...prev, query: e.target.value }))}
              className="w-full pl-12 pr-4 py-3 bg-gray-50 border border-gray-100 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
            />
          </div>
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`flex items-center gap-2 px-5 py-3 border rounded-2xl text-sm font-bold transition-all ${showFilters ? 'bg-blue-50 border-blue-200 text-blue-600' : 'border-gray-200 text-slate-600 hover:bg-gray-50'}`}
          >
            <Filter size={18} className={showFilters ? 'text-blue-500' : 'text-slate-400'} />
            Advanced Filters
          </button>

          <button
            onClick={handleSyncDb}
            className="flex items-center gap-2 px-5 py-3 border border-gray-200 rounded-2xl text-sm font-bold text-slate-600 hover:bg-gray-50 transition-all hover:text-blue-600 hover:border-blue-200"
            title="Force Full Sync from Portal to Local DB"
          >
            <RefreshCw size={18} className="text-slate-400 group-hover:text-blue-500" />
            Sync Database
          </button>
        </div>

        {showFilters && (
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4 p-4 bg-gray-50/50 rounded-2xl border border-gray-100 animate-in slide-in-from-top-2">
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-500 ml-1">Invoice Type</label>
              <div className="flex bg-white rounded-xl border border-gray-200 p-1">
                {['All', 'I', 'C', 'D'].map(t => (
                  <button
                    key={t}
                    onClick={() => setFilters(prev => ({ ...prev, type: t }))}
                    className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all ${filters.type === t ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-500 hover:bg-gray-50'}`}
                  >
                    {t === 'All' ? 'All' : t === 'I' ? 'Inv' : t === 'C' ? 'Cre' : 'Deb'}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-500 ml-1">Direction</label>
              <div className="flex bg-white rounded-xl border border-gray-200 p-1">
                {['All', 'Sent', 'Received'].map(d => (
                  <button
                    key={d}
                    onClick={() => setFilters(prev => ({ ...prev, direction: d }))}
                    className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all ${filters.direction === d ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-500 hover:bg-gray-50'}`}
                  >
                    {d === 'All' ? 'All' : d}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-500 ml-1">Date From</label>
              <div className="relative">
                <CalendarDays className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                <input
                  type="date"
                  value={filters.dateFrom}
                  onChange={(e) => setFilters(prev => ({ ...prev, dateFrom: e.target.value }))}
                  className="w-full pl-10 pr-3 py-2 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-slate-600"
                />
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-500 ml-1">Date To</label>
              <div className="relative">
                <CalendarDays className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                <input
                  type="date"
                  value={filters.dateTo}
                  onChange={(e) => setFilters(prev => ({ ...prev, dateTo: e.target.value }))}
                  className="w-full pl-10 pr-3 py-2 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-slate-600"
                />
              </div>
            </div>
            {/* Task 7: Status filter */}
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-500 ml-1">Status</label>
              <select
                value={filters.status}
                onChange={(e) => setFilters(prev => ({ ...prev, status: e.target.value }))}
                className="w-full bg-white border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-slate-600"
              >
                <option value="All">All Status</option>
                <option value="Valid">Valid</option>
                <option value="Invalid">Invalid</option>
                <option value="Submitted">Submitted</option>
                <option value="Rejected">Rejected</option>
                <option value="Cancelled">Cancelled</option>
                <option value="CancelRequest">Cancel Requested</option>
                <option value="RejectRequest">Reject Requested</option>
                <option value="DeclinedCancel">Cancel Declined</option>
                <option value="DeclinedReject">Reject Declined</option>
              </select>
            </div>
            <div className="flex items-end">
              <button
                onClick={() => setFilters({ type: 'All', direction: 'All', status: 'All', dateFrom: '', dateTo: '', query: '' })}
                className="w-full py-2 bg-white border border-gray-200 text-slate-500 rounded-xl text-sm font-bold hover:bg-gray-50 hover:text-rose-500 transition-colors"
              >
                Reset Filters
              </button>
            </div>
          </div>
        )}

        {/* Task 11: Bulk actions — cancel, download PDF */}
        {selectedInvoices.length > 0 && (
          <div className="bg-blue-600 p-4 rounded-2xl flex items-center justify-between animate-in slide-in-from-top-2 duration-200 text-white shadow-lg shadow-blue-100">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center font-bold">{selectedInvoices.length}</div>
              <span className="text-sm font-bold">Invoices selected for action</span>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={handleBulkDownloadPDF} className="px-4 py-2 bg-white text-blue-600 text-xs font-black rounded-xl hover:bg-blue-50 transition-colors uppercase">Download All PDF</button>
              <button onClick={handleBulkCancel} className="px-4 py-2 bg-blue-500 text-white border border-white/20 text-xs font-black rounded-xl hover:bg-blue-400 transition-colors uppercase">Cancel Documents</button>
            </div>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-gray-50">
                <th className="pb-4 pt-2">
                  <input
                    type="checkbox"
                    className="w-4 h-4 rounded-lg border-gray-300 text-blue-600 focus:ring-blue-500"
                    checked={selectedInvoices.length === invoices.length && invoices.length > 0}
                    onChange={toggleSelectAll}
                  />
                </th>
                <th className="pb-4 pt-2 text-[10px] font-black text-slate-400 uppercase tracking-widest pl-2">Internal ID</th>
                <th className="pb-4 pt-2 text-[10px] font-black text-slate-400 uppercase tracking-widest">Receiver / Client</th>
                <th className="pb-4 pt-2 text-[10px] font-black text-slate-400 uppercase tracking-widest">Date Issued</th>
                <th className="pb-4 pt-2 text-[10px] font-black text-slate-400 uppercase tracking-widest pl-2">Type</th>
                <th className="pb-4 pt-2 text-[10px] font-black text-slate-400 uppercase tracking-widest">Amount</th>
                <th className="pb-4 pt-2 text-[10px] font-black text-slate-400 uppercase tracking-widest">Status</th>
                <th className="pb-4 pt-2 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {paginatedInvoices.map((inv) => (
                <tr key={inv.id} className="hover:bg-blue-50/30 transition-all group cursor-pointer" onClick={() => handleViewDetails(inv.id)}>
                  <td className="py-5" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      className="w-4 h-4 rounded-lg border-gray-300 text-blue-600 focus:ring-blue-500"
                      checked={selectedInvoices.includes(inv.id)}
                      onChange={(e) => { e.stopPropagation(); toggleSelect(inv.id); }}
                    />
                  </td>
                  <td className="py-5 pl-2">
                    <div className="flex flex-col">
                      <span className="text-sm font-bold text-slate-800 tracking-tight">{inv.internalId}</span>
                      <span className="text-[10px] text-slate-400 font-mono">UID: {inv.id.substring(0, 8)}...</span>
                    </div>
                  </td>
                  <td className="py-5">
                    <div className="flex flex-col">
                      <span className="text-sm text-slate-700 font-bold">{inv.receiverName}</span>
                      <span className="text-[10px] text-slate-400 font-medium">Tax ID: {inv.receiverId}</span>
                    </div>
                  </td>
                  <td className="py-5 text-sm text-slate-600 font-medium">{inv.date}</td>
                  <td className="py-5 pl-2">
                    {(() => {
                      const type = (inv as any).type || 'I';
                      const direction = (inv as any).direction || 'Sent';
                      const colors: any = { 'I': 'bg-blue-100 text-blue-700', 'C': 'bg-amber-100 text-amber-700', 'D': 'bg-emerald-100 text-emerald-700' };
                      return (
                        <div className="flex items-center gap-2">
                          {direction === 'Sent' ? <ArrowUp size={16} className="text-blue-500" /> : <ArrowDown size={16} className="text-orange-500" />}
                          <div className={`w-8 h-8 flex items-center justify-center rounded-lg text-xs font-black ${colors[type] || colors['I']}`}>
                            {type}
                          </div>
                        </div>
                      );
                    })()}
                  </td>
                  <td className="py-5">
                    <div className="flex flex-col">
                      <span className="text-sm font-black text-slate-900">{inv.total.toLocaleString()}</span>
                      <span className="text-[10px] font-bold text-blue-500 uppercase">{inv.currency}</span>
                    </div>
                  </td>
                  <td className="py-5">{getStatusBadge(inv)}</td>
                  <td className="py-5 text-right" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-end gap-2 pr-2">
                      <button onClick={() => handleViewDetails(inv.id)} title="View Details" className="p-2.5 bg-blue-50 text-blue-600 hover:bg-blue-600 hover:text-white rounded-xl transition-all font-bold"><Eye size={16} /></button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          window.open(`/print/invoice/${inv.id}`, '_blank');
                        }}
                        title="Print / Save as PDF"
                        className="p-2.5 bg-emerald-50 text-emerald-600 hover:bg-emerald-600 hover:text-white rounded-xl transition-all font-bold"
                      >
                        <Printer size={16} />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          const rect = e.currentTarget.getBoundingClientRect();
                          // Calculate position relative to document
                          setActiveMenu({ id: inv.id, direction: (inv as any).direction || 'Sent', top: rect.bottom + window.scrollY + 5, left: rect.right + window.scrollX - 220 });
                        }}
                        className={`p-2.5 rounded-xl transition-all ${activeMenu?.id === inv.id ? 'bg-blue-600 text-white shadow-md' : 'bg-gray-50 text-slate-400 hover:bg-slate-200 hover:text-slate-600'}`}
                      >
                        <MoreVertical size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {filteredInvoices.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-20 text-center">
                    <div className="flex flex-col items-center gap-3 text-slate-400">
                      <FileText size={48} className="opacity-10" />
                      <p className="text-sm font-bold">No documents found for this period.</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Footer */}
        <div className="flex flex-col md:flex-row items-center justify-between gap-4 pt-4 border-t border-gray-50">
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <span>Rows per page:</span>
            <select
              value={itemsPerPage}
              onChange={(e) => setItemsPerPage(Number(e.target.value))}
              className="bg-gray-50 border border-gray-200 rounded-lg px-2 py-1 text-slate-700 font-bold focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            >
              {[5, 10, 20, 50].map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <span className="ml-2 font-bold">
              {filteredInvoices.length > 0 ? (
                <>Showing {Math.min((currentPage - 1) * itemsPerPage + 1, filteredInvoices.length)} - {Math.min(currentPage * itemsPerPage, filteredInvoices.length)} of {filteredInvoices.length}</>
              ) : 'No results'}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              disabled={currentPage === 1}
              onClick={() => setCurrentPage(p => p - 1)}
              className="p-2 border border-gray-200 rounded-xl disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50 text-slate-600 transition-all"
            >
              <ChevronLeft size={18} />
            </button>

            <div className="flex items-center gap-1">
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                let p = i + 1;
                if (totalPages > 5) {
                  if (currentPage <= 3) p = i + 1;
                  else if (currentPage >= totalPages - 2) p = totalPages - 4 + i;
                  else p = currentPage - 2 + i;
                }

                return (
                  <button
                    key={p}
                    onClick={() => setCurrentPage(p)}
                    className={`w-8 h-8 rounded-lg text-sm font-bold transition-all ${currentPage === p ? 'bg-blue-600 text-white shadow-md shadow-blue-200' : 'text-slate-500 hover:bg-gray-50'}`}
                  >
                    {p}
                  </button>
                );
              })}
            </div>

            <button
              disabled={currentPage === totalPages || totalPages === 0}
              onClick={() => setCurrentPage(p => p + 1)}
              className="p-2 border border-gray-200 rounded-xl disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50 text-slate-600 transition-all"
            >
              <ChevronRight size={18} />
            </button>
          </div>
        </div>
      </div>

      {/* DOCUMENT DETAILS SLIDE-OVER */}
      {viewingDoc && (
        <div className="fixed inset-0 z-50 flex justify-end" style={{ background: 'rgba(0,0,0,0.3)' }}>
          <div className="w-full max-w-2xl bg-white h-full shadow-2xl p-0 flex flex-col animate-in slide-in-from-right duration-300">

            {/* Header */}
            <div className="p-6 border-b border-gray-100 flex items-center justify-between bg-slate-50">
              <div>
                <h2 className="text-xl font-bold text-slate-800">Document Details</h2>
                <p className="text-xs text-slate-500 font-mono mt-1">{viewingDoc.id}</p>
              </div>
              <button onClick={() => setViewingDoc(null)} className="p-2 hover:bg-slate-200 rounded-full transition-colors"><XCircle size={24} className="text-slate-400" /></button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6 space-y-8">
              {viewingDoc.loading ? (
                <div className="flex flex-col items-center justify-center h-48 gap-3">
                  <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
                  <span className="text-xs font-bold text-blue-600">Fetching live data from ETA...</span>
                </div>
              ) : viewingDoc.data ? (() => {
                const data = viewingDoc.data;
                const lines = getDocVal(data, 'invoiceLines') || [];

                // Currency Logic
                const currencySegs = getDocVal(data, 'currencySegments');
                const foreignCurr = currencySegs && currencySegs.length > 0 ? getDocVal(currencySegs[0], 'currency') : null;
                const isForeign = foreignCurr && foreignCurr !== 'EGP';
                const currency = isForeign ? foreignCurr : 'EGP';
                const exchangeRate = isForeign ? getDocVal(currencySegs[0], 'currencyExchangeRate') : 1;

                // Totals
                const totalAmount = isForeign ? getDocVal(currencySegs[0], 'totalAmount') : getDocVal(data, 'totalAmount');
                const taxTotals = isForeign ? getDocVal(currencySegs[0], 'taxTotals') : getDocVal(data, 'taxTotals');

                const dateIssued = getDocVal(data, 'dateTimeIssued');
                const issuer = getDocVal(data, 'issuer');
                const receiver = getDocVal(data, 'receiver');
                const signatures = getDocVal(data, 'signatures');

                return (
                  <>
                    {/* Summary Grid */}
                    <div className="grid grid-cols-2 gap-4">
                      <div className="p-4 bg-blue-50 rounded-2xl border border-blue-100">
                        <span className="text-[10px] uppercase font-bold text-blue-400 tracking-wider">Total Amount</span>
                        <div className="flex items-end gap-2 mt-1">
                          <span className="text-2xl font-black text-slate-800">{totalAmount?.toLocaleString()}</span>
                          <span className="text-sm font-bold text-blue-600 mb-1">{currency}</span>
                        </div>
                        {isForeign && (
                          <div className="text-[10px] text-slate-400 mt-1 font-mono">
                            Eq: {getDocVal(data, 'totalAmount')?.toLocaleString()} EGP
                            <span className="mx-1">•</span>
                            Rate: {exchangeRate}
                          </div>
                        )}
                      </div>
                      <div className="p-4 bg-gray-50 rounded-2xl border border-gray-100">
                        <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Date Issued</span>
                        <div className="text-lg font-bold text-slate-700 mt-1">{dateIssued ? new Date(dateIssued).toLocaleString() : 'N/A'}</div>
                      </div>
                    </div>

                    {/* Issuer / Receiver */}
                    <div className="grid grid-cols-2 gap-8">
                      <div>
                        <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-3 border-b pb-2">Issuer (Seller)</h3>
                        <div className="text-sm font-bold text-slate-800">{getDocVal(issuer, 'name')}</div>
                        <div className="text-xs text-slate-500 mt-1">Tax ID: {getDocVal(issuer, 'id')}</div>
                        <div className="text-xs text-slate-500 mt-1">{getDocVal(issuer?.address, 'street')}</div>
                      </div>
                      <div>
                        <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-3 border-b pb-2">Receiver (Buyer)</h3>
                        <div className="text-sm font-bold text-slate-800">{getDocVal(receiver, 'name')}</div>
                        <div className="text-xs text-slate-500 mt-1">Tax ID: {getDocVal(receiver, 'id')}</div>
                        <div className="text-xs text-slate-500 mt-1">{getDocVal(receiver?.address, 'street')}</div>
                      </div>
                    </div>

                    {/* Line Items */}
                    <div>
                      <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-4">Invoice Lines</h3>
                      <div className="border border-gray-100 rounded-xl overflow-hidden">
                        <table className="w-full text-left text-sm">
                          <thead className="bg-gray-50 text-slate-500 font-bold text-xs">
                            <tr>
                              <th className="p-3">Description</th>
                              <th className="p-3 text-center">Qty</th>
                              <th className="p-3 text-right">Unit Price</th>
                              <th className="p-3 text-right">Total</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-50">
                            {lines.map((line: any, idx: number) => {
                              const unitVal = isForeign ? getDocVal(line.unitValue, 'amountSold') : getDocVal(line.unitValue, 'amountEGP');
                              const lineTotal = isForeign ? getDocVal(line, 'salesTotalForeign') : getDocVal(line, 'salesTotal'); // or total
                              return (
                                <tr key={idx}>
                                  <td className="p-3 font-medium text-slate-700 max-w-[200px] truncate" title={getDocVal(line, 'description')}>{getDocVal(line, 'description')}</td>
                                  <td className="p-3 text-center text-slate-500">{getDocVal(line, 'quantity')}</td>
                                  <td className="p-3 text-right text-slate-500">{unitVal?.toLocaleString()}</td>
                                  <td className="p-3 text-right font-bold text-slate-800">{lineTotal?.toLocaleString()}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    {/* Tax Breakdown */}
                    {taxTotals && taxTotals.length > 0 && (
                      <div className="bg-gray-50/50 rounded-xl border border-gray-100 p-4">
                        <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-3">Taxes & Totals</h3>
                        <div className="space-y-2">
                          {taxTotals.map((tax: any, idx: number) => (
                            <div key={idx} className="flex justify-between text-sm">
                              <span className="font-medium text-slate-600">{getDocVal(tax, 'taxType')}</span>
                              <span className="font-bold text-slate-700">{getDocVal(tax, 'amount')?.toLocaleString()} {currency}</span>
                            </div>
                          ))}
                          <div className="border-t border-gray-200 mt-2 pt-2 flex justify-between items-center">
                            <span className="font-bold text-slate-800">Grand Total</span>
                            <span className="text-lg font-black text-blue-600">{totalAmount?.toLocaleString()} {currency}</span>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Signatures */}
                    {signatures && signatures.length > 0 && (
                      <div className="p-4 bg-emerald-50 border border-emerald-100 rounded-xl flex items-center gap-3">
                        <CheckCircle2 size={20} className="text-emerald-500" />
                        <div>
                          <div className="text-sm font-bold text-emerald-800">Digitally Signed</div>
                          <div className="text-xs text-emerald-600">Type: {getDocVal(signatures[0], 'signatureType')}</div>
                        </div>
                      </div>
                    )}

                    {/* Debug Section */}
                    <details className="p-4 border-t border-gray-100 mt-4">
                      <summary className="text-xs font-bold text-slate-400 cursor-pointer">Debug: Raw Data Payload</summary>
                      <pre className="mt-4 p-4 bg-slate-900 text-green-400 rounded-xl text-[10px] font-mono overflow-auto max-h-60">
                        {JSON.stringify(viewingDoc.data, null, 2)}
                      </pre>
                    </details>
                  </>
                );
              })() : (
                <div className="text-center text-slate-400 py-10">Document data not available.</div>
              )}
            </div>

            {/* Footer */}
            <div className="p-6 border-t border-gray-100 bg-gray-50 flex gap-3">
              <button className="flex-1 py-3 bg-white border border-gray-200 rounded-xl font-bold text-slate-600 hover:bg-gray-100" onClick={() => {
                const pubUrl = viewingDoc.data?.publicUrl;
                if (pubUrl) window.open(pubUrl);
                else window.open(`https://invoicing.eta.gov.eg/documents/${viewingDoc.id}`);
              }}>Open in Portal</button>
              <button className="flex-1 py-3 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700" onClick={() => {
                // Open the print-friendly view in a new tab — the user can then
                // use the browser's "Save as PDF" for a clean exportable file.
                if (viewingDoc.id) window.open(`/print/invoice/${viewingDoc.id}`, '_blank');
              }}>{t('invoices.printPdf')}</button>
            </div>
          </div>
        </div>
      )}

      {activeError && (
        <div className="fixed inset-0 bg-slate-950/40 backdrop-blur-md z-[100] flex items-center justify-center p-6 animate-in fade-in duration-300">
          <div className="bg-white w-full max-w-lg rounded-[48px] p-10 space-y-8 shadow-2xl animate-in zoom-in-95 duration-300 ring-1 ring-black/5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="bg-rose-50 p-3 rounded-2xl text-rose-500 shadow-sm">
                  <HelpCircle size={32} />
                </div>
                <div>
                  <h3 className="text-2xl font-black text-slate-800 tracking-tight">Smart Error Decoder</h3>
                  <p className="text-[10px] text-slate-400 uppercase font-black tracking-widest">Document Internal ID: {activeError.internalId}</p>
                </div>
              </div>
              <button onClick={() => setActiveError(null)} className="p-3 bg-gray-50 hover:bg-rose-50 hover:text-rose-500 rounded-2xl transition-all">
                <XCircle size={24} className="opacity-50" />
              </button>
            </div>

            <div className="space-y-8">
              <div className="p-8 bg-slate-900 rounded-[32px] text-white shadow-xl relative overflow-hidden">
                <div className="absolute top-0 right-0 p-8 opacity-5 pointer-events-none">
                  <AlertCircle size={100} />
                </div>
                <p className="text-[10px] font-black text-slate-500 uppercase mb-6 tracking-widest relative z-10">ETA Response Code</p>
                <div className="flex items-center gap-6 relative z-10">
                  <span className="text-6xl font-black tracking-tighter text-rose-400">{activeError.code}</span>
                  <div className="h-14 w-px bg-white/10" />
                  <div className="flex-1">
                    <p className="text-base font-bold text-white leading-snug">{ERROR_MAP[activeError.code]?.en || 'Unknown error response from ETA portal.'}</p>
                    <p className="text-lg font-black text-blue-400 mt-2 leading-none" dir="rtl">{ERROR_MAP[activeError.code]?.ar || 'خطأ غير معروف من بوابة الضرائب.'}</p>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <h4 className="font-black text-slate-800 text-xs uppercase tracking-widest pl-2">Automatic Resolution Steps:</h4>
                <div className="grid grid-cols-1 gap-3">
                  {[
                    'Check Source ERP system for missing header fields.',
                    'Verify Item Code mapping in Master Data module.',
                    'Refresh Digital Signature cache and retry.'
                  ].map((step, i) => (
                    <div key={i} className="flex items-center gap-4 p-4 bg-gray-50 rounded-2xl border border-gray-100/50">
                      <span className="shrink-0 w-8 h-8 bg-white shadow-sm text-blue-600 rounded-xl flex items-center justify-center text-xs font-black">{i + 1}</span>
                      <p className="text-sm font-bold text-slate-600">{step}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex gap-4 pt-2">
                <button
                  onClick={() => setActiveError(null)}
                  className="flex-1 py-5 bg-gray-100 text-slate-500 font-black rounded-3xl hover:bg-gray-200 transition-all uppercase text-xs tracking-widest"
                >
                  Dismiss
                </button>
                <button
                  onClick={async () => { await alertDialog({ title: 'Help', message: 'Opening Help Docs...', tone: 'info' }); setActiveError(null); }}
                  className="flex-2 px-8 py-5 bg-blue-600 text-white font-black rounded-3xl hover:bg-blue-700 transition-all shadow-xl shadow-blue-200 uppercase text-xs tracking-widest"
                >
                  View SDK Solution
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* ACTION MENU OVERLAY */}
      {activeMenu && (
        <div
          className="fixed z-[9999] bg-white rounded-2xl shadow-xl border border-gray-100 p-2 flex flex-col gap-1 w-56 animate-in zoom-in-95 duration-200"
          style={{ top: activeMenu.top, left: activeMenu.left }}
          onClick={(e) => e.stopPropagation()}
        >
          <button onClick={() => handleMenuAction('public_link', activeMenu.id)} className="w-full flex items-center gap-3 px-3 py-2.5 text-slate-600 hover:bg-gray-50 hover:text-blue-600 rounded-xl transition-all text-xs font-bold text-left">
            <Share2 size={16} /> Open in Portal
          </button>
          <div className="h-px bg-gray-100 my-1" />
          {/* Task 9: Disable cancel/reject button if time has expired */}
          {activeMenu.direction === 'Received' ? (() => {
            const inv = invoices.find(i => i.id === activeMenu.id);
            const expired = inv ? isActionExpired(inv, 'reject') : false;
            return (
              <button
                onClick={() => !expired && handleMenuAction('reject', activeMenu.id)}
                disabled={expired}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all text-xs font-bold text-left ${expired ? 'text-slate-300 cursor-not-allowed' : 'text-slate-600 hover:bg-rose-50 hover:text-rose-600'}`}
                title={expired ? 'Rejection period has expired' : 'Reject this document'}
              >
                {expired ? <TimerOff size={16} /> : <XCircle size={16} />}
                {expired ? 'Reject Expired' : 'Reject Document'}
              </button>
            );
          })() : (() => {
            const inv = invoices.find(i => i.id === activeMenu.id);
            const expired = inv ? isActionExpired(inv, 'cancel') : false;
            return (
              <button
                onClick={() => !expired && handleMenuAction('cancel', activeMenu.id)}
                disabled={expired}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all text-xs font-bold text-left ${expired ? 'text-slate-300 cursor-not-allowed' : 'text-slate-600 hover:bg-rose-50 hover:text-rose-600'}`}
                title={expired ? 'Cancellation period has expired' : 'Cancel this document'}
              >
                {expired ? <TimerOff size={16} /> : <Trash2 size={16} />}
                {expired ? 'Cancel Expired' : 'Cancel Document'}
              </button>
            );
          })()}
          <div className="h-px bg-gray-100 my-1" />
          <div className="px-3 py-1.5 text-[10px] font-black text-slate-400 uppercase tracking-widest">Download As</div>
          <button onClick={() => handleMenuAction('download', activeMenu.id, 'pdf')} className="w-full flex items-center gap-3 px-3 py-2 text-slate-600 hover:bg-gray-50 hover:text-blue-600 rounded-lg transition-all text-xs font-medium text-left">
            <FileText size={14} /> PDF Document
          </button>
          <button onClick={() => handleMenuAction('download', activeMenu.id, 'json')} className="w-full flex items-center gap-3 px-3 py-2 text-slate-600 hover:bg-gray-50 hover:text-blue-600 rounded-lg transition-all text-xs font-medium text-left">
            <FileJson size={14} /> JSON Data
          </button>
          <button onClick={() => handleMenuAction('download', activeMenu.id, 'xml')} className="w-full flex items-center gap-3 px-3 py-2 text-slate-600 hover:bg-gray-50 hover:text-blue-600 rounded-lg transition-all text-xs font-medium text-left">
            <FileCode size={14} /> XML Structure
          </button>
        </div>
      )}


      {/* Modern Dialog Component */}
      <ModernDialog
        isOpen={dialogState.isOpen}
        type={dialogState.type}
        title={dialogState.title}
        message={dialogState.message}
        onConfirm={dialogState.onConfirm}
        onCancel={closeDialog}
      />
    </div>
  );
};

export default Invoices;
