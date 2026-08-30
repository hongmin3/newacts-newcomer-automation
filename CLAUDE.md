# CLAUDE.md

Follow `akela/PROTOCOL.md` for every task.

## Project Root 탐색 규칙

`education-project/`, `registration-project/` 등 하위 폴더에서 작업하든 항상 이 프로젝트 루트의 `akela.json`/`knowledge/`를 사용하고, 하위 폴더에 별도 akela 구조를 만들지 않는다. 현재 작업 디렉터리가 하위 폴더라면 `scripts/find-project-root.ps1`로 프로젝트 루트를 먼저 찾는다.

## 커밋 정책 (재강조)

이 저장소는 원본 Apps Script 스냅샷을 보존하고 개선본을 검증하는 저장소다. README의 "변경 정책"과 `knowledge/change-policy.md`에 명시된 대로:

- **사용자 승인 전에는 커밋하지 않는다.** 개선본은 로컬/Apps Script에서 검증만 하고, 사용자의 명시적 승인이 있을 때만 커밋·push한다.
- 테스트 메일은 반드시 `ksj747172@gmail.com` 한 명에게만 발송한다.
- 개인정보(교인 명단, 전화번호 등)가 포함된 테스트 데이터는 절대 커밋하지 않는다.
- 운영 전환 시에는 반드시 `active: true`, `mode: 'PRODUCTION'` 플래그 상태를 확인한다.
- `education-project/`, `registration-project/` 내부의 `.gs` 소스 파일은 직접 수정하지 않는다.

자세한 내용과 최신 근거는 항상 `akela compile`로 컴파일된 slice를 통해 확인하고, 원본 근거는 `docs/`와 `README.md`를 참조한다.
