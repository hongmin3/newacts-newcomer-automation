// Validates: REQ-REG-001, REQ-REPORT-001
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const logs=[];const c={console:{log:s=>logs.push(s)}};vm.createContext(c);
for(const f of ['등록새가족-군현황 자동 배치.gs','등록 새가족 새가족교육 수료현황 자동화.gs'])vm.runInContext(fs.readFileSync('registration-project/'+f,'utf8'),c);
let locks=0,calls=0;c.withRegistrationLock_=f=>{locks++;return f();};
c.reconcileRegistrationWithLatestAttendance_=o=>{calls++;assert.equal(o.dryRun,false);return {registrations:3,changes:[{name:'PRIVATE_NAME'}],protected:[],review:[]};};
assert.equal(typeof c.applyRegistrationCorrectionsNow,'function');
const actual=c.applyRegistrationCorrectionsNow();assert.equal(actual.changes.length,1);assert.equal(locks,1);assert.equal(calls,1);
assert(!logs.join('').includes('PRIVATE_NAME'));
const large={dryRun:true,reconciliation:{changes:Array(1000).fill({name:'PRIVATE_NAME'}),review:[]},sync:{registrations:3,unmatched:[{name:'PRIVATE_NAME'}]}};
c.runRegistrationMaintenance_=o=>{assert.equal(o.dryRun,true);assert.equal(o.sendEmail,false);return large;};
c.runRegistrationReporting_=c.runRegistrationMaintenance_;
c.previewRegistrationMaintenance();c.previewRegistrationReporting();
assert(logs.every(s=>s.length<2000 && !s.includes('PRIVATE_NAME')));
console.log('등록 수동 실행의 잠금·메일 없음·집계 로그 통과');
