# 원본 설치형 트리거

2026-08-12 Apps Script 트리거 화면에서 확인한 설정입니다.

| 프로젝트 | 함수 | 일정 | 실패 알림 |
|---|---|---|---|
| 등록 프로젝트 | `runAllAutomationTrigger` | 매주 월요일 08:00~09:00 | 즉시 |
| 등록 프로젝트 | `runSystem` | 매주 금요일 11:00~12:00 | 매일 |
| 교육 프로젝트 | `main` | 매주 화요일 17:00~18:00 | 즉시 |
| 교육 프로젝트 | `main` | 매주 금요일 09:00~10:00 | 매일 |
| 교육 프로젝트 | `sendNewcomerNotifications` | 매주 토요일 08:00~09:00 | 즉시 |
| 집중교육 신청 프로젝트 | `onFormSubmitHandler` | Form이 연결된 관리자 Spreadsheet에 응답 제출 시 | 즉시 |

> 트리거 구성은 2026-09-19 코드 반영 후에도 그대로입니다. 함수명을 바꾸지 않았으므로
> 재설정할 항목은 없습니다. 출석 웹앱만 버전 7로 새로 배포했습니다.

## 수동 함수

- `previewEducationDetailedReport`: 교육 상세 메일 본문을 시트·메일 변경 없이 확인
- `sortAttendanceSourceNewestFirst`: 출석 응답 시트를 타임스탬프 최신순으로 1회 정렬
- `sortEducationManagementNewestFirst`: 교육 출석 현황과 로그를 최신순으로 1회 정렬
- `migrateEducationCursorAndProcessPending`: 행 번호 커서를 시각 커서로 이전하며 미처리분 반영
- `syncIntensiveTraining`: 집중교육 출석 반영
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
