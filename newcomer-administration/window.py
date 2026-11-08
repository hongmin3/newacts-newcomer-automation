"""Small native Windows review screen. All external operations are explicit."""
import json
import pathlib
import queue
import threading
import tkinter as tk
from tkinter import ttk,filedialog,messagebox,simpledialog
import urllib.parse

from windows_runtime import user_data_root
from source import read_csv
from workflow import preview


class Window:
    def __init__(self,root):
        self.root=root; self.data=user_data_root(); self.review=None; self.source_rows=[]
        self.busy=False; self.messages=queue.Queue()
        root.title('뉴액츠 새가족 교적·주보 도우미'); root.geometry('1000x720'); root.minsize(800,600)
        self.fields={key:tk.StringVar() for key in ('sheet','start','end','publication')}
        settings=self.data/'settings.json'
        if settings.exists():
            saved=json.loads(settings.read_text(encoding='utf-8'))
            self.fields['sheet'].set(saved.get('sheet',''))
        outer=ttk.Frame(root,padding=20); outer.pack(fill='both',expand=True)
        ttk.Label(outer,text='새가족 등록과 다음 주 주보 준비',font=('맑은 고딕',18,'bold')).pack(anchor='w')
        ttk.Label(outer,text='명단을 확인한 뒤 단계별로 진행합니다. 현재 교적 자동 저장은 연결 확인 전입니다.').pack(anchor='w',pady=(8,16))
        form=ttk.Frame(outer); form.pack(fill='x')
        for i,(key,label) in enumerate([('sheet','일반 등록 시트 주소'),('start','등록 시작일'),('end','등록 종료일'),('publication','주보 발행일')]):
            ttk.Label(form,text=label).grid(row=i,column=0,sticky='w',pady=4)
            ttk.Entry(form,textvariable=self.fields[key],width=75 if i==0 else 20).grid(row=i,column=1,sticky='w',padx=12)
        ttk.Label(form,text='날짜는 연도를 포함해 입력하세요. 예: 2026-11-08').grid(row=4,column=1,sticky='w',padx=12,pady=4)
        actions=ttk.Frame(outer); actions.pack(fill='x',pady=12)
        for text,command in [('Google 연결',self.google_auth),('시트 불러오기',self.load_sheet),
                             ('CSV 불러오기',self.load_csv),('디모데 인증',self.credentials),('교적 대조',self.lookup),
                             ('검토 저장',self.export_review)]:
            ttk.Button(actions,text=text,command=command).pack(side='left',padx=(0,6))
        self.table=ttk.Treeview(outer,columns=('date','name','phone','state','issues'),show='headings')
        for key,label,width in [('date','등록일',95),('name','이름',100),('phone','연락처',110),('state','교적 확인',110),('issues','확인할 내용',400)]:
            self.table.heading(key,text=label); self.table.column(key,width=width,stretch=key=='issues')
        scroll=ttk.Scrollbar(outer,orient='vertical',command=self.table.yview); self.table.configure(yscrollcommand=scroll.set)
        scroll.pack(side='right',fill='y'); self.table.pack(fill='both',expand=True)
        self.status=tk.StringVar(value='등록 기간과 주보 발행일을 입력하고 명단을 불러오세요.')
        ttk.Label(outer,textvariable=self.status,wraplength=920).pack(anchor='w',pady=(12,6))
        ttk.Label(outer,text='기등록자도 주보·새 번호·전도 실적에 포함합니다. 방문 전용은 제외합니다.').pack(anchor='w')
        ttk.Label(outer,text='한글 양식 연결과 교적 저장 화면 확인이 끝날 때까지 최종 자동 반영은 보류됩니다.').pack(anchor='w')
        root.after(100,self.poll); root.protocol('WM_DELETE_WINDOW',self.close)

    def work(self,label,fn,done):
        if self.busy: messagebox.showinfo('진행 중','현재 작업이 끝날 때까지 기다려 주세요.'); return
        self.busy=True; self.status.set(label)
        def worker():
            try: self.messages.put((done,fn(),None))
            except Exception as error:
                message=str(error) if isinstance(error,ValueError) else '연결·파일 접근을 확인하세요. 자동 재시도하지 않았습니다.'
                self.messages.put((done,None,message))
        threading.Thread(target=worker,daemon=True).start()

    def poll(self):
        try:
            done,value,error=self.messages.get_nowait(); self.busy=False
            if error: self.status.set(error); messagebox.showerror('확인 필요',error)
            else: done(value)
        except queue.Empty: pass
        self.root.after(100,self.poll)

    def dates(self): return [self.fields[k].get().strip() for k in ('start','end','publication')]

    def show(self,review):
        self.review=review
        self.table.delete(*self.table.get_children())
        labels={'NOT_CHECKED':'조회 전','EXISTING':'기등록 확인','NEW_CANDIDATE':'신규 후보','REVIEW':'검토 필요'}
        for row in review['records']:
            issues=list(row['issues'])
            if row.get('decision'): issues.append(row['decision']['reason'])
            self.table.insert('', 'end', values=(row['date'],row['name'],row['phone'],labels.get(row['identity'],row['identity']),' / '.join(issues)))
        self.status.set(f"{len(review['records'])}명 검토 중. 교적·시트·주보 변경은 하지 않았습니다.")

    def load_csv(self):
        if self.busy: return
        path=filedialog.askopenfilename(title='등록 명단 CSV 선택',filetypes=[('CSV','*.csv')])
        if not path: return
        try:
            from sheets import outside_repo
            from files import file_hash
            path=outside_repo(path); self.source_rows=read_csv(path)
            review=preview(self.source_rows,*self.dates())
            review.update(source_path=str(path),source_file_hash=file_hash(path))
            self.show(review)
        except ValueError as error: messagebox.showerror('명단 확인',str(error))
        except Exception: messagebox.showerror('명단 확인','파일 인코딩과 읽기 권한을 확인하세요.')

    def google_auth(self):
        if self.busy: return
        path=filedialog.askopenfilename(title='Google Desktop OAuth 인증 파일 선택',filetypes=[('JSON','*.json')])
        if not path: return
        from sheets import authorize
        self.work('브라우저에서 Google 읽기 권한을 승인해 주세요.',lambda:authorize(path,self.data/'google-token.dpapi'),
                  lambda _:self.status.set('Google 읽기 권한 연결 완료. 시트는 변경하지 않았습니다.'))

    def load_sheet(self):
        raw=self.fields['sheet'].get().strip(); parts=urllib.parse.urlsplit(raw)
        if raw.startswith('https://docs.google.com/spreadsheets/d/'):
            ident=parts.path.split('/')[3]
        else: ident=raw
        if not ident or '/' in ident: messagebox.showerror('시트 확인','일반 등록 시트 주소를 입력하세요.'); return
        dates=self.dates()
        from sheets import connect,read_sheet
        def load():
            service=connect(self.data/'google-token.dpapi')
            rows,_,_=read_sheet(service,ident)
            result=preview(rows,*dates); result['sheet_id']=ident
            return rows,result
        def done(value):
            self.source_rows,review=value; self.show(review)
            (self.data/'settings.json').write_text(json.dumps({'sheet':raw},ensure_ascii=False),encoding='utf-8')
        self.work('일반 등록 시트를 읽고 있습니다.',load,done)

    def credentials(self):
        if self.busy: return
        account=simpledialog.askstring('디모데 인증','디모데 계정',parent=self.root)
        if not account: return
        password=simpledialog.askstring('디모데 인증','암호는 현재 Windows 사용자 전용으로 암호화합니다.',show='*',parent=self.root)
        if not password: return
        from dimode import save_credentials
        try:
            save_credentials(self.data/'dimode.dpapi',account,password)
            self.status.set('디모데 인증을 암호화했습니다. 아직 로그인하지 않았습니다.')
        except Exception: messagebox.showerror('인증 저장','Windows 사용자 인증 저장에 실패했습니다.')

    def lookup(self):
        if not self.source_rows: messagebox.showinfo('명단 선택','먼저 등록 명단을 불러오세요.'); return
        dates=self.dates()
        from dimode import open_reader
        self.work('디모데를 읽고 있습니다. 교적은 변경하지 않습니다.',
                  lambda:preview(self.source_rows,*dates,reader=open_reader(self.data/'dimode.dpapi')),self.show)

    def export_review(self):
        if self.busy or self.review is None: return
        from main import save_json
        path=filedialog.asksaveasfilename(title='개인정보가 포함된 검토 자료 저장',initialdir=str(self.data),defaultextension='.json')
        if not path: return
        try:
            save_json(path,self.review); self.status.set('검토 자료를 저장했습니다. 운영 자료는 변경하지 않았습니다.')
        except Exception: messagebox.showerror('저장 확인','기존 파일을 덮어쓸 수 없습니다. 저장소 밖 새 경로를 선택하세요.')

    def close(self):
        if self.busy:
            messagebox.showinfo('진행 중','현재 조회가 끝난 뒤 창을 닫아 주세요.'); return
        self.root.destroy()


def run():
    root=tk.Tk(); Window(root); root.mainloop()
