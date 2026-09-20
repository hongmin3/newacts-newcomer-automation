# 뉴액츠 새가족·교육 통합 자동화

뉴액츠 새가족 등록, 교육 출석, 집중교육 신청, 수료 현황, 문자공지 명단을 관리하는 Google Apps Script 소스 저장소입니다. 네 개의 Apps Script 프로젝트가 서로 다른 Google Workspace 파일을 연결해 사용합니다.

저장소와 운영 Apps Script는 `scripts/apps-script.mjs`로 직접 비교·반영합니다. `npm run diff`가 "모든 프로젝트가 운영과 동일합니다"를 출력하면 저장소 코드가 곧 운영 코드입니다.

```bash
npm test          # 로컬 정적·단위 검증 5종
npm run diff      # 운영 ↔ 저장소 차이 확인
npm run push      # 저장소 코드를 운영에 반영
```

## 한눈에 보는 자동화

| 자동화 | 실행 함수 | 일정/방식 | 주요 기능 | 코드 위치 |
|---|---|---|---|---|
| 교육 출석 입력 웹앱 | `doGet`, `searchUser`, `submitAttendance` | 웹앱에서 수시 실행 | 이름·전화번호 확인 후 교육 주차 출석 응답을 시트 **2행에 최신순으로** 저장 | `attendance-webapp/` |
| 등록 명단 유지관리 | `runAllAutomationTrigger` → `runRegistrationMaintenanceTrigger` | 매주 월요일 08:00~09:00 | 교육 출석 기준 등록정보 자동 보정, 군 현황판 갱신, 결과 메일 | `registration-project/등록새가족-군현황 자동 배치.gs` |
| 교육 수료현황·주간 메일 | `runSystem` → `runRegistrationReportingTrigger` | 매주 금요일 11:00~12:00 | 등록 명단과 교육 출석 결합, 수료현황 재작성, 전체·군별 주간 메일 | `registration-project/등록 새가족 새가족교육 수료현황 자동화.gs` |
| 교육 출석 반영 | `main` → `processPendingAttendanceTrigger` | 매주 화요일 17:00~18:00 | 새 설문 응답을 **타임스탬프 커서** 기준으로 증분 반영하고 상세 결과 메일 | `education-project/교육 출석 현황 업데이트.gs` |
| 교육 문자공지 명단 | `sendNewcomerNotifications` → `sendNewcomerNotificationsTrigger` | 매주 토요일 08:00~09:00 | 교육 진행 중·미진행 명단과 문자 발송용 번호를 메일로 전송 | `education-project/문자 명단 리스트.gs` |
| 집중교육 신청 접수 | `onFormSubmitHandler` | Form 제출 즉시 | 군→팀 분기 신청, 전화번호 정규화, 관리자·공개 명단 동기화 | `intensive-training-application/` |
| 집중교육 출석 반영 | `syncIntensiveTraining` | 필요할 때 수동 실행 | `26년 집중교육` 참석자를 일반 교육 출석 현황에 반영 | `education-project/집중교육 출석 현황 업데이트.gs` |
| 상반기 결산 생성 | `generateSettlementReport` | 필요할 때 수동 실행 | 등록 자료를 기준으로 상반기 결산 집계표 갱신 | `registration-project/제목 없음.gs` |

트리거 시간은 Apps Script가 지정 시간대 안에서 선택해 실행하므로 정확히 정각에 시작되지 않을 수 있습니다. 확인 당시 트리거 상세는 [`docs/current-triggers.md`](docs/current-triggers.md)에 있습니다.

### 현재 중지된 기능

- **상반기 방문 새가족 동기화**: `syncRegisteredToVisited_`가 의도적으로 비활성입니다. 하반기 시트를 준비한 뒤 다시 켜야 합니다. 시트 메뉴의 "방문자 명단만 동기화"를 눌러도 안내만 표시됩니다.

## 프로젝트와 데이터 흐름

