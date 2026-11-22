const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { load, spreadsheet } = require('./helpers/fake-sheets');

const educationFile = 'education-project/교육 출석 현황 업데이트.gs';
const maintenanceFile = 'registration-project/등록새가족-군현황 자동 배치.gs';
const cutoff = new Date('2026-11-15T00:00:00+09:00').getTime();
const previous = {
  id: 'previous', groups: [{ key: '석', label: '석군', recipient: 'retired@example.test', teams: ['이전팀'] }]
};
const current = {
  id: 'current', effectiveAt: new Date(cutoff), groups: [
    { id: 'spring', key: '새군', label: '새봄군', recipient: 'spring@example.test', teams: ['봄팀'] },
    { key: '조', label: '조군', recipient: 'jo@example.test', teams: ['조팀'] }
  ]
};
const renamed = {
  ...current,
  id: 'renamed',
  effectiveAt: new Date('2026-11-23T00:00:00+09:00'),
  groups: [{ ...current.groups[0], key: '봄', label: '다음계절군', aliases: ['새군', '새봄군'] }, current.groups[1]]
};

function useLatestVersion(context, version) {
  const originalReader = context.readOrgConfiguration_;
  context.readOrgConfiguration_ = date => date == null || Number(date) >= Number(version.effectiveAt) ?
    version : originalReader(date);
}

function wireConfiguration(context) {
  context.readOrgConfiguration_ = date => date != null && Number(date) < cutoff ? previous : current;
  context.findOrgGroup_ = (configuration, value) =>
    configuration.groups.find(group => [group.key, group.label, ...(group.aliases || [])].includes(String(value || '').trim())) || null;
}

function makeMasterRow(week1, week2, group = '석', team = '이전팀') {
  return [1, '4', group, team, '예시이름', '여', '010-0000-0001', week1, week2, '', '', '', '원래 메모'];
}

function sourceRow(source, date, week, group, team, name = '예시이름') {
  return { sourceRow: source, timestampMs: new Date(date).getTime(), values: [date, '', week + '주차', '', name, '010-0000-0001', '여', '', group, team] };
}

function education(rows, priorRows = []) {
  const app = load(educationFile);
  wireConfiguration(app.context);
  const book = spreadsheet('current', { '교육 출석 현황': [['번호'], ...rows] });
  const oldBook = spreadsheet('archive', { '교육 출석 현황': [['번호'], ...priorRows] });
  const currentId = app.evaluate('EDUCATION_AUTOMATION.masterSpreadsheetId');
  app.context.SpreadsheetApp.openById = id => {
    if (id === currentId) return book;
    assert.equal(id, 'archive');
    return oldBook;
  };
  if (priorRows.length) app.properties.set('ORG_PREVIOUS_EDUCATION_SPREADSHEET_ID', 'archive');
  return { app, book, oldBook, sheet: book.getSheetByName('교육 출석 현황') };
}

// Validates: REQ-ORGSETTINGS-003, REQ-ORGSETTINGS-004
{
  const { app, book, sheet } = education([makeMasterRow('2026-11-01', '2026-11-08')]);
  const third = sourceRow(5, '2026-11-22T04:00:00Z', 3, '새봄군', '봄팀(새봄군)');
  const applied = app.context.processAttendanceRows_([third], { dryRun: false });
  assert.equal(applied.updated, 1);
  assert.deepEqual(sheet.rows[1].slice(2, 4), ['새군', '봄팀']);
  assert.deepEqual(sheet.rows[1].slice(7, 10), ['2026-11-01', '2026-11-08', '2026-11-22']);
  const history = book.getSheetByName('교육 소속 변경 이력');
  assert.ok(history?.isSheetHidden());
  assert.match(JSON.stringify(history.rows[1]), /이전팀.*봄팀/);
  app.context.processAttendanceRows_([sourceRow(6, '2026-11-23T04:00:00Z', 3, '조군', '조팀')], { dryRun: false });
  assert.deepEqual(sheet.rows[1].slice(2, 4), ['새군', '봄팀']);
  assert.equal(history.rows.length, 2);
  assert.equal(sheet.rows[1][12], '원래 메모');
}

