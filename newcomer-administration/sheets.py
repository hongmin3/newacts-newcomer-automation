"""Google authorization is explicit, read-only by default, and stored with DPAPI."""
import json
import pathlib
import uuid

from source import map_rows,source_digest
from windows_runtime import protect_secret,unprotect_secret

READ_SCOPE='https://www.googleapis.com/auth/spreadsheets.readonly'
WRITE_SCOPE='https://www.googleapis.com/auth/spreadsheets'
META_KEY='newacts_administration_id'


def outside_repo(path):
    path=pathlib.Path(path).resolve()
    if path.is_relative_to(pathlib.Path(__file__).resolve().parents[1]):
        raise ValueError('인증·명단·실행 자료는 저장소 밖에 보관하세요.')
    return path


def authorize(client_path,token_path,write=False):
    from google_auth_oauthlib.flow import InstalledAppFlow
    client_path=outside_repo(client_path); token_path=outside_repo(token_path)
    scope=WRITE_SCOPE if write else READ_SCOPE
    flow=InstalledAppFlow.from_client_secrets_file(str(client_path),[scope])
    credentials=flow.run_local_server(port=0,authorization_prompt_message='Google 인증을 브라우저에서 완료하세요.',
                                    success_message='인증되었습니다. 이 창을 닫고 프로그램으로 돌아가세요.')
    token_path.write_bytes(protect_secret(credentials.to_json().encode()))
    return credentials


def connect(token_path,write=False):
    from google.oauth2.credentials import Credentials
    from google.auth.transport.requests import Request
    from googleapiclient.discovery import build
    token_path=outside_repo(token_path)
    credentials=Credentials.from_authorized_user_info(json.loads(unprotect_secret(token_path.read_bytes())))
    if write and not credentials.has_scopes([WRITE_SCOPE]): raise ValueError('시트 쓰기 권한을 별도로 인증하세요.')
    if credentials.expired and credentials.refresh_token:
        credentials.refresh(Request()); token_path.write_bytes(protect_secret(credentials.to_json().encode()))
    return build('sheets','v4',credentials=credentials,cache_discovery=False)


def read_sheet(service,spreadsheet_id,sheet_name='등록 새가족'):
    sheet_range="'"+sheet_name.replace("'","''")+"'!A:T"
    api=service.spreadsheets()
    values=api.values().get(spreadsheetId=spreadsheet_id,range=sheet_range,valueRenderOption='FORMATTED_VALUE').execute().get('values',[])
    if not values: raise ValueError('원본 시트가 비어 있습니다.')
    metadata=api.get(spreadsheetId=spreadsheet_id,fields='sheets(properties,developerMetadata),developerMetadata').execute()
    matching=[s for s in metadata.get('sheets',[]) if s['properties']['title']==sheet_name]
    if len(matching)!=1: raise ValueError('원본 시트 이름을 확인하세요.')
    sheet=matching[0]; sheet_id=sheet['properties']['sheetId']
    md=list(metadata.get('developerMetadata',[]))+list(sheet.get('developerMetadata',[]))
    identities={}
    for item in md:
        loc=item.get('location',{}).get('dimensionRange',{})
        if item.get('metadataKey')==META_KEY and loc.get('sheetId')==sheet_id and loc.get('dimension')=='ROWS':
            start=loc['startIndex']+1
            if start in identities: raise ValueError('동일한 행의 관리번호가 여러 개입니다.')
            identities[start]=item['metadataValue']
    rows=map_rows(values[0],values[1:])
    for row in rows: row['record_id']=identities.get(row['row_number'],row.get('record_id',''))
    return rows,values[0],sheet_id


def build_source_patch(record,rows,columns):
    found=[r for r in rows if r.get('record_id')==record.get('record_id')]
    if len(found)!=1 or not record.get('record_id'): raise ValueError('원본 관리번호가 없거나 여러 명입니다.')
    current=found[0]
    if source_digest(current)!=record.get('source_version'): raise ValueError('조회 뒤 원본이 바뀌었습니다.')
    patches=[]
    for key,change in record.get('allowed_field_changes',{}).items():
        if key not in ('name','existing_mark') or key not in columns:
            raise ValueError('승인 범위 밖 시트 변경입니다.')
        if current.get(key,'')!=change['before']: raise ValueError('기존 셀 값이 예상과 다릅니다.')
        patches.append({'row':current['row_number'],'column':columns[key],**change})
    return patches


def apply_source_patch(service,spreadsheet_id,sheet_name,record,columns):
    rows,_,_=read_sheet(service,spreadsheet_id,sheet_name)
    patches=build_source_patch(record,rows,columns); api=service.spreadsheets().values()
    before=[dict(r) for r in rows]
    for p in patches:
        address="'"+sheet_name.replace("'","''")+"'!"+p['column']+str(p['row'])
        value=api.get(spreadsheetId=spreadsheet_id,range=address,valueRenderOption='FORMATTED_VALUE').execute().get('values',[['']])[0][0]
        if value!=p['before']: raise ValueError('쓰기 직전 셀 값이 바뀌었습니다.')
        api.update(spreadsheetId=spreadsheet_id,range=address,valueInputOption='RAW',body={'values':[[p['after']]]}).execute()
        actual=api.get(spreadsheetId=spreadsheet_id,range=address,valueRenderOption='FORMATTED_VALUE').execute().get('values',[['']])[0][0]
        if actual!=p['after']: raise ValueError('시트 반영 후 재조회 불일치')
    after,_,_=read_sheet(service,spreadsheet_id,sheet_name)
    expected=[dict(r) for r in before]
    for r in expected:
        if r.get('record_id')==record['record_id']:
            for key,change in record.get('allowed_field_changes',{}).items(): r[key]=change['after']
    if expected!=after: raise ValueError('계획한 셀 외의 변경이 있습니다. 수동 검토하세요.')
    return patches
