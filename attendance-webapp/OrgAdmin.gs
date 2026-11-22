const ORG_ADMIN_TAB = '군·팀 설정';
const ORG_JOB_TAB = '_군팀_적용작업';
const ORG_DRAFT_START = 8;
const ORG_GROUP_ID_COLUMN = 11;
const ORG_EDUCATION_TAB = '교육 출석 현황';
const ORG_ADMIN_PHASES = {
  pause: '신청 접수 상태 확인', form: '집중교육 폼 갱신', guide: '안내도 갱신',
  activate: '군·팀 적용', reopen: '집중교육 폼 접수 복구', done: '적용 완료'
};

function onOpen() {
  SpreadsheetApp.getUi().createMenu('군·팀 관리')
    .addItem('설정 탭 준비', 'setupOrgSettings')
    .addItem('다음 회기로 복사', 'copyOrgSettingsToNextTerm')
    .addItem('미리보기 및 적용', 'previewOrgSettings')
    .addItem('중단한 적용 이어가기', 'resumeOrgSettings')
    .addItem('이전 적용을 초안으로 복원', 'restorePreviousOrgSettingsDraft')
    .addToUi();
}

function orgAdminContext_() {
  const props = PropertiesService.getScriptProperties();
  const configuredId = props.getProperty(ORG_SETTINGS_PROPERTY);
  const active = SpreadsheetApp.getActiveSpreadsheet();
  const book = configuredId ? SpreadsheetApp.openById(configuredId) : active;
  if (!book) throw new Error('관리용 스프레드시트에서 군·팀 설정을 열어 주세요.');

  const email = String(Session.getActiveUser().getEmail() || '').trim().toLowerCase();
  const configuredAdmins = String(props.getProperty('ORG_ADMIN_EMAILS') || '')
    .split(/[\s,]+/).map(function (value) { return value.toLowerCase(); }).filter(Boolean);
  const owner = book.getOwner();
  const ownerEmail = owner ? owner.getEmail().toLowerCase() : '';
  if (!email || (email !== ownerEmail && !configuredAdmins.includes(email))) {
    throw new Error('군·팀 설정을 관리할 권한이 없습니다.');
  }
  return {book: book, props: props, admins: [ownerEmail].concat(configuredAdmins).filter(Boolean)};
}

function setupOrgSettings() {
  return withOrgPublishLock_(function () {
    const context = orgAdminContext_();
    const responseProperty = 'ORG_ATTENDANCE_RESPONSE_SPREADSHEET_ID';
    const needsResponseId = !context.props.getProperty(responseProperty);
    if (needsResponseId && !context.book.getSheetByName(ATTENDANCE_APP.sheetName)) {
      throw new Error('출석 응답 파일을 설정한 뒤 설정 탭을 준비해 주세요.');
    }
    const history = ensureOrgSheet_(context, ORG_VERSIONS_SHEET);
    const historyHeader = ['버전', '적용 시각 UTC', '회기', '설정'];
    const historyRange = history.getRange(1, 1, 1, historyHeader.length);
    if (!history.getLastRow()) historyRange.setValues([historyHeader]);
    else if (JSON.stringify(historyRange.getValues()[0]) !== JSON.stringify(historyHeader)) {
      throw new Error('군·팀 적용 이력의 첫 행을 확인해 주세요.');
    }
    const journal = ensureOrgSheet_(context, ORG_JOB_TAB);
    [history, journal].forEach(function (sheet) {
      if (!sheet.isSheetHidden()) sheet.hideSheet();
    });
    const draft = ensureOrgSheet_(context, ORG_ADMIN_TAB);
    prepareOrgDraftTab_(draft);
    SpreadsheetApp.flush();
    if (needsResponseId) context.props.setProperty(responseProperty, context.book.getId());
    if (!context.props.getProperty(ORG_SETTINGS_PROPERTY)) {
      context.props.setProperty(ORG_SETTINGS_PROPERTY, context.book.getId());
    }
    draft.activate();
    return '군·팀 설정 탭을 확인해 주세요.';
  });
}

function ensureOrgSheet_(context, name) {
  const sheet = context.book.getSheetByName(name) || context.book.insertSheet(name);
  protectOrgSheet_(sheet, context.admins);
  return sheet;
}

