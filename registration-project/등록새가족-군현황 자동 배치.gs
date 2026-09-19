/**
 * 등록/군 현황/방문자 자동화 - 안전한 배치 처리 버전
 */
const REGISTRATION_AUTOMATION = Object.freeze({
  active: true,
  mode: 'PRODUCTION',
  testRecipient: 'ksj747172@gmail.com',
  productionAdminRecipients: [
    'ksj747172@gmail.com',
    'rayo072@naver.com',
    'rnrnwkddn@naver.com',
    'wnehdrms123@naver.com',
    'whduswn94@naver.com'
  ],
  groupRecipients: {
    '신': 'smk941129@gmail.com',
    '조': 'kmc7758@naver.com',
    '총': 'eomchong@icloud.com',
    '석': 'hwoneeeeee@gmail.com',
    '전': 'jbr0196@naver.com',
    '명': 'jun607@naver.com',
    '임': 'dkssud2521@naver.com',
    '슬': 'l__seul@naver.com',
    '영': 'revlee0956@gmail.com'
  },
  registrationSpreadsheetId: '1dBO4rhCCadxO-KVBX_Jmg4aDcV9zim_sqM95JKd4Snk',
  educationSpreadsheetId: '1EEIAL39SgRtO1JTe8zpZ4qDMCf_qF-bfrtxn6jfpLgg',
  attendanceSpreadsheetId: '1PKQY3wVgSpk6SqJa9dCyCAV54CIzZF03d-ePReFGwxs',
  attendanceSheetName: '설문지 응답 시트1',
  autoCorrectionEnabled: true,
  correctionStatePrefix: 'REGISTRATION_EDUCATION_CORRECTION_',
  registrationSheetName: '등록 새가족',
  dashboardSheetName: '등록 새가족 군 현황',
  visitedSheetName: '상반기 방문 새가족',
  completionSheetName: '새가족교육 수료현황',
  educationSheetName: '교육 출석 현황',
  logSheetName: '자동화 로그',
  visitorStartDate: '2026-03-29'
});

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('⛪ 새가족 자동화 시스템')
    .addItem('변경 예정 미리보기', 'previewRegistrationMaintenance')
    .addItem('승인된 테스트 실행', 'runRegistrationMaintenanceTest')
    .addSeparator()
    .addItem('군 현황판만 업데이트', 'updateNewFamilyStatusMenu')
    .addItem('방문자 명단만 동기화', 'syncRegisteredToVisitedMenu')
    .addToUi();
}
function runRegistrationMaintenanceTrigger() {
  if (!REGISTRATION_AUTOMATION.active) {
    console.log('등록 자동화가 비활성 상태라 실행하지 않았습니다.');
    return;
  }
  return withRegistrationLock_(function () {
    return runRegistrationMaintenance_({
      dryRun: false,
      sendEmail: true,
      label: '정기 실행'
    });
  });
}

/**
 * 기존 설치형 트리거 함수명 호환용.
 */
function runAllAutomationTrigger() {
  return runRegistrationMaintenanceTrigger();
}

function previewRegistrationMaintenance() {
  return withRegistrationLock_(function () {
    const result = runRegistrationMaintenance_({
      dryRun: true,
      sendEmail: false,
      label: '미리보기'
    });
    console.log(JSON.stringify(result));
    return result;
  });
}

/**
 * 사용자 승인 후에만 실행합니다. 메일은 테스트 수신자 한 명에게만 갑니다.
 */
function runRegistrationMaintenanceTest() {
  return withRegistrationLock_(function () {
    return runRegistrationMaintenance_({
      dryRun: true,
      sendEmail: true,
      label: '상세 테스트(미리보기)'
    });
  });
}

