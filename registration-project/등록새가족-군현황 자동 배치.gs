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
  // === 회기마다 바뀌는 값: 군 목록 ===========================================
  // 이 배열이 이 프로젝트에서 군을 정의하는 유일한 자리입니다.
  // 순서가 곧 군 현황판의 열 순서이고, 군을 더하거나 빼면 열 수도 따라 바뀝니다.
  // 바꿀 때는 아래 groupRecipients의 키도 같은 목록으로 맞춥니다.
  groups: ['신', '조', '명', '총', '영', '석', '전', '슬', '임'],
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

/**
 * 군 현황판 열 배치. 예배 구분(4부/5부)은 군을 나누지 않고,
 * "스스로"만 4부·5부 열로 나눠 한눈에 구분되게 합니다.
 * 열 번호는 0부터 세며 시트 열 번호는 +1 입니다.
 */
const DASHBOARD_LAYOUT = (function () {
  // 열 번호를 손으로 세지 않습니다 - 군이 늘거나 줄면 여기서 다시 계산됩니다.
  const groups = REGISTRATION_AUTOMATION.groups;
  const groupStartColumn = 1;
  const self4 = groupStartColumn + groups.length;
  return Object.freeze({
    headerRows: 2,
    startRow: 3,
    // 날짜 + 군 + 스스로(4부·5부) + 미배정 + 합계
    columns: groups.length + 5,
    legacyColumns: 20,
    dateColumn: 0,
    groupStartColumn: groupStartColumn,
    groupOrder: Object.freeze(groups.slice()),
    selfColumns: Object.freeze({ '4': self4, '5': self4 + 1 }),
    unassignedColumn: self4 + 2,
    totalColumn: self4 + 3
  });
})();

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
      forceTestRecipient: true,
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

  if (!options.dryRun) {
    writeRegistrationLog_('runRegistrationMaintenance', result);
  }

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
        '건 · 스스로/미배정 ' +
        (dashboard.attention || []).length + '명 · 검토 ' +
        reviewCount + '건',
      body: createDetailedRegistrationMaintenanceText_(result, options.label),
      htmlBody: createDetailedRegistrationMaintenanceHtml_(result, options.label),
      forceTestRecipient: Boolean(options.forceTestRecipient)
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
    '군 현황판 업데이트 완료\n배치: ' + result.processed +
    '명 (미배정 열: ' + result.unassigned +
    '명)\n검토 필요: ' + result.review.length + '건'
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

/**
 * 등록 행 하나가 현황판의 어느 열로 가는지 결정합니다.
 * 어떤 입력에서도 열 번호 없는 결과를 돌려주지 않습니다 - 확정하지 못하면
 * '미배정' 열로 보내고 assigned:false 로 검토 대상임을 알립니다.
 */
function resolveDashboardGroupColumn_(group, introducer, service) {
  const raw = String(group || '').trim();
  const intro = String(introducer || '').trim();
  const isSelf = raw === '스스로' || raw === '군배정필요' ||
    (!raw && intro === '스스로');

  if (isSelf) {
    const selfColumn = DASHBOARD_LAYOUT.selfColumns[String(service)];
    if (selfColumn === undefined) {
      return {
        column: DASHBOARD_LAYOUT.unassignedColumn,
        assigned: false,
        reason: '스스로 등록인데 예배 구분(4/5)이 없어 미배정 열로 배치: ' +
          (String(service || '').trim() || '빈값')
      };
    }
    return { column: selfColumn, assigned: true, reason: '' };
  }

  const index = DASHBOARD_LAYOUT.groupOrder.indexOf(
    normalizeAttendanceGroupForRegistration_(raw)
  );
  if (index === -1) {
    return {
      column: DASHBOARD_LAYOUT.unassignedColumn,
      assigned: false,
      reason: '군을 확인할 수 없어 미배정 열로 배치: ' + (raw || '빈값')
    };
  }
  return {
    column: DASHBOARD_LAYOUT.groupStartColumn + index,
    assigned: true,
    reason: ''
  };
}

/**
 * 1~2행 머리글 값을 만듭니다. 시트를 건드리지 않는 순수 함수라 테스트가 쉽습니다.
 */
