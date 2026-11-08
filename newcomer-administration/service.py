import datetime as dt
from source import digest


def approval_payload(batch):
    return {k:v for k,v in batch.items() if k not in ('approval_digest','approved_at','approved_by')}


def approve(batch, reviewer):
    if not str(reviewer).strip() or not batch.get('records'): raise ValueError('담당자와 대상이 필요합니다.')
    for row in batch['records']:
        if not row.get('record_id') or row.get('issues') or row.get('identity') not in ('EXISTING','NEW_CONFIRMED','CREATED'):
            raise ValueError('검토가 끝나지 않은 대상은 승인할 수 없습니다.')
    result=dict(batch)
    result['approved_at']=dt.datetime.now(dt.timezone.utc).isoformat()
    result['approved_by']=reviewer.strip()
    result['approval_digest']=digest(approval_payload(result))
    return result


def verify_approval(batch):
    if not batch.get('approved_by') or batch.get('approval_digest')!=digest(approval_payload(batch)):
        raise ValueError('승인 뒤 자료가 바뀌었습니다. 다시 확인하세요.')
    return True


def apply_step(store,batch,record,step,before_digest,write,read_back):
    previous=store.step(batch,record,step)
    if previous and previous['state']=='VERIFIED':
        if previous['before_digest']!=before_digest: raise ValueError('완료된 단계의 입력이 바뀌었습니다.')
        return previous
    key=store.begin_step(batch,record,step,before_digest)
    try:
        external_id=write()
        actual=read_back()
        if not actual: raise ValueError('외부 반영 후 재조회 결과가 다릅니다.')
        store.finish_step(key,'VERIFIED',str(external_id or ''),digest(actual))
    except BaseException:
        store.finish_step(key,'UNKNOWN')
        raise
    return store.step(batch,record,step)
