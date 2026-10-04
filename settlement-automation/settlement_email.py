import base64
import html
import json
from collections import defaultdict
from datetime import date, timedelta
from email.message import EmailMessage
from pathlib import Path

from desktop.legacy_config import config


ARMY_ORDER = ["신", "조", "명", "총", "석", "전", "영", "슬", "임"]
DEFAULT_TEST_RECIPIENT = "ksj747172@gmail.com"
DEFAULT_ADMIN_RECIPIENTS = [
    "ksj747172@gmail.com",
    "rayo072@naver.com",
    "rnrnwkddn@naver.com",
    "wnehdrms123@naver.com",
    "whduswn94@naver.com",
]
DEFAULT_ARMY_RECIPIENTS = {
    "신": "smk941129@gmail.com",
    "조": "kmc7758@naver.com",
    "총": "eomchong@icloud.com",
    "석": "hwoneeeeee@gmail.com",
    "전": "jbr0196@naver.com",
    "명": "jun607@naver.com",
    "임": "dkssud2521@naver.com",
    "슬": "l__seul@naver.com",
    "영": "revlee0956@gmail.com",
}


def is_last_tuesday(day):
    return day.weekday() == 1 and (day + timedelta(days=7)).month != day.month


def _rate(attended, possible):
    return attended / possible if possible else 0


def _format_date(value):
    return value.isoformat() if hasattr(value, "isoformat") else str(value or "-")


def _summary(items):
    completed = [item for item in items if item["조회 상태"] == "조회완료"]
    possible = sum(item["대상 일요일"] for item in completed)
    attended = sum(item["출석 일요일"] for item in completed)
    return {
        "total": len(items),
        "completed": len(completed),
        "possible": possible,
        "attended": attended,
        "rate": _rate(attended, possible),
    }


def _cell(value):
    return (
        '<td style="padding:8px;border:1px solid #e5e7eb;text-align:center;'
        'vertical-align:middle">' + html.escape(str(value)) + "</td>"
    )


def _summary_cards(summary):
    cards = [
        ("명단 인원", f'{summary["total"]}명', "#f3f4f6"),
        ("조회 완료", f'{summary["completed"]}명', "#dbeafe"),
        ("대상 주일", f'{summary["possible"]}회', "#fef3c7"),
        ("출석 주일", f'{summary["attended"]}회', "#dcfce7"),
        ("정착률", f'{summary["rate"]:.1%}', "#ede9fe"),
    ]
    cells = "".join(
        '<td style="padding:12px 8px;text-align:center;background:' + color +
        ';border-radius:8px"><div style="font-size:12px;color:#6b7280">' +
        html.escape(label) + '</div><div style="margin-top:4px;font-size:20px;'
        'font-weight:700">' + html.escape(value) + "</div></td>"
        for label, value, color in cards
    )
    return (
        '<table role="presentation" style="width:100%;border-collapse:separate;'
        'border-spacing:8px;margin:0 0 22px"><tr>' + cells + "</tr></table>"
    )


def _member_table(items):
    head = "".join(_cell(value) for value in [
        "이름", "팀", "등록일", "대상 주일", "출석 주일", "정착률", "최근 4주", "조회 상태"
    ])
    rows = []
    for item in items:
        rate = "-" if item["정착률"] is None else f'{item["정착률"]:.1%}'
        values = [
            item["이름"], item["팀"] or "-", _format_date(item["등록일"]),
            item["대상 일요일"], item["출석 일요일"] if item["출석 일요일"] is not None else "-",
            rate, item["최근 4주"] or "-", item["조회 상태"],
        ]
        rows.append("<tr>" + "".join(_cell(value) for value in values) + "</tr>")
    return (
        '<table style="width:100%;margin:0 auto;border-collapse:collapse;'
        'font-size:13px;text-align:center"><thead><tr style="background:#eef2ff;'
        'font-weight:700">' + head + "</tr></thead><tbody>" + "".join(rows) +
        "</tbody></table>"
    )