function runRegistrationMaintenance_(options) {
  const reconciliation = reconcileRegistrationWithLatestAttendance_({
    dryRun: options.dryRun ||
      !REGISTRATION_AUTOMATION.autoCorrectionEnabled
  });
  const dashboard = updateNewFamilyStatus_({ dryRun: options.dryRun });
  const visitors = {
    disabled: true, added: 0, updated: 0,
    addedDetails: [], updatedDetails: [], review: []
  };
  const result = {
    dryRun: Boolean(options.dryRun),
    autoCorrectionEnabled:
      Boolean(REGISTRATION_AUTOMATION.autoCorrectionEnabled),
    reconciliation: reconciliation,
    dashboard: dashboard,
    visitors: visitors
  };

  if (options.sendEmail) {
    const reviewCount =
      reconciliation.review.length +
      dashboard.review.length;
    const changeLabel = result.dryRun ||
      !result.autoCorrectionEnabled ? '변경 예정' : '자동 수정';

    sendRegistrationEmail_({
      recipients: [REGISTRATION_AUTOMATION.testRecipient],
      subject: '[새가족 자동화] ' + options.label + ' | ' +
        changeLabel + ' ' + reconciliation.changes.length +
        '건 · 검토 ' + reviewCount + '건',
      body: createDetailedRegistrationMaintenanceText_(result, options.label),
      htmlBody: createDetailedRegistrationMaintenanceHtml_(result, options.label)
    });
  }
  return result;
}

function updateNewFamilyStatusMenu() {
  if (!REGISTRATION_AUTOMATION.active &&
      REGISTRATION_AUTOMATION.mode === 'PRODUCTION') {
    throw new Error('등록 자동화가 비활성 상태입니다.');
  }
  const result = withRegistrationLock_(function () {
    return updateNewFamilyStatus_({ dryRun: false });
  });
  SpreadsheetApp.getUi().alert(
    '군 현황판 업데이트 완료\n처리: ' + result.processed +
    '명\n검토 필요: ' + result.review.length + '건'
  );
  return result;
}

function syncRegisteredToVisitedMenu() {
  const result = {
    disabled: true, added: 0, updated: 0,
    addedDetails: [], updatedDetails: [], review: []
  };
  SpreadsheetApp.getUi().alert(
    '상반기 방문자 동기화는 중지되었습니다. 하반기 시트 준비 후 다시 설정해 주세요.'
  );
  return result;
}

function updateNewFamilyStatus_(options) {
  const ss = getRegistrationSpreadsheet_();
  const sourceSheet = ss.getSheetByName(
    REGISTRATION_AUTOMATION.registrationSheetName
  );
  const targetSheet = ss.getSheetByName(
    REGISTRATION_AUTOMATION.dashboardSheetName
  );
  if (!sourceSheet || !targetSheet) {
    throw new Error('등록 새가족 또는 군 현황 시트를 찾을 수 없습니다.');
  }

  const data = sourceSheet.getDataRange().getValues().slice(1);
  const groups4 = {
    '신': 1, '조': 2, '명': 3, '총': 4, '영': 5,
    '석': 6, '전': 7, '슬': 8, '스스로': 9
  };
  const groups5 = {
    '명': 10, '총': 11, '영': 12, '석': 13,
    '임': 14, '전': 15, '슬': 16, '스스로': 17
  };

  const grouped = new Map();
  const review = [];
  let processed = 0;

  data.forEach(function (row, index) {
    const date = parseRegistrationDate_(row[1]);
    const service = Number(row[2]);
    let group = String(row[3] || '').trim();
    const name = String(row[5] || '').trim();
    const introducer = String(row[10] || '').trim();

    if (!date || !name) return;
    if (![4, 5].includes(service)) {
      review.push({
        row: index + 2,
        name: name,
        reason: '예배 구분이 4/5가 아님'
      });
      return;
    }

    if (group === '군배정필요' || (!group && introducer === '스스로')) {
      group = '스스로';
    }

    const columnMap = service === 4 ? groups4 : groups5;
    if (!columnMap[group]) {
      review.push({
        row: index + 2,
        name: name,
        reason: '현황판에 매핑되지 않은 군: ' + (group || '빈값')
      });
      return;
    }

    const key = Utilities.formatDate(date, 'Asia/Seoul', 'yyyy-MM-dd');
    if (!grouped.has(key)) {
      grouped.set(key, {
        date: date,
        display: Utilities.formatDate(date, 'Asia/Seoul', 'M/d'),
        services: { 4: {}, 5: {} }
      });
    }
    const serviceGroups = grouped.get(key).services[service];
    if (!serviceGroups[group]) serviceGroups[group] = [];
    serviceGroups[group].push(name);
    processed += 1;
  });

  const days = Array.from(grouped.values()).sort(function (a, b) {
    return a.date.getTime() - b.date.getTime();
  });
  const output = [];
  const backgrounds = [];

  days.forEach(function (day, dayIndex) {
    let rowsForDay = 1;
    [4, 5].forEach(function (service) {
      Object.keys(day.services[service]).forEach(function (group) {
        rowsForDay = Math.max(
          rowsForDay,
          day.services[service][group].length
        );
      });
    });

    const color = dayIndex % 2 === 0 ? '#FFF2CC' : '#FFFFFF';
    const start = output.length;
    for (let offset = 0; offset < rowsForDay; offset++) {
      output.push(new Array(20).fill(''));
      backgrounds.push(new Array(20).fill(color));
    }

    output[start][0] = day.display;
    let dayTotal = 0;

    [4, 5].forEach(function (service) {
      const map = service === 4 ? groups4 : groups5;
      Object.keys(day.services[service]).forEach(function (group) {
        const names = day.services[service][group].slice().sort();
        dayTotal += names.length;
        names.forEach(function (name, offset) {
          output[start + offset][map[group]] = name;
        });
      });
    });
    output[start][18] = dayTotal;
  });

  if (!options.dryRun) {
    const startRow = 3;
    const oldRows = Math.max(targetSheet.getLastRow() - startRow + 1, 0);
    if (oldRows > 0) {
      targetSheet.getRange(startRow, 1, oldRows, 20).clearContent();
    }
    ensureRegistrationRows_(targetSheet, startRow + output.length - 1);
    if (output.length > 0) {
      targetSheet.getRange(startRow, 1, output.length, 20)
        .setValues(output)
        .setBackgrounds(backgrounds)
        .setHorizontalAlignment('center')
        .setVerticalAlignment('middle');
    }
  }

  return {
    processed: processed,
    outputRows: output.length,
    review: review
  };
}

