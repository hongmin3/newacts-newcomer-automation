"""Validates: REQ-RATEDESKTOP-001,003,004,005,006. External effects stay fake."""
import multiprocessing
import tempfile
import unittest
from contextlib import contextmanager
from datetime import date
from pathlib import Path
from threading import Event
from dataclasses import replace
from desktop.runtime import RuntimePaths
from desktop.settings import load_settings
from desktop.history import HistoryStore
from desktop.sheets import TAB_HEADERS
from desktop.service import SettlementService, RunRequest, ProcessLock


def row(i=0, army='신', completed=True):
    return {'No.':i+1,'군':army,'팀':'시험팀','이름':'가상'+str(i),'성별':'','핸드폰':'',
            '등록일':'2026-09-01','기준일':'2026-10-04','대상 일요일':5,
            '출석 일요일':3 if completed else None,'정착률':.6 if completed else None,
            '최근 4주':'','조회 상태':'조회완료' if completed else '조회오류','비고':'','디모데 ID':str(i),
            'possible':5,'attended':3 if completed else None,'rate':.6 if completed else None,
            'recent_possible':4,'recent_attended':2 if completed else None,
            'recent_rate':.5 if completed else None,'observation_status':'충분','formula_version':'recent4-v1'}


class FakeSheets:
    def __init__(self): self.tabs={}; self.owners={}; self.writes=[]; self.fail=None
    def read_tab(self,name): return self.tabs.get(name)
    def ownership(self,name): return self.owners.get(name)
    def create_tab(self,name,headers,owner): self.tabs[name]=[list(headers)]; self.owners[name]=owner
    def write_rows(self,name,rows):
        if name==self.fail: raise OSError('network')
        self.writes.append(name); self.tabs[name]=[list(TAB_HEADERS[name])]+rows
    def update_cells(self,name,updates):
        self.writes.append(name)
        for r,c,v in updates:
            while len(self.tabs[name])<=r: self.tabs[name].append([])
            while len(self.tabs[name][r])<=c: self.tabs[name][r].append('')
            self.tabs[name][r][c]=v


class FakeAdapter:
    def __init__(self,rows):
        self.rows=rows; self.sheets=FakeSheets(); self.send_calls=[]; self.legacy=[]; self.fail_send=False
        self.after_query=None; self.auth=True; self.queries=[]
    def authenticate(self,settings,paths,secret_store):
        if not self.auth: raise RuntimeError('auth failure with secret')
    def load_rows(self): return self.rows
    def query_person(self,item,options):
        self.queries.append(item['이름'])
        if self.after_query: self.after_query()
        return dict(item)
    def write_legacy(self,results,as_of): self.legacy.append(results)
    def send(self,report):
        self.send_calls.append(report.key)
        if self.fail_send: raise TimeoutError('unknown delivery')
        return 'gmail-id'
    def close(self): pass


def lock_attempt(path,queue):
    try:
        with ProcessLock(Path(path)): queue.put('acquired')
    except BlockingIOError: queue.put('blocked')


class ServiceTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.paths=RuntimePaths.for_user(Path(self.tmp.name)); self.paths.ensure_directories()
        self.settings=replace(load_settings(self.paths),roster_start='2026-01-01',roster_end='2026-12-31',dimode_account='fake')
        self.adapter=FakeAdapter([row()]); self.service=SettlementService(self.adapter)
    def run_service(self,**kwargs):
        return self.service.run(RunRequest(as_of=date(2026,10,4),**kwargs),self.settings,self.paths,lambda e:None,Event())
    def test_run_never_sends_email(self):
        result=self.run_service()
        self.assertEqual(result.status,'completed'); self.assertTrue(result.sheet_published)
        self.assertEqual(self.adapter.send_calls,[]); self.assertEqual(len(self.adapter.legacy),1)
        self.assertEqual(self.service.preview_reports(result.run_id)[0].key,'overall')
    def test_cancel_preserves_previous_success(self):
        prior=self.run_service(); cancel=Event(); self.adapter.after_query=cancel.set
        current=self.service.run(RunRequest(as_of=date(2026,10,4)),self.settings,self.paths,lambda e:None,cancel)
        self.assertEqual(current.status,'cancelled'); self.assertFalse(current.sheet_published)
        selected=HistoryStore(self.paths.data_root).monthly_summary('2026-10','recent4-v1')
        self.assertEqual(selected[0]['run_id'],prior.run_id); self.assertEqual(len(self.adapter.legacy),1)
    def test_second_process_cannot_write(self):
        with ProcessLock(self.paths.data_root/'execution.lock'):
            ctx=multiprocessing.get_context('spawn'); queue=ctx.Queue(); p=ctx.Process(target=lock_attempt,args=(str(self.paths.data_root/'execution.lock'),queue)); p.start()
            self.assertEqual(queue.get(timeout=10),'blocked'); p.join(10); self.assertEqual(p.exitcode,0)
            outcome=self.run_service(); self.assertEqual(outcome.status,'busy'); self.assertEqual(self.adapter.legacy,[])
        with ProcessLock(self.paths.data_root/'execution.lock'): pass
    def test_94_percent_army_is_blocked_95_is_allowed(self):
        self.adapter.rows=[row(i,'신',i<94) for i in range(100)]+[row(i+100,'조',i<95) for i in range(100)]+[row(i+200,'명') for i in range(100)]
        outcome=self.run_service(); previews=self.service.preview_reports(outcome.run_id)
        states=self.service.send_selected(outcome.run_id,['army:신','army:조'])
        self.assertEqual(states,{'army:신':'blocked','army:조':'sent'}); self.assertEqual(self.adapter.send_calls,['army:조'])
        self.assertTrue(next(p for p in previews if p.key=='overall').enabled)
    def test_uncertain_delivery_is_not_retried(self):
        outcome=self.run_service(); self.service.preview_reports(outcome.run_id); self.adapter.fail_send=True
        self.assertEqual(self.service.send_selected(outcome.run_id,['overall'])['overall'],'uncertain')
        calls=len(self.adapter.send_calls)
        self.service.resume(outcome.run_id,self.settings,self.paths,lambda e:None,Event())
        self.service.preview_reports(outcome.run_id)
        self.assertEqual(self.service.send_selected(outcome.run_id,['overall'],resend=True)['overall'],'uncertain')
        self.assertEqual(len(self.adapter.send_calls),calls)
    def test_partial_publication_resume_does_not_repeat_completed_stages(self):
        self.adapter.sheets.fail='정착률 월별 이력'; outcome=self.run_service()
        self.assertEqual(outcome.status,'publication_failed'); self.assertEqual(self.adapter.sheets.writes,['군별 정착 현황'])
        self.adapter.sheets.fail=None
        recovered=self.service.resume(outcome.run_id,self.settings,self.paths,lambda e:None,Event())
        self.assertEqual(recovered.status,'completed'); self.assertEqual(len(self.adapter.legacy),1)
        self.assertEqual(self.adapter.sheets.writes.count('군별 정착 현황'),1)
        self.assertEqual(len(self.adapter.queries),1)
    def test_authentication_and_period_block_writes(self):
        self.adapter.auth=False; outcome=self.run_service(); self.assertEqual(outcome.status,'authentication_required'); self.assertEqual(self.adapter.legacy,[])
        self.adapter.auth=True; self.settings=replace(self.settings,roster_start=None)
        self.assertEqual(self.run_service().status,'setup_required'); self.assertEqual(self.adapter.queries,[])
    def test_preview_required_sent_not_repeated_test_mode_is_separate(self):
        outcome=self.run_service()
        self.assertEqual(self.service.send_selected(outcome.run_id,['overall'])['overall'],'preview_required')
        self.service.preview_reports(outcome.run_id)
        self.assertEqual(self.service.send_selected(outcome.run_id,['overall'])['overall'],'sent')
        self.assertEqual(self.service.send_selected(outcome.run_id,['overall'])['overall'],'sent')
        self.assertEqual(len(self.adapter.send_calls),1)
        test=self.run_service(test_mode=True,limit=1); self.assertEqual(test.status,'test'); self.assertFalse(test.sheet_published)
        self.assertEqual(len(self.adapter.legacy),1)
    def test_no_preview_does_not_become_approval_on_second_attempt(self):
        outcome=self.run_service()
        for _ in range(2):
            self.assertEqual(self.service.send_selected(outcome.run_id,['overall'])['overall'],'preview_required')
        self.assertEqual(self.adapter.send_calls,[])
    def test_global_quality_94_is_blocked_95_is_allowed(self):
        self.adapter.rows=[row(i,completed=i<94) for i in range(100)]
        failed=self.run_service(); self.assertEqual(failed.status,'quality_failed'); self.assertEqual(self.adapter.legacy,[])
        self.service.preview_reports(failed.run_id)
        self.assertEqual(self.service.send_selected(failed.run_id,['overall'])['overall'],'blocked')
        self.adapter.rows=[row(i,completed=i<95) for i in range(100)]
        passed=self.run_service(); self.assertEqual(passed.status,'completed')
        self.service.preview_reports(passed.run_id)
        self.assertEqual(self.service.send_selected(passed.run_id,['overall'])['overall'],'sent')
    def test_record_failure_after_send_keeps_uncertain_and_never_retries(self):
        from unittest.mock import patch
        outcome=self.run_service(); self.service.preview_reports(outcome.run_id)
        setter=self.service._set_delivery
        def failing(run_id,key,status,**values):
            if status!='sending': raise OSError('disk failure')
            return setter(run_id,key,status,**values)
        with patch.object(self.service,'_set_delivery',side_effect=failing):
            self.assertEqual(self.service.send_selected(outcome.run_id,['overall'])['overall'],'uncertain')
        self.service.resume(outcome.run_id,self.settings,self.paths,lambda e:None,Event())
        self.service.preview_reports(outcome.run_id)
        self.assertEqual(self.service.send_selected(outcome.run_id,['overall'],resend=True)['overall'],'uncertain')
        self.assertEqual(self.adapter.send_calls,['overall'])
    def test_crashed_query_resumes_only_remaining_people(self):
        self.adapter.rows=[row(i) for i in range(3)]
        def crash(event):
            if event.stage=='query' and event.completed==1: raise KeyboardInterrupt()
        with self.assertRaises(KeyboardInterrupt):
            self.service.run(RunRequest(as_of=date(2026,10,4)),self.settings,self.paths,crash,Event())
        pending=self.service.pending_runs(self.paths)
        self.assertEqual(len(pending),1)
        recovered=self.service.resume(pending[0]['run_id'],self.settings,self.paths,lambda e:None,Event())
        self.assertEqual(recovered.status,'completed')
        self.assertEqual(self.adapter.queries,['가상0','가상1','가상2'])

    def test_sending_checkpoint_is_uncertain_after_restart(self):
        outcome=self.run_service(); self.service.preview_reports(outcome.run_id)
        self.service._set_delivery(outcome.run_id,'overall','sending')
        replacement=SettlementService(self.adapter)
        replacement.resume(outcome.run_id,self.settings,self.paths,lambda e:None,Event())
        replacement.preview_reports(outcome.run_id)
        self.assertEqual(replacement.send_selected(outcome.run_id,['overall'])['overall'],'uncertain'); self.assertEqual(self.adapter.send_calls,[])

