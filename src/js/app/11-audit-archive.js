// #region 獨立巡檢、封存與補班
function showIndependentAudit(){
 const box=$('integrityStatus');if(!last){
  $('auditIssueCount').classList.add('hidden');
  box.className='message';box.textContent='尚未排班，無法進行結果巡檢。';return {issues:[]};
 }
 let issues=[];
 try{
  const current=build();
  if(loadedSig!==currentInputSig())issues.push('目前資料與排班版本不一致（需重新排班）');
  issues.push(...auditCurrentAssignments(current));

 }catch(e){issues.push('巡檢程式執行失敗：'+String(e?.message||e));}
 issues=[...new Set(issues)];
 const count=$('auditIssueCount');
 count.classList.toggle('hidden',issues.length===0);
 count.textContent=issues.length?`⚠ ${issues.length} 項待處理`:'';
 if(issues.length)$('uxDiagnostics').open=true;
 box.className='message '+(issues.length?'alert':'safe');
 box.textContent=issues.length?`⚠ 發現 ${issues.length} 項需要處理：\n`+issues.slice(0,12).map(s=>'• '+s).join('\n')+(issues.length>12?'\n…其餘請另外檢查':''):
 '✅ 獨立巡檢未發現已實作規則、班數統計或固定班次的不一致。\n⚠ 請核對實際業參紀錄、跨月補償與單位規則。';
 return {issues};
}

function recalcAudit(){if(last?.solutions?.door&&last?.solutions?.officer)last.auditIssues=independentScheduleAudit(last.m,last.solutions,pinnedShifts);}
function verifyOptimization(m,solutions,pins,priorMissing=null){
 const issues=independentScheduleAudit(m,solutions,pins);
 if(priorMissing)for(const pool of ['door','officer']){
  const n=solutions[pool].missing;
  if(n>priorMissing[pool])issues.push(names[pool]+'候選缺 '+n+' 班，原表缺 '+priorMissing[pool]+' 班');
 }
 if(issues.length)throw Error('排班結果交叉檢查未通過：'+issues.slice(0,3).join('；'));
 return true;
}

