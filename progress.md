# Progress

- 현재 목표: 없음
- 완료한 작업: 운영 Apps Script ↔ 저장소 드리프트 해소, 메일 안전장치·숨김 로그 복구, 동기화 도구 도입, 운영 반영(웹앱 버전 7), README 최신화
- 진행 중 작업: 없음
- 남은 작업: 없음
- 중요한 설계 결정:
  - 저장소가 운영보다 뒤처져 있었으므로 운영 코드를 기준으로 맞춘 뒤 그 위에서 고도화했다.
  - 자동화 로그는 기록하되 시트를 숨겨 운영 화면에 노출하지 않는다.
  - 월요일 메일 1명 수신과 상반기 방문자 동기화 중지는 의도된 설정이라 유지한다.
  - `scripts/apps-script.mjs`로 diff/pull/push/deploy를 수행해 드리프트 재발을 막는다.
- 변경 파일: 네 프로젝트의 `.gs`/`appsscript.json`, `scripts/`, `tests/`, `package.json`, `README.md`, `docs/current-triggers.md`
- 알려진 문제: 없음
- 다음 세션 시작점: `npm run diff`로 운영과의 일치 확인 후 대상 프로젝트 선택