class ProductionBoundaryTests(unittest.TestCase):
    def test_desktop_import_and_report_preview_do_not_import_local_config(self):
        import subprocess, sys
        project=Path(__file__).resolve().parents[1]
        script='import sys; sys.path.insert(0,sys.argv[1]); import settlement_automation, settlement_email; assert "config" not in sys.modules; p=settlement_email.build_report_previews([],__import__("datetime").date(2026,10,4),"https://example.invalid"); assert p[0]["enabled"] is False; assert "config" not in sys.modules'
        result=subprocess.run([sys.executable,'-I','-B','-c',script,str(project)],capture_output=True,text=True)
        self.assertEqual(result.returncode,0,result.stderr)

class ApiCall:
    def __init__(self,value): self.value=value
    def execute(self): return self.value


class FakeGoogleSheets:
    def __init__(self): self.calls=[]; self.present=False; self.body=[['old','manual']]; self.owner=None
    def spreadsheets(self): return self
    def values(self): return self
    def get(self,**kwargs):
        self.calls.append(('get',kwargs))
        if 'range' in kwargs: return ApiCall({'values':[list(TAB_HEADERS['새가족 돌봄 기록'])]+self.body})
        return ApiCall({'sheets':[{'properties':{'sheetId':17,'title':'새가족 돌봄 기록'},'developerMetadata':[{'metadataKey':'newacts-owner','metadataValue':self.owner}]}] if self.present else []})
    def batchUpdate(self,**kwargs):
        self.calls.append(('batchUpdate',kwargs))
        if 'addSheet' in kwargs['body']['requests'][0]:
            self.present=True; return ApiCall({'replies':[{'addSheet':{'properties':{'sheetId':17}}}]})
        return ApiCall({})
    def update(self,**kwargs): self.calls.append(('update',kwargs)); return ApiCall({})
    def clear(self,**kwargs): self.calls.append(('clear',kwargs)); return ApiCall({})


