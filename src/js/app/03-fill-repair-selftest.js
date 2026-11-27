// #region 初排、補班與公平
function solvePool(m,pool,pins={},opts={}){const pp=m.staff[pool],tasks=m.tasks[pool];const options=new Map(),availability=new Map();
 for(const p of pp)availability.set(p.key,0);
 for(const t of tasks){let cs=[];for(const p of pp)if(!staticReason(p,t)){cs.push(p);availability.set(p.key,availability.get(p.key)+1);}options.set(t.key,cs);}
 const goals=calcGoals(m,pool,availability),targets=calcActualTargets(m,pool,goals,availability);let best=null;
 for(let run=0;run<(opts.runLimit||24);run++){
  let rng=seeded(17411+run*196613+pool.length*97+(opts.seedOffset||0)),occupied=new Map(),done=new Map(),hrs=new Map(),harshN=new Map(),harshM=new Map(),slotN=new Map(),holidayLoads=new Map(),res=new Map();
  for(const p of pp){occupied.set(p.key,p.history.slice());done.set(p.key,0);hrs.set(p.key,0);harshN.set(p.key,0);harshM.set(p.key,0);slotN.set(p.key,new Map());}
  // 人工固定班次先排入，不得因自動搜尋被挪動。
  for(const t of tasks){if(!Object.prototype.hasOwnProperty.call(pins,t.key))continue;
   const who=pins[t.key],p=pp.find(x=>x.id===who);
   if(!p)throw Error(`人工固定班次 ${dateText(t.day)} ${names[pool]} ${t.num} 班：找不到人員 ${who}，請解除固定後重試`);
   const reason=staticReason(p,t)||conflict(p,t,occupied);
   if(reason)throw Error(`人工固定班次 ${dateText(t.day)} ${names[pool]} ${t.num} 班 ${p.name} 不合規：${reason}。請先解除固定`);
   res.set(t.key,p);if(t.holiday)holidayLoads.set(p.key,(holidayLoads.get(p.key)||0)+1);occupied.get(p.key).push(t);done.set(p.key,done.get(p.key)+1);hrs.set(p.key,hrs.get(p.key)+t.dur);
   if(night(t))harshN.set(p.key,harshN.get(p.key)+1);if(noon(t))harshM.set(p.key,harshM.get(p.key)+1);
   const sc=slotN.get(p.key);sc.set(t.num,(sc.get(t.num)||0)+1);
  }
  const order=tasks.filter(t=>!Object.prototype.hasOwnProperty.call(pins,t.key)).map(t=>({t,jitter:rng()}));
  order.sort((a,b)=>options.get(a.t.key).length-options.get(b.t.key).length||Number(sundayStay(b.t))-Number(sundayStay(a.t))||(night(b.t)?1:0)-(night(a.t)?1:0)||a.jitter-b.jitter);
  if(pool==='officer'&&run%3!==0){
   const direction=run%3===1?1:-1;
   order.sort((a,b)=>direction*(a.t.day-b.t.day));
  }
  let missing=0;
  for(const {t} of order){let choices=[];for(const p of options.get(t.key))if(!conflict(p,t,occupied)){
    const g=targets.get(p.key)||0,used=done.get(p.key);
    const quota=(used+0.5)/Math.max(0.4,g),diff=used-g;
    const burden=night(t)?harshN.get(p.key)*.13:0;
    const midday=noon(t)?harshM.get(p.key)*.13:0;
    const repeat=(slotN.get(p.key).get(t.num)||0)*.16;
    const h=hrs.get(p.key)*.005;
    const sameDay=occupied.get(p.key).filter(x=>x.day===t.day).length;
    const adjacent=t.pool==='door'&&occupied.get(p.key).some(x=>Math.abs(x.day-t.day)===1);
    const fatigue=t.pool==='door'?sameDay*9+Math.max(0,sameDay-1)*18+Number(adjacent):0;
    const noise=rng()*.14;
    const holidayLoad=t.holiday?(holidayLoads.get(p.key)||0)/Math.max(1,g):0;
    const businessDay=p.events.some(e=>e.type==='業參日'&&t.day>=e.start&&t.day<=e.end);
    choices.push({p,score:holidayLoad+(businessDay?2:0)+quota*2.5+Math.max(0,diff)*.10+burden+midday+repeat+h+fatigue+noise});
   }
   if(!choices.length){res.set(t.key,null);missing++;continue;}
   choices.sort((a,b)=>a.score-b.score);const p=choices[0].p;
   res.set(t.key,p);if(t.holiday)holidayLoads.set(p.key,(holidayLoads.get(p.key)||0)+1);occupied.get(p.key).push(t);done.set(p.key,done.get(p.key)+1);hrs.set(p.key,hrs.get(p.key)+t.dur);
   if(night(t))harshN.set(p.key,harshN.get(p.key)+1);if(noon(t))harshM.set(p.key,harshM.get(p.key)+1);
   const sc=slotN.get(p.key);sc.set(t.num,(sc.get(t.num)||0)+1);
  }
  // 最後再巡一輪所有空班：若此時仍有合格人選，就補上，不為追求公平而留空。
  for(const t of tasks){if(res.get(t.key)!==null)continue;
   const choices=options.get(t.key).filter(p=>!conflict(p,t,occupied));if(!choices.length)continue;
   choices.sort((a,b)=>(done.get(a.key)+.5)/Math.max(.4,targets.get(a.key)||0)-(done.get(b.key)+.5)/Math.max(.4,targets.get(b.key)||0));
   const p=choices[0];res.set(t.key,p);if(t.holiday)holidayLoads.set(p.key,(holidayLoads.get(p.key)||0)+1);occupied.get(p.key).push(t);done.set(p.key,done.get(p.key)+1);hrs.set(p.key,hrs.get(p.key)+t.dur);
   if(night(t))harshN.set(p.key,harshN.get(p.key)+1);if(noon(t))harshM.set(p.key,harshM.get(p.key)+1);
   const sc=slotN.get(p.key);sc.set(t.num,(sc.get(t.num)||0)+1);missing--;
  }
  const equity=pp.reduce((s,p)=>s+Math.abs(done.get(p.key)-(targets.get(p.key)||0)),0);
  const holidayCost=pp.reduce((sum,p)=>sum+(holidayLoads.get(p.key)||0)**2/Math.max(1,targets.get(p.key)||0),0);
  const extra=pool==='door'?pp.reduce((total,p)=>{
   const worked=occupied.get(p.key).filter(t=>!t.hist);
   return total+worked.length-new Set(worked.map(t=>t.day)).size;
  },0):0;
  if(!best||missing<best.missing||missing===best.missing&&(extra<best.extra||
     extra===best.extra&&(equity<best.equity||equity===best.equity&&holidayCost<best.holidayCost)))
    best={res,missing,extra,equity,holidayCost,occupied,done,hrs,harshN,harshM,goals,targets,options};
  if(!best.missing&&!best.extra&&run>=9&&!opts.fullRuns)break;
 }
 // 與選人流程獨立地重算每個輸出值是否合法（靜態＋全部其他班次）。
 let verified=new Map(),issues=[];
 for(const t of tasks){const p=best.res.get(t.key);if(!p){const optionsHere=best.options.get(t.key),n=optionsHere.length,now=optionsHere.filter(x=>!conflict(x,t,best.occupied)).length;verified.set(t.key,{check:'缺班',note:n===0?'初篩合格 0 人（休假／勤務資格等限制）':`初篩合格 ${n} 人；其他班次排入後可接班 ${now} 人（仍可能透過重新調整解決）`});continue;}
  const reason=staticReason(p,t);let without=new Map();without.set(p.key,[...p.history,...tasks.filter(x=>x.key!==t.key&&best.res.get(x.key)?.key===p.key)]);
  const dynamic=conflict(p,t,without);const check=reason||dynamic?'違規':'通過';const note=reason||dynamic||'';
  if(check==='違規')issues.push(`${dateText(t.day)} ${names[pool]} ${t.num}班 ${p.name}：${note}`);
  verified.set(t.key,{check,note});
 }
 const stats=pp.map(p=>({p,count:best.done.get(p.key),hours:best.hrs.get(p.key),night:best.harshN.get(p.key),noon:best.harshM.get(p.key),meal:p.mealCredit,carry:p.carry,goal:best.goals.get(p.key)||0,target:best.targets.get(p.key)||0}));
 return {...best,tasks,verified,issues,stats};
}

