/** @OnlyCurrentDoc */
/** 2026-11-01 당일 파일 전용. 기존 등록/메일 프로젝트와 분리된 container-bound script. */
var EVENT = Object.freeze({date:'2026-11-01', firstRow:2, width:22,
  groups:['신군','조군','명군','총군','영군','석군','전군','임군','슬군','기타'],
  visitors:'총 방문 새가족', registrations:'총 등록 새가족', raw:'_원본', log:'_변경기록', conflicts:'_충돌',
  headers:['관리번호','날짜','군','팀','순','이름','성별','나이','생년월일','휴대폰','주소','인도자','예배(부)','방문','등록','결신','등록경로','비고','확인사항','수정시각','버전','화면 비교값']});

function onOpen() {
  SpreadsheetApp.getUi().createMenu('행축 명단')
    .addItem('대기 입력 처리·전체 다시 맞추기','eventRepair')
    .addSeparator().addItem('선택 행의 충돌 입력 적용','eventAcceptConflict')
    .addItem('선택 행을 저장된 값으로 복원','eventRestoreRow')
    .addSeparator().addItem('선택 기록 취소(이력 보관)','eventCancel')
    .addItem('마지막 취소 복구','eventUndoCancel').addToUi();
}
function eventViews_() { return [EVENT.visitors,EVENT.registrations].concat(EVENT.groups); }
function eventIsView_(name) { return eventViews_().indexOf(name)>=0; }
function eventText_(v) { return v===null||v===undefined?'':String(v).trim(); }
function eventEqual_(a,b) { return eventText_(a)===eventText_(b); }
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
    else if(col===2){v=eventText_(v)|| (EVENT.groups.indexOf(source)>=0?source:'기타');if(v!=='기타'&&!/군$/.test(v))v+='군';if(EVENT.groups.indexOf(v)<0)throw new Error('군은 목록에서 선택해 주세요.');}
    else if(col===9)v=eventPhone_(v);
    else if(col>=13&&col<=15)v=eventBool_(v);
    else if(col===7){if(v!==''&&v!==null){v=Number(v);if(!Number.isInteger(v)||v<0||v>120)throw new Error('나이는 0~120 사이 정수로 입력해 주세요.');}else v='';}
    else if(col===8){v=eventText_(v);if(v){var birth=v.replace(/[-./]/g,'');if(!/^\d{8}$/.test(birth))throw new Error('생년월일은 YYYYMMDD로 입력해 주세요.');var y=+birth.slice(0,4),m=+birth.slice(4,6),d=+birth.slice(6,8),date=new Date(Date.UTC(y,m-1,d));if(date.getUTCFullYear()!==y||date.getUTCMonth()+1!==m||date.getUTCDate()!==d||birth>'20261101'||y<1900)throw new Error('생년월일 날짜를 확인해 주세요.');v=birth;}}
    else {v=eventText_(v);if(v.length>2000)throw new Error('한 칸은 2,000자 이내로 입력해 주세요.');if(col===6&&v&&['남','여'].indexOf(v)<0)throw new Error('성별은 남·여 또는 빈칸으로 입력해 주세요.');}
    if(!force&&baseline&&!eventEqual_(baseline[col],canonical[col])&&!eventEqual_(v,canonical[col]))conflicts.push({column:col,base:baseline[col],stored:canonical[col],input:v});
    else row[col]=v;
  });
  if(!eventText_(row[5]))throw new Error('이름은 비울 수 없습니다. 기록 취소는 행축 명단 메뉴를 사용해 주세요.');
  row[1]=row[1]||EVENT.date;row[2]=row[2]||'기타';
  if(row[14])row[13]=true;
  return {row:row,conflicts:conflicts};
}
/** 화면에 아직 처리하지 않은 입력이 있으면 그 칸과 이전 비교값을 보존한다. */
function eventProjection_(current, baseline, desired) {
  var values=current.slice(),base=baseline.slice(),pending=false;
  for(var c=0;c<21;c++){
    if(c>=1&&c<=17&&!eventEqual_(current[c],baseline[c])&&!eventEqual_(current[c],desired[c])){pending=true;continue;}
    values[c]=desired[c];base[c]=desired[c];
  }
  if(pending)values[18]='입력 처리 대기: 메뉴에서 다시 맞추기';
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
  var notes=[];if(!row[9])notes.push('연락처 확인');
  var key=eventKey_(row),phone=eventText_(row[9]).replace(/\D/g,''),name=eventText_(row[5]).replace(/\s/g,'');
  records.forEach(function(other){if(other[0]===row[0]||other[21])return;
    if(phone&&phone===eventText_(other[9]).replace(/\D/g,''))notes.push(key===eventKey_(other)?'동일인 중복 확인':'같은 전화번호의 다른 이름 확인');
    else if(name===eventText_(other[5]).replace(/\s/g,''))notes.push('동명이인 확인');
  });
  return Array.from(new Set(notes)).join(' / ')||'정상';
}
function eventHasDirty_(row){var base=eventBaseline_(row);return !!base&&row.slice(1,18).some(function(v,i){return !eventEqual_(v,base[i+1]);});}
function eventMember_(row,name){if(row[21])return false;if(name===EVENT.visitors)return !!row[13];if(name===EVENT.registrations)return !!row[14];return row[2]===name;}
function eventFind_(sheet,id){
  var data=eventData_(sheet),matches=[];data.forEach(function(r,i){if(r[0]===id)matches.push({row:i+2,values:r});});return matches;
}
function eventProject_(ss,record,oldGroup,sourceName,cache) {
  var names=(sourceName==='*'?eventViews_():[EVENT.visitors,EVENT.registrations,record[2],oldGroup,sourceName]).filter(function(n,i,a){return eventIsView_(n)&&a.indexOf(n)===i;});
  names.forEach(function(name){
    var sheet=ss.getSheetByName(name);if(!sheet)throw new Error('필수 탭이 없습니다: '+name);
    var matches=cache?(cache[name].byId[record[0]]||[]):eventFind_(sheet,record[0]);
    matches=matches.map(function(item){return {row:item.row,values:sheet.getRange(item.row,1,1,EVENT.width).getValues()[0]};});
    if(matches.length>1)throw new Error(name+': 관리번호가 복사되었습니다. 저장값 복원 메뉴로 확인해 주세요.');
    if(!eventMember_(record,name)){
      matches.forEach(function(item){
        if(eventHasDirty_(item.values)){if(record[21])eventAudit_(ss,'취소 전 대기 입력 보관',name,item.values,record,'화면에서 제외하기 전 입력값을 보관함');else {sheet.getRange(item.row,19).setValue('입력 처리 대기: 소속 변경 확인');return;}}
        sheet.getRange(item.row,1,1,EVENT.width).clearContent();
      });return;
    }
    if(!matches.length){var dest=cache?cache[name].nextRow:Math.max(2,eventData_(sheet).length+2);
      while(dest<=sheet.getMaxRows()&&sheet.getRange(dest,1,1,EVENT.width).getValues()[0].some(function(v){return v!==''&&v!==false&&v!==null&&v!==undefined;}))dest++;
      if(dest>sheet.getMaxRows())sheet.insertRowsAfter(sheet.getMaxRows(),100);
      var full=record.slice(0,21);full[21]=JSON.stringify(record.slice(0,21));eventWrite_(sheet.getRange(dest,1,1,EVENT.width),[full]);if(cache){cache[name].byId[record[0]]=[{row:dest,values:full}];cache[name].nextRow=dest+1;}return;}
    var item=matches[0],baseline=eventBaseline_(item.values);
    if(!baseline){sheet.getRange(item.row,19).setValue('화면 비교값 손상: 저장값 복원 필요');return;}
    var p=eventProjection_(item.values,baseline,record);
    // 쓰기 직전 다시 읽어 중간에 입력된 값을 항목별로 보존한다.
    var fresh=sheet.getRange(item.row,1,1,EVENT.width).getValues()[0];
    for(var c=1;c<=17;c++)if(!eventEqual_(fresh[c],item.values[c])){p.values[c]=fresh[c];p.baseline[c]=baseline[c];p.pending=true;}
    if(p.pending)p.values[18]='입력 처리 대기: 메뉴에서 다시 맞추기';
    p.values[21]=JSON.stringify(p.baseline.slice(0,21));
    // 입력 열은 실제로 갱신이 필요한 칸만 쓴다. 대기 중인 다른 칸은 쓰지 않는다.
    for(var j=0;j<EVENT.width;j++)if(!eventEqual_(fresh[j],p.values[j]))eventWrite_(sheet.getRange(item.row,j+1,1,1),[[p.values[j]]]);
  });
}
function eventProcessRow_(ss,sheet,rowNumber,columns,oneValue,force) {
  var raw=ss.getSheetByName(EVENT.raw),records=eventData_(raw),input=sheet.getRange(rowNumber,1,1,EVENT.width).getValues()[0],base=eventBaseline_(input),isNew=!input[0];
  if(isNew&&!eventText_(input[5])){sheet.getRange(rowNumber,19).setValue('이름 입력 후 자동 연결');return;}
  var mergedFrom=null;
  var existingIndex=records.findIndex(function(r){return r[0]===input[0];}),candidate,patch={};
  if(!isNew&&existingIndex<0){sheet.getRange(rowNumber,19).setValue('관리번호 확인 필요: 새 기록은 관리번호를 붙여넣지 마세요.');return;}
  if(!isNew&&!base){sheet.getRange(rowNumber,19).setValue('화면 비교값 손상: 저장값 복원 필요');return;}
  if(!isNew&&eventFind_(sheet,input[0]).length>1&&!/^충돌:/.test(eventText_(input[18]))){sheet.getRange(rowNumber,19).setValue('관리번호 중복: 전체 행 복사를 하지 마세요.');return;}
  if(isNew){
    candidate=Array(EVENT.width).fill('');candidate[0]=Utilities.getUuid();candidate[1]=EVENT.date;candidate[2]=EVENT.groups.indexOf(sheet.getName())>=0?sheet.getName():'기타';candidate[13]=true;candidate[14]=sheet.getName()===EVENT.registrations;candidate[15]=false;candidate[20]=0;candidate[21]=false;
    for(var c=1;c<=17;c++)if(input[c]!==''&&input[c]!==null)patch[c]=input[c];
    // 초기 체크박스 false는 전체 등록 탭의 기본 등록을 해제하지 않는다.
    patch[13]=true;
    if(sheet.getName()===EVENT.registrations&&input[14]!==true)patch[14]=true;
  }else{candidate=records[existingIndex];columns.forEach(function(c){if(c>=1&&c<=17)patch[c]=input[c];});}
  var planned=eventApplyPatch_(candidate,isNew?null:base,patch,sheet.getName(),force);
  // 이름을 먼저 쓴 뒤 전화번호를 채우는 입력도 같은 사람으로 연결한다.
  var key=eventKey_(planned.row),matches=key?records.map(function(r,i){return {r:r,i:i};}).filter(function(x){return !x.r[21]&&x.r[0]!==candidate[0]&&eventKey_(x.r)===key;}):[];
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
    merge[13]=true;if(sheet.getName()===EVENT.registrations)merge[14]=true;
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
    ss.getSheetByName(EVENT.conflicts).appendRow([eventNow_(),sheet.getName(),rowNumber,candidate[0],JSON.stringify(planned.conflicts),'미해결']);
    sheet.getRange(rowNumber,19).setValue('충돌: '+planned.conflicts.map(function(x){return EVENT.headers[x.column];}).join(', ')+' / 행축 명단 메뉴에서 선택');
    return;
  }
  var changed=isNew||!!mergedFrom||planned.row.slice(1,18).some(function(v,i){return !eventEqual_(v,candidate[i+1]);});
  var after=planned.row;after[0]=candidate[0];after[21]=false;after[18]=eventHealth_(after,records.filter(function(r){return !mergedFrom||r[0]!==mergedFrom.row[0];}));
  if(changed){after[19]=eventNow_();after[20]=(Number(candidate[20])||0)+1;
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
  eventProject_(ss,after,candidate[2],sheet.getName());
  ss.getSheetByName('사용 안내').getRange('B2').setValue('자동 연결 확인: '+eventNow_());
}
function eventWithLock_(ss,fn) {
  var lock=LockService.getDocumentLock();
  if(!lock.tryLock(5000)){ss.toast('다른 입력을 처리 중입니다. 입력값은 남아 있습니다. 행축 명단 → 전체 다시 맞추기를 사용해 주세요.','입력 대기',8);return false;}
  try{fn();SpreadsheetApp.flush();return true;}finally{lock.releaseLock();}
}
function onEdit(e) {
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
  });}catch(err){sheet.getRange(from,19).setValue('반영 중단: '+err.message+' / 메뉴에서 다시 맞추기');e.source.toast('입력값을 보존했습니다. 행축 명단 → 전체 다시 맞추기를 사용해 주세요.','자동 연결 확인',10);}
}
function eventRepair() {
  var ss=SpreadsheetApp.getActive();eventWithLock_(ss,function(){
    // Google 편집 이벤트가 빠졌거나 잠금을 기다린 입력을 먼저 처리한다.
    eventViews_().forEach(function(name){var sheet=ss.getSheetByName(name);eventData_(sheet).forEach(function(row,i){
      var base=eventBaseline_(row),cols=[];
      if(/^충돌:/.test(eventText_(row[18])))return;
      if(!row[0]){if(!eventText_(row[5]))return;for(var c=1;c<=17;c++)cols.push(c);}
      else if(base){for(var j=1;j<=17;j++)if(!eventEqual_(row[j],base[j]))cols.push(j);}
      if(!cols.length)return;
      try{eventProcessRow_(ss,sheet,i+2,cols,undefined,false);}catch(err){sheet.getRange(i+2,19).setValue('입력 확인: '+err.message);}
    });});
    var cache={};eventViews_().forEach(function(name){var data=eventData_(ss.getSheetByName(name)),byId={};data.forEach(function(r,i){if(r[0]){byId[r[0]]=byId[r[0]]||[];byId[r[0]].push({row:i+2,values:r});}});cache[name]={byId:byId,nextRow:data.length+2};});
    eventData_(ss.getSheetByName(EVENT.raw)).forEach(function(row){eventProject_(ss,row,'','*',cache);});
    ss.toast('대기 입력 처리와 명단 다시 맞추기를 완료했습니다. 확인사항 열도 확인해 주세요.','행축 명단',8);
  });
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
