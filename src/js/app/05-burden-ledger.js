// #region 勤務負擔點數帳、離線精算 Worker

// 跨月點數帳：每個已封存月份記錄「實得點數 − 依班數應得點數」（×2 單位）；本月目標扣除之前的累計差額。
function burdenLedgerRaw(pool,beforeMonth=activeMonth){
 const raw=new Map();
 for(const [key,item] of Object.entries(appStore.months||{})){
  if(key>=beforeMonth||!item?.locked||!item.burden?.[pool])continue;
  for(const [id,delta] of Object.entries(item.burden[pool]))raw.set(id,(raw.get(id)||0)+Number(delta||0));
 }
 return raw;
}
function burdenOffsets(m,pool,persons){
 const people=m.staff[pool],raw=burdenLedgerRaw(pool),out=people.map(p=>raw.get(p.id)||0);
 const goals=persons.map(p=>p.goal),G=goals.reduce((a,b)=>a+b,0),S=out.reduce((a,b)=>a+b,0);
 const tasks=m.tasks[pool],avg=tasks.length?tasks.reduce((a,t)=>a+burdenScaled(pool,t),0)/tasks.length:0,limit=3*avg;
 return out.map((k,i)=>Math.max(-limit,Math.min(limit,G?k-goals[i]*S/G:k)));
}
function burdenDeltas(solutions){
 const out={};
 for(const pool of ['door','officer']){
  const sol=solutions[pool],pts=new Map(),cnt=new Map();let F=0,P=0;
  for(const t of sol.tasks){const w=sol.res.get(t.key);if(!w)continue;const v=burdenScaled(pool,t);F++;P+=v;pts.set(w.id,(pts.get(w.id)||0)+v);cnt.set(w.id,(cnt.get(w.id)||0)+1);}
  out[pool]={};
  for(const [id,v] of pts)out[pool][id]=Math.round((v-P*cnt.get(id)/F)*100)/100;
 }
 return out;
}
function solverBuildRequest(m,solutions){
 const out={};
 for(const pool of ['door','officer']){
  const tasks=m.tasks[pool],people=m.staff[pool],res=solutions[pool];
  const persons=people.map(p=>({allowed:[],goal:Math.max(0,Math.round(res.targets.get(p.key)||0)),credit:0}));
  if(pool==='door')for(let i=0;i<people.length;i++){
   const occupied=new Set(people[i].history.map(t=>t.day));
   const edgeDays=[m.month.first-2,m.month.first-1,m.month.last+1,m.month.last+2];
   persons[i].edgeShifts=[m.month.first-1,m.month.last+1].map(d=>people[i].history.filter(t=>t.day===d).length);
   persons[i].edgeMask=edgeDays.reduce((mask,d,bit)=>mask+(occupied.has(d)?2**bit:0),0);
   const span=Math.max(2,GUARD_SHIFT_RULES.door.maxConsecutiveDays);
   persons[i].edgeBefore=Array.from({length:span},(_,k)=>occupied.has(m.month.first-1-k));
   persons[i].edgeAfter=Array.from({length:span},(_,k)=>occupied.has(m.month.last+1+k));
  }
  if(pool==='officer')for(let i=0;i<people.length;i++){
   // 安官連站天數要看前後月份已排的日子
   const occupied=new Set(people[i].history.map(t=>t.day)),span=Math.max(2,GUARD_SHIFT_RULES.officer.maxConsecutiveDays);
   persons[i].edgeBefore=Array.from({length:span},(_,k)=>occupied.has(m.month.first-1-k));
   persons[i].edgeAfter=Array.from({length:span},(_,k)=>occupied.has(m.month.last+1+k));
  }
  const personById=new Map(people.map((p,i)=>[p.id,i]));
  for(let j=0;j<tasks.length;j++){
   const t=tasks[j];
   for(let i=0;i<people.length;i++){
    const p=people[i];
    if(!staticReason(p,t)&&!conflict(p,t,new Map([[p.key,p.history]])))persons[i].allowed.push(j);
   }
  }
  const pins=[];
  tasks.forEach((t,j)=>{if(Object.prototype.hasOwnProperty.call(pinnedShifts,t.key)){
   const who=personById.get(pinnedShifts[t.key]);if(who===undefined)throw Error('人工固定人員不存在於名冊');pins.push([j,who]);
  }});
  if(burdenOn()){const off=burdenOffsets(m,pool,persons);persons.forEach((p,i)=>p.burdenOffset=off[i]);}
  out[pool]={points:burdenOn()?tasks.map(t=>burdenScaled(pool,t)):undefined,holidayWeight:burdenOn()?GUARD_FAIRNESS.holidayWeight:0,tasks:tasks.map(t=>({day:t.day,num:t.num,start:t.start,end:t.end,dur:t.dur,
   stay:sundayStay(t),night:night(t),noon:noon(t),holiday:!!t.holiday})),people:persons,pins,rules:JSON.parse(JSON.stringify(GUARD_SHIFT_RULES)),
   baseline:tasks.map(t=>{const assigned=res.res.get(t.key);return assigned?personById.get(assigned.id):null;})};
 }
 return {month:activeMonth,pools:out};
}



function singleDailyShiftLowerBound(m,pool='door'){
 const days=m.month.last-m.month.first+1;
 // 任意 K+1 天共需 K+1 倍每日人數，每人最多連續出勤 K 天（K 取自規則表）。
 if(pool==='door'){const K=GUARD_SHIFT_RULES.door.maxConsecutiveDays;return {days,minimum:days>=K+1?Math.ceil((K+1)*slots.door.length/K):slots.door.length,maxStationDays:days-Math.floor(days/(K+1))};}
 const G=GUARD_SHIFT_RULES.officer.minGapDays,KO=GUARD_SHIFT_RULES.officer.maxConsecutiveDays;
 if(G<=1)return {days,minimum:days>=KO+1?Math.ceil((KO+1)*slots[pool].length/KO):slots[pool].length,maxStationDays:days-Math.floor(days/(KO+1))};
 return {days,minimum:Math.min(days,G)*slots[pool].length,maxStationDays:Math.ceil(days/G)};
}
function scheduleReferenceCode(){
 if(!last)return '';
 return `${activeMonth.replace('-','')}-${readonlyFingerprint().toUpperCase().padStart(8,'0')}`;
}

// #endregion
