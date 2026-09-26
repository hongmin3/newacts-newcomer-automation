# 원본 설치형 트리거

2026-08-12 Apps Script 트리거 화면에서 확인한 설정입니다.

| 프로젝트 | 함수 | 일정 | 실패 알림 |
|---|---|---|---|
| 등록 프로젝트 | `runAllAutomationTrigger` | 매주 월요일 08:00~09:00 | 즉시 |
| 등록 프로젝트 | `runSystem` | 매주 금요일 11:00~12:00 | 매일 |
| 교육 프로젝트 | `main` | 매주 화요일 17:00~18:00 | 즉시 |
| 교육 프로젝트 | `sendNewcomerNotifications` | 매주 토요일 08:00~09:00 | 즉시 |
| 집중교육 신청 프로젝트 | `onFormSubmitHandler` | Form이 연결된 관리자 Spreadsheet에 응답 제출 시 | 즉시 |

> 위 표는 2026-08-12 확인 당시 구성입니다. 2026-09-19 코드 반영에서 함수명을 바꾸지 않아
> 재설정할 항목은 없었고, 출석 웹앱만 버전 7로 새로 배포했습니다. 아래 결정으로 바뀌는
> 항목은 그 절에 따로 적습니다.

## 2026-09-19 결정 — 금요일 교육 트리거 제거

교육 출석 반영은 화요일 하루 한 번이면 충분하므로 **금요일 09:00~10:00 트리거를 없앱니다.**
삭제 함수 `removeFridayEducationTrigger`는 교육 프로젝트에 반영·확인 완료 상태입니다. 이 함수는
금요일 `main` 클록 트리거만 지우고 화요일 트리거는 유지하며, 결과 JSON에 지운 트리거와 남은
트리거를 함께 반환합니다. 함수명은 그대로 `main`을 유지하므로 나머지 트리거를 다시 만들 필요가
없습니다.

> **남은 수동 1단계**: 이 계정의 Apps Script 프로젝트는 API 원격 실행(`scripts.run`)이 저장소
> 오류(NOT_FOUND)로 차단되어 있어 API로는 실행할 수 없습니다. 교육 프로젝트 편집기에서
> `removeFridayEducationTrigger`를 **한 번 실행**해 금요일 트리거를 실제로 지우면 됩니다.
> 편집기 실행이 어려우면 트리거 화면에서 금요일 09:00~10:00의 `main` 클록 트리거 하나를 직접
> 삭제해도 같은 결과입니다. 실행 뒤에는 이 표의 금요일 `main` 행을 지우고 이 절의
> "수동 1단계" 안내를 완료로 표시해 주세요.

## 수동 함수

- `previewEducationDetailedReport`: 교육 상세 메일 본문을 시트·메일 변경 없이 확인
- `sortAttendanceSourceNewestFirst`: 출석 응답 시트를 타임스탬프 최신순으로 1회 정렬
- `sortEducationManagementNewestFirst`: 교육 출석 현황과 로그를 최신순으로 1회 정렬
- `migrateEducationCursorAndProcessPending`: 행 번호 커서를 시각 커서로 이전하며 미처리분 반영
- `removeFridayEducationTrigger`: 금요일 `main` 클록 트리거만 삭제(화요일 등 나머지는 유지, 여러 번 실행해도 안전)
- 시트 상단 `집중교육 → 참석 명단 반영`: `0`·`o`·`O`로 표시한 집중교육 참석자를 실제 반영하고 결과 건수를 알림으로 표시
- `syncIntensiveTraining`: 집중교육 출석 반영
- `applyIntensiveTrainingNow`: Apps Script 편집기에서 승인 후 집중교육 출석을 실제 반영(메일 없음, 시트 변경)
- `generateSettlementReport`: 결산 시트 생성 시도
- `setupSystem`: 집중교육 Form·관리자/공개 Spreadsheet·제출 트리거 최초 설치
- `verifySystem`: 집중교육 파일 수·공유 권한·시트·군→팀→참석자 분기·트리거 재검증
- `resetSystemProperties`: 집중교육 설치 속성과 제출 트리거 초기화(Drive 파일은 유지)
- 시트 상단 사용자 메뉴의 군 현황 갱신 함수 (방문자 동기화는 현재 중지 상태로 안내만 표시)

## 확인 당시 최근 실행

- `runAllAutomationTrigger`: 5.74초, 완료
- `runSystem`: 117.442초, 완료
- 화요일 `main`: 287.786초, 완료
- 금요일 `main`: 6.653초, 완료
- `sendNewcomerNotifications`: 14.49초, 완료