class AdapterTests(unittest.TestCase):
    def test_google_sheet_owner_is_durable_metadata_and_care_cells_are_bounded(self):
        from desktop.adapters import GoogleSheetsAdapter
        api=FakeGoogleSheets(); adapter=GoogleSheetsAdapter(api,'fake')
        self.assertIsNone(adapter.read_tab('새가족 돌봄 기록'))
        adapter.create_tab('새가족 돌봄 기록',TAB_HEADERS['새가족 돌봄 기록'],'newacts-settlement-desktop-v1')
        requests=[c[1]['body']['requests'] for c in api.calls if c[0]=='batchUpdate']
        self.assertEqual(len(requests),1)
        self.assertEqual(len(requests[0]),3)
        metadata=requests[0][1]['createDeveloperMetadata']['developerMetadata']
        self.assertEqual(metadata,{'metadataKey':'newacts-owner','metadataValue':'newacts-settlement-desktop-v1','location':{'sheetId':requests[0][0]['addSheet']['properties']['sheetId']},'visibility':'DOCUMENT'})
        api.owner='newacts-settlement-desktop-v1'
        adapter.update_cells('새가족 돌봄 기록',[(1,0,'id'),(1,2,'조')])
        updates=[c[1] for c in api.calls if c[0]=='update']
        self.assertEqual([u['range'] for u in updates[-2:]],["'새가족 돌봄 기록'!A2","'새가족 돌봄 기록'!C2"])
        count=len(api.calls)
        with self.assertRaises(ValueError): adapter.update_cells('새가족 돌봄 기록',[(1,3,'bad')])
        self.assertEqual(len(api.calls),count)
        with self.assertRaises(ValueError): adapter.write_rows('새가족 돌봄 기록',[])
        with self.assertRaises(ValueError): adapter.read_tab('등록 새가족')
    def test_production_query_uses_existing_lookup_explicit_period_and_no_print(self):
        from desktop.adapters import ProductionAdapter
        from settlement_automation import RunOptions
        from unittest.mock import patch
        import io
        from contextlib import redirect_stdout
        with tempfile.TemporaryDirectory() as tmp:
            paths=RuntimePaths.for_user(Path(tmp)); settings=replace(load_settings(paths),roster_start='2026-01-01',roster_end='2026-12-31')
            adapter=ProductionAdapter(); adapter.settings=settings; adapter.page=object(); adapter.right_frame=object()
            inspected={'registration':date(2026,9,1),'possible':5,'attended':3,'rate':.6,'recent':'','status':'조회완료','note':'','dimode_id':'17'}
            output=io.StringIO()
            with patch('settlement_automation.inspect_person',return_value=inspected) as inspect, redirect_stdout(output):
                result=adapter.query_person({'새신자':'가상','날짜':'9.1','군':'신'},RunOptions(date(2026,10,4),None,settings.roster_start,settings.roster_end))
            self.assertEqual(result['조회 상태'],'조회완료'); self.assertEqual(output.getvalue(),'')
            self.assertEqual(inspect.call_args.kwargs,{'roster_start':'2026-01-01','roster_end':'2026-12-31'})

class ExecutedCall:
    def __init__(self,action): self.action=action
    def execute(self): return self.action()


