# 변경 정책

이 저장소는 원본 Apps Script 스냅샷을 보존하면서 개선본을 안전하게 검증하기 위한 정책을 따른다. 아래 규칙은 `README.md`의 "변경 정책"과 `docs/enhanced-architecture.md`의 운영 전환 절차를 정제한 것이다. 원본 문서(`README.md`, `docs/`)가 항상 1차 근거이며, 이 파일은 요약 참조용이다.

## 사용자 승인 전 커밋 금지
<!-- akela: id=no-commit-before-approval scope=policy-change,production-cutover tier=must -->

- 원본 스냅샷은 첫 커밋(`73c2e5d`)으로 이미 보존되어 있다.
- 개선본(코드 수정)은 로컬과 Apps Script 편집기에서 충분히 검증하되, **사용자의 명시적 승인 전에는 두 번째 커밋을 만들지 않는다.**
- 사용자 승인 후에만 커밋하고, 그 후에만 원격 저장소로 push한다.
- `education-project/`, `registration-project/` 내부의 `.gs` 소스 파일은 AI 에이전트가 직접 수정하지 않는다.

## 테스트 메일은 반드시 1인에게만 발송
<!-- akela: id=test-email-single-recipient scope=policy-change,production-cutover tier=must -->

- 테스트 전용 함수(`runEducationTest`, `runNewcomerNotificationTest`, `runRegistrationMaintenanceTest`, `runRegistrationReportingTest`, `runIntensiveTrainingTest` 등)는 메일 수신자를 `ksj747172@gmail.com` 한 주소로 강제해야 한다.
- 설정 객체의 `mode: 'TEST'`일 때 두 명 이상의 수신자를 지정하면 오류로 중단되도록 되어 있다. 이 안전장치를 우회하거나 제거하지 않는다.
- 운영 수신자(관리자 5명, 9개 군 담당자 등 실제 교인 연락처)로 테스트 메일을 보내지 않는다.

## 개인정보 포함 테스트 데이터는 커밋 금지
<!-- akela: id=no-pii-in-commits scope=policy-change tier=must -->

- 교인 명단, 전화번호, 실제 수신자 이메일 등 개인정보가 담긴 테스트 데이터나 실행 로그를 저장소(`git`)에 커밋하지 않는다.
- knowledge 파일을 포함한 모든 문서화 작업에서도 실제 교인 개인정보를 knowledge에 포함하지 않는다.

## 운영 전환 시 active / mode 플래그 확인 절차
<!-- akela: id=active-mode-flag-checklist scope=policy-change,production-cutover tier=must -->

두 프로젝트의 설정 객체는 다음 두 값으로 안전 모드를 제어한다 (`docs/enhanced-architecture.md` 참조).

- `active`: `false`이면 설치형 트리거 진입 함수가 아무 작업도 하지 않고 종료한다.
- `mode: 'TEST'`: 메일 수신자를 테스트 주소(`ksj747172@gmail.com`) 한 곳으로 강제한다.
- `mode: 'PRODUCTION'`: 원본에 보존된 기존 관리자·군 담당자 수신 목록을 사용한다.

운영 전환 순서(요약):

1. 사용자에게 실제 테스트 실행 승인을 받는다.
2. 테스트 모드에서 테스트 함수를 실행하고 시트 변경과 본인 수신 메일을 확인한다.
3. 신규 응답 커서 등 필요한 초기화를 수행한다.
4. 사용자에게 테스트 결과와 원본 대비 차이를 보고한다.
5. 사용자 승인 후에만 `active: true`, `mode: 'PRODUCTION'`으로 변경한다.
6. Apps Script에 저장하고 트리거 일정을 최종 확인한다.
7. 사용자 승인 후에만 개선본을 Git 커밋하고 원격 저장소에 푸시한다.

2026-08-14 기준 두 프로젝트 모두 사용자 최종 승인에 따라 `active: true`, `mode: 'PRODUCTION'`으로 전환 완료된 상태이다. 이후 코드를 다시 수정할 경우에도 위 절차(TEST 모드 검증 → 승인 → PRODUCTION 전환)를 반복해야 한다.
