/**
 * 집중교육 출석을 일반 교육 출석 현황에 안전하게 반영합니다.
 * 기존 주차 값은 덮어쓰지 않으며 전화번호가 유일한 경우에만 자동 매칭합니다.
 */
function previewIntensiveTraining() {
  return syncIntensiveTraining_({ dryRun: true });
}
function syncIntensiveTraining() {
  if (!EDUCATION_AUTOMATION.active) {
    console.log('교육 자동화가 비활성 상태라 집중교육을 반영하지 않았습니다.');
    return;
  }
  return withEducationLock_(function () {
    return syncIntensiveTraining_({ dryRun: false });
  });
}

/**
 * 사용자 승인 후 실제 시트 반영 테스트에 사용합니다.
 */
function runIntensiveTrainingTest() {
  return withEducationLock_(function () {
    return syncIntensiveTraining_({ dryRun: false });
  });
}

function syncIntensiveTraining_(options) {
  const ss = SpreadsheetApp.openById(
    EDUCATION_AUTOMATION.masterSpreadsheetId
  );
  const intensiveSheet = ss.getSheetByName('26년 집중교육');
  const attendanceSheet = getEducationMasterSheet_();
  if (!intensiveSheet) throw new Error('26년 집중교육 시트를 찾을 수 없습니다.');

  const intensiveLastRow = intensiveSheet.getLastRow();
  const attendanceLastRow = attendanceSheet.getLastRow();
  const result = {
    scanned: 0,
    added: 0,
    updated: 0,
    conflicts: [],
    dryRun: Boolean(options.dryRun)
  };

  if (intensiveLastRow <= 1) return result;

  const intensiveData = intensiveSheet
    .getRange(2, 1, intensiveLastRow - 1, Math.max(intensiveSheet.getLastColumn(), 6))
    .getValues();
  const attendanceRows = attendanceLastRow > 1
    ? attendanceSheet.getRange(2, 1, attendanceLastRow - 1, 11).getValues()
    : [];

  const phoneIndex = new Map();
  let maxNo = 0;
  attendanceRows.forEach(function (row, index) {
    const no = Number(row[0]);
    if (Number.isFinite(no)) maxNo = Math.max(maxNo, no);
    addIndexValue_(phoneIndex, normalizeEducationPhone_(row[6]), index);
  });

  intensiveData.forEach(function (row, index) {
    if (String(row[5] || '').trim().toUpperCase() !== 'O') return;
    result.scanned += 1;

    const id = String(row[0] || '').trim();
    const group = transformEducationGroup_(row[1]);
    const team = String(row[2] || '').trim();
    const name = String(row[3] || '').trim();
    const phone = formatEducationPhone_(row[4]);
    const phoneKey = normalizeEducationPhone_(phone);
    const quarter = id.split('-')[0];
    const completionText = quarter ? quarter + '분기 집중교육' : '집중교육';

    if (!name || !phoneKey) {
      result.conflicts.push({
        row: index + 2,
        name: name,
        reason: '이름 또는 전화번호 누락'
      });
      return;
    }

    const matches = phoneIndex.get(phoneKey) || [];
    if (matches.length > 1) {
      result.conflicts.push({
        row: index + 2,
        name: name,
        reason: '같은 전화번호가 교육 시트에 여러 행 존재'
      });
      return;
    }

    if (matches.length === 0) {
      maxNo += 1;
      const newRow = [
        maxNo, '', isValidEducationGroup_(group) ? group : '',
        isValidEducationTeam_(team) ? team : '', name, '', phone,
        'O', 'O', 'O', completionText
      ];
      attendanceRows.push(newRow);
      addIndexValue_(phoneIndex, phoneKey, attendanceRows.length - 1);
      result.added += 1;
      return;
    }

    const target = attendanceRows[matches[0]];
    let changed = false;
    for (let column = 7; column <= 9; column++) {
      if (String(target[column] || '').trim() === '') {
        target[column] = 'O';
        changed = true;
      }
    }

    if (String(target[10] || '').trim() === '') {
      target[10] = completionText;
      changed = true;
    } else if (String(target[10]).trim() !== completionText) {
      result.conflicts.push({
        row: index + 2,
        name: name,
        reason: '기존 4주차 값을 보존함: ' + String(target[10])
      });
    }

    if (changed) result.updated += 1;
  });

  if (!options.dryRun && (result.added > 0 || result.updated > 0)) {
    ensureEducationRows_(attendanceSheet, attendanceRows.length + 1);
    attendanceSheet
      .getRange(2, 1, attendanceRows.length, 11)
      .setValues(attendanceRows);
    writeEducationLog_('syncIntensiveTraining', {
      scanned: result.scanned,
      added: result.added,
      updated: result.updated,
      duplicates: [],
      infoChanges: [],
      review: result.conflicts
    });
  }

  console.log(JSON.stringify(result));
  return result;
}
