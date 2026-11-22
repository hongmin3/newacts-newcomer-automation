# 회기별 군·팀 설정 구현 계획

> 실행 시 writing-plans, test-driven-development를 사용한다. 승인된 기능 사양을 먼저 읽는다.

**목표** 군·팀을 한 번 적용해 사용처를 갱신하고 개편 전 출석을 이어받는다.

**사양** `specs/org-settings.md`, REQ-ATTEND-001, REQ-EDU-002, REQ-REG-002, REQ-REPORT-001, REQ-INTENSIVE-001.

## 공통 계약

- `readOrgConfiguration_(at)`는 해당 유효 시각의 설정을 읽는다. 설정 미연결 또는 최초 적용 전에는 null. 연결과 읽기 실패는 오류다.
- 설정 객체는 `{id, term, effectiveAt, groups: [{key, label, recipient, teams: [string]}]}` 형태다. 적용된 그룹과 팀만 포함한다. `findOrgGroup_(config, value)`는 유일한 약칭이나 표시 이름을 찾는다.
- 모든 실행은 먼저 테스트용 파일 또는 가상 데이터로 확인한다. 운영 Apps Script 및 파일 쓰기는 별도 운영 배포 시점에 진행한다.

## 작업

- [x] 공통 설정 읽기 및 관리자 탭. 시각 기준 조회, 중복 검증, 미리보기와 재개 동작을 시험한다.
- [x] 출석 화면과 등록. 교육관리 원본이나 이전 회기의 확인된 2주차가 3주차로 이어지고 중복 작성하지 않는지 시험한다.
- [x] 교육과 군별 보고. 이전 시각 설정, 소속 변경 이력, 폐지 군 미배정, 다음 실행의 보고 대상을 시험한다.
- [x] 기존 안내도와 집중교육 폼. 안정적인 파일 ID, 변경된 선택지, 실패 후 재실행을 시험한다.
- [x] `npm test`, 준비 검사, 사양 HTML 재생성과 Python 검증을 마쳤다.
- [ ] 운영 파일 연결과 배포는 별도 작업에서 확인한다.