def _army_summary_table(grouped):
    headers = ["군", "명단", "조회 완료", "대상 주일", "출석 주일", "정착률"]
    head = "".join(_cell(value) for value in headers)
    rows = []
    for army in ARMY_ORDER:
        summary = _summary(grouped.get(army, []))
        values = [army + "군", summary["total"], summary["completed"],
                  summary["possible"], summary["attended"], f'{summary["rate"]:.1%}']
        rows.append("<tr>" + "".join(_cell(value) for value in values) + "</tr>")
    return (
        '<h3 style="margin:24px 0 8px;text-align:center">군별 정착률 현황</h3>'
        '<table style="width:100%;margin:0 auto;border-collapse:collapse;'
        'font-size:13px;text-align:center"><thead><tr style="background:#eef2ff;'
        'font-weight:700">' + head + "</tr></thead><tbody>" + "".join(rows) +
        "</tbody></table>"
    )


def build_html(title, items, as_of, grouped=None, sheet_url="", include_members=True):
    summary = _summary(items)
    content = (
        '<div style="max-width:980px;margin:0 auto;font-family:Malgun Gothic,Arial,'
        'sans-serif;color:#1f2937;text-align:center">'
        f'<h2 style="margin:0 0 8px;text-align:center">{html.escape(title)}</h2>'
        f'<p style="margin:0 0 16px;color:#6b7280;text-align:center">기준일: {as_of.isoformat()}</p>'
        + _summary_cards(summary)
    )
    if grouped is not None:
        content += _army_summary_table(grouped)
    if include_members:
        content += '<h3 style="margin:24px 0 8px;text-align:center">개인별 정착 현황</h3>'
        content += _member_table(items)
    if sheet_url:
        content += ('<p style="margin:22px 0;text-align:center"><a href="' +
                    html.escape(sheet_url, quote=True) + '">정착률 시트에서 전체 내용 보기</a></p>')
    return content + "</div>"


def _plain_text(title, items, as_of, sheet_url):
    summary = _summary(items)
    return "\n".join([
        title,
        f"기준일: {as_of.isoformat()}",
        f'명단 인원: {summary["total"]}명',
        f'조회 완료: {summary["completed"]}명',
        f'대상 주일: {summary["possible"]}회',
        f'출석 주일: {summary["attended"]}회',
        f'정착률: {summary["rate"]:.1%}',
        "", sheet_url,
    ])


def _send(gmail_service, recipients, subject, text_body, html_body):
    message = EmailMessage()
    message["To"] = ", ".join(recipients)
    message["Subject"] = subject
    message.set_content(text_body)
    message.add_alternative(html_body, subtype="html")
    raw = base64.urlsafe_b64encode(message.as_bytes()).decode("ascii")
    response = gmail_service.users().messages().send(userId="me", body={"raw": raw}).execute()
    return response.get("id")


def send_reports(gmail_service, results, as_of, sheet_url, test_mode=False, scope="all"):
    test_recipient = getattr(config, "TEST_RECIPIENT", DEFAULT_TEST_RECIPIENT)
    admins = getattr(config, "ADMIN_RECIPIENTS", DEFAULT_ADMIN_RECIPIENTS)
    army_recipients = getattr(config, "ARMY_RECIPIENTS", DEFAULT_ARMY_RECIPIENTS)
    grouped = defaultdict(list)
    for item in results:
        grouped[item["군"]].append(item)

    sent = []
    prefix = "[테스트]" if test_mode else ""
    admin_to = [test_recipient] if test_mode else admins
    title = "전체 새가족 정착률 현황"
    _send(
        gmail_service, admin_to,
        f"{prefix}[새가족부] 전체 새가족 정착률 현황 - {as_of.isoformat()}",
        _plain_text(title, results, as_of, sheet_url),
        build_html(
            title, results, as_of, grouped=grouped, sheet_url=sheet_url,
            include_members=False,
        ),
    )
    sent.append({"report": "전체", "recipients": admin_to})

    if scope == "overall":
        return sent

    for army in ARMY_ORDER:
        items = grouped.get(army, [])
        if not items:
            continue
        recipients = [test_recipient] if test_mode else [army_recipients[army]]
        title = f"{army}군 새가족 정착률 현황"
        _send(
            gmail_service, recipients,
            f"{prefix}[새가족부] {army}군 새가족 정착률 현황 - {as_of.isoformat()}",
            _plain_text(title, items, as_of, sheet_url),
            build_html(title, items, as_of, sheet_url=sheet_url),
        )
        sent.append({"report": army, "recipients": recipients})
    return sent


