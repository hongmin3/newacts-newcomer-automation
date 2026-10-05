# 새가족 정착률 자동화

`등록 새가족` 시트의 명단을 디모데 교인 상세페이지와 대조하고, 등록일부터 실행 기준일까지의 주일 출석률을 계산해 같은 스프레드시트의 `정착률` 탭을 갱신합니다.

## Mac 빠른 시작

Apple Silicon Mac에서는 사용자 `Applications` 폴더의 `새가족 정착률.app`을 더블클릭합니다.
앱에 Python과 Chromium이 포함되어 있어 사용할 때 패키지를 설치할 필요가 없습니다.

1. Google OAuth 인증 파일과 디모데 계정·암호, 명단 기간을 준비합니다.
2. 최초 설정 화면에서 인증 파일을 선택하고 로그인을 승인합니다. 암호는 Mac 키체인에 저장합니다.
3. 인증 완료 후 조회와 시트 갱신이 시작됩니다. 이후 실행은 Asia/Seoul 당일 기준으로 시작합니다.
4. 군별 결과와 메일 미리보기를 확인합니다. 메일은 선택한 보고서의 발송 버튼을 눌렀을 때만 보냅니다.

`1명 시험 조회`를 선택하면 인증 뒤 한 명만 조회합니다. 시트 변경과 메일 발송 없이 시험 이력으로 저장하며, 전체 조회는 `새 조회 시작`을 눌러 시작합니다.
Google 승인이 만료되었거나 계정을 바꾸려면 `인증 다시 설정`을 누릅니다. 앱의 월별 이력 표는 실행하지 않은 달을 `미실행`으로 표시합니다.

설정·인증 토큰·CSV·SQLite 이력은 `~/Library/Application Support/NewactsSettlement/`,
로그는 `~/Library/Logs/NewactsSettlement/`에 오류 종류·단계·진단 번호만 기록합니다. 앱을 이동하거나 교체해도 이 폴더는 유지됩니다.
기존 Windows 예약 실행·발송 상태를 확인한 뒤 운영을 전환합니다. Mac 예약 실행은 제공하지 않습니다.
현재 앱의 실제 Google·디모데 인증, 운영 시트 갱신과 메일 도착은 미확인입니다.

### Mac에서 확인할 시트

조회가 완료되면 기존 `정착률` 탭과 함께 다음 시트를 갱신합니다.

| 시트 | 확인하는 내용 |
|---|---|
| `군별 정착 현황` | 기준일별 인원·조회 완료율·누적 및 최근 4주 출석률·전월 차이 |
| `정착률 월별 이력` | 군·월·산식 버전별 마지막 정상 결과와 전월 차이 |
| `새가족 돌봄 기록` | 확정된 디모데 ID로 연결한 새가족의 이름·군과 담당자 기록 |

`새가족 돌봄 기록`의 담당자·연락일·진행 상태·다음 확인일·메모는 사람이 입력하며 자동 갱신이 덮어쓰지 않습니다. 군이 바뀌어도 같은 디모데 ID의 기록을 이어갑니다. 기존 관리 탭의 열 구성이나 소유 표시가 맞지 않으면 갱신을 멈추고 확인을 요청합니다.

### 개발자 빌드와 검증

Apple Silicon macOS 13 이상, Python 3.14 환경에서 저장소 루트에서 실행합니다.

```bash
python3 -m venv settlement-automation/.venv
settlement-automation/.venv/bin/python -m pip install -r settlement-automation/requirements-mac.lock
PLAYWRIGHT_BROWSERS_PATH=settlement-automation/.venv/playwright-browsers settlement-automation/.venv/bin/python -m playwright install chromium
QT_QPA_PLATFORM=offscreen settlement-automation/.venv/bin/python -B settlement-automation/tests/run_tests.py
settlement-automation/build_mac.sh
```

빌드는 `settlement-automation/dist/새가족 정착률.app`을 만듭니다. 서명은 로컬 실행용이며 공증은 하지 않았습니다.
개발자 자체 검사는 제품 화면에 표시하지 않으며 임시 사용자 데이터와 가짜 외부 연결만 사용합니다.

```bash
"settlement-automation/dist/새가족 정착률.app/Contents/MacOS/NewactsSettlement" --self-test
```

## 계산 기준

- `12/28`은 `2025-12-28`, `1/4` 이후 월/일은 2026년으로 해석합니다.
- 등록일을 포함하여 기준일까지 실제로 있었던 일요일 수가 분모입니다.
- 같은 기간 디모데 상세페이지 `출결사항 > 주일`에서 체크된 일요일 수가 분자입니다.
- 정착률 = 출석 일요일 / 대상 일요일입니다.
- 디모데 화면의 연간 출석률은 사용하지 않고 등록일 이후 구간을 다시 계산합니다.
- 전화번호가 있으면 `이름+전화번호`, 없거나 불일치하면 `이름+군+청년 A/B`가 한 명일 때만 동일인으로 확정합니다.

## 결과 시트

`정착률` 탭에는 다음이 생성됩니다.

- 전체 인원·조회 완료·총 대상 주일·총 출석·전체 정착률
- 군별 인원·조회 완료·출석 합계·군 정착률
- 군/팀 순으로 정렬된 개인별 상세 표
- 팀명 뒤 괄호 표기는 자동 제거 (`주품 (황수현)` → `주품`)
- 개인별 등록일, 대상 일요일, 출석 일요일, 정착률, 최근 4주 출석, 조회 상태
- 정착률 색상: 70% 이상 초록, 40~70% 노랑, 40% 미만 빨강, 미조회 회색

색상은 판정 등급이 아니라 빠른 확인을 위한 시각 표시입니다.

