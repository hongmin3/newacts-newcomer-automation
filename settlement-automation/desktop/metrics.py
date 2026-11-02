"""출석 기간을 통일하는 순수 계산. 운영 설정이나 서비스는 읽지 않는다."""
import re
from calendar import monthrange
from datetime import date, datetime, timedelta

ARMY_ORDER = ('신', '조', '명', '총', '석', '전', '영', '슬', '임')
FORMULA_VERSION = 'recent3-v2'


def three_month_start(as_of: date) -> date:
    month_index = as_of.year * 12 + as_of.month - 1 - 3
    year, month_zero = divmod(month_index, 12)
    month = month_zero + 1
    return date(year, month, min(as_of.day, monthrange(year, month)[1]))


def _sundays(start: date, end: date) -> tuple[date, ...]:
    first = start + timedelta(days=(6 - start.weekday()) % 7)
    return tuple(first + timedelta(days=7 * n) for n in range(max(0, (end - first).days // 7 + 1)))


def recent_sundays(as_of: date) -> tuple[date, ...]:
    last = as_of - timedelta(days=(as_of.weekday() - 6) % 7)
    return tuple(last - timedelta(days=7 * n) for n in (3, 2, 1, 0))


def member_metrics(registration: date, attendance: dict[date, bool], as_of: date) -> dict:
    possible_dates = _sundays(registration, as_of)
    recent_dates = tuple(day for day in recent_sundays(as_of) if day >= registration)
    possible, recent_possible = len(possible_dates), len(recent_dates)
    attended = sum(bool(attendance.get(day)) for day in possible_dates)
    recent_attended = sum(bool(attendance.get(day)) for day in recent_dates)
    recent3_start = three_month_start(as_of)
    recent3_dates = _sundays(max(registration, recent3_start), as_of)
    recent3_attended = sum(bool(attendance.get(day)) for day in recent3_dates)
    if registration > as_of:
        settlement_status = '대상외'
    elif recent3_attended:
        settlement_status = '정착'
    elif registration > recent3_start:
        settlement_status = '관찰 중'
    else:
        settlement_status = '미정착'
    return {
        'possible': possible, 'attended': attended,
        'rate': attended / possible if possible else None,
        'recent_possible': recent_possible, 'recent_attended': recent_attended,
        'recent_rate': recent_attended / recent_possible if recent_possible else None,
        'observation_status': '계산 대상 없음' if not recent_possible else ('관찰 기간 부족' if recent_possible < 4 else '충분'),
        'recent3_start': recent3_start.isoformat(),
        'recent3_possible': len(recent3_dates), 'recent3_attended': recent3_attended,
        'settled': settlement_status == '정착', 'settlement_status': settlement_status,
        'formula_version': FORMULA_VERSION,
    }


def resolve_registration_date(value: str, period_start: date, period_end: date) -> date:
    if period_start > period_end:
        raise ValueError('명단 기간이 역전되어 있습니다.')
    text = str(value or '').strip()
    for fmt in ('%Y-%m-%d', '%Y/%m/%d', '%Y.%m.%d', '%y%m%d', '%Y%m%d'):
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            pass
    match = re.fullmatch(r'(\d{1,2})[./-](\d{1,2})', text)
    candidates = []
    if match:
        month, day = map(int, match.groups())
        for year in range(period_start.year, period_end.year + 1):
            try:
                candidate = date(year, month, day)
            except ValueError:
                continue
            if period_start <= candidate <= period_end:
                candidates.append(candidate)
    if len(candidates) != 1:
        raise ValueError('등록일 확인 필요: 명단 기간에서 날짜가 하나로 정해지지 않습니다.')
    return candidates[0]


def _army(value) -> str:
    army = re.sub(r'\([^)]*\)', '', str(value or '')).strip()
    army = army[:-1].strip() if army.endswith('군') else army
    army = {'아하': '신', '아너스': '조'}.get(army, army)
    return army if army in ARMY_ORDER else ('미배정' if not army else '군 정보 검토')


def army_metrics(results: list[dict]) -> list[dict]:
    grouped = {}
    for item in results:
        if item.get('settlement_status') == '대상외':
            continue
        grouped.setdefault(_army(item.get('군', item.get('army'))), []).append(item)
    summaries = []
    for army in (*ARMY_ORDER, '미배정', '군 정보 검토'):
        if army not in grouped:
            continue
        items = grouped[army]
        completed = [item for item in items if item.get('조회 상태', item.get('status')) == '조회완료']
        possible = sum(item.get('possible', item.get('대상 일요일', 0)) or 0 for item in completed)
        attended = sum(item.get('attended', item.get('출석 일요일', 0)) or 0 for item in completed)
        recent_possible = sum(item.get('recent_possible', 0) or 0 for item in completed)
        recent_attended = sum(item.get('recent_attended', 0) or 0 for item in completed)
        settlement_known = [item for item in items if _settlement_is_known(item)]
        settled_count = sum(item['settlement_status'] == '정착' for item in settlement_known)
        observing_count = sum(item['settlement_status'] == '관찰 중' for item in settlement_known)
        unsettled_count = sum(item['settlement_status'] == '미정착' for item in settlement_known)
        settlement_review_count = len(items) - len(settlement_known)
        summaries.append({
            'army': army, 'member_count': len(items), 'completed_count': len(completed),
            'review_count': len(items) - len(completed), 'completion_rate': len(completed) / len(items),
            'possible': possible, 'attended': attended, 'rate': attended / possible if possible else None,
            'recent_possible': recent_possible, 'recent_attended': recent_attended,
            'recent_rate': recent_attended / recent_possible if recent_possible else None,
            'insufficient_count': sum(item.get('observation_status') == '관찰 기간 부족' for item in completed),
            'no_target_count': sum(item.get('observation_status') == '계산 대상 없음' for item in completed),
            'recent3_attended': sum(item['recent3_attended'] for item in settlement_known),
            'settled_count': settled_count, 'observing_count': observing_count,
            'unsettled_count': unsettled_count, 'settlement_review_count': settlement_review_count,
            'settlement_rate': settled_count / len(items),
            'settlement_provisional': bool(settlement_review_count),
            'formula_version': FORMULA_VERSION,
        })
    return summaries


def _settlement_is_known(item: dict) -> bool:
    """조회와 새 기간 계산이 확인된 결과만 정착 집계에 사용한다."""
    possible, attended = item.get('recent3_possible'), item.get('recent3_attended')
    status = item.get('settlement_status')
    if (not item.get('recent3_start') or type(possible) is not int or type(attended) is not int
            or not 0 <= attended <= possible or status not in ('정착', '관찰 중', '미정착')
            or (status == '정착') != (attended > 0)):
        return False
    lookup_status = item.get('조회 상태', item.get('status'))
    return lookup_status == '조회완료' or (
        lookup_status == '계산대상없음' and possible == 0 and attended == 0 and status == '관찰 중')