function prepareOrgDraftTab_(sheet) {
  const title = sheet.getRange('A1').getValue();
  if (title && title !== ORG_ADMIN_TAB) throw new Error('군·팀 설정 탭의 제목을 확인해 주세요.');
  const header = sheet.getRange(7, 1, 1, 10);
  if (!header.getValues()[0][0]) {
    sheet.getRange('A1').setValue(ORG_ADMIN_TAB);
    sheet.getRange('A2:A5').setValues([['편집 회기'], ['적용 상태'], ['현재 적용'], ['편집 방법']]);
    sheet.getRange('B5').setValue('군·팀을 편집한 뒤 군·팀 관리 → 미리보기 및 적용을 선택합니다.');
    header.setValues([[
      '군 약칭', '군 이름', '순서', '보고 담당자 메일', '사용', '', '소속 군', '팀 이름', '순서', '사용'
    ]]).setFontWeight('bold').setBackground('#dbeafe');
    sheet.setFrozenRows(7);
    sheet.setColumnWidth(4, 245);
  }
  if (sheet.getRange(7, ORG_GROUP_ID_COLUMN).getValue() !== '군 식별 코드') {
    sheet.getRange(7, ORG_GROUP_ID_COLUMN).setValue('군 식별 코드');
  }
  sheet.hideColumns(ORG_GROUP_ID_COLUMN);
  if (!sheet.getRange('B2').getValue()) {
    const now = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-M').split('-').map(Number);
    const term = now[1] < 3 ? now[0] - 1 : now[0];
    if (sheet.getLastRow() < ORG_DRAFT_START) {
      const groups = Object.keys(ATTENDANCE_APP.legacyTeams).map(function (label) {
        return {key: label.slice(0, -1), label: label, recipient: '', teams: ATTENDANCE_APP.legacyTeams[label]};
      });
      writeOrgDraft_(sheet, {term: term, groups: groups});
    } else {
      sheet.getRange('B2').setValue(term);
    }
    sheet.getRange('B3').setValue('초안');
  }
}

function protectOrgSheet_(sheet, admins) {
  const description = '군·팀 운영자';
  const matching = sheet.getProtections(SpreadsheetApp.ProtectionType.SHEET).filter(function (protection) {
    return protection.getDescription() === description;
  });
  const protections = matching.length ? matching : [sheet.protect().setDescription(description)];
  protections.forEach(function (protection) {
    protection.setWarningOnly(false);
    protection.setUnprotectedRanges([]);
    protection.addEditors(admins);
    const outside = protection.getEditors().filter(function (user) {
      return !admins.includes(user.getEmail().toLowerCase());
    });
    if (outside.length) protection.removeEditors(outside);
    if (protection.canDomainEdit()) protection.setDomainEdit(false);
  });
}

function requireOrgAdminTab_(context) {
  const sheet = context.book.getSheetByName(ORG_ADMIN_TAB);
  if (!sheet) throw new Error('군·팀 관리 메뉴에서 설정 탭을 먼저 준비해 주세요.');
  return sheet;
}

function requireOrgAdminJobTab_(context) {
  const sheet = context.book.getSheetByName(ORG_JOB_TAB);
  if (!sheet) throw new Error('군·팀 적용작업 탭을 확인해 주세요.');
  return sheet;
}

