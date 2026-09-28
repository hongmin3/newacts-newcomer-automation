const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const serverSource = fs.readFileSync(
  path.join(root, 'attendance-webapp', 'Code.gs'),
  'utf8'
);
const htmlSource = fs.readFileSync(
  path.join(root, 'attendance-webapp', 'Index.html'),
  'utf8'
);

const context = { console };
vm.createContext(context);
vm.runInContext(
  serverSource + `
    globalThis.__test = {
      normalizeAttendanceName_,
      normalizeAttendancePhone_,
      isValidAttendancePhone_,
      formatAttendancePhone_,
      parseAttendanceWeek_,
      validateAttendanceSubmission_,
      insertAttendanceNewestFirst_
    };
  `,
  context
);

const api = context.__test;
assert.equal(api.normalizeAttendanceName_(' 홍 민 '), '홍민');
assert.equal(api.normalizeAttendancePhone_('010-1234-5678'), '01012345678');
assert.equal(api.isValidAttendancePhone_('01012345678'), true);
assert.equal(api.isValidAttendancePhone_('021234567'), false);
assert.equal(api.formatAttendancePhone_('01012345678'), '010-1234-5678');
assert.equal(api.parseAttendanceWeek_('4주차'), 4);

assert.throws(
  () => api.validateAttendanceSubmission_({
    name: '테스트',
    phone: '010-1234-5678',
    week: 5,
    gun: '신군',
    team: '가예(신군)'
  }),
  /허용되지 않은 교육 주차/
);

// 운영 시트는 최신순이므로 신규 응답은 헤더 바로 아래(2행)에 삽입해야 합니다.
const calls = [];
const written = [];
const fakeSheet = {
  insertRowBefore(row) {
    calls.push(['insertRowBefore', row]);
  },
  getRange(row, column, numRows, numColumns) {
    calls.push(['getRange', row, column, numRows, numColumns]);
    return {
      setValues(values) {
        written.push(values);
        return this;
      },
      setNumberFormat(format) {
        calls.push(['setNumberFormat', format]);
        return this;
      }
    };
  }
};
const newRow = ['2026-09-20 09:00:00', '동의', '1주차', '지인', '홍민', '010-1234-5678', '남자', '20', '신군', '가예'];
api.insertAttendanceNewestFirst_(fakeSheet, newRow);

const sameShape = (actual, expected) =>
  assert.equal(JSON.stringify(actual), JSON.stringify(expected));

sameShape(calls[0], ['insertRowBefore', 2]);
sameShape(calls[1], ['getRange', 2, 1, 1, newRow.length]);
sameShape(written, [[newRow]]);
sameShape(calls[2], ['getRange', 2, 1, null, null]);
sameShape(calls[3], ['setNumberFormat', 'yyyy. MM. dd HH:mm:ss']);

assert.match(serverSource, /insertAttendanceNewestFirst_\(sheet, newRow\)/);
assert.doesNotMatch(serverSource, /sheet\.appendRow\(newRow\)/);
assert.match(serverSource, /LockService\.getScriptLock/);
assert.match(htmlSource, /\.withFailureHandler\(showRequestError\)/);
assert.match(htmlSource, /escapeHtml\(userData\.name\)/);

console.log('attendance web app static and validation checks passed');
