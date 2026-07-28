param(
    [string]$ChromePath,
    [string]$ProfilePath = (Join-Path $env:LOCALAPPDATA "Kuafu/chrome-profile")
)

$ErrorActionPreference = "Stop"
if (-not $ChromePath) {
    $candidates = @(
        (Join-Path $env:ProgramFiles "Google/Chrome/Application/chrome.exe"),
        (Join-Path ${env:ProgramFiles(x86)} "Google/Chrome/Application/chrome.exe"),
        (Join-Path $env:LOCALAPPDATA "Google/Chrome/Application/chrome.exe")
    )
    $ChromePath = $candidates | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
}
if (-not $ChromePath -or -not (Test-Path -LiteralPath $ChromePath)) { throw "Google Chrome executable not found" }

New-Item -ItemType Directory -Force -Path $ProfilePath | Out-Null
Start-Process -FilePath $ChromePath -ArgumentList @(
    "--user-data-dir=$ProfilePath",
    "--no-first-run",
    "https://www.linkedin.com/login"
)
Write-Host "Complete LinkedIn sign-in in the dedicated Kuafu Chrome window, then close that window."
