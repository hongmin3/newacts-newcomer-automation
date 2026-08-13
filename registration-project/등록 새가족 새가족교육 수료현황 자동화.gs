/**
 * 등록 명단과 교육 출석을 결합해 수료현황과 주간 통계를 생성합니다.
 * 등록 시트의 군/팀/전화번호는 자동으로 덮어쓰지 않고 불일치 보고만 합니다.
 */
function runRegistrationReportingTrigger() {
  if (!REGISTRATION_AUTOMATION.active) {
    console.log('등록 자동화가 비활성 상태라 수료 리포트를 실행하지 않았습니다.');
    return;
  }
  return withRegistrationLock_(function () {
    return runRegistrationReporting_({
      dryRun: false,
      sendEmail: true,
      label: '정기 실행'
    });
  });
}
/**
 * 기존 설치형 트리거 함수명 호환용.
 */
function runSystem() {
  return runRegistrationReportingTrigger();
}

function previewRegistrationReporting() {
  return withRegistrationLock_(function () {
    const result = runRegistrationReporting_({
      dryRun: true,
      sendEmail: false,
      label: '미리보기'
    });
    console.log(JSON.stringify(result));
    return result;
  });
}

/**
 * 사용자 승인 후에만 실행합니다. 테스트 메일은 본인 한 명에게만 갑니다.
 */
function runRegistrationReportingTest() {
  return withRegistrationLock_(function () {
    return runRegistrationReporting_({
      dryRun: false,
      sendEmail: true,
      label: '승인된 테스트'
    });
  });
}

function runRegistrationReporting_(options) {
  const syncResult = syncCompletionData_({ dryRun: options.dryRun });
  const reportResult = buildAndSendWeeklyReports_({
    sendEmail: options.sendEmail,
    syncResult: syncResult,
    label: options.label
  });

  const result = {
    dryRun: Boolean(options.dryRun),
    sync: syncResult,
    report: reportResult
  };

  if (!options.dryRun) writeCompletionLog_(result);
  return result;
}

/**
 * 기존 수동 함수명 호환용.
 */
function syncNewFamilyData() {
  if (!REGISTRATION_AUTOMATION.active &&
      REGISTRATION_AUTOMATION.mode === 'PRODUCTION') {
    throw new Error('등록 자동화가 비활성 상태입니다.');
  }
  return withRegistrationLock_(function () {
    return syncCompletionData_({ dryRun: false });
  });
}

