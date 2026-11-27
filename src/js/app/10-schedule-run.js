// #region 整月排班與最小異動
async function runSchedule(reviewedModel){
 if(scheduleBusy){setStatus('排班正在運算，請勿重複啟動。','warn');return;}
 if(!allowScheduleChange())return;

 const previousLast=last,previousSig=loadedSig;
 const btn=$('run'),m=reviewedModel||reviewInputs();if(!m||m.errors.length||m.warnings.some(w=>w.code==='DATE_YEAR_SUSPECT')&&!yearIsConfirmed())return;
 const carryRows=['door','officer'].flatMap(pool=>m.staff[pool].filter(p=>p.carry>0||p.carrySource==='手動').map(p=>[pool,p.id,p.carry]));
 const pendingPrior=m.warnings.some(w=>w.code==='PRIOR_UNLOCKED');
 if(carryRows.length||pendingPrior){
  const item=appStore.months[activeMonth]??={},sig=textSig([carryRows,pendingPrior,prevDependency(activeMonth)]);
  if(item.carryReview!==sig){
   const summary=['door','officer'].map(pool=>names[pool]+' '+carryRows.filter(r=>r[0]===pool).reduce((n,r)=>n+r[2],0)+' 班').join('、');
   if(!confirm('本月登記的跨月減班：'+summary+'。'+(pendingPrior?'前月未封存或缺少補償快照。':'')+'已核對並繼續排班？'))return;
   item.carryReview=sig;
  }
 }
 if(progressOwner||repairBusy||minimalBusy)return;
 stopOffline('');
 const generation=++scheduleGeneration,startingMonth=activeMonth,startingSig=currentInputSig(),pins={...pinnedShifts},startingPins=textSig(pins);
 const auto=true;
 const origin=currentStep,priorRows=appStore.months[activeMonth]?.schedule;
 let published=null,finishEarly=false,canFinish=false,cancelled=false,committed=false,destination=origin;
 const notice=[];
 const view=openProgress(startingMonth+' 排班','取消排班',()=>{
  if(canFinish){
   finishEarly=true;
   if(offlineJobs.size)stopOffline('已使用通過巡檢的班表。');
  }else cancelled=true;
  $('runInterrupt').disabled=true;
 });
 scheduleBusy=true;btn.disabled=true;setScheduleButtonsBusy(true);
 const current=()=>generation===scheduleGeneration&&activeMonth===startingMonth&&currentInputSig()===startingSig&&
  textSig(pinnedShifts)===startingPins&&!isLocked()&&!storagePaused;
 function check(){if(!current())throw Error('月份、資料或班表狀態已變動，請重新排班');if(cancelled)throw Error('已取消排班');}
 async function phase(percent,text){paintProgress(view,percent,text);await allowProgressPaint();check();}
 try{
  await phase(4,'準備大門人選');
  const door=solvePool(m,'door',pins);
  await phase(15,'安排安官班次');
  const solutions={door,officer:solvePool(m,'officer',pins)};
  await phase(26,'檢查大門缺班');
  smartRepairPool(m,'door',door,pins,4800);exactNeighborhoodRepairPool(m,'door',door,pins);
  await phase(37,'檢查安官缺班');
  smartRepairPool(m,'officer',solutions.officer,pins,4800);exactNeighborhoodRepairPool(m,'officer',solutions.officer,pins);
  await phase(47,'平衡個人班數與作息');
  improveFairnessPool(m,'door',door,pins,3);improveFairnessPool(m,'officer',solutions.officer,pins,3);
  const missing=Object.fromEntries(['door','officer'].map(p=>[p,solutions[p].tasks.filter(t=>!solutions[p].res.get(t.key)).length]));
  optimizeDailyPool(m,'door',door,pins);
  for(const p of ['door','officer'])recountSolution(solutions[p],p,m);
  await phase(56,'核對兩表與固定班次');
  verifyOptimization(m,solutions,pins,missing);
  let base={m,solutions,scheduleRules:8};
  if(previousLast&&previousSig===startingSig&&previousLast.m.month.first===m.month.first){
   const oldIds=compactAssignments(previousLast.solutions),ids=compactAssignments(solutions);
   const frame=solverBuildRequest(m,solutions).pools;
   for(const [pool,score] of [['officer',officerObjectives],['door',doorObjectives]]){
    const src=frame[pool],byId=new Map(m.staff[pool].map((p,i)=>[p.id,i]));
    const prior=oldIds[pool].map(id=>id==null?-1:byId.get(id));
    if(prior.some(i=>i===undefined)||compareDoorObjectives(score(src,prior),score(src,src.baseline))>=0)continue;
    try{
     const chosen={...ids,[pool]:oldIds[pool]};
     const candidate=cloneSearchCandidate(m,solutions,chosen);
     verifyOptimization(m,candidate,pins);base.solutions=candidate;ids[pool]=oldIds[pool];
    }catch(_){/* An older roster can violate a newly introduced rule. */}
   }
  }
  canFinish=true;$('runInterrupt').textContent='使用目前已驗證班表';
  if(auto&&!finishEarly){
   // 大門與安官同時精算（各用一個背景執行緒）
   const frac={door:0,officer:0},text={};
   const shared={base,view,check,parallel:true,paint:(pool,f,t)=>{frac[pool]=f;text[pool]=t;
    paintProgress(view,60+36*(frac.door+frac.officer)/2,(text.door||'大門準備中')+'｜'+(text.officer||'安官準備中'));}};
   const results=await Promise.all(['door','officer'].map(pool=>runPrecision(pool,shared)));
   for(const r of results)if(r)notice.push(r);
   check();
  }
  await phase(97,'完成最終巡檢');
  verifyOptimization(base.m,base.solutions,pins);
  published=base;last=base;loadedSig=startingSig;currentPool='door';missingOnly=false;allMissingMode=false;
  $('assignPanel').classList.add('hidden');$('filterDate').value=initialViewDate(m.month);$('filterText').value='';
  render();
  if(showIndependentAudit().issues.length)throw Error('完成前巡檢未通過');
  if(priorRows){const changes=shiftDiff(priorRows,scheduleRows(last.solutions));
   if(changes.length)appendChangeLog('整月重新排班',changes,{reason:'整月排班與巡檢完成',afterRef:scheduleReferenceCode()});}
  $('noResults').classList.add('hidden');
  if(!saveAutoNow())notice.push('自動儲存不可用，請備份班表。');
  committed=true;destination='results';
  $('repairStatus').textContent=notice.join('　');
  setStatus('已完成本月排班。');
  paintProgress(view,100,'排班完成');await allowProgressPaint();
 }catch(e){
  if(!committed&&activeMonth===startingMonth&&generation===scheduleGeneration&&(last===previousLast||last===published)){
   last=previousLast;loadedSig=previousSig;
   if(last)render();else{$('results').classList.add('hidden');$('noResults').classList.remove('hidden');}
  }
  if(!cancelled){
   if(!committed)destination='review';
   setStatus('排班未完成：'+(e?.message||e),'error');
  }
 }finally{
  scheduleBusy=false;btn.disabled=false;setScheduleButtonsBusy(false);closeProgress(view);
  if(activeMonth===startingMonth&&generation===scheduleGeneration)showStep(destination);
 }
}

