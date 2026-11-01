'use strict';
// 외부 Sheets/잠금/시계만 대체한다. 운영 함수는 원본 Code.gs를 실행한다.
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../../event-day-workbook/Code.gs'),'utf8');
function createFixture(){
 let seq=0,owner=null,actor='editor-1',now=Date.UTC(2026,10,1),hook=null,io=0;
 const props={},stats={reads:0,writes:0,lockDenied:0},sheets={},named={};
 const book={getSheetByName:n=>sheets[n],getSheets:()=>Object.values(sheets),getRangeByName:n=>named[n],setNamedRange:(n,r)=>named[n]=r,toast(){}};
 function signal(kind,phase,r){io++;if(hook)hook({kind,phase,index:io,sheet:r.sheet.name,row:r.row,col:r.col,nr:r.nr,nc:r.nc});}
 class Range{
  constructor(sheet,row,col,nr=1,nc=1){Object.assign(this,{sheet,row,col,nr,nc});}
  getSheet(){return this.sheet;}getRow(){return this.row;}getColumn(){return this.col;}getNumRows(){return this.nr;}getNumColumns(){return this.nc;}getLastRow(){return this.row+this.nr-1;}getLastColumn(){return this.col+this.nc-1;}
  getValues(){stats.reads++;signal('read','before',this);const out=Array.from({length:this.nr},(_,r)=>Array.from({length:this.nc},(_,c)=>this.sheet.data[this.row+r-1]?.[this.col+c-1]??''));signal('read','after',this);return out;}
  setValues(values){stats.writes++;signal('write','before',this);for(let r=0;r<this.nr;r++)for(let c=0;c<this.nc;c++){this.sheet.data[this.row+r-1]??=[];var v=values[r][c],key=`${this.row+r},${this.col+c}`;this.sheet.formulas??={};if(typeof v==='string'&&v.startsWith('=')){this.sheet.formulas[key]=v;v=v==='=1+1'?2:v;}else delete this.sheet.formulas[key];this.sheet.data[this.row+r-1][this.col+c-1]=v;}signal('write','after',this);return this;}
  setValue(v){return this.setValues([[v]]);}clearContent(){return this.setValues(Array.from({length:this.nr},()=>Array(this.nc).fill('')));}
  setDataValidation(rule){this.sheet.validations??={};for(let i=0;i<this.nr;i++)this.sheet.validations[`${this.row+i},${this.col}`]=rule;return this;}
  getFormulas(){return Array.from({length:this.nr},(_,r)=>Array.from({length:this.nc},(_,c)=>this.sheet.formulas?.[`${this.row+r},${this.col+c}`]??''));}
  getNotes(){return Array.from({length:this.nr},(_,r)=>Array.from({length:this.nc},(_,c)=>this.sheet.notes[`${this.row+r},${this.col+c}`]??''));}
  setNote(v){signal('note','before',this);this.sheet.notes[`${this.row},${this.col}`]=v;signal('note','after',this);return this;}
  clearNote(){for(let r=0;r<this.nr;r++)for(let c=0;c<this.nc;c++)delete this.sheet.notes[`${this.row+r},${this.col+c}`];return this;}
  copyFormatToRange(){}
 }
 class Sheet{
  constructor(name,id){Object.assign(this,{name,id,data:[],notes:{},max:1001});}
  getConditionalFormatRules(){return this.rules||[];}setConditionalFormatRules(r){this.rules=r;}getName(){return this.name;}getSheetId(){return this.id;}getParent(){return book;}getMaxRows(){return this.max;}
  getLastRow(){for(let i=this.data.length-1;i>=0;i--)if(this.data[i]?.some(v=>v!==''&&v!==null&&v!==undefined))return i+1;return 0;}
  getRange(r,c,nr,nc){return new Range(this,r,c,nr,nc);}appendRow(v){return this.getRange(this.getLastRow()+1,1,1,v.length).setValues([v]);}
  deleteRows(at,count){this.data.splice(at-1,count);this.max-=count;for(const r of Object.values(named)){if(r.sheet!==this)continue;const overlap=Math.max(0,Math.min(r.getLastRow(),at+count-1)-Math.max(r.row,at)+1);if(r.row>=at+count)r.row-=count;else if(r.row>=at)r.row=at;r.nr-=overlap;}}
  insertRowsAfter(at,count){this.insertRowsBefore(at+1,count);}
  insertRowsBefore(at,count){while(this.data.length<at-1)this.data.push([]);this.data.splice(at-1,0,...Array.from({length:count},()=>[]));this.max+=count;for(const r of Object.values(named)){if(r.sheet!==this)continue;if(r.row>=at)r.row+=count;else if(r.getLastRow()>=at)r.nr+=count;}const notes={};for(const [k,v]of Object.entries(this.notes)){const [r,c]=k.split(',').map(Number);notes[`${r>=at?r+count:r},${c}`]=v;}this.notes=notes;}
 }
 const clock=class extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}};
 const ctx={Date:clock,console:{log(){}},Utilities:{getUuid:()=>`fixture-${++seq}`,formatDate:(_d,_tz,format)=>format==='yyyy-MM-dd'?'2026-11-01':'2026-11-01 12:00:00'},SpreadsheetApp:{getActive:()=>book,newConditionalFormatRule:()=>({whenFormulaSatisfied(v){this.formula=v;return this;},setBackground(v){this.color=v;return this;},setRanges(v){this.ranges=v;return this;},build(){return {getBooleanCondition:()=>({getCriteriaValues:()=>[this.formula]}),ranges:this.ranges,color:this.color};}}),flush(){},newDataValidation:()=>({requireValueInList(options,show){this.options=[...options];this.show=show;return this;},setAllowInvalid(allow){this.allow=allow;return this;},build(){return {options:this.options,show:this.show,allow:this.allow};}})},PropertiesService:{getScriptProperties:()=>({getProperty:k=>props[k]??null,setProperty(k,v){props[k]=String(v);return this;}})},LockService:{getDocumentLock:()=>({tryLock(){if(owner&&owner!==actor){stats.lockDenied++;return false;}owner=actor;return true;},releaseLock(){if(owner===actor)owner=null;}})}};
 vm.runInNewContext(source,ctx);
 const groups=['신군','조군','명군','총군','영군','석군','전군','임군','슬군','기타'];
 for(const [i,n]of ['총 방문 새가족','총 등록 새가족',...groups,'_원본','_변경기록','_충돌'].entries())sheets[n]=new Sheet(n,300+i);
 for(const n of ['총 방문 새가족','총 등록 새가족','_원본','_변경기록','_충돌'])sheets[n].data[0]=Array(22).fill('머리글');
 for(const g of groups){const sh=sheets[g];sh.data[0]=['방문 명단'];sh.data[1]=['순번','','이름'];sh.data[22]=Array(10).fill('').concat(['계']);sh.data[24]=['등록 명단'];sh.data[25]=['순번','','이름'];sh.data[36]=Array(11).fill('').concat(['계']);named[`_EVENT_${sh.id}_VISIT`]=sh.getRange(3,1,20,12);named[`_EVENT_${sh.id}_REG`]=sh.getRange(27,1,10,13);}
 function as(who,fn){const prev=actor;actor=who;try{return fn();}finally{actor=prev;}}
 function trigger(n,r,c,nr=1,nc=1,who='editor-1'){return as(who,()=>ctx.onEdit({source:book,range:sheets[n].getRange(r,c,nr,nc)}));}
 function input(n,r,c,values,who='editor-1'){const matrix=Array.isArray(values)?values:[[values]];const saved=hook;hook=null;sheets[n].getRange(r,c,matrix.length,matrix[0].length).setValues(matrix);hook=saved;return trigger(n,r,c,matrix.length,matrix[0].length,who);}
 function raw(){return (sheets['_원본'].data.slice(1)).filter(r=>r?.[0]).map(r=>r.slice());}
 function visible(name,registered=false){const sh=sheets[name],reg=groups.includes(name)?named[`_EVENT_${sh.id}_${registered?'REG':'VISIT'}`]:sh.getRange(2,1,1000,registered?13:12);const out=[];for(let i=0;i<reg.nr;i++){const r=reg.row+i,v=sh.data[r-1]??[],id=v[registered&&groups.includes(name)?30:28];if(id)out.push({row:r,id,values:v.slice(),note:sh.notes[`${r},3`]??''});}return out;}
 return {ctx,book,sheets,groups,raw,visible,input,trigger,props,stats,as,setHook:f=>hook=f,hold:who=>owner=who,release:()=>owner=null,advance:ms=>now+=ms,repair(){return as('background',()=>ctx.eventAutoSync());}};
}
module.exports={createFixture};
