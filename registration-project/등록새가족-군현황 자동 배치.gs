/**
 * ⛪ 새가족 통합 자동화 시스템 (트리거 & 이메일 발송 지원 버전)
 */

// 1. 스프레드시트 상단 메뉴 구성
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('⛪ 새가족 자동화 시스템')
    .addItem('⚡ 전체 자동화 통합 실행 (현황판 + 방문자 동기화)', 'runAllAutomationMenu')
    .addSeparator()
    .addItem('1. 군 현황판만 업데이트', 'updateNewFamilyStatusMenu')
    .addItem('2. 방문자 명단만 동기화 (3/29 이후)', 'syncRegisteredToVisitedMenu')
    .addToUi();
}

// 🖱️ [메뉴 클릭 시 실행] 화면에 알림창을 띄워줍니다.
function runAllAutomationMenu() {
  updateNewFamilyStatus(); 
  const result = syncRegisteredToVisited();
  
  if (result) {
    SpreadsheetApp.getUi().alert(
      "🎉 [전체 통합 자동화] 수동 실행 완료!\n\n" +
      "▶ 현황판 정렬 및 업데이트가 완료되었습니다.\n" +
      "▶ 새로 추가된 인원 (3/29 이후 미방문자): " + result.added + "명\n" +
      "▶ 등록 확인 체크된 인원 (기방문자): " + result.updated + "행"
    );
  }
}

// ⏰ [매주 월요일 트리거 실행용 함수] 알림창 없이 백그라운드에서 실행 후 이메일을 보냅니다.
function runAllAutomationTrigger() {
  updateNewFamilyStatus(); 
  const result = syncRegisteredToVisited();
  
  if (result) {
    sendResultEmail(result.added, result.updated);
  }
}

// 📧 이메일 발송 처리 함수
function sendResultEmail(addedCount, updatedCount) {
  const email = "ksj747172@gmail.com"; // 수신 이메일 주소
  const subject = "[새가족 자동화 시스템] 매주 월요일 정기 실행 결과 보고";
  
  const ssUrl = SpreadsheetApp.getActiveSpreadsheet().getUrl();
  const body = 
    "안녕하세요, 새가족 자동화 시스템 알림입니다.\n\n" +
    "지정된 일정(매주 월요일 오전)에 따라 자동화 스크립트가 성공적으로 수행되었습니다.\n\n" +
    "========= 실행 결과 =========" +
    "\n1. 군 현황판: 최신 데이터 반영 및 정렬 완료" +
    "\n2. 상반기 방문 새가족 시트 동기화 완료" +
    "\n   - 신규 추가 인원 (3/29 이후 미방문자): " + addedCount + "명" +
    "\n   - 등록 여부 체크 인원 (기방문자): " + updatedCount + "행" +
    "\n=============================\n\n" +
    "자세한 사항은 아래 스프레드시트 링크에서 확인해 주세요.\n" +
    ssUrl;
    
  // 구글 메일 서비스를 이용해 메일을 전송합니다.
  MailApp.sendEmail(email, subject, body);
}


/* ==========================================================================
   [개별 메뉴용 연결 함수]
   ========================================================================== */
function updateNewFamilyStatusMenu() {
  updateNewFamilyStatus();
  SpreadsheetApp.getUi().alert("군 현황판 업데이트가 완료되었습니다!");
}

function syncRegisteredToVisitedMenu() {
  const result = syncRegisteredToVisited();
  if (result) {
    SpreadsheetApp.getUi().alert(
      "새가족 명단 동기화 완료!\n\n" +
      "▶ 새로 추가된 인원 (3/29 이후 미방문자): " + result.added + "명\n" +
      "▶ 등록 확인 체크된 인원 (기방문자): " + result.updated + "행"
    );
  }
}


/* ==========================================================================
   [기능 1 Core] 등록 새가족 -> 등록 새가족 군 현황판 업데이트
   ========================================================================== */
