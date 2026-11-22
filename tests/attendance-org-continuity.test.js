const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../attendance-webapp/Code.gs'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '../attendance-webapp/Index.html'), 'utf8');
const identity = { name: '교육시험', phone: '010-0000-0001' };
const configuration = {
  id: 'org-2',
  groups: [
    { key: '새', label: '새군', recipient: 'private@example.test', teams: ['기쁨'] },
    { key: '빛', label: '빛군', recipient: 'private@example.test', teams: ['소망'] }
  ]
};

function makeSheet(rows, source = false) {
  const sheet = {
    getLastRow: () => rows.length + 1,
    getRange(row, column, rowCount, width) {
      return {
        getValues: () => rows.slice(row - 2, row - 2 + rowCount)
          .map(values => values.slice(column - 1, column - 1 + width)),
        setValues(values) {
          assert.equal(source, true, '교육 원본을 수정하면 안 됩니다.');
          rows.splice(row - 2, values.length, ...values);
        },
        setNumberFormat() {}
      };
    },
    insertRowBefore(row) {
      assert.equal(source, true, '교육 원본에 행을 삽입하면 안 됩니다.');
      rows.splice(row - 2, 0, []);
    }
  };
  return sheet;
}

function educationRow(weeks, identityOverride = identity) {
  return [1, 4, '옛', '이전팀', identityOverride.name, '여', identityOverride.phone, ...weeks];
}

function responseRow(week, date, group = '옛군', team = '이전팀(옛군)') {
  return [date, '동의', week + '주차', '', identity.name, identity.phone, '여자', '07년생 ~ 03년생', group, team];
}

function setup({ current, previous, responses = [], responseBook = false } = {}) {
  const activeSheet = makeSheet(responses, true);
  const sheetsById = {
    current: { '교육 출석 현황': current && makeSheet(current) },
    previous: { '교육 출석 현황': previous && makeSheet(previous) },
    responses: { '설문지 응답 시트1': activeSheet }
  };
  const propertyValues = {
    ORG_EDUCATION_SPREADSHEET_ID: current ? 'current' : null,
    ORG_PREVIOUS_EDUCATION_SPREADSHEET_ID: previous ? 'previous' : null,
    ORG_ATTENDANCE_RESPONSE_SPREADSHEET_ID: responseBook ? 'responses' : null
  };
  let liveConfig = configuration;
  let locked = false;
  const context = vm.createContext({
    Date,
    readOrgConfiguration_: () => liveConfig,
    PropertiesService: { getScriptProperties: () => ({ getProperty: key => propertyValues[key] }) },
    LockService: {
      getScriptLock: () => ({
        tryLock() { assert.equal(locked, false); locked = true; return true; },
        releaseLock() { assert.equal(locked, true); locked = false; }
      })
    },
    SpreadsheetApp: {
      getActiveSpreadsheet: () => responseBook ? null : ({ getSheetByName: name => sheetsById.responses[name] }),
      openById: id => ({ getSheetByName: name => sheetsById[id][name] }),
      flush: () => assert.equal(locked, true)
    }
  });
  vm.runInContext(source, context);
  return { api: context, setConfig: config => { liveConfig = config; } };
}

function submission(overrides = {}) {
  return {
    ...identity, week: 3, gender: '남자', age: '위조 나이', gun: '새군', team: '기쁨(새군)', orgConfigId: 'org-2',
    ...overrides
  };
}

// Validates: REQ-ORGSETTINGS-003
test('교육 시트에만 2주차까지 있는 사람의 3주차를 한 번만 추가한다', () => {
  const history = [educationRow(['2026-10-04', '2026-10-11', '', ''])];
  const responses = [];
  const { api } = setup({ current: history, responses });
  assert.equal(typeof api.searchUser, 'undefined');
  assert.equal(api.loadAttendanceForm(identity.name, identity.phone).record?.week, 2);
  assert.equal(api.submitAttendance(submission()).duplicate, false);
  assert.equal(api.submitAttendance(submission()).duplicate, true);
  assert.equal(responses.length, 1);
  assert.equal(responses[0].length, 10);
  assert.deepEqual(Array.from(responses[0].slice(2)), [
    '3주차', '', identity.name, identity.phone, '여자', '', '새군', '기쁨(새군)'
  ]);
  assert.equal(history[0][9], '');
});

