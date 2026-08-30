# Apps Script 프로젝트 구성

한성교회 뉴액츠 청년부의 두 Google Apps Script 프로젝트에 대한 요약이다. 스크립트 ID와 원본 역할 설명은 `README.md`와 `docs/current-architecture.md`를 그대로 참조하여 정리했다.

## 등록·정착 현황 관리 프로젝트 (`registration-project/`)
<!-- akela: id=registration-project-role scope=gas-role-lookup,trigger-debug tier=should -->

- 연결 스프레드시트: `2026년 뉴액츠 청년부 등록 새가족 현황`
- 스크립트 ID: `1ZUvqTsXt0HwODX0Byi7GYWnNa75uTJ0ViKxP2vBUYl7KyM9-VriLQjK9`
- 관련 시트: 등록 새가족, 등록 새가족 군 현황, 상반기 방문 새가족, 새가족교육 수료현황, 상반기 결산, 정착률
- 역할:
  - 등록 명단을 군별 현황판으로 재작성
  - 등록 명단을 방문자 명단으로 동기화
  - 교육 출석 현황과 등록 명단을 결합해 수료현황 재작성
  - 군별·전체 통계 및 배정 필요 명단 메일 발송
  - 결산 데이터 생성 함수 제공
- 원본 진입 함수: `runAllAutomationTrigger`(월요일), `runSystem`(금요일)
- 개선본 진입 함수: `runRegistrationMaintenanceTrigger`, `runRegistrationReportingTrigger` (기존 함수명은 호환용 래퍼로 유지)

## 교육관리 프로젝트 (`education-project/`)
<!-- akela: id=education-project-role scope=gas-role-lookup,trigger-debug tier=should -->

- 연결 스프레드시트: `뉴액츠 새가족부 교육관리`
- 스크립트 ID: `1FkpwxV8uFORcOMqTO19rrMB2ifEfFAmK7aXu1pI8p5eT0_HMX-o4brJc`
- 입력 원본: `2026년 새가족교육 출석 (응답)` (Google Form 응답 시트)
- 관련 시트: 교육 출석 현황, 26년 집중교육
- 역할:
  - Google Form 응답에서 직전 일요일 출석 데이터 반영
  - 주차별 출석, 중복, 번호 불일치, 군·팀 변경 감지
  - 교육 진행·미진행 문자 대상 명단 메일 발송
  - 집중교육 참석자를 교육 출석 현황에 반영
- 원본 진입 함수: `main`(화·금요일), `sendNewcomerNotifications`(토요일)
- 개선본 진입 함수: `processPendingAttendanceTrigger`, `sendNewcomerNotificationsTrigger` (기존 함수명은 호환용 래퍼로 유지)

## 두 프로젝트의 관계
<!-- akela: id=project-relationship scope=gas-role-lookup tier=should -->

교육 프로젝트가 먼저 실행되어 교육 출석 현황을 갱신하고, 등록 프로젝트가 그 결과를 받아 등록 새가족 현황 쪽 수료현황·통계를 재작성하는 순서로 데이터가 흐른다 (`docs/current-architecture.md`의 데이터 흐름 다이어그램 참조). 두 프로젝트를 혼동하지 않도록, 작업 요청이 "출석/문자 대상/집중교육"이면 교육 프로젝트, "등록/군 현황/방문자/수료현황/결산/정착률"이면 등록 프로젝트를 대상으로 한다.
