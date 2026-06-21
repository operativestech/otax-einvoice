# E-Invoice URL Reference Guide

## Quick URL Reference

### Public Routes (No Authentication Required)
- **Login Page:** `http://localhost:3001/login`
- **Setup Wizard:** `http://localhost:3001/wizard`
- **Customer Portal:** `http://localhost:3001/customer-portal`

### Protected Routes (Authentication Required)

#### Main Application
- **Dashboard (Home):** `http://localhost:3001/` or `http://localhost:3001/dashboard`
- **Invoice Search:** `http://localhost:3001/invoices`
- **Import Excel:** `http://localhost:3001/import` ⭐ (As requested)
- **Manual Invoice Entry:** `http://localhost:3001/manual-invoice`

#### Integration & Data
- **ERP Connector:** `http://localhost:3001/erp-connector`
- **Master Data:** `http://localhost:3001/master-data`

#### Analytics & Monitoring
- **Reports:** `http://localhost:3001/reports`
- **System Health:** `http://localhost:3001/system-health`

#### Configuration
- **Settings:** `http://localhost:3001/settings`
- **Dashboard Creator:** `http://localhost:3001/dashboard-creator`
- **ETA Reference:** `http://localhost:3001/eta-reference`

## URL Mapping (Old vs New)

| Old State-Based View | New URL Path | Description |
|---------------------|--------------|-------------|
| `AppView.LOGIN` | `/login` | User login page |
| `AppView.WIZARD` | `/wizard` | Initial setup wizard |
| `AppView.DASHBOARD` | `/dashboard` | Main dashboard |
| `AppView.INVOICES` | `/invoices` | Invoice search & management |
| `AppView.INVOICE_EXCEL` | `/import` | Excel import page ⭐ |
| `AppView.MANUAL_INVOICE` | `/manual-invoice` | Manual invoice entry |
| `AppView.ERP_CONNECTOR` | `/erp-connector` | ERP integration |
| `AppView.MASTER_DATA` | `/master-data` | Master data management |
| `AppView.REPORTS` | `/reports` | Reports & analytics |
| `AppView.SETTINGS` | `/settings` | Application settings |
| `AppView.SYSTEM_HEALTH` | `/system-health` | System monitoring |
| `AppView.CUSTOMER_PORTAL` | `/customer-portal` | Customer-facing portal |
| `AppView.DASHBOARD_CREATOR` | `/dashboard-creator` | UI builder |
| `AppView.ETA_REFERENCE` | `/eta-reference` | ETA documentation |

## Production URLs

When deployed, replace `localhost:3001` with your production domain:

### Example Production URLs
- Login: `https://yourdomain.com/login`
- Import: `https://yourdomain.com/import`
- Dashboard: `https://yourdomain.com/dashboard`

## Navigation Examples

### From Code (Programmatic)
```typescript
import { useNavigate } from 'react-router-dom';

const MyComponent = () => {
  const navigate = useNavigate();
  
  // Navigate to import page
  navigate('/import');
  
  // Navigate to dashboard
  navigate('/dashboard');
  
  // Navigate with replace (no history entry)
  navigate('/login', { replace: true });
};
```

### From JSX (Declarative)
```typescript
import { Link } from 'react-router-dom';

const MyComponent = () => {
  return (
    <div>
      <Link to="/import">Import Excel</Link>
      <Link to="/invoices">View Invoices</Link>
    </div>
  );
};
```

### From Browser
Simply type the URL in the address bar:
```
http://localhost:3001/import
```

## API Endpoints (Unchanged)

All API endpoints remain at `/api/*`:
- `POST /api/login`
- `POST /api/setup`
- `GET /api/health`
- `GET /api/invoices`
- etc.

## Notes

1. **Case Sensitivity:** URLs are case-sensitive. Use lowercase paths.
2. **Trailing Slashes:** Both `/import` and `/import/` work the same.
3. **404 Handling:** Unknown routes redirect to login if not authenticated.
4. **Deep Linking:** All routes support direct access via URL.
5. **Bookmarking:** Users can bookmark any page for quick access.
