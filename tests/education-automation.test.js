const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');

const educationSource = read('education-project', '교육 출석 현황 업데이트.gs');
const notificationSource = read('education-project', '문자 명단 리스트.gs');
const intensiveSource = read('education-project', '집중교육 출석 현황 업데이트.gs');

const sent = [];
const menus = [];
const alerts = [];
const context = {
  console,
  MailApp: { sendEmail: (message) => sent.push(message) },
  SpreadsheetApp: {
    getUi: () => ({
      createMenu(name) {
        const menu = {
          name,
          items: [],
          addItem(label, handler) {
            this.items.push({ label, handler });
            return this;
          },
          addToUi() {
            menus.push({ name: this.name, items: this.items.slice() });
            return this;
          }
        };
        return menu;
      },
      alert(message) {
        alerts.push(String(message));
      }
    })
  },
  Utilities: {
    formatDate: (date) => new Date(date).toISOString().slice(0, 10)
  }
};
vm.createContext(context);
vm.runInContext(
  [educationSource, notificationSource, intensiveSource].join('\n'),
  context
);
const call = (expression) => vm.runInContext(expression, context);

// --- 메일 수신자 안전장치 -------------------------------------------------
call("sendEducationEmail_({ subject: '정기 실행', body: 'b' });");
assert.equal(sent[0].to.split(',').length, 5);
assert.doesNotMatch(sent[0].subject, /^\[TEST\]/);

call("sendEducationEmail_({ subject: '테스트', body: 'b', forceTestRecipient: true });");
assert.equal(sent[1].to, 'ksj747172@gmail.com');
assert.match(sent[1].subject, /^\[TEST\] /);

// 운영 수신자를 직접 넘겨도 안전장치가 이깁니다.
call(`sendEducationEmail_({
  recipients: EDUCATION_AUTOMATION.productionRecipients,
  subject: '테스트2', body: 'b', forceTestRecipient: true
});`);
assert.equal(sent[2].to, 'ksj747172@gmail.com');

// --- 메일 하단 수신자 안내 문구 -------------------------------------------
// 운영 모드에서 '한 명에게만 발송'이라고 잘못 안내하던 문구를 고쳤습니다.
call('globalThis.__describe = describeEducationRecipients_;');
assert.match(context.__describe(false), /운영 수신자 5명/);
assert.doesNotMatch(context.__describe(false), /한 명에게만/);
assert.match(context.__describe(true), /한 명에게만/);
assert.doesNotMatch(
  educationSource,
  /escapeEducationHtml_\(EDUCATION_AUTOMATION\.testRecipient\) \+\s*\n\s*' 한 명에게만 발송됩니다/
);

// --- 테스트 진입점이 안전장치를 켜는지 ------------------------------------
assert.match(
  educationSource,
  /function runEducationTest\(\)[\s\S]{0,220}forceTestRecipient: true/
);
assert.match(
  notificationSource,
  /function runNewcomerNotificationTest\(\)[\s\S]{0,180}forceTestRecipient: true/
);

// 토요일 정기 발송은 안전장치를 켜지 않습니다(운영 5명 유지).
const sentBefore = sent.length;
call("sendEducationEmail_({ subject: '토요일 문자공지', body: 'b', forceTestRecipient: false });");
assert.equal(sent[sentBefore].to.split(',').length, 5);

// --- 집중교육 반영은 실제 시트를 바꾼다 (TEST-EDU-003) --------------------
// Validates: REQ-EDU-003
// 숫자 0과 영문 o/O는 모두 현장에서 쓰는 참석 표시입니다.
call('globalThis.__isIntensiveAttendanceMarked = isIntensiveAttendanceMarked_;');
assert.equal(context.__isIntensiveAttendanceMarked(0), true);
assert.equal(context.__isIntensiveAttendanceMarked('0'), true);
assert.equal(context.__isIntensiveAttendanceMarked('o'), true);
assert.equal(context.__isIntensiveAttendanceMarked('O'), true);
assert.equal(context.__isIntensiveAttendanceMarked(''), false);
assert.equal(context.__isIntensiveAttendanceMarked('X'), false);

// 사용자가 시트에서 실행하는 경로가 실제 반영 함수까지 이어져야 합니다.
call('onOpen();');
assert.deepEqual(menus, [{
  name: '집중교육',
  items: [{ label: '참석 명단 반영', handler: 'applyIntensiveTrainingFromMenu' }]
}]);
call(`
  globalThis.__intensiveApplyCount = 0;
  globalThis.applyIntensiveTrainingNow = function () {
    globalThis.__intensiveApplyCount += 1;
    return { scanned: 36, added: 30, updated: 5, conflicts: [{}] };
  };
  applyIntensiveTrainingFromMenu();
`);
assert.equal(context.__intensiveApplyCount, 1);
assert.equal(alerts.length, 1);
assert.match(alerts[0], /확인 36명/);
assert.match(alerts[0], /추가 30명/);
assert.match(alerts[0], /갱신 5명/);
assert.match(alerts[0], /검토 필요 1명/);

// 잠금·권한·시트 오류가 나면 사용자가 시트 안에서 원인을 확인할 수 있어야 합니다.
call(`
  globalThis.applyIntensiveTrainingNow = function () {
    throw new Error('권한 거부');
  };
`);
assert.throws(
  () => call('applyIntensiveTrainingFromMenu();'),
  /권한 거부/
);
assert.equal(alerts.length, 2);
assert.match(alerts[1], /집중교육 참석 명단 반영 실패/);
assert.match(alerts[1], /권한 거부/);

