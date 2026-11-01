function runGroupMoveSmoke(){
 var ss=SpreadsheetApp.getActive();if(ss.getName().indexOf('행축 자동화 검증 전용')!==0)throw Error('검증 전용 파일에서만 실행합니다.');
 var checks=0;function ok(v,label){if(!v)throw Error(label);checks++;}
 function locate(name,id){var sh=eventPlainWrap_(ss).getSheetByName(name),rows=eventData_(sh);return {sheet:sh,row:rows.findIndex(function(r){return r[0]===id;})+2};}
 [false,true].forEach(function(reg){
  var name='기타::'+(reg?'등록':'방문'),sh=eventPlainWrap_(ss).getSheetByName(name),rows=eventData_(sh),at=2;
  while(at<=sh.getMaxRows()&&eventText_((rows[at-2]||[])[5]))at++;
  if(at>sh.getMaxRows())throw Error('시험 빈 입력 칸 없음');
  var physical=sh.physical,r=at+sh.plainMap.offset,range=physical.getRange(r,3,1,4);range.setValues([['군이동검증'+(reg?'등록':'방문'),'여',30,reg?'01044440002':'01044440001']]);onEdit({source:ss,range:range});
  var input=sh.getRange(at,1,1,22).getValues()[0],id=input[0];ok(!!id,'시험 카드 저장');
  physical.getRange(r,9).setValue(reg?'총군':'신');
  eventRepair(true,true);
  var raw=eventData_(ss.getSheetByName(EVENT.raw)).filter(function(x){return x[0]===id;})[0],target=reg?'총군::등록':'신군::방문';
  ok(raw[2]===(reg?'총군':'신군'),'원본 군 반영');ok(eventFind_(eventPlainWrap_(ss).getSheetByName(name),id).length===0,'기타에서 제외');
  ok(eventFind_(eventPlainWrap_(ss).getSheetByName(target),id).length===1,'목적 군에 한 번 표시');
  var total=eventFind_(eventPlainWrap_(ss).getSheetByName(reg?EVENT.registrations:EVENT.visitors),id);ok(total.length===1&&total[0].values[2]===raw[2],'총 명단 군 반영');
  ok(raw[13]===!reg&&raw[14]===reg,'카드 종류 보존');ok(raw[9]===(reg?'010-4444-0002':'010-4444-0001'),'연락처 보존');
  var dest=locate(target,id),clear=dest.sheet.physical.getRange(dest.row+dest.sheet.plainMap.offset,1,1,reg?13:12);clear.clearContent();onEdit({source:ss,range:clear});
 });console.log(JSON.stringify({status:'PASS',checks:checks,path:'기타 군 수정→원본·군별·총 명단 이동'}));
}
