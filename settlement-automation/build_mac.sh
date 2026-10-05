#!/bin/bash
set -euo pipefail
project_dir="$(cd "$(dirname "$0")" && pwd)"
cd "$project_dir"
python_bin="$project_dir/.venv/bin/python"
if [[ "$(uname -s)" != Darwin || "$(uname -m)" != arm64 ]]; then
  echo 'Apple Silicon Mac에서 빌드해 주세요.' >&2; exit 1
fi
"$python_bin" -m pip check
"$python_bin" -c 'import subprocess,pathlib; actual=set(subprocess.check_output([".venv/bin/python","-m","pip","freeze"],text=True).splitlines()); expected=set(pathlib.Path("requirements-mac.lock").read_text().splitlines()); assert actual==expected, "잠금 파일과 설치 의존성이 다릅니다."'
# Strict resource allowlist: the source tree and operational config never become payload.
payload_dir="$(mktemp -d -t newacts-build)"
trap 'rm -rf "$payload_dir"' EXIT
cp config.example.py "$payload_dir/"
cp -R .venv/playwright-browsers "$payload_dir/playwright-browsers"
"$python_bin" -B -m desktop.bundle "$payload_dir"
NEWACTS_BROWSER_PAYLOAD="$payload_dir/playwright-browsers" "$python_bin" -m PyInstaller --noconfirm --clean settlement-mac.spec > /tmp/newacts-pyinstaller.log 2>&1 || { tail -60 /tmp/newacts-pyinstaller.log; exit 1; }
app_path="$project_dir/dist/새가족 정착률.app"
# Preserve Chromium's signed nested .app structure; PyInstaller file re-signing breaks it.
cp -R "$payload_dir/playwright-browsers" "$app_path/Contents/Resources/playwright-browsers"
ln -s ../Resources/playwright-browsers "$app_path/Contents/Frameworks/playwright-browsers"
codesign --force --sign - "$app_path"
"$python_bin" -B -m desktop.bundle "$app_path"
"$app_path/Contents/MacOS/NewactsSettlement" --self-test
printf '앱 빌드 완료: %s\n' "$app_path"
