
// One dedicated local worker. Each emitted witness is re-audited by the page.
self.onmessage=async ({data})=>{
 try{
  useShiftRules(data.frame&&data.frame.rules);
  const compiled=await WebAssembly.compile(data.wasm);
  const highs=await Module({instantiateWasm(imports,ready){
   const instance=new WebAssembly.Instance(compiled,imports);
   ready(instance,compiled);return instance.exports;
  }});
  useDraftLimits(highs,data.frame&&data.frame.draft);
  self.postMessage({type:'ready',id:data.id});
  const solve=data.frame.pool==='officer'?solveOfficerPrecision:precisionSolve;
  const result=solve(highs,data.frame,progress=>self.postMessage({type:'progress',id:data.id,progress}));
  self.postMessage({type:'result',id:data.id,result});
 }catch(e){
  // 一鍵排班的運算量上限：保留已回報的最佳班表（頁面已逐一巡檢），結果與裝置快慢無關
  if(e&&e.workLimit)self.postMessage({type:'result',id:data.id,result:{status:'WORK_LIMIT',workLimited:true,safetyHit:__safetyHit}});
  else self.postMessage({type:'error',id:data.id,error:String(e.message||e)});
 }
};
function incompatibleDoorSlots(a,b){
 const gap=Math.abs(a.day-b.day);
 if(gap<=__shiftRules.shared.sameSlotWindowDays&&a.num===b.num)return true;
 if(stayRepeat(gap)&&a.stay&&b.stay)return true;
 const aStart=24*(a.day-b.day)+a.start,aEnd=aStart+a.end-a.start,R=__shiftRules.door.restHours;
 return aEnd+R>b.start && b.end+R>aStart;
}
function improveDoorTimes(src,initial){
 const a=initial.slice(),allowed=src.people.map(p=>new Set(p.allowed)),pins=new Map(src.pins);
 const own=src.people.map(()=>new Set());
 a.forEach((p,j)=>{if(p>=0)own[p].add(j);});
 function canMove(p,from,to){
  if(!allowed[p].has(to))return false;
  for(const k of own[p])if(k!==from&&incompatibleDoorSlots(src.tasks[k],src.tasks[to]))return false;
  return true;
 }
 let previous=doorObjectives(src,a)[4],changed=true;
 while(changed){
  changed=false;
  for(let j=0;j<a.length;j++)for(let k=j+1;k<a.length&&src.tasks[k].day===src.tasks[j].day;k++){
   const p=a[j],q=a[k];
   if(p<0||q<0||p===q||pins.has(j)||pins.has(k)||!canMove(p,j,k)||!canMove(q,k,j))continue;
   a[j]=q;a[k]=p;
   const score=doorObjectives(src,a)[4];
   if(score<previous){
    own[p].delete(j);own[p].add(k);own[q].delete(k);own[q].add(j);previous=score;changed=true;
   }else{a[j]=p;a[k]=q;}
  }
 }
 return a;
}
// LP-format builder. 'zero' is a fixed variable so empty sums are valid LP expressions.
function precisionModel(src,stage,locks,totals,cuts,certificate=null){
 const {tasks,people}=src,days=tasks.length/12,pinned=new Map(src.pins);
 const rows=[],bounds=['zero = 0'],binary=[],xs=tasks.map(()=>[]),objective=[],holes=[],worked=[],errors=[],pairs=[];
 const sum=names=>names.length?names.join(' + '):'zero';
 const equal=(v,list)=>rows.push(v+' - '+(list.length?list.join(' - '):'zero')+' = 0');
 const count=(v,list)=>{equal(v,list);return v;};
 const linear=(terms)=>terms.filter(([c])=>c!==0).map(([c,v],i)=>(c<0?' - ':i?' + ':' ')+Math.abs(c)+' '+v).join('')||'zero';
 const fixedFull=locks[0]===0,onePerDay=locks[1]===0,fixedGoals=locks[2]===0;

 const F=tasks.length-(locks[0]||0),N=totals?.night||0,M=totals?.noon||0,HD=totals?.holiday||0;
 const fairVars=[],lockTerms=[];
 for(let p=0;p<people.length;p++){
  const person=people[p],restrict=src.dayRestriction&&src.dayRestriction.get(p),allow=new Set(restrict?person.allowed.filter(j=>restrict.has(Math.floor(j/12))):person.allowed),dayFlags=new Map(),stayFlags=new Map(),slots=[],names=[];
  const dayItems=Array.from({length:days},()=>[]),perNum=new Map(),night=[],noon=[],hol=[],ptTerms=[];
  for(let d=0;d<days;d++){
   const items=dayItems[d],stays=[];
   for(let j=d*12;j<(d+1)*12;j++){
    if(!allow.has(j)||(pinned.has(j)&&pinned.get(j)!==p))continue;
    const v='x'+p+'_'+j,t=tasks[j];binary.push(v);xs[j].push([p,v]);items.push(v);names.push(v);
    slots.push({t,v,start:24*d+t.start});
    if(t.stay)stays.push(v);
    if(t.night)night.push(v);
    if(t.noon)noon.push(v);
    if(t.holiday)hol.push(v);
    if(src.points)ptTerms.push([src.points[j],v]);
    if(!perNum.has(t.num))perNum.set(t.num,[]);
    perNum.get(t.num).push({d,v,harsh:t.night||t.noon});
   }
   if(!items.length)continue;
   const y='y'+p+'_'+d;binary.push(y);dayFlags.set(d,y);worked.push(y);
   if(onePerDay)equal(y,items);
   else rows.push(sum(items)+' - '+doorDayCap()+' '+y+' <= 0',sum(items)+' - '+y+' >= 0');
   if(stays.length){
    const s='s'+p+'_'+d;binary.push(s);stayFlags.set(d,s);
    rows.push(sum(stays)+' - '+(onePerDay?1:doorDayCap())+' '+s+' <= 0',sum(stays)+' - '+s+' >= 0');
    for(let gapW=1;gapW<=__shiftRules.shared.sundayStayGapWeeks;gapW++)if(stayFlags.has(d-7*gapW))rows.push(s+' + '+stayFlags.get(d-7*gapW)+' <= 1');
   }
   if(stage>=3 && dayFlags.has(d-1)){
    const z='z'+p+'_'+d,prev=dayFlags.get(d-1);pairs.push(z);
    rows.push(y+' + '+prev+' - '+z+' <= 1'); // minimizing or capping their sum binds overlaps
   }
  }
  if(!onePerDay)doorLoadWindows(dayItems,person.edgeShifts||[0,0],row=>rows.push(row));
  const hist=edgeHistory(person,days),K=__shiftRules.door.maxConsecutiveDays;
  for(let first=-K;first<days;first++){
   const span=Array.from({length:K+1},(_,i)=>first+i),vars=span.map(d=>dayFlags.get(d)).filter(Boolean);
   const cap=K-span.reduce((n,d)=>n+(hist.get(d)||0),0);
   if(vars.length>cap)rows.push(sum(vars)+' <= '+cap);
  }
  // Door shifts have fixed duration two hours. Shifts starting less than (2 + rest) hours apart form a clique.
  slots.sort((a,b)=>a.start-b.start);
  for(let i=0;i<slots.length;i++){
   const clique=[slots[i].v];
   for(let k=i+1;k<slots.length&&slots[k].start<slots[i].start+2+__shiftRules.door.restHours;k++)clique.push(slots[k].v);
   if(clique.length>1)rows.push(sum(clique)+' <= 1');
  }
  for(const list of perNum.values())for(let i=0;i<list.length;i++){
   const clique=[list[i].v];
   for(let k=i+1;k<list.length&&list[k].d<=list[i].d+__shiftRules.shared.sameSlotWindowDays;k++)clique.push(list[k].v);
   if(clique.length>1)rows.push(sum(clique)+' <= 1');
  }
  if(stage<2)continue;
  const c=count('c'+p,names),goal=person.goal;
  if(fixedGoals)bounds.push(c+' = '+goal);
  else{
   const u='u'+p;errors.push(u);
   rows.push(c+' - '+u+' <= '+goal,c+' + '+u+' >= '+goal);
  }
  if(stage<4)continue;
  if(certificate){
   for(const {key,ranges} of certificate.groups){
    const {lo,hi,numbers}=ranges[p],list=key==='night'?night:noon;
    const limit=(vars,min,max)=>{
     if(min>0)rows.push(sum(vars)+' >= '+min);
     if(vars.length>max)rows.push(sum(vars)+' <= '+max);
    };
    limit(list,lo,hi);
    for(const num of numbers){
     const bin=(perNum.get(num)||[]).map(x=>x.v);
     limit(bin,Math.floor(lo/numbers.length),Math.ceil(hi/numbers.length));
    }
   }
   continue;
  }
  // 點數模式：班數已鎖定在 goal±L1 內，點數與假日班數的平方差距改用精確寫法（同安官的 exactSquares）
  let doorZ=null;
  function exactDoor(v,h,weights,slope,offset){
   if(!doorZ){
    const L=locks[2]||0,lo=Math.max(0,Math.ceil(goal-L-1e-9)),hi=Math.min(names.length,Math.floor(goal+L+1e-9)),ks=[],zs=[];
    for(let k=lo;k<=hi;k++){ks.push(k);const z='w'+p+'_'+k;zs.push(z);binary.push(z);}
    rows.push(sum(zs)+' = 1');rows.push(linear([[1,c],...ks.map((k,i)=>[-k,zs[i]])])+' = 0');doorZ={ks,zs};
   }
   const ws=weights.slice().sort((a,b)=>a-b),ys=[],hs=[];
   doorZ.ks.forEach((k,i)=>{
    const z=doorZ.zs[i],lo=ws.slice(0,k).reduce((a,b)=>a+b,0),hi=k?ws.slice(-k).reduce((a,b)=>a+b,0):0,sk=slope*k-offset;
    const y=v+'y'+k,hk=v+'h'+k;ys.push(y);hs.push(hk);
    rows.push(linear([[1,y],[-lo,z]])+' >= 0',linear([[1,y],[-hi,z]])+' <= 0');
    if(lo===hi)rows.push(linear([[1,hk],[-((lo-sk)**2),z]])+' >= 0');
    else for(let val=lo;val<hi;val++){const a=val-sk;rows.push(linear([[1,hk],[-(2*a+1),y],[(2*a+1)*sk+a*(a+1),z]])+' >= 0');}
   });
   rows.push(linear([[1,v],...ys.map(y=>[-1,y])])+' = 0');
   rows.push(linear([[1,h],...hs.map(x=>[-1,x])])+' = 0');
  }
  function square(v,list,total,weight,bucket){
   count(v,list);
   const h='h'+v;
   (bucket||objective).push(weight+' '+h);
   if(fixedGoals){
    // The secants interpolate the exact square on every feasible integer count.
    const target=total*goal/F,cap=Math.min(goal,list.length);
    if(!cap){bounds.push(h+' = '+target**2);return;}
    for(let k=0;k<cap;k++)rows.push(linear([[1,h],[-(2*k+1-2*target),v]])+' >= '+(target**2-k*(k+1)));
   }else if(src.points){
    const inList=new Set(list);exactDoor(v,h,names.map(x=>inList.has(x)?1:0),total/F,0);
   }else{
    const points=cuts.get(v)||new Set([0]);
    for(const e of points){
     const q=e/F;
     rows.push(linear([[1,h],[-2*q,v],[2*q*total/F,c]])+' >= '+(-q*q));
    }
    fairVars.push({p,v,h,total,weight});
   }
  }
  // 第 5 階段（假日公平）：艱苦哨各項改為「不得超過已證明最優值」的鎖定條件，目標換成假日失衡。
  // 勤務負擔點數：pt＝Σ點數×班次；目標＝依班數應得點數 − 跨月累計差額
  function wsquare(v,terms,total,offset,weight,bucket){
   rows.push(linear([[1,v],...terms.map(([w,x])=>[-w,x])])+' = 0');
   const h='h'+v;(bucket||objective).push(weight+' '+h);
   if(fixedGoals){
    const target=total*goal/F-offset,maxV=terms.reduce((acc,[w])=>acc+w,0);
    if(!maxV){bounds.push(h+' = '+target**2);return;}
    for(let k=0;k<maxV;k++)rows.push(linear([[1,h],[-(2*k+1-2*target),v]])+' >= '+(target**2-k*(k+1)));
   }else if(src.points){
    const wt=new Map(terms.map(([w,x])=>[x,w]));exactDoor(v,h,names.map(x=>wt.get(x)||0),total/F,offset);
   }else{
    const pts=cuts.get(v)||new Set([0]);
    for(const e of pts){const q=e/F;rows.push(linear([[1,h],[-2*q,v],[2*q*total/F,c]])+' >= '+(2*q*offset-q*q));}
    fairVars.push({p,v,h,total,weight,offset});
   }
  }
  const harshBucket=stage===5?lockTerms:objective;
  if(src.points){wsquare('pt'+p,ptTerms,totals?.points||0,person.burdenOffset||0,10,harshBucket);if(src.holidayWeight>0)square('d'+p,hol,HD,40*src.holidayWeight,harshBucket);}
  else{square('n'+p,night,N,10,harshBucket);square('m'+p,noon,M,7,harshBucket);}
  if(stage===5){if(src.points&&src.holidayWeight>0)objective.push('1 hd'+p);else square('d'+p,hol,HD,1);}
  for(const [num,list] of perNum)if(list[0].harsh && list.length>1){
   const v=count('r'+p+'_'+num,list.map(item=>item.v)),h='h'+v;
   harshBucket.push('6 '+h);
   const cap=Math.min(list.length,Math.ceil(days/(__shiftRules.shared.sameSlotWindowDays+1)),fixedGoals?goal:list.length);
   for(let k=1;k<cap;k++)rows.push(h+' - '+(2*k-1)+' '+v+' >= '+(-(k*k+k-1)));
  }
 }
 for(let j=0;j<xs.length;j++){
  const v='b'+j,list=xs[j].map(x=>x[1]);
  if(fixedFull||pinned.has(j))rows.push(sum(list)+' = 1');
  else{binary.push(v);holes.push(v);rows.push(sum([...list,v])+' = 1');}
 }
 if(stage===0)objective.push(...holes);
 else if(!fixedFull)rows.push(sum(holes)+' = '+locks[0]);
 const filled=tasks.length-(locks[0]||0);
 if(stage===1){const t='extra';rows.push(t+' + '+sum(worked)+' = '+filled);objective.push(t);}
 if(stage>1&&!onePerDay)rows.push(sum(worked)+' = '+(filled-locks[1]));
 if(stage===2)objective.push(...errors);
 if(stage>2&&!fixedGoals)rows.push(sum(errors)+' <= '+locks[2]);
 if(stage===3)objective.push(...pairs);
 if(src.stageLowerBound&&src.stageLowerBound.stage===stage&&(stage===1||stage===2))rows.push(sum(objective)+' >= '+src.stageLowerBound.value);
 if(stage>=4){
  rows.push(sum(pairs)+' <= '+locks[3]);
  if(!fixedFull)for(const [key,total] of [['night',N],['noon',M]]){
   const vars=xs.flatMap((arr,j)=>tasks[j][key]?arr.map(x=>x[1]):[]);
   rows.push(sum(vars)+' = '+total);
  }
 }
 if(stage===5)rows.push(sum(lockTerms)+' <= '+(10*locks[4]+0.5/(F*F)));
 const lp=['Minimize',' obj: '+sum(objective),'Subject To',...rows.map((r,i)=>' c_'+i+': '+r),'Bounds',...bounds,...(binary.length?['Binary',...binary]:[]),'End'].join('\n');
 return {lp,fairVars,read:r=>xs.map(arr=>arr.find(([,v])=>r.Columns[v]?.Primal>0.5)?.[0]??-1)};
}
// Relax the calendar while keeping the monthly targets, category totals and available slot numbers.
// Convex marginal costs give a global lower bound and the count ranges that can attain it.
function doorFairBound(src){
 const F=src.tasks.length,den=10*F*F,groups=[];
 let numerator=0;
 for(const [key,weight] of [['night',10],['noon',7]]){
  const total=src.tasks.filter(t=>t[key]).length,units=[];
  const ranges=src.people.map((person,p)=>{
   const viable=person.allowed.filter(j=>src.tasks[j][key]);
   const numbers=[...new Set(viable.map(j=>src.tasks[j].num))],K=numbers.length;
   const cost=n=>{
    const q=K?Math.floor(n/K):0,rem=K?n%K:0;
    const repeats=(K-rem)*Math.max(0,q-1)**2+rem*q*q;
    return weight*(F*n-total*person.goal)**2+6*F**2*repeats;
   };
   numerator+=cost(0);
   const cap=Math.min(viable.length,person.goal);
   for(let k=1;k<=cap;k++)units.push({p,cost:cost(k)-cost(k-1)});
   return {lo:0,hi:0,numbers};
  });
  units.sort((a,b)=>a.cost-b.cost);
  if(units.length<total)return null;
  const cut=total?units[total-1].cost:-Infinity;
  for(const u of units){
   if(u.cost<cut)ranges[u.p].lo++;
   if(u.cost<=cut)ranges[u.p].hi++;
  }
  for(let i=0;i<total;i++)numerator+=units[i].cost;
  groups.push({key,ranges});
 }
 return {value:numerator/den,groups};
}

