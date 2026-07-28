param(
    [string]$ChromePath,
    [string]$ProfilePath = (Join-Path $env:LOCALAPPDATA "Kuafu/chrome-profile"),
    [string]$NodePath
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
if (-not $NodePath) {
    $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
    if ($nodeCommand) {
        $NodePath = $nodeCommand.Source
    }
    else {
        $NodePath = Join-Path $env:USERPROFILE ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe"
    }
}
if (-not (Test-Path -LiteralPath $NodePath)) { throw "Node runtime not found: $NodePath" }

$preflight = Join-Path $repoRoot "runtime/src/cli/browser-preflight.mjs"
$arguments = @($preflight, "--profile-path", $ProfilePath)
if ($ChromePath) { $arguments += @("--chrome", $ChromePath) }

& $NodePath @arguments
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
