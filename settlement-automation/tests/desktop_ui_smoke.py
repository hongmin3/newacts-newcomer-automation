"""Local visible Qt smoke; no network, operational settings, or Keychain writes.
Run from project root: QT_QPA_PLATFORM=cocoa .venv/bin/python -B tests/desktop_ui_smoke.py
"""
import json
import sys
import tempfile
import time
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from test_desktop_window import FakeService, WindowTests
from desktop.window import MainWindow
from desktop.service import RunOutcome
from datetime import date
from PySide6.QtCore import Qt
from PySide6.QtGui import QFont
from PySide6.QtWidgets import QApplication
from desktop.runtime import RuntimePaths
from desktop.settings import AppSettings
app=QApplication.instance() or QApplication([]); app.setFont(QFont('Apple SD Gothic Neo',11))
artifacts=Path(tempfile.mkdtemp(prefix='newacts-ui-smoke-'))
def pump(condition=lambda:False,seconds=.2):
    deadline=time.monotonic()+seconds
    while time.monotonic()<deadline:
        app.processEvents(); time.sleep(.005)
        if condition(): return
    if condition is not None and condition()!=False: return

def snapshot(w,name):
    pump(seconds=.3); w.grab().save(str(artifacts/(name+'.png')))
    print(json.dumps({'screen':name,'visible':w.isVisible(),'status':w.status_label.text()},ensure_ascii=False))
with tempfile.TemporaryDirectory() as home:
    paths=RuntimePaths.for_user(Path(home))
    settings=AppSettings('https://example.invalid','명단','정착률','https://example.invalid',paths.oauth_client_file,paths.oauth_token_file,'fake','2026-01-01','2026-12-31')
    class Secrets:
        def set_password(self,*args): pass
    class Adapter:
        def authenticate(self,*args): pass
        def close(self): pass
    s=FakeService(); s.secret_store=Secrets(); s.adapter=Adapter()
    w=MainWindow(None,paths,lambda:s); w.show(); snapshot(w,'setup')
    client=Path(home)/'picked.json'; client.write_text('{"installed":{}}')
    w.client_edit.setText(str(client)); w.account_edit.setText('fake'); w.password_edit.setText('fake')
    w.setup_button.click(); pump(lambda:w.outcome is not None,3); assert w.outcome and s.run_calls==1 and s.mail_calls==0
    snapshot(w,'completed'); w.preview_button.click(); pump(lambda:w.send_button.isEnabled(),3); snapshot(w,'preview')
    w.report_list.item(0).setCheckState(Qt.Checked); w.send_button.click(); pump(lambda:w.thread is None,3)
    assert s.mail_calls==1; snapshot(w,'sent'); w.close(); pump()
    s=FakeService(wait=True); w=MainWindow(settings,paths,lambda:s); w.show(); pump(lambda:s.cancel is not None,3)
    snapshot(w,'progress'); w.close(); assert s.cancel.is_set(); pump(lambda:not w.isVisible(),3); assert not w.isVisible()
    print('{"close_cancel":true,"thread_finished":true}')
    s=FakeService(error=True); w=MainWindow(settings,paths,lambda:s); w.show(); pump(lambda:s.run_calls==1 and w.thread is None,3)
    assert 'secret' not in w.status_label.text(); snapshot(w,'error'); w.close(); pump()
print('증거 폴더:',artifacts)
