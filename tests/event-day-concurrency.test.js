'use strict';
const assert=require('node:assert/strict');
const {createFixture}=require('./helpers/event-day-memory.cjs');
// Validates: REQ-EVENTDAYWORKBOOK-002, REQ-EVENTDAYWORKBOOK-003, REQ-EVENTDAYWORKBOOK-004, REQ-EVENTDAYWORKBOOK-006, REQ-EVENTDAYWORKBOOK-007, REQ-EVENTDAYWORKBOOK-008
let passed=0;
function test(name,fn){fn();passed++;console.log('통과: '+name);}
function verify(f){const records=f.raw().filter(r=>!r[21]);for(const name of ['총 방문 새가족','총 등록 새가족',...f.groups])for(const registered of f.groups.includes(name)?[false,true]:[name==='총 등록 새가족']){
 const got=f.visible(name,registered),want=records.filter(r=>r[registered?14:13]&&(!f.groups.includes(name)||r[2]===name));
 assert.deepEqual(got.map(r=>r.id).sort(),want.map(r=>r[0]).sort(),name+' 연결 집합');
 assert.equal(new Set(got.map(r=>r.id)).size,got.length,name+' 중복');
 got.forEach((r,i)=>{assert.equal(r.values[0],i+1,name+' 순번');assert.equal(r.values[8],want.find(x=>x[0]===r.id)[2].replace(/군$/,''),name+' 군');if(!registered)assert.equal(r.values[10],'-');});
}}
const person=(name,phone)=>[[name,'여',30,phone]];
test('등록 단독 입력은 방문 명단을 만들지 않는다',()=>{for(const name of ['총 등록 새가족','명군']){const f=createFixture();f.input(name,name==='명군'?27:2,3,person('등록전용','01011110000'));assert.equal(f.visible('총 방문 새가족').length,0);assert.equal(f.visible('명군').length,0);assert.equal(f.raw().filter(r=>!r[21]&&r[14]).length,1);verify(f);}});
test('방문·등록 양쪽에서 이름 비우기가 전체 삭제로 전파',()=>{for(const name of ['총 방문 새가족','명군']){const f=createFixture(),r=name==='명군'?3:2;f.input(name,r,3,person('방문삭제','01011110001'));f.input(name,r,3,'');assert.equal(f.raw().filter(r=>!r[21]).length,0);verify(f);}for(const name of ['총 등록 새가족','명군']){const f=createFixture(),r=name==='명군'?27:2;f.input(name,r,3,person('등록해제','01011110002'));f.input(name,r,3,'');assert.equal(f.raw().filter(r=>!r[21]).length,0);verify(f);}});
test('10개 군의 편집 이벤트가 모두 대기해도 추가 편집 없이 40명 연결',()=>{const f=createFixture();f.hold('long-running');for(const [i,g]of f.groups.entries()){f.input(g,3,3,[['방문'+i+'가','남',20,'010'+String(10000000+i*4)],['방문'+i+'나','여',21,'010'+String(10000001+i*4)]],'visitor-'+i);f.input(g,27,3,[['등록'+i+'가','남',22,'010'+String(10000002+i*4)],['등록'+i+'나','여',23,'010'+String(10000003+i*4)]],'registration-'+i);}assert.equal(f.raw().length,0);assert.equal(f.stats.lockDenied,20);f.release();f.repair();assert.equal(f.raw().filter(r=>!r[21]).length,40);assert.equal(f.visible('총 등록 새가족',true).length,20);verify(f);});
test('같은 사람의 서로 다른 칸 동시 수정은 함께 반영',()=>{const f=createFixture();f.input('명군',27,3,person('동시수정','01011110003'));f.hold('busy');f.input('명군',27,10,'새팀','editor-2');f.input('총 등록 새가족',2,7,'새주소','editor-3');f.release();f.repair();const r=f.raw().find(r=>!r[21]);assert.equal(r[3],'새팀');assert.equal(r[10],'새주소');verify(f);});
test('같은 칸 동시 수정은 충돌 표시와 양쪽 값 보존',()=>{const f=createFixture();f.input('명군',27,3,person('동시충돌','01011110004'));f.hold('busy');f.input('명군',27,10,'둘째팀','editor-2');f.input('총 등록 새가족',2,10,'첫째팀','editor-3');f.release();f.repair();const r=f.raw().find(r=>!r[21]);assert.equal(r[3],'첫째팀');assert.equal(f.visible('명군',true)[0].values[9],'둘째팀');assert.match(f.visible('명군',true)[0].note,/충돌:/);});
// 실제 쓰기가 반영된 뒤 응답이 실패하는 경우를 재현한다.
test('전화번호 없는 새 방문자의 원본 추가 직후 실패도 중복 없이 복구',()=>{const f=createFixture();let fired=false;f.setHook(e=>{if(!fired&&e.kind==='write'&&e.phase==='after'&&e.sheet==='_원본'){fired=true;throw Error('응답 유실');}});f.input('명군',3,3,'무전화시험');f.setHook(null);f.repair();assert.equal(fired,true);assert.equal(f.raw().filter(r=>!r[21]&&r[5]==='무전화시험').length,1);verify(f);});


