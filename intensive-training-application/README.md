# 새가족 집중교육 신청 자동화

팀장·목양리더가 참석자 한 명당 Google Form을 한 번 제출하면 관리자 명단과 공개 확인 명단을 실시간으로 갱신하는 독립 Apps Script 프로젝트입니다.

## 운영 링크

- [집중교육 신청 Form](https://docs.google.com/forms/d/e/1FAIpQLSc0KjicIwnqOMf6VdzmaAp834L_utpg4PCyxwsqqyuYDNpyvg/viewform)
- [신청자 현황 공개 확인 시트](https://docs.google.com/spreadsheets/d/1dZbp9oHvcWEuWrDhATK3obLC_8rUb_M1jzH9UC8tOM0/edit)

집중교육 신청 Form 제출이 완료되면 신청자 현황은 위 공개 확인 시트에서 확인하면 됩니다. 공개 시트에는 군, 팀, 참석자 이름, 신청자 이름만 표시되며 전화번호·이메일·계정·응답 ID는 포함하지 않습니다.

관리자 Spreadsheet와 시스템 폴더 링크는 개인정보 보호를 위해 저장소에 기록하지 않습니다.

## 구조

```text
집중교육 신청 Form
  └─ 참석자 1명 = 응답 1건
       │ 관리자 Spreadsheet의 onFormSubmit
       ├─ 집중교육_신청자_관리: Form 원문 + 정규화된 전화번호
       ├─ 관리용_명단: 중복 의심·처리상태 포함
       └─ 공개 확인 Spreadsheet
            └─ 신청확인명단: 군 → 팀 → 참석자 이름 정렬, 전화번호 없음
```

- 군은 9개이며 각 군 선택 후 해당 군의 팀 Section으로만 이동합니다.
- Form에는 `명군/총군/전군`처럼 표시하지만 관리자·공개 시트에는 `명/총/전`처럼 `군`을 제외해 저장합니다.
- 팀 선택 후 참석자 정보 Section으로 이동하므로 잘못된 군/팀 조합을 선택할 수 없습니다.
- 전화번호는 `010xxxxxxxx` 또는 `010-xxxx-xxxx`만 허용하며 제출 후 하이픈 형식으로 정규화합니다.
- 관리자 파일과 시스템 폴더는 소유자 전용 비공개, 공개 확인 시트만 `링크가 있는 모든 사용자: 뷰어`입니다.
- 관리자 명단은 참석자 이름과 전화번호가 모두 같은 이전 신청을 `중복 의심`으로 표시합니다.

## 설치와 재설치

Apps Script 프로젝트 ID는 `1CRE913FQ73aVI2D2ol03-7vUAMJLIiD2-f64L2YL0fqHayAmSG_3ceZy`입니다.

1. Apps Script의 `Code.gs`에 이 디렉터리의 `Code.gs`를 반영합니다.
2. 최초 설치는 `setupSystem()`을 한 번 실행합니다.
3. 실행 로그의 `검증 완료` 메시지를 확인합니다.
4. 기존 설치를 새로 만들 때만 `resetSystemProperties()`을 먼저 실행합니다.
5. 초기화는 속성과 트리거만 제거합니다. 기존 시스템 폴더와 파일은 Drive에서 별도로 정리해야 합니다.

`setupSystem()`은 다음을 자동 수행합니다.

- My Drive 루트에 비공개 시스템 폴더 생성
- Form 1개, 관리자 Spreadsheet 1개, 공개 Spreadsheet 1개 생성
- 모든 군→팀→참석자 Section 분기 구성
- 공개 시트에만 링크 읽기 권한 설정
- 관리자 Spreadsheet Form-submit 트리거 설치
- 파일 수, 공유 권한, 시트 구성, 공개 헤더, 전체 분기, 트리거 자체 검증

설치 도중 검증이 실패하면 해당 실행에서 새로 만든 파일과 폴더를 휴지통으로 보내 반쪽 설치와 중복 생성을 방지합니다.

## 검증 기록

2026-08-29 실제 Form에서 `신군 → 아가` 경로로 테스트 응답을 제출해 다음을 확인했습니다.

- 숫자만 입력한 전화번호가 관리자 원문과 관리 명단에서 `010-0000-0000`으로 정규화됨
- 관리 명단에 `정상` 상태로 실시간 추가됨
- 공개 확인 시트에는 전화번호 없이 즉시 추가됨
- 테스트 행은 검증 직후 세 시트에서 제거됨

로컬 정적·단위 검증은 저장소 루트에서 실행합니다.

```bash
node tests/intensive-training-application.test.js
```
