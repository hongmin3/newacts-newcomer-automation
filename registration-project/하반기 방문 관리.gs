/** 하반기 방문 명단. 같은 등록 Apps Script 프로젝트의 설정·잠금·메일 도우미를 쓴다. */
const VISITOR_MANAGEMENT = Object.freeze({
  endDateProperty: 'REGISTRATION_VISITOR_END_DATE',
  headers: ['', '날짜', '부', '군', '팀', '방문자 이름', '성별', '나이',
    '주소', '핸드폰', '인도자', '문화행축', '중복', '등록여부', '구분/비고']
});

function visitorDateKey_(value, year) {
  if (value instanceof Date && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, 'Asia/Seoul', 'yyyy-MM-dd');
  }
  const text = String(value || '').trim();
  const full = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  const short = text.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (!full && !short) return '';
  const y = full ? Number(full[1]) : year;
  const m = Number(full ? full[2] : short[1]);
  const d = Number(full ? full[3] : short[2]);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() + 1 !== m ||
      date.getUTCDate() !== d) return '';
  return String(y) + '-' + ('0' + m).slice(-2) + '-' + ('0' + d).slice(-2);
}

function getVisitorPeriod_() {
  const start = REGISTRATION_AUTOMATION.visitorStartDate;
  const end = PropertiesService.getScriptProperties()
    .getProperty(VISITOR_MANAGEMENT.endDateProperty) || '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || visitorDateKey_(start) !== start) {
    throw new Error('방문 관리 시작일 설정을 확인해 주세요.');
  }
  if (end && (!/^\d{4}-\d{2}-\d{2}$/.test(end) ||
      visitorDateKey_(end) !== end || end < start)) {
    throw new Error('방문 관리 마감일 속성을 확인해 주세요.');
  }
  return { start: start, end: end,
    today: Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd') };
}

function visitorNameKey_(value) {
  return String(value || '').trim().replace(/\s+/g, '');
}

function visitorPhoneKey_(value) {
  let phone = normalizeRegistrationPhone_(value);
  // 숫자 셀로 입력해 첫 0이 사라진 국내 휴대전화도 같은 번호로 읽는다.
  if (/^1[016789]\d{7,8}$/.test(phone)) phone = '0' + phone;
  return /^01[016789]\d{7,8}$/.test(phone) ? phone : '';
}

function visitorAge_(value, dateKey) {
  const text = value instanceof Date && !isNaN(value.getTime())
    ? Utilities.formatDate(value, 'Asia/Seoul', 'yyyy-MM-dd')
    : String(value || '').trim().replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3');
  const birth = visitorDateKey_(text);
  if (!birth || birth > dateKey) return '';
  const age = Number(dateKey.slice(0, 4)) - Number(birth.slice(0, 4)) -
    (dateKey.slice(5) < birth.slice(5) ? 1 : 0);
  return age >= 0 && age <= 120 ? age : '';
}

