/** @OnlyCurrentDoc */
/** 2026-11-01 당일 파일 전용. 기존 등록/메일 프로젝트와 분리된 container-bound script. */
var EVENT = Object.freeze({date:'2026-11-01', firstRow:2, width:22,
  registrationRoutes:['직접방문','설문지','관계','교인인도'],
  groups:['신군','조군','명군','총군','영군','석군','전군','임군','슬군','기타'],
  visitors:'총 방문 새가족', registrations:'총 등록 새가족', raw:'_원본', log:'_변경기록', conflicts:'_충돌',
  headers:['관리번호','날짜','군','팀','순','이름','성별','나이','생년월일','휴대폰','주소','인도자','예배(부)','방문','등록','결신','등록경로','비고','확인사항','수정시각','버전','화면 비교값']});

function onOpen() { try { eventRepair(true); } catch (err) { console.log('명단 연결 확인: '+err.message); } }
function eventGroup_(name) { var g=String(name).split('::')[0];return EVENT.groups.indexOf(g)>=0?g:''; }
function eventRegisteredView_(name){return name===EVENT.registrations||/::등록$/.test(name);}
function eventGroupViews_(g){return g?[g+'::방문',g+'::등록']:[];}
function eventViews_() { var a=[EVENT.visitors,EVENT.registrations];EVENT.groups.forEach(function(g){a=a.concat(eventGroupViews_(g));});return a; }
function eventIsView_(name) { return eventViews_().indexOf(name)>=0; }
function eventText_(v) { return v===null||v===undefined?'':String(v).trim(); }
function eventEqual_(a,b) { return eventText_(a)===eventText_(b); }
function eventStoredGroup_(v){var s=eventText_(v);return EVENT.groups.indexOf(s+'군')>=0?s+'군':s;}
function eventDisplayGroup_(v){var s=eventText_(v);return EVENT.groups.indexOf(s)>=0?s.replace(/군$/,''):s;}

