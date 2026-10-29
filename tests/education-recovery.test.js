// Validates: REQ-EDU-001, REQ-EDU-002, REQ-EDU-004
const assert = require('node:assert/strict');
const {spreadsheet, load} = require('./helpers/fake-sheets');
function setup(rows) {
  const h = load('education-project/교육 출석 현황 업데이트.gs');
  const config = h.evaluate('EDUCATION_AUTOMATION');
  const master = spreadsheet('master', {[config.masterSheetName]: [Array(13).fill('header')]});
  const source = spreadsheet('source', {[config.sourceSheetName]: [Array(10).fill('header'), ...rows]});
  h.context.SpreadsheetApp.openById = id => id === config.masterSpreadsheetId ? master : source;
  h.properties.set(config.cursorProperty, '0');
  return {...h, config, master, source, run: options => h.context.processPendingAttendance_(options)};
}
const response = (date, week = '1주차', phone = '01011112222', name = 'sample') =>
  [new Date(date), '', week, '', name, phone, '남', '', '조군', '보배'];
const h = setup([response('2026-10-25T03:00:00Z')]);
h.context.MailApp.sendEmail = () => {throw Error('mail unavailable');};
assert.throws(() => h.run({dryRun: false, sendEmail: true}), /mail unavailable/);
assert.equal(h.master.getSheetByName(h.config.masterSheetName).rows.length, 2);
h.context.MailApp.sendEmail = mail => h.sent.push(mail);
h.run({dryRun: false, sendEmail: true});
assert.equal(h.sent.length, 1, '새 응답이 없어도 대기 보고를 보낸다');
h.run({dryRun: false, sendEmail: true});
assert.equal(h.sent.length, 1);
assert.equal(h.context.getEducationOperationalStatus().pendingReports, 0);

const review = setup([response('2026-10-25T03:00:00Z', '7주차')]);
review.run({dryRun: false, sendEmail: false});
assert.equal(review.context.getEducationOperationalStatus().unresolvedReviews, 1);
review.source.getSheetByName(review.config.sourceSheetName).rows[1][2] = '1주차';
const cursor = review.properties.get(review.config.cursorProperty);
review.context.reprocessEducationReviews();
assert.equal(review.context.getEducationOperationalStatus().unresolvedReviews, 0);
assert.equal(review.master.getSheetByName(review.config.masterSheetName).rows.length, 2);
assert.equal(review.properties.get(review.config.cursorProperty), cursor);
assert.equal(review.sent.length, 0, '검토 재처리는 메일을 보내지 않는다');

const preview = setup([response('2026-10-25T03:00:00Z')]);
const before = JSON.stringify([...preview.properties]);
preview.run({dryRun: true, sendEmail: false});
assert.equal(preview.master.writes, 0);
assert.equal(preview.source.writes, 0);
assert.equal(JSON.stringify([...preview.properties]), before);
assert.equal(preview.master.getSheets().length, 1);

// 최신순 입력도 오래된 응답부터 처리하고, 같은 전화번호의 2주차를 이어 붙인다.
const ordered = setup([response('2026-11-01T03:00:00Z', '2주차'), response('2026-10-25T03:00:00Z')]);
ordered.run({dryRun: false, sendEmail: false});
const orderedRow = ordered.master.getSheetByName(ordered.config.masterSheetName).rows[1];
assert.equal(orderedRow[7], '2026-10-25'); assert.equal(orderedRow[8], '2026-11-01');
const noNewMail = setup([]); noNewMail.run({dryRun: false, sendEmail: true});
assert.equal(noNewMail.sent.length, 0);

for (const phase of ['before', 'after']) {
  const interrupted = setup([response('2026-10-25T03:00:00Z')]); let fail = true;
  interrupted.master.fail = write => {
    if (fail && write.name === interrupted.config.masterSheetName && write.phase === phase) {
      fail = false; throw Error('attendance unavailable');
    }
  };
  assert.throws(() => interrupted.run({dryRun: false, sendEmail: false}), /attendance unavailable/);
  interrupted.run({dryRun: false, sendEmail: false});
  assert.equal(interrupted.master.getSheetByName(interrupted.config.masterSheetName).rows.length, 2);
  assert.equal(interrupted.context.getEducationOperationalStatus().pendingReports, 1);
}

