"""Validates: REQ-RATEDESKTOP-008; synthetic CSVs and mocked services only."""
import csv
import io
import tempfile
import unittest
from contextlib import redirect_stdout
from datetime import date
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import settlement_automation as automation
from desktop.metrics import army_metrics, member_metrics


AS_OF = date(2026, 11, 2)


def legacy_row():
    return {'No.': 1, '군': '신', '팀': '가상팀', '이름': '가상인', '성별': '',
            '핸드폰': '', '등록일': date(2026, 1, 1), '기준일': AS_OF,
            '대상 일요일': 44, '출석 일요일': 22, '정착률': .5,
            '최근 4주': '0/4', '조회 상태': '조회완료', '비고': '', '디모데 ID': 'fake'}


class DefinitionCompatibilityTests(unittest.TestCase):
    def test_old_csv_roundtrip_keeps_recent_three_months_unknown(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(automation, 'PROJECT_DIR', Path(tmp)):
            output = Path(tmp) / 'output'
            output.mkdir()
            original = legacy_row()
            with (output / 'settlement_result.csv').open('w', encoding='utf-8-sig', newline='') as stream:
                writer = csv.DictWriter(stream, fieldnames=list(original))
                writer.writeheader()
                writer.writerow(original)
            restored = automation.load_previous_results()
            self.assertIsNone(restored[0].get('recent3_attended'))
            self.assertEqual(restored[0].get('정착상태'), '확인 필요')
            self.assertIsNone(restored[0].get('settled'))
            self.assertEqual(restored[0]['출석률'], .5)
            path = automation.save_csv(restored)
            self.assertTrue(path.read_bytes().startswith(b'\xef\xbb\xbf'))
            again = automation.load_previous_results()[0]
            self.assertEqual(again['이름'], original['이름'])
            self.assertEqual(again['출석률'], .5)
            self.assertIsNone(again.get('recent3_attended'))
            self.assertEqual(again.get('settlement_status'), '확인 필요')
            summary = army_metrics([again])[0]
            self.assertEqual(summary['settlement_review_count'], 1)
            self.assertTrue(summary['settlement_provisional'])

    def test_csv_serializes_legacy_detail_without_new_fields(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(automation, 'PROJECT_DIR', Path(tmp)):
            path = automation.save_csv([legacy_row()])
            row = next(csv.DictReader(io.StringIO(path.read_text(encoding='utf-8-sig'))))
            self.assertEqual(row['출석률'], '0.5')
            self.assertEqual(row['최근 3개월 출석 횟수'], '')
            self.assertEqual(row['정착상태'], '확인 필요')

    def test_failed_atomic_replace_preserves_previous_csv_bytes(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(automation, 'PROJECT_DIR', Path(tmp)):
            path = Path(tmp) / 'output' / 'settlement_result.csv'
            path.parent.mkdir()
            previous = b'previous snapshot\r\n'
            path.write_bytes(previous)
            row = {**legacy_row(), '출석률': .5, '최근 3개월 출석 횟수': None, '정착상태': '확인 필요'}
            with patch('desktop.runtime.os.replace', side_effect=OSError('synthetic failure')):
                with self.assertRaises(OSError):
                    automation.save_csv([row])
            self.assertEqual(path.read_bytes(), previous)
            self.assertEqual(list(path.parent.iterdir()), [path])

    def test_future_lookup_result_stays_outside_settlement_population(self):
        source = {'새신자': '가상인', '날짜': '2026-11-03', '군': '신'}
        with redirect_stdout(io.StringIO()):
            result = automation.collect_results(None, None, [source], automation.RunOptions(AS_OF, None))[0]
        self.assertEqual(result['정착상태'], '대상외')
        self.assertEqual(result['settlement_status'], '대상외')
        self.assertEqual(army_metrics([result]), [])

    def test_zero_sundays_current_registrant_stays_in_denominator(self):
        source = {'새신자': '가상인', '날짜': '2026-11-02', '군': '신'}
        with redirect_stdout(io.StringIO()):
            result = automation.collect_results(None, None, [source], automation.RunOptions(AS_OF, None))[0]
        self.assertEqual(result['정착상태'], '관찰 중')
        summary = army_metrics([result])[0]
        self.assertEqual(summary['member_count'], 1)
        self.assertEqual(summary['observing_count'], 1)
        self.assertEqual(summary['settlement_rate'], 0)

    def test_summary_and_csv_exclude_future_dates_even_for_old_rows(self):
        current = legacy_row()
        future = {**legacy_row(), '등록일': date(2026, 11, 3), '이름': '미래가상인'}
        self.assertEqual(automation.summary_rows([current, future])[0][1], 1)
        with tempfile.TemporaryDirectory() as tmp, patch.object(automation, 'PROJECT_DIR', Path(tmp)):
            path = automation.save_csv([current, future])
            saved = list(csv.DictReader(io.StringIO(path.read_text(encoding='utf-8-sig'))))
        self.assertEqual([row['이름'] for row in saved], ['가상인'])

    def test_sheet_serializes_old_rows_and_excludes_future_population(self):
        service = MagicMock()
        config = SimpleNamespace(SHEET_URL='https://docs.google.com/spreadsheets/d/fake/edit', RESULT_SHEET_NAME='가상결과')
        future = {**legacy_row(), '등록일': date(2026, 11, 3), '이름': '미래가상인'}
        with patch.object(automation, 'config', config), patch.object(automation, 'ensure_result_sheet', return_value=1):
            automation.write_result_sheet(service, [legacy_row(), future], AS_OF)
        calls = service.spreadsheets().values().update.call_args_list
        values = calls[0].kwargs['body']['values']
        detail = values[values.index(automation.DETAIL_HEADERS) + 1:]
        self.assertEqual(len(detail), 1)
        self.assertEqual(detail[0][10], .5)
        self.assertEqual(detail[0][11], '')
        self.assertEqual(detail[0][-1], '확인 필요')

    def test_cli_filters_future_source_dates_and_retains_unresolved_dates(self):
        args = SimpleNamespace(as_of=AS_OF.isoformat(), monthly=False, force_monthly=False,
            test_email=False, limit=None, email_from_csv=False, retry_unmatched=False,
            only_name=None, headless=True, no_sheet_write=True, send_email=False)
        rows = [{'새신자': '현재', '날짜': '2026-11-02'},
                {'새신자': '미래', '날짜': '2026-11-03'},
                {'새신자': '확인', '날짜': '날짜확인'}]
        with patch.object(automation, 'parse_args', return_value=args), \
             patch.object(automation, 'get_google_services', return_value=(None, None)), \
             patch.object(automation, 'load_source_rows', return_value=rows), \
             patch.object(automation, 'config', SimpleNamespace(DIMODE_URL='https://example.invalid', SHEET_URL='')), \
             patch.dict('sys.modules', {'playwright': MagicMock(), 'playwright.sync_api': MagicMock()}), \
             patch.object(automation, 'wait_for_login'), \
             patch.object(automation, 'collect_results', return_value=[]) as collect, \
             patch.object(automation, 'save_csv', return_value=Path('/synthetic/result.csv')), \
             redirect_stdout(io.StringIO()):
            automation.main()
        self.assertEqual(collect.call_args.args[2], [rows[0], rows[2]])


    def test_retry_refreshes_old_definition_and_outdated_complete_snapshots(self):
        registrations = [date(2026, 1, day) for day in range(1, 6)]
        rows = [{'새신자': f'가상{index}', '날짜': registration.isoformat()}
                for index, registration in enumerate(registrations)]
        previous = []
        for index, registration in enumerate(registrations):
            item = {**legacy_row(), '이름': f'가상{index}', '등록일': registration}
            if index in (1, 2, 4):
                item.update(member_metrics(registration, {date(2026, 11, 1): True}, AS_OF))
            if index == 1:
                item['기준일'] = date(2026, 11, 1)
            if index == 4:
                item['formula_version'] = 'recent4-v1'
            if index == 3:
                item.update({'recent3_attended': None, 'settlement_status': '확인 필요'})
            previous.append(item)
        args = SimpleNamespace(as_of=AS_OF.isoformat(), monthly=False, force_monthly=False,
            test_email=False, limit=None, email_from_csv=False, retry_unmatched=True,
            only_name=None, headless=True, no_sheet_write=True, send_email=False)
        with patch.object(automation, 'parse_args', return_value=args), \
             patch.object(automation, 'get_google_services', return_value=(None, None)), \
             patch.object(automation, 'load_source_rows', return_value=rows), \
             patch.object(automation, 'load_previous_results', return_value=previous), \
             patch.object(automation, 'config', SimpleNamespace(DIMODE_URL='https://example.invalid', SHEET_URL='')), \
             patch.dict('sys.modules', {'playwright': MagicMock(), 'playwright.sync_api': MagicMock()}), \
             patch.object(automation, 'wait_for_login'), \
             patch.object(automation, 'collect_results', return_value=[]) as collect, \
             patch.object(automation, 'save_csv', return_value=Path('/synthetic/result.csv')), \
             redirect_stdout(io.StringIO()):
            automation.main()
        self.assertEqual(collect.call_args.args[2], [rows[0], rows[1], rows[3], rows[4]])


if __name__ == '__main__':
    unittest.main()
