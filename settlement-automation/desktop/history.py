"""Private immutable execution snapshots and transactional monthly selections."""
import csv
import hashlib
import io
import json
import re
import sqlite3
from datetime import date, datetime, timezone
from pathlib import Path
from .metrics import army_metrics
from .runtime import write_private_file


class HistoryStore:
    def __init__(self, root: Path):
        self.root = Path(root)
        self.runs_dir = self.root / 'runs'
        self.history_file = self.root / 'history.sqlite3'
        for directory in (self.root, self.runs_dir):
            directory.mkdir(parents=True, exist_ok=True, mode=0o700)
            directory.chmod(0o700)
        if not self.history_file.exists():
            self.history_file.touch(mode=0o600)
        self.history_file.chmod(0o600)
        with self._connect() as db:
            db.executescript('''
                CREATE TABLE IF NOT EXISTS runs (
                    run_id TEXT PRIMARY KEY, as_of TEXT NOT NULL, recorded_at TEXT NOT NULL,
                    version TEXT NOT NULL, status TEXT NOT NULL, path TEXT NOT NULL,
                    digest TEXT NOT NULL, selected INTEGER NOT NULL, metrics TEXT NOT NULL, payload TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS publications (run_id TEXT PRIMARY KEY, digest TEXT NOT NULL, payload TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS stages (
                    run_id TEXT NOT NULL, stage TEXT NOT NULL, PRIMARY KEY(run_id, stage));
            ''')

    def _connect(self):
        return sqlite3.connect(self.history_file)

    @staticmethod
    def _run_id(run_id):
        if not isinstance(run_id,str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]{0,127}',run_id):
            raise ValueError('실행 번호 형식이 올바르지 않습니다.')
        return run_id

    def save_snapshot(self, run_id: str, as_of: date, results: list[dict], version: str, status: str) -> Path:
        self._run_id(run_id)
        payload = json.dumps({'as_of':as_of.isoformat(),'results':results,'version':version,'status':status},
                             ensure_ascii=False,sort_keys=True,default=str)
        digest = hashlib.sha256(payload.encode()).hexdigest()
        metrics = army_metrics(results)
        completed = sum(item['completed_count'] for item in metrics)
        selected = status == 'completed' and bool(results) and completed / len(results) >= 0.95
        with self._connect() as db:
            db.execute('BEGIN IMMEDIATE')
            existing = db.execute('SELECT path,digest FROM runs WHERE run_id=?',(run_id,)).fetchone()
            if existing:
                if existing[1] != digest:
                    raise ValueError('같은 실행 번호의 원본을 바꿀 수 없습니다.')
                return Path(existing[0])
            recorded = datetime.now(timezone.utc).isoformat()
            directory = self.runs_dir / run_id
            directory.mkdir(mode=0o700,exist_ok=True)
            directory.chmod(0o700)
            path = directory / (datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ') + '_' + run_id + '.csv')
            output = io.StringIO(newline='')
            columns = list(dict.fromkeys(key for row in results for key in row))
            writer = csv.DictWriter(output,fieldnames=columns)
            writer.writeheader()
            writer.writerows(results)
            write_private_file(path,output.getvalue())
            db.execute('INSERT INTO runs VALUES (?,?,?,?,?,?,?,?,?,?)',
                       (run_id,as_of.isoformat(),recorded,version,status,str(path),digest,int(selected),
                        json.dumps(metrics,ensure_ascii=False),payload))
        return path

    def monthly_summary(self, month: str, version: str) -> list[dict]:
        start = date.fromisoformat(month + '-01')
        previous = date(start.year - (start.month == 1),12 if start.month == 1 else start.month-1,1).strftime('%Y-%m')
        with self._connect() as db:
            rows = db.execute('SELECT run_id,as_of,recorded_at,metrics FROM runs WHERE selected=1 AND version=? ORDER BY recorded_at,rowid',
                              (version,)).fetchall()
        chosen = {}
        for run_id,as_of,recorded,encoded in rows:
            for metric in json.loads(encoded):
                chosen[(as_of[:7],metric['army'])] = dict(metric,run_id=run_id,as_of=as_of,
                                                       recorded_at=recorded,month=as_of[:7],formula_version=version)
        summaries = []
        for (period,army),item in chosen.items():
            if period != month:
                continue
            prior = chosen.get((previous,army))
            item = dict(item)
            item['previous_run_id'] = prior['run_id'] if prior else None
            item['member_count_delta'] = item['member_count'] - prior['member_count'] if prior else None
            for field in ('rate','recent_rate'):
                item[field + '_delta_pp'] = ((item[field]-prior[field])*100
                    if prior and item[field] is not None and prior[field] is not None else None)
            summaries.append(item)
        return summaries

    def stage_done(self, run_id: str, stage: str) -> bool:
        with self._connect() as db:
            return db.execute('SELECT 1 FROM stages WHERE run_id=? AND stage=?',(run_id,stage)).fetchone() is not None

    def mark_stage(self, run_id: str, stage: str) -> None:
        self._run_id(run_id)
        with self._connect() as db:
            db.execute('INSERT OR IGNORE INTO stages VALUES (?,?)',(run_id,stage))

    def bind_publication(self, run_id: str, results: list[dict], summaries: list[dict]) -> None:
        self._run_id(run_id)
        payload = json.dumps([results,summaries],ensure_ascii=False,sort_keys=True,default=str)
        digest = hashlib.sha256(payload.encode()).hexdigest()
        with self._connect() as db:
            db.execute('BEGIN IMMEDIATE')
            prior = db.execute('SELECT digest FROM publications WHERE run_id=?',(run_id,)).fetchone()
            if prior and prior[0] != digest:
                raise ValueError('같은 실행 번호의 시트 반영 내용을 바꿀 수 없습니다.')
            db.execute('INSERT OR IGNORE INTO publications VALUES (?,?,?)',(run_id,digest,payload))

    def load_snapshot(self, run_id: str) -> dict:
        with self._connect() as db:
            row = db.execute('SELECT payload FROM runs WHERE run_id=?',(run_id,)).fetchone()
        if not row:
            raise KeyError(run_id)
        snapshot = json.loads(row[0])
        snapshot['as_of'] = date.fromisoformat(snapshot['as_of'])
        return snapshot

    def load_publication(self, run_id: str) -> dict:
        with self._connect() as db:
            row = db.execute('SELECT payload FROM publications WHERE run_id=?',(run_id,)).fetchone()
        if not row:
            raise KeyError(run_id)
        results,summaries = json.loads(row[0])
        return {'run_id':run_id,'results':results,'summaries':summaries}

    def pending_publications(self) -> list[str]:
        with self._connect() as db:
            return [row[0] for row in db.execute(
                "SELECT p.run_id FROM publications p WHERE (SELECT COUNT(*) FROM stages s WHERE s.run_id=p.run_id AND s.stage IN ('current','monthly','care'))<3 ORDER BY p.rowid")]
