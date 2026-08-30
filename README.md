# 뉴액츠 새가족·교육 통합 자동화

뉴액츠 새가족 등록, 교육 출석, 집중교육 신청, 수료 현황, 문자공지 명단을 관리하는 Google Apps Script 소스 저장소입니다. 네 개의 Apps Script 프로젝트가 서로 다른 Google Workspace 파일을 연결해 사용합니다.

> GitHub의 `.gs` 파일을 수정해도 운영 중인 Apps Script에 자동 배포되지는 않습니다. 변경한 파일을 해당 Apps Script 프로젝트에 반영해야 실제 트리거 실행에 적용됩니다. 이 저장소에는 현재 `clasp` 설정이 없습니다.

## 한눈에 보는 자동화

| 자동화 | 실행 함수 | 일정/방식 | 주요 기능 | 코드 위치 |
|---|---|---|---|---|
| 교육 출석 입력 웹앱 | `doGet`, `searchUser`, `submitAttendance` | 웹앱에서 수시 실행 | 이름·전화번호 확인 후 교육 주차 출석 응답 저장 | `attendance-webapp/` |
| 등록 명단 유지관리 | `runAllAutomationTrigger` → `runRegistrationMaintenanceTrigger` | 매주 월요일 08:00~09:00 | 군별 현황판 갱신, 방문 새가족 명단 동기화, 결과 메일 | `registration-project/등록새가족-군현황 자동 배치.gs` |
| 교육 수료현황·주간 메일 | `runSystem` → `runRegistrationReportingTrigger` | 매주 금요일 11:00~12:00 | 등록 명단과 교육 출석 결합, 수료현황 재작성, 전체·군별 주간 메일 | `registration-project/등록 새가족 새가족교육 수료현황 자동화.gs` |
| 교육 출석 반영 | `main` → `processPendingAttendanceTrigger` | 매주 화요일 17:00~18:00, 금요일 09:00~10:00 | 새 설문 응답을 교육 출석 현황에 증분 반영하고 결과 메일 | `education-project/교육 출석 현황 업데이트.gs` |
| 교육 문자공지 명단 | `sendNewcomerNotifications` → `sendNewcomerNotificationsTrigger` | 매주 토요일 08:00~09:00 | 교육 진행 중·미진행 명단과 문자 발송용 번호를 메일로 전송 | `education-project/문자 명단 리스트.gs` |
| 집중교육 신청 접수 | `onFormSubmitHandler` | Form 제출 즉시 | 군→팀 분기 신청, 전화번호 정규화, 관리자·공개 명단 동기화 | `intensive-training-application/` |
| 집중교육 출석 반영 | `syncIntensiveTraining` | 필요할 때 수동 실행 | `26년 집중교육` 참석자를 일반 교육 출석 현황에 반영 | `education-project/집중교육 출석 현황 업데이트.gs` |
| 상반기 결산 생성 | `generateSettlementReport` | 필요할 때 수동 실행 | 등록 자료를 기준으로 상반기 결산 집계표 갱신 | `registration-project/제목 없음.gs` |

트리거 시간은 Apps Script가 지정 시간대 안에서 선택해 실행하므로 정확히 정각에 시작되지 않을 수 있습니다. 확인 당시 트리거 상세는 [`docs/current-triggers.md`](docs/current-triggers.md)에 있습니다.

## 프로젝트와 데이터 흐름

```text
출석 웹앱
  └─ 2026년 새가족교육 출석 (응답) / 설문지 응답 시트1
       │  화·금: 교육 출석 증분 반영
       ▼
뉴액츠 새가족부 교육관리
  ├─ 교육 출석 현황
  └─ 26년 집중교육
       │  금: 등록 명단과 결합
       ▼
2026년 뉴액츠 청년부 등록 새가족 현황
  ├─ 등록 새가족
  ├─ 등록 새가족 군 현황
  ├─ 상반기 방문 새가족
  ├─ 새가족교육 수료현황
  └─ 상반기 결산

토요일 문자공지 명단
  ├─ 교육 출석 현황에서 교육 진행 중 대상 조회
  └─ 새가족교육 수료현황에서 교육 미진행 대상 조회
       └─ 관리자 5명에게 메일 발송
```

연결 구조와 데이터 기준에 관한 추가 설명은 [`docs/current-architecture.md`](docs/current-architecture.md), 안전장치와 처리 규칙은 [`docs/enhanced-architecture.md`](docs/enhanced-architecture.md)를 참고하세요.