// Exchange two shifts only when both people keep the four higher-priority scores.
function searchDoorTimes(src,initial,floor,onBest){
 const {tasks,people}=src,allowed=people.map(p=>new Set(p.allowed)),pins=new Map(src.pins);
 const filled=initial.filter(p=>p>=0).length,den=10*filled**2;
 const nTotal=initial.filter((p,j)=>p>=0&&tasks[j].night).length,mTotal=initial.filter((p,j)=>p>=0&&tasks[j].noon).length;
 const swaps=[],movable=initial.flatMap((p,j)=>p>=0&&!pins.has(j)?[j]:[]);
 const crossDays=doorObjectives(src,initial)[1]===0,days=tasks.length/12;
 const dayOf=tasks.map((_,j)=>Math.floor(j/12));
 for(let j=0;j<initial.length;j++)if(initial[j]>=0&&!pins.has(j)){
  for(let k=j+1;k<initial.length&&tasks[k].day===tasks[j].day;k++)
   if(initial[k]>=0&&!pins.has(k)&&(tasks[j].night||tasks[j].noon||tasks[k].night||tasks[k].noon))swaps.push([j,k]);
 }
 if(!swaps.length)return initial;
 let best=initial,bestScore=doorObjectives(src,best)[4],seed=61937;
 const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
 const clashes=tasks.map((t,j)=>tasks.flatMap((u,k)=>k!==j&&incompatibleDoorSlots(t,u)?[k]:[]));
 const deadline=Date.now()+11000*(__draft?DRAFT_SAFETY*SAFETY_SCALE:1),OFF=Math.max(2,__shiftRules.door.maxConsecutiveDays);
 function shift(w,t,sign){
  if(t.night)w.n+=sign;
  if(t.noon)w.m+=sign;
  if(t.night||t.noon)w.slots[t.num]+=sign;
 }
 function cost(w){
  let value=10*(filled*w.n-nTotal*w.count)**2+7*(filled*w.m-mTotal*w.count)**2;
  for(const b of w.slots)if(b>1)value+=6*filled**2*(b-1)**2;
  return value;
 }
 for(let pass=0;pass<60&&Date.now()<deadline&&bestScore>floor+1e-9;pass++){
  const a=best.slice(),stats=people.map(()=>({count:0,n:0,m:0,slots:new Int16Array(13),cost:0,days:new Int8Array(days+2*OFF)}));
  for(const [p,w] of stats.entries())for(const [d,v] of edgeHistory(people[p],days))if(d+OFF>=0&&d+OFF<days+2*OFF)w.days[d+OFF]=v;
  a.forEach((p,j)=>{if(p>=0){stats[p].count++;stats[p].days[dayOf[j]+OFF]++;shift(stats[p],tasks[j],1);}});
  for(const w of stats)w.cost=cost(w);
  let value=Math.round(bestScore*den),changed=false;
  const iterations=Math.max(40000,swaps.length*60);
  function dayMove(w,from,to){
   const f=from+OFF,d=to+OFF;
   if(w.days[d])return Infinity;
   const next=k=>k!==f&&k>=0&&k<w.days.length&&w.days[k]>0;
   let left=0,right=0;while(next(d-1-left))left++;while(next(d+1+right))right++;
   if(left+right+1>__shiftRules.door.maxConsecutiveDays)return Infinity;
   return Number(d>OFF&&next(d-1))+Number(d<days+OFF-1&&next(d+1))-
    Number(f>OFF&&w.days[f-1]>0)-Number(f<days+OFF-1&&w.days[f+1]>0);
  }
  for(let i=0;i<iterations;i++){
   let [j,k]=swaps[Math.floor(rand()*swaps.length)];
   if(crossDays&&rand()<0.53){j=movable[Math.floor(rand()*movable.length)];k=movable[Math.floor(rand()*movable.length)];}
   const p=a[j],q=a[k],d=dayOf[j],e=dayOf[k];
   if(p===q||!allowed[p].has(k)||!allowed[q].has(j))continue;
   if(clashes[k].some(u=>u!==j&&a[u]===p)||clashes[j].some(u=>u!==k&&a[u]===q))continue;
   const u=stats[p],v=stats[q],tj=tasks[j],tk=tasks[k];
   if(d!==e&&dayMove(u,d,e)+dayMove(v,e,d)!==0)continue;
   shift(u,tj,-1);shift(u,tk,1);shift(v,tk,-1);shift(v,tj,1);
   const cu=cost(u),cv=cost(v),delta=cu+cv-u.cost-v.cost;
   const temp=(pass%3===0?0.8:0.36)*(1-i/iterations)+0.025;
   if(delta<=0||rand()<Math.exp(-delta/(den*temp))){
    a[j]=q;a[k]=p;u.cost=cu;v.cost=cv;value+=delta;
    if(d!==e){u.days[d+OFF]--;u.days[e+OFF]++;v.days[e+OFF]--;v.days[d+OFF]++;}
    if(value/den<bestScore){
     bestScore=value/den;best=a.slice();changed=true;
     if(bestScore<=floor+1e-9)break;
    }
   }else{shift(u,tk,-1);shift(u,tj,1);shift(v,tj,-1);shift(v,tk,1);}
  }
  if(changed)onBest(best);
 }
 if(__draft&&Date.now()>=deadline)__safetyHit=true;
 return best;
}

