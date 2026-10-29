// Validates: REQ-NOTI-001
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {spreadsheet, load} = require('./helpers/fake-sheets');
const h = load('education-project/교육 출석 현황 업데이트.gs');
vm.runInContext(fs.readFileSync(require.resolve('../education-project/문자 명단 리스트.gs'), 'utf8'), h.context);
const edu = h.evaluate('EDUCATION_AUTOMATION'), noti = h.evaluate('NOTIFICATION_CONFIG');
const make = (name, phone, week1, week4 = '', optOut = '') => [1, '', '조', '보배', name, '', phone, week1, '', '', week4, optOut];
const master = spreadsheet('master', {[edu.masterSheetName]: [Array(13).fill('header'),
  make('included', '01011112222', '2026-10-25'),
  make('duplicate', '010-1111-2222', '2026-10-25'),
  make('old', '01011112223', '2025-10-25'),
  make('completed', '01011112224', '2026-10-25', '수료'),
  make('opt-out', '01011112225', '2026-10-25', '', 'o')
]});
const registered = (name, phone, date, week = '', opt = '') => [1, '조', '보배', '', name, '', phone, date, week, '', '', '', opt];
const registration = spreadsheet('registration', {[noti.registrationSheetName]: [Array(13).fill('header'),
  registered('included', '01011112222', '2026-10-25'),
  registered('started', '01011112223', '2026-10-25', '2026-10-25'),
  registered('old', '01011112224', '2025-10-25'),
  registered('opt-out', '01011112225', '2026-10-25', '', 'O')
]});
h.context.SpreadsheetApp.openById = id => id === edu.masterSpreadsheetId ? master : registration;
const cutoff = new Date('2026-10-01T00:00:00+09:00');
assert.deepEqual(Array.from(h.context.getEducationInProgressList_(cutoff), p => p.name), ['included']);
assert.deepEqual(Array.from(h.context.getNotStartedList_(cutoff), p => p.name), ['included']);
assert.equal(h.sent.length, 0); assert.equal(master.writes + registration.writes, 0);
console.log('notification-selection tests passed');