{
  const { app, sheet } = education([makeMasterRow('2026-11-01', '')]);
  const applied = app.context.processAttendanceRows_([
    sourceRow(3, '2026-11-08T04:00:00Z', 2, '석군', '이전팀'),
    sourceRow(4, '2026-11-22T04:00:00Z', 3, '새봄군', '봄팀(조군)')
  ], { dryRun: false });
  assert.equal(applied.updated, 2);
  assert.equal(applied.review.length, 1);
  assert.deepEqual(sheet.rows[1].slice(2, 4), ['석', '이전팀']);
  assert.deepEqual(sheet.rows[1].slice(7, 10), ['2026-11-01', '2026-11-08', '2026-11-22']);
}

{
  const old = makeMasterRow('2026-11-01', '2026-11-08');
  const { app, oldBook, sheet } = education([], [old]);
  const third = sourceRow(9, '2026-11-22T04:00:00Z', 3, '새봄군', '봄팀(새봄군)');
  const applied = app.context.processAttendanceRows_([third], { dryRun: false });
  assert.equal(applied.added, 1);
  assert.deepEqual(sheet.rows[1].slice(2, 4), ['새군', '봄팀']);
  assert.deepEqual(sheet.rows[1].slice(7, 10), ['2026-11-01', '2026-11-08', '2026-11-22']);
  assert.equal(sheet.rows[1][12], '');
  assert.equal(oldBook.writes, 0);
}

{
  const { app, sheet } = education([], [makeMasterRow('', '2026. 11. 8')]);
  const third = sourceRow(9, '2026-11-22T04:00:00Z', 3, '새봄군', '봄팀(새봄군)');
  const result = app.context.processAttendanceRows_([third], { dryRun: false });
  assert.equal(result.added, 1);
  assert.deepEqual(sheet.rows[1].slice(7, 10), ['', '2026. 11. 8', '2026-11-22']);
}

{
  const { app, sheet } = education([makeMasterRow('2026-11-01', '')]);
  const result = app.context.processAttendanceRows_([
    sourceRow(4, '2026-11-22T04:00:00Z', 2, '새봄군', '봄팀', '다른이름')
  ], { dryRun: false });
  assert.equal(result.review.length, 1);
  assert.equal(sheet.rows[1][8], '');
}

{
  const { app, book, sheet } = education([makeMasterRow('2026-11-01', '2026-11-08')]);
  const response = sourceRow(11, '2026-11-22T04:00:00Z', 3, '새봄군', '봄팀(새봄군)');
  book.fail = action => {
    if (action.name === '교육 출석 현황' && action.phase === 'before') throw new Error('테스트 중단');
  };
  assert.throws(() => app.context.queueEducationBatch_([response], response.timestampMs, { sendEmail: false }), /테스트 중단/);
  assert.equal(book.getSheetByName('교육 소속 변경 이력').rows.length, 2);
  assert.equal(sheet.rows[1][9], '');
  book.fail = null;
  app.context.recoverEducationBatches_({ sendEmail: false });
  assert.deepEqual(sheet.rows[1].slice(2, 4), ['새군', '봄팀']);
  assert.equal(sheet.rows[1][9], '2026-11-22');
  assert.equal(book.getSheetByName('교육 소속 변경 이력').rows.length, 2);
}

{
  const { app, book, sheet } = education([makeMasterRow('2026-11-01', '2026-11-08')]);
  const response = sourceRow(12, '2026-11-22T04:00:00Z', 3, '새봄군', '봄팀(조군)');
  const result = app.context.queueEducationBatch_([response], response.timestampMs, { sendEmail: false });
  assert.equal(result.updated, 1);
  assert.equal(result.review.length, 1);
  assert.equal(book.getSheetByName('교육 검토 목록').rows[1][1], 'OPEN');
  assert.equal(sheet.rows[1][9], '2026-11-22');
  assert.deepEqual(sheet.rows[1].slice(2, 4), ['석', '이전팀']);
}

function registration() {
  const app = load(maintenanceFile);
  for (const file of ['등록 새가족 새가족교육 수료현황 자동화.gs', '하반기 방문 관리.gs', '제목 없음.gs']) {
    vm.runInContext(fs.readFileSync(path.resolve(__dirname, '..', 'registration-project', file), 'utf8'), app.context);
  }
  app.context.Utilities.formatDate = (date, tz, format) => {
    const [year, month, day] = new Intl.DateTimeFormat('sv-SE', {timeZone: tz}).format(new Date(date)).split('-');
    return format === 'M/d' ? Number(month) + '/' + Number(day) : [year, month, day].join('-');
  };
  wireConfiguration(app.context);
  return app;
}