test('신규 입력의 모든 쓰기 전후 중단 후 무전화 인물 한 명으로 복구',()=>{
 const probe=createFixture();let writes=0;probe.setHook(e=>{if(e.kind==='write'&&e.phase==='before')writes++;});probe.input('명군',3,3,'중단검사');
 let examined=0;
 for(const phase of ['before','after'])for(let at=1;at<=writes;at++){
  const f=createFixture();let seen=0,fired=false;f.setHook(e=>{if(e.kind==='write'&&e.phase===phase&&++seen===at){fired=true;throw Error('쓰기 경계 중단');}});
  try{f.input('명군',3,3,'중단검사');}catch(_){}f.setHook(null);f.repair();f.repair();
  assert.ok(fired,phase+' '+at+' 도달');assert.equal(f.raw().filter(r=>!r[21]&&r[5]==='중단검사').length,1,phase+' '+at+' 중복');verify(f);examined++;
 }
 assert.ok(examined>0);console.log('  쓰기 경계 '+examined+'개 검사');
});
test('방문 삭제의 모든 쓰기 전후 중단 후 전체·군에서 제거',()=>{
 function setup(){const f=createFixture();f.input('명군',3,3,person('삭제중단','01011110009'));return f;}
 const probe=setup();let writes=0;probe.setHook(e=>{if(e.kind==='write'&&e.phase==='before')writes++;});probe.input('명군',3,3,'');
 let examined=0;
 for(const phase of ['before','after'])for(let at=1;at<=writes;at++){
  const f=setup();let seen=0,fired=false;f.setHook(e=>{if(e.kind==='write'&&e.phase===phase&&++seen===at){fired=true;throw Error('삭제 경계 중단');}});
  try{f.input('명군',3,3,'');}catch(_){}f.setHook(null);f.repair();f.repair();
  assert.ok(fired);assert.equal(f.raw().filter(r=>!r[21]).length,0,phase+' '+at+' 삭제 복구');verify(f);examined++;
 }
 assert.ok(examined>0);console.log('  삭제 경계 '+examined+'개 검사');
});
test('실행 중 다른 군 담당자의 새 입력이 들어오면 대기 후 함께 반영',()=>{
 const probe=createFixture();let totalReads=0;probe.setHook(e=>{if(e.kind==='read'&&e.phase==='after')totalReads++;});probe.input('명군',3,3,person('먼저방문','01011110005'));
 assert.ok(totalReads>0);
 for(let point=1;point<=totalReads;point++){
  const f=createFixture();let reads=0,inserted=false;
  f.setHook(e=>{if(e.kind==='read'&&e.phase==='after'&&++reads===point){inserted=true;f.setHook(null);f.input('조군',27,3,person('겹친등록','01011110006'),'second-user');}});
  f.input('명군',3,3,person('먼저방문','01011110005'),'first-user');f.setHook(null);f.repair();f.repair();
  assert.ok(inserted,'중첩 위치 '+point);assert.ok(f.stats.lockDenied>0,'다른 편집자는 잠금을 얻지 못해야 한다');
  assert.equal(f.raw().filter(r=>!r[21]).length,2);verify(f);
 }
 console.log('  서로 다른 군 입력 중첩 시점 '+totalReads+'개 검사');
});


