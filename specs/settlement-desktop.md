# Mac 정착률 관리 앱 기능 사양

<!-- spec-feature: v2 -->

| 항목 | 값 |
|---|---|
| 상위 사양 | [SPEC.md](../SPEC.md) |
| 기능 ID | `settlement-desktop` |
| Document Version | 0.2.0 |
| Last Updated | 2026-11-02 |
| Status | implemented |

먼저 목적과 사용 순서를 읽고 필요한 요구사항을 찾는다.
공통 보안·데이터 보존 규칙은 상위 사양을 따른다.

## 1. 목적

군 담당자가 Mac 앱을 열어 새가족 출석 현황을 갱신하고, 월별 변화를 확인하며 연락 기록을 이어서 관리한다.
최초 인증 후에는 터미널 없이 실행하고, 결과를 확인한 뒤 메일 발송을 선택한다.

| 용어 | 뜻 |
|---|---|
| 누적 출석률 | 등록일 이후 출석한 주일 수를 대상 주일 수로 나눈 값 |
| 최근 3개월 | 조회일의 달력상 3개월 전 같은 날부터 조회일까지 |
| 정착률 | 최근 3개월에 1회 이상 출석한 새가족 수 ÷ 전체 새가족 수 |
| 퍼센트포인트 | 두 비율의 차이. 50%에서 60%가 되면 10퍼센트포인트 |

## 2. 범위

Apple Silicon Mac 앱, 실행·인증 화면, 군별 현황, 실행별 원본과 월별 이력, 돌봄 기록, 수동 메일 발송을 포함한다.
예약 실행, Intel Mac·Windows 실행파일, 새 메일 수신자, 연속 결석 자동 알림은 추가하지 않는다.
기존 Windows 실행과 REQ-RATE-001~003의 기존 경로는 유지한다.

## 5. 기능 요구사항

| 카테고리 | 이름 |
|---|---|
| RATEDESKTOP | Mac 실행과 군별 관리 |

### 요구사항 지도

앱 실행·인증(001) → 조회·출석 계산(002) → 이력 보관(003) → 군별 화면·돌봄 기록(004) → 메일 선택 발송(005).
중복 실행·취소·실패 복구는 006을 함께 따른다.

### REQ-RATEDESKTOP-001 더블클릭 실행과 최초 인증

#### 하는 일
`새가족 정착률.app`을 열면 진행 화면이 나타나고, 인증이 준비되어 있으면 전체 조회와 시트 갱신을 시작한다.
Python·Chromium을 앱에 포함하며 사용자가 매번 터미널을 열거나 패키지를 설치하지 않게 한다.

#### 순서
1. 최초 실행에서 Google 인증 파일 선택·승인과 디모데 로그인을 확인한다.
2. 설정된 앱은 실행 당일을 Asia/Seoul 기준일로 사용한다. 과거 기준일은 화면에서 선택한다.
3. 명단 읽기·출결 조회·계산·시트 갱신의 진행을 표시한다.
4. 완료 후 시트 열기·군별 현황·메일 미리보기를 제공한다.
5. 최초 설정에서 `1명 시험 조회`를 선택하면 인증 후 1명만 조회한다. 시트를 바꾸거나 메일을 보내지 않고 시험 이력으로 보관한다. 시험 완료 뒤 전체 조회는 사용자가 시작한다. 일반 설정 완료 후에는 전체 조회를 시작한다.

#### 지킬 것
인증·결과는 앱 외부 사용자 Application Support 폴더에 보관한다. 암호는 Mac 키체인에 보관한다.
앱 교체 후에도 설정과 이력을 유지한다. 인증 정보는 앱 빌드·Git·일반 로그에 넣지 않는다.

#### 안 될 때
인증 만료·네트워크 오류를 화면에 안내하고 다시 인증하거나 재시도할 수 있게 한다.
인증 완료 전에는 시트 변경과 메일 발송을 하지 않는다.

### REQ-RATEDESKTOP-002 같은 기간으로 출석 현황 계산

#### 하는 일
누적 출석률과 군별 최근 3개월 정착 현황·조회 완료율을 함께 보여준다. 현재 표시·집계는 REQ-RATEDESKTOP-008을 따른다.

