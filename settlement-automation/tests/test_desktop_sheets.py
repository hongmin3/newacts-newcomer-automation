"""Validates: REQ-RATEDESKTOP-004, REQ-RATEDESKTOP-006."""
import copy
import tempfile
import unittest
from pathlib import Path
from desktop.history import HistoryStore
from desktop.sheets import SheetPublisher, TAB_HEADERS, CARE_TAB, CURRENT_TAB, HISTORY_TAB
from test_desktop_history import member


class FakeSheet:
    def __init__(self):
        self.tabs = {'등록 새가족': [['원본']], '정착률': [['기존 결과']]}
        self.owners = {}
        self.write_calls = []
        self.fail = None

    def read_tab(self,name):
        return copy.deepcopy(self.tabs.get(name))

    def ownership(self,name):
        return self.owners.get(name)

    def create_tab(self,name,headers,owner):
        self.tabs[name] = [list(headers)]
        self.owners[name] = owner
        self.write_calls.append(('create',name))

    def write_rows(self,name,rows):
        if self.fail == name:
            raise RuntimeError('가짜 시트 실패')
        self.tabs[name] = [self.tabs[name][0]] + copy.deepcopy(rows)
        self.write_calls.append(('rows',name))

    def update_cells(self,name,updates):
        if self.fail == name:
            raise RuntimeError('가짜 시트 실패')
        for row,col,value in updates:
            while len(self.tabs[name]) <= row:
                self.tabs[name].append([''] * len(self.tabs[name][0]))
            self.tabs[name][row][col] = value
        self.write_calls.append(('cells',name,copy.deepcopy(updates)))


class SheetTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.history = HistoryStore(Path(self.tmp.name))
        self.sheet = FakeSheet()
        self.publisher = SheetPublisher(self.sheet,self.history)

    def test_existing_unowned_tab_is_not_cleared(self):
        self.sheet.tabs[CARE_TAB] = [['모르는 열'],['수동 기록']]
        before = copy.deepcopy(self.sheet.tabs)
        with self.assertRaises(ValueError):
            self.publisher.publish('r1',[member()],[])
        self.assertEqual(self.sheet.write_calls,[])
        self.assertEqual(self.sheet.tabs,before)

    def test_move_keeps_care_note_for_same_id(self):
        original = copy.deepcopy(self.sheet.tabs)
        self.publisher.publish('r1',[member()],[])
        self.sheet.tabs[CARE_TAB][1][TAB_HEADERS[CARE_TAB].index('메모')] = '직접 쓴 메모'
        self.publisher.publish('r2',[member(army='조')],[])
        row = self.sheet.tabs[CARE_TAB][1]
        self.assertEqual(row[TAB_HEADERS[CARE_TAB].index('메모')],'직접 쓴 메모')
        self.assertEqual(row[2],'조')
        for tab in original:
            self.assertEqual(self.sheet.tabs[tab],original[tab])
        self.assertTrue(all(col < 3 for call in self.sheet.write_calls if call[0]=='cells' for row,col,value in call[2]))

    def test_same_name_different_id_does_not_merge(self):
        self.publisher.publish('r1',[member('1'),member('2'),member('')],[])
        self.assertEqual([row[0] for row in self.sheet.tabs[CARE_TAB][1:]],['1','2'])

    def test_partial_failure_retries_only_unfinished_stages(self):
        self.sheet.fail = HISTORY_TAB
        with self.assertRaises(RuntimeError):
            self.publisher.publish('r1',[member()],[])
        calls = list(self.sheet.write_calls)
        self.sheet.fail = None
        report = SheetPublisher(self.sheet,HistoryStore(Path(self.tmp.name))).publish('r1',[member()],[])
        self.assertEqual(report['completed'],['current','monthly','care'])
        self.assertEqual(sum(call==('rows',CURRENT_TAB) for call in self.sheet.write_calls),1)
        self.assertGreater(len(self.sheet.write_calls),len(calls))
        count = len(self.sheet.write_calls)
        self.publisher.publish('r1',[member()],[])
        self.assertEqual(len(self.sheet.write_calls),count)

    def test_header_change_and_duplicate_id_halt_before_writes(self):
        self.publisher.publish('r1',[member()],[])
        self.sheet.tabs[CARE_TAB].append(list(self.sheet.tabs[CARE_TAB][1]))
        self.sheet.write_calls.clear()
        with self.assertRaises(ValueError):
            self.publisher.publish('r2',[member()],[])
        self.assertEqual(self.sheet.write_calls,[])
        self.sheet.tabs[CARE_TAB].pop()
        self.sheet.tabs[CURRENT_TAB][0][0] = '手動'
        with self.assertRaises(ValueError):
            self.publisher.publish('r2',[member()],[])
        self.assertEqual(self.sheet.write_calls,[])

    def test_unconfirmed_duplicate_ids_are_not_added(self):
        self.publisher.publish('r1',[member('x'),member('x'),member('y',status='복수일치')],[])
        self.assertEqual(len(self.sheet.tabs[CARE_TAB]),1)

    def test_same_run_changed_payload_halts_before_writes(self):
        self.publisher.publish('r1',[member()],[])
        self.sheet.write_calls.clear()
        with self.assertRaises(ValueError):
            self.publisher.publish('r1',[member(army='조')],[])
        self.assertEqual(self.sheet.write_calls,[])
