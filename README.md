# 뉴액츠 새가족·교육 통합 자동화

Google Sheets에 연결된 두 Apps Script 프로젝트의 원본을 보존하고, 안전하게 개선하기 위한 저장소입니다.

현재 커밋은 2026-08-12 기준 Apps Script 편집기에 저장되어 있던 **원본 코드 스냅샷**입니다. 원본의 동작을 보존하기 위해 수신자 주소, 스프레드시트 ID, 기존 로직을 수정하지 않았습니다. 따라서 원본 함수를 로컬 검토 없이 직접 실행하지 마세요.

## 프로젝트 구성

- `registration-project/`: `2026년 뉴액츠 청년부 등록 새가족 현황`에 연결된 프로젝트
- `education-project/`: `뉴액츠 새가족부 교육관리`에 연결된 프로젝트
- `docs/current-architecture.md`: 시트 연결 구조와 현재 데이터 흐름
- `docs/current-triggers.md`: 설치형 트리거 원본 설정

## 연결된 문서

1. 등록·정착 관리: `2026년 뉴액츠 청년부 등록 새가족 현황`
2. 교육 관리: `뉴액츠 새가족부 교육관리`
3. 교육 입력 원본: `2026년 새가족교육 출석 (응답)`

## 주의

원본 코드에는 여러 실사용 메일 수신자가 설정되어 있습니다. `main`, `runSystem`, `sendWeeklyReports`, `sendNewcomerNotifications` 등의 함수를 실행하면 실제 메일이 발송될 수 있습니다. 개선본 검증 시에는 테스트 모드에서 `ksj747172@gmail.com` 한 주소만 사용합니다.

## 원본 Apps Script 프로젝트

- 등록 프로젝트 스크립트 ID: `1ZUvqTsXt0HwODX0Byi7GYWnNa75uTJ0ViKxP2vBUYl7KyM9-VriLQjK9`
- 교육 프로젝트 스크립트 ID: `1FkpwxV8uFORcOMqTO19rrMB2ifEfFAmK7aXu1pI8p5eT0_HMX-o4brJc`

## 변경 정책

1. 원본 스냅샷은 첫 커밋으로 보존합니다.
2. 개선본은 로컬 및 Apps Script에서 검증하되 사용자 승인 전에는 커밋하지 않습니다.
3. 테스트 메일은 한 명에게만 발송합니다.
4. 개인정보가 포함된 테스트 데이터는 저장소에 커밋하지 않습니다.

