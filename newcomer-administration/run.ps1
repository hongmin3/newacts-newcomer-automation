param([Parameter(ValueFromRemainingArguments=$true)][string[]]$Arguments)
$ErrorActionPreference = 'Stop'
$env:PYTHONUTF8 = '1'
$pythonPath = Join-Path $PSScriptRoot '.venv/Scripts/python.exe'
if (-not (Test-Path -LiteralPath $pythonPath)) {
    Write-Error '전용 Python 환경이 없습니다. 설치 안내를 확인하세요.'
    exit 1
}
& $pythonPath -B (Join-Path $PSScriptRoot 'main.py') @Arguments
exit $LASTEXITCODE