/** 행 위치는 원본 그대로 유지한다. 같은 이름/번호가 있으면 새 줄을 추측해서 만들지 않는다. */
function buildVisitorSyncPlan_(registrations, visitors, formulas, period) {
  const byName = new Map(); const byPhone = new Map();
  visitors.forEach(function (row, index) {
    const record = { row: row, index: index,
      name: visitorNameKey_(row[5]), phone: visitorPhoneKey_(row[9]) };
    if (!record.name && !record.phone) return;
    addRegistrationIndex_(byName, record.name, record);
    addRegistrationIndex_(byPhone, record.phone, record);
  });
  const candidates = []; const review = [];
  registrations.forEach(function (row, index) {
    if (!row.slice(0, 15).some(function (v) { return String(v || '').trim(); })) return;
    const name = visitorNameKey_(row[5]);
    // 등록 명단 오른쪽의 집계뿐인 줄은 등록자가 아니다.
    if (!name && !String(row[1] || '').trim() && !String(row[9] || '').trim()) return;
    const date = visitorDateKey_(row[1], Number(period.start.slice(0, 4)));
    const item = { registrationRow: index + 2, name: String(row[5] || '').trim() };
    if (!date) { review.push(Object.assign(item, {reason: '등록일을 확인할 수 없음'})); return; }
    if (date < period.start || date > period.today || (period.end && date > period.end)) return;
    const phone = visitorPhoneKey_(row[9]);
    if (!name || !phone) {
      review.push(Object.assign(item, {reason: '이름 또는 휴대전화번호 확인 필요'})); return;
    }
    candidates.push({ row: row, name: name, phone: phone, date: date, detail: item });
  });
  const registrationNames = new Map(); const registrationPhones = new Map();
  candidates.forEach(function (item) {
    addRegistrationIndex_(registrationNames, item.name, item);
    addRegistrationIndex_(registrationPhones, item.phone, item);
  });
  const addedRows = []; const addedDetails = []; const updatedDetails = [];
  const updates = []; const after = visitors.map(function (row) { return row.slice(); });
  let lastUsed = -1; let maxNumber = 0;
  visitors.forEach(function (row, index) {
    if (row.some(function (v) { return v !== '' && v !== null && v !== undefined; }) ||
        (formulas[index] || []).some(Boolean)) lastUsed = index;
    const number = Number(row[0]);
    if (Number.isFinite(number) && number > maxNumber) maxNumber = number;
  });
  candidates.forEach(function (item) {
    const detail = Object.assign({}, item.detail);
    const fail = function (reason) { review.push(Object.assign(detail, {reason: reason})); };
    if (registrationNames.get(item.name).length > 1 ||
        registrationPhones.get(item.phone).length > 1) {
      fail('관리 기간 안 등록 명단에 같은 이름 또는 전화번호가 여러 줄 있음'); return;
    }
    const nameMatches = byName.get(item.name) || [];
    const phoneMatches = byPhone.get(item.phone) || [];
    if (nameMatches.length || phoneMatches.length) {
      if (nameMatches.length !== 1 || phoneMatches.length !== 1 ||
          nameMatches[0].index !== phoneMatches[0].index) {
        fail('방문 명단의 이름·전화번호가 불일치하거나 여러 줄과 일치함'); return;
      }
      const match = nameMatches[0]; const marker = String(match.row[13] || '').trim();
      if ((formulas[match.index] || [])[13]) {
        fail('등록여부 셀에 수식이 있어 보존함'); return;
      }
      if (marker === 'O') return;
      if (marker) { fail('기존 등록여부 표시를 보존함: ' + marker); return; }
      updates.push({ row: match.index + 2, value: 'O' }); after[match.index][13] = 'O';
      updatedDetails.push(Object.assign(detail, {visitorRow: match.index + 2}));
      return;
    }
    const row = item.row;
    const visitor = [++maxNumber, item.date, row[2], row[3], row[4], row[5], row[6],
      visitorAge_(row[7], item.date), row[8], formatRegistrationPhone_(item.phone),
      row[10], '', '', 'O', '등록 명단에서 자동 반영'];
    addedRows.push(visitor); after[lastUsed + addedRows.length] = visitor;
    addedDetails.push(Object.assign(detail, {visitorRow: lastUsed + addedRows.length + 2}));
  });
  return { added: addedRows.length, updated: updates.length, review: review,
    addedDetails: addedDetails, updatedDetails: updatedDetails,
    addedRows: addedRows, updates: updates, appendRow: lastUsed + 3,
    period: period, summary: summarizeVisitorRows_(after),
    campaign: summarizeVisitorCampaign_(after, period) };
}

function summarizeVisitorRows_(rows) {
  const result = { records: 0, registered: 0, unregistered: 0, groups: {} };
  rows.forEach(function (row) {
    if (!visitorNameKey_(row[5])) return;
    result.records++;
    if (String(row[13] || '').trim() === 'O') result.registered++;
    else result.unregistered++;
    const group = String(row[3] || '').trim() || '미배정';
    result.groups[group] = (result.groups[group] || 0) + 1;
  });
  return result;
}

