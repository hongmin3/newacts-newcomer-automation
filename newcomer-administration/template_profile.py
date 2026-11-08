"""Discover the observed two-table layout without approving it automatically."""
import re
import uuid
from hwp_adapter import inspect_hwpx


def detect_profile(path):
    inspected=inspect_hwpx(path); tables=inspected['tables']
    welcomes=[t for t in tables if t['rows'] and [c.strip() for c in t['rows'][0]]==['번호','이름','교구','인도자']]
    totals=[t for t in tables if t['rows'] and {'청년부','계'}.issubset(c.strip() for c in t['rows'][0])]
    if len(welcomes)!=1 or len(totals)!=1: raise ValueError('확인된 주보 표 양식과 다릅니다.')
    welcome,total=welcomes[0],totals[0]; headers=[c.strip() for c in total['rows'][0]]
    buckets={}; names={}; seen=set()
    for index,row in enumerate(total['rows'][2:],2):
        if len(row)!=2 or not row[0].strip().isdigit(): continue
        count=row[0].strip()
        if count in buckets: raise ValueError('같은 누적 인원 칸이 여러 개입니다.')
        buckets[count]=[index,1]
        for name in [v.strip() for v in re.split(r'\s*,\s*',row[1]) if v.strip()]:
            if name in seen: raise ValueError('전도자 표에 이름이 중복됩니다. 동일인 여부를 확인하세요.')
            seen.add(name); names[uuid.uuid4().hex]=name
    if not buckets: raise ValueError('전도자 누적 인원 칸을 찾지 못했습니다.')
    return {'version':'hancom-two-tables-v1','confirmed':False,'section':inspected['section'],
            'structure':inspected['structure'],'publication_mode':'filename',
            'welcome':{'table':welcome['index'],'header_rows':1,
                       'columns':{'number':0,'name':1,'parish':2,'introducer':3}},
            'totals':{'table':total['index'],'total':[1,headers.index('계')],
                      'youth_total':[1,headers.index('청년부')]},
            'buckets':{'table':total['index'],'rows':buckets,'separator':', '},
            'introducer_names':names}
