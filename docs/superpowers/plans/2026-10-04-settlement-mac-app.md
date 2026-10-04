# Mac 정착률 관리 앱 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 최초 인증 후 Mac 앱 더블클릭으로 새가족 출석을 조회하고 군별 현황·월별 이력·돌봄 기록을 관리한다.

**Architecture:** 기존 Python 조회·계산과 HTML 보고서를 재사용한다. 실행 제어·사용자 데이터 저장·화면을 나누고 PySide6 화면에서 작업 진행 이벤트를 받는다. Python과 Chromium을 포함한 Apple Silicon `.app`으로 만든다.

**Tech Stack:** Python, 기존 Playwright·Google API, SQLite, Mac 키체인(keyring), PySide6, PyInstaller.

**Spec:** [승인된 설계](../specs/2026-10-04-settlement-mac-design.md), [정식 기능 사양](../../../specs/settlement-desktop.md), [공통 SPEC](../../../SPEC.md).

## Global Constraints

- REQ-RATEDESKTOP-001~006이 구현 범위다. 현재 상태는 모두 `draft`다.
- Apple Silicon Mac만 1차 지원한다. 예약 작업·Intel Mac·Windows 실행파일은 추가하지 않는다.
- 기준일은 Asia/Seoul의 실행 당일이다. 과거 기준일은 사람이 선택한다.
- 앱 실행은 조회·시트 갱신 요청이다. 메일 발송은 미리보기 후 별도 선택이며 자동 발송하지 않는다.
- 전체와 발송할 각 군의 조회 완료율은 `0.95` 이상이어야 한다.
- 최근 4주는 공통 기준일까지 지난 일요일 4개이며 등록일 이후 날짜만 분모에 넣는다.
- 기존 시트 ID·이름·열 위치·운영 수신자·Windows CLI와 월간 옵션을 보존한다.
- 원본 명단·디모데 출결·담당자 수동 기록을 자동 수정하지 않는다. 이력 자동 삭제는 없다.
- 암호는 Mac 키체인, 토큰·이력은 사용자 Application Support, 개인정보 없는 로그는 Library/Logs에 둔다.
- 인증·명단·실행 결과는 앱 빌드와 Git에 포함하지 않는다.
- 실제 시트 변경·메일은 사용자 승인 범위에서만 검증한다. 앱 빌드는 운영 실행을 뜻하지 않는다.

## Review Focus

- 앱 교체·설치 경로 이동: 외부 데이터와 인증이 보존되는지 Task 1·6에서 검사한다.
- 등록일 12월·연도 없음: 여러 날짜로 해석되면 확인 대상으로 남기는지 Task 2에서 검사한다.
- 동명이인·군 이동·ID 없음: 수동 메모가 다른 사람에게 연결되지 않는지 Task 3에서 검사한다.
- 전송 결과 불명확·전송 후 기록 실패: 재실행에서 자동으로 다시 발송하지 않는지 Task 4에서 검사한다.
- UI 종료·두 프로세스·조회 중 취소: 이전 정상 결과 보존과 잠금 복구를 Task 4·5에서 검사한다.

## 사전 확인·재사용·검증 규칙

읽은 근거: 프로젝트와 공통 AGENTS, Akela slice, SPEC의 REQ-RATE-001~003 및 NFR-SEC-001·NFR-DATA-001,
기존 `settlement-automation/` Python 파일·테스트, `scripts/run-tests.mjs`, `botyard.json`.

워크스페이스 `projects/`·`tools/`에서 desktop·mac·pyinstaller·keychain 파일명을 검색했다.
재사용할 Mac 앱 포장·인증 화면은 발견하지 못했다. 프로젝트 Python 파일 목록을 별도로 확인했다.
전체 워크스페이스에 다른 구현이 없다는 결론은 내리지 않는다.

재사용: 동일인 검색·출결 읽기·기존 누적 계산·시트 형식·군별 수신 범위·HTML 보고서.
새 구현: 앱 화면, 외부 데이터 경로, 실행 이력, 최근 4주 집계, 돌봄 연결, 단계별 복구, 앱 빌드.
기존 마지막 화요일 판정은 CLI에 유지한다. 수동 앱에는 새 사양을 적용한다.
기존 RATE 요구사항을 바꿔 앱의 수동 실행을 정당화하지 않는다.

