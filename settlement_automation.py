import argparse
import csv
import re
import time
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import config

from settlement_email import (
    already_sent,
    ensure_safe_to_email,
    is_last_tuesday,
    mark_sent,
    send_reports,
)


PROJECT_DIR = Path(__file__).resolve().parent
PERSON_LIST_URL = "https://hansungv6.dimode.co.kr/WebYouth/Person/PersonList.aspx?mTag=MB2"
ATTENDANCE_RADIO_NAME = "ctl00$cph1$PersonModifyYouth1$AttList1$rblYear"
ATTENDANCE_AREA = "#ctl00_cph1_PersonModifyYouth1_accPnAtt"
ARMY_ORDER = ["신", "조", "명", "총", "석", "전", "영", "슬", "임"]
ARMY_ALIASES = {
    "조": {"조", "아너스"},
    "신": {"신", "아하"},
}
DETAIL_HEADERS = [
    "No.", "군", "팀", "이름", "성별", "핸드폰", "등록일", "기준일",
    "대상 일요일", "출석 일요일", "정착률", "최근 4주", "조회 상태", "비고", "디모데 ID",
]


def normalize_text(value):
    return re.sub(r"\s+", " ", str(value or "")).strip()


def normalize_name(value):
    # 시트와 디모데가 동명이인 구분용으로 이름 끝에 붙이는 영문자를 동일하게 제거한다.
    return re.sub(r"\s*[A-Za-z]$", "", normalize_text(value)).strip()


def normalize_army(value):
    value = re.sub(r"\([^)]*\)", "", normalize_text(value)).strip()
    return value[:-1] if value.endswith("군") else value


def normalize_team(value):
    """팀명 뒤 괄호 표기를 제거한다. 예: 주품 (황수현) -> 주품."""
    return re.sub(r"\s*\([^)]*\)\s*", " ", normalize_text(value)).strip()


def equivalent_armies(value):
    normalized = normalize_army(value)
    return ARMY_ALIASES.get(normalized, {normalized})


def format_phone(value):
    digits = re.sub(r"\D", "", str(value or ""))
    if len(digits) == 11:
        return f"{digits[:3]}-{digits[3:7]}-{digits[7:]}"
    if len(digits) == 10:
        return f"{digits[:3]}-{digits[3:6]}-{digits[6:]}"
    return ""


def normalize_birthdate(value):
    digits = re.sub(r"\D", "", str(value or ""))
    return digits[:8] if len(digits) >= 8 else ""


def spreadsheet_id_from_url(url):
    match = re.search(r"/spreadsheets/d/([a-zA-Z0-9_-]+)", url or "")
    if not match:
        raise ValueError("SHEET_URL에서 스프레드시트 ID를 찾을 수 없습니다.")
    return match.group(1)


def parse_registration_date(value):
    """12월은 2025년, 1월 이후는 2026년으로 해석한다."""
    text = normalize_text(value)
    if not text:
        raise ValueError("등록일 없음")
    for fmt in ("%Y-%m-%d", "%Y/%m/%d", "%y%m%d", "%Y%m%d"):
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            pass
    match = re.fullmatch(r"(\d{1,2})[./-](\d{1,2})", text)
    if not match:
        raise ValueError(f"등록일 형식 오류: {text}")
    month, day = map(int, match.groups())
    return date(2025 if month == 12 else 2026, month, day)


def sundays_between(start, end):
    if start > end:
        return []
    first = start + timedelta(days=(6 - start.weekday()) % 7)
    result = []
    current = first
    while current <= end:
        result.append(current)
        current += timedelta(days=7)
    return result


def sundays_in_year(year):
    return sundays_between(date(year, 1, 1), date(year, 12, 31))


GOOGLE_SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/gmail.send",
]


def get_google_credentials():
    client_file = Path(getattr(config, "GOOGLE_OAUTH_CLIENT_FILE", "credentials.json"))
    token_file = Path(getattr(config, "GOOGLE_OAUTH_TOKEN_FILE", "token.json"))
    if not client_file.is_absolute():
        client_file = PROJECT_DIR / client_file
    if not token_file.is_absolute():
        token_file = PROJECT_DIR / token_file
    if not client_file.exists():
        raise RuntimeError(f"Google OAuth 파일이 없습니다: {client_file}")

    from google.auth.transport.requests import Request
    from google.oauth2.credentials import Credentials
    from google_auth_oauthlib.flow import InstalledAppFlow
    from googleapiclient.discovery import build

    credentials = None
    if token_file.exists():
        credentials = Credentials.from_authorized_user_file(str(token_file))
        if not credentials.has_scopes(GOOGLE_SCOPES):
            credentials = None
    if credentials and credentials.expired and credentials.refresh_token:
        credentials.refresh(Request())
    if not credentials or not credentials.valid:
        flow = InstalledAppFlow.from_client_secrets_file(str(client_file), GOOGLE_SCOPES)
        credentials = flow.run_local_server(port=0)
    token_file.write_text(credentials.to_json(), encoding="utf-8")
    return credentials