test('등록경로 네 값이 군·전체 양방향으로 연결되고 방문에는 추가하지 않는다',()=>{
 const f=createFixture();f.input('명군',27,3,person('등록경로검증','01011110008'));
 const wanted=['직접방문','설문지','관계','교인인도'];
 assert.deepEqual(f.sheets['명군'].validations?.['27,13']?.options,wanted,'군 등록 선택 목록');
 for(const [i,value]of wanted.entries()){if(i%2)f.input('총 등록 새가족',2,13,value);else f.input('명군',27,13,value);assert.equal(f.visible('총 등록 새가족',true)[0].values[12],value);assert.equal(f.visible('명군',true)[0].values[12],value);assert.equal(f.visible('총 방문 새가족').length,0);}
 f.input('명군',27,13,'임의입력');assert.equal(f.raw()[0][16],'교인인도');assert.match(f.visible('명군',true)[0].note,/입력 확인/);
});


test('전체 행 삭제로 숨김 연결 번호가 사라지면 삭제로 추측하지 않고 화면 복구',()=>{
 const f=createFixture();f.input('명군',3,3,person('행삭제경계','01011110010'));f.sheets['명군'].deleteRows(3,1);f.repair();assert.equal(f.raw().filter(r=>!r[21]).length,1);assert.equal(f.visible('명군')[0].values[2],'행삭제경계');verify(f);
});
test('등록 구역 확장 뒤 새 입력 칸까지 네 가지 선택 목록 유지',()=>{
 const f=createFixture();for(let i=0;i<12;i++){const row=f.book.getRangeByName('_EVENT_'+f.sheets['명군'].id+'_REG').getRow()+i;f.input('명군',row,3,person('확장'+i,'0103333'+String(1000+i)));}
 const region=f.book.getRangeByName('_EVENT_'+f.sheets['명군'].id+'_REG');assert.equal(region.nr,15);assert.deepEqual(f.sheets['명군'].validations[`${region.getLastRow()},13`].options,['직접방문','설문지','관계','교인인도']);assert.equal(f.visible('총 방문 새가족').length,0);verify(f);
});
test('화면·번호를 함께 저장해도 명단 밖 수식과 값 보존',()=>{
 const f=createFixture();f.sheets['총 방문 새가족'].getRange(2,20).setValue('=1+1');f.sheets['총 방문 새가족'].getRange(2,21).setValue('오른쪽 메모');f.input('명군',3,3,person('수식보존','01011110011'));assert.equal(f.sheets['총 방문 새가족'].getRange(2,20).getFormulas()[0][0],'=1+1');assert.equal(f.sheets['총 방문 새가족'].getRange(2,21).getValues()[0][0],'오른쪽 메모');verify(f);
});
test('서로 다른 50개 입력 순서에서 10군 병행 입력·삭제·군 이동 보존',()=>{
 let cases=0;
 for(let seed=1;seed<=50;seed++){
  const f=createFixture(),jobs=[],expected=[];let state=seed;
  const random=()=>{state=(state*1664525+1013904223)>>>0;return state/4294967296;};
  f.groups.forEach((g,i)=>{for(let j=0;j<4;j++){const registered=j>=2,name='시험'+i+'_'+j;expected.push(name);jobs.push({g,row:(registered?27:3)+(j%2),name,phone:'010'+String(40000000+i*4+j)});}});
  for(let i=jobs.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[jobs[i],jobs[j]]=[jobs[j],jobs[i]];}f.hold('busy');jobs.forEach((job,i)=>{f.input(job.g,job.row,3,person(job.name,job.phone),'user-'+i);if(i%9===8){f.release();f.repair();f.hold('busy');}});f.release();f.repair();verify(f);
  assert.deepEqual(f.raw().filter(r=>!r[21]).map(r=>r[5]).sort(),expected.sort(),'seed '+seed+' 인물');
  f.hold('busy');for(const job of jobs.slice(0,10)){const registered=job.row>=27,entry=f.visible(job.g,registered).find(r=>r.values[2]===job.name);f.input(job.g,entry.row,3,'','delete-'+job.name);expected.splice(expected.indexOf(job.name),1);}f.release();f.repair();verify(f);
  assert.deepEqual(f.raw().filter(r=>!r[21]).map(r=>r[5]).sort(),expected.sort(),'seed '+seed+' 삭제');
  const move=f.visible('총 방문 새가족')[0];if(move){f.input('총 방문 새가족',move.row,9,'임');verify(f);}cases+=40;
 }
 assert.equal(cases,2000);console.log('  50개 순서·2000명 입력과 500명 삭제 검사');
});


