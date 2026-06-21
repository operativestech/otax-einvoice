
import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import TopBar from './components/TopBar';
import ErrorBoundary from './components/ErrorBoundary';
import LiveConsole from './components/LiveConsole';
import Chatbot from './components/Chatbot';
import DialogHost, { ToastHost } from './components/ConfirmDialog';
import Dashboard from './pages/Dashboard';
import Invoices from './pages/Invoices';

import InvoiceExcel from './pages/InvoiceExcel';
import ManualInvoice from './pages/ManualInvoice';
import Reports from './pages/Reports';
import MasterData from './pages/MasterData';
import Settings from './pages/Settings';
import SystemHealth from './pages/SystemHealth';
import Wizard from './pages/Wizard';
import Login from './pages/Login';
import CustomerPortal from './pages/CustomerPortal';
import ETAReference from './pages/ETAReference';
import ProfileSettings from './pages/ProfileSettings';
import ExportToETA from './pages/ExportToETA';
import ExportPackages from './pages/ExportPackages';
import Reconciliation from './pages/Reconciliation';
import UserManagement from './pages/UserManagement';
import SuperAdminOrganizations from './pages/SuperAdminOrganizations';
import SuperAdminPlans from './pages/SuperAdminPlans';
import SuperAdminRoles from './pages/SuperAdminRoles';
import SuperAdminActivity from './pages/SuperAdminActivity';
import Signup from './pages/Signup';
import ForgotPassword from './pages/ForgotPassword';
import JoinOrganization from './pages/JoinOrganization';
import AcceptInvitation from './pages/AcceptInvitation';
import InvoicePrint from './pages/InvoicePrint';
import { User } from './types';
import { installFetchInterceptor, logEvent } from './utils/consoleLogger';

// Install once at module-load — every `fetch('/api/...')` in the app will be
// mirrored into the Live Operations Console. Pages can still call
// `logEvent(...)` directly for high-signal events that need a custom message.
installFetchInterceptor();

// Protected Route Component
const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const storedUser = localStorage.getItem('invoice_user');

  if (!storedUser) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
};

