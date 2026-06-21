import React from 'react';
import { AlertTriangle, CheckCircle2, Info, XCircle, AlertCircle } from 'lucide-react';

interface ModernDialogProps {
    isOpen: boolean;
    type: 'confirm' | 'success' | 'error' | 'info';
    title: string;
    message: string;
    onConfirm?: () => void;
    onCancel: () => void;
    confirmText?: string;
    cancelText?: string;
}

const ModernDialog: React.FC<ModernDialogProps> = ({
    isOpen,
    type,
    title,
    message,
    onConfirm,
    onCancel,
    confirmText = "OK",
    cancelText = "Cancel"
}) => {
    if (!isOpen) return null;

    const getIcon = () => {
        switch (type) {
            case 'confirm': return <AlertTriangle size={32} className="text-amber-500" />;
            case 'success': return <CheckCircle2 size={32} className="text-emerald-500" />;
            case 'error': return <AlertCircle size={32} className="text-rose-500" />;
            default: return <Info size={32} className="text-blue-500" />;
        }
    };

    const getConfirmButtonClass = () => {
        switch (type) {
            case 'confirm': return "bg-slate-800 hover:bg-slate-900 shadow-slate-200 border border-transparent";
            case 'error': return "bg-rose-600 hover:bg-rose-700 shadow-rose-200 border border-transparent";
            case 'success': return "bg-emerald-600 hover:bg-emerald-700 shadow-emerald-200 border border-transparent";
            default: return "bg-blue-600 hover:bg-blue-700 shadow-blue-200 border border-transparent";
        }
    };

    return (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-in fade-in duration-200">
            <div
                className="bg-white rounded-[32px] shadow-2xl w-full max-w-sm p-8 animate-in zoom-in-95 duration-200 border border-white/40 ring-1 ring-black/5 flex flex-col items-center text-center relative overflow-hidden"
                role="dialog"
                aria-modal="true"
            >
                {/* Ambient Background Glow */}
                <div className={`absolute top-0 left-0 w-full h-2 bg-gradient-to-r ${type === 'confirm' ? 'from-amber-400 to-orange-500' :
                        type === 'success' ? 'from-emerald-400 to-teal-500' :
                            type === 'error' ? 'from-rose-400 to-red-500' : 'from-blue-400 to-indigo-500'
                    }`} />

                <div className={`mb-6 p-4 rounded-3xl bg-opacity-10 ${type === 'confirm' ? 'bg-amber-100' :
                        type === 'success' ? 'bg-emerald-100' :
                            type === 'error' ? 'bg-rose-100' : 'bg-blue-100'
                    }`}>
                    {getIcon()}
                </div>

                <h3 className="text-xl font-bold text-slate-800 mb-2 tracking-tight">{title}</h3>
                <p className="text-slate-500 text-sm font-medium leading-relaxed mb-8">{message}</p>

                <div className="flex gap-3 w-full">
                    {type === 'confirm' && (
                        <button
                            onClick={onCancel}
                            className="flex-1 py-3.5 px-4 bg-white border border-gray-200 text-slate-600 font-bold rounded-2xl hover:bg-gray-50 hover:border-gray-300 transition-all text-sm"
                        >
                            {cancelText}
                        </button>
                    )}
                    <button
                        onClick={() => {
                            if (onConfirm) onConfirm();
                            else onCancel();
                        }}
                        className={`flex-1 py-3.5 px-4 text-white font-bold rounded-2xl shadow-lg transition-all transform hover:scale-[1.02] active:scale-[0.98] text-sm ${getConfirmButtonClass()}`}
                    >
                        {confirmText}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ModernDialog;
