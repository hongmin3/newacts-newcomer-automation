// Validates: REQ-REPORT-001
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const c = { console };
vm.createContext(c);
for (const file of ['등록새가족-군현황 자동 배치.gs', '등록 새가족 새가족교육 수료현황 자동화.gs']) {
  vm.runInContext(fs.readFileSync('registration-project/' + file, 'utf8'), c);
}
function sheet(rows) {
  return {rows, fail: false, clears: 0, writes: 0,
    getLastRow(){return this.rows.length;},getLastColumn:()=>15,getMaxRows:()=>100,
    getRange(r,col,n=1,w=1){const s=this;return {
      getValues:()=>Array.from({length:n},(_,i)=>Array.from({length:w},(_,j)=>s.rows[r-1+i]?.[col-1+j]??'')),
      clearContent(){s.clears++;for(let i=0;i<n;i++)s.rows[r-1+i]=Array(w).fill('');},
      setValues(block){if(s.fail)throw Error('모의 쓰기 실패');s.writes++;block.forEach((row,i)=>{s.rows[r-1+i]=Array.from(row);});}
    };}
  };
}
const regRow=Array(15).fill('');regRow[5]='합성';regRow[9]='01000000001';
const reg=sheet([[],regRow]),edu=sheet([[]]);
const manual=[1,'','','','합성','','01000000001','','','','','','O','확인','보존 메모'];
const completion=sheet([[],manual.slice()]);
const cfg=vm.runInContext('REGISTRATION_AUTOMATION',c);
c.getRegistrationSpreadsheet_=()=>({getSheetByName:n=>n===cfg.registrationSheetName?reg:completion});
c.SpreadsheetApp={openById:()=>({getSheetByName:()=>edu})};
completion.fail=true;
assert.throws(()=>c.syncCompletionData_({dryRun:false}),/모의 쓰기 실패/);
assert.deepEqual(completion.rows[1],manual,'실패해도 이전 전체 행 보존');
completion.fail=false;c.syncCompletionData_({dryRun:false});
assert.deepEqual(completion.rows[1].slice(12),manual.slice(12));
completion.rows.push([2,'','','','합성2','','01000000002','','','','','','O','','두번째 메모']);
c.syncCompletionData_({dryRun:false});
assert.ok(completion.rows[2].every(v=>v===''),'줄어든 결과의 꼬리도 같은 쓰기로 비운다');
assert.equal(completion.clears,0);
assert.deepEqual(completion.rows[1].slice(12),manual.slice(12));
const before=JSON.stringify(completion.rows);c.syncCompletionData_({dryRun:true});assert.equal(JSON.stringify(completion.rows),before);
console.log('수료 쓰기 실패·재실행·축소·미리보기 보존 통과');