#### 순서
1. 누적 출석률은 등록일부터 기준일까지의 주일을 분모로 사용한다. 최근 3개월 출석 횟수와 정착 판정은 REQ-RATEDESKTOP-008을 따른다.
2. 군별 출석률은 조회 완료자의 출석·대상 주일 합계로 계산한다.
3. 내부 과거 4주 지표는 이전 이력을 읽는 용도로만 유지한다. 현재 화면의 3개월 상태는 REQ-RATEDESKTOP-008을 따른다.
4. 누적 출석률에서는 조회 실패·동일인 미확정의 주일 수를 제외하고 미확인 인원을 표시한다. 정착률의 전체 인원 분모는 REQ-RATEDESKTOP-008을 따른다.
5. 군이 없으면 `미배정`, 지원하지 않는 군이면 `군 정보 검토`로 분류한다.

#### 지킬 것
출결 화면의 기간을 못 읽었으면 결석으로 채우지 않는다.
명시된 등록 연도를 우선 사용하고, 연도가 없는 날짜는 설정한 명단 기간으로 판단한다.
날짜가 하나로 정해지지 않으면 확인 대상으로 남긴다.

### REQ-RATEDESKTOP-003 실행별 원본과 월별 이력 보관

#### 하는 일
다시 실행해도 이전 원본을 보관하고, 월별 군 현황을 비교할 수 있게 한다.

#### 순서
1. 시각·실행 번호를 포함한 새 CSV와 SQLite 실행 기록을 보관한다.
2. 품질 검사를 통과한 결과만 정상 현황으로 선택한다.
3. 군·기준일의 월·산식 버전별로 마지막 정상 결과를 월별 표시값으로 사용한다.
4. 실행이 없는 달은 `미실행`, 전월이 없거나 산식이 다르면 비교값을 빈 값으로 표시한다.
5. 이전 군별 인원과 현재 인원 차이를 함께 표시하며 비율 차이는 퍼센트포인트로 표시한다.

#### 지킬 것
과거 결과는 당시 군·기준일·조회 시각을 유지한다. 이전 결과를 자동 삭제하지 않는다.
시험 결과는 운영 결과·메일 상태와 별도로 저장한다.

### REQ-RATEDESKTOP-004 군별 화면과 돌봄 기록 보존

#### 하는 일
`군별 정착 현황 v2`, `정착률 월별 이력 v2`, `새가족 돌봄 기록`에서 현황과 담당자 기록을 연결한다.
기존 `정착률`과 원본 명단의 이름·열 위치는 유지한다.

#### 순서
1. 군별 현황에 기준일·인원·조회 완료율·누적 출석률·정착률·최근 3개월 출석 횟수·전월 차이를 표시한다.
2. 돌봄 기록은 확정된 디모데 ID로 사람을 연결한다.
3. 담당자·연락일·진행 상태·다음 확인일·짧은 메모는 자동화가 덮어쓰지 않는다.
4. 군 이동은 같은 사람의 돌봄 기록을 이어가고, ID가 없거나 복수 일치하면 확인 대상으로 남긴다.

#### 안 될 때
같은 이름의 새 탭에 기존 내용이 있으면 내용을 확인하기 전 초기화하지 않는다.
군별 필터만으로 열람 권한이 분리된 것으로 취급하지 않는다.

### REQ-RATEDESKTOP-005 결과 확인 후 보고서 발송

#### 하는 일
사용자가 보고서와 기존 수신 범위를 확인하고 발송 버튼을 눌렀을 때만 메일을 보낸다.

#### 설정
전체 및 발송할 각 군의 조회 완료율은 0.95 이상이어야 한다. 미배정·군 정보 검토는 군별 운영 발송에서 제외한다.
전체 보고서는 요약을 유지하며 개인별 표는 기존 REQ-RATE-002를 따른다.

