# REST 운영 미리보기 설정

담당자가 터미널에서 등록 보정과 수료현황의 반영 예정 집계를 읽는 경로다. 실제 보정·수료 갱신·메일 함수는 호출하지 않는다.

## 현재 운영 상태

2026-10-29에 표준 Cloud 연결, 전용 Desktop OAuth 인증, 본인만 호출하는 실행 API 배포를 구성했다. `doctor`와 두 미리보기를 터미널 REST 호출로 실행해 완료 응답을 확인했다.

등록·수료 시트의 전체 값과 스크립트 속성을 실행 전후로 대조해 변경이 없음을 확인했다. 기존 예약 함수 두 개가 유지되고 Cloud 전환 뒤 소유자 계정의 편집기 미리보기도 완료됐다. 예약 실행 자체와 메일 도착은 이번 검증에서 실행하지 않았다.

Chrome의 Cloud 인증 화면에서 발생한 `Failed to load`는 Safari로 접근해 해결했다. 비밀 인증값과 실행 배포 ID는 Mac의 개인 설정에만 보관한다. 공용 clasp 인증과 기존 Windows용 OAuth 클라이언트는 바꾸지 않았다.

2026-10-29에 OAuth 앱을 ‘프로덕션 단계’(`In production`)로 게시하고 게시 뒤 발급한 새 인증을 연결했다. 테스트 상태의 7일 갱신 토큰 제한이 적용되지 않는 구성이다. 실행 API 접근은 계속 본인만(`MYSELF`)이다.

[앱 소개](https://newacts-automation-info.secret-drum-8851.chatgpt.site/), [개인정보처리방침](https://newacts-automation-info.secret-drum-8851.chatgpt.site/privacy.html), [이용 안내·약관](https://newacts-automation-info.secret-drum-8851.chatgpt.site/terms.html)을 공개하고 Google 브랜딩에 같은 주소를 저장했다. 공개 페이지에는 업무 명단이나 인증값을 넣지 않는다.

> **참고** 프로덕션 게시와 Google의 앱 검증은 서로 다르다. 현재는 본인용으로 사용하며 Google의 미인증 앱 안내와 사용자 한도가 남아 있다. 접근 철회, 계정 정책 등 [일반적인 인증 만료 조건](https://developers.google.com/identity/protocols/oauth2#expiration)에서는 다시 인증해야 한다. 7일이 지난 뒤의 실행 시험을 했다는 뜻은 아니다.

## 실행 명령

프로젝트 루트에서 다음 명령을 사용한다.

```bash
npm run preview -- registration doctor
npm run preview -- registration maintenance
npm run preview -- registration reporting
```

`doctor`는 인증과 본인 전용 실행 배포를 확인한다. 두 미리보기 명령은 편집기 없이 REST API를 호출하며 집계만 출력한다. 설정이 없거나 실행이 실패하면 종료 코드가 1이다. 자동 재시도나 편집기 실행으로 대신하지 않는다.

## 최초 설정 순서

1. 담당자 소유 표준 Cloud 프로젝트에서 Google Apps Script API를 사용 설정한다.
2. 같은 프로젝트의 OAuth 동의 화면과 Desktop app 클라이언트를 준비하고 JSON을 Mac의 저장소 밖 개인 폴더에 저장한다.
3. 등록 스크립트 개요에 표시되는 OAuth 범위를 확인한다. 실행 요청은 호출할 함수 외에도 스크립트 전체의 범위를 요구한다.
4. 표준 Cloud 프로젝트로 등록 스크립트를 연결한다. 기존 권한 승인이 다시 필요할 수 있으므로 예약 실행 전에 소유자 인증을 완료한다.
5. 접근 범위를 본인만으로 제한한 API 실행 배포를 만들고 배포 ID를 확인한다. 스크립트 ID와 혼동하지 않는다.
6. 아래 최초 인증을 실행한 뒤 `doctor`와 두 미리보기를 실행한다. API 응답이 성공해도 운영 데이터 변경이 없음을 별도로 확인한다.

Cloud 연결·인증·배포 변경은 담당자가 요청한 범위에서 수행한다. OAuth 권한 승인 화면이 나타나면 프로젝트·계정·요청 범위를 확인한다. 현재 공용 clasp 인증 파일은 덮어쓰지 않는다.

[Google 실행 API 설정 안내](https://developers.google.com/apps-script/api/how-tos/execute), [REST 메서드와 배포 ID](https://developers.google.com/apps-script/api/reference/rest/v1/scripts/run)

## 최초 OAuth 인증

이 프로젝트의 Python 가상환경에는 Google OAuth 라이브러리가 있다. `--scope`는 스크립트 개요에서 확인한 범위마다 한 번씩 지정한다. 배포 조회용 범위는 도구가 추가한다.

```bash
settlement-automation/.venv/bin/python -I scripts/apps-script-execution-auth.py \
  --client "$HOME/.config/newacts-apps-script/client.json" \
  --project-number '<표준 Cloud 프로젝트 번호>' \
  --deployment-id '<실행 API 배포 ID>' \
  --scope 'https://www.googleapis.com/auth/spreadsheets' \
  --scope 'https://www.googleapis.com/auth/script.send_mail'
```

2026-10-29 등록 스크립트 개요에서는 위 두 범위를 확인했다. 실제 설정 전에 다시 확인한다. 미리보기만 호출해도 실행 API는 스크립트 전체 범위를 요구하므로 메일 권한이 인증 목록에 포함된다. 미리보기 명령은 메일 함수를 호출하지 않는다.

도구가 출력하는 Google 인증 주소를 브라우저에서 연다. 이 인증은 최초 설정과 접근 철회 등으로 갱신 토큰이 만료된 뒤에 필요하다. 유효한 인증이 있는 동안 미리보기는 브라우저 없이 갱신 토큰을 사용한다. 운영용 인증은 OAuth 앱을 프로덕션으로 게시한 뒤 발급한다. 테스트 중에 받은 토큰은 새 운영 인증으로 교체한다. 기존 전용 설정 파일이 있으면 덮어쓰지 않는다. 재인증할 때는 같은 Cloud 번호·실행 배포 ID와 확인한 범위로 `--config`에 별도 개인 파일을 지정한다. 새 파일로 `NEWACTS_EXECUTION_CONFIG`를 지정해 `doctor`와 두 미리보기를 확인한 뒤 사용한다. 기존 파일은 새 인증이 성공할 때까지 보관한다.

생성 위치는 `~/.config/newacts-apps-script/registration.json`이며 파일 권한은 600이다. 다른 위치는 `--config`로 지정하고 미리보기 실행 때 같은 경로를 `NEWACTS_EXECUTION_CONFIG` 환경 변수로 넘긴다. 인증 파일은 저장소 안에 둘 수 없다.

설정에는 `projectNumber`, `deploymentId`, `client_id`, `client_secret`, `refresh_token`이 들어간다. 토큰·비밀값을 채팅이나 Git에 붙이지 않는다.

## 검증 범위

`tests/apps-script-execution.test.js`는 허용 함수 제한, 배포 ID 경로, Cloud 번호 불일치 차단, 토큰 만료, HTTP·실행 오류와 미완료 응답, 집계 출력, 잘못된 최초 인증 입력의 무저장을 확인한다.

합성 검사는 운영 OAuth·배포 성공을 대신하지 않는다. 2026-10-29 실제 실행 결과는 `progress.md`에 기록했다. 미리보기는 `dryRun: true` 결과만 성공으로 처리하며 메일 발송 함수는 호출하지 않는다.
