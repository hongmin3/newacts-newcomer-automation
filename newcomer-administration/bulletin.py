"""Build from an immutable baseline, never from last run's draft."""
import copy
from source import iso_date


def build_bulletin_plan(records, baseline, bulletin_date, published=()):
    iso_date(bulletin_date)
    if baseline['total']!=baseline['last_number']:
        raise ValueError('기준 총계와 마지막 번호가 다릅니다.')
    if baseline.get('issues'): raise ValueError('기준 주보 확인 항목이 남아 있습니다.')
    counts=copy.deepcopy(baseline['introducers']); entries=[]; seen=set()
    for row in records:
        if row.get('kind')=='visitor': continue
        ident=row.get('record_id')
        if not ident or ident in seen or ident in published:
            raise ValueError('관리번호 없음·중복 또는 이미 게시한 사람입니다.')
        seen.add(ident)
        if row.get('issues') or row.get('identity') not in ('EXISTING','CREATED','NEW_CONFIRMED'):
            raise ValueError('등록 대상의 검토가 끝나지 않았습니다.')
        if row.get('identity')=='NEW_CONFIRMED' and not row.get('external_id'):
            raise ValueError('신규 교적 저장과 재조회가 필요합니다.')
        entries.append({'record_id':ident,'number':baseline['last_number']+len(entries)+1,
                        'name':row['name'],'parish':'청년','introducer':row.get('introducer','')})
        if row.get('clergy') is True or row.get('credit_policy')=='none_confirmed': continue
        introducer=row.get('introducer_id')
        if not introducer: raise ValueError('인도자 식별 또는 제외 결정을 확인하세요.')
        if introducer not in counts: counts[introducer]={'name':row['introducer'],'count':0}
        if counts[introducer]['name']!=row['introducer']:
            raise ValueError('인도자 관리번호와 표시 이름이 다릅니다.')
        counts[introducer]['count']+=1; counts[introducer]['highlight']=True
    return {'bulletin_date':bulletin_date,'baseline_hash':baseline['file_hash'],
            'profile_version':baseline['profile_version'],'entries':entries,'introducers':counts,
            'last_number':baseline['last_number']+len(entries),'total':baseline['total']+len(entries),
            'youth_total':baseline['youth_total']+len(entries)}


def verify_bulletin(expected, actual):
    for key in ('bulletin_date','entries','introducers','last_number','total','youth_total'):
        if expected[key]!=actual.get(key): raise ValueError('저장본 대조 실패: '+key)
    if actual['last_number']!=actual['total']: raise ValueError('저장본 총계와 마지막 번호 불일치')
    return True
