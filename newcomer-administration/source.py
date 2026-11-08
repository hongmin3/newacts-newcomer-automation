"""Source parsing is pure: no authentication or external writes on import."""
import csv
import datetime as dt
import hashlib
import json
import re

FIELDS = {'관리번호':'record_id', '날짜':'date', '새신자':'name', '이름':'name',
          '핸드폰':'phone', '전화번호':'phone', '생년월일':'birth', '성별':'sex',
          '주소':'address', '군':'army', '팀':'team', '순':'cell', '인도자':'introducer',
          '인도자ID':'introducer_id', '기등록':'existing_mark', '구분':'kind'}


def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True,
                                    separators=(',', ':')).encode('utf-8')).hexdigest()


def iso_date(value):
    value = str(value).strip()
    if not re.fullmatch(r'\d{4}[-./]\d{1,2}[-./]\d{1,2}', value):
        raise ValueError('연도를 포함한 날짜가 필요합니다: YYYY-MM-DD')
    year, month, day = map(int, re.split(r'[-./]', value))
    return dt.date(year, month, day)


def parse_birth(value, year):
    value = str(value or '').strip()
    result = {'birth':'', 'age':None, 'issues':[]}
    if not value:
        return result
    if re.fullmatch(r'\d{4}년생', value):
        born = int(value[:4])
        if not 1900 <= born <= year: result['issues'].append('출생연도 확인 필요')
        else: result['age'] = year - born + 1
    elif re.fullmatch(r'\d{1,3}세', value):
        result['age'] = int(value[:-1])
    elif re.fullmatch(r'\d{4}', value):
        return parse_birth(value+'년생', year)
    else:
        try: result['birth'] = iso_date(value).isoformat()
        except ValueError: result['issues'].append('생년월일 또는 출생연도 확인 필요')
    return result


def source_digest(row):
    return digest({k:v for k,v in row.items() if k not in {'row_number','source_version','issues','identity','external_id','decision'}})


def map_rows(headers, rows):
    headers = [str(h).strip() for h in headers]
    if len(headers) != len(set(headers)):
        raise ValueError('중복 머리글이 있습니다.')
    mapped = [FIELDS.get(h,h) for h in headers]
    if len(mapped) != len(set(mapped)):
        raise ValueError('같은 필드를 가리키는 머리글이 여러 개입니다.')
    if not {'date','name','phone'}.issubset(mapped):
        raise ValueError('날짜·새신자(이름)·핸드폰 머리글이 필요합니다.')
    return [dict(zip(mapped, list(row)+['']*max(0,len(mapped)-len(row)))) | {'row_number':i}
            for i,row in enumerate(rows,2) if any(str(v).strip() for v in row)]


def read_csv(path):
    with open(path, encoding='utf-8-sig', newline='') as stream:
        reader=csv.reader(stream); headers=next(reader, [])
        return map_rows(headers,list(reader))


def read_applicants(rows, start, end, bulletin_date):
    first,last,publication = map(iso_date,(start,end,bulletin_date))
    if first > last or publication <= last:
        raise ValueError('등록 기간과 이후 주보 발행일을 확인하세요.')
    result=[]
    for raw in rows:
        if not str(raw.get('name','')).strip(): continue
        row=dict(raw)
        if str(row.get('kind','registration')).strip() in ('visitor','방문','방문자'): continue
        date=iso_date(row.get('date',''))
        if not first <= date <= last: continue
        row['date']=date.isoformat(); row['kind']='registration'
        row['name']=str(row['name']).strip()
        row['phone']=re.sub(r'\D','',str(row.get('phone','')))
        row['record_id']=str(row.get('record_id','')).strip()
        row['issues']=list(raw.get('issues',[]))
        if not row['record_id']: row['issues'].append('원본의 고정 관리번호 없음: 외부 반영 보류')
        if not re.fullmatch(r'0\d{8,10}',row['phone']): row['issues'].append('전화번호 확인 필요')
        birth=parse_birth(row.get('birth',''),date.year)
        row['birth']=birth['birth']; row['age']=birth['age']; row['issues']+=birth['issues']
        row['source_version']=source_digest(raw)
        result.append(row)
    counts={}
    for row in result:
        if row['record_id']: counts[row['record_id']]=counts.get(row['record_id'],0)+1
    for row in result:
        if counts.get(row['record_id'],0)>1: row['issues'].append('원본 관리번호 중복')
    return sorted(result,key=lambda r:r['date'])