// v6.7：以舊月班表為基準的「最小異動」候選，與一般全月重排完全分離。
// 不降低任何強制限制；本地預覽、人工確認後才寫回。搜尋有限，不承諾全域最小異動。
let pendingMinimal=null;
function scheduleRows(solutions){
 return Object.fromEntries(['door','officer'].map(pool=>[pool,solutions[pool].tasks.map(t=>[t.day,t.num,solutions[pool].res.get(t.key)?.id||null])]));
}
function shiftDiff(before,after){
 const changes=[];
 for(const pool of ['door','officer']){
  const previous=new Map((before?.[pool]||[]).map(r=>[pool+':'+r[0]+':'+r[1],r[2]??null]));
  for(const row of after?.[pool]||[]){
   const key=pool+':'+row[0]+':'+row[1];if(!previous.has(key))throw Error('舊班表不完整，無法安全比較：'+key);
   const oldId=previous.get(key),newId=row[2]??null;
   if(oldId!==newId)changes.push({pool,day:row[0],num:row[1],before:oldId,after:newId});
  }
 }
 return changes.sort((a,b)=>a.day-b.day||a.pool.localeCompare(b.pool)||a.num-b.num);
}
function shiftDisplayName(id,pool,model){
 if(!id)return '缺班';
 const person=model?.staff?.[pool]?.find(p=>p.id===id);
 return person?`${person.rank||''} ${person.name}（${id}）`.trim():`${id}（原名冊／已離單位）`;
}
function renderShiftDiff(host,changes,model){
 host.replaceChildren();
 if(!changes.length){const el=document.createElement('p');el.className='help';el.textContent='沒有需要變動的班次。';host.appendChild(el);return;}
 for(const c of changes){const box=document.createElement('div');box.className='minimal-diff-row';
  const label=document.createElement('b');label.textContent=`${dateText(c.day)} · ${names[c.pool]} 第${c.num}班`;
  const text=document.createElement('span');text.textContent=`${shiftDisplayName(c.before,c.pool,model)} → ${shiftDisplayName(c.after,c.pool,model)}`;
  box.append(label,text);host.appendChild(box);
 }
}
function appendChangeLog(type,changes,info={}){
 const month=activeMonth,item=appStore.months[month]||{};
 const records=Array.isArray(item.changeLog)?item.changeLog:[];
 records.unshift({at:new Date().toISOString(),type,by:String(info.by||'未標記').slice(0,40),reason:String(info.reason||'').slice(0,140),
  beforeRef:info.beforeRef||'',afterRef:info.afterRef||'',changes:changes.map(c=>[c.pool,c.day,c.num,c.before,c.after])});
 item.changeLog=records.slice(0,30);appStore.months[month]=item;
}
function renderChangeHistory(){
 const item=appStore.months[activeMonth],records=Array.isArray(item?.changeLog)?item.changeLog:[];
 $('changeHistoryCount').textContent=`${records.length} 筆`;
 const host=$('changeHistoryList');host.replaceChildren();
 if(!records.length){host.textContent='尚無班表變更紀錄。';return;}
 for(const entry of records){const wrap=document.createElement('details');wrap.className='change-history-event';
  const head=document.createElement('summary');let ts='';try{ts=new Date(entry.at).toLocaleString('zh-TW',{hour12:false});}catch(_){}
  const changes=Array.isArray(entry.changes)?entry.changes:[];
  head.textContent=`${ts} · ${entry.type||'調整'} · ${changes.length} 班 · ${entry.by||'未標記'}`;
  const line=document.createElement('p');line.className='help';line.textContent=`原因：${entry.reason||'未填寫'}；套用前：${entry.beforeRef||'—'}；套用後：${entry.afterRef||'—'}`;
  const list=document.createElement('div');list.className='minimal-diff-list';
  renderShiftDiff(list,changes.filter(x=>Array.isArray(x)&&x.length>=5).map(x=>({pool:x[0],day:x[1],num:x[2],before:x[3],after:x[4]})),last?.m);
  wrap.append(head,line,list);host.appendChild(wrap);
 }
}
function discardMinimal(reason=''){
 pendingMinimal=null;$('minimalCompare').classList.add('hidden');
 if(reason)$('minimalStatus').textContent=reason;
}
function refreshMinimalPanel(){
 const item=appStore.months[activeMonth],available=!!item?.schedule;
 const offer=available&&!isLocked()&&(!last||item.inputSig!==currentInputSig()||last.auditIssues?.length||last.solutions.door.missing||last.solutions.officer.missing||dailyLoadStats(last.solutions.door).extra||minimalBusy||!!pendingMinimal);
 $('minimalPanel').classList.toggle('hidden',!offer);
 if(!offer)$('minimalPanel').open=false;
 if(!last&&available&&!/無法安全載入|未通過目前的規則巡檢/.test($('noResults').textContent))$('noResults').textContent='本月已有儲存班表，請核對目前資料後再排班。';
 if(!available)$('noResults').textContent='還沒有班表。新增人員、登記休假後即可一鍵排班。';
 $('minimalStart').disabled=!available||isLocked()||scheduleBusy||repairBusy||minimalBusy;
 if(!available)return;
 if(isLocked())$('minimalStatus').textContent='🔒 此月份已封存，須解除封存才能修復。';
 else if(!pendingMinimal)$('minimalStatus').textContent=loadedSig&&loadedSig===currentInputSig()?'已排班；如有需要可預覽不改動原班表的修復。':'偵測到有舊版班表。若登記了新休假／勤務，建議先預覽最小異動修復。';
 if(pendingMinimal&&(pendingMinimal.month!==activeMonth||pendingMinimal.sig!==currentInputSig()||pendingMinimal.pins!==textSig(pinnedShifts)||pendingMinimal.source!==textSig(item.schedule)))discardMinimal('資料、月份或固定班次已變動，請重新預覽。');
}
function retainedPool(m,pool,saved,pins,onePerDay=false){
 const rows=Array.isArray(saved)?saved:[],map=new Map(rows.map(r=>[`${pool}:${r[0]}:${r[1]}`,r[2]??null]));
 if(map.size!==m.tasks[pool].length)throw Error(names[pool]+' 舊班表班次數不完整，無法進行最小異動修復。');
 const blanks=rows.map(r=>[r[0],r[1],null]);
 const sol=emptySolution(m,pool,blanks),res=sol.res;
 const accepted=new Map(m.staff[pool].map(p=>[p.key,[...p.history]]));
 const candidates=sol.tasks.filter(t=>map.get(t.key)).sort((a,b)=>{
   const ap=Object.prototype.hasOwnProperty.call(pins,a.key),bp=Object.prototype.hasOwnProperty.call(pins,b.key);
   return Number(bp)-Number(ap)||(sol.options.get(a.key)?.length||0)-(sol.options.get(b.key)?.length||0)||a.day-b.day||a.num-b.num;
 });
 let released=0;
 for(const t of candidates){const id=map.get(t.key),p=m.staff[pool].find(p=>p.id===id);
   const pinned=Object.prototype.hasOwnProperty.call(pins,t.key);
   if(pinned&&pins[t.key]!==id)throw Error(`固定班次 ${dateText(t.day)} 第${t.num}班與舊班表不一致，請先處理固定班次。`);
   if(onePerDay&&p&&accepted.get(p.key).some(a=>a.day===t.day)){
    if(pinned)return null;
    released++;continue;
   }
   const why=!p?'人員已不在名冊':staticReason(p,t)||conflict(p,t,accepted);
   if(why){if(pinned)throw Error(`固定班次 ${dateText(t.day)} ${names[pool]} 第${t.num}班已不符合新限制：${why}；請先解除固定。`);released++;continue;}
   res.set(t.key,p);accepted.get(p.key).push(t);
 }
 for(const [k,id] of Object.entries(pins))if(k.startsWith(pool+':')&&map.get(k)!==id)throw Error('人工固定班次與原班表不一致：'+k);
 recountSolution(sol,pool,m);
 return {sol,released};
}
// v6.8: exact iterative-deepening search for minimum number of CHANGED shifts.
// This is native JavaScript branch-and-bound, NOT OR-Tools CP-SAT or WASM.
// It can certify minimum edit count for a FULL roster only when every smaller
// edit budget was exhausted without node/time cutoff. Domains cover all people
// in the selected pool, and all other assignments remain in the model.
// Crucial: an OPTIMAL here is relative to currently implemented hard rules;
// independently verify the resulting schedule before making it available.
function exactMinimumChangesPool(m,pool,source,pins={},config={}){
 const maxChanges=Math.min(6,Math.max(0,config.maxChanges??4));
 const maxNodes=Math.max(50,config.maxNodes??12000);
 const maxMs=Math.max(50,config.maxMs??1100);
 const people=m.staff[pool],tasks=m.tasks[pool];
 const byId=new Map(people.map(p=>[p.id,p]));
 const keys=tasks.map(t=>t.key),byTask=new Map(tasks.map(t=>[t.key,t]));
 const expected=new Map(source.map(row=>[`${pool}:${row[0]}:${row[1]}`,row[2]??null]));
 if(expected.size!==tasks.length||keys.some(k=>!expected.has(k)))throw Error('數學精修：原始班表缺少班次');
 const start=performance.now(),orig=new Map(expected),state=new Map();
 for(const k of keys)state.set(k,byId.has(orig.get(k))?orig.get(k):null);
 const domains=new Map(),byHist=new Map();
 for(const p of people)byHist.set(p.id,new Map([[p.key,p.history]]));
 for(const t of tasks){const domain=people.filter(p=>!staticReason(p,t)&&!conflict(p,t,byHist.get(p.id)));
  domains.set(t.key,domain.map(p=>p.id));
 }
 for(const [key,id] of Object.entries(pins))if(key.startsWith(pool+':')&&orig.get(key)!==id)
  throw Error('數學精修：人工固定班次與原班表不一致：'+key);
 let nodes=0,cutoff=false,found=null,foundDepth=null,reason='';
 const changed=new Set();
 // Return one forced or pairwise/group violation. Every legal solution must
 // change at least one of the displayed keys. This is the search completeness
 // invariant for each successive depth limit.
 function violation(){
  const owned=new Map(people.map(p=>[p.id,[]]));
  for(const t of tasks){const id=state.get(t.key);
   if(id===null)return [t.key];
   if(!domains.get(t.key).includes(id))return [t.key];
   owned.get(id).push(t);
  }
  for(const p of people){const arr=owned.get(p.id),hist=p.history;
   for(const t of arr){
    // History is immutable; if this conflicts, only this shift may change.
    if(conflict(p,t,byHist.get(p.id)))return [t.key];
   }
   for(let i=0;i<arr.length;i++)for(let j=i+1;j<arr.length;j++){
    const a=arr[i],b=arr[j];
    if(conflict(p,a,new Map([[p.key,[b]]]))||conflict(p,b,new Map([[p.key,[a]]])))return [a.key,b.key];
   }
   // Same-day total constraints can be violated even if each pair is valid.
   if(pool==='door'){
    const days=new Map();for(const t of arr){let group=days.get(t.day)||[];group.push(t);days.set(t.day,group);}
    const worked=new Set([...days.keys(),...hist.map(t=>t.day)]);
    for(const first of worked)if(worked.has(first+1)){
     const active=[...(days.get(first)||[]),...(days.get(first+1)||[])];
     if(active.length&&active.length+hist.filter(t=>t.day===first||t.day===first+1).length>GUARD_SHIFT_RULES.door.twoDayMaxShifts)return active.map(t=>t.key);
    }
    const K=GUARD_SHIFT_RULES.door.maxConsecutiveDays,span=k=>Array.from({length:K+1},(_,i)=>k+i);
    for(const first of worked)if(span(first).every(d=>worked.has(d))){
     const movable=span(first).flatMap(d=>days.get(d)||[]);
     if(movable.length)return movable.map(t=>t.key);
    }
    for(const group of days.values())if(group.length>GUARD_SHIFT_RULES.door.dailyMaxShifts||group.reduce((n,t)=>n+t.dur,0)>GUARD_SHIFT_RULES.door.dailyMaxHours)return group.map(t=>t.key);
   }
  }
  return null;
 }
 function dfs(maxEdits){
  if(++nodes>maxNodes||performance.now()-start>maxMs){cutoff=true;return false;}
  const defect=violation();
  if(defect===null){found=new Map(state);foundDepth=changed.size;return true;}
  if(changed.size>=maxEdits)return false;
  // If every member of a violated set was changed already, no legal completion
  // exists down this branch. Reassignment of the same shift twice is never
  // needed: we enumerate every final candidate on its first change.
  for(const k of defect){
   if(changed.has(k)||Object.prototype.hasOwnProperty.call(pins,k))continue;
   const prior=state.get(k),candidates=domains.get(k);
   // Reassign to every eligible roster member. No null candidates: all
   // shifts must be filled for a global minimum-edit certificate.
   for(const who of candidates){
    if(who===prior)continue;
    state.set(k,who);changed.add(k);
    if(dfs(maxEdits))return true;
    changed.delete(k);state.set(k,prior);
    if(cutoff)return false;
   }
  }
  return false;
 }
 // Admissible lower bound: each initially missing or statically forbidden
 // assignment necessarily changes in every fully filled solution.
 let lower=0;
 for(const t of tasks)if(state.get(t.key)===null||!domains.get(t.key).includes(state.get(t.key)))lower++;
 if(lower>maxChanges)return {status:'NOT_ATTEMPTED',reason:`至少 ${lower} 班必須改動，超出本機精修上限 ${maxChanges} 班`,nodes:0,found:false,certified:false};
 for(let k=lower;k<=maxChanges;k++){
  if(dfs(k))return {status:'OPTIMAL',reason:`已完整排除所有少於 ${foundDepth} 班異動的方案`,found:true,certified:true,changed:foundDepth,assignment:found,nodes,ms:Math.round(performance.now()-start)};
  if(cutoff)return {status:'UNKNOWN',reason:'搜尋達到時間或節點額度，無法證明最優',nodes,ms:Math.round(performance.now()-start),found:false,certified:false};
 }
 return {status:'BOUND_EXHAUSTED',reason:`已完整檢查最多 ${maxChanges} 班異動，未找到全班填滿方案；不代表整月無解`,nodes,ms:Math.round(performance.now()-start),found:false,certified:false};
}
function solutionFromExact(m,pool,source,assignment){
 const blank=source.map(r=>[r[0],r[1],null]);const sol=emptySolution(m,pool,blank);
 const roster=new Map(m.staff[pool].map(p=>[p.id,p]));
 for(const t of sol.tasks){const id=assignment.get(t.key);sol.res.set(t.key,id?roster.get(id):null);}
 recountSolution(sol,pool,m);
 if(sol.missing||sol.issues.length)throw Error('精確解未通過班次檢查');
 return sol;
}
function changedPoolCount(pool,source,sol){
 const orig=new Map(source.map(r=>[`${pool}:${r[0]}:${r[1]}`,r[2]??null]));
 return sol.tasks.reduce((n,t)=>n+Number((sol.res.get(t.key)?.id??null)!==orig.get(t.key)),0);
}
// Keep eligible original duties in place and search only the open slots.
// A full roster reaching this lower bound also proves the minimum edits in its stated scope.
function repairAtEditFloor(m,pool,rows,pins){
 const keep=retainedPool(m,pool,rows,pins,pool==='door');
 if(!keep)return null;
 const sol=keep.sol,open=sol.tasks.filter(t=>!sol.res.get(t.key));
 const people=new Map(m.staff[pool].map(p=>[p.id,p]));
 const source=new Map(rows.map(([day,num,id])=>[pool+':'+day+':'+num,id]));
 const seen=new Set();let lower=0;
 for(const t of sol.tasks){
  const p=people.get(source.get(t.key));
  if(!p||staticReason(p,t)){lower++;continue;}
  const dayKey=p.key+'|'+t.day;
  if(seen.has(dayKey))lower++;
  seen.add(dayKey);
 }
 if(open.length!==lower||open.length>40)return null;
 const occupied=new Map(m.staff[pool].map(p=>[p.key,[...p.history]]));
 for(const t of sol.tasks){const p=sol.res.get(t.key);if(p)occupied.get(p.key).push(t);}
 const end=performance.now()+750;let nodes=0;
 function fill(pending){
  if(!pending.length)return true;
  if(++nodes>12000||performance.now()>end)return false;
  let chosen=null,options=null;
  for(const t of pending){
   const legal=sol.options.get(t.key).filter(p=>!occupied.get(p.key).some(a=>a.day===t.day)&&!conflict(p,t,occupied));
   if(!legal.length)return false;
   if(!options||legal.length<options.length){options=legal;chosen=t;}
  }
  const other=pending.filter(t=>t!==chosen);
  const deficit=p=>sol.targets.get(p.key)-(occupied.get(p.key).length-p.history.length);
  options.sort((a,b)=>deficit(b)-deficit(a));
  for(const p of options){
   sol.res.set(chosen.key,p);occupied.get(p.key).push(chosen);
   if(fill(other))return true;
   occupied.get(p.key).pop();sol.res.set(chosen.key,null);
   if(performance.now()>end)break;
  }
  return false;
 }
 if(!fill(open))return null;
 recountSolution(sol,pool,m);
 if(sol.missing||sol.issues.length||changedPoolCount(pool,rows,sol)!==lower)return null;
 return {sol,proof:{certified:true,changed:lower,nodes,zeroDaily:pool==='door'}};
}
let minimalBusy=false;
function updateMathProofMessage(text,good=false){const el=$('minimalMathStatus');el.textContent=text;el.className='proof-status '+(good?'good':'warn');}

