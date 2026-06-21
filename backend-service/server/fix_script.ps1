$path = "e:\app\OTax E-Invoice\smart-e-invoicing-middleware\server\server.ts"
$content = Get-Content $path
$index = 0
$found = $false

# Search for the duplicate line starting from index 1800 to suffice
for ($i = 1800; $i -lt $content.Count; $i++) {
    if ($content[$i] -match "// Helper to parse ADO.NET") {
        # Check if it's the second occurrence (the one we want to delete)
        # Actually, simpler: finding ANY occurrence after line 1800 is likely the duplicate 
        # because the first valid one is at line ~46.
        if ($i -gt 100) { 
            $index = $i
            $found = $true
            break
        }
    }
}

if ($found) {
    Write-Host "Found duplicate at line $($index+1). Truncating..."
    $newContent = $content[0..($index - 1)]
    $newContent += ""
    $newContent += "app.listen(port as number, '0.0.0.0', () => {"
    $newContent += "    console.log(`"Backend listening at http://0.0.0.0:`${port}`");"
    $newContent += "});"
    
    $newContent | Set-Content $path -Encoding UTF8
    Write-Host "Success!"
}
else {
    Write-Host "Duplicate start line not found."
}
