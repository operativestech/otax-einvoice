
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
} from 'lucide-react';
import { User } from '../types';
import { useTranslation } from '../i18n';

interface SidebarProps {
  isExpanded: boolean;
  onExpand: (expanded: boolean) => void;
  user?: User | null;
}

interface MenuItem {
  path: string;
  label: string;
  icon: React.ReactNode;
  permission?: string;
  superAdminOnly?: boolean;
  orgAdminOnly?: boolean;
  badge?: string;
  dividerBefore?: boolean;
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

  // ── Super Admin sees ONLY management items ──
  const superAdminMenuItems: MenuItem[] = [
    { path: '/super-admin', label: lang === 'ar' ? 'المنظمات' : 'Organizations', icon: <Building2 size={18} /> },
    { path: '/super-admin/plans', label: lang === 'ar' ? 'الخطط والأسعار' : 'Plans & Pricing', icon: <CreditCard size={18} /> },
    { path: '/super-admin/roles', label: lang === 'ar' ? 'الصلاحيات' : 'Roles & Permissions', icon: <Lock size={18} /> },
    { path: '/super-admin/activity', label: lang === 'ar' ? 'سجل النشاط' : 'Activity Logs', icon: <ClipboardList size={18} /> },
  ];

  // ── Regular users see app items. Labels come from the i18n dictionary
  //    so they flip automatically when the user toggles language. ──
  const appMenuItems: MenuItem[] = [
    { path: '/dashboard', label: t('nav.dashboard'), icon: <LayoutDashboard size={18} />, permission: 'dashboard.view' },
    { path: '/invoices', label: t('nav.invoices'), icon: <FileText size={18} />, permission: 'invoices.view' },
    { path: '/export-eta', label: t('nav.exportEta'), icon: <div className="text-emerald-500"><UploadCloud size={18} /></div>, permission: 'invoices.create' },
    { path: '/import', label: t('nav.import'), icon: <FileSpreadsheet size={18} />, permission: 'invoices.create' },
    { path: '/manual-invoice', label: t('nav.manualInvoice'), icon: <PlusCircle size={18} />, permission: 'invoices.create' },
    { path: '/reports', label: t('nav.reports'), icon: <BarChart3 size={18} />, permission: 'reports.view' },
    { path: '/export-packages', label: t('nav.exportPackages'), icon: <Package size={18} />, permission: 'reports.view' },
    { path: '/reconciliation', label: t('nav.reconciliation'), icon: <GitCompare size={18} />, permission: 'reports.view', badge: 'New' },
    { path: '/master-data', label: t('nav.masterData'), icon: <Database size={18} />, permission: 'masterdata.view' },
    { path: '/system-health', label: t('nav.systemHealth'), icon: <Activity size={18} /> },
    { path: '/settings', label: t('nav.settings'), icon: <Settings size={18} />, permission: 'settings.view' },
    // ── Administration (divider before) ──
    { path: '/admin/users', label: t('nav.users'), icon: <UserCog size={18} />, permission: 'org_users.view', orgAdminOnly: true, dividerBefore: true },
  ];

  // Super admin → management only, Regular users → app items
  const visibleMenuItems = isSuperAdmin
    ? superAdminMenuItems
    : appMenuItems.filter(item => {
      if (item.orgAdminOnly && !isOrgAdmin) return false;
      return hasPermission(item.permission);
    });

  return (
    <aside
      className={`bg-slate-900 text-white flex flex-col h-full transition-all duration-300 ease-in-out z-40 ${isExpanded ? 'w-64' : 'w-20'}`}
      onMouseEnter={() => onExpand(true)}
      onMouseLeave={() => onExpand(false)}
    >
      {/* Logo — same height as TopBar */}
      <div className="p-4 flex items-center gap-3 overflow-hidden border-b border-slate-800 h-16 shrink-0">
        <div className="bg-blue-600 p-2 rounded-lg shrink-0">
          <ShieldCheck size={24} className="text-white" />
        </div>
        <span className={`font-bold text-lg whitespace-nowrap transition-opacity duration-300 ${isExpanded ? 'opacity-100' : 'opacity-0'}`}>
          OTax
        </span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-2 space-y-0.5">
        {visibleMenuItems.map((item) => {
          const isActive = location.pathname === item.path ||
            (item.path !== '/dashboard' && item.path !== '/' && location.pathname.startsWith(item.path));

          return (
            <React.Fragment key={item.path}>
              {/* Divider */}
              {item.dividerBefore && (
                <div className="mx-4 my-1.5 border-t border-slate-700/50" />
              )}

              <Link
                to={item.path}
                className={`w-full flex items-center py-1.5 gap-3 transition-colors group relative ${isExpanded ? 'px-4' : 'justify-center'
                  } ${isActive
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                  }`}
              >
                <div className="shrink-0">{item.icon}</div>
                <span className={`whitespace-nowrap transition-all duration-300 text-xs ${isExpanded ? 'opacity-100' : 'opacity-0 absolute'}`}>
                  {item.label}
                </span>
                {isExpanded && item.badge && (
                  <span className="ml-auto bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-md animate-pulse">
                    {item.badge}
                  </span>
                )}
                {!isExpanded && (
                  <div className="absolute left-full ml-2 px-2 py-1 bg-slate-800 text-white text-xs rounded opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity whitespace-nowrap z-50">
                    {item.label}
                  </div>
                )}
              </Link>
            </React.Fragment>
          );
        })}
      </nav>

      {/* Bottom: Role badge (only when expanded) */}
      {isExpanded && user && (
        <div className="p-3 border-t border-slate-800">
          <div className={`text-[10px] font-bold uppercase tracking-widest px-2 py-1.5 rounded-md text-center ${isSuperAdmin
            ? 'bg-amber-500/20 text-amber-400'
            : isOrgAdmin
              ? 'bg-blue-500/20 text-blue-400'
              : 'bg-slate-700/50 text-slate-400'
            }`}>
            {isSuperAdmin ? '⚡ Super Admin' : isOrgAdmin ? '🏢 Org Admin' : user.role || 'User'}
          </div>
          {user.organization?.name && (
            <p className="text-[10px] text-slate-500 text-center mt-1 truncate">{user.organization.name}</p>
          )}
        </div>
      )}
    </aside>
  );
};

export default Sidebar;
