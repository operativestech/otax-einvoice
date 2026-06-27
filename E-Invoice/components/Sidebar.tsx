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
  FolderOpen,
  Send,
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

const Sidebar: React.FC<SidebarProps> = ({ isExpanded, onExpand, user }) => {
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

  const appMenuItems: MenuItem[] = [
    { label: 'WORKSPACE', isHeader: true },
    { path: '/dashboard', label: t('nav.dashboard'), icon: <LayoutDashboard size={18} />, permission: 'dashboard.view' },
    
    { label: 'DOCUMENTS HUB', isHeader: true },
    { path: '/manual-invoice', label: t('nav.manualInvoice'), icon: <PlusCircle size={18} />, permission: 'invoices.create' },
    { path: '/import', label: t('nav.import'), icon: <FileSpreadsheet size={18} />, permission: 'invoices.create' },
    { path: '/export-eta', label: t('nav.exportEta'), icon: <UploadCloud size={18} />, permission: 'invoices.create' },
    
    { label: 'ETA SUBMISSIONS', isHeader: true },
    { path: '/invoices', label: t('nav.invoices'), icon: <FileText size={18} />, permission: 'invoices.view' },
    { path: '/eta-reference', label: 'ETA Reference', icon: <Send size={18} /> },
    { path: '/export-packages', label: t('nav.exportPackages'), icon: <Package size={18} />, permission: 'reports.view' },

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

  // Filter out empty headers (if permissions hid all their children)
  const cleanedMenuItems = visibleMenuItems.filter((item, index, array) => {
    if (item.isHeader) {
      const nextItem = array[index + 1];
      if (!nextItem || nextItem.isHeader) return false;
    }
    return true;
  });

  return (
    <aside
      className={`bg-white/80 backdrop-blur-xl border-r border-slate-200/60 text-slate-600 flex flex-col h-full transition-all duration-300 ease-in-out z-40 ${isExpanded ? 'w-64' : 'w-20'}`}
      onMouseEnter={() => onExpand(true)}
      onMouseLeave={() => onExpand(false)}
    >
      {/* Logo */}
      <div className="p-4 flex items-center gap-3 overflow-hidden border-b border-slate-100 h-16 shrink-0">
        <div className="bg-primary-600 p-2 rounded-xl shadow-soft shrink-0">
          <ShieldCheck size={24} className="text-white" />
        </div>
        <span className={`font-bold text-lg text-slate-800 whitespace-nowrap transition-opacity duration-300 ${isExpanded ? 'opacity-100' : 'opacity-0'}`}>
          OTax Premium
        </span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-4 space-y-1">
        {cleanedMenuItems.map((item, idx) => {
          if (item.isHeader) {
            return (
              <div key={`header-${idx}`} className={`px-6 pt-4 pb-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest transition-opacity duration-300 ${isExpanded ? 'opacity-100' : 'opacity-0 hidden'}`}>
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
              className={`w-full flex items-center py-2.5 gap-3 transition-all duration-200 group relative ${isExpanded ? 'px-4 mx-3 rounded-xl w-[calc(100%-24px)]' : 'justify-center mx-2 rounded-xl w-[calc(100%-16px)]'} ${isActive
                  ? 'bg-primary-50 text-primary-700 font-semibold shadow-sm'
                  : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'
                }`}
            >
              <div className={`shrink-0 transition-colors ${isActive ? 'text-primary-600' : 'text-slate-400 group-hover:text-primary-500'}`}>
                {item.icon}
              </div>
              <span className={`whitespace-nowrap transition-all duration-300 text-sm ${isExpanded ? 'opacity-100' : 'opacity-0 absolute'}`}>
                {item.label}
              </span>
              {isExpanded && item.badge && (
                <span className="ml-auto bg-emerald-100 text-emerald-700 border border-emerald-200 text-[10px] font-bold px-1.5 py-0.5 rounded-md">
                  {item.badge}
                </span>
              )}
              {!isExpanded && (
                <div className="absolute left-full ml-3 px-3 py-1.5 bg-slate-800 text-white text-xs font-medium rounded-lg opacity-0 group-hover:opacity-100 pointer-events-none transition-all shadow-lg whitespace-nowrap z-50 transform translate-x-2 group-hover:translate-x-0">
                  {item.label}
                </div>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Bottom: Role badge */}
      {isExpanded && user && (
        <div className="p-4 border-t border-slate-100 bg-slate-50/50">
          <div className={`text-[10px] font-bold uppercase tracking-widest px-2 py-1.5 rounded-lg text-center shadow-sm ${isSuperAdmin
            ? 'bg-amber-100 text-amber-700 border border-amber-200'
            : isOrgAdmin
              ? 'bg-primary-100 text-primary-700 border border-primary-200'
              : 'bg-white text-slate-600 border border-slate-200'
            }`}>
            {isSuperAdmin ? '⚡ Super Admin' : isOrgAdmin ? '🏢 Org Admin' : user.role || 'User'}
          </div>
          {user.organization?.name && (
            <p className="text-xs font-medium text-slate-600 text-center mt-2 truncate">{user.organization.name}</p>
          )}
        </div>
      )}
    </aside>
  );
};

export default Sidebar;