function syncCompletionData_(options) {
  const registrationSS = getRegistrationSpreadsheet_();
  const educationSS = SpreadsheetApp.openById(
    REGISTRATION_AUTOMATION.educationSpreadsheetId
  );
  const registrationSheet = registrationSS.getSheetByName(
    REGISTRATION_AUTOMATION.registrationSheetName
  );
  const completionSheet = registrationSS.getSheetByName(
    REGISTRATION_AUTOMATION.completionSheetName
  );
  const educationSheet = educationSS.getSheetByName(
    REGISTRATION_AUTOMATION.educationSheetName
  );

  if (!registrationSheet || !completionSheet || !educationSheet) {
    throw new Error('등록/수료/교육 시트 중 하나를 찾을 수 없습니다.');
  }

  const registrationRows = registrationSheet.getLastRow() > 1
    ? registrationSheet
      .getRange(
        2, 1, registrationSheet.getLastRow() - 1,
        Math.max(registrationSheet.getLastColumn(), 11)
      )
      .getValues()
    : [];
  const educationRows = educationSheet.getLastRow() > 1
    ? educationSheet
      .getRange(
        2, 1, educationSheet.getLastRow() - 1,
        Math.max(educationSheet.getLastColumn(), 13)
      )
      .getValues()
    : [];
  const oldCompletionRows = completionSheet.getLastRow() > 1
    ? completionSheet
      .getRange(2, 1, completionSheet.getLastRow() - 1, 15)
      .getValues()
    : [];

  const educationByPhone = new Map();
  const oldManualByPhone = new Map();

  educationRows.forEach(function (row, index) {
    addRegistrationIndex_(
      educationByPhone,
      normalizeRegistrationPhone_(row[6]),
      { index: index, row: row }
    );
  });

  oldCompletionRows.forEach(function (row) {
    const phone = normalizeRegistrationPhone_(row[6]);
    if (!phone) return;
    if (!oldManualByPhone.has(phone)) oldManualByPhone.set(phone, []);
    oldManualByPhone.get(phone).push({
      messageOptOut: row[12],
      unidentified: row[13],
      note: row[14]
    });
  });

  const output = [];
  const result = {
    registrations: 0,
    matched: 0,
    unmatched: [],
    ambiguous: [],
    discrepancies: [],
    preservedManualRows: 0,
    outputRows: 0
  };

  registrationRows.forEach(function (row, index) {
    const name = String(row[5] || '').trim();
    const phoneKey = normalizeRegistrationPhone_(row[9]);
    if (!name && !phoneKey) return;
    result.registrations += 1;

    const matches = phoneKey ? (educationByPhone.get(phoneKey) || []) : [];
    let educationRow = null;

    if (matches.length === 1) {
      educationRow = matches[0].row;
      result.matched += 1;
    } else if (matches.length > 1) {
      result.ambiguous.push({
        registrationRow: index + 2,
        name: name,
        reason: '교육 시트에 같은 전화번호가 여러 행 존재'
      });
    } else {
      result.unmatched.push({
        registrationRow: index + 2,
        name: name,
        reason: phoneKey ? '교육 시트에서 전화번호를 찾지 못함' : '전화번호 없음'
      });
    }

    if (educationRow) {
      const educationGroup = String(educationRow[2] || '').trim();
      const educationTeam = String(educationRow[3] || '').trim();
      const registrationGroup = String(row[3] || '').trim();
      const registrationTeam = String(row[4] || '').trim();

      if (educationGroup && educationGroup !== registrationGroup) {
        result.discrepancies.push({
          registrationRow: index + 2,
          name: name,
          field: '군',
          registrationValue: registrationGroup,
          educationValue: educationGroup
        });
      }
      if (educationTeam && educationTeam !== registrationTeam) {
        result.discrepancies.push({
          registrationRow: index + 2,
          name: name,
          field: '팀',
          registrationValue: registrationTeam,
          educationValue: educationTeam
        });
      }
    }

    let manual = {
      messageOptOut: '',
      unidentified: '',
      note: ''
    };
    const manualMatches = phoneKey
      ? (oldManualByPhone.get(phoneKey) || [])
      : [];
    if (manualMatches.length === 1) {
      manual = manualMatches[0];
      if (manual.messageOptOut || manual.unidentified || manual.note) {
        result.preservedManualRows += 1;
      }
    }

    output.push([
      output.length + 1,
      row[3],
      row[4],
      row[2],
      row[5],
      row[6],
      row[9],
      row[1],
      educationRow ? educationRow[7] : '',
      educationRow ? educationRow[8] : '',
      educationRow ? educationRow[9] : '',
      educationRow ? educationRow[10] : '',
      manual.messageOptOut,
      manual.unidentified,
      manual.note
    ]);
  });

  result.outputRows = output.length;

  if (!options.dryRun) {
    const oldRows = Math.max(completionSheet.getLastRow() - 1, 0);
    if (oldRows > 0) {
      completionSheet.getRange(2, 1, oldRows, 15).clearContent();
    }
    ensureRegistrationRows_(completionSheet, output.length + 1);
    if (output.length > 0) {
      completionSheet.getRange(2, 1, output.length, 15).setValues(output);
    }
  }

  return result;
}