function buildNewFamilyStatusHeader_() {
  const width = DASHBOARD_LAYOUT.columns;
  const top = new Array(width).fill('');
  const bottom = new Array(width).fill('');

  top[DASHBOARD_LAYOUT.dateColumn] = '날짜';
  top[DASHBOARD_LAYOUT.groupStartColumn] = '군 배정 (4·5부 통합)';
  top[DASHBOARD_LAYOUT.selfColumns['4']] = '스스로';
  top[DASHBOARD_LAYOUT.unassignedColumn] = '미배정';
  top[DASHBOARD_LAYOUT.totalColumn] = '합계';

  DASHBOARD_LAYOUT.groupOrder.forEach(function (group, index) {
    bottom[DASHBOARD_LAYOUT.groupStartColumn + index] = group;
  });
  bottom[DASHBOARD_LAYOUT.selfColumns['4']] = '4부';
  bottom[DASHBOARD_LAYOUT.selfColumns['5']] = '5부';

  return [top, bottom];
}

function writeNewFamilyStatusHeader_(sheet) {
  const width = DASHBOARD_LAYOUT.columns;

  // 이전 배치(20열)의 머리글이 오른쪽에 남지 않도록 먼저 넓게 지웁니다.
  const staleWidth = Math.min(
    Math.max(DASHBOARD_LAYOUT.legacyColumns, width),
    sheet.getMaxColumns()
  );
  const stale = sheet.getRange(1, 1, DASHBOARD_LAYOUT.headerRows, staleWidth);
  stale.breakApart();
  stale.clearContent();
  stale.setBackground(null);

  const header = sheet.getRange(1, 1, DASHBOARD_LAYOUT.headerRows, width);
  header.setValues(buildNewFamilyStatusHeader_())
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle')
    .setFontWeight('bold')
    .setBackground('#D9EAD3');

  // 세로 병합(2행짜리 단일 열)과 가로 병합(1행짜리 여러 열)을 나눠 적용합니다.
  sheet.getRange(1, DASHBOARD_LAYOUT.dateColumn + 1,
    DASHBOARD_LAYOUT.headerRows, 1).merge();
  sheet.getRange(1, DASHBOARD_LAYOUT.unassignedColumn + 1,
    DASHBOARD_LAYOUT.headerRows, 1).merge();
  sheet.getRange(1, DASHBOARD_LAYOUT.totalColumn + 1,
    DASHBOARD_LAYOUT.headerRows, 1).merge();
  sheet.getRange(1, DASHBOARD_LAYOUT.groupStartColumn + 1,
    1, DASHBOARD_LAYOUT.groupOrder.length).merge();
  sheet.getRange(1, DASHBOARD_LAYOUT.selfColumns['4'] + 1, 1, 2).merge();
}