function syncRegisteredToVisited_(options) {
  return {
    disabled: true, added: 0, updated: 0,
    addedDetails: [], updatedDetails: [], review: []
  };
}

function createRegistrationMaintenanceText_(result) {
  let text = '';
  text += '군 현황 처리: ' + result.dashboard.processed + '명\n';
  text += '군 현황 출력: ' + result.dashboard.outputRows + '행\n';
  text += '검토 필요: ' + result.dashboard.review.length + '건\n';
  return text;
}

function reconcileRegistrationWithLatestAttendance_(options) {
  const registrationSS = getRegistrationSpreadsheet_();
  const attendanceSS = SpreadsheetApp.openById(
    REGISTRATION_AUTOMATION.attendanceSpreadsheetId
  );
  const registrationSheet = registrationSS.getSheetByName(
    REGISTRATION_AUTOMATION.registrationSheetName
  );
  const attendanceSheet = attendanceSS.getSheetByName(
    REGISTRATION_AUTOMATION.attendanceSheetName
  );
  if (!registrationSheet || !attendanceSheet) {
    throw new Error('등록 새가족 또는 교육 출석 응답 시트를 찾을 수 없습니다.');
  }

  const registrationRows = registrationSheet.getLastRow() > 1
    ? registrationSheet.getRange(
        2, 1, registrationSheet.getLastRow() - 1,
        Math.max(registrationSheet.getLastColumn(), 14)
      ).getValues()
    : [];
  const attendanceRows = attendanceSheet.getLastRow() > 1
    ? attendanceSheet.getRange(
        2, 1, attendanceSheet.getLastRow() - 1,
        Math.max(attendanceSheet.getLastColumn(), 10)
      ).getValues()
    : [];

  const registrationNameCounts = new Map();
  registrationRows.forEach(function (row) {
    const key = normalizeRegistrationName_(row[5]);
    if (key) registrationNameCounts.set(
      key, (registrationNameCounts.get(key) || 0) + 1
    );
  });

  const attendanceRecords = attendanceRows.map(function (row, index) {
    const timestamp = parseRegistrationDate_(row[0]);
    return {
      sourceRow: index + 2,
      timestamp: timestamp,
      timestampMs: timestamp ? timestamp.getTime() : 0,
      name: String(row[4] || '').trim(),
      nameKey: normalizeRegistrationName_(row[4]),
      phone: formatRegistrationPhone_(row[5]),
      phoneKey: normalizeRegistrationPhone_(row[5]),
      group: normalizeAttendanceGroupForRegistration_(row[8]),
      team: normalizeAttendanceTeamForRegistration_(row[9])
    };
  }).filter(function (item) {
    return item.timestamp && item.nameKey;
  }).sort(function (a, b) {
    return b.timestampMs - a.timestampMs || a.sourceRow - b.sourceRow;
  });

  const attendanceByName = new Map();
  const attendanceByPhone = new Map();
  attendanceRecords.forEach(function (record) {
    if (!attendanceByName.has(record.nameKey)) {
      attendanceByName.set(record.nameKey, []);
    }
    attendanceByName.get(record.nameKey).push(record);
    if (record.phoneKey) {
      if (!attendanceByPhone.has(record.phoneKey)) {
        attendanceByPhone.set(record.phoneKey, []);
      }
      attendanceByPhone.get(record.phoneKey).push(record);
    }
  });

  const properties = PropertiesService.getScriptProperties();
  const result = {
    registrations: 0,
    matched: 0,
    unmatched: 0,
    changes: [],
    protected: [],
    review: [],
    dryRun: Boolean(options.dryRun)
  };

  registrationRows.forEach(function (row, index) {
    const registrationRow = index + 2;
    const no = String(row[0] || '').trim();
    const currentName = String(row[5] || '').trim();
    const currentNameKey = normalizeRegistrationName_(currentName);
    const currentPhoneKey = normalizeRegistrationPhone_(row[9]);
    if (!currentNameKey && !currentPhoneKey) return;
    result.registrations += 1;

    const stateKey = REGISTRATION_AUTOMATION.correctionStatePrefix +
      (no || ('ROW_' + registrationRow));
    const savedState = parseRegistrationCorrectionState_(
      properties.getProperty(stateKey)
    );
    let match = null;
    let strategy = '';

    if (savedState.sourceNameKey &&
        attendanceByName.has(savedState.sourceNameKey)) {
      match = attendanceByName.get(savedState.sourceNameKey)[0];
      strategy = '이전 자동매칭 이름';
    } else if (currentNameKey &&
               attendanceByName.has(currentNameKey)) {
      const nameMatches = attendanceByName.get(currentNameKey);
      const nameAndPhoneMatches = currentPhoneKey
        ? nameMatches.filter(function (item) {
            return item.phoneKey === currentPhoneKey;
          })
        : [];
      if (nameAndPhoneMatches.length > 0) {
        match = nameAndPhoneMatches[0];
        strategy = '이름+전화번호';
      } else if (registrationNameCounts.get(currentNameKey) === 1) {
        match = nameMatches[0];
        strategy = '고유 이름';
      } else {
        result.review.push({
          registrationRow: registrationRow,
          name: currentName,
          reason: '동명이인이 있어 전화번호까지 일치하는 교육 출석을 찾지 못함'
        });
      }
    } else if (currentPhoneKey &&
               attendanceByPhone.has(currentPhoneKey)) {
      const phoneMatches = attendanceByPhone.get(currentPhoneKey);
      result.review.push({
        registrationRow: registrationRow,
        name: currentName,
        reason: '전화번호는 같지만 이름이 달라 자동 수정하지 않음: ' +
          phoneMatches[0].name
      });
    }

    if (!match) {
      result.unmatched += 1;
      return;
    }
    result.matched += 1;

    const fields = [
      {
        key: 'name', label: '이름', column: 6,
        current: currentName, latest: match.name,
        normalize: normalizeRegistrationName_
      },
      {
        key: 'group', label: '군', column: 4,
        current: String(row[3] || '').trim(), latest: match.group,
        normalize: function (value) { return String(value || '').trim(); }
      },
      {
        key: 'team', label: '팀', column: 5,
        current: String(row[4] || '').trim(), latest: match.team,
        normalize: function (value) { return String(value || '').trim(); }
      },
      {
        key: 'phone', label: '전화번호', column: 10,
        current: formatRegistrationPhone_(row[9]), latest: match.phone,
        normalize: normalizeRegistrationPhone_
      }
    ];

    let stateChanged = false;
    fields.forEach(function (field) {
      if (!field.latest ||
          field.normalize(field.current) === field.normalize(field.latest)) {
        return;
      }

      const fieldState = savedState.fields[field.key] || null;
      if (fieldState && fieldState.protected) {
        result.protected.push({
          registrationRow: registrationRow,
          name: currentName,
          field: field.label,
          currentValue: field.current,
          educationValue: field.latest,
          reason: '사용자가 자동 수정 후 직접 변경하여 보호됨'
        });
        return;
      }

      if (fieldState &&
          field.normalize(field.current) !==
            field.normalize(fieldState.lastAutoValue)) {
        result.protected.push({
          registrationRow: registrationRow,
          name: currentName,
          field: field.label,
          currentValue: field.current,
          educationValue: field.latest,
          reason: '자동 수정값과 달라 수동 수정으로 판단해 보호'
        });
        if (!options.dryRun) {
          fieldState.protected = true;
          fieldState.manualValue = field.current;
          fieldState.protectedAt = new Date().toISOString();
          savedState.fields[field.key] = fieldState;
          stateChanged = true;
        }
        return;
      }

      result.changes.push({
        registrationRow: registrationRow,
        no: no,
        name: currentName || match.name,
        field: field.label,
        before: field.current || '(빈값)',
        after: field.latest,
        matchStrategy: strategy,
        attendanceRow: match.sourceRow,
        attendanceAt: Utilities.formatDate(
          match.timestamp, 'Asia/Seoul', 'yyyy-MM-dd HH:mm:ss'
        )
      });

      if (!options.dryRun) {
        registrationSheet.getRange(
          registrationRow, field.column
        ).setValue(field.latest);
        savedState.fields[field.key] = {
          previousValue: field.current,
          lastAutoValue: field.latest,
          protected: false,
          updatedAt: new Date().toISOString()
        };
        stateChanged = true;
      }
    });

    if (!options.dryRun && stateChanged) {
      savedState.sourceNameKey = match.nameKey;
      savedState.sourcePhoneKey = match.phoneKey;
      properties.setProperty(stateKey, JSON.stringify(savedState));
    }
  });

  if (!options.dryRun) SpreadsheetApp.flush();
  return result;
}