// v5.4: 班表作息品質統計。以「人員＋勤務日期」計算，不把跨日但相鄰的不同日期誤認為同日。
function dailyLoadStats(sol){
 const perDay=new Map();
 for(const t of sol.tasks){const p=sol.res.get(t.key);if(!p)continue;const k=p.key+'|'+t.day;perDay.set(k,(perDay.get(k)||0)+1);}
 let doubles=0,triples=0,extra=0,max=0;
 for(const n of perDay.values()){if(n>=2)doubles++;if(n>=3)triples++;extra+=Math.max(0,n-1);max=Math.max(max,n);}
 return {doubles,triples,extra,max};
}
// 多目標、有限預算的局部搜尋：不減少覆蓋率、不改人工固定，嚴格驗證換班雙方。
// 先嘗試把同日第二／第三班分給另一位合法人員；再嘗試兩人對調班次。
// 可降低勤務集中，但不承諾達到全域最佳解。
function optimizeDailyPool(m,pool,sol,pins={},maxMoves=70,maxChecks=26000){
 if(pool!=='door')return {moved:0,swapped:0,checks:0,cutoff:false,before:dailyLoadStats(sol),after:dailyLoadStats(sol)};
 const staff=m.staff[pool],tasks=sol.tasks,own=new Map(staff.map(p=>[p.key,[]]));
 for(const t of tasks){const p=sol.res.get(t.key);if(p)own.get(p.key).push(t);}
 const before=dailyLoadStats(sol);
 const pinned=t=>Object.prototype.hasOwnProperty.call(pins,t.key);
 function cost(p,arr){
  const counts=new Map(),slotCounts=new Map();let ni=0,mi=0;
  for(const t of arr){counts.set(t.day,(counts.get(t.day)||0)+1);if(night(t))ni++;if(noon(t))mi++;if(night(t)||noon(t))slotCounts.set(t.num,(slotCounts.get(t.num)||0)+1);}
  let double=0,third=0;
  for(const n of counts.values()){double+=Math.max(0,n-1);third+=Math.max(0,n-2);}
  const g=sol.targets.get(p.key)||0,imbalance=arr.length-g;
  const fair=10*imbalance*imbalance/Math.max(1,Math.sqrt(g+1));
  const harsh=1.1*ni*ni+.9*mi*mi;
  let repeat=0;for(const n of slotCounts.values())repeat+=Math.max(0,n-1)**2;
  return 170*double+380*third+fair+harsh+repeat*.8;
 }
 function legal(p,t,remain){return !staticReason(p,t)&&!conflict(p,t,new Map([[p.key,[...p.history,...remain]]]));}
 let moved=0,swapped=0,checks=0,cutoff=false;
 for(let pass=0;pass<maxMoves;pass++){
  let choice=null;
  function consider(change,extra,delta){
   if(extra>0||(extra===0&&delta>=-.0001))return;
   if(!choice||extra<choice.extra||(extra===choice.extra&&delta<choice.delta))choice={...change,extra,delta};
  }
  const candidates=tasks.filter(t=>!pinned(t)&&sol.res.get(t.key)&&own.get(sol.res.get(t.key).key).filter(x=>x.day===t.day).length>1);
  // 先處理同日站三班的人員，再處理同日兩班。
  candidates.sort((a,b)=>own.get(sol.res.get(b.key).key).filter(x=>x.day===b.day).length-own.get(sol.res.get(a.key).key).filter(x=>x.day===a.day).length||a.day-b.day||a.num-b.num);
  for(const t of candidates){
   const from=sol.res.get(t.key),source=own.get(from.key),afterSource=source.filter(x=>x.key!==t.key);
   const currentSourceCost=cost(from,source),reducedSourceCost=cost(from,afterSource);
   for(const to of (sol.options.get(t.key)||[])){
    if(to.key===from.key)continue;
    if(++checks>maxChecks){cutoff=true;break;}
    const dest=own.get(to.key),currentDestCost=cost(to,dest);
    if(legal(to,t,dest)){
     const delta=(reducedSourceCost+cost(to,[...dest,t]))-(currentSourceCost+currentDestCost);
     consider({type:'move',t,from,to},Number(dest.some(a=>a.day===t.day))-1,delta);
    }
    // 即使 B 無法直接接班，也嘗試把 B 的某一班換給 A。
    for(const u of dest){
     if(pinned(u))continue;
     if(++checks>maxChecks){cutoff=true;break;}
     const remainingDest=dest.filter(x=>x.key!==u.key);
     if(!legal(to,t,remainingDest)||!legal(from,u,afterSource))continue;
     const delta=cost(from,[...afterSource,u])+cost(to,[...remainingDest,t])-currentSourceCost-currentDestCost;
     const extra=Number(remainingDest.some(a=>a.day===t.day))+Number(afterSource.some(a=>a.day===u.day))-
      Number(remainingDest.some(a=>a.day===u.day))-1;
     consider({type:'swap',t,u,from,to},extra,delta);
    }
    if(cutoff)break;
   }
   if(cutoff)break;
  }
  if(!choice)break;
  const {t,u,from,to}=choice;
  if(choice.type==='move'){
   sol.res.set(t.key,to);
   own.set(from.key,own.get(from.key).filter(x=>x.key!==t.key));own.get(to.key).push(t);moved++;
  }else{
   sol.res.set(t.key,to);sol.res.set(u.key,from);
   own.set(from.key,[...own.get(from.key).filter(x=>x.key!==t.key),u]);
   own.set(to.key,[...own.get(to.key).filter(x=>x.key!==u.key),t]);swapped++;
  }
  if(cutoff)break;
 }
 return {moved,swapped,checks,cutoff,before,after:dailyLoadStats(sol)};
}

