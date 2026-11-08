"""Edit only confirmed HWPX table locations; preserve unrelated archive members.

HWP originals are converted through an owned Hancom instance by inspect_hwp.
No positional template guesses are permitted here.
"""
import copy
import io
import pathlib
import re
import zipfile
import xml.etree.ElementTree as ET

from source import digest, iso_date

P='http://www.hancom.co.kr/hwpml/2011/paragraph'
H='http://www.hancom.co.kr/hwpml/2011/head'


def parse_xml(data):
    for _,(prefix,uri) in ET.iterparse(io.BytesIO(data),events=['start-ns']):
        if not prefix.startswith('ns'): ET.register_namespace(prefix,uri)
    return ET.fromstring(data)


def tables(tree): return list(tree.iter('{'+P+'}tbl'))
def rows(table): return table.findall('{'+P+'}tr')
def cells(row): return row.findall('{'+P+'}tc')
def text(cell): return ''.join(t.text or '' for t in cell.iter('{'+P+'}t'))


def cell_at(all_tables, spec, key):
    r,c=spec[key]
    return cells(rows(all_tables[spec['table']])[r])[c]


def structure(tree):
    return digest([{'columns':t.get('colCnt'),'rows':[len(cells(r)) for r in rows(t)]}
                   for t in tables(tree)])


def inspect_hwpx(path,section='Contents/section0.xml'):
    with zipfile.ZipFile(path) as z: tree=parse_xml(z.read(section))
    return {'section':section,'structure':structure(tree),
            'tables':[{'index':i,'rows':[[text(c) for c in cells(r)] for r in rows(t)]}
                      for i,t in enumerate(tables(tree))]}


def put_text(cell,value,red_id=None):
    paragraphs=list(cell.iter('{'+P+'}p'))
    if not paragraphs: raise ValueError('편집 가능한 한글 문단이 없습니다.')
    first=paragraphs[0]
    runs=first.findall('{'+P+'}run')
    if not runs: raise ValueError('편집 가능한 한글 글자 영역이 없습니다.')
    run=runs[0]
    # Complex controls/embedded content must never be cleared by plain-text editing.
    if any(c.tag not in ('{'+P+'}t','{'+P+'}lineBreak') for r in runs for c in r):
        raise ValueError('셀에 복합 개체가 있습니다. 양식 검토가 필요합니다.')
    for paragraph in paragraphs:
        if paragraph is not first:
            raise ValueError('여러 문단 셀의 편집 규칙을 확인하세요.')
    for r in runs:
        for child in list(r): r.remove(child)
    ET.SubElement(run,'{'+P+'}t').text=str(value)
    if red_id is not None: run.set('charPrIDRef',str(red_id))
    for child in first.findall('{'+P+'}linesegarray'): first.remove(child)


def red_style(header):
    props=header.find('.//{'+H+'}charProperties')
    if props is None or not len(props): raise ValueError('한글 글자 스타일을 찾지 못했습니다.')
    for child in props:
        if child.get('textColor','').upper()=='#FF0000': return child.get('id')
    new=copy.deepcopy(props[0]); ident=str(max(int(c.get('id','0')) for c in props)+1)
    new.set('id',ident); new.set('textColor','#FF0000'); props.append(new)
    props.set('itemCnt',str(len(props)))
    return ident


def _load(path,profile,check_structure=True):
    if not profile.get('confirmed'): raise ValueError('담당자가 확인한 양식 위치 정보가 필요합니다.')
    with zipfile.ZipFile(path) as z:
        contents={i.filename:z.read(i.filename) for i in z.infolist()}
    tree=parse_xml(contents[profile['section']])
    if check_structure and structure(tree)!=profile['structure']: raise ValueError('한글 양식 구조가 달라졌습니다.')
    return contents,tree


