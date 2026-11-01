/** 가상 명단 전용 파일에서만 운영 진입점을 실제 Sheets와 함께 실행한다. */
function runIsolatedIntegration() {
  var ss=SpreadsheetApp.getActive();
  if(ss.getName().indexOf('행축 자동화 검증 전용')!==0)throw new Error('운영 파일에서 실행할 수 없습니다.');
  resetIsolatedIntegration();
  ss.getSheetByName(EVENT.visitors).getRange(2,20).setFormula('=1+1');
  var checks=0;
  function ok(value,label){if(!value)throw new Error('검증 실패: '+label);checks++;}
  function edit(name,row,col,matrix){var range=ss.getSheetByName(name).getRange(row,col,matrix.length,matrix[0].length);range.setValues(matrix);onEdit({source:ss,range:range});}
  function pending(){PropertiesService.getScriptProperties().setProperty('EVENT_SYNC_DIRTY',Utilities.getUuid());eventAutoSync();}
  function active(){return eventData_(ss.getSheetByName(EVENT.raw)).filter(function(r){return !r[21];});}
  function verify(){var wrapped=eventPlainWrap_(ss),raw=active();eventViews_().forEach(function(name){var sh=wrapped.getSheetByName(name),data=eventData_(sh).filter(function(r){return !!r[0];}),expected=raw.filter(function(r){return eventMember_(r,name);});ok(data.length===expected.length,name+' 인원');ok(new Set(data.map(function(r){return r[0];})).size===data.length,name+' 중복');data.forEach(function(r){ok(expected.some(function(x){return x[0]===r[0];}),name+' 연결');});});SpreadsheetApp.flush();ok(ss.getSheetByName(EVENT.visitors).getRange(1,16).getValues()[0][0]===raw.filter(function(r){return r[13];}).length,'방문 집계');ok(ss.getSheetByName(EVENT.registrations).getRange(1,16).getValues()[0][0]===raw.filter(function(r){return r[14];}).length,'등록 집계');}
  // 편집 이벤트가 모두 누락된 10개 군 입력을 추가 입력 없이 복구한다.
  EVENT.groups.forEach(function(g,i){ss.getSheetByName(g).getRange(3,3,1,4).setValues([['가상검증'+i,'여',30,'0102222'+('0000'+i).slice(-4)]]);});
  pending();ok(active().length===10,'10군 방문 입력 복구');verify();ok(ss.getSheetByName(EVENT.visitors).getRange(2,20).getFormula()==='=1+1','명단 밖 수식 보존');console.log('실제 Sheets 10군 입력·전체 연결 통과');
  EVENT.groups.slice(0,5).forEach(function(g,i){ss.getSheetByName(g).getRange(27,3,1,4).setValues([['가상검증'+i,'여',30,'0102222'+('0000'+i).slice(-4)]]);});
  pending();ok(active().length===10,'방문과 등록 동일인 연결');ok(active().filter(function(r){return r[14];}).length===5,'등록 인원');verify();
  edit(EVENT.groups[5],3,3,[['']]);ok(active().length===9,'방문 이름 삭제');verify();
  edit(EVENT.groups[0],27,3,[['']]);ok(active().filter(function(r){return r[14];}).length===4,'등록 해제');ok(active().length===8,'등록 삭제가 방문에도 전파');verify();
  edit(EVENT.groups[1],3,3,[['']]);ok(active().length===7,'방문 삭제가 등록에도 전파');verify();
  edit(EVENT.groups[0],27,3,[['가상등록전용','여',30,'']]);
  ok(active().filter(function(r){return r[13];}).length===7,'등록 단독 입력은 방문을 만들지 않음');verify();
  EVENT.registrationRoutes.forEach(function(route,i){
    if(i%2){var list=eventData_(eventPlainWrap_(ss).getSheetByName(EVENT.registrations)),at=list.findIndex(function(r){return r[5]==='가상등록전용';})+2;edit(EVENT.registrations,at,13,[[route]]);}else edit(EVENT.groups[0],27,13,[[route]]);
    ok(ss.getSheetByName(EVENT.groups[0]).getRange(27,13).getValues()[0][0]===route,'등록경로 양방향 연결');
  });
  var validation=ss.getSheetByName(EVENT.groups[0]).getRange(27,13).getDataValidation();
  ok(validation.getCriteriaValues()[0].join('|')==='직접방문|설문지|관계|교인인도','실제 선택 목록');
  ok(validation.getAllowInvalid()===false,'목록 외 입력 제한');
  // 실제 원본 쓰기를 마친 다음 오류를 던져 응답 유실을 재현한다.
  var originalWrap=eventPlainWrap_,fired=false;
  eventPlainWrap_=function(real){var wrapped=originalWrap(real),get=wrapped.getSheetByName;wrapped.getSheetByName=function(name){var sh=get(name);if(name!==EVENT.raw)return sh;return {getName:function(){return sh.getName();},getLastRow:function(){return sh.getLastRow();},getRange:function(a,b,c,d){return sh.getRange(a,b,c,d);},appendRow:function(row){sh.appendRow(row);if(!fired){fired=true;throw new Error('시험: 원본 저장 후 응답 유실');}}};};return wrapped;};
  try{edit('슬군',4,3,[['가상무전화응답유실']]);}finally{eventPlainWrap_=originalWrap;}
  pending();ok(fired,'실제 원본 쓰기 후 오류 도달');ok(active().filter(function(r){return r[5]==='가상무전화응답유실';}).length===1,'무전화 재시도 중복 없음');verify();
  // 같은 사람의 소속이 다르면 별도 기록과 양쪽 경고를 보존한다.
  edit('명군',4,3,[['가상소속중복','남',30,'01033330000']]);
  edit('석군',4,3,[['가상소속중복','남',30,'01033330000']]);
  pending();var duplicates=active().filter(function(r){return r[5]==='가상소속중복';});
  ok(duplicates.length===2&&duplicates[0][0]!==duplicates[1][0],'소속별 두 기록 보존');
  ['명군','석군'].forEach(function(g){ok(/동일인 중복/.test(ss.getSheetByName(g).getRange(4,3).getNote()),g+' 중복 메모');});
  eventViews_().forEach(function(name){var sh=eventPlainWrap_(ss).getSheetByName(name),map=sh.plainMap,tag='EVENT_DUPLICATE_'+(map.registered?'REG':'VISIT');ok(sh.physical.getConditionalFormatRules().some(function(rule){var condition=rule.getBooleanCondition();return condition&&condition.getCriteriaValues().some(function(v){return String(v).indexOf(tag)>=0;});}),name+' 중복 강조 규칙');});verify();
  var result={checks:checks,groups:10,visitors:active().filter(function(r){return r[13];}).length,registrations:active().filter(function(r){return r[14];}).length,status:'PASS'};
  ss.insertSheet('검증 결과').getRange(1,1,1,2).setValues([['결과',JSON.stringify(result)]]);
  console.log(JSON.stringify(result));
}

