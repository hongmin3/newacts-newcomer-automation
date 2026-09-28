$ErrorActionPreference = "Stop"
$projectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$python = Join-Path $projectDir ".venv\Scripts\python.exe"

if (-not (Test-Path -LiteralPath $python)) {
    throw "가상환경 Python을 찾을 수 없습니다: $python"
}

Set-Location -LiteralPath $projectDir
& $python "main.py" "--monthly" "--headless" "--send-email"
exit $LASTEXITCODE
