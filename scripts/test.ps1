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
$python = Resolve-CommandPath @("python", "python3")
$node = Resolve-CommandPath @("node")

$pythonTests = @(
    ".agents/skills/prepare-candidate-job-search/scripts/test_candidate_search_policy.py",
    ".agents/skills/discover-linkedin-job-postings/scripts/test_query_portfolio_workflow.py",
    ".agents/skills/discover-linkedin-job-postings/scripts/test_validate_discovery_run.py",
    ".agents/skills/tailor-job-application/scripts/test_materialize_screening_batch.py"
)

$nodeTests = @(
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
