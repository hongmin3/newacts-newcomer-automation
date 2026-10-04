# Task 4 실행 서비스 완료 보고

상태: DONE. 실제 Sheets·디모데·키체인·Gmail·트리거·배포·push는 실행하지 않았다. 운영 연결 코드와 가짜 외부 경계의 로컬 검증을 완료했다. 기능 상태는 GUI·앱 통합·승인된 운영 확인 전이므로 draft 유지한다.

## 변경

- `desktop/service.py`: 조회·품질·스냅샷·시트 단계를 제어하고 개인 조회 사이에서 취소한다. 조회는 메일을 보내지 않는다. 같은 실행 번호로 조회 또는 시트 미완료 단계만 복구한다.
- `desktop/adapters.py`: 실제 Google/Chromium/키체인·기존 조회·정착률 쓰기·Gmail을 명시된 설정으로 연결한다. 새 탭은 Google developerMetadata의 OWNER를 영구 저장하고 전체 헤더를 검증한다. 돌봄 기록은 A:C 셀만 갱신한다.
- `desktop/legacy_config.py`: CLI는 함수 호출 때 기존 config를 읽는다. Mac은 ContextVar로 비밀 없는 AppSettings 경계를 사용하며 config.py 없이 가져올 수 있다. 운영 설정을 전역 덮어쓰거나 시험용 sys.modules 주입을 제품에 넣지 않았다.
- `settlement_automation.py`: Google 파일 경로 설정을 선택적으로 주입하고 앱 조회는 개인 이름 출력 없이 진행 숫자를 전달한다. 기존 CLI 인자 없는 동작·월간 옵션·수신 범위·정착률 열 순서를 유지한다.
- `settlement_email.py`: 기존 고정 수신자·HTML 생성기를 사용한 미리보기 함수 추가. 전체는 요약만, 군 보고서는 기존 개인별 표를 유지한다.

## RED / GREEN

공통 Python 명령은 다음과 같다. 운영 config는 공통 실행기가 가리며, 생략은 없다.

```bash
settlement-automation/.venv/bin/python -B settlement-automation/tests/run_tests.py
```

1. 서비스 시험 먼저 추가. RED: `ModuleNotFoundError: No module named 'desktop.service'`, `Ran 39 tests`, `FAILED (errors=1)`.
2. 서비스 구현 뒤 명시적 가져오기·미리보기 시험 RED: config.py 없는 독립 프로세스에서 `ModuleNotFoundError: No module named 'config'`; 미리보기 함수 부재 5개 error. `Ran 48 tests`, `FAILED (failures=1, errors=5)`.
3. lazy CLI 경계·미리보기 연결 뒤 GREEN: 48개 통과.
4. 실제 Google API payload·기존 조회 연결 시험 추가. RED: adapter 부재 2개 error, 50개 중 실패. metadata OWNER·자동 셀 범위·명단 기간·개인 출력 억제 연결 후 GREEN: 50개 통과.
5. 미리보기 없는 반복 발송 시험 RED: 두 번째 호출이 `sent`여서 `preview_required` 기대와 불일치. 내부 미리보기 계산과 사용자 미리보기 승인을 분리한 뒤 GREEN: `Ran 54 tests`, `OK`.

검증한 경계:

- 정상 실행 뒤 자동 메일 0회, 기존 정착률 쓰기 1회, 자동 소유 탭 게시 완료.
- 개인 조회 완료 경계에서 취소한 결과는 cancelled 원본만 보관한다. 이전 monthly 정상 run_id 유지, 시트 추가 변경 0회.
- multiprocessing spawn 실제 두 프로세스에서 OS flock으로 두 번째 획득 차단. PID 파일 존재로 실행 중 여부를 판단하지 않는다. 락 해제 뒤 다시 획득 가능.
- 전체 94/100은 quality_failed·시트 변경/발송 차단, 95/100은 허용. 군 94/100 차단·95/100 발송. 군 경계 시험의 전체는 289/300으로 전체 게이트도 충족한다.
- 일부 시트 실패 후 resume: current와 legacy 완료 단계 호출 수가 각각 1 유지. 원래 load_publication 결과로 monthly/care만 완료한다. 디모데 재조회 0회.
- query 첫 사람 저장 후 KeyboardInterrupt로 강제중단을 재현한다. pending_runs에 나타나며 resume는 남은 2명만 조회한다. 기존 1명은 반복하지 않는다.
- persisted sending·네트워크 전송 결과 불명확·전송 후 로컬 기록 실패는 uncertain이다. resume와 resend=True에서도 전송 횟수가 늘지 않는다.
- 인증 실패/명단 기간 미설정은 외부 변경 0회. 최대 인원 limit는 test_mode에서만 허용한다. 시험 결과는 status=test이며 정상 월별 선택과 시트 갱신에서 제외한다. 시험 미리보기 수신자는 기존 시험 주소다.
- 독립 `python -I` 프로세스가 config.py 없이 기존 모듈·미리보기를 가져온다. config는 sys.modules에 생기지 않는다.