class AtomicGoogleAPI:
    """In-memory Google boundary: each batch applies together or none; response can be lost."""
    def __init__(self): self.tabs={}; self.calls=[]; self.failure=None
    def spreadsheets(self): return self
    def values(self): return self
    def seed(self,name,body=(),owner='newacts-settlement-desktop-v1'):
        self.tabs[name]={'properties':{'sheetId':len(self.tabs)+1,'title':name},
            'developerMetadata':[{'metadataKey':'newacts-owner','metadataValue':owner}],
            'rows':[list(TAB_HEADERS[name])]+list(body)}
    def get(self,**kwargs):
        import copy
        def read():
            if 'range' in kwargs:
                name=kwargs['range'].split('!')[0].strip("'")
                return {'values':copy.deepcopy(self.tabs[name]['rows'])}
            return {'sheets':[{k:copy.deepcopy(v) for k,v in tab.items() if k!='rows'} for tab in self.tabs.values()]}
        return ExecutedCall(read)
    def _target(self,name,kind):
        return bool(self.failure and self.failure[0]==kind and (kind=='create' or name=='정착률 월별 이력'))
    def update(self,**kwargs):
        def write():
            self.calls.append(('values.update',kwargs))
            name,area=kwargs['range'].split('!'); name=name.strip("'")
            kind='create' if area=='A1' else 'monthly'
            if self._target(name,kind): raise OSError('legacy separated update failed')
            import re
            match=re.fullmatch(r'([A-Z]+)([0-9]+)',area)
            start=int(match[2])-1; column=0
            for letter in match[1]: column=column*26+ord(letter)-64
            column-=1
            rows=self.tabs[name]['rows']
            for offset,values in enumerate(kwargs['body']['values']):
                while len(rows)<=start+offset: rows.append([])
                destination=rows[start+offset]
                while len(destination)<column+len(values): destination.append('')
                destination[column:column+len(values)]=values
            return {}
        return ExecutedCall(write)
    def clear(self,**kwargs):
        def clear():
            self.calls.append(('values.clear',kwargs))
            self.tabs[kwargs['range'].split('!')[0].strip("'")]['rows'][1:]=[]
            return {}
        return ExecutedCall(clear)
    def batchUpdate(self,**kwargs):
        import copy
        def apply():
            requests=kwargs['body']['requests']; self.calls.append(('batchUpdate',kwargs))
            candidate=copy.deepcopy(self.tabs); targeted=False
            for req in requests:
                if 'addSheet' in req:
                    props=dict(req['addSheet']['properties']); props.setdefault('sheetId',len(candidate)+1)
                    if props['title'] in candidate: raise ValueError('duplicate title')
                    candidate[props['title']]={'properties':props,'developerMetadata':[],'rows':[]}
                elif 'createDeveloperMetadata' in req:
                    value=req['createDeveloperMetadata']['developerMetadata']
                    tab=next(t for t in candidate.values() if t['properties']['sheetId']==value['location']['sheetId'])
                    tab['developerMetadata'].append(value)
                elif 'updateCells' in req:
                    data=req['updateCells']; area=data.get('range',data.get('start'))
                    tab=next(t for t in candidate.values() if t['properties']['sheetId']==area['sheetId'])
                    start=area.get('startRowIndex',area.get('rowIndex',0)); col=area.get('startColumnIndex',area.get('columnIndex',0))
                    kind='create' if start==0 else 'monthly'
                    targeted=targeted or self._target(tab['properties']['title'],kind)
                    new=[]
                    for r in data.get('rows',[]):
                        new.append([next(iter(cell.get('userEnteredValue',{'empty':''}).values())) for cell in r.get('values',[])])
                    end=area.get('endRowIndex',start+len(new))
                    while len(tab['rows'])<end: tab['rows'].append([])
                    for i in range(start,end):
                        while len(tab['rows'][i])<area.get('endColumnIndex',col+len(new[i-start]) if i-start<len(new) else col): tab['rows'][i].append('')
                        values=new[i-start] if i-start<len(new) else []
                        for c in range(col,area.get('endColumnIndex',col+len(values))):
                            tab['rows'][i][c]=values[c-col] if c-col<len(values) else ''
                    while tab['rows'] and not any(v!='' for v in tab['rows'][-1]): tab['rows'].pop()
                else: raise AssertionError('unsupported request')
            if targeted and self.failure[1]=='before': raise OSError('batch refused before commit')
            self.tabs=candidate
            if targeted and self.failure[1]=='after': raise TimeoutError('batch committed response lost')
            return {'replies':[{'addSheet':{'properties':next(t['properties'] for t in candidate.values() if t['properties']['title']==req['addSheet']['properties']['title'])}} if 'addSheet' in req else {} for req in requests]}
        return ExecutedCall(apply)