function buildAndSendWeeklyReports_(options) {
  const ss = getRegistrationSpreadsheet_();
  const sheet = ss.getSheetByName(
    REGISTRATION_AUTOMATION.completionSheetName
  );
  if (!sheet) throw new Error('새가족교육 수료현황 시트를 찾을 수 없습니다.');

  let rows = sheet.getLastRow() > 1
    ? sheet.getRange(2, 1, sheet.getLastRow() - 1, 15).getValues()
    : [];

  // 미리보기에서는 방금 계산한 결과가 아직 시트에 없으므로 현재 통계를 사용합니다.
  const total = createCompletionStats_();
  const byGroup = {};

  rows.forEach(function (row) {
    const group = String(row[1] || '').trim().charAt(0);
    if (!byGroup[group]) byGroup[group] = createCompletionStats_();
    updateCompletionStats_(total, row, false);
    updateCompletionStats_(byGroup[group], row, true);
  });

  const report = {
    total: total,
    byGroup: byGroup,
    discrepancies: options.syncResult.discrepancies.length,
    ambiguous: options.syncResult.ambiguous.length,
    unmatched: options.syncResult.unmatched.length
  };

  if (!options.sendEmail) return report;

  const adminHtml = createCompletionReportHtml_(
    '전체',
    total,
    options.syncResult,
    byGroup
  );
  sendRegistrationEmail_({
    recipients: REGISTRATION_AUTOMATION.productionAdminRecipients,
    subject: '[새가족부] 전체 새가족교육 현황 - ' + options.label,
    body: createCompletionReportText_('전체', total, options.syncResult),
    htmlBody: adminHtml
  });

  Object.keys(REGISTRATION_AUTOMATION.groupRecipients).forEach(function (group) {
    const stats = byGroup[group];
    if (!stats || stats.registered === 0) return;
    sendRegistrationEmail_({
      recipients: [REGISTRATION_AUTOMATION.groupRecipients[group]],
      subject: '[새가족부] ' + group + '군 새가족교육 수료 통계',
      body: createCompletionReportText_(group + '군', stats, null),
      htmlBody: createCompletionReportHtml_(group + '군', stats, null, null)
    });
  });

  return report;
}

/**
 * 기존 수동 함수명 호환용.
 */
function sendWeeklyReports() {
  if (!REGISTRATION_AUTOMATION.active &&
      REGISTRATION_AUTOMATION.mode === 'PRODUCTION') {
    throw new Error('등록 자동화가 비활성 상태입니다.');
  }
  return withRegistrationLock_(function () {
    const emptySync = {
      discrepancies: [],
      ambiguous: [],
      unmatched: []
    };
    return buildAndSendWeeklyReports_({
      sendEmail: true,
      syncResult: emptySync,
      label: '수동 실행'
    });
  });
}

function createCompletionStats_() {
  return {
    registered: 0,
    participated: 0,
    completed: 0,
    inProgress: 0,
    notStarted: 0,
    members: {
      completed: [],
      inProgress: [],
      notStarted: []
    }
  };
}

function updateCompletionStats_(stats, row, collectMembers) {
  stats.registered += 1;
  const weekValues = [row[8], row[9], row[10], row[11]];
  const weeks = weekValues.map(function (value) {
    return String(value || '').trim() !== '';
  });
  if (weeks.some(Boolean)) stats.participated += 1;
  let status = 'notStarted';
  if (weeks[3]) {
    stats.completed += 1;
    status = 'completed';
  } else if (weeks.some(Boolean)) {
    stats.inProgress += 1;
    status = 'inProgress';
  } else {
    stats.notStarted += 1;
  }

  if (collectMembers) {
    stats.members[status].push({
      name: String(row[4] || '').trim(),
      team: String(row[2] || '').trim(),
      phone: formatRegistrationPhone_(row[6]),
      relevantDate: status === 'completed'
        ? formatRegistrationReportDate_(weekValues[3])
        : status === 'inProgress'
          ? findLastEducationDate_(weekValues)
          : formatRegistrationReportDate_(row[7])
    });
  }
}