def get_google_services():
    from googleapiclient.discovery import build

    credentials = get_google_credentials()
    return (
        build("sheets", "v4", credentials=credentials),
        build("gmail", "v1", credentials=credentials),
    )


def load_source_rows(service):
    spreadsheet_id = spreadsheet_id_from_url(config.SHEET_URL)
    sheet_name = getattr(config, "SOURCE_SHEET_NAME", "등록 새가족")
    values = service.spreadsheets().values().get(
        spreadsheetId=spreadsheet_id,
        range=f"'{sheet_name}'!A:T",
    ).execute().get("values", [])
    if not values:
        return []
    headers = values[0]
    rows = []
    for sheet_row, raw in enumerate(values[1:], start=2):
        padded = raw + [""] * (len(headers) - len(raw))
        row = dict(zip(headers, padded))
        if normalize_text(row.get("새신자")) and normalize_text(row.get("날짜")):
            row["_sheet_row"] = sheet_row
            rows.append(row)
    return rows


def parse_person_card(text):
    name_match = re.search(r"이름\s*([^\s(]+)\s*\(", text)
    phone_match = re.search(r"핸드폰\s*([0-9\- ]{10,15})", text)
    birthdate_match = re.search(r"(?:생일/나이|생년월일)\s*([0-9]{4}[-./]?[0-9]{2}[-./]?[0-9]{2})", text)
    army_match = re.search(r"([^\s>(]+군)(?:\([^)]*\))?\s*>\s*([^>\n]+)", text)
    activity_match = re.search(r"교인\s*>\s*청년\s*\(([A-Z])\)", text)
    name = normalize_name(name_match.group(1) if name_match else "")
    return {
        "name": name,
        "phone": format_phone(phone_match.group(1) if phone_match else ""),
        "birthdate": normalize_birthdate(birthdate_match.group(1) if birthdate_match else ""),
        "army": normalize_army(army_match.group(1)) if army_match else "",
        "team": normalize_team(army_match.group(2)) if army_match else "",
        "activity": activity_match.group(1) if activity_match else "",
    }


def reset_person_search(right_frame):
    right_frame.locator(
        "#ctl00_cph1_PersonListYouth1_tabConSch_tabPnSch0_txtNameSch0"
    ).fill("")
    right_frame.locator(
        "#ctl00_cph1_PersonListYouth1_tabConSch_tabPnSch0_txtHandphoneSch0"
    ).fill("")


def search_person_cards(right_frame, *, name="", phone=""):
    reset_person_search(right_frame)
    if name:
        field = right_frame.locator(
            "#ctl00_cph1_PersonListYouth1_tabConSch_tabPnSch0_txtNameSch0"
        )
    else:
        field = right_frame.locator(
            "#ctl00_cph1_PersonListYouth1_tabConSch_tabPnSch0_txtHandphoneSch0"
        )
    field.fill(name or phone)
    right_frame.locator(
        "#ctl00_cph1_PersonListYouth1_tabConSch_tabPnSch0_imgSearch0"
    ).click()
    # ASP.NET 검색 결과 표가 이전 검색에서 새 검색으로 교체될 시간을 확보한다.
    time.sleep(max(1.2, getattr(config, "SEARCH_DELAY", 0.8)))
    return right_frame.locator("table.tablelineno")