function updateNewFamilyStatus() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sourceSheet = ss.getSheetByName("등록 새가족");
  const targetSheet = ss.getSheetByName("등록 새가족 군 현황");

  if (!sourceSheet || !targetSheet) return;

  const sourceData = sourceSheet.getDataRange().getValues();
  const dataRows = sourceData.slice(1);

  const colMap4 = { "신": 1, "조": 2, "명": 3, "총": 4, "영": 5, "석": 6, "전": 7, "슬": 8, "스스로": 9 };
  const colMap5 = { "명": 10, "총": 11, "영": 12, "석": 13, "임": 14, "전": 15, "슬": 16, "스스로": 17 };

  let groupedData = {};

  dataRows.forEach(row => {
    let dateVal = row[1];
    if (!dateVal) return;
    
    let tempDate = (dateVal instanceof Date) ? dateVal : new Date(dateVal);
    let month = tempDate.getMonth() + 1;
    let day = tempDate.getDate();
    let year = (month === 12) ? 2025 : 2026;
    let dateObj = new Date(year, month - 1, day);
    let dateStr = month + "/" + day;
    
    const service = row[2];      
    const groupName = row[3];    
    const name = row[5];         
    const introducer = row[10];  

    if (!groupedData[dateStr]) {
      groupedData[dateStr] = { "4": {}, "5": {}, "total": 0, "sortKey": dateObj.getTime() };
    }
    
    let targetGroup = groupName;
    if (groupName === "군배정필요" || (introducer === "스스로" && (!groupName || groupName === ""))) {
      targetGroup = "스스로";
    }

    let serviceKey = service.toString();
    if (!groupedData[dateStr][serviceKey][targetGroup]) {
      groupedData[dateStr][serviceKey][targetGroup] = [];
    }
    
    groupedData[dateStr][serviceKey][targetGroup].push(name);
    groupedData[dateStr].total++;
  });

  const startRow = 3;
  if (targetSheet.getLastRow() >= startRow) {
    targetSheet.getRange(startRow, 1, targetSheet.getLastRow(), 20)
               .clear()
               .setBackground(null)
               .setFontColor("black")
               .setFontWeight("normal")
               .setHorizontalAlignment("center")
               .setVerticalAlignment("middle");
  }

  const sortedDates = Object.keys(groupedData).sort((a, b) => groupedData[a].sortKey - groupedData[b].sortKey);
  let currentRow = startRow;
  let weekToggle = true;

  sortedDates.forEach(dateStr => {
    const dayData = groupedData[dateStr];
    let maxRowsForDay = 1;
    [dayData["4"], dayData["5"]].forEach(svc => {
      Object.values(svc).forEach(names => maxRowsForDay = Math.max(maxRowsForDay, names.length));
    });

    const bgColor = weekToggle ? "#FFF2CC" : "#FFFFFF";
    targetSheet.getRange(currentRow, 1, maxRowsForDay, 20).setBackground(bgColor);
    
    targetSheet.getRange(currentRow, 1).setValue(dateStr);
    targetSheet.getRange(currentRow, 19).setValue(dayData.total);

    fillServiceData(targetSheet, currentRow, dayData["4"], colMap4);
    fillServiceData(targetSheet, currentRow, dayData["5"], colMap5);

    currentRow += maxRowsForDay;
    weekToggle = !weekToggle;
  });
}

function fillServiceData(sheet, startRow, serviceData, colMap) {
  Object.keys(serviceData).forEach(group => {
    const colIdx = colMap[group];
    if (colIdx) {
      const names = serviceData[group].sort();
      names.forEach((name, i) => {
        sheet.getRange(startRow + i, colIdx + 1).setValue(name);
      });
    }
  });
}


/* ==========================================================================
   [기능 2 Core] 등록 새가족 -> 상반기 방문 새가족 명단 동기화
   ========================================================================== */
/* ==========================================================================
   [기능 2 Core] 등록 새가족 -> 상반기 방문 새가족 명단 동기화
   ========================================================================== */