function writeOrgDraft_(sheet, config) {
  const groupRows = config.groups.map(function (group, index) {
    return [group.key, group.label, index + 1, group.recipient, true, ''];
  });
  const teamRows = config.groups.flatMap(function (group) {
    return group.teams.map(function (team, index) { return [group.label, team, index + 1, true]; });
  });
  const rowCount = Math.max(groupRows.length, teamRows.length, 1);
  const minRows = ORG_DRAFT_START - 1 + rowCount + 12;
  if (sheet.getMaxRows() < minRows) {
    sheet.insertRowsAfter(sheet.getMaxRows(), minRows - sheet.getMaxRows());
  }
  const usable = sheet.getMaxRows() - ORG_DRAFT_START + 1;
  sheet.getRange(ORG_DRAFT_START, 1, usable, ORG_GROUP_ID_COLUMN).clearContent();
  const checkbox = SpreadsheetApp.newDataValidation().requireCheckbox().setAllowInvalid(false).build();
  sheet.getRange(ORG_DRAFT_START, 5, usable, 1).setDataValidation(checkbox);
  sheet.getRange(ORG_DRAFT_START, 10, usable, 1).setDataValidation(checkbox);
  const groupLabels = sheet.getRange(ORG_DRAFT_START, 2, usable, 1);
  const dropdown = SpreadsheetApp.newDataValidation().requireValueInRange(groupLabels, true)
    .setAllowInvalid(false).build();
  sheet.getRange(ORG_DRAFT_START, 7, usable, 1).setDataValidation(dropdown);
  const values = Array.from({length: rowCount}, function (_, i) {
    const group = config.groups[i];
    return (groupRows[i] || ['', '', '', '', '', '']).concat(
      teamRows[i] || ['', '', '', ''], group ? group.id || group.key : '');
  });
  sheet.getRange(ORG_DRAFT_START, 1, rowCount, ORG_GROUP_ID_COLUMN).setValues(values);
  sheet.getRange('B2').setValue(config.term);
}

function copyOrgSettingsToNextTerm() {
  return withOrgPublishLock_(function () {
    const context = orgAdminContext_();
    ensureOrgDraftMayChange_(context);
    const active = readOrgConfiguration_();
    if (!active) throw new Error('첫 회기 설정을 적용한 뒤 복사할 수 있습니다.');
    const sheet = requireOrgAdminTab_(context);
    if (Number(sheet.getRange('B2').getValue()) !== active.term) {
      throw new Error('다른 회기의 초안이 있습니다. 현재 초안을 먼저 확인해 주세요.');
    }
    const draft = readOrgDraft_(context);
    if (JSON.stringify(draft.groups) !== JSON.stringify(active.groups)) {
      throw new Error('편집한 초안이 있습니다. 현재 회기에 적용한 뒤 다음 회기로 복사해 주세요.');
    }
    writeOrgDraft_(sheet, Object.assign({}, active, {term: active.term + 1}));
    sheet.getRange('B3').setValue('다음 회기 초안');
  });
}

function restorePreviousOrgSettingsDraft() {
  return withOrgPublishLock_(function () {
    const context = orgAdminContext_();
    ensureOrgDraftMayChange_(context);
    const versions = readOrgVersions_();
    if (versions.length < 2) throw new Error('복원할 이전 배치가 없습니다.');
    const sheet = requireOrgAdminTab_(context);
    writeOrgDraft_(sheet, versions[versions.length - 2]);
    sheet.getRange('B3').setValue('이전 배치 복원 초안');
  });
}

function ensureOrgDraftMayChange_(context) {
  const job = readOrgPublicationJob_(context);
  if (job && job.phase !== 'done') throw new Error('중단한 적용을 먼저 이어가 주세요.');
}

function orgText_(value) {
  return String(value === undefined || value === null ? '' : value).trim();
}

function orgDraftName_(value, rowNumber, field) {
  const text = orgText_(value);
  if (!text || text.length > 40 || /^[=+@-]/.test(text) || /[()\x00-\x1f]/.test(text)) {
    throw new Error(rowNumber + '행 ' + field + '을(를) 확인해 주세요.');
  }
  return text;
}

function orgDraftOrder_(value, rowNumber) {
  if (value === '' || value === undefined) return rowNumber;
  const order = Number(value);
  if (!Number.isInteger(order) || order < 1) throw new Error(rowNumber + '행 순서를 확인해 주세요.');
  return order;
}

