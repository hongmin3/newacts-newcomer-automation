// Validates: REQ-REG-001
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
function registration(no, name, phone, group = '신', team = '교육팀', date = '2026-10-04') {
  const row = Array(15).fill('');
  Object.assign(row, { 0: no, 1: date, 3: group, 4: team, 5: name, 9: phone });
  return row;
}
function attendance(name, phone, group = '조', team = '교육팀') {
  return ['2026-10-28T10:00:00+09:00', '', '', '', name, phone, '', '', group, team];
}
function fixture(rows, responses, initial = {}) {
  const properties = { ...initial };
  const writes = { cells: 0, properties: 0 };
  const sheet = data => ({
    data, getLastRow: () => data.length, getLastColumn: () => 15,
    getRange(r, c, n = 1, w = 1) {
      return {
        getValues: () => Array.from({ length: n }, (_, i) => Array.from({ length: w }, (_, j) => data[r - 1 + i]?.[c - 1 + j] ?? '')),
        setValue: value => { writes.cells++; data[r - 1][c - 1] = value; }
      };
    }
  });
  const registrations = sheet([[], ...rows]);
  const source = sheet([[], ...responses]);
  const context = { console, Utilities: { formatDate: date => new Date(date).toISOString().slice(0, 10) },
    SpreadsheetApp: { openById: () => ({ getSheetByName: () => source }), flush() {} },
    PropertiesService: { getScriptProperties: () => ({ getProperties: () => ({ ...properties }), setProperties: values => { writes.properties++; Object.assign(properties, values); } }) }
  };
  vm.createContext(context);
  for (const file of ['등록새가족-군현황 자동 배치.gs', '등록 새가족 새가족교육 수료현황 자동화.gs']) {
    vm.runInContext(fs.readFileSync(path.join(root, 'registration-project', file), 'utf8'), context);
  }
  context.getRegistrationSpreadsheet_ = () => ({ getSheetByName: () => registrations });
  return { registrations, properties, writes, context, run: (dryRun = false) => context.reconcileRegistrationWithLatestAttendance_({ dryRun }),
    prefix: vm.runInContext('REGISTRATION_AUTOMATION.correctionStatePrefix', context) };
}
const tests = [];
function test(name, run) { tests.push([name, run]); }

