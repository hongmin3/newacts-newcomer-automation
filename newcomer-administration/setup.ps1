param([string]$PythonPath = "$env:LOCALAPPDATA/Programs/Python/Python313/python.exe")
$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $PythonPath)) { throw 'Python 3.13 실행파일 경로를 지정하세요.' }
$venvPython = Join-Path $PSScriptRoot '.venv/Scripts/python.exe'
if (-not (Test-Path -LiteralPath $venvPython)) {
    & $PythonPath -m venv (Join-Path $PSScriptRoot '.venv')
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
& $venvPython -m pip install -r (Join-Path $PSScriptRoot 'requirements.txt')
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& $venvPython -B (Join-Path $PSScriptRoot 'main.py') doctor
exit $LASTEXITCODE
