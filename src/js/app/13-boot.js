// #region 結果導覽與啟動
function initResultNavigation(){
 function chooseView(person){
  $('personAgenda').hidden=!person;$('dailyView').hidden=person;
  $('viewPerson').setAttribute('aria-pressed',String(person));$('viewDay').setAttribute('aria-pressed',String(!person));
  if(person)$('agendaSearch').focus();
 }
 $('viewDay').onclick=()=>chooseView(false);
 $('viewPerson').onclick=()=>chooseView(true);
 $('uxJumpMissing').onclick=()=>showScheduleDate($('filterDate').value,!allMissingMode);
 $('agendaSearch').addEventListener('input',renderPersonalAgenda);
 // 依人員檢視：可直接複製／分享此人班表，或跳到「人員查詢」修改他的休假與勤務紀錄
 {const say=m=>$('agendaShareStatus').textContent=m;
  const text=()=>personShareHeader().replace('個人班表','班表')+'\n'+personShiftText(agendaCurrent.pool,agendaCurrent.p,'block',true)+'\n'+personShareFooter;
  const ready=()=>{if(!agendaCurrent)return false;const reason=readonlyEligibility();if(reason){say('⚠ '+reason);return false;}if(!$('agendaConsent').checked){say('⚠ 請先勾選上方的分享確認。');return false;}return true;};
  $('agendaConsent').onchange=e=>{$('shareConsent').checked=e.target.checked;$('shareConsent').dispatchEvent(new Event('change',{bubbles:true}));};
  $('agendaCopy').onclick=()=>{if(ready())copyPlainText(text(),$('agendaShareText'),say);};
  $('agendaSend').hidden=!navigator.share;
  $('agendaLink').onclick=()=>{if(!ready())return;if(!personShifts(agendaCurrent.pool,agendaCurrent.p).length){say('ℹ 此人本月沒有班。');return;}
   const p=agendaCurrent.p;copyPlainText((p.name||p.id)+' '+last.m.month.m+' 月班表（點開可加入手機行事曆）：'+personalLinkFor(agendaCurrent.pool,p),$('agendaShareText'),say);};
  $('agendaSend').onclick=async()=>{if(!ready())return;try{await navigator.share({title:(agendaCurrent.p.name||agendaCurrent.p.id)+' 班表',text:text()});say('✅ 已開啟分享。');}catch(e){if(e&&e.name!=='AbortError')say('ℹ 這個 App 不支援系統分享，請改用「複製此人班表」。');}};
  $('agendaRecords').onclick=()=>{if(!agendaCurrent)return;lookupId=agendaCurrent.p.id;showStep('records');renderLookup();setTimeout(()=>$('personLookup').scrollIntoView({block:'start',behavior:'smooth'}),80);};
 }

}
function initEasyUX(){
 initResultNavigation();
 $('recordCategory').onchange=()=>{currentCat=$('recordCategory').value;resetRecord();};


 $('personForm').addEventListener('submit',submitPerson);$('personPool').addEventListener('change',()=>updateRankChoices());updateRankChoices();$('personCancel').onclick=cancelPersonEdit;$('rosterSearch').addEventListener('input',rosterDisplay);
 $('clearMonthSchedule').onclick=()=>clearMonthSchedule(false);
 $('confirmClearMonth').onclick=()=>{clearMonthSchedule(true);$('clearMonthSchedule').focus();};
 $('cancelClearMonth').onclick=()=>{closeClearMonthPrompt('已取消，班表已保留。');$('clearMonthSchedule').focus();};
  $('recordsRun').onclick=quickSchedule;$('resultsRun').onclick=quickSchedule;
 $('minimalStart').onclick=minimalPreview;$('minimalAccept').onclick=applyMinimal;$('minimalDismiss').onclick=()=>discardMinimal('已保留原班表，未套用候選方案。');$('minimalGoReview').onclick=()=>showStep('review');
 $('prevDay').onclick=()=>moveScheduleDate(-1);$('nextDay').onclick=()=>moveScheduleDate(1);
 $('todayDay').onclick=()=>{const v=localToday();if(last&&v>=dateText(last.m.month.first)&&v<=dateText(last.m.month.last))showScheduleDate(v);};
 // 手機：在班表卡片上左右滑動換日
 {let x0=null,y0=null;const area=$('daySchedule');
  area.addEventListener('touchstart',e=>{if(e.touches.length===1){x0=e.touches[0].clientX;y0=e.touches[0].clientY;}else x0=null;},{passive:true});
  area.addEventListener('touchend',e=>{if(x0===null)return;const t=e.changedTouches[0],dx=t.clientX-x0,dy=t.clientY-y0;x0=null;
   if(Math.abs(dx)>70&&Math.abs(dx)>2*Math.abs(dy)){const b=$(dx<0?'nextDay':'prevDay');if(b&&!b.disabled)b.click();}},{passive:true});}
 $('assignSave').onclick=applyAssign;$('assignUnlock').onclick=unlockAssignment;$('assignClear').onclick=clearAssignment;
 $('assignCancel').onclick=()=>{$('assignPanel').classList.add('hidden');assignKey=null;};
 $('smartRepair').onclick=repairCurrent;$('archiveToggle').onclick=toggleArchive;

 $('roInlineDoor').onclick=()=>{inlinePool='door';renderReadonlyInline();};
$('roInlineOfficer').onclick=()=>{inlinePool='officer';renderReadonlyInline();};
$('roInlineSearch').oninput=renderReadonlyInline;
$('roInlineDate').onchange=()=>{const d=inlineReadonlyDate($('roInlineDate').value);if(d&&d>=$('roInlineDate').min&&d<=$('roInlineDate').max){inlineDay=d;renderReadonlyInline();}};
$('roInlinePrev').onclick=()=>moveReadonlyInlineDay(-1);$('roInlineNext').onclick=()=>moveReadonlyInlineDay(1);
$('sharePreview').onclick=previewReadonly;$('shareFile').onclick=shareOrDownload;$('shareText').onclick=copyReadonlyText;$('shareCopyClose').onclick=()=>{$('shareCopyBox').classList.add('hidden');};$('shareClose').onclick=closeReadonlyPreview;
 $('agendaPerson').addEventListener('change',renderPersonalAgenda);
 $('ruleSelfTest').onclick=runRuleSelfTests;$('integrityRun').onclick=showIndependentAudit;
 $('precisionAll').onclick=async()=>{
  precisionStopAll=false;
  if(offlineJobs.size||progressOwner||scheduleBusy){$('offlineReport').textContent='請先完成目前的排班作業。';return;}
  if(!last||!allowFreshEdit()||loadedSig!==currentInputSig()){$('offlineReport').textContent='請先建立有效的本月班表。';return;}
  const view=openProgress(activeMonth+' 精算（大門＋安官同時進行）','停止並查看班表',()=>{precisionStopAll=true;stopOffline('已停止精算，已保留通過巡檢的班表。');});
  const frac={door:0,officer:0},text={};
  const group={view,paint:(pool,f,t)=>{frac[pool]=f;text[pool]=t;paintProgress(view,100*(frac.door+frac.officer)/2,(text.door||'大門準備中')+'｜'+(text.officer||'安官準備中'));}};
  try{await Promise.all(['door','officer'].map(pool=>runPrecision(pool,null,group)));}
  finally{
   closeProgress(view);if(last)renderEasyDayView();
   const msg=['door','officer'].map(p=>precisionPart(p,'Panel').dataset.status).filter(Boolean).join('　');
   if(msg)$('offlineReport').textContent=msg;
  }
 };
 $('offlineStop').onclick=()=>{precisionStopAll=true;stopOffline();};
 $('overviewRun').onclick=quickSchedule;
 $('overviewCheck').onclick=()=>showStep('review');
 $('overviewSchedule').onclick=()=>showStep('results');
 ['door','officer'].forEach(id=>$(id).addEventListener('input',rosterDisplay));
 $('restore').addEventListener('change',()=>setTimeout(()=>{rosterDisplay();refreshUX();},120));
 document.querySelectorAll('[data-step]').forEach(b=>b.addEventListener('click',()=>{$('quickMessage').classList.remove('active');}));
 rosterDisplay();
}

$('month').value=todayMonth();$('monthTop').value=todayMonth();
initUX();
initEasyUX();
startProtectedStore();
// 給「有新版本」提示用：運算或加密儲存進行中時先不要切換版本；切換前先把自動存檔寫入。
window.rosterUpdateBlocker=()=>scheduleBusy||repairBusy||minimalBusy||offlineJobs.size||!$('runProgress').hidden?'正在排班或精算':
 vault&&(encryptedWritePending||autoSaveTimer!==null)?'正在儲存資料':'';
window.rosterFlushSave=()=>{if(!vault&&autoSaveTimer!==null)saveAutoNow();};
// #endregion
