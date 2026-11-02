"""Validates: REQ-RATEDESKTOP-008. Synthetic data, no external writes or mail."""
import copy
import tempfile
import unittest
from datetime import date
from pathlib import Path
from desktop.window import _metric_text
from desktop.metrics import member_metrics, army_metrics, FORMULA_VERSION
from desktop.history import HistoryStore
from desktop.sheets import SheetPublisher, CURRENT_TAB, HISTORY_TAB, CARE_TAB, TAB_HEADERS, OWNER
from test_desktop_sheets import FakeSheet
import settlement_email as email


def person(recent=True):
    item = {'이름':'가상인','팀':'가상팀','군':'신','등록일':'2026-01-01',
            '디모데 ID':'synthetic','조회 상태':'조회완료'}
    item.update(member_metrics(date(2026,1,1), {date(2026,10,4): recent}, date(2026,10,4)))
    item.update({'대상 일요일':item['possible'],'출석 일요일':item['attended'],
                 '정착률':item['rate'], '최근 4주':'기존 값'})
    return item


class SettlementViewsTests(unittest.TestCase):
    def test_mail_separates_attendance_and_settlement(self):
        item = person()
        output = email.build_html('제목',[item],date(2026,10,4),grouped={'신':[item]})
        self.assertIn('출석률',output)
        self.assertIn('100.0%',output)
        self.assertIn(f"{item['rate']:.1%}",output)
        self.assertIn('최근 3개월 출석 횟수',output)
        self.assertNotIn('최근 4주',output)
        plain = email._plain_text('제목',[item],date(2026,10,4),'')
        self.assertIn('출석률:',plain)
        self.assertIn('정착률: 100.0%',plain)

    def test_zero_count_and_old_csv_unknown(self):
        item=person(False)
        self.assertIn('미정착',email._member_table([item]))
        self.assertIn('>0</td>',email._member_table([item]))
        legacy={key:value for key,value in person().items() if key not in (
            'recent3_start','recent3_possible','recent3_attended','settled','settlement_status')}
        output=email.build_html('제목',[legacy],date(2026,10,4))
        self.assertIn('확인필요',output)
        self.assertIn('잠정',output)
        self.assertNotIn('최근 4주',output)

    def test_new_tabs_preserve_old_tabs_and_manual_care(self):
        self.assertEqual(CURRENT_TAB,'군별 정착 현황 v2')
        self.assertEqual(HISTORY_TAB,'정착률 월별 이력 v2')
        sheet=FakeSheet()
        sheet.tabs['군별 정착 현황']=[['과거 열'],['과거 값']]
        sheet.tabs['정착률 월별 이력']=[['과거 이력']]
        sheet.tabs[CARE_TAB]=[list(TAB_HEADERS[CARE_TAB]),['synthetic','가상인','신','담당','날짜','상태','다음','메모']]
        sheet.owners[CARE_TAB]=OWNER
        before=copy.deepcopy(sheet.tabs)
        with tempfile.TemporaryDirectory() as tmp:
            SheetPublisher(sheet,HistoryStore(Path(tmp))).publish('v2',[person()],[])
        for tab in before:
            self.assertEqual(sheet.tabs[tab],before[tab])
        self.assertIn('정착률',sheet.tabs[CURRENT_TAB][0])
        self.assertIn('최근 3개월 출석 횟수',sheet.tabs[CURRENT_TAB][0])
        self.assertNotIn('최근 4주',' '.join(sheet.tabs[CURRENT_TAB][0]))

    def test_monthly_delta_uses_settlement_and_separates_versions(self):
        with tempfile.TemporaryDirectory() as tmp:
            history=HistoryStore(Path(tmp))
            history.save_snapshot('old',date(2026,8,30),[person()], 'recent4-v1','completed')
            history.save_snapshot('sep',date(2026,9,27),[person(False)],FORMULA_VERSION,'completed')
            first=history.monthly_summary('2026-09',FORMULA_VERSION)[0]
            self.assertIsNone(first.get('settlement_rate_delta_pp'))
            history.save_snapshot('oct',date(2026,10,4),[person()],FORMULA_VERSION,'completed')
            current=history.monthly_summary('2026-10',FORMULA_VERSION)[0]
            self.assertEqual(current.get('settlement_rate_delta_pp'),100.0)

    def test_old_window_values_are_unknown_and_provisional(self):
        legacy={'member_count':2,'rate':.75,'formula_version':'recent4-v1'}
        self.assertEqual(_metric_text(legacy,'settlement_rate'),'확인필요')
        self.assertEqual(_metric_text(legacy,'recent3_attended'),'확인필요')
        self.assertEqual(_metric_text(legacy,'settlement_provisional'),'잠정·확인필요')
        current=army_metrics([{key:value for key,value in person().items() if not key.startswith('recent3')}])[0]
        self.assertEqual(_metric_text(current,'settlement_rate'),'확인필요 (잠정)')
        self.assertEqual(_metric_text(current,'recent3_attended'),'확인필요 (잠정)')

    def test_window_displays_two_rates_and_recent_three_months(self):
        from PySide6.QtWidgets import QApplication
        from desktop.runtime import RuntimePaths
        from desktop.service import RunOutcome
        from desktop.window import MainWindow
        app=QApplication.instance() or QApplication([])
        with tempfile.TemporaryDirectory() as tmp:
            window=MainWindow(None,RuntimePaths.for_user(Path(tmp)),lambda:object())
            try:
                metric=army_metrics([person()])[0]
                metric.update(month='2026-10',status='완료')
                window.show_outcome(RunOutcome('v2','completed',date(2026,10,4),summaries=[metric],monthly_history=[metric]))
                for table in (window.table,window.history_table):
                    headers=[table.horizontalHeaderItem(i).text() for i in range(table.columnCount())]
                    self.assertIn('정착률',headers)
                    self.assertIn('최근 3개월 출석 횟수',headers)
                    self.assertNotIn('최근 4주',' '.join(headers))
                    self.assertEqual(table.item(0,headers.index('정착률')).text(),'100.0%')
            finally:
                window.close()
                app.processEvents()