function createCompletionReportText_(title, stats, syncResult) {
  const participationRate = stats.registered
    ? (stats.participated / stats.registered * 100).toFixed(1)
    : '0.0';
  const completionRate = stats.registered
    ? (stats.completed / stats.registered * 100).toFixed(1)
    : '0.0';
  let text = '';
  text += title + ' 새가족교육 현황\n';
  text += '등록: ' + stats.registered + '명\n';
  text += '교육 참여: ' + stats.participated + '명\n';
  text += '수료: ' + stats.completed + '명\n';
  text += '진행 중: ' + stats.inProgress + '명\n';
  text += '미시작: ' + stats.notStarted + '명\n';
  text += '1회 이상 교육 참여율: ' + participationRate + '%\n';
  text += '수료율: ' + completionRate + '%\n';
  if (syncResult) {
    text += '\n[등록 정보 확인 필요]\n';
    text += '등록 시트와 교육 시트의 군/팀 값이 서로 다른 인원: ' +
      syncResult.discrepancies.length + '건\n';
    text += '자동화는 어느 값이 맞는지 판단하지 않고 등록 시트 값을 그대로 유지했습니다.\n';
    text += '실제 소속을 확인하여 잘못된 시트 값을 직접 수정해 주세요.\n';
    text += '중복 전화번호: ' + syncResult.ambiguous.length + '건\n';
    text += '교육 미매칭: ' + syncResult.unmatched.length + '건\n';
  }
  return text;
}

function createCompletionReportHtml_(title, stats, syncResult, groupStats) {
  const participationRate = stats.registered
    ? (stats.participated / stats.registered * 100).toFixed(1)
    : '0.0';
  const completionRate = stats.registered
    ? (stats.completed / stats.registered * 100).toFixed(1)
    : '0.0';
  let html = '<div style="max-width:900px;margin:0 auto;font-family:Malgun Gothic,Arial,sans-serif;color:#1f2937;text-align:center">';
  html += '<h2 style="margin:0 0 16px;color:#111827;text-align:center">' +
    escapeRegistrationHtml_(title) + ' 새가족교육 현황</h2>';
  html += '<table role="presentation" style="width:100%;border-collapse:separate;border-spacing:8px;margin:0 0 22px">';
  html += '<tr>' +
    createCompletionSummaryCell_('등록', stats.registered, '#f3f4f6') +
    createCompletionSummaryCell_('교육 참여', stats.participated, '#dbeafe') +
    createCompletionSummaryCell_('수료', stats.completed, '#dcfce7') +
    createCompletionSummaryCell_('진행 중', stats.inProgress, '#fef3c7') +
    createCompletionSummaryCell_('미시작', stats.notStarted, '#fee2e2') +
    createCompletionSummaryCell_('1회 이상 참여율', participationRate + '%', '#cffafe') +
    createCompletionSummaryCell_('수료율', completionRate + '%', '#ede9fe') +
    '</tr></table>';

  if (groupStats) {
    html += createCompletionGroupSummaryTable_(groupStats);
  }

  const memberCount = stats.members
    ? stats.members.completed.length + stats.members.inProgress.length +
      stats.members.notStarted.length
    : 0;
  if (memberCount > 0) {
    html += createCompletionMemberTable_('수료', '수료일', stats.members.completed, '#166534', '#f0fdf4');
    html += createCompletionMemberTable_('진행 중', '마지막 교육일', stats.members.inProgress, '#92400e', '#fffbeb');
    html += createCompletionMemberTable_('미시작', '등록일', stats.members.notStarted, '#991b1b', '#fef2f2');
  }

  if (syncResult && syncResult.discrepancies.length) {
    html += '<div style="margin-top:28px;padding:16px;background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;text-align:center">';
    html += '<h3 style="margin:0 0 10px;color:#9a3412;text-align:center">등록 정보와 교육 응답이 다른 항목</h3>';
    html += '<p style="margin:0 0 8px;line-height:1.6;text-align:center">아래 인원은 등록 새가족 시트의 군·팀과 교육 출석 시트에 입력된 군·팀이 서로 다릅니다.</p>';
    html += '<p style="margin:0 0 14px;line-height:1.6;text-align:center"><strong>자동화는 등록 정보를 덮어쓰지 않고 기존 등록 값을 유지했습니다.</strong><br>실제 소속을 확인한 뒤 등록 시트 또는 교육 시트 중 잘못된 값을 직접 수정해 주세요.</p>';
    html += '<table style="width:100%;margin:0 auto;border-collapse:collapse;text-align:center;font-size:13px">';
    html += '<thead><tr style="background:#ffedd5">' +
      '<th style="padding:8px;border:1px solid #fdba74;text-align:center">이름</th>' +
      '<th style="padding:8px;border:1px solid #fdba74;text-align:center">확인 항목</th>' +
      '<th style="padding:8px;border:1px solid #fdba74;text-align:center">현재 등록 값(유지됨)</th>' +
      '<th style="padding:8px;border:1px solid #fdba74;text-align:center">교육 시트 입력 값</th>' +
      '</tr></thead><tbody>';
    syncResult.discrepancies.slice(0, 100).forEach(function (item) {
      html += '<tr>' +
        createCompletionTableCell_(item.name, 'center') +
        createCompletionTableCell_(item.field, 'center') +
        createCompletionTableCell_(item.registrationValue || '(빈값)', 'center') +
        createCompletionTableCell_(item.educationValue || '(빈값)', 'center') +
        '</tr>';
    });
    html += '</tbody></table>';
    if (syncResult.discrepancies.length > 100) {
      html += '<p style="margin:10px 0 0;text-align:center">메일에는 처음 100건만 표시했습니다. 전체 내역은 수료 자동화 로그를 확인해 주세요.</p>';
    }
    html += '</div>';
  }
  return html + '</div>';
}

