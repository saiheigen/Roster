// #region 介面事件、人員與日曆
function initUX(){
 for(const el of document.querySelectorAll('[data-step]'))el.onclick=()=>showStep(el.dataset.step);
 for(const el of document.querySelectorAll('[data-next]'))el.onclick=()=>showStep(el.dataset.next);
 $('door').addEventListener('input',()=>{refreshUX();invalidateResult();});$('officer').addEventListener('input',()=>{refreshUX();invalidateResult();});
 $('month').addEventListener('change',()=>{refreshUX();invalidateResult();});
 for(const id of recordIds)$(id).addEventListener('input',()=>{refreshUX();if(id===currentCat)renderRecords();invalidateResult();});
 $('historyPool').addEventListener('change',()=>{$('personFilter').value='';slotPicker();refreshPersonOptions();});$('personFilter').addEventListener('input',refreshPersonOptions);
 $('recordForm').addEventListener('submit',submitRecord);
 $('lookupQuery').addEventListener('input',renderLookupMatches);
 $('personShareCopy').onclick=copyPersonShare;$('personShareSend').onclick=sendPersonShare;$('personShareSend').hidden=!navigator.share;
 $('lookupQuery').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();const b=$('lookupMatches').querySelector('[data-lookup]');if(b&&$('lookupMatches').querySelectorAll('[data-lookup]').length===1)b.click();}});
 $('cancelEdit').onclick=resetRecord;
 $('bulkImportButton').onclick=()=>{$('importFile').dataset.target=currentCat;$('importFile').click();};
 document.querySelectorAll('[data-file-target]').forEach(b=>b.onclick=()=>{$('importFile').dataset.target=b.dataset.fileTarget;$('importFile').click();});
 $('importFile').addEventListener('change',async e=>{const f=e.target.files?.[0];if(!f)return;try{await importCSV(e.target.dataset.target,f);}catch(err){alert('讀檔失敗：'+err.message);}e.target.value='';});
 $('holidayOverrides').addEventListener('input',()=>{invalidateResult();refreshUX();});
 $('ruleSettings').addEventListener('input',()=>{applyRuleSettings($('ruleSettings').value);renderRuleSettings();invalidateResult();refreshUX();});
 $('ruleSettingsReset').onclick=()=>{if(isLocked()||!$('ruleSettings').value)return;if(!confirm('把本月排班規則全部恢復預設？'))return;$('ruleSettings').value='';$('ruleSettings').dispatchEvent(new Event('input',{bubbles:true}));};
 renderRuleSettings();
 $('yearReviewed').addEventListener('change',saveYearReviewApproval);
 $('checkData').onclick=reviewInputs;$('run').onclick=()=>runSchedule();$('reviewClearPins').onclick=()=>{if(!allowScheduleChange())return;pinnedShifts={};if(appStore.months[activeMonth])appStore.months[activeMonth].pins={};saveAutoNow();reviewInputs();setStatus('✅ 已解除本月人工固定。既有班表仍保留，但重新排班時可自由調整。');};
 $('demo').onclick=()=>{if(Object.values(appStore.months).some(v=>v?.schedule)){alert('目前已有保存的月班表。為保護你的資料，不能直接載入示範內容。請先備份，改在全新工作環境試用。');return;}if(ids.some(id=>id!=='month'&&$(id).value.trim())&&!confirm('示範資料會取代目前尚未排班的名冊與勤務紀錄。確定嗎？'))return;pinnedShifts={};loadDemoData();rosterDisplay();$('personStatus').textContent='已載入測試人員，可以試著登記休假、按一鍵排班。';};
 $('filterDate').addEventListener('change',()=>showScheduleDate($('filterDate').value));$('filterText').addEventListener('input',render);
 $('clearFilter').onclick=()=>{$('filterText').value='';missingOnly=false;render();};
 const origRestore=$('restore').onchange;
 $('restore').onchange=async e=>{await origRestore(e);refreshUX();renderRecordEditor();rosterDisplay();};
 refreshUX();renderRecordEditor();showStep('setup');
}

