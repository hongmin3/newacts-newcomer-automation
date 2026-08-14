import unittest
from datetime import date

from settlement_automation import normalize_team
from settlement_email import build_html, ensure_safe_to_email, is_last_saturday


class SettlementAutomationTest(unittest.TestCase):
    def test_last_saturday(self):
        self.assertTrue(is_last_saturday(date(2026, 8, 29)))
        self.assertFalse(is_last_saturday(date(2026, 8, 22)))

    def test_team_parentheses_are_removed(self):
        self.assertEqual(normalize_team("주품 (황수현 )"), "주품")
        self.assertEqual(normalize_team("로뎀(담당자)"), "로뎀")

    def test_email_is_centered_and_escaped(self):
        item = {
            "군": "신", "팀": "주품", "이름": "홍<민", "등록일": date(2026, 8, 1),
            "대상 일요일": 2, "출석 일요일": 1, "정착률": 0.5,
            "최근 4주": "O-X-", "조회 상태": "조회완료",
        }
        rendered = build_html("신군 새가족 정착률 현황", [item], date(2026, 8, 14))
        self.assertIn("text-align:center", rendered)
        self.assertIn("홍&lt;민", rendered)

    def test_overall_email_can_omit_member_table(self):
        item = {
            "군": "신", "팀": "주품", "이름": "홍민", "등록일": date(2026, 8, 1),
            "대상 일요일": 2, "출석 일요일": 1, "정착률": 0.5,
            "최근 4주": "O-X-", "조회 상태": "조회완료",
        }
        rendered = build_html(
            "전체 새가족 정착률 현황", [item], date(2026, 8, 14),
            grouped={"신": [item]}, include_members=False,
        )
        self.assertIn("군별 정착률 현황", rendered)
        self.assertNotIn("개인별 정착 현황", rendered)

    def test_low_completion_rate_blocks_email(self):
        rows = [{"조회 상태": "조회완료"}] * 94 + [{"조회 상태": "조회오류"}] * 6
        with self.assertRaises(RuntimeError):
            ensure_safe_to_email(rows)


if __name__ == "__main__":
    unittest.main()
