"""Select a read-only member search scope before using the existing matcher."""
import time

_STATE = '#ctl00_cph1_PersonListYouth1_tabConSch_tabPnSch0_ucStateSch0_ddlState'
_SUBSTATE = _STATE + '1'
_SCOPE_TIMEOUT_MS = 15000

# Re-read the current DOM after ASP.NET replaces controls. These are visible
# dropdown selections, never ASP.NET hidden fields or saved server state.
_SCOPE_READY = """(element, expected) => {
    const document = element.ownerDocument;
    const window = document.defaultView;
    if (document.readyState === 'loading') return false;
    const webForms = window.Sys && window.Sys.WebForms;
    const manager = webForms && webForms.PageRequestManager
        ? webForms.PageRequestManager.getInstance() : null;
    if (manager && manager.get_isInAsyncPostBack()) return false;
    return expected.every(item => {
        const select = document.querySelector(item.selector);
        if (!select || select.disabled || !select.selectedOptions.length) return false;
        const option = select.selectedOptions[0];
        return option.value === item.value &&
            (item.label === undefined || option.textContent.trim() === item.label);
    });
}"""


def _wait_for_scope(right_frame, expected):
    deadline = time.monotonic() + _SCOPE_TIMEOUT_MS / 1000
    while True:
        remaining_ms = max(1, int((deadline - time.monotonic()) * 1000))
        # Both supported callers (FrameLocator and Locator) offer locator().
        # Re-resolve the dropdown each pass because a postback can replace it.
        if right_frame.locator(_STATE).evaluate(
            _SCOPE_READY, expected, timeout=remaining_ms,
        ):
            return
        if time.monotonic() >= deadline:
            raise TimeoutError('디모데 검색 범위 변경 확인 시간이 초과되었습니다.')
        time.sleep(0.05)


def _select(right_frame, selector, *, label=None, value=None):
    choice = {'label': label} if label is not None else {'value': value}
    selected = right_frame.locator(selector).select_option(**choice)
    if len(selected) != 1 or (value is not None and selected[0] != value):
        raise RuntimeError('디모데 검색 범위 선택을 확인할 수 없습니다.')
    expected = {'selector': selector, 'value': selected[0]}
    if label is not None:
        expected['label'] = label
    _wait_for_scope(right_frame, [expected])
    return expected


def find_with_fallback(right_frame, row, find_in_scope):
    """Try youth first, then all members only for an unambiguous no-match.

    Return the matcher's ``(card, status, candidate)`` unchanged. The selected
    scope stays in place so callers can use the returned card locator. The next
    invocation resets to youth. Filter errors propagate to the caller's normal
    per-person failure handling instead of searching an uncertain scope.
    """
    member = _select(right_frame, _STATE, label='교인')
    youth = _select(right_frame, _SUBSTATE, label='청년')
    _wait_for_scope(right_frame, [member, youth])
    result = find_in_scope(right_frame, row)
    card, status, _candidate = result
    if card is None and status == '정확한교인없음':
        all_members = _select(right_frame, _SUBSTATE, value='')
        _wait_for_scope(right_frame, [member, all_members])
        return find_in_scope(right_frame, row)
    return result