function readAndSyncVisitors_(options) {
  const period = getVisitorPeriod_(); const ss = getRegistrationSpreadsheet_();
  const source = ss.getSheetByName(REGISTRATION_AUTOMATION.registrationSheetName);
  const target = ss.getSheetByName(REGISTRATION_AUTOMATION.visitedSheetName);
  if (!source || !target) throw new Error('등록 새가족 또는 하반기 방문 새가족 시트를 찾을 수 없습니다.');
  const header = target.getRange(1, 1, 1, 15).getValues()[0];
  VISITOR_MANAGEMENT.headers.forEach(function (expected, index) {
    if (index && String(header[index] || '').trim() !== expected) {
      throw new Error('하반기 방문 새가족 머리글 확인 필요: ' + (index + 1) + '열 / ' + expected);
    }
  });
  const sourceHeader = source.getRange(1, 1, 1, 15).getValues()[0];
  ['날짜', '예배', '군', '팀', '새신자', '성별', '생년월일', '주소', '핸드폰', '인도자'].forEach(function (expected, index) {
    if (String(sourceHeader[index + 1] || '').trim() !== expected) {
      throw new Error('등록 새가족 머리글 확인 필요: ' + expected);
    }
  });
  const sourceRows = source.getLastRow() > 1
    ? source.getRange(2, 1, source.getLastRow() - 1, 15).getValues() : [];
  const range = target.getLastRow() > 1
    ? target.getRange(2, 1, target.getLastRow() - 1, 15) : null;
  const plan = buildVisitorSyncPlan_(sourceRows, range ? range.getValues() : [],
    range ? range.getFormulas() : [], period);
  const campaignFormulas = prepareVisitorCampaignSummary_(target, period);
  if (!options.dryRun) {
    let appliedAdded = 0; let appliedUpdated = 0;
    try {
    // 새 줄을 먼저 쓰고, 기존 줄은 N열 한 칸씩만 쓴다. 재시도해도 같은 줄을 다시 추가하지 않는다.
    if (plan.addedRows.length) {
      ensureRegistrationRows_(target, plan.appendRow + plan.addedRows.length - 1);
      target.getRange(plan.appendRow, 1, plan.addedRows.length, 15).setValues(
        plan.addedRows.map(function (row) {
          return row.map(function (value) {
            return typeof value === 'string' && /^[=+@]/.test(value) ? "'" + value : value;
          });
        })
      );
      appliedAdded = plan.added;
      target.getRange(plan.appendRow, 10, plan.addedRows.length, 1).setNumberFormat('@');
    }
    plan.updates.forEach(function (item) {
      target.getRange(item.row, 14).setValue(item.value); appliedUpdated++;
    });
    // 그리드가 늘었으면 집계 범위도 늘린다.
    const finalFormulas = buildVisitorCampaignFormulaRows_(
      target.getRange(2, 17, campaignFormulas.length, 1).getValues().map(function (row) { return String(row[0]).trim(); }),
      target.getMaxRows(), period);
    target.getRange(2, 18, finalFormulas.length, 3).setValues(finalFormulas);
    } catch (error) {
      error.visitorResult = { added: appliedAdded, updated: appliedUpdated,
        addedDetails: plan.addedDetails.slice(0, appliedAdded),
        updatedDetails: plan.updatedDetails.slice(0, appliedUpdated),
        period: period, review: [], partial: true };
      throw error;
    }
  }
  delete plan.addedRows; delete plan.updates; delete plan.appendRow;
  plan.dryRun = Boolean(options.dryRun);
  return plan;
}

function previewVisitorManagement() {
  return withRegistrationLock_(function () { return syncRegisteredToVisited_({dryRun: true}); });
}

function visitorPeriodLabel_(period) {
  return period.start + ' ~ ' + (period.end || '종료일 미정');
}

function visitorSummaryText_(result) {
  if (result.error) return '방문 동기화 실패: ' + result.error + '\n' +
    '실패 전 완료한 반영: 추가 ' + result.added + '건 / 등록 표시 ' + result.updated +
    '건. 시트 결과를 확인하고 다시 실행하세요.';
  return '하반기 방문 관리: ' + visitorPeriodLabel_(result.period) + '\n' +
    (result.dryRun ? '반영 예정' : '반영 결과') + ': 추가 ' + result.added +
    '건 / 등록 표시 ' + result.updated + '건 / 검토 ' + result.review.length + '건\n' +
    '관리 시트 전체 방문 기록 ' + result.summary.records + '건 / 등록 ' +
    result.summary.registered + '건 / 미등록 ' + result.summary.unregistered + '건\n' +
    '행사(10/31·11/1): 선방문 ' + result.campaign.previsit + '건 / 문화행축 ' +
    result.campaign.culture + '건 / 행사 당일 ' + result.campaign.event + '건\n' +
    '행사 군별 집계에서 제외한 군 확인 대상 기록: ' + result.campaign.unassigned + '건\n' +
    '군별 기록: ' + Object.keys(result.summary.groups).map(function (group) {
      return group + ' ' + result.summary.groups[group] + '건';
    }).join(', ');
}

