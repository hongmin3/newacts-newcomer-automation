# 뉴액츠 새가족 자동화 AI 인덱스

Follow `akela/PROTOCOL.md` for every task. 프로젝트 도메인 규칙은 compile된 slice를 기준으로 사용한다.

## 목적과 구조

Google Sheets 기반 새가족 출석, 교육, 등록 명단, 수료·결산 보고를 세 개의 Apps Script 프로젝트로 운영한다.

- 출석 웹앱: `attendance-webapp/Code.gs`, `Index.html`
- 교육 관리: `education-project/`
- 등록·보고: `registration-project/`
- 정적 테스트: `tests/`
- 현재 구조·트리거·안전 절차: `docs/`
- 사람용 운영 설명: `README.md`

각 디렉터리는 실제로 서로 다른 Apps Script 프로젝트에 대응한다. 같은 프로젝트 안의 `.gs` 파일은 전역 설정과 공통 함수를 공유한다.

## 작업 시작 순서

1. 이어지는 작업이면 `progress.md`를 확인한다.
2. 요청 대상 Apps Script 프로젝트 하나를 정한다.
3. 구조 질문은 `docs/current-architecture.md`, 트리거 질문은 `docs/current-triggers.md`만 필요할 때 읽는다.
4. 코드 변경 전 시트·메일·트리거 영향과 검증 방법을 명시한다.

## 테스트

```bash
node tests/attendance-webapp.test.js
node tests/education-notification.test.js
```

로컬 테스트는 실제 Sheets, 메일, 권한, 트리거를 검증하지 않는다. 배포는 현재 수동이며 사용자의 명시적 요청 없이 실행하지 않는다.

## 변경 금지 및 운영 안전

- `active`, `mode`, 운영 수신자, 시트 ID·이름·열 위치, 트리거 함수명을 임의 변경하지 않는다.
- `run*Test`라는 이름만 믿지 않는다. 현재 모드를 자동으로 TEST로 바꾸지 않으므로 실제 실행 전에 README의 안전 절차를 확인한다.
- 운영 메일 발송, 시트 변경, 트리거 설치, 웹앱 배포는 명시적 승인 범위에서만 수행한다.
- 개인정보 명단이나 실행 결과를 저장소에 추가하지 않는다.
- 공통 설정·함수 의존성이 있는 파일을 독립 스크립트로 분리하지 않는다.

## 컨텍스트 효율

- 제외: `.git/`, `.clasp.json`, `.clasprc.json`, `node_modules/`, `coverage/`, `dist/`, 개인정보·실행 로그.
- 세 프로젝트의 모든 `.gs`를 한 번에 읽지 않고 요청 대상 파일의 함수부터 `rg`로 찾는다.
- 과거 테스트 결과 문서는 회귀 이력 확인이 필요할 때만 읽는다.
- READ-ONCE를 적용하고 수정 후 전체 파일보다 diff와 관련 Node 테스트를 확인한다.
- 정상 로그 전체를 출력하지 않고 실패 메시지와 최종 결과만 확인한다.

## 상세 문서 라우팅

- 현재 데이터 흐름: `docs/current-architecture.md`
- 트리거와 수동 함수: `docs/current-triggers.md`
- 안전 모드·운영 절차: `docs/enhanced-architecture.md`
- 웹앱 보강·롤백: `docs/attendance-webapp-hardening.md`
- 과거 검증 결과: `docs/test-results-2026-08-12.md`
- 결산 메일 분석: `docs/settlement-monthly-email-analysis.md`
