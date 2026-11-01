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
  pending();ok(active().length===15,'방문과 등록 별도 카드 기록');ok(active().filter(function(r){return r[14];}).length===5,'등록 인원');verify();
  edit(EVENT.groups[5],3,1,[Array(13).fill('')]);ok(active().length===14,'방문 이름 삭제');verify();
  edit(EVENT.groups[0],27,1,[Array(13).fill('')]);ok(active().filter(function(r){return r[14];}).length===4,'등록 해제');ok(active().length===13,'등록 삭제가 방문에 전파되지 않음');verify();
  edit(EVENT.groups[1],3,1,[Array(13).fill('')]);ok(active().length===12,'방문 삭제가 등록에 전파되지 않음');verify();
  edit(EVENT.groups[0],27,3,[['가상등록전용','여',30,'']]);
  ok(active().filter(function(r){return r[13];}).length===8,'등록 단독 입력은 방문을 만들지 않음');verify();
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
  // 이전 버전의 한 번호에 묶인 두 카드와 대기 입력도 실제 Sheets에서 분리한다.
  edit('기타',4,3,[['가상기존카드분리','남',30,'01033330001']]);
  var legacy=active().filter(function(r){return r[5]==='가상기존카드분리';})[0],rawRows=eventData_(ss.getSheetByName(EVENT.raw)),legacyRow=rawRows.findIndex(function(r){return r[0]===legacy[0];})+2;
  legacy[14]=true;ss.getSheetByName(EVENT.raw).getRange(legacyRow,1,1,22).setValues([legacy]);eventProject_(eventPlainWrap_(ss),legacy,'','*');
  ss.getSheetByName('기타').getRange(27,7).setValue('분리중 대기 주소');pending();
  var split=active().filter(function(r){return r[5]==='가상기존카드분리';});ok(split.length===2,'기존 카드 분리');ok(split.every(function(r){return !(r[13]&&r[14]);}),'카드 종류 분리');ok(split.filter(function(r){return r[14];})[0][10]==='분리중 대기 주소','기존 카드 대기 입력 보존');
  edit('기타',4,1,[Array(13).fill('')]);ok(active().filter(function(r){return r[5]==='가상기존카드분리'&&r[14];}).length===1,'방문 제외 후 등록 카드 유지');verify();
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

/** 전체 통합 검증 뒤 최종 코드의 실제 편집·안내 경로를 한 번 더 실행한다. */
function runIndependentCardSmoke(){
  var ss=SpreadsheetApp.getActive();if(ss.getName().indexOf('행축 자동화 검증 전용')!==0)throw new Error('검증 전용 파일에서만 실행합니다.');
  var checks=0;function ok(v,label){if(!v)throw new Error('검증 실패: '+label);checks++;}
  function edit(r,c,v){var range=ss.getSheetByName('신군').getRange(r,c,v.length,v[0].length);range.setValues(v);onEdit({source:ss,range:range});}
  ok(!ss.getSheetByName('신군').getRange(5,3).getValue()&&!ss.getSheetByName('신군').getRange(28,3).getValue(),'시험 입력 칸 비어 있음');
  edit(5,3,[['가상최종별개카드','여',30,'01033330002']]);edit(28,3,[['가상최종별개카드','여',30,'01033330002']]);eventRepair(true);
  var records=eventData_(ss.getSheetByName(EVENT.raw)).filter(function(r){return r[5]==='가상최종별개카드'&&!r[21];});
  ok(records.length===2&&records[0][0]!==records[1][0],'별도 관리번호');ok(records.filter(function(r){return r[13]&&!r[14];}).length===1,'방문 카드 한 건');ok(records.filter(function(r){return r[14]&&!r[13];}).length===1,'등록 카드 한 건');
  ok(/방문·등록 각각 입력됨/.test(ss.getSheetByName('신군').getRange(5,3).getNote()),'방문 중복 입력 안내');ok(/방문·등록 각각 입력됨/.test(ss.getSheetByName('신군').getRange(28,3).getNote()),'등록 중복 입력 안내');
  edit(28,7,[['등록 카드 전용 주소']]);ok(ss.getSheetByName('신군').getRange(5,7).getValue()==='','등록 수정이 방문에 전파되지 않음');
  edit(5,1,[Array(13).fill('')]);ok(ss.getSheetByName('신군').getRange(28,3).getValue()==='가상최종별개카드','방문 삭제 후 등록 유지');
  console.log(JSON.stringify({status:'PASS',checks:checks,path:'최종 코드 카드별 실제 입력·수정·삭제'}));
}
function runHardeningSmoke(){
 var ss=SpreadsheetApp.getActive();if(ss.getName().indexOf('행축 자동화 검증 전용')!==0)throw Error('검증 전용');resetIsolatedIntegration();var sh=ss.getSheetByName('기타'),region=ss.getRangeByName('_EVENT_'+sh.getSheetId()+'_REG'),start=region.getRow(),n=region.getNumRows()+2,checks=0;
 function ok(v){if(!v)throw Error('보강 검증 실패 '+checks);checks++;}
 function edit(row,col,values){var r=sh.getRange(row,col,values.length,values[0].length);r.setValues(values);onEdit({source:ss,range:r});}
 edit(start,3,Array.from({length:n},function(_,i){return ['보강가상'+i,'여',30,'0105555'+String(1000+i)];}));eventRepair(true);ok(eventData_(ss.getSheetByName(EVENT.raw)).filter(function(r){return !r[21];}).length===n);
 edit(start,3,[['']]);ok(eventData_(ss.getSheetByName(EVENT.raw)).filter(function(r){return !r[21];}).length===n);edit(start,3,[['수정완료']]);ok(sh.getRange(start,6).getValue()==='010-5555-1000');
 edit(start,1,[Array(13).fill('')]);ok(eventData_(ss.getSheetByName(EVENT.raw)).filter(function(r){return !r[21];}).length===n-1);
 sh.getRange(start+1,13).clearDataValidations();eventRepair(true);ok(!!sh.getRange(start+1,13).getDataValidation());
 SpreadsheetApp.flush();var result={status:'PASS',checks:checks,bulk:n};ss.insertSheet('검증 결과').getRange(1,1,1,2).setValues([['보강 검증',JSON.stringify(result)]]);console.log(JSON.stringify(result));
}

