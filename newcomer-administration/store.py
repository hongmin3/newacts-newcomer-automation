"""One SQLite transaction per transition; connections always close."""
import contextlib
import sqlite3
import pathlib
from windows_runtime import acquire_writer_lock


class OperationStore:
    def __init__(self,path):
        self.path=pathlib.Path(path)
        with acquire_writer_lock(self.path.with_suffix('.writer.lock')), self.connection() as db:
            db.executescript('''CREATE TABLE IF NOT EXISTS steps (
                batch TEXT, record TEXT, step TEXT, attempt INTEGER NOT NULL,
                state TEXT NOT NULL, before_digest TEXT, external_id TEXT, after_digest TEXT,
                PRIMARY KEY(batch,record,step));
                CREATE TABLE IF NOT EXISTS publications (
                record TEXT PRIMARY KEY, publication TEXT NOT NULL, batch TEXT NOT NULL);''')
            db.execute("UPDATE steps SET state='UNKNOWN' WHERE state='APPLYING'")

    @contextlib.contextmanager
    def connection(self):
        db=sqlite3.connect(self.path,timeout=5)
        db.row_factory=sqlite3.Row
        try:
            with db: yield db
        finally: db.close()

    def step(self,batch,record,step):
        with self.connection() as db:
            row=db.execute('SELECT * FROM steps WHERE batch=? AND record=? AND step=?',(batch,record,step)).fetchone()
            return dict(row) if row else None

    def begin_step(self,batch,record,step,before):
        with self.connection() as db:
            db.execute('BEGIN IMMEDIATE')
            old=db.execute('SELECT state,attempt FROM steps WHERE batch=? AND record=? AND step=?',(batch,record,step)).fetchone()
            if old and old['state'] in ('APPLYING','UNKNOWN','VERIFIED'):
                raise ValueError('완료 또는 결과 불명 작업은 재전송할 수 없습니다.')
            attempt=old['attempt']+1 if old else 1
            db.execute('INSERT OR REPLACE INTO steps VALUES (?,?,?,?,?,?,NULL,NULL)',
                       (batch,record,step,attempt,'APPLYING',before))
        return (batch,record,step)

    def finish_step(self,key,state,external_id=None,after_digest=None):
        if state not in ('VERIFIED','UNKNOWN','FAILED','REVIEW'): raise ValueError('잘못된 작업 상태')
        with self.connection() as db:
            db.execute('UPDATE steps SET state=?,external_id=?,after_digest=? WHERE batch=? AND record=? AND step=?',
                       (state,external_id,after_digest,*key))

    def published(self):
        with self.connection() as db: return {r['record'] for r in db.execute('SELECT record FROM publications')}

    def record_publication(self,record,publication,batch):
        with self.connection() as db:
            old=db.execute('SELECT publication,batch FROM publications WHERE record=?',(record,)).fetchone()
            if old:
                if tuple(old)==(publication,batch): return
                raise ValueError('다른 실행에서 이미 게시한 사람입니다.')
            db.execute('INSERT INTO publications VALUES (?,?,?)',(record,publication,batch))
