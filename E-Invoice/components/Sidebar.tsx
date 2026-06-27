import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  FileText,
  PlusCircle,
  BarChart3,
  Database,
  Activity,
  Settings,
  ShieldCheck,
  FileSpreadsheet,
  UploadCloud,
  Package,
  GitCompare,
  Building2,
  UserCog,
  CreditCard,
  Lock,
  ClipboardList,
  Send,
  Sparkles,
  ArrowRight,
} from 'lucide-react';
import { User } from '../types';
import { useTranslation } from '../i18n';

interface SidebarProps {
  isExpanded: boolean;
  onExpand: (expanded: boolean) => void;
  user?: User | null;
}

interface MenuItem {
  path?: string;
  label: string;
  icon?: React.ReactNode;
  permission?: string;
  superAdminOnly?: boolean;
  orgAdminOnly?: boolean;
  badge?: string;
  isHeader?: boolean;
}

const SidebarLogo = () => (
  <div className="flex items-center gap-2">
    <div className="relative w-8 h-8 flex-shrink-0">
      <svg viewBox="0 0 24 24" fill="none" className="w-full h-full drop-shadow-sm">
        <path d="M12 2L3.5 7V17L12 22L20.5 17V7L12 2Z" fill="url(#sidebar-hex-grad)" />
        <path d="M12 6.5L6.5 9.7V14.3L12 17.5L17.5 14.3V9.7L12 6.5Z" fill="white" fillOpacity="0.15" />
        <path d="M12 8.5L8.5 10.5V13.5L12 15.5L15.5 13.5V10.5L12 8.5Z" fill="white" />
        <defs>
          <linearGradient id="sidebar-hex-grad" x1="3.5" y1="2" x2="20.5" y2="22" gradientUnits="userSpaceOnUse">
            <stop stopColor="#3b82f6" />
            <stop offset="1" stopColor="#1d4ed8" />
          </linearGradient>
        </defs>
      </svg>
    </div>
    <span className="text-xl font-bold tracking-tight text-slate-800">OTax</span>
  </div>
);