test('이전 미수료 기록과 반영 대기 응답을 함께 사용하고 기존 줄을 보존한다', () => {
  const archive = [educationRow([new Date('2026-10-04T00:00:00+09:00'), '', '', ''])];
  const original = responseRow(2, new Date('2026-10-11T10:00:00+09:00'));
  const responses = [original.slice()];
  const { api } = setup({ previous: archive, responses });
  assert.equal(api.loadAttendanceForm(identity.name, identity.phone).record?.week, 2);
  assert.equal(api.submitAttendance(submission()).duplicate, false);
  assert.deepEqual(responses[1], original);
  assert.equal(responses[0][7], '07년생 ~ 03년생');
  assert.equal(archive[0][8], '');
});

test('이전 교육의 1주차가 비어 있어도 확인된 2주차 다음으로 이어진다', () => {
  const previous = [educationRow(['', '2026-10-11', '', ''])];
  const responses = [];
  const { api } = setup({ previous, responses });
  assert.equal(api.loadAttendanceForm(identity.name, identity.phone).record?.week, 2);
  assert.equal(api.submitAttendance(submission()).duplicate, false);
  assert.equal(responses[0][2], '3주차');
  assert.equal(previous[0][7], '');
});

test('활성 시트가 없는 웹앱에서는 지정한 출석 응답 파일에서 읽고 저장한다', () => {
  const responses = [responseRow(2, new Date('2026-10-11T10:00:00+09:00'))];
  const { api } = setup({ responses, responseBook: true });
  assert.equal(api.loadAttendanceForm(identity.name, identity.phone).record?.week, 2);
  assert.equal(api.submitAttendance(submission()).duplicate, false);
  assert.equal(responses[0][2], '3주차');
});

test('이름의 한글 조합 방식과 공백이 달라도 번호가 같으면 찾는다', () => {
  const history = [educationRow(['2026-10-04', '2026-10-11'], {
    name: '교육 시험'.normalize('NFD'), phone: '01000000001'
  })];
  const { api } = setup({ current: history });
  assert.equal(api.loadAttendanceForm(identity.name, identity.phone).record?.week, 2);
});

test('교육 시트의 중복 행이나 같은 번호에 다른 이름을 매칭하지 않는다', () => {
  const exact = educationRow(['2026-10-04', '2026-10-11', '', '']);
  const conflict = educationRow(['2026-10-04', '', '', ''], { ...identity, name: '다른이름' });
  [ [exact, exact.slice()], [conflict] ].forEach(current => {
    const responses = [];
    const { api } = setup({ current, responses });
    assert.throws(() => api.loadAttendanceForm(identity.name, identity.phone).record, /담당자/);
    assert.throws(() => api.submitAttendance(submission()), /담당자/);
    assert.deepEqual(responses, []);
  });
});

test('집중교육 완료는 수료로 표시하고 확인되지 않은 출석 표시를 이어받지 않는다', () => {
  const completed = [educationRow(['O', 'O', 'O', '4분기 집중교육'])];
  const individual = [educationRow(['2026-10-04', '', '', '개별 수료'])];
  const markOnly = [educationRow(['O', '', '', ''])];
  assert.equal(setup({ current: completed }).api.loadAttendanceForm(identity.name, identity.phone).record?.week, 4);
  assert.equal(setup({ current: individual }).api.loadAttendanceForm(identity.name, identity.phone).record?.week, 4);
  assert.equal(setup({ previous: markOnly }).api.loadAttendanceForm(identity.name, identity.phone).record, null);
});

