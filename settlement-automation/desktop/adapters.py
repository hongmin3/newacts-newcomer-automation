"""Live adapters are created only by explicit desktop execution, never on import."""
import time
import secrets
from datetime import date
from .legacy_config import use_settings
from .runtime import SecretStore
from .sheets import OWNER, TAB_HEADERS, CARE_TAB
from .errors import ValidationIssue


def _a1(name): return "'" + name.replace("'", "''") + "'"
def _column(index):
    result=''; index+=1
    while index:
        index, remainder=divmod(index-1,26); result=chr(65+remainder)+result
    return result


class GoogleSheetsAdapter:
    OWNER_KEY='newacts-owner'
    def __init__(self,api,spreadsheet_id): self.api=api; self.spreadsheet_id=spreadsheet_id
    def _allowed(self,name):
        if name not in TAB_HEADERS: raise ValueError('앱 관리 대상 탭이 아닙니다.')
    def _sheet(self,name):
        self._allowed(name)
        metadata=self.api.spreadsheets().get(spreadsheetId=self.spreadsheet_id,
                    fields='sheets(properties(sheetId,title),developerMetadata)').execute()
        return next((sheet for sheet in metadata.get('sheets',[]) if sheet['properties']['title']==name),None)
    def read_tab(self,name):
        if self._sheet(name) is None: return None
        # Read full existing width, so extra headers cause validation to fail.
        return self.api.spreadsheets().values().get(spreadsheetId=self.spreadsheet_id,
                    range=_a1(name)).execute().get('values',[])
    def ownership(self,name):
        sheet=self._sheet(name)
        if sheet is None: return None
        owners=[item.get('metadataValue') for item in sheet.get('developerMetadata',[]) if item.get('metadataKey')==self.OWNER_KEY]
        return owners[0] if len(owners)==1 else None
    def _owned(self,name):
        rows=self.read_tab(name)
        if self.ownership(name)!=OWNER or not rows or tuple(rows[0])!=TAB_HEADERS[name]:
            raise ValidationIssue('sheet_structure',tab=name)
        return rows
    @staticmethod
    def _row_data(rows):
        encoded=[]
        for row in rows:
            values=[]
            for value in row:
                if value is None or value=='': cell={}
                elif isinstance(value,bool): cell={'userEnteredValue':{'boolValue':value}}
                elif isinstance(value,(int,float)): cell={'userEnteredValue':{'numberValue':value}}
                else: cell={'userEnteredValue':{'stringValue':str(value)}}
                values.append(cell)
            encoded.append({'values':values})
        return encoded
    def create_tab(self,name,headers,owner):
        self._allowed(name)
        if tuple(headers)!=TAB_HEADERS[name] or owner!=OWNER or self._sheet(name) is not None:
            raise ValueError('새 관리 탭의 조건이 올바르지 않습니다.')
        # Caller-selected ID lets addSheet, OWNER and header share one atomic batch.
        metadata=self.api.spreadsheets().get(spreadsheetId=self.spreadsheet_id,
                                            fields='sheets(properties(sheetId))').execute()
        used={sheet['properties']['sheetId'] for sheet in metadata.get('sheets',[])}
        sheet_id=secrets.randbelow(2**31-1)
        while sheet_id in used: sheet_id=secrets.randbelow(2**31-1)
        self.api.spreadsheets().batchUpdate(spreadsheetId=self.spreadsheet_id,body={'requests':[
            {'addSheet':{'properties':{'sheetId':sheet_id,'title':name,
                         'gridProperties':{'rowCount':1000,'columnCount':len(headers)}}}},
            {'createDeveloperMetadata':{'developerMetadata':{'metadataKey':self.OWNER_KEY,'metadataValue':owner,
               'location':{'sheetId':sheet_id},'visibility':'DOCUMENT'}}},
            {'updateCells':{'start':{'sheetId':sheet_id,'rowIndex':0,'columnIndex':0},
                            'rows':self._row_data([headers]),'fields':'userEnteredValue'}}
        ]}).execute()
    def write_rows(self,name,body_rows):
        self._allowed(name)
        if name==CARE_TAB or any(len(row)>len(TAB_HEADERS[name]) for row in body_rows):
            raise ValueError('자동 관리 본문 범위를 벗어났습니다.')
        existing=self._owned(name)
        end_row=max(len(existing),len(body_rows)+1)
        if end_row==1: return
        sheet=self._sheet(name)
        # A range clears only userEnteredValue cells omitted by rows, in the SAME
        # atomic update that writes the replacement. Headers/formats stay intact.
        self.api.spreadsheets().batchUpdate(spreadsheetId=self.spreadsheet_id,body={'requests':[
            {'updateCells':{'range':{'sheetId':sheet['properties']['sheetId'],
                 'startRowIndex':1,'endRowIndex':end_row,'startColumnIndex':0,
                 'endColumnIndex':len(TAB_HEADERS[name])},
                 'rows':self._row_data(body_rows),'fields':'userEnteredValue'}}
        ]}).execute()
    def update_cells(self,name,updates):
        self._allowed(name)
        if name!=CARE_TAB or any(type(r) is not int or type(c) is not int or r<1 or not 0<=c<=2 for r,c,_ in updates):
            raise ValueError('돌봄 기록 자동 열만 수정할 수 있습니다.')
        self._owned(name)
        for row,column,value in updates:
            self.api.spreadsheets().values().update(spreadsheetId=self.spreadsheet_id,
                range=_a1(name)+'!'+_column(column)+str(row+1),valueInputOption='RAW',body={'values':[[value]]}).execute()


