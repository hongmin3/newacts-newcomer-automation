// Validates the actual attendance-to-education handoff for REQ-ORGSETTINGS-003 and REQ-ORGSETTINGS-004.
const assert = require('node:assert/strict');
const { load, spreadsheet } = require('./helpers/fake-sheets');

const config = {
  id: 'new-term',
  groups: [{key: '조', label: '조군', recipient: 'example@example.test', teams: ['가예']}]
};
const now = '2026-11-22T04:00:00.000Z';
class FixedDate extends Date {
  constructor(...args) { super(...(args.length ? args : [now])); }
  static now() { return Date.parse(now); }
}
const person = {name: '가상 참석자', phone: '010-0000-1111'};
const original = [1, '4', '신', '가예', person.name, '여', person.phone,
  '2026-11-08', '2026-11-15', '', '', '', '이전 메모'];
const educationBook = spreadsheet('education', {'교육 출석 현황': [['번호'], original]});
const attendanceBook = spreadsheet('attendance', {'설문지 응답 시트1': [['제출 시각']]});
const responses = attendanceBook.getSheetByName('설문지 응답 시트1');
responses.insertRowBefore = row => responses.rows.splice(row - 1, 0, []);

const attendance = load('attendance-webapp/Code.gs');
attendance.context.Date = FixedDate;
attendance.context.readOrgConfiguration_ = () => config;
attendance.context.SpreadsheetApp.getActiveSpreadsheet = () => attendanceBook;
attendance.context.SpreadsheetApp.openById = id => {
  assert.equal(id, 'education');
  return educationBook;
};
attendance.context.SpreadsheetApp.flush = () => {};
attendance.properties.set('ORG_EDUCATION_SPREADSHEET_ID', 'education');

const ready = attendance.context.loadAttendanceForm(person.name, person.phone);
assert.equal(ready.record.week + 1, 3);
assert.equal(ready.record.gun, '', '남아 있는 예전 군을 새 배치에서 선택하지 않는다.');
assert.equal(JSON.stringify(ready.organization).includes('example@example.test'), false);

const request = {...person, gun: '조군', team: '가예(조군)', week: 3, orgConfigId: config.id};
assert.equal(attendance.context.submitAttendance(request).duplicate, false);
assert.equal(attendance.context.submitAttendance(request).duplicate, true);
assert.equal(responses.rows.length, 2);
assert.equal(responses.rows[1][9], '가예(조군)');
assert.equal(educationBook.writes, 0, '웹앱은 교육 기록을 직접 바꾸지 않는다.');

const education = load('education-project/교육 출석 현황 업데이트.gs');
education.context.Date = FixedDate;
education.context.readOrgConfiguration_ = () => config;
education.context.findOrgGroup_ = (configuration, value) =>
  configuration.groups.find(group => group.label === value || group.key === value) || null;
education.context.SpreadsheetApp.openById = () => educationBook;
const actual = education.context.processAttendanceRows_([{sourceRow: 2, values: responses.rows[1]}], {dryRun: false});
assert.equal(actual.updated, 1);
assert.equal(actual.review.length, 0);
const row = educationBook.getSheetByName('교육 출석 현황').rows[1];
assert.deepEqual(row.slice(2, 4), ['조', '가예']);
assert.deepEqual(row.slice(7, 10), [original[7], original[8], '2026-11-22']);
const history = educationBook.getSheetByName('교육 소속 변경 이력');
assert.ok(history);
assert.match(JSON.stringify(history.rows[1]), /신.*가예.*조.*가예/);
assert.equal(education.context.processAttendanceRows_([{sourceRow: 2, values: responses.rows[1]}], {
  dryRun: false
}).duplicates.length, 1);
assert.equal(history.rows.length, 2);
assert.deepEqual(responses.rows[1].slice(8), ['조군', '가예(조군)']);
console.log('기존 2주차 조회 → 3주차 중복 방지 → 교육 반영 및 이전 소속 보존 통과');
