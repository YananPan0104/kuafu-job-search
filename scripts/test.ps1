$ErrorActionPreference = "Stop"

function Resolve-CommandPath {
    param([string[]]$Candidates)

    foreach ($candidate in $Candidates) {
        $command = Get-Command $candidate -ErrorAction SilentlyContinue
        if ($command) {
            return $command.Source
        }
    }

    throw "Required runtime not found: $($Candidates -join ', ')"
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$bundledRuntime = Join-Path $env:USERPROFILE ".cache/codex-runtimes/codex-primary-runtime/dependencies"
$python = Resolve-CommandPath @((Join-Path $bundledRuntime "python/python.exe"), "python", "python3")
$node = Resolve-CommandPath @((Join-Path $bundledRuntime "node/bin/node.exe"), "node")

$pythonTests = @(
    ".agents/skills/prepare-candidate-job-search/scripts/test_candidate_confirmations.py",
    ".agents/skills/prepare-candidate-job-search/scripts/test_candidate_search_policy.py",
    ".agents/skills/discover-linkedin-job-postings/scripts/test_query_portfolio_workflow.py",
    ".agents/skills/discover-linkedin-job-postings/scripts/test_materialize_browser_checkpoint.py",
    ".agents/skills/discover-linkedin-job-postings/scripts/test_validate_discovery_run.py",
    ".agents/skills/discover-linkedin-job-postings/scripts/test_audit_discovery_descriptions.py",
    ".agents/skills/tailor-job-application/scripts/test_materialize_screening_batch.py"
    ".agents/skills/tailor-job-application/scripts/test_detect_jd_language.py"
)

$nodeTests = @(
    ".agents/skills/discover-linkedin-job-postings/scripts/test_loading_policy.mjs",
    "runtime/test/phase1-runner.test.mjs",
    "runtime/test/phase2-browser.test.mjs",
    "runtime/test/phase3-discovery.test.mjs",
    ".agents/skills/discover-linkedin-job-postings/scripts/test_linkedin_discovery.mjs",
    ".agents/skills/discover-linkedin-job-postings/scripts/test_linkedin_split_pane_adapter.mjs"
)

Push-Location $repoRoot
try {
    foreach ($test in $pythonTests) {
        Write-Host "Running $test"
        & $python $test
        if ($LASTEXITCODE -ne 0) { throw "Test failed: $test" }
    }

    foreach ($test in $nodeTests) {
        Write-Host "Running $test"
        & $node $test
        if ($LASTEXITCODE -ne 0) { throw "Test failed: $test" }
    }
}
finally {
    Pop-Location
}

Write-Host "All tests passed."