function parseOrgDraft_(termValue, rows) {
  const term = Number(termValue);
  if (!Number.isInteger(term) || term < 2000 || term > 9999) throw new Error('편집 회기를 숫자 연도로 입력해 주세요.');
  const groups = [];
  const groupNames = new Map();
  rows.forEach(function (row, index) {
    const rowNumber = ORG_DRAFT_START + index;
    if (!row.slice(0, 4).some(orgText_) && row[4] !== true) return;
    const key = orgDraftName_(row[0], rowNumber, '군 약칭');
    const label = orgDraftName_(row[1], rowNumber, '군 이름');
    if (groupNames.has(key) || groupNames.has(label)) throw new Error(rowNumber + '행 군 이름 또는 약칭이 중복됩니다.');
    if ([key, label].some(function (name) { return /^(스스로|미배정|합계|군배정필요)$|모르겠/.test(name); })) {
      throw new Error(rowNumber + '행 군 이름은 출석 및 집계 화면에서 이미 쓰고 있습니다.');
    }
    const enabled = row[4] === true;
    const recipient = orgText_(row[3]);
    if (enabled && !/^[^\s,@;]+@[^\s,@;]+\.[^\s,@;]+$/.test(recipient)) {
      throw new Error(rowNumber + '행 군별 담당자 메일을 확인해 주세요.');
    }
    const group = {
      key: key, label: label, recipient: recipient, id: orgText_(row[ORG_GROUP_ID_COLUMN - 1]),
      enabled: enabled, order: orgDraftOrder_(row[2], rowNumber), teams: []
    };
    groupNames.set(key, group);
    groupNames.set(label, group);
    groups.push(group);
  });
  rows.forEach(function (row, index) {
    const rowNumber = ORG_DRAFT_START + index;
    if (!row.slice(6, 9).some(orgText_) && row[9] !== true) return;
    const label = orgText_(row[6]);
    const team = orgDraftName_(row[7], rowNumber, '팀 이름');
    const group = groupNames.get(label);
    if (!group) throw new Error(rowNumber + '행 팀에 설정표에 없는 군이 있습니다.');
    if (group.teams.some(function (item) { return item.name === team; })) {
      throw new Error(rowNumber + '행에 같은 군의 팀 이름이 중복됩니다.');
    }
    if (/모르겠/.test(team)) throw new Error(rowNumber + '행 팀 이름은 출석 화면에서 이미 쓰고 있습니다.');
    group.teams.push({name: team, order: orgDraftOrder_(row[8], rowNumber), enabled: row[9] === true});
  });
  const activeGroups = groups.filter(function (group) { return group.enabled; })
    .sort(function (left, right) { return left.order - right.order; })
    .map(function (group) {
      const teams = group.teams.filter(function (team) { return team.enabled; })
        .sort(function (left, right) { return left.order - right.order; })
        .map(function (team) { return team.name; });
      if (!teams.length) throw new Error(group.label + '에 사용할 팀이 없습니다.');
      return {key: group.key, label: group.label, recipient: group.recipient, teams: teams, id: group.id};
    });
  if (!activeGroups.length) throw new Error('사용할 군을 한 개 이상 선택해 주세요.');
  return {term: term, groups: activeGroups};
}

function reconcileOrgGroupIds_(draft, versions) {
  const namesById = new Map();
  versions.forEach(function (version) {
    version.groups.forEach(function (group) {
      const id = group.id || group.key;
      const names = namesById.get(id) || new Set();
      [group.key, group.label].concat(group.aliases || []).forEach(function (name) { names.add(name); });
      namesById.set(id, names);
    });
  });
  const active = versions.length ? versions[versions.length - 1].groups : [];
  const activeNames = new Map();
  const activeIds = new Set();
  return {
    term: draft.term,
    groups: draft.groups.map(function (group) {
      const matched = active.filter(function (prior) {
        return [prior.key, prior.label].some(function (name) { return name === group.key || name === group.label; });
      });
      if (!group.id && matched.length > 1) throw new Error(group.label + '의 이전 군을 하나로 찾지 못했습니다.');
      const id = group.id || (matched.length ? matched[0].id || matched[0].key : group.key);
      if (activeIds.has(id)) throw new Error(group.label + '의 군 식별 코드가 중복됩니다.');
      activeIds.add(id);
      const aliases = [...(namesById.get(id) || [])].filter(function (name) {
        return name !== group.key && name !== group.label;
      });
      [group.key, group.label].concat(aliases).forEach(function (name) {
        const priorId = activeNames.get(name);
        if (priorId && priorId !== id) throw new Error(name + ' 군의 이전 표기가 서로 겹칩니다.');
        activeNames.set(name, id);
      });
      return Object.assign({}, group, {id: id, aliases: aliases});
    })
  };
}