async function minimalPreview(){
 if(scheduleBusy||repairBusy||minimalBusy)return;
 if(!allowScheduleChange())return;
 minimalBusy=true;$('minimalStart').disabled=true;
 $('minimalStatus').textContent='正在核對資料並準備精修…';
 updateMathProofMessage('正在嘗試離線精確搜尋。有限額度內可證明最少改動；超額時自動保留智慧修復結果。');
 // Yield one frame so the iPhone viewer can show the busy indicator.
 await new Promise(resolve=>setTimeout(resolve,25));
 let m,previewError='';
 try{m=build();if(m.errors.length)throw Error(m.errors.slice(0,3).join('；'));
  if(m.warnings.some(w=>w.code==='DATE_YEAR_SUSPECT')&&!yearIsConfirmed(m))throw Error('有尚未確認的疑似年份筆誤，請先到資料檢查頁確認。');
  const item=appStore.months[activeMonth];if(!item?.schedule)throw Error('本月沒有既有班表，請先一鍵排班。');
  const source=JSON.parse(JSON.stringify(item.schedule)),sig=currentInputSig(),pinSig=textSig(pinnedShifts),month=activeMonth;
  const solutions={},released={},repairs={},proofs={};
  for(const pool of ['door','officer']){
   const keep=retainedPool(m,pool,source[pool],pinnedShifts);solutions[pool]=keep.sol;released[pool]=keep.released;
   const directFull=repairAtEditFloor(m,pool,source[pool],pinnedShifts);
   if(directFull){
    solutions[pool]=directFull.sol;proofs[pool]=directFull.proof;
    repairs[pool]={direct:keep.sol.missing,local:0,remaining:0};continue;
   }
   const stable=new Map(keep.sol.res);
   const direct=smartRepairPool(m,pool,keep.sol,pinnedShifts,3800);
   recountSolution(keep.sol,pool,m);
   if(keep.sol.issues.length){keep.sol.res=stable;recountSolution(keep.sol,pool,m);}
   const local=exactNeighborhoodRepairPool(m,pool,keep.sol,pinnedShifts,{attempts:24,nodes:17000,perAttempt:2800,maxVars:9,candidates:8});
   recountSolution(keep.sol,pool,m);
   const heuristicChanged=changedPoolCount(pool,source[pool],keep.sol);
   let exact;
   try{
    exact=exactMinimumChangesPool(m,pool,source[pool],pinnedShifts,{maxChanges:4,maxNodes:15000,maxMs:1200});
    if(exact.found){
     const exactSol=solutionFromExact(m,pool,source[pool],exact.assignment);
     const exactChanges=changedPoolCount(pool,source[pool],exactSol);
     if(exactChanges!==exact.changed)throw Error('最少改動計數不一致');
     if(keep.sol.missing>0||exactChanges<heuristicChanged){solutions[pool]=exactSol;}
     else if(exactChanges>heuristicChanged&&keep.sol.missing===0){
      exact={status:'UNVERIFIED',certified:false,reason:'精確搜尋與既有候選的改班數不一致，未宣稱最優',nodes:exact.nodes};
     }
    }
   }catch(e){exact={status:'ERROR',certified:false,reason:'精確搜尋未能完成驗證：'+String(e?.message||e)};}
   proofs[pool]=exact;
   recountSolution(solutions[pool],pool,m);
   repairs[pool]={direct:direct.filled,local:local.filled,remaining:solutions[pool].missing};
  }
  if(month!==activeMonth||sig!==currentInputSig()||pinSig!==textSig(pinnedShifts)||textSig(item?.schedule)!==textSig(source))throw Error('運算期間資料已改變，已捨棄過期方案');
  verifyOptimization(m,solutions,pinnedShifts);
  const after=scheduleRows(solutions),changes=shiftDiff(source,after);
  const oldFilled=Object.values(source).reduce((n,rows)=>n+rows.filter(r=>r[2]).length,0);
  const newFilled=Object.values(after).reduce((n,rows)=>n+rows.filter(r=>r[2]).length,0);
  const initialViolations=released.door+released.officer;
  const certified=['door','officer'].every(pool=>proofs[pool]?.certified)&&newFilled===m.tasks.door.length+m.tasks.officer.length;
  if(!changes.length&&item.inputSig===sig){discardMinimal();previewError='已核對：原班表可沿用，沒有需要調整的班次。';updateMathProofMessage(previewError);return;}
  pendingMinimal={month:activeMonth,sig,pins:pinSig,source:textSig(item.schedule),before:source,after,m,solutions,changes,oldFilled,newFilled,initialViolations,proofs,certified};
  $('minimalCompare').classList.remove('hidden');$('minimalDiffCount').textContent=`${changes.length} 班`;
  $('minimalSummary').className='minimal-summary'+(newFilled<oldFilled||changes.length>20?' warn':'');
  $('minimalSummary').textContent=`原本排入 ${oldFilled} 班 → 修復後 ${newFilled} 班（總班數 ${m.tasks.door.length+m.tasks.officer.length}）。大門同日額外 ${dailyLoadStats(solutions.door).extra} 班。\n原安排因新限制需釋放 ${initialViolations} 班；本次共有 ${changes.length} 班與原版不同，仍缺 ${m.tasks.door.length+m.tasks.officer.length-newFilled} 班。\n${changes.length>20?'⚠ 異動較多，請逐筆核對並通知相關人員。':''}`;
  renderShiftDiff($('minimalDiffList'),changes,m);
  const describe=pool=>{const p=proofs[pool],label=names[pool];return `${label}：${p?.certified?'✅ '+(p.zeroDaily?'在排滿且同日零多班下，':'排滿下，')+'已證明最少 '+p.changed+' 班異動':`⚠ 尚未證明最優（${p?.reason||'未執行'}）`}${p?.nodes!==undefined?'，搜尋 '+p.nodes+' 節點':''}`;};
  updateMathProofMessage(`${certified?'已排滿；各勤務最少異動的證明範圍如下。':'🔎 已產生合法候選；部分範圍尚未完成數學最優證明。'}\n${describe('door')}\n${describe('officer')}\n本機使用有時間與節點上限的分枝回溯搜尋；原班表尚未變動。`,certified);
  $('minimalStatus').textContent='✅ 已產生候選方案，尚未套用，原班表不變。';
  $('minimalCompare').scrollIntoView({block:'nearest',behavior:'smooth'});
 }catch(e){previewError='⛔ 無法安全產生候選：'+(e?.message||e);discardMinimal();updateMathProofMessage('本次精修沒有產生可安全套用的結果：'+String(e?.message||e));}
 finally{minimalBusy=false;refreshMinimalPanel();if(previewError)$('minimalStatus').textContent=previewError;}
}