function syncRegisteredToVisited() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var regSheet = ss.getSheetByName("등록 새가족");
  var visitSheet = ss.getSheetByName("상반기 방문 새가족");
  
  if (!regSheet || !visitSheet) return null;
  
  var visitLastRow = visitSheet.getLastRow();
  var visitData = [];
  var existingKeysMap = new Map(); 
  var maxNo = 0; 
  
  if (visitLastRow > 1) {
    // 💡 수정됨: 15열(O열) -> 14열(N열)까지만 가져오도록 14로 변경
    visitData = visitSheet.getRange(2, 1, visitLastRow - 1, 14).getValues();
    for (var i = 0; i < visitData.length; i++) {
      var gun = visitData[i][3] ? visitData[i][3].toString().trim() : "";  
      var team = visitData[i][4] ? visitData[i][4].toString().trim() : ""; 
      var name = visitData[i][5] ? visitData[i][5].toString().trim() : ""; 
      
      var currentNo = parseInt(visitData[i][0], 10);
      if (!isNaN(currentNo) && currentNo > maxNo) {
        maxNo = currentNo;
      }
      
      if (name) {
        var cleanedName = cleanName(name);
        var key = cleanedName + "|" + gun + "|" + team;
        if (!existingKeysMap.has(key)) {
          existingKeysMap.set(key, []);
        }
        existingKeysMap.get(key).push(i); 
      }
    }
  }
  
  var regLastRow = regSheet.getLastRow();
  if (regLastRow <= 1) return { added: 0, updated: 0 };
  
  var regData = regSheet.getRange(2, 1, regLastRow - 1, 11).getValues();
  var addedCount = 0;
  var updatedCount = 0;
  
  for (var j = 0; j < regData.length; j++) {
    var regDateVal = regData[j][1];
    if (!isAfterOrEqualMarch29(regDateVal)) continue; 
    
    var regGun = regData[j][3] ? regData[j][3].toString().trim() : "";  
    var regTeam = regData[j][4] ? regData[j][4].toString().trim() : ""; 
    var regName = regData[j][5] ? regData[j][5].toString().trim() : ""; 
    
    if (!regName) continue; 
    
    var regCleanedName = cleanName(regName);
    var regKey = regCleanedName + "|" + regGun + "|" + regTeam;
    
    if (existingKeysMap.has(regKey)) {
      var indices = existingKeysMap.get(regKey);
      indices.forEach(function(idx) {
        // 💡 수정됨: 인덱스 14(O열) -> 인덱스 13(N열)로 변경
        if (visitData[idx][13] !== "O") {
          visitData[idx][13] = "O";
          updatedCount++;
        }
      });
    } else {
      // 💡 수정됨: 배열 칸 수를 15 -> 14로 변경
      var newRow = new Array(14).fill("");
      
      maxNo++;
      newRow[0] = maxNo;
      
      // B~K열 복사 (이 부분은 열 삭제와 무관하게 동일합니다)
      for (var k = 1; k <= 10; k++) {
        newRow[k] = regData[j][k];
      }
      
      // 💡 수정됨: 인덱스 14(O열) -> 인덱스 13(N열)에 "O" 체크
      newRow[13] = "O"; 
      
      visitData.push(newRow);
      addedCount++;
      
      existingKeysMap.set(regKey, [visitData.length - 1]);
    }
  }
  
  if (visitData.length > 0) {
    // 💡 수정됨: 15열(O열) -> 14열(N열)까지만 덮어쓰도록 14로 변경
    visitSheet.getRange(2, 1, visitData.length, 14).setValues(visitData);
  }
  
  return { added: addedCount, updated: updatedCount };
}

function cleanName(name) {
  if (!name) return "";
  return name.toString().trim().replace(/[A-Z]$/, "").trim();
}

function isAfterOrEqualMarch29(dateVal) {
  if (!dateVal) return false;
  var dateObj;
  if (dateVal instanceof Date) {
    dateObj = dateVal;
  } else {
    var str = dateVal.toString().trim();
    if (!str) return false;
    if (str.includes('/')) {
      var parts = str.split('/');
      var month = parseInt(parts[0], 10);
      var day = parseInt(parts[1], 10);
      if (isNaN(month) || isNaN(day)) return false;
      var year = (month === 12) ? 2025 : 2026;
      dateObj = new Date(year, month - 1, day);
    } else if (str.includes('월')) {
      var matches = str.match(/(\d+)월\s*(\d+)일/);
      if (matches) {
        var month = parseInt(matches[1], 10);
        var day = parseInt(matches[2], 10);
        var year = (month === 12) ? 2025 : 2026;
        dateObj = new Date(year, month - 1, day);
      } else { return false; }
    } else {
      dateObj = new Date(str);
      if (dateObj.getFullYear() < 2026 && !str.includes('202')) { dateObj.setFullYear(2026); }
    }
  }
  if (isNaN(dateObj.getTime())) return false;
  var targetDate = new Date(2026, 2, 29);
  var compareDate = new Date(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate());
  return compareDate >= targetDate;
}