`npm test`: 기존 Node 7개 검증 파일 통과. HTML 재생성 완료. 프로젝트 준비 검사 failed=0이며 기존 SPEC_OPEN_QUESTIONS 경고가 남는다. `git diff --check` 통과.

대표 성공 사용 경로는 실제 service·HistoryStore·SheetPublisher·미리보기 생성기를 임시 사용자 폴더와 FakeAdapter로 실행하여 출력을 읽었다:

```text
{'status': 'completed', 'stage': 'completed', 'sheet_published': True, 'query_count': 1, 'legacy_count': 1, 'auto_mail_count': 0, 'preview_keys': ['overall', 'army:신']}
{'selected_delivery': {'overall': 'sent'}, 'selected_mail_count': 1}
```

외부 fake는 디모데·Sheets·Gmail 호출만 대체한다. JSON/CSV/SQLite·권한·OS 잠금은 로컬에서 실행한다.

## Task 5 API 계약

모든 UI 자료형은 `desktop.service`에서 가져온다. 다음 네 dataclass는 frozen이다. 리스트/사전 내용은 소비자가 고치지 않아야 한다.

```python
RunRequest(as_of: date | None = None, limit: int | None = None,
           test_mode: bool = False, resume_id: str | None = None)
ProgressEvent(stage: str, completed: int = 0, total: int = 0,
              message_code: str = '')
RunOutcome(run_id: str, status: str, as_of: date,
           results: list[dict] = [], summaries: list[dict] = [],
           stage: str = '', sheet_published: bool = False, error: str | None = None)
ReportPreview(key: str, title: str, recipients: tuple[str, ...], subject: str,
              text: str, html: str, enabled: bool, reason: str | None,
              status: str = 'pending', last_sent_at: str | None = None)
```

생성자의 [] 표기는 설명용이다. 실제 구현은 default_factory를 사용한다. RunRequest.as_of=None이면 Asia/Seoul 실행 당일, as_of=date면 사람이 선택한 날짜다. limit는 양의 정수이며 test_mode=False에서 설정하면 setup_required로 반환한다. resume_id가 있으면 run은 resume로 연결한다.

```python
service = SettlementService(adapter=None, secret_store=None)
service.run(request, settings, paths, on_progress, cancel) -> RunOutcome
service.resume(run_id, settings, paths, on_progress, cancel) -> RunOutcome
service.pending_runs(paths) -> list[dict]
service.preview_reports(run_id) -> list[ReportPreview]
service.send_selected(run_id, report_keys: list[str], resend=False) -> dict[str, str]
```