새 명령은 아래 작업에서 만들 예정이다. 현재 동작한다고 안내하지 않는다.
각 테스트는 먼저 실패 이유를 읽고 수정 후 통과를 확인한다. 태스크별 로컬 커밋 뒤 최종 게이트를 통과하면 push한다.
최종 필수 검사: `npm test`, Python 검증, `node .project-check/project-readiness.js .`, 워크스페이스 검사.
공통·프로젝트 지침대로 변경 문서와 HTML을 함께 커밋하며 force push·remote 변경·rebase는 하지 않는다.

## 파일과 공통 자료형

새 모듈은 `settlement-automation/desktop/`에 둔다. 기존 CLI를 얇은 호출 경로로 유지한다.

| 파일 | 책임 |
|---|---|
| `desktop/runtime.py`, `desktop/settings.py` | 앱 자원·데이터 경로, 비밀 없는 설정, 키체인과 OAuth 위치 |
| `desktop/metrics.py` | 최근 4주·군별 요약·날짜 해석 |
| `desktop/history.py` | SQLite 실행·월별 선택값·보고서 발송 상태와 CSV 원본 |
| `desktop/sheets.py` | 새 탭 집계·돌봄 ID 연결·수동 열 보존 |
| `desktop/service.py` | 실행 단계·중복 잠금·취소·복구·발송 작업 |
| `desktop/window.py`, `desktop_app.py` | 설정과 진행 화면·미리보기·앱 실행 입구 |
| `settlement-mac.spec`, `build_mac.sh`, `requirements-mac.in`, 잠금 파일 | 앱 묶음 빌드와 검증한 의존성 버전 |
| `tests/run_tests.py`, `tests/test_desktop_*.py` | 비밀 없는 테스트 실행과 기능별 검증 |

`MemberResult`는 기존 CSV의 한 사람 결과 사전이다. 기존 열 이름을 유지하고 앱용 출결 날짜 자료는 별도로 전달한다.
`RunRequest`는 기준일·시험 여부·최대 인원·이어서 실행할 번호를 담는 불변 자료형이다.
`RunOutcome`은 실행 번호·단계·조회 결과·요약·시트 반영 여부를 담는다.
`ProgressEvent`는 단계·완료 수·전체 수·사용자 안내 코드다. 개인정보를 이벤트 로그에 넣지 않는다.
위 세 자료형은 `desktop/service.py`가 정의하고 화면과 테스트가 같은 정의를 사용한다.

### Task 1: 외부 설정·인증과 테스트 실행 기반

**Files:** Create `desktop/__init__.py`, `desktop/runtime.py`, `desktop/settings.py`, `tests/run_tests.py`, `tests/test_desktop_runtime.py`; Modify 기존 인증 함수·`requirements-mac.in`.

**Interfaces:** `RuntimePaths.for_user(home: Path) -> RuntimePaths`, `load_settings(paths: RuntimePaths) -> AppSettings`,
`save_settings(paths: RuntimePaths, settings: AppSettings) -> None`, `SecretStore.get_password(account: str) -> str | None`,
`SecretStore.set_password(account: str, password: str) -> None`.
`AppSettings`는 기존 비밀 없는 시트·군 설정, OAuth 파일 위치, 명단 날짜 범위를 담는다.

- [ ] 실패 테스트: `test_app_replacement_preserves_user_data`는 앱 경로만 바꿔도 데이터 경로가 같음을 확인한다.
  `test_password_never_enters_settings_or_logs`는 설정 JSON과 로그에 시험 암호가 없음을 확인한다.
  `test_missing_config_uses_safe_test_bootstrap`는 실제 `config.py` 없이 기존 테스트를 실행할 수 있어야 한다.

```python
# test_app_replacement_preserves_user_data
assert first_launch.paths.data_root == replaced_app.paths.data_root
# test_password_never_enters_settings_or_logs
assert secret not in settings_json + diagnostic_log
```
- [ ] `python3 -B settlement-automation/tests/run_tests.py`를 실행하고 신규 모듈·계약 부재로 실패하는지 읽는다.
- [ ] 경로·설정·키체인 경계를 구현한다. 권한은 디렉터리 `0700`, 인증·데이터 파일 `0600`을 사용한다.
  기존 `config.example.py`의 비밀 없는 값만 재사용한다. 설정되지 않은 계정을 실제 로그인으로 시험하지 않는다.