function parseRegistrationCorrectionState_(value) {
  if (!value) return { fields: {} };
  try {
    const parsed = JSON.parse(value);
    if (!parsed.fields || typeof parsed.fields !== 'object') {
      parsed.fields = {};
    }
    return parsed;
  } catch (error) {
    return { fields: {} };
  }
}

function normalizeAttendanceGroupForRegistration_(value) {
  const text = String(value || '').trim();
  if (!text || text.includes('모르겠')) return '';
  const group = text.charAt(0);
  return ['석', '총', '신', '슬', '명', '전', '조', '영', '임']
    .includes(group) ? group : '';
}

function normalizeAttendanceTeamForRegistration_(value) {
  const text = String(value || '').trim();
  if (!text || text.includes('모르겠')) return '';
  return text.split('(')[0].trim();
}

function maskRegistrationPhone_(value) {
  const phone = normalizeRegistrationPhone_(value);
  if (phone.length < 7) return '번호 확인 필요';
  return phone.slice(0, 3) + '-****-' + phone.slice(-4);
}

function createDetailedRegistrationMaintenanceText_(result, label) {
  const correction = result.reconciliation;
  const reviewCount = correction.review.length +
    result.dashboard.review.length;
  const changeLabel = result.dryRun || !result.autoCorrectionEnabled
    ? '변경 예정' : '자동 수정';

  let text = '';
  text += '[실행 정보]\n';
  text += '구분: ' + label + '\n';
  text += '실제 반영 여부: ' +
    (result.dryRun ? '미리보기(시트 변경 없음)' : '실제 반영') + '\n';
  text += '교육 출석 기준 자동 보정: ' +
    (result.autoCorrectionEnabled ? '활성' : '테스트 중(비활성)') + '\n\n';

  text += '[등록 정보 자동 보정]\n';
  text += '등록자 확인: ' + correction.registrations + '명\n';
  text += '교육 출석 매칭: ' + correction.matched + '명\n';
  text += '교육 출석 미매칭: ' + correction.unmatched + '명\n';
  text += changeLabel + ': ' + correction.changes.length + '건\n';
  text += '수동 수정 보호: ' + correction.protected.length + '건\n';
  text += '매칭 검토 필요: ' + correction.review.length + '건\n\n';

  if (correction.changes.length) {
    text += '[' + changeLabel + ' 상세]\n';
    correction.changes.slice(0, 100).forEach(function (item) {
      text += '- 등록 ' + item.registrationRow + '행 / ' + item.name +
        ' / ' + item.field + ': ' + item.before + ' → ' + item.after +
        ' / 근거: 교육 출석 ' + item.attendanceAt +
        ' (' + item.matchStrategy + ')\n';
    });
    text += '\n';
  }

  text += '[군 현황판]\n';
  text += '정상 배치 인원: ' + result.dashboard.processed + '명\n';
  text += '출력 행 수: ' + result.dashboard.outputRows +
    '행 (인원 수가 아닌 화면 배치 행 수)\n';
  text += '검토 필요: ' + result.dashboard.review.length + '건\n\n';

  if (reviewCount) {
    text += '[검토 필요 상세]\n';
    correction.review.concat(
      result.dashboard.review
    ).slice(0, 100).forEach(function (item) {
      text += '- 등록 ' + (item.registrationRow || item.row || '?') +
        '행 / ' + (item.name || '이름 없음') +
        ' / ' + item.reason + '\n';
    });
  }

  text += '\n등록 시트: https://docs.google.com/spreadsheets/d/' +
    REGISTRATION_AUTOMATION.registrationSpreadsheetId + '/edit#gid=0\n';
  text += '교육 출석 시트: https://docs.google.com/spreadsheets/d/' +
    REGISTRATION_AUTOMATION.attendanceSpreadsheetId +
    '/edit#gid=679249123\n';
  return text;
}