function readOrgDraft_(context) {
  const sheet = requireOrgAdminTab_(context);
  const last = sheet.getLastRow();
  const rows = last < ORG_DRAFT_START ? []
    : sheet.getRange(ORG_DRAFT_START, 1, last - ORG_DRAFT_START + 1, ORG_GROUP_ID_COLUMN).getValues();
  return reconcileOrgGroupIds_(parseOrgDraft_(sheet.getRange('B2').getValue(), rows), readOrgVersions_());
}

function rememberOrgDraftGroupIds_(context, draft) {
  const sheet = requireOrgAdminTab_(context);
  const count = sheet.getLastRow() - ORG_DRAFT_START + 1;
  const rows = sheet.getRange(ORG_DRAFT_START, 1, count, ORG_GROUP_ID_COLUMN).getValues();
  const groups = new Map(draft.groups.map(function (group) { return [group.key, group]; }));
  const ids = rows.map(function (row) {
    const group = groups.get(orgText_(row[0]));
    return [group && group.label === orgText_(row[1]) ? group.id : row[ORG_GROUP_ID_COLUMN - 1]];
  });
  sheet.getRange(ORG_DRAFT_START, ORG_GROUP_ID_COLUMN, count, 1).setValues(ids);
}

function orgDraftChanges_(before, after) {
  const changes = [];
  const old = new Map((before ? before.groups : []).map(function (group) { return [group.id || group.key, group]; }));
  const addedTeams = [];
  const retiredTeams = [];
  after.groups.forEach(function (group) {
    const id = group.id || group.key;
    const prior = old.get(id);
    old.delete(id);
    if (!prior) changes.push({label: '군 추가', text: group.label});
    else if (prior.label !== group.label) changes.push({label: '군 이름 변경', text: prior.label + ' → ' + group.label});
    if (prior && prior.key !== group.key) changes.push({label: '군 약칭 변경', text: prior.key + ' → ' + group.key});
    if (prior && prior.recipient !== group.recipient) changes.push({label: '보고 담당자 변경', text: group.label});
    group.teams.forEach(function (team) {
      if (!prior || !prior.teams.includes(team)) addedTeams.push({group: group.label, team: team, index: changes.length});
    });
    (prior ? prior.teams : []).forEach(function (team) {
      if (!group.teams.includes(team)) retiredTeams.push({group: prior.label, team: team});
    });
  });
  old.forEach(function (group) {
    changes.push({label: '군 종료', text: group.label});
    group.teams.forEach(function (team) { retiredTeams.push({group: group.label, team: team}); });
  });
  addedTeams.slice().reverse().forEach(function (item) {
    const candidates = retiredTeams.filter(function (retired) { return retired.team === item.team; });
    const unique = addedTeams.filter(function (added) { return added.team === item.team; }).length === 1;
    const moved = unique && candidates.length === 1 ? candidates[0] : null;
    if (moved) retiredTeams.splice(retiredTeams.indexOf(moved), 1);
    changes.splice(item.index, 0, {
      label: moved ? '팀 이동' : '팀 추가',
      text: item.team + ' (' + (moved ? moved.group + ' → ' : '') + item.group + ')'
    });
  });
  retiredTeams.forEach(function (item) {
    changes.push({label: '팀 종료', text: item.team + ' (' + item.group + ')'});
  });
  return changes;
}

function orgAssetTargets_(context) {
  const targets = {
    formId: context.props.getProperty('ORG_INTENSIVE_FORM_ID'),
    guideFileId: context.props.getProperty('ORG_GUIDE_FILE_ID'),
    guideTemplateId: context.props.getProperty('ORG_GUIDE_TEMPLATE_ID')
  };
  if (Object.values(targets).some(function (value) { return !value; })) {
    throw new Error('집중교육 폼, 안내도 PNG, 안내도 템플릿 연결 값을 확인해 주세요.');
  }
  return targets;
}

function orgDraftFingerprint_(draft, active, targets, revisions) {
  const value = JSON.stringify({draft: draft, current: active ? active.id : null, targets: targets, revisions: revisions});
  return Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value));
}