class ProductionAdapter:
    def __init__(self):
        self.settings=None; self.google=None; self.gmail=None; self.sheets=None
        self.playwright=None; self.browser=None; self.page=None; self.right_frame=None
    def authenticate(self,settings,paths,secret_store,*,reauthorize=False):
        from settlement_automation import get_google_credentials, spreadsheet_id_from_url, wait_for_login, PERSON_LIST_URL
        from googleapiclient.discovery import build
        from playwright.sync_api import sync_playwright
        self.close()
        self.settings=settings
        secret_store=secret_store or SecretStore()
        if not settings.dimode_account or not secret_store.get_password(settings.dimode_account):
            raise ValidationIssue('account')
        credentials=get_google_credentials(paths=paths,settings=settings,reauthorize=reauthorize)
        self.google=build('sheets','v4',credentials=credentials)
        self.gmail=build('gmail','v1',credentials=credentials)
        self.sheets=GoogleSheetsAdapter(self.google,spreadsheet_id_from_url(settings.sheet_url))
        self.playwright=sync_playwright().start()
        self.browser=self.playwright.chromium.launch(headless=False)
        self.page=self.browser.new_page()
        self.page.goto(settings.dimode_url)
        with use_settings(settings):
            wait_for_login(self.page,account=settings.dimode_account,secret_store=secret_store)
        deadline=time.monotonic()+20
        right=self.page.frame(name='right')
        while right is None and time.monotonic()<deadline:
            self.page.wait_for_timeout(250); right=self.page.frame(name='right')
        if right is None: raise RuntimeError('디모데 화면 연결을 확인해 주세요.')
        right.goto(PERSON_LIST_URL); right.wait_for_load_state('domcontentloaded')
        self.right_frame=self.page.frame_locator('frame[name="right"]')
    def load_rows(self):
        from settlement_automation import load_source_rows
        with use_settings(self.settings): return load_source_rows(self.google)
    def query_person(self,row,options):
        from settlement_automation import collect_results
        with use_settings(self.settings):
            return collect_results(self.page,self.right_frame,[row],options,on_progress=lambda *_:None)[0]
    def write_legacy(self,results,as_of):
        from settlement_automation import write_result_sheet
        restored=[]
        for item in results:
            item=dict(item)
            for key in ('등록일','기준일'):
                if isinstance(item.get(key),str) and item[key]: item[key]=date.fromisoformat(item[key])
            restored.append(item)
        with use_settings(self.settings): write_result_sheet(self.google,restored,as_of)
    def send(self,report):
        from settlement_email import _send
        return _send(self.gmail,report.recipients,report.subject,report.text,report.html)
    def close(self):
        try:
            if self.browser: self.browser.close()
        finally:
            self.browser=None; self.page=None; self.right_frame=None
            if self.playwright:
                try: self.playwright.stop()
                finally: self.playwright=None