def find_exact_person_card(right_frame, row):
    expected_name = normalize_name(row.get("새신자"))
    expected_phone = format_phone(row.get("핸드폰"))
    expected_army = normalize_army(row.get("군"))
    expected_team = normalize_team(row.get("팀"))
    expected_birthdate = normalize_birthdate(row.get("생년월일"))

    if expected_phone:
        cards = search_person_cards(right_frame, phone=expected_phone)
        phone_candidates = []
        for index in range(cards.count()):
            card = cards.nth(index)
            candidate = parse_person_card(card.inner_text())
            if candidate["phone"] == expected_phone:
                phone_candidates.append((card, candidate))

        matches = []
        for card, candidate in phone_candidates:
            organization_changed = (
                candidate["army"] not in equivalent_armies(expected_army)
                or (expected_team and candidate["team"] != expected_team)
            )
            # 군/팀이 달라진 번호 일치는 생년월일까지 같을 때만 이동한 동일인으로 인정한다.
            if not organization_changed or (
                expected_birthdate
                and candidate["birthdate"] == expected_birthdate
            ):
                matches.append((card, candidate))
        if len(matches) > 1 and expected_birthdate:
            birth_matches = [item for item in matches if item[1]["birthdate"] == expected_birthdate]
            if birth_matches:
                matches = birth_matches
        if len(matches) == 1:
            card, candidate = matches[0]
            return card, "전화번호일치", candidate
        if len(matches) > 1:
            return None, "교인복수일치", {"failure_note": "같은 전화번호의 디모데 후보가 여러 명입니다."}

    cards = search_person_cards(right_frame, name=expected_name)
    name_candidates = []
    for index in range(cards.count()):
        card = cards.nth(index)
        candidate = parse_person_card(card.inner_text())
        if candidate["name"] == expected_name:
            name_candidates.append((card, candidate))

    # 이름이 같으면 생년월일을 가장 강한 보조키로 사용한다. 군 이동·활동구분 C도 허용한다.
    birth_matches = [
        item for item in name_candidates
        if expected_birthdate and item[1]["birthdate"] == expected_birthdate
    ]
    matches = birth_matches or [
        item for item in name_candidates
        if item[1]["army"] in equivalent_armies(expected_army)
    ]
    if len(matches) == 1:
        card, candidate = matches[0]
        return card, "이름생년월일일치" if birth_matches else "이름군일치", candidate
    if len(matches) > 1:
        return None, "교인복수일치", {"failure_note": "이름 검색 후보가 여러 명이며 생년월일로 확정되지 않습니다."}
    if name_candidates:
        return None, "정확한교인없음", {"failure_note": "이름 후보는 있으나 생년월일과 군 정보가 일치하지 않습니다."}
    return None, "정확한교인없음", {"failure_note": f"디모데에서 '{expected_name}' 이름 검색 결과가 없습니다."}


def wait_for_login(page):
    user_id = normalize_text(getattr(config, "USER_ID", ""))
    user_pw = str(getattr(config, "USER_PW", "") or "")
    if "/Login/" in page.url and user_id and user_pw:
        textboxes = page.locator('input[type="text"]')
        password = page.locator('input[type="password"]')
        textboxes.first.fill(user_id)
        password.first.fill(user_pw)
        password.first.press("Enter")
        try:
            page.wait_for_load_state("networkidle", timeout=15000)
        except Exception:
            page.wait_for_load_state("domcontentloaded", timeout=15000)

    deadline = time.time() + int(getattr(config, "LOGIN_WAIT_SECONDS", 300))
    while "/Login/" in page.url and time.time() < deadline:
        print("디모데 브라우저에서 로그인해 주세요. 로그인 완료를 기다리는 중입니다...", flush=True)
        page.wait_for_timeout(1000)
    if "/Login/" in page.url:
        raise RuntimeError("디모데 로그인 대기 시간이 초과되었습니다.")


def select_attendance_year(popup, year):
    selector = f'input[name="{ATTENDANCE_RADIO_NAME}"][value="{year}"]'
    radio = popup.locator(selector)
    if radio.count() == 0:
        raise RuntimeError(f"디모데 상세페이지에 {year}년 출결 탭이 없습니다.")
    if radio.is_checked():
        return
    # ASP.NET 포스트백은 사람/연도에 따라 같은 URL에서 갱신되어
    # 명시적 navigation 이벤트가 발생하지 않는 경우가 있다.
    radio.click()
    deadline = time.time() + 15
    while time.time() < deadline:
        current = popup.locator(selector)
        if current.count() and current.is_checked():
            # 체크 상태가 바뀐 직후 표가 교체되는 짧은 구간까지 기다린다.
            popup.wait_for_timeout(500)
            return
        popup.wait_for_timeout(100)
    raise RuntimeError(f"디모데 출결 연도를 {year}년으로 전환하지 못했습니다.")


def read_sunday_attendance(popup, year):
    select_attendance_year(popup, year)
    table = popup.locator(f"{ATTENDANCE_AREA} table.defaultTableNoTopLine").first
    sunday_row = table.locator("tr").filter(has_text="주일").first
    boxes = sunday_row.locator('input[type="checkbox"]')
    expected_dates = sundays_in_year(year)
    box_count = boxes.count()
    if box_count < len(expected_dates):
        raise RuntimeError(
            f"{year}년 주일 체크박스 수가 예상과 다릅니다: "
            f"화면 {box_count}개 / 달력 {len(expected_dates)}개"
        )
    # 디모데는 일부 연도에 달력 뒤쪽 빈 자리용 체크박스를 하나 더 렌더링한다.
    # 실제 일요일 수만 앞에서부터 사용하고, 여분 칸이 체크돼 있으면 화면 변경으로 간주한다.
    if any(boxes.nth(index).is_checked() for index in range(len(expected_dates), box_count)):
        raise RuntimeError(f"{year}년 달력의 여분 출결 칸이 체크되어 있습니다.")
    return {
        expected_dates[index]: boxes.nth(index).is_checked()
        for index in range(len(expected_dates))
    }