function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function fmt(t){return `${pad(t.start)}:00–${pad(t.end)}:00`;}

// v6.2: bounded, constraint-propagating exact search over a *small* neighborhood.
// Distinct from the heuristic chain repair below: within its selected neighborhood,
// the solver explores assignment combinations by MRV and backtracks atomically.
// It can establish neighborhood feasibility, NOT global optimality/infeasibility.
// No constraints are relaxed. Pinned shifts and all assignments outside the
// neighborhood remain immutable. A completed improvement is checked and only
// then committed. On search exhaustion, the original roster is untouched.
function exactNeighborhoodRepairPool(m,pool,sol,pins={},limits={}){
 const taskMap=new Map(sol.tasks.map(t=>[t.key,t]));
 const defaultLimit={attempts:18,nodes:14000,perAttempt:2500,maxVars:9,candidates:7};
 const cfg={...defaultLimit,...limits};
 let nodes=0,attempts=0,filled=0,exhausted=0,rejected=0,provenLocalNo=0;
 const pinned=k=>Object.prototype.hasOwnProperty.call(pins,k);
 const byPerson=new Map(m.staff[pool].map(p=>[p.key,p]));
 const currentlyOwned=(p)=>sol.tasks.filter(t=>sol.res.get(t.key)?.key===p.key);
 const eligible=t=>(sol.options?.get(t.key)||m.staff[pool].filter(p=>!staticReason(p,t)));
 function blockers(p,t){
  if(conflict(p,t,new Map([[p.key,p.history]])))return null; // immutable history conflict
  const owned=currentlyOwned(p);
  if(!conflict(p,t,new Map([[p.key,[...p.history,...owned]]])))return [];
  let matches=owned.filter(x=>conflict(p,t,new Map([[p.key,[x]]])));
  // For aggregate daily-hour/day-count limits, the conflict may need multiple
  // shifts together; include the entire same-day set.
  const same=owned.filter(x=>x.day===t.day);
  const RD=GUARD_SHIFT_RULES.door;
  if(t.pool==='door' && (same.reduce((n,x)=>n+x.dur,0)+t.dur>RD.dailyMaxHours || same.length>=RD.dailyMaxShifts))
    matches.push(...same);
  if(t.pool==='door')for(const neighbor of [t.day-1,t.day+1]){
   const pair=[...same,...owned.filter(a=>a.day===neighbor)];
   if(pair.length+p.history.filter(a=>a.day===neighbor).length>=RD.twoDayMaxShifts)matches.push(...pair);
  }
  if(t.pool==='door'){
   // 連站天數：把可能構成過長連續出勤的鄰近日期班次一併列為可移動對象
   const K=RD.maxConsecutiveDays;
   for(let off=-K;off<=K;off++)if(off)matches.push(...owned.filter(a=>a.day===t.day+off));
  }
  if(t.pool==='officer'&&same.length)matches.push(...same);
  return [...new Map(matches.map(x=>[x.key,x])).values()];
 }
 function runExact(selected,target){
  const keys=[...selected],inside=new Set(keys);
  // The immutable outside assignments include every previous shift and all
  // history; check against these before searching any combinations.
  const fixed=new Map(m.staff[pool].map(p=>[p.key,[...p.history]]));
  for(const t of sol.tasks){const p=sol.res.get(t.key);
   if(p&&!inside.has(t.key))fixed.get(p.key).push(t);
  }
  const domains=new Map();
  for(const k of keys){const t=taskMap.get(k);
   const d=eligible(t).filter(p=>!staticReason(p,t)&&
    !conflict(p,t,new Map([[p.key,fixed.get(p.key)]])));
   if(!d.length)return {found:false,exhausted:false};
   domains.set(k,d);
  }
  const assigned=new Map(),partial=new Map(m.staff[pool].map(p=>[p.key,[]]));
  const nodeStart=nodes;
  let cutoff=false,answer=null;
  const supports=(p,t)=>!conflict(p,t,new Map([[p.key,[...fixed.get(p.key),...partial.get(p.key)]]]));
  function dfs(){
   if(++nodes>cfg.nodes||nodes-nodeStart>cfg.perAttempt){cutoff=true;return false;}
   if(assigned.size===keys.length){answer=new Map(assigned);return true;}
   let next=null,domain=null;
   // MRV + forward checking: if any unassigned task is impossible under the
   // current partial assignment, reject immediately.
   for(const k of keys){if(assigned.has(k))continue;
    const t=taskMap.get(k),d=domains.get(k).filter(p=>supports(p,t));
    if(!d.length)return false;
    if(!domain||d.length<domain.length||(d.length===domain.length&&k===target.key)){
     domain=d;next=k;
    }
   }
   const t=taskMap.get(next),old=sol.res.get(next);
   domain.sort((a,b)=>{
    // Prefer assignments that perturb fewer existing shifts; when tied,
    // favor staff currently under their weighted target and fewer same-day jobs.
    const ca=(a.key===old?.key?-.3:0)+((currentlyOwned(a).length+.5)/Math.max(1,sol.targets.get(a.key)||1))
           +partial.get(a.key).filter(x=>x.day===t.day).length*5;
    const cb=(b.key===old?.key?-.3:0)+((currentlyOwned(b).length+.5)/Math.max(1,sol.targets.get(b.key)||1))
           +partial.get(b.key).filter(x=>x.day===t.day).length*5;
    return ca-cb||a.key.localeCompare(b.key);
   });
   for(const p of domain){
    assigned.set(next,p);partial.get(p.key).push(t);
    if(dfs())return true;
    partial.get(p.key).pop();assigned.delete(next);
    if(cutoff)return false;
   }
   return false;
  }
  dfs();
  return {found:!!answer,answer,exhausted:cutoff};
 }
 const holes=sol.tasks.filter(t=>!sol.res.get(t.key))
  .sort((a,b)=>eligible(a).length-eligible(b).length||a.day-b.day||a.num-b.num);
 for(const target of holes){
  if(filled>=cfg.attempts||attempts>=cfg.attempts||nodes>=cfg.nodes)break;
  if(sol.res.get(target.key)||pinned(target.key))continue;
  const pivots=eligible(target).filter(p=>!conflict(p,target,new Map([[p.key,p.history]])))
   .map(p=>({p,bs:blockers(p,target)})).filter(x=>x.bs!==null)
   .sort((a,b)=>a.bs.length-b.bs.length||a.p.key.localeCompare(b.p.key)).slice(0,cfg.candidates);
  let done=false;
  for(const {p,bs} of pivots){
   if(attempts>=cfg.attempts||nodes>=cfg.nodes)break;
   if(bs.some(x=>pinned(x.key)))continue;
   let selected=new Set([target.key,...bs.map(x=>x.key)]);
   // First try only direct blockers. If that cannot work, add one extra
   // layer of blockers of a plausible replacement to handle 3-way chains.
   const shapes=[new Set(selected)];
   if(selected.size<=cfg.maxVars-2){
    for(const b of bs){
     const expansions=eligible(b).filter(q=>q.key!==p.key)
      .map(q=>({q,bs:blockers(q,b)})).filter(x=>x.bs!==null&&x.bs.every(x=>!pinned(x.key)))
      .sort((x,y)=>x.bs.length-y.bs.length).slice(0,2);
     for(const x of expansions){for(const z of x.bs)selected.add(z.key);}
    }
    if(selected.size<=cfg.maxVars&&selected.size>shapes[0].size)shapes.push(selected);
   }
   for(const shape of shapes){
    if(shape.size>cfg.maxVars||attempts>=cfg.attempts||nodes>=cfg.nodes)continue;
    attempts++;
    const outcome=runExact(shape,target);
    if(outcome.exhausted)exhausted++;
    else if(!outcome.found)provenLocalNo++;
    if(!outcome.found)continue;
    // Candidate must be strictly more complete; all originally occupied
    // neighborhood shifts remain occupied and no pins can be reassigned.
    const original=new Map(sol.res);
    for(const [k,p] of outcome.answer)sol.res.set(k,p);
    recountSolution(sol,pool,m);
    const oldFilled=[...original.values()].filter(Boolean).length;
    const newFilled=sol.tasks.filter(t=>!!sol.res.get(t.key)).length;
    if(sol.issues.length || newFilled<=oldFilled || [...Object.entries(pins)].some(([k,id])=>k.startsWith(pool+':')&&sol.res.get(k)?.id!==id)){
     sol.res=original;recountSolution(sol,pool,m);rejected++;continue;
    }
    filled+=newFilled-oldFilled;done=true;break;
   }
   if(done)break;
  }
 }
 return {filled,attempts,nodes,exhausted,rejected,provenLocalNo,remaining:sol.tasks.filter(t=>!sol.res.get(t.key)).length};
}

