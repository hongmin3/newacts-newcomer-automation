# 새가족 정착률 자동화 사양서

<!-- spec-template: v1 -->

| 항목 | 값 |
|---|---|
| Document Version | 0.1.0 |
| Last Updated | 2026-09-21 |
| Status | draft — 기존 계약 일부의 근거 기반 사양화 |

기존 코드와 테스트의 명시적 약속을 처음으로 연결한 제한된 기준선이다. 전체 제품 사양이나 운영 검증 완료를 뜻하지 않는다. 기존 약속과 구현의 차이는 SPEC / CODE MISMATCH로 남기고 코드에 맞춰 약속을 바꾸지 않는다.

## 1. 목적

등록 후 출석을 확인해 정착률 보고서를 만들고 검증된 결과만 안내한다.

## 2. 프로젝트 범위

포함: 메일 안전 기준과 표현/월간 날짜 판정.

제외: 운영 데이터·비밀 설정의 열람/변경, 기능 수정, 인증·배포·예약 실행 변경. 이 제외는 작업 경계이며 기존 제품 기능을 제거한다는 뜻이 아니다.

## 5. 기능 요구사항

### REQ-CORE-001 조회 완료율 안전 기준

조회완료 비율이 설정 안전 기준 미만이면 RuntimeError로 메일 발송을 차단한다. 기본 기준은 0.95이며 100건 중 94건 완료 fixture는 거부한다.

관련 구현: `settlement_email.py`. 관련 테스트: `tests/test_settlement.py`의 `test_low_completion_rate_blocks_email`.

### REQ-CORE-002 개인별 표 선택

전체 보고서에서 include_members=False이면 군별 현황은 유지하고 개인별 상세표는 포함하지 않는다.

관련 구현: `settlement_email.py`. 관련 테스트: `tests/test_settlement.py`의 `test_overall_email_can_omit_member_table`.

### REQ-CORE-003 마지막 화요일 판정

월간 실행 조건에 쓰는 날짜 판정은 해당 월 마지막 화요일에만 참을 반환한다. 2026-08-25는 참, 같은 달 18일은 거짓이다.

관련 구현: `settlement_email.py`. 관련 테스트: `tests/test_settlement.py`의 `test_last_tuesday`.

## 9. 오류 처리 정책

메일 안전 검사 실패를 성공이나 발송 완료로 기록하지 않는다. 동일인 판정 및 실제 시트 갱신·메일 전송 계약은 이번 기준선 밖이며 기존 동작을 보존한다.

## 11. 테스트 사양

테스트가 import하는 모듈은 로컬 설정을 참조할 수 있다. 비밀 설정을 열거나 운영 인증을 사용하는 대신 별도 격리 사본에 비밀 없는 테스트 설정을 준비한 뒤 실행한다.

개발 의존성을 준비하고 프로젝트 루트에서 실행할 명령:

```text
python -m unittest discover -s tests -p test_settlement.py -v
```

이번 작업에서는 테스트 본문과 구현 연결을 확인했으며 명령을 실제 실행하지 않았다.

### TEST-CORE-001

REQ-CORE-001의 입력과 결과를 `tests/test_settlement.py`의 `test_low_completion_rate_blocks_email` fixture/assertion으로 검증한다. 해당 assertion 실패는 검사 실패다.

### TEST-CORE-002

REQ-CORE-002의 입력과 결과를 `tests/test_settlement.py`의 `test_overall_email_can_omit_member_table` fixture/assertion으로 검증한다. 해당 assertion 실패는 검사 실패다.

### TEST-CORE-003

REQ-CORE-003의 입력과 결과를 `tests/test_settlement.py`의 `test_last_tuesday` fixture/assertion으로 검증한다. 해당 assertion 실패는 검사 실패다.

## 12. 요구사항 추적성

| Requirement | Implementation | Test | Status |
|---|---|---|---|
| REQ-CORE-001 | `settlement_email.py` | TEST-CORE-001: `tests/test_settlement.py` | implemented |
| REQ-CORE-002 | `settlement_email.py` | TEST-CORE-002: `tests/test_settlement.py` | implemented |
| REQ-CORE-003 | `settlement_email.py` | TEST-CORE-003: `tests/test_settlement.py` | implemented |

implemented는 구현·테스트 소스 연결을 확인했다는 뜻이며 실제 실행 통과를 의미하지 않는다.

## 13. 미확정 사항

- 동일인 매칭·출석 계산·시트 동기화·실제 메일 전송의 전체 추적성 및 운영 검증은 확인 필요다.
- 미확정 범위 검토 전에는 전체 프로젝트 readiness 완료로 보고하지 않는다.