def dimode_id_from_url(url):
    return parse_qs(urlparse(url).query).get("id", [""])[0]


def inspect_person(page, right_frame, row, as_of):
    registration = parse_registration_date(row.get("날짜"))
    possible_dates = sundays_between(registration, as_of)
    if not possible_dates:
        return {
            "registration": registration,
            "possible": 0,
            "attended": 0,
            "rate": None,
            "recent": "0/0",
            "status": "등록일미래",
            "note": "기준일 이후 등록일",
            "dimode_id": "",
        }

    card, match_status, matched_person = find_exact_person_card(right_frame, row)
    if card is None:
        return {
            "registration": registration,
            "possible": len(possible_dates),
            "attended": None,
            "rate": None,
            "recent": "",
            "status": match_status,
            "note": (matched_person or {}).get("failure_note", "전화번호 또는 이름·군을 확인하세요."),
            "dimode_id": "",
            "latest_team": "",
        }

    name = matched_person["name"] or normalize_name(row.get("새신자"))
    with page.expect_popup() as popup_info:
        card.get_by_text(name, exact=False).first.click()
    popup = popup_info.value
    popup.wait_for_load_state("domcontentloaded")
    try:
        attendance = {}
        for year in sorted({item.year for item in possible_dates}):
            attendance.update(read_sunday_attendance(popup, year))
        attended = sum(bool(attendance.get(item)) for item in possible_dates)
        recent_dates = possible_dates[-4:]
        recent_attended = sum(bool(attendance.get(item)) for item in recent_dates)
        return {
            "registration": registration,
            "possible": len(possible_dates),
            "attended": attended,
            "rate": attended / len(possible_dates),
            "recent": f"{recent_attended}/{len(recent_dates)}",
            "status": "조회완료",
            "note": "",
            "dimode_id": dimode_id_from_url(popup.url),
            "latest_team": matched_person["team"],
            "latest_army": matched_person["army"],
        }
    finally:
        popup.close()


@dataclass
class RunOptions:
    as_of: date
    limit: int | None


def collect_results(page, right_frame, source_rows, options):
    results = []
    for index, row in enumerate(source_rows, start=1):
        if options.limit is not None and len(results) >= options.limit:
            break
        name = normalize_text(row.get("새신자"))
        try:
            inspected = inspect_person(page, right_frame, row, options.as_of)
        except Exception as exc:
            try:
                registration = parse_registration_date(row.get("날짜"))
                possible = len(sundays_between(registration, options.as_of))
            except ValueError:
                registration, possible = None, 0
            inspected = {
                "registration": registration,
                "possible": possible,
                "attended": None,
                "rate": None,
                "recent": "",
                "status": "조회오류",
                "note": str(exc)[:180],
                "dimode_id": "",
            }
        result = {
            "No.": index,
            "군": normalize_army(inspected.get("latest_army") or row.get("군")),
            "팀": normalize_team(inspected.get("latest_team") or row.get("팀")),
            "이름": name,
            "성별": normalize_text(row.get("성별")),
            "핸드폰": format_phone(row.get("핸드폰")),
            "등록일": inspected["registration"],
            "기준일": options.as_of,
            "대상 일요일": inspected["possible"],
            "출석 일요일": inspected["attended"],
            "정착률": inspected["rate"],
            "최근 4주": inspected["recent"],
            "조회 상태": inspected["status"],
            "비고": inspected["note"],
            "디모데 ID": inspected["dimode_id"],
        }
        results.append(result)
        rate_text = "-" if result["정착률"] is None else f"{result['정착률']:.1%}"
        print(f"[{len(results)}/{len(source_rows)}] {name}: {result['조회 상태']} / {rate_text}", flush=True)
    order = {army: index for index, army in enumerate(ARMY_ORDER)}
    results.sort(key=lambda item: (order.get(item["군"], 999), item["군"], item["팀"], item["이름"]))
    for index, item in enumerate(results, start=1):
        item["No."] = index
    return results


def summary_rows(results):
    grouped = defaultdict(list)
    for item in results:
        grouped[item["군"] or "미배정"].append(item)
    order = {army: index for index, army in enumerate(ARMY_ORDER)}
    rows = []
    for army in sorted(grouped, key=lambda value: (order.get(value, 999), value)):
        items = grouped[army]
        completed = [item for item in items if item["조회 상태"] == "조회완료"]
        possible = sum(item["대상 일요일"] for item in completed)
        attended = sum(item["출석 일요일"] for item in completed)
        rows.append([
            army,
            len(items),
            len(completed),
            possible,
            attended,
            attended / possible if possible else None,
        ])
    return rows


def cell_value(value):
    if value is None:
        return ""
    if isinstance(value, date):
        return value.isoformat()
    return value


