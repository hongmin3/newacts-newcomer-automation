"""Validates: REQ-RATEDESKTOP-002; synthetic records only."""
import unittest
from datetime import date
from unittest.mock import MagicMock, patch

from desktop.metrics import army_metrics, member_metrics, recent_sundays, resolve_registration_date
import settlement_automation as automation


class MetricsTests(unittest.TestCase):
    def test_recent_window_uses_registration_boundary(self):
        result = member_metrics(date(2026, 9, 20), {date(2026, 9, 20): True, date(2026, 10, 4): True}, date(2026, 10, 4))
        self.assertEqual(result['recent_possible'], 3)
        self.assertEqual(result['recent_attended'], 2)
        self.assertEqual(result['recent_rate'], 2 / 3)
        self.assertEqual(result['observation_status'], '관찰 기간 부족')
        self.assertEqual(result['rate'], 2 / 3)
        self.assertEqual(result['formula_version'], 'recent4-v1')

    def test_common_window_and_zero_one_four_weeks(self):
        as_of = date(2026, 10, 6)
        self.assertEqual(recent_sundays(as_of), (date(2026, 9, 13), date(2026, 9, 20), date(2026, 9, 27), date(2026, 10, 4)))
        for registration, possible, status in [(date(2026, 10, 7), 0, '계산 대상 없음'), (date(2026, 10, 4), 1, '관찰 기간 부족'), (date(2026, 8, 1), 4, '충분')]:
            with self.subTest(registration=registration):
                result = member_metrics(registration, {}, as_of)
                self.assertEqual(result['recent_possible'], possible)
                self.assertEqual(result['observation_status'], status)
                self.assertEqual(result['recent_rate'], 0 if possible else None)

    def test_unqueried_member_is_not_absent(self):
        completed = {'군': '신군', '조회 상태': '조회완료', **member_metrics(date(2026, 9, 13), {date(2026, 10, 4): True}, date(2026, 10, 4))}
        failed = {'군': '신', '조회 상태': '조회오류', 'possible': 20, 'attended': None, 'recent_possible': 4, 'recent_attended': None}
        ambiguous = {**failed, '조회 상태': '동명이인'}
        result = army_metrics([completed, failed, ambiguous])[0]
        self.assertEqual(result['army'], '신')
        self.assertEqual(result['member_count'], 3)
        self.assertEqual(result['completed_count'], 1)
        self.assertEqual(result['review_count'], 2)
        self.assertEqual(result['completion_rate'], 1 / 3)
        self.assertEqual(result['recent_rate'], 1 / 4)
        self.assertEqual(result['possible'], 4)

    def test_empty_and_unknown_army_are_separate(self):
        result = army_metrics([{'군': '', '조회 상태': '조회오류'}, {'군': '새로운군', '조회 상태': '조회오류'}])
        self.assertEqual([r['army'] for r in result], ['미배정', '군 정보 검토'])
        self.assertTrue(all(r['recent_rate'] is None for r in result))

    def test_ambiguous_december_requires_review(self):
        with self.assertRaises(ValueError):
            resolve_registration_date('12.20', date(2025, 1, 1), date(2026, 12, 31))
        self.assertEqual(resolve_registration_date('12.20', date(2025, 12, 1), date(2026, 10, 4)), date(2025, 12, 20))
        self.assertEqual(resolve_registration_date('2026-12-20', date(2025, 1, 1), date(2026, 10, 4)), date(2026, 12, 20))
        for value in ('02.30', '11.01', ''):
            with self.subTest(value=value), self.assertRaises(ValueError):
                resolve_registration_date(value, date(2026, 1, 1), date(2026, 10, 4))
        self.assertEqual(automation.parse_registration_date('12.20'), date(2025, 12, 20))

    def test_desktop_period_reaches_collection_and_legacy_defaults_remain(self):
        row = {'날짜': '12.20', '새신자': '시험', '군': '신'}
        options = automation.RunOptions(date(2026, 10, 4), None, roster_start=date(2024, 12, 1), roster_end=date(2025, 1, 31))
        with patch.object(automation, 'find_exact_person_card', return_value=(None, '미일치', None)):
            results = automation.collect_results(None, None, [row], options)
        self.assertEqual(results[0]['등록일'], date(2024, 12, 20))
        self.assertIsNone(results[0]['recent_attended'])
        self.assertEqual(army_metrics(results)[0]['completion_rate'], 0)
        ambiguous = automation.RunOptions(date(2026, 10, 4), None, roster_start=date(2024, 1, 1), roster_end=date(2026, 10, 4))
        results = automation.collect_results(None, None, [row], ambiguous)
        self.assertEqual(results[0]['조회 상태'], '조회오류')
        self.assertIsNone(results[0]['등록일'])
        self.assertEqual(results[0]['recent_possible'], 0)
        self.assertEqual(results[0]['observation_status'], '확인 필요')
        self.assertEqual(results[0]['formula_version'], 'recent4-v1')

    def test_successful_collection_preserves_cumulative_rate(self):
        page = MagicMock()
        popup = page.expect_popup.return_value.__enter__.return_value.value
        popup.url = 'https://example.invalid/person?id=fixture-only'
        person = {'name': '시험', 'army': '조', 'team': '시험팀'}
        attendance = {date(2025, 12, 21): True, date(2026, 9, 27): True, date(2026, 10, 4): True}
        with patch.object(automation, 'find_exact_person_card', return_value=(MagicMock(), '조회완료', person)), patch.object(automation, 'read_sunday_attendance', side_effect=lambda popup, year: {d: value for d, value in attendance.items() if d.year == year}):
            results = automation.collect_results(page, None, [{'날짜': '12.20', '새신자': '시험', '군': '신'}], automation.RunOptions(date(2026, 10, 4), None))
        item = results[0]
        self.assertEqual(item['대상 일요일'], 42)
        self.assertEqual(item['출석 일요일'], 3)
        self.assertEqual(item['정착률'], 3 / 42)
        self.assertEqual(item['최근 4주'], '2/4')
        self.assertEqual(item['recent_rate'], 1 / 2)
        summary = army_metrics(results)[0]
        self.assertEqual(summary['army'], '조')
        self.assertEqual(summary['rate'], 3 / 42)
        self.assertEqual(summary['recent_rate'], 1 / 2)
        self.assertEqual(summary['formula_version'], 'recent4-v1')

    def test_unconfirmed_attendance_period_raises(self):
        radio = MagicMock()
        radio.is_checked.return_value = False
        table = MagicMock()
        boxes = table.first.locator.return_value.filter.return_value.first.locator.return_value
        boxes.count.return_value = 52
        boxes.nth.return_value.is_checked.return_value = False
        popup = MagicMock()
        popup.locator.side_effect = lambda selector: radio if 'input[name=' in selector else table
        with patch.object(automation, 'select_attendance_year'):
            with self.assertRaises(RuntimeError):
                automation.read_sunday_attendance(popup, 2026)


if __name__ == '__main__':
    unittest.main()
