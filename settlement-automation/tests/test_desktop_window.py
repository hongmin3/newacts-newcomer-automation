"""Validates: REQ-RATEDESKTOP-001,004,005,006. Real Qt, fake remote service."""
import os
os.environ.setdefault('QT_QPA_PLATFORM', 'offscreen')
import tempfile
import time
import threading
import unittest
from pathlib import Path
from datetime import date
from PySide6.QtWidgets import QApplication
from PySide6.QtGui import QFont
from desktop.runtime import RuntimePaths
from desktop.settings import AppSettings
from desktop.service import RunOutcome, ProgressEvent, ReportPreview

class FakeService:
    def __init__(self, wait=False, error=False):
        self.run_calls = self.mail_calls = 0
        self.wait = wait; self.error = error; self.cancel = None
        self.worker_thread = None
    def pending_runs(self, paths): return []
    def run(self, request, settings, paths, progress, cancel):
        self.run_calls += 1; self.cancel = cancel; self.worker_thread = threading.get_ident()
        progress(ProgressEvent('query', 1, 2, 'query_progress'))
        if self.error: raise RuntimeError('secret must never be displayed')
        if self.wait: cancel.wait(2)
        return RunOutcome('fake-run', 'cancelled' if cancel.is_set() else 'completed', date(2026,10,4), summaries=[{'army':'신','query_completion_rate':1.0}], sheet_published=not cancel.is_set())
    def preview_reports(self, run_id):
        return [ReportPreview('overall','전체',('test@example.invalid',),'가짜 보고서','개인정보 없는 요약','<p>요약</p>',True,None)]
    def send_selected(self, run_id, keys, resend=False):
        self.mail_calls += 1; return {key:'sent' for key in keys}

class WindowTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls): cls.app = QApplication.instance() or QApplication([]); cls.app.setFont(QFont("Apple SD Gothic Neo",11))
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.paths = RuntimePaths.for_user(Path(self.temp.name))
        self.settings = AppSettings('https://example.invalid','명단','정착률','https://example.invalid',self.paths.oauth_client_file,self.paths.oauth_token_file,'fake','2026-01-01','2026-12-31')
        self.windows=[]
    def tearDown(self):
        for window in self.windows:
            window.close(); self.pump(lambda: not window.isVisible())
        self.temp.cleanup()
    def pump(self, predicate):
        end=time.monotonic()+3
        while not predicate() and time.monotonic()<end:
            self.app.processEvents(); time.sleep(.005)
        self.app.processEvents(); self.assertTrue(predicate())
    def window(self, settings, service):
        from desktop.window import MainWindow
        w=MainWindow(settings,self.paths,lambda:service); self.windows.append(w); w.show(); return w
    def test_unconfigured_launch_does_not_start_run(self):
        s=FakeService(); w=self.window(None,s); self.app.processEvents()
        self.assertEqual(s.run_calls,0); self.assertFalse(w.send_button.isEnabled())
    def test_configured_launch_starts_once(self):
        s=FakeService(); w=self.window(self.settings,s); self.pump(lambda:w.outcome is not None)
        self.assertEqual(s.run_calls,1); self.assertEqual(s.mail_calls,0)
        self.assertNotEqual(s.worker_thread,threading.get_ident())
    def test_close_requests_cancel_without_freezing(self):
        s=FakeService(wait=True); w=self.window(self.settings,s); self.pump(lambda:s.cancel is not None)
        start=time.monotonic(); w.close(); self.assertLess(time.monotonic()-start,.2)
        self.assertTrue(s.cancel.is_set()); self.pump(lambda:not w.isVisible())
    def test_send_button_requires_preview(self):
        s=FakeService(); w=self.window(self.settings,s); self.pump(lambda:w.outcome is not None)
        w.send_button.click(); self.assertEqual(s.mail_calls,0)
        w.preview_button.click(); self.pump(lambda:w.send_button.isEnabled())
        w.report_list.item(0).setCheckState(__import__('PySide6.QtCore',fromlist=['Qt']).Qt.Checked)
        w.send_button.click(); self.pump(lambda:s.mail_calls==1)
    def test_worker_errors_are_sanitized_and_retry_available(self):
        s=FakeService(error=True); w=self.window(self.settings,s); self.pump(lambda:s.run_calls==1 and w.thread is None)
        self.assertNotIn('secret',w.status_label.text()); self.assertTrue(w.run_button.isEnabled())
    def test_setup_copies_private_client_and_authenticates_before_run(self):
        class Secrets:
            def set_password(self, account, password): self.saved=(account,password)
        class Adapter:
            def authenticate(self,settings,paths,secrets): self.account=settings.dimode_account
            def close(self): pass
        s=FakeService(); s.secret_store=Secrets(); s.adapter=Adapter()
        w=self.window(None,s)
        client=Path(self.temp.name)/'picked.json'; client.write_text('{"installed":{"client_id":"fake"}}')
        w.client_edit.setText(str(client)); w.account_edit.setText('fake'); w.password_edit.setText('fake-secret')
        w.setup_button.click(); self.pump(lambda:w.outcome is not None)
        self.assertEqual(s.run_calls,1); self.assertEqual(s.mail_calls,0)
        self.assertEqual(self.paths.oauth_client_file.stat().st_mode & 0o777,0o600)
        self.assertNotIn('fake-secret',self.paths.settings_file.read_text())
    def test_first_setup_constructs_lazy_production_adapter(self):
        from unittest.mock import patch
        from desktop.service import SettlementService
        class Secrets:
            def set_password(self,a,p): pass
        class Adapter:
            def __init__(self): self.authenticated=False
            def authenticate(self,*args): self.authenticated=True
            def close(self): pass
        service=SettlementService(secret_store=Secrets())
        w=self.window(None,service)
        client=Path(self.temp.name)/'picked.json'; client.write_text('{"installed":{}}')
        w.client_edit.setText(str(client)); w.account_edit.setText('fake'); w.password_edit.setText('fake')
        with patch('desktop.adapters.ProductionAdapter',Adapter),patch.object(service,'run',return_value=RunOutcome('fake','completed',date(2026,10,4))):
            w.setup_button.click(); self.pump(lambda:w.outcome is not None)
        self.assertTrue(service.adapter.authenticated)
    def test_pending_run_requires_choice_and_resumes_same_service(self):
        s=FakeService()
        s.pending_runs=lambda paths:[{'run_id':'interrupted','as_of':'2026-10-04','stage':'query'}]
        s.resume=lambda run_id,settings,paths,progress,cancel:RunOutcome(run_id,'completed',date(2026,10,4))
        w=self.window(self.settings,s); self.app.processEvents(); self.assertEqual(s.run_calls,0)
        w.resume_button.click(); self.pump(lambda:w.outcome is not None)
        self.assertEqual(w.outcome.run_id,'interrupted'); self.assertEqual(s.mail_calls,0)
    def test_unseen_report_and_uncertain_are_not_sent(self):
        s=FakeService(); w=self.window(self.settings,s); self.pump(lambda:w.outcome is not None)
        s.preview_reports=lambda run_id:[ReportPreview(key,key,('test@example.invalid',),'test','test','',True,None,status) for key,status in [('overall','pending'),('army:신','pending'),('army:조','uncertain')]]
        w.preview_button.click(); self.pump(lambda:w.send_button.isEnabled())
        from PySide6.QtCore import Qt
        for i in (1,2): w.report_list.item(i).setCheckState(Qt.Checked)
        w.resend.setChecked(True); w.send_button.click(); self.pump(lambda:w.thread is None); self.assertEqual(s.mail_calls,0)
        w.report_list.setCurrentRow(1); w.send_button.click(); self.pump(lambda:s.mail_calls==1)
    def test_preview_displays_html_and_summary_uses_readable_rates(self):
        s=FakeService(); w=self.window(self.settings,s); self.pump(lambda:w.outcome is not None)
        w.show_outcome(RunOutcome('fake','completed',date(2026,10,4),summaries=[{'army':'신','completion_rate':.95,'recent_rate':.5,'as_of':'2026-10-04'}]))
        headers=[w.table.horizontalHeaderItem(i).text() for i in range(w.table.columnCount())]
        self.assertIn('조회 완료율',headers)
        col=headers.index('조회 완료율'); self.assertEqual(w.table.item(0,col).text(),'95.0%')
        s.preview_reports=lambda run_id:[ReportPreview('overall','전체',('test@example.invalid',),'제목','plain','<p>HTML 보고서 본문</p>',True,None)]
        w.preview_button.click(); self.pump(lambda:w.send_button.isEnabled())
        self.assertIn('HTML 보고서 본문',w.preview_browser.toPlainText())
    def test_corrupt_saved_settings_opens_setup_without_external_run(self):
        self.paths.ensure_directories(); self.paths.settings_file.write_text('{broken')
        s=FakeService(); w=self.window(None,s); self.app.processEvents()
        self.assertTrue(w.setup_panel.isVisible()); self.assertEqual(s.run_calls,0)
    def test_cancel_button_cancels_current_and_next_worker_without_publication(self):
        s=FakeService(wait=True); w=self.window(self.settings,s)
        self.pump(lambda:s.cancel is not None)
        first=s.cancel
        w.cancel_button.click()
        self.assertTrue(first.is_set(), '취소 버튼은 현재 worker 이벤트를 설정해야 한다')
        self.pump(lambda:w.outcome is not None and w.thread is None)
        self.assertEqual(w.outcome.status,'cancelled')
        self.assertFalse(w.outcome.sheet_published)
        w.run_button.click()
        self.pump(lambda:s.run_calls==2 and s.cancel is not first)
        second=s.cancel
        self.assertFalse(second.is_set(), '새 조회에는 새 취소 이벤트가 필요하다')
        w.cancel_button.click()
        self.assertTrue(second.is_set(), '두 번째 worker도 버튼으로 취소해야 한다')
        self.pump(lambda:w.outcome is not None and w.thread is None)
        self.assertEqual(w.outcome.status,'cancelled')
        self.assertFalse(w.outcome.sheet_published)
        self.assertEqual(s.mail_calls,0)
    def test_cancel_button_blocks_real_service_publication_and_mail(self):
        from desktop.service import SettlementService
        from test_desktop_service import FakeAdapter, row
        adapter=FakeAdapter([row(0),row(1)])
        entered=threading.Event(); release=threading.Event()
        adapter.after_query=lambda:(entered.set(),release.wait(2))
        service=SettlementService(adapter=adapter)
        w=self.window(self.settings,service)
        try:
            for attempt in range(2):
                if attempt: w.run_button.click()
                self.pump(entered.is_set)
                w.cancel_button.click()
                self.assertTrue(w.cancel.is_set())
                release.set()
                self.pump(lambda:w.outcome is not None and w.thread is None)
                self.assertEqual(w.outcome.status,'cancelled')
                self.assertFalse(w.outcome.sheet_published)
                self.assertEqual(adapter.sheets.writes,[])
                self.assertEqual(adapter.sheets.tabs,{})
                self.assertEqual(adapter.legacy,[])
                self.assertEqual(adapter.send_calls,[])
                entered.clear(); release.clear()
        finally: release.set()
    def test_setup_trial_runs_real_service_one_person_without_sheets_or_mail(self):
        from desktop.service import SettlementService
        from test_desktop_service import FakeAdapter,row
        class Secrets:
            def set_password(self,*args): pass
        adapter=FakeAdapter([row(0),row(1)])
        service=SettlementService(adapter,Secrets()); w=self.window(None,service)
        client=Path(self.temp.name)/'picked.json'; client.write_text('{"installed":{}}')
        w.client_edit.setText(str(client)); w.account_edit.setText('fake'); w.password_edit.setText('fake')
        w.trial_button.click(); self.pump(lambda:w.outcome is not None and w.thread is None)
        self.assertEqual(w.outcome.status,'test'); self.assertEqual(len(adapter.queries),1)
        self.assertEqual(adapter.legacy,[]); self.assertEqual(adapter.sheets.writes,[]); self.assertEqual(adapter.send_calls,[])
        self.assertFalse(w.preview_button.isEnabled()); self.assertFalse(w.send_button.isEnabled())
        with service.history._connect() as db:
            self.assertEqual(db.execute('SELECT status,selected FROM runs').fetchall(),[('test',0)])
        self.app.processEvents(); self.assertEqual(len(adapter.queries),1)
    def test_reset_authentication_forces_real_credential_flow(self):
        from desktop.adapters import ProductionAdapter
        from desktop.service import SettlementService
        from unittest.mock import patch,Mock
        class Secrets:
            def set_password(self,*args): pass
            def get_password(self,*args): return 'fake'
        adapter=ProductionAdapter(); service=SettlementService(adapter,Secrets())
        service.pending_runs=lambda paths:[{'run_id':'hold','as_of':'2026-10-04','stage':'authentication'}]
        service.run=Mock(return_value=RunOutcome('fake','completed',date(2026,10,4)))
        w=self.window(self.settings,service)
        self.paths.ensure_directories(); self.paths.oauth_client_file.write_text('{}'); self.paths.oauth_token_file.write_text('broken')
        w.reset_button.click(); w.password_edit.setText('fake')
        fresh=Mock(); fresh.to_json.return_value='{}'
        with patch('google.oauth2.credentials.Credentials.from_authorized_user_file') as read, patch('google_auth_oauthlib.flow.InstalledAppFlow.from_client_secrets_file') as flow, patch('googleapiclient.discovery.build'),patch('playwright.sync_api.sync_playwright'),patch('settlement_automation.wait_for_login'),patch('settlement_automation.spreadsheet_id_from_url',return_value='test-only'):
            flow.return_value.run_local_server.return_value=fresh
            w.setup_button.click(); self.pump(lambda:w.thread is None)
            self.assertIsNotNone(w.outcome,w.status_label.text()+self.paths.log_file.read_text() if self.paths.log_file.exists() else w.status_label.text())
        read.assert_not_called(); flow.return_value.run_local_server.assert_called_once_with(port=0,prompt='select_account')
    def test_history_table_renders_missing_month_and_empty_ratio(self):
        from desktop.service import SettlementService
        from test_desktop_service import FakeAdapter,row
        service=SettlementService(FakeAdapter([row()]))
        service.run(__import__('desktop.service',fromlist=['RunRequest']).RunRequest(as_of=date(2026,8,31)),self.settings,self.paths,lambda _:None,threading.Event())
        w=self.window(self.settings,service)
        w.historical.setChecked(True); w.as_of.setDate(__import__('PySide6.QtCore',fromlist=['QDate']).QDate(2026,10,4))
        self.pump(lambda:w.outcome is not None and w.thread is None)
        values=[[w.history_table.item(r,c).text() for c in range(w.history_table.columnCount())] for r in range(w.history_table.rowCount())]
        missing=next(r for r in values if r[0]=='2026-09')
        self.assertEqual(missing[1],'미실행'); self.assertTrue(all(v=='' for v in missing[3:]))
    def test_typed_setup_errors_offer_specific_guidance_and_private_diagnostic(self):
        from desktop.service import SettlementService
        from test_desktop_service import FakeAdapter,row
        class Secrets:
            def set_password(self,*args): pass
        w=self.window(None,SettlementService(FakeAdapter([row()]),Secrets()))
        client=Path(self.temp.name)/'picked.json'; client.write_text('{private-broken')
        w.client_edit.setText(str(client)); w.account_edit.setText('fake'); w.password_edit.setText('private-password')
        w.setup_button.click(); self.pump(lambda:w.thread is None)
        self.assertIn('Google 인증 파일',w.status_label.text()); self.assertNotIn('다시 시도',w.status_label.text())
        self.assertNotIn('private',w.status_label.text()+self.paths.log_file.read_text())

    def test_sheet_validation_outcome_is_visible_in_window(self):
        from desktop.service import SettlementService
        from desktop.sheets import CURRENT_TAB
        from test_desktop_service import FakeAdapter,row
        adapter=FakeAdapter([row()]); adapter.sheets.tabs[CURRENT_TAB]=[['existing']]
        w=self.window(self.settings,SettlementService(adapter))
        self.pump(lambda:w.outcome is not None and w.thread is None)
        self.assertEqual(w.outcome.status,'validation_blocked')
        self.assertIn(CURRENT_TAB,w.status_label.text()); self.assertIn('열 구성',w.status_label.text())
        self.assertNotIn('다시 시도',w.status_label.text())
    def test_date_and_file_access_guidance_are_typed_without_paths(self):
        from desktop.errors import diagnose,ValidationIssue
        from dataclasses import replace
        invalid=replace(self.settings,roster_start='2026-12-31',roster_end='2026-01-01')
        with self.assertRaises(ValidationIssue) as caught: invalid.validate()
        failure=diagnose(caught.exception,'setup',self.paths)
        self.assertEqual(failure.code,'date'); self.assertIn('시작일',failure.guidance)
        failure=diagnose(PermissionError('secret-path'),'setup',self.paths)
        self.assertEqual(failure.code,'file_access'); self.assertIn('접근 권한',failure.guidance)
        self.assertNotIn('secret-path',failure.guidance+self.paths.log_file.read_text())