test('실제 상태 생성 뒤 순번 재사용이 타인 팀·전화번호를 바꾸지 않는다', () => {
  const f = fixture([registration(1, '이전사람', '010-0000-0001')], [attendance('이전사람', '010-0000-0001')]);
  assert.equal(f.run().changes.length, 1);
  const replacement = registration(1, '새사람', '010-0000-0002', '신', '새사람팀');
  f.registrations.data[1] = replacement;
  f.run();
  assert.equal(replacement[4], '새사람팀');
  assert.equal(replacement[9], '010-0000-0002');
});
test('정렬·재번호 후에도 수동 보호 상태가 같은 사람에게 유지된다', () => {
  const a = registration(1, '이전사람', '010-0000-0001');
  const b = registration(2, '다른사람', '010-0000-0002');
  const f = fixture([a, b], [attendance('이전사람', '010-0000-0001'), attendance('다른사람', '010-0000-0002')]);
  f.run(); a[3] = '명'; f.run();
  a[0] = 2; b[0] = 1; f.registrations.data.splice(1, 2, b, a);
  const result = f.run();
  assert.equal(a[3], '명');
  assert(result.protected.some(item => item.name === '이전사람' && item.reason.includes('보호됨')));
  assert.equal(result.review.length, 0);
});
test('중복 이름·등록일은 서로 다른 전화번호라도 보정하지 않는다', () => {
  const a = registration(1, '같은이름', '010-0000-0001');
  const b = registration(2, '같은이름', '010-0000-0002');
  const f = fixture([a, b], [attendance('같은이름', '010-0000-0001'), attendance('같은이름', '010-0000-0002')]);
  const result = f.run();
  assert.equal(result.changes.length, 0); assert.equal(result.review.length, 2);
  assert.equal(Object.keys(f.properties).length, 0);
});
test('legacy 보호 상태는 번호가 달라도 이름·전화가 맞는 유일 소유자에게 이전한다', () => {
  const row = registration(8, '이전사람', '010-0000-0001', '명');
  const f = fixture([row], [attendance('이전사람', '010-0000-0001')]);
  const key = f.prefix + '1';
  const legacy = JSON.stringify({ sourceNameKey: '이전사람', sourcePhoneKey: '01000000001', fields: { group: { lastAutoValue: '조', protected: true, manualValue: '명' } } });
  f.properties[key] = legacy;
  const result = f.run(); assert.equal(row[3], '명'); assert.equal(result.protected.length, 1);
  assert.equal(f.properties[key], legacy);
  const states = Object.values(f.properties).map(JSON.parse);
  assert(states.some(state => state.version === 2 && state.owner && state.fields.group.protected));
});
test('legacy 소유가 불명확하면 신규 자동보정을 중단한다', () => {
  const row = registration(1, '이전사람', '010-0000-0002');
  const f = fixture([row], [attendance('이전사람', '010-0000-0003')]);
  f.properties[f.prefix + '1'] = JSON.stringify({ sourceNameKey: '이전사람', sourcePhoneKey: '01000000001', fields: { group: { lastAutoValue: '조', protected: true } } });
  const before = JSON.stringify(f.properties);const result = f.run();
  assert.equal(result.changes.length, 0); assert.equal(result.review.length, 1);assert.equal(JSON.stringify(f.properties), before);
});
test('같은 이름·전화 legacy 상태가 여러 개면 이전하지 않는다', () => {
  const row = registration(3, '이전사람', '010-0000-0001');
  const f = fixture([row], [attendance('이전사람', '010-0000-0001')]);
  const state = JSON.stringify({ sourceNameKey: '이전사람', sourcePhoneKey: '01000000001', fields: {} });
  f.properties[f.prefix + '1'] = state;f.properties[f.prefix + '2'] = state;
  assert.equal(f.run().changes.length, 0);assert.equal(Object.keys(f.properties).length, 2);
});
test('미리보기는 legacy 이전도 시트 기록도 하지 않는다', () => {
  const row = registration(8, '이전사람', '010-0000-0001');
  const f = fixture([row], [attendance('이전사람', '010-0000-0001')]);
  f.properties[f.prefix + '1'] = JSON.stringify({ sourceNameKey: '이전사람', sourcePhoneKey: '01000000001', fields: {} });
  const before = JSON.stringify(f.properties);f.run(true);
  assert.equal(row[3], '신');assert.equal(JSON.stringify(f.properties), before);
  assert.deepEqual(f.writes, { cells: 0, properties: 0 });
});
test('이름을 고쳐 기존 소유자와 달라지면 같은 전화번호의 보호 상태를 초기화하지 않는다', () => {
  const row = registration(1, '이전사람', '010-0000-0001');
  const f = fixture([row], [attendance('이전사람', '010-0000-0001')]);
  f.run();row[3] = '명';f.run();row[5] = '수정한이름';
  const originalOpen = f.context.SpreadsheetApp.openById;
  f.context.SpreadsheetApp.openById = () => ({ getSheetByName: () => ({ getLastRow: () => 2, getLastColumn: () => 10,
    getRange: () => ({ getValues: () => [attendance('수정한이름', '010-0000-0001')] }) }) });
  const before = JSON.stringify(f.properties);const result = f.run();
  assert.equal(row[3], '명');assert.equal(result.changes.length, 0);assert.equal(result.review.length, 1);
  assert.equal(JSON.stringify(f.properties), before);f.context.SpreadsheetApp.openById = originalOpen;
});
test('날짜 표현이 바뀌어도 같은 실제 날짜의 상태를 사용한다', () => {
  const row = registration(1, '이전사람', '010-0000-0001');
  const f = fixture([row], [attendance('이전사람', '010-0000-0001')]);
  f.run();row[3] = '명';f.run();
  row[1] = new Date('2026-10-04T12:00:00+09:00');
  const result = f.run();assert.equal(row[3], '명');assert.equal(result.review.length, 0);
  assert.equal(Object.keys(f.properties).length, 1);
});
test('연도가 없는 날짜와 필수 식별값 누락을 안전하게 구분한다', () => {
  const row = registration(1, '이전사람', '010-0000-0001', '신', '교육팀', '10/4');
  const f = fixture([row], [attendance('이전사람', '010-0000-0001')]);
  f.run();row[3] = '명';f.run();row[1] = '10/04';
  assert.equal(f.run().review.length, 0);assert.equal(row[3], '명');
  row[1] = '';const before = JSON.stringify(f.properties);
  assert.equal(f.run().review.length, 1);assert.equal(JSON.stringify(f.properties), before);
});
test('손상된 상태 또는 다른 소유자 표시는 기존 값을 유지하고 검토한다', () => {
  for (const corrupt of [() => '{broken', value => JSON.stringify({ ...JSON.parse(value), owner: { nameKey: '다른사람', dateKey: '2026-10-04' } })]) {
    const row = registration(1, '이전사람', '010-0000-0001');
    const f = fixture([row], [attendance('이전사람', '010-0000-0001')]);
    f.run();const key = Object.keys(f.properties)[0];f.properties[key] = corrupt(f.properties[key]);row[3] = '명';
    const before = JSON.stringify(f.properties);const result = f.run();
    assert.equal(row[3], '명');assert.equal(result.review.length, 1);assert.equal(JSON.stringify(f.properties), before);
  }
});
let failed = 0;
for (const [name, run] of tests) {
  try { run(); console.log('통과: ' + name); } catch (error) { failed++; console.error('실패: ' + name + '\n' + error.message); }
}
if (failed) process.exitCode = 1;
