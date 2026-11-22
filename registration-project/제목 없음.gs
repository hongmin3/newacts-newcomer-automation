/**
 * 상반기 결산 시트를 등록 새가족 데이터로 다시 계산합니다.
 * 실제 탭명인 "상반기 결산"을 사용하며 계산 범위만 갱신합니다.
 */
function previewSettlementReport() {
  return generateSettlementReport_({ dryRun: true });
}
function generateSettlementReport() {
  if (!REGISTRATION_AUTOMATION.active &&
      REGISTRATION_AUTOMATION.mode === 'PRODUCTION') {
    throw new Error('등록 자동화가 비활성 상태입니다.');
  }
  return withRegistrationLock_(function () {
    return generateSettlementReport_({ dryRun: false });
  });
}

function generateSettlementReport_(options) {
  const ss = getRegistrationSpreadsheet_();
  const sourceSheet = ss.getSheetByName(
    REGISTRATION_AUTOMATION.registrationSheetName
  );
  const settlementSheet = ss.getSheetByName('상반기 결산');
  if (!sourceSheet || !settlementSheet) {
    throw new Error('등록 새가족 또는 상반기 결산 시트를 찾을 수 없습니다.');
  }

  const configuration = readRegistrationOrg_();
  const rowMapping = {
    '신': 3, '조': 4, '명': 5, '총': 6, '영': 7,
    '석': 8, '전': 9, '슬': 10, '임': 11
  };
  const lastColumn = settlementSheet.getLastColumn();
  const settlement = settlementSheet
    .getRange(1, 1, 12, lastColumn)
    .getValues();

  const currentRows = new Map();
  if (configuration) {
    for (let row = 2; row < 11; row++) {
      const listed = settlement[row].slice(0, 3).map(function (value) {
        return registrationGroupKey_(value, configuration);
      }).filter(Boolean);
      const group = listed[0];
      if (!group) continue;
      if (listed.some(function (key) { return key !== group; }) || currentRows.has(group)) {
        throw new Error('상반기 결산 시트의 군 행이 중복되거나 서로 다릅니다.');
      }
      currentRows.set(group, row + 1);
    }
  }
  const columnMapping = {};
  let currentDate = '';
  for (let column = 10; column <= lastColumn; column++) {
    const dateValue = settlement[0][column - 1];
    const typeValue = String(settlement[1][column - 1] || '').trim();
    if (dateValue !== '') currentDate = normalizeSettlementDate_(dateValue);
    if (currentDate && typeValue) {
      columnMapping[currentDate + '_' + typeValue] = column;
    }
  }

  for (let row = 2; row < 11; row++) {
    settlement[row][4] = 0;
    settlement[row][5] = '';
    settlement[row][7] = 0;
    settlement[row][8] = '';
    for (let column = 9; column < lastColumn; column++) {
      settlement[row][column] = 0;
    }
  }

  const source = sourceSheet.getDataRange().getValues();
  const review = [];
  let counted = 0;
  let unassigned = 0;
  const groupCounts = new Map();
  const outsideGrid = new Array(lastColumn).fill(0);

  for (let index = 1; index < source.length; index++) {
    const row = source[index];
    if (!row[5]) continue;

    const date = normalizeSettlementDate_(row[1]);
    const group = configuration ? registrationGroupKey_(row[3], configuration) :
      String(row[3] || '').trim().charAt(0);
    const path = String(row[13] || '').trim();
    const targetRow = configuration ? currentRows.get(group) : rowMapping[group];

    let type = '일반';
    if (!isBeforeCampaignStart_(date) &&
        (path === '관계' || path === '설문지')) {
      type = '행축';
    }

    const targetColumn = columnMapping[date + '_' + type];
    if ((!configuration && !targetRow) || !targetColumn) {
      review.push({
        row: index + 1,
        name: String(row[5] || ''),
        reason: !targetColumn
          ? '결산 날짜/구분 열 없음: ' + date + '_' + type
          : '군 매핑 없음'
      });
      continue;
    }

    if (targetRow) {
      settlement[targetRow - 1][targetColumn - 1] =
        (Number(settlement[targetRow - 1][targetColumn - 1]) || 0) + 1;
    } else {
      outsideGrid[targetColumn - 1] += 1;
      outsideGrid[type === '일반' ? 4 : 7] += 1;
    }
    if (configuration) {
      if (!group) unassigned += 1;
      const key = group || '미배정';
      if (!groupCounts.has(key)) groupCounts.set(key, new Array(lastColumn).fill(0));
      groupCounts.get(key)[targetColumn - 1] += 1;
    }
    counted += 1;
  }

  for (let row = 2; row < 11; row++) {
    let general = 0;
    let campaign = 0;
    for (let column = 9; column < lastColumn; column++) {
      const value = Number(settlement[row][column]) || 0;
      const type = String(settlement[1][column] || '').trim();
      if (type === '일반') general += value;
      if (type === '행축') campaign += value;
    }
    settlement[row][4] = general;
    settlement[row][7] = campaign;

    const generalGoal = Number(settlement[row][3]) || 0;
    const campaignGoal = Number(settlement[row][6]) || 0;
    settlement[row][5] = generalGoal ? general / generalGoal : 0;
    settlement[row][8] = campaignGoal ? campaign / campaignGoal : 0;
  }

  for (let column = 3; column < lastColumn; column++) {
    if (column === 5 || column === 8) continue;
    let total = outsideGrid[column];
    for (let row = 2; row < 11; row++) {
      total += Number(settlement[row][column]) || 0;
    }
    settlement[11][column] = total;
  }

  const totalGeneralGoal = Number(settlement[11][3]) || 0;
  const totalCampaignGoal = Number(settlement[11][6]) || 0;
  settlement[11][5] = totalGeneralGoal
    ? Number(settlement[11][4]) / totalGeneralGoal
    : 0;
  settlement[11][8] = totalCampaignGoal
    ? Number(settlement[11][7]) / totalCampaignGoal
    : 0;

  const currentGroupGrid = configuration ?
    prepareSettlementCurrentGroups_(settlementSheet, settlement, configuration, groupCounts) : null;
  if (!options.dryRun) {
    // 머리글, 군 이름과 수동 목표 셀은 보존하고 계산 칸만 씁니다.
    [5, 8, 10].forEach(function (firstColumn) {
      const width = firstColumn === 10 ? lastColumn - 9 : 2;
      if (width > 0) settlementSheet.getRange(3, firstColumn, 10, width).setValues(
        settlement.slice(2).map(function (row) {
          return row.slice(firstColumn - 1, firstColumn - 1 + width);
        })
      );
    });
    [4, 7].forEach(function (goalColumn) {
      settlementSheet.getRange(12, goalColumn).setValue(settlement[11][goalColumn - 1]);
    });
    if (currentGroupGrid) {
      ensureRegistrationRows_(settlementSheet, currentGroupGrid.firstRow + currentGroupGrid.values.length - 1);
      settlementSheet.getRange(currentGroupGrid.firstRow, 1, currentGroupGrid.values.length, lastColumn)
        .setValues(currentGroupGrid.values);
    }
    settlementSheet.getRange(3, 6, 10, 1).setNumberFormat('0.00%');
    settlementSheet.getRange(3, 9, 10, 1).setNumberFormat('0.00%');
  }

  const result = {
    counted: counted,
    review: review,
    unassigned: unassigned,
    dryRun: Boolean(options.dryRun)
  };
  console.log(JSON.stringify(result));
  return result;
}