function applyMinimal(){
 const pending=pendingMinimal;if(!pending)return;
 try{
  if(isLocked())throw Error('本月已封存');
  const item=appStore.months[activeMonth];
  if(activeMonth!==pending.month||currentInputSig()!==pending.sig||textSig(pinnedShifts)!==pending.pins||textSig(item?.schedule)!==pending.source)throw Error('資料或既有班表已變動，請重新預覽。');
  if(yearReviewRequired())throw Error('疑似年份尚未確認');
  verifyOptimization(pending.m,pending.solutions,pinnedShifts);
  const oldLast=last,oldSig=loadedSig;
  last={m:pending.m,solutions:pending.solutions,scheduleRules:8};loadedSig=pending.sig;
  try{render();showIndependentAudit();
   appendChangeLog(pending.certified?(pending.proofs.door.zeroDaily?'排滿、大門零多班下最少異動（已證明）':'數學最少異動（已證明）'):'最小異動重排（未證明最優）',pending.changes,{by:$('changeOperator').value.trim(),reason:$('minimalReason').value.trim(),beforeRef:textSig(pending.before),afterRef:scheduleReferenceCode()});
   const saved=saveAutoNow();renderChangeHistory();
   if(!saved)$('minimalStatus').textContent='⚠ 已套用到目前畫面，但本機自動儲存失敗！請立即使用「備份全部」並確認檔案存在。';
  }catch(e){last=oldLast;loadedSig=oldSig;throw e;}
  const saveWarning=$('minimalStatus').textContent.includes('自動儲存失敗');
  discardMinimal(saveWarning?'⚠ 已套用，但沒有成功自動存檔！請立刻手動備份。':'✅ 已套用，變動 '+pending.changes.length+' 班，並記錄到本月變更紀錄。');
  $('noResults').classList.add('hidden');$('filterDate').value=initialViewDate(pending.m.month);
  showStep('results');
 }catch(e){$('minimalStatus').textContent='⛔ 套用已取消，原班表未變：'+(e?.message||e);}
}