## 설치

PowerShell에서 다음을 실행합니다.

```powershell
cd 'C:\Users\2024980\Documents\자동화\projects\newacts-newcomer-automation\settlement-automation'
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python -m playwright install chromium
Copy-Item config.example.py config.py
```

기존 `config.py`가 있다면 덮어쓰지 마세요.

Google Cloud에서 Sheets API를 활성화하고 Desktop OAuth 클라이언트 JSON을 내려받아 이 폴더에 `credentials.json`으로 둡니다. 최초 실행 때 Google 승인을 완료하면 `token.json`이 생성됩니다.

## 실행

먼저 1명만 CSV로 시험합니다. 디모데 로그인 정보가 비어 있으면 열린 Chromium 창에서 직접 로그인하면 됩니다.

```powershell
python main.py --limit 1 --no-sheet-write
```

시험 결과는 `output\settlement_result.csv`에 저장됩니다. 확인 후 전체 결과를 구글시트에 반영합니다.

```powershell
python main.py
```

특정 기준일로 재현하려면 다음처럼 실행합니다.

```powershell
python main.py --as-of 2026-08-12
```

## 매월 마지막 화요일 자동 실행

Windows 작업 스케줄러는 매주 화요일 오전 9시에 `run_monthly.ps1`을 호출합니다. 프로그램이 7일 뒤의 달이 바뀌는지 검사하므로 실제 디모데 조회·시트 갱신·메일 발송은 매월 마지막 화요일에만 실행됩니다.

운영 메일은 전체 현황을 관리자에게 보내고, 신·조·명·총·석·전·영·슬·임군은 기존 새가족 자동화와 같은 군별 수신자에게 각각 보냅니다. 월별 발송 기록으로 중복 실행을 막으며 조회 완료율이 95% 미만이면 메일을 보내지 않습니다.

```powershell
.\run_monthly.ps1
```

승인된 테스트는 날짜 조건을 건너뛰고 전체 및 모든 군별 보고서를 테스트 수신자 한 명에게만 보냅니다.

```powershell
.\.venv\Scripts\python.exe main.py --monthly --force-monthly --headless --test-email
```

현재 PC에는 작업 스케줄러 항목 `새가족 정착률 월말 자동화`가 등록되어 있습니다. 매주 화요일 오전 9시에 날짜를 검사하며, 실제 전체 조회와 운영 메일은 마지막 화요일에만 실행됩니다. PC가 예약 시각에 꺼져 있으면 다음 시작 시 가능한 즉시 실행하도록 설정되어 있습니다.

메일은 기존 새가족교육 보고서와 같은 가운데 정렬 HTML 표 형식을 사용합니다.

- 전체: 전체 요약 카드, 군별 정착률 표, 시트 링크 (개인 명단 제외)
- 군별: 해당 군 요약 카드와 개인 명단
- 개인 명단: 이름, 팀, 등록일, 대상 주일, 출석 주일, 정착률, 최근 4주, 조회 상태
- 테스트 모드: 전체 및 모든 군별 보고서를 `TEST_RECIPIENT` 한 곳으로만 발송
- 운영 모드: 관리자 및 기존 군별 수신자에게 각각 발송

## 2026-08-14 승인 테스트

- 전체 421명 조회 및 `정착률` 탭 갱신 완료
- 조회 완료 402명(95.5%), 전체 정착률 49.1%
- 팀명 괄호 표기 0건 확인
- 전체 1통과 군별 9통, 총 10통을 테스트 수신자 한 명에게 발송 완료
- 피드백 반영 후 전체 메일에서 421명 개인 명단을 제거하고 요약 전용으로 재검증
- 운영 수신자에게는 테스트 메일을 발송하지 않음

## 2026-08-14 운영 발송

- 정착률을 다시 조회하거나 시트를 다시 쓰지 않고, 검증 완료된 2026-08-14 CSV 사용
- 전체 관리자 5명에게 전체 요약 메일 1통 발송
- 9개 군 담당자에게 해당 군 명단 메일 각 1통 발송
- 총 10통 운영 발송 완료

## 안전 장치

- 교인을 한 명으로 확정하지 못하면 출석률을 만들지 않고 상태와 사유만 기록합니다.
- 디모데에는 어떤 값도 저장하지 않습니다. 출결 체크박스도 읽기 전용입니다.
- 원본 `등록 새가족` 탭은 수정하지 않습니다.
- 기존 Windows CLI는 `정착률` 탭만 전체 갱신합니다. Mac 앱은 위의 세 관리 시트도 갱신하며 돌봄 기록의 수동 입력 열을 보존합니다.
- 자격 증명과 실행 결과는 `.gitignore`에 포함되어 있습니다.

## AI 에이전트 Context 관리 (Akela)

이 프로젝트는 [Akela](https://github.com/TimothyHan/akela)를 사용해 Codex/Claude Code 같은 AI 에이전트가 작업할 때 전체 문서를 다 읽는 대신 필요한 지식만 골라 압축된 컨텍스트로 제공받습니다. 런타임 의존성이 아니며 실행/배포 동작에는 전혀 영향을 주지 않습니다.

- Knowledge: `knowledge/`
- Protocol: `akela/PROTOCOL.md`
- 설정: `akela.json`

작업 종류(activity)별로 관련 지식만 컴파일해서 사용하므로 매 작업마다 전체 문서를 컨텍스트에 넣을 때보다 토큰 사용량이 크게 줄어듭니다. 기본 흐름:

knowledge/ → `akela compile` → 작업별 slice.md → Codex/Claude 작업 → `akela log`로 Evidence 기록 → `akela stats`/curate로 지식 유지보수
