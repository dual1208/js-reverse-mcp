# Run interactively in PowerShell. Uses the real Google Chrome GUI application.
$ErrorActionPreference = 'Stop'
& winget list --id Google.Chrome --exact --source winget
if ($LASTEXITCODE -ne 0) {
    & winget install --id Google.Chrome --exact --source winget
    if ($LASTEXITCODE -ne 0) { throw "Chrome installation failed ($LASTEXITCODE)." }
}