#### 순서
1. 전체·군별로 발송 대상과 제외 사유를 미리 보여준다.
2. 선택된 보고서별로 실행 번호와 발송 진행을 기록한다.
3. 일부 실패 시 확인된 성공 보고서는 다시 보내지 않는다.
4. 같은 결과를 다시 보내려면 마지막 발송일을 보여주고 사용자의 재발송 선택을 받는다.

#### 안 될 때
전송 결과가 불명확하거나 전송 후 기록에 실패하면 `발송 결과 검토`로 남기고 자동 재발송하지 않는다.
실제 Gmail 전송과 로컬 기록을 한 번에 확정할 수 있다고 가정하지 않는다.

### REQ-RATEDESKTOP-006 중복 실행과 중단 복구

#### 하는 일
동시에 실행하지 않고, 취소하거나 중단해도 이전 정상 현황과 담당자 기록을 보존한다.

#### 순서
1. 동일 Mac에 실행 중인 작업이 있으면 새 조회를 시작하지 않는다.
2. 취소 요청은 안전한 조회 경계에서 처리하고 취소 결과로 정상 현황을 갱신하지 않는다.
3. 다음 시작 때 중단된 실행을 표시하고 이어서 실행 또는 새 실행을 선택하게 한다.
4. 시트 일부 반영 시 같은 실행 번호로 남은 단계를 복구한다. 메일은 자동 재발송하지 않는다.

#### 지킬 것
Mac 잠금이 다른 컴퓨터까지 막는다고 가정하지 않는다.
운영 전환 시 기존 Windows 실행·발송 상태를 확인하며 Windows 예약 작업을 자동 변경하지 않는다.

### REQ-RATEDESKTOP-007 프로젝트 폴더에서 오늘 기준 실행

#### 하는 일
Mac에서 `오늘 정착률 실행.command`를 더블클릭하면 한국 날짜를 기준으로 전체 등록자의 출결을 조회하고 기존 `정착률` 탭을 갱신한다.

#### 순서
1. 프로젝트의 Python 실행 환경과 Chromium을 사용한다. 없으면 설치가 필요한 항목을 안내하고 멈춘다.
2. 인증 파일·실행 결과·잠금 파일은 `settlement-automation/local/`에 보관하며 Git에 넣지 않는다. 인증 파일은 소유자만 읽고 쓸 수 있게 한다.
3. Google Sheets 권한으로 인증한다. 디모데 암호는 기존 키체인 조회 도구가 직접 읽으며 로그인 실패는 다시 시도하지 않는다.
4. 기존 동일인 확인과 출결 계산을 사용한다. 등록일이 기준일 이후인 사람은 제외한다.
5. 전체 결과를 새 CSV에 보관한다. 등록 이후 대상 주일이 없는 사람은 `계산대상없음`으로 표시하고 조회 완료율의 분모에서 제외한다. 나머지 대상자의 조회 완료율이 95% 미만이면 시트를 갱신하지 않는다.
6. 정상 결과의 기존 결과 탭을 갱신하고 기준일·인원·출석 합계와 원본 명단 보존을 다시 읽어 확인한다. 메일은 보내지 않는다.

#### 안 될 때
다른 실행이 진행 중이면 시작하지 않는다. 오류 종류를 안내하고 종료하며 비밀값이나 개인 명단은 터미널에 출력하지 않는다.

### REQ-RATEDESKTOP-008 출석률과 최근 3개월 정착률 구분

#### 하는 일
새가족이 얼마나 꾸준히 출석했는지는 출석률로, 최근 3개월에 한 번이라도 출석했는지는 정착 여부로 구분한다.