function ensureRegistrationColumns_(sheet, requiredColumns) {
  const missing = requiredColumns - sheet.getMaxColumns();
  if (missing > 0) sheet.insertColumnsAfter(sheet.getMaxColumns(), missing);
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
  const grouped = new Map();
  const review = [];
  // 담당자가 직접 군을 정해 줘야 하는 사람들 - 스스로 등록자와 미배정자.
  const attention = [];
  let processed = 0;
  let unassigned = 0;

  data.forEach(function (row, index) {
    const name = String(row[5] || '').trim();
    if (!name) return;

    const serviceText = String(row[2] || '').trim() || '미상';
    const groupText = String(row[3] || '').trim() || '빈값';
    const introducerText = String(row[10] || '').trim();
    const date = parseRegistrationDate_(row[1]);

    if (!date) {
      // 배치할 날짜가 없으면 현황판에 쓸 자리가 없습니다. 검토로만 보고합니다.
      const dateReason = '등록일을 해석할 수 없어 현황판에 배치하지 못함: ' +
        (String(row[1] || '').trim() || '빈값');
      review.push({ row: index + 2, name: name, reason: dateReason });
      attention.push({
        kind: '미배정',
        row: index + 2,
        name: name,
        date: '미상',
        service: serviceText,
        group: groupText,
        introducer: introducerText,
        note: dateReason
      });
      return;
    }

    const placement = resolveDashboardGroupColumn_(
      row[3], row[10], Number(row[2])
    );
    if (!placement.assigned) {
      unassigned += 1;
      review.push({ row: index + 2, name: name, reason: placement.reason });
    }

    const isSelfColumn =
      placement.column === DASHBOARD_LAYOUT.selfColumns['4'] ||
      placement.column === DASHBOARD_LAYOUT.selfColumns['5'];
    if (isSelfColumn || !placement.assigned) {
      attention.push({
        kind: placement.assigned ? '스스로' : '미배정',
        row: index + 2,
        name: name,
        date: Utilities.formatDate(date, 'Asia/Seoul', 'M/d'),
        service: serviceText,
        group: groupText,
        introducer: introducerText,
        note: placement.reason || '군 배정이 필요합니다'
      });
    }

    const key = Utilities.formatDate(date, 'Asia/Seoul', 'yyyy-MM-dd');
    if (!grouped.has(key)) {
      grouped.set(key, {
        date: date,
        display: Utilities.formatDate(date, 'Asia/Seoul', 'M/d'),
        columns: {}
      });
    }
    const columns = grouped.get(key).columns;
    if (!columns[placement.column]) columns[placement.column] = [];
    columns[placement.column].push(name);
    processed += 1;
  });

  const days = Array.from(grouped.values()).sort(function (a, b) {
    return a.date.getTime() - b.date.getTime();
  });
  const width = DASHBOARD_LAYOUT.columns;
  const output = [];
  const backgrounds = [];

  days.forEach(function (day, dayIndex) {
    const columnKeys = Object.keys(day.columns);
    let rowsForDay = 1;
    columnKeys.forEach(function (column) {
      rowsForDay = Math.max(rowsForDay, day.columns[column].length);
    });

    const color = dayIndex % 2 === 0 ? '#FFF2CC' : '#FFFFFF';
    const start = output.length;
    for (let offset = 0; offset < rowsForDay; offset++) {
      output.push(new Array(width).fill(''));
      backgrounds.push(new Array(width).fill(color));
    }

    output[start][DASHBOARD_LAYOUT.dateColumn] = day.display;
    let dayTotal = 0;

    columnKeys.forEach(function (column) {
      const names = day.columns[column].slice().sort();
      dayTotal += names.length;
      names.forEach(function (name, offset) {
        output[start + offset][Number(column)] = name;
      });
    });
    output[start][DASHBOARD_LAYOUT.totalColumn] = dayTotal;
  });

  if (!options.dryRun) {
    const startRow = DASHBOARD_LAYOUT.startRow;
    ensureRegistrationColumns_(targetSheet, width);
    writeNewFamilyStatusHeader_(targetSheet);

    // 이전 20열 배치가 남긴 내용과 배경색을 먼저 지웁니다.
    const clearWidth = Math.min(
      Math.max(DASHBOARD_LAYOUT.legacyColumns, width),
      targetSheet.getMaxColumns()
    );
    const oldRows = Math.max(targetSheet.getLastRow() - startRow + 1, 0);
    if (oldRows > 0) {
      const oldRange = targetSheet.getRange(startRow, 1, oldRows, clearWidth);
      oldRange.clearContent();
      oldRange.setBackground(null);
    }

    ensureRegistrationRows_(targetSheet, startRow + output.length - 1);
    if (output.length > 0) {
      targetSheet.getRange(startRow, 1, output.length, width)
        .setValues(output)
        .setBackgrounds(backgrounds)
        .setHorizontalAlignment('center')
        .setVerticalAlignment('middle');
    }
  }

  return {
    processed: processed,
    unassigned: unassigned,
    outputRows: output.length,
    review: review,
    attention: attention
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
  text += '군 현황 배치: ' + result.dashboard.processed + '명\n';
  text += '미배정 열: ' + (result.dashboard.unassigned || 0) + '명\n';
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
  const storedStates = properties.getProperties();
  const pendingStates = {};
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
      Object.prototype.hasOwnProperty.call(storedStates, stateKey)
        ? storedStates[stateKey]
        : null
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

    // 이름은 자동으로 고치지 않는다. 등록 명단의 이름과 교육 출석 이름이 다르면
    // 사람이 어느 쪽이 맞는지 확인해야 하므로 검토 내역으로만 보고한다(REQ-REG-001).
    if (normalizeRegistrationName_(currentName) !==
        normalizeRegistrationName_(match.name)) {
      result.review.push({
        registrationRow: registrationRow,
        name: currentName || match.name,
        reason: '등록 명단 이름이 교육 출석 이름(' + match.name +
          ')과 달라 자동 수정하지 않음'
      });
    }

    const fields = registrationCorrectionFields_(row, match);

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
      pendingStates[stateKey] = JSON.stringify(savedState);
    }
  });

  if (!options.dryRun) {
    if (Object.keys(pendingStates).length) {
      properties.setProperties(pendingStates);
    }
    SpreadsheetApp.flush();
  }
  return result;
}

