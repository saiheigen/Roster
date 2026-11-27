
// Runs inside an isolated worker. Input uses the page's eligibility matrix and targets.
self.onmessage=async ({data})=>{
 try{
  useShiftRules(data.frame&&data.frame.rules);
  const compiled=await WebAssembly.compile(data.wasm);
  const highs=await Module({instantiateWasm(imports,ready){const instance=new WebAssembly.Instance(compiled,imports);ready(instance,compiled);return instance.exports;}});
  self.postMessage({type:'result',id:data.id,result:solveZero(highs,data.frame)});
 }catch(e){self.postMessage({type:'error',id:data.id,error:String(e)});}
};
function doorLoadWindows(dayItems,edgeShifts,add){
 for(let d=-1;d<dayItems.length;d++){
  const items=[...(dayItems[d]||[]),...(dayItems[d+1]||[])];
  const history=d<0?edgeShifts[0]:d+1===dayItems.length?edgeShifts[1]:0;
  const cap=Math.max(0,__shiftRules.door.twoDayMaxShifts-history);
  if(items.length>cap)add(items.join(' + ')+' <= '+cap);
 }
}
function solveZero(highs,src,precision=false,bandPlan=null){
 const {tasks,people,baseline,pins}=src;
 const days=tasks.length/12, staff=people.length;
 if(!Number.isInteger(days)||!days||!staff)throw Error('Invalid door month');
 const pinned=new Map(pins);
 const allowed=people.map((person,p)=>new Set(person.allowed.filter(j=>!pinned.has(j)||pinned.get(j)===p)));
 const category=t=>t.night?'night':t.noon?'noon':'day';
 const bandKey=(p,d,key)=>'w'+p+'_'+d+'_'+key;
 const prior=Array.from({length:days},(_,d)=>new Set(baseline.slice(d*12,d*12+12)));
 const y=(p,d)=>'y'+p+'_'+d, x=(p,j)=>'x'+p+'_'+j;
 const selected=(r,v)=>r.Columns?.[v]?.Primal>0.5;
 const sum=vars=>vars.join(' + ');
 function model(stage,daySolution,limit){
  const daily=stage==='day',minimum=stage==='minimum',joint=stage==='joint'||minimum,rules=[],binary=[],cost=[],active=[];
  const bySlot=Array.from({length:tasks.length},()=>[]);
  const dailyBands=Array.from({length:days},()=>({night:[],noon:[],day:[]}));
  const overlap=[];
  function within(vars,lo,hi){
   if(!vars.length)return lo===0;
   if(lo===hi)rules.push(sum(vars)+' = '+lo);
   else{
    if(lo)rules.push(sum(vars)+' >= '+lo);
    if(hi<vars.length)rules.push(sum(vars)+' <= '+hi);
   }
   return true;
  }
  const weeks=Array.from({length:staff},()=>Array.from({length:days},()=>[]));
  for(let p=0;p<staff;p++){
   const dayItems=Array.from({length:days},()=>[]),work=[],seenSlots=new Set(),personBands={night:[],noon:[],day:[]},byNum=new Map();
   for(let d=0;d<days;d++){
    const slots=[];
    for(let j=12*d;j<12*d+12;j++)if(allowed[p].has(j))slots.push(j);
    if(!slots.length)continue;
    const personDay=y(p,d);
    if(daily||joint){
     binary.push(personDay);work.push(personDay);active.push(personDay);

     if(precision){
      if(d>0&&work.includes(y(p,d-1))){
       const both='z'+p+'_'+d;binary.push(both);if(bandPlan)overlap.push(both);else cost.push(both);
       rules.push(personDay+' + '+y(p,d-1)+' - '+both+' <= 1');
      }
     }else if(!prior[d].has(p))cost.push(personDay);
    }
    if(daily){
     if(bandPlan){
      const bins=[];
      for(const key of new Set(slots.map(j=>category(tasks[j])))){
       const w=bandKey(p,d,key);bins.push(w);binary.push(w);personBands[key].push(w);dailyBands[d][key].push(w);
       for(const j of slots)if(category(tasks[j])===key){
        bySlot[j].push(w);
        if(pinned.get(j)===p)rules.push(w+' = 1');
       }
      }
      rules.push(sum(bins)+' - '+personDay+' = 0');
     }else for(const j of slots)bySlot[j].push(personDay);
     if(slots.some(j=>pinned.get(j)===p))rules.push(personDay+' = 1');
     continue;
    }
    if(!joint&&!selected(daySolution,personDay))continue;
    const shifts=dayItems[d];
    for(const j of slots){
     if(bandPlan&&!selected(daySolution,bandKey(p,d,category(tasks[j]))))continue;
     const name=x(p,j);
     if(bandPlan){if(!byNum.has(tasks[j].num))byNum.set(tasks[j].num,[]);byNum.get(tasks[j].num).push(name);}
     binary.push(name);shifts.push(name);bySlot[j].push(name);
     if(tasks[j].stay)weeks[p][d].push(name);
     if(!joint&&!bandPlan&&baseline[j]!==p)cost.push(name);
     for(let k=12*(d-1);d>0 && k<12*d;k++)if(seenSlots.has(k) &&
      ((__shiftRules.shared.sameSlotWindowDays>=1&&j%12===k%12) || 24+tasks[j].start-tasks[k].end<__shiftRules.door.restHours))rules.push(x(p,k)+' + '+name+' <= 1');
     for(let back=2;back<=__shiftRules.shared.sameSlotWindowDays;back++)if(j>=12*back && seenSlots.has(j-12*back))rules.push(x(p,j-12*back)+' + '+name+' <= 1');
     seenSlots.add(j);
    }
    if(minimum){
     rules.push(sum(shifts)+' - '+doorDayCap()+' '+personDay+' <= 0',sum(shifts)+' - '+personDay+' >= 0');
     for(let a=0;a<slots.length;a++)for(let b=a+1;b<slots.length;b++){
      const first=tasks[slots[a]],second=tasks[slots[b]];
      if(first.end+__shiftRules.door.restHours>second.start && second.end+__shiftRules.door.restHours>first.start)rules.push(shifts[a]+' + '+shifts[b]+' <= 1');
     }
    }else rules.push(sum(shifts)+(joint?' - '+personDay+' = 0':' = 1'));
   }
   if(bandPlan){
    for(const {key,ranges} of bandPlan.bound.groups){
     const {lo,hi,numbers}=ranges[p];
     if(daily){if(!within(personBands[key],lo,hi))return {Status:'Infeasible'};}
     else for(const num of numbers)if(!within(byNum.get(num)||[],Math.floor(lo/numbers.length),Math.ceil(hi/numbers.length)))return {Status:'Infeasible'};
    }
   }
   if(daily||joint){
    const history=edgeHistory(people[p],days),K=__shiftRules.door.maxConsecutiveDays;
    const availableDays=new Set(work);
    for(let first=-K;first<days;first++){
     const span=Array.from({length:K+1},(_,i)=>first+i);
     const vars=span.map(d=>y(p,d)).filter(v=>availableDays.has(v));
     const limit=K-span.reduce((n,d)=>n+(history.get(d)||0),0);
     if(vars.length>limit)rules.push(sum(vars)+' <= '+limit);
    }
   }
   if(minimum)doorLoadWindows(dayItems,people[p].edgeShifts||[0,0],row=>rules.push(row));
   if(!minimum&&(daily||joint)&&work.length){
    if(precision)rules.push(sum(work)+' = '+people[p].goal);
    else{
     cost.push((tasks.length+1)+' u'+p,(tasks.length+1)+' v'+p);
     rules.push(sum(work)+' + u'+p+' - v'+p+' = '+people[p].goal);
    }
   }
   if(!daily)for(let gapW=1;gapW<=__shiftRules.shared.sundayStayGapWeeks;gapW++)for(let d=7*gapW;d<days;d++){
    const a=weeks[p][d-7*gapW],b=weeks[p][d];
    if(minimum){for(const left of a)for(const right of b)rules.push(left+' + '+right+' <= 1');}
    else if(a.length&&b.length)rules.push(sum([...a,...b])+' <= 1');
   }
  }
  if(daily&&bandPlan){
   if(!within(overlap,0,bandPlan.pairs))return {Status:'Infeasible'};
   for(let d=0;d<days;d++)for(const key of ['night','noon','day']){
    const quota=tasks.slice(12*d,12*d+12).filter(t=>category(t)===key).length;
    if(!within(dailyBands[d][key],quota,quota))return {Status:'Infeasible'};
   }
  }
  if(bySlot.some(a=>!a.length))return {Status:'Infeasible'};
  if(daily){
   for(let d=0;d<days;d++){
    const work=[...new Set(bySlot.slice(d*12,d*12+12).flat())];
    rules.push(sum(work)+' = 12');
   }
   for(const a of bySlot)rules.push(sum(a)+' >= 1');
  }else for(const a of bySlot)rules.push(sum(a)+' = 1');
  const lp=[minimum?'Maximize':'Minimize',' obj: '+(minimum?sum(active):(sum(cost)||'0 '+binary[0])),'Subject To',
   ...rules.map((r,i)=>' c'+i+': '+r),'Binary',...binary,'End'].join('\n');
  return highs.solve(lp,{time_limit:limit,mip_rel_gap:0,output_flag:false});
 }
 const day=model('day',null,bandPlan?14:precision?25:12);

 let slot;
 if((bandPlan?day.Status==='Optimal':day.Status!=='Infeasible')&&day.Columns)slot=model('slot',day,bandPlan?10:precision?15:12);
 function read(r,strict=true){
  if(!r?.Columns)return null;
  const a=tasks.map((_,j)=>people.map((_,p)=>p).filter(p=>selected(r,x(p,j))));
  if(a.some(row=>row.length!==1))return null;
  const ids=a.map(row=>row[0]);
  for(let d=0;d<days;d++)if(strict && new Set(ids.slice(d*12,d*12+12)).size!==12)return null;
  return ids;
 }
 let assignments=read(slot);
 if(precision)return {assignments,pairBound:day.Status==='Optimal'?Math.round(day.ObjectiveValue):null};
 if(!assignments){
  slot=day.Status==='Infeasible'?day:model('joint',null,18);
  assignments=read(slot);
  if(!assignments){
   const min=model('minimum',null,18);
   const witness=read(min,false);
   if(min.Status==='Optimal' && witness){
    const extra=Array.from({length:days},(_,d)=>12-new Set(witness.slice(12*d,12*d+12)).size).reduce((a,b)=>a+b,0);
    return {assignments:witness,status:'FEASIBLE',minimum:extra};
   }
   return {reason:min.Status==='Infeasible'?'時段模型判定無法填滿全月':slot.Status==='Infeasible'?'已證明滿班不能零雙班，最少額外班數待確認':'限時內未找到完整零雙班解，最少額外班數待確認'};
  }
 }
 return {assignments,status:'FEASIBLE'};
}
