# Workflow

## Target selection
<!-- akela: id=target-selection scope=attendance,education,registration tier=must -->
작업 전에 출석 웹앱, 교육 관리, 등록·보고 중 대상 Apps Script 프로젝트 하나를 정한다. 여러 프로젝트 변경이면 각 시트·메일·trigger 영향을 따로 검토한다.

## Local tests
<!-- akela: id=local-tests scope=attendance,education,registration tier=should -->
관련 Node 정적 테스트를 실행한다. 로컬 테스트는 실제 Sheets, 메일, 권한, trigger, 배포를 검증하지 않는다는 한계를 결과에 명시한다.

## Deployment gate
<!-- akela: id=deployment-gate scope=deploy tier=must -->
운영 메일 발송, Sheet 변경, trigger 설치, 웹앱 배포는 명시된 요청 범위에서만 수행한다. 배포는 현재 수동이다.