// Validates: REQ-ORGSETTINGS-001, REQ-ORGSETTINGS-003
test('현재 군·팀 선택지만 공개하며 잘못 짝지은 팀은 제출되지 않는다', () => {
  const responses = [responseRow(2, new Date('2026-10-11T10:00:00+09:00'))];
  const { api } = setup({ responses });
  const form = JSON.parse(JSON.stringify(api.loadAttendanceForm(identity.name, identity.phone)));
  assert.deepEqual(form.organization.groups, [
    { label: '새군', teams: ['기쁨'] }, { label: '빛군', teams: ['소망'] }
  ]);
  assert.equal(form.organization.id, 'org-2');
  assert.throws(() => api.submitAttendance(submission({ team: '소망(빛군)' })), /소속 팀/);
  assert.throws(() => api.submitAttendance(submission({ gun: '옛군', team: '이전팀(옛군)' })), /소속 군/);
  assert.equal(responses.length, 1);
});

test('회기 적용 중 낡은 폼 제출은 보류하고 새 선택지와 확인되지 않은 소속을 허용한다', () => {
  const responses = [responseRow(2, new Date('2026-10-11T10:00:00+09:00'))];
  const { api, setConfig } = setup({ responses });
  setConfig({ ...configuration, id: 'org-3', groups: [{ key: '다', label: '다음군', teams: ['새팀'] }] });
  const stale = api.submitAttendance(submission());
  assert.equal(stale.configurationChanged, true);
  assert.equal(stale.organization.id, 'org-3');
  assert.equal(responses.length, 1);
  const unknown = submission({
    orgConfigId: 'org-3', gun: '군을 잘 모르겠어요', team: '팀을 잘모르겠어요(새가족부원에게 문의주세요)'
  });
  assert.equal(api.submitAttendance(unknown).duplicate, false);
  assert.equal(responses[0][8], unknown.gun);
  assert.equal(responses[0][9], unknown.team);
});

test('열어 둔 출석 화면에서 새 군·팀을 고르고 같은 주차로 다시 제출할 수 있다', () => {
  const elements = new Map();
  const makeElement = () => {
    const classes = new Set();
    return {
      value: '', textContent: '', children: [],
      classList: { add: value => classes.add(value), remove: value => classes.delete(value), contains: value => classes.has(value) },
      replaceChildren() { this.children = []; this.value = ''; },
      appendChild(child) { this.children.push(child); }
    };
  };
  const element = id => {
    if (!elements.has(id)) elements.set(id, makeElement());
    return elements.get(id);
  };
  const responses = [responseRow(2, new Date('2026-10-11T10:00:00+09:00'), '신군', '가예(신군)')];
  const { api, setConfig } = setup({ responses });
  setConfig({ ...configuration, groups: [{ key: '신', label: '신군', teams: ['가예'] }] });
  const client = vm.createContext({ document: { getElementById: element, createElement: makeElement }, alert: assert.fail });
  function callServer(name, args, success, failure) {
    let result;
    try { result = api[name](...args); } catch (error) { failure(error); return; }
    success(result);
  }
  let success;
  let failure;
  const run = {
    withSuccessHandler(handler) { success = handler; return this; },
    withFailureHandler(handler) { failure = handler; return this; },
    loadAttendanceForm(...args) { callServer('loadAttendanceForm', args, success, failure); },
    submitAttendance(...args) { callServer('submitAttendance', args, success, failure); }
  };
  client.google = { script: { run } };
  vm.runInContext(html.match(/<script>([\s\S]+)<\/script>/)[1], client);

  element('searchName').value = identity.name;
  element('searchPhone').value = identity.phone;
  element('privacyConsent').checked = true;
  client.searchUser();
  setConfig({ ...configuration, id: 'org-3', groups: [{ key: '다', label: '다음군', teams: ['새팀'] }] });
  client.submitForm();
  assert.equal(responses.length, 1);
  assert.equal(element('formSection').classList.contains('hidden'), false);
  assert.equal(element('gun').value, '');
  assert.deepEqual(element('gun').children.map(option => option.value), ['', '다음군', '군을 잘 모르겠어요']);
  assert.match(element('affiliationNotice').textContent, /다시 선택/);

  element('gun').value = '다음군';
  client.updateTeamOptions();
  element('team').value = '새팀(다음군)';
  client.submitForm();
  assert.deepEqual(Array.from(responses[0].slice(8)), ['다음군', '새팀(다음군)']);
  assert.equal(responses[0][2], '3주차');
});
