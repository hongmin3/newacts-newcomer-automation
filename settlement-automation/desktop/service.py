"""Desktop execution boundary. Importing this module never authenticates or runs work."""
import json
import uuid
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from pathlib import Path
from threading import Event
from typing import Callable
from zoneinfo import ZoneInfo

from .history import HistoryStore
from .metrics import FORMULA_VERSION, army_metrics
from .runtime import RuntimePaths, SecretStore, write_private_file
from .settings import AppSettings
from .sheets import SheetPublisher


@dataclass(frozen=True)
class RunRequest:
    as_of: date | None = None
    limit: int | None = None
    test_mode: bool = False
    resume_id: str | None = None


@dataclass(frozen=True)
class ProgressEvent:
    stage: str
    completed: int = 0
    total: int = 0
    message_code: str = ''


@dataclass(frozen=True)
class RunOutcome:
    run_id: str
    status: str
    as_of: date
    results: list[dict] = field(default_factory=list)
    summaries: list[dict] = field(default_factory=list)
    stage: str = ''
    sheet_published: bool = False
    error: str | None = None


@dataclass(frozen=True)
class ReportPreview:
    key: str
    title: str
    recipients: tuple[str, ...]
    subject: str
    text: str
    html: str
    enabled: bool
    reason: str | None
    status: str = 'pending'
    last_sent_at: str | None = None