def ensure_safe_to_email(results):
    total = len(results)
    completed = sum(item["조회 상태"] == "조회완료" for item in results)
    minimum = float(getattr(config, "MIN_QUERY_COMPLETION_RATE", 0.95))
    actual = completed / total if total else 0
    if actual < minimum:
        raise RuntimeError(
            f"조회 완료율이 {actual:.1%}로 안전 기준 {minimum:.1%}보다 낮아 메일을 보내지 않았습니다."
        )
    return actual


def state_path(project_dir):
    return Path(project_dir) / "output" / "monthly_email_state.json"


def already_sent(project_dir, as_of):
    path = state_path(project_dir)
    if not path.exists():
        return False
    state = json.loads(path.read_text(encoding="utf-8"))
    return state.get("last_production_month") == as_of.strftime("%Y-%m")


def mark_sent(project_dir, as_of, sent):
    path = state_path(project_dir)
    path.parent.mkdir(exist_ok=True)
    path.write_text(json.dumps({
        "last_production_month": as_of.strftime("%Y-%m"),
        "sent_at": date.today().isoformat(),
        "reports": [item["report"] for item in sent],
    }, ensure_ascii=False, indent=2), encoding="utf-8")


def build_report_previews(results, as_of, sheet_url, *, test_mode=False):
    """Desktop report content uses existing fixed recipient scope, never mutable CLI config."""
    from desktop.metrics import army_metrics
    metrics = army_metrics(results)
    complete = sum(item['completed_count'] for item in metrics)
    overall_ok = bool(results) and complete / len(results) >= .95
    grouped = defaultdict(list)
    for item in results:
        grouped[item['군']].append(item)
    definitions = [('overall','전체 새가족 정착률 현황',results,tuple(DEFAULT_ADMIN_RECIPIENTS),overall_ok)]
    metrics_by_army = {item['army']:item for item in metrics}
    for army in ARMY_ORDER:
        if grouped.get(army):
            definitions.append(('army:'+army,army+'군 새가족 정착률 현황',grouped[army],
                                (DEFAULT_ARMY_RECIPIENTS[army],),overall_ok and metrics_by_army[army]['completion_rate']>=.95))
    # Unassigned/unknown groups have visible exclusion reasons and no recipients.
    for army in ('미배정','군 정보 검토'):
        items = [p for p in results if (not p.get('군') if army=='미배정' else p.get('군') and p['군'] not in ARMY_ORDER)]
        if items: definitions.append(('excluded:'+army,army,items,(),False))
    reports=[]
    for key,title,items,recipients,quality in definitions:
        recipients = (DEFAULT_TEST_RECIPIENT,) if test_mode and recipients else recipients
        enabled=quality and bool(recipients)
        reports.append(dict(key=key,title=title,recipients=recipients,
            subject=(' [테스트]' if test_mode else '')+'[새가족부] '+title+' - '+as_of.isoformat(),
            text=_plain_text(title,items,as_of,sheet_url),
            html=build_html(title,items,as_of,grouped=grouped if key=='overall' else None,
                            sheet_url=sheet_url,include_members=key!='overall'),
            enabled=enabled,reason=None if enabled else ('운영 발송 대상 군이 아닙니다.' if key.startswith('excluded:') else '전체와 해당 군의 조회 완료율이 95% 이상이어야 합니다.')))
    return reports