// 有界連鎖調班搜尋：只挪動尚未人工固定的班次；不放寬任何既有禁排規則。
function smartRepairPool(m,pool,sol,pins={},maxSteps=1500){
 const pp=m.staff[pool],tasks=sol.tasks,res=sol.res;
 const order=tasks.filter(t=>!res.get(t.key)).sort((a,b)=>(sol.options.get(a.key)?.length||0)-(sol.options.get(b.key)?.length||0));
 let steps=0,filled=0,cutoff=false;
 const used=person=>tasks.reduce((n,t)=>n+Number(res.get(t.key)?.key===person.key),0);
 function owned(p,except){return [...p.history,...tasks.filter(t=>t.key!==except.key&&res.get(t.key)?.key===p.key)];}
 function attempt(target,depth,held){
  if(steps++>maxSteps){cutoff=true;return false;}
  if(held.has(target.key))return false;
  let nextHeld=new Set(held);nextHeld.add(target.key);
  const candidates=(sol.options.get(target.key)||[]).slice().sort((a,b)=>
   (used(a)+.5)/Math.max(1,sol.targets.get(a.key)||1)-(used(b)+.5)/Math.max(1,sol.targets.get(b.key)||1));
  for(const p of candidates){
   if(steps>maxSteps){cutoff=true;return false;}
   const before=owned(p,target);
   if(!conflict(p,target,new Map([[p.key,before]]))){res.set(target.key,p);return true;}
   if(depth<=0||conflict(p,target,new Map([[p.key,p.history]])))continue;
   const blockers=before.filter(t=>!t.hist&&conflict(p,target,new Map([[p.key,[t]]])));
   if(!blockers.length||blockers.length>2||blockers.some(t=>held.has(t.key)||Object.prototype.hasOwnProperty.call(pins,t.key)))continue;
   // Save entire branch. If any displaced person cannot be reassigned, rollback atomically.
   const snapshot=new Map(res);
   blockers.forEach(t=>res.set(t.key,null));res.set(target.key,p);
   if(!conflict(p,target,new Map([[p.key,owned(p,target)]]))){
    let ok=true;
    for(const b of blockers){if(!attempt(b,depth-1,nextHeld)){ok=false;break;}}
    if(ok)return true;
   }
   res.clear();snapshot.forEach((v,k)=>res.set(k,v));
  }
  return false;
 }
 for(const t of order){if(steps>maxSteps){cutoff=true;break;}
  if(!res.get(t.key)&&attempt(t,3,new Set()))filled++;
 }
 return {filled,steps,cutoff,remaining:tasks.filter(t=>!res.get(t.key)).length};
}
// v5: 已排班覆蓋率不變、人工固定不動，只做合法的公平改善。
// 先比班數距離，再比較夜哨／午間／固定時段分散程度；不承諾全域最優。
function improveFairnessPool(m,pool,sol,pins={},passes=3){
 const staff=m.staff[pool],tasks=sol.tasks,byPerson=new Map(staff.map(p=>[p.key,[]]));
 let changed=0,rounds=0;
 const occupancy=()=>{for(const v of byPerson.values())v.length=0;
  for(const t of tasks){const p=sol.res.get(t.key);if(p)byPerson.get(p.key).push(t);}};
 const cost=(p,own)=>{
  const count=own.length,goal=sol.targets.get(p.key)||0;
  const x=count-goal,nightly=own.filter(night).length,midday=own.filter(noon).length;
  const weight=1/Math.max(.333333,p.weight);
  const base=16*x*x/Math.max(1,Math.sqrt(goal+1));
  const harsh=1.1*nightly*nightly+.9*midday*midday;
  const slotCount=new Map();for(const t of own)if(night(t)||noon(t))slotCount.set(t.num,(slotCount.get(t.num)||0)+1);
  const repetition=[...slotCount.values()].reduce((a,n)=>a+Math.max(0,n-1)*Math.max(0,n-1),0)*.8;
  const hours=pool==='officer'?own.reduce((a,t)=>a+t.dur,0):0;
  let dayPenalty=0;
  if(pool==='door'){const byDay=new Map();for(const t of own)byDay.set(t.day,(byDay.get(t.day)||0)+1);
   for(const n of byDay.values())dayPenalty+=170*Math.max(0,n-1)+380*Math.max(0,n-2);}
  return base+harsh+repetition+hours*hours*.001/weight+dayPenalty;
 };
 for(let pass=0;pass<passes;pass++){
  occupancy();let moved=0;
  // 先處理容易造成不均的班次，避免每次相同結果。
  for(const t of tasks){
   if(Object.prototype.hasOwnProperty.call(pins,t.key))continue;
   const old=sol.res.get(t.key);if(!old)continue;
   const oldOwn=byPerson.get(old.key),remaining=oldOwn.filter(x=>x.key!==t.key);
   const baseline=cost(old,oldOwn);const reduced=cost(old,remaining);
   const canRemoveExtra=pool==='door'&&remaining.some(a=>a.day===t.day);
   let replacement=null,bestDelta=-.000001;
   for(const p of staff){if(p.key===old.key||staticReason(p,t))continue;
    const own=byPerson.get(p.key);
    if(pool==='door'&&!canRemoveExtra&&own.some(a=>a.day===t.day))continue;
    if(conflict(p,t,new Map([[p.key,[...p.history,...own]]])))continue;
    const delta=reduced+cost(p,[...own,t])-baseline-cost(p,own);
    if(delta<bestDelta){bestDelta=delta;replacement=p;}
   }
   if(replacement){sol.res.set(t.key,replacement);
    byPerson.set(old.key,remaining);byPerson.get(replacement.key).push(t);moved++;changed++;}
  }
  rounds++;if(!moved)break;
 }
 return {changed,rounds};
}
// 缺班原因：逐一列出名冊上每個人不能排這一班的原因。
// 「本人其他班次」造成的（例如連站、休息不足），附上是哪一班，可先把那一班換給別人再補這一班。
function missingWhy(pool,t){
 if(!last)return '';
 const sol=last.solutions[pool],people=last.m.staff[pool],occ=new Map(people.map(p=>[p.key,[...p.history]]));
 for(const u of sol.tasks){const w=sol.res.get(u.key);if(w&&occ.has(w.key))occ.get(w.key).push(u);}
 const groups=new Map(),put=(why,own,label)=>{if(!groups.has(why))groups.set(why,{own,names:[]});groups.get(why).names.push(label);};
 const when=a=>(a.day<last.m.month.first?'上月 ':a.day>last.m.month.last?'下月 ':'')+dateText(a.day).slice(5)+' '+fmt(a);
 for(const p of people){
  const name=p.name||p.id,st=staticReason(p,t);
  if(st){put(st,false,name);continue;}
  const mine=occ.get(p.key),why=conflict(p,t,occ);
  if(!why){put('目前可直接補上（按「補人」）',true,name);continue;}
  const culprits=mine.filter(a=>!conflict(p,t,new Map([[p.key,mine.filter(b=>b!==a)]]))).slice(0,2);
  put(why,true,name+(culprits.length?'（因 '+culprits.map(when).join('、')+'）':''));
 }
 const list=[...groups].sort((a,b)=>(b[1].own-a[1].own)||b[1].names.length-a[1].names.length);
 return `<details class="miss-why"><summary>為什麼沒人能排？（${people.length} 人）</summary><ul>${list.map(([why,g])=>
  `<li><b>${esc(why)}</b>：${g.names.length} 人<div class="miss-names">${g.names.map(esc).join('、')}</div></li>`).join('')}</ul>`+
  `<p class="help">括號內是擋住這一班的本人其他班次；把那一班換給別人，這個人就能補上。其餘是休假、車勤等個人事件，只能找其他人或調整規則。</p></details>`;
}
function rowsFor(pool){const r=last.solutions[pool],sorted=r.tasks.slice().sort((a,b)=>a.day-b.day||a.num-b.num);
 return sorted.map(t=>{const p=r.res.get(t.key),v=r.verified.get(t.key);return [dateText(t.day),`星期${weekday(t.day)}`,t.num,fmt(t),t.dur,p?.id||'',p?.rank||'',p?.name||'',v.check,v.note];});}
