# 뉴액츠 새가족·교육 통합 자동화

Google Sheets에 연결된 두 Apps Script 프로젝트의 원본을 보존하고, 안전하게 개선하기 위한 저장소입니다.

첫 커밋(`73c2e5d`)은 2026-08-12 기준 Apps Script 편집기에 저장되어 있던 **원본 코드 스냅샷**입니다. 현재 작업 트리에는 검토 중인 개선본이 있으며, 사용자 승인 전에는 두 번째 커밋을 만들지 않습니다.

## 프로젝트 구성

- `registration-project/`: `2026년 뉴액츠 청년부 등록 새가족 현황`에 연결된 프로젝트
- `education-project/`: `뉴액츠 새가족부 교육관리`에 연결된 프로젝트
- `docs/current-architecture.md`: 시트 연결 구조와 현재 데이터 흐름
- `docs/current-triggers.md`: 설치형 트리거 원본 설정
- `docs/enhanced-architecture.md`: 개선본 구조, 안전 모드, 실행 절차
- `docs/settlement-monthly-email-analysis.md`: 정착률 월간 실행·메일 자동화 분석

## 연결된 문서

1. 등록·정착 관리: `2026년 뉴액츠 청년부 등록 새가족 현황`
2. 교육 관리: `뉴액츠 새가족부 교육관리`
3. 교육 입력 원본: `2026년 새가족교육 출석 (응답)`

## 주의

개선본은 사용자 승인과 테스트를 거쳐 `active: true`, `mode: 'PRODUCTION'`으로 운영 전환했습니다. 테스트 전용 함수는 메일 수신자를 `ksj747172@gmail.com` 한 주소로 강제하며, 운영 트리거는 원본의 관리자·군 담당자 수신 목록을 그대로 사용합니다.

## 원본 Apps Script 프로젝트

- 등록 프로젝트 스크립트 ID: `1ZUvqTsXt0HwODX0Byi7GYWnNa75uTJ0ViKxP2vBUYl7KyM9-VriLQjK9`
- 교육 프로젝트 스크립트 ID: `1FkpwxV8uFORcOMqTO19rrMB2ifEfFAmK7aXu1pI8p5eT0_HMX-o4brJc`

## 변경 정책

1. 원본 스냅샷은 첫 커밋으로 보존합니다.
2. 개선본은 로컬 및 Apps Script에서 검증하되 사용자 승인 전에는 커밋하지 않습니다.
3. 테스트 메일은 한 명에게만 발송합니다.
4. 개인정보가 포함된 테스트 데이터는 저장소에 커밋하지 않습니다.

## 현재 상태

- 원본: GitHub 비공개 저장소 `hongmin3/newacts-newcomer-automation`의 `main`에 보존
- 개선 코드: 로컬과 두 Apps Script 프로젝트에 저장됨
- 자동 실행: `active: true`, `mode: 'PRODUCTION'`으로 승인된 운영 트리거 활성화
- 실행 테스트: 2026-08-12 사용자 승인 후 TEST 모드로 완료
- 테스트 메일: `[TEST]` 제목의 네 종류가 `ksj747172@gmail.com`에 도착함
- 개선본 커밋: 최종 승인에 따라 생성·푸시 예정
