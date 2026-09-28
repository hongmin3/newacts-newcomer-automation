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
      validateAttendanceSubmission_
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

assert.match(serverSource, /sheet\.appendRow\(newRow\)/);
assert.doesNotMatch(serverSource, /insertRowAfter\(1\)/);
assert.match(serverSource, /LockService\.getScriptLock/);
assert.match(htmlSource, /\.withFailureHandler\(showRequestError\)/);
assert.match(htmlSource, /escapeHtml\(userData\.name\)/);

console.log('attendance web app static and validation checks passed');
