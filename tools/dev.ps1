# Run all static checks, then print Chrome reload steps for unpacked dev install.
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
Push-Location $Root

$checks = @(
  'tools/verify-modules.js',
  'tools/verify-load-order.js',
  'tools/verify-architecture.js',
  'tools/test-pure-modules.js',
  'tools/test-bootstrap-load.js',
  'tools/test-smoke-workbooks.js'
)

foreach ($script in $checks) {
  Write-Host "`n>> node $script" -ForegroundColor Cyan
  node $script
  if ($LASTEXITCODE -ne 0) {
    Pop-Location
    exit $LASTEXITCODE
  }
}

Write-Host ''
Write-Host 'All checks passed.' -ForegroundColor Green
Write-Host ''
Write-Host 'Reload the extension in Chrome:' -ForegroundColor Yellow
Write-Host '  1. Open chrome://extensions'
Write-Host '  2. Click Reload on "CAFM Asset + PPM Importer"'
Write-Host '  3. Refresh every open Concept Evolution tab (F5)'
Write-Host ''
Write-Host 'Tip: run tools/watch-dev.ps1 in another terminal to get reload reminders on file save.'
Write-Host ''
Write-Host 'Regenerate smoke test workbooks (optional):' -ForegroundColor Yellow
Write-Host '  node tools/generate-smoke-workbook.js'

Pop-Location
