param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$')]
    [string]$CandidateId,
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$')]
    [string]$RunId,
    [Parameter(Mandatory = $true)]
    [string]$CacheRun,
    [string]$PortfolioPath,
    [int]$MaxQueries = 5,
    [int]$MaxCards = 0,
    [int]$MaxUniqueJobs = 60,
    [int]$MaxDetails = 30,
    [ValidateRange(1, 50)]
    [int]$MaxPagesPerQuery = 8,
    [ValidateRange(1, 10)]
    [int]$MaxStagnantObservations = 2,
    [ValidateRange(1, 5)]
    [int]$DetailConcurrency = 5,
    [string]$ProfilePath = (Join-Path $env:LOCALAPPDATA "Kuafu/chrome-profile"),
    [string]$NodePath,
    [string]$PythonPath,
    [string]$ChromePath
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$candidateRoot = Join-Path $repoRoot "discovery/$CandidateId"
if (-not $NodePath) {
    $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
    $NodePath = if ($nodeCommand) { $nodeCommand.Source } else { Join-Path $env:USERPROFILE ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe" }
}
if (-not $PythonPath) {
    $pythonCommand = Get-Command python -ErrorAction SilentlyContinue
    $PythonPath = if ($pythonCommand) { $pythonCommand.Source } else { Join-Path $env:USERPROFILE ".cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe" }
}
if (-not (Test-Path -LiteralPath $NodePath)) { throw "Node runtime not found: $NodePath" }
if (-not (Test-Path -LiteralPath $PythonPath)) { throw "Python runtime not found: $PythonPath" }
$runner = Join-Path $repoRoot "runtime/src/cli/discovery-runner.mjs"
$arguments = @(
    $runner,
    "--repo-root", $repoRoot,
    "--candidate-root", $candidateRoot,
    "--run-id", $RunId,
    "--cache-run", $CacheRun,
    "--profile-path", $ProfilePath,
    "--python", $PythonPath,
    "--max-queries", $MaxQueries,
    "--max-cards", $MaxCards,
    "--max-unique-jobs", $MaxUniqueJobs,
    "--max-details", $MaxDetails,
    "--max-pages-per-query", $MaxPagesPerQuery,
    "--max-stagnant-observations", $MaxStagnantObservations,
    "--detail-concurrency", $DetailConcurrency
)
if ($PortfolioPath) { $arguments += @("--portfolio-path", $PortfolioPath) }
if ($ChromePath) { $arguments += @("--chrome", $ChromePath) }

& $NodePath @arguments
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