function eventBool_(v) {
  if(v===true||v===1||/^(TRUE|O|○|예|Y|1)$/i.test(eventText_(v)))return true;
  if(v===false||v===0||/^(FALSE|X|아니오|N|0|)$/i.test(eventText_(v)))return false;
  throw new Error('방문·등록·결신은 체크박스로 입력해 주세요.');
}
function eventDate_(v) {
  if(v instanceof Date && !isNaN(v.getTime()))return Utilities.formatDate(v,'Asia/Seoul','yyyy-MM-dd');
  if(typeof v==='number')return new Date(Math.round((v-25569)*86400000)).toISOString().slice(0,10);
  var s=eventText_(v).replace(/\./g,'-').replace(/\//g,'-');
  if(/^(11-0?1|2026-11-0?1)$/.test(s))return EVENT.date;
  return s;
}
function eventPhone_(v) {
  var s=eventText_(v);if(!s)return '';
  var p=s.replace(/[\s()+.-]/g,'').replace(/^\+?82/,'0');
  if(/^1[016789]\d{7,8}$/.test(p))p='0'+p;
  if(!/^0\d{8,10}$/.test(p))throw new Error('휴대전화번호는 숫자 9~11자리로 입력해 주세요.');
  return p.length===11?p.replace(/^(\d{3})(\d{4})(\d{4})$/,'$1-$2-$3'):p;
}
function eventKey_(row) {
  var p=eventText_(row[9]).replace(/\D/g,'');
  return row[5]&&p?eventText_(row[5]).replace(/\s/g,'')+'|'+p:'';
}
/** 충돌 항목은 저장값을 유지한다. 서로 다른 항목의 변경은 합친다. */
function eventApplyPatch_(canonical, baseline, patch, source, force) {
  var row=canonical.slice(), conflicts=[];
  Object.keys(patch).forEach(function(k){
    var col=Number(k);if(col<1||col>17)return;
    var v=patch[k];
    if(col===1){v=eventDate_(v)||EVENT.date;if(v!==EVENT.date)throw new Error('이 시트는 2026년 11월 1일 행사 전용입니다.');}
    else if(col===2){v=eventText_(v)|| (eventGroup_(source)||'기타');if(v!=='기타'&&!/군$/.test(v))v+='군';if(EVENT.groups.indexOf(v)<0)throw new Error('군은 목록에서 선택해 주세요.');}
    else if(col===9)v=eventPhone_(v);
    else if(col===16){v=eventText_(v);if(v&&EVENT.registrationRoutes.indexOf(v)<0)throw new Error('등록경로는 직접방문·설문지·관계·교인인도 중 하나를 선택해 주세요.');}
    else if(col>=13&&col<=15)v=eventBool_(v);
    else if(col===7){if(v!==''&&v!==null){var ageText=eventText_(v);if(/^-/.test(ageText))throw new Error('나이·생년월일을 확인해 주세요.');v=/^\d{1,3}$/.test(ageText)&&Number(ageText)<=120?Number(ageText):ageText;}else v='';}
    else if(col===8){v=eventText_(v);if(v){var birth=v.replace(/[-./]/g,'');if(!/^\d{8}$/.test(birth))throw new Error('생년월일은 YYYYMMDD로 입력해 주세요.');var y=+birth.slice(0,4),m=+birth.slice(4,6),d=+birth.slice(6,8),date=new Date(Date.UTC(y,m-1,d));if(date.getUTCFullYear()!==y||date.getUTCMonth()+1!==m||date.getUTCDate()!==d||birth>'20261101'||y<1900)throw new Error('생년월일 날짜를 확인해 주세요.');v=birth;}}
    else {v=eventText_(v);if(v.length>2000)throw new Error('한 칸은 2,000자 이내로 입력해 주세요.');if(col===6&&v&&['남','여'].indexOf(v)<0)throw new Error('성별은 남·여 또는 빈칸으로 입력해 주세요.');}
    if(!force&&baseline&&!eventEqual_(baseline[col],canonical[col])&&!eventEqual_(v,canonical[col]))conflicts.push({column:col,base:baseline[col],stored:canonical[col],input:v});
    else row[col]=v;
  });
  if(!eventText_(row[5]))throw new Error('이름은 비울 수 없습니다. 기록 취소는 행축 명단 메뉴를 사용해 주세요.');
  row[1]=row[1]||EVENT.date;row[2]=row[2]||'기타';

  return {row:row,conflicts:conflicts};
}
/** 화면에 아직 처리하지 않은 입력이 있으면 그 칸과 이전 비교값을 보존한다. */
function eventProjection_(current, baseline, desired) {
  var values=current.slice(),base=baseline.slice(),pending=false;
  for(var c=0;c<21;c++){
    if(c>=1&&c<=17&&!eventEqual_(current[c],baseline[c])&&!eventEqual_(current[c],desired[c])){pending=true;continue;}
    values[c]=desired[c];base[c]=desired[c];
  }
  if(pending)values[18]='다른 입력 처리 대기: 자동으로 다시 반영합니다.';
  values[21]=JSON.stringify(base.slice(0,21));
  return {values:values,baseline:base,pending:pending};
}
function eventData_(sheet) {
  var n=sheet.getLastRow()-1,data=n>0?sheet.getRange(2,1,n,EVENT.width).getValues():[];
  // Google 테이블의 빈 체크박스 false는 사용된 행으로 세지 않는다.
  while(data.length&&!data[data.length-1].some(function(v){return v!==''&&v!==false&&v!==null&&v!==undefined;}))data.pop();
  data.forEach(function(row){[13,14,15].forEach(function(c){if(row[c]!==''&&row[c]!==undefined)row[c]=eventBool_(row[c]);});if(sheet.getName()===EVENT.raw&&row[21]!==''&&row[21]!==undefined)row[21]=eventBool_(row[21]);if(row[1])row[1]=eventDate_(row[1]);if(row[8] instanceof Date)row[8]=Utilities.formatDate(row[8],'Asia/Seoul','yyyyMMdd');if(row[19] instanceof Date)row[19]=Utilities.formatDate(row[19],'Asia/Seoul','yyyy-MM-dd HH:mm:ss');});
  return data;
}
function eventBaseline_(row) {
  if(!row[21]||typeof row[21]!=='string')return null;
  try{var b=JSON.parse(row[21]);return Array.isArray(b)&&b.length===21?b:null;}catch(e){return null;}
}
function eventNow_(){return Utilities.formatDate(new Date(),'Asia/Seoul','yyyy-MM-dd HH:mm:ss');}
function eventSafeValues_(row){return row.map(function(v){return typeof v==='string'&&/^[=+@]/.test(v)?"'"+v:v;});}
function eventWrite_(range,values){range.setValues(values.map(eventSafeValues_));}
function eventAudit_(ss,kind,source,before,after,detail){
  ss.getSheetByName(EVENT.log).appendRow([eventNow_(),kind,source,(after||before||[])[0]||'',JSON.stringify(before||[]),JSON.stringify(after||[]),detail||'']);
}
function eventHealth_(row,records){
  var notes=[];if(!row[9])notes.push('연락처 확인: 중복·방문/등록 동일인 확인 필요');
  var key=eventKey_(row),phone=eventText_(row[9]).replace(/\D/g,''),name=eventText_(row[5]).replace(/\s/g,'');
  records.forEach(function(other){if(other[0]===row[0]||other[21])return;
    if(!((row[13]&&other[13])||(row[14]&&other[14]))){if(key&&key===eventKey_(other))notes.push('방문·등록 각각 입력됨');return;}
    if(phone&&phone===eventText_(other[9]).replace(/\D/g,''))notes.push(key===eventKey_(other)?'동일인 중복 확인':'같은 전화번호의 다른 이름 확인');
    else if(name===eventText_(other[5]).replace(/\s/g,''))notes.push('동명이인 확인');
  });
  return Array.from(new Set(notes)).join(' / ')||'정상';
}
function eventHasDirty_(row){var base=eventBaseline_(row);return !!base&&row.slice(1,18).some(function(v,i){return !eventEqual_(v,base[i+1]);});}
function eventMember_(row,name){if(row[21])return false;if(name===EVENT.visitors)return !!row[13];if(name===EVENT.registrations)return !!row[14];return row[2]===eventGroup_(name)&&(eventRegisteredView_(name)?!!row[14]:!!row[13]);}
function eventFind_(sheet,id){
  var data=eventData_(sheet),matches=[];data.forEach(function(r,i){if(r[0]===id)matches.push({row:i+2,values:r});});return matches;
}
function eventProject_(ss,record,oldGroup,sourceName,cache,onlyNames) {
  var names=(onlyNames||(sourceName==='*'?eventViews_():[EVENT.visitors,EVENT.registrations].concat(eventGroupViews_(record[2]),eventGroupViews_(oldGroup),[sourceName]))).filter(function(n,i,a){return eventIsView_(n)&&a.indexOf(n)===i;});
  names.forEach(function(name){
    var sheet=ss.getSheetByName(name);if(!sheet)throw new Error('필수 탭이 없습니다: '+name);
    var matches=cache?(cache[name].byId[record[0]]||[]):eventFind_(sheet,record[0]);
    if(cache){matches=matches.map(function(item){return {row:item.row,values:sheet.getRange(item.row,1,1,EVENT.width).getValues()[0]};});if(matches.some(function(item){return item.values[0]!==record[0];}))matches=eventFind_(sheet,record[0]);}
    if(matches.length>1)throw new Error(name+': 관리번호가 복사되었습니다. 입력 내용을 확인해 주세요.');
    if(!eventMember_(record,name)){
      matches.forEach(function(item){
        if(sheet.getRange(item.row,1).getValues()[0][0]!==record[0])return;
        if(eventHasDirty_(item.values)){if(record[21])eventAudit_(ss,'취소 전 대기 입력 보관',name,item.values,record,'화면에서 제외하기 전 입력값을 보관함');else {sheet.getRange(item.row,19).setValue('군 변경 전 입력 확인');return;}}
        sheet.getRange(item.row,1,1,EVENT.width).clearContent();
      });return;
    }
    if(!matches.length){var dest=cache?cache[name].nextRow:Math.max(2,eventData_(sheet).length+2);
      while(dest<=sheet.getMaxRows()&&sheet.getRange(dest,1,1,EVENT.width).getValues()[0].some(function(v){return v!==''&&v!==false&&v!==null&&v!==undefined;}))dest++;
      if(dest>sheet.getMaxRows())sheet.insertRowsAfter(sheet.getMaxRows(),100);
      var full=record.slice(0,21);full[21]=JSON.stringify(record.slice(0,21));eventWrite_(sheet.getRange(dest,1,1,EVENT.width),[full]);if(cache){cache[name].byId[record[0]]=[{row:dest,values:full}];cache[name].nextRow=dest+1;}return;}
    var item=matches[0],baseline=eventBaseline_(item.values);
    if(!baseline){sheet.getRange(item.row,19).setValue('화면 비교값 손상: 입력 확인 필요');return;}
    var p=eventProjection_(item.values,baseline,record);
    // 쓰기 직전 다시 읽어 중간에 입력된 값을 항목별로 보존한다.
    var fresh=sheet.getRange(item.row,1,1,EVENT.width).getValues()[0];
    if(fresh[0]!==record[0])return;
    for(var c=1;c<=17;c++)if(!eventEqual_(fresh[c],item.values[c])){p.values[c]=fresh[c];p.baseline[c]=baseline[c];p.pending=true;}
    if(p.pending)p.values[18]='다른 입력 처리 대기: 자동으로 다시 반영합니다.';
    if(/^충돌:/.test(eventText_(fresh[18])))p.values[18]=fresh[18];
    p.values[21]=JSON.stringify(p.baseline.slice(0,21));
    // 입력 열은 실제로 갱신이 필요한 칸만 쓴다. 대기 중인 다른 칸은 쓰지 않는다.
    for(var j=0;j<EVENT.width;j++)if(!eventEqual_(fresh[j],p.values[j])){if(sheet.getRange(item.row,1).getValues()[0][0]!==record[0])return;eventWrite_(sheet.getRange(item.row,j+1,1,1),[[p.values[j]]]);}
  });
}
function eventProcessRow_(ss,sheet,rowNumber,columns,oneValue,force) {
  var raw=ss.getSheetByName(EVENT.raw),records=eventData_(raw),input=sheet.getRange(rowNumber,1,1,EVENT.width).getValues()[0],base=eventBaseline_(input),isNew=!input[0];
  if(isNew&&!eventText_(input[5])){sheet.getRange(rowNumber,19).setValue('이름 입력 후 자동 연결');return;}
  var mergedFrom=null;
  var existingIndex=records.findIndex(function(r){return r[0]===input[0];}),candidate,patch={};
  var reserved=!isNew&&existingIndex<0&&base&&base[0]===input[0]&&Number(base[20])===0;
  if(!isNew&&existingIndex<0&&!reserved){sheet.getRange(rowNumber,19).setValue('관리번호 확인 필요: 새 기록은 관리번호를 붙여넣지 마세요.');return;}
  if(!isNew&&!base){sheet.getRange(rowNumber,19).setValue('화면 비교값 손상: 입력 확인 필요');return;}
  if(!isNew&&eventFind_(sheet,input[0]).length>1&&!/^충돌:/.test(eventText_(input[18]))){sheet.getRange(rowNumber,19).setValue('관리번호 중복: 전체 행 복사를 하지 마세요.');return;}
  if(reserved)isNew=true;
  if(!isNew){
    var inputIdentity=eventKey_(input),storedIdentity=eventKey_(records[existingIndex]),sameKind=eventRegisteredView_(sheet.getName())?14:13;
    if(base&&eventText_(base[5])&&eventText_(base[9])&&!eventEqual_(input[5],base[5])&&String(input[9]||'').replace(/\D/g,'')!==String(base[9]||'').replace(/\D/g,''))throw new Error('이름과 휴대폰이 함께 바뀌어 관리번호 연결 확인이 필요합니다. 입력 내용과 기존 원본을 보존했습니다.');
    if(inputIdentity&&inputIdentity!==storedIdentity&&records.some(function(r){return !r[21]&&r[sameKind]&&r[0]!==input[0]&&eventKey_(r)===inputIdentity;}))throw new Error('이름·휴대폰이 다른 관리번호의 기존 카드와 일치합니다. 입력 셀만 이동했는지 확인해 주세요. 기존 원본을 보존했습니다.');
  }
  if(isNew){
    candidate=Array(EVENT.width).fill('');candidate[0]=reserved?input[0]:Utilities.getUuid();candidate[1]=EVENT.date;candidate[2]=eventGroup_(sheet.getName())||'기타';candidate[13]=!eventRegisteredView_(sheet.getName());candidate[14]=eventRegisteredView_(sheet.getName());candidate[15]=false;candidate[20]=0;candidate[21]=false;
    for(var c=1;c<=17;c++)if(input[c]!==''&&input[c]!==null)patch[c]=input[c];
    // 초기 체크박스 false는 전체 등록 탭의 기본 등록을 해제하지 않는다.
    patch[13]=!eventRegisteredView_(sheet.getName());
    if(eventRegisteredView_(sheet.getName())&&input[14]!==true)patch[14]=true;
  }else{candidate=records[existingIndex];columns.forEach(function(c){if(c>=1&&c<=17)patch[c]=input[c];});}
  if(sheet.plainMap){patch[13]=!eventRegisteredView_(sheet.getName());patch[14]=eventRegisteredView_(sheet.getName());}
  var planned=eventApplyPatch_(candidate,isNew?null:base,patch,sheet.getName(),force);
  // 이름을 먼저 쓴 뒤 전화번호를 채우는 입력도 같은 사람으로 연결한다.
  var key=eventKey_(planned.row),matches=key?records.map(function(r,i){return {r:r,i:i};}).filter(function(x){return !x.r[21]&&!!x.r[eventRegisteredView_(sheet.getName())?14:13]&&x.r[0]!==candidate[0]&&eventKey_(x.r)===key&&eventStoredGroup_(x.r[2])===eventStoredGroup_(planned.row[2])&&eventText_(x.r[3])===eventText_(planned.row[3]);}):[];
  if(matches.length>1)throw new Error('동일인 후보가 여러 명입니다. 기존 관리번호를 확인해 주세요.');
  if(matches.length===1){
    mergedFrom=existingIndex<0?null:{row:candidate.slice(),index:existingIndex};
    var incoming=planned.row.slice(),merge={};
    candidate=matches[0].r;existingIndex=matches[0].i;
    for(var k=3;k<=17;k++){
      if(k>=13&&k<=15){if(incoming[k])merge[k]=true;}
      else if(incoming[k]!==''&&incoming[k]!==null)merge[k]=incoming[k];
    }
    // 기본 기타 배정으로 기존 군을 덮지 않는다. 군을 직접 고친 경우만 반영한다.
    if(Object.prototype.hasOwnProperty.call(patch,2))merge[2]=incoming[2];
    if(eventRegisteredView_(sheet.getName()))merge[14]=true;else merge[13]=true;
    var mergeBase=Array(EVENT.width).fill('');
    [13,14,15].forEach(function(c){mergeBase[c]=candidate[c];});
    planned=eventApplyPatch_(candidate,mergeBase,merge,sheet.getName(),force);
    patch=merge;
  }
  if(candidate[21])throw new Error('취소된 기록입니다. 마지막 취소 복구 메뉴를 사용해 주세요.');
  if(planned.conflicts.length){
    if(isNew){
      // 신규 붙여넣기의 충돌도 대상 관리번호와 비교값을 주어 메뉴에서 해결할 수 있다.
      var conflictView=candidate.slice(0,21);
      Object.keys(patch).forEach(function(k){conflictView[Number(k)]=patch[k];});
      conflictView[21]=JSON.stringify(candidate.slice(0,21));
      eventWrite_(sheet.getRange(rowNumber,1,1,EVENT.width),[conflictView]);
    }
    if(base){planned.conflicts.forEach(function(item){base[item.column]=candidate[item.column];});sheet.getRange(rowNumber,22).setValue(JSON.stringify(base));}
    ss.getSheetByName(EVENT.conflicts).appendRow([eventNow_(),sheet.getName(),rowNumber,candidate[0],JSON.stringify(planned.conflicts),'미해결']);
    sheet.getRange(rowNumber,19).setValue('충돌: '+planned.conflicts.map(function(x){return EVENT.headers[x.column]+' (저장값: '+eventText_(x.stored)+' / 입력: '+eventText_(x.input)+')';}).join(', ')+' / 확인 후 해당 항목을 다시 입력해 주세요.');
    return;
  }
  var changed=isNew||!!mergedFrom||planned.row.slice(1,18).some(function(v,i){return !eventEqual_(v,candidate[i+1]);});
  var after=planned.row;after[0]=candidate[0];after[21]=false;after[18]=eventHealth_(after,records.filter(function(r){return !mergedFrom||r[0]!==mergedFrom.row[0];}));
  if(changed){after[19]=eventNow_();after[20]=(Number(candidate[20])||0)+1;
    // 원본보다 먼저 입력 행에 번호와 버전 0 비교값을 한 번에 남긴다.
    // 원본 쓰기 직후 응답이 끊겨도 같은 번호로 이어서 처리한다.
    if(isNew&&existingIndex<0&&sheet.stageCreate){var draft=after.slice(0,21);draft[20]=0;sheet.stageCreate(rowNumber,draft);}
    eventAudit_(ss,isNew&&existingIndex<0?'추가':'수정',sheet.getName(),existingIndex<0?null:candidate,after);
    if(existingIndex<0){raw.appendRow(eventSafeValues_(after));existingIndex=records.length;}else eventWrite_(raw.getRange(existingIndex+2,1,1,EVENT.width),[after]);
  }
  if(mergedFrom){
    var retired=mergedFrom.row.slice();retired[21]=true;retired[19]=eventNow_();retired[20]=(Number(retired[20])||0)+1;
    eventAudit_(ss,'동일인 연결',sheet.getName(),mergedFrom.row,retired,'연결 대상: '+after[0]);
    eventWrite_(raw.getRange(mergedFrom.index+2,1,1,EVENT.width),[retired]);
  }
  // 이 이벤트가 처리한 칸만 비교값을 갱신한다. 다른 대기 입력은 그대로 둔다.
  var sourceBase=base?base.slice():after.slice(0,21);
  if(isNew||mergedFrom||eventFind_(sheet,after[0]).some(function(x){return x.row!==rowNumber;})){
    sourceBase=after.slice(0,21);
    // 기본 날짜/군/체크와 입력 정규화를 반영한다. 중복 연결은 같은 탭의 기존 행과 합친다.
    var existingViews=eventFind_(sheet,after[0]);
    if(existingViews.some(function(x){return x.row!==rowNumber;})){sheet.getRange(rowNumber,1,1,EVENT.width).clearContent();}
    else {var newValues=after.slice(0,21),freshNew=sheet.getRange(rowNumber,1,1,EVENT.width).getValues()[0];
      for(var f=1;f<=17;f++)if(!eventEqual_(freshNew[f],input[f]))newValues[f]=freshNew[f];
      newValues[21]=JSON.stringify(sourceBase);eventWrite_(sheet.getRange(rowNumber,1,1,EVENT.width),[newValues]);}
  }else{
    Object.keys(patch).forEach(function(k){var c=Number(k);if(eventEqual_(sheet.getRange(rowNumber,c+1).getValues()[0][0],input[c])){sourceBase[c]=after[c];eventWrite_(sheet.getRange(rowNumber,c+1,1,1),[[after[c]]]);}});
    sheet.getRange(rowNumber,22).setValue(JSON.stringify(sourceBase));
  }
  if(mergedFrom)eventProject_(ss,retired,mergedFrom.row[2],'*');
  if(/^(입력 확인:|충돌:)/.test(eventText_(input[18]))&&!eventHasDirty_(sheet.getRange(rowNumber,1,1,EVENT.width).getValues()[0]))sheet.getRange(rowNumber,19).setValue(after[18]);
  eventProject_(ss,after,candidate[2],sheet.getName());
  if(changed&&after[18].indexOf('방문·등록 각각 입력됨')>=0&&eventText_(candidate[18]).indexOf('방문·등록 각각 입력됨')<0)ss.toast('방문과 등록에 각각 입력되었습니다. 방문 1건·등록 1건으로 따로 집계합니다.','카드별 입력 안내',8);

}
function eventWithLock_(ss,fn,waitMs,quiet) {
  if(PropertiesService.getScriptProperties().getProperty('EVENT_ARMY_BASIS_REQUEST')&&!EVENT_ARMY_BASIS_EXEC)return false;
  var lock=LockService.getDocumentLock();
  if(!lock.tryLock(waitMs||5000)){if(!quiet)ss.toast('다른 입력을 처리 중입니다. 입력값을 남겨 두고 자동으로 다시 반영합니다. 잠시 기다려 주세요.','입력 대기',8);return false;}
  try{if(PropertiesService.getScriptProperties().getProperty('EVENT_ARMY_BASIS_REQUEST')){var real=ss.real||ss;EVENT_STRUCTURE_CONTEXT={expected:{},touched:{},real:real};eventStructureSheets_(real).forEach(function(p){EVENT_STRUCTURE_CONTEXT.expected[p.getSheetId()]=p.getMaxRows();EVENT_STRUCTURE_CONTEXT.touched[p.getSheetId()]=p;});return eventReconcileArmyBasis_(ss);}eventStructureBegin_(ss);var result=fn();SpreadsheetApp.flush();return result!==false;}finally{try{eventStructureFinish_();}finally{lock.releaseLock();}}
}
function eventEditInternal_(e) {
  if(!e||!e.range||!e.source)return;
  var sheet=e.range.getSheet();if(!eventIsView_(sheet.getName())||e.range.getLastRow()<2)return;
  var from=Math.max(2,e.range.getRow()),to=e.range.getLastRow(),cols=[];
  for(var c=Math.max(1,e.range.getColumn()-1);c<=Math.min(17,e.range.getLastColumn()-1);c++)cols.push(c);
  if(!cols.length){e.source.toast('관리번호·확인사항·수정시각은 자동 관리됩니다.','입력 안내',5);return;}
  try{eventWithLock_(e.source,function(){
    for(var row=from;row<=to;row++){
      try{eventProcessRow_(e.source,sheet,row,cols,e.range.getNumRows()===1&&e.range.getNumColumns()===1?e.value:undefined,false);}
      catch(err){sheet.getRange(row,19).setValue('입력 확인: '+err.message);e.source.toast(err.message,'입력 확인',8);}
    }
  });}catch(err){sheet.getRange(from,19).setValue('반영 중단: '+err.message+' / 시트를 다시 열기');e.source.toast('입력값을 보존했습니다. 시트를 다시 열어 주세요.','자동 연결 확인',10);}
}
function eventRepair(silent,background) {
  var ss=eventPlainWrap_(SpreadsheetApp.getActive());return eventWithLock_(ss,function(){
    eventPlainNumbers_(ss);
    var urgentProps=PropertiesService.getScriptProperties(),urgent=urgentProps.getProperty('EVENT_UNSAVED_REQUEST');
    if(urgent){
      if(urgentProps.getProperty('EVENT_UNSAVED_PHASE')!=='fresh'){
        var restored=eventRestoreMissing_(ss,20000);
        if(restored.complete)urgentProps.deleteProperty('EVENT_UNSAVED_MISSING');else urgentProps.setProperty('EVENT_UNSAVED_MISSING','1');
        if(restored.processed){urgentProps.setProperty('EVENT_UNSAVED_PHASE','fresh');urgentProps.setProperty('EVENT_SYNC_DIRTY',Utilities.getUuid());return false;}
      }
      var urgentResult=eventDrainUnsaved_(ss,20000);
      urgentProps.deleteProperty('EVENT_UNSAVED_PHASE');
      if(urgentResult.complete&&urgentProps.getProperty('EVENT_UNSAVED_MISSING')!=='1'&&urgentProps.getProperty('EVENT_UNSAVED_REQUEST')===urgent)urgentProps.deleteProperty('EVENT_UNSAVED_REQUEST');
      if(urgentResult.processed||!urgentResult.complete||urgentProps.getProperty('EVENT_UNSAVED_MISSING')==='1'){urgentProps.setProperty('EVENT_SYNC_DIRTY',Utilities.getUuid());return false;}
    }
    eventSeparateCards_(ss);
    // 군 수정은 전체 화면 복구보다 먼저 저장한다. 느린 전체 확인에 밀리지 않는다.
    if(eventPendingGroupMoves_(ss,background)){eventPlainLabels_(ss,true);return false;}
    eventViews_().forEach(function(name){eventEnsureCapacity_(ss.getSheetByName(name));});
    var journal=eventReplayEdits_(ss),complete=true,jobs=[],props=PropertiesService.getScriptProperties();
    eventRefreshProjections_(ss);
    // Google 편집 이벤트가 빠졌거나 잠금을 기다린 입력을 먼저 처리한다.
    eventViews_().forEach(function(name){var sheet=ss.getSheetByName(name);eventData_(sheet).forEach(function(row,i){
      row=eventSplitAssignmentPending_(ss,sheet,i+2,row);
      var base=eventBaseline_(row),cols=[];
      if(/^충돌:/.test(eventText_(row[18])))return;
      if(!row[0]){if(!eventText_(row[5]))return;for(var c=1;c<=17;c++)cols.push(c);}
      else if(base){for(var j=1;j<=17;j++)if(!eventEqual_(row[j],base[j]))cols.push(j);}
      if(!cols.length&&row[0]&&base&&Number(base[20])===0)cols.push(5);
      if(!cols.length)return;
      jobs.push({name:name,row:i+2,cols:cols,fresh:!row[0],key:name+'|'+(row[0]||('row:'+(i+2)))});
    });});
    var waitingKeys={};
    jobs.forEach(function(job){
      job.last=Number(props.getProperty('EVENT_REPAIR_AT_'+job.key)||0);job.first=0;
      if(job.fresh){var key='EVENT_REPAIR_SEEN_'+job.key;waitingKeys[key]=true;job.first=Number(props.getProperty(key)||0)||Date.now();props.setProperty(key,String(job.first));}
    });
    Object.keys(props.getProperties()).forEach(function(key){if(key.indexOf('EVENT_REPAIR_SEEN_')===0&&!waitingKeys[key])props.deleteProperty(key);});
    jobs.sort(function(a,b){return Number(!a.fresh)-Number(!b.fresh)||a.last-b.last||a.first-b.first;});
    var started=Date.now(),processed=0;
    for(var step=0;step<jobs.length;step++){
      if(background&&processed&&Date.now()-started>=20000){complete=false;break;}
      var job=jobs[step],sheet=ss.getSheetByName(job.name);
      props.setProperty('EVENT_REPAIR_AT_'+job.key,String(Date.now()));processed++;
      try{var fresh=sheet.getRange(job.row,1,1,22).getValues()[0];if(sheet.plainMap&&fresh[0]&&!eventText_(fresh[5]))eventPlainClear_(ss,sheet,job.row,sheet.plainMap);else eventProcessRow_(ss,sheet,job.row,job.cols,undefined,false);}catch(err){complete=false;sheet.getRange(job.row,19).setValue('입력 확인: '+err.message);}
    }
    eventRefreshHealth_(ss);
    eventRefreshProjections_(ss);
    eventPlainLabels_(ss,false,true);
    if(!silent)ss.toast('명단을 다시 연결했습니다.','입력 확인',5);
    if(complete)journal.forEach(function(k){PropertiesService.getScriptProperties().deleteProperty(k);});
    return complete;
  },background?15000:60000,!!background);
}
/** 군 칸만 먼저 처리하고, 다른 대기 입력과 카드 종류는 유지한다. */
function eventPendingGroupMoves_(ss,background){
  var names=eventGroupViews_('기타').concat(eventViews_().filter(function(n){return eventGroup_(n)!=='기타';})),props=PropertiesService.getScriptProperties(),pending=false;
  var views=names.map(function(name){var sheet=ss.getSheetByName(name),rows=eventData_(sheet);
    rows.forEach(function(row,i){if(!row[0]&&eventText_(row[5])){pending=true;var key='EVENT_REPAIR_SEEN_'+name+'|row:'+(i+2);if(!props.getProperty(key))props.setProperty(key,String(Date.now()));}});
    return {name:name,sheet:sheet,rows:rows};
  });
  if(pending&&!props.getProperty('EVENT_UNSAVED_REQUEST'))props.setProperty('EVENT_UNSAVED_REQUEST',Utilities.getUuid());
  var started=Date.now(),processed=0;
  for(var v=0;v<views.length;v++){
    var sheet=views[v].sheet,rows=views[v].rows;
    for(var i=0;i<rows.length;i++){
      var row=rows[i],base=eventBaseline_(row);
      if(!row[0]||!base||!eventText_(row[5])||/^충돌:/.test(eventText_(row[18]))||eventEqual_(row[2],base[2]))continue;
      var target=eventStoredGroup_(eventText_(row[2])||eventGroup_(views[v].name)||'기타');
      if(EVENT.groups.indexOf(target)<0)continue;
      if(background&&processed&&Date.now()-started>=20000)return true;
      var found=eventFind_(sheet,row[0]);if(found.length!==1)continue;
      try{eventProcessRow_(ss,sheet,found[0].row,[2],undefined,false);processed++;}
      catch(err){sheet.getRange(found[0].row,19).setValue('입력 확인: '+err.message);}
    }
  }
  return processed>0;
}
function eventSyncGroupMoves(){
 var ss=eventPlainWrap_(SpreadsheetApp.getActive());
 PropertiesService.getScriptProperties().setProperty('EVENT_SYNC_DIRTY',Utilities.getUuid());
 return eventWithLock_(ss,function(){eventSeparateCards_(ss);eventPendingGroupMoves_(ss,false);eventPlainLabels_(ss,true);},180000);
}
function eventSelected_(ss){var sheet=ss.getActiveSheet(),row=sheet.getActiveRange().getRow();if(!eventIsView_(sheet.getName())||row<2)throw new Error('명단에서 대상 행을 선택해 주세요.');var values=sheet.getRange(row,1,1,EVENT.width).getValues()[0];if(!values[0])throw new Error('자동 연결된 행을 선택해 주세요.');return {sheet:sheet,row:row,values:values};}
function eventAcceptConflict(){var ss=SpreadsheetApp.getActive();eventWithLock_(ss,function(){var s=eventSelected_(ss),base=eventBaseline_(s.values),cols=[];if(!base)throw new Error('화면 비교값이 없습니다. 저장값 복원을 사용해 주세요.');for(var c=1;c<=17;c++)if(!eventEqual_(s.values[c],base[c]))cols.push(c);eventProcessRow_(ss,s.sheet,s.row,cols,undefined,true);eventResolveLog_(ss,s.values[0],'입력 적용');});}
function eventResolveLog_(ss,id,action){var sh=ss.getSheetByName(EVENT.conflicts),n=sh.getLastRow();if(n<2)return;sh.getRange(2,1,n-1,6).getValues().forEach(function(row,i){if(row[3]===id&&row[5]==='미해결')sh.getRange(i+2,6).setValue(action+' '+eventNow_());});}
function eventRestoreRow(){var ss=SpreadsheetApp.getActive();eventWithLock_(ss,function(){var s=eventSelected_(ss),row=eventData_(ss.getSheetByName(EVENT.raw)).find(function(r){return r[0]===s.values[0];});if(!row)throw new Error('원본에 없는 관리번호입니다.');eventAudit_(ss,'화면 복원',s.sheet.getName(),s.values,row);var full=row.slice(0,21);full[21]=JSON.stringify(full);if(eventFind_(s.sheet,row[0]).some(function(x){return x.row!==s.row;}))s.sheet.getRange(s.row,1,1,EVENT.width).clearContent();else eventWrite_(s.sheet.getRange(s.row,1,1,EVENT.width),[full]);eventProject_(ss,row,'',s.sheet.getName());eventResolveLog_(ss,row[0],'저장값 복원');});}
function eventCancel(){var ss=SpreadsheetApp.getActive(),s=eventSelected_(ss),ui=SpreadsheetApp.getUi();if(ui.alert('기록 취소','선택한 기록을 명단에서 숨기고 이력을 보관할까요?',ui.ButtonSet.YES_NO)!==ui.Button.YES)return;eventWithLock_(ss,function(){var raw=ss.getSheetByName(EVENT.raw),items=eventData_(raw),i=items.findIndex(function(r){return r[0]===s.values[0];});if(i<0)throw new Error('원본을 찾지 못했습니다.');var before=items[i],after=before.slice();after[21]=true;after[19]=eventNow_();after[20]=Number(before[20])+1;eventAudit_(ss,'취소',s.sheet.getName(),before,after);eventWrite_(raw.getRange(i+2,1,1,EVENT.width),[after]);eventProject_(ss,after,before[2],s.sheet.getName());});}
function eventUndoCancel(){
  var ss=SpreadsheetApp.getActive();eventWithLock_(ss,function(){
    var raw=ss.getSheetByName(EVENT.raw),items=eventData_(raw),last=-1,latest={};
    var log=ss.getSheetByName(EVENT.log),n=log.getLastRow();
    if(n>1)log.getRange(2,1,n-1,7).getValues().forEach(function(entry){if(['취소','동일인 연결'].indexOf(entry[1])>=0)latest[entry[3]]=entry[1];});
    items.forEach(function(r,i){if(r[21]&&latest[r[0]]==='취소'&&(last<0||r[19]>=items[last][19]))last=i;});
    if(last<0){ss.toast('복구할 취소 기록이 없습니다.');return;}
    var before=items[last],after=before.slice();after[21]=false;after[19]=eventNow_();after[20]=Number(before[20])+1;
    eventAudit_(ss,'취소 복구','메뉴',before,after);eventWrite_(raw.getRange(last+2,1,1,EVENT.width),[after]);eventProject_(ss,after,'','');
  });
}

/** 화면은 원래 양식의 단순 명단. 내부 연결 값만 숨긴다. */
function eventPlainMap_(name) {
  var registered=eventRegisteredView_(name),group=eventGroup_(name);
  var cols=[-1,12,5,6,7,9,10,11,2,3,4,17];if(registered)cols.push(16);
  return {name:name,physical:group||name,start:group&&registered?14:1,meta:group&&registered?31:29,cols:cols,registered:registered,group:group};
}
function eventPlainWrap_(real) {
  if(!real.getSheets)return real;
  var cache={};
  return {real:real,labelNames:cache,getSheetByName:function(name){if(!eventIsView_(name))return real.getSheetByName(name);if(!cache[name])cache[name]=eventPlainSheet_(real.getSheetByName(eventPlainMap_(name).physical),eventPlainMap_(name),function(){Object.keys(cache).forEach(function(k){cache[k].refresh();});});return cache[name];},
    toast:function(a,b,c){real.toast(a,b,c);},getActiveSheet:function(){var p=real.getActiveSheet(),m=eventPlainMapForColumn_(p.getName(),p.getActiveRange().getColumn(),p.getActiveRange().getRow(),p);return m?this.getSheetByName(m.name):p;}};
}
function eventPlainConfigure_(physical,map){
  eventStructureGuard_(physical);
  map.offset=0;map.limit=physical.getMaxRows();
  if(map.group){
    map.rangeName='_EVENT_'+physical.getSheetId()+'_'+(map.registered?'REG':'VISIT');
    var region=physical.getParent().getRangeByName(map.rangeName);
    if(!region)throw new Error('명단 입력 범위를 확인해 주세요.');
    var boundary=region.getRow()+':'+region.getNumRows();
    if(map.checkedBoundary!==boundary){
      var header=physical.getRange(Math.max(1,region.getRow()-1),3).getValues()[0][0];
      if(eventText_(header).replace(/\s/g,'')!=='이름'){
        eventStructureValidate_(physical);eventStructureRepairRanges_(physical);
        region=physical.getParent().getRangeByName(map.rangeName);
      }
      map.checkedBoundary=region.getRow()+':'+region.getNumRows();
    }
    map.offset=region.getRow()-2;map.limit=region.getNumRows()+1;map.start=1;
  }
  return map;
}
function eventPlainMapForColumn_(name,col,row,physical){
  if(name===EVENT.visitors||name===EVENT.registrations)return eventPlainMap_(name);
  if(EVENT.groups.indexOf(name)<0)return null;
  var maps=[eventPlainMap_(name+'::방문'),eventPlainMap_(name+'::등록')];
  for(var i=0;i<maps.length;i++){var map=eventPlainConfigure_(physical,maps[i]);if(col<=map.cols.length&&row>=map.offset+2&&row<=map.offset+map.limit)return map;}
  return null;
}
function eventPlainSheet_(physical,map,onResize) {
  eventPlainConfigure_(physical,map);
  function readRows(row,count){
    if(map.group)eventPlainConfigure_(physical,map);
    var physicalRows=physical.getRange(row+map.offset,1,count,32).getValues(),notes=physical.getRange(row+map.offset,map.start+2,count,1).getNotes();
    var values=physicalRows.map(function(r){return r.slice(map.start-1,map.start-1+map.cols.length);}),metas=physicalRows.map(function(r){return r.slice(map.meta-1,map.meta+1);});
    return values.map(function(visible,index){var meta=metas[index],base;
      try{base=JSON.parse(meta[1]);}catch(_){}
      var out=Array(22).fill('');if(Array.isArray(base)&&base.length===21)out=base.slice().concat(['']);
      out[0]=meta[0]||'';out[21]=meta[1]||'';map.cols.forEach(function(c,i){if(c>=0&&(map.registered||c!==4))out[c]=c===2?eventStoredGroup_(visible[i]):visible[i];});
      if(notes[index][0])out[18]=notes[index][0];return out;
    });
  }
  function note(row,value){eventStatusNote_(physical.getRange(row+map.offset,map.start+2),value);}
  function write(row,col,value){
    eventStructureTouch_(physical);
    if(map.group)eventPlainConfigure_(physical,map);
    var i=map.cols.indexOf(col);
    if(col===0)physical.getRange(row+map.offset,map.meta).setValue(value);
    else if(col===21)physical.getRange(row+map.offset,map.meta+1).setValue(value);
    else if(col===18)note(row,value);
    else if(i>=0)physical.getRange(row+map.offset,map.start+i).setValue(col===2?eventDisplayGroup_(value):!map.registered&&col===4?'-':value);
  }
  var sheet={plainMap:map,physical:physical,stageCreate:function(row,draft){eventStructureGuard_(physical);eventWrite_(physical.getRange(row+map.offset,map.meta,1,2),[[draft[0],JSON.stringify(draft)]]);eventStructureTouch_(physical,true);},refresh:function(){eventPlainConfigure_(physical,map);},getName:function(){return map.name;},getLastRow:function(){if(map.group)eventPlainConfigure_(physical,map);return Math.max(1,Math.min(physical.getLastRow(),map.offset+map.limit)-map.offset);},getMaxRows:function(){return map.limit;},insertRowsAfter:function(a,b){if(!map.group){physical.insertRowsAfter(a,b);eventStructureOwnResize_(physical,b);map.limit+=b;return;}var start=map.offset+2,length=map.limit-1,at=start+length;var added=10;physical.insertRowsBefore(at,added);eventStructureOwnResize_(physical,added);physical.getRange(at-1,1,1,32).copyFormatToRange(physical,1,32,at,at+added-1);physical.getParent().setNamedRange(map.rangeName,physical.getRange(start,1,length+added,map.cols.length));onResize();},
    getActiveRange:function(){return {getRow:function(){return physical.getActiveRange().getRow()-map.offset;}};},
    getRange:function(row,col,nr,nc){nr=nr||1;nc=nc||1;return {
      getValues:function(){return readRows(row,nr).map(function(r){return r.slice(col-1,col-1+nc);});},
      setValues:function(values){eventStructureTouch_(physical);eventPlainConfigure_(physical,map);values.forEach(function(values,r){if(col===1&&values.length===22){
        // 화면 내용과 관리번호를 한 번에 저장해 한쪽만 남는 중단 상태를 막는다.
        var target=physical.getRange(row+r+map.offset,1,1,32),current=target.getValues()[0],formulas=target.getFormulas()[0];
        var whole=eventSafeValues_(current);formulas.forEach(function(formula,i){if(formula)whole[i]=formula;});
        var view=eventSafeValues_(map.cols.map(function(c){return c<0?row+r-1:c===2?eventDisplayGroup_(values[c]):!map.registered&&c===4?'-':values[c];}));
        view.forEach(function(v,i){whole[map.start+i-1]=v;});whole[map.meta-1]=values[0];whole[map.meta]=values[21];
        eventStructureGuard_(physical);target.setValues([whole]);eventStructureTouch_(physical,current[map.meta-1]!==whole[map.meta-1]);note(row+r,values[18]);
      }else values.forEach(function(v,c){write(row+r,col+c-1,v);});});return this;},
      setValue:function(v){return this.setValues([[v]]);},
      clearContent:function(){eventStructureTouch_(physical);eventPlainConfigure_(physical,map);physical.getRange(row+map.offset,map.start,nr,map.cols.length).clearContent();physical.getRange(row+map.offset,map.meta,nr,2).clearContent();physical.getRange(row+map.offset,map.start+2,nr,1).clearNote().setFontColor('#000000');return this;}
    };}};
  return sheet;
}
function eventPlainClear_(ss,sheet,rowNumber,map) {
  var input=sheet.getRange(rowNumber,1,1,22).getValues()[0];if(!input[0])return;
  var raw=ss.getSheetByName(EVENT.raw),records=eventData_(raw),i=records.findIndex(function(r){return r[0]===input[0];});if(i<0)return;
  var before=records[i],after=before.slice();
  if(map.cols.some(function(c){return c>=0&&c!==2&&c!==4&&eventText_(input[c]);})){sheet.getRange(rowNumber,19).setValue('이름 수정 대기: 이름을 다시 입력하세요. 삭제는 보이는 명단 내용 전체를 비워 주세요.');return;}
  // 이름을 지운 카드만 같은 종류의 전체·군별 화면에서 제외한다.
  // 해당 카드의 내용은 취소 기록에 남겨 복구할 수 있게 한다.
  after[21]=true;after[19]=eventNow_();after[20]=Number(before[20])+1;
  eventAudit_(ss,'취소',map.name,before,after,'이름 비우기: 같은 종류의 전체·군별 카드만 삭제');
  eventWrite_(raw.getRange(i+2,1,1,22),[after]);sheet.getRange(rowNumber,1,1,22).clearContent();eventProject_(ss,after,before[2],'*');
}
function eventPlainFooter_(physical,map){
  if(!map.group)return;var col=map.registered?12:11,row=map.offset+map.limit+1;
  var formula='=SUMPRODUCT(N(LEN(TRIM(INDEX('+map.rangeName+',0,3)))>0))';
  physical.getRange(row,col,1,2).setValues([['계',formula]]);
}
/** 화면에 입력된 이름 수만 계산한다. 명단과 연결 정보는 수정하지 않는다. */
function eventRefreshCounts(){
  var real=SpreadsheetApp.getActive();if(!real.getSheets)return false;
  return eventWithLock_(eventPlainWrap_(real),function(){var complete=true;eventViews_().forEach(function(name){var map=eventPlainMap_(name),p=real.getSheetByName(map.physical);eventPlainConfigure_(p,map);
    if(map.group){var row=map.offset+map.limit+1,col=map.registered?12:11;if(p.getRange(row,col).getValues()[0][0]!=='계'){complete=false;return;}p.getRange(row,col+1).setValue('=SUMPRODUCT(N(LEN(TRIM(INDEX('+map.rangeName+',0,3)))>0))');}
    else p.getRange(1,16).setValue('=SUMPRODUCT(N(LEN(TRIM(C2:C))>0))');
  });if(complete)PropertiesService.getScriptProperties().setProperty('EVENT_COUNTS_REV','visible-v1');},1,true);
}
function onEdit(e) {
  if(!e||!e.range||!e.source)return;
  if(!e.source.getSheets){eventEditInternal_(e);return;}
  var physical=e.range.getSheet(),name=physical.getName(),maps=[];
  if(name===EVENT.visitors||name===EVENT.registrations)maps=[eventPlainMap_(name)];
  else if(EVENT.groups.indexOf(name)>=0)maps=[eventPlainMap_(name+'::방문'),eventPlainMap_(name+'::등록')];else return;
  eventRememberEdit_(e,maps);
  PropertiesService.getScriptProperties().setProperty('EVENT_SYNC_DIRTY',Utilities.getUuid());
  var ss=eventPlainWrap_(e.source),eventRow=e.range.getRow(),eventLast=e.range.getLastRow(),eventCol=e.range.getColumn(),eventColLast=e.range.getLastColumn();
  eventWithLock_(ss,function(){eventSeparateCards_(ss);maps.forEach(function(map){
    eventPlainConfigure_(physical,map);
    var sheet=ss.getSheetByName(map.name);
    if(map.group&&eventRow>=map.offset+2&&eventRow<=map.offset+map.limit+1&&eventLast>=map.offset+map.limit+1){
      var oldEnd=map.offset+map.limit,extra=eventLast-oldEnd;
      var overflow=physical.getRange(oldEnd+1,1,extra,map.cols.length).getValues();
      if(overflow.some(function(r){return eventText_(r[2]);})){
        var other=eventPlainConfigure_(physical,eventPlainMap_(map.group+(map.registered?'::방문':'::등록')));
        if(!map.registered&&eventLast>=other.offset+1)throw new Error('방문 붙여넣기가 등록 구역과 겹칩니다. 입력 범위를 확인해 주세요.');
        var footerCol=map.registered?12:11;
        overflow.forEach(function(r){[footerCol,footerCol+1].forEach(function(c){if(c<eventCol||c>eventColLast)r[c-1]='';});});
        var oldLimit=map.offset+map.limit;
        while(map.offset+map.limit<eventLast){sheet.insertRowsAfter(sheet.getMaxRows(),5);eventPlainConfigure_(physical,map);}
        physical.getRange(oldEnd+1+(map.offset+map.limit-oldLimit),1,extra,map.cols.length).clearContent().clearNote();
        physical.getRange(oldEnd+1,1,extra,map.cols.length).setValues(overflow);
        physical.getRange(map.offset+map.limit+1,1,1,map.cols.length).clearContent().clearNote();eventPlainFooter_(physical,map);
      }
    }
    if(eventRow>=map.offset+2&&eventRow<=map.offset+map.limit){eventEnsureCapacity_(sheet);eventPlainConfigure_(physical,map);}
    var columns=[];map.cols.forEach(function(c,i){var physicalCol=map.start+i;if(c>=0&&(map.registered||c!==4)&&physicalCol>=eventCol&&physicalCol<=eventColLast)columns.push(c);});
    if(!columns.length)return;
    // 마지막 이벤트의 칸뿐 아니라 같은 명단에서 먼저 대기한 입력도 반영한다.
    eventData_(sheet).forEach(function(values,i){
      var row=i+2,base=eventBaseline_(values),changed=[];
      var inEvent=row>=eventRow-map.offset&&row<=eventLast-map.offset;
      if(/^충돌:/.test(eventText_(values[18]))&&!inEvent)return;
      if(!values[0]){if(!eventText_(values[5]))return;changed=columns.slice();}
      else if(base){for(var c=1;c<=17;c++)if(!eventEqual_(values[c],base[c]))changed.push(c);}
      // 충돌난 칸은 사람이 그 칸을 직접 수정할 때만 확정한다.
      if(/^충돌:/.test(eventText_(values[18])))changed=changed.filter(function(c){return columns.indexOf(c)>=0;});
      if(!changed.length&&values[0]&&base&&Number(base[20])===0)changed.push(5);
      if(!changed.length&&base&&inEvent&&/^(입력 확인:|충돌:)/.test(eventText_(values[18])))changed=columns.slice();
      if(!changed.length){if(base&&/^다른 입력 처리 대기:/.test(eventText_(values[18])))sheet.getRange(row,19).setValue(base[18]||'');return;}
      try{if(changed.indexOf(5)>=0&&!eventText_(values[5])&&values[0])eventPlainClear_(ss,sheet,row,map);else eventProcessRow_(ss,sheet,row,changed,undefined,false);}
      catch(err){sheet.getRange(row,19).setValue('입력 확인: '+err.message);e.source.toast(err.message,'입력 확인',6);}
    });
  });eventPlainLabels_(ss,true);},15000);
}

/** 파생 표시만 정리한다. 행 순서와 입력값·내부 연결값은 이동하지 않는다. */
function eventPlainLabels_(ss,onlyTouched,verifyRules) {
  (onlyTouched?Object.keys(ss.labelNames||{}):eventViews_()).forEach(function(name){
    var sheet=ss.getSheetByName(name),map=sheet.plainMap;
    if(!map)return;
    eventEnsureCapacity_(sheet);
    eventDuplicateRule_(sheet,verifyRules);
    if(map.registered)eventRouteDropdown_(sheet,verifyRules);
    var physical=sheet.physical,start=map.offset+2,count=Math.min(map.limit-1,Math.max(0,physical.getLastRow()-start+1));
    if(!count)return;
    var visible=physical.getRange(start,1,count,11).getValues();
    eventWriteNumbers_(physical,start,visible);
    visible.forEach(function(row,i){
      var hasName=!!eventText_(row[2]);
      if(hasName&&row[8]!==eventDisplayGroup_(row[8])&&eventEqual_(physical.getRange(start+i,9).getValues()[0][0],row[8])){
        eventStructureGuard_(physical);physical.getRange(start+i,9).setValue(eventDisplayGroup_(row[8]));
      }
      if(!map.registered&&hasName&&row[10]!=='-'&&eventEqual_(physical.getRange(start+i,3).getValues()[0][0],row[2])){
        eventStructureGuard_(physical);physical.getRange(start+i,11).setValue('-');
      }
    });
  });
}

/** 긴 동기화 전에 모든 화면의 번호만 확인한다. 입력·범위·서식은 쓰지 않는다. */
function eventPlainNumbers_(ss){
  var labels=ss.real?eventPlainWrap_(ss.real):ss;
  eventViews_().forEach(function(name){
    var sheet=labels.getSheetByName(name),map=sheet.plainMap;if(!map)return;
    var p=sheet.physical,start=map.offset+2,count=Math.min(map.limit-1,Math.max(0,p.getLastRow()-start+1));
    if(count)eventWriteNumbers_(p,start,p.getRange(start,1,count,3).getValues());
  });
}
function eventWriteNumbers_(physical,start,visible){
  var number=0,needsNumbers=visible.some(function(row){var wanted=eventText_(row[2])?++number:'';return !eventEqual_(row[0],wanted);});
  if(!needsNumbers)return;
  // A열만 한 번에 갱신한다. 최신 이름으로 계산하고 행 이동 여부를 확인한다.
  var names=physical.getRange(start,3,visible.length,1).getValues();number=0;
  var numbers=names.map(function(row){return [eventText_(row[0])?++number:''];});
  eventStructureGuard_(physical);
  physical.getRange(start,1,visible.length,1).setValues(numbers);
}

/** 시간 기반 실행. 잠금 대기·실패 뒤에도 새 편집 없이 재시도한다. */
var EVENT_ARMY_BASIS_EXEC=false;
function eventAutoSync(){EVENT_ARMY_BASIS_EXEC=true;try{return eventAutoSyncInternal_();}finally{EVENT_ARMY_BASIS_EXEC=false;}}
function eventAutoSyncInternal_() {
  var props=PropertiesService.getScriptProperties();
  if(props.getProperty('EVENT_COUNTS_REV')!=='visible-v1')eventRefreshCounts();
  // 최초 자동 확인에서 기존 메모에도 색을 적용한다.
  if(props.getProperty('EVENT_STATUS_REV')!=='font-v1')eventRefreshStatusDisplay();
  if(eventStructureHasChanges_(SpreadsheetApp.getActive()))props.setProperty('EVENT_SYNC_DIRTY',String(Date.now())+'-rows');
  var generation=props.getProperty('EVENT_SYNC_DIRTY')||'initial';
  var done=props.getProperty('EVENT_SYNC_DONE');
  var last=Number(props.getProperty('EVENT_SYNC_LAST')||0);
  if(!props.getProperty('EVENT_UNSAVED_REQUEST')&&done===generation&&Date.now()-last<15*60*1000&&props.getProperty('EVENT_CAPACITY_REV')==='reserve5-add10'&&props.getProperty('EVENT_REPAIR_REV')==='chunk-v1')return;
  // 완료 표시는 처리한 세대만 남긴다. 처리 중 들어온 새 편집 표시를 지우지 않는다.
  if(eventRepair(true,true)){
    props.setProperty('EVENT_CAPACITY_REV','reserve5-add10');
    props.setProperty('EVENT_REPAIR_REV','chunk-v1');
    props.setProperty('EVENT_SYNC_DONE',generation);
    props.setProperty('EVENT_SYNC_LAST',String(Date.now()));
    console.log('행축 대기 입력 자동 확인 완료');
  }
}

function eventRouteDropdown_(sheet,verify){
  var map=sheet.plainMap,physical=sheet.physical,props=PropertiesService.getScriptProperties();
  var signature=JSON.stringify([map.offset+2,map.limit-1,EVENT.registrationRoutes]);
  var key='EVENT_ROUTE_RANGE_'+physical.getSheetId();
  if(!verify&&props.getProperty(key)===signature)return;
  var rule=SpreadsheetApp.newDataValidation().requireValueInList(EVENT.registrationRoutes,true).setAllowInvalid(false).build();
  physical.getRange(map.offset+2,13,map.limit-1,1).setDataValidation(rule);
  props.setProperty(key,signature);
}

function eventRefreshHealth_(ss) {
  var raw=ss.getSheetByName(EVENT.raw),records=eventData_(raw);
  records.forEach(function(row,i){if(row[21])return;var health=eventHealth_(row,records);if(row[18]!==health)raw.getRange(i+2,19).setValue(health);});
}
function eventSplitAssignmentPending_(ss,sheet,n,row) {
  var group=eventGroup_(sheet.getName()),base=eventBaseline_(row);
  if(!group||!base||!/^군 변경 전 입력 확인/.test(eventText_(row[18]))||!eventKey_(row))return row;
  var found=eventData_(ss.getSheetByName(EVENT.raw)).filter(function(r){return r[0]===row[0]&&!r[21];})[0];
  if(!found||found[2]===group||row[2]!==group||eventKey_(found)!==eventKey_(row))return row;
  eventAudit_(ss,'소속별 기록 분리',sheet.getName(),row,found,'이전 군 확인 대기 행의 소속과 입력값을 별도 기록으로 보존');
  var separate=row.slice();separate[0]='';separate[21]='';separate[18]='';separate[13]=!eventRegisteredView_(sheet.getName());separate[14]=eventRegisteredView_(sheet.getName());
  eventWrite_(sheet.getRange(n,1,1,EVENT.width),[separate]);return separate;
}
function eventDuplicateRule_(sheet,verify) {
  var map=sheet.plainMap,physical=sheet.physical,start=map.offset+2,count=map.limit-1;
  var tag='EVENT_DUPLICATE_'+(map.registered?'REG':'VISIT'),key=tag+'_'+physical.getSheetId(),signature=JSON.stringify([start,count,'card-v3']);
  var props=PropertiesService.getScriptProperties();if(!verify&&props.getProperty(key)===signature)return;
  var last=physical.getParent().getSheetByName(EVENT.raw).getMaxRows();
  var formula=`=AND(N("${tag}")=0,$C${start}<>"",$F${start}<>"",SUMPRODUCT(N(REGEXREPLACE(INDIRECT("'_원본'!F2:F${last}"),"\\s","")=REGEXREPLACE($C${start},"\\s","")),N(INDIRECT("'_원본'!J2:J${last}")=$F${start}),N(INDIRECT("'_원본'!V2:V${last}")=FALSE),N(INDIRECT("'_원본'!${map.registered?'O':'N'}2:${map.registered?'O':'N'}${last}")=TRUE))>1)`;
  var rules=physical.getConditionalFormatRules().filter(function(rule){var condition=rule.getBooleanCondition();return !condition||!condition.getCriteriaValues().some(function(v){return String(v).indexOf(tag)>=0;});});
  rules.push(SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied(formula).setBackground('#fff2cc').setRanges([physical.getRange(start,3,count,1)]).build());
  physical.setConditionalFormatRules(rules);props.setProperty(key,signature);
}

/** 기존 한 번호의 두 카드를 분리한다. 등록 화면의 대기 입력은 그대로 둔다. */
function eventSeparateCards_(ss) {
  if(!ss.getSheetByName(EVENT.visitors).plainMap)return;
  var raw=ss.getSheetByName(EVENT.raw),records=eventData_(raw);
  records.forEach(function(before,i){
    if(before[21]||!before[13]||!before[14])return;
    var id=before[0]+'-registration',registered=records.filter(function(r){return r[0]===id;})[0];
    if(!registered){registered=before.slice();registered[0]=id;registered[13]=false;registered[14]=true;registered[19]=eventNow_();registered[20]=Number(before[20])+1;
      eventAudit_(ss,'방문·등록 카드 분리','기존 명단',before,registered,'등록 카드에 별도 관리번호 부여');raw.appendRow(eventSafeValues_(registered));records.push(registered);}
    if(registered[13]||!registered[14]||eventKey_(registered)!==eventKey_(before))throw new Error('기존 카드 분리 번호를 확인해 주세요.');
    eventViews_().filter(eventRegisteredView_).forEach(function(name){var sheet=ss.getSheetByName(name);eventFind_(sheet,before[0]).forEach(function(item){
      var base=eventBaseline_(item.values);if(!base)throw new Error('기존 등록 카드 비교값 확인 필요');
      base[0]=id;base[13]=false;base[14]=true;sheet.stageCreate(item.row,base);
    });});
    var visitor=before.slice();visitor[14]=false;visitor[19]=eventNow_();visitor[20]=Number(before[20])+1;
    eventAudit_(ss,'방문·등록 카드 분리','기존 명단',before,visitor,'방문 카드는 기존 번호 유지');eventWrite_(raw.getRange(i+2,1,1,EVENT.width),[visitor]);
  });
}

/** 단일 셀 편집값을 화면 반영과 별도로 보관한다. */
function eventRememberEdit_(e,maps){
  if(e.range.getNumRows()!==1||e.range.getNumColumns()!==1)return;
  var p=e.range.getSheet(),r=e.range.getRow(),c=e.range.getColumn();
  maps.forEach(function(m){eventPlainConfigure_(p,m);if(r<m.offset+2||r>m.offset+m.limit)return;
    var col=m.cols[c-m.start];if(col===undefined||col<0||(!m.registered&&col===4))return;
    var row=eventPlainSheet_(p,m,function(){}).getRange(r-m.offset,1,1,22).getValues()[0];
    if(!row[0])return;
    var v=Object.prototype.hasOwnProperty.call(e,'value')?e.value:p.getRange(r,c).getValues()[0][0];
    if(col===2&&!eventText_(v))v=eventGroup_(m.name)||'기타';
    PropertiesService.getScriptProperties().setProperty('EVENT_EDIT_'+Utilities.getUuid(),JSON.stringify({time:Date.now(),view:m.name,id:row[0],col:col,value:v,previous:(eventBaseline_(row)||[])[col]}));
  });
}
function eventReplayEdits_(ss){
  if(!ss.getSheetByName(EVENT.visitors).plainMap)return [];
  var props=PropertiesService.getScriptProperties();if(!props.getProperties)return [];
  var all=props.getProperties(),keys=Object.keys(all).filter(function(k){return k.indexOf('EVENT_EDIT_')===0;}),latest={};
  keys.forEach(function(k){var x=JSON.parse(all[k]),key=x.id+'|'+x.col;if(!latest[key]||latest[key].time<=x.time)latest[key]=x;});
  Object.keys(latest).forEach(function(k){var x=latest[k],raw=eventData_(ss.getSheetByName(EVENT.raw)).filter(function(r){return r[0]===x.id;})[0];
    if(!raw||raw[21]||eventEqual_(raw[x.col],x.value))return;
    var sh=ss.getSheetByName(x.view),found=eventFind_(sh,x.id);if(found.length!==1)return;
    var item=found[0];try{var patch={};patch[x.col]=x.value;x.value=eventApplyPatch_(raw,null,patch,x.view,false).row[x.col];}catch(_){}if(eventEqual_(item.values[x.col],x.value))return;
    eventAudit_(ss,'편집값 복구',x.view,item.values,raw,'편집 이벤트에 보관한 값을 복구: '+EVENT.headers[x.col]);
    eventWrite_(sh.getRange(item.row,x.col+1),[[x.value]]);
    var base=eventBaseline_(item.values);if(base){base[x.col]=x.previous;sh.getRange(item.row,22).setValue(JSON.stringify(base));}
  });return keys;
}

function physicalLastName_(sheet){var m=sheet.plainMap;var end=m.offset+m.limit,n=Math.min(6,m.limit-1);return sheet.physical.getRange(end-n+1,3,n,1).getValues().some(function(r){return !!eventText_(r[0]);});}

function eventEnsureCapacity_(sheet){
  var m=sheet.plainMap;if(!m||!m.group||!physicalLastName_(sheet))return;
  // 계 행에 아직 처리하지 않은 입력이 있으면 먼저 기존 초과 입력 경로에서 보존한다.
  if(eventText_(sheet.physical.getRange(m.offset+m.limit+1,3).getValues()[0][0]))return;
  sheet.insertRowsAfter(sheet.getMaxRows(),10);eventPlainFooter_(sheet.physical,m);
}
/** 입력이 몰릴 때 명단 전체 처리 전에 빈칸만 확보한다. */
function eventExpandCapacity(){var ss=eventPlainWrap_(SpreadsheetApp.getActive());return eventWithLock_(ss,function(){eventViews_().forEach(function(name){eventEnsureCapacity_(ss.getSheetByName(name));});},60000);}

/** 이름 칸의 표시만 갱신한다. 입력값과 기존 중복 배경색에는 쓰지 않는다. */
function eventStatusStyle_(value){
  var text=eventText_(value).split('\n\n[입력 안내]')[0],color='#000000',help='';
  if(/^충돌:/.test(text)){color='#c5221f';help='빨간 글씨: 서로 다른 입력이 있습니다. 저장값과 입력값을 확인한 뒤 필요한 칸만 다시 입력하세요. 기다리기만 해서는 해결되지 않습니다.';}
  else if(/^(입력 확인:|이름 수정 대기:|군 변경 전 입력 확인|관리번호|화면 비교값|반영 중단:)/.test(text)){color='#b45309';help='주황 글씨: 확인이 필요합니다. 위 안내에 나온 칸을 수정하세요. 다른 칸이나 행 전체를 지우지 마세요.';}
  else if(/^다른 입력 처리 대기:/.test(text)){color='#1967d2';help='파란 글씨: 자동 반영을 기다리는 중입니다. 같은 내용을 다시 붙여넣지 마세요. 계속 남으면 담당자에게 알려 주세요.';}
  return {color:color,note:!text||text==='정상'?'':text+(help?'\n\n[입력 안내] '+help:'')};
}
function eventStatusNote_(cell,value){
  var style=eventStatusStyle_(value);
  if(style.note)cell.setNote(style.note);else cell.clearNote();
  cell.setFontColor(style.color);
}
/** 운영 중 수동/최초 실행도 표시만 변경한다. 동기화·정렬·행 확장을 호출하지 않는다. */
function eventRefreshStatusDisplay(){
  var real=SpreadsheetApp.getActive();if(!real.getSheets)return false;
  return eventWithLock_(eventPlainWrap_(real),function(){
    var visited={};
    eventViews_().forEach(function(name){
      var map=eventPlainMap_(name),physical=real.getSheetByName(map.physical);eventPlainConfigure_(physical,map);
      var start=map.offset+2,count=Math.min(map.limit-1,Math.max(0,physical.getLastRow()-start+1));
      if(count){var range=physical.getRange(start,3,count,1),notes=range.getNotes(),colors=range.getFontColors();
        notes.forEach(function(row,i){var wanted=eventStatusStyle_(row[0]);
          if(wanted.color==='#000000'&&row[0].indexOf('[입력 안내]')<0)return;
          if(wanted.note===row[0]&&wanted.color===String(colors[i][0]).toLowerCase())return;
          var cell=physical.getRange(start+i,3),fresh=cell.getNotes()[0][0];
          // 메모가 바뀌면 오래된 판단으로 덮지 않는다. 데이터 셀 값은 읽고 되쓰지 않는다.
          if(fresh===row[0])eventStatusNote_(cell,fresh);
        });
      }
      var headerRow=start-1,key=physical.getSheetId()+':'+headerRow;
      if(!visited[key]){var header=physical.getRange(headerRow,3),old=header.getNotes()[0][0]||'',tag='[입력 상태 색상]';
        var legend=tag+' 빨강: 충돌 확인 / 주황: 입력 확인 / 파랑: 자동 반영 대기. 이름 칸 메모에서 이유와 조치를 확인하세요. 노란 배경은 기존 중복 확인 표시입니다.';
        var next=old.indexOf(tag)>=0?old.split(tag)[0]+legend:(old?old+'\n\n':'')+legend;
        if(next!==old)header.setNote(next);visited[key]=true;
      }
    });
    PropertiesService.getScriptProperties().setProperty('EVENT_STATUS_REV','font-v1');
  },1,true);
}

function eventRefreshProjections_(ss){
    var cache={};eventViews_().forEach(function(name){var data=eventData_(ss.getSheetByName(name)),byId={};data.forEach(function(r,i){if(r[0]){byId[r[0]]=byId[r[0]]||[];byId[r[0]].push({row:i+2,values:r});}});cache[name]={byId:byId,nextRow:data.length+2};});
    var rawRows=eventData_(ss.getSheetByName(EVENT.raw));rawRows.forEach(function(row){var needs=eventViews_().some(function(name){var matches=cache[name].byId[row[0]]||[];if(!eventMember_(row,name))return matches.length>0;if(matches.length!==1)return true;var base=eventBaseline_(matches[0].values);return !base||Number(base[20])!==Number(row[20])||base[18]!==row[18];});if(needs)eventProject_(ss,row,'','*',cache);});
    eventRepairOrphans_(ss,cache,rawRows);
}

/** 이전 구역 밖에 남은, 수정되지 않은 중복 화면만 이력과 함께 정리한다. */
function eventRepairOrphans_(ss,cache,records){
  var byId={};records.forEach(function(r){byId[r[0]]=r;});
  EVENT.groups.forEach(function(g){var views=eventGroupViews_(g).map(function(n){return ss.getSheetByName(n);}),p=views[0].physical;if(!p)return;
    var count=p.getLastRow()-1;if(count<1)return;
    var data=p.getRange(2,1,count,32).getValues();
    views.forEach(function(sh){var m=sh.plainMap;data.forEach(function(row,i){var physicalRow=i+2,id=row[m.meta-1],canonical=byId[id];
      if(!canonical||canonical[21]||canonical[2]!==g||!canonical[m.registered?14:13])return;
      if(physicalRow>=m.offset+2&&physicalRow<=m.offset+m.limit)return;
      if(row[(m.registered?29:31)-1])return;
      if(!(cache[m.name].byId[id]||[]).length)return;
      var n=physicalRow-m.offset,before=sh.getRange(n,1,1,22).getValues()[0],base=eventBaseline_(before);if(!base||base[0]!==id)return;
      var dirty=m.cols.some(function(c){return c>=0&&(m.registered||c!==4)&&!eventEqual_(before[c],base[c]);});
      if(dirty){sh.getRange(n,19).setValue('입력 확인: 입력 범위 밖 중복 행에 수정이 남아 있습니다. 확인 전까지 보존합니다.');return;}
      eventAudit_(ss,'범위 밖 중복 화면 정리',m.name,before,canonical,'원본과 입력 범위 안의 기록을 유지함');
      var fresh=sh.getRange(n,1,1,22).getValues()[0];if(JSON.stringify(fresh)!==JSON.stringify(before))return;
      sh.getRange(n,1,1,22).clearContent();
    });});
  });
}
/** 운영 복구: 저장번호가 없는 입력만 먼저 연결한다. 기존 수정/충돌은 보존한다. */
function eventImportUnsaved(){
 var props=PropertiesService.getScriptProperties(),request=Utilities.getUuid();
 props.setProperty('EVENT_UNSAVED_REQUEST',request);props.setProperty('EVENT_SYNC_DIRTY',request);
 var ss=eventPlainWrap_(SpreadsheetApp.getActive());
 return eventWithLock_(ss,function(){
  var result=eventDrainUnsaved_(ss,20000);
  if(result.complete&&props.getProperty('EVENT_UNSAVED_REQUEST')===request)props.deleteProperty('EVENT_UNSAVED_REQUEST');
  return result.complete;
 },1000,true);
}
/** 신규 복구는 잠금을 얻은 실행 안에서 이어 간다. 속성에는 행 위치와 시각만 둔다. */
function eventDrainUnsaved_(ss,budget){
 var props=PropertiesService.getScriptProperties(),jobs=[],seen={},tick=Date.now();
 eventViews_().forEach(function(name){var sheet=ss.getSheetByName(name);eventData_(sheet).forEach(function(row,i){
  if(row[0]||!eventText_(row[5]))return;
  var key='EVENT_UNSAVED_AT_'+name+'|'+(i+2),saved=props.getProperty(key),state=saved?JSON.parse(saved):{first:Number(props.getProperty('EVENT_REPAIR_SEEN_'+name+'|row:'+(i+2))||0)||tick,last:0};
  if(!saved)props.setProperty(key,JSON.stringify(state));seen[key]=true;jobs.push({name:name,row:i+2,key:key,state:state});
 });});
 Object.keys(props.getProperties()).forEach(function(key){if(key.indexOf('EVENT_UNSAVED_AT_')===0&&!seen[key])props.deleteProperty(key);});
 jobs.sort(function(a,b){return a.state.last-b.state.last||a.state.first-b.state.first;});
 var started=Date.now(),processed=0,complete=true,touched={},cols=[];for(var c=1;c<=17;c++)cols.push(c);
 for(var i=0;i<jobs.length;i++){
  if(processed&&Date.now()-started>=budget){complete=false;break;}
  var job=jobs[i],sheet=ss.getSheetByName(job.name),fresh=sheet.getRange(job.row,1,1,22).getValues()[0];
  if(fresh[0]||!eventText_(fresh[5])){props.deleteProperty(job.key);continue;}
  job.state.last=Date.now();props.setProperty(job.key,JSON.stringify(job.state));processed++;
  var registered=eventRegisteredView_(job.name),target=eventStoredGroup_(fresh[2]||eventGroup_(job.name)||'기타');
  touched[job.name]=true;touched[registered?EVENT.registrations:EVENT.visitors]=true;
  if(EVENT.groups.indexOf(target)>=0)touched[eventGroupViews_(target)[registered?1:0]]=true;
  try{eventProcessRow_(ss,sheet,job.row,cols,undefined,false);}catch(err){sheet.getRange(job.row,19).setValue('입력 확인: '+err.message);}
 }
 if(processed)eventPlainLabels_({labelNames:touched,getSheetByName:ss.getSheetByName},true);
 console.log('신규 입력 우선 확인 '+processed+'건'+(complete?'':' / 다음 자동 확인에서 계속'));
 return {complete:complete,processed:processed};
}
/** 번호가 있는 화면은 보존하고 저장된 번호의 화면 누락만 복구한다. */
function eventRestoreMissing_(ss,budget){
 var cache={},names=eventViews_(),jobs=[],touched={};
 names.forEach(function(name){var data=eventData_(ss.getSheetByName(name)),byId={};data.forEach(function(row,i){if(row[0]){byId[row[0]]=byId[row[0]]||[];byId[row[0]].push({row:i+2,values:row});}});cache[name]={byId:byId,nextRow:data.length+2};});
 eventData_(ss.getSheetByName(EVENT.raw)).forEach(function(row){names.forEach(function(name){if(eventMember_(row,name)&&!cache[name].byId[row[0]])jobs.push({record:row,name:name});});});
 var started=Date.now(),processed=0,complete=true;
 for(var i=0;i<jobs.length;i++){
  if(processed&&Date.now()-started>=budget){complete=false;break;}
  var job=jobs[i];eventProject_(ss,job.record,'','*',cache,[job.name]);processed++;touched[job.name]=true;
 }
 if(processed)eventPlainLabels_({labelNames:touched,getSheetByName:ss.getSheetByName},true);
 if(processed)console.log('저장된 명단의 화면 누락 복구 '+processed+'건');
 return {complete:complete,processed:processed};
}

/** 명단 행 구조와 관리번호를 기억한다. 이름·연락처는 속성에 저장하지 않는다. */
var EVENT_STRUCTURE_CONTEXT=null;
function eventStructureSheets_(real){return [EVENT.visitors,EVENT.registrations].concat(EVENT.groups).map(function(n){return real.getSheetByName(n);}).filter(Boolean);}
function eventStructureLoad_(p){var props=PropertiesService.getScriptProperties(),key='EVENT_STRUCT_'+p.getSheetId(),text=props.getProperty(key);if(!text)return null;var state=JSON.parse(text);state.ids=[];for(var i=0;i<state.parts;i++){var part=props.getProperty(key+'_'+state.rev+'_'+i);if(!part)throw new Error('행 변경 기억을 확인해 주세요.');state.ids=state.ids.concat(JSON.parse(part));}return state;}
function eventStructureCapture_(p){var max=p.getMaxRows(),n=Math.max(0,p.getLastRow()-1),rows=n?p.getRange(2,29,n,4).getValues():[],ids=[],group=EVENT.groups.indexOf(p.getName())>=0;rows.forEach(function(r){if(r[0])ids.push([r[0],!group&&p.getName()===EVENT.registrations?'등록':'방문']);if(group&&r[2])ids.push([r[2],'등록']);});if(p.getMaxRows()!==max)throw new Error('행 위치가 변경되어 다시 확인합니다.');return {rows:max,ids:ids};}
function eventStructureSave_(p,state){var props=PropertiesService.getScriptProperties(),key='EVENT_STRUCT_'+p.getSheetId(),old=props.getProperty(key),rev=Utilities.getUuid(),parts=Math.ceil(state.ids.length/100);for(var i=0;i<parts;i++)props.setProperty(key+'_'+rev+'_'+i,JSON.stringify(state.ids.slice(i*100,(i+1)*100)));props.setProperty(key,JSON.stringify({rows:state.rows,parts:parts,rev:rev}));if(old){var previous=JSON.parse(old);for(var j=0;j<previous.parts;j++)props.deleteProperty(key+'_'+previous.rev+'_'+j);}}
function eventStructureGuard_(p){var ctx=EVENT_STRUCTURE_CONTEXT;if(ctx&&ctx.expected[p.getSheetId()]!==undefined&&p.getMaxRows()!==ctx.expected[p.getSheetId()]){PropertiesService.getScriptProperties().setProperty('EVENT_SYNC_DIRTY',String(Date.now())+'-rows');throw new Error('행 위치가 변경되어 입력을 보존하고 다시 확인합니다.');}}
function eventStructureTouch_(p,immediate){var ctx=EVENT_STRUCTURE_CONTEXT;if(!ctx)return;eventStructureGuard_(p);ctx.touched[p.getSheetId()]=p;if(immediate)eventStructureSave_(p,eventStructureCapture_(p));}
function eventStructureOwnResize_(p,delta){var ctx=EVENT_STRUCTURE_CONTEXT;if(!ctx)return;if(p.getMaxRows()!==ctx.expected[p.getSheetId()]+delta)throw new Error('행 추가 중 다른 변경이 있어 다시 확인합니다.');ctx.expected[p.getSheetId()]+=delta;eventStructureTouch_(p,true);}
function eventStructureBegin_(ss){var props=PropertiesService.getScriptProperties();if(ss.real&&props.getProperty('EVENT_STRUCT_REQUESTED')==='v1'&&props.getProperty('EVENT_STRUCT_ENABLED')!=='v1'){eventStructureSheets_(ss.real).forEach(function(p){eventStructureSave_(p,eventStructureCapture_(p));});props.setProperty('EVENT_STRUCT_ENABLED','v1');props.deleteProperty('EVENT_STRUCT_REQUESTED');console.log('행 변경 기준 저장 완료');}if(!ss.real||props.getProperty('EVENT_STRUCT_ENABLED')!=='v1')return;var physical=eventStructureSheets_(ss.real),ctx={expected:{},touched:{},real:ss.real},remove=props.getProperty('EVENT_STRUCT_REMOVE'),cancellations={},changed=[];
 physical.forEach(function(p){ctx.expected[p.getSheetId()]=p.getMaxRows();});EVENT_STRUCTURE_CONTEXT=ctx;
 physical.forEach(function(p){var old=eventStructureLoad_(p);if(!old){eventStructureSave_(p,eventStructureCapture_(p));return;}if(old.rows===p.getMaxRows()&&!remove)return;var now=eventStructureCapture_(p),present={};now.ids.forEach(function(x){present[x[0]]=true;});if(now.rows<old.rows||remove)old.ids.forEach(function(x){if(!present[x[0]])cancellations[x[0]]={source:p.getName(),kind:x[1]};});changed.push({p:p,state:now});});
 changed.forEach(function(x){eventStructureValidate_(x.p);});
 var raw=ss.getSheetByName(EVENT.raw),records=eventData_(raw),cancelled=[];records.forEach(function(before,i){var lost=cancellations[before[0]];if(!lost||before[21]||!before[lost.kind==='등록'?14:13]||(EVENT.groups.indexOf(lost.source)>=0&&before[2]!==lost.source))return;var after=before.slice();after[21]=true;after[19]=eventNow_();after[20]=Number(before[20])+1;eventAudit_(ss,'행 삭제',lost.source,before,after,'실제 행 구조 변화와 사라진 관리번호 확인');eventWrite_(raw.getRange(i+2,1,1,22),[after]);cancelled.push(after);});
 changed.forEach(function(x){eventStructureSave_(x.p,x.state);ctx.touched[x.p.getSheetId()]=x.p;});if(remove)props.deleteProperty('EVENT_STRUCT_REMOVE');
 changed.forEach(function(x){eventStructureRepairRanges_(x.p);});
 cancelled.forEach(function(r){eventProject_(ss,r,r[2],'*');});
}
function eventStructureFinish_(){var ctx=EVENT_STRUCTURE_CONTEXT;if(!ctx)return;try{Object.keys(ctx.touched).forEach(function(k){var p=ctx.touched[k];if(p.getMaxRows()===ctx.expected[k])eventStructureSave_(p,eventStructureCapture_(p));});}finally{EVENT_STRUCTURE_CONTEXT=null;}}
function eventStructureHasChanges_(real){if(!real.getSheets||PropertiesService.getScriptProperties().getProperty('EVENT_STRUCT_ENABLED')!=='v1')return false;return eventStructureSheets_(real).some(function(p){var old=eventStructureLoad_(p);return old&&old.rows!==p.getMaxRows();});}
function eventEnableStructureTracking(){var props=PropertiesService.getScriptProperties();if(props.getProperty('EVENT_STRUCT_ENABLED')==='v1'){console.log('행 변경 추적 활성 상태 확인');return true;}props.setProperty('EVENT_STRUCT_REQUESTED','v1');props.setProperty('EVENT_SYNC_DIRTY',String(Date.now())+'-structure-init');var done=eventWithLock_(eventPlainWrap_(SpreadsheetApp.getActive()),function(){},1000,true);console.log(done?'행 변경 기준 저장 완료':'행 변경 설정 대기: 다음 자동 처리에서 기준 저장');return done;}
function eventOnChange(e){if(!e||!e.source||!['INSERT_ROW','REMOVE_ROW'].includes(e.changeType))return;var props=PropertiesService.getScriptProperties();if(e.changeType==='REMOVE_ROW')props.setProperty('EVENT_STRUCT_REMOVE',String(Date.now()));props.setProperty('EVENT_SYNC_DIRTY',String(Date.now())+'-structure');var ss=eventPlainWrap_(e.source);eventWithLock_(ss,function(){eventPlainLabels_(ss,false,true);},15000,true);}
function eventStructureRepairRanges_(p){
 var real=p.getParent(),group=EVENT.groups.indexOf(p.getName())>=0;
 if(!group){if(p.getMaxRows()<2){p.insertRowsAfter(1,1);eventStructureOwnResize_(p,1);}return;}
 ['VISIT','REG'].forEach(function(kind,index){
  var data=p.getRange(1,1,Math.max(1,p.getLastRow()),13).getValues(),headers=[];
  data.forEach(function(r,i){if(eventText_(r[2]).replace(/\s/g,'')==='이름')headers.push(i+1);});
  if(headers.length!==2)throw new Error(p.getName()+': 머리글을 확인해 주세요. 명단 행만 추가·삭제할 수 있습니다.');
  var start=headers[index]+1,bound=index===0?headers[1]-1:data.length,footer=0,col=index===0?10:11;
  for(var r=start;r<=bound;r++)if(data[r-1]&&data[r-1][col]==='계')footer=r;
  if(!footer)throw new Error(p.getName()+': 계 위치를 확인해 주세요.');
  if(footer===start){p.insertRowsBefore(start,1);eventStructureOwnResize_(p,1);footer++;}
  var name='_EVENT_'+p.getSheetId()+'_'+kind,range=real.getRangeByName(name),length=footer-start;
  if(!range||range.getRow()!==start||range.getNumRows()!==length)real.setNamedRange(name,p.getRange(start,1,length,index===0?12:13));
 });
}

function eventStructureValidate_(p){
 var data=p.getRange(1,1,Math.max(1,p.getLastRow()),13).getValues(),headers=[];
 data.forEach(function(r,i){if(eventText_(r[2]).replace(/\s/g,'')==='이름')headers.push(i+1);});
 if(EVENT.groups.indexOf(p.getName())<0){if(eventText_(data[0][2]).replace(/\s/g,'')!=='이름')throw new Error(p.getName()+': 머리글 삭제를 확인해 주세요.');return;}
 if(headers.length!==2)throw new Error(p.getName()+': 머리글 삭제를 확인해 주세요.');
 headers.forEach(function(h,i){var end=i===0?headers[1]-1:data.length,found=false;for(var r=h+1;r<=end;r++)if(data[r-1][i===0?10:11]==='계')found=true;if(!found)throw new Error(p.getName()+': 계 행 삭제를 확인해 주세요.');});
}

/** 운영자가 요청한 군별 기준 정리. 군별 본문은 읽기만 한다. */
function eventUseArmyAsBasis(){
 var props=PropertiesService.getScriptProperties();props.setProperty('EVENT_ARMY_BASIS_REQUEST',Utilities.getUuid());props.setProperty('EVENT_SYNC_DIRTY',Utilities.getUuid());
 EVENT_ARMY_BASIS_EXEC=true;try{return eventWithLock_(eventPlainWrap_(SpreadsheetApp.getActive()),function(){},1000,true);}finally{EVENT_ARMY_BASIS_EXEC=false;}
}
function eventReconcileArmyBasis_(ss){
 var props=PropertiesService.getScriptProperties(),request=props.getProperty('EVENT_ARMY_BASIS_REQUEST'),raw=ss.getSheetByName(EVENT.raw),old=eventData_(raw),records=old.map(function(r){return r.slice();}),used={},sources=[],cards=[],logs=[],journalKeys=Object.keys(props.getProperties()).filter(function(k){return k.indexOf('EVENT_EDIT_')===0;});
 function same(a,b){return JSON.stringify(a)===JSON.stringify(b);}
 function identity(r){return JSON.stringify([eventText_(r[5]),String(r[9]||'').replace(/\D/g,''),eventStoredGroup_(r[2]),eventText_(r[3]),eventText_(r[12])]);}
 EVENT.groups.forEach(function(g){eventGroupViews_(g).forEach(function(name){var sh=ss.getSheetByName(name),rows=eventData_(sh),m=sh.plainMap;if(!m)return;
  var physical=sh.physical,start=m.offset+2,count=rows.length,body=count?physical.getRange(start,2,count,12).getValues():[],meta=count?physical.getRange(start,m.meta,count,2).getValues():[];
  sources.push({sh:sh,p:physical,map:m,start:start,rows:rows,body:body,meta:meta});
  rows.forEach(function(input,i){if(!eventText_(input[5]))return;var reg=eventRegisteredView_(name),r=input.slice(0,22);r[1]=EVENT.date;r[2]=g;r[13]=!reg;r[14]=reg;r[15]=false;r[21]=false;
   var key=identity(r),matches=records.map(function(v,j){return {r:v,index:j};}).filter(function(x){return !x.r[21]&&!used[x.r[0]]&&!!x.r[reg?14:13]&&identity(x.r)===key;}),found=matches.find(function(x){return x.r[0]===input[0];})||matches[0],index=found?found.index:records.length;
   r[0]=found?found.r[0]:(input[0]&&!used[input[0]]&&!records.some(function(v){return v[0]===input[0];})?input[0]:Utilities.getUuid());r[18]='정상';r[19]=eventNow_();r[20]=found?(Number(found.r[20])||0)+1:1;used[r[0]]=true;records[index]=r;cards.push({source:sources[sources.length-1],offset:i,record:r,registered:reg});
  });
 });});
 // 원본을 바꾸기 전에 군별 본문과 메타가 처음 읽은 상태인지 확인한다.
 sources.forEach(function(s){eventStructureGuard_(s.p);if(s.rows.length&&(!same(s.body,s.p.getRange(s.start,2,s.rows.length,12).getValues())||!same(s.meta,s.p.getRange(s.start,s.map.meta,s.rows.length,2).getValues())))throw new Error('군별 입력이 변경되어 다음 확인에서 다시 정리합니다.');});
 var now=eventNow_();old.forEach(function(r,i){if(!r[21]&&!used[r[0]]){var cancelled=r.slice();cancelled[21]=true;cancelled[19]=now;cancelled[20]=(Number(r[20])||0)+1;records[i]=cancelled;logs.push([now,'군 기준 제외','군별 기준',r[0],JSON.stringify(r),JSON.stringify(cancelled),'군별 명단에 없어 전체에서 제외']);}});
 // 새 번호를 먼저 군별 메타에 남긴다. 중단돼도 다음 회차가 같은 번호를 재사용한다.
 sources.forEach(function(s){s.rows.forEach(function(r,i){if(!eventText_(r[5]))s.meta[i]=['',''];});});
 cards.forEach(function(c){var s=c.source;s.meta[c.offset]=[c.record[0],JSON.stringify(c.record.slice(0,21))];});
 sources.forEach(function(s){if(!s.rows.length)return;eventStructureGuard_(s.p);s.p.getRange(s.start,s.map.meta,s.rows.length,2).setValues(s.meta);eventStructureTouch_(s.p,true);});
 old.forEach(function(r,i){if(used[r[0]]&&!same(r,records[i]))logs.push([now,'군 기준 정보 적용','군별 기준',r[0],JSON.stringify(r),JSON.stringify(records[i]),'군별 현재 입력 우선']);});
 if(records.length)eventWrite_(raw.getRange(2,1,records.length,22),records);
 if(logs.length){var log=ss.getSheetByName(EVENT.log);log.getRange(log.getLastRow()+1,1,logs.length,7).setValues(logs);}
 // 전체 화면은 군별 현재 기록으로 다시 표시한다. 다른 입력이 바뀌면 다음 회차에 재시도한다.
 [false,true].forEach(function(reg){var name=reg?EVENT.registrations:EVENT.visitors,p=ss.getSheetByName(name).physical,list=cards.filter(function(c){return c.registered===reg;}),count=Math.max(p.getLastRow()-1,list.length),before=count?p.getRange(2,1,count,32).getValues():[],after=before.map(function(r){return r.slice();});
  if(!count)return;
  for(var i=0;i<count;i++){var row=after[i];for(var j=0;j<(reg?13:12);j++)row[j]='';row[28]='';row[29]='';if(i<list.length){var rec=list[i].record,map=eventPlainMap_(name);map.cols.forEach(function(c,k){row[k]=c<0?i+1:c===2?eventDisplayGroup_(rec[c]):!reg&&c===4?'-':rec[c];});row[28]=rec[0];row[29]=JSON.stringify(rec.slice(0,21));}}
  var formulas=p.getRange(2,1,count,32).getFormulas();after=after.map(function(r,i){var safe=eventSafeValues_(r);formulas[i].forEach(function(f,j){if(f&&j>=(reg?13:12)&&j!==28&&j!==29)safe[j]=f;});return safe;});
  eventStructureGuard_(p);if(!same(before,p.getRange(2,1,count,32).getValues()))throw new Error('전체 입력이 변경되어 다음 확인에서 다시 정리합니다.');var history=before.map(function(r,i){return [now,'군 기준 전체 교체',name,r[28]||'',JSON.stringify(r),'','기존 전체 '+(i+2)+'행 보관'];});var audit=ss.getSheetByName(EVENT.log);audit.getRange(audit.getLastRow()+1,1,history.length,7).setValues(history);
  p.getRange(2,1,count,32).setValues(after);eventStructureTouch_(p,true);
  var check=p.getRange(2,1,count,32).getValues();if(check.some(function(r,i){return r.some(function(v,j){return !(typeof after[i][j]==='string'&&after[i][j].charAt(0)==='=')&&!eventEqual_(v,after[i][j]);});}))throw new Error('전체 반영 뒤 새 입력이 있어 다시 확인합니다.');
 });
 // 정리 전 전체 명단의 미처리 편집은 군별 기준으로 대체됐음을 남긴다.
 journalKeys.forEach(function(k){props.deleteProperty(k);});
 if(props.getProperty('EVENT_ARMY_BASIS_REQUEST')===request)props.deleteProperty('EVENT_ARMY_BASIS_REQUEST');props.setProperty('EVENT_SYNC_DIRTY',Utilities.getUuid());
 console.log('군별 기준 정리 완료: 방문 '+cards.filter(function(c){return !c.registered;}).length+'건, 등록 '+cards.filter(function(c){return c.registered;}).length+'건, 제외 '+logs.filter(function(r){return r[1]==='군 기준 제외';}).length+'건');return true;
}
/** 확인 완료된 연결의 오래된 안내만 현재 원본 기준으로 다시 계산한다. */
function eventRefreshBasisNotes(){
 var ss=eventPlainWrap_(SpreadsheetApp.getActive());return eventWithLock_(ss,function(){var records=eventData_(ss.getSheetByName(EVENT.raw)),byId={};records.forEach(function(r){if(!r[21])byId[r[0]]=r;});var count=0;
 eventViews_().forEach(function(name){var sh=ss.getSheetByName(name);if(!sh.plainMap)return;eventData_(sh).forEach(function(row,i){var r=byId[row[0]],old=eventText_(row[18]).split('\n\n[입력 안내]')[0];if(!r||eventHasDirty_(row)||eventKey_(row)!==eventKey_(r))return;if(old&&!/^(정상|입력 확인:|충돌:|다른 입력 처리 대기:|연락처 확인:|동일인 중복 확인|같은 전화번호|동명이인 확인|방문·등록 각각 입력됨|군 변경 전|이름 수정 대기|관리번호|화면 비교값)/.test(old))return;var health=eventHealth_(r,records);if(old===health||(!old&&health==='정상'))return;sh.getRange(i+2,19).setValue(health);count++;});});console.log('현재 군별 기준의 오류·중복 안내 재확인 '+count+'행');return true;},180000,true);
}
