# Watches project files and prints Chrome reload steps after each save.
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
Push-Location $Root
node tools/watch-dev.js
Pop-Location
