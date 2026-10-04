"""Owned desktop tabs only; external sheet access is explicitly injected."""
from .metrics import army_metrics

OWNER = 'newacts-settlement-desktop-v1'
CURRENT_TAB = '군별 정착 현황'
HISTORY_TAB = '정착률 월별 이력'
CARE_TAB = '새가족 돌봄 기록'
METRIC_FIELDS = ('army','member_count','completion_rate','rate','recent_rate','member_count_delta','rate_delta_pp','recent_rate_delta_pp')
TAB_HEADERS = {
    CURRENT_TAB: ('실행 번호','기준일','군','인원','조회 완료율','누적 출석률','최근 4주 출석률','전월 인원 차이','누적 차이(pp)','최근 차이(pp)'),
    HISTORY_TAB: ('월','산식 버전','실행 번호','기준일','군','인원','조회 완료율','누적 출석률','최근 4주 출석률','전월 인원 차이','누적 차이(pp)','최근 차이(pp)'),
    CARE_TAB: ('디모데 ID','이름','군','담당자','연락일','진행 상태','다음 확인일','메모'),
}


class SheetPublisher:
    """Adapter uses zero-based cell indexes and durable per-run stage checkpoints.

    read_tab -> list[list] | None; ownership -> str | None;
    create_tab(name, headers, owner); write_rows(name, body_rows);
    update_cells(name, [(row, column, value), ...]).
    write_rows replaces only owned body rows; update_cells touches only supplied cells.
    """
    def __init__(self, sheets, history):
        self.sheets = sheets
        self.history = history

    def publish(self, run_id: str, results: list[dict], summaries: list[dict]) -> dict:
        self.history.bind_publication(run_id,results,summaries)
        # Validate ALL existing destinations before creating or modifying any tab.
        existing = {}
        for name,headers in TAB_HEADERS.items():
            rows = self.sheets.read_tab(name)
            existing[name] = rows
            if rows is not None and (self.sheets.ownership(name) != OWNER or not rows or tuple(rows[0]) != headers):
                raise ValueError('기존 관리 탭의 소유 구조 확인이 필요합니다: ' + name)
        care = existing[CARE_TAB] or [list(TAB_HEADERS[CARE_TAB])]
        ids = [str(row[0]) for row in care[1:] if row and row[0]]
        if len(ids) != len(set(ids)):
            raise ValueError('돌봄 기록의 디모데 ID 중복을 확인해 주세요.')
        for name,headers in TAB_HEADERS.items():
            if existing[name] is None:
                self.sheets.create_tab(name,headers,OWNER)
        stages = ('current','monthly','care')
        summary_by_army = {item['army']:item for item in summaries}
        if not self.history.stage_done(run_id,'current'):
            rows = []
            for metric in army_metrics(results):
                summary = summary_by_army.get(metric['army'],{})
                item = dict(metric)
                item.update({key:summary.get(key) for key in METRIC_FIELDS if key.endswith('_delta') or key.endswith('_pp')})
                as_of = summary.get('as_of',str(results[0].get('기준일','')) if results else '')
                rows.append([run_id,as_of] + [self._cell(item.get(key)) for key in METRIC_FIELDS])
            self.sheets.write_rows(CURRENT_TAB,rows)
            self.history.mark_stage(run_id,'current')
        if not self.history.stage_done(run_id,'monthly'):
            rows = (self.sheets.read_tab(HISTORY_TAB) or [[]])[1:]
            keys = {(row[0],row[1],row[4]):index for index,row in enumerate(rows) if len(row)>=5}
            for item in summaries:
                key = (item['month'],item['formula_version'],item['army'])
                row = [item['month'],item['formula_version'],item['run_id'],item['as_of']] + [self._cell(item.get(field)) for field in METRIC_FIELDS]
                if key in keys:
                    rows[keys[key]] = row
                else:
                    keys[key] = len(rows)
                    rows.append(row)
            self.sheets.write_rows(HISTORY_TAB,rows)
            self.history.mark_stage(run_id,'monthly')
        if not self.history.stage_done(run_id,'care'):
            rows = self.sheets.read_tab(CARE_TAB)
            indexes = {str(row[0]):index for index,row in enumerate(rows[1:],1) if row and row[0]}
            updates = []
            incoming = {}
            for person in results:
                person_id = str(person.get('디모데 ID',person.get('dimode_id','')) or '').strip()
                if person_id:
                    incoming.setdefault(person_id,[]).append(person)
            next_row = len(rows)
            for person_id,matches in incoming.items():
                if len(matches) != 1:
                    continue
                person = matches[0]
                if person.get('조회 상태',person.get('status')) != '조회완료':
                    continue
                index = indexes.get(person_id)
                if index is None:
                    index = next_row
                    next_row += 1
                values = (person_id,person.get('이름',person.get('name','')),person.get('군',person.get('army','')))
                for col,value in enumerate(values):
                    if index >= len(rows) or col >= len(rows[index]) or rows[index][col] != value:
                        updates.append((index,col,value))
            if updates:
                self.sheets.update_cells(CARE_TAB,updates)
            self.history.mark_stage(run_id,'care')
        return {'run_id':run_id,'completed':list(stages)}

    @staticmethod
    def _cell(value):
        return '' if value is None else value
