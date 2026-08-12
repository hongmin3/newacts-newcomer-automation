function generateSettlementReport() {
  let ss = SpreadsheetApp.getActiveSpreadsheet();
  
  // 시트 가져오기
  let sheetSrc = ss.getSheetByName("등록 새가족");
  let sheetBal = ss.getSheetByName("결산");
  
  if (!sheetSrc || !sheetBal) {
    SpreadsheetApp.getUi().alert("Error: '등록 새가족' 또는 '결산' 시트를 찾을 수 없습니다.");
    return;
  }
  
  // 1. 매핑 데이터 정의
  let rowMapping = {
    "아하": 3, "아너스": 4, "명군": 5, "총군": 6, "영군": 7, "석군": 8, "전군": 9, "슬군": 10, "임군": 11
  };
  
  let groupMapping = {
    "신": "아하", "아하": "아하",
    "조": "아너스", "아너스": "아너스",
    "명": "명군", "명군": "명군",
    "총": "총군", "총군": "총군",
    "영": "영군", "영군": "영군",
    "석": "석군", "석군": "석군",
    "전": "전군", "전군": "전군",
    "슬": "슬군", "슬군": "슬군",
    "임": "임군", "임군": "임군"
  };
  
  // 2. 결산 시트의 헤더 정보를 읽어 열(Column) 매핑 생성
  let lastCol = sheetBal.getLastColumn();
  let balData = sheetBal.getRange(1, 1, 12, lastCol).getValues();
  
  let colMapping = {}; // key: "M/D_구분" -> 예: "12/28_일반", "1/4_일반"
  let currentCtxDate = "";
  
  for (let col = 10; col <= lastCol; col++) { // J열(10번째)부터 시작
    let r1Val = balData[0][col - 1]; // 1행 (날짜 데이터 또는 객체)
    let r2Val = balData[1][col - 1].toString().trim(); // 2행 (일반/행축)
    
    if (r1Val !== "") {
      currentCtxDate = normalizeDate(r1Val);
    }
    if (currentCtxDate && r2Val) {
      let key = currentCtxDate + "_" + r2Val;
      colMapping[key] = col;
    }
  }
  
  // 3. 기존 카운팅 데이터 및 결과 데이터 영역 초기화
  for (let r = 2; r < 11; r++) { 
    balData[r][4] = 0;  // E열 (일반결과)
    balData[r][5] = ""; // F열 (일반달성률)
    balData[r][7] = 0;  // H열 (행축결과)
    balData[r][8] = ""; // I열 (행축달성률)
    for (let c = 9; c < lastCol; c++) {
      balData[r][c] = 0; // J열 이후 데이터 초기화
    }
  }
  
  // 4. 등록 새가족 데이터 프로세싱
  let sourceData = sheetSrc.getDataRange().getValues();
  let uncountedRecords = [];
  
  for (let i = 1; i < sourceData.length; i++) {
    let row = sourceData[i];
    let no = row[0];
    if (no === "" || isNaN(no)) continue; // 합계 행이나 빈 행 패스
    
    let rawDate = row[1];  // B열: 날짜
    let rawGroup = row[3]; // D열: 군
    let path = String(row[13]).trim();    // N열: 등록경로
    let name = row[5];     // F열: 새신자 이름
    
    let normDate = normalizeDate(rawDate);
    let normGroup = groupMapping[String(rawGroup).trim()];
    
    if (!normGroup) {
      uncountedRecords.push({ row: i + 1, name: name, reason: "소속 군 미지정 또는 알 수 없는 표기 (" + rawGroup + ")" });
      continue;
    }
    
    // 3월 8일 기점 구분 정의 (보강된 날짜 비교 함수 사용)
    let type = "일반";
    if (!isBeforeMarch8(normDate)) {
      if (path === "관계" || path === "설문지") {
        type = "행축";
      } else {
        type = "일반";
      }
    }
    
    let key = normDate + "_" + type;
    let targetColIndex = colMapping[key];
    let targetRowIndex = rowMapping[normGroup];
    
    if (targetColIndex && targetRowIndex) {
      balData[targetRowIndex - 1][targetColIndex - 1] += 1;
    } else {
      uncountedRecords.push({ row: i + 1, name: name, reason: "결산 시트에서 일치하는 날짜/구분 열을 찾을 수 없음 (" + key + ")" });
    }
  }
  
  // 5. 합계 및 달성률 계산 (E, F, H, I열 및 12행 총합 계산)
  for (let r = 2; r < 11; r++) { 
    let generalSum = 0;
    let happinessSum = 0;
    
    for (let c = 9; c < lastCol; c++) {
      let type = balData[1][c].toString().trim();
      let val = parseInt(balData[r][c], 10) || 0;
      if (type === "일반") generalSum += val;
      if (type === "행축") happinessSum += val;
    }
    
    balData[r][4] = generalSum;  // E열 반영
    balData[r][7] = happinessSum; // H열 반영
    
    let genGoal = parseFloat(balData[r][3]) || 0; // D열 목표
    balData[r][5] = genGoal > 0 ? ((generalSum / genGoal) * 100).toFixed(2) + "%" : "0.00%";
    
    let hapGoal = parseFloat(balData[r][6]) || 0; // G열 목표
    balData[r][8] = hapGoal > 0 ? ((happinessSum / hapGoal) * 100).toFixed(2) + "%" : "0.00%";
  }
  
  // 6. 12행 청년계(세로 총합) 계산
  for (let c = 3; c < lastCol; c++) {
    if (c === 5 || c === 8) continue; 
    let colSum = 0;
    for (let r = 2; r < 11; r++) {
      colSum += parseInt(balData[r][c], 10) || 0;
    }
    balData[11][c] = colSum;
  }
  
  let totalGenGoal = parseFloat(balData[11][3]) || 0;
  let totalGenResult = parseFloat(balData[11][4]) || 0;
  balData[11][5] = totalGenGoal > 0 ? ((totalGenResult / totalGenGoal) * 100).toFixed(2) + "%" : "0.00%";
  
  let totalHapGoal = parseFloat(balData[11][6]) || 0;
  let totalHapResult = parseFloat(balData[11][7]) || 0;
  balData[11][8] = totalHapGoal > 0 ? ((totalHapResult / totalHapGoal) * 100).toFixed(2) + "%" : "0.00%";
  
  // 7. 연산된 데이터를 결산 시트에 반영
  sheetBal.getRange(1, 1, 12, lastCol).setValues(balData);
  
  // 8. 결과 알림 및 로그 출력
  if (uncountedRecords.length > 0) {
    Logger.log("=========================================");
    Logger.log("     [경고] 카운팅되지 않은 새가족 명단     ");
    Logger.log("=========================================");
    uncountedRecords.forEach(function(rec) {
      Logger.log("행 번호: " + rec.row + " | 이름: " + rec.name + " | 사유: " + rec.reason);
    });
    Logger.log("=========================================");
    SpreadsheetApp.getUi().alert("결산 작성이 완료되었으나, 누락된 데이터가 " + uncountedRecords.length + "건 있습니다.\n[Ctrl + Enter]를 눌러 로그를 확인해주세요.");
  } else {
    SpreadsheetApp.getUi().alert("🎉 결산 시트 자동 기입이 완벽하게 완료되었습니다!");
  }
}

