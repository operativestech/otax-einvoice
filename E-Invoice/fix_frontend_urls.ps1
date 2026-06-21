$middlewarePath = "e:\app\OTax E-Invoice\smart-e-invoicing-middleware"

# 1. Update vite.config.ts
Write-Host "Updating vite.config.ts..." -ForegroundColor Yellow
$viteConfig = Get-Content "$middlewarePath\vite.config.ts" -Raw
$viteConfig = $viteConfig -replace "define: \{", "define: {`n        'import.meta.env.VITE_API_URL': JSON.stringify(env.VITE_API_URL),"
Set-Content "$middlewarePath\vite.config.ts" -Value $viteConfig
Write-Host "Success: vite.config.ts updated" -ForegroundColor Green

# 2. Update apiService.ts
Write-Host "`nUpdating services/apiService.ts..." -ForegroundColor Yellow
$apiServiceContent = @'
// Use environment variable from Amplify, fallback to dynamic detection
const getApiBase = () => {
    // First priority: Environment variable from Amplify
    if (import.meta.env.VITE_API_URL) {
        return import.meta.env.VITE_API_URL.replace('/api', '');
    }
    
    // Second priority: Check if running locally
    const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    if (isLocal) {
        return `${window.location.protocol}//${window.location.hostname}:3001`;
    }
    
    // Fallback: Production Render URL
    return 'https://e-invoice-545y.onrender.com';
};

const API_BASE = getApiBase();
const API_URL = `${API_BASE}/api`;

// The signer MUST always be local because it talks to the physical USB token
const SIGNER_API_URL = 'http://localhost:3001/api/signer';

// Save for other components to use
localStorage.setItem('API_BASE_URL', API_BASE);
localStorage.setItem('API_URL', API_URL);

// Export for use in other files
export { API_URL, API_BASE, SIGNER_API_URL };
'@

$existingContent = Get-Content "$middlewarePath\services\apiService.ts" -Raw
$pattern = "(?s)//.*?const API_BASE.*?localStorage\.setItem\('API_URL', API_URL\);"
$existingContent -replace $pattern, $apiServiceContent | Set-Content "$middlewarePath\services\apiService.ts"
Write-Host "Success: apiService.ts updated" -ForegroundColor Green

# 3. Update pages/Settings.tsx
Write-Host "`nUpdating pages/Settings.tsx..." -ForegroundColor Yellow
$settingsContent = Get-Content "$middlewarePath\pages\Settings.tsx" -Raw

# Add import if not present
if ($settingsContent -notmatch "import.*API_URL.*from.*apiService") {
    $settingsContent = "import { API_URL as DEFAULT_API_URL } from '../services/apiService';`n" + $settingsContent
}

# Replace hardcoded URLs
$settingsContent = $settingsContent -replace "'http://localhost:3001/api'", "DEFAULT_API_URL"
$settingsContent = $settingsContent -replace """http://localhost:3001/api""", "DEFAULT_API_URL"

Set-Content "$middlewarePath\pages\Settings.tsx" -Value $settingsContent
Write-Host "Success: Settings.tsx updated" -ForegroundColor Green

# 4. Update pages/InvoiceExcel.tsx
Write-Host "`nUpdating pages/InvoiceExcel.tsx..." -ForegroundColor Yellow
$invoiceContent = Get-Content "$middlewarePath\pages\InvoiceExcel.tsx" -Raw

# Add import if not present
if ($invoiceContent -notmatch "import.*API_URL.*from.*apiService") {
    $invoiceContent = "import { API_URL } from '../services/apiService';`n" + $invoiceContent
}

# Replace hardcoded URLs
$invoiceContent = $invoiceContent -replace "'http://localhost:3001/api/excel/parse'", '`${API_URL}/excel/parse`'
$invoiceContent = $invoiceContent -replace "'http://localhost:3001/api/excel/calculate'", '`${API_URL}/excel/calculate`'
$invoiceContent = $invoiceContent -replace "'http://localhost:3001/api/excel/submit'", '`${API_URL}/excel/submit`'

Set-Content "$middlewarePath\pages\InvoiceExcel.tsx" -Value $invoiceContent
Write-Host "Success: InvoiceExcel.tsx updated" -ForegroundColor Green

# 5. Update pages/Wizard.tsx
Write-Host "`nUpdating pages/Wizard.tsx..." -ForegroundColor Yellow
$wizardContent = Get-Content "$middlewarePath\pages\Wizard.tsx" -Raw

# Add import if not present
if ($wizardContent -notmatch "import.*API_URL.*from.*apiService") {
    $wizardContent = "import { API_URL } from '../services/apiService';`n" + $wizardContent
}

# Replace hardcoded URL
$wizardContent = $wizardContent -replace "'http://localhost:3001/api/setup'", '`${API_URL}/setup`'

Set-Content "$middlewarePath\pages\Wizard.tsx" -Value $wizardContent
Write-Host "Success: Wizard.tsx updated" -ForegroundColor Green

# 6. Add .env file
Write-Host "`nUpdating .env file..." -ForegroundColor Yellow
$envPath = "$middlewarePath\.env"
if (Test-Path $envPath) {
    $envContent = Get-Content $envPath -Raw
    if ($envContent -notmatch "VITE_API_URL") {
        Add-Content $envPath "`nVITE_API_URL=https://e-invoice-545y.onrender.com/api"
    }
}
else {
    Set-Content $envPath "VITE_API_URL=https://e-invoice-545y.onrender.com/api"
}
Write-Host "Success: .env file updated" -ForegroundColor Green

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "All files updated successfully!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "`nNext steps:" -ForegroundColor Yellow
Write-Host "1. cd 'e:\app\OTax E-Invoice\smart-e-invoicing-middleware'"
Write-Host "2. npm run build"
Write-Host "3. git add ."
Write-Host "4. git commit -m 'Fix API URL configuration'"
Write-Host "5. git push origin frontend"