class ProcessLock:
    """OS releases flock even after a crash; file existence is never the lock."""
    def __init__(self, path: Path): self.path = Path(path); self.file = None
    def __enter__(self):
        import fcntl
        self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.file = self.path.open('a+')
        self.path.chmod(0o600)
        try: fcntl.flock(self.file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BaseException:
            self.file.close(); self.file = None
            raise
        return self
    def __exit__(self, *args):
        self.file.close(); self.file = None


class DeliveryFailed(Exception):
    """An adapter may use this only when the provider definitively refused delivery."""


class SettlementService:
    def __init__(self, adapter=None, secret_store=None):
        self.adapter = adapter
        self.secret_store = secret_store
        self.paths = None
        self.settings = None
        self.history = None
        self._previewed = set()

    def _configure(self, settings, paths):
        settings.validate()
        paths.ensure_directories()
        self.settings, self.paths = settings, paths
        self.history = HistoryStore(paths.data_root)
        if self.adapter is None:
            from .adapters import ProductionAdapter
            self.adapter = ProductionAdapter()

    def _path(self, run_id):
        HistoryStore._run_id(run_id)
        return self.paths.runs_dir / run_id / 'execution.json'

    def _load(self, run_id): return json.loads(self._path(run_id).read_text(encoding='utf-8'))
    def _save(self, state):
        path = self._path(state['run_id']); path.parent.mkdir(mode=0o700, exist_ok=True)
        write_private_file(path, json.dumps(state, ensure_ascii=False, default=str, indent=2))

    def _outcome(self, state, error=None):
        return RunOutcome(state['run_id'], state['status'], date.fromisoformat(state['as_of']),
                          state.get('results', []), state.get('summaries', []), state.get('stage',''),
                          state.get('sheet_published',False), error)

    def pending_runs(self, paths: RuntimePaths) -> list[dict]:
        """Read local interrupted runs without creating adapters or authenticating."""
        runs = []
        for path in sorted(paths.runs_dir.glob('*/execution.json')):
            state = json.loads(path.read_text(encoding='utf-8'))
            if state['status'] in ('running','publication_failed','authentication_required'):
                runs.append({'run_id':state['run_id'],'as_of':state['as_of'],'stage':state['stage'],'status':state['status']})
        return runs

    def run(self, request: RunRequest, settings: AppSettings, paths: RuntimePaths,
            on_progress: Callable[[ProgressEvent], None], cancel: Event) -> RunOutcome:
        if request.resume_id:
            return self.resume(request.resume_id,settings,paths,on_progress,cancel)
        as_of = request.as_of or datetime.now(ZoneInfo('Asia/Seoul')).date()
        run_id = uuid.uuid4().hex
        if not isinstance(as_of,date) or isinstance(as_of,datetime) or (request.limit is not None and (type(request.limit) is not int or request.limit<1)):
            raise ValueError('기준일과 최대 인원을 확인해 주세요.')
        if request.limit is not None and not request.test_mode:
            return RunOutcome(run_id,'setup_required',as_of,error='최대 인원은 시험 실행에서만 사용합니다.')
        self._configure(settings,paths)
        state = {'run_id':run_id,'as_of':as_of.isoformat(),'test_mode':request.test_mode,'limit':request.limit,
                 'status':'running','stage':'authentication','results':[],'summaries':[], 'sheet_published':False,'deliveries':{}}
        try:
            with ProcessLock(paths.data_root/'execution.lock'):
                self._save(state)
                return self._execute(state,on_progress,cancel)
        except BlockingIOError:
            return RunOutcome(run_id,'busy',as_of,stage='lock',error='다른 작업이 실행 중입니다.')

    def resume(self, run_id, settings, paths, on_progress, cancel):
        self._configure(settings,paths)
        try:
            with ProcessLock(paths.data_root/'execution.lock'):
                state = self._load(run_id)
                # Never retry ambiguous mail as a side effect of recovery.
                for delivery in state['deliveries'].values():
                    if delivery['status']=='sending': delivery['status']='uncertain'
                self._save(state)
                if state['status'] in ('cancelled','quality_failed','test','completed'):
                    return self._outcome(state)
                return self._execute(state,on_progress,cancel)
        except BlockingIOError:
            return RunOutcome(run_id,'busy',datetime.now(ZoneInfo('Asia/Seoul')).date(),stage='lock',error='다른 작업이 실행 중입니다.')

    def _execute(self,state,progress,cancel):
        stage = 'authentication'
        try:
            if not self.settings.roster_start or not self.settings.roster_end:
                state.update(status='setup_required',stage='setup'); self._save(state)
                return self._outcome(state,'명단 기간을 설정해 주세요.')
            progress(ProgressEvent(stage,message_code='authentication_check'))
            self.adapter.authenticate(self.settings,self.paths,self.secret_store)
            if 'source_rows' not in state:
                stage = 'roster'; progress(ProgressEvent(stage,message_code='reading_roster'))
                source_rows = self.adapter.load_rows()
                state['source_rows'] = source_rows[:state['limit']] if state['limit'] else source_rows
                self._save(state)
            from settlement_automation import RunOptions
            options = RunOptions(date.fromisoformat(state['as_of']),None,self.settings.roster_start,self.settings.roster_end)
            stage = 'query'; state['stage']=stage; state['status']='running'; self._save(state)
            rows=state['source_rows']; results=state['results']
            while len(results)<len(rows):
                if cancel.is_set(): break
                item=self.adapter.query_person(rows[len(results)],options)
                item['No.']=len(results)+1
                results.append(item); self._save(state)
                progress(ProgressEvent(stage,len(results),len(rows),'query_progress'))
            if cancel.is_set():
                state.update(status='cancelled',stage=stage); self._save(state)
                self.history.save_snapshot(state['run_id'],options.as_of,results,FORMULA_VERSION,'cancelled')
                return self._outcome(state)
            stage='quality'; metrics=army_metrics(results)
            completed=sum(item['completed_count'] for item in metrics)
            if not results or completed/len(results)<.95:
                state.update(status='quality_failed',stage=stage); self._save(state)
                self.history.save_snapshot(state['run_id'],options.as_of,results,FORMULA_VERSION,'failed')
                return self._outcome(state,'조회 완료율 기준을 충족하지 못했습니다.')
            snapshot_status='test' if state['test_mode'] else 'completed'
            self.history.save_snapshot(state['run_id'],options.as_of,results,FORMULA_VERSION,snapshot_status)
            if state['test_mode']:
                state.update(status='test',stage='completed',summaries=metrics); self._save(state)
                return self._outcome(state)
            stage='publication'
            # Bind once. Later months/runs must not change recovery input.
            try: publication=self.history.load_publication(state['run_id'])
            except KeyError:
                summaries=self.history.monthly_summary(options.as_of.strftime('%Y-%m'),FORMULA_VERSION)
                self.history.bind_publication(state['run_id'],results,summaries)
                publication=self.history.load_publication(state['run_id'])
            state['summaries']=publication['summaries']; state['stage']=stage; self._save(state)
            progress(ProgressEvent(stage,message_code='publishing_sheets'))
            if not self.history.stage_done(state['run_id'],'legacy'):
                self.adapter.write_legacy(publication['results'],options.as_of)
                self.history.mark_stage(state['run_id'],'legacy')
            SheetPublisher(self.adapter.sheets,self.history).publish(state['run_id'],publication['results'],publication['summaries'])
            state.update(status='completed',stage='completed',sheet_published=True); self._save(state)
            progress(ProgressEvent('completed',len(results),len(rows),'run_completed'))
            return self._outcome(state)
        except Exception:
            # External exceptions may contain credentials or personal information.
            state.update(status='authentication_required' if stage=='authentication' else
                         'publication_failed' if stage=='publication' else 'running',stage=stage)
            self._save(state)
            return self._outcome(state,'인증을 확인해 주세요.' if stage=='authentication' else '작업이 중단되었습니다. 같은 실행 번호로 다시 시도해 주세요.')
        finally:
            self.adapter.close()

    def preview_reports(self,run_id) -> list[ReportPreview]:
        # Only a free OS lock proves a persisted sending process has stopped.
        with ProcessLock(self.paths.data_root/'execution.lock'):
            state=self._load(run_id)
            changed=False
            for delivery in state['deliveries'].values():
                if delivery['status']=='sending': delivery['status']='uncertain'; changed=True
            if changed: self._save(state)
            previews=self._reports(state)
            self._previewed.update((run_id,r.key) for r in previews)
            return previews

    def _reports(self,state):
        from settlement_email import build_report_previews
        reports=build_report_previews(state['results'],date.fromisoformat(state['as_of']),
                    self.settings.sheet_url,test_mode=state['test_mode'])
        previews=[]
        for report in reports:
            delivery=state['deliveries'].get(report['key'],{})
            enabled=report['enabled'] and state['status'] in ('completed','test')
            reason=report['reason'] if report['reason'] else (None if enabled else '실행 완료가 필요합니다.')
            previews.append(ReportPreview(**{**report,'enabled':enabled,'reason':reason},
                              status=delivery.get('status','pending'),last_sent_at=delivery.get('last_sent_at')))
        return previews

    def _set_delivery(self,run_id,key,status,**values):
        state=self._load(run_id)
        prior=state['deliveries'].get(key,{})
        state['deliveries'][key]={**prior,'status':status,**values}
        self._save(state)

    def send_selected(self,run_id: str,report_keys: list[str],resend: bool=False) -> dict[str,str]:
        if self.paths is None: raise RuntimeError('실행 또는 복구로 서비스를 먼저 연결해 주세요.')
        if not report_keys: return {}
        previewed=set(self._previewed)
        statuses={}
        try:
            with ProcessLock(self.paths.data_root/'execution.lock'):
                state=self._load(run_id)
                reports={p.key:p for p in self._reports(state)}
                for key in dict.fromkeys(report_keys):
                    if key not in reports: statuses[key]='blocked'; continue
                    report=reports[key]
                    previous=state['deliveries'].get(key,{}).get('status','pending')
                    if previous in ('sending','uncertain'): statuses[key]='uncertain'; continue
                    if previous=='sent' and not resend: statuses[key]='sent'; continue
                    if (run_id,key) not in previewed: statuses[key]='preview_required'; continue
                    if not report.enabled: statuses[key]='blocked'; continue
                    try:
                        self.adapter.authenticate(self.settings,self.paths,self.secret_store)
                    except Exception:
                        statuses[key]='authentication_required'; continue
                    try:
                        self._set_delivery(run_id,key,'sending')
                        provider_id=self.adapter.send(report)
                        self._set_delivery(run_id,key,'sent',last_sent_at=datetime.now(timezone.utc).isoformat(),provider_id=provider_id)
                        statuses[key]='sent'
                    except DeliveryFailed:
                        self._set_delivery(run_id,key,'failed'); statuses[key]='failed'
                    except Exception:
                        # If this record write also fails, 'sending' remains a durable guard.
                        try: self._set_delivery(run_id,key,'uncertain')
                        except Exception: pass
                        statuses[key]='uncertain'
                return statuses
        except BlockingIOError:
            return {key:'busy' for key in report_keys}
        finally: self.adapter.close()


_default_service = SettlementService()
def run(request,settings,paths,on_progress,cancel): return _default_service.run(request,settings,paths,on_progress,cancel)
def resume(run_id,settings,paths,on_progress,cancel): return _default_service.resume(run_id,settings,paths,on_progress,cancel)
def preview_reports(run_id): return _default_service.preview_reports(run_id)
def send_selected(run_id,report_keys,resend=False): return _default_service.send_selected(run_id,report_keys,resend)