function createDetailedRegistrationMaintenanceHtml_(result, label) {
  const correction = result.reconciliation;
  const reviewItems = correction.review.concat(
    result.dashboard.review
  );
  const changeLabel = result.dryRun || !result.autoCorrectionEnabled
    ? '변경 예정' : '자동 수정';

  let html = '<div style="max-width:980px;margin:0 auto;' +
    'font-family:Malgun Gothic,Arial,sans-serif;color:#1f2937">';
  html += '<h2 style="margin-bottom:8px">새가족 자동화 상세 결과</h2>';
  html += '<p style="margin-top:0;color:#6b7280">' +
    escapeRegistrationHtml_(label) + ' · ' +
    (result.dryRun ? '미리보기(시트 변경 없음)' : '실제 반영') +
    '</p>';

  html += '<h3>1. 등록 정보 자동 보정</h3>';
  html += createRegistrationSummaryTable_([
    ['등록자', correction.registrations + '명'],
    ['교육 출석 매칭', correction.matched + '명'],
    ['미매칭', correction.unmatched + '명'],
    [changeLabel, correction.changes.length + '건'],
    ['수동 수정 보호', correction.protected.length + '건'],
    ['매칭 검토', correction.review.length + '건']
  ]);

  if (correction.changes.length) {
    html += '<h4>' + changeLabel + ' 상세</h4>';
    html += '<table style="width:100%;border-collapse:collapse;font-size:13px">';
    html += '<tr style="background:#eef2ff"><th>등록 행</th><th>이름</th>' +
      '<th>항목</th><th>기존 값</th><th>교육 최신 값</th>' +
      '<th>판단 근거</th></tr>';
    correction.changes.slice(0, 100).forEach(function (item) {
      html += '<tr>' +
        createRegistrationTableCell_(item.registrationRow) +
        createRegistrationTableCell_(item.name) +
        createRegistrationTableCell_(item.field) +
        createRegistrationTableCell_(item.before) +
        createRegistrationTableCell_(item.after) +
        createRegistrationTableCell_(
          item.attendanceAt + ' / ' + item.matchStrategy
        ) + '</tr>';
    });
    html += '</table>';
  }

  html += '<h3>2. 군 현황판</h3>';
  html += '<p>등록자 <b>' + result.dashboard.processed +
    '명</b>을 정상 배치해 <b>' + result.dashboard.outputRows +
    '행</b>을 구성했습니다. 출력 행 수는 인원 수가 아니라 날짜별 최대 인원을 맞춘 화면 배치 행 수입니다.</p>';

  if (reviewItems.length) {
    html += '<h3>3. 검토 필요 상세</h3>';
    html += '<table style="width:100%;border-collapse:collapse;font-size:13px">';
    html += '<tr style="background:#fff7ed"><th>행</th><th>이름</th><th>사유</th></tr>';
    reviewItems.slice(0, 100).forEach(function (item) {
      html += '<tr>' +
        createRegistrationTableCell_(
          item.registrationRow || item.row || '?'
        ) +
        createRegistrationTableCell_(item.name || '이름 없음') +
        createRegistrationTableCell_(item.reason) + '</tr>';
    });
    html += '</table>';
  }

  html += '<p style="margin-top:24px"><a href="https://docs.google.com/spreadsheets/d/' +
    REGISTRATION_AUTOMATION.registrationSpreadsheetId +
    '/edit#gid=0">등록 새가족 시트 열기</a> · ' +
    '<a href="https://docs.google.com/spreadsheets/d/' +
    REGISTRATION_AUTOMATION.attendanceSpreadsheetId +
    '/edit#gid=679249123">교육 출석 시트 열기</a></p>';
  html += '<p style="color:#6b7280;font-size:12px">수료현황·군별 통계 메일 수신자 설정은 변경하지 않았습니다.</p>';
  return html + '</div>';
}

