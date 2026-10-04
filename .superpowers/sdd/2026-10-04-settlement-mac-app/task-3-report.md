# Task 3 완료 보고

상태: DONE. 실행별 원본·월별 선택과 담당자 기록 보존 경계를 구현했다. 실제 Sheets·디모데·메일·트리거·배포·push는 실행하지 않았다.

## 변경과 검증

- `settlement-automation/desktop/history.py`: 0600 CSV·SQLite와 0700 저장 폴더, 실행 번호별 원본 보존, 전체 품질 통과 실행 선택, 군·월·산식별 마지막 정상 결과와 전월 비교를 구현했다.
- `settlement-automation/desktop/sheets.py`: 세 새 탭만 대상으로 소유 표식·전체 헤더를 먼저 확인한다. 확정 ID의 기본 정보 3열만 갱신하고 담당자 5열·기존 원본 명단·정착률 탭을 보존한다.
- SQLite에는 스냅샷의 형식 유지 JSON, 시트 반영 원래 입력, 완료 단계가 남는다. 같은 실행 번호에 다른 내용을 넣으면 거부한다. 시트 실패 후 완료한 단계는 반복하지 않는다.
- 추적성 경로와 CHANGELOG·progress·생성 HTML을 갱신했다. 앱·운영 연결이 남으므로 draft 상태를 유지한다.

## RED / GREEN 명령과 출력

모든 Python 검증은 다음 공통 명령이다. 가짜 config를 사용하는 실행기이며 생략된 시험은 없다.

```bash
settlement-automation/.venv/bin/python -B settlement-automation/tests/run_tests.py
```

1. 이력·시트 시험을 먼저 작성했다. RED: `ModuleNotFoundError: No module named 'desktop.history'`, `Ran 26 tests in 0.025s`, `FAILED (errors=2)`.
2. 두 모듈 구현 후 GREEN: `Ran 32 tests in 0.057s`, `OK`.
3. 소유 헤더·ID 중복·수동 열 셀 쓰기·동일 실행 내용 변경 시험을 추가했다. RED: `test_same_run_changed_payload_halts_before_writes`, `AssertionError: ValueError not raised`, `Ran 36 tests in 0.069s`, `FAILED (failures=1)`.
4. 반영 내용 지문을 저장한 뒤 GREEN: `Ran 36 tests in 0.082s`, `OK`.
5. 형식 유지 복구 읽기·미완료 실행 목록 시험을 추가했다. RED: `AttributeError: 'HistoryStore' object has no attribute 'load_snapshot'`, `Ran 37 tests in 0.094s`, `FAILED (errors=1)`.
6. 원래 JSON 입력과 복구 조회 API 구현 후 GREEN: `Ran 37 tests in 0.085s`, `OK`.

대표 실행 경로는 가짜 Sheets에 두 번 게시하여 군 이동 후 메모·동명이인 ID·원본 탭 보존을 읽고, 월별 선택과 일부 실패 뒤 새 HistoryStore로 복구하는 시험에서 실제 모듈을 실행했다. 가짜는 외부 Sheets 경계만 대체한다.

- `npm test`: `7개 검증 파일 모두 통과`.
- `node .project-check/render-spec-html.js .`: `SPEC_HTML WRITTEN docs/SPEC.html`.
- `node .project-check/project-readiness.js .`: `failed=0`; 기존 `SPEC_OPEN_QUESTIONS` 경고 유지.
- `git diff --check`: 통과.

## 후속 작업 인터페이스 계약

### HistoryStore

`HistoryStore(root: Path)`의 root는 **RuntimePaths.data_root**다. root/runs와 root/history.sqlite3을 쓴다. runs_dir 자체나 home을 넣으면 안 된다. 저장 폴더 0700, CSV·SQLite 0600이며 앱 빌드와 Git에 넣지 않는다.

```python
save_snapshot(run_id, as_of: date, results: list[dict], version: str, status: str) -> Path
monthly_summary(month: str, version: str) -> list[dict]
load_snapshot(run_id) -> dict
stage_done(run_id, stage) -> bool
mark_stage(run_id, stage) -> None
bind_publication(run_id, results, summaries) -> None
pending_publications() -> list[str]
load_publication(run_id) -> dict
```

