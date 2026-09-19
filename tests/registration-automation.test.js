const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');

const maintenanceSource = read('registration-project', '등록새가족-군현황 자동 배치.gs');
const completionSource = read('registration-project', '등록 새가족 새가족교육 수료현황 자동화.gs');

const sent = [];
const context = {
  console,
  MailApp: { sendEmail: (message) => sent.push(message) }
};
vm.createContext(context);
vm.runInContext(maintenanceSource + '\n' + completionSource, context);

const call = (expression) => vm.runInContext(expression, context);

// --- 메일 수신자 안전장치 -------------------------------------------------
// 운영 모드에서는 요청한 수신자에게 그대로 보냅니다.
call(`sendRegistrationEmail_({
  recipients: REGISTRATION_AUTOMATION.productionAdminRecipients,
  subject: '정기 실행', body: 'b'
});`);
assert.equal(sent.length, 1);
assert.equal(sent[0].to.split(',').length, 5);
assert.doesNotMatch(sent[0].subject, /^\[TEST\]/);

// run*Test 계열은 운영 모드에서도 테스트 수신자 한 명으로 고정됩니다.
call(`sendRegistrationEmail_({
  recipients: REGISTRATION_AUTOMATION.productionAdminRecipients,
  subject: '승인된 테스트', body: 'b', forceTestRecipient: true
});`);
assert.equal(sent[1].to, 'ksj747172@gmail.com');
assert.match(sent[1].subject, /^\[TEST\] /);

// 군 리더 단일 수신자에게도 같은 안전장치가 적용됩니다.
call(`sendRegistrationEmail_({
  recipients: [REGISTRATION_AUTOMATION.groupRecipients['신']],
  subject: '신군 통계', body: 'b', forceTestRecipient: true
});`);
assert.equal(sent[2].to, 'ksj747172@gmail.com');

// 테스트 함수들이 실제로 안전장치를 켜는지 소스에서 확인합니다.
assert.match(maintenanceSource, /forceTestRecipient: true/);
assert.match(completionSource, /forceTestRecipient: true/);
assert.doesNotMatch(
  completionSource,
  /label: '승인된 테스트'[\s\S]{0,80}dryRun: false/
);

// --- 'M/d' 연도 추정 ------------------------------------------------------
// 연도를 하드코딩하면 해가 바뀔 때 모든 등록일이 어긋납니다.
call('globalThis.__year = (month, date) => resolveRegistrationYear_(month, date);');
const yearOn = (year, month, forMonth) =>
  context.__year(forMonth, new Date(year, month - 1, 15));

assert.equal(yearOn(2026, 9, 12), 2025, '회기 시작 전 12월은 전년도');
assert.equal(yearOn(2026, 9, 3), 2026, '3월은 당해 연도');
assert.equal(yearOn(2026, 12, 12), 2026, '12월 실행 중의 12월은 당해 연도');
assert.equal(yearOn(2027, 6, 12), 2026, '해가 바뀌어도 같은 규칙이 적용됨');
assert.equal(yearOn(2027, 6, 3), 2027);
assert.doesNotMatch(maintenanceSource, /month === 12 \? 2025 : 2026/);

// --- 숨김 로그 시트 -------------------------------------------------------
// 로그 시트는 만들어진 뒤에도 항상 숨김 상태여야 합니다.
function createFakeSheet(name, { hidden = false } = {}) {
  return {
    name,
    hidden,
    values: [],
    getSheetId: () => name,
    getName: () => name,
    isSheetHidden() { return this.hidden; },
    hideSheet() { this.hidden = true; },
    setFrozenRows() { return this; },
    getLastRow() { return this.values.length; },
    insertRowAfter() { return this; },
    getRange() {
      const sheet = this;
      return {
        setValues(values) { sheet.values.push(...values); return this; },
        setFontWeight() { return this; },
        setNumberFormat() { return this; }
      };
    }
  };
}

function createFakeSpreadsheet(sheets) {
  return {
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
}

call('globalThis.__hiddenLogSheet = getHiddenLogSheet_;');

const fresh = createFakeSpreadsheet([createFakeSheet('등록 새가족')]);
const created = context.__hiddenLogSheet(fresh, '자동화 로그', ['실행시각']);
assert.equal(created.isSheetHidden(), true, '새로 만든 로그 시트는 숨겨져야 합니다');
assert.notEqual(fresh.active.getName(), '자동화 로그', '활성 시트는 운영 시트로 남아야 합니다');

// 이미 있는데 보이는 상태라면 다시 숨깁니다.
const visibleLog = createFakeSheet('자동화 로그');
const existing = createFakeSpreadsheet([createFakeSheet('등록 새가족'), visibleLog]);
context.__hiddenLogSheet(existing, '자동화 로그', ['실행시각']);
assert.equal(visibleLog.isSheetHidden(), true, '보이는 기존 로그 시트도 숨겨야 합니다');

// 로그 기록이 다시 살아 있는지 확인합니다.
assert.doesNotMatch(maintenanceSource, /function writeRegistrationLog_[\s\S]{0,60}disabled: true/);
assert.doesNotMatch(completionSource, /function writeCompletionLog_[\s\S]{0,60}disabled: true/);
assert.match(maintenanceSource, /writeRegistrationLog_\('runRegistrationMaintenance', result\)/);
assert.match(completionSource, /if \(!options\.dryRun\) writeCompletionLog_\(result\)/);

// --- 등록 정보 자동 보정 상태 저장 ---------------------------------------
// 등록자 수만큼 PropertiesService를 호출하지 않아야 합니다.
assert.doesNotMatch(maintenanceSource, /properties\.getProperty\(stateKey\)/);
assert.match(maintenanceSource, /properties\.getProperties\(\)/);
assert.match(maintenanceSource, /properties\.setProperties\(pendingStates\)/);

console.log('registration automation checks passed');