function resetIsolatedIntegration(){
  var ss=SpreadsheetApp.getActive();if(ss.getName().indexOf('행축 자동화 검증 전용')!==0)throw new Error('운영 파일에서는 실행할 수 없습니다.');
  [EVENT.visitors,EVENT.registrations,EVENT.raw,EVENT.log,EVENT.conflicts].forEach(function(name){var sh=ss.getSheetByName(name);sh.getRange(2,1,sh.getMaxRows()-1,32).clearContent().clearNote();});
  EVENT.groups.forEach(function(g){var sh=ss.getSheetByName(g);['VISIT','REG'].forEach(function(kind){var r=ss.getRangeByName('_EVENT_'+sh.getSheetId()+'_'+kind);sh.getRange(r.getRow(),1,r.getNumRows(),32).clearContent().clearNote();});});
  var result=ss.getSheetByName('검증 결과');if(result)ss.deleteSheet(result);
  ss.getSheetByName(EVENT.visitors).getRange(1,16).setFormula("=COUNTIFS('_원본'!N2:N,TRUE,'_원본'!V2:V,FALSE)");
  ss.getSheetByName(EVENT.registrations).getRange(1,16).setFormula("=COUNTIFS('_원본'!O2:O,TRUE,'_원본'!V2:V,FALSE)");
  EVENT.groups.forEach(function(g){var sh=ss.getSheetByName(g);['VISIT','REG'].forEach(function(kind){var r=ss.getRangeByName('_EVENT_'+sh.getSheetId()+'_'+kind),flag=kind==='REG'?'O':'N';sh.getRange(r.getLastRow()+1,kind==='REG'?13:12).setFormula("=COUNTIFS('_원본'!C2:C,\""+g+"\",'_원본'!"+flag+"2:"+flag+",TRUE,'_원본'!V2:V,FALSE)");});});
  PropertiesService.getScriptProperties().deleteAllProperties();
}
