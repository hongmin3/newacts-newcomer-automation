# Architecture

## Project boundaries
<!-- akela: id=project-boundaries scope=attendance,education,registration,deploy tier=must -->
`attendance-webapp/`, `education-project/`, `registration-project/`는 서로 다른 Apps Script 프로젝트다. 한 디렉터리 안의 `.gs` 파일은 전역 설정과 공통 함수를 공유하므로 독립 script로 임의 분리하지 않는다.

## Data effects
<!-- akela: id=data-effects scope=attendance,education,registration tier=must -->
이 자동화는 Google Sheets의 명단·출석·교육·등록·보고 데이터와 메일을 다룬다. 시트 구조와 수신자는 Runtime contract로 취급한다.

## Documentation routing
<!-- akela: id=documentation-routing scope=attendance,education,registration,deploy tier=should -->
현재 흐름은 `docs/current-architecture.md`, trigger는 `docs/current-triggers.md`, 안전 절차는 `docs/enhanced-architecture.md`에서 요청에 필요한 절만 확인한다.