const Sidebar: React.FC<SidebarProps> = ({ user }) => {
  const location = useLocation();
  const { t, lang } = useTranslation();

  const permissions = user?.permissions || [];
  const isSuperAdmin = user?.isSuperAdmin || false;
  const isOrgAdmin = user?.isOrgAdmin || false;

  const hasPermission = (permission?: string): boolean => {
    if (!permission) return true;
    if (isOrgAdmin) return true;
    return permissions.includes(permission);
  };

  const superAdminMenuItems: MenuItem[] = [
    { label: 'SUPER ADMIN', isHeader: true },
    { path: '/super-admin', label: lang === 'ar' ? 'المنظمات' : 'Organizations', icon: <Building2 size={18} /> },
    { path: '/super-admin/plans', label: lang === 'ar' ? 'الخطط والأسعار' : 'Plans & Pricing', icon: <CreditCard size={18} /> },
    { path: '/super-admin/roles', label: lang === 'ar' ? 'الصلاحيات' : 'Roles & Permissions', icon: <Lock size={18} /> },
    { path: '/super-admin/activity', label: lang === 'ar' ? 'سجل النشاط' : 'Activity Logs', icon: <ClipboardList size={18} /> },
  ];

  // Modified order: ETA SUBMISSIONS first, then DOCUMENTS HUB
  const appMenuItems: MenuItem[] = [
    { label: 'WORKSPACE', isHeader: true },
    { path: '/dashboard', label: t('nav.dashboard'), icon: <LayoutDashboard size={18} />, permission: 'dashboard.view' },
    
    { label: 'ETA SUBMISSIONS', isHeader: true },
    { path: '/invoices', label: t('nav.invoices'), icon: <FileText size={18} />, permission: 'invoices.view' },
    { path: '/eta-reference', label: 'ETA Reference', icon: <Send size={18} /> },
    { path: '/export-packages', label: t('nav.exportPackages'), icon: <Package size={18} />, permission: 'reports.view' },

    { label: 'DOCUMENTS HUB', isHeader: true },
    { path: '/manual-invoice', label: t('nav.manualInvoice'), icon: <PlusCircle size={18} />, permission: 'invoices.create' },
    { path: '/import', label: t('nav.import'), icon: <FileSpreadsheet size={18} />, permission: 'invoices.create' },
    { path: '/export-eta', label: t('nav.exportEta'), icon: <UploadCloud size={18} />, permission: 'invoices.create' },

    { label: 'ANALYTICS & DATA', isHeader: true },
    { path: '/reports', label: t('nav.reports'), icon: <BarChart3 size={18} />, permission: 'reports.view' },
    { path: '/reconciliation', label: t('nav.reconciliation'), icon: <GitCompare size={18} />, permission: 'reports.view', badge: 'New' },
    { path: '/master-data', label: t('nav.masterData'), icon: <Database size={18} />, permission: 'masterdata.view' },
    { path: '/system-health', label: t('nav.systemHealth'), icon: <Activity size={18} /> },
    
    { label: 'ADMINISTRATION', isHeader: true },
    { path: '/settings', label: t('nav.settings'), icon: <Settings size={18} />, permission: 'settings.view' },
    { path: '/admin/users', label: t('nav.users'), icon: <UserCog size={18} />, permission: 'org_users.view', orgAdminOnly: true },
  ];

  const visibleMenuItems = isSuperAdmin
    ? superAdminMenuItems
    : appMenuItems.filter(item => {
      if (item.isHeader) return true;
      if (item.orgAdminOnly && !isOrgAdmin) return false;
      return hasPermission(item.permission);
    });

  const cleanedMenuItems = visibleMenuItems.filter((item, index, array) => {
    if (item.isHeader) {
      const nextItem = array[index + 1];
      if (!nextItem || nextItem.isHeader) return false;
    }
    return true;
  });

  return (
    <aside className="bg-slate-50 border-r border-slate-200/60 text-slate-600 flex flex-col h-full w-64 shrink-0 relative z-40 select-none">
      
      {/* Logo */}
      <div className="p-5 flex items-center justify-between border-b border-slate-200/50 h-16 shrink-0 bg-white">
        <SidebarLogo />
      </div>

      {/* Navigation list */}
      <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-0.5 custom-scrollbar">
        {cleanedMenuItems.map((item, idx) => {
          if (item.isHeader) {
            return (
              <div key={`header-${idx}`} className="px-3 pt-4 pb-1 text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                {item.label}
              </div>
            );
          }

          const isActive = location.pathname === item.path ||
            (item.path !== '/dashboard' && item.path !== '/' && location.pathname.startsWith(item.path!));

          return (
            <Link
              key={item.path}
              to={item.path!}
              className={`w-full flex items-center py-2 px-3 gap-3 transition-all duration-200 rounded-xl ${isActive
                  ? 'bg-blue-600 text-white font-bold shadow-[0_8px_20px_rgba(37,99,235,0.25)]'
                  : 'text-slate-600 hover:bg-slate-200/50 hover:text-slate-900 font-medium'
                }`}
            >
              <div className={`shrink-0 transition-colors ${isActive ? 'text-white' : 'text-slate-400'}`}>
                {item.icon}
              </div>
              <span className="whitespace-nowrap text-sm">
                {item.label}
              </span>
              {item.badge && (
                <span className={`ml-auto border text-[9px] font-bold px-1.5 py-0.5 rounded-md ${isActive ? 'bg-white/20 text-white border-white/20' : 'bg-emerald-100 text-emerald-700 border-emerald-200'}`}>
                  {item.badge}
                </span>
              )}
            </Link>
          );
        })}

        {/* Seamless e-invoicing card at the bottom of sidebar from mockup */}
        <div className="pt-6">
          <div className="bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-100 rounded-2xl p-4 space-y-3 relative overflow-hidden shadow-sm">
            <div className="absolute right-[-10px] bottom-[-10px] w-20 h-20 bg-blue-500/5 blur-lg rounded-full pointer-events-none" />
            
            {/* Tiny Document Icon Card */}
            <div className="w-8 h-8 rounded-lg bg-blue-600/10 flex items-center justify-center text-blue-600">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-4 h-4">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
                <polyline points="10 9 9 9 8 9" />
              </svg>
            </div>

            <div className="space-y-1">
              <h4 className="text-xs font-bold text-slate-800">Seamless e-invoicing</h4>
              <p className="text-[10px] text-slate-500 leading-normal">Trusted. Compliant. Future-Ready.</p>
            </div>

            <Link to="/settings/tokensign" className="inline-flex items-center gap-1 text-[10px] font-bold text-blue-600 hover:text-blue-700">
              Learn more <ArrowRight size={10} />
            </Link>
          </div>
        </div>

      </nav>

      {/* Role badge */}
      {user && (
        <div className="p-4 border-t border-slate-200/50 bg-white">
          <div className={`text-[10px] font-bold uppercase tracking-widest px-2 py-1.5 rounded-lg text-center shadow-sm ${isSuperAdmin
            ? 'bg-amber-50 text-amber-700 border border-amber-200'
            : isOrgAdmin
              ? 'bg-blue-50 text-blue-700 border border-blue-200'
              : 'bg-slate-50 text-slate-600 border border-slate-200'
            }`}>
            {isSuperAdmin ? '⚡ Super Admin' : isOrgAdmin ? '🏢 Org Admin' : user.role || 'User'}
          </div>
          {user.organization?.name && (
            <p className="text-[10px] font-semibold text-slate-500 text-center mt-2 truncate">{user.organization.name}</p>
          )}
        </div>
      )}
    </aside>
  );
};

export default Sidebar;