// Main Layout Component
const MainLayout: React.FC = () => {
  const [isSidebarExpanded, setIsSidebarExpanded] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [isOnline, setIsOnline] = useState(true);
  const [companyName, setCompanyName] = useState('E-Corp Global Ltd');
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const storedUser = localStorage.getItem('invoice_user');
    const storedCompanyName = localStorage.getItem('company_name');

    if (storedCompanyName) {
      setCompanyName(storedCompanyName);
    }

    if (storedUser) {
      setUser(JSON.parse(storedUser));
    }
  }, []);

  const handleLogout = () => {
    const uname = user?.username || user?.name || 'user';
    setUser(null);
    localStorage.removeItem('invoice_user');
    localStorage.removeItem('token');
    localStorage.removeItem('company_name');
    localStorage.removeItem('user_properties');
    logEvent(`👋 ${uname} signed out`, 'info');
    navigate('/login');
  };

  // Log every route change so the console is a readable "breadcrumb" of the session.
  useEffect(() => {
    const path = location.pathname;
    if (path && path !== '/login') {
      // Skip the initial mount — otherwise every page load spams the console.
      logEvent(`📍 Navigated to ${path}`, 'info');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  // Don't show layout for customer portal
  if (location.pathname === '/customer-portal') {
    return <CustomerPortal />;
  }

  return (
    <div className="flex h-screen bg-gray-50 text-slate-900 overflow-hidden">
      <Sidebar
        isExpanded={isSidebarExpanded}
        onExpand={setIsSidebarExpanded}
        user={user}
      />

      <div className="flex-1 flex flex-col min-w-0 transition-all duration-300">
        <TopBar
          user={user}
          isOnline={isOnline}
          onLogout={handleLogout}
          onToggleNetwork={() => setIsOnline(!isOnline)}
          companyName={companyName}
        />

        <main className="flex-1 overflow-y-auto p-6">
          <ErrorBoundary scope="main">
          <Routes>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/invoices" element={<Invoices />} />

            <Route path="/import" element={<InvoiceExcel />} />
            <Route path="/manual-invoice" element={<ManualInvoice />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/master-data" element={<MasterData />} />
            <Route path="/settings" element={<Navigate to="/settings/compinfo" replace />} />
            <Route path="/settings/:section" element={<Settings />} />
            <Route path="/system-health" element={<SystemHealth />} />
            <Route path="/eta-reference" element={<ETAReference />} />
            <Route path="/profile" element={<ProfileSettings />} />
            <Route path="/export-eta" element={<ExportToETA />} />
            <Route path="/export-packages" element={<ExportPackages />} />
            <Route path="/reconciliation" element={<Reconciliation />} />
            <Route path="/admin/users" element={<UserManagement />} />
            <Route path="/super-admin" element={<SuperAdminOrganizations />} />
            <Route path="/super-admin/plans" element={<SuperAdminPlans />} />
            <Route path="/super-admin/roles" element={<SuperAdminRoles />} />
            <Route path="/super-admin/activity" element={<SuperAdminActivity />} />
          </Routes>
          </ErrorBoundary>
        </main>

        <LiveConsole />
        {location.pathname === '/dashboard' && <Chatbot />}
      </div>
    </div>
  );
};

// Main App Component
const App: React.FC = () => {
  const handleLogin = (u: any) => {
    localStorage.setItem('invoice_user', JSON.stringify(u));
    logEvent(`🔓 ${u?.username || u?.name || 'user'} signed in`, 'success');
    // Store JWT token separately for easy access by all pages
    if (u.token) {
      localStorage.setItem('token', u.token);
    }

    // Store company name from organization or properties
    if (u.organization?.name) {
      localStorage.setItem('company_name', u.organization.name);
    } else if (u.properties) {
      const companyProp = u.properties.find((p: any) => p.property_name === 'issuer_name');
      if (companyProp) {
        localStorage.setItem('company_name', companyProp.property_value);
      }
      localStorage.setItem('user_properties', JSON.stringify(u.properties));
    }
  };

  const handleWizardComplete = () => {
    localStorage.setItem('wizard_completed', 'true');
  };

  return (
    // React Router v6 → v7 opt-in flags. These silence the two "Future Flag
    // Warning" lines in the console and give us v7 behavior early:
    //   - v7_startTransition:    wrap state updates in React.startTransition
    //   - v7_relativeSplatPath:  fix relative route resolution inside splat routes
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      {/* Centralised confirm/alert dialog — replaces the browser-native popups
          across the whole app. Anywhere can call confirmDialog/alertDialog. */}
      <DialogHost />
      {/* Toast cards (top-right floating) — used by Save buttons across the
          settings tabs so success/error feedback is consistent + non-blocking. */}
      <ToastHost />
      <Routes>
        {/* Public Routes */}
        <Route path="/login" element={<Login onLogin={handleLogin} />} />
        <Route path="/signup" element={<Signup onLogin={handleLogin} />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/join-org" element={<JoinOrganization onLogin={handleLogin} />} />
        <Route path="/invite/:token" element={<AcceptInvitation onLogin={handleLogin} />} />
        <Route path="/wizard" element={<Wizard onComplete={handleWizardComplete} />} />
        <Route path="/customer-portal" element={<CustomerPortal />} />
        {/* Print-friendly invoice view. Protected (needs a valid JWT) but
            stands alone so it opens in a fresh tab without the main layout. */}
        <Route path="/print/invoice/:uuid" element={
          <ProtectedRoute>
            <InvoicePrint />
          </ProtectedRoute>
        } />

        {/* Protected Routes */}
        <Route
          path="/*"
          element={
            <ProtectedRoute>
              <MainLayout />
            </ProtectedRoute>
          }
        />
      </Routes>
    </BrowserRouter>
  );
};

export default App;