#### 순서
1. 기존 등록 이후 주일 출석 비율의 표시 이름을 `출석률`로 바꾼다. 이 비율을 정착률이라고 표시하지 않는다.
2. 최근 3개월은 조회일에서 달력상 3개월 전 같은 날부터 조회일까지이며 양 끝 날짜를 포함한다. 같은 날이 없는 달은 그 달의 마지막 날을 쓴다. 개인 등록일 이전 출석은 제외한다.
3. 이 기간에 주일 출석이 1회 이상이면 `정착`이다. 출석이 없고 등록 후 3개월이 안 됐으면 `관찰 중`, 그 밖에는 `미정착`이다.
4. 정착률은 `정착 인원 ÷ 전체 새가족 인원`이다. 사용자의 최종 요청에 따라 관찰 중인 신규 등록자도 분모에 포함한다. 기준일 이후 등록자는 명단 집계에서 제외한다.
5. 개인별 `최근 4주` 표시는 `최근 3개월 출석 횟수`로 바꾼다. 전체·군별 화면과 보고서에는 정착 인원·관찰 중·미정착·미확인 인원과 출석률·정착률을 구분한다.
6. 조회 실패자는 미확인으로 남긴다. 전체 명단 분모는 유지하며, 미확인이 있으면 알려진 정착 인원 기준 잠정치라고 표시한다. 과거 합계만으로 최근 3개월 출석을 추정하지 않는다.
7. 새 산식 버전으로 이력을 구분하여 예전 산식과 전월 차이를 계산하지 않는다. 관리 시트의 기존 담당자 입력과 과거 이력은 보존하며 새 열 구성이 필요한 현황·이력은 새 버전 탭을 사용한다.

### REQ-RATEDESKTOP-009 청년 우선 조회와 교인 전체 재검색

#### 하는 일
교인구분의 청년 범위에서 찾지 못한 새가족을 교인 전체에서 한 번 더 찾는다.

#### 순서
1. 각 사람의 조회 시작 시 교인구분 첫 선택은 `교인`, 두 번째 선택은 `청년`으로 설정한다.
2. 기존 전화번호·이름 조회와 동일인 판정을 먼저 수행한다.
3. 일치하는 사람을 찾지 못한 경우에만 첫 선택 `교인`을 유지하고 두 번째 선택을 빈 값으로 바꾼다. 같은 전화번호·이름 조회와 동일인 판정을 다시 수행한다.
4. 여러 사람이 일치하면 임의로 한 사람을 고르지 않는다. 다른 사람 조회를 시작할 때는 다시 `청년`으로 되돌린다.
5. 검색 범위 변경이 실패하면 미확인 상태로 남긴다. 디모데 교적·출결은 수정하지 않는다.

## 11. 테스트 사양

각 테스트는 비밀 없는 가짜 설정·명단·외부 서비스로 자동 검증한다.
Mac 앱과 운영 데이터 확인은 자동 테스트 뒤 승인된 범위에서 별도로 수행한다.

### TEST-RATEDESKTOP-001 앱 실행과 인증

최초 설정·인증 만료·설정 완료·앱 교체를 시험한다. 미인증 상태는 외부 변경 0회,
인증된 상태는 작업 1회, 메일 발송 0회인지 확인한다. 무효·깨진·정상 토큰의 명시적 재승인과 일시적 갱신 실패 안내를 구분한다.
최초 설정의 1명 시험 조회는 실제 실행 서비스와 가짜 외부 연결로 시험한다. 조회 1명·시트 변경 0회·메일 0회·별도 시험 이력·후속 전체 조회 없음인지 확인한다. Finder에서 앱을 열어 화면과 Chromium을 확인한다.

### TEST-RATEDESKTOP-002 출석 계산 경계

같은 기준일의 0주·1주·4주, 연말 날짜, 조회 실패·미배정 입력을 검사한다.
조회 실패는 분자·분모에서 제외하고, 모호한 날짜는 확인 대상이어야 한다.

### TEST-RATEDESKTOP-003 이력 보존

같은 월 재실행·다른 기준일·산식 변경·군 이동·미실행 월을 입력한다.
모든 원본이 남고 마지막 정상 결과만 선택되며, 비교 불가 상태에는 차이를 표시하지 않아야 한다.

### TEST-RATEDESKTOP-004 담당자 기록 보존

군 이동·동명이인·ID 없음과 수동 메모를 넣고 두 번 갱신한다.
확정 ID만 연결되고 수동 입력·기존 탭 내용·원본 명단이 보존되어야 한다.

### TEST-RATEDESKTOP-005 발송 품질과 일부 실패

전체 및 군별 94/100·95/100 조회 완료율, 일부 전송 실패·전송 후 기록 실패를 검사한다.
기준 미달 보고서는 발송하지 않고, 확인된 성공 또는 결과 불명확 보고서는 자동으로 다시 보내지 않아야 한다.