```text
출석 웹앱
  └─ 2026년 새가족교육 출석 (응답) / 설문지 응답 시트1   ← 최신 응답이 2행
       │  화·금: 교육 출석 증분 반영 (타임스탬프 커서)
       ▼
뉴액츠 새가족부 교육관리
  ├─ 교육 출석 현황   ← 최근 활동순 정렬
  ├─ 26년 집중교육
  └─ 자동화 로그 (숨김)
       │  금: 등록 명단과 결합
       ▼
2026년 뉴액츠 청년부 등록 새가족 현황
  ├─ 등록 새가족       ← 월: 교육 출석 기준 자동 보정
  ├─ 등록 새가족 군 현황   (14열 · 1~2행 머리글 / 3행 합계 / 4행부터 명단)
  ├─ 상반기 방문 새가족 (동기화 중지)
  ├─ 새가족교육 수료현황
  ├─ 상반기 결산
  ├─ 자동화 로그 (숨김)
  └─ 수료 자동화 로그 (숨김)

토요일 문자공지 명단
  ├─ 교육 출석 현황에서 교육 진행 중 대상 조회
  └─ 새가족교육 수료현황에서 교육 미진행 대상 조회
       └─ 운영 수신자 5명에게 메일 발송
```

연결 구조와 데이터 기준에 관한 추가 설명은 [`docs/current-architecture.md`](docs/current-architecture.md), 안전장치와 처리 규칙은 [`docs/enhanced-architecture.md`](docs/enhanced-architecture.md)를 참고하세요.