function createRegistrationSummaryTable_(items) {
  let html = '<table style="width:100%;border-collapse:collapse;margin:8px 0 16px">';
  html += '<tr>';
  items.forEach(function (item) {
    html += '<td style="padding:12px 8px;border:1px solid #dbeafe;' +
      'background:#eff6ff;text-align:center"><div style="font-size:12px;' +
      'color:#6b7280">' + escapeRegistrationHtml_(item[0]) +
      '</div><div style="font-size:19px;font-weight:700;margin-top:4px">' +
      escapeRegistrationHtml_(item[1]) + '</div></td>';
  });
  return html + '</tr></table>';
}

function createRegistrationTableCell_(value) {
  return '<td style="padding:8px;border:1px solid #e5e7eb;text-align:center">' +
    escapeRegistrationHtml_(value) + '</td>';
}

function sendRegistrationEmail_(message) {
  const requested = message.recipients || [];
  const recipients = REGISTRATION_AUTOMATION.mode === 'PRODUCTION'
    ? requested
    : [REGISTRATION_AUTOMATION.testRecipient];

  const unique = Array.from(new Set(recipients.map(String).map(function (value) {
    return value.trim();
  }).filter(Boolean)));

  if (REGISTRATION_AUTOMATION.mode !== 'PRODUCTION') {
    if (unique.length !== 1 ||
        unique[0] !== REGISTRATION_AUTOMATION.testRecipient) {
      throw new Error('테스트 메일 수신자 안전장치 위반');
    }
  }

  MailApp.sendEmail({
    to: unique.join(','),
    subject: (REGISTRATION_AUTOMATION.mode === 'PRODUCTION'
      ? ''
      : '[TEST] ') + message.subject,
    body: message.body || 'HTML 메일입니다.',
    htmlBody: message.htmlBody || undefined
  });
}

