
// 精算引擎使用的班與班規則參數。頁面每次呼叫精算時，都會把規則表（GUARD_SHIFT_RULES）隨資料傳入。
var __shiftRules={door:{maxConsecutiveDays:2,restHours:6,dailyMaxHours:6,dailyMaxShifts:3,twoDayMaxShifts:3},officer:{minGapDays:1,maxConsecutiveDays:2,restHours:6},shared:{sameSlotWindowDays:2,sundayStayGapWeeks:1}};
function useShiftRules(r){if(r)__shiftRules=r;}
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