- run_id는 영숫자로 시작하고 영숫자·밑줄·하이픈만 포함하는 1~128자다. 새 실행은 새 ID를 써야 한다.
- status=`completed`이고 전체 완료율이 0.95 이상인 비어 있지 않은 결과만 월별 정상 선택에 들어간다. `failed`, `cancelled`, `test` 등 다른 status는 CSV·실행 기록만 남긴다. 시험은 이 상태로 운영 선택과 분리한다.
- 군별 0.95는 SPEC의 **발송** 조건이다. 전체 정상 실행의 낮은 완료율 군도 월별 현황에 `review_count`·`completion_rate`와 함께 보존한다. 이력 선택에 군별 발송 게이트를 적용하지 않는다.
- CSV 이름은 UTC 조회 기록 시각과 run_id를 포함한다. SQLite의 as_of는 선택 기준일, recorded_at은 UTC 저장 시각이다. 결과 사전의 당시 군·기준일·조회값을 고치지 않는다.
- 동일 run_id·동일 스냅샷은 기존 경로를 반환한다. 다른 내용은 ValueError다. 원본은 자동 삭제하지 않는다.
- month는 `YYYY-MM`, version은 `recent4-v1`으로 시작한다. 월별 반환은 army_metrics의 모든 필드에 `run_id`, `as_of`(ISO 문자열), `recorded_at`, `month`, `previous_run_id`, `member_count_delta`, `rate_delta_pp`, `recent_rate_delta_pp`를 더한다. 비율 차이는 `(현재-전월)*100`이다.
- 실행 없는 월은 `[]`다. 화면은 이를 `미실행`으로 표시해야 한다. 전월 또는 같은 산식 전월이 없으면 비교값은 None이다. 분모가 0인 비율 비교도 None이다.
- load_snapshot은 `as_of`를 date로, results의 수치/None을 JSON 형식으로 돌려준다. CSV만 다시 해석할 필요가 없다.
- 단계 이름은 `current`, `monthly`, `care`다. pending_publications는 이 세 단계가 모두 완료되지 않은 반영 요청의 실행 번호다. load_publication은 `{run_id, results, summaries}`다.
- 복구 시 **load_publication의 원래 입력**으로 publish해야 한다. 나중의 월별 자료로 summaries를 다시 만들면 같은 ID의 내용 변경으로 거부된다.
- 스냅샷 전에 조회가 강제 종료된 실행 관리와 메일 상태는 Task4의 서비스 책임이다. 이 모듈은 스냅샷 저장 후 시트 일부 반영 복구를 담당한다.

### SheetPublisher

```python
SheetPublisher(sheets, history: HistoryStore)
publish(run_id: str, results: list[dict], summaries: list[dict]) -> dict
# 반환: {'run_id': run_id, 'completed': ['current', 'monthly', 'care']}
```

실제 Sheets 어댑터는 **주입해야 한다**. 모듈은 네트워크나 운영 config를 import하지 않는다. 계약은 다음과 같다.

```python
read_tab(name) -> list[list] | None  # 헤더 포함, 없는 탭은 None
ownership(name) -> str | None
create_tab(name, headers, owner) -> None
write_rows(name, body_rows) -> None  # 자동 소유 본문만 교체; 헤더 유지
update_cells(name, [(row, column, value), ...]) -> None  # 0부터 시작하는 인덱스
```