- [ ] 같은 명령으로 기존 5개 테스트와 신규 경로·설정 테스트를 통과시킨다. 명령은 생략된 테스트가 없을 때만 성공한다.
- [ ] 이 태스크 파일과 연결된 SPEC 상태·진행 기록만 커밋한다.

### Task 2: 기간을 통일한 군별 출석 지표

**Files:** Create `desktop/metrics.py`, `tests/test_desktop_metrics.py`; Modify `settlement_automation.py`의 출결 읽기·계산 연결.

**Interfaces:** `recent_sundays(as_of: date) -> tuple[date, ...]`,
`member_metrics(registration: date, attendance: dict[date, bool], as_of: date) -> dict`,
`army_metrics(results: list[dict]) -> list[dict]`,
`resolve_registration_date(value: str, period_start: date, period_end: date) -> date`.
출결 기간 확인 실패는 예외로 전달한다. 기존 CLI의 기본 날짜 해석은 변경하지 않고 앱에 명단 기간을 주입한다.

- [ ] 실패 테스트 `test_recent_window_uses_registration_boundary`:
  기준일 `2026-10-04`, 등록일 `2026-09-20`, 출석 `09-20·10-04`이면 최근 분모 `3`, 분자 `2`, 비율 `2/3`이다.
  `test_unqueried_member_is_not_absent`는 실패자를 군 분자·분모에서 제외하고 완료율에 반영한다.
  `test_ambiguous_december_requires_review`는 명단 기간 안에 가능한 12월 날짜가 두 개면 확정하지 않는다.

```python
# test_recent_window_uses_registration_boundary
assert result["recent_possible"] == 3
assert result["recent_attended"] == 2
assert result["recent_rate"] == 2 / 3
```
- [ ] 공통 Python 검증을 실행하고 해당 assertion 또는 새 인터페이스 부재로 실패하는지 확인한다.
- [ ] 함수를 구현한다. 분모 0은 `None`, 대상 주일 4개 미만은 관찰 기간 부족으로 분류한다.
  군 없는 입력과 알 수 없는 군의 분류를 각각 검사한다.
- [ ] 공통 Python 검증 PASS 및 기존 누적 비율 동일 여부를 확인한다.
- [ ] 계산 변경과 테스트·추적성을 커밋한다.

### Task 3: 실행 원본·월별 현황과 돌봄 기록

**Files:** Create `desktop/history.py`, `desktop/sheets.py`, `tests/test_desktop_history.py`, `tests/test_desktop_sheets.py`.

**Interfaces:** `HistoryStore(root: Path)`, `save_snapshot(run_id: str, as_of: date, results: list[dict], version: str, status: str) -> Path`,
`monthly_summary(month: str, version: str) -> list[dict]`,
`SheetPublisher.publish(run_id: str, results: list[dict], summaries: list[dict]) -> dict`.
이력 저장소는 원본 CSV를 보존하고 SQLite 작업 단위로 진행을 기록한다. 기존 결과 사전과 SPEC의 새 탭 이름을 그대로 사용한다.

- [ ] 실패 테스트 `test_failed_rerun_keeps_previous_month_selection`는 정상 실행 후 실패 결과가 월별 선택값을 바꾸지 않음을 확인한다.
  `test_move_keeps_care_note_for_same_id`는 군 이동 뒤 확정 ID의 메모가 보존됨을 확인한다.
  `test_same_name_different_id_does_not_merge`는 동명이인의 기록이 합쳐지지 않음을 확인한다.
  `test_existing_unowned_tab_is_not_cleared`는 소유 구조를 확인하지 못한 탭에 변경 0회를 확인한다.

