// Validates REQ-ORGSETTINGS-001 and the coordination in REQ-ORGSETTINGS-002.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const adminPath = path.join(root, 'attendance-webapp', 'OrgAdmin.gs');
assert.ok(fs.existsSync(adminPath), '군·팀 설정 관리자 기능이 필요합니다.');
const common = fs.readFileSync(path.join(root, 'attendance-webapp', 'OrgConfig.gs'), 'utf8');
for (const project of ['education-project', 'registration-project', 'intensive-training-application']) {
  assert.equal(fs.readFileSync(path.join(root, project, 'OrgConfig.gs'), 'utf8'), common);
}
const v1 = {id: 'v1', term: 2026, groups: [{key: '신', label: '신군', recipient: 'test@example.org', teams: ['가예']}]};
const v2 = {id: 'v2', term: 2027, groups: [{key: '조', label: '조군', recipient: 'test@example.org', teams: ['가예']}]};
const rows = [
  ['v1', '2026-12-31T00:00:00.000Z', 2026, JSON.stringify(v1)],
  ['v2', '2027-03-01T00:00:00.000Z', 2027, JSON.stringify(v2)]
];
let reads = 0;
let configSource = '';
const fakeSheet = {getLastRow: () => 3, getRange: () => ({getValues: () => { reads++; return rows; }})};
const context = vm.createContext({
  SpreadsheetApp: {openById: () => ({getSheetByName: () => fakeSheet})},
  PropertiesService: {getScriptProperties: () => ({getProperty: () => configSource})}
});
vm.runInContext(common + '\n' + fs.readFileSync(adminPath, 'utf8'), context);
const call = (code) => vm.runInContext(code, context);
assert.equal(call('readOrgConfiguration_()'), null);
configSource = 'settings-book';
assert.equal(call("readOrgConfiguration_(new Date('2027-02-28T23:59:59Z')).id"), 'v1');
assert.equal(call("readOrgConfiguration_(new Date('2027-03-01T00:00:00Z')).id"), 'v2');
assert.equal(call("readOrgConfiguration_(new Date('2025-01-01T00:00:00Z'))"), null);
assert.equal(reads, 1, '응답 묶음에서 같은 이력 시트를 여러 번 읽지 않습니다.');
assert.equal(call("findOrgGroup_(readOrgConfiguration_(new Date('2027-03-01T00:00:00Z')), '조').label"), '조군');

const validDraft = [
  ['신', '신군', 2, 'sin@example.org', true, '', '신군', '가예', 2, true],
  ['조', '조군', 1, 'cho@example.org', true, '', '조군', '보배', 1, true],
  ['옛', '옛군', 3, '', false, '', '신군', '하임', 1, true]
];
context.draft = validDraft;
assert.equal(call("JSON.stringify(parseOrgDraft_(2027, draft).groups.map(g => [g.key, g.teams]))"),
  '[["조",["보배"]],["신",["하임","가예"]]]');
assert.deepEqual(
  JSON.parse(call("JSON.stringify(orgDraftChanges_(null, parseOrgDraft_(2027,draft)).map(x => x.label))")),
  ['군 추가', '팀 추가', '군 추가', '팀 추가', '팀 추가']
);
context.bad = [...validDraft, ['', '', '', '', '', '', '없는 군', '유령', 3, true]];
assert.throws(() => call('parseOrgDraft_(2027, bad)'), /없는 군/);
context.bad = [...validDraft, ['', '', '', '', '', '', '신군', '가예', 3, true]];
assert.throws(() => call('parseOrgDraft_(2027, bad)'), /중복/);
context.bad = validDraft.map(row => row.map((v, i) => i === 3 ? '' : v));
assert.throws(() => call('parseOrgDraft_(2027, bad)'), /담당자 메일/);

const log = [];
const job = {phase: 'pause', wasAccepting: true, configuration: v2};
let imageFails = true;
context.operations = {
  record: state => log.push('save:' + state.phase),
  setAccepting: enabled => log.push('accept:' + enabled),
  updateForm: config => log.push('form:' + config.id),
  updateGuide: config => {log.push('png:' + config.id); if (imageFails) throw new Error('PNG write failed');},
  activate: config => log.push('apply:' + config.id)
};
context.job = job;
assert.throws(() => call('runOrgPublication_(job, operations)'), /PNG write failed/);
assert.equal(job.phase, 'guide');
assert.deepEqual(log, ['accept:false', 'save:form', 'form:v2', 'save:guide', 'png:v2']);
imageFails = false;
call('runOrgPublication_(job, operations)');
assert.equal(job.phase, 'done');
assert.deepEqual(log.slice(5), ['png:v2', 'save:activate', 'apply:v2', 'save:reopen', 'accept:true', 'save:done']);

context.renamed = {term: 2027, groups: [
  {id: '조', key: '봄', label: '봄군', recipient: 'test@example.org', teams: ['가예']}
]};
context.prior = v2;
const renamed = JSON.parse(call('JSON.stringify(reconcileOrgGroupIds_(renamed, [prior]))'));
assert.deepEqual(renamed.groups[0].aliases, ['조', '조군']);
context.renamedConfig = renamed;
assert.equal(call("findOrgGroup_(renamedConfig, '조').key"), '봄');
assert.equal(call("findOrgGroup_(renamedConfig, '조군').key"), '봄');
assert.deepEqual(JSON.parse(call('JSON.stringify(orgDraftChanges_(prior, renamedConfig).map(x => x.label))')),
  ['군 이름 변경', '군 약칭 변경']);