// [보강] 날짜 포맷 표준화 함수 (객체/텍스트 완벽 대응 및 12/28 기입 요구사항 충족)
function normalizeDate(val) {
  if (!val) return "";
  
  // 데이터가 구글시트 내부 날짜(Date) 객체인 경우 처리
  if (val instanceof Date) {
    let m = val.getMonth() + 1;
    let d = val.getDate();
    if (m === 12 && d === 28) return "12/28"; // 12/28 고정 매핑
    return m + "/" + d;
  }
  
  let str = val.toString().trim();
  
  // 결산 시트 헤더 "2025.12월" 이거나 텍스트 "12/28" 인 경우 예외 지정
  if (str.includes("2025.12") || str.includes("12/28") || str.includes("12월 28일")) {
    return "12/28";
  }
  
  // 일반 텍스트 문자열인 경우 숫자만 추출 ("1월4일" -> ["1", "4"] -> "1/4")
  let matches = str.match(/\d+/g);
  if (matches && matches.length >= 2) {
    // 만약 첫 숫자가 4자리 연도 포맷인 경우 (예: 2026-01-04) 연도 제외 월/일만 취함
    if (matches[0].length === 4) {
      return parseInt(matches[1], 10) + "/" + parseInt(matches[2], 10);
    }
    return parseInt(matches[0], 10) + "/" + parseInt(matches[1], 10);
  }
  
  return str;
}

// [보강] 안전한 기점 날짜(3월 8일) 판별 보조 함수
function isBeforeMarch8(normDate) {
  let parts = normDate.split("/");
  let m = parseInt(parts[0], 10);
  let d = parseInt(parts[1], 10);
  
  if (m === 12) return true; // 2025년 12월은 당연히 이전
  if (m === 1 || m === 2) return true; // 1월, 2월은 전부 이전
  if (m === 3 && d < 8) return true; // 3월 1일~7일까지는 무조건 이전 (일반 등록 취급)
  
  return false; // 3월 8일 포함 그 이후 날짜
}