async function importCSV(target,file){
 const bytes=await file.arrayBuffer();let data='';
 try{data=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch(e){try{data=new TextDecoder('big5').decode(bytes);}catch(_){data=new TextDecoder().decode(bytes);}}
 data=data.replace(/^\ufeff/,'');
 if(target==='door'||target==='officer'){
  const oldId=new Set(rosterPersons(target).map(x=>x.id)),newId=new Set(data.split(/\r?\n/).map(x=>csvFields(x)[0]).filter(Boolean));
  const retired=[...oldId].filter(x=>!newId.has(x));
  const touched=retired.filter(id=>Object.values(appStore.months).some(item=>(item?.schedule?.[target]||[]).some(r=>r[2]===id)||Object.entries(item?.pins||{}).some(([k,v])=>k.startsWith(target+':')&&v===id)));
  if(touched.length)throw Error('匯入會移除已有歷史排班的 '+touched.length+' 名人員（'+touched.slice(0,4).join('、')+'）。請在原名冊修正，不可直接覆蓋歷史身分。');
 }
 $(target).value=data;
 invalidateResult();refreshUX();if(target==='door'||target==='officer')rosterDisplay();if(recordDefs[target])renderRecordEditor();
 if(target==='door'||target==='officer')$('setupStatus').textContent=`已匯入：${file.name}。請確認名冊預覽是否正確。`;saveAutoNow();
}



// #endregion
