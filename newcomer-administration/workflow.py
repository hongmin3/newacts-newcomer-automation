"""Explicit, staged workflow. A preview never constructs any writer."""
import copy
import pathlib
import uuid
import inspect
from functools import wraps

from source import read_applicants,digest
from service import approve,verify_approval,apply_step
from bulletin import build_bulletin_plan,verify_bulletin
from hwp_adapter import write_bulletin_draft,read_bulletin_draft,read_baseline
from files import file_hash,publish_bulletin
from windows_runtime import acquire_writer_lock


def single_writer(fn):
    @wraps(fn)
    def locked(*args,**kwargs):
        store=inspect.signature(fn).bind(*args,**kwargs).arguments['store']
        with acquire_writer_lock(store.path.with_suffix('.writer.lock')):
            return fn(*args,**kwargs)
    return locked


def preview(rows,start,end,publication,reader=None):
    from identity import inspect_identity
    records=read_applicants(rows,start,end,publication)
    for row in records:
        # A source file may not assert that an external operation succeeded.
        row['identity']='NOT_CHECKED'; row.pop('external_id',None)
        if reader:
            decision=inspect_identity(row,reader.search)
            row['identity']=decision['state']; row['external_id']=decision['external_id']; row['decision']=decision
    return {'start':start,'end':end,'bulletin_date':publication,'records':records,
            'policy':{'source':'registration_sheet','existing':'include','clergy':'no_credit',
                      'unresolved':'review','version':'2026-11-08'}}


def prepare_batch(review,template,reviewer,baseline,profile):
    review=copy.deepcopy(review)
    if not profile.get('confirmed'): raise ValueError('양식 확인이 필요합니다.')
    review.update(batch_id=uuid.uuid4().hex,template_hash=file_hash(template),
                  baseline=copy.deepcopy(baseline),profile=copy.deepcopy(profile))
    if review['template_hash']!=baseline['file_hash']: raise ValueError('기준 파일이 바뀌었습니다.')
    actual=read_baseline(template,profile)
    if any(baseline.get(k)!=value for k,value in actual.items()):
        raise ValueError('입력한 기준 수치와 한글 원본이 다릅니다. 기준부터 다시 확인하세요.')
    return approve(review,reviewer)


def _verify(batch,baseline=None,profile=None):
    verify_approval(batch)
    if baseline is not None and batch.get('baseline')!=baseline: raise ValueError('승인한 기준값이 바뀌었습니다.')
    if profile is not None and batch.get('profile')!=profile: raise ValueError('승인한 양식이 바뀌었습니다.')


@single_writer
def make_draft(batch,baseline,template,target,profile,store):
    _verify(batch,baseline,profile)
    if file_hash(template)!=batch['template_hash']: raise ValueError('승인 후 원본 파일이 바뀌었습니다.')
    plan=build_bulletin_plan(batch['records'],baseline,batch['bulletin_date'],store.published())
    request=digest({'plan':plan,'target':str(pathlib.Path(target).resolve())})
    previous=store.step(batch['batch_id'],'__batch__','draft')
    if previous and previous['state']=='VERIFIED':
        if previous['before_digest']!=request: raise ValueError('이미 완료한 초안의 대상이 바뀌었습니다.')
        if file_hash(target)!=previous['external_id']: raise ValueError('완료한 초안이 바뀌었습니다.')
    else:
        def write():
            write_bulletin_draft(template,target,profile,plan)
            return file_hash(target)
        def read():
            actual=read_bulletin_draft(target,profile,plan['bulletin_date'],{e['record_id']:e['number'] for e in plan['entries']})
            verify_bulletin(plan,actual)
            return actual
        apply_step(store,batch['batch_id'],'__batch__','draft',request,write,read)
    return plan|{'draft_hash':file_hash(target),'approval_digest':batch['approval_digest']}


@single_writer
def publish(batch,plan,draft,target,profile,store,page_review):
    _verify(batch,profile=profile)
    if not page_review: raise ValueError('한글에서 페이지를 확인한 뒤 최종 승인하세요.')
    if plan.get('approval_digest')!=batch['approval_digest']: raise ValueError('초안의 승인이 다릅니다.')
    expected_plan=build_bulletin_plan(batch['records'],batch['baseline'],batch['bulletin_date'])
    if any(plan.get(k)!=v for k,v in expected_plan.items()): raise ValueError('초안 계획이 승인한 내용과 다릅니다.')
    if file_hash(draft)!=plan['draft_hash']: raise ValueError('검증 후 초안 파일이 바뀌었습니다.')
    actual=read_bulletin_draft(draft,profile,plan['bulletin_date'],{e['record_id']:e['number'] for e in plan['entries']})
    verify_bulletin(plan,actual)
    target=pathlib.Path(target).resolve()
    request=digest({'target':str(target),'draft_hash':plan['draft_hash'],'approval':batch['approval_digest']})
    previous=store.step(batch['batch_id'],'__batch__','publish')
    if previous:
        if previous['before_digest']!=request: raise ValueError('저장 대상이 바뀌었습니다. 새 승인이 필요합니다.')
        if previous['state'] in ('UNKNOWN','VERIFIED'):
            if not target.exists() or file_hash(target)!=plan['draft_hash']:
                raise ValueError('최종 저장 결과가 불명확합니다. 덮어쓰지 않고 확인하세요.')
            # Reconcile the already-created file, without resending or renumbering.
            for entry in plan['entries']: store.record_publication(entry['record_id'],plan['bulletin_date'],batch['batch_id'])
            store.finish_step((batch['batch_id'],'__batch__','publish'),'VERIFIED',plan['draft_hash'],digest(actual))
            return
    if store.published().intersection(e['record_id'] for e in plan['entries']):
        raise ValueError('이미 다른 실행에서 게시한 사람이 있습니다.')
    def write():
        result=publish_bulletin(draft,target,None)
        for entry in plan['entries']: store.record_publication(entry['record_id'],plan['bulletin_date'],batch['batch_id'])
        return result
    apply_step(store,batch['batch_id'],'__batch__','publish',request,write,
               lambda: file_hash(target)==plan['draft_hash'])