// Publish improving witnesses while the unrestricted search proves its bounds.
// 精算時同時跑的幾個背景引擎：第 0 個用預設設定，其餘換隨機種子與啟發式搜尋力度，走不同的搜尋路徑
// （一鍵排班只用一個引擎、variant 一律為 0，才能保證同資料同結果）
function variantOptions(src){
 const v=src.variant||0;if(!v)return {};
 return {random_seed:1000003*v%2147483647,mip_heuristic_effort:[0.05,0.3,0.15,0.5][v%4]};
}
// 最近一次求解回報的下限（「最優值不可能低於此」）；時間到沒證明完時，頁面會記住它，下次精算接著用
var __lastDual=-Infinity;
function solveDoorModel(highs,definition,seed,options,onWitness){
 const model=highs.createModel({format:'lp',data:definition.lp});__lastDual=-Infinity;
 try{
  model.options.set(draftOptions(options));
  const names=Array.from({length:model.getDimensions().numCols},(_,i)=>model.getColName(i));
  const xcols=[];
  names.forEach((v,i)=>{
   const m=/^x(\d+)_(\d+)$/.exec(v);
   if(!m)return;
   const p=Number(m[1]),j=Number(m[2]);xcols.push([i,j,p]);
  });
  const MI=highs.constants.callbackType.mipInterrupt,budget=draftBudget(highs,options)[MI];
  const r=model.run({[MI](e){const b=Number(e.data.mip_dual_bound);if(Number.isFinite(b)&&b>__lastDual)__lastDual=b;if(budget)budget(e);},[highs.constants.callbackType.mipImprovingSolution](e){
   const vector=e.data.mip_solution;
   if(!vector||vector.length!==names.length)return;
   const a=Array(seed.length).fill(-1);
   for(const [i,j,p] of xcols)if(vector[i]>0.5)a[j]=p;
   onWitness(a);
  }});
  const states=highs.constants.modelStatus;
  if(r.modelStatus===states.optimal)__lastDual=Infinity; // 已證明最優：由呼叫端以目標值判斷
  if(r.modelStatus===states.infeasible)return {Status:'Infeasible'};
  if(__draft&&r.modelStatus===states.timeLimit)__safetyHit=true;
  if(__draft&&[states.unknown,states.solutionLimit,states.timeLimit,states.interrupted].includes(r.modelStatus))throw workLimitError();
  if(r.modelStatus!==states.optimal)throw Error('精算引擎回報 '+r.modelStatus);
  const vector=model.getSolution().colValue,columns={};
  names.forEach((v,i)=>columns[v]={Primal:vector[i]});
  return {Status:'Optimal',Columns:columns,ObjectiveValue:model.getObjectiveValue()};
 }finally{model.dispose();}
}