function visitorManagementStatusMenu() {
  const result = previewVisitorManagement();
  SpreadsheetApp.getUi().alert(visitorSummaryText_(result) + '\n마감 후에도 기간 안의 늦은 등록 입력은 반영합니다.');
  return result;
}

function closeVisitorManagementMenu() {
  const ui = SpreadsheetApp.getUi();
  const answer = ui.prompt('방문 관리 마감일 지정',
    'YYYY-MM-DD로 입력하세요. 그날까지 등록한 사람을 포함하며 기간 안의 늦은 입력은 계속 반영합니다.', ui.ButtonSet.OK_CANCEL);
  if (answer.getSelectedButton() !== ui.Button.OK) return {cancelled: true};
  const end = answer.getResponseText().trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(end) || visitorDateKey_(end) !== end ||
      end < REGISTRATION_AUTOMATION.visitorStartDate) {
    ui.alert('마감일은 시작일 이후의 실제 날짜를 YYYY-MM-DD로 입력하세요.');
    return {invalid: true};
  }
  // prompt는 잠금을 해제하므로 응답을 받은 다음 잠근다.
  return withRegistrationLock_(function () {
    PropertiesService.getScriptProperties().setProperty(VISITOR_MANAGEMENT.endDateProperty, end);
    ui.alert('방문 관리 마감일: ' + end + '\n기존 명단은 보관하며 이 날짜까지의 등록자만 반영합니다.');
    return {end: end};
  });
}

function reopenVisitorManagementMenu() {
  const ui = SpreadsheetApp.getUi();
  if (ui.alert('방문 관리 마감 해제', '종료일 미정으로 다시 관리할까요? 기존 명단은 보관됩니다.', ui.ButtonSet.YES_NO) !== ui.Button.YES) {
    return {cancelled: true};
  }
  return withRegistrationLock_(function () {
    PropertiesService.getScriptProperties().deleteProperty(VISITOR_MANAGEMENT.endDateProperty);
    return {end: ''};
  });
}

function visitorMaintenanceText_(visitors) {
  if (!visitors) return '';
  let text = '\n[하반기 방문 명단]\n' + visitorSummaryText_(visitors) + '\n';
  ['addedDetails', 'updatedDetails'].forEach(function (key) {
    (visitors[key] || []).slice(0, 100).forEach(function (item) {
      text += '- ' + (key === 'addedDetails' ? '추가' : '등록 표시') +
        ' / 등록 ' + item.registrationRow + '행 / 방문 ' + item.visitorRow + '행 / ' + item.name + '\n';
    });
  });
  text += '방문 시트: https://docs.google.com/spreadsheets/d/' +
    REGISTRATION_AUTOMATION.registrationSpreadsheetId + '/edit#gid=1113837712\n';
  return text;
}

function visitorMaintenanceHtml_(visitors) {
  if (!visitors) return '';
  const text = visitorMaintenanceText_(visitors);
  return '<h3>하반기 방문 명단</h3><p>' + escapeRegistrationHtml_(text).replace(/\n/g, '<br>') +
    '</p><a href="https://docs.google.com/spreadsheets/d/' +
    REGISTRATION_AUTOMATION.registrationSpreadsheetId + '/edit#gid=1113837712">하반기 방문 시트 열기</a>';
}

const VISITOR_CAMPAIGN = Object.freeze({
  firstDate: '2026-10-31', secondDate: '2026-11-01'
});

function summarizeVisitorCampaign_(rows, period) {
  const result = { previsit: 0, culture: 0, event: 0, unassigned: 0 };
  rows.forEach(function (row) {
    if (!visitorNameKey_(row[5]) || String(row[12] || '').trim().toUpperCase() === 'O') return;
    const date = visitorDateKey_(row[1], 2026);
    if (!date || date < period.start || (period.end && date > period.end)) return;
    if (REGISTRATION_AUTOMATION.groups.indexOf(String(row[3] || '').trim()) < 0) {
      result.unassigned++; return;
    }
    if (date < VISITOR_CAMPAIGN.firstDate) result.previsit++;
    if (String(row[11] || '').trim().toUpperCase() === 'O') result.culture++;
    if (date === VISITOR_CAMPAIGN.firstDate || date === VISITOR_CAMPAIGN.secondDate) result.event++;
  });
  return result;
}