function createCompletionSummaryCell_(label, value, background) {
  return '<td style="padding:12px 8px;text-align:center;background:' + background +
    ';border-radius:8px"><div style="font-size:12px;color:#6b7280">' +
    escapeRegistrationHtml_(label) + '</div><div style="margin-top:4px;font-size:20px;font-weight:700">' +
    escapeRegistrationHtml_(value) + '</div></td>';
}

function createCompletionGroupSummaryTable_(groupStats) {
  let html = '<h3 style="margin:24px 0 8px;color:#1f2937;text-align:center">군별 교육 현황</h3>';
  html += '<table style="width:100%;margin:0 auto;border-collapse:collapse;font-size:13px;text-align:center">';
  html += '<thead><tr style="background:#eef2ff">' +
    '<th style="padding:9px;border:1px solid #c7d2fe;text-align:center">군</th>' +
    '<th style="padding:9px;border:1px solid #c7d2fe;text-align:center">등록</th>' +
    '<th style="padding:9px;border:1px solid #c7d2fe;text-align:center">1회 이상 참여</th>' +
    '<th style="padding:9px;border:1px solid #c7d2fe;text-align:center">참여율</th>' +
    '<th style="padding:9px;border:1px solid #c7d2fe;text-align:center">수료</th>' +
    '<th style="padding:9px;border:1px solid #c7d2fe;text-align:center">진행 중</th>' +
    '<th style="padding:9px;border:1px solid #c7d2fe;text-align:center">미시작</th>' +
    '<th style="padding:9px;border:1px solid #c7d2fe;text-align:center">수료율</th>' +
    '</tr></thead><tbody>';
  Object.keys(REGISTRATION_AUTOMATION.groupRecipients).forEach(function (group) {
    const item = groupStats[group] || createCompletionStats_();
    const participationRate = item.registered
      ? (item.participated / item.registered * 100).toFixed(1) + '%'
      : '0.0%';
    const completionRate = item.registered
      ? (item.completed / item.registered * 100).toFixed(1) + '%'
      : '0.0%';
    html += '<tr>' +
      createCompletionTableCell_(group + '군', 'center') +
      createCompletionTableCell_(item.registered, 'center') +
      createCompletionTableCell_(item.participated, 'center') +
      createCompletionTableCell_(participationRate, 'center') +
      createCompletionTableCell_(item.completed, 'center') +
      createCompletionTableCell_(item.inProgress, 'center') +
      createCompletionTableCell_(item.notStarted, 'center') +
      createCompletionTableCell_(completionRate, 'center') +
      '</tr>';
  });
  return html + '</tbody></table>';
}