### TEST-RATEDESKTOP-006 중단 복구

두 프로세스 실행·취소·앱 강제 종료·시트 부분 실패를 재현한다.
두 번째 작업은 변경하지 않고, 이전 정상 결과와 담당자 기록이 보존되며 미완료 단계만 복구되어야 한다.

## 12. 요구사항 추적성

아래 자동 검증은 가짜 외부 서비스로 계산·이력·화면·복구 경계를 확인한다.
운영 인증, 실제 시트 갱신과 메일 도착은 별도 확인이 필요하다.

| Requirement | Implementation | Test | Status |
|---|---|---|---|
| REQ-RATEDESKTOP-001 | `settlement-automation/desktop/runtime.py`, `settlement-automation/desktop/settings.py`, `settlement-automation/settlement_automation.py`, `settlement-automation/desktop/window.py`, `settlement-automation/desktop_app.py`, `settlement-automation/build_mac.sh`, `settlement-automation/settlement-mac.spec` | `settlement-automation/tests/test_desktop_bundle.py`, `settlement-automation/tests/test_desktop_runtime.py`, `settlement-automation/tests/test_desktop_final_fixes.py`, `settlement-automation/tests/test_desktop_window.py`, TEST-RATEDESKTOP-001 | verified |
| REQ-RATEDESKTOP-002 | `settlement-automation/desktop/metrics.py`, `settlement-automation/desktop/service.py`, `settlement-automation/settlement_automation.py` | `settlement-automation/tests/test_desktop_metrics.py`, `settlement-automation/tests/test_desktop_final_fixes.py`, TEST-RATEDESKTOP-002 | verified |
| REQ-RATEDESKTOP-003 | `settlement-automation/desktop/history.py`, `settlement-automation/desktop/window.py` | `settlement-automation/tests/test_desktop_history.py`, `settlement-automation/tests/test_desktop_final_fixes.py`, `settlement-automation/tests/test_desktop_window.py`, TEST-RATEDESKTOP-003 | verified |
| REQ-RATEDESKTOP-004 | `settlement-automation/desktop/sheets.py`, `settlement-automation/desktop/window.py` | `settlement-automation/tests/test_desktop_sheets.py`, `settlement-automation/tests/test_desktop_window.py`, TEST-RATEDESKTOP-004 | verified |
| REQ-RATEDESKTOP-005 | `settlement-automation/desktop/service.py`, `settlement-automation/desktop/adapters.py`, `settlement-automation/settlement_email.py` | `settlement-automation/tests/test_desktop_service.py`, `settlement-automation/tests/test_desktop_window.py`, TEST-RATEDESKTOP-005 | verified |
| REQ-RATEDESKTOP-006 | `settlement-automation/desktop/service.py`, `settlement-automation/desktop/adapters.py`, `settlement-automation/desktop/errors.py` | `settlement-automation/tests/test_desktop_final_fixes.py`, `settlement-automation/tests/test_desktop_service.py`, `settlement-automation/tests/test_desktop_window.py`, TEST-RATEDESKTOP-006 | verified |

| REQ-RATEDESKTOP-007 | `settlement-automation/local_run.py`, `settlement-automation/오늘 정착률 실행.command` | `settlement-automation/tests/test_local_run.py` | implemented |

| REQ-RATEDESKTOP-008 | `settlement-automation/desktop/metrics.py`, `settlement-automation/settlement_automation.py`, `settlement-automation/settlement_email.py`, `settlement-automation/desktop/window.py`, `settlement-automation/desktop/sheets.py`, `settlement-automation/desktop/history.py`, `settlement-automation/local_run.py` | `settlement-automation/tests/test_settlement_definition.py`, `settlement-automation/tests/test_settlement_views.py`, `settlement-automation/tests/test_definition_compat.py` | verified |

| REQ-RATEDESKTOP-009 | `settlement-automation/desktop/search.py`, `settlement-automation/settlement_automation.py` | `settlement-automation/tests/test_search_scope.py` | verified |