class AtomicPublicationTests(unittest.TestCase):
    # Removing batch atomicity loses old months or leaves an owner/header partial tab.
    def test_monthly_refusal_and_lost_response_preserve_previous_month_on_resume(self):
        from desktop.adapters import GoogleSheetsAdapter
        from desktop.sheets import SheetPublisher, HISTORY_TAB
        for mode in ('before','after'):
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as tmp:
                api=AtomicGoogleAPI()
                old=['2026-09','recent4-v1','previous','2026-09-27','신',1,1,.6,.5,'','','']
                for name in TAB_HEADERS: api.seed(name,[old] if name==HISTORY_TAB else [])
                store=HistoryStore(Path(tmp)); publisher=SheetPublisher(GoogleSheetsAdapter(api,'fake'),store)
                data=[row()]; store.save_snapshot('new',date(2026,10,4),data,'recent4-v1','completed')
                summary=store.monthly_summary('2026-10','recent4-v1'); api.failure=('monthly',mode)
                with self.assertRaises(OSError): publisher.publish('new',data,summary)
                self.assertIn(old,api.tabs[HISTORY_TAB]['rows'])
                self.assertFalse(store.stage_done('new','monthly'))
                api.failure=None; restored=HistoryStore(Path(tmp)); original=restored.load_publication('new')
                SheetPublisher(GoogleSheetsAdapter(api,'fake'),restored).publish('new',original['results'],original['summaries'])
                self.assertIn(old,api.tabs[HISTORY_TAB]['rows'])
                self.assertEqual([r[0] for r in api.tabs[HISTORY_TAB]['rows'][1:]],['2026-09','2026-10'])
                self.assertTrue(restored.stage_done('new','monthly'))
                self.assertFalse(any(kind=='values.clear' for kind,_ in api.calls))
    def test_creation_refusal_and_lost_response_resume_without_partial_tabs(self):
        from desktop.adapters import GoogleSheetsAdapter
        from desktop.sheets import SheetPublisher, CURRENT_TAB, OWNER
        for mode in ('before','after'):
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as tmp:
                api=AtomicGoogleAPI(); api.failure=('create',mode); store=HistoryStore(Path(tmp))
                publisher=SheetPublisher(GoogleSheetsAdapter(api,'fake'),store)
                with self.assertRaises(OSError): publisher.publish('new',[row()],[])
                if mode=='before': self.assertNotIn(CURRENT_TAB,api.tabs)
                else:
                    tab=api.tabs[CURRENT_TAB]; self.assertEqual(tab['rows'][:1],[list(TAB_HEADERS[CURRENT_TAB])])
                    self.assertEqual(tab['developerMetadata'][0]['metadataValue'],OWNER)
                api.failure=None; original=store.load_publication('new')
                publisher.publish('new',original['results'],original['summaries'])
                self.assertTrue(all(store.stage_done('new',stage) for stage in ('current','monthly','care')))
                self.assertEqual(set(api.tabs),set(TAB_HEADERS))
    def test_unowned_existing_tab_still_blocks_all_mutations(self):
        from desktop.adapters import GoogleSheetsAdapter
        from desktop.sheets import SheetPublisher, CURRENT_TAB
        with tempfile.TemporaryDirectory() as tmp:
            api=AtomicGoogleAPI(); api.seed(CURRENT_TAB,[],owner=None)
            with self.assertRaises(ValueError): SheetPublisher(GoogleSheetsAdapter(api,'fake'),HistoryStore(Path(tmp))).publish('new',[row()],[])
            self.assertEqual(api.calls,[])
