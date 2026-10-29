// Validates: REQ-INTENSIVE-001, REQ-INTENSIVE-002
const assert = require('node:assert/strict');
const {spreadsheet, load} = require('./helpers/fake-sheets');
function setup() {
  const h = load('intensive-training-application/Code.gs');
  const c = h.evaluate('CONFIG');
  const q = h.evaluate('Q');
  const headers = [q.APPLICANT, q.GROUP, q.TEAM, q.ATTENDEE, q.PHONE];
  const values = ['applicant', '조군', '보배', 'attendee', '01011112222'];
  const admin = spreadsheet('admin', {[c.ADMIN_VIEW_SHEET_NAME]: [Array(9).fill('header')],
    responses: [['시각', ...headers], [new Date('2026-10-25T03:00:00Z'), ...values]]});
  const pub = spreadsheet('public', {[c.PUBLIC_SHEET_NAME]: [Array(5).fill('header')]});
  h.properties.set('ADMIN_SS_ID', 'admin'); h.properties.set('PUBLIC_SS_ID', 'public');
  h.context.SpreadsheetApp.openById = id => id === 'admin' ? admin : pub;
  const event = {range: admin.getSheetByName('responses').getRange(2, 1),
    values: [new Date('2026-10-25T03:00:00Z'), ...values]};
  return {...h, c, admin, pub, event, run: () => h.context.onFormSubmitHandler(event)};
}
for (const phase of ['before', 'after']) {
  const h = setup(); let fail = true;
  h.pub.fail = write => {
    if (fail && write.phase === phase) {fail = false; throw Error('public unavailable');}
  };
  assert.throws(h.run, /public unavailable/);
  h.run(); h.run();
  assert.equal(h.admin.getSheetByName(h.c.ADMIN_VIEW_SHEET_NAME).rows.length, 2, '관리자 중복 금지');
  assert.equal(h.pub.getSheetByName(h.c.PUBLIC_SHEET_NAME).rows.length, 2, '공개 중복 금지');
  assert.equal(h.context.getIntensiveApplicationStatus().pending, 0);
}
const moved = setup();
const responses = moved.admin.getSheetByName('responses');
responses.rows.splice(1, 0, [new Date('2026-10-26T03:00:00Z'), 'new-applicant', '조군', '보배', 'other', '01099998888']);
moved.run();
const journal = moved.admin.getSheetByName('신청 처리 기록');
assert.match(journal.rows[1][0], new RegExp(String(new Date('2026-10-25T03:00:00Z').getTime()) + '$'), '원본 순서가 바뀌어도 제출 시각으로 찾는다');

const twice = setup(); twice.run();
const raw = twice.admin.getSheetByName('responses');
raw.rows.push([new Date('2026-10-26T03:00:00Z'), ...twice.event.values.slice(1)]);
twice.event = {range: raw.getRange(3, 1), values: raw.rows[2].slice()};
twice.context.onFormSubmitHandler(twice.event);
assert.equal(twice.admin.getSheetByName(twice.c.ADMIN_VIEW_SHEET_NAME).rows[2][7], '중복 의심');
assert.equal(twice.pub.getSheetByName(twice.c.PUBLIC_SHEET_NAME).rows.length, 3);

const invalid = setup(); invalid.event.values[5] = 'bad'; invalid.run();
assert.equal(invalid.pub.getSheetByName(invalid.c.PUBLIC_SHEET_NAME).rows.length, 1);
assert.equal(invalid.admin.getSheetByName(invalid.c.ADMIN_VIEW_SHEET_NAME).rows[1][8], '전화번호 형식 오류');

const verify = setup();
verify.properties.set('SYSTEM_FOLDER_ID', 'folder'); verify.properties.set('FORM_ID', 'form');
const admin = spreadsheet('admin', {[verify.c.ADMIN_VIEW_SHEET_NAME]: [[]], [verify.c.RAW_SHEET_NAME]: [[]]});
const publicBook = spreadsheet('public', {[verify.c.PUBLIC_SHEET_NAME]: [['번호', '군', '팀', '집중교육 참석자 이름', '신청자 이름']]});
verify.context.SpreadsheetApp.openById = id => id === 'admin' ? admin : publicBook;
verify.context.getIntensiveJournal_(admin, true);
verify.context.assertSafeSharing = () => {};
verify.context.DriveApp = {getFileById: () => ({}), getFolderById: () => ({getFiles: () => {
  const ids = ['form', 'admin', 'public']; let i = 0;
  return {hasNext: () => i < ids.length, next: () => ({getId: () => ids[i++]})};
}})};
verify.context.FormApp = {openById: () => {throw Error('FORM_REACHED');}};
assert.throws(() => verify.context.verifySystem(), /FORM_REACHED/, '숨김 기록이 생겨도 기존 시스템 검증을 통과한다');
const sorted = setup();
const ps = sorted.pub.getSheetByName(sorted.c.PUBLIC_SHEET_NAME);
ps.rows.push([1, '조', '보배', 'prior', 'prior-applicant']);
let interruption = true;
sorted.pub.fail = w => {if (interruption && w.phase === 'after') {interruption = false; throw Error('pause');}};
assert.throws(sorted.run, /pause/);
[ps.rows[1], ps.rows[2]] = [ps.rows[2], ps.rows[1]];
sorted.run();
assert.deepEqual(ps.rows.slice(1).map(row => row[3]).sort(), ['attendee', 'prior'], '사람이 정렬한 기존 행을 덮어쓰지 않는다');
const queued = setup();
queued.pub.fail = () => {throw Error('offline');};
assert.throws(queued.run, /offline/);
const qr = queued.admin.getSheetByName('responses');
qr.rows.push([new Date('2026-10-26T03:00:00Z'), ...queued.event.values.slice(1)]);
assert.throws(() => queued.context.onFormSubmitHandler({range: qr.getRange(3, 1), values: qr.rows[2]}), /offline/);
assert.equal(queued.context.getIntensiveApplicationStatus().pending, 2, '기존 실패가 있어도 새 제출을 복구 목록에 먼저 보관한다');
queued.pub.fail = null;
queued.context.retryPendingIntensiveApplications();
assert.equal(queued.pub.getSheetByName(queued.c.PUBLIC_SHEET_NAME).rows.length, 3, '별도 제출 두 건을 각각 복구한다');
assert.equal(queued.admin.getSheetByName(queued.c.ADMIN_VIEW_SHEET_NAME).rows[2][7], '중복 의심');
console.log('intensive-recovery tests passed');
