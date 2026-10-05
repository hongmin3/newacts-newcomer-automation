"""Developer-only bundled probe. Real local stack, fake external boundaries."""
import json
import os
import platform
import sqlite3
import sys
import tempfile
import time
from dataclasses import replace
from datetime import date
from pathlib import Path
from threading import Event
from .bundle import check_browser
from .runtime import RuntimePaths, resource_path
from .settings import load_settings, save_settings
from .service import SettlementService, RunRequest
from .sheets import TAB_HEADERS

class LocalSheets:
    def __init__(self): self.tabs={}; self.owners={}
    def read_tab(self,name): return self.tabs.get(name)
    def ownership(self,name): return self.owners.get(name)
    def create_tab(self,name,headers,owner): self.tabs[name]=[list(headers)]; self.owners[name]=owner
    def write_rows(self,name,rows): self.tabs[name]=[list(TAB_HEADERS[name])]+rows
    def update_cells(self,name,updates):
        for r,c,v in updates:
            while len(self.tabs[name])<=r: self.tabs[name].append([])
            while len(self.tabs[name][r])<=c: self.tabs[name][r].append('')
            self.tabs[name][r][c]=v

class LocalAdapter:
    def __init__(self,fail=False): self.sheets=LocalSheets(); self.fail=fail; self.mail_calls=0
    def authenticate(self,*args):
        if self.fail: raise RuntimeError('fake secret never displayed')
    def load_rows(self):
        return [{'No.':1,'군':'신','팀':'가짜','이름':'가상','성별':'','핸드폰':'','등록일':'2026-09-01',
                 '기준일':'2026-10-04','조회 상태':'조회완료','디모데 ID':'fake-1','비고':'',
                 '대상 일요일':5,'출석 일요일':3,'정착률':.6,'최근 4주':'',
                 'possible':5,'attended':3,'rate':.6,'recent_possible':4,'recent_attended':2,
                 'recent_rate':.5,'observation_status':'충분','formula_version':'recent4-v1'}]
    def query_person(self,row,options): return dict(row)
    def write_legacy(self,*args): pass
    def send(self,*args): self.mail_calls+=1; raise AssertionError('메일 호출 금지')
    def close(self): pass

class LocalSecrets:
    def set_password(self,*args): pass
    def get_password(self,*args): return 'fake'

def run(home=None,visible=False):
    # Missing browser is a hard failure before any local job; never use user cache.
    browser_root=check_browser(resource_path('playwright-browsers'))
    os.environ['PLAYWRIGHT_BROWSERS_PATH']=str(browser_root)
    from playwright.sync_api import sync_playwright
    from PySide6.QtWidgets import QApplication
    from PySide6.QtGui import QFont
    from .window import MainWindow
    # Developer previews must not expose operational recipients from legacy defaults.
    import settlement_email
    settlement_email.DEFAULT_ADMIN_RECIPIENTS=['test@example.invalid']
    settlement_email.DEFAULT_TEST_RECIPIENT='test@example.invalid'
    settlement_email.DEFAULT_ARMY_RECIPIENTS={'신':'test@example.invalid'}
    app=QApplication.instance() or QApplication([]); app.setFont(QFont('Apple SD Gothic Neo',11))
    with tempfile.TemporaryDirectory(prefix='newacts-bundle-') as temporary:
        home=Path(home).resolve() if home else Path(temporary)
        if home==Path.home().resolve() or 'newacts' not in home.name:
            raise ValueError('자체 검사에는 newacts 이름의 격리 폴더만 사용할 수 있습니다.')
        paths=RuntimePaths.for_user(home); paths.ensure_directories()
        settings=replace(load_settings(paths),sheet_url='https://example.invalid',dimode_url='https://example.invalid',dimode_account='fake',roster_start='2026-01-01',roster_end='2026-12-31')
        adapter=LocalAdapter(); service=SettlementService(adapter,LocalSecrets())
        def pump(predicate,seconds=10):
            deadline=time.monotonic()+seconds
            while not predicate() and time.monotonic()<deadline: app.processEvents(); time.sleep(.005)
            app.processEvents(); assert predicate(), 'Qt 작업 시간 초과'
        setup=MainWindow(None,paths,lambda:service); setup.show(); app.processEvents()
        assert setup.outcome is None and setup.status_label.text()=='최초 설정을 완료해 주세요.'
        if visible: setup.grab().save(str(home/'setup.png'))
        setup.close(); app.processEvents()
        save_settings(paths,settings)
        before=paths.settings_file.read_bytes()
        outcome=service.run(RunRequest(as_of=date(2026,10,4)),settings,paths,lambda event:None,Event())
        assert outcome.status=='completed' and outcome.sheet_published and adapter.mail_calls==0
        window=MainWindow(load_settings(paths),paths,lambda:service); window.show()
        pump(lambda:window.outcome is not None and window.thread is None)
        assert window.outcome.status=='completed'
        window.preview_button.click(); pump(lambda:window.send_button.isEnabled() and window.thread is None)
        if visible: window.grab().save(str(home/'preview.png'))
        window.close(); app.processEvents()
        error_paths=RuntimePaths.for_user(home/'newacts-error')
        error_settings=replace(settings,oauth_client_file=error_paths.oauth_client_file,oauth_token_file=error_paths.oauth_token_file)
        error=MainWindow(error_settings,error_paths,lambda:SettlementService(LocalAdapter(True),LocalSecrets())); error.show()
        # Repeated probes preserve prior authentication failures. The product waits
        # for a human recovery choice; this fake probe explicitly requests a new run.
        if error.pending_combo.count(): error.start_run()
        pump(lambda:error.thread is None and error.outcome is not None)
        assert error.outcome.status=='authentication_required' and 'fake secret' not in error.status_label.text()
        if visible: error.grab().save(str(home/'error.png'))
        error.close(); app.processEvents()
        with sqlite3.connect(paths.history_file) as db:
            count=db.execute('SELECT count(*) FROM runs').fetchone()[0]
        assert count>=2 and paths.settings_file.read_bytes()==before
        with sync_playwright() as playwright:
            browser=playwright.chromium.launch(headless=not visible)
            page=browser.new_page(); page.route('**/*',lambda route:route.abort())
            page.set_content('<title>Newacts local bundle check</title><p>로컬 브라우저 검사</p>')
            assert page.title()=='Newacts local bundle check'
            if visible: page.screenshot(path=str(home/'browser.png')); time.sleep(1)
            browser.close()
        result={'status':'PASS','frozen':bool(getattr(sys,'frozen',False)),'architecture':platform.machine(),
                'resources':str(resource_path('config.example.py')),'browser_root':str(browser_root),
                'sqlite':sqlite3.sqlite_version,'history_runs':count,'mail_calls':adapter.mail_calls,'settings_preserved':True}
        print(json.dumps(result,ensure_ascii=False),flush=True)
        if visible: (home/'result.json').write_text(json.dumps(result,ensure_ascii=False))
    return 0