```python
# test_move_keeps_care_note_for_same_id
assert care_after[person_id]["메모"] == care_before[person_id]["메모"]
# test_existing_unowned_tab_is_not_cleared
assert foreign_sheet.write_calls == []
```
- [ ] 공통 Python 검증을 실행하고 이력·시트 경계 계약이 없어 실패하는지 확인한다.
- [ ] 실행별 파일 저장과 SQLite 기록, 월별 마지막 정상 선택을 구현한다. 산식 버전은 `recent4-v1`로 시작한다.
  새 탭 헤더와 자동 소유 열을 확인한다. 돌봄 탭에서는 확정 ID·자동 기본 정보만 추가하고 담당자 열은 쓰지 않는다.
- [ ] 재실행 전후 수동 셀·원본 탭을 비교하는 가짜 Sheets 검증을 통과시킨다.
  실행 없는 월과 산식 다른 전월은 비교값이 `None`이어야 한다.
- [ ] 이력·시트 변경과 테스트·추적성을 커밋한다.

### Task 4: 실행 제어·취소·복구·선택 발송

**Files:** Create `desktop/service.py`, `tests/test_desktop_service.py`; Modify `settlement_automation.py`, `settlement_email.py`의 명시적 설정·서비스 연결.

**Interfaces:** `run(request: RunRequest, settings: AppSettings, paths: RuntimePaths, on_progress: Callable[[ProgressEvent], None], cancel: Event) -> RunOutcome`,
`resume(run_id: str, settings: AppSettings, paths: RuntimePaths, on_progress: Callable, cancel: Event) -> RunOutcome`,
`send_selected(run_id: str, report_keys: list[str], resend: bool = False) -> dict[str, str]`.
외부 읽기·시트·메일과 키체인은 주입 가능한 경계로 두고 기존 CLI 함수는 호환 경로로 유지한다.

- [ ] 실패 테스트 `test_run_never_sends_email`는 정상 조회·갱신 후 메일 호출 0회를 확인한다.
  `test_cancel_preserves_previous_success`와 `test_second_process_cannot_write`는 이전 정상 선택값과 변경 0회를 확인한다.
  `test_94_percent_army_is_blocked_95_is_allowed`는 경계값을 검사한다.
  `test_uncertain_delivery_is_not_retried`는 전송 결과 불명확 상태에서 두 번째 발송 호출 0회를 확인한다.

```python
# test_run_never_sends_email
assert gmail.send_calls == []
# test_94_percent_army_is_blocked_95_is_allowed
assert report_states["94-percent"] == "blocked"
assert report_states["95-percent"] == "sent"
# test_uncertain_delivery_is_not_retried
assert attempts_after_resume == attempts_before_resume
```
- [ ] 공통 Python 검증을 실행하고 위 경계에서 실패를 확인한다.
- [ ] 사람별 조회 경계에서 취소하고 완료 결과만 품질 검사·보관·시트 반영한다.
  시트 반영 단계와 보고서별 `pending/sending/sent/failed/uncertain` 상태를 기록한다.
  전송 전 `sending`을 저장하고 중단된 `sending`은 `uncertain`으로 취급한다.
  실행 프로세스 종료에 풀리는 OS 잠금을 사용한다. PID 파일 존재만으로 실행 중임을 판단하지 않는다.
- [ ] 시트 부분 실패 후 같은 실행 번호의 미완료 단계만 재실행하는 검증을 통과시킨다.
  기존 CLI 옵션·월간 판정·수신 범위도 회귀 검증한다.
- [ ] 제어·발송 변경과 테스트·추적성을 커밋한다.

### Task 5: 최초 설정과 진행 화면

**Files:** Create `desktop/window.py`, `desktop_app.py`, `tests/test_desktop_window.py`.

**Interfaces:** `MainWindow(settings: AppSettings | None, paths: RuntimePaths, service_factory: Callable)`,
`show_progress(event: ProgressEvent) -> None`, `show_outcome(outcome: RunOutcome) -> None`, `main() -> int`.
Task 4의 자료형을 가져오고 다른 형태로 재정의하지 않는다. 화면은 Qt 작업 스레드와 신호를 사용한다.

- [ ] 실패 테스트 `test_unconfigured_launch_does_not_start_run`과 `test_configured_launch_starts_once`에서 호출 0·1회를 확인한다.
  `test_close_requests_cancel_without_freezing`은 취소 이벤트와 화면 응답을 확인한다.
  `test_send_button_requires_preview`는 미리보기 전 발송 호출 0회를 확인한다.