집중교육 신청 Form 제출이 완료되면 신청자 현황은 [공개 확인 시트](https://docs.google.com/spreadsheets/d/1dZbp9oHvcWEuWrDhATK3obLC_8rUb_M1jzH9UC8tOM0/edit)에서 확인하면 됩니다. 공개 명단에는 전화번호가 포함되지 않습니다.

## 디렉터리 안내

### `attendance-webapp/`

- `Code.gs`: 웹앱 화면 제공, 사용자 검색, 입력값 검증, 출석 응답 저장
- `Index.html`: 이름·전화번호 검색과 주차 선택 화면
- `appsscript.json`: 시간대, 웹앱 접근 권한(`ANYONE_ANONYMOUS`, `USER_DEPLOYING`)
- 연결 대상: `2026년 새가족교육 출석 (응답)`
- 스크립트 ID: `1JPi6GfNS1UR_iWic0h9yZRr-NhEYnxAV_l-YM7_huZwVceBhnDX7m5s6`

웹앱은 이름과 전화번호를 함께 확인하고, 1~4주차만 허용하며, 직전 주차 다음 주차만 접수합니다. 신규 응답은 `insertAttendanceNewestFirst_`가 **헤더 바로 아래 2행에 삽입**합니다. 기존 응답을 한 번에 최신순으로 정렬하려면 `sortAttendanceSourceNewestFirst`를 1회 실행합니다.

웹앱은 버전 고정 배포이므로 코드만 반영해서는 사용자 화면이 바뀌지 않습니다. `npm run deploy` 대신 아래 명령으로 새 버전을 만들고 기존 URL에 연결합니다.

```bash
node scripts/apps-script.mjs deploy attendance-webapp --description "변경 요약"
```

### `education-project/`

- `교육 출석 현황 업데이트.gs`: 공통 설정, 새 응답 증분 처리, 메일 안전장치, 숨김 로그, 공통 유틸리티
- `문자 명단 리스트.gs`: 토요일 문자공지 대상 조회와 HTML 메일 작성
- `집중교육 출석 현황 업데이트.gs`: 집중교육 결과 병합
- 연결 대상: `뉴액츠 새가족부 교육관리`
- 스크립트 ID: `1FkpwxV8uFORcOMqTO19rrMB2ifEfFAmK7aXu1pI8p5eT0_HMX-o4brJc`

`문자 명단 리스트.gs`는 같은 프로젝트의 `sendEducationEmail_`, 잠금, 전화번호·날짜 유틸리티를 사용하므로 세 파일을 한 Apps Script 프로젝트에 함께 두어야 합니다. 운영 수신자는 `EDUCATION_AUTOMATION.productionRecipients` 한 곳에서만 관리합니다.

### `registration-project/`

- `등록새가족-군현황 자동 배치.gs`: 등록 자동화 설정, 교육 출석 기준 자동 보정, 군 현황판, 숨김 로그, 공통 함수
  - 군 목록은 `REGISTRATION_AUTOMATION.groups` 한 곳에서만 정의합니다. 현황판 열 순서·열 수·군 표기 정규화가 모두 여기서 파생되므로 열 번호를 손으로 세지 않습니다. **군은 회기마다 바뀝니다 — 바꾸는 절차는 `SPEC.md` 8.1에 있습니다.**
- `등록 새가족 새가족교육 수료현황 자동화.gs`: 수료현황 동기화 및 전체·군별 메일
- `제목 없음.gs`: 상반기 결산 집계. Apps Script 파일명도 현재 동일하게 유지해야 관리가 쉽습니다.
- 연결 대상: `2026년 뉴액츠 청년부 등록 새가족 현황`
- 스크립트 ID: `1ZUvqTsXt0HwODX0Byi7GYWnNa75uTJ0ViKxP2vBUYl7KyM9-VriLQjK9`

등록 프로젝트 파일들은 `REGISTRATION_AUTOMATION` 설정과 공통 잠금·메일·형식 변환 함수를 공유하므로 한 Apps Script 프로젝트에 함께 배치합니다.

### `intensive-training-application/`

- `Code.gs`: Form·관리자 시트·공개 확인 시트·제출 트리거 일괄 설치 및 실시간 동기화
- `README.md`: [운영 Form과 공개 확인 시트](intensive-training-application/README.md), 재설치, 보안 구조, 실제 검증 기록
- 스크립트 ID: `1CRE913FQ73aVI2D2ol03-7vUAMJLIiD2-f64L2YL0fqHayAmSG_3ceZy`

이 프로젝트는 기존 교육관리 Spreadsheet와 코드를 공유하지 않는 독립 Apps Script 프로젝트입니다. `setupSystem()`은 비공개 시스템 폴더에 Form 1개와 Spreadsheet 2개를 만들고 공개 확인 시트만 링크 뷰어로 공유합니다.

### `scripts/`, `docs/`, `tests/`

- `scripts/apps-script.mjs`: 운영 ↔ 저장소 `diff` / `pull` / `push` / `deploy`
- `scripts/apps-script-projects.json`: 네 프로젝트의 script ID 매니페스트
- `scripts/run-tests.mjs`: `tests/*.test.js` 일괄 실행
- `docs/current-triggers.md`: 운영 트리거와 수동 함수
- `docs/current-architecture.md`: 시트 간 데이터 흐름
- `docs/enhanced-architecture.md`: 안전 모드, 증분 처리, 검토 규칙
- `docs/attendance-webapp-hardening.md`: 웹앱 보강 내용
- `docs/test-results-2026-08-12.md`: 운영 전 검증 기록
- `docs/settlement-monthly-email-analysis.md`: 정착률/월간 메일 분석 자료

## 운영 메일

### 월요일 08:00 — 등록 유지관리 (`runAllAutomationTrigger`)

수신자는 `REGISTRATION_AUTOMATION.testRecipient` **1명**입니다. 관리자 전체 발송이 필요해지면 `runRegistrationMaintenance_`의 `recipients`를 `productionAdminRecipients`로 바꿉니다.

- 제목: `[새가족 자동화] 정기 실행 | 자동 수정 N건 · 스스로/미배정 K명 · 검토 M건`
- 내용: 등록정보 자동 보정 요약(등록자·매칭·미매칭·자동수정·수동수정 보호·검토) → 자동수정 상세(행/이름/항목/기존값→교육 최신값/판단 근거) → 군 현황판 결과 → **스스로 등록·군 미배정 명단** → 검토 필요 상세 → 시트 링크
- 스스로 등록·군 미배정 명단은 담당자가 직접 군을 정해 줘야 하는 사람만 모은 표입니다. 등록 시트 행 번호가 있어 그 행을 바로 찾아 고칠 수 있습니다(REQ-REG-003).

### 화요일 17:00 — 교육 출석 반영 (`main`)

운영 수신자 5명. 제목에 신규·출석·중복·검토 건수가 들어가고, 본문에는 신규 추가 / 출석 반영 / 중복 / 군·팀 최신화 / 검토 필요를 각각 표로 정리합니다.

### 금요일 11:00 — 수료현황·주간 통계 (`runSystem`)

관리자 5명에게 전체 통계, 군 리더 9명에게 각 군 통계가 갑니다.

### 토요일 08:00 — 문자공지 명단 (`sendNewcomerNotifications`)

제목은 `[뉴액츠 새가족부] 금주 새가족 교육 문자공지 명단 (날짜)`이고 운영 수신자 5명에게 발송합니다.

운영 수신자 주소는 저장소에 두지 않습니다. 실제 목록은 `EDUCATION_AUTOMATION.productionRecipients`
설정 객체 한 곳에서만 관리합니다(REQ-MAIL-001).

대상자 선정 기준:

- 조회 기간: 최근 15주. 단, `2025-11-02` 이전은 조회하지 않음
- 교육 진행 중: 교육 출석 현황에 있으며 4주차를 완료하지 않았고 문자 제외 표시가 없는 사람
- 교육 미진행: 수료현황에 등록됐지만 1주차를 시작하지 않았고 문자 제외 표시가 없는 사람
- 문자 번호 목록: 중복 번호 제거 후 임원 번호를 포함하며 20명 단위 구분선 제공

## 운영 설정과 안전장치

교육과 등록 프로젝트의 공통 설정은 각각 `EDUCATION_AUTOMATION`, `REGISTRATION_AUTOMATION`에 있습니다.

- `active: true`: 정기 트리거가 실제 작업을 수행 / `active: false`: 진입해도 작업하지 않고 종료
- `mode: 'PRODUCTION'`: 운영 수신자에게 메일 발송 / `mode: 'TEST'`: 테스트 수신자 한 명에게만 발송
- `forceTestRecipient`: **현재 모드와 무관하게** 테스트 수신자 한 명으로 고정하고 제목에 `[TEST]`를 붙입니다. 아래 테스트 함수들이 이 옵션을 켭니다.
- `LockService`: 동시에 실행된 작업이 같은 시트를 중복 수정하지 않도록 차단
- 교육 응답 커서: `EDUCATION_LAST_RESPONSE_AT`(타임스탬프) 이후의 새 응답만 처리. 과거 행 번호 커서 `EDUCATION_LAST_RESPONSE_ROW`는 자동으로 이전됩니다.
- 등록정보 자동 보정: **군·팀·전화번호만** 자동으로 고칩니다. 이름이 교육 출석과 다르면 고치지 않고 검토 내역으로 보고합니다. 자동 수정한 값을 스크립트 속성에 기록해 두고, 사람이 그 값을 다시 고치면 이후 자동 수정 대상에서 **보호**합니다.
- 데이터 보존: 출석 원본·실행 로그·보정 상태를 자동으로 삭제하지 않습니다. 정리 기준이 필요해지면 코드보다 사양을 먼저 정합니다.

### 테스트 함수 (운영 발송 없음)

| 함수 | 동작 |
|---|---|
| `runEducationTest` | 직전 일요일 응답을 미리보기로 처리하고 테스트 수신자 1명에게만 발송 |
| `runNewcomerNotificationTest` | 문자공지 메일을 테스트 수신자 1명에게만 발송 |
| `runRegistrationMaintenanceTest` | 시트 변경 없이 등록 유지관리 결과를 테스트 수신자 1명에게만 발송. **시트 메뉴에는 없으며 Apps Script 편집기에서 실행한다** |
| `runRegistrationReportingTest` | 시트 변경 없이 수료 리포트를 테스트 수신자 1명에게 1통만 발송 |

이 함수들은 모두 `mode`를 `TEST`로 바꾸지 않아도 안전합니다. 예전에는 이름과 달리 운영 수신자 전체에게 실제 메일이 나갔습니다.

### 승인 후 실제 반영 (메일 없음, 시트 변경)

| 함수 | 동작 |
|---|---|
| `applyIntensiveTrainingNow` | 집중교육 참석자를 교육 출석 현황에 실제 반영. 먼저 `previewIntensiveTraining`으로 확인 |
| `generateSettlementReport` | 상반기 결산 시트를 다시 계산. 먼저 `previewSettlementReport`으로 확인 |
| `syncIntensiveTraining` | 활성 상태에서 집중교육 반영을 실행하는 정식 경로(위와 같은 작업) |

### 자동화 로그 (숨김 시트)

실행 결과는 아래 시트에 최신순으로 쌓이며 **항상 숨김 상태**로 유지됩니다. 운영 화면에는 보이지 않고, 확인이 필요하면 스프레드시트 메뉴의 `보기 → 숨겨진 시트`에서 엽니다.

| 스프레드시트 | 시트 | 기록 내용 |
|---|---|---|
| 뉴액츠 새가족부 교육관리 | `자동화 로그` | 실행시각·함수·모드·확인·추가·갱신·중복·정보변경·검토필요 |
| 2026년 뉴액츠 청년부 등록 새가족 현황 | `자동화 로그` | 실행시각·함수·모드·자동보정·수동보호·보정검토·현황인원·현황출력행·현황검토 |
| 2026년 뉴액츠 청년부 등록 새가족 현황 | `수료 자동화 로그` | 실행시각·모드·등록·매칭·미매칭·중복·불일치·출력행 |

## 배포 방법

```bash
npm run diff                  # 운영과 무엇이 다른지 먼저 확인
npm test                      # 로컬 검증
npm run push                  # 네 프로젝트 전체 반영
node scripts/apps-script.mjs push education      # 한 프로젝트만 반영
node scripts/apps-script.mjs pull                # 운영 코드를 저장소로 되돌림
```

- 인증은 clasp가 저장한 `~/.clasprc.json`의 refresh token을 재사용합니다. 토큰이 없으면 `clasp login`을 한 번 실행하세요.
- `push`는 해당 프로젝트의 **파일 전체를 교체**합니다. 실행 전 `npm run diff`로 확인하고, 반영 후에는 도구가 다시 읽어 일치를 자동 검증합니다.
- 트리거는 코드 반영으로 바뀌지 않습니다. 함수명을 바꾸면 Apps Script 트리거 화면에서 직접 수정해야 합니다.
- 처음 설치하는 교육 프로젝트라면 `initializeEducationCursor`를 한 번 실행해 기준 시각을 저장합니다.
- 웹앱은 코드 반영 후 `deploy` 명령으로 새 버전을 만들어야 사용자 화면에 적용됩니다.

## 수동 실행 순서

변경 전에 가능한 경우 아래 미리보기 함수를 먼저 사용합니다.

| 목적 | 미리보기/안전 확인 | 실제 실행 |
|---|---|---|
| 새 교육 응답 반영 | `previewPendingAttendance`, `previewEducationDetailedReport` | `processPendingAttendanceTrigger` |
| 집중교육 병합 | `previewIntensiveTraining` | `applyIntensiveTrainingNow` (메일 없음, 시트 변경) |
| 등록 보정·군 현황 갱신 | `previewRegistrationMaintenance` | `runRegistrationMaintenanceTrigger` |
| 수료현황·주간 메일 | `previewRegistrationReporting` | `runRegistrationReportingTrigger` |
| 상반기 결산 | `previewSettlementReport` | `generateSettlementReport` |
| 토요일 문자공지 메일 | `runNewcomerNotificationTest` | `sendNewcomerNotificationsTrigger` |

Apps Script 실행 로그와 숨김 `자동화 로그` 시트를 함께 확인하세요. 검토 필요 항목은 전화번호 중복, 누락, 잘못된 교육 주차, 군·팀 불일치 등을 뜻하며 자동으로 임의 수정하지 않습니다.

## 로컬 테스트

Node.js 18 이상에서 실행합니다. 별도 패키지 설치는 필요 없습니다.

```bash
npm test
```

| 파일 | 검증 내용 |
|---|---|
| `tests/attendance-webapp.test.js` | 입력 검증, 전화번호·주차 정규화, 2행 삽입 호출 순서 |
| `tests/education-automation.test.js` | 메일 수신자 안전장치, 수신자 안내 문구, 숨김 로그 시트 |
| `tests/education-notification.test.js` | 토요일 문자공지 운영 수신자 5명, 수신자 목록 단일 관리 |
| `tests/registration-automation.test.js` | 메일 안전장치, `M/d` 연도 추정, 숨김 로그, Properties 배치 호출 |
| `tests/intensive-training-application.test.js` | 군·팀 구성, 전화번호 정규화, 트리거·공유 설정, 공개 헤더 |

이 테스트는 Apps Script API를 실제 호출하지 않는 정적·단위 검증입니다. 실제 시트 권한, 트리거, 메일 도착 여부는 Apps Script에서 별도로 확인해야 합니다.

## 변경 시 체크리스트

1. 개인정보가 포함된 실제 명단이나 실행 결과를 저장소에 커밋하지 않습니다.
2. 시트 ID, 시트 이름, 열 위치를 바꾸면 이를 참조하는 모든 프로젝트를 함께 확인합니다.
3. 운영 메일 수신자 변경 시 TEST 모드 안전장치와 수신자 테스트도 갱신합니다.
4. 미리보기 → 테스트 함수 → 운영 실행 순서로 검증합니다.
5. `npm test` → `npm run diff` → `npm run push` 순서로 반영하고, 웹앱은 새 버전까지 배포합니다.

## AI Agent Context

이 저장소는 작업별 AI 컨텍스트 관리를 위해 Akela를 사용합니다. Akela는 Apps Script Runtime Dependency가 아닙니다.

- Knowledge: `knowledge/`
- Agent Protocol: `akela/PROTOCOL.md`
- Configuration: `akela.json`

Codex와 Claude Code는 대상 Apps Script 활동의 Knowledge만 compile한 뒤 작업하고 Evidence와 outcome을 기록합니다. `akela stats`의 후보는 `akela/CURATE.md` 절차로 검토하며, 정식 Knowledge 변경은 사람이 승인합니다.
