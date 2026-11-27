
// 精算引擎使用的班與班規則參數。頁面每次呼叫精算時，都會把規則表（GUARD_SHIFT_RULES）隨資料傳入。
var __shiftRules={door:{maxConsecutiveDays:2,restHours:6,dailyMaxHours:6,dailyMaxShifts:3,twoDayMaxShifts:3},officer:{minGapDays:1,maxConsecutiveDays:2,restHours:6},shared:{sameSlotWindowDays:2,sundayStayGapWeeks:1}};
function useShiftRules(r){if(r)__shiftRules=r;}
// 一鍵排班（draft）的確定性：求解器的工作量改用「單純形法迭代次數」計算（在求解器回呼時檢查，超過預算就中斷），
// 不看時鐘，所以同一份資料在快慢不同的裝置上得到相同結果。原本的時間上限放寬 DRAFT_SAFETY 倍，只當安全網；
// 真的被時間截斷時記為 __safetyHit（結果可能因裝置而異，畫面會註明）。「精算並證明最優」不受影響。
var __draft=false,__safetyHit=false,__stageSeconds=null;
const DRAFT_ITERS_PER_SECOND=1200,DRAFT_STAGE_SECONDS=180,DRAFT_SAFETY=6,SAFETY_SCALE=1;
// 主要階段（不設時間上限的整體求解）在一鍵排班時的工作量：缺班、同日多班、個人班數公平各 120 秒，其餘 15 秒（以桌機速度換算），
// 改用迭代次數計算，與裝置快慢無關。
function draftStage(seconds){__stageSeconds=seconds;}
function draftOptions(o){
 if(!__draft)return o;
 return {...o,time_limit:((o&&o.time_limit)||__stageSeconds||DRAFT_STAGE_SECONDS)*DRAFT_SAFETY*SAFETY_SCALE};
}
// 回傳 mipInterrupt 回呼：累計迭代次數超過預算就中斷（只有一鍵排班時才加）
function draftBudget(highs,o){
 if(!__draft)return {};
 const budget=((o&&o.time_limit)||__stageSeconds||DRAFT_STAGE_SECONDS)*DRAFT_ITERS_PER_SECOND;
 return {[highs.constants.callbackType.mipInterrupt](e){if(Number(e.data.mip_total_lp_iterations||0)>budget)e.interrupt();}};
}
function useDraftLimits(highs,draft){
 __draft=!!draft;__safetyHit=false;if(!__draft)return;
 const solve=highs.solve.bind(highs);
 highs.solve=(lp,o)=>{
  if(!/\n\s*(binary|bin|general|gen|integer|integers)\s*\n/i.test(lp)){
   const r=solve(lp,draftOptions(o));if(r.Status==='Time limit reached')__safetyHit=true;return r;
  }
  const model=highs.createModel({format:'lp',data:lp});
  try{
   model.options.set(draftOptions(o||{}));
   const r=model.run(draftBudget(highs,o)),S=highs.constants.modelStatus;
   if(r.modelStatus===S.timeLimit){__safetyHit=true;return {Status:'Time limit reached'};}
   if(r.modelStatus===S.infeasible)return {Status:'Infeasible'};
   if(r.modelStatus!==S.optimal)return {Status:'Interrupted'};
   const n=model.getDimensions().numCols,x=model.getSolution().colValue,Columns={};
   for(let i=0;i<n;i++)Columns[model.getColName(i)]={Primal:x[i]};
   return {Status:'Optimal',Columns,ObjectiveValue:model.getObjectiveValue()};
  }finally{model.dispose();}
 };
}
function workLimitError(){const e=Error('一鍵排班運算量已達上限');e.workLimit=true;return e;}
function stayRepeat(gap){const w=__shiftRules.shared.sundayStayGapWeeks;return gap>0&&gap%7===0&&gap<=7*w;}
function doorDayCap(){const D=__shiftRules.door;return Math.min(D.dailyMaxShifts,Math.floor(D.dailyMaxHours/2));}
function edgeHistory(person,days){
 const h=new Map();
 if(person.edgeBefore){person.edgeBefore.forEach((v,i)=>h.set(-1-i,v?1:0));person.edgeAfter.forEach((v,i)=>h.set(days+i,v?1:0));return h;}
 const mask=person.edgeMask||0;
 [[-2,mask&1],[-1,(mask>>1)&1],[days,(mask>>2)&1],[days+1,(mask>>3)&1]].forEach(([d,v])=>h.set(d,v));
 return h;
}
function doorObjectives(src, assignments) {
 const {tasks,people}=src;
 const stats=people.map(()=>({count:0,night:0,noon:0,hol:0,pts:0,days:new Set(),slots:new Map()}));
 let filled=0, nights=0, noons=0, hols=0, ptsTotal=0;
 assignments.forEach((p,j)=>{
  if(p==null||p<0)return;
  const w=stats[p],t=tasks[j];
  w.count++; w.days.add(t.day); filled++;
  if(src.points){w.pts+=src.points[j];ptsTotal+=src.points[j];}
  if(t.holiday){w.hol++; hols++;}
  if(t.night){w.night++; nights++;}
  if(t.noon){w.noon++; noons++;}
  if(t.night||t.noon)w.slots.set(t.num,(w.slots.get(t.num)||0)+1);
 });
 let extra=0, l1=0, pairs=0, harsh=0, holiday=0;
 for(const [p,w] of stats.entries()){
  extra+=w.count-w.days.size;
  holiday+=(filled*w.hol-hols*w.count)**2;
  l1+=Math.abs(w.count-people[p].goal);
  for(const d of w.days)if(w.days.has(d-1))pairs++;
  if(src.points)harsh+=10*(filled*w.pts-ptsTotal*w.count+filled*(people[p].burdenOffset||0))**2+40*(src.holidayWeight||0)*(filled*w.hol-hols*w.count)**2;
  else harsh+=10*(filled*w.night-nights*w.count)**2+7*(filled*w.noon-noons*w.count)**2;
  for(const n of w.slots.values())harsh+=6*filled**2*(n-1)**2;
 }
 return [tasks.length-filled,extra,l1,pairs,harsh/(10*(filled||1)**2),holiday/((filled||1)**2)];
}
function officerObjectives(src,assignments){
 const staff=src.people.map(()=>({count:0,night:0,noon:0,hours:0,hol:0,pts:0,slots:new Map()}));
 let filled=0,nights=0,noons=0,hours=0,hols=0,ptsTotal=0;
 assignments.forEach((p,j)=>{
  if(p==null||p<0)return;
  const t=src.tasks[j],w=staff[p];
  filled++;w.count++;w.hours+=t.dur;hours+=t.dur;
  if(src.points){w.pts+=src.points[j];ptsTotal+=src.points[j];}
  if(t.holiday){hols++;w.hol++;}
  if(t.night){nights++;w.night++;}
  if(t.noon){noons++;w.noon++;}
  if(t.night||t.noon)w.slots.set(t.num,(w.slots.get(t.num)||0)+1);
 });
 let l1=0,cost=0,holiday=0;
 staff.forEach((w,p)=>{
  l1+=Math.abs(w.count-src.people[p].goal);
  holiday+=(filled*w.hol-hols*w.count)**2;
  if(src.points)cost+=50*(filled*w.pts-ptsTotal*w.count+filled*(src.people[p].burdenOffset||0))**2+200*(src.holidayWeight||0)*(filled*w.hol-hols*w.count)**2;
  else cost+=50*(filled*w.night-nights*w.count)**2+35*(filled*w.noon-noons*w.count)**2+(filled*w.hours-hours*w.count)**2;
  for(const n of w.slots.values())cost+=30*filled**2*(n-1)**2;
 });
 return [src.tasks.length-filled,l1,cost/(50*(filled||1)**2),holiday/((filled||1)**2)];
}