def write_bulletin_draft(source,target,profile,plan):
    source,target=pathlib.Path(source).resolve(),pathlib.Path(target).resolve()
    if source==target or target.exists() or target.suffix.lower()!='.hwpx':
        raise ValueError('존재하지 않는 별도 HWPX 작업 사본이 필요합니다.')
    if profile['version']!=plan['profile_version']: raise ValueError('승인한 양식 버전이 아닙니다.')
    contents,tree=_load(source,profile); all_tables=tables(tree)
    header=parse_xml(contents['Contents/header.xml']); red=red_style(header)
    welcome=profile['welcome']; table=all_tables[welcome['table']]
    existing=rows(table)
    if not existing: raise ValueError('주보 표 행이 없습니다.')
    blank_rows=[row for row in existing[welcome['header_rows']:] if all(not text(c).strip() for c in cells(row))]
    template=copy.deepcopy(existing[-1])
    if len(cells(template))!=len(welcome['columns']): raise ValueError('주보 표 열을 확인하세요.')
    # Append only. Existing parish registrations in the selected document are preserved.
    for entry in plan['entries']:
        row=blank_rows.pop(0) if blank_rows else copy.deepcopy(template)
        row_index=rows(table).index(row) if row in rows(table) else len(rows(table))
        for key,col in welcome['columns'].items(): put_text(cells(row)[col],entry[key])
        for cell in cells(row):
            for address in cell.iter('{'+P+'}cellAddr'): address.set('rowAddr',str(row_index))
        if row not in rows(table): table.append(row)
    table.set('rowCnt',str(len(rows(table))))
    total_spec=profile['totals']
    for key in ('total','youth_total'): put_text(cell_at(all_tables,total_spec,key),plan[key])
    if profile.get('publication_mode')=='filename':
        if re.findall(r'\d{4}-\d{2}-\d{2}',target.stem)!=[plan['bulletin_date']]:
            raise ValueError('이 양식은 초안 파일명에 발행일 YYYY-MM-DD가 한 번 있어야 합니다.')
    else: put_text(cell_at(all_tables,total_spec,'publication'),plan['bulletin_date'])
    bucket_spec=profile['buckets']; names=profile['introducer_names']
    if len(set(names.values()))!=len(names): raise ValueError('동명이인 인도자의 표 위치를 구분해야 합니다.')
    positions={}; original_styles={}
    for count,position in bucket_spec['rows'].items():
        cell=cell_at(all_tables,bucket_spec,count) if count in bucket_spec else cells(rows(all_tables[bucket_spec['table']])[position[0]])[position[1]]
        current=text(cell)
        items=[x.strip() for x in current.split(bucket_spec['separator']) if x.strip()]
        for name in items:
            if name in positions: raise ValueError('전도자 표에 같은 이름이 여러 번 있습니다.')
            positions[name]=int(count)
            if name not in names.values(): raise ValueError('표의 인도자 식별 정보가 없습니다.')
        for run in cell.iter('{'+P+'}run'):
            for name in [v.strip() for v in text(run).split(bucket_spec['separator']) if v.strip()]:
                original_styles[name]=run.get('charPrIDRef','0')
    # Do not move or recolor any unapproved name. Each affected destination must be plain text.
    desired={k:[] for k in bucket_spec['rows']}
    for ident,info in plan['introducers'].items():
        if names.get(ident)!=info['name']: raise ValueError('인도자 이름과 관리번호를 확인하세요.')
        key=str(info['count'])
        if key not in desired: raise ValueError('해당 누적 인원 칸이 없습니다. 표 확장 검토가 필요합니다.')
        desired[key].append((info['name'],info.get('highlight',False)))
    for count,position in bucket_spec['rows'].items():
        cell=cells(rows(all_tables[bucket_spec['table']])[position[0]])[position[1]]
        desired_names=[n for n,_ in desired[count]]
        current_names=[v.strip() for v in text(cell).split(bucket_spec['separator']) if v.strip()]
        if desired_names==current_names and not any(red_flag for _,red_flag in desired[count]): continue
        put_text(cell,'')
        run=next(cell.iter('{'+P+'}run')); parent=next(cell.iter('{'+P+'}p'))
        for i,(name,highlight) in enumerate(desired[count]):
            new=copy.deepcopy(run)
            new.set('charPrIDRef',red if highlight else original_styles.get(name,'0'))
            for child in list(new): new.remove(child)
            ET.SubElement(new,'{'+P+'}t').text=(bucket_spec['separator'] if i else '')+name
            parent.append(new)
        parent.remove(run)
    contents[profile['section']]=ET.tostring(tree,encoding='utf-8',xml_declaration=True)
    contents['Contents/header.xml']=ET.tostring(header,encoding='utf-8',xml_declaration=True)
    # Exclusive creation; a concurrently-created draft is never replaced.
    with zipfile.ZipFile(source) as original, open(target,'xb') as stream, zipfile.ZipFile(stream,'w') as z:
        for info in original.infolist(): z.writestr(copy.copy(info),contents[info.filename])
    return target


def read_bulletin_draft(path,profile,publication,record_numbers):
    contents,tree=_load(path,profile,False); all_tables=tables(tree)
    w=profile['welcome']; entries=[]
    reverse={int(v):k for k,v in record_numbers.items()}
    for row in rows(all_tables[w['table']])[w['header_rows']:]:
        values={key:text(cells(row)[col]) for key,col in w['columns'].items()}
        try: number=int(values['number'])
        except ValueError: continue
        if number in reverse:
            entries.append(values|{'number':number,'record_id':reverse[number]})
    header=parse_xml(contents['Contents/header.xml'])
    red_ids={c.get('id') for c in header.iter('{'+H+'}charPr') if c.get('textColor','').upper()=='#FF0000'}
    found={}; b=profile['buckets']; names=profile['introducer_names']; inverse={v:k for k,v in names.items()}
    for count,(r,c) in b['rows'].items():
        cell=cells(rows(all_tables[b['table']])[r])[c]
        for run in cell.iter('{'+P+'}run'):
            for name in [v.strip() for v in text(run).split(b['separator']) if v.strip()]:
                if name not in inverse or inverse[name] in found: raise ValueError('전도자 저장본 식별 불가·중복')
                info={'name':name,'count':int(count)}
                if run.get('charPrIDRef') in red_ids: info['highlight']=True
                found[inverse[name]]=info
    totals=profile['totals']
    if profile.get('publication_mode')=='filename':
        dates=re.findall(r'\d{4}-\d{2}-\d{2}',pathlib.Path(path).stem)
        date=iso_date(dates[0]).isoformat() if len(dates)==1 else None
    else: date=iso_date(text(cell_at(all_tables,totals,'publication'))).isoformat()
    if publication is not None and date!=publication: raise ValueError('저장본의 발행일이 다릅니다.')
    total=int(text(cell_at(all_tables,totals,'total')))
    youth=int(text(cell_at(all_tables,totals,'youth_total')))
    all_numbers=[]
    for row in rows(all_tables[w['table']])[w['header_rows']:]:
        try: all_numbers.append(int(text(cells(row)[w['columns']['number']])))
        except ValueError: pass
    return {'bulletin_date':date,'entries':entries,'introducers':found,'last_number':max(all_numbers,default=0),
            'total':total,'youth_total':youth}


def read_baseline(path,profile):
    from files import file_hash
    actual=read_bulletin_draft(path,profile,None,{})
    return {k:actual[k] for k in ('last_number','total','youth_total','introducers')}|{
        'file_hash':file_hash(path),'profile_version':profile['version']}
