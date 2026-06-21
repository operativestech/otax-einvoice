
import React, { useState } from 'react';
import { ShieldCheck, LogOut, FileText, Download, XCircle, ChevronRight, AlertCircle } from 'lucide-react';
import PasswordInput from '../components/PasswordInput';

const CustomerPortal: React.FC = () => {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [taxId, setTaxId] = useState('');
  const [accessCode, setAccessCode] = useState('');
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  const mockInvoices = [
    { id: '1', date: '2023-11-01', total: '15,400.00 EGP', status: 'Accepted', internalId: 'INV-2023-001' },
    { id: '2', date: '2023-11-02', total: '2,150.00 EGP', status: 'Pending', internalId: 'INV-2023-005' },
    { id: '3', date: '2023-11-05', total: '45,000.00 EGP', status: 'Accepted', internalId: 'INV-2023-012' },
  ];

  if (!isLoggedIn) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-6">
        <div className="w-full max-w-md bg-white p-8 rounded-3xl shadow-xl border border-gray-100 space-y-8">
          <div className="flex flex-col items-center gap-4">
            <div className="bg-blue-600 p-3 rounded-2xl text-white">
              <ShieldCheck size={32} />
            </div>
            <div className="text-center">
              <h1 className="text-2xl font-bold text-slate-800">Customer B2B Portal</h1>
              <p className="text-slate-500 text-sm mt-1">Access your electronic invoices from E-Corp Global</p>
            </div>
          </div>

          <div className="space-y-4">
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-500 uppercase">Receiver Tax ID</label>
              <input
                type="text"
                value={taxId}
                onChange={(e) => setTaxId(e.target.value)}
                placeholder="123-456-789"
                className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-blue-500 transition-all"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-500 uppercase">Access Code</label>
              <PasswordInput
                value={accessCode}
                onChange={(e) => setAccessCode(e.target.value)}
                placeholder="••••••"
                className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-blue-500 transition-all"
              />
            </div>
            <button
              onClick={() => setIsLoggedIn(true)}
              className="w-full bg-slate-900 text-white font-bold py-4 rounded-xl hover:bg-slate-800 transition-all"
            >
              View My Invoices
            </button>
          </div>

          <div className="bg-blue-50 p-4 rounded-xl flex gap-3">
            <AlertCircle size={20} className="text-blue-500 shrink-0" />
            <p className="text-xs text-blue-700 leading-relaxed">
              If you don't have an access code, please contact our financial department at finance@ecorp-global.com
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="bg-white border-b border-gray-200 h-16 flex items-center justify-between px-6 sm:px-12">
        <div className="flex items-center gap-3">
          <ShieldCheck className="text-blue-600" size={24} />
          <span className="font-bold text-slate-800">B2B Customer Portal</span>
        </div>
        <div className="flex items-center gap-6">
          <div className="hidden sm:block text-right">
            <p className="text-sm font-bold text-slate-800">Alpha Corp Ltd</p>
            <p className="text-[10px] text-slate-400 font-mono">Tax ID: 123-456-789</p>
          </div>
          <button
            onClick={() => setIsLoggedIn(false)}
            className="flex items-center gap-2 text-slate-500 hover:text-rose-600 transition-colors"
          >
            <LogOut size={18} />
            <span className="text-xs font-bold">Exit</span>
          </button>
        </div>
      </header>

      <main className="flex-1 max-w-5xl w-full mx-auto p-6 sm:p-12 space-y-8">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold text-slate-800">My Recent Invoices</h2>
          <span className="text-xs font-bold text-slate-400 bg-white border border-gray-200 px-3 py-1 rounded-full uppercase">Last 30 Days</span>
        </div>

        <div className="grid grid-cols-1 gap-4">
          {mockInvoices.map((inv) => (
            <div key={inv.id} className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex flex-col sm:flex-row sm:items-center justify-between gap-6 hover:border-blue-200 transition-colors">
              <div className="flex items-center gap-5">
                <div className="w-12 h-12 bg-gray-50 rounded-xl flex items-center justify-center text-slate-400">
                  <FileText size={24} />
                </div>
                <div>
                  <h3 className="font-bold text-slate-800">{inv.internalId}</h3>
                  <p className="text-xs text-slate-400">{inv.date}</p>
                </div>
              </div>

              <div className="flex flex-col sm:items-center">
                <span className="text-lg font-bold text-slate-800">{inv.total}</span>
                <span className={`text-[10px] font-bold uppercase tracking-wider ${inv.status === 'Accepted' ? 'text-emerald-500' : 'text-amber-500'}`}>
                  {inv.status}
                </span>
              </div>

              <div className="flex items-center gap-3">
                <button className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2 border border-gray-200 rounded-xl text-sm font-semibold hover:bg-gray-50 transition-colors">
                  <Download size={18} /> PDF
                </button>
                <button
                  onClick={() => setShowRejectModal(true)}
                  className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2 bg-rose-50 text-rose-600 rounded-xl text-sm font-semibold hover:bg-rose-100 transition-colors"
                >
                  <XCircle size={18} /> Reject
                </button>
              </div>
            </div>
          ))}
        </div>
      </main>

      {showRejectModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[100] flex items-center justify-center p-6">
          <div className="bg-white w-full max-w-md rounded-3xl p-8 space-y-6 animate-in zoom-in-95 duration-200">
            <div className="flex items-center gap-3 text-rose-600">
              <XCircle size={32} />
              <h3 className="text-xl font-bold">Reject Invoice</h3>
            </div>
            <p className="text-slate-500 text-sm">
              Please provide a valid reason for rejection. This request will be sent directly to the Egyptian Tax Authority portal and our financial team.
            </p>
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-400 uppercase">Reason for Rejection</label>
              <textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="e.g. Incorrect pricing, missing items, wrong tax category..."
                className="w-full bg-gray-50 border border-gray-200 rounded-xl p-4 text-sm outline-none focus:ring-2 focus:ring-rose-500 h-32"
              />
            </div>
            <div className="flex gap-4">
              <button
                onClick={() => setShowRejectModal(false)}
                className="flex-1 py-3 text-slate-600 font-bold text-sm"
              >
                Cancel
              </button>
              <button
                onClick={() => setShowRejectModal(false)}
                disabled={!rejectReason.trim()}
                className="flex-1 bg-rose-600 text-white py-3 rounded-xl font-bold text-sm hover:bg-rose-700 disabled:opacity-50"
              >
                Submit Rejection
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CustomerPortal;