function withRegistrationLock_(callback) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('다른 등록 자동화가 실행 중입니다.');
  try {
    return callback();
  } finally {
    lock.releaseLock();
  }
}

function getRegistrationSpreadsheet_() {
  return SpreadsheetApp.openById(
    REGISTRATION_AUTOMATION.registrationSpreadsheetId
  );
}

function writeRegistrationLog_(functionName, result) {
  return { disabled: true };
}

function ensureRegistrationRows_(sheet, requiredLastRow) {
  const missing = requiredLastRow - sheet.getMaxRows();
  if (missing > 0) sheet.insertRowsAfter(sheet.getMaxRows(), missing);
}

function addRegistrationIndex_(map, key, value) {
  if (!key) return;
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(value);
}

function normalizeRegistrationPhone_(value) {
  return String(value || '').replace(/[^0-9]/g, '');
}

function normalizeRegistrationName_(value) {
  return String(value || '')
    .trim()
    .replace(/[A-Z]$/, '')
    .replace(/\s+/g, '');
}

function parseRegistrationDate_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) return value;
  if (!value || String(value).trim() === '') return null;

  const text = String(value).trim();
  const short = text.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (short) {
    const month = Number(short[1]);
    const day = Number(short[2]);
    const year = month === 12 ? 2025 : 2026;
    return new Date(year, month - 1, day);
  }

  const date = new Date(text);
  return isNaN(date.getTime()) ? null : date;
}

function escapeRegistrationHtml_(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
