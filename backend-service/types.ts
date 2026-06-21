
export enum AppView {
  LOGIN = 'login',
  WIZARD = 'wizard',
  DASHBOARD = 'dashboard',
  INVOICES = 'invoices',
  ERP_CONNECTOR = 'erp_connector',
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
  status: 'Valid' | 'Invalid' | 'Submitted' | 'Rejected' | 'Draft' | 'Cancelled';
  currency: string;
  errorCode?: string;
}

export interface LogEntry {
  timestamp: string;
  message: string;
  type: 'info' | 'success' | 'error' | 'warning';
}

export interface User {
  name: string;
  role: 'Admin' | 'Operator' | 'Viewer' | 'Reporter';
  avatar?: string;
}

export interface KPIData {
  label: string;
  value: string | number;
  trend: number;
  icon: string;
}