def ensure_result_sheet(service, spreadsheet_id):
    title = getattr(config, "RESULT_SHEET_NAME", "정착률")
    metadata = service.spreadsheets().get(
        spreadsheetId=spreadsheet_id,
        fields="sheets(properties(sheetId,title,gridProperties))",
    ).execute()
    for sheet in metadata.get("sheets", []):
        if sheet["properties"]["title"] == title:
            return sheet["properties"]["sheetId"]
    reply = service.spreadsheets().batchUpdate(
        spreadsheetId=spreadsheet_id,
        body={"requests": [{"addSheet": {"properties": {"title": title, "gridProperties": {"rowCount": 1000, "columnCount": 15}}}}]},
    ).execute()
    return reply["replies"][0]["addSheet"]["properties"]["sheetId"]


def write_result_sheet(service, results, as_of):
    spreadsheet_id = spreadsheet_id_from_url(config.SHEET_URL)
    sheet_name = getattr(config, "RESULT_SHEET_NAME", "정착률")
    sheet_id = ensure_result_sheet(service, spreadsheet_id)
    summaries = summary_rows(results)
    detail_start = max(16, 5 + len(summaries) + 2)
    detail_first_row = detail_start + 1
    detail_last_row = detail_start + len(results)

    service.spreadsheets().values().clear(
        spreadsheetId=spreadsheet_id,
        range=f"'{sheet_name}'!A:O",
        body={},
    ).execute()

    values = [
        ["2026년 새가족 정착률"],
        ["기준일", as_of.isoformat(), "업데이트", datetime.now().strftime("%Y-%m-%d %H:%M"), "산식", "등록일 포함 일요일 중 주일 출결 체크 비율"],
        [],
        ["군", "명단 인원", "조회 완료", "대상 일요일", "출석 일요일", "군 정착률", "", "전체 요약", "값"],
    ]
    # 요약 숫자는 코드 계산값이 아니라 아래에서 입력하는 Google Sheets 수식으로 집계한다.
    values.extend([[item[0], "", "", "", "", ""] for item in summaries])
    while len(values) < detail_start - 1:
        values.append([])
    values.append(DETAIL_HEADERS)
    for item in results:
        values.append([cell_value(item[header]) for header in DETAIL_HEADERS])

    service.spreadsheets().values().update(
        spreadsheetId=spreadsheet_id,
        range=f"'{sheet_name}'!A1",
        valueInputOption="RAW",
        body={"values": values},
    ).execute()
    summary_formulas = []
    for offset in range(len(summaries)):
        sheet_row = 5 + offset
        summary_formulas.append([
            f'=COUNTIF($B${detail_first_row}:$B${detail_last_row},$A{sheet_row})',
            f'=COUNTIFS($B${detail_first_row}:$B${detail_last_row},$A{sheet_row},$M${detail_first_row}:$M${detail_last_row},"조회완료")',
            f'=SUMIFS($I${detail_first_row}:$I${detail_last_row},$B${detail_first_row}:$B${detail_last_row},$A{sheet_row},$M${detail_first_row}:$M${detail_last_row},"조회완료")',
            f'=SUMIFS($J${detail_first_row}:$J${detail_last_row},$B${detail_first_row}:$B${detail_last_row},$A{sheet_row},$M${detail_first_row}:$M${detail_last_row},"조회완료")',
            f'=IFERROR(E{sheet_row}/D{sheet_row},0)',
        ])
    service.spreadsheets().values().update(
        spreadsheetId=spreadsheet_id,
        range=f"'{sheet_name}'!B5",
        valueInputOption="USER_ENTERED",
        body={"values": summary_formulas},
    ).execute()

    overview = [
        ["전체 인원", f'=COUNTA($D${detail_first_row}:$D${detail_last_row})'],
        ["조회 완료", f'=COUNTIF($M${detail_first_row}:$M${detail_last_row},"조회완료")'],
        ["총 대상 일요일", f'=SUMIF($M${detail_first_row}:$M${detail_last_row},"조회완료",$I${detail_first_row}:$I${detail_last_row})'],
        ["총 출석 일요일", f'=SUMIF($M${detail_first_row}:$M${detail_last_row},"조회완료",$J${detail_first_row}:$J${detail_last_row})'],
        ["전체 정착률", "=IFERROR(I8/I7,0)"],
    ]
    service.spreadsheets().values().update(
        spreadsheetId=spreadsheet_id,
        range=f"'{sheet_name}'!H5:I9",
        valueInputOption="USER_ENTERED",
        body={"values": overview},
    ).execute()

    white = {"red": 1, "green": 1, "blue": 1}
    light_blue = {"red": 0.82, "green": 0.89, "blue": 0.96}
    navy = {"red": 0.16, "green": 0.31, "blue": 0.49}
    light_gray = {"red": 0.94, "green": 0.95, "blue": 0.96}
    border = {"style": "SOLID", "color": {"red": 0.78, "green": 0.81, "blue": 0.84}}
    used_rows = detail_start + len(results)
    requests = [
        {"unmergeCells": {"range": {"sheetId": sheet_id, "startRowIndex": 0, "endRowIndex": 1, "startColumnIndex": 0, "endColumnIndex": 15}}},
        {"repeatCell": {"range": {"sheetId": sheet_id, "startRowIndex": 0, "endRowIndex": max(used_rows, 20), "startColumnIndex": 0, "endColumnIndex": 15}, "cell": {"userEnteredFormat": {"backgroundColor": white, "textFormat": {"foregroundColor": {"red": 0.12, "green": 0.12, "blue": 0.12}, "bold": False}, "horizontalAlignment": "LEFT", "verticalAlignment": "MIDDLE", "wrapStrategy": "WRAP"}}, "fields": "userEnteredFormat"}},
        {"mergeCells": {"range": {"sheetId": sheet_id, "startRowIndex": 0, "endRowIndex": 1, "startColumnIndex": 0, "endColumnIndex": 15}, "mergeType": "MERGE_ALL"}},
        {"repeatCell": {"range": {"sheetId": sheet_id, "startRowIndex": 0, "endRowIndex": 1, "startColumnIndex": 0, "endColumnIndex": 15}, "cell": {"userEnteredFormat": {"backgroundColor": navy, "horizontalAlignment": "CENTER", "textFormat": {"foregroundColor": white, "bold": True, "fontSize": 16}}}, "fields": "userEnteredFormat"}},
        {"repeatCell": {"range": {"sheetId": sheet_id, "startRowIndex": 3, "endRowIndex": 4, "startColumnIndex": 0, "endColumnIndex": 6}, "cell": {"userEnteredFormat": {"backgroundColor": light_blue, "horizontalAlignment": "CENTER", "textFormat": {"bold": True}, "borders": {"top": border, "bottom": border, "left": border, "right": border}}}, "fields": "userEnteredFormat"}},
        {"repeatCell": {"range": {"sheetId": sheet_id, "startRowIndex": 3, "endRowIndex": 4, "startColumnIndex": 7, "endColumnIndex": 9}, "cell": {"userEnteredFormat": {"backgroundColor": light_blue, "horizontalAlignment": "CENTER", "textFormat": {"bold": True}, "borders": {"top": border, "bottom": border, "left": border, "right": border}}}, "fields": "userEnteredFormat"}},
        {"repeatCell": {"range": {"sheetId": sheet_id, "startRowIndex": detail_start - 1, "endRowIndex": detail_start, "startColumnIndex": 0, "endColumnIndex": 15}, "cell": {"userEnteredFormat": {"backgroundColor": navy, "horizontalAlignment": "CENTER", "textFormat": {"foregroundColor": white, "bold": True}, "borders": {"top": border, "bottom": border, "left": border, "right": border}}}, "fields": "userEnteredFormat"}},
        {"repeatCell": {"range": {"sheetId": sheet_id, "startRowIndex": detail_start, "endRowIndex": used_rows, "startColumnIndex": 0, "endColumnIndex": 15}, "cell": {"userEnteredFormat": {"borders": {"bottom": border}}}, "fields": "userEnteredFormat.borders"}},
        {"repeatCell": {"range": {"sheetId": sheet_id, "startRowIndex": 4, "endRowIndex": 4 + len(summaries), "startColumnIndex": 5, "endColumnIndex": 6}, "cell": {"userEnteredFormat": {"numberFormat": {"type": "PERCENT", "pattern": "0.0%"}}}, "fields": "userEnteredFormat.numberFormat"}},
        {"repeatCell": {"range": {"sheetId": sheet_id, "startRowIndex": 8, "endRowIndex": 9, "startColumnIndex": 8, "endColumnIndex": 9}, "cell": {"userEnteredFormat": {"numberFormat": {"type": "PERCENT", "pattern": "0.0%"}}}, "fields": "userEnteredFormat.numberFormat"}},
        {"repeatCell": {"range": {"sheetId": sheet_id, "startRowIndex": detail_start, "endRowIndex": used_rows, "startColumnIndex": 10, "endColumnIndex": 11}, "cell": {"userEnteredFormat": {"numberFormat": {"type": "PERCENT", "pattern": "0.0%"}, "horizontalAlignment": "CENTER"}}, "fields": "userEnteredFormat(numberFormat,horizontalAlignment)"}},
        {"updateSheetProperties": {"properties": {"sheetId": sheet_id, "gridProperties": {"frozenRowCount": detail_start, "frozenColumnCount": 0}}, "fields": "gridProperties.frozenRowCount,gridProperties.frozenColumnCount"}},
        {"setBasicFilter": {"filter": {"range": {"sheetId": sheet_id, "startRowIndex": detail_start - 1, "endRowIndex": used_rows, "startColumnIndex": 0, "endColumnIndex": 15}}}},
    ]
    widths = [85, 55, 90, 95, 55, 125, 95, 95, 90, 90, 85, 85, 105, 220, 90]
    for index, width in enumerate(widths):
        requests.append({"updateDimensionProperties": {"range": {"sheetId": sheet_id, "dimension": "COLUMNS", "startIndex": index, "endIndex": index + 1}, "properties": {"pixelSize": width}, "fields": "pixelSize"}})
    for index, item in enumerate(results, start=detail_start):
        rate = item["정착률"]
        if rate is None:
            color = light_gray
        elif rate >= 0.7:
            color = {"red": 0.78, "green": 0.91, "blue": 0.82}
        elif rate >= 0.4:
            color = {"red": 1.0, "green": 0.91, "blue": 0.65}
        else:
            color = {"red": 0.96, "green": 0.78, "blue": 0.78}
        requests.append({"repeatCell": {"range": {"sheetId": sheet_id, "startRowIndex": index, "endRowIndex": index + 1, "startColumnIndex": 10, "endColumnIndex": 11}, "cell": {"userEnteredFormat": {"backgroundColor": color, "textFormat": {"bold": True}}}, "fields": "userEnteredFormat(backgroundColor,textFormat.bold)"}})
    service.spreadsheets().batchUpdate(
        spreadsheetId=spreadsheet_id,
        body={"requests": requests},
    ).execute()
    return f"https://docs.google.com/spreadsheets/d/{spreadsheet_id}/edit#gid={sheet_id}"