// The page supplies statutory eligibility, neighboring-month duty and the targets after credits.
function officerConflict(a,b){
 const d=Math.abs(a.day-b.day),[e,l]=a.day<b.day?[a,b]:[b,a];
 return d<__shiftRules.officer.minGapDays||(d===1&&24+l.start-e.end<(__shiftRules.officer.restHours||0))||(d<=__shiftRules.shared.sameSlotWindowDays&&a.num===b.num)||(stayRepeat(d)&&a.stay&&b.stay);
}
// 可站天數上限（只看隔天數與連站天數，不看休息時數，所以是上限）
function officerCapacity(days,gap=__shiftRules.officer.minGapDays){
 const K=gap>1?Infinity:(__shiftRules.officer.maxConsecutiveDays||Infinity);
 let prev=-Infinity,cap=0,run=0;
 for(const d of [...new Set(days)].sort((a,b)=>a-b)){
  if(d-prev<gap)continue;
  if(d===prev+1){if(run>=K)continue;run++;}else run=1;
  cap++;prev=d;
 }
 return cap;
}
// 某人在指派 a 之下是否違反「最多連站天數」（含前後月份）
function officerRunsOk(f,a,p){
 const K=__shiftRules.officer.maxConsecutiveDays;if(__shiftRules.officer.minGapDays>1||!K)return true;
 const hist=edgeHistory(f.people[p],f.days),on=new Set([...hist].filter(([,v])=>v).map(([d])=>d));
 a.forEach((x,j)=>{if(x===p)on.add(f.tasks[j].day-f.first);});
 let run=0;for(let d=-K-1;d<=f.days+K;d++){run=on.has(d)?run+1:0;if(run>K)return false;}
 return true;
}
function officerLP(){
 const rows=[],bounds=['zero = 0'],binary=[],cost=[];
 const sum=a=>a.length?a.join(' + '):'zero';
 const expr=terms=>terms.filter(([n])=>n!==0).map(([n,v],i)=>(n<0?' - ':i?' + ':'')+Math.abs(n)+' '+v).join('')||'zero';
 function total(v,terms){rows.push(v+' - '+(terms.length?terms.join(' - '):'zero')+' = 0');return v;}
 function text(continuous=false){
  return ['Minimize',' obj: '+sum(cost),'Subject To',...rows.map((r,i)=>' row'+i+': '+r),'Bounds',...bounds,
   ...(binary.length&&!continuous?['Binary',...binary]:[]),'End'].join('\n');
 }
 return {rows,bounds,binary,cost,sum,expr,total,text};
}
function officerFrame(src){
 const {tasks,people}=src,first=tasks[0].day,days=tasks.length/7,pins=new Map(src.pins);
 const allowed=people.map((w,p)=>w.allowed.filter(j=>!pins.has(j)||pins.get(j)===p));
 const capacity=allowed.map(js=>officerCapacity(js.map(j=>tasks[j].day)));
 const goalTotal=people.reduce((s,w)=>s+w.goal,0);
 function lowerL1(filled){
  const missingGoals=people.reduce((s,w,p)=>s+Math.max(0,w.goal-capacity[p]),0);
  return 2*Math.max(missingGoals,goalTotal-filled)+filled-goalTotal;
 }
 return {src,tasks,people,first,days,pins,allowed,capacity,goalTotal,lowerL1};
}
function officerAssignmentModel(f,{stage,filled,l1,targetL1,choices,groups,categoryOnly=false,cuts,lock,fixHoles=null}){
 const {tasks,people,first,days,pins,allowed,capacity}=f;
 const lp=officerLP(),{rows,binary,bounds,cost,sum,expr,total}=lp;
 const slotVars=tasks.map(()=>[]),holes=[],errors=[],categoryTotals=[[],[],[]],fairTerms=[],lockTerms=[];
 const band=t=>t.night?0:t.noon?1:t.dur===4?3:2;
 const offDay=(list,gap)=>{
  const ds=[...list.keys()].sort((a,b)=>a-b);
  for(const d of ds){const vars=ds.filter(v=>v>=d&&v<d+gap).flatMap(v=>list.get(v));if(vars.length>1)rows.push(sum(vars)+' <= 1');}
 };
 const allFilled=filled===tasks.length;
 const totalN=tasks.filter(t=>t.night).length,totalM=tasks.filter(t=>t.noon).length,totalH=tasks.reduce((a,t)=>a+t.dur,0),totalD=tasks.filter(t=>t.holiday).length;
 // 勤務負擔點數（與假日班數）平方差距的精確寫法：
 // 「個人班數公平」已鎖定，每人班數 c 只可能是 goal±l1 內的幾個整數。對每個可能的 c 用一個 0/1 變數 z，
 // 把點數 pt（假日班數 d）拆到被選中的 c 底下；pt 只會是整數，在相鄰整數之間畫割線，平方在每個可能值都完全正確。
 // 一次求解即是真正的最優（不必一輪一輪補切線），線性放鬆的下限也比切線緊。
 function exactSquares(p,c,work,goal,parts){
  const maxC=Math.min(capacity[p],work.length),loC=Math.max(0,Math.ceil(goal-(l1??maxC)-1e-9)),hiC=Math.min(maxC,Math.floor(goal+(l1??maxC)+1e-9));
  const ks=[],zs=[];for(let k=loC;k<=hiC;k++){ks.push(k);const z='z'+p+'_'+k;zs.push(z);binary.push(z);}
  rows.push(sum(zs)+' = 1');rows.push(expr([[1,c],...ks.map((k,i)=>[-k,zs[i]])])+' = 0');
  for(const part of parts){
   const ws=part.weights.slice().sort((a,b)=>a-b),ys=[],hs=[];
   ks.forEach((k,i)=>{
    const z=zs[i],lo=ws.slice(0,k).reduce((a,b)=>a+b,0),hi=k?ws.slice(-k).reduce((a,b)=>a+b,0):0,s=part.slope*k-part.offset;
    const y=part.name+'y'+p+'_'+k,h=part.name+'h'+p+'_'+k;ys.push(y);hs.push(h);
    rows.push(expr([[1,y],[-lo,z]])+' >= 0',expr([[1,y],[-hi,z]])+' <= 0');
    if(lo===hi)rows.push(expr([[1,h],[-((lo-s)**2),z]])+' >= 0');
    else for(let v=lo;v<hi;v++){const a=v-s;rows.push(expr([[1,h],[-(2*a+1),y],[(2*a+1)*s+a*(a+1),z]])+' >= 0');}
   });
   rows.push(expr([[1,part.var],...ys.map(y=>[-1,y])])+' = 0');
   rows.push(expr([[1,part.key],...hs.map(h=>[-1,h])])+' = 0');
  }
 }
 for(let p=0;p<people.length;p++){
  const work=[],night=[],noon=[],day=[],eve=[],hol=[],ptTerms=[],dayTasks=new Map(),byDay=new Map(),byNumber=new Map(),bySunday=new Map(),bandVars=new Map();
  for(const j of allowed[p]){
   if(choices&&!choices(j,p))continue;
   const t=tasks[j],d=t.day-first,k=band(t),key=d+'_'+k;
   let x;
   if(categoryOnly&&bandVars.has(key))x=bandVars.get(key);
   else{
    x=categoryOnly?'w'+p+'_'+key:'x'+p+'_'+j;binary.push(x);work.push(x);bandVars.set(key,x);
    [night,noon,day,eve][k].push(x);
    if(t.holiday)hol.push(x);
    if(f.src.points&&!categoryOnly)ptTerms.push([f.src.points[j],x]);
    if(!byDay.has(d))byDay.set(d,[]);byDay.get(d).push(x);
    if(!categoryOnly){if(!dayTasks.has(d))dayTasks.set(d,[]);dayTasks.get(d).push([t,x]);}
    if(!categoryOnly||k!==0){
     if(!byNumber.has(t.num))byNumber.set(t.num,new Map());
     byNumber.get(t.num).set(d,[x]);
    }
    if(t.stay)bySunday.set(d,x);
   }
   slotVars[j].push([p,x]);
   if(pins.get(j)===p)rows.push(x+' = 1');
  }
  offDay(byDay,__shiftRules.officer.minGapDays);
  // 最多連站天數（含前後月份已排的日子）與跨日休息時數
  if(__shiftRules.officer.minGapDays<=1&&__shiftRules.officer.maxConsecutiveDays){
   const KO=__shiftRules.officer.maxConsecutiveDays,hist=edgeHistory(people[p],days);
   for(let s0=-KO;s0<days;s0++){
    const span=Array.from({length:KO+1},(_,i)=>s0+i),vars=span.flatMap(d=>byDay.get(d)||[]);
    const cap=KO-span.reduce((n,d)=>n+(hist.get(d)||0),0);
    if(vars.length&&vars.length>cap)rows.push(sum(vars)+' <= '+Math.max(0,cap));
   }
   const RO=__shiftRules.officer.restHours||0;
   if(RO>0)for(const [d,list] of dayTasks){const next=dayTasks.get(d+1);if(!next)continue;
    for(const [t1,x1] of list)for(const [t2,x2] of next)if(24+t2.start-t1.end<RO)rows.push(x1+' + '+x2+' <= 1');}
  }
  for(const m of byNumber.values())offDay(m,__shiftRules.shared.sameSlotWindowDays+1);
  for(const [d,v] of bySunday)for(let gapW=1;gapW<=__shiftRules.shared.sundayStayGapWeeks;gapW++)if(bySunday.has(d-7*gapW))rows.push(bySunday.get(d-7*gapW)+' + '+v+' <= 1');
  if(stage===0)continue;
  const w=people[p],c=total('c'+p,work);
  if(groups){
   const opts=groups[p],bs=opts.map((o,i)=>'a'+p+'_'+i);
   if(!opts.length)throw Error('安官人員配額組合為空');
   if(opts.length>1){binary.push(...bs);rows.push(sum(bs)+' = 1');}
   function tie(list,prop){
    const vs=opts.map(o=>o[prop]);
    if(vs.every(n=>n===vs[0])){rows.push(sum(list)+' = '+vs[0]);return;}
    rows.push(expr([...list.map(v=>[1,v]),...vs.map((n,i)=>[-n,bs[i]])])+' = 0');
   }
   tie(work,'c');tie(night,'n');tie(noon,'m');tie(eve,'e');
   if(!categoryOnly){
    // Per-person pattern cost assumes the most even attainable spread across eligible night slots.
    const numbers=[...new Set(allowed[p].filter(j=>tasks[j].night).map(j=>tasks[j].num))];
    for(const num of numbers){
     const bin=[...(byNumber.get(num)?.values()||[])].flat();
     const lo=opts.map(o=>Math.floor(o.n/numbers.length)),hi=opts.map(o=>Math.ceil(o.n/numbers.length));
     for(const [arr,op] of [[lo,' >= '],[hi,' <= ']]){
      if(arr.every(v=>v===arr[0]))rows.push(sum(bin)+op+arr[0]);
      else rows.push(expr([...bin.map(v=>[1,v]),...arr.map((n,i)=>[-n,bs[i]])])+op+'0');
     }
    }
   }
   continue;
  }
  const u='u'+p;errors.push(u);rows.push(c+' - '+u+' <= '+w.goal,c+' + '+u+' >= '+w.goal);
  if(stage<2)continue;
  const harshBucket=stage===3?lockTerms:cost;
  const nv=total('n'+p,night),mv=total('m'+p,noon),hv='h'+p;
  rows.push(expr([[1,hv],...night.map(v=>[-2,v]),...noon.concat(day).map(v=>[-6,v]),...eve.map(v=>[-4,v])])+' = 0');
  [nv,mv,hv].forEach((v,k)=>categoryTotals[k].push(v));
  const bits=[];
  if(!allFilled){
   for(let b=1;b<=capacity[p];b*=2){const flag='b'+p+'_'+b;bits.push([b,flag]);binary.push(flag);}
   rows.push(expr([[1,c],...bits.map(([b,v])=>[-b,v])])+' = 0');
  }
  if(f.src.points){
   // 勤務負擔點數（只在全部填滿時使用）：err＝pt − 總點數/填班數×班數 ＋ 跨月累計差額
   // 有缺班時（fixHoles）：缺的班固定空著，總點數與假日班數只算有人站的班
   const pv='pt'+p,PT=f.src.points.reduce((a,b,j)=>a+(fixHoles&&fixHoles.has(j)?0:b),0),off=w.burdenOffset||0,key='k'+p+'_0',err='q'+p+'_0';
   rows.push(expr([[1,pv],...ptTerms.map(([wt,x])=>[-wt,x])])+' = 0');
   const liveD=fixHoles?tasks.filter((t,j)=>t.holiday&&!fixHoles.has(j)).length:totalD,useHol=f.src.holidayWeight>0;
   const dv=useHol?total('d'+p,hol):null,k3='k'+p+'_3';
   if(!categoryOnly){
    // 精確寫法（見 exactSquares）：err＝pt − 總點數/填班數×班數 ＋ 跨月累計差額
    const holSet=new Set(hol),parts=[{name:'p',var:pv,key,weights:ptTerms.map(([wt])=>wt),slope:PT/filled,offset:off}];
    if(useHol)parts.push({name:'d',var:dv,key:k3,weights:work.map(x=>holSet.has(x)?1:0),slope:liveD/filled,offset:0});
    exactSquares(p,c,work,w.goal,parts);
   }else{
    bounds.push(err+' free');rows.push(expr([[1,err],[-1,pv],[PT/filled,c]])+' = '+off);
    for(const a of cuts.get(key)||[0])rows.push(expr([[1,key],[-2*a/filled,err]])+' >= '+(-((a/filled)**2)));
    if(useHol){const e3='q'+p+'_3';bounds.push(e3+' free');rows.push(expr([[1,e3],[-1,dv],[liveD/filled,c]])+' = 0');
     for(const a of cuts.get(k3)||[0])rows.push(expr([[1,k3],[-2*a/filled,e3]])+' >= '+(-((a/filled)**2)));}
   }
   fairTerms.push({p,k:0,key});harshBucket.push('50 '+key);
   // 假日班數平均（與點數合併計分）；第 4 項假日班公平沿用同一個變數
   if(useHol){fairTerms.push({p,k:3,key:k3});harshBucket.push((200*f.src.holidayWeight)+' '+k3);}
  }else for(const [k,[v,weight,fixed,limit]] of [[nv,50,totalN,filled],[mv,35,totalM,filled],[hv,1,totalH,6*filled]].entries()){
   const key='k'+p+'_'+k,err='q'+p+'_'+k,terms=[[1,err],[-1,v]];
   if(allFilled)terms.push([fixed/filled,c]);
   else for(const [b,flag] of bits){
    const prod='v'+p+'_'+k+'_'+b,g='g'+k;
    rows.push(prod+' - '+limit+' '+flag+' <= 0',prod+' - '+g+' <= 0',expr([[1,prod],[-1,g],[-limit,flag]])+' >= '+(-limit));
    terms.push([b/filled,prod]);
   }
   bounds.push(err+' free');rows.push(expr(terms)+' = 0');
   for(const a of cuts.get(key)||[0])rows.push(expr([[1,key],[-2*a/filled,err]])+' >= '+(-((a/filled)**2)));
   fairTerms.push({p,k,key});harshBucket.push(weight+' '+key);
  }
  if(stage===3&&f.src.points&&f.src.holidayWeight>0)cost.push('1 k'+p+'_3');
  else if(stage===3){
   // 第 4 項：假日班公平（只在全部填滿時使用）
   const dv=total('d'+p,hol),key='k'+p+'_3',err='q'+p+'_3';
   bounds.push(err+' free');rows.push(expr([[1,err],[-1,dv],[totalD/filled,c]])+' = 0');
   for(const a of cuts.get(key)||[0])rows.push(expr([[1,key],[-2*a/filled,err]])+' >= '+(-((a/filled)**2)));
   fairTerms.push({p,k:3,key});cost.push('1 '+key);
  }
  for(const [num,entries] of byNumber){
   const example=tasks.find(t=>t.num===num);if(!example.night&&!example.noon)continue;
   const list=[...entries.values()].flat(),v=total('r'+p+'_'+num,list),h='s'+p+'_'+num;
   harshBucket.push('30 '+h);const cap=officerCapacity([...entries.keys()],__shiftRules.shared.sameSlotWindowDays+1);
   for(let k=1;k<cap;k++)rows.push(h+' - '+(2*k-1)+' '+v+' >= '+(1-k-k*k));
  }
 }
 if(categoryOnly){
  for(let d=0;d<days;d++)for(let b=0;b<4;b++){
   const js=tasks.flatMap((t,j)=>t.day-first===d&&band(t)===b?[j]:[]);
   const vs=[...new Set(js.flatMap(j=>slotVars[j].map(x=>x[1])))];
   rows.push(sum(vs)+' = '+js.length);
  }
  for(const list of slotVars)rows.push(sum(list.map(x=>x[1]))+' >= 1');
 }else for(let j=0;j<tasks.length;j++){
  const list=slotVars[j].map(x=>x[1]);
  if(!allFilled&&!pins.has(j)){const hole='o'+j;binary.push(hole);holes.push(hole);list.push(hole);if(fixHoles)rows.push(hole+' = '+(fixHoles.has(j)?1:0));}
  rows.push(sum(list)+' = 1');
 }
 if(stage===0)cost.push(...holes);
 if(stage>0&&!allFilled)rows.push(sum(holes)+' = '+(tasks.length-filled));
 if(!groups&&stage===1){
  if(targetL1!=null)rows.push(sum(errors)+' <= '+targetL1);
  else cost.push(...errors);
 }
 if(!groups&&stage>=2){
  rows.push(sum(errors)+' <= '+l1);
  if(stage===3)rows.push(sum(lockTerms)+' <= '+(50*lock+0.5/(filled*filled)));
  if(!allFilled)categoryTotals.forEach((vs,k)=>total('g'+k,vs));
 }
 return {lp:lp.text(),fairTerms,read:r=>slotVars.map(list=>list.find(([,v])=>r.Columns?.[v]?.Primal>0.5)?.[0]??-1)};
}
// Ignore calendar competition to obtain a lower bound, then place the same duty mix on actual dates.
function officerPatterns(f,l1,incumbent){
 const {tasks,people,capacity,allowed,goalTotal}=f,F=tasks.length;
 const N=tasks.filter(t=>t.night).length,M=tasks.filter(t=>t.noon).length,E=tasks.filter(t=>t.dur===4).length,H=tasks.reduce((s,t)=>s+t.dur,0);
 const D=(l1+goalTotal-F)/2,S=(l1+F-goalTotal)/2,required=people.reduce((s,p,i)=>s+Math.max(0,p.goal-capacity[i]),0);
 const groups=people.map((w,p)=>{
  const ds=allowed[p].map(j=>tasks[j]),nk=new Set(ds.filter(t=>t.night).map(t=>t.num)).size;
  const cat=t=>t.night?1:t.noon?2:t.dur===4?8:4;
  const caps=Array.from({length:16},(_,mask)=>{
   const possible=ds.filter(t=>(mask&cat(t))!==0);
   return officerCapacity(possible.map(t=>t.day),new Set(possible.map(t=>t.num)).size===1?Math.max(__shiftRules.officer.minGapDays,__shiftRules.shared.sameSlotWindowDays+1):__shiftRules.officer.minGapDays);
  });
  const options=[];
  for(let c=Math.max(0,w.goal-D+required-Math.max(0,w.goal-capacity[p]));c<=Math.min(capacity[p],w.goal+S);c++){
   for(let n=0;n<=Math.min(c,caps[1]);n++)for(let m=0;m<=Math.min(c-n,caps[2]);m++)for(let e=0;e<=Math.min(c-n-m,caps[8]);e++){
    const day=c-n-m-e;
    if(day>caps[4])continue;
    const count=[n,m,day,e];
    if(caps.some((cap,mask)=>count.reduce((s,v,i)=>s+((mask&(1<<i))?v:0),0)>cap))continue;
    const hours=6*c-4*n-2*e,low=nk?Math.floor(n/nk):0,rem=nk?n%nk:0;
    const rep=(nk-rem)*Math.max(0,low-1)**2+rem*low**2+Math.max(0,m-1)**2;
    const price=50*(F*n-N*c)**2+35*(F*m-M*c)**2+(F*hours-H*c)**2+30*F**2*rep;
    options.push({c,n,m,e,l:Math.abs(c-w.goal),price});
   }
  }
  return options;
 });
 if(groups.some(g=>!g.length))return null;
 const minima=groups.map(g=>Math.min(...g.map(o=>o.price))),base=minima.reduce((a,b)=>a+b,0),max=Math.round(incumbent*50*F*F);
 const pruned=groups.map((g,p)=>g.filter(o=>base-minima[p]+o.price<=max));
 return {groups:pruned,totals:[F,N,M,E,l1],den:50*F*F};
}
function officerMaster(highs,spec){
 const {groups,totals,den}=spec,lp=officerLP(),resources=['c','n','m','e','l'],vars=groups.map((g,p)=>g.map((_,i)=>'a'+p+'_'+i));
 groups.forEach((g,p)=>{
  lp.rows.push(lp.sum(vars[p])+' = 1');lp.binary.push(...vars[p]);
  g.forEach((o,i)=>{if(o.price)lp.cost.push((o.price/den)+' '+vars[p][i]);});
 });
 resources.forEach((k,r)=>lp.rows.push(lp.expr(groups.flatMap((g,p)=>g.map((o,i)=>[o[k],vars[p][i]])))+' = '+totals[r]));
 const opt={output_flag:false,mip_abs_gap:0,mip_rel_gap:0};
 const relax=highs.solve(lp.text(true),opt);
 if(relax.Status!=='Optimal')return null;
 const exact=highs.solve(lp.text(),{...opt,time_limit:14});
 if(exact.Status!=='Optimal')return null;
 const chosen=groups.map((g,p)=>g.filter((_,i)=>exact.Columns[vars[p][i]].Primal>.5));
 if(chosen.some(g=>g.length!==1))return null;
 const price=chosen.reduce((s,g)=>s+g[0].price,0);
 if(!Number.isFinite(exact.ObjectiveValue)||Math.abs(exact.ObjectiveValue-price/den)>1e-4)return null;
 if(resources.some((k,i)=>chosen.reduce((s,g)=>s+g[0][k],0)!==totals[i]))throw Error('安官配額下限複核失敗');
 // The LP reduced costs are used only to select a larger feasibility neighborhood.
 const budget=Math.max(0,price/den-relax.ObjectiveValue)+1e-5;
 const near=groups.map((g,p)=>g.filter((o,i)=>chosen[p][0]===o||(relax.Columns[vars[p][i]]?.Dual??0)<=budget));
 return {chosen,near,floor:price/den};
}
function officerTimes(f,initial,accept){
 const a=initial.slice(),{allowed,pins,tasks}=f,can=allowed.map(js=>new Set(js));
 const clash=tasks.map((t,j)=>tasks.flatMap((u,k)=>k!==j&&officerConflict(t,u)?[k]:[]));
 const scores=a=>officerObjectives(f.src,a);
 let best=scores(a),changed=true;
 for(let pass=0;changed&&pass<6;pass++){
  changed=false;
  for(let j=0;j<a.length;j++)for(let k=j+1;k<a.length;k++){
   const p=a[j],q=a[k];if(p<0||q<0||p===q||pins.has(j)||pins.has(k)||!can[p].has(k)||!can[q].has(j))continue;
   if(clash[j].some(i=>i!==k&&a[i]===q)||clash[k].some(i=>i!==j&&a[i]===p))continue;
   a[j]=q;a[k]=p;
   if(tasks[j].day!==tasks[k].day&&(!officerRunsOk(f,a,p)||!officerRunsOk(f,a,q))){a[j]=p;a[k]=q;continue;}
   const s=scores(a);
   if(s[2]<best[2]){best=s;changed=true;}else{a[j]=p;a[k]=q;}
  }
  if(changed)accept(a.slice());
 }
}
function solveOfficerPrecision(highs,src,send){
 const f=officerFrame(src),{tasks,people}=f;
 if(!tasks.length||tasks.length%7||tasks.some((t,j)=>t.num!==j%7+1||t.day!==f.first+Math.floor(j/7)||
    t.dur!==[2,2,2,2,6,6,4][j%7]||!!t.night!==(j%7<4)||!!t.noon!==(j%7===5)))throw Error('安官時段格式不符');
 let best=src.baseline.map(p=>p??-1),score=officerObjectives(src,best),proven=0,ptsTimed=false,ptsRestricted=false;
 const emit=phase=>send({phase,proven:ptsTimed?Math.min(proven,2):proven,scores:score,assignments:best});
 let ptsBound=null;
 const fin=r=>ptsTimed?{...r,status:'OPTIMAL',holidayUnproven:true,pointsUnproven:true,pointsTimedOut:!ptsRestricted,pointsRestricted:ptsRestricted,pointsBound:ptsBound}:r;
 function consider(a){
  const q=officerObjectives(src,a);
  if(q.slice(0,proven).some((v,i)=>v!==score[i])||compareDoorObjectives(q,score)>=0)return;
  score=q;best=a.slice();emit('找到更佳安官班表');
 }
 const opt={output_flag:false,mip_abs_gap:0,mip_rel_gap:0,...variantOptions(src)};
 if(score[0]===0)proven=1;
 emit('已核對安官起始班表');
 if(!proven){
  const holes=tasks.filter((_,j)=>best[j]<0),near=new Set(holes.flatMap(t=>[t.day-1,t.day,t.day+1]));
  const everySlotHasCandidate=tasks.every((_,j)=>f.allowed.some(js=>js.includes(j)));
  if(everySlotHasCandidate){
   emit('先補安官缺班，嘗試調整缺班日前後的人選');
   const warm=officerAssignmentModel(f,{stage:0,filled:tasks.length,choices:(j,p)=>near.has(tasks[j].day)||best[j]===p});
   const r=highs.solve(warm.lp,{...opt,time_limit:3});
   if(r.Status==='Optimal')consider(warm.read(r));
  }
  if(!score[0]){proven=1;emit('安官已填滿');}
 }
 if(!proven){
  emit('計算全月可填的最多安官班次');
  const model=officerAssignmentModel(f,{stage:0});
  draftStage(120);
  const r=solveDoorModel(highs,model,best,opt,consider);
  if(r.Status!=='Optimal')throw Error('安官缺班證明未完成');
  consider(model.read(r));if(Math.abs(r.ObjectiveValue-score[0])>1e-6)throw Error('安官缺班數複核失敗');
  proven++;emit('已證明最低缺班數');
 }
 const filled=tasks.length-score[0],low=f.lowerL1(filled);
 if(score[1]>low){
  // Try a sparse selection of alternatives first. A verified witness at the counting bound is sufficient.
  const original=best.slice();
  const candidates=tasks.map((_,j)=>f.allowed.flatMap((js,p)=>js.includes(j)?[p]:[]));
  let seed=6569;
  const rng=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  const keep=candidates.map((list,j)=>new Set([original[j],...list.map(p=>[rng(),p]).sort((a,b)=>a[0]-b[0]).slice(0,5).map(x=>x[1])]));
  const model=officerAssignmentModel(f,{stage:1,filled,targetL1:low,choices:(j,p)=>keep[j].has(p)});
  const r=highs.solve(model.lp,{...opt,time_limit:4});
  if(r.Status==='Optimal')consider(model.read(r));
 }
 if(score[1]>low){
  emit('正在證明個人班數偏差的最小值');
  draftStage(120);
  const def=officerAssignmentModel(f,{stage:1,filled}),r=solveDoorModel(highs,def,best,opt,consider);
  if(r.Status!=='Optimal')throw Error('安官班數偏差證明未完成');
  consider(def.read(r));if(Math.abs(r.ObjectiveValue-score[1])>1e-6)throw Error('安官班數偏差複核失敗');
 }
 proven=2;emit('已證明最低缺班數與班數偏差');
 if(src.points&&score[2]!==0){
  // 有缺班：缺的班維持空缺（數量已證明最少），其餘班次照樣平衡點數，但不宣稱最優
  const holeSet=filled!==tasks.length?new Set(best.flatMap((p,j)=>p<0?[j]:[])):null;
  if(holeSet){ptsRestricted=true;emit('安官有缺班：缺的班維持空缺，其餘班次照樣平衡勤務負擔點數');}
  const ptsOut={status:'OPTIMAL',holidayUnproven:true,pointsUnproven:true,pointsTimedOut:!holeSet,pointsRestricted:!!holeSet};
  emit('安官勤務負擔點數：兩兩互換改善');officerTimes(f,best,consider);
  if(!(src.pointsSeconds>0))return ptsOut;
  const ptsEnd=Date.now()+src.pointsSeconds*1000;
  const live=j=>!holeSet||!holeSet.has(j);
  const HT=tasks.filter((t,j)=>t.holiday&&live(j)).length,PT=src.points.reduce((a,b,j)=>a+(live(j)?b:0),0),cuts=new Map(),grid=Array.from({length:33},(_,i)=>i-16);
  people.forEach((_,p)=>cuts.set('k'+p+'_0',new Set(grid.map(d=>filled*d))));
  const addPts=a=>{
   const pt=people.map(()=>0),cnt=people.map(()=>0),hd=people.map(()=>0);a.forEach((p,j)=>{if(p<0)return;pt[p]+=src.points[j];cnt[p]++;if(tasks[j].holiday)hd[p]++;});
   let added=false;
   const put=(key,e)=>{if(!cuts.has(key))cuts.set(key,new Set([0]));if(!cuts.get(key).has(e)){cuts.get(key).add(e);added=true;}};
   people.forEach((w,p)=>{put('k'+p+'_0',filled*pt[p]-PT*cnt[p]+filled*(w.burdenOffset||0));if(src.holidayWeight>0)put('k'+p+'_3',filled*hd[p]-HT*cnt[p]);});
   return added;
  };
  addPts(best);
  // 上次精算留下的下限：同一份資料仍然有效。目前班表的點數一旦等於這個下限，就證明已是最優
  if(!holeSet&&Number.isFinite(src.pointsLB))ptsBound=src.pointsLB;
  const atBound=()=>ptsBound!==null&&score[2]<=ptsBound+1e-9*Math.max(1,score[2]);
  // 大型鄰域搜尋（LNS）：每輪只讓幾位安官（點數偏高與偏低各半）彼此重新分配手上的班，其他人完全不動，
  // 用整數規劃求這一小組的最佳分配。小問題幾秒內解完，能穩定改善點數；但只是改善，不構成整體最優證明。
  // 用時間預算的前 45%；剩下的時間照舊做整體證明（從改善後的班表出發，較容易完成）。
  {
   // 第二次以後（已有上次的下限）不再做小組重新分配，時間全部用來證明
   const lnsEnd=Date.now()+(Number.isFinite(src.pointsLB)?0:src.pointsSeconds*1000*0.45);
   let seed=40503+7919*(src.variant||0),stall=0,rounds=0;const rnd=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
   const dev=a=>{const d=people.map(w=>filled*(w.burdenOffset||0));a.forEach((p,j)=>{if(p>=0&&live(j))d[p]+=filled*src.points[j]-PT;});return d;};
   const take=(list,k)=>{const c=list.slice(),out=[];while(out.length<k&&c.length)out.push(c.splice(Math.floor(rnd()*c.length),1)[0]);return out;};
   const size=Math.min(people.length,6),third=Math.max(3,Math.ceil(people.length/3));
   while(rounds<300&&stall<15&&score[2]>1e-9&&!atBound()&&Date.now()<lnsEnd-500){
    rounds++;
    const d=dev(best),order=people.map((_,p)=>p).sort((x,y)=>d[y]-d[x]||x-y);
    const group=new Set([...take(order.slice(0,third),size>>1),...take(order.slice(-third),size-(size>>1))]);
    const before=score[2];
    for(let again=0;again<3;again++){
     const left=(lnsEnd-Date.now())/1000;if(left<0.5)break;
     const def=officerAssignmentModel(f,{stage:2,filled,l1:score[1],cuts,fixHoles:holeSet,choices:(j,p)=>best[j]===p||(group.has(p)&&group.has(best[j]))});
     let r;try{r=solveDoorModel(highs,def,best,{...opt,time_limit:Math.min(8,left)},consider);}catch(_){break;}
     if(r.Status!=='Optimal')break;
     const a=def.read(r);consider(a);
     // 近似目標（切平面）在這一小組已最佳；若真實點數沒改善，補上切平面再解一次
     if(score[2]<before-1e-9||!addPts(a))break;
    }
    if(score[2]<before-1e-9){stall=0;emit('安官勤務負擔點數：小組重新分配改善到 '+score[2].toFixed(2)+'（第 '+rounds+' 輪）');}else stall++;
   }
  }
  for(let iter=0;;iter++){
   if(iter>400)throw Error('安官勤務負擔點數未能完成證明');
   if(atBound()){emit('安官勤務負擔點數已達上次精算算出的下限');break;}
   emit('正在證明安官勤務負擔點數最優');
   const left=(ptsEnd-Date.now())/1000;if(left<=0.5){ptsTimed=true;break;}
   const def=officerAssignmentModel(f,{stage:2,filled,l1:score[1],cuts,fixHoles:holeSet});
   let r;try{r=solveDoorModel(highs,def,best,{...opt,time_limit:left},consider);}
   catch(e){
    if(Date.now()>=ptsEnd-1000){
     if(!holeSet&&Number.isFinite(__lastDual))ptsBound=Math.max(ptsBound??0,__lastDual/50);
     if(atBound())break; // 這次找到的班表已達下限（下限可能來自上次精算）
     ptsTimed=true;break;
    }
    throw e;}
   if(r.Status!=='Optimal'){if(Date.now()>=ptsEnd-1000){ptsTimed=true;break;}throw Error('安官勤務負擔點數證明未完成');}
   const a=def.read(r);consider(a);
   emit('安官勤務負擔點數：下限 '+(r.ObjectiveValue/50).toFixed(2)+'，目前 '+score[2].toFixed(2)+'（第 '+(iter+1)+' 輪）');
   if(r.ObjectiveValue>=score[2]*50-1e-6*Math.max(1,score[2]*50))break;
   if(!addPts(a))throw Error('安官勤務負擔點數評分與下限不一致');
  }
 }
 if(src.points&&ptsRestricted)ptsTimed=true;
 if(!src.points&&score[2]!==0)officerTimes(f,best,consider);
 let floor=0;
 if(!src.points&&score[2]!==0&&filled===tasks.length){
  emit('計算夜哨、午哨與勤務時數的共同下限');
  const patterns=officerPatterns(f,score[1],score[2]),master=patterns&&officerMaster(highs,patterns);
  if(master){
   floor=master.floor;
   for(const groups of [master.chosen,master.near]){
    if(Math.abs(score[2]-floor)<1e-9)break;
    emit('將安官配額排入實際時段，艱苦哨下限 '+floor.toFixed(2));
    const daily=officerAssignmentModel(f,{stage:2,filled,groups,categoryOnly:true});
    const d=highs.solve(daily.lp,{...opt,time_limit:10});
    if(d.Status==='Optimal'){
     const choices=(j,p)=>{const t=tasks[j],band=t.night?0:t.noon?1:t.dur===4?3:2;return d.Columns['w'+p+'_'+(t.day-f.first)+'_'+band]?.Primal>.5;};
     const slots=officerAssignmentModel(f,{stage:2,filled,groups,choices});
     const r=highs.solve(slots.lp,{...opt,time_limit:8});
     if(r.Status==='Optimal')consider(slots.read(r));
    }
   }
  }
 }
 if(score[2]<floor-1e-8)throw Error('安官艱苦哨低於求解下限，證明需重新核對');
 if(!src.points&&score[2]>floor+1e-9){
  const cuts=new Map();
  function addCuts(a){
   const per=people.map(()=>[0,0,0,0]),tot=[0,0,0];
   a.forEach((p,j)=>{if(p<0)return;const t=tasks[j],b=[+t.night,+t.noon,t.dur];per[p][3]++;b.forEach((n,k)=>{per[p][k]+=n;tot[k]+=n;});});
   let added=false;
   per.forEach((v,p)=>tot.forEach((g,k)=>{
    const key='k'+p+'_'+k,e=filled*v[k]-g*v[3];if(!cuts.has(key))cuts.set(key,new Set([0]));
    if(!cuts.get(key).has(e)){cuts.get(key).add(e);added=true;}
   }));return added;
  }
  addCuts(best);
  for(;;){
   emit('正在證明安官艱苦哨最優'+(floor?'，已知下限 '+floor.toFixed(2):''));
   const def=officerAssignmentModel(f,{stage:2,filled,l1:score[1],cuts});
   draftStage(15);
   const r=solveDoorModel(highs,def,best,opt,consider);
   if(r.Status!=='Optimal')throw Error('安官艱苦哨證明未完成');
   const a=def.read(r);consider(a);
   const scale=50*filled*filled;
   if(Math.round(r.ObjectiveValue*filled*filled)>=Math.round(score[2]*scale))break;
   if(!addCuts(a))throw Error('安官艱苦哨評分與下限不一致');
  }
 }
 proven=3;if(score[3]===0&&!ptsTimed)proven=4;
 emit(ptsRestricted?'有缺班：其餘班次的勤務負擔點數已平衡（不另證明）':ptsTimed?'勤務負擔點數已達時限，接著在點數不變差的前提下改善假日班':'三項安官目標均已證明最優');
 if(proven===3){
  if(filled!==tasks.length){emit('安官有缺班，假日班公平不另證明');return fin({status:'OPTIMAL',holidayUnproven:true});}
  const cuts=new Map();
  const addCuts=a=>{
   const per=people.map(()=>[0,0,0,0,0]),tot=[0,0,0,0];
   a.forEach((p,j)=>{if(p<0)return;const t=tasks[j],b=[src.points?src.points[j]:+t.night,+t.noon,t.dur,+!!t.holiday];per[p][4]++;b.forEach((n,k)=>{per[p][k]+=n;tot[k]+=n;});});
   let added=false;
   per.forEach((v,p)=>tot.forEach((g,k)=>{
    const key='k'+p+'_'+k,e=filled*v[k]-g*v[4]+(src.points&&k===0?filled*(people[p].burdenOffset||0):0);if(!cuts.has(key))cuts.set(key,new Set([0]));
    if(!cuts.get(key).has(e)){cuts.get(key).add(e);added=true;}
   }));return added;
  };
  const atBound=()=>{if(score[1]!==0)return false;const counts=people.map((_,p)=>best.filter(q=>q===p).length),lb=holidayLowerBound(src,counts,true);return lb!==null&&score[3]<=lb+1e-9;};
  if(atBound()){proven=4;emit(ptsTimed?'假日班已達理論下限':'四項安官目標均已證明最優（假日班已達理論下限）');return fin({status:'OPTIMAL'});}
  if(!(src.holidaySeconds>0))return fin({status:'OPTIMAL',holidayUnproven:true});
  const holidayEnd=Date.now()+src.holidaySeconds*1000,timedOut={status:'OPTIMAL',holidayUnproven:true,holidayTimedOut:true};
  addCuts(best);let done=false;
  for(let iter=0;iter<400&&!done;iter++){
   const left=(holidayEnd-Date.now())/1000;if(left<=0.5)return fin(timedOut);
   if(atBound()){done=true;break;}
   emit('正在證明安官假日班公平的最小值（第 '+(iter+1)+' 輪）');
   const def=officerAssignmentModel(f,{stage:3,filled,l1:score[1],cuts,lock:score[2]});
   let r;try{r=solveDoorModel(highs,def,best,{...opt,time_limit:left},consider);}
   catch(e){if(Date.now()>=holidayEnd-1000)return fin(timedOut);throw e;}
   if(r.Status!=='Optimal')throw Error('安官假日班公平證明未完成');
   const a=def.read(r),q=officerObjectives(src,a);
   if(q[0]!==score[0]||q[1]!==score[1])throw Error('安官假日班：高優先目標複核失敗');
   const added=addCuts(a),tol=1e-9*Math.max(1,Math.abs(score[2]));
   if(q[2]>score[2]+tol){if(!added)throw Error('安官假日班：艱苦哨鎖定複核失敗');continue;}
   consider(a);
   // 點數模式為精確寫法：求解器的目標值等於真實假日分數就是最優，不必再補切線重解
   if(!added||(src.points&&Math.abs(r.ObjectiveValue-q[3])<=1e-6*Math.max(1,q[3]))){
    if(Math.abs(r.ObjectiveValue-q[3])>1e-6)throw Error('安官假日班分數複核失敗');
    if(q[3]>score[3]+1e-12)throw Error('安官假日班：最優解與已知班表不一致');
    done=true;
   }
  }
  if(!done)throw Error('安官假日班公平未能在迭代上限內完成證明');
  proven=4;
 }
 emit(ptsTimed?'假日班公平已改善（勤務負擔點數未完成證明）':'四項安官目標均已證明最優');return fin({status:'OPTIMAL'});
}

