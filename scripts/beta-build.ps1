$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $repo
if ([Environment]::OSVersion.Platform -ne 'Win32NT') { throw 'Windows x64 build host required.' }
if (!(Test-Path 'node_modules/electron/dist/electron.exe' -PathType Leaf)) { throw 'Installed Windows Electron missing. No dependencies were installed.' }
if (!(Test-Path 'node_modules/electron-builder/cli.js' -PathType Leaf)) { throw 'Installed electron-builder missing. No dependencies were installed.' }
node scripts/check-release.js
if ($LASTEXITCODE -ne 0) { throw 'Source package check failed.' }
# Uses existing dependencies. Builder may need vendor NSIS/signing tool downloads;
# run only on an approved build host. Never publishes a GitHub release.
node node_modules/electron-builder/cli.js --win nsis --x64 --publish never
if ($LASTEXITCODE -ne 0) { throw 'Windows beta installer build failed.' }
node scripts/check-release.js --dist
if ($LASTEXITCODE -ne 0) { throw 'Built package verification failed; do not distribute.' }
$installers = @(Get-ChildItem -LiteralPath 'dist' -Filter 'Orbit-Beta-Setup-0.1.0-beta.1-x64.exe' -File)
if ($installers.Count -ne 1) { throw 'Expected one beta installer.' }
Get-FileHash -LiteralPath $installers[0].FullName -Algorithm SHA256 |
    Format-List Algorithm, Hash, Path
Write-Output 'Build produced. This is not E2E acceptance, code-signing proof or permission to publish.'
