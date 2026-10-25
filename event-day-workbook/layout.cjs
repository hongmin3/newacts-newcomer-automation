'use strict';
/** 새 이벤트 파일 전용 Sheets batchUpdate 구성. 원본 파일에는 적용하지 않는다. */
const fs=require('node:fs'),vm=require('node:vm');
const ctx={};vm.runInNewContext(fs.readFileSync(__dirname+'/Code.gs','utf8'),ctx);
const E=ctx.EVENT;
const IDs={summary:2000,guide:2001,raw:2100,log:2101,conflicts:2102};
const views=[{name:E.visitors,id:100,table:'EventVisitors'},{name:E.registrations,id:101,table:'EventRegistrations'},...E.groups.map((name,i)=>({name,id:110+i,table:'EventGroup'+i}))];
const cell=v=>({userEnteredValue:typeof v==='boolean'?{boolValue:v}:typeof v==='number'?{numberValue:v}:String(v).startsWith('=')?{formulaValue:v}:{stringValue:String(v)}});
const block=(id,row,col,rows)=>({updateCells:{start:{sheetId:id,rowIndex:row,columnIndex:col},rows:rows.map(r=>({values:r.map(cell)})),fields:'userEnteredValue'}});
function build(oldSheets=[]){
 const req=[];
 const sheets=[{name:'행사 현황',id:IDs.summary,rows:60,cols:8},{name:'사용 안내',id:IDs.guide,rows:60,cols:3},...views.map(v=>({...v,rows:1001,cols:22})),{name:E.raw,id:IDs.raw,rows:5001,cols:22},{name:E.log,id:IDs.log,rows:5001,cols:7},{name:E.conflicts,id:IDs.conflicts,rows:1001,cols:6}];
 // 임시 이름으로 생성하여 복사본의 동명 탭과 충돌하지 않게 한다.
 sheets.forEach(s=>req.push({addSheet:{properties:{sheetId:s.id,title:'NEW_'+s.name,gridProperties:{rowCount:s.rows,columnCount:s.cols,frozenRowCount:1,hideGridlines:false}}}}));
 oldSheets.forEach(s=>req.push({deleteSheet:{sheetId:s.properties.sheetId}}));
 sheets.forEach(s=>req.push({updateSheetProperties:{properties:{sheetId:s.id,title:s.name,hidden:s.name.startsWith('_')},fields:'title,hidden'}}));
 req.push({updateSpreadsheetProperties:{properties:{locale:'ko_KR',timeZone:'Asia/Seoul'},fields:'locale,timeZone'}});
 sheets.forEach(s=>req.push({repeatCell:{range:{sheetId:s.id,startRowIndex:0,endRowIndex:1},cell:{userEnteredFormat:{backgroundColor:{red:.91,green:.92,blue:.94},textFormat:{bold:true,fontSize:10,foregroundColor:{red:0,green:0,blue:0}},wrapStrategy:'WRAP',verticalAlignment:'MIDDLE'}},fields:'userEnteredFormat'}}));
 views.forEach(v=>{
  req.push(block(v.id,0,0,[E.headers]));
  req.push({updateDimensionProperties:{range:{sheetId:v.id,dimension:'ROWS',startIndex:0,endIndex:1},properties:{pixelSize:36},fields:'pixelSize'}});
  const widths=[90,105,75,85,85,105,60,55,100,130,190,100,80,65,65,65,120,180,230,155,60,80];
  widths.forEach((w,i)=>req.push({updateDimensionProperties:{range:{sheetId:v.id,dimension:'COLUMNS',startIndex:i,endIndex:i+1},properties:{pixelSize:w},fields:'pixelSize'}}));
  [0,20,21].forEach(i=>req.push({updateDimensionProperties:{range:{sheetId:v.id,dimension:'COLUMNS',startIndex:i,endIndex:i+1},properties:{hiddenByUser:true},fields:'hiddenByUser'}}));
  req.push({repeatCell:{range:{sheetId:v.id,startRowIndex:1,endRowIndex:1001,startColumnIndex:1,endColumnIndex:18},cell:{userEnteredFormat:{numberFormat:{type:'TEXT'},verticalAlignment:'MIDDLE'}},fields:'userEnteredFormat'}});
  const props=E.headers.map((h,i)=>({columnIndex:i,columnName:h,columnType:[13,14,15].includes(i)?'BOOLEAN':[7,20].includes(i)?'DOUBLE':'TEXT'}));
  props[2]={columnIndex:2,columnName:E.headers[2],columnType:'DROPDOWN',dataValidationRule:{condition:{type:'ONE_OF_LIST',values:E.groups.map(userEnteredValue=>({userEnteredValue}))}}};
  props[6]={columnIndex:6,columnName:E.headers[6],columnType:'DROPDOWN',dataValidationRule:{condition:{type:'ONE_OF_LIST',values:['남','여'].map(userEnteredValue=>({userEnteredValue}))}}};
  req.push({addTable:{table:{name:v.table,rowsProperties:{headerColorStyle:{rgbColor:{red:.91,green:.92,blue:.94}},firstBandColorStyle:{rgbColor:{red:1,green:1,blue:1}},secondBandColorStyle:{rgbColor:{red:1,green:1,blue:1}}},range:{sheetId:v.id,startRowIndex:0,endRowIndex:1001,startColumnIndex:0,endColumnIndex:22},columnProperties:props}}});
  req.push({addProtectedRange:{protectedRange:{range:{sheetId:v.id,startRowIndex:0,endRowIndex:1},warningOnly:true,description:'1행 머리글은 자동 연결에 사용합니다.'}}});
  req.push({addConditionalFormatRule:{index:0,rule:{ranges:[{sheetId:v.id,startRowIndex:1,endRowIndex:1001,startColumnIndex:18,endColumnIndex:19}],booleanRule:{condition:{type:'CUSTOM_FORMULA',values:[{userEnteredValue:'=AND($S2<>"",$S2<>"정상")'}]},format:{backgroundColor:{red:1,green:.93,blue:.8}}}}}});
 });
 [0,1,2,3,4,5,6,8,9,10,11,12,16,17,18,19].forEach(i=>req.push({repeatCell:{range:{sheetId:IDs.raw,startRowIndex:1,startColumnIndex:i,endColumnIndex:i+1},cell:{userEnteredFormat:{numberFormat:{type:'TEXT'}}},fields:'userEnteredFormat.numberFormat'}}));
 req.push(block(IDs.raw,0,0,[[...E.headers.slice(0,21),'취소여부']]));
 req.push(block(IDs.log,0,0,[['시각','동작','입력 탭','관리번호','변경 전','변경 후','상세']]));
 req.push(block(IDs.conflicts,0,0,[['시각','입력 탭','행','관리번호','충돌 항목','처리상태']]));
 req.push(block(IDs.summary,0,0,[['2026년 11월 1일 행축 방문·등록 현황']]));
 req.push(block(IDs.summary,1,0,[['집계 기준','11월 1일 당일 / 관리번호별 인원 / 취소 제외']]));
 req.push(block(IDs.summary,3,0,[['군','방문 인원','등록 인원','미등록 방문','등록 비율','연락처 확인']]));
 E.groups.forEach((g,i)=>{
   const r=i+5;
   req.push(block(IDs.summary,r-1,0,[[g,
    `=COUNTIFS('_원본'!C2:C,A${r},'_원본'!N2:N,TRUE,'_원본'!V2:V,FALSE)`,
    `=COUNTIFS('_원본'!C2:C,A${r},'_원본'!O2:O,TRUE,'_원본'!V2:V,FALSE)`,
    `=B${r}-C${r}`,`=IFERROR(C${r}/B${r},0)`,
    `=COUNTIFS('_원본'!C2:C,A${r},'_원본'!F2:F,"<>",'_원본'!J2:J,"",'_원본'!V2:V,FALSE)`
   ]]));
 });
 req.push(block(IDs.summary,14,0,[['합계','=SUM(B5:B14)','=SUM(C5:C14)','=SUM(D5:D14)','=IFERROR(C15/B15,0)','=SUM(F5:F14)']]));
 req.push(block(IDs.summary,17,0,[['방문과 등록','등록자는 방문 명단에도 남습니다. 방문·등록 인원을 더하면 같은 사람이 두 번 포함됩니다.'],['동명이인','이름과 전화번호가 모두 같을 때만 같은 사람으로 연결합니다. 전화번호가 없으면 따로 기록합니다.'],['집계 제외','취소한 기록은 제외됩니다. 군이 비면 기타로 기록합니다.'],['입력 위치','총 방문 새가족·총 등록 새가족 또는 각 군 탭의 2행부터 입력하세요.']]));
 req.push({repeatCell:{range:{sheetId:IDs.summary,startRowIndex:4,endRowIndex:15,startColumnIndex:4,endColumnIndex:5},cell:{userEnteredFormat:{numberFormat:{type:'PERCENT',pattern:'0.0%'}}},fields:'userEnteredFormat.numberFormat'}});
 req.push({updateDimensionProperties:{range:{sheetId:IDs.summary,dimension:'COLUMNS',startIndex:0,endIndex:6},properties:{pixelSize:125},fields:'pixelSize'}});
 req.push({mergeCells:{range:{sheetId:IDs.summary,startRowIndex:0,endRowIndex:1,startColumnIndex:0,endColumnIndex:6},mergeType:'MERGE_ALL'}});
 [1,17,18,19,20].forEach(r=>req.push({mergeCells:{range:{sheetId:IDs.summary,startRowIndex:r,endRowIndex:r+1,startColumnIndex:1,endColumnIndex:6},mergeType:'MERGE_ALL'}}));
 req.push({repeatCell:{range:{sheetId:IDs.summary,startRowIndex:17,endRowIndex:21,startColumnIndex:1,endColumnIndex:6},cell:{userEnteredFormat:{wrapStrategy:'WRAP'}},fields:'userEnteredFormat.wrapStrategy'}});
 req.push({updateDimensionProperties:{range:{sheetId:IDs.summary,dimension:'ROWS',startIndex:17,endIndex:21},properties:{pixelSize:42},fields:'pixelSize'}});
 const guide=[['항목','사용 방법'],['연결 상태','설정 중: 완료 전 입력하지 마세요.'],['행사일','2026-11-01 하루 전용입니다. 날짜는 비워도 자동 입력됩니다.'],['처음 입력','총 방문·총 등록 또는 각 군 탭의 2행부터 이름과 연락처를 입력하세요. 이름을 적으면 자동 연결됩니다.'],['1행 머리글','1행은 고정되어 있습니다. 열 제목·열 순서·관리번호는 바꾸지 마세요.'],['군 선택','군별 탭에서는 해당 군이 자동 선택됩니다. 전체 명단에서 군을 비우면 기타가 됩니다.'],['방문과 등록','등록 체크 시 방문 체크도 유지됩니다. 등록 해제 후에도 방문 이력은 남습니다.'],['동일인 연결','이름과 전화번호가 모두 같으면 기존 사람에 연결합니다. 동명이인은 이름만으로 합치지 않습니다.'],['연락처 없는 경우','입력할 수 있지만 확인사항에 연락처 확인이 표시됩니다. 다음 입력 때 자동으로 같은 사람으로 합치지 않습니다.'],['여러 행 입력','B:R 입력 열만 붙여넣으세요. 관리번호가 있는 전체 행을 다른 위치에 복사하지 마세요.'],['자동 연결 대기','일반적으로 몇 초 내 반영됩니다. 확인사항에 대기·중단이 보이거나 명단이 맞지 않으면 행축 명단 → 전체 다시 맞추기를 실행하세요.'],['수정 충돌','확인사항에 충돌이 뜨면 저장값을 보존합니다. 해당 행에서 입력 적용 또는 저장값 복원을 선택하세요.'],['군 변경','군 열을 새 군으로 바꾸면 새 군 탭으로 이동합니다. 기존 탭에 대기 입력이 있으면 먼저 처리하세요.'],['기록 취소','행을 지우지 말고 행축 명단 → 선택 기록 취소를 사용하세요. 마지막 취소 복구로 되돌릴 수 있습니다.'],['행 직접 삭제','행 삭제는 원본 취소가 아닙니다. 다시 맞추기를 하면 원본에서 화면을 복구합니다.'],['집계','행사 현황은 관리번호별 인원입니다. 등록자는 방문 인원에도 포함되므로 방문+등록을 총 인원으로 쓰지 마세요.'],['개인정보와 공유','담당자만 공유하세요. 군별 탭은 접근 권한을 분리하지 않습니다. 편집자는 다른 군과 숨김 원본도 열 수 있습니다.'],['다른 자동화','기존 등록·교육·메일 자동화와 별도로 동작합니다. 기존 자동화의 결과는 이 파일로 자동 가져오지 않습니다.'],['복구 기록','숨겨진 원본·변경기록·충돌 탭은 지우지 마세요. 이 파일을 복사할 때는 입력 전 연결 동작을 다시 확인하세요.'],['행사 전 점검','담당자 계정과 휴대폰에서 가상 인물 1명으로 입력→등록 체크→군 변경을 확인하고 취소하세요.']];
 req.push(block(IDs.guide,0,0,guide));
 req.push({updateDimensionProperties:{range:{sheetId:IDs.guide,dimension:'COLUMNS',startIndex:0,endIndex:1},properties:{pixelSize:155},fields:'pixelSize'}});
 req.push({updateDimensionProperties:{range:{sheetId:IDs.guide,dimension:'COLUMNS',startIndex:1,endIndex:2},properties:{pixelSize:720},fields:'pixelSize'}});
 req.push({repeatCell:{range:{sheetId:IDs.guide,startRowIndex:1,endRowIndex:guide.length,startColumnIndex:0,endColumnIndex:2},cell:{userEnteredFormat:{wrapStrategy:'WRAP',verticalAlignment:'MIDDLE'}},fields:'userEnteredFormat'}});
 req.push({updateDimensionProperties:{range:{sheetId:IDs.guide,dimension:'ROWS',startIndex:1,endIndex:guide.length},properties:{pixelSize:50},fields:'pixelSize'}});
 req.push({addProtectedRange:{protectedRange:{range:{sheetId:IDs.summary},warningOnly:true,description:'집계 수식입니다. 명단 탭에서 입력하세요.'}}});
 return req;
}
module.exports={build,views,IDs};
if(require.main===module){const old=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));process.stdout.write(JSON.stringify(build(old.sheets)));}
