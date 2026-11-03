# VS Code process tasks: run npm.cmd directly and preserve a failing exit code.
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('test', 'build')][string]$Action
)
$ErrorActionPreference = 'Stop'
$Frontend = Join-Path (Split-Path $PSScriptRoot -Parent) 'frontend'
$exitCode = 1
try {
    $node = (Get-Command node -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
    $npm = Join-Path (Split-Path $node -Parent) 'npm.cmd'
    if (-not (Test-Path -LiteralPath $npm)) { throw "npm.cmd was not found beside Node.js: $node" }
    Push-Location -LiteralPath $Frontend
    try {
        if (-not (Test-Path -LiteralPath 'node_modules/vite/bin/vite.js')) {
            Write-Host 'Installing the locked frontend dependencies (npm ci)...'
            & $npm ci --no-audit --no-fund
            if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
        }
        & $npm run $Action
        $exitCode = $LASTEXITCODE
    } finally { Pop-Location }
} catch {
    Write-Host "Frontend task failed: $($_.Exception.Message)" -ForegroundColor Red
}
exit $exitCode
