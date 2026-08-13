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

  const rowMapping = {
    '신': 3, '조': 4, '명': 5, '총': 6, '영': 7,
    '석': 8, '전': 9, '슬': 10, '임': 11
  };
  const lastColumn = settlementSheet.getLastColumn();
  const settlement = settlementSheet
    .getRange(1, 1, 12, lastColumn)
    .getValues();

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

  for (let index = 1; index < source.length; index++) {
    const row = source[index];
    if (!row[5]) continue;

    const date = normalizeSettlementDate_(row[1]);
    const group = String(row[3] || '').trim().charAt(0);
    const path = String(row[13] || '').trim();
    const targetRow = rowMapping[group];

    let type = '일반';
    if (!isBeforeCampaignStart_(date) &&
        (path === '관계' || path === '설문지')) {
      type = '행축';
    }

    const targetColumn = columnMapping[date + '_' + type];
    if (!targetRow || !targetColumn) {
      review.push({
        row: index + 1,
        name: String(row[5] || ''),
        reason: !targetRow
          ? '군 매핑 없음'
          : '결산 날짜/구분 열 없음: ' + date + '_' + type
      });
      continue;
    }

    settlement[targetRow - 1][targetColumn - 1] =
      (Number(settlement[targetRow - 1][targetColumn - 1]) || 0) + 1;
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
    let total = 0;
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

  if (!options.dryRun) {
    settlementSheet
      .getRange(1, 1, 12, lastColumn)
      .setValues(settlement);
    settlementSheet.getRange(3, 6, 10, 1).setNumberFormat('0.00%');
    settlementSheet.getRange(3, 9, 10, 1).setNumberFormat('0.00%');
  }

  const result = {
    counted: counted,
    review: review,
    dryRun: Boolean(options.dryRun)
  };
  console.log(JSON.stringify(result));
  return result;
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