/** 운영 자료 없는 전용 파일에서 표시·기타 이동을 확인한다. 기존 시험 행은 보존한다. */
function runStatusDisplaySmoke(){
 var ss=SpreadsheetApp.getActive();if(ss.getName().indexOf('행축 자동화 검증 전용')!==0)throw Error('검증 전용 파일에서만 실행합니다.');
 var checks=0,sh=ss.getSheetByName(EVENT.visitors),wrapped=eventPlainWrap_(ss),r=Math.max(2,eventData_(wrapped.getSheetByName(EVENT.visitors)).length+2);
 function ok(v,label){if(!v)throw Error('표시 검증 실패: '+label);checks++;}
 function edit(c,v){var range=sh.getRange(r,c);range.setValue(v);onEdit({source:ss,range:range,value:v});}
 edit(3,'표시검증가상'+r);edit(9,'명');var id=sh.getRange(r,29).getValue();
 edit(9,'없는군');ok(sh.getRange(r,3).getFontColor()==='#b45309','오류 글자색');ok(sh.getRange(r,9).getValue()==='없는군','오류 입력 보존');
 edit(9,'명');ok(sh.getRange(r,3).getFontColor()==='#000000','오류 해결');
 var noteCell=sh.getRange(r,3);eventStatusNote_(noteCell,'충돌: 팀 (저장값: 가 / 입력: 나)');ok(noteCell.getFontColor()==='#c5221f','충돌 글자색');
 var before=JSON.stringify(sh.getRange(r,1,1,32).getValues());eventRefreshStatusDisplay();ok(JSON.stringify(sh.getRange(r,1,1,32).getValues())===before,'표시 실행 입력값 보존');
 eventStatusNote_(noteCell,'다른 입력 처리 대기: 자동으로 다시 반영합니다.');ok(noteCell.getFontColor()==='#1967d2','대기 글자색');eventStatusNote_(noteCell,'정상');
 var groupView=eventPlainWrap_(ss).getSheetByName('명군::방문'),groupRow=eventFind_(groupView,id)[0].row+groupView.plainMap.offset,groupRange=ss.getSheetByName('명군').getRange(groupRow,9);
 groupRange.setValue('');onEdit({source:ss,range:groupRange,value:''});
 ok(eventData_(ss.getSheetByName(EVENT.raw)).filter(function(x){return x[0]===id;})[0][2]==='명군','군별 기존 입력 빈칸은 해당 군');
 edit(9,'');var record=eventData_(ss.getSheetByName(EVENT.raw)).filter(function(x){return x[0]===id;})[0];ok(record[2]==='기타','빈 군 기타 이동');ok(eventFind_(eventPlainWrap_(ss).getSheetByName('기타::방문'),id).length===1,'기타 화면 연결');
 ok(sh.getRange(1,3).getNote().indexOf('[입력 상태 색상]')>=0,'머리글 안내');
 console.log(JSON.stringify({status:'PASS',checks:checks,path:'상태 표시·입력 보존·기타 이동'}));
}

function runStatusConflictSmoke(){
 var ss=SpreadsheetApp.getActive();if(ss.getName().indexOf('행축 자동화 검증 전용')!==0)throw Error('검증 전용 파일에서만 실행합니다.');
 var checks=0,sh=ss.getSheetByName(EVENT.visitors),r=Math.max(2,eventData_(eventPlainWrap_(ss).getSheetByName(EVENT.visitors)).length+2);
 function ok(v,label){if(!v)throw Error('충돌 검증 실패: '+label);checks++;}
 function edit(sheet,row,col,value){var range=sheet.getRange(row,col);range.setValue(value);onEdit({source:ss,range:range,value:value});}
 edit(sh,r,3,'충돌표시가상'+r);edit(sh,r,9,'신');var id=sh.getRange(r,29).getValue(),view=eventPlainWrap_(ss).getSheetByName('신군::방문'),g=ss.getSheetByName('신군'),gr=eventFind_(view,id)[0].row+view.plainMap.offset;
 g.getRange(gr,10).setValue('확인전팀');edit(sh,r,10,'저장팀');edit(g,gr,10,'확인전팀');
 ok(/^충돌:/.test(g.getRange(gr,3).getNote()),'충돌 생성');ok(g.getRange(gr,3).getFontColor()==='#c5221f','빨간 충돌 글씨');
 edit(g,gr,7,'별도로 입력한 주소');
 var record=eventData_(ss.getSheetByName(EVENT.raw)).filter(function(x){return x[0]===id;})[0];
 ok(record[3]==='저장팀','다른 칸 수정으로 충돌 미확정');ok(record[10]==='별도로 입력한 주소','주소 수정 반영');ok(g.getRange(gr,10).getValue()==='확인전팀','대기 입력 보존');ok(/^충돌:/.test(g.getRange(gr,3).getNote()),'충돌 표시 유지');
 edit(g,gr,10,'확인전팀');ok(g.getRange(gr,3).getFontColor()==='#000000','확인 후 기본색');
 console.log(JSON.stringify({status:'PASS',checks:checks,path:'충돌 두 값 보존·다른 칸 수정·확인 후 해제'}));
}