def save_csv(results):
    output_dir = PROJECT_DIR / "output"
    output_dir.mkdir(exist_ok=True)
    path = output_dir / "settlement_result.csv"
    with path.open("w", newline="", encoding="utf-8-sig") as stream:
        writer = csv.DictWriter(stream, fieldnames=DETAIL_HEADERS)
        writer.writeheader()
        for item in results:
            writer.writerow({key: cell_value(item[key]) for key in DETAIL_HEADERS})
    return path


def load_previous_results():
    path = PROJECT_DIR / "output" / "settlement_result.csv"
    if not path.exists():
        return []
    results = []
    with path.open(encoding="utf-8-sig", newline="") as stream:
        for row in csv.DictReader(stream):
            item = dict(row)
            item["No."] = int(item["No."] or 0)
            item["등록일"] = datetime.strptime(item["등록일"], "%Y-%m-%d").date() if item["등록일"] else None
            item["기준일"] = datetime.strptime(item["기준일"], "%Y-%m-%d").date() if item["기준일"] else None
            item["대상 일요일"] = int(item["대상 일요일"] or 0)
            item["출석 일요일"] = int(item["출석 일요일"]) if item["출석 일요일"] else None
            item["정착률"] = float(item["정착률"]) if item["정착률"] else None
            results.append(item)
    return results


