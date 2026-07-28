param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$')]
    [string]$CandidateId,

    [string]$LocalDate = (Get-Date -Format "yyyy-MM-dd"),

    [string]$NodePath,

    [string]$PythonPath,

    [switch]$DryRun
)

$ErrorActionPreference = "Stop"

function Resolve-Runtime {
    param([string]$ExplicitPath, [string[]]$Commands, [string]$BundledRelativePath)

    if ($ExplicitPath) {
        if (-not (Test-Path -LiteralPath $ExplicitPath)) { throw "Runtime not found: $ExplicitPath" }
        return (Resolve-Path -LiteralPath $ExplicitPath).Path
    }
    foreach ($commandName in $Commands) {
        $command = Get-Command $commandName -ErrorAction SilentlyContinue
        if ($command) { return $command.Source }
    }
    $bundled = Join-Path $env:USERPROFILE ".cache/codex-runtimes/codex-primary-runtime/dependencies/$BundledRelativePath"
    if (Test-Path -LiteralPath $bundled) { return (Resolve-Path -LiteralPath $bundled).Path }
    throw "Required runtime not found: $($Commands -join ', ')"
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$candidateRoot = Join-Path $repoRoot "discovery/$CandidateId"
if (-not (Test-Path -LiteralPath $candidateRoot)) { throw "Candidate discovery root not found: $candidateRoot" }

$node = Resolve-Runtime $NodePath @("node") "node/bin/node.exe"
$python = Resolve-Runtime $PythonPath @("python", "python3") "python/python.exe"
$runner = Join-Path $repoRoot "runtime/src/cli/daily-runner.mjs"
$arguments = @(
    $runner,
    "--candidate", $CandidateId,
    "--date", $LocalDate,
    "--candidate-root", $candidateRoot,
    "--repo-root", $repoRoot,
    "--python", $python
)
if ($DryRun) { $arguments += "--dry-run" }

& $node @arguments
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
