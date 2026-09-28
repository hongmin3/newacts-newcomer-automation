# 트리거 및 아키텍처 요약

`docs/current-triggers.md`, `docs/current-architecture.md`, `docs/enhanced-architecture.md`, `docs/settlement-monthly-email-analysis.md`의 핵심 내용을 요약한다. 트리거 일정이나 함수 세부 동작을 변경할 때는 반드시 원본 문서를 다시 확인한다.

## 원본 설치형 트리거 (2026-08-12 확인)
<!-- akela: id=original-triggers scope=trigger-debug tier=should -->

| 프로젝트 | 함수 | 일정 | 실패 알림 |
|---|---|---|---|
| 등록 프로젝트 | `runAllAutomationTrigger` | 매주 월요일 08:00~09:00 | 즉시 |
| 등록 프로젝트 | `runSystem` | 매주 금요일 11:00~12:00 | 매일 |
| 교육 프로젝트 | `main` | 매주 화요일 17:00~18:00 | 즉시 |
| 교육 프로젝트 | `main` | 매주 금요일 09:00~10:00 | 매일 |
| 교육 프로젝트 | `sendNewcomerNotifications` | 매주 토요일 08:00~09:00 | 즉시 |

## 개선본 권장 트리거 (2026-08-14 반영 완료)
<!-- akela: id=improved-triggers scope=trigger-debug,production-cutover tier=should -->

| 프로젝트 | 함수 | 일정 | 실패 알림 |
|---|---|---|---|
| 등록 | `runRegistrationMaintenanceTrigger` | 매주 월요일 08:00~09:00 | 즉시 |
| 등록 | `runRegistrationReportingTrigger` | 매주 금요일 11:00~12:00 | 즉시 |
| 교육 | `processPendingAttendanceTrigger` | 매주 월요일 07:00~08:00 | 즉시 |
| 교육 | `processPendingAttendanceTrigger` | 매주 금요일 09:00~10:00 | 즉시 |
| 교육 | `sendNewcomerNotificationsTrigger` | 매주 토요일 08:00~09:00 | 즉시 |

기존 함수명(`main`, `runSystem`, `runAllAutomationTrigger`, `sendNewcomerNotifications`)은 호환용 래퍼로 남아 있어 직접 호출해도 동작한다.

## 원본 대비 개선본 주요 변경점
<!-- akela: id=diff-summary scope=trigger-debug tier=context -->

- 중복 실행: 매 실행마다 전체 재탐색 → 마지막 처리 행 이후의 신규 응답만 처리 (`processPendingAttendanceTrigger`)
- 동시 실행 보호 없음 → 프로젝트 잠금으로 중복 실행 차단
- 사람 매칭: 이름/전화번호 혼용 → 정규화된 전화번호가 한 명과 일치할 때만 자동 반영, 불일치 시 기존 값 보존 + 검토 로그 기록
- 시트 쓰기: 행/셀 단위 다수 쓰기 → 범위 단위 배열 일괄 쓰기
- 방문자 동기화: 시트 전면 재작성 → 전화번호 기준 갱신/추가, 기존 수동 열 보존
- 집중교육: 4주차 값 덮어쓸 위험 → 빈 값만 채우고 충돌은 로그로 분리
- 메일 안전장치: 테스트 주소 강제, 운영 수신자는 별도 설정으로 분리 보존

## 미리보기 / 테스트 / 운영 함수 구분
<!-- akela: id=function-tiers scope=trigger-debug,production-cutover tier=should -->

- 미리보기(메일·시트 변경 없음): `previewPendingAttendance`, `previewIntensiveTraining`, `previewRegistrationMaintenance`, `previewRegistrationReporting`, `previewSettlementReport`
- 승인 후 테스트(메일은 본인 한 명에게만): `runEducationTest`, `runNewcomerNotificationTest`, `runRegistrationMaintenanceTest`, `runRegistrationReportingTest`, `runIntensiveTrainingTest`
- 운영 트리거 진입점: `processPendingAttendanceTrigger`, `sendNewcomerNotificationsTrigger`, `runRegistrationMaintenanceTrigger`, `runRegistrationReportingTrigger`

## 데이터 흐름 개요
<!-- akela: id=data-flow-overview scope=trigger-debug,gas-role-lookup tier=context -->

```text
2026년 새가족교육 출석 (응답)  →  교육관리 (교육 출석 현황, 26년 집중교육)
  →  등록 새가족 현황 (등록 새가족, 군 현황, 방문자, 수료현황, 결산, 정착률)
```

교육 프로젝트가 먼저 Form 응답을 반영하고, 등록 프로젝트가 그 결과를 받아 등록 시트 쪽을 재작성하는 순서다. 자세한 내용은 `docs/current-architecture.md`를 참조.

## 정착률 월간 메일 자동화 (Windows 예약 작업)
<!-- akela: id=settlement-automation-note scope=trigger-debug tier=context -->

- 정착률 계산은 Apps Script가 아니라 로컬 Python(`settlement-automation/main.py`)이 디모데 웹 화면 출결을 읽어 처리한다. 새가족교육 메일 트리거와는 별도의 실행 기반이다(REQ-RATE-001~003).
- Windows 작업 스케줄러 `새가족 정착률 월말 자동화`가 매주 화요일 오전 9시에 `settlement-automation/run_monthly.ps1`을 실행한다. 스크립트는 그 달의 마지막 화요일일 때만 계산하고 메일을 보낸다(REQ-RATE-003).
- 운영 절차와 동일인 판정 규칙은 `rate-operations.md`, `rate-matching-rules.md`에 있다.