- OWNER=`newacts-settlement-desktop-v1`. 어댑터는 탭의 영구 metadata 등으로 소유 표식을 읽고 저장한다. 이름·헤더만으로 소유를 추정하면 안 된다.
- 모듈의 `TAB_HEADERS`가 정확한 열 순서다. 탭은 `군별 정착 현황`, `정착률 월별 이력`, `새가족 돌봄 기록`뿐이다. 원본 탭과 기존 `정착률` 탭에는 어댑터 호출을 하지 않는다.
- 기존 세 탭을 모두 읽고 소유·헤더·돌봄 ID 중복을 확인한 뒤 첫 변경을 한다. 확인 실패면 외부 변경 0회다.
- 돌봄 탭 자동 열은 0~2의 `디모데 ID`, `이름`, `군`이다. 3~7의 담당자·연락일·진행 상태·다음 확인일·메모에 update_cells를 호출하지 않는다. 새 행도 자동 열만 쓴다.
- person ID는 기존 `디모데 ID` 또는 주입 결과 `dimode_id`다. `조회 상태`/`status`=`조회완료`인 유일 ID만 기본 정보를 쓴다. ID 없음·동일 입력 ID 복수·미확정 상태는 돌봄 연결을 하지 않는다. 확인 대상 표시는 서비스/UI가 결과 사전을 사용한다.
- 현황은 results에서 군별 계산을 다시 하고 summaries에서 기준일·전월 차이를 가져온다. 실제 서비스 결과에 `기준일`을 유지한다.
- 월별 탭은 `(month,formula_version,army)`별 선택값을 갱신하고 다른 월·산식 행은 남긴다. 실행별 불변 원본은 CSV·SQLite에 있다.
- 각 탭 작업 성공 후 SQLite 단계를 기록한다. 외부 쓰기 성공 후 단계 기록 전에 종료되어도 같은 원래 입력의 자동 영역만 반복할 수 있다. 돌봄 수동 열에는 영향을 주지 않는다.
- publish 자체는 완료 품질·취소 판정을 받지 않는다. 서비스는 정상 실행·인증 완료를 확인하고 save_snapshot을 끝낸 후 publish해야 한다. 실패·취소 실행은 게시하지 않는다. 메일은 호출하지 않는다.

## 한계·프로토콜

실제 Sheets 권한·metadata 저장·네트워크·Mac 앱은 미검증이다. 아직 구체적 gspread 어댑터와 서비스/UI 연결은 없다. 기존 Windows·Apps Script 파일은 변경하지 않았다.

Task Observer: 저장소 확인, 보존된 bash frontmatter scan·checkpoint 기록, 원칙 확인, 리뷰 날짜 2026-09-28 확인을 실행했다. 7일 미만으로 리뷰 대상이 아니다. task-observer와 test-driven-development를 지목한 활성 관찰은 없었다. 기록 없음: 일반 구현·테스트 보완 외 새 스킬 개선 신호가 없었다.

Akela registration slice를 읽고 data-effects/config-invariants/personal-data/local-tests 적용을 기록했다. outcome DONE. observer와 akela runtime 기록은 커밋에서 제외했다. push 없음.

## 검토 수정 1: 혼합 조회 상태의 중복 ID

BASE `aac12c1`의 Important finding을 재현했다. 기존 구현은 조회완료 행을 먼저 골라 같은 ID의 조회오류 행을 중복 판정에서 빼고 있었다. 전체 입력의 비어 있지 않은 ID를 먼저 묶은 뒤, 빈도가 1이고 조회완료인 행만 돌봄에 연결하도록 수정했다. SPEC 변경은 없다.

회귀 시험 `test_mixed_status_duplicate_id_preserves_care_and_does_not_add`는 기존 돌봄 행·새 ID 각각에 조회완료/조회오류 두 행을 넣는다. 기존 3개 자동 열과 5개 수동 열 전체가 그대로이고 새 행도 없으며 돌봄 탭 외부 쓰기 0회임을 확인한다.

RED/GREEN covering 명령:

```bash
settlement-automation/.venv/bin/python -B -c 'import runpy, unittest, sys; runpy.run_path("settlement-automation/tests/run_tests.py"); suite=unittest.defaultTestLoader.discover("settlement-automation/tests",pattern="test_desktop_sheets.py"); result=unittest.TextTestRunner().run(suite); sys.exit(not result.wasSuccessful())'
```

- RED: `Ran 8 tests in 0.042s`, `FAILED (failures=1)`. 기존 ID의 군이 신→조로 바뀌고 new ID 행이 생겨 전체 행 비교가 실패했다.
- GREEN: `Ran 8 tests in 0.042s`, `OK`. 운영 config를 가리는 공통 실행기를 사용했고 외부 경계는 FakeSheet다.
- 후속 계약 변경: 같은 ID의 모든 상태를 포함하여 빈도를 센다. 빈도 1+조회완료만 갱신한다. 생성자·복구 API·열 계약은 그대로다.
- HTML 재생성·준비 검사 failed=0·diff 검사를 통과했다. 실제 운영 호출·push 없음.
- Task Observer 시작 스캔·checkpoint·리뷰 날짜를 다시 확인했다. 기록 없음: 작업 산출물 결함이며 새 스킬 개선 신호 없음. Akela registration slice를 읽고 적용 규칙과 outcome DONE을 기록했다. runtime 기록은 커밋에서 제외했다.