// 'run*Test'라는 이름이 붙으면 미리보기로 오해되므로 실제 반영 함수는 이름을 분리했습니다.
assert.match(intensiveSource, /function previewIntensiveTraining\(\)[\s\S]{0,120}dryRun: true/);
assert.match(
  intensiveSource,
  /function applyIntensiveTrainingNow\(\)[\s\S]{0,200}dryRun: false/
);
assert.doesNotMatch(intensiveSource, /function runIntensiveTrainingTest\(/);
assert.match(intensiveSource, /previewIntensiveTraining/);

// 시트가 `3-1`을 날짜로 저장해도 화면에 보이는 번호로 분기를 판정합니다.
let writtenIntensiveRows;
const visibleIntensiveRow = ['3-1', '장년', '1팀', '테스트', '010-1234-5678', 'O'];
const storedIntensiveRow = [new Date('2026-03-01'), ...visibleIntensiveRow.slice(1)];
context.SpreadsheetApp.openById = () => ({
  getSheetByName: () => ({
    getLastRow: () => 2,
    getLastColumn: () => 6,
    getRange: () => ({
      getValues: () => [storedIntensiveRow],
      getDisplayValues: () => [visibleIntensiveRow]
    })
  })
});
context.getEducationMasterSheet_ = () => ({
  getLastRow: () => 1,
  getLastColumn: () => 13,
  getMaxRows: () => 10,
  getRange: () => ({ setValues: (rows) => { writtenIntensiveRows = rows; } })
});
context.writeEducationLog_ = () => {};
const intensiveResult = call('syncIntensiveTraining_({ dryRun: false });');
assert.equal(intensiveResult.added, 1);
assert.equal(writtenIntensiveRows[0][10], '3분기 집중교육');

// 이전 실행이 날짜 문자열을 적은 경우에만 그 잘못된 표기를 고칩니다.
const oldIntensiveRow = new Array(13).fill('');
oldIntensiveRow[0] = 1;
oldIntensiveRow[4] = '테스트';
oldIntensiveRow[6] = '010-1234-5678';
oldIntensiveRow[10] = 'Sun Mar 01 2026 00:00:00 GMT+0900 (한국 표준시)분기 집중교육';
context.getEducationMasterSheet_ = () => ({
  getLastRow: () => 2,
  getLastColumn: () => 13,
  getMaxRows: () => 10,
  getRange: () => ({
    getValues: () => [oldIntensiveRow],
    setValues: (rows) => { writtenIntensiveRows = rows; }
  })
});
writtenIntensiveRows = undefined;
const repairResult = call('syncIntensiveTraining_({ dryRun: false });');
assert.equal(repairResult.updated, 1);
assert.equal(writtenIntensiveRows[0][10], '3분기 집중교육');
oldIntensiveRow[10] = '개별 수료';
writtenIntensiveRows = undefined;
const preservedResult = call('syncIntensiveTraining_({ dryRun: false });');
assert.equal(preservedResult.conflicts.length, 1);
assert.equal(oldIntensiveRow[10], '개별 수료');

// --- 금요일 교육 트리거 삭제 도우미 (NFR-OPS-001) -------------------------
// Validates: NFR-OPS-001
// 삭제 도우미는 금요일 `main` CLOCK 트리거만 지우고 나머지는 건드리지 않아야 합니다.
assert.match(educationSource, /function removeFridayEducationTrigger\(\)/);
assert.match(
  educationSource,
  /getHandlerFunction\(\) !== 'main'[\s\S]{0,120}getTriggerSource\(\) !== ScriptApp\.TriggerSource\.CLOCK/
);
assert.match(
  educationSource,
  /day === ScriptApp\.WeekDay\.FRIDAY[\s\S]{0,160}ScriptApp\.deleteTrigger\(trigger\)/
);

// --- 숨김 로그 시트 -------------------------------------------------------
function createFakeSheet(name, { hidden = false } = {}) {
  return {
    name,
    hidden,
    rows: [],
    getSheetId: () => name,
    getName: () => name,
    isSheetHidden() { return this.hidden; },
    hideSheet() { this.hidden = true; },
    setFrozenRows() { return this; },
    getLastRow() { return this.rows.length; },
    insertRowAfter() { return this; },
    getRange() {
      const sheet = this;
      return {
        setValues(values) { sheet.rows.push(...values); return this; },
        setFontWeight() { return this; },
        setNumberFormat() { return this; }
      };
    }
  };
}

const sheets = [createFakeSheet('교육 출석 현황')];
const spreadsheet = {
  sheets,
  active: sheets[0],
  getSheets() { return this.sheets; },
  getSheetByName(name) { return this.sheets.find((s) => s.name === name) || null; },
  setActiveSheet(sheet) { this.active = sheet; },
  insertSheet(name) {
    const sheet = createFakeSheet(name);
    this.sheets.push(sheet);
    this.active = sheet;
    return sheet;
  }
};

call('globalThis.__hiddenLogSheet = getHiddenLogSheet_;');
const logSheet = context.__hiddenLogSheet(spreadsheet, '자동화 로그', ['실행시각']);
assert.equal(logSheet.isSheetHidden(), true, '로그 시트는 숨겨져야 합니다');
assert.equal(spreadsheet.active.getName(), '교육 출석 현황', '활성 시트는 그대로여야 합니다');

assert.doesNotMatch(educationSource, /function writeEducationLog_[\s\S]{0,60}disabled: true/);
assert.match(
  educationSource,
  /writeEducationLog_\('processPendingAttendanceTrigger', result\)/
);

console.log('education automation checks passed');