// 假日班公平的下界：每人總班數固定時，忽略日曆只看「每人最多可拿幾個假日班」，
// 可分離凸函數在總和限制下以貪婪法求得精確最小值。這是有效下界；目前班表若已達到，即證明最優。
function holidayLowerBound(src,counts,onePerDay){
 const {tasks,people}=src,F=counts.reduce((a,b)=>a+b,0),H=tasks.filter(t=>t.holiday).length;
 if(!F||!H)return 0;
 const caps=people.map((person,p)=>{
  const js=person.allowed.filter(j=>tasks[j].holiday);
  const n=onePerDay?new Set(js.map(j=>tasks[j].day)).size:js.length;
  return Math.min(counts[p],n);
 });
 if(caps.reduce((a,b)=>a+b,0)<H)return null;
 const h=people.map(()=>0),cost=(p,k)=>(F*k-H*counts[p])**2;
 for(let u=0;u<H;u++){
  let best=-1,delta=Infinity;
  for(let p=0;p<people.length;p++)if(h[p]<caps[p]){const d=cost(p,h[p]+1)-cost(p,h[p]);if(d<delta){delta=d;best=p;}}
  if(best<0)return null;h[best]++;
 }
 return h.reduce((s,k,p)=>s+cost(p,k),0)/(F*F);
}
function compareDoorObjectives(a,b){
 for(let i=0;i<a.length;i++)if(a[i]!==b[i])return a[i]<b[i]?-1:1;
 return 0;
}
