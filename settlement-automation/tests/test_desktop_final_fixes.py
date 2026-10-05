"""Validates: REQ-RATEDESKTOP-001,002,003,004,006. Real boundaries, fake external I/O."""
import json
import tempfile
import unittest
from pathlib import Path
from datetime import date
from dataclasses import replace
from threading import Event
from unittest.mock import patch, Mock, MagicMock
from desktop.runtime import RuntimePaths
from desktop.settings import load_settings
from desktop.service import SettlementService, RunRequest
from desktop.sheets import CURRENT_TAB, CARE_TAB, TAB_HEADERS, OWNER
from test_desktop_service import FakeAdapter, row

class FinalFixTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.paths=RuntimePaths.for_user(Path(self.temp.name)); self.paths.ensure_directories()
        self.settings=replace(load_settings(self.paths),dimode_account='fake',roster_start='2026-01-01',roster_end='2026-12-31')
        self.adapter=FakeAdapter([row()]); self.service=SettlementService(self.adapter)
    def run_service(self,as_of=date(2026,10,4)):
        return self.service.run(RunRequest(as_of=as_of),self.settings,self.paths,lambda _:None,Event())
    def test_explicit_reauthorization_skips_invalid_corrupt_and_valid_tokens(self):
        from settlement_automation import get_google_credentials
        from google.auth.exceptions import RefreshError
        self.paths.oauth_client_file.write_text('{}')
        for token_state in ('invalid','corrupt','valid'):
            with self.subTest(token=token_state):
                self.paths.oauth_token_file.write_text('old token')
                stale=Mock(valid=token_state=='valid',expired=token_state!='valid',refresh_token='fake')
                stale.refresh.side_effect=RefreshError('invalid_grant')
                fresh=Mock(); fresh.to_json.return_value='{"new":true}'
                with patch('google.oauth2.credentials.Credentials.from_authorized_user_file',side_effect=ValueError('secret') if token_state=='corrupt' else None,return_value=stale) as read, patch('google_auth_oauthlib.flow.InstalledAppFlow.from_client_secrets_file') as flow:
                    flow.return_value.run_local_server.return_value=fresh
                    self.assertIs(get_google_credentials(paths=self.paths,reauthorize=True),fresh)
                    read.assert_not_called(); stale.refresh.assert_not_called()
                    flow.return_value.run_local_server.assert_called_once_with(port=0,prompt='select_account')
                self.assertEqual(json.loads(self.paths.oauth_token_file.read_text()),{'new':True})
    def test_refresh_transient_and_revoked_have_different_safe_guidance(self):
        from settlement_automation import get_google_credentials
        from google.auth.exceptions import RefreshError, TransportError
        self.paths.oauth_client_file.write_text('{}'); self.paths.oauth_token_file.write_text('old')
        for error,code in ((RefreshError('private invalid grant'),'google_reauthorize'),(RefreshError('private temporary',retryable=True),'connection'),(TransportError('private network'),'connection')):
            with self.subTest(code=code):
                stale=Mock(valid=False,expired=True,refresh_token='fake'); stale.refresh.side_effect=error
                with patch('google.oauth2.credentials.Credentials.from_authorized_user_file',return_value=stale), patch('google_auth_oauthlib.flow.InstalledAppFlow.from_client_secrets_file') as flow:
                    with self.assertRaises(Exception) as caught: get_google_credentials(paths=self.paths)
                    self.assertEqual(getattr(caught.exception,'code',None),code)
                    flow.assert_not_called()
                self.assertEqual(self.paths.oauth_token_file.read_text(),'old')
    def test_historical_prefilter_removes_future_only_before_limit_and_quality(self):
        past=dict(row(),날짜='2026-09-01'); future=dict(row(1),날짜='2026-10-05')
        self.adapter.rows=[future,past]
        outcome=self.run_service(date(2026,9,30))
        self.assertEqual(outcome.status,'completed'); self.assertEqual(len(outcome.results),1)
        self.assertEqual(self.adapter.queries,[past['이름']]); self.assertEqual(outcome.summaries[0]['completion_rate'],1)
    def test_ambiguous_dates_remain_in_quality_denominator(self):
        self.settings=replace(self.settings,roster_start='2025-01-01',roster_end='2026-12-31')
        self.adapter.rows=[dict(row(),날짜='2026-09-01'),dict(row(1,completed=False),날짜='9.1')]
        outcome=self.run_service()
        self.assertEqual(outcome.status,'quality_failed'); self.assertEqual(len(outcome.results),2)
    def test_zero_sundays_after_registration_is_completed_no_target(self):
        import settlement_automation as a
        popup=Mock(url='https://example.invalid/?id=fake'); page=MagicMock()
        page.expect_popup.return_value.__enter__.return_value.value=popup
        person={'name':'가상','army':'신','team':'시험팀'}
        with patch.object(a,'find_exact_person_card',return_value=(Mock(),'조회완료',person)):
            result=a.inspect_person(page,Mock(),{'날짜':'2026-10-05'},date(2026,10,6),roster_start='2026-01-01',roster_end='2026-12-31')
        self.assertEqual(result['status'],'조회완료'); self.assertEqual(result['observation_status'],'계산 대상 없음')
        self.assertEqual(result['possible'],0); self.assertIsNone(result['rate']); self.assertEqual(result['dimode_id'],'fake')
    def test_missing_month_reaches_outcome_without_fabricating_run(self):
        self.run_service(date(2026,8,31)); outcome=self.run_service(date(2026,10,4))
        missing=[s for s in outcome.monthly_history if s['month']=='2026-09']
        self.assertEqual(missing[0]['status'],'미실행'); self.assertIsNone(missing[0]['rate']); self.assertIsNone(missing[0]['rate_delta_pp'])
        with self.service.history._connect() as db: self.assertEqual(db.execute('SELECT COUNT(*) FROM runs').fetchone()[0],2)
    def test_sheet_validation_is_actionable_private_and_not_retry_only(self):
        self.adapter.sheets.tabs[CURRENT_TAB]=[['private content']]
        outcome=self.run_service()
        self.assertEqual(outcome.status,'validation_blocked'); self.assertIn(CURRENT_TAB,outcome.error)
        self.assertNotIn('다시 시도',outcome.error); self.assertEqual(outcome.failure.code,'sheet_structure')
        log=self.paths.log_file.read_text(); self.assertNotIn('private content',log)
        record=json.loads(log.splitlines()[-1]); self.assertEqual(record['code'],'sheet_structure'); self.assertEqual(record['stage'],'publication')
        self.assertEqual(self.paths.log_file.stat().st_mode&0o777,0o600)
    def test_duplicate_id_guidance_does_not_reveal_id(self):
        self.adapter.sheets.tabs[CARE_TAB]=[list(TAB_HEADERS[CARE_TAB]),['secret-person-id'],['secret-person-id']]
        self.adapter.sheets.owners[CARE_TAB]=OWNER
        outcome=self.run_service()
        self.assertEqual(outcome.status,'validation_blocked'); self.assertIn('중복',outcome.error)
        self.assertNotIn('secret-person-id',outcome.error+self.paths.log_file.read_text())
    def test_external_exception_contents_do_not_enter_diagnostics(self):
        self.adapter.load_rows=Mock(side_effect=RuntimeError('token=PRIVATE 이름=SECRET'))
        outcome=self.run_service()
        self.assertIsNotNone(outcome.failure)
        record=json.loads(self.paths.log_file.read_text().splitlines()[-1])
        self.assertEqual(set(record),{'diagnostic_id','code','stage','error_type'})
        self.assertNotIn('PRIVATE',outcome.error+self.paths.log_file.read_text())

    def test_corrupt_token_is_reauth_guidance_but_cli_preserves_error(self):
        import settlement_automation as a
        from desktop.errors import ValidationIssue
        self.paths.oauth_client_file.write_text('{}'); self.paths.oauth_token_file.write_text('{broken')
        with patch('google.oauth2.credentials.Credentials.from_authorized_user_file',side_effect=ValueError('private content')):
            with self.assertRaises(ValidationIssue) as raised: a.get_google_credentials(paths=self.paths)
            self.assertEqual(raised.exception.code,'google_reauthorize')
            with patch.object(a.config,'GOOGLE_OAUTH_CLIENT_FILE',self.paths.oauth_client_file,create=True), patch.object(a.config,'GOOGLE_OAUTH_TOKEN_FILE',self.paths.oauth_token_file,create=True):
                with self.assertRaises(ValueError) as original: a.get_google_credentials()
                self.assertNotIsInstance(original.exception,ValidationIssue)
        self.assertEqual(self.paths.oauth_token_file.read_text(),'{broken')
    def test_trial_limit_applies_after_historical_eligibility(self):
        self.adapter.rows=[dict(row(1),날짜='2026-10-05'),dict(row(2),날짜='2026-09-01')]
        outcome=self.service.run(RunRequest(as_of=date(2026,9,30),limit=1,test_mode=True),self.settings,self.paths,lambda _:None,Event())
        self.assertEqual(outcome.status,'test'); self.assertEqual(self.adapter.queries,['가상2'])
        self.assertEqual(self.adapter.legacy,[]); self.assertEqual(self.adapter.send_calls,[])