function orgIsPresentDate_(value) {
  if (value instanceof Date) return Number.isFinite(value.getTime());
  const parts = orgText_(value).match(/^(\d{4})\s*[-./]\s*(\d{1,2})\s*[-./]\s*(\d{1,2})\.?$/);
  if (!parts) return false;
  const year = Number(parts[1]);
  const month = Number(parts[2]);
  const day = Number(parts[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function orgIncompleteCount_(context) {
  const sources = [
    context.props.getProperty('ORG_EDUCATION_SPREADSHEET_ID'),
    context.props.getProperty('ORG_PREVIOUS_EDUCATION_SPREADSHEET_ID')
  ].filter(Boolean);
  if (!sources.length) throw new Error('교육관리 스프레드시트를 먼저 연결해 주세요.');
  const records = new Map();
  new Set(sources).forEach(function (id) {
    const sheet = SpreadsheetApp.openById(id).getSheetByName(ORG_EDUCATION_TAB);
    if (!sheet) throw new Error('연결한 파일에서 교육 출석 현황 탭을 찾지 못했습니다.');
    const last = sheet.getLastRow();
    if (last < 2) return;
    const rows = sheet.getRange(2, 5, last - 1, 7).getValues();
    rows.forEach(function ([name, , phone, week1, week2, week3, week4]) {
      const nameKey = orgText_(name).replace(/\s+/g, '');
      const number = orgText_(phone).replace(/\D/g, '');
      if (!nameKey || !/^\d{10,11}$/.test(number)) return;
      const key = nameKey + '|' + number;
      const record = records.get(key) || {hasAttendance: false, completed: false};
      record.hasAttendance = record.hasAttendance || [week1, week2, week3].some(orgIsPresentDate_);
      record.completed = record.completed || orgIsPresentDate_(week4) || /^(?:(?:[1-4]분기\s*)?집중\s*교육|개별\s*수료)$/.test(orgText_(week4));
      records.set(key, record);
    });
  });
  return Array.from(records.values()).filter(function (record) {
    return record.hasAttendance && !record.completed;
  }).length;
}

function previewOrgSettings() {
  const context = orgAdminContext_();
  ensureOrgDraftMayChange_(context);
  const draft = readOrgDraft_(context);
  const active = readOrgConfiguration_();
  const targets = orgAssetTargets_(context);
  const revisions = orgCheckAssets_(targets);
  const count = orgIncompleteCount_(context);
  const blob = orgRenderGuide_(draft, targets);
  const preview = {
    draft: draft, changes: orgDraftChanges_(active, draft), incomplete: count,
    confirmation: orgDraftFingerprint_(draft, active, targets, revisions),
    guide: 'data:image/png;base64,' + Utilities.base64Encode(blob.getBytes())
  };
  const template = HtmlService.createTemplateFromFile('OrgPreview');
  template.preview = preview;
  SpreadsheetApp.getUi().showModalDialog(template.evaluate().setWidth(720).setHeight(680), '군·팀 설정 미리보기');
}

function applyOrgSettings(confirmation) {
  return withOrgPublishLock_(function () {
    const context = orgAdminContext_();
    ensureOrgDraftMayChange_(context);
    const draft = readOrgDraft_(context);
    const targets = orgAssetTargets_(context);
    const revisions = orgCheckAssets_(targets);
    if (confirmation !== orgDraftFingerprint_(draft, readOrgConfiguration_(), targets, revisions)) {
      throw new Error('미리보기 이후 설정이나 연결 파일이 바뀌었습니다. 다시 확인해 주세요.');
    }
    rememberOrgDraftGroupIds_(context, draft);
    const job = {
      phase: 'pause',
      wasAccepting: orgFormAccepting_(targets),
      configuration: Object.assign({id: Utilities.getUuid()}, draft),
      targets: targets
    };
    saveOrgPublicationJob_(context, job);
    return executeOrgPublication_(context, job);
  });
}

function resumeOrgSettings() {
  const result = withOrgPublishLock_(function () {
    const context = orgAdminContext_();
    const job = readOrgPublicationJob_(context);
    if (!job) return '이어서 적용할 변경이 없습니다.';
    if (job.phase === 'done') {
      const active = readOrgConfiguration_();
      if (!active || active.id !== job.configuration.id) throw new Error('군·팀 적용 이력을 다시 확인해 주세요.');
      updateOrgAppliedDisplay_(context, active);
      requireOrgAdminTab_(context).getRange('B3').setValue(ORG_ADMIN_PHASES.done);
      SpreadsheetApp.flush();
      return '마지막 군·팀 적용이 완료되어 있습니다.';
    }
    return executeOrgPublication_(context, job);
  });
  SpreadsheetApp.getUi().alert(result);
}

function withOrgPublishLock_(callback) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) throw new Error('다른 요청을 처리 중입니다. 잠시 후 다시 시도해 주세요.');
  try { return callback(); }
  finally { lock.releaseLock(); }
}

function readOrgPublicationJob_(context) {
  const value = requireOrgAdminJobTab_(context).getRange('A1').getValue();
  return value ? JSON.parse(value) : null;
}

function saveOrgPublicationJob_(context, job) {
  requireOrgAdminJobTab_(context).getRange('A1').setValue(JSON.stringify(job));
  requireOrgAdminTab_(context).getRange('B3').setValue(ORG_ADMIN_PHASES[job.phase]);
  SpreadsheetApp.flush();
}

function runOrgPublication_(job, ops) {
  const advance = function (phase) {
    const next = Object.assign({}, job, {phase: phase});
    ops.record(next);
    job.phase = phase;
  };
  if (job.phase === 'pause') {
    if (job.wasAccepting) ops.setAccepting(false);
    advance('form');
  }
  if (job.phase === 'form') {
    ops.updateForm(job.configuration);
    advance('guide');
  }
  if (job.phase === 'guide') {
    ops.updateGuide(job.configuration);
    advance('activate');
  }
  if (job.phase === 'activate') {
    ops.activate(job.configuration);
    advance('reopen');
  }
  if (job.phase === 'reopen') {
    if (job.wasAccepting) ops.setAccepting(true);
    advance('done');
  }
  if (job.phase !== 'done') throw new Error('군·팀 적용 단계가 올바르지 않습니다.');
}

function executeOrgPublication_(context, job) {
  try {
    if (['form', 'guide', 'activate'].includes(job.phase) && orgFormAccepting_(job.targets)) {
      orgSetFormAccepting_(job.targets, false);
    }
    runOrgPublication_(job, {
      record: function (next) { saveOrgPublicationJob_(context, next); },
      setAccepting: function (on) { orgSetFormAccepting_(job.targets, on); },
      updateForm: function (configuration) { orgUpdateForm_(configuration, job.targets); },
      updateGuide: function (configuration) {
        orgUpdateGuide_(orgRenderGuide_(configuration, job.targets), job.targets);
      },
      activate: function (configuration) { activateOrgConfiguration_(context, configuration); }
    });
    return job.configuration.term + ' 회기 군·팀 설정을 적용했습니다.';
  } catch (error) {
    const message = '군·팀 적용 중단 · ' + (ORG_ADMIN_PHASES[job.phase] || job.phase);
    requireOrgAdminTab_(context).getRange('B3').setValue(message);
    SpreadsheetApp.flush();
    throw new Error(message + '. ' + error.message);
  }
}

function activateOrgConfiguration_(context, configuration) {
  const history = context.book.getSheetByName(ORG_VERSIONS_SHEET);
  orgVersionCache_ = null;
  if (!readOrgVersions_().some(function (version) { return version.id === configuration.id; })) {
    const appliedAt = new Date().toISOString();
    history.appendRow([configuration.id, appliedAt, configuration.term, JSON.stringify(configuration)]);
    SpreadsheetApp.flush();
    orgVersionCache_ = null;
  }
  const active = readOrgConfiguration_();
  if (!active || active.id !== configuration.id) throw new Error('군·팀 적용 이력을 다시 확인해 주세요.');
  updateOrgAppliedDisplay_(context, active);
}

function updateOrgAppliedDisplay_(context, active) {
  requireOrgAdminTab_(context).getRange('B4').setValue(
    active.term + ' 회기 · ' + Utilities.formatDate(new Date(active.effectiveAt), 'Asia/Seoul', 'yyyy-MM-dd HH:mm:ss')
  );
}