function createCompletionMemberTable_(label, dateLabel, members, color, background) {
  let html = '<h3 style="margin:24px 0 8px;color:' + color + ';text-align:center">' +
    escapeRegistrationHtml_(label) + ' (' + members.length + '명)</h3>';
  if (!members.length) {
    return html + '<div style="padding:12px;background:' + background +
      ';border-radius:8px;color:#6b7280;text-align:center">대상자가 없습니다.</div>';
  }

  html += '<table style="width:100%;margin:0 auto;border-collapse:collapse;font-size:13px;text-align:center">';
  html += '<thead><tr style="background:' + background + '">' +
    '<th style="padding:9px;border:1px solid #d1d5db;text-align:center">이름</th>' +
    '<th style="padding:9px;border:1px solid #d1d5db;text-align:center">팀</th>' +
    '<th style="padding:9px;border:1px solid #d1d5db;text-align:center">연락처</th>' +
    '<th style="padding:9px;border:1px solid #d1d5db;text-align:center">' +
    escapeRegistrationHtml_(dateLabel) + '</th></tr></thead><tbody>';
  members.forEach(function (member) {
    html += '<tr>' +
      createCompletionTableCell_(member.name, 'center') +
      createCompletionTableCell_(member.team, 'center') +
      createCompletionTableCell_(member.phone, 'center') +
      createCompletionTableCell_(member.relevantDate, 'center') + '</tr>';
  });
  return html + '</tbody></table>';
}

function createCompletionTableCell_(value, align) {
  return '<td style="padding:8px;border:1px solid #e5e7eb;text-align:' + align + '">' +
    escapeRegistrationHtml_(value) + '</td>';
}

function formatRegistrationPhone_(value) {
  const digits = normalizeRegistrationPhone_(value);
  if (digits.length === 11) {
    return digits.slice(0, 3) + '-' + digits.slice(3, 7) + '-' + digits.slice(7);
  }
  if (digits.length === 10) {
    return digits.slice(0, 3) + '-' + digits.slice(3, 6) + '-' + digits.slice(6);
  }
  return String(value || '').trim();
}

function findLastEducationDate_(weekValues) {
  for (let index = weekValues.length - 1; index >= 0; index--) {
    if (String(weekValues[index] || '').trim() !== '') {
      return formatRegistrationReportDate_(weekValues[index]);
    }
  }
  return '날짜 없음';
}

function formatRegistrationReportDate_(value) {
  if (!value || String(value).trim() === '') return '날짜 없음';
  const parsed = parseRegistrationDate_(value);
  if (parsed) {
    return Utilities.formatDate(parsed, 'Asia/Seoul', 'yyyy-MM-dd');
  }
  return String(value).trim();
}

function writeCompletionLog_(result) {
  const ss = getRegistrationSpreadsheet_();
  const name = '수료 자동화 로그';
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow([
      '실행시각', '모드', '등록', '매칭', '미매칭',
      '중복', '불일치', '출력행'
    ]);
  }
  sheet.appendRow([
    new Date(), REGISTRATION_AUTOMATION.mode,
    result.sync.registrations, result.sync.matched,
    result.sync.unmatched.length, result.sync.ambiguous.length,
    result.sync.discrepancies.length, result.sync.outputRows
  ]);
}
