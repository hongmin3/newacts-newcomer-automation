'use strict';
const fs=require('node:fs'),vm=require('node:vm'),ctx={};vm.runInNewContext(fs.readFileSync(__dirname+'/Code.gs','utf8'),ctx);
const E=ctx.EVENT,IDs={raw:4100,log:4101,conflicts:4102};
const views=[{name:E.visitors,id:300,registered:false},{name:E.registrations,id:301,registered:true},...E.groups.map((name,i)=>({name,id:310+i,group:true}))];
const headers=['순번','예배(부)','방문자 이름','성별','나이(생년월일)','휴대폰','주소','전도자','군','팀','순','비고'];
const registeredHeaders=headers.map((h,i)=>i===2?'등록자 이름':h).concat(['등록경로']);
const cell=v=>({userEnteredValue:typeof v==='number'?{numberValue:v}:String(v).startsWith('=')?{formulaValue:v}:{stringValue:String(v)}});
const block=(sheetId,rowIndex,columnIndex,rows)=>({updateCells:{start:{sheetId,rowIndex,columnIndex},rows:rows.map(r=>({values:r.map(cell)})),fields:'userEnteredValue'}});
function build(oldSheets=[]){
 const req=[],all=[...views,{name:E.raw,id:IDs.raw},{name:E.log,id:IDs.log},{name:E.conflicts,id:IDs.conflicts}];
 all.forEach(s=>req.push({addSheet:{properties:{sheetId:s.id,title:'NEW_'+s.name,gridProperties:{rowCount:s.id>=4100?5001:1001,columnCount:32,frozenRowCount:1}}}}));
 oldSheets.forEach(s=>req.push({deleteSheet:{sheetId:s.properties.sheetId}}));
 all.forEach(s=>req.push({updateSheetProperties:{properties:{sheetId:s.id,title:s.name,hidden:s.name.startsWith('_')},fields:'title,hidden'}}));
 req.push({updateSpreadsheetProperties:{properties:{locale:'ko_KR',timeZone:'Asia/Seoul'},fields:'locale,timeZone'}});
 const style=require('./reference-style.json');
 const styles=arr=>arr.slice(0,11).concat([arr[12]||arr[11]||{}]);
 const fmt=(id,row,formats)=>req.push({updateCells:{start:{sheetId:id,rowIndex:row,columnIndex:0},rows:[{values:formats.map(userEnteredFormat=>({userEnteredFormat}))}],fields:'userEnteredFormat'}});
 views.forEach(s=>{
  const areas=s.group?[{title:0,header:1,start:2,end:22,footer:22,registered:false},{title:24,header:25,start:26,end:36,footer:36,registered:true}]:[{header:0,start:1,end:1001,registered:s.registered}];
  req.push({updateSheetProperties:{properties:{sheetId:s.id,gridProperties:{frozenRowCount:s.group?2:1}},fields:'gridProperties.frozenRowCount'}});
  areas.forEach(a=>{
   const hs=(a.registered?registeredHeaders:headers).map((h,i)=>i===2?'이 름':i===4?(s.group?'나이':'나이(생년월일)'):h);
   req.push(block(s.id,a.header,0,[hs]));
   var fs=styles(s.group?style.header:(a.registered?style.totalRegistrationHeader:style.totalVisitorHeader));if(a.registered)fs.push(style.header[12]||style.header[11]||{});fmt(s.id,a.header,fs);
   const bs=styles(style.body);if(a.registered)bs.push(style.body[12]||{});
   bs.forEach((f,i)=>req.push({repeatCell:{range:{sheetId:s.id,startRowIndex:a.start,endRowIndex:a.end,startColumnIndex:i,endColumnIndex:i+1},cell:{userEnteredFormat:{...f,numberFormat:{type:'TEXT'}}},fields:'userEnteredFormat'}}));
   if(s.group){
    req.push({updateDimensionProperties:{range:{sheetId:s.id,dimension:'ROWS',startIndex:a.start,endIndex:a.end},properties:{pixelSize:18},fields:'pixelSize'}});
    req.push(block(s.id,a.title,0,[[`행축 ${s.name} ${a.registered?'등록자':'방문자'} 명단`]]));
    req.push({mergeCells:{range:{sheetId:s.id,startRowIndex:a.title,endRowIndex:a.title+1,startColumnIndex:0,endColumnIndex:10},mergeType:'MERGE_ALL'}});
    req.push({repeatCell:{range:{sheetId:s.id,startRowIndex:a.title,endRowIndex:a.title+1,startColumnIndex:0,endColumnIndex:10},cell:{userEnteredFormat:style.title},fields:'userEnteredFormat'}});
    const footerCol=a.registered?11:10;
    req.push(block(s.id,a.footer,footerCol,[['계',`=COUNTIFS('_원본'!C2:C,"${s.name}",'_원본'!${a.registered?'O':'N'}2:${a.registered?'O':'N'},TRUE,'_원본'!V2:V,FALSE)`]]));
    req.push({repeatCell:{range:{sheetId:s.id,startRowIndex:a.footer,endRowIndex:a.footer+1,startColumnIndex:footerCol,endColumnIndex:footerCol+2},cell:{userEnteredFormat:style.header[0]},fields:'userEnteredFormat'}});
    req.push({addNamedRange:{namedRange:{name:`_EVENT_${s.id}_${a.registered?'REG':'VISIT'}`,range:{sheetId:s.id,startRowIndex:a.start,endRowIndex:a.end,startColumnIndex:0,endColumnIndex:hs.length}}}});
    req.push({updateDimensionProperties:{range:{sheetId:s.id,dimension:'ROWS',startIndex:a.title,endIndex:a.title+1},properties:{pixelSize:28},fields:'pixelSize'}});
   }else req.push(block(s.id,0,14,[[s.registered?'총 등록자':'총 방문자',`=COUNTIFS('_원본'!${s.registered?'O':'N'}2:${s.registered?'O':'N'},TRUE,'_원본'!V2:V,FALSE)`]]));
  });
  if(s.group)req.push({updateDimensionProperties:{range:{sheetId:s.id,dimension:'ROWS',startIndex:23,endIndex:24},properties:{pixelSize:10},fields:'pixelSize'}});
  [45,100,85,47,100,125,180,85,80,75,65,130,110].forEach((w,i)=>req.push({updateDimensionProperties:{range:{sheetId:s.id,dimension:'COLUMNS',startIndex:i,endIndex:i+1},properties:{pixelSize:w},fields:'pixelSize'}}));
  req.push({updateDimensionProperties:{range:{sheetId:s.id,dimension:'COLUMNS',startIndex:28,endIndex:32},properties:{hiddenByUser:true},fields:'hiddenByUser'}});
  req.push(block(s.id,0,28,[['방문 관리번호','방문 비교값','등록 관리번호','등록 비교값']]));
 });
 req.push(block(IDs.raw,0,0,[[...E.headers.slice(0,21),'취소여부']]));
 [0,1,2,3,4,5,6,7,8,9,10,11,12,16,17,18,19].forEach(i=>req.push({repeatCell:{range:{sheetId:IDs.raw,startRowIndex:1,startColumnIndex:i,endColumnIndex:i+1},cell:{userEnteredFormat:{numberFormat:{type:'TEXT'}}},fields:'userEnteredFormat.numberFormat'}}));
 req.push(block(IDs.log,0,0,[['시각','동작','입력 명단','관리번호','변경 전','변경 후','상세']]));
 req.push(block(IDs.conflicts,0,0,[['시각','입력 명단','행','관리번호','충돌 내용','상태']]));
 return req;
}
module.exports={build,views,IDs,headers,registeredHeaders};
