# 새가족·교육 통합 자동화 사양서

<!-- spec-template: v1 -->

| 항목 | 값 |
|---|---|
| Document Version | 0.1.0 |
| Last Updated | 2026-09-21 |
| Status | draft — 제한된 기존 계약 기준선 |

전체 사양 및 운영 검증 완료를 의미하지 않는다. 기존 약속과 코드가 다르면 SPEC / CODE MISMATCH로 기록하며 현재 코드를 정당화하려고 약속을 바꾸지 않는다.

## 1. 목적

등록 관리와 교육 관리 Apps Script를 구분해 유지보수하고 안전하게 운영한다.

## 2. 프로젝트 범위

이번 사양화는 아래 확인된 계약에 한정한다. 제품 전체 기능은 기존 문서와 구현을 보존한다. 문서 작업 범위에서 운영 기능·인증·예약·배포·비밀값·실데이터를 변경하지 않는다.

## 5. 기능 요구사항

### REQ-CORE-001 비활성 트리거 차단

active=false이면 설치형 트리거 진입 함수가 작업 없이 종료해야 한다. 비활성 상태를 배포 완료로 오인하지 않는다.

근거 구현: `education-project/교육 출석 현황 업데이트.gs`. 검증 근거: `docs/enhanced-architecture.md`.

### REQ-CORE-002 테스트 수신자 단일화

TEST 모드와 테스트 전용 함수는 지정된 테스트 수신자 한 곳만 사용한다. 여러 수신자이면 오류로 중단하고 운영 수신자로 보내지 않는다.

근거 구현: `education-project/교육 출석 현황 업데이트.gs`. 검증 근거: `docs/enhanced-architecture.md`.

## 9. 오류 처리 정책

실패나 미검증 범위를 성공으로 기록하지 않는다. 구체적인 계약별 거부/보류 결과는 5절에 따른다. 아직 근거가 부족한 오류 처리 동작은 13절의 미확정 범위이며 추측으로 확정하지 않는다.

## 11. 테스트 사양

기존 README와 컴파일된 변경 정책, 실제 runEducationTest 함수 존재를 근거로 한 수동 검증 사양이다. 테스트 전용 함수 실행도 메일 전송이므로 이번 문서 작업에서는 호출하지 않았다.

### TEST-CORE-001

대상: REQ-CORE-001. 절차: 격리된 Apps Script 복사본에서 active=false로 트리거 진입을 호출하고 외부 시트 변경/메일이 없는지 확인한다. 운영 설정은 변경하지 않는다.

기대 결과: 해당 Requirement의 동작과 일치해야 하며 실패나 미실행은 통과로 기록하지 않는다. 실행 상태: 미실행.

### TEST-CORE-002

대상: REQ-CORE-002. 절차: 격리 사본에서 runEducationTest 등 전용 함수를 검토하고 수신자 수 검사 및 TEST/PRODUCTION 분기를 확인한다. 실제 발송은 별도 승인 후 수행한다.

기대 결과: 해당 Requirement의 동작과 일치해야 하며 실패나 미실행은 통과로 기록하지 않는다. 실행 상태: 미실행.

## 12. 요구사항 추적성

| Requirement | Implementation | Test | Status |
|---|---|---|---|
| REQ-CORE-001 | `education-project/교육 출석 현황 업데이트.gs` | TEST-CORE-001; 근거 `docs/enhanced-architecture.md` | draft |
| REQ-CORE-002 | `education-project/교육 출석 현황 업데이트.gs` | TEST-CORE-002; 근거 `docs/enhanced-architecture.md` | draft |

## 13. 미확정 사항

- 시트별 데이터 흐름과 모든 테스트 함수/교육 과정의 요구사항 추적 및 라이브 운영 결과는 확인 필요다.
- 전체 readiness 및 실제 운영/CLI 검증 완료로 선언하지 않는다.