집중교육 신청 Form 제출이 완료되면 신청자 현황은 [공개 확인 시트](https://docs.google.com/spreadsheets/d/1dZbp9oHvcWEuWrDhATK3obLC_8rUb_M1jzH9UC8tOM0/edit)에서 확인하면 됩니다. 공개 명단에는 전화번호가 포함되지 않습니다.

## 디렉터리 안내

### `attendance-webapp/`

- `Code.gs`: 웹앱 화면 제공, 사용자 검색, 입력값 검증, 출석 응답 저장
- `Index.html`: 이름·전화번호 검색과 주차 선택 화면
- 연결 대상: `2026년 새가족교육 출석 (응답)`
- 스크립트 ID: `1JPi6GfNS1UR_iWic0h9yZRr-NhEYnxAV_l-YM7_huZwVceBhnDX7m5s6`

웹앱은 이름과 전화번호를 함께 확인하고, 1~4주차만 허용합니다. 배포본을 바꿀 때에는 Apps Script에서 새 웹앱 버전을 배포해야 합니다.

### `education-project/`

- `교육 출석 현황 업데이트.gs`: 공통 설정, 새 응답 증분 처리, 메일 안전장치, 로그 및 공통 유틸리티
- `문자 명단 리스트.gs`: 토요일 문자공지 대상 조회와 HTML 메일 작성
- `집중교육 출석 현황 업데이트.gs`: 집중교육 결과 병합
- 연결 대상: `뉴액츠 새가족부 교육관리`
- 스크립트 ID: `1FkpwxV8uFORcOMqTO19rrMB2ifEfFAmK7aXu1pI8p5eT0_HMX-o4brJc`

`문자 명단 리스트.gs`는 같은 프로젝트의 `sendEducationEmail_`, 잠금, 전화번호·날짜 유틸리티를 사용하므로 세 파일을 한 Apps Script 프로젝트에 함께 두어야 합니다.

### `registration-project/`

- `등록새가족-군현황 자동 배치.gs`: 등록 자동화 설정과 공통 함수, 군 현황판 및 방문자 명단 관리
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

### `docs/`와 `tests/`

- `docs/current-triggers.md`: 운영 트리거와 수동 함수
- `docs/current-architecture.md`: 시트 간 데이터 흐름
- `docs/enhanced-architecture.md`: 안전 모드, 증분 처리, 검토 규칙
- `docs/attendance-webapp-hardening.md`: 웹앱 보강 내용
- `docs/test-results-2026-08-12.md`: 운영 전 검증 기록
- `docs/settlement-monthly-email-analysis.md`: 정착률/월간 메일 분석 자료
- `tests/attendance-webapp.test.js`: 웹앱 입력 검증 정적 테스트
- `tests/education-notification.test.js`: 토요일 문자공지 운영 수신자 검증

## 토요일 문자공지 메일

메일 제목은 `[뉴액츠 새가족부] 금주 새가족 교육 문자공지 명단 (날짜)`입니다.

운영 수신자는 `education-project/문자 명단 리스트.gs`의 `NOTIFICATION_CONFIG.productionRecipients`에서 관리합니다.

```text
ksj747172@gmail.com
kimth6805@gmail.com
rnrnwkddn@naver.com
wnehdrms123@naver.com
whduswn94@naver.com
```

운영 모드에서는 위 5명에게 모두 발송합니다. `EDUCATION_AUTOMATION.mode`가 `TEST`이면 전달된 운영 명단을 무시하고 `testRecipient` 한 명에게만 보내므로, 테스트가 실수로 전체 수신자에게 발송되지 않습니다.

대상자 선정 기준:

- 조회 기간: 최근 15주. 단, `2025-11-02` 이전은 조회하지 않음
- 교육 진행 중: 교육 출석 현황에 있으며 4주차를 완료하지 않았고 문자 제외 표시가 없는 사람
- 교육 미진행: 수료현황에 등록됐지만 1주차를 시작하지 않았고 문자 제외 표시가 없는 사람
- 문자 번호 목록: 중복 번호 제거 후 임원 번호를 포함하며 20명 단위 구분선 제공

## 운영 설정과 안전장치

교육과 등록 프로젝트의 공통 설정은 각각 `EDUCATION_AUTOMATION`, `REGISTRATION_AUTOMATION`에 있습니다.

- `active: true`: 정기 트리거가 실제 작업을 수행
- `active: false`: 트리거가 진입해도 작업하지 않고 종료
- `mode: 'PRODUCTION'`: 운영 수신자에게 메일 발송
- `mode: 'TEST'`: 테스트 수신자 한 명에게만 메일 발송
- `LockService`: 동시에 실행된 작업이 같은 시트를 중복 수정하지 않도록 차단
- `자동화 로그` 시트: 실제 반영 결과와 검토 필요 건 기록
- 교육 응답 커서: `EDUCATION_LAST_RESPONSE_ROW` 이후의 새 응답만 처리

`runEducationTest`, `runNewcomerNotificationTest`, `runRegistrationMaintenanceTest`, `runRegistrationReportingTest`는 이름과 달리 현재 모드를 자동으로 `TEST`로 전환하지 않습니다. 전체 수신자 발송을 피하려면 먼저 설정의 `mode`를 `TEST`로 변경한 뒤 실행하고, 검증 후 `PRODUCTION`으로 되돌려야 합니다.

## 설치·배포 방법

1. 이 저장소에서 변경할 파일과 연결 대상 프로젝트를 확인합니다.
2. [Google Apps Script](https://script.google.com/)에서 위 스크립트 ID에 해당하는 프로젝트를 엽니다.
3. 로컬 디렉터리 안의 `.gs`/`.html` 파일 내용을 같은 프로젝트의 대응 파일에 반영합니다.
4. Apps Script 프로젝트 설정에서 시간대를 `Asia/Seoul`로 확인합니다.
5. 처음 설치하는 교육 프로젝트라면 `initializeEducationCursor`를 한 번 실행해 기존 응답의 마지막 행을 기준점으로 저장합니다.
6. 필요한 Google Sheets 및 메일 권한을 승인합니다.
7. 먼저 미리보기 함수로 결과를 확인하고, 필요하면 `mode: 'TEST'`에서 테스트합니다.
8. 운영 전환 시 `active: true`, `mode: 'PRODUCTION'`을 확인합니다.
9. 왼쪽 **트리거** 메뉴에서 아래 정기 트리거를 설치하거나 기존 트리거의 함수명을 확인합니다.
10. 웹앱 코드를 변경했다면 **배포 → 배포 관리 → 새 버전**으로 웹앱을 다시 배포합니다.

GitHub와 Apps Script를 자동 동기화하려면 별도로 `clasp` 설정 및 인증을 추가해야 합니다. 현재는 수동 반영 방식입니다.

## 수동 실행 순서

변경 전에 가능한 경우 아래 미리보기 함수를 먼저 사용합니다.

| 목적 | 미리보기/안전 확인 | 실제 실행 |
|---|---|---|
| 새 교육 응답 반영 | `previewPendingAttendance` | `processPendingAttendanceTrigger` |
| 집중교육 병합 | `previewIntensiveTraining` | `syncIntensiveTraining` |
| 등록 군 현황·방문자 갱신 | `previewRegistrationMaintenance` | `runRegistrationMaintenanceTrigger` |
| 수료현황·주간 메일 | `previewRegistrationReporting` | `runRegistrationReportingTrigger` |
| 상반기 결산 | `previewSettlementReport` | `generateSettlementReport` |
| 토요일 문자공지 메일 | TEST 모드에서 `runNewcomerNotificationTest` | `sendNewcomerNotificationsTrigger` |

Apps Script 실행 로그와 각 문서의 `자동화 로그` 시트를 함께 확인하세요. 검토 필요 항목은 전화번호 중복, 누락, 잘못된 교육 주차, 군·팀 불일치 등을 뜻하며 자동으로 임의 수정하지 않습니다.

## 로컬 테스트

Node.js 18 이상에서 실행합니다. 별도 패키지 설치는 필요 없습니다.

```bash
node tests/attendance-webapp.test.js
node tests/education-notification.test.js
node tests/intensive-training-application.test.js
```

이 테스트는 Apps Script API를 실제 호출하지 않는 정적·단위 검증입니다. 실제 시트 권한, 트리거, 메일 도착 여부는 Apps Script에서 별도로 확인해야 합니다.

## 변경 시 체크리스트
1. 개인정보가 포함된 실제 명단이나 실행 결과를 저장소에 커밋하지 않습니다.
2. 시트 ID, 시트 이름, 열 위치를 바꾸면 이를 참조하는 모든 프로젝트를 함께 확인합니다.
3. 운영 메일 수신자 변경 시 TEST 모드 안전장치와 수신자 테스트도 갱신합니다.
4. 미리보기 → TEST 모드 → 운영 모드 순서로 검증합니다.
5. GitHub 반영 후 Apps Script 프로젝트에도 같은 코드를 배포합니다.

## AI Agent Context

이 저장소는 작업별 AI 컨텍스트 관리를 위해 Akela를 사용합니다. Akela는 Apps Script Runtime Dependency가 아닙니다.

- Knowledge: `knowledge/`
- Agent Protocol: `akela/PROTOCOL.md`
- Configuration: `akela.json`

Codex와 Claude Code는 대상 Apps Script 활동의 Knowledge만 compile한 뒤 작업하고 Evidence와 outcome을 기록합니다. `akela stats`의 후보는 `akela/CURATE.md` 절차로 검토하며, 정식 Knowledge 변경은 사람이 승인합니다.
