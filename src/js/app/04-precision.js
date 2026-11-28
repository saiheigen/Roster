// #region 局部重排、離線精算、品質摘要與規則設定

// v5.7｜受限大型鄰域搜尋（LNS）：從既有合法班表抽出一部分非固定班次，再依稀缺度和負擔重建。
// 不更改既有強制規則；若無法保留覆蓋率或交叉驗證失敗，整組候選直接淘汰。
function cloneSearchCandidate(m,template,ids){
 const solutions={};
 for(const pool of ['door','officer']){
  const source=template[pool],people=new Map(m.staff[pool].map(p=>[p.id,p]));
  const res=new Map(),list=ids[pool]||[];
  if(list.length!==source.tasks.length)throw Error('局部重排來源班次不完整');
  source.tasks.forEach((t,i)=>{const id=list[i];if(id&&!people.has(id))throw Error('局部重排找不到原人員');res.set(t.key,id?people.get(id):null);});
  solutions[pool]={...source,res};recountSolution(solutions[pool],pool,m);
 }
 return solutions;
}
function compactAssignments(solutions){return Object.fromEntries(['door','officer'].map(pool=>[pool,solutions[pool].tasks.map(t=>solutions[pool].res.get(t.key)?.id||null)]));}










// 全部運算在本機完成（v8.0 起已移除線上求解器）。
const {offlineAssignments}=RosterOfflineCodec;
// All worker inputs are local. The main page retains the roster and validates each result.
// 大門與安官的精算各自在一個背景執行緒同時進行（手機多核心可同時運算）
const offlineJobs=new Set();
function stopOffline(message='已停止精修，保留目前班表。',only=null){
 const jobs=only?(offlineJobs.has(only)?[only]:[]):[...offlineJobs];
 for(const job of jobs){
  offlineJobs.delete(job);job.reject?.(Error(message));job.worker?.terminate();
  if(job.precision&&message)precisionPart(job.pool,'Report').textContent=(job.summary||activeMonth+' '+job.label)+'｜已停止';
 }
 if(!offlineJobs.size){$('offlineStop').hidden=true;precisionButtons(false);}
 if(!message&&!only)for(const pool of ['door','officer'])precisionPart(pool,'Panel').hidden=true;
 if(message||!only)$('offlineReport').textContent=message;
}
async function solveOfflinePool(job,url,bytes,frame,onProgress=null){
 let worker,timer;
 try{
  worker=new Worker(url);job.worker=worker;
  return await new Promise((resolve,reject)=>{
   job.reject=reject;
   timer=setTimeout(()=>reject(Error('背景精算引擎未啟動')),45000);
   worker.onerror=()=>reject(Error('背景求解器無法執行'));
   worker.onmessage=({data})=>{
    if(data?.type==='ready'&&data.id===1){clearTimeout(timer);return;}
    if(data?.type==='progress'&&data.id===1&&onProgress){
     try{onProgress(data.progress);}catch(e){reject(e);}
    }
    if(data?.type==='result'&&data.id===1)resolve(data.result);
    if(data?.type==='error')reject(Error(onProgress&&data.error?data.error:'背景求解器執行失敗'+(data.phase?'：'+data.phase:'')));
   };
   const buffer=bytes.slice().buffer;
   worker.postMessage({type:'solve',id:1,frame,wasm:buffer},[buffer]);
  });
 }finally{clearTimeout(timer);worker?.terminate();job.worker=null;job.reject=null;}
}

// 精算（不含一鍵排班）時同時開幾個背景引擎，各用不同的隨機種子與搜尋力度（見 variantOptions）。
// 任何一個把全部目標證明完就採用它並停止其他；都沒證明完就等全部結束，取證明最多的結果、最高的點數下限。
// 每個引擎回報的班表都經過同一個 onProgress 檢查與巡檢，只會採用更好的班表。
function precisionWorkerCount(){
 const cores=navigator.hardwareConcurrency||2,mem=navigator.deviceMemory||8,touch=matchMedia?.('(pointer:coarse)').matches;
 // 大門、安官同時精算，各分一半核心；手機或記憶體小的裝置最多 2 個，避免瀏覽器因記憶體不足關掉分頁
 return Math.max(1,Math.min(touch||mem<=4?2:3,Math.floor(cores/2)));
}
async function solveOfflinePortfolio(job,url,bytes,src,onProgress,count){
 if(count<=1)return solveOfflinePool(job,url,bytes,src,onProgress);
 const subs=Array.from({length:count},()=>({worker:null,reject:null}));
 const level=r=>r?(r.pointsUnproven?0:2)+(r.holidayUnproven?0:1):-1;
 return await new Promise((resolve,reject)=>{
  let settled=false,pending=count;const results=[],errors=[];
  const stopAll=()=>subs.forEach(sub=>{sub.reject?.(Error('已由其他引擎完成'));sub.worker?.terminate();});
  job.worker={terminate:stopAll};
  job.reject=e=>{if(settled)return;settled=true;stopAll();reject(e);};
  const done=()=>{
   if(settled||pending)return;settled=true;
   if(!results.length){reject(errors[0]||Error('背景求解器執行失敗'));return;}
   const best=results.reduce((a,b)=>level(b)>level(a)?b:a);
   const bounds=results.map(r=>r.pointsBound).filter(Number.isFinite);
   resolve({...best,pointsBound:bounds.length?Math.max(...bounds):best.pointsBound,safetyHit:results.some(r=>r.safetyHit)});
  };
  subs.forEach((sub,k)=>{
   solveOfflinePool(sub,url,bytes,{...src,variant:k},p=>onProgress(p,k)).then(r=>{
    if(settled)return;
    if(r&&!r.workLimited&&level(r)===3){settled=true;stopAll();resolve({...r,safetyHit:!!r.safetyHit});return;}
    results.push(r);pending--;done();
   },e=>{if(settled)return;errors.push(e);pending--;done();});
  });
 });
}