// ---------- 簡單操作層：單人新增、逐日班表、人工指定 ----------
let editingPerson=null,assignKey=null,allMissingMode=false;
function getRosterRows(pool){return $(pool).value.split(/\r?\n/).map((raw,i)=>({i,raw,fields:csvFields(raw)})).filter(x=>x.raw.trim()&&!x.raw.trim().startsWith('#')&&!skipHeader(x)).map(row=>({...row,normalized:normalizeRosterFields(row.fields,pool)}));}
// 單人編輯時只提供該勤務類別的級職；整批匯入的既有級職不會被悄悄更動。
function updateRankChoices(selectedRank=''){
 const pool=$('personPool').value,options=selectableRanks[pool]||[];
 const old=selectedRank||'';
 $('personRank').innerHTML='<option value="">請選擇級職</option>'+options.map(r=>`<option value="${r}">${r}</option>`).join('');
 if(old&&!options.includes(old)&&editingPerson){
  const option=document.createElement('option');option.value=old;option.textContent='原資料：'+old+'（保留／建議更正）';$('personRank').appendChild(option);
 }
 $('personRank').value=old;
 $('personRankHelp').textContent=pool==='officer'?'安全士官：上士／中士／下士':'大門衛哨：上兵／一兵／二兵';
}
function sortRosterRows(rows,pool){
 const ranks=selectableRanks[pool];
 return rows.slice().sort((a,b)=>{
  const ra=a.normalized.rank,rb=b.normalized.rank;
  const ai=ranks.indexOf(ra),bi=ranks.indexOf(rb);
  return (ai<0?ranks.length:ai)-(bi<0?ranks.length:bi)||a.i-b.i;
 });
}
function rosterDisplay(){
 try{window.updatePwaHint?.();}catch(_){}
 for(const pool of ['door','officer']){
  const query=($('rosterSearch')?.value||'').trim().toLowerCase();
  const rows=sortRosterRows(getRosterRows(pool).filter(r=>!query||r.fields.some(f=>String(f).toLowerCase().includes(query))),pool),list=$(pool+'List');
  if(query)$(pool+'RosterGroup').open=rows.length>0;
  let lastRank=null,html='';
  for(const r of rows){
   const {id,rank,name}=r.normalized,group=selectableRanks[pool].includes(rank)?rank:'其他／未分類';
   if(group!==lastRank){const count=rows.filter(z=>(selectableRanks[pool].includes(z.normalized.rank)?z.normalized.rank:'其他／未分類')===group).length;
    html+=`<div class="person-rank-heading">${esc(group)}<span>${count} 人</span></div>`;lastRank=group;
   }
   const inactive=appStore.lifecycle?.[lifecycleKey(pool,id)];
   html+=`<div class="personrow"><div><span class="who">${esc(name||'(未填姓名)')}</span>${inactive?`<span class="leave-tag">${esc(inactive)} 起停用</span>`:''}<span class="sub">${esc(rank||'未填級職')} · ${esc(id)}</span></div><div class="person-actions"><button type="button" data-editperson="${pool}:${r.i}">修改</button><button type="button" data-statusperson="${pool}:${r.i}">${inactive?'恢復':'離單位'}</button><button type="button" data-delperson="${pool}:${r.i}" class="danger">刪除</button></div></div>`;
  }
  list.innerHTML=rows.length?html:'<div class="empty-state">'+(query?'查無符合的人員。':'尚無人員。')+'</div>';
  list.querySelectorAll('[data-editperson]').forEach(b=>b.onclick=()=>{
   const [p,i]=b.dataset.editperson.split(':');const f=csvFields($(p).value.split(/\r?\n/)[Number(i)]);
   editingPerson={pool:p,index:Number(i),id:f[0]};$('personPool').value=p;$('personPool').disabled=true;
   const person=normalizeRosterFields(f,p);$('personName').value=person.name;updateRankChoices(person.rank);$('personSex').value=person.sex;
   $('personSave').textContent='儲存人員修改';$('personCancel').style.display='';$('personStatus').textContent='正在修改 '+f[0];showStep('setup');$('personName').focus();
  });
  list.querySelectorAll('[data-statusperson]').forEach(b=>b.onclick=()=>openLifecycleEditor(b.dataset.statusperson));
  list.querySelectorAll('[data-delperson]').forEach(b=>b.onclick=()=>{
   const [p,i]=b.dataset.delperson.split(':');const f=csvFields($(p).value.split(/\r?\n/)[Number(i)]);
   const person=normalizeRosterFields(f,p),name=person.name,personId=person.id;
   if([...rosterPersons('door'),...rosterPersons('officer')].filter(person=>person.id===personId).length>1){$('personStatus').textContent='⚠ 名冊有重複人員編號 '+personId+'；為避免誤刪他人勤務，請先到進階名冊修正編號。';return;}
   const referenced=Object.entries(appStore.months).filter(([month,item])=>(item?.schedule?.[p]||[]).some(e=>e[2]===personId)||Object.values(item?.pins||{}).includes(personId)).map(([m])=>m);
   if(referenced.length){$('personStatus').textContent=`⚠ ${name} 已有歷史班表（${referenced.slice(0,4).join('、')}）。不能刪除身分；請點「離單位」設定生效日。`;return;}
   if([...rosterPersons('door'),...rosterPersons('officer')].filter(person=>person.name===name).length>1){$('personStatus').textContent='⚠ 有重複姓名，無法安全清理姓名形式的勤務紀錄；請先修正資料。';return;}
   const snapshot=beforeDelete();let removed=0;
   // 連帶移除本人勤務紀錄，避免留下找不到名冊人員的失效資料。
   for(const id of recordIds){const rawLines=$(id).value.split(/\r?\n/),targetCol=id==='history'?3:0;
    const kept=rawLines.filter(line=>{const fields=csvFields(line),key=fields[targetCol];
     if(key===personId||key===name){removed++;return false;}return true;});
    if(kept.length!==rawLines.length)$(id).value=kept.join('\n');
   }
   let a=$(p).value.split(/\r?\n/);a.splice(Number(i),1);$(p).value=a.join('\n');
   if(appStore.lifecycle)delete appStore.lifecycle[lifecycleKey(p,personId)];
   cancelPersonEdit();invalidateResult();refreshUX();rosterDisplay();saveAutoNow();
   offerUndo(snapshot,`已刪除 ${name}${removed?'（連同 '+removed+' 筆勤務紀錄）':''}`);
   $('personStatus').textContent='✅ 已刪除 '+name+'；15 秒內可按下方撤銷。';
  });
 }
}
let lifecycleEditing=null;
function openLifecycleEditor(ref){
 const [pool,index]=ref.split(':'),f=csvFields($(pool).value.split(/\r?\n/)[Number(index)]);
 const p=normalizeRosterFields(f,pool);if(!p.id)return;
 const key=lifecycleKey(pool,p.id),current=appStore.lifecycle?.[key]||'';
 if(current){
  // Reactivating is a visible user action, but never bypasses a sealed month.
  if(Object.entries(appStore.months).some(([month,item])=>item.locked&&month+'-31'>=current)){
   $('personStatus').textContent='🔒 有封存月份涉及此人的停用日期。請先解除相關月份封存，才能恢復輪值。';return;
  }
  delete appStore.lifecycle[key];invalidateResult();refreshUX();rosterDisplay();renderRecordEditor();saveAutoNow();
  $('personStatus').textContent=`✅ ${p.name} 已恢復輪值資格；已排月份請重新核對。`;
  return;
 }
 lifecycleEditing={pool,id:p.id,name:p.name};
 $('lifecyclePersonName').textContent=`${p.rank||''} ${p.name}（${p.id}）｜設定離單位`;
 const now=new Date();$('lifecycleDate').value=[now.getFullYear(),pad(now.getMonth()+1),pad(now.getDate())].join('-');
 $('lifecycleNotice').textContent='停用生效日以前的班次與歷史資料都保留。';
 $('lifecyclePanel').classList.remove('hidden');$('lifecyclePanel').scrollIntoView({block:'nearest',behavior:'smooth'});
}
function saveLifecycle(){
 if(!lifecycleEditing)return;
 const iso=$('lifecycleDate').value;
 if(!/^\d{4}-\d{2}-\d{2}$/.test(iso)||dateDisplaySafe(iso)!==iso){$('lifecycleNotice').textContent='請選擇有效的生效日期';return;}
 const {pool,id,name}=lifecycleEditing,key=lifecycleKey(pool,id);
 const locked=Object.entries(appStore.months).filter(([month,item])=>item.locked&&month+'-31'>=iso).map(([month])=>month);
 if(locked.length){$('lifecycleNotice').textContent='⛔ 封存月份受影響：'+locked.join('、')+'。請先解封與核對，不能直接改動已封存月份的輪值資格。';return;}
 appStore.lifecycle=appStore.lifecycle||{};appStore.lifecycle[key]=iso;
 const impacted=Object.entries(appStore.months).filter(([month,item])=>(item?.schedule?.[pool]||[]).some(row=>row[2]===id&&dateText(row[0])>=iso)).map(([month])=>month);
 lifecycleEditing=null;$('lifecyclePanel').classList.add('hidden');
 invalidateResult();refreshUX();rosterDisplay();renderRecordEditor();saveAutoNow();
 $('personStatus').textContent=`✅ ${name} 自 ${iso} 起不參與排班。${impacted.length?'⚠ '+impacted.join('、')+' 的既有班表含停用後班次，必須重新排班驗證。':'歷史班表保留。'}`;
}
$('lifecycleSave').onclick=saveLifecycle;
$('lifecycleCancel').onclick=()=>{lifecycleEditing=null;$('lifecyclePanel').classList.add('hidden');};
function cancelPersonEdit(){editingPerson=null;$('personForm').reset();$('personPool').disabled=false;updateRankChoices();$('personSave').textContent='＋ 加入名冊';$('personCancel').style.display='none';}
function migrateLegacyNameRecords(name,id){
 let changed=0;
 for(const rid of recordIds){
  const col=rid==='history'?3:0;
  const updated=$(rid).value.split(/\r?\n/).map(row=>{
   if(!row.trim()||row.trim().startsWith('#'))return row;
   const f=csvFields(row);if(f[col]!==name)return row;
   f[col]=id;changed++;return f.join('\t');
  });
  $(rid).value=updated.join('\n');
 }
 return changed;
}
function submitPerson(ev){ev.preventDefault();const name=$('personName').value.trim(),pool=$('personPool').value,rank=$('personRank').value.trim(),sex=$('personSex').value;
 if(!name){$('personStatus').textContent='請輸入姓名';return;}
 if(!rank){$('personStatus').textContent='請先選擇級職';return;}
 if(!selectableRanks[pool].includes(rank)&&!(editingPerson&&rank===csvFields($(editingPerson.pool).value.split(/\r?\n/)[editingPerson.index])[1])){$('personStatus').textContent='請選擇符合勤務種類的級職';return;}
 if(/[\t\r\n,，;]/.test(name)||/[\t\r\n,，;]/.test(rank)){$('personStatus').textContent='姓名或級職不能含逗號、分號或換行';return;}
 const others=[...rosterPersons('door'),...rosterPersons('officer')];
let id;
 if(editingPerson){
  id=editingPerson.id;let arr=$(editingPerson.pool).value.split(/\r?\n/);
  const oldFields=csvFields(arr[editingPerson.index]),oldName=normalizeRosterFields(oldFields,editingPerson.pool).name;
   if(oldName!==name){
    const dup=others.filter(p=>p.name===oldName);
    if(dup.length>1){$('personStatus').textContent='⚠ 原姓名不唯一。請先把姓名形式的勤務紀錄改成人員編號，再修改姓名。';return;}
    migrateLegacyNameRecords(oldName,id);
   }
  arr[editingPerson.index]=[id,rank,name,sex].join('\t');$(editingPerson.pool).value=arr.join('\n');
 }
  else{
   const same=others.filter(p=>p.name===name);
   if(same.length){
    // 名字重複可共存，但舊資料如果用姓名指人，必須先安全轉成唯一編號。
    const linked=recordIds.some(rid=>$(rid).value.split(/\r?\n/).some(row=>{if(!row.trim()||row.trim().startsWith('#'))return false;const f=csvFields(row);return f[rid==='history'?3:0]===name;}));
    if(linked&&same.length!==1){$('personStatus').textContent='⚠ 舊勤務紀錄使用了重複姓名，請先改成編號再新增同名人員。';return;}
    if(linked)migrateLegacyNameRecords(name,same[0].id);
   }
   ensureNextIds();const prefix=pool==='door'?'H':'P',occupied=new Set(others.map(p=>p.id));let n=appStore.nextIds[pool];while(occupied.has(prefix+String(n).padStart(3,'0')))n++;id=prefix+String(n).padStart(3,'0');appStore.nextIds[pool]=n+1;$(pool).value+=($(pool).value.trim()?'\n':'')+[id,rank,name,sex].join('\t');
  }
 const wasEditing=!!editingPerson,action=wasEditing?'已更新':'已新增';cancelPersonEdit();if(!wasEditing){$('personPool').value=pool;updateRankChoices(rank);$('personName').focus();}refreshUX();rosterDisplay();invalidateResult();saveAutoNow();$('personStatus').textContent=`✅ ${action} ${name}（${id}）`;
}
function initialViewDate(month){
 const now=new Date(),local=[now.getFullYear(),String(now.getMonth()+1).padStart(2,'0'),String(now.getDate()).padStart(2,'0')].join('-');
 return local>=dateText(month.first)&&local<=dateText(month.last)?local:dateText(month.first);
}
function showScheduleDate(value,showMissing=false){
 if(!last)return;
 assignKey=null;$('assignPanel').classList.add('hidden');
 $('filterDate').value=value;allMissingMode=showMissing;
 renderEasyDayView();
}
function localToday(){const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');}
function moveScheduleDate(offset){
 if(!last)return;
 const month=last.m.month,current=parseDate($('filterDate').value,month)??month.first;
 showScheduleDate(dateText(Math.max(month.first,Math.min(month.last,current+offset))));
}
function renderEasyDayView(){
 if(!last)return;
 const mo=last.m.month,sol=last.solutions[currentPool];
 $('uxJumpMissing').textContent=allMissingMode?'返回每日班表':'本月缺 '+sol.missing+' 班';
 $('uxJumpMissing').setAttribute('aria-pressed',String(allMissingMode));
 const proof=precisionSnapshots[currentPool];
 const verified=proof&&proof.month===activeMonth&&proof.inputs===currentInputSig()&&proof.pins===textSig(pinnedShifts)&&proof.signature===precisionPoolSignature(last.solutions,currentPool)?proof.proven||0:0;
 const extra=currentPool==='door'?dailyLoadStats(sol).extra:0,notes=[];
 if(sol.missing)notes.push(verified>=1?'已證明在目前規則與固定班次下最少缺 '+sol.missing+' 班。':'目前缺 '+sol.missing+' 班，本次尚未證明最少缺班數。');
 if(extra)notes.push('同日額外 '+extra+' 班，'+(verified>=2?'已證明在相同填班數下最少。':'本次尚未證明最少額外班數。'));
 $('coverageNote').textContent=notes.join(' ');$('coverageNote').hidden=!notes.length;
 try{renderQualitySummary();}catch(_){}
 let chosen=$('filterDate').value||dateText(mo.first);if(chosen<dateText(mo.first)||chosen>dateText(mo.last))chosen=dateText(mo.first);
 $('filterDate').min=dateText(mo.first);$('filterDate').max=dateText(mo.last);
 const selectedDay=parseDate(chosen,mo);
 const items=sol.tasks.filter(t=>allMissingMode?!sol.res.get(t.key):t.day===selectedDay)
  .sort((a,b)=>a.day-b.day||a.num-b.num);
 
 $('filterDate').value=chosen;
 const d=allMissingMode?'本月所有缺班':`${chosen}（星期${weekday(selectedDay)}）`;
 $('dayTitle').textContent=d+' · '+items.length+' 班';

 $('prevDay').disabled=allMissingMode||chosen<=dateText(mo.first);$('nextDay').disabled=allMissingMode||chosen>=dateText(mo.last);
 {const today=localToday();$('todayDay').hidden=allMissingMode||today<dateText(mo.first)||today>dateText(mo.last)||today===chosen;}
 $('daySchedule').innerHTML=items.length?items.map(t=>{
   const p=sol.res.get(t.key),{check,note}=sol.verified.get(t.key);
   return `<div class="shift-card ${check==='缺班'?'miss':check==='違規'?'bad':''} ${Object.prototype.hasOwnProperty.call(pinnedShifts,t.key)?'pinned':''} ${t.start>=22||t.start<6?'is-night':'is-day'}"><div class="shift-time">${allMissingMode?'<span class="shift-date">'+esc(dateText(t.day).slice(5))+'</span>':''}<b>${esc(shiftClock(t))}</b><small>第 ${t.num} 班・${t.dur} 小時</small></div><div class="shift-name">${p?esc(p.name):'⚠ 尚未排人'}<small>${p?esc(p.rank||'已安排'):(note?esc(note):'無可用人選或尚未找到可行排法')}</small></div><button type="button" data-assign="${esc(t.key)}" ${isLocked()?'disabled title="本月已封存，請先解除封存"':''}>${p?'調整':'補人'}</button>${check==='缺班'?missingWhy(currentPool,t):''}</div>`;
 }).join(''):`<div class="day-empty">${allMissingMode?'這個月沒有缺班。':'這天沒有可顯示的班次。'}</div>`;
 $('daySchedule').querySelectorAll('[data-assign]').forEach(b=>b.onclick=()=>openAssign(b.dataset.assign));renderMonthCalendar();
}
function renderMonthCalendar(){
 if(!last)return;
 const m=last.m.month,chosen=$('filterDate').value,rows={},sol=last.solutions[currentPool];
 for(const t of sol.tasks){
  const day=dateText(t.day);if(!rows[day])rows[day]={missing:0,invalid:0,holiday:t.holiday};
  const v=sol.verified.get(t.key);
  if(v?.check==='缺班')rows[day].missing++;
  if(v?.check==='違規')rows[day].invalid++;
 }
 const day0=new Date(m.first*86400000).getUTCDay();
 let html='日一二三四五六'.split('').map(c=>`<div class="calendar-week">${c}</div>`).join('');
 for(let x=0;x<day0;x++)html+='<div class="calendar-spacer"></div>';
 for(let d=1;d<=m.days;d++){
  const date=dateText(m.first+d-1),v=rows[date]||{missing:0,invalid:0};
  const holiday=rows[date]?.holiday;
  const cls=v.invalid?'cal-bad':v.missing?'cal-warn':'cal-good';
  html+=`<button type="button" data-cal-date="${date}" class="calendar-day ${cls} ${chosen===date?'selected':''}" aria-label="${date}${holiday?' 假期':''}，缺班 ${v.missing} 班"><b>${d}${holiday?'假':''}</b><small>${v.invalid?v.invalid+' 違規':v.missing?v.missing+' 缺':'✓'}</small></button>`;
 }
 $('monthCalendar').innerHTML=html;
 $('monthCalendar').querySelectorAll('[data-cal-date]').forEach(b=>b.onclick=()=>{
  showScheduleDate(b.dataset.calDate);
 });
}
function occupiedExcept(sol,p,target){return [...p.history,...sol.tasks.filter(t=>t.key!==target.key&&sol.res.get(t.key)?.key===p.key)];}
function openAssign(key){if(!allowFreshEdit())return;if(!last)return;const pool=key.split(':')[0],sol=last.solutions[pool],t=sol.tasks.find(x=>x.key===key);if(!t)return;
 currentPool=pool;assignKey=key;$('assignOperator').value='';
 const prev=sol.res.get(key);const allowed=last.m.staff[pool].filter(p=>!staticReason(p,t)&&!conflict(p,t,new Map([[p.key,occupiedExcept(sol,p,t)]])));
 $('assignTitle').textContent=`${dateText(t.day)} ${names[pool]} 第${t.num}班（${fmt(t)}）；目前：${prev?.name||'缺班'}`;
 $('assignPicker').innerHTML=allowed.length?allowed.map(p=>`<option value="${esc(p.key)}">${esc(p.name)} · ${esc(p.rank||'未填級職')} · ${esc(p.id)}</option>`).join(''):'<option value="">沒有符合現有規則的候選人</option>';
 if(prev&&allowed.some(p=>p.key===prev.key))$('assignPicker').value=prev.key;
 $('assignInfo').textContent=`找到 ${allowed.length} 名通過現有規則初步檢查的人員。確認後，此班將鎖定；下一次自動排班會保留它。`;
 $('assignUnlock').classList.toggle('hidden',!Object.prototype.hasOwnProperty.call(pinnedShifts,key));
 $('assignSave').disabled=!allowed.length;$('assignPanel').classList.remove('hidden');$('assignPanel').scrollIntoView({behavior:'smooth',block:'nearest'});
}
function recountSolution(sol,pool,model=last.m){
 const pp=model.staff[pool],tasks=sol.tasks;let occ=new Map(),done=new Map(),hrs=new Map(),hn=new Map(),hm=new Map(),verified=new Map(),issues=[];
 for(const p of pp){occ.set(p.key,[...p.history]);done.set(p.key,0);hrs.set(p.key,0);hn.set(p.key,0);hm.set(p.key,0);}
 for(const t of tasks){const p=sol.res.get(t.key);if(!p)continue;occ.get(p.key).push(t);done.set(p.key,done.get(p.key)+1);hrs.set(p.key,hrs.get(p.key)+t.dur);if(night(t))hn.set(p.key,hn.get(p.key)+1);if(noon(t))hm.set(p.key,hm.get(p.key)+1);}
 let missing=0;for(const t of tasks){const p=sol.res.get(t.key);if(!p){missing++;const init=pp.filter(p=>!staticReason(p,t)).length,now=pp.filter(p=>!staticReason(p,t)&&!conflict(p,t,new Map([[p.key,occ.get(p.key)] ]))).length;verified.set(t.key,{check:'缺班',note:init===0?'初篩合格 0 人（休假／勤務資格等限制）':`初篩合格 ${init} 人；其他班次排入後可接班 ${now} 人（仍可能透過重新調整解決）`});continue;}
  const reason=staticReason(p,t)||conflict(p,t,new Map([[p.key,occupiedExcept(sol,p,t)]]));const check=reason?'違規':'通過';verified.set(t.key,{check,note:reason||''});if(reason)issues.push(`${dateText(t.day)} ${names[pool]} ${t.num} 班 ${p.name}：${reason}`);
 }
 Object.assign(sol,{occupied:occ,done,hrs,harshN:hn,harshM:hm,verified,issues,missing,stats:pp.map(p=>({p,count:done.get(p.key),hours:hrs.get(p.key),night:hn.get(p.key),noon:hm.get(p.key),meal:p.mealCredit,carry:p.carry,goal:sol.goals.get(p.key)||0,target:sol.targets.get(p.key)||0}))});
}
function applyAssign(){if(!$('assignOperator').value.trim()){$('assignInfo').textContent='請填寫本次操作者，再確認異動。';$('assignOperator').focus();return;}if(!allowFreshEdit())return;if(!assignKey||!last)return;const pool=assignKey.split(':')[0],sol=last.solutions[pool],t=sol.tasks.find(x=>x.key===assignKey),key=$('assignPicker').value,p=last.m.staff[pool].find(p=>p.key===key);if(!p||!t)return;
 if(staticReason(p,t)||conflict(p,t,new Map([[p.key,occupiedExcept(sol,p,t)]]))){$('assignInfo').textContent='這個人剛好不符合勤務限制，無法指定。';return;}
 const old=sol.res.get(t.key),hadPin=Object.prototype.hasOwnProperty.call(pinnedShifts,t.key),oldPin=pinnedShifts[t.key];
 const previousRef=scheduleReferenceCode();
 sol.res.set(t.key,p);pinnedShifts[t.key]=p.id;recountSolution(sol,pool);
 try{verifyOptimization(last.m,last.solutions,pinnedShifts);}
 catch(e){sol.res.set(t.key,old);if(hadPin)pinnedShifts[t.key]=oldPin;else delete pinnedShifts[t.key];recountSolution(sol,pool);$('assignInfo').textContent='⚠ 已保留原班表：'+e.message;return;}
 const changes=[{pool,day:t.day,num:t.num,before:old?.id||null,after:p.id}];
 appendChangeLog('人工指定固定',changes,{by:$('assignOperator').value.trim(),reason:$('assignReason').value.trim(),beforeRef:previousRef,afterRef:scheduleReferenceCode()});
 $('assignReason').value='';$('assignPanel').classList.add('hidden');assignKey=null;render();showIndependentAudit();
 saveAutoNow();$('reviewHint').textContent='✅ 已指定並固定，變更已加入本機紀錄。';
}
function quickSchedule(){
 if(scheduleBusy){setStatus('排班正在運算，請勿重複點擊。','warn');return;}
 if(!allowScheduleChange())return;
 $('quickMessage').classList.remove('active');
 if(!rosterPersons('door').length||!rosterPersons('officer').length){$('quickMessage').textContent='請先建立大門與安官兩份名冊（也可在「人員名冊」載入範例名冊試用）。';$('quickMessage').classList.add('active');showStep('setup');return;}
 const m=reviewInputs();if(!m||m.errors.length||m.warnings.some(w=>w.code==='DATE_YEAR_SUSPECT')&&!yearIsConfirmed()){$('quickMessage').textContent='資料有需要修正的地方，已帶你到問題清單。';$('quickMessage').classList.add('active');showStep('review');return;}
 return runSchedule(m);
}

// #endregion
