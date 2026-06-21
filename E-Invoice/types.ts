
export enum AppView {
  LOGIN = 'login',
  WIZARD = 'wizard',
  DASHBOARD = 'dashboard',
  INVOICES = 'invoices',
  INVOICE_EXCEL = 'invoice_excel',
  MANUAL_INVOICE = 'manual_invoice',
  REPORTS = 'reports',
  MASTER_DATA = 'master_data',
  SETTINGS = 'settings',
  SYSTEM_HEALTH = 'system_health',
  CUSTOMER_PORTAL = 'customer_portal',
  DASHBOARD_CREATOR = 'dashboard_creator',
  ETA_REFERENCE = 'eta_reference'
}

export interface Invoice {
  id: string;
  internalId: string;
  receiverId: string;
  receiverName: string;
  date: string;
  total: number;
  status: 'Valid' | 'Invalid' | 'Submitted' | 'Rejected' | 'Draft' | 'Cancelled' | 'CancelRequest' | 'RejectRequest' | 'DeclinedCancel' | 'DeclinedReject' | 'RequestedCancel' | 'RequestedReject';
  currency: string;
  errorCode?: string;
  canbeCancelledUntil?: string;
  canbeRejectedUntil?: string;
}

export interface LogEntry {
  timestamp: string;
  message: string;
  type: 'info' | 'success' | 'error' | 'warning';
}

export interface UserRole {
  id: number;
  name: string;
  displayName: string;
}

export interface UserOrganization {
  id: number;
  name: string;
  tax_id: string;
  logo_url?: string;
  primary_color?: string;
  subscription_plan?: string;
}

export interface User {
  id?: number;
  name: string;
  username?: string;
  role: string;
  avatar?: string;
  isDemo?: boolean;
  isSuperAdmin?: boolean;
  isOrgAdmin?: boolean;
  roles?: UserRole[];
  permissions?: string[];
  organization?: UserOrganization | null;
  properties?: any[];
  token?: string;
}

export interface KPIData {
  label: string;
  value: string | number;
  trend: number;
  icon: string;
}