function registered(group, name) {
  return [1, '5/10', 4, group, '봄팀', name, '', '', '', '010-0000-0001', '', '', '', ''];
}

function completion(group, name) {
  return [4, group, '봄팀', '', name, '', '010-0000-0001', '5/10', '', '', '', ''];
}

// Validates: REQ-ORGSETTINGS-004
{
  const app = registration();
  const book = spreadsheet('registration', {
    '등록 새가족': [['번호'], registered('새봄군', '새 이름'), registered('석', '이전 이름')],
    '등록 새가족 군 현황': [['날짜']],
    '새가족교육 수료현황': [['예배'], completion('새군', '새 이름'), completion('석', '이전 이름'), completion('새봄군 미확정', '비슷한 이름'), []]
  });
  app.context.getRegistrationSpreadsheet_ = () => book;
  const dashboard = app.context.updateNewFamilyStatus_({ dryRun: true });
  assert.equal(dashboard.processed, 2);
  assert.equal(dashboard.unassigned, 1);
  assert.equal(dashboard.attention[0].name, '이전 이름');
  assert.equal(dashboard.verification.matched, true);
  const result = app.context.buildAndSendWeeklyReports_({
    syncResult: { discrepancies: [], ambiguous: [], unmatched: [] }, sendEmail: true, label: '검증'
  });
  assert.equal(result.total.registered, 3);
  assert.equal(result.byGroup['새군'].registered, 1);
  assert.equal(result.byGroup['미배정'].registered, 2);
  assert.equal(app.sent[1].to, 'spring@example.test');
  assert.equal(app.sent.length, 2);
  assert.match(app.sent[0].htmlBody, /미배정/);
  assert.doesNotMatch(app.sent[1].htmlBody, /이전 이름|비슷한 이름/);
  app.sent.length = 0;
  app.context.buildAndSendWeeklyReports_({
    syncResult: { discrepancies: [], ambiguous: [], unmatched: [] },
    sendEmail: true, forceTestRecipient: true, label: '검증'
  });
  assert.equal(app.sent.length, 1);
  assert.match(app.sent[0].subject, /^\[TEST\] /);
  assert.notEqual(app.sent[0].to, 'spring@example.test');

  useLatestVersion(app.context, renamed);
  const renamedDashboard = app.context.updateNewFamilyStatus_({ dryRun: true });
  assert.equal(renamedDashboard.unassigned, 1);
  assert.equal(renamedDashboard.attention[0].name, '이전 이름');
  const renamedReport = app.context.buildAndSendWeeklyReports_({
    syncResult: { discrepancies: [], ambiguous: [], unmatched: [] }, sendEmail: false, label: '검증'
  });
  assert.equal(renamedReport.byGroup['봄'].registered, 1);
  assert.equal(renamedReport.byGroup['미배정'].registered, 2);
}

{
  const app = registration();
  const matrix = Array.from({ length: 12 }, () => new Array(10).fill(''));
  matrix[0][9] = '5/10';
  matrix[1][9] = '일반';
  matrix[2][2] = '석군';
  matrix[2][3] = 8;
  matrix[3][2] = '새봄군';
  matrix[3][3] = 4;
  const book = spreadsheet('registration', {
    '등록 새가족': [['번호'], registered('새군', '새 이름'), registered('석', '이전 이름')],
    '상반기 결산': matrix
  });
  app.context.getRegistrationSpreadsheet_ = () => book;
  const result = app.context.generateSettlementReport_({ dryRun: false });
  const sheet = book.getSheetByName('상반기 결산');
  assert.equal(result.counted, 2);
  assert.equal(sheet.rows[3][9], 1);
  assert.equal(sheet.rows[2][9], 0);
  assert.equal(sheet.rows[2][3], 8);
  assert.equal(sheet.rows[3][3], 4);
  assert.equal(sheet.rows[11][9], 2);
  assert.equal(sheet.rows[11][4], 2);
  assert.equal(sheet.rows.find(row => row[0] === '미배정')[9], 1);
  useLatestVersion(app.context, renamed);
  const afterRename = app.context.generateSettlementReport_({ dryRun: false });
  assert.equal(afterRename.counted, 2);
  assert.equal(sheet.rows[3][2], '새봄군');
  assert.equal(sheet.rows[3][3], 4);
  assert.equal(sheet.rows[3][9], 1);
  assert.equal(sheet.rows.find(row => row[0] === '다음계절군')[9], 1);
}


