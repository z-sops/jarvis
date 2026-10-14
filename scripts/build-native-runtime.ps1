# Explicit invocation authorizes build-time downloads/installations inside the
# new image. Does not modify Orbit settings, host CLI installs or existing jobs.
$ErrorActionPreference = 'Stop'
$endpoint = 'npipe:////./pipe/dockerDesktopLinuxEngine'
$context = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../containers/native-runtime'))
$lock = Get-Content -LiteralPath (Join-Path $context 'runtime-lock.json') -Raw | ConvertFrom-Json
$kind = & docker --host $endpoint info --format '{{.OSType}}/{{.Architecture}}'
if ($LASTEXITCODE -ne 0 -or $kind.Trim() -ne 'linux/x86_64') { throw 'Local Docker Linux amd64 engine required.' }
function Confirm-Base {
    $id = & docker --host $endpoint image inspect $lock.base.name --format '{{.Id}}'
    if ($LASTEXITCODE -ne 0 -or $id.Trim() -ne $lock.base.id) {
        throw 'Installed base image tag does not match reviewed immutable image ID. No build started.'
    }
}
Confirm-Base
$tag = 'orbit-native-runtime:hermes0.21.6-opencode1.18.35'
& docker --host $endpoint build --pull=false --platform linux/amd64 --tag $tag $context
if ($LASTEXITCODE -ne 0) { throw 'Image build failed; do not configure it in Orbit.' }
Confirm-Base
$id = & docker --host $endpoint image inspect $tag --format '{{.Id}}'
if ($LASTEXITCODE -ne 0 -or $id -notmatch '^sha256:[a-f0-9]{64}$') { throw 'Cannot verify resulting image ID.' }
Write-Output "Built candidate image: $id"
& node (Join-Path $PSScriptRoot 'native-runtime-check.js') $id
if ($LASTEXITCODE -ne 0) { throw 'Contained CLI diagnostic failed; do not configure this image.' }
Write-Output 'CLI/isolation checks passed. Native task/provider/MCP compatibility remains unverified.'