// 假日班公平精修：在精算引擎已證明所有目標最優之後，只做「不改變任何已證明目標數值」的互換，
// 讓假日班依各人總班數更平均。排序在所有既有目標之後，因此不會犧牲缺班、班數公平、連站或艱苦哨。
function holidayImbalance(tasks,a){
 const count=new Map(),hol=new Map();let filled=0,H=0;
 a.forEach((p,j)=>{if(p<0)return;filled++;count.set(p,(count.get(p)||0)+1);if(tasks[j].holiday){H++;hol.set(p,(hol.get(p)||0)+1);}});
 let total=0;for(const [p,c] of count)total+=(filled*(hol.get(p)||0)-H*c)**2;
 return {value:filled?total/(filled*filled):0,holidays:H};
}
function holidayPolish(base,pool,src,pins,objectives,deadlineMs=4000){
 const staff=base.m.staff[pool],mt=base.m.tasks[pool],sol=base.solutions[pool],index=new Map(staff.map((p,i)=>[p.id,i]));
 const a=mt.map(t=>{const w=sol.res.get(t.key);return w?index.get(w.id):-1;});
 const before=holidayImbalance(mt,a);
 if(!before.holidays||before.value===0)return {changed:false,before:before.value,after:before.value,assignments:a};
 const fixed=new Set(src.pins.map(x=>x[0])),start=Date.now(),merged=!!src.points&&src.holidayWeight>0;let reference=objectives(src,a);
 const own=new Map(staff.map(p=>[p.key,[...p.history]]));
 a.forEach((p,j)=>{if(p>=0)own.get(staff[p].key).push(mt[j]);});
 const F=a.filter(p=>p>=0).length,H=before.holidays,cnt=staff.map(()=>0),hol=staff.map(()=>0);
 a.forEach((p,j)=>{if(p>=0){cnt[p]++;if(mt[j].holiday)hol[p]++;}});
 const term=(p,h)=>(F*h-H*cnt[p])**2;
 const holidayJobs=[],otherJobs=[];
 mt.forEach((t,j)=>{if(a[j]<0||fixed.has(j))return;(t.holiday?holidayJobs:otherJobs).push(j);});
 const legal=(p,drop,add)=>{
  const person=staff[p],list=own.get(person.key).filter(t=>t!==drop);
  return !staticReason(person,add)&&!conflict(person,add,new Map([[person.key,list]]));
 };
 let changed=false,guard=0;
 while(guard++<300&&Date.now()-start<deadlineMs){
  let best=null;
  for(const j of holidayJobs){
   const p=a[j];
   for(const k of otherJobs){
    const q=a[k];
    if(p===q||mt[j].num!==mt[k].num||mt[j].day===mt[k].day)continue;
    const delta=term(p,hol[p]-1)+term(q,hol[q]+1)-term(p,hol[p])-term(q,hol[q]);
    if(delta>=0||(best&&delta>=best.delta))continue;
    if(!legal(p,mt[j],mt[k])||!legal(q,mt[k],mt[j]))continue;
    const trial=a.slice();trial[j]=q;trial[k]=p;
    const vector=objectives(src,trial);
    // 點數模式：假日已併入勤務負擔點數，只要更高優先目標不變、點數分數不變差即可
    if(merged?(vector.slice(0,-2).some((n,i)=>n!==reference[i])||vector[vector.length-2]>reference[reference.length-2]+1e-12):vector.slice(0,-1).some((n,i)=>n!==reference[i]))continue;
    best={j,k,p,q,delta,vector};
   }
  }
  if(!best)break;
  const {j,k,p,q}=best,P=own.get(staff[p].key),Q=own.get(staff[q].key);
  P.splice(P.indexOf(mt[j]),1,mt[k]);Q.splice(Q.indexOf(mt[k]),1,mt[j]);
  a[j]=q;a[k]=p;hol[p]--;hol[q]++;if(merged)reference=best.vector;
  changed=true;
 }
 const after=holidayImbalance(mt,a);
 return {changed,before:before.value,after:after.value,assignments:a};
}
// 勤務負擔點數模式的精修：兩人互換班次（大門限同日或同時段，安官不限），
// 依完整規則檢查合法、整體目標依序比較必須更好才採用，反覆到沒有可改善的互換為止。
// 不用時間上限，同樣的資料一定得到同樣的結果；再按一次一鍵排班也不會再變動。
function pointsPolish(base,pool,src,pins,objectives){
 const staff=base.m.staff[pool],mt=base.m.tasks[pool],sol=base.solutions[pool],index=new Map(staff.map((p,i)=>[p.id,i]));
 const a=mt.map(t=>{const w=sol.res.get(t.key);return w?index.get(w.id):-1;});
 const before=holidayImbalance(mt,a),fixed=new Set(src.pins.map(x=>x[0])),officer=pool==='officer';
 let ref=objectives(src,a);const ptsBefore=ref[ref.length-2];
 const own=new Map(staff.map(p=>[p.key,[...p.history]]));
 a.forEach((p,j)=>{if(p>=0)own.get(staff[p].key).push(mt[j]);});
 const legal=(p,drop,add)=>{const person=staff[p],list=own.get(person.key).filter(t=>t!==drop);return !staticReason(person,add)&&!conflict(person,add,new Map([[person.key,list]]));};
 const pairs=[];
 for(let j=0;j<mt.length;j++)for(let k=j+1;k<mt.length;k++)if(officer||mt[j].day===mt[k].day||mt[j].num===mt[k].num)pairs.push([j,k]);
 let changed=false;
 for(let pass=0;pass<40;pass++){
  let moved=false;
  for(const [j,k] of pairs){
   const p=a[j],q=a[k];
   if(p<0||q<0||p===q||fixed.has(j)||fixed.has(k))continue;
   a[j]=q;a[k]=p;
   const v=objectives(src,a);
   if(compareDoorObjectives(v,ref)<0&&legal(p,mt[j],mt[k])&&legal(q,mt[k],mt[j])){
    const P=own.get(staff[p].key),Q=own.get(staff[q].key);
    P.splice(P.indexOf(mt[j]),1,mt[k]);Q.splice(Q.indexOf(mt[k]),1,mt[j]);
    ref=v;moved=true;changed=true;
   }else{a[j]=p;a[k]=q;}
  }
  if(!moved)break;
 }
 const after=holidayImbalance(mt,a);
 return {changed,before:before.value,after:after.value,ptsBefore,ptsAfter:ref[ref.length-2],assignments:a};
}
let precisionStopAll=false;
function proofFor(pool){
 if(!last)return null;
 const valid=v=>v&&v.done&&v.month===activeMonth&&v.inputs===currentInputSig()&&v.pins===textSig(pinnedShifts)&&v.signature===precisionPoolSignature(last.solutions,pool);
 const mem=precisionSnapshots[pool];if(valid(mem))return mem;
 const saved=appStore.months[activeMonth]?.proof?.[pool];return valid(saved)?saved:null;
}
function qualityItems(){
 if(!last||!last.m||`${last.m.month.y}-${pad(last.m.month.m)}`!==activeMonth)return null;
 const items=[],names={door:'大門',officer:'安官'},nice=t=>String(t).replace(' L1','').replace('（已計折抵）','').replace('（人次）','');
 let audit=[];try{audit=independentScheduleAudit(last.m,last.solutions,{});}catch(_){}
 if(audit.length)items.push(['bad','獨立巡檢有 '+audit.length+' 項問題，請到班表頁「巡檢」查看',false]);
 for(const pool of ['door','officer']){
  const sol=last.solutions[pool],p=proofFor(pool),n=names[pool],l1=pool==='door'?2:1;
  if(sol.missing)items.push(['bad',n+'缺 '+sol.missing+' 班'+(p&&p.proven>=1?'（已證明是目前人力與規則下的最少值，需增加人力或調整規則；在班表頁按「本月缺 '+sol.missing+' 班」可看每一班沒人能排的原因，「人力缺口試算」列出怎麼補最有效）':''),!p||p.proven<1]);
  if(!p){items.push(['warn',n+'尚未完成精算證明',true]);}
  else if(p.proven>=p.total)items.push(['ok',n+'：'+p.total+' 項目標全部已證明最優',false]);
  else if(p.proven>l1)items.push(['info',n+'：主要目標已證明最優；'+p.labels.slice(p.proven).map(nice).join('、')+' 未證明最優（次要項目，不影響發布）',false]);
  else items.push(['warn',n+'：'+nice(p.labels[p.proven])+' 尚未完成最佳化',true]);
  const ci=last.m.capInfo&&last.m.capInfo[pool];
  if(ci&&ci.over&&ci.over.length)items.push(['warn',n+'有 '+ci.over.length+' 人超過每月上限 '+ci.cap+' 班'+(ci.cap<ci.avg?'（上限低於本月可排人員平均 '+ci.avg.toFixed(1)+' 班，請到「人員名冊 › 排班規則與每人上限」調高）':'（人力不足）')+'：'+ci.over.slice(0,6).join('、')+(ci.over.length>6?'…':''),false]);
 }
 const order={bad:0,warn:1,ok:2,info:3};
 return items.sort((a,b)=>order[a[0]]-order[b[0]]);
}
// 人力缺口試算：估計每一種調整能「直接補上」幾個缺班（不動其他人已排的班次）。
// 包含：某人的休假／車勤等事件改期、多一位整月可排的人、單一規則放寬一級。
let gapCache={key:'',html:''};
function gapAnalysis(pool){
 const sol=last.solutions[pool],people=last.m.staff[pool],holes=sol.tasks.filter(t=>!sol.res.get(t.key)).slice(0,120);
 if(!holes.length)return null;
 const baseOcc=()=>{const occ=new Map(people.map(p=>[p.key,[...p.history]]));for(const u of sol.tasks){const w=sol.res.get(u.key);if(w&&occ.has(w.key))occ.get(w.key).push(u);}return occ;};
 const cap=last.m.capInfo?.[pool]?.cap||Infinity;
 // 依序把缺班補給第一位合法的人；limit：每人最多再補幾班（新增人員受每月上限限制）
 const greedy=(cands,occ,limit=Infinity,skip=null)=>{const got=[],used=new Map();
  for(const t of holes){if(skip&&skip.has(t))continue;for(const p of cands){
   if((used.get(p.key)||0)>=limit||staticReason(p,t)||conflict(p,t,occ))continue;
   occ.get(p.key).push(t);used.set(p.key,(used.get(p.key)||0)+1);got.push(t);break;
  }}
  return got;};
 const when=t=>dateText(t.day).slice(5)+' '+fmt(t),span=e=>dateText(e.start).slice(5)+(e.end>e.start?'–'+dateText(e.end).slice(5):'');
 // 1. 個人事件調整：休假等事件從頭或從尾縮短最少天數（中間挖一天通常沒用，因為收假日、休假前一天也有限制）
 const plans=new Map();
 for(const t of holes)for(const p of people){
  if(!staticReason(p,t))continue;
  for(const e of p.events){
   if(staticReason({...p,events:p.events.filter(x=>x!==e)},t))continue;   // 不是這個事件擋住
   const id=p.key+'|'+e.type+'|'+e.start+'|'+e.end;if(!plans.has(id))plans.set(id,{p,e});
  }
 }
 const events=[];
 for(const {p,e} of plans.values()){
  const L=e.end-e.start+1,others=p.events.filter(x=>x!==e),opts=[];
  const test=(evs,cost,how)=>{const got=greedy([{...p,events:evs}],baseOcc());if(got.length)opts.push({n:got.length,cost,how,got});};
  for(let k=1;k<L;k++){test([...others,{...e,end:e.end-k}],k,'提早 '+k+' 天收假（最後一天改為 '+dateText(e.end-k).slice(5)+'）');test([...others,{...e,start:e.start+k}],k,'延後 '+k+' 天開始（改為 '+dateText(e.start+k).slice(5)+' 起）');}
  test(others,L,L>1?'整段取消或改到其他月份':'改期');
  if(!opts.length)continue;
  // 每個事件只列 CP 值最高的一種，若補得更多的另一種也一併列出
  const best=[...opts].sort((a,b)=>(b.n/b.cost-a.n/a.cost)||a.cost-b.cost)[0],most=[...opts].sort((a,b)=>b.n-a.n||a.cost-b.cost)[0];
  for(const o of best===most||most.n===best.n?[best]:[best,most])
   events.push({n:o.n,cost:o.cost,text:`${p.name||p.id}「${e.type} ${span(e)}」${o.how}`,sub:'可補：'+o.got.map(when).join('、')});
 }
 events.sort((a,b)=>(b.n/b.cost-a.n/a.cost)||b.n-a.n);
 // 2. 多一位／兩位整月可排的人
 const blank=k=>({...people[0],key:'__gap'+k,id:'新增'+k,name:'新增'+k,events:[],history:[],inactiveFrom:null,kitchen:false});
 const occ2=baseOcc();occ2.set('__gap1',[]);occ2.set('__gap2',[]);
 const got1=greedy([blank(1)],occ2,cap),add1=got1.length,add2=greedy([blank(2)],occ2,cap,new Set(got1)).length;
 // 3. 規則放寬一級
 const R=GUARD_SHIFT_RULES,rules=[];
 const tryRule=(path,delta)=>{
  const f=GUARD_RULE_FIELDS.find(x=>x[0]===path);if(!f)return;
  const [obj,key]=guardRulePath({shift:R},path),old=obj[key];if(typeof old!=='number')return;
  const val=old+delta;if(val<f[3]||val>f[4])return;
  obj[key]=val;let n=0;try{n=greedy(people,baseOcc()).length;}finally{obj[key]=old;}
  if(n)rules.push({n,text:`${f[1]}：${old} → ${val} ${String(f[2]).replace(/（.*$/,'')}`});
 };
 if(pool==='door'){tryRule('shift.door.maxConsecutiveDays',1);tryRule('shift.door.restHours',-2);tryRule('shift.door.dailyMaxShifts',1);tryRule('shift.door.dailyMaxHours',2);tryRule('shift.door.twoDayMaxShifts',1);}
 else{if(R.officer.minGapDays>1)tryRule('shift.officer.minGapDays',-1);else tryRule('shift.officer.maxConsecutiveDays',1);tryRule('shift.officer.restHours',-2);}
 tryRule('shift.shared.sameSlotWindowDays',-1);
 rules.sort((a,b)=>b.n-a.n);
 return {holes:sol.missing,events:events.slice(0,8),moreEvents:Math.max(0,events.length-8),add1,add2,rules};
}
function renderGapAnalysis(){
 const box=$('gapAnalysis');if(!box)return;
 const pools=last&&last.m&&`${last.m.month.y}-${pad(last.m.month.m)}`===activeMonth?['door','officer'].filter(p=>last.solutions[p].missing>0):[];
 if(!pools.length){box.hidden=true;return;}
 const total=pools.reduce((n,p)=>n+last.solutions[p].missing,0);
 box.hidden=false;box.querySelector('summary').textContent='🔍 人力缺口試算：本月缺 '+total+' 班，怎麼補最有效？';
 const key=activeMonth+'|'+currentInputSig()+'|'+pools.map(p=>precisionPoolSignature(last.solutions,p)).join('|')+'|'+JSON.stringify(GUARD_SHIFT_RULES);
 const body=box.querySelector('.gap-body');
 const fill=()=>{
  if(gapCache.key!==key){
   const names={door:'大門衛哨',officer:'安全士官'};
   let html='';
   for(const pool of pools){
    const g=gapAnalysis(pool);if(!g)continue;
    const li=x=>`<li>${esc(x.text)}：<span class="gap-n">可直接補 ${x.n} 班</span>${x.sub?`<div class="gap-sub">${esc(x.sub)}</div>`:''}</li>`;
    html+=`<h4>${names[pool]}（缺 ${g.holes} 班）</h4>`;
    html+=`<p><b>增加人力</b>：多 1 位整月可排的人 <span class="gap-n">可補 ${g.add1} 班</span>；多 2 位 <span class="gap-n">可補 ${g.add1+g.add2} 班</span></p>`;
    html+=g.events.length?`<p><b>休假／車勤等調整</b>（少調整幾天就能補上的排前面）</p><ol>${g.events.map(li).join('')}</ol>${g.moreEvents?`<p class="gap-sub">另有 ${g.moreEvents} 種調整未列出。</p>`:''}`:'<p><b>休假／車勤等調整</b>：沒有單一事件調整就能直接補上的缺班。</p>';
    html+=g.rules.length?`<p><b>規則放寬一級</b>（需先確認符合單位規定）</p><ol>${g.rules.map(li).join('')}</ol>`:'<p><b>規則放寬一級</b>：放寬單一規則也無法直接補上。</p>';
   }
   html+='<p class="help">試算只計「直接補上、不動其他人已排的班」，實際重新排班常能補得更多。調整休假或規則後，請按「重新排班」確認結果；規則在「人員名冊 › 排班規則與每人上限」修改。</p>';
   gapCache={key,html};
  }
  body.innerHTML=gapCache.html;
 };
 if(gapCache.key===key)body.innerHTML=gapCache.html;else{body.innerHTML='<p class="help">打開時計算…</p>';if(box.open)fill();}
 box.ontoggle=()=>{if(box.open&&gapCache.key!==key)fill();};
}
function renderQualitySummary(){
 try{renderGapAnalysis();}catch(e){console.warn('gap analysis',e);}
 const items=qualityItems();
 for(const id of ['overviewQuality','resultsQuality']){
  const box=$(id);if(!box)continue;
  if(!items){box.hidden=true;box.replaceChildren();continue;}
  const level=items.some(i=>i[0]==='bad')?'bad':items.some(i=>i[0]==='warn')?'warn':'ok';
  box.className='quality-summary'+(level==='ok'?'':' '+level);box.hidden=false;box.replaceChildren();
  const head=document.createElement('strong');
  head.textContent=level==='bad'?'⛔ 排班品質：需要處理':level==='warn'?'⚠ 排班品質：建議處理後再發布':'✅ 排班品質：可以發布';
  const list=document.createElement('ul');
  for(const [kind,text] of items){const li=document.createElement('li');li.className=kind;li.textContent=(kind==='ok'?'✓ ':kind==='info'?'・':kind==='bad'?'✗ ':'! ')+text;list.appendChild(li);}
  let row=null;
  if(items.some(i=>i[2])){
   row=document.createElement('div');row.className='actions';
   const b=document.createElement('button');b.type='button';b.className='ghost';b.textContent='前往「精算並證明最優」';
   b.onclick=()=>{showStep('results');const t=$('precisionTools');if(t){t.open=true;t.scrollIntoView({behavior:'smooth',block:'start'});}};
   row.appendChild(b);
  }
  if(id==='resultsQuality'){
   // 班表頁只顯示一行摘要，點開才看細項，讓班表本身留在第一屏
   const first=items.find(i=>i[0]==='bad')||items.find(i=>i[0]==='warn');
   const det=document.createElement('details'),sum=document.createElement('summary');
   sum.textContent=(level==='bad'?'⛔ 需要處理':level==='warn'?'⚠ 建議處理後再發布':'✅ 可以發布')+(first?'：'+first[1].replace(/（.*$/,''):'');
   det.append(sum,list);if(row)det.appendChild(row);box.appendChild(det);
  }else{box.append(head,list);if(row)box.appendChild(row);}
 }
}
function renderRuleSettings(){
 const form=$('ruleSettingsForm');if(!form)return;
 const live={shift:GUARD_SHIFT_RULES,fairness:GUARD_FAIRNESS};form.replaceChildren();
 let group='';const groupName=p=>p.startsWith('shift.door')?'大門衛哨':p.startsWith('shift.officer')?'安全士官':p.startsWith('shift.shared')?'共同規則':/^fairness\.(burdenMode|holidayBonus|holidayWeight|points)/.test(p)?'勤務負擔點數（班數最公平的前提下，再平衡每人點數；跨月累計）':'每人每月上限（軟上限：人力不足時才會超過，並在班表頁列出）';
 GUARD_RULE_FIELDS.forEach(([path,label,unit,lo,hi,step,nullable],n)=>{
  if(groupName(path)!==group){group=groupName(path);const h=document.createElement('div');h.className='rule-group';h.textContent=group;form.appendChild(h);}
  const [o,k]=guardRulePath(live,path),[d]=guardRulePath(GUARD_RULE_DEFAULTS,path);
  const box=document.createElement('div');box.className='field'+(o[k]!==d[k]?' changed':'');
  const id='ruleField'+n,lab=document.createElement('label');lab.htmlFor=id;lab.textContent=label;
  const row=document.createElement('div');row.className='rule-input';
  const input=document.createElement('input');input.type='number';input.id=id;input.min=String(lo);input.max=String(hi);input.step=String(step);input.dataset.path=path;
  input.value=o[k]==null?'':String(o[k]);if(nullable)input.placeholder='依倍數';
  const u=document.createElement('span');u.textContent=unit;
  const hint=document.createElement('small');hint.textContent='預設 '+(d[k]==null?'依倍數':d[k]);
  row.append(input,u);box.append(lab,row,hint);form.appendChild(box);
  input.addEventListener('change',saveRuleSettingsFromForm);
 });
 const locked=isLocked();form.querySelectorAll('input').forEach(x=>x.disabled=locked);$('ruleSettingsReset').disabled=locked;
 const n=customRuleCount(),bad=ruleSettingsProblems();
 $('ruleSettingsBadge').textContent=n?'（自訂 '+n+' 項）':'';
 $('ruleSettingsStatus').textContent=bad.length?'⚠ '+bad.join('；'):locked?'本月已封存，規則不可修改。':n?'已採用自訂規則，請重新排班。':'目前全部為預設值。';
}
function saveRuleSettingsFromForm(){
 if(isLocked())return renderRuleSettings();
 const custom={};
 $('ruleSettingsForm').querySelectorAll('input[data-path]').forEach(input=>{
  const field=GUARD_RULE_FIELDS.find(f=>f[0]===input.dataset.path),nullable=!!field[6],text=input.value.trim();
  const v=text===''?(nullable?null:NaN):Number(text);
  const [d,k]=guardRulePath(GUARD_RULE_DEFAULTS,field[0]);
  if(v===d[k]||(Number.isNaN(v)&&text===''&&!nullable))return;
  const keys=field[0].split('.'),last=keys.pop();let o=custom;for(const key of keys)o=o[key]=o[key]||{};o[last]=Number.isNaN(v)?text:v;
 });
 const text=Object.keys(custom).length?JSON.stringify(custom):'';
 const box=$('ruleSettings');if(box.value===text)return renderRuleSettings();
 box.value=text;box.dispatchEvent(new Event('input',{bubbles:true}));
}
const precisionSnapshots={door:null,officer:null};
function precisionPart(pool,part){return $((pool==='door'?'precision':'officerPrecision')+part);}
function precisionButtons(busy){$('precisionAll').disabled=busy;}
function precisionPoolSignature(solutions,pool){const sol=solutions[pool];return textSig(sol.tasks.map(t=>sol.res.get(t.key)?.id||null));}
function checkPrecisionDisplay(){
 for(const pool of ['door','officer']){
  const state=precisionSnapshots[pool],panel=precisionPart(pool,'Panel');
  if(!state||panel.hidden)continue;
  if(state.month!==activeMonth||state.pins!==textSig(pinnedShifts)||state.inputs!==currentInputSig()||
     !last||state.signature!==precisionPoolSignature(last.solutions,pool)){
   panel.hidden=true;precisionSnapshots[pool]=null;
   if(!offlineJobs.size)$('offlineReport').textContent='';
  }
 }
}
// 同一份資料（名冊、班次、規則、固定班、點數與跨月帳）才共用上次精算的點數下限；資料一改就不用
function pointsProblemKey(src){
 const {baseline,holidaySeconds,pointsSeconds,draft,pointsLB,...core}=src;
 const text=JSON.stringify(core,(k,v)=>v instanceof Map?[...v]:v instanceof Set?[...v]:v);
 let h=2166136261;for(let i=0;i<text.length;i++){h^=text.charCodeAt(i);h=Math.imul(h,16777619);}
 return src.pool+':'+(h>>>0).toString(36)+':'+text.length;
}
async function runPrecision(pool,draft=null,group=null){
 const officer=pool==='officer',label=officer?'安官':'大門',objectives=officer?officerObjectives:doorObjectives;
 const labels=officer?['缺班','個人目標偏差 L1（已計折抵）',burdenOn()?'勤務負擔點數':'艱苦哨與時數公平分數','假日班公平']:['缺班','同日額外班次','個人目標偏差 L1','本月連站兩天（人次）',burdenOn()?'勤務負擔點數':'艱苦哨分數','假日班公平'];
 const panel=precisionPart(pool,'Panel'),report=precisionPart(pool,'Report'),status=$('offlineReport');
 if(offlineJobs.size&&!group&&!draft?.parallel){status.textContent='請先停止正在執行的精修，再啟動精算。';return;}
 if(!draft&&(!last||!allowFreshEdit()||loadedSig!==currentInputSig())){status.textContent='請先建立有效的本月班表。';return;}
  if((!draft&&!group&&(progressOwner||scheduleBusy))||repairBusy){status.textContent='請先完成目前的排班作業。';return;}
 const job={precision:true,pool,label},base=draft?.base||last,month=activeMonth,generation=scheduleGeneration;
 const inputs=draft?currentInputSig():loadedSig,pins={...pinnedShifts},pinSig=textSig(pins);
 // 只核對本勤務的班表：另一個勤務同時精算、更新班表時不會互相誤判
 let signature=precisionPoolSignature(base.solutions,pool),url,latest,certified=0,saveWarning='',finalizeCells=null,latestBound=null;
 const current=()=>offlineJobs.has(job)&&(draft||last===base)&&month===activeMonth&&!isLocked()&&!storagePaused&&
  generation===scheduleGeneration&&inputs===currentInputSig()&&pinSig===textSig(pinnedShifts)&&signature===precisionPoolSignature(base.solutions,pool);
 function check(){if(draft)draft.check();if(!current())throw Error('本月資料或班表已變更，請重新啟動精算');}
 const view=draft?.view||group?.view||openProgress(month+' '+label+'精算','停止並查看班表',()=>{precisionStopAll=true;stopOffline('已停止精算，已保留通過巡檢的班表。');});
 const shared=draft||group,paint=(frac,text)=>{if(shared?.paint)shared.paint(pool,frac,text);else paintProgress(view,(draft?.start||0)+(draft?.span||100)*frac,text);};
 paint(0,'準備'+label+'精算');
 let timedOut=false,problem='',safetyHit=false;
 let overall=null;
 const l1Stage=officer?1:2;
 // 一鍵排班的運算量由背景引擎以「求解器迭代次數」限制（與裝置快慢無關，同資料結果相同）。
 // 這裡的 10 分鐘只是安全網：真的觸發時結果會因裝置而異，畫面會註明。
 if(draft)overall=setTimeout(()=>{if(offlineJobs.has(job)){timedOut=true;safetyHit=true;stopOffline(label+'精算已達一鍵排班時間上限。',job);}},600000*SAFETY_SCALE);
 const snapshot={month,inputs,pins:pinSig,signature:precisionPoolSignature(base.solutions,pool),proven:0,total:labels.length,labels:labels.slice(),done:false,timedOut:false};precisionSnapshots[pool]=snapshot;
 offlineJobs.add(job);$('offlineStop').hidden=false;precisionButtons(true);panel.hidden=false;delete panel.dataset.status;
 precisionPart(pool,'Rows').replaceChildren();report.textContent=month+' '+label+'｜正在核對本機班表';
 status.textContent=label+'精算可隨時停止，通過獨立巡檢的改善會自動存檔。';
 try{
  verifyOptimization(base.m,base.solutions,pins);
  const src={...solverBuildRequest(base.m,base.solutions).pools[pool],pool,draft:!!draft,holidaySeconds:draft?0:60,pointsSeconds:draft?0:120},initial=objectives(src,src.baseline);
  // 上次精算留下的勤務負擔點數下限（同一份資料才用）
  // 同一份資料再按精算：沿用下限，並把點數證明時間加倍（120 → 240 → 480 秒），求解器才有機會往下算得更深
  const boundKey=pointsProblemKey(src),saved=appStore.months[activeMonth]?.pointsBounds?.[boundKey];
  if(!draft&&saved&&Number.isFinite(saved.lb)){src.pointsLB=saved.lb;src.pointsSeconds=Math.min(480,120*2**Math.min(2,saved.runs||1));}
  latest=initial;
  const cells=labels.map((label,i)=>{
   const row=document.createElement('tr');
   const fmt=x=>i>=labels.length-2?x.toFixed(2):String(x);
   const cols=[label,fmt(initial[i]),fmt(initial[i]),'待證明'].map(value=>{
    const cell=document.createElement('td');cell.textContent=value;row.appendChild(cell);return cell;
   });
   precisionPart(pool,'Rows').appendChild(row);
   // 結束後（final）：次要項目顯示「已改善／未再改善」，不再停在「待證明」
   let shown=initial[i],proof=false;
   let bound=null;
   return (value,proved,final,lower)=>{
    if(value!==undefined&&value!==null)shown=value;if(proved!==undefined)proof=!!proved;if(Number.isFinite(lower))bound=lower;
    cols[2].textContent=fmt(shown);
    cols[3].textContent=proof?'已證明最優':!final?'待證明':i>=labels.length-2?(shown<initial[i]-1e-9?'已改善・未證明':'未再改善・未證明')+(bound!==null&&!proof?'（最優值至少 '+fmt(bound)+'）':''):'未完成證明';
   };
  });
  finalizeCells=()=>cells.forEach((c,i)=>c(undefined,undefined,true,i===labels.length-2&&Number.isFinite(latestBound)?latestBound:undefined));
  const bytes=unb64($('zeroBinary').textContent.trim());
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
  if(hash!=='69a85477acde13876c8fe83357959724e795abdfd144af0531f920d41b5f813e')throw Error('離線精算引擎校驗失敗');
  check();url=URL.createObjectURL(new Blob([$('zeroModule').textContent,'\n',$('doorObjectives').textContent,'\n',$('precisionWorker').textContent],{type:'text/javascript'}));
  const workers=draft?1:precisionWorkerCount();
  const onProgress=progress=>{
   check();
   const a=progress.assignments,q=objectives(src,a);
   if(workers>1){
    if(q.some((n,i)=>!Number.isFinite(n)||n!==progress.scores[i]))throw Error('目標數值不符');
    const cmp=compareDoorObjectives(q,latest);
    // 多個引擎同時跑：落後的回報直接略過；別的引擎多證明了幾項、但班表沒有比較好時，只更新「已證明」的項數
    if(cmp>=0&&progress.proven<=certified)return;
    if(cmp>0){
     if(q.slice(0,progress.proven).some((n,i)=>n!==latest[i]))throw Error('不同引擎的已證明數值不一致');
     certified=progress.proven;snapshot.proven=certified;cells.forEach((set,i)=>set(latest[i],i<certified));
     report.textContent=month+' '+label+'｜'+progress.phase+'（'+certified+'/'+labels.length+'）'+saveWarning;job.summary=report.textContent;
     paint(certified/labels.length,label+' · '+progress.phase+'（'+certified+'/'+labels.length+'）');return;
    }
   }
   if(q.some((n,i)=>!Number.isFinite(n)||n!==progress.scores[i])||(workers===1&&progress.proven<certified)||progress.proven>labels.length||
    q.slice(0,certified).some((n,i)=>n!==latest[i]))throw Error('目標數值或證明順序不符');
   const cmp=compareDoorObjectives(q,latest);
   if(cmp>0)throw Error('候選方案優先順序不符');
   if(cmp<0){
    const previous=base.solutions,ids=compactAssignments(previous);
    ids[pool]=offlineAssignments({status:'FEASIBLE',assignments:a},src,base.m.staff[pool]);
    const candidate=cloneSearchCandidate(base.m,previous,ids);
    verifyOptimization(base.m,candidate,pins,{door:previous.door.missing,officer:previous.officer.missing});
    const before=draft?null:scheduleRows(previous),beforeRef=draft?null:scheduleReferenceCode();
    base.solutions=candidate;snapshot.signature=precisionPoolSignature(candidate,pool);
    try{if(!draft){render();if(showIndependentAudit().issues.length)throw Error('獨立巡檢未通過');}}
    catch(e){base.solutions=previous;snapshot.signature=precisionPoolSignature(previous,pool);if(!draft)render();throw e;}
    signature=precisionPoolSignature(candidate,pool);
    if(!draft){appendChangeLog(label+'精算',shiftDiff(before,scheduleRows(candidate)),{reason:'依序比較已設定的目標，通過獨立巡檢',beforeRef,afterRef:scheduleReferenceCode()});
    renderChangeHistory();
    if(!saveAutoNow())saveWarning='。本機自動存檔失敗，請使用「備份全部」';}
   }
   latest=q;certified=Math.max(certified,progress.proven);snapshot.proven=certified;
   cells.forEach((set,i)=>set(q[i],i<certified));
   report.textContent=month+' '+label+'｜'+progress.phase+'（'+certified+'/'+labels.length+'）'+saveWarning;
   job.summary=report.textContent;
   paint(certified/labels.length,label+' · '+progress.phase+'（'+certified+'/'+labels.length+'）');
  };
  const solved=await solveOfflinePortfolio(job,url,bytes,src,onProgress,workers);check();
  if(solved?.safetyHit)safetyHit=true;
  if(!draft&&Number.isFinite(solved?.pointsBound))latestBound=solved.pointsBound;
  // 記住這次算出的點數下限（只增不減）；下次對同一份資料按精算，班表一達到下限就算證明完成
  if(!draft&&Number.isFinite(solved?.pointsBound)){
   const mo=appStore.months[activeMonth]||(appStore.months[activeMonth]={}),all=mo.pointsBounds||(mo.pointsBounds={}),prev=all[boundKey];
   all[boundKey]={lb:Math.max(Number.isFinite(prev?.lb)?prev.lb:-Infinity,solved.pointsBound),runs:(prev?.runs||0)+1};
   const keys=Object.keys(all);if(keys.length>12)delete all[keys[0]];saveAutoSoon();
  }
  if(solved?.workLimited){timedOut=true;stopOffline(label+'精算已達一鍵排班運算量上限。',job);throw Error('已達一鍵排班運算量上限');}
  const holidaySkipped=!!solved?.holidayUnproven&&(certified===labels.length-1||(!!solved?.pointsUnproven&&certified===labels.length-2));
  if(certified!==labels.length&&!holidaySkipped)throw Error('求解器未完成所有目標的證明');
  let holidayNote='';
  try{
   const polished=holidaySkipped?(src.points?pointsPolish(base,pool,src,pins,objectives):holidayPolish(base,pool,src,pins,objectives,draft?4000*DRAFT_SAFETY*SAFETY_SCALE:4000)):{changed:false,before:0,after:0,assignments:[]};
   if(polished.changed){
    check();
    const previous=base.solutions,ids=compactAssignments(previous);
    ids[pool]=offlineAssignments({status:'FEASIBLE',assignments:polished.assignments},src,base.m.staff[pool]);
    const candidate=cloneSearchCandidate(base.m,previous,ids);
    verifyOptimization(base.m,candidate,pins,{door:previous.door.missing,officer:previous.officer.missing});
    const before=draft?null:scheduleRows(previous),beforeRef=draft?null:scheduleReferenceCode();
    base.solutions=candidate;snapshot.signature=precisionPoolSignature(candidate,pool);
    try{if(!draft){render();if(showIndependentAudit().issues.length)throw Error('獨立巡檢未通過');}}
    catch(e){base.solutions=previous;snapshot.signature=precisionPoolSignature(previous,pool);if(!draft)render();throw e;}
    signature=precisionPoolSignature(candidate,pool);
    if(!draft){appendChangeLog(label+(src.points?'點數與假日精修':'假日公平精修'),shiftDiff(before,scheduleRows(candidate)),{reason:src.points?'兩人互換班次，勤務負擔點數或假日班更平均；更高優先目標不變':'假日班依班數更平均；已證明的其他目標數值完全不變',beforeRef,afterRef:scheduleReferenceCode()});
     renderChangeHistory();if(!saveAutoNow())saveWarning='。本機自動存檔失敗，請使用「備份全部」';}
    holidayNote=(src.points?'　點數與假日精修：假日失衡 ':'　假日班公平精修：失衡指標 ')+polished.before.toFixed(2)+' → '+polished.after.toFixed(2)+(src.points?'，勤務負擔點數 '+polished.ptsBefore.toFixed(2)+' → '+polished.ptsAfter.toFixed(2)+'（更高優先目標不變）。':'（其他目標不變）。');
   }else if(polished.before>0)holidayNote='　假日班已無法在不影響其他目標下再平均。';
   else if(!holidaySkipped)holidayNote='';
  }catch(e){holidayNote='　假日班公平精修略過：'+e.message+'。';}
  // 精修後若已達理論下限（每人總班數固定、全部填滿時的有效下限），假日班公平也就證明最優；表格同步更新。
  let holidayProvenByBound=false;
  if(holidaySkipped){
   try{
    const cur=base.solutions[pool],idx=new Map(base.m.staff[pool].map((p,i)=>[p.id,i]));
    const a=base.m.tasks[pool].map(t=>{const w=cur.res.get(t.key);return w?idx.get(w.id):-1;});
    const v=objectives(src,a),k=v.length-1,L1=officer?1:2;
    if(v[0]===0&&v[L1]===0){
     const counts=base.m.staff[pool].map((_,p)=>a.filter(q=>q===p).length),lb=holidayLowerBound(src,counts,officer?true:v[1]===0);
     holidayProvenByBound=lb!==null&&v[k]<=lb+1e-9&&!solved?.pointsUnproven;
    }
    if(src.points)cells[k-1](v[k-1],certified>k-1);
    cells[k](v[k],holidayProvenByBound);
    if(holidayProvenByBound){certified=labels.length;report.textContent=month+' '+label+'｜'+labels.length+' 項目標均已證明最優（'+labels.length+'/'+labels.length+'）';}
   }catch(_){}
  }
  const why=solved?.pointsRestricted?'有缺班：缺的班維持空缺，其餘班次已平衡勤務負擔點數與假日班（不另證明）':solved?.pointsUnproven?(solved.pointsTimedOut?(draft?'勤務負擔點數已在時限內改善，需要完整證明請按「精算並證明最優」':'勤務負擔點數在 '+src.pointsSeconds+' 秒內未完成證明，已保留找到的改善'+(Number.isFinite(latestBound)?'（最優值至少 '+latestBound.toFixed(2)+'，目前最多差 '+Math.max(0,(latest[labels.length-2]-latestBound)/Math.max(1e-9,latest[labels.length-2])*100).toFixed(1)+'%；再按一次精算會接著算，時間加倍）':'')+'；假日班公平已在點數不變差的前提下改善'):'有缺班，勤務負擔點數與假日班公平不另證明')
   :solved?.holidayTimedOut?'假日班公平在 60 秒內未完成證明，已保留找到的改善':draft?'假日班已用快速互換改善，需要完整證明請按「精算並證明最優」':'有缺班，假日班公平不另證明';
  status.textContent=panel.dataset.status=label+'精算完成，'+(holidaySkipped&&!holidayProvenByBound?(labels.length-(solved?.pointsUnproven?2:1))+' 項目標已證明最優（'+why+'）。':labels.length+' 項目標均已證明最優（含假日班公平）。')+holidayNote+saveWarning;
 }catch(e){if(offlineJobs.has(job)){problem=label+'精算未完成：'+e.message;panel.dataset.status=label+'精算已中止。'+e.message;status.textContent=label+'精算已中止。'+e.message+'。'+saveWarning;report.textContent=month+' '+label+'｜已中止，已完成 '+certified+'/'+labels.length+' 項證明。'+saveWarning;}}
 finally{
  if(url)URL.revokeObjectURL(url);
  if(offlineJobs.has(job)){offlineJobs.delete(job);if(!offlineJobs.size){$('offlineStop').hidden=true;precisionButtons(false);}}
  if(!draft&&!group){closeProgress(view);if(last)renderEasyDayView();}
  if(finalizeCells)finalizeCells();
 }
 if(overall!==null)clearTimeout(overall);
 snapshot.proven=Math.max(snapshot.proven||0,certified||0);snapshot.done=true;snapshot.timedOut=!!timedOut;snapshot.safetyHit=!!safetyHit;
 {const rec=appStore.months[activeMonth];if(rec&&snapshot.month===activeMonth){rec.proof={...(rec.proof||{}),[pool]:{...snapshot}};if(typeof saveAutoSoon==='function')saveAutoSoon();}}
 if(typeof renderQualitySummary==='function')renderQualitySummary();
 const device=safetyHit?'（本次運算受裝置速度影響，換一台裝置重排可能略有不同）':'';
 return (timedOut?(certified<=l1Stage?'⚠ '+label+(certified<l1Stage?'缺班或同日多班':'個人班數公平')+'尚未完成最佳化（已達一鍵排班運算上限），建議到班表頁「最佳化與修復」按「精算並證明最優」。':label+(burdenOn()?'勤務負擔點數':'艱苦哨')+'／連站等次要公平項目已達一鍵排班運算上限，已保留已驗證的班表。'):problem)+(device&&(timedOut||problem)?device:device?'⚠ '+label+device:'');
}

// #endregion