function visitorFormulaDate_(key) {
  const parts = key.split('-').map(Number);
  return 'DATE(' + parts.join(',') + ')';
}

/** 날짜 셀과 텍스트 날짜를 같은 날짜 번호로 읽는다. 기존 그리드 안에서 계산한다. */
function buildVisitorCampaignFormulaRows_(groupRows, maxRows, period) {
  const col = function (letter) { return '$' + letter + '$2:$' + letter + '$' + maxRows; };
  const b = col('B');
  const day = 'IFERROR(IF(ISNUMBER(' + b + '),INT(' + b + '),DATEVALUE(IF(REGEXMATCH(TO_TEXT(' + b +
    '),"^\\d{1,2}/\\d{1,2}$"),"2026/"&' + b + ',' + b + '))),0)';
  return groupRows.map(function (group, index) {
    const sheetRow = index + 2;
    if (group === '합계') return ['R', 'S', 'T'].map(function (letter) {
      return '=SUM(' + letter + '2:' + letter + (sheetRow - 1) + ')';
    });
    const common = '(TRIM(' + col('D') + ')=TRIM($Q' + sheetRow + '))*(TRIM(' + col('F') + ')<>"")*' +
      '(UPPER(TRIM(' + col('M') + '))<>"O")*(' + day + '>=' + visitorFormulaDate_(period.start) + ')' +
      (period.end ? '*(' + day + '<=' + visitorFormulaDate_(period.end) + ')' : '');
    const count = function (condition) { return '=SUM(ARRAYFORMULA(' + common + '*' + condition + '))'; };
    return [count('(' + day + '<' + visitorFormulaDate_(VISITOR_CAMPAIGN.firstDate) + ')'),
      count('(UPPER(TRIM(' + col('L') + '))="O")'),
      count('((' + day + '=' + visitorFormulaDate_(VISITOR_CAMPAIGN.firstDate) + ')+(' + day + '=' +
        visitorFormulaDate_(VISITOR_CAMPAIGN.secondDate) + '))')];
  });
}

function prepareVisitorCampaignSummary_(target, period) {
  const headers = target.getRange(1, 18, 1, 3).getValues()[0];
  ['선방문', '문화행축', '행축당일방문'].forEach(function (expected, index) {
    if (String(headers[index] || '').trim() !== expected) throw new Error('하반기 행사 집계 머리글 확인 필요: ' + expected);
  });
  const count = REGISTRATION_AUTOMATION.groups.length;
  const groups = target.getRange(2, 17, count + 1, 1).getValues().map(function (row) { return String(row[0] || '').trim(); });
  if (groups[count] !== '합계' || new Set(groups.slice(0, count)).size !== count ||
      groups.slice(0, count).some(function (group) { return REGISTRATION_AUTOMATION.groups.indexOf(group) < 0; })) {
    throw new Error('하반기 행사 집계 Q열의 군 목록·합계 행을 확인해 주세요.');
  }
  return buildVisitorCampaignFormulaRows_(groups, target.getMaxRows(), period);
}

function updateVisitorCampaignSummaryMenu() {
  if (!REGISTRATION_AUTOMATION.active && REGISTRATION_AUTOMATION.mode === 'PRODUCTION') {
    throw new Error('등록 자동화가 비활성 상태입니다.');
  }
  const result = withRegistrationLock_(function () {
    const target = getRegistrationSpreadsheet_().getSheetByName(REGISTRATION_AUTOMATION.visitedSheetName);
    if (!target) throw new Error('하반기 방문 새가족 시트를 찾을 수 없습니다.');
    const formulas = prepareVisitorCampaignSummary_(target, getVisitorPeriod_());
    target.getRange(2, 18, formulas.length, 3).setValues(formulas);
    return {updated: formulas.length, firstDate: VISITOR_CAMPAIGN.firstDate, secondDate: VISITOR_CAMPAIGN.secondDate};
  });
  SpreadsheetApp.getUi().alert('하반기 행사 집계 갱신 완료\n행사: 10월 31일·11월 1일\n선방문: 10월 4일~10월 30일');
  return result;
}