- 기본 adapter는 실제 ProductionAdapter지만 생성/가져오기만으로 인증·조회·외부 변경하지 않는다. secret_store 기본값은 인증 시 Mac SecretStore다. GUI는 worker에서 run/resume/send를 호출해야 한다. 브라우저 세션은 매 작업 finally에 닫힌다.
- preview/send에는 **run 또는 resume로 settings/paths를 연결한 같은 service instance**를 쓴다. 앱 재시작 후 이전 완료 결과는 resume(run_id,...)로 연결하면 외부 재조회 없이 즉시 반환한다. pending_runs는 읽기 전용이고 개인정보 없이 run_id/as_of/stage/status만 반환한다.
- module-level run/resume/preview_reports/send_selected 편의 함수는 동일한 기본 service instance를 사용한다. 주입 경계가 필요한 UI 시험은 SettlementService 객체를 사용한다.
- 결과 status: completed, test, cancelled, quality_failed, publication_failed, authentication_required, setup_required, busy, running. running은 중단된 조회이며 pending_runs의 복구 대상이다. completed는 sheet_published=True다. test는 시트 갱신 없이 완료한 시험이다. publication_failed는 스냅샷 보관 이후 시트 재시도 필요다.
- stage: lock/setup/authentication/roster/query/quality/publication/completed. progress message_code: authentication_check, reading_roster, query_progress, publishing_sheets, run_completed. 진행 이벤트는 이름·연락처·ID·예외 원문을 담지 않는다. error는 비밀 없는 일반 사용자 안내다.
- 결과 행은 기존 한글 필드와 recent4-v1 개인 지표를 유지한다. 정상 summaries는 HistoryStore 월별 선택·전월 차이이며 test summaries는 해당 시험의 army_metrics다. RuntimePaths.data_root가 HistoryStore root다.
- execution.json에는 실행 요청·원래 명단·완료 조회·단계·발송 상태가 사용자 runs_dir/run_id 아래 0600으로 남는다. 원본/메일 상태 자동 삭제는 없다. 중단된 조회는 이 원래 명단과 완료 결과로 이어간다. 새 실행은 새 UUID다.
- report key는 overall, army:신 등 기존 9군, 제외 그룹은 excluded:미배정/excluded:군 정보 검토다. UI는 key를 그대로 전달한다. 대상 군만 선택해도 전체 보고서를 자동 보내지 않는다.
- preview_reports는 콘텐츠·수신 범위·품질 제외 사유·마지막 성공 시각을 제공하며 같은 instance에 미리보기 확인을 남긴다. send_selected 자체는 이를 승인으로 만들지 않는다. 미리보기 없는 발송은 preview_required다. UI는 사용자의 발송 버튼에서만 send_selected를 호출한다.
- 발송 상태: pending/sending/sent/failed/uncertain. 반환에는 blocked/preview_required/authentication_required/busy도 있다. sent는 resend=False면 그대로 반환하며 전송 0회다. resend=True는 사용자가 마지막 발송일을 확인하고 선택한 재발송이다. uncertain은 이 옵션에서도 보내지 않는다.
- 네트워크 호출 전 sending을 비공개 저장한다. 성공 후 sent+UTC last_sent_at+provider_id를 저장한다. 저장 실패 또는 일반 provider 예외는 uncertain이다. 확정 거절만 DeliveryFailed로 failed를 만들 수 있다. 기본 Gmail adapter의 불명확 예외는 모두 uncertain으로 처리한다.
- preview/recovery는 OS lock이 비어 있을 때만 persisted sending을 uncertain으로 바꾼다. 잠금 중 preview는 BlockingIOError가 날 수 있으므로 UI는 실행 중 미리보기·발송 버튼을 막는다. run/resume/send는 잠금 경쟁을 busy로 반환한다.

## 명시적 설정·외부 adapter 계약

`get_google_credentials(paths=paths, settings=settings)`는 설정의 절대 client/token 위치를 쓴다. 인자 없는 CLI는 기존 PROJECT_DIR 기준 경로다. 앱 authenticate는 계정·키체인 암호가 준비되어 있고 Google 승인 및 디모데 로그인·프레임 연결이 완료된 다음에만 반환한다. 재시도에도 인증을 확인한다. 인증 오류 원문은 로그/화면으로 전달하지 않는다.

주입 adapter 메서드:

```python
authenticate(settings, paths, secret_store) -> None
load_rows() -> list[dict]
query_person(source_row, RunOptions) -> dict  # 정상 또는 확인 대상 한글 결과 + 지표
write_legacy(results, as_of) -> None
send(ReportPreview) -> str | None            # provider message ID
close() -> None
sheets                                     # Task 3 SheetPublisher adapter
```

ProductionAdapter는 기존 collect_results/inspect_person을 사용하며 명단 roster_start/end를 함께 주입한다. lookup는 read_sunday_attendance의 기간 확인을 유지한다. legacy 정착률은 별도 legacy stage로 기존 열·수식·서식을 유지한다. Task3의 current/monthly/care 완료 상태와 다른 단계다.

GoogleSheetsAdapter는 관리 세 탭 이외의 이름을 거절한다. createDeveloperMetadata는 metadataKey=newacts-owner, metadataValue=OWNER, location.sheetId, visibility=DOCUMENT를 쓴다. 헤더와 OWNER를 다시 확인하고 자동 본문만 쓰며 care는 A:C의 개별 RAW 셀만 쓴다. 실제 Google 권한/충돌/네트워크 확인은 아직 수행하지 않았다.

## 한계·프로토콜

실제 Windows·Finder·Chromium·키체인·운영 Sheets/Gmail 검증은 수행하지 않았다. Mac 잠금은 다른 컴퓨터를 막지 않는다. 기존 Windows 예약 실행과 운영 발송 상태는 운영 전환 전에 사람이 확인해야 한다. 조회/발송을 worker에서 실행하고 UI 버튼 상태를 연결하는 일은 Task 5다.

Task Observer: 시작 저장소 확인·frontmatter scan 16/16·malformed 0·checkpoint 기록·원칙/리뷰 날짜 확인을 수행했다. task-observer/test-driven-development 지목 OPEN 관찰 없음. 마지막 리뷰 2026-09-28이며 7일 미만. 기록 없음: 구현 결함과 시험 보완을 처리했고 별도 스킬 개선 신호가 없었다.

Akela registration slice의 data-effects/config-invariants/personal-data/local-tests를 적용 기록하고 outcome DONE으로 닫았다. 공유 akela/observer runtime 기록은 커밋하지 않는다. push 없음.
