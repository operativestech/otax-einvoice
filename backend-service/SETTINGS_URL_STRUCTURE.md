# Settings Page URL Structure - Updated

## ✅ Changes Made

The Settings page now uses **URL-based routing** instead of internal state. Each settings section has its own URL.

### New URL Structure

| Section | Old (State-based) | New URL | Description |
|---------|-------------------|---------|-------------|
| Company Info | Tab: company | `/settings/compinfo` | Company details and address |
| Token Signature | Tab: signer | `/settings/tokensign` | eSign token configuration |
| OTAX Connection | Tab: otax | `/settings/otaxconn` | ETA portal credentials |
| Export Rules | Tab: xml | `/settings/exportrules` | Invoice export settings |
| File Locations | Tab: paths | `/settings/fileloc` | File system paths |
| ERP Server | Tab: erp | `/settings/erpserver` | ERP connection settings |
| Log Databases | Tab: logs | `/settings/logdb` | Database configuration |
| Regional Compliance | Tab: compliance | `/settings/compliance` | Compliance settings |

---

## How It Works

### Before (State-based)
```typescript
const [activeTab, setActiveTab] = useState('company');

<button onClick={() => setActiveTab('company')}>
  Company Info
</button>
```

### After (URL-based)
```typescript
const { section } = useParams<{ section?: string }>();
const navigate = useNavigate();
const activeTab = section || 'compinfo';

<button onClick={() => navigate('/settings/tokensign')}>
  Token Signature
</button>
```

---

## Benefits

✅ **Shareable Links** - You can now share direct links to specific settings sections  
✅ **Browser History** - Back/forward buttons work correctly  
✅ **Bookmarkable** - Users can bookmark specific settings pages  
✅ **Better UX** - URL reflects current state  
✅ **No New Files** - Same Settings.tsx component, just URL-aware  

---

## Examples

### Navigate to Token Signature Settings
```
http://localhost:3001/settings/tokensign
```

### Navigate to Company Info
```
http://localhost:3001/settings/compinfo
```

### Navigate to ERP Server Settings
```
http://localhost:3001/settings/erpserver
```

### Default Settings Page
```
http://localhost:3001/settings
```
→ Automatically redirects to `/settings/compinfo`

---

## Implementation Details

### Files Modified

1. **`pages/Settings.tsx`**
   - Added `useParams` and `useNavigate` hooks
   - Updated tab IDs to URL-friendly names
   - Changed `setActiveTab` to `navigate()`
   - Updated all switch cases

2. **`App.tsx`**
   - Added route: `/settings/:section`
   - Added redirect: `/settings` → `/settings/compinfo`

### No New Files Created

The same `Settings.tsx` component handles all sections. The URL parameter determines which content to show.

---

## Testing

1. **Start the app**:
   ```bash
   npm run dev
   ```

2. **Navigate to settings**:
   - Go to http://localhost:3001/settings
   - Should redirect to http://localhost:3001/settings/compinfo

3. **Click different tabs**:
   - URL should update to `/settings/tokensign`, `/settings/otaxconn`, etc.
   - Browser back/forward should work

4. **Direct URL access**:
   - Try http://localhost:3001/settings/tokensign
   - Should open directly to Token Signature section

---

## URL Mapping Reference

```typescript
const tabs = [
  { id: 'compinfo', label: 'Company Info' },      // /settings/compinfo
  { id: 'tokensign', label: 'Token Signature' },  // /settings/tokensign
  { id: 'otaxconn', label: 'OTAX Connection' },   // /settings/otaxconn
  { id: 'exportrules', label: 'Export Rules' },   // /settings/exportrules
  { id: 'fileloc', label: 'File Locations' },     // /settings/fileloc
  { id: 'erpserver', label: 'ERP Server' },       // /settings/erpserver
  { id: 'logdb', label: 'Log Databases' },        // /settings/logdb
  { id: 'compliance', label: 'Regional Compliance' }, // /settings/compliance
];
```

---

## Future Enhancements

You can easily add more settings sections by:

1. Adding a new tab to the `tabs` array
2. Adding a new case to the `renderContent()` switch statement
3. No routing changes needed - it automatically works!

Example:
```typescript
// Add to tabs array
{ id: 'notifications', label: 'Notifications', icon: <Bell size={18} /> }

// Add to renderContent()
case 'notifications':
  return <div>Notification settings...</div>;
```

URL will be: `/settings/notifications`

---

**Status**: ✅ Complete and ready to use!