{
  const app = registration();
  const visitor = (group, name) => [1, '2026-10-31', 4, group, '', name, '', '', '', '', '', 'O'];
  const existing = [visitor('새봄군', '새 이름'), visitor('석', '이전 이름')];
  const plan = app.context.buildVisitorSyncPlan_([], existing, [],
    { start: '2026-10-04', end: '2026-11-01', today: '2026-11-02' });
  assert.equal(plan.summary.groups['새군'], 1);
  assert.equal(plan.summary.groups['미배정'], 1);
  assert.equal(plan.campaign.event, 1);
  assert.equal(plan.campaign.unassigned, 1);
  useLatestVersion(app.context, renamed);
  const formulas = app.context.buildVisitorCampaignFormulaRows_(['새봄군', '합계'], 20,
    { start: '2026-10-04', end: '2026-11-01' });
  for (const row of formulas) {
    assert.match(row[0], /="새군"/);
    assert.match(row[0], /="새봄군"/);
  }
}

{
  const app = registration();
  const row = registered('조', '예시이름');
  row[4] = '조팀';
  const book = spreadsheet('registration', { '등록 새가족': [['번호'], row] });
  const attendance = spreadsheet('attendance', {
    '설문지 응답 시트1': [['날짜'],
      sourceRow(2, '2026-11-08T04:00:00Z', 2, '석군', '이전팀').values,
      sourceRow(3, '2026-11-22T04:00:00Z', 3, '새봄군', '봄팀(새봄군)').values,
      sourceRow(4, '2026-11-29T04:00:00Z', 4, '조군', '봄팀').values]
  });
  app.context.getRegistrationSpreadsheet_ = () => book;
  app.context.SpreadsheetApp.openById = () => attendance;
  const properties = {};
  app.context.PropertiesService.getScriptProperties = () => ({ getProperties: () => properties });
  const result = app.context.reconcileRegistrationWithLatestAttendance_({ dryRun: true });
  assert.equal(result.changes.find(change => change.field === '군')?.after, '새군');
  assert.equal(result.review.length, 1);
  const originalReader = app.context.readOrgConfiguration_;
  const contactUpdate = {
    ...current,
    id: 'contact-update',
    effectiveAt: new Date('2026-11-23T00:00:00+09:00'),
    groups: [{ ...current.groups[0], recipient: 'new-contact@example.test' }, current.groups[1]]
  };
  app.context.readOrgConfiguration_ = date => date == null || Number(date) >= Number(contactUpdate.effectiveAt) ?
    contactUpdate : originalReader(date);
  const afterContactUpdate = app.context.reconcileRegistrationWithLatestAttendance_({ dryRun: true });
  assert.equal(afterContactUpdate.changes.find(change => change.field === '군')?.after, '새군');
  app.context.readOrgConfiguration_ = originalReader;
  useLatestVersion(app.context, renamed);
  const afterRename = app.context.reconcileRegistrationWithLatestAttendance_({ dryRun: true });
  assert.equal(afterRename.changes.find(change => change.field === '군')?.after, '봄');
  app.context.readOrgConfiguration_ = originalReader;
  useLatestVersion(app.context, {
    ...renamed,
    groups: [{ ...renamed.groups[0], id: 'different-group' }, renamed.groups[1]]
  });
  const borrowedAlias = app.context.reconcileRegistrationWithLatestAttendance_({ dryRun: true });
  assert.equal(borrowedAlias.changes.length, 0);
  app.context.readOrgConfiguration_ = originalReader;
  useLatestVersion(app.context, renamed);
  const owner = { nameKey: '예시이름', dateKey: 'month-day:5/10' };
  const key = app.evaluate('REGISTRATION_AUTOMATION.correctionStatePrefix') + 'V2_' + encodeURIComponent(JSON.stringify(owner));
  properties[key] = JSON.stringify({ version: 2, owner, fields: { group: { protected: true } } });
  const protectedResult = app.context.reconcileRegistrationWithLatestAttendance_({ dryRun: true });
  assert.equal(protectedResult.changes.length, 0);
  assert.equal(protectedResult.protected.length, 2);
}

console.log('조직 설정 교육·등록 보고 검증 통과');