test('같은 사람을 다른 군에서 입력하면 두 행을 보존하고 양쪽 경고',()=>{
 const f=createFixture();f.hold('busy');f.input('명군',3,3,person('같은사람','01011110012'),'first');f.input('총군',27,3,person('같은사람','01011110012'),'second');f.release();f.repair();assert.equal(f.raw().filter(r=>!r[21]).length,2);assert.equal(f.visible('총 방문 새가족').length,1);assert.equal(f.visible('총 등록 새가족',true).length,1);assert.match(f.visible('명군')[0].note,/동일인 중복/);assert.match(f.visible('총군',true)[0].note,/동일인 중복/);verify(f);
});
test('같은 군의 다른 팀도 두 행 보존하고 같은 소속 방문·등록만 연결',()=>{
 const f=createFixture();const v=person('팀중복','01011110015')[0];f.input('명군',3,3,[v.concat(['','','명','첫팀'])]);f.input('명군',4,3,[v.concat(['','','명','둘팀'])]);f.input('명군',27,3,[v.concat(['','','명','첫팀'])]);f.repair();assert.equal(f.raw().filter(r=>!r[21]).length,2);assert.equal(f.visible('명군')[0].id,f.visible('명군',true)[0].id);assert.match(f.visible('명군')[0].note,/동일인 중복/);const rules=f.sheets['명군'].rules;assert.equal(rules.length,2);assert.ok(rules.every(r=>r.color==='#fff2cc'&&r.ranges[0].col===3));verify(f);
});
test('전화번호 없는 동명이인은 임의로 합치지 않는다',()=>{
 const f=createFixture();f.hold('busy');f.input('명군',3,3,'같은이름','first');f.input('총군',3,3,'같은이름','second');f.release();f.repair();assert.equal(f.raw().filter(r=>!r[21]).length,2);verify(f);
});
test('삭제와 다른 칸 수정이 겹쳐도 삭제가 복원되지 않고 대기 값은 이력에 보존',()=>{
 const f=createFixture();f.input('명군',3,3,person('삭제동시','01011110013'));f.input('명군',27,3,person('삭제동시','01011110013'));
 f.hold('busy');f.input('총 방문 새가족',2,3,'','first');f.input('명군',27,7,'삭제중대기주소','second');f.release();f.repair();assert.equal(f.raw().filter(r=>!r[21]).length,0);assert.ok(f.sheets['_변경기록'].data.some(r=>r.some(v=>String(v).includes('삭제중대기주소'))),'삭제 전 대기 입력 이력');verify(f);
});


test('이전 군 이동 확인 대기 행을 새 번호로 분리해 양쪽 소속 보존',()=>{
 const f=createFixture();f.input('명군',3,3,person('소속분리','01011110014'));const original=f.visible('명군')[0];
 f.hold('busy');f.input('명군',3,10,'주전','old-group');f.release();
 f.input('총 방문 새가족',2,9,'석');
 assert.match(f.visible('명군')[0].note,/군 변경 전 입력 확인/);
 f.repair();const records=f.raw().filter(r=>!r[21]);assert.equal(records.length,2);assert.deepEqual(records.map(r=>r[2]).sort(),['명군','석군']);assert.notEqual(f.visible('명군')[0].id,f.visible('석군')[0].id);assert.ok(records.some(r=>r[3]==='주전'));assert.match(f.visible('명군')[0].note,/동일인 중복/);assert.match(f.visible('석군')[0].note,/동일인 중복/);verify(f);
});
console.log('동시 입력·삭제 '+passed+'개 시나리오 통과');