function prepareSettlementCurrentGroups_(sheet, settlement, configuration, counts) {
  const title = '현재 군 설정 집계';
  const used = sheet.getLastRow();
  const previous = used > 12 ? sheet.getRange(13, 1, used - 12, 2).getValues() : [];
  const old = previous.findIndex(function (row) { return row[0] === title; });
  const firstRow = old < 0 ? Math.max(13, used + 1) : old + 13;
  const oldLength = old < 0 ? 0 : Number(previous[old][1]);
  if (old >= 0 && (!Number.isInteger(oldLength) || oldLength < 3 ||
      !previous[old + 1] || previous[old + 1][0] !== '군' || firstRow + oldLength - 1 > used)) {
    throw new Error('현재 군 결산의 이전 출력 범위를 확인해 주세요.');
  }
  const width = settlement[0].length;
  const groups = configuration.groups.concat([{ key: '미배정', label: '미배정' }]);
  let date = '';
  const dateHeaders = settlement[1].slice(9).map(function (type, index) {
    if (settlement[0][index + 9]) date = normalizeSettlementDate_(settlement[0][index + 9]);
    return date && type ? date + ' ' + type : '';
  });
  const output = [
    [title, groups.length + 2].concat(new Array(width - 2).fill('')),
    ['군', '', '', '', '일반', '', '', '행축', ''].concat(dateHeaders)
  ];
  groups.forEach(function (group) {
    const row = Array.from(counts.get(group.key) || new Array(width).fill(0));
    row[0] = group.label;
    for (let column = 9; column < width; column++) {
      const type = String(settlement[1][column] || '').trim();
      if (type === '일반') row[4] += row[column];
      if (type === '행축') row[7] += row[column];
    }
    [1, 2, 3, 5, 6, 8].forEach(function (column) { row[column] = ''; });
    output.push(row);
  });
  while (output.length < oldLength) output.push(new Array(width).fill(''));
  if (old >= 0 && firstRow + output.length - 1 > firstRow + oldLength - 1 &&
      used > firstRow + oldLength - 1) {
    throw new Error('현재 군 결산의 확장 범위에 다른 자료가 있습니다.');
  }
  return { firstRow: firstRow, values: output };
}

function normalizeSettlementDate_(value) {
  const date = parseRegistrationDate_(value);
  if (date) return Utilities.formatDate(date, 'Asia/Seoul', 'M/d');

  const text = String(value || '').trim();
  const matches = text.match(/\d+/g);
  if (!matches || matches.length < 2) return text;
  if (matches[0].length === 4 && matches.length >= 3) {
    return Number(matches[1]) + '/' + Number(matches[2]);
  }
  return Number(matches[0]) + '/' + Number(matches[1]);
}

function isBeforeCampaignStart_(monthDay) {
  const parts = String(monthDay || '').split('/');
  const month = Number(parts[0]);
  const day = Number(parts[1]);
  if (!month || !day) return true;
  if (month === 12 || month < 3) return true;
  return month === 3 && day < 8;
}