def result_key(item):
    registration = item.get("등록일") or item.get("날짜") or ""
    if registration and not isinstance(registration, date):
        try:
            registration = parse_registration_date(registration)
        except ValueError:
            pass
    return (
        normalize_name(item.get("이름") or item.get("새신자")),
        format_phone(item.get("핸드폰")),
        str(registration),
    )


def parse_args():
    parser = argparse.ArgumentParser(description="새가족 주일 출석 기반 정착률 조사")
    parser.add_argument("--as-of", help="기준일(YYYY-MM-DD), 기본값은 오늘")
    parser.add_argument("--limit", type=int, help="시험 실행할 최대 인원")
    parser.add_argument("--only-name", help="시험 실행할 새가족 이름")
    parser.add_argument("--no-sheet-write", action="store_true", help="구글시트에 쓰지 않고 CSV만 생성")
    parser.add_argument("--retry-unmatched", action="store_true", help="이전 결과에서 미확인 인원만 재조회 후 병합")
    parser.add_argument("--send-email", action="store_true", help="시트 갱신 성공 후 정착률 메일 발송")
    parser.add_argument("--test-email", action="store_true", help="모든 보고서를 테스트 수신자 한 명에게만 발송")
    parser.add_argument("--monthly", action="store_true", help="마지막 화요일에만 실행하고 월별 중복 발송 방지")
    parser.add_argument("--force-monthly", action="store_true", help="오늘이 마지막 화요일이 아니어도 월간 실행 강제")
    parser.add_argument("--headless", action="store_true", help="예약 작업용 숨김 브라우저 실행")
    parser.add_argument("--email-from-csv", action="store_true", help="검증 완료된 기존 CSV로 조회 없이 메일만 발송")
    parser.add_argument("--email-scope", choices=("all", "overall"), default="all", help="메일 발송 범위")
    return parser.parse_args()


