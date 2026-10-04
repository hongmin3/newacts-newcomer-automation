"""Run every settlement test using isolated, non-operational settings."""
import sys
import types
import unittest
from pathlib import Path

PROJECT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT))
# Always shadow local config.py: tests must never load real accounts or recipients.
config = types.ModuleType('config')
config.SHEET_URL = 'https://docs.google.com/spreadsheets/d/test-only-sheet/edit'
config.SOURCE_SHEET_NAME = '등록 새가족'
config.RESULT_SHEET_NAME = '정착률'
config.DIMODE_URL = 'https://example.invalid/'
config.USER_ID = config.USER_PW = ''
config.TEST_RECIPIENT = 'test@example.invalid'
config.ADMIN_RECIPIENTS = []
config.ARMY_RECIPIENTS = {}
config.MIN_QUERY_COMPLETION_RATE = 0.95
sys.modules['config'] = config

if __name__ == '__main__':
    suite = unittest.defaultTestLoader.discover(str(PROJECT / 'tests'), pattern='test_*.py')
    count = suite.countTestCases()
    result = unittest.TextTestRunner(verbosity=1).run(suite)
    if result.skipped:
        print('생략된 테스트가 있어 검증에 실패했습니다.', file=sys.stderr)
    sys.exit(0 if result.wasSuccessful() and not result.skipped and count >= 5 else 1)
