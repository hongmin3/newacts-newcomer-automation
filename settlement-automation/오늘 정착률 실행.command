#!/bin/bash
set -eu
cd -- "$(dirname -- "$0")"
if [ ! -x .venv/bin/python ]; then
  echo '정착률 Python 실행 환경이 없습니다. README의 Mac 설치 안내를 확인해 주세요.'
  exit 1
fi
export PYTHONUNBUFFERED=1
if [ -d local/browsers ]; then
  export PLAYWRIGHT_BROWSERS_PATH="$PWD/local/browsers"
elif [ -d .venv/playwright-browsers ]; then
  export PLAYWRIGHT_BROWSERS_PATH="$PWD/.venv/playwright-browsers"
fi
exec .venv/bin/python -B local_run.py