```python
# test_unconfigured_launch_does_not_start_run
assert service.run_calls == 0
# test_configured_launch_starts_once
assert service.run_calls == 1
assert service.mail_calls == 0
```
- [ ] Qt offscreen 환경에서 공통 Python 검증을 실행해 신규 화면 계약의 실패를 확인한다.
- [ ] Google 파일 선택·OAuth 승인·키체인 저장·명단 기간 설정과 인증 만료 재설정을 구현한다.
  진행·중단 복구·완료 화면, 시트 열기·군별 현황·메일 미리보기·선택 발송을 구현한다.
- [ ] 가짜 서비스로 화면을 실제 열어 설정·취소·오류·완료를 확인한다. 비밀이나 운영 명단을 넣지 않는다.
- [ ] 화면과 테스트·추적성을 커밋한다.

### Task 6: Mac 앱 빌드·배치·완료 검증

**Files:** Create `settlement-mac.spec`, `build_mac.sh`, 의존성 잠금 파일; Modify `requirements-mac.in`,
`botyard.json`, `settlement-automation/README.md`, `README.md`, SPEC 추적성, `CHANGELOG.md`, `progress.md`.

**Interfaces:** `build_mac.sh`는 arm64 `.app`을 dist 아래 만들고 경로를 출력한다.
`desktop_app.py --self-test`는 실제 번들 경로·SQLite·Chromium 시작/종료·가짜 작업을 검사하고 네트워크 서비스와 메일을 호출하지 않는다.
이 옵션은 제품 화면에 넣지 않는다.

- [ ] 실패 검증: Chromium을 빠뜨린 시험 번들은 자체 검사에서 실패해야 한다.
  인증 파일을 넣은 시험 빌드 입력은 배포 전 포함 파일 검사에서 차단되어야 한다.

```python
# test_bundle_without_chromium_fails_preflight
assert missing_browser_probe.returncode != 0
# test_bundle_input_with_credentials_is_refused
assert contaminated_input_check.returncode != 0
```
- [ ] 격리된 가상환경에서 현재 Mac의 의존성 호환성을 확인해 버전을 잠근다.
  PyInstaller 폴더형 `.app`에 Python·PySide6·Chromium을 포함하고 비밀 파일은 제외한다.
- [ ] 실제 번들의 자체 검사를 실행하고, Finder에서 앱을 열어 설정 화면·브라우저·오류 안내를 확인한다.
  앱 위치를 옮기고 다시 열어 설정·이력이 보존되는지 확인한다. 아직 앱이 준비되어 있지 않으면 조회를 시작하지 않는다.
- [ ] 새 Python·UI 검증을 `botyard.json` 게이트에 추가한다. 설치되지 않은 의존성을 이유로 성공 처리하지 않는다.
  `npm test`와 Python 검증, 준비·워크스페이스 검사 출력 및 종료 코드를 모두 읽는다.
- [ ] 사용 안내와 실제 실행 결과를 갱신한다. `node .project-check/render-spec-html.js .`로 HTML을 생성하고 준비 검사를 다시 통과시킨다.
  구현과 자동 검증에 맞게 `draft` 상태를 갱신한다. 인증·운영 시트·메일 도착 미확인은 progress에 남긴다.
- [ ] 사용자 Applications 폴더에 앱을 배치하고 다시 읽는다. 배치만으로 운영 조회나 메일을 실행하지 않는다.
  관련 파일만 커밋하고 프로젝트 remote에 push한다. 개인정보·런타임 결과·다른 세션 변경은 포함하지 않는다.

## 실행 전 확인과 미완료 보고 기준

이 계획의 명령과 파일은 구현 예정이며 현재 존재하지 않는 항목이 있다.
현재 설계 승인만 받은 상태다. 작성된 계획 검토와 실행 방식 선택 뒤 구현을 시작한다.

실제 Google·디모데 인증과 기존 Windows 상태 확인이 없으면 앱 패키지·가짜 작업 검증까지 완료할 수 있다.
시트 쓰기·메일 도착은 각각 승인 범위에서 실행하고 결과를 다시 읽어야 운영 완료로 보고한다.
인증 정보 부족을 이유로 화면·계산·패키징 작업까지 멈추지 않는다.
