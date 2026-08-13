# 개선본 구조와 운영 절차

## 연결 구조

```text
Google Form 응답 시트
  └─ processPendingAttendanceTrigger
       ├─ 신규 응답만 커서 이후부터 처리
       ├─ 전화번호가 유일할 때만 교육 명단 자동 매칭
       └─ 교육 출석 현황 A:K 일괄 반영 및 검토 로그 기록

교육 출석 현황
  ├─ sendNewcomerNotificationsTrigger
  │    └─ 문자 대상 명단을 중복 제거하여 메일 전송
  └─ runRegistrationReportingTrigger
       ├─ 등록 명단과 전화번호 기준 결합
       ├─ 새가족교육 수료현황 A:O 재작성
       └─ 군별·전체 보고 메일 전송

등록 새가족
  └─ runRegistrationMaintenanceTrigger
       ├─ 군 현황판 일괄 갱신
       └─ 방문자 시트는 기존 수동 열을 보존하며 신규/변경분만 반영
```

## 원본 대비 변경점

| 항목 | 원본 | 개선본 |
|---|---|---|
| 중복 실행 | 동일한 일요일 응답을 화·금요일 모두 재탐색 | 마지막 처리 행 이후의 신규 응답만 처리 |
| 동시 실행 | 보호 없음 | 프로젝트 잠금으로 중복 실행 차단 |
| 사람 매칭 | 이름 또는 전화번호 혼용 | 정규화된 전화번호가 한 명과 일치할 때만 자동 반영 |
| 불일치 처리 | 일부 값을 자동 덮어씀 | 기존 값을 보존하고 검토 로그에 기록 |
| 시트 쓰기 | 행/셀 단위 쓰기 다수 | 필요한 범위를 배열로 일괄 쓰기 |
| 방문자 동기화 | 시트를 전면 재작성 | 전화번호 기준 갱신/추가, 수동 열 보존 |
| 집중교육 | 4주차 값을 덮어쓸 수 있음 | 빈 값만 채우고 충돌은 로그로 분리 |
| 테스트 메일 | 운영 수신자에게 발송 위험 | 테스트 주소 한 곳으로 강제 |
| 운영 메일 | 코드에 흩어진 수신자 | 원본 수신 목록을 운영 설정에 분리 보존 |

## 안전 모드와 현재 운영 상태

두 프로젝트의 설정 객체는 다음 두 값을 사용합니다.

- `active`: `false`이면 설치형 트리거 진입 함수가 아무 작업도 하지 않고 종료합니다.
- `mode: 'TEST'`: 메일 수신자를 `ksj747172@gmail.com`으로 강제합니다.
- `mode: 'PRODUCTION'`: 보존된 기존 관리자·군 담당자 수신 목록을 사용합니다.

테스트 함수도 메일 안전장치를 통과해야 하며, 테스트 모드에서 두 명 이상의 수신자를 지정하면 오류로 중단됩니다. 2026-08-14 최종 승인에 따라 현재는 `active: true`, `mode: 'PRODUCTION'`입니다.

## 함수별 실행 방법

### 미리보기(메일·시트 변경 없음)

- 교육 신규 응답: `previewPendingAttendance`
- 집중교육 반영: `previewIntensiveTraining`
- 등록 유지보수: `previewRegistrationMaintenance`
- 등록 수료/보고: `previewRegistrationReporting`
- 결산: `previewSettlementReport`

### 승인 후 테스트(메일은 본인 한 명에게만 발송)

- 교육 출석 반영: `runEducationTest`
- 문자 명단 메일: `runNewcomerNotificationTest`
- 등록 군 현황/방문자 동기화: `runRegistrationMaintenanceTest`
- 등록 수료현황/보고 메일: `runRegistrationReportingTest`
- 집중교육 반영: `runIntensiveTrainingTest`

### 운영 트리거 진입점

- `processPendingAttendanceTrigger`
- `sendNewcomerNotificationsTrigger`
- `runRegistrationMaintenanceTrigger`
- `runRegistrationReportingTrigger`

기존 함수명 `main`, `runSystem`, `runAllAutomationTrigger`, `sendNewcomerNotifications`는 호환용 래퍼로 남겨 두었습니다.

## 운영 전환 순서

1. 사용자에게 실제 테스트 실행 승인을 받습니다.
2. 테스트 모드에서 필요한 테스트 함수를 실행하고 시트 변경 및 본인 수신 메일을 확인합니다.
3. 신규 응답 커서를 `initializeEducationCursor`로 현재 마지막 행에 설정합니다.
4. 사용자에게 테스트 결과와 원본 대비 차이를 보고합니다.
5. 사용자 승인 후 두 설정을 `active: true`, `mode: 'PRODUCTION'`으로 변경합니다.
6. Apps Script에 저장하고 트리거 일정을 최종 확인합니다.
7. 사용자 승인 후에만 개선본을 Git 커밋하고 원격 저장소에 푸시합니다.

## 2026-08-14 운영 전환 완료

- 교육 응답 커서: 450행으로 초기화, 이후 451행부터 증분 처리
- 설정: 두 프로젝트 모두 `active: true`, `mode: 'PRODUCTION'`
- 전체 관리자 메일 제목: `[새가족부] 전체 새가족교육 현황 - …`
- 전체 관리자 수신: 원본의 관리자 5명 목록 유지
- 군별 수신: 원본의 신·조·총·석·전·명·임·슬·영군 담당자 주소 유지
- 설치형 트리거: 아래 권장 트리거 구성으로 반영 완료

## 권장 트리거

| 프로젝트 | 함수 | 일정 | 실패 알림 |
|---|---|---|---|
| 등록 | `runRegistrationMaintenanceTrigger` | 매주 월요일 08:00~09:00 | 즉시 |
| 등록 | `runRegistrationReportingTrigger` | 매주 금요일 11:00~12:00 | 즉시 |
| 교육 | `processPendingAttendanceTrigger` | 매주 월요일 07:00~08:00 | 즉시 |
| 교육 | `processPendingAttendanceTrigger` | 매주 금요일 09:00~10:00 | 즉시 |
| 교육 | `sendNewcomerNotificationsTrigger` | 매주 토요일 08:00~09:00 | 즉시 |
