"""Validates: REQ-RATEDESKTOP-007"""
import unittest
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from datetime import date
from unittest.mock import patch
from local_run import totals, require_quality, today, verify_summary, normalize_no_sundays

class LocalRunTests(unittest.TestCase):
    def test_failed_queries_excluded_from_rate(self):
        rows=[{'조회 상태':'조회완료','대상 일요일':4,'출석 일요일':3},
              {'조회 상태':'조회오류','대상 일요일':100,'출석 일요일':None}]
        self.assertEqual(totals(rows)['rate'], .75)
        with self.assertRaises(RuntimeError): require_quality(rows)
        with self.assertRaises(RuntimeError): require_quality([])
    def test_quality_boundary(self):
        ok={'조회 상태':'조회완료','대상 일요일':4,'출석 일요일':2}
        bad={'조회 상태':'조회오류','대상 일요일':4,'출석 일요일':None}
        self.assertEqual(require_quality([ok]*95+[bad]*5)['complete'],95)
        with self.assertRaises(RuntimeError): require_quality([ok]*94+[bad]*6)
    def test_korea_date(self):
        with patch('local_run.datetime') as clock:
            clock.now.return_value.date.return_value=date(2026,11,2)
            self.assertEqual(today(),date(2026,11,2))
            self.assertEqual(str(clock.now.call_args.args[0]),'Asia/Seoul')

    def test_sheet_summary_corruption_is_rejected(self):
        rows=[{'군':'신','조회 상태':'조회완료','대상 일요일':4,'출석 일요일':3}]
        sheet=[[] for _ in range(11)]
        sheet[4]=['신',1,1,4,3,.75,0,'전체 인원',1]
        sheet[5]=['']*8+[1]
        sheet[6]=['']*8+[4]
        sheet[7]=['']*8+[3]
        sheet[8]=['']*8+[.75]
        sheet[9]=['']*8+[0]
        sheet[10]=['']*8+[0]
        self.assertEqual(verify_summary(sheet,rows)['attended'],3)
        sheet[7][8]=2
        with self.assertRaises(RuntimeError): verify_summary(sheet,rows)
        sheet[7][8]=3
        sheet[4][4]=2
        with self.assertRaises(RuntimeError): verify_summary(sheet,rows)

    def test_missing_army_summary_cells_are_rejected(self):
        armies=['신','조','명','총','석','전']
        rows=[{'군':army,'조회 상태':'조회완료','대상 일요일':4,'출석 일요일':3} for army in armies]
        sheet=[[] for _ in range(11)]
        for index, army in enumerate(armies,4): sheet[index]=[army,1,1,4,3,.75,0]
        for index,value in enumerate([6,6,24,18,.75],4): sheet[index]+=['요약',value]
        sheet[9]+=['요약',0]
        sheet[10]=['']*8+[0]
        verify_summary(sheet,rows)
        sheet[9]=['전']
        with self.assertRaises(RuntimeError): verify_summary(sheet,rows)

    def test_today_registration_without_sunday_is_not_future(self):
        raw={'등록일':'2026-11-02','대상 일요일':0,'조회 상태':'등록일미래','비고':'기준일 이후 등록일','출석 일요일':0}
        fixed=normalize_no_sundays(raw,date(2026,11,2))
        self.assertEqual(fixed['조회 상태'],'계산대상없음')
        self.assertEqual(raw['조회 상태'],'등록일미래')
        self.assertEqual(totals([fixed])['eligible'],0)
        ok={'조회 상태':'조회완료','대상 일요일':4,'출석 일요일':3}
        self.assertEqual(require_quality([ok,fixed])['eligible'],1)