def main():
    args = parse_args()
    as_of = datetime.strptime(args.as_of, "%Y-%m-%d").date() if args.as_of else date.today()
    if args.monthly and not args.force_monthly and not is_last_tuesday(as_of):
        print(f"{as_of.isoformat()}은 마지막 화요일이 아니므로 실행하지 않습니다.", flush=True)
        return
    if args.monthly and not args.test_email and already_sent(PROJECT_DIR, as_of):
        print(f"{as_of.strftime('%Y-%m')} 운영 메일은 이미 발송되어 중복 실행하지 않습니다.", flush=True)
        return
    options = RunOptions(as_of=as_of, limit=args.limit)
    service, gmail_service = get_google_services()
    if args.email_from_csv:
        results = load_previous_results()
        if not results:
            raise SystemExit("메일에 사용할 기존 CSV 결과가 없습니다.")
        csv_as_of = results[0].get("기준일")
        if csv_as_of != as_of:
            raise SystemExit(
                f"CSV 기준일({csv_as_of})과 실행 기준일({as_of})이 달라 메일을 보내지 않습니다."
            )
        completion_rate = ensure_safe_to_email(results)
        sheet_url = (
            getattr(config, "SHEET_URL", "").split("#")[0].split("?gid=")[0]
            + "#gid=276981079"
        )
        sent = send_reports(
            gmail_service, results, as_of, sheet_url,
            test_mode=args.test_email, scope=args.email_scope,
        )
        print(
            f"기존 CSV 메일 발송 완료: {len(sent)}통 / 조회 완료율 {completion_rate:.1%} / "
            f"모드 {'TEST' if args.test_email else 'PRODUCTION'}",
            flush=True,
        )
        return
    source_rows = load_source_rows(service)
    previous_results = load_previous_results() if args.retry_unmatched else []
    if args.retry_unmatched:
        retry_keys = {
            result_key(item) for item in previous_results
            if item["조회 상태"] != "조회완료"
        }
        source_rows = [row for row in source_rows if result_key(row) in retry_keys]
    if args.only_name:
        source_rows = [
            row for row in source_rows
            if normalize_text(row.get("새신자")) == normalize_text(args.only_name)
        ]
        if not source_rows:
            raise SystemExit(f"원본 시트에서 이름을 찾지 못했습니다: {args.only_name}")
    print(f"기준일: {as_of.isoformat()}, 대상: {len(source_rows)}명", flush=True)

    try:
        from playwright.sync_api import sync_playwright
    except ModuleNotFoundError as exc:
        raise SystemExit("python -m pip install -r requirements.txt 를 먼저 실행하세요.") from exc

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            headless=args.headless or bool(getattr(config, "HEADLESS", False))
        )
        page = browser.new_page()
        page.goto(config.DIMODE_URL)
        wait_for_login(page)
        frame_deadline = time.time() + 20
        right_page = page.frame(name="right")
        while right_page is None and time.time() < frame_deadline:
            page.wait_for_timeout(250)
            right_page = page.frame(name="right")
        if right_page is None:
            raise RuntimeError("디모데 오른쪽 프레임을 찾지 못했습니다.")
        right_page.goto(PERSON_LIST_URL)
        right_page.wait_for_load_state("domcontentloaded")
        right_frame = page.frame_locator('frame[name="right"]')
        results = collect_results(page, right_frame, source_rows, options)
        browser.close()

    if args.retry_unmatched:
        retried = {result_key(item): item for item in results}
        results = [retried.get(result_key(item), item) for item in previous_results]
        for index, item in enumerate(results, start=1):
            item["No."] = index
    for item in results:
        if item["조회 상태"] == "조회완료":
            item["비고"] = ""

    csv_path = save_csv(results)
    print(f"CSV 저장: {csv_path}", flush=True)
    sheet_url = getattr(config, "SHEET_URL", "")
    if not args.no_sheet_write:
        sheet_url = write_result_sheet(service, results, as_of)
        print(f"구글시트 저장: {sheet_url}", flush=True)
    if args.send_email or args.test_email:
        completion_rate = ensure_safe_to_email(results)
        sent = send_reports(
            gmail_service, results, as_of, sheet_url,
            test_mode=args.test_email, scope=args.email_scope,
        )
        print(
            f"메일 발송 완료: {len(sent)}통 / 조회 완료율 {completion_rate:.1%} / "
            f"모드 {'TEST' if args.test_email else 'PRODUCTION'}",
            flush=True,
        )
        if args.monthly and not args.test_email:
            mark_sent(PROJECT_DIR, as_of, sent)


if __name__ == "__main__":
    main()
