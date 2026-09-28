# 운영 절차

> **참고** 이 문서의 명령은 모두 저장소의 `settlement-automation/` 폴더에서 실행한다. 가상환경(`.venv`)과 인증 파일도 그 폴더에 둔다.

## 설치
<!-- akela: id=setup -->


1. `python -m venv .venv` 로 가상환경을 만들고 `.\.venv\Scripts\Activate.ps1` 로 활성화합니다.
2. `python -m pip install -r requirements.txt` 로 의존성을 설치합니다.
3. `python -m playwright install chromium` 으로 브라우저를 설치합니다.
4. `config.example.py` 를 `config.py` 로 복사해 실행 환경 설정값(스프레드시트 URL, 시트 이름, 디모데 URL, 발송 관련 임계값 등)을 채웁니다. 기존 `config.py`가 있으면 덮어쓰지 않습니다.

## 인증 파일 (내용은 다루지 않음)
<!-- akela: id=auth-files -->


- `settlement-automation/` 폴더에 `credentials.json`(Google Cloud Desktop OAuth 클라이언트 JSON)과 `token.json`(최초 로그인 승인 후 자동 생성되는 토큰)이 필요합니다.
- 두 파일은 개인/기관 인증 정보이므로 `.gitignore`에 등록되어 커밋 대상에서 제외되어 있고, 어떤 문서나 knowledge 파일에도 내용을 기록하지 않습니다.
- 디모데 로그인 정보(`USER_ID`/`USER_PW`)를 비워 두면 실행 시 열리는 Chromium 창에서 직접 로그인합니다.

## 시험 실행
<!-- akela: id=trial-run -->


전체 실행 전에 1명만 CSV로 시험합니다.

```powershell
python main.py --limit 1 --no-sheet-write
```

결과는 `output\settlement_result.csv`에 저장되며, 확인 후에만 전체 실행으로 넘어갑니다.

## 전체 실행
<!-- akela: id=full-run -->


```powershell
python main.py
```

특정 기준일로 재현하려면:

```powershell
python main.py --as-of 2026-08-12
```

## 월간 자동 실행 (`run_monthly.ps1`)
<!-- akela: id=monthly-run -->


- Windows 작업 스케줄러가 매주 화요일 오전 9시에 `run_monthly.ps1`을 호출합니다.
- 프로그램 내부에서 7일 뒤 기준으로 "월이 바뀌는지"를 검사하므로, 실제 디모데 조회·시트 갱신·메일 발송은 매월 마지막 화요일에만 수행됩니다.
- `run_monthly.ps1`은 가상환경의 Python으로 `main.py --monthly --headless --send-email`을 실행합니다.
- 월별 발송 기록을 남겨 같은 달에 중복 실행/중복 발송되지 않도록 막습니다.
- 조회 완료율이 설정된 최소 기준(`MIN_QUERY_COMPLETION_RATE`) 미만이면 메일을 보내지 않습니다.

## 승인 테스트 실행
<!-- akela: id=approval-test-run -->


날짜 조건을 건너뛰고 전체 및 모든 군별 보고서를 테스트 수신자 한 명에게만 보냅니다.

```powershell
.\.venv\Scripts\python.exe main.py --monthly --force-monthly --headless --test-email
```

## 발송 대상
<!-- akela: id=email-recipients -->


- 운영 메일: 전체 현황은 관리자에게, 군별 명단은 각 군 담당 수신자에게 각각 발송합니다.
- 테스트 모드에서는 전체 및 모든 군별 보고서가 설정된 테스트 수신자 한 곳으로만 발송됩니다.

## 주요 실행 옵션
<!-- akela: id=cli-options -->


- `--as-of` : 기준일 지정(YYYY-MM-DD), 기본값은 오늘
- `--limit` : 시험 실행할 최대 인원 수
- `--only-name` : 특정 인원만 시험 실행
- `--no-sheet-write` : 시트에 쓰지 않고 CSV만 생성
- `--retry-unmatched` : 이전 결과에서 미확인 인원만 재조회 후 병합
- `--send-email` : 시트 갱신 성공 후 정착률 메일 발송
- `--test-email` : 모든 보고서를 테스트 수신자에게만 발송
- `--monthly` / `--force-monthly` : 마지막 화요일 조건 검사 및 강제 실행
- `--headless` : 예약 작업용 숨김 브라우저 실행
- `--email-from-csv` : 검증 완료된 기존 CSV로 조회 없이 메일만 발송
