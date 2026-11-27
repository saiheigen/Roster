// #region 班表結果與個人統計
function renderWorkloadNotice(){
 if(!last)return;
 const pool=currentPool,officer=pool==='officer',label=names[pool];
 const load=dailyLoadStats(last.solutions[pool]),bound=singleDailyShiftLowerBound(last.m,pool);
 const head=last.m.staff[pool].length,notice=$('workloadNotice');
 $('loadSummary').textContent=(officer&&load.doubles?'需修正 · ':'')+'同日多班 '+load.doubles+' 人日';
 $('loadSummary').classList.toggle('needs-fix',officer&&load.doubles>0);
 const critical=officer?load.doubles>0:load.triples>0;
 notice.className=critical?'critical':load.doubles||head<bound.minimum?'':'ok';
 const headline=load.doubles===0?label+'目前沒有同日多班':
  officer?'⚠️ 安官同日多班違規：'+load.doubles+' 人日':
  load.triples?'⚠️ 大門同日三班以上：'+load.triples+' 人日':'⚠️ 大門同日多班：'+load.doubles+' 人日';
 const details='同日兩班以上 '+load.doubles+' 人日，其中三班以上 '+load.triples+' 人日，同日額外班次 '+load.extra+' 班。';
 const baseline=label+'名冊 '+head+' 人。每天 '+slots[pool].length+' 班，按每人每天最多一班、'+(officer?(GUARD_SHIFT_RULES.officer.minGapDays>1?'站一歇一':'最多連站'+guardNumeral(GUARD_SHIFT_RULES.officer.maxConsecutiveDays)+'天'):'最多連站'+guardNumeral(GUARD_SHIFT_RULES.door.maxConsecutiveDays)+'天')+'計算，本月 '+bound.days+' 天至少需要 '+bound.minimum+' 人。休假與其他勤務可能提高實際需求。';
 const health=officer?'安官每天最多一班。'+(load.doubles?'請核對重複值勤的人員與日期。':''):
  '大門同日多班時，請核對勤務間隔與當日總時數。';
 notice.replaceChildren();
 const title=document.createElement('strong');title.textContent=headline;notice.appendChild(title);
 const stat=document.createElement('div');stat.textContent=details;notice.appendChild(stat);
 const line=document.createElement('div');line.className='muted';line.textContent=baseline;notice.appendChild(line);
 const avgLine=document.createElement('div');avgLine.className='muted';avgLine.textContent='平均每人約 '+(last.solutions[pool].tasks.length/Math.max(1,head)).toFixed(1)+' 班（含休假者）'+(head<bound.minimum*1.5?'；人力偏緊（名冊人數未達最低需求的 1.5 倍），請留意疲勞與休息品質。':'。');notice.appendChild(avgLine);
 const ci=last.m.capInfo&&last.m.capInfo[pool];
 if(ci&&Number.isFinite(ci.cap)){
  const capLine=document.createElement('div');capLine.className='muted';
  const rule=GUARD_FAIRNESS.monthlyCapFixed[pool]!=null?'固定上限':'可排人員平均 '+ci.avg.toFixed(1)+' 班 × '+GUARD_FAIRNESS.monthlyCapRatio;
  capLine.textContent='每人每月上限 '+ci.cap+' 班（'+rule+'）'+(ci.applied?'：已啟用，原本最高 '+ci.before+' 班，調整後最高 '+ci.after+' 班。':'：本月無人超過。')+
   (ci.over.length?'　⚠ 人力不足，仍有 '+ci.over.length+' 人超過上限：'+ci.over.slice(0,8).join('、')+(ci.over.length>8?'…':'')+'。':'');
  notice.appendChild(capLine);
 }
 const foot=document.createElement('div');foot.className='muted';foot.textContent=health;notice.appendChild(foot);
 if(load.doubles){
  const byDate=new Map(),sol=last.solutions[pool];
  for(const task of sol.tasks){
   const person=sol.res.get(task.key);if(!person)continue;
   const key=task.day+'|'+person.key;
   if(!byDate.has(key))byDate.set(key,{day:task.day,person,shifts:[]});
   byDate.get(key).shifts.push(task.num);
  }
  for(const {day,person,shifts} of byDate.values())if(shifts.length>1){
   const row=document.createElement('div');
   row.textContent=dateText(day)+' · '+person.name+'（'+person.id+'） · 第 '+shifts.join('、')+' 班';notice.appendChild(row);
  }
 }
 $('scheduleReference').textContent='本月班表對照碼：'+scheduleReferenceCode()+'（僅供比對版本，不代表核定或防竄改）';
}
function renderQualityPanel(){
 if(!last)return;
 const {m,solutions}=last,missing=solutions.door.missing+solutions.officer.missing;
 let noStatic=0,blocked=0;
 for(const pool of ['door','officer'])for(const t of solutions[pool].tasks){
  if(solutions[pool].res.get(t.key))continue;
  const initial=m.staff[pool].filter(p=>!staticReason(p,t));
  if(!initial.length)noStatic++;else blocked++;
 }
 const allStats=[...solutions.door.stats,...solutions.officer.stats],imbalanced=allStats.filter(x=>Math.abs(x.count-x.target)>=2).length;
 const dload=dailyLoadStats(solutions.door);
 const audit=last.auditIssues?.length||0,stale=loadedSig!==currentInputSig();
 const entries=[
  [noStatic,'無初篩候選的班次'],[blocked,'有候選但尚未排入'],[dload.doubles,'大門同日多班人日'],[dload.triples,'其中同日三班人日'],[imbalanced,'偏離參考目標 2 班以上人數']
 ];
 $('qualityRows').innerHTML=entries.map(([n,title])=>`<div class="quality-box"><b>${n}</b><span>${esc(title)}</span></div>`).join('');
 let hints=[];if(noStatic)hints.push(`${noStatic} 班的名冊人員均被休假、勤務或免哨等靜態條件排除，需先檢查原始資料／人力配置。`);
 if(blocked)hints.push(`${blocked} 班有初步候選，但有限搜尋尚未找到不衝突的排法；不等於證明無解。`);
 if(imbalanced)hints.push(`有 ${imbalanced} 人的有效班數偏離參考目標達 2 班，建議查看個人勤務。`);
 if(dload.doubles)hints.push(`大門同日多班共 ${dload.doubles} 人日（其中三班 ${dload.triples} 人日）；已嘗試合法調整，仍保留的可能受人力、休假或固定班次限制。`);
 if(m.staff.door.some(p=>p.weight!==1)||m.staff.officer.some(p=>p.weight!==1))hints.push('業參名額採整月權重；已登記的實際業參日會優先避開。');
 if(stale)hints.push('⚠ 班表與目前資料不一致，先重新排班再操作。');
 if(audit)hints.push('⚠ 獨立稽核發現 '+audit+' 筆違規。');
 if(!hints.length)hints.push('目前沒有缺班或顯著班數偏差。仍須核對同時段艱苦哨、業參實際日期及單位核定規則。');
 $('qualityHint').textContent=hints.join('\n');
}
let agendaCurrent=null;
function renderPersonalAgenda(){
 if(!last)return;
 const pool=currentPool,el=$('agendaPerson'),old=el.value,staff=last.m.staff[pool];
 const rankList=selectableRanks[pool];
 const query=$('agendaSearch').value.trim().toLowerCase();
 const sorted=staff.filter(p=>[p.id,p.name].some(v=>String(v).toLowerCase().includes(query))).sort((a,b)=>{
  const ai=rankList.indexOf(a.rank),bi=rankList.indexOf(b.rank);
  return (ai<0?99:ai)-(bi<0?99:bi)||a.id.localeCompare(b.id);
 });
 const ids=sorted.map(p=>p.key);
 el.innerHTML=sorted.map(p=>`<option value="${esc(p.key)}">${esc(p.rank)} · ${esc(p.name)}（${esc(p.id)}）</option>`).join('');
 if(ids.includes(old))el.value=old;
 const p=staff.find(p=>p.key===el.value);if(!p){agendaCurrent=null;$('agendaActions').hidden=true;$('agendaSummary').textContent=query?'查無符合的人員':'目前沒有可查看的人員';$('agendaList').innerHTML='';return;}
 const sol=last.solutions[pool],own=personShifts(pool,p);agendaCurrent={pool,p};$('agendaActions').hidden=false;$('agendaConsent').checked=$('shareConsent').checked;$('agendaShareStatus').textContent='';$('agendaShareText').classList.add('hidden');
 const st=sol.stats.find(s=>s.p.key===p.key);
 $('agendaSummary').textContent=`${p.rank} ${p.name} · 本月 ${own.length} 班／${own.reduce((a,t)=>a+t.dur,0)} 小時 · 假期 ${own.filter(t=>t.holiday).length} 班 · 本月建議實站 ${st?.target??0} 班（基本配額 ${st?.goal??0}） · 夜哨 ${st?.night??0} 班 · 午間 ${st?.noon??0} 班 · 督伙折抵 ${p.mealCredit} · 前月減班 ${p.carry}`;
 $('agendaList').innerHTML=own.length?own.map(t=>`<div class="agenda-item"><b>${dateText(t.day)} 星期${weekday(t.day)}</b><span>第 ${t.num} 班 · ${fmt(t)} ${night(t)?'· 夜哨':noon(t)?'· 午間':''}</span></div>`).join(''):'<div class="help">本月沒有排入班次。</div>';
}
function render(){if(!last)return;checkPrecisionDisplay();recalcAudit();refreshReadonlyPanel();refreshMinimalPanel();renderChangeHistory();
 const {m,solutions}=last,door=solutions.door,off=solutions.officer,total=m.tasks.door.length+m.tasks.officer.length,filled=total-door.missing-off.missing,invalid=door.issues.length+off.issues.length+(last.auditIssues?.length||0);
 $('results').classList.remove('hidden');updateScheduleFreshness();refreshArchivePanel();$('metrics').innerHTML=[['大門已排',m.tasks.door.length-door.missing+'/'+m.tasks.door.length],['安官已排',m.tasks.officer.length-off.missing+'/'+m.tasks.officer.length],['總缺班',door.missing+off.missing],['違規檢查',invalid===0?'0 筆':'⚠ '+invalid+' 筆']].map(([a,b])=>`<div class="metric"><span>${a}</span><b>${b}</b></div>`).join('');
 renderWorkloadNotice();
  const msg=[];if(m.warnings.length)msg.push('<div class="message warn"><strong>資料完整性提醒</strong>\n'+esc(m.warnings.map(w=>w.msg).join('\n'))+'</div>');
 if(invalid)msg.push('<div class="message error"><strong>發現違規，請勿使用此結果</strong>\n'+esc([...new Set([...door.issues,...off.issues,...(last.auditIssues||[])])].slice(0,25).join('\n'))+'</div>');
 if(filled===total&&!invalid)msg.push('<div class="message">本月所有班次均已填入，獨立檢查未發現本工具已實作規則的違反。仍不代表已完成所有真實規章驗收。</div>');
 else if(door.missing+off.missing)msg.push('<div class="message warn">尚有 '+(door.missing+off.missing)+' 班未填。缺班沒有被強行塞人；這是本演算法的結果，不代表可以斷定人力一定不足。</div>');
 $('messages').innerHTML=msg.join('');
 renderQualityPanel();renderPersonalAgenda();
 document.querySelectorAll('[data-pool]').forEach(b=>{b.classList.toggle('active',b.dataset.pool===currentPool);b.setAttribute('aria-pressed',String(b.dataset.pool===currentPool));});
 let rows=rowsFor(currentPool);if(missingOnly)rows=rows.filter(row=>row[8]==='缺班');
  const search=$('filterText').value.trim().toLowerCase();
  if(search)rows=rows.filter(row=>String(row[9]).toLowerCase().includes(search));
 $('tableInfo').textContent=`顯示 ${rows.length} 班；值勤日以實際日期計算，22–24 屬當日第 1 班。`;
 $('tableBody').innerHTML=rows.map(row=>`<tr class="${row[8]==='缺班'?'missing':row[8]==='違規'?'bad':''}">${row.map(v=>`<td>${esc(v)}</td>`).join('')}</tr>`).join('');
 const holidayCounts=new Map(),sol=solutions[currentPool];
 for(const t of sol.tasks){const person=sol.res.get(t.key);if(t.holiday&&person)holidayCounts.set(person.key,(holidayCounts.get(person.key)||0)+1);}
 const ptsOf=new Map();for(const t of sol.tasks){const w=sol.res.get(t.key);if(w)ptsOf.set(w.key,(ptsOf.get(w.key)||0)+burdenScaled(currentPool,t)/2);}
 const ledger=burdenLedgerRaw(currentPool);
 $('statBody').innerHTML=sol.stats.map(s=>`<tr>${[s.p.id,s.p.name,s.count,s.hours,s.night,s.noon,holidayCounts.get(s.p.key)||0,s.meal,s.carry+(s.p.carrySource?'（'+s.p.carrySource+'）':''),s.goal.toFixed(0),s.target.toFixed(0),(ptsOf.get(s.p.key)||0).toFixed(1),ledger.has(s.p.id)?((ledger.get(s.p.id)/2>0?'+':'')+(ledger.get(s.p.id)/2).toFixed(1)):'—'].map(v=>`<td>${esc(v)}</td>`).join('')}</tr>`).join('');
 $('missingToggle').textContent='只看缺班：'+(missingOnly?'開':'關');
 renderEasyDayView();
}

// v5.1：輸出與管理工作台完全分離的「單月唯讀快照」，不序列化任何原始紀錄。
let sharePreviewFingerprint='';

// #endregion