/**
 * 등록 명단에서 자동 보정할 항목을 정의한다.
 *
 * 이름은 여기에 넣지 않는다 — 이름이 다르면 사람이 확인해야 하므로
 * `reconcileRegistrationWithLatestAttendance_`가 검토 내역으로 보고한다(REQ-REG-001).
 */
function registrationCorrectionFields_(row, match) {
  return [
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
  return REGISTRATION_AUTOMATION.groups.includes(group) ? group : '';
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
  text += '현황판 배치 인원: ' + result.dashboard.processed +
    '명 (누락 없음)\n';
  text += '미배정 열 인원: ' + (result.dashboard.unassigned || 0) +
    '명 (군을 확정하지 못했지만 현황판에는 이름이 있습니다)\n';
  text += '출력 행 수: ' + result.dashboard.outputRows +
    '행 (인원 수가 아닌 화면 배치 행 수)\n';
  text += '검토 필요: ' + result.dashboard.review.length + '건\n\n';

  const attention = result.dashboard.attention || [];
  if (attention.length) {
    text += '[스스로 등록·군 미배정 명단]\n';
    text += '아래 인원은 담당자가 군을 정해 줘야 합니다.\n';
    attention.forEach(function (item) {
      const servicePart = item.service === '미상'
        ? '예배 구분 미상' : item.service + '부';
      text += '- [' + item.kind + '] ' + item.date + ' ' + servicePart +
        ' / 등록 ' + item.row + '행 / ' + item.name +
        ' / 군 표기: ' + item.group +
        (item.introducer ? ' / 소개자: ' + item.introducer : '') + '\n';
    });
    text += '\n';
  }

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
  html += createRegistrationSummaryTable_([
    ['현황판 배치', result.dashboard.processed + '명'],
    ['미배정 열', (result.dashboard.unassigned || 0) + '명'],
    ['출력 행', result.dashboard.outputRows + '행']
  ]);
  html += '<p style="color:#6b7280;font-size:13px">군 배정은 4부·5부를 나누지 않고 ' +
    '하나의 군 열에 모읍니다. "스스로"만 4부·5부 열로 나눠 표시합니다. ' +
    '군을 확정하지 못한 사람도 <b>미배정</b> 열에 이름이 남으므로 현황판에서 누락되지 ' +
    '않습니다. 출력 행 수는 인원 수가 아니라 날짜별 최대 인원을 맞춘 화면 배치 행 수입니다.</p>';

  const attentionItems = result.dashboard.attention || [];
  if (attentionItems.length) {
    html += '<h3>3. 스스로 등록·군 미배정 명단</h3>';
    html += '<p style="color:#6b7280;font-size:13px">아래 ' +
      attentionItems.length + '명은 담당자가 군을 정해 줘야 합니다.</p>';
    html += '<table style="width:100%;border-collapse:collapse;font-size:13px">';
    html += '<tr style="background:#ecfeff"><th>구분</th><th>등록일</th>' +
      '<th>예배</th><th>등록 행</th><th>이름</th><th>군 표기</th>' +
      '<th>소개자</th></tr>';
    attentionItems.slice(0, 100).forEach(function (item) {
      html += '<tr>' +
        createRegistrationTableCell_(item.kind) +
        createRegistrationTableCell_(item.date) +
        createRegistrationTableCell_(item.service) +
        createRegistrationTableCell_(item.row) +
        createRegistrationTableCell_(item.name) +
        createRegistrationTableCell_(item.group) +
        createRegistrationTableCell_(item.introducer || '-') + '</tr>';
    });
    html += '</table>';
  }

  if (reviewItems.length) {
    html += '<h3>4. 검토 필요 상세</h3>';
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
  // run*Test 계열은 현재 모드와 무관하게 테스트 수신자 한 명으로 고정합니다.
  const testOnly = Boolean(message.forceTestRecipient) ||
    REGISTRATION_AUTOMATION.mode !== 'PRODUCTION';
  const recipients = testOnly
    ? [REGISTRATION_AUTOMATION.testRecipient]
    : (message.recipients || []);

  const unique = Array.from(new Set(recipients.map(String).map(function (value) {
    return value.trim();
  }).filter(Boolean)));

  if (testOnly) {
    if (unique.length !== 1 ||
        unique[0] !== REGISTRATION_AUTOMATION.testRecipient) {
      throw new Error('테스트 메일 수신자 안전장치 위반');
    }
  }

  MailApp.sendEmail({
    to: unique.join(','),
    subject: (testOnly ? '[TEST] ' : '') + message.subject,
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

/**
 * 실행 결과를 숨김 로그 시트에 최신순으로 남깁니다.
 * 운영 화면에는 보이지 않도록 항상 숨김 상태를 유지합니다.
 */
function writeRegistrationLog_(functionName, result) {
  const sheet = getHiddenLogSheet_(
    getRegistrationSpreadsheet_(),
    REGISTRATION_AUTOMATION.logSheetName,
    ['실행시각', '함수', '모드', '자동보정', '수동보호',
      '보정검토', '현황인원', '현황출력행', '현황검토']
  );
  const correction = result.reconciliation ||
    { changes: [], protected: [], review: [] };

  if (sheet.getLastRow() > 1) sheet.insertRowAfter(1);
  sheet.getRange(2, 1, 1, 9).setValues([[
    new Date(), functionName, REGISTRATION_AUTOMATION.mode,
    correction.changes.length, correction.protected.length,
    correction.review.length, result.dashboard.processed,
    result.dashboard.outputRows, result.dashboard.review.length
  ]]);
  sheet.getRange(2, 1).setNumberFormat('yyyy. MM. dd HH:mm:ss');
  return { logged: true };
}

/**
 * 로그 시트를 만들고 항상 숨김 상태로 유지합니다.
 * 활성 시트는 숨길 수 없으므로 다른 시트를 먼저 활성화합니다.
 */
function getHiddenLogSheet_(spreadsheet, name, headers) {
  let sheet = spreadsheet.getSheetByName(name);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(name);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  }
  if (!sheet.isSheetHidden()) {
    const visibleOthers = spreadsheet.getSheets().filter(function (other) {
      return other.getSheetId() !== sheet.getSheetId() && !other.isSheetHidden();
    });
    if (visibleOthers.length) {
      spreadsheet.setActiveSheet(visibleOthers[0]);
      sheet.hideSheet();
    }
  }
  return sheet;
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
    return new Date(resolveRegistrationYear_(month), month - 1, day);
  }

  const date = new Date(text);
  return isNaN(date.getTime()) ? null : date;
}

/**
 * 'M/d' 표기는 연도가 없어 회기 기준으로 추정합니다.
 * 회기는 3월에 시작하므로 12월 값은 오늘이 12월이 아니면 전년도로 봅니다.
 * 연도를 고정하면 해가 바뀌는 순간 모든 날짜가 어긋나므로 오늘 기준으로 계산합니다.
 */
function resolveRegistrationYear_(month, today) {
  const base = today && typeof today.getFullYear === 'function'
    ? today
    : new Date();
  const currentYear = base.getFullYear();
  const currentMonth = base.getMonth() + 1;
  if (month === 12 && currentMonth !== 12) return currentYear - 1;
  return currentYear;
}

function escapeRegistrationHtml_(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