function refreshArchivePanel(){
 const panel=$('archivePanel'),btn=$('archiveToggle'),locked=isLocked(),month=activeMonth;
 panel.classList.toggle('locked',locked);
 const item=appStore.months[month]||{};
 $('archiveTitle').textContent=locked?'🔒 '+month+' 已封存（防止誤改）':'🗂 '+month+' 尚未封存';
 $('archiveDescription').textContent=locked?'本月禁止重新排班、智慧補班及人工調班。若要修正，須先解除封存。封存不等於單位核定。':'確認班表完整且符合已實作規則後，可封存以防誤操作。封存不等於單位核定。';
 btn.textContent=locked?(unlockArmed?'再次點擊確認解除封存':'解除封存（需二次確認）'):'🔒 封存本月班表';
 $('archiveCarry').textContent=locked&&item.compensationOut?('次月待減班數：'+Object.values(item.compensationOut).reduce((s,o)=>s+Object.values(o||{}).reduce((a,b)=>a+Number(b||0),0),0)+' 班（依已實作的整數參考目標估算）'):'提醒：封存會保護排班操作，但修改共用人員／勤務資料仍可能造成歷史班表過期。';
 $('resultsRun').disabled=locked;$('smartRepair').disabled=locked;
 $('resultsRun').title=locked?'請先解除本月封存':'';$('smartRepair').title=locked?'請先解除本月封存':'';
}
function toggleArchive(){
 if(!last){setStatus('請先完成排班，才能封存本月。','warn');return;}
 const item=appStore.months[activeMonth]||{};
 if(item.locked){
  if(!unlockArmed){unlockArmed=true;refreshArchivePanel();if(unlockTimer!==null)clearTimeout(unlockTimer);unlockTimer=setTimeout(()=>{unlockArmed=false;refreshArchivePanel();},8000);return;}
  unlockArmed=false;if(unlockTimer!==null)clearTimeout(unlockTimer);unlockTimer=null;
  item.locked=false;delete item.lockedAt;delete item.compensationOut;delete item.burden;appStore.months[activeMonth]=item;
  saveAutoNow();render();setStatus('已解除本月封存；後續修改會讓依賴本月的下月班表需要重新驗證。');return;
 }
 if(yearReviewRequired()){setStatus('⚠ 疑似年份筆誤尚未核對，禁止封存；請先到資料檢查頁確認。','error');showStep('review');return;}
 recalcAudit();
 const auditNew=showIndependentAudit();if(auditNew.issues.length){setStatus('獨立巡檢未通過，無法封存；請看「獨立班表巡檢」詳情。','error');return;}
 if(loadedSig!==currentInputSig()){setStatus('班表資料已異動或前月已變動，請重新排班後再封存。','error');return;}
 const missed=last.solutions.door.missing+last.solutions.officer.missing;
 const issues=last.solutions.door.issues.length+last.solutions.officer.issues.length+(last.auditIssues||[]).length;
 if(missed||issues){setStatus(`目前仍有 ${missed} 個缺班、${issues} 項違規提示，無法封存。`,'error');return;}
 const output={door:{},officer:{}};
 for(const pool of ['door','officer'])for(const st of last.solutions[pool].stats){
  const amount=Math.max(0,Math.trunc(st.count+st.meal+st.carry-st.goal));
  if(amount>0)output[pool][st.p.id]=amount;
 }
 saveMonthSettings();cacheCurrentSchedule();const saved=appStore.months[activeMonth];
 saved.locked=true;saved.lockedAt=new Date().toISOString();saved.compensationOut=output;saved.inputSig=loadedSig;
 if(burdenOn())saved.burden=burdenDeltas(last.solutions);else delete saved.burden;
 saveAutoNow();render();setStatus('已封存 '+activeMonth+'。本月已鎖定，次月可參照待減班數；仍須人工核對。');
}
function updateScheduleFreshness(){
 const banner=$('scheduleFreshness');if(!last){banner.classList.add('hidden');return;}
 const stale=loadedSig&&loadedSig!==currentInputSig();
 const invalid=last.solutions.door.issues.length+last.solutions.officer.issues.length+(last.auditIssues?.length||0);
 banner.classList.toggle('hidden',!stale&&!invalid);banner.classList.toggle('error',!!invalid);
 banner.textContent=invalid?`⚠ 這份班表有 ${invalid} 筆規則違反，請勿使用。修正資料或固定班次後重新排班。`:
 stale?'⚠ 本月資料或前月班表已變動；這份舊班表需解除封存（若已封存）並重新驗證。':'';
}
function refreshDashboard(){
 try{renderQualitySummary();}catch(_){}
 if(!$('overviewMonth'))return;
 const month=$('month').value||activeMonth;
 if($('clearMonthPrompt').dataset.month && $('clearMonthPrompt').dataset.month!==month)closeClearMonthPrompt();
 $('monthTop').value=month;
 const [y,mo]=month.split('-').map(Number),nDays=new Date(Date.UTC(y,mo,0)).getUTCDate();
 $('overviewMonth').textContent=`${y} 年 ${mo} 月`;
 $('overviewDoorCount').textContent=rosterPersons('door').length;
 $('overviewOfficerCount').textContent=rosterPersons('officer').length;
 $('overviewEventsCount').textContent=recordIds.reduce((a,id)=>a+countRows(id),0);
 const item=appStore.months[month];let total=nDays*19,missing=null;
 if(last&&`${last.m.month.y}-${pad(last.m.month.m)}`===month)missing=last.solutions.door.missing+last.solutions.officer.missing;
 else if(item?.schedule)missing=['door','officer'].reduce((a,p)=>a+(item.schedule[p]||[]).filter(r=>!r[2]).length,0);
 const percent=missing===null?0:Math.max(0,Math.round(100*(total-missing)/total));
 $('overviewRate').textContent=missing===null?'尚未排班':`${percent}%`;
 $('overviewBar').style.width=percent+'%';$('overviewMissing').textContent=missing===null?'—':String(missing);
 $('overviewCountNote').textContent=(missing===null?`本月共 ${total} 班，尚未產生班表。`:`已安排 ${total-missing} / ${total} 班`)+((missing!==null&&(!appStore.lastManualBackupAt||Date.now()-appStore.lastManualBackupAt>7*864e5))?'　⚠ 近 7 天沒有手動備份，請到下方「備份與還原」匯出備份。':'');
 const state=$('overviewBadge');state.className='state-tag'+(missing===0?' ok':missing===null?'':' warn');
 state.textContent=missing===null?'尚未排班':isLocked(month)?'已封存（需人工審核）':missing===0?'已排滿（待審核）':`仍缺 ${missing} 班`;
 if(item?.needsRuleRepair){state.className='state-tag warn';state.textContent='草稿未通過巡檢';}
 const messages=[];
 if(item?.needsRuleRepair)messages.push(['⚠','本月草稿需先修復。請到「本月班表」預覽修復。']);
 if(!rosterPersons('door').length||!rosterPersons('officer').length)messages.push(['⚠','請先建立大門與安官兩份名冊。']);
 else messages.push(['✓',`名冊已建檔：大門 ${rosterPersons('door').length} 人、安官 ${rosterPersons('officer').length} 人。`]);
 if(item?.schedule&&item.inputSig!==currentInputSig())messages.push(['⚠','這個月的既有班表與目前資料版本不同，必須重新檢查。']);
 if(!item?.schedule)messages.push(['◌','這個月尚未建立可檢視的班表。']);
 if(item?.schedule)messages.push(['✓',`本月班表已儲存，含 ${Object.keys(item.pins||{}).length} 筆人工固定班次。${item.locked?'目前已封存，修改班表前需先解除封存。':''}`]);
 if(!appStore.months[dateText(dateOf(y,mo,1)-1).slice(0,7)]?.schedule)messages.push(['i','未發現上月班表；月初跨月限制需人工提供歷史資料。']);
 $('overviewAlerts').innerHTML=messages.map(([icon,msg])=>`<div class="health-item"><i>${esc(icon)}</i><span>${esc(msg)}</span></div>`).join('');
 const keys=Object.keys(appStore.months).filter(k=>appStore.months[k]?.schedule).sort().reverse();
 $('recentMonthList').innerHTML=keys.length?keys.map(k=>`<button type="button" data-open-month="${esc(k)}" class="${k===month?'selected':''}">${esc(k)}</button>`).join(''):'<span class="help">尚未儲存任何月班表</span>';
 $('recentMonthList').querySelectorAll('[data-open-month]').forEach(b=>b.onclick=()=>changeMonth(b.dataset.openMonth));
}
function repairCurrent(){
 if(repairBusy){$('repairStatus').textContent='補班搜尋正在執行，請勿重複啟動。';return;}
 if(!allowFreshEdit())return;
 if(!last){showStep('home');return;}
 if(loadedSig&&loadedSig!==currentInputSig()){$('repairStatus').textContent='⚠ 資料已異動，請先重新排班。';return;}
 const generation=++repairGeneration,reference=last,startingMonth=activeMonth,startingSig=currentInputSig(),startingPins=textSig(pinnedShifts);
 repairBusy=true;$('repairStatus').textContent='正在搜尋合法補班、公平與作息最佳化…';
 $('smartRepair').disabled=true;
 setTimeout(()=>{
  if(generation!==repairGeneration||reference!==last||startingMonth!==activeMonth||startingSig!==currentInputSig()||startingPins!==textSig(pinnedShifts)){
    repairBusy=false;$('smartRepair').disabled=false;$('repairStatus').textContent='⚠ 資料／月份已變動，已取消舊補班任務。';return;
  }
  const snapshots={door:new Map(last.solutions.door.res),officer:new Map(last.solutions.officer.res)};
  const previousMissing={door:last.solutions.door.tasks.filter(t=>!last.solutions.door.res.get(t.key)).length,officer:last.solutions.officer.tasks.filter(t=>!last.solutions.officer.res.get(t.key)).length};
  try{
   const d=smartRepairPool(last.m,'door',last.solutions.door,pinnedShifts,4800);
   const o=smartRepairPool(last.m,'officer',last.solutions.officer,pinnedShifts,4800);
   const exactD=exactNeighborhoodRepairPool(last.m,'door',last.solutions.door,pinnedShifts);
   const exactO=exactNeighborhoodRepairPool(last.m,'officer',last.solutions.officer,pinnedShifts);
   const f1=improveFairnessPool(last.m,'door',last.solutions.door,pinnedShifts,2);
   const f2=improveFairnessPool(last.m,'officer',last.solutions.officer,pinnedShifts,2);
   const day=optimizeDailyPool(last.m,'door',last.solutions.door,pinnedShifts);
   recountSolution(last.solutions.door,'door');recountSolution(last.solutions.officer,'officer');
   verifyOptimization(last.m,last.solutions,pinnedShifts,previousMissing);
   const beforeRows=Object.fromEntries(['door','officer'].map(pool=>[pool,last.solutions[pool].tasks.map(t=>[t.day,t.num,snapshots[pool].get(t.key)?.id||null])]));
   const changes=shiftDiff(beforeRows,scheduleRows(last.solutions));
   render();showIndependentAudit();
   if(changes.length)appendChangeLog('智慧補班／作息調整',changes,{reason:'從現有合法班表補班與優化'});
   saveAutoNow();renderChangeHistory();
   $('repairStatus').textContent=`補上 ${d.filled+o.filled+exactD.filled+exactO.filled} 班（局部回溯 ${exactD.filled+exactO.filled}）；公平改善 ${f1.changed+f2.changed} 班；作息改派 ${day.moved} 班、換班 ${day.swapped} 組；大門同日多班 ${day.before.doubles} → ${day.after.doubles} 人日。仍缺 ${last.solutions.door.missing+last.solutions.officer.missing} 班；有限搜尋不保證全域最優。`;
  }catch(e){
   for(const pool of ['door','officer']){last.solutions[pool].res=new Map(snapshots[pool]);recountSolution(last.solutions[pool],pool);}
   render();$('repairStatus').textContent='調整已回滾，原班表保留：'+e.message;
  }finally{repairBusy=false;$('smartRepair').disabled=false;}
 },25);
}
function unlockAssignment(){if(!$('assignOperator').value.trim()){$('assignInfo').textContent='請填寫本次操作者，再確認異動。';$('assignOperator').focus();return;}
 if(!allowFreshEdit())return;
 if(!last||!assignKey)return;
 const previouslyPinned=assignKey;
 const [pool,day,num]=assignKey.split(':');const who=pinnedShifts[assignKey];
 delete pinnedShifts[assignKey];appendChangeLog('解除人工固定',[{pool,day:Number(day),num:Number(num),before:who,after:who}],{by:$('assignOperator').value.trim(),reason:previouslyPinned+' 已解除固定，班次人員未變'});
 $('assignPanel').classList.add('hidden');assignKey=null;render();saveAutoNow();
 $('repairStatus').textContent='已解除該班固定，下次排班允許重新調整。';
}
function clearAssignment(){if(!$('assignOperator').value.trim()){$('assignInfo').textContent='請填寫本次操作者，再確認異動。';$('assignOperator').focus();return;}
 if(!allowFreshEdit())return;
 if(!last||!assignKey)return;
 const pool=assignKey.split(':')[0],sol=last.solutions[pool];
 const prior=sol.res.get(assignKey),oldPin=pinnedShifts[assignKey],wasPinned=Object.prototype.hasOwnProperty.call(pinnedShifts,assignKey);
 sol.res.set(assignKey,null);delete pinnedShifts[assignKey];recountSolution(sol,pool);
 try{verifyOptimization(last.m,last.solutions,pinnedShifts);}catch(e){sol.res.set(assignKey,prior);if(wasPinned)pinnedShifts[assignKey]=oldPin;recountSolution(sol,pool);$('repairStatus').textContent='⚠ 清空失敗，原班表已保留：'+e.message;return;}
 appendChangeLog('人工清空班次',[{pool,day:sol.tasks.find(t=>t.key===assignKey)?.day,num:sol.tasks.find(t=>t.key===assignKey)?.num,before:prior?.id||null,after:null}],{by:$('assignOperator').value.trim(),reason:$('assignReason').value.trim()});
 $('assignReason').value='';$('assignPanel').classList.add('hidden');assignKey=null;render();showIndependentAudit();saveAutoNow();
 $('repairStatus').textContent='已清空此班，並留下本機操作紀錄。';
}


// #endregion
