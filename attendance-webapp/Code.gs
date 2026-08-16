function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
      .setTitle('새가족 교육 출석체크')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function searchUser(name, phone) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0]; 
  const data = sheet.getDataRange().getValues();
  
  let latestRecord = null;
  let maxWeek = 0;
  const cleanPhone = phone.replace(/-/g, '').trim();

  for (let i = 1; i < data.length; i++) {
    const rowName = String(data[i][4]).trim();
    const rowPhone = String(data[i][5]).replace(/-/g, '').trim();
    
    if (rowName === name.trim() && rowPhone === cleanPhone) {
      const weekStr = String(data[i][2]); 
      const weekNum = parseInt(weekStr.replace(/[^0-9]/g, '')) || 1;
      
      if (weekNum > maxWeek) {
        maxWeek = weekNum;
        latestRecord = {
          name: rowName,
          phone: String(data[i][5]), 
          gender: data[i][6],
          age: data[i][7],
          gun: data[i][8],
          team: data[i][9],
          week: weekNum
        };
      }
    }
  }
  return latestRecord; 
}

function submitAttendance(formData) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
  
  // ★ 수정된 부분: 타임스탬프에 시간(HH:mm:ss) 추가
  const timestamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy. MM. dd HH:mm:ss");
  const consent = "위와 같이 개인정보를 수집·이용하는 것에 동의합니다.";
  const weekStr = formData.week + "주차";
  const route = formData.week === 1 ? formData.route : ""; 
  
  const newRow = [
    timestamp,
    consent,
    weekStr,
    route,
    formData.name,
    formData.phone,
    formData.gender,
    formData.age,
    formData.gun,
    formData.team
  ];

  // 1행(헤더) 바로 아래인 2행에 빈 줄을 하나 만들고 데이터를 넣습니다.
  sheet.insertRowAfter(1);
  sheet.getRange(2, 1, 1, newRow.length).setValues([newRow]);
  
  return formData.week;
}