// 大門「同日額外班次」與「個人目標偏差」的理論下限。
// 只保留「每人每天是否可站、連站天數、每日人數需求、每日／相鄰兩日班數上限、同日額外班次上限」，
// 放寬時段休息、同時段、留守與人工固定等條件，所以是有效下限；目前班表若已達到，該項即證明最優，
// 不必再跑整月模型。達不到時照舊執行完整證明，結果不受影響。
function doorDayBound(highs,src,stage,locks){
 const missingLock=stage>0?locks[0]:null,extraLock=locks[1];
 const {tasks,people}=src,days=tasks.length/12,K=__shiftRules.door.maxConsecutiveDays,cap=doorDayCap(),two=__shiftRules.door.twoDayMaxShifts;
 // 引擎內部以「班次序號 ÷ 12」作為第幾天（0 起算），不是實際日期編號
 const demand=Array(days).fill(0);tasks.forEach((t,j)=>demand[Math.floor(j/12)]++);
 const slots=people.map(p=>{const c=Array(days).fill(0);p.allowed.forEach(j=>c[Math.floor(j/12)]++);return c;});
 const y=(p,d)=>'y'+p+'_'+d,sv=(p,d)=>'s'+p+'_'+d,sum=list=>list.length?list.join(' + '):'zero';
 function build(integral){
  const rows=[],bounds=['zero = 0'],obj=[],ints=[],extraTerms=[];
  people.forEach((person,p)=>{
   const hist=edgeHistory(person,days),shifts=[];
   for(let first=-K;first<days;first++){
    const vars=[];let used=0;
    for(let d=first;d<=first+K;d++){if(d>=0&&d<days){if(slots[p][d])vars.push(y(p,d));}else used+=hist.get(d)||0;}
    if(vars.length)rows.push(sum(vars)+' <= '+Math.max(0,K-used));
   }
   for(let d=0;d<days;d++){
    if(!slots[p][d])continue;
    bounds.push('0 <= '+y(p,d)+' <= 1','0 <= '+sv(p,d)+' <= '+Math.min(cap,slots[p][d]));
    if(integral)ints.push(y(p,d),sv(p,d));
    rows.push(sv(p,d)+' - '+y(p,d)+' >= 0',sv(p,d)+' - '+Math.min(cap,slots[p][d])+' '+y(p,d)+' <= 0');
    if(d+1<days&&slots[p][d+1])rows.push(sv(p,d)+' + '+sv(p,d+1)+' <= '+two);
    shifts.push(sv(p,d));extraTerms.push(sv(p,d)+' - '+y(p,d));
   }
   if(stage===2){rows.push(sum(shifts)+' - dp'+p+' + dm'+p+' = '+person.goal);bounds.push('dp'+p+' >= 0','dm'+p+' >= 0');obj.push('dp'+p,'dm'+p);}
  });
  const all=[];
  for(let d=0;d<days;d++){const ss=[];people.forEach((_,p)=>{if(slots[p][d])ss.push(sv(p,d));});all.push(...ss);rows.push(sum(ss)+(missingLock===0?' = ':' <= ')+demand[d]);}
  if(stage>0&&missingLock>0)rows.push(sum(all)+' = '+(tasks.length-missingLock));
  const extra=extraTerms.length?extraTerms.join(' + '):'zero';
  if(stage===0)obj.push(sum(all));else if(stage===1)obj.push(extra);else rows.push(extra+' <= '+extraLock);
  return [stage===0?'Maximize':'Minimize',' obj: '+obj.join(' + '),'Subject To',...rows.map((r,i)=>' b_'+i+': '+r),'Bounds',...bounds,...(ints.length?['General',...ints]:[]),'End'].join('\n');
 }
 let value=null,pattern=null;
 try{
  const r=solveDoorModel(highs,{lp:build(false)},Array(tasks.length).fill(-1),{output_flag:false,time_limit:20},()=>{});
  if(r.Status!=='Optimal'||!Number.isFinite(r.ObjectiveValue))return null;
  value=stage===0?tasks.length-Math.floor(r.ObjectiveValue+1e-6):Math.ceil(r.ObjectiveValue-1e-6);
 }catch(_){return null;}
 try{
  // 整數版只用來產生「每人站哪幾天」的導引，不影響下限的正確性
  const r=solveDoorModel(highs,{lp:build(true)},Array(tasks.length).fill(-1),{output_flag:false,time_limit:8,mip_rel_gap:0},()=>{});
  if(r.Status==='Optimal'){pattern=new Map();people.forEach((_,p)=>{const set=new Set();for(let d=0;d<days;d++)if(slots[p][d]&&(r.Columns[y(p,d)]?.Primal||0)>0.5)set.add(d);pattern.set(p,set);});}
 }catch(_){}
 return {value,pattern};
}
function precisionSolve(highs,src,send){
 const {tasks,people}=src;
 if(!tasks.length||tasks.length%12||tasks.some(t=>t.end-t.start!==2))throw Error('大門時段格式不符');
 let best=src.baseline.map(p=>p??-1),score=doorObjectives(src,best),proven=0,ptsTimed=false;
 const emit=phase=>send({phase,proven:ptsTimed?Math.min(proven,4):proven,assignments:best,scores:score});
 let ptsBound=null;
 const fin=r=>ptsTimed?{...r,status:'OPTIMAL',holidayUnproven:true,pointsUnproven:true,pointsTimedOut:true,pointsBound:ptsBound}:r;
 const consider=(a)=>{if(!a)return false;const s=doorObjectives(src,a);if(compareDoorObjectives(s,score)>=0)return false;best=a;score=s;return true;};
 const auto=()=>{while(proven<6&&score[proven]===0)proven++;};
 auto();emit('已核對起始班表');
 if(proven<4&&people.length){
  const warm=solveZero(highs,src,true);
  consider(warm.assignments);
  auto();
  if(proven===3&&Number.isInteger(warm.pairBound)&&score[3]===warm.pairBound){proven++;auto();}
  emit('已完成每日人選與時段配對');
 }
 const options={mip_rel_gap:0,mip_abs_gap:0,output_flag:false,...variantOptions(src)};
 function publish(a){
  const s=doorObjectives(src,a);
  if(s.slice(0,proven).some((v,i)=>v!==score[i]))throw Error('高優先目標不符');
  if(consider(a))emit('已找到更佳的合法班表');
 }
 let fairFloor=null;
 const labels=['缺班','同日額外班次','個人目標偏差','本月連站次數','艱苦哨公平'];
 while(proven<4){
  if(score[0]===0&&(proven===1||proven===2)){
   const bound=doorDayBound(highs,src,proven,score),lb=bound?bound.value:null;
   // 防呆：目前班表本身可行，下限不可能高於它；出現矛盾代表下限有誤，不採用、照舊完整證明。
   if(lb!==null&&lb===score[proven]){proven++;auto();emit('已證明'+labels[proven-1]+'最優（已達理論下限）');continue;}
   if(lb!==null&&lb<score[proven]){
    // 先依下限模型的「每人站哪幾天」快速找班表（最多 15 秒）；達到下限即證明最優。
    emit('正在依理論下限尋找'+labels[proven]+'更少的班表');
    src.dayRestriction=bound.pattern;if(!bound.pattern)src.dayRestriction=null;
    if(src.dayRestriction)try{const m=precisionModel(src,proven,score.slice(0,proven)),r=solveDoorModel(highs,m,best,{...options,time_limit:15},publish);if(r.Status==='Optimal')consider(m.read(r));}catch(_){}
    src.dayRestriction=null;
    if(score[proven]===lb){proven++;auto();emit('已證明'+labels[proven-1]+'最優（已達理論下限）');continue;}
   }
   // 仍未達下限：把下限當成整月模型的一條有效限制，找到達下限的班表時即可立刻確認最優。
   src.stageLowerBound=lb!==null&&lb<score[proven]?{stage:proven,value:lb}:null;
  }else src.stageLowerBound=null;
  emit('正在證明'+labels[proven]+'的最小值');
  draftStage(proven<=2?120:15);
  const m=precisionModel(src,proven,score.slice(0,proven)),r=solveDoorModel(highs,m,best,options,publish);
  if(r.Status!=='Optimal')throw Error(labels[proven]+'求解狀態 '+r.Status);
  const a=m.read(r),s=doorObjectives(src,a);
  if(Math.abs(s[proven]-r.ObjectiveValue)>0.001||s.slice(0,proven).some((v,i)=>v!==score[i])||s[proven]>score[proven])throw Error('目標值複核失敗');
  consider(a);proven++;auto();emit('已證明'+labels[proven-1]+'最優');
 }
 if(proven===4){
  consider(improveDoorTimes(src,best));auto();emit(''+(src.points?'已完成同日時段互換（平衡勤務負擔點數）':'已完成艱苦哨時段互換')+'');
 }
 if(proven===4&&src.points){
  // 勤務負擔點數階段：以割平面逐步逼近平方偏差並證明最優（有缺班時不另證明）
  if(score[0]!==0){emit('有缺班：缺的班維持空缺，其餘班次以兩人互換平衡勤務負擔點數');return {status:'OPTIMAL',holidayUnproven:true,pointsUnproven:true,pointsRestricted:true};}
  const ptsOut={status:'OPTIMAL',holidayUnproven:true,pointsUnproven:true,pointsTimedOut:true};
  if(!(src.pointsSeconds>0))return ptsOut;
  const ptsEnd=Date.now()+src.pointsSeconds*1000;
  const PTS=src.points.reduce((a,b)=>a+b,0),F=tasks.length,cuts=new Map();let done=false;
  // 先在 ±8 點範圍每 0.5 點放一條切線，讓下限一開始就接近真實平方偏差，減少反覆求解次數
  const grid=Array.from({length:33},(_,i)=>i-16);people.forEach((_,p)=>cuts.set('pt'+p,new Set(grid.map(d=>F*d))));
  // 上次精算留下的下限（同一份資料仍有效）；班表點數一旦等於下限即證明最優
  if(Number.isFinite(src.pointsLB))ptsBound=src.pointsLB;
  const atBound=()=>ptsBound!==null&&score[4]<=ptsBound+1e-9*Math.max(1,score[4]);
  for(let iter=0;iter<400&&!done;iter++){
   if(atBound()){emit('勤務負擔點數已達上次精算算出的下限');done=true;break;}
   emit('正在證明勤務負擔點數的最優分配');
   const left=(ptsEnd-Date.now())/1000;if(left<=0.5){ptsTimed=true;break;}
   const model=precisionModel(src,4,score.slice(0,4),{points:PTS,holiday:tasks.filter(t=>t.holiday).length},cuts);
   let r;try{r=solveDoorModel(highs,model,best,{...options,time_limit:left},publish);}
   catch(e){
    if(Date.now()>=ptsEnd-1000){
     if(Number.isFinite(__lastDual))ptsBound=Math.max(ptsBound??0,__lastDual/10);
     if(atBound()){done=true;break;}
     ptsTimed=true;break;
    }
    throw e;}
   if(r.Status!=='Optimal'){if(Date.now()>=ptsEnd-1000){ptsTimed=true;break;}throw Error('勤務負擔點數求解狀態 '+r.Status);}
   const a=model.read(r),s=doorObjectives(src,a);
   if(s.slice(0,4).some((v,i)=>v!==score[i]))throw Error('高優先目標複核失敗');
   if(consider(a))emit('已找到勤務負擔點數更平均的班表');
   let added=false;
   for(const {p,v,total,offset} of model.fairVars){
    const e=F*Math.round(r.Columns[v].Primal)-total*Math.round(r.Columns['c'+p].Primal)+F*(offset||0);
    if(!cuts.has(v))cuts.set(v,new Set([0]));
    if(!cuts.get(v).has(e)){cuts.get(v).add(e);added=true;}
   }
   if(!added){if(Math.abs(r.ObjectiveValue/10-s[4])>1e-6)throw Error('勤務負擔點數分數複核失敗');done=true;}
  }
  if(!done&&!ptsTimed)throw Error('勤務負擔點數未能完成證明');
  if(ptsTimed)emit('勤務負擔點數已達時限，接著在點數不變差的前提下改善假日班');else{proven=5;auto();emit('五項目標均已證明最優');}
 }
 if(proven===4&&!src.points){
  if(score[0]===0&&score[2]===0){
   const bound=doorFairBound(src);
   if(bound){
    fairFloor=bound.value;
    const atFloor=()=>Math.abs(score[4]-bound.value)<1e-9;
    if(!atFloor()){
     searchDoorTimes(src,best,bound.value,a=>{if(consider(a))emit('艱苦哨分配改善，理論下限 '+bound.value.toFixed(2));});
    }
    if(!atFloor()&&score[1]===0){
     emit('按夜哨、午哨與日哨配對，驗證下限 '+bound.value.toFixed(2));
     const planned=solveZero(highs,{...src,baseline:best},true,{bound,pairs:score[3]});
     if(planned.assignments&&doorObjectives(src,planned.assignments).slice(0,4).every((n,i)=>n===score[i]))consider(planned.assignments);
    }
    if(!atFloor()){
     const dates=people.map(()=>new Set());
     best.forEach((p,j)=>dates[p].add(tasks[j].day));
     const fixed={...src,people:people.map((p,i)=>({...p,allowed:p.allowed.filter(j=>dates[i].has(tasks[j].day))}))};
     // Reassigning night slot numbers first keeps the workers and day/night totals unchanged.
     const band=t=>t.night?'night':t.noon?'noon':'day';
     const bands=people.map(()=>new Set());
     best.forEach((p,j)=>bands[p].add(tasks[j].day+'/'+band(tasks[j])));
     const tight={...src,people:people.map((p,i)=>({...p,allowed:p.allowed.filter(j=>
      bands[i].has(tasks[j].day+'/'+band(tasks[j]))&&(tasks[j].night||best[j]===i))}))};
     // Free the dates on which a worker can correct a shortfall without re-solving the whole month.
     const criticalDays=new Set();
     for(const {key,ranges} of bound.groups)ranges.forEach(({lo,hi,numbers},p)=>{
      const assigned=best.flatMap((q,j)=>q===p&&tasks[j][key]?[j]:[]);
      const bins=numbers.map(num=>assigned.filter(j=>tasks[j].num===num).length);
      if(assigned.length>=lo&&assigned.length<=hi&&(!bins.length||Math.max(...bins)-Math.min(...bins)<=1))return;
      dates[p].forEach(d=>criticalDays.add(d));
      for(const j of people[p].allowed)if(tasks[j][key])criticalDays.add(tasks[j].day);
     });
     const neighborhood={...src,people:people.map((p,i)=>({...p,allowed:p.allowed.filter(j=>criticalDays.has(tasks[j].day)||best[j]===i)}))};
     const trials=[[tight,3]];
     if(criticalDays.size&&criticalDays.size<=12)trials.push([neighborhood,20]);
     trials.push([fixed,8],[src,15]);
     for(const [modelSrc,seconds] of trials){
      emit('驗證艱苦哨理論下限 '+bound.value.toFixed(2));
      const model=precisionModel(modelSrc,4,score.slice(0,4),{},new Map(),bound);
      const r=highs.solve(model.lp,{...options,time_limit:seconds});
      if(r.Status==='Optimal'){
       const a=model.read(r),s=doorObjectives(src,a);
       if(s.slice(0,4).some((v,i)=>v!==score[i]))throw Error('艱苦哨候選的高優先目標不符');
       consider(a);
       if(atFloor())break;
      }
     }
    }
    if(atFloor()){proven=5;auto();emit('五項目標均已證明最優');}
   }
  }
  if(proven===4){
  // At a fixed filled count, enumerating the possible category totals makes each square convex.
  const F=tasks.length-score[0],nt=tasks.filter(t=>t.night).length,mt=tasks.filter(t=>t.noon).length;
  let feasibleTotals=false;
  for(let n=Math.max(0,nt-score[0]);n<=Math.min(nt,F);n++)for(let m=Math.max(0,mt-score[0]);m<=Math.min(mt,F-n);m++){
   if(F-n-m>tasks.length-nt-mt)continue;
   const cuts=new Map();
   for(;;){
    emit('正在證明艱苦哨公平的最小值'+(fairFloor===null?'':'，理論下限 '+fairFloor.toFixed(2)));
    const model=precisionModel(src,4,score.slice(0,4),{night:n,noon:m},cuts);
    draftStage(15);
    const r=solveDoorModel(highs,model,best,options,publish);
    if(r.Status==='Infeasible')break;
    if(r.Status!=='Optimal')throw Error('艱苦哨求解狀態 '+r.Status);
    const a=model.read(r),s=doorObjectives(src,a);
    if(s.slice(0,4).some((v,i)=>v!==score[i]))throw Error('高優先目標複核失敗');
    if(consider(a))emit('已找到艱苦哨分配更平均的班表');
    let added=false;
    for(const {p,v,h,total} of model.fairVars){
     const e=F*Math.round(r.Columns[v].Primal)-total*Math.round(r.Columns['c'+p].Primal);
     if(!cuts.has(v))cuts.set(v,new Set([0]));
     if(!cuts.get(v).has(e)){
      cuts.get(v).add(e);added=true;
     }
    }
    if(!added){
     if(Math.abs(r.ObjectiveValue/10-s[4])>1e-6)throw Error('艱苦哨分數複核失敗');
     feasibleTotals=true;break;
    }
   }
  }
  if(!feasibleTotals)throw Error('無法驗證已知班表的艱苦哨分數');
  proven=5;auto();
  }
 }
 if(proven===5||ptsTimed){
  // 第 6 項：假日班公平。只在全部填滿時證明（缺班時假日總數會變動，交由頁面做不影響其他目標的互換）。
  if(score[0]!==0){emit('五項目標均已證明最優；有缺班，假日班公平不另證明');return {status:'OPTIMAL',holidayUnproven:true};}
  const nt=tasks.filter(t=>t.night).length,mt=tasks.filter(t=>t.noon).length,ht=tasks.filter(t=>t.holiday).length,F=tasks.length;
  if(score[2]===0){
   const counts=people.map((_,p)=>best.filter(q=>q===p).length),lb=holidayLowerBound(src,counts,score[1]===0);
   if(lb!==null&&score[5]<=lb+1e-9){proven=6;emit(ptsTimed?'假日班已達理論下限':'六項目標均已證明最優（假日班已達理論下限）');return fin({status:'OPTIMAL'});}
  }
  if(!(src.holidaySeconds>0))return fin({status:'OPTIMAL',holidayUnproven:true});
  const holidayEnd=Date.now()+src.holidaySeconds*1000,timedOut={status:'OPTIMAL',holidayUnproven:true,holidayTimedOut:true};
  const cuts=new Map();let done=false;
  for(let iter=0;iter<400&&!done;iter++){
   const left=(holidayEnd-Date.now())/1000;if(left<=0.5)return fin(timedOut);
   if(score[2]===0){const counts=people.map((_,p)=>best.filter(q=>q===p).length),lb=holidayLowerBound(src,counts,score[1]===0);
    if(lb!==null&&score[5]<=lb+1e-9){done=true;break;}}
   emit('正在證明假日班公平的最小值（第 '+(iter+1)+' 輪）');
   const model=precisionModel(src,5,score.slice(0,5),{night:nt,noon:mt,holiday:ht,points:src.points?src.points.reduce((a,b)=>a+b,0):0},cuts);
   let r;try{r=solveDoorModel(highs,model,best,{...options,time_limit:left},publish);}
   catch(e){if(Date.now()>=holidayEnd-1000)return fin(timedOut);throw e;}
   if(r.Status!=='Optimal')throw Error('假日班公平求解狀態 '+r.Status);
   const a=model.read(r),s=doorObjectives(src,a);
   if(s.slice(0,4).some((v,i)=>v!==score[i]))throw Error('假日班：高優先目標複核失敗');
   let added=false;
   for(const {p,v,total,offset} of model.fairVars){
    const e=F*Math.round(r.Columns[v].Primal)-total*Math.round(r.Columns['c'+p].Primal)+F*(offset||0);
    if(!cuts.has(v))cuts.set(v,new Set([0]));
    if(!cuts.get(v).has(e)){cuts.get(v).add(e);added=true;}
   }
   if(s[4]>score[4]+1e-12){if(!added)throw Error('假日班：艱苦哨鎖定複核失敗');continue;}
   if(consider(a))emit('已找到假日班更平均的班表');
   if(!added){
    if(Math.abs(r.ObjectiveValue-s[5])>1e-6)throw Error('假日班分數複核失敗');
    if(s[5]>score[5]+1e-12)throw Error('假日班：最優解與已知班表不一致');
    done=true;
   }
  }
  if(!done)throw Error('假日班公平未能在迭代上限內完成證明');
  proven=6;
 }
 emit(ptsTimed?'假日班公平已改善（勤務負擔點數未完成證明）':'六項目標均已證明最優');
 return fin({status:'OPTIMAL'});
}