// 內建邊界條件自測：不讀真實名冊，不修改資料，僅檢查指定條件回傳結果。
function runRuleSelfTests(){
 const d=dateOf(2026,11,16),mk=(pool='door')=>({key:'test:'+pool,id:'T01',pool,kitchen:false,events:[],history:[],carry:0,mealCredit:0,weight:1});
 const t=(day, num=6,pool='door')=>{const s=slots[pool].find(x=>x.num===num);return {key:pool+':'+day+':'+num,pool,day,num,start:s.start,end:s.end,dur:s.end-s.start}};
 let checks=[];const c=(name,pass)=>checks.push({name,pass:!!pass});
 const p=mk();p.events=[{type:'休假',start:d,end:d+3}];
 c('休假前日夜哨禁排',!!staticReason(p,t(d-1,1)));c('休假前日白天可候選',!staticReason(p,t(d-1,6)));
 c('休假最後一日禁排',!!staticReason(p,t(d+3)));c('收假當日禁排',!!staticReason(p,t(d+4)));c('收假隔日恢復',!staticReason(p,t(d+5)));
 p.events=[{type:'受訓',start:d,end:d+2}];c('受訓前一日禁排',!!staticReason(p,t(d-1)));c('結訓隔日恢復',!staticReason(p,t(d+3)));
 const q=mk('officer');q.events=[{type:'值星',start:d,end:d+2}];c('值星前後一天禁排',!!staticReason(q,t(d-1,6,'officer'))&&!!staticReason(q,t(d+3,6,'officer')));
 q.events=[{type:'督伙',start:d,end:d}];c('督伙當日及隔日禁安官',!!staticReason(q,t(d,6,'officer'))&&!!staticReason(q,t(d+1,6,'officer')));
 p.events=[{type:'夜查',start:d,end:d}];c('夜查三日全天禁排',[-1,0,1].every(k=>!!staticReason(p,t(d+k))));
 p.events=[{type:'車勤',start:d,end:d}];{const mo=(y,m,n)=>({y,m,days:n,first:dateOf(y,m,1),last:dateOf(y,m,n)});const hs=(y,m,n,ov='')=>holidaySet(mo(y,m,n),ov,[]);const has=(set,y,m,d)=>set.has(dateOf(y,m,d));const f27=hs(2027,2,28);c('2027 春節 2/4–2/10 預置',[4,5,6,7,8,9,10].every(d=>has(f27,2027,2,d))&&!has(f27,2027,2,11)&&!has(f27,2027,2,3));c('2027 十月國慶與光復連假',[9,10,11,23,24,25].every(d=>has(hs(2027,10,31),2027,10,d))&&!has(hs(2027,10,31),2027,10,12));c('2027 年底行憲連假與元旦補假',[24,25,26,31].every(d=>has(hs(2027,12,31),2027,12,d)));c('未預置年份不帶假日、手動可補',hs(2028,2,29).size===0&&has(hs(2028,2,29,'+5'),2028,2,5));c('2026 既有假日不受影響',has(hs(2026,2,28),2026,2,14)&&has(hs(2026,12,31),2026,12,25));}
 c('車勤前夜禁排、當日全天禁排',!!staticReason(p,t(d-1,1))&&!staticReason(p,t(d-1,6))&&!!staticReason(p,t(d,6)));c('車勤次日大門08–10起可排（含22–24）',!!staticReason(p,t(d+1,5))&&!!staticReason(p,t(d+1,2))&&!staticReason(p,t(d+1,6))&&!staticReason(p,t(d+1,1)));{const o=mk('officer');o.events=[{type:'車勤',start:d,end:d}];c('車勤次日安官06–12起可排（含22–24）',!!staticReason(o,t(d+1,4,'officer'))&&!!staticReason(o,t(d+1,2,'officer'))&&!staticReason(o,t(d+1,5,'officer'))&&!staticReason(o,t(d+1,1,'officer')));}
 p.events=[];const blocked=(day,num,other)=>!!conflict(p,t(day,num),new Map([[p.key,other]]));
 c('大門連兩天可排',!blocked(d+1,6,[t(d,10)]));
 c('大門前兩日均站禁排',blocked(d,6,[t(d-2,7),t(d-1,8)]));
 c('大門後兩日均站禁排',blocked(d,6,[t(d+2,7),t(d+1,8)]));
 c('大門補中間一天不可形成連三日',blocked(d,6,[t(d-1,7),t(d+1,8)]));
 c('大門兩日 2＋2 禁排，兩種填入順序',blocked(d+1,7,[t(d,2),t(d,6),t(d+1,3)])&&blocked(d,6,[t(d,2),t(d+1,3),t(d+1,7)]));
 c('大門兩日 3＋1 禁排',blocked(d+1,8,[t(d,2),t(d,6),t(d,10)]));
 c('大門兩日 2＋1 可排',!blocked(d+1,7,[t(d,2),t(d,6)]));
 c('大門同一天雙班只算一日',!blocked(d+1,6,[t(d,3),t(d,10)]));
 c('大門跨日休息最少六小時',blocked(d+1,2,[t(d,1)])&&!blocked(d+1,5,[t(d,1)]));
 {const OR=GUARD_SHIFT_RULES.officer,ob=(day,num,other)=>!!conflict(q,t(day,num,'officer'),new Map([[q.key,other]]));
  if(OR.minGapDays>=2)c('安官站一歇一',ob(d+1,2,[t(d,4,'officer')]));
  else{
   const cyc=k=>[5,6,7][((k%3)+3)%3],K=OR.maxConsecutiveDays,prevDays=Array.from({length:K},(_,i)=>t(d-K+i,cyc(i),'officer'));
   c('安官可連站兩天',K<2||!ob(d+1,6,[t(d,5,'officer')]));
   c('安官不可連續'+guardNumeral(K+1)+'天',ob(d,cyc(K),prevDays));
   c('安官跨日休息'+guardNumeral(OR.restHours)+'小時（22–24 接隔天 00–02 禁排）',OR.restHours<=0||ob(d+1,2,[t(d,1,'officer')]));
   c('安官 22–24 接隔天 06–12 可排',OR.restHours>6||!ob(d+1,5,[t(d,1,'officer')]));
   c('安官同日只排一班',ob(d,5,[t(d,2,'officer')]));
  }
 }
 c('兩日內同時段限制',!!conflict(p,t(d+2,6),new Map([[p.key,[t(d,6)]]])));
 c('同日大門六小時休息',!!conflict(p,t(d,8),new Map([[p.key,[t(d,6)]]])));
 c('同日兩班滿足六小時可排',!conflict(p,t(d,10),new Map([[p.key,[t(d,3)]]])));
 c('大門同日累計六小時上限',!!conflict(p,t(d,11),new Map([[p.key,[t(d,2),t(d,6),t(d,9)]]])));
 const sunday=dateOf(2026,11,15);c('連續星期日留守',!!conflict(p,t(sunday+7,6),new Map([[p.key,[t(sunday,6)]]])));
 c('週日大門 20–22 留守，22–24 另計',sundayStay(t(sunday,12))&&!sundayStay(t(sunday,1))&&!sundayStay(t(sunday-1,12)));
 c('兩週留守含 20–22（兩方向）',blocked(sunday+7,12,[t(sunday,5)])&&blocked(sunday,12,[t(sunday+7,11)]));
 c('安官週日 18–22 留守',sundayStay(t(sunday,7,'officer'))&&!sundayStay(t(sunday,6,'officer')));
 for(const pool of ['door','officer']){
  const conscript=mk(pool);conscript.events=[{type:'義務役',start:sunday-1,end:sunday+7}];
  c(names[pool]+'義務役六、日所有時段禁排',[sunday-1,sunday].every(day=>slots[pool].every(s=>!!staticReason(conscript,t(day,s.num,pool)))));
  c(names[pool]+'義務役平日或資格期間外可排',[sunday-8,sunday+1,sunday+13].every(day=>!staticReason(conscript,t(day,1,pool))));
 }
 c('安官同日不得多站',!!conflict(q,t(d,7,'officer'),new Map([[q.key,[t(d,6,'officer')]]])));
 const mo={y:2026,m:12,first:dateOf(2026,12,1),last:dateOf(2026,12,31)};
 c('兩位數西元年 26/12/03',parseDate('26/12/03',mo)===dateOf(2026,12,3));
 c('三位數民國年 115/12/03',parseDate('115/12/03',mo)===dateOf(2026,12,3));
 c('完整西元年 2025/12/03 可辨識',parseDate('2025/12/03',mo)===dateOf(2025,12,3));
 const broken=csvFields('H001,2026/12/03,"2026/12/08');
 c('未配對引號回傳錯誤不拋出',!!broken.parseError);
 const oldTwo=normalizeRosterFields(csvFields('H001\t測試甲'.replace('\\t','\t')),'door');
 c('兩欄舊名冊保留編號與姓名',oldTwo.id==='H001'&&oldTwo.name==='測試甲'&&oldTwo.rank==='');
 const oldThree=normalizeRosterFields(csvFields('H002 王大明 男'),'door');
 c('三欄舊名冊不把性別當姓名',oldThree.name==='王大明'&&oldThree.rank===''&&oldThree.sex==='男');
 c('缺級職產生警告而非假裝完整',oldTwo.issues.some(x=>x.code==='RANK_MISSING'));
 c('性別 M 轉為男',normalizeRosterFields(['P001','中士','甲','M'],'officer').sex==='男');
 c('性別 男性 轉為男',normalizeRosterFields(['H001','上兵','甲','男性'],'door').sex==='男');
 const unknownSex=normalizeRosterFields(['H001','上兵','甲','未知'],'door');
 c('不明性別清空並發出警告',unknownSex.sex===''&&unknownSex.issues.some(x=>x.code==='SEX_UNKNOWN'));
 c('級職字典包含士官長及少尉',isKnownRank('士官長')&&isKnownRank('少尉'));
 const oldOfficer=normalizeRosterFields(csvFields('P001 少尉 王小明 女'),'officer');
 c('舊級職可解析且提示資格待核',oldOfficer.rank==='少尉'&&oldOfficer.name==='王小明'&&oldOfficer.issues.some(x=>x.code==='RANK_OUTSIDE_POOL'));
 const mtag={};parseDate('115/12/03',mo,mtag);
 c('日期解析保留民國年來源資訊',mtag.format==='roc'&&mtag.inputYear===115);
 const y2025={},y2026={};
 const oldYear=parseDate('2025/12/03',mo,y2025),newYear=parseDate('2026/12/03',mo,y2026);
 c('排 2026/12 時偵測 2025/12 筆誤',adjacentYearTypo(mo,oldYear,oldYear,y2025,y2025));
 c('排 2026/12 時不誤報 2026/12',!adjacentYearTypo(mo,newYear,newYear,y2026,y2026));
 const normalHistory={},may=parseDate('2025/05/03',mo,normalHistory);
 c('前一年不同月份歷史紀錄不誤報',!adjacentYearTypo(mo,may,may,normalHistory,normalHistory));

 const gross=csvFields('H001,上兵,"王$\'",男');
 c('名冊 CSV 引號與特殊符號可解析',gross[2]==="王$'");
 const retired=mk();retired.inactiveFrom=d;
 c('離單位生效當日禁排',!!staticReason(retired,t(d,6)));
 c('離單位前一日不因停用禁排',!staticReason(retired,t(d-1,6)));
 c('缺少停用設定仍可正常判定',!staticReason(mk(),t(d,6)));
 c('日期校驗不接受不存在的日期',dateDisplaySafe('2026-02-30')!=='2026-02-30');

 const failed=checks.filter(x=>!x.pass);$('ruleSelfTestResult').textContent=checks.map(x=>(x.pass?'✓ ':'✗ ')+x.name).join('\n')+`\n\n${checks.length-failed.length}/${checks.length} 項通過。${failed.length?'請勿將本系統用作正式排班':'仍須用真實規章與獨立資料另行驗收'}`;
 $('ruleSelfTestResult').style.color=failed.length?'#a33c3c':'#336e65';return {total:checks.length,passed:checks.length-failed.length,failed:failed.map(x=>x.name)};
}

// #endregion