const properties = new Map();
const tabs = new Map();
let interruptProtection = true;
function tab(name, initialRows = []) {
  const rows = initialRows.map(values => values.slice());
  const protections = [];
  let hidden = false;
  const sheet = {
    getLastRow: () => rows.length,
    isSheetHidden: () => hidden,
    hideSheet() { hidden = true; },
    hideColumns() {},
    activate() {},
    getProtections: () => protections,
    getRange(row, column, height = 1, width = 1) {
      if (typeof row === 'string') {
        assert.match(row, /^[AB]\d$/);
        column = row[0] === 'A' ? 1 : 2;
        row = Number(row[1]);
      }
      const range = {
        getValues: () => Array.from({length: height}, (_, y) =>
          Array.from({length: width}, (_, x) => rows[row - 1 + y]?.[column - 1 + x] ?? '')),
        getValue: () => range.getValues()[0][0],
        setValues(values) {
          values.forEach((line, y) => {
            while (rows.length < row + y) rows.push([]);
            line.forEach((value, x) => { rows[row - 1 + y][column - 1 + x] = value; });
          });
          return range;
        },
        setValue: value => range.setValues([[value]])
      };
      return range;
    },
    protect() {
      if (name === '_군팀_적용이력' && interruptProtection) {
        interruptProtection = false;
        throw new Error('test interruption');
      }
      const editors = new Set(['outsider@example.test']);
      const protection = {
        description: '', warning: true, holes: ['A1'], domain: true,
        getDescription: () => protection.description,
        setDescription(value) { protection.description = value; return protection; },
        setWarningOnly(value) { protection.warning = value; },
        setUnprotectedRanges(values) { protection.holes = values; },
        addEditors(values) { values.forEach(value => editors.add(value)); },
        getEditors: () => Array.from(editors, email => ({getEmail: () => email})),
        removeEditors(values) { values.forEach(user => editors.delete(user.getEmail())); },
        canDomainEdit: () => protection.domain,
        setDomainEdit(value) { protection.domain = value; }
      };
      protections.push(protection);
      return protection;
    }
  };
  tabs.set(name, sheet);
  return sheet;
}

tab('설문지 응답 시트1');
const draftTab = tab('군·팀 설정', [['군·팀 설정'], ['', 2026], ['', '중단'], [], [], [], ['군 약칭']]);
const settingBook = {
  getId: () => 'response-book',
  getSheetByName: name => tabs.get(name),
  insertSheet: name => tab(name),
  getOwner: () => ({getEmail: () => 'owner@example.test'})
};
context.ATTENDANCE_APP = {sheetName: '설문지 응답 시트1'};
context.LockService = {getScriptLock: () => ({tryLock: () => true, releaseLock: () => {}})};
context.PropertiesService = {getScriptProperties: () => ({
  getProperty: key => properties.get(key),
  setProperty: (key, value) => properties.set(key, value)
})};
context.SpreadsheetApp = {
  getActiveSpreadsheet: () => settingBook,
  openById: () => settingBook,
  ProtectionType: {SHEET: 'SHEET'},
  flush() {},
  getUi: () => ({alert() {}})
};
context.Utilities = {formatDate: date => date.toISOString()};
let actor = '';
context.Session = {getActiveUser: () => ({getEmail: () => actor})};
assert.throws(() => call('setupOrgSettings()'), /권한/);
assert.equal(properties.size, 0);
actor = 'owner@example.test';
assert.throws(() => call('setupOrgSettings()'), /test interruption/);
assert.ok(tabs.has('_군팀_적용이력'));
assert.equal(properties.size, 0, '연결은 보호 설정이 끝난 뒤 저장합니다.');
call('setupOrgSettings()');
assert.equal(properties.get('ORG_ATTENDANCE_RESPONSE_SPREADSHEET_ID'), settingBook.getId());
assert.equal(properties.get('ORG_SETTINGS_SPREADSHEET_ID'), settingBook.getId());
for (const name of ['군·팀 설정', '_군팀_적용이력', '_군팀_적용작업']) {
  const sheet = tabs.get(name);
  const [protection] = sheet.getProtections();
  assert.equal(protection.warning, false);
  assert.deepEqual(Array.from(protection.holes), []);
  assert.equal(protection.domain, false);
  assert.deepEqual(protection.getEditors().map(user => user.getEmail()), [actor]);
  assert.equal(sheet.isSheetHidden(), name !== '군·팀 설정');
}
properties.set('ORG_ADMIN_EMAILS', 'next@example.test');
call('setupOrgSettings()');
assert.deepEqual(draftTab.getProtections()[0].getEditors().map(user => user.getEmail()), [actor, 'next@example.test']);
properties.delete('ORG_ADMIN_EMAILS');
call('setupOrgSettings()');
assert.deepEqual(draftTab.getProtections()[0].getEditors().map(user => user.getEmail()), [actor]);

const history = tabs.get('_군팀_적용이력');
history.getRange(2, 1, 1, 4).setValues([['v1', '2025-11-20T00:00:00.000Z', 2026, JSON.stringify(v1)]]);
tabs.get('_군팀_적용작업').getRange('A1').setValue(JSON.stringify({phase: 'done', configuration: v1}));
call('resumeOrgSettings()');
assert.equal(draftTab.getRange('B3').getValue(), '적용 완료');
assert.match(draftTab.getRange('B4').getValue(), /^2026 회기/);

console.log('군·팀 이력 조회, 초안 확인, 도중 실패와 이어서 적용 검사 통과');
