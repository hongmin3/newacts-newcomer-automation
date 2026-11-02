"""Validates: REQ-RATEDESKTOP-009. No browser, accounts or network."""
import unittest

from desktop.search import find_with_fallback


FIRST = '#ctl00_cph1_PersonListYouth1_tabConSch_tabPnSch0_ucStateSch0_ddlState'
SECOND = FIRST + '1'


class Select:
    def __init__(self, frame, selector):
        self.frame = frame
        self.selector = selector

    def select_option(self, *, label=None, value=None):
        if self.frame.select_error:
            raise self.frame.select_error
        choices = {'교인': 'member', '청년': 'youth', '': ''}
        selected = choices[label] if label is not None else value
        self.frame.values[self.selector] = selected
        # A parent dropdown change replaces the child after the postback.
        if self.selector == FIRST:
            self.frame.values[SECOND] = ''
        self.frame.pending = True
        return [selected]

    def evaluate(self, expression, expected, *, timeout):
        if self.frame.verify_error:
            raise self.frame.verify_error
        self.frame.pending = False
        labels = {'member': '교인', 'youth': '청년', '': ''}
        return all(
            self.frame.values[item['selector']] == item['value']
            and ('label' not in item or
                 labels[self.frame.values[item['selector']]] == item['label'])
            for item in expected
        )


class Frame:
    def __init__(self):
        self.values = {FIRST: 'visitor', SECOND: ''}
        self.pending = False
        self.select_error = None
        self.verify_error = None

    def locator(self, selector):
        if selector not in self.values:
            raise AssertionError('Unexpected dropdown')
        return Select(self, selector)

class SearchScopeTests(unittest.TestCase):
    def test_youth_success_retains_scope_for_returned_card(self):
        frame = Frame()
        # Production callers pass FrameLocator or Locator, neither of which
        # supplies Frame.wait_for_function().
        self.assertFalse(hasattr(frame, 'wait_for_function'))
        row, card, person = {'새신자': '시험'}, object(), {'id': 'test'}

        def find(scope, actual_row):
            self.assertIs(scope, frame)
            self.assertIs(actual_row, row)
            self.assertEqual(scope.values, {FIRST: 'member', SECOND: 'youth'})
            self.assertFalse(scope.pending)
            return card, '전화번호일치', person

        result = find_with_fallback(frame, row, find)
        self.assertEqual(result, (card, '전화번호일치', person))
        self.assertEqual(frame.values[SECOND], 'youth')

    def test_no_match_retries_all_members_without_resetting_returned_card(self):
        frame, scopes, card = Frame(), [], object()

        def find(scope, row):
            scopes.append(dict(scope.values))
            if len(scopes) == 1:
                return None, '정확한교인없음', {'failure_note': '시험'}
            return card, '이름생년월일일치', {'id': 'other'}

        result = find_with_fallback(frame, {}, find)
        self.assertIs(result[0], card)
        self.assertEqual(scopes, [{FIRST: 'member', SECOND: 'youth'},
                                  {FIRST: 'member', SECOND: ''}])
        self.assertEqual(frame.values[SECOND], '')

    def test_duplicate_and_other_failures_do_not_retry(self):
        for status in ('교인복수일치', '조회오류'):
            with self.subTest(status=status):
                calls = []
                result = (None, status, {'failure_note': '시험'})

                def find(scope, row):
                    calls.append(scope.values[SECOND])
                    return result

                self.assertEqual(find_with_fallback(Frame(), {}, find), result)
                self.assertEqual(calls, ['youth'])

    def test_next_person_resets_to_youth_after_all_member_search(self):
        frame, scopes = Frame(), []

        def no_match(scope, row):
            scopes.append(scope.values[SECOND])
            return None, '정확한교인없음', None

        find_with_fallback(frame, {}, no_match)

        def found(scope, row):
            scopes.append(scope.values[SECOND])
            return object(), '전화번호일치', None

        find_with_fallback(frame, {}, found)
        self.assertEqual(scopes, ['youth', '', 'youth'])

    def test_filter_selection_and_verification_failures_propagate(self):
        for failing_operation in ('select_error', 'verify_error'):
            with self.subTest(operation=failing_operation):
                frame, calls = Frame(), []
                setattr(frame, failing_operation, RuntimeError('범위 변경 실패'))
                with self.assertRaisesRegex(RuntimeError, '범위 변경 실패'):
                    find_with_fallback(frame, {}, lambda *args: calls.append(args))
                self.assertEqual(calls, [])
