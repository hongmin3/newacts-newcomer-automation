"""Validates: REQ-RATEDESKTOP-003, REQ-RATEDESKTOP-006."""
import tempfile
import unittest
from datetime import date
from pathlib import Path
from desktop.history import HistoryStore


def member(person_id='1', army='신', status='조회완료'):
    return {'디모데 ID': person_id, '이름': '시험 이름', '군': army, '조회 상태': status,
            'possible': 10, 'attended': 5, 'recent_possible': 4, 'recent_attended': 3,
            'observation_status': '충분', 'formula_version': 'recent4-v1'}


class HistoryTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.store = HistoryStore(Path(self.tmp.name))

    def test_failed_rerun_keeps_previous_month_selection(self):
        first = self.store.save_snapshot('ok', date(2026, 10, 4), [member()], 'recent4-v1', 'completed')
        second = self.store.save_snapshot('bad', date(2026, 10, 5), [member(status='조회오류')], 'recent4-v1', 'failed')
        self.assertTrue(first.exists() and second.exists())
        self.assertEqual(self.store.monthly_summary('2026-10', 'recent4-v1')[0]['run_id'], 'ok')
        self.assertEqual(first.stat().st_mode & 0o777, 0o600)
        self.assertEqual(self.store.history_file.stat().st_mode & 0o777, 0o600)

    def test_quality_and_cancel_do_not_select(self):
        self.store.save_snapshot('low', date(2026,10,4), [member(),member('2',status='조회오류')], 'recent4-v1', 'completed')
        self.store.save_snapshot('cancel', date(2026,10,4), [member()], 'recent4-v1', 'cancelled')
        self.assertEqual(self.store.monthly_summary('2026-10','recent4-v1'), [])

    def test_previous_month_difference_and_missing_or_version(self):
        self.store.save_snapshot('sep', date(2026,9,30), [member()], 'recent4-v1', 'completed')
        self.store.save_snapshot('oct', date(2026,10,4), [member(),member('2')], 'recent4-v1', 'completed')
        summary = self.store.monthly_summary('2026-10','recent4-v1')[0]
        self.assertEqual(summary['member_count_delta'],1)
        self.assertEqual(summary['recent_rate_delta_pp'],0)
        self.assertEqual(self.store.monthly_summary('2026-11','recent4-v1'),[])
        self.store.save_snapshot('new', date(2026,10,5), [member()], 'v2', 'completed')
        self.assertIsNone(self.store.monthly_summary('2026-10','v2')[0]['rate_delta_pp'])

    def test_same_run_is_immutable_and_stages_survive_restart(self):
        path = self.store.save_snapshot('one',date(2026,10,4),[member()],'recent4-v1','completed')
        self.store.mark_stage('one','current')
        reopened = HistoryStore(Path(self.tmp.name))
        self.assertTrue(reopened.stage_done('one','current'))
        self.assertEqual(reopened.save_snapshot('one',date(2026,10,4),[member()],'recent4-v1','completed'),path)
        with self.assertRaises(ValueError):
            reopened.save_snapshot('one',date(2026,10,4),[],'recent4-v1','failed')
        with self.assertRaises(ValueError):
            reopened.save_snapshot('../escape',date.today(),[],'recent4-v1','failed')

    def test_test_runs_do_not_replace_normal_and_low_army_stays_visible(self):
        self.store.save_snapshot('sep',date(2026,9,30),[member('s','조')],'recent4-v1','completed')
        rows = [member(str(i)) for i in range(95)] + [member('s','조',status='조회오류')]
        self.store.save_snapshot('oct',date(2026,10,4),rows,'recent4-v1','completed')
        self.store.save_snapshot('test',date(2026,10,5),[member('s','조')],'recent4-v1','test')
        summaries = self.store.monthly_summary('2026-10','recent4-v1')
        self.assertEqual([row['army'] for row in summaries],['신','조'])
        self.assertEqual(summaries[1]['completion_rate'],0)
        self.assertEqual(summaries[1]['review_count'],1)
        self.assertEqual(summaries[1]['run_id'],'oct')
        self.assertIsNone(summaries[0]['member_count_delta'])

    def test_recovery_reads_typed_snapshot_and_pending_publication(self):
        self.store.save_snapshot('one',date(2026,10,4),[member()],'recent4-v1','completed')
        self.store.bind_publication('one',[member()],[])
        self.store.mark_stage('one','current')
        reopened = HistoryStore(Path(self.tmp.name))
        snapshot = reopened.load_snapshot('one')
        self.assertEqual(snapshot['results'][0]['possible'],10)
        self.assertEqual(snapshot['as_of'],date(2026,10,4))
        self.assertEqual(reopened.pending_publications(),['one'])
        self.assertEqual(reopened.load_publication('one')['results'],[member()])
        reopened.mark_stage('one','monthly')
        reopened.mark_stage('one','care')
        self.assertEqual(reopened.pending_publications(),[])
