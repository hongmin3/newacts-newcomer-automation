"""Validates: REQ-RATEDESKTOP-008; synthetic attendance only."""
import unittest
from datetime import date

from desktop import metrics


class SettlementDefinitionTests(unittest.TestCase):
    def test_calendar_month_window_clamps_month_end(self):
        cases = [
            (date(2026, 11, 2), date(2026, 8, 2)),
            (date(2024, 5, 31), date(2024, 2, 29)),
            (date(2025, 5, 31), date(2025, 2, 28)),
            (date(2026, 1, 31), date(2025, 10, 31)),
            (date(2026, 12, 31), date(2026, 9, 30)),
        ]
        self.assertTrue(callable(getattr(metrics, 'three_month_start', None)))
        for as_of, expected in cases:
            with self.subTest(as_of=as_of):
                self.assertEqual(metrics.three_month_start(as_of), expected)

    def test_november_second_includes_august_second(self):
        result = metrics.member_metrics(date(2026, 1, 1), {
            date(2026, 7, 26): True, date(2026, 8, 2): True,
            date(2026, 11, 2): True, date(2026, 11, 8): True,
        }, date(2026, 11, 2))
        self.assertEqual(result.get('recent3_start'), '2026-08-02')
        self.assertEqual(result.get('recent3_possible'), 14)
        self.assertEqual(result.get('recent3_attended'), 1)
        self.assertEqual(result.get('settlement_status'), '정착')
        self.assertIs(result.get('settled'), True)

    def test_window_ends_on_as_of_and_excludes_preregistration_attendance(self):
        result = metrics.member_metrics(date(2026, 10, 25), {
            date(2026, 8, 2): True, date(2026, 10, 18): True,
            date(2026, 11, 1): True, date(2026, 11, 8): True,
        }, date(2026, 11, 1))
        self.assertEqual(result.get('recent3_possible'), 2)
        self.assertEqual(result.get('recent3_attended'), 1)
        self.assertEqual(result.get('settlement_status'), '정착')

    def test_zero_attendance_uses_registration_boundary(self):
        for registration, expected in [
            (date(2026, 8, 1), '미정착'),
            (date(2026, 8, 2), '미정착'),
            (date(2026, 8, 3), '관찰 중'),
            (date(2026, 11, 2), '관찰 중'),
            (date(2026, 11, 3), '대상외'),
        ]:
            with self.subTest(registration=registration):
                result = metrics.member_metrics(registration, {}, date(2026, 11, 2))
                self.assertEqual(result.get('settlement_status'), expected)
                self.assertIs(result.get('settled'), False)

    def test_recent_four_and_cumulative_metrics_are_preserved(self):
        result = metrics.member_metrics(date(2026, 9, 20), {
            date(2026, 9, 20): True, date(2026, 10, 4): True,
        }, date(2026, 10, 4))
        self.assertEqual(result['rate'], 2 / 3)
        self.assertEqual(result['recent_possible'], 3)
        self.assertEqual(result['recent_attended'], 2)
        self.assertEqual(result['recent_rate'], 2 / 3)
        self.assertEqual(result['observation_status'], '관찰 기간 부족')
        self.assertEqual(result.get('recent3_attended'), 2)
        self.assertEqual(result['formula_version'], 'recent3-v2')

    def test_army_full_denominator_includes_observing_and_unknown(self):
        def row(registration, attendance, status='조회완료'):
            return {'군': '신군', '조회 상태': status, **metrics.member_metrics(
                registration, attendance, date(2026, 11, 2))}

        result = metrics.army_metrics([
            row(date(2026, 1, 1), {date(2026, 8, 2): True}),
            row(date(2026, 1, 1), {}),
            row(date(2026, 11, 2), {}, '계산대상없음'),
            row(date(2026, 1, 1), {date(2026, 8, 2): True}, '조회오류'),
            {'군': '신', '조회 상태': '조회완료', 'rate': 1, 'attended': 99},
            row(date(2026, 11, 3), {}, '계산대상없음'),
        ])[0]
        self.assertEqual(result['member_count'], 5)
        self.assertEqual(result.get('recent3_attended'), 1)
        self.assertEqual(result.get('settled_count'), 1)
        self.assertEqual(result.get('observing_count'), 1)
        self.assertEqual(result.get('unsettled_count'), 1)
        self.assertEqual(result.get('settlement_review_count'), 2)
        self.assertEqual(result.get('settlement_rate'), 1 / 5)
        self.assertIs(result.get('settlement_provisional'), True)

    def test_valid_no_target_newcomer_is_known_but_failed_lookup_is_unknown(self):
        newcomer = metrics.member_metrics(date(2026, 11, 2), {}, date(2026, 11, 2))
        result = metrics.army_metrics([
            {'army': '조', 'status': '계산대상없음', **newcomer},
        ])[0]
        self.assertEqual(result.get('observing_count'), 1)
        self.assertEqual(result.get('settlement_review_count'), 0)
        self.assertEqual(result.get('settlement_rate'), 0)
        self.assertIs(result.get('settlement_provisional'), False)
        for status in ('조회오류', '미일치', '동명이인', '등록일확인필요'):
            with self.subTest(status=status):
                result = metrics.army_metrics([{'army': '조', 'status': status, **newcomer}])[0]
                self.assertEqual(result.get('observing_count'), 0)
                self.assertEqual(result.get('settlement_review_count'), 1)

    def test_legacy_and_incomplete_metrics_never_imply_settlement(self):
        for changes in ({'rate': 1}, {'recent3_attended': None}, {'settlement_status': None}):
            with self.subTest(changes=changes):
                values = metrics.member_metrics(date(2026, 1, 1), {}, date(2026, 11, 2))
                if changes == {'rate': 1}:
                    values = changes
                else:
                    values.update(changes)
                summary = metrics.army_metrics([{'army': '신', 'status': '조회완료', **values}])[0]
                self.assertEqual(summary.get('settled_count'), 0)
                self.assertEqual(summary.get('unsettled_count'), 0)
                self.assertEqual(summary.get('settlement_review_count'), 1)
                self.assertIs(summary.get('settlement_provisional'), True)


if __name__ == '__main__':
    unittest.main()