const match = setup([]);
const masterSheet = match.master.getSheetByName(match.config.masterSheetName);
const masterRow = [1, '4부', '조', '보배', 'sample', '남', '010-1111-2222', 'kept', '', '', '', '', ''];
masterSheet.rows.push(masterRow.slice());
let actual = match.context.processAttendanceRows_([{sourceRow: 2, values: response('2026-10-25T03:00:00Z')}], {dryRun: false});
assert.equal(actual.duplicates.length, 1); assert.equal(masterSheet.rows[1][7], 'kept');
actual = match.context.processAttendanceRows_([{sourceRow: 2, values: response('2026-10-25T03:00:00Z', '2주차', '01099998888')}], {dryRun: false});
assert.equal(actual.review.length, 1, '이름만 일치하면 자동 반영하지 않는다');
masterSheet.rows.push(masterRow.slice());
actual = match.context.processAttendanceRows_([{sourceRow: 2, values: response('2026-10-25T03:00:00Z', '2주차')}], {dryRun: false});
assert.equal(actual.review.length, 1, '전화번호 중복은 검토한다');

const late = setup([response('2026-10-26T03:00:00Z')]);
assert.equal(late.run({dryRun: true, sendEmail: false}).review.length, 1);
const ambiguous = setup([response('2026-10-25T03:00:00Z', '7주차')]);
ambiguous.run({dryRun: false, sendEmail: false});
ambiguous.source.getSheetByName(ambiguous.config.sourceSheetName).rows.push(response('2026-10-25T03:00:00Z'));
assert.throws(() => ambiguous.context.reprocessEducationReviews(), /一つ|하나로/);
assert.equal(ambiguous.master.getSheetByName(ambiguous.config.masterSheetName).rows.length, 1);
const collision = setup([response('2026-10-25T03:00:00Z', '7주차'), response('2026-10-25T03:00:00Z', '1주차', '01099998888', 'other')]);
collision.run({dryRun: false, sendEmail: false});
assert.equal(collision.context.getEducationOperationalStatus().unresolvedReviews, 1, '같은 시각의 정상 응답이 검토 항목을 해결 처리하지 않는다');

const old = setup([response('2026-10-25T03:00:00Z', '7주차')]);
old.run({dryRun: false, sendEmail: false});
const newest = response('2026-11-01T03:00:00Z'); newest[9] = '새힘';
old.source.getSheetByName(old.config.sourceSheetName).rows.push(newest);
old.run({dryRun: false, sendEmail: false});
old.source.getSheetByName(old.config.sourceSheetName).rows[1][2] = '1주차';
old.context.reprocessEducationReviews();
assert.equal(old.master.getSheetByName(old.config.masterSheetName).rows[1][3], '새힘', '검토 재처리가 현재 군·팀을 되돌리지 않는다');
const changed = setup([response('2026-10-25T03:00:00Z', '2주차')]);
const cm = changed.master.getSheetByName(changed.config.masterSheetName);
cm.rows.push([1, '4부', '조', '보배', 'sample', '남', '010-1111-2222']);
let once = true;
changed.master.fail = w => {if (once && w.name === changed.config.masterSheetName && w.phase === 'before') {once = false; throw Error('pause');}};
assert.throws(() => changed.run({dryRun: false, sendEmail: false}), /pause/);
cm.rows.push([2, '4부', '조', '보배', 'other', '남', '010-1111-2222']);
changed.run({dryRun: false, sendEmail: true});
assert.equal(changed.context.getEducationOperationalStatus().unresolvedReviews, 1, '복구 중 새 충돌은 검토로 보존한다');
assert.match(changed.sent[0].htmlBody, /검토/);
assert.equal(changed.context.readEducationBatches_()[0].data.result.updated, 0, '반영하지 못한 출석을 성공으로 보고하지 않는다');
console.log('education-recovery tests passed');
