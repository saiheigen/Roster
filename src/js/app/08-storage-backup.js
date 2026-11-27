// #region 月份版本、備份與還原
const autoKey='guard-offline-autosave-v5';
let appStore={format:'guard-offline-v5',global:{},months:{},activeMonth:todayMonth(),updatedAt:'',nextIds:{door:1,officer:1},lifecycle:{},lastManualBackupAt:''};
let activeMonth=todayMonth(),pinnedShifts={},loadedSig='';
let autoSaveReady=false,autoSaveTimer=null,undoState=null,undoTimer=null,unlockArmed=false,unlockTimer=null;
const textSig=obj=>{let s=JSON.stringify(obj),n=2166136261;for(let i=0;i<s.length;i++)n=Math.imul(n^s.charCodeAt(i),16777619);return (n>>>0).toString(16);};
// v6.4.1: the approval is scoped to one month and the exact suspicious date records.
// Unrelated roster edits must not erase it; changed dates must invalidate it.
let yearReviewedSignature='';
function yearReviewFingerprint(model){
 const m=model||build();
 const rows=(m.yearSuspectRows||[]).map(v=>JSON.stringify(v)).sort();
 return textSig({month:activeMonth,suspectRows:rows});
}
function yearIsConfirmed(model){
 const item=appStore.months[activeMonth];
 return !!(item?.yearApproval?.signature&&item.yearApproval.signature===yearReviewFingerprint(model));
}
function syncYearReviewCheckbox(model){
 const confirmed=yearIsConfirmed(model);
 $('yearReviewed').checked=confirmed;
 return confirmed;
}
function yearReviewRequired(m=build()){
 return m.warnings.some(w=>w.code==='DATE_YEAR_SUSPECT')&&!yearIsConfirmed(m);
}
function saveYearReviewApproval(){
 const m=build();
 if($('yearReviewed').checked&&m.warnings.some(w=>w.code==='DATE_YEAR_SUSPECT')){
  const item=appStore.months[activeMonth]||{};
  item.yearApproval={signature:yearReviewFingerprint(m),reviewedAt:new Date().toISOString()};
  appStore.months[activeMonth]=item;
 }else if(appStore.months[activeMonth])delete appStore.months[activeMonth].yearApproval;
 yearReviewedSignature=appStore.months[activeMonth]?.yearApproval?.signature||'';
 saveAutoNow();
 reviewInputs();
}
// 依月份隔離「業參權重」及「手動跨月補償」，禁止錯用到其他月份。
const monthFieldIds=['business','carry','holidayOverrides','ruleSettings'];
const monthInputs=()=>Object.fromEntries(monthFieldIds.filter(id=>!['holidayOverrides','ruleSettings'].includes(id)||$(id).value.trim()).map(id=>[id,$(id).value]));
const globalInputs=()=>{const data=raw();delete data.month;monthFieldIds.forEach(id=>delete data[id]);return data;};
function saveMonthSettings(month=activeMonth){const item=appStore.months[month]||{};item.settings=monthInputs();appStore.months[month]=item;}
function loadMonthSettings(month=activeMonth){const item=appStore.months[month],settings=item?.settings||{};monthFieldIds.forEach(id=>$(id).value=typeof settings[id]==='string'?settings[id]:'');
 // 還沒有班表的新月份沿用上個月的排班規則設定；已有班表的月份維持當時的設定。
 if(typeof settings.ruleSettings!=='string'&&!item?.schedule){const prev=appStore.months[prevMonthKey(month)]?.settings?.ruleSettings;if(typeof prev==='string')$('ruleSettings').value=prev;}
 applyRuleSettings($('ruleSettings').value);if(typeof renderRuleSettings==='function')renderRuleSettings();}
function prevMonthKey(month=activeMonth){const [y,mo]=month.split('-').map(Number);return dateText(dateOf(y,mo,1)-1).slice(0,7);}
function prevDependency(month=activeMonth){const item=appStore.months[prevMonthKey(month)];if(!item)return '無';return textSig({schedule:item.schedule||null,locked:!!item.locked,compensationOut:item.compensationOut||null,pins:item.pins||{},...(item.needsRuleRepair?{needsRuleRepair:true}:{})});}
// 只計算與該月份有關的日期紀錄；1 月新資料不會無故讓已封存的 11 月失效。
function monthRelevantInputs(month){
 const v=globalInputs(),[y,mo]=month.split('-').map(Number),mv={y,m:mo,first:dateOf(y,mo,1),last:dateOf(y,mo+1,0)};
 for(const key of ['leave','training','duty','meal','nightcheck','driver','exempt','history','businessDay']){
  v[key]=String(v[key]||'').split(/\r?\n/).filter(line=>{
   if(!line.trim()||line.trim().startsWith('#'))return false;
   const fields=csvFields(line);if(skipHeader({fields}))return false;
   try{
    const startCol=key==='exempt'?2:1,endCol=key==='exempt'?3:(key==='history'?1:2);
    if(key==='exempt'&&!fields[startCol]&&!fields[endCol])return true; // 永久免哨
    const start=parseDate(fields[startCol],mv),end=parseDate(fields[endCol]||fields[startCol],mv);
    if(start===null||end===null)return true; // 有問題的資料必須保留在雜湊檢查中
    const lo=key==='history'?mv.first-14:mv.first-2,hi=key==='history'?mv.last+14:mv.last+2;
    return start<=hi&&end>=lo;
   }catch(e){return true;}
  }).join('\n');
 }
 if(!v.businessDay)delete v.businessDay;
 return v;
}
function signatureForMonth(month){const settings=month===activeMonth?monthInputs():appStore.months[month]?.settings||{};
 const end=month+'-31';const lifecycle=Object.fromEntries(Object.entries(appStore.lifecycle||{}).filter(([,date])=>date<=end).sort(([a],[b])=>a.localeCompare(b)));
 return textSig({global:monthRelevantInputs(month),settings,previous:prevDependency(month),lifecycle});}
const currentInputSig=()=>signatureForMonth(activeMonth);
function isLocked(month=activeMonth){return !!appStore.months[month]?.locked;}
function allowScheduleChange(){if(!isLocked())return true;setStatus('本月班表已封存。請先在班表頁面解除封存，再修改或重排。','warn');$('repairStatus').textContent='🔒 本月已封存，操作受到保護。';showStep('results');return false;}
function allowFreshEdit(){if(!allowScheduleChange())return false;if(yearReviewRequired()){setStatus('⚠ 疑似年份筆誤尚未確認，請先到資料檢查頁核對。','warn');showStep('review');return false;}if(last&&independentScheduleAudit(last.m,last.solutions,pinnedShifts).length){setStatus('目前班表巡檢未通過，已封鎖人工修改；請先重新排班。','error');return false;}if(last&&loadedSig!==currentInputSig()){setStatus('資料或前月班表已變動，請先重新排班再調整個別班次。','warn');$('repairStatus').textContent='⚠ 班表已過期，需先重新排班，避免人工指定違反新限制。';showStep('results');return false;}return true;}
// 永不回收已發放的自動編號；並掃描舊備份與歷史班表，避免新人沿用舊勤務身分。
function ensureNextIds(){
 const next=appStore.nextIds&&typeof appStore.nextIds==='object'?appStore.nextIds:{};
 for(const pool of ['door','officer']){
  const prefix=pool==='door'?'H':'P';let highest=0;
  function include(id){const match=new RegExp('^'+prefix+'(\\d+)$').exec(String(id||''));if(match)highest=Math.max(highest,Number(match[1]));}
  for(const person of rosterPersons(pool))include(person.id);
  for(const item of Object.values(appStore.months||{})){
   for(const entry of (item?.schedule?.[pool]||[]))include(entry[2]);
   for(const [key,id] of Object.entries(item?.pins||{}))if(key.startsWith(pool+':'))include(id);
  }
  const candidate=Number(next[pool]);next[pool]=Math.max(highest+1,Number.isSafeInteger(candidate)&&candidate>0?candidate:1);
 }
 appStore.nextIds=next;
}
function cacheCurrentSchedule(month=activeMonth){
 if(!last||!last.m||`${last.m.month.y}-${pad(last.m.month.m)}`!==month)return;
 if(appStore.months[month]?.needsRuleRepair&&loadedSig&&loadedSig===currentInputSig()&&!auditCurrentAssignments(build()).length)delete appStore.months[month].needsRuleRepair;
 appStore.months[month]={...(appStore.months[month]||{}),
  schedule:Object.fromEntries(['door','officer'].map(pool=>[pool,last.solutions[pool].tasks.map(t=>[t.day,t.num,last.solutions[pool].res.get(t.key)?.id||null])])),
  pins:{...pinnedShifts},scheduleRules:last.scheduleRules,inputSig:loadedSig,
  proof:{...(appStore.months[month]?.proof||{}),...Object.fromEntries(['door','officer'].map(p=>[p,precisionSnapshots[p]]).filter(([,v])=>v&&v.done&&v.month===month))},
  goals:Object.fromEntries(['door','officer'].map(pool=>[pool,last.solutions[pool].stats.map(s=>[s.p.id,s.goal,s.count,s.meal])])),
  updatedAt:new Date().toISOString()
 };
}
function projectBackup(){saveMonthSettings();cacheCurrentSchedule();ensureNextIds();return {format:'guard-offline-v5',global:globalInputs(),months:appStore.months,activeMonth:$('month').value,nextIds:{...appStore.nextIds},lifecycle:{...(appStore.lifecycle||{})},lastManualBackupAt:appStore.lastManualBackupAt||'',updatedAt:new Date().toISOString()};}
function checkHistoricalRosterRefs(backup){
 const errors=[];
 for(const pool of ['door','officer']){
  const current=new Set(String(backup.global?.[pool]||'').split(/\r?\n/).map(row=>csvFields(row)[0]).filter(Boolean));
  for(const [month,item] of Object.entries(backup.months||{})){
   const saved=new Set((item?.schedule?.[pool]||[]).map(row=>row[2]).filter(Boolean));
   Object.entries(item?.pins||{}).filter(([key])=>key.startsWith(pool+':')).forEach(([key,id])=>{if(id)saved.add(id);});
   for(const id of saved)if(!current.has(id))errors.push(month+' '+names[pool]+' '+id);
  }
 }
 return errors;
}

const snapshotPrefix=autoKey+'-snapshot-';
// The encrypted store holds the same logical autosave and snapshot keys as the plain store.
const vaultId=autoKey+'-encrypted-v1', epochKey=autoKey+'-generation';
const legacyKeys=['guard-offline-autosave-v42','guard-offline-autosave-v4','guard-offline-autosave-v3'];
const ownedKey=k=>k===autoKey||k===autoKey+'-test'||legacyKeys.includes(k)||k.startsWith(snapshotPrefix)||k.startsWith(autoKey+'-corrupt-');
let vault=null,storagePaused=false,lastEnvelope=null,storageEpoch=null,writeNumber=0,flushPromise=Promise.resolve();
function ownStorageKeys(){
 return Array.from({length:localStorage.length},(_,i)=>localStorage.key(i)).filter(k=>k&&ownedKey(k));
}
function storageTarget(){return vault?vault.store:localStorage;}
function checkWriter(){
 if(storagePaused||localStorage.getItem(epochKey)!==storageEpoch||localStorage.getItem(vaultId)!==lastEnvelope)
  throw Error('本機存檔已在另一個視窗變更，請重新開啟工作台');
}
function memoryStore(map){
 return {get length(){return map.size;},key:i=>Array.from(map.keys())[i],
  getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,String(v)),removeItem:k=>map.delete(k)};
}
function b64(bytes){
 let out='';for(let i=0;i<bytes.length;i+=16384)out+=String.fromCharCode(...bytes.subarray(i,i+16384));
 return btoa(out);
}
function unb64(str){return Uint8Array.from(atob(str),c=>c.charCodeAt(0));}
async function passwordKey(password,salt){
 const api=globalThis.crypto?.subtle;if(!api)throw Error('此檢視器未提供本機加密功能');
 const raw=await api.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveKey']);
 return api.deriveKey({name:'PBKDF2',hash:'SHA-256',iterations:600000,salt},raw,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
}
async function sealData(payload,key,salt,format){
 const iv=crypto.getRandomValues(new Uint8Array(12));
 const cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(format)},key,new TextEncoder().encode(JSON.stringify(payload)));
 return JSON.stringify({format,salt:b64(salt),iv:b64(iv),data:b64(new Uint8Array(cipher))});
}
async function openData(env,password,format){
 if(env.format!==format)throw Error('加密格式無效');
 const salt=unb64(env.salt),iv=unb64(env.iv);if(salt.length!==16||iv.length!==12)throw Error('加密資料不完整');
 const key=await passwordKey(password,salt);
 const bytes=await crypto.subtle.decrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(format)},key,unb64(env.data));
 return {key,salt,payload:JSON.parse(new TextDecoder().decode(bytes))};
}
const vaultFormat='guard-vault-v1',backupFormat='guard-backup-encrypted-v1';
let encryptedWritePending=false;
function flushVault(){
 encryptedWritePending=true;
 const number=++writeNumber;
 autoStatus('正在加密儲存…');
 flushPromise=flushPromise.then(async()=>{
  if(number!==writeNumber||storagePaused||!vault)return;
  checkWriter();
  const raw=await sealData(Object.fromEntries(vault.entries),vault.key,vault.salt,vaultFormat);
  if(number!==writeNumber||storagePaused)return;
  checkWriter();localStorage.setItem(vaultId,raw);lastEnvelope=raw;
  encryptedWritePending=false;autoStatus('● 已加密儲存');
 }).catch(e=>autoStatus('加密存檔失敗，請匯出備份。'+e.message,true));
}
function cleanupMigrated(map){
 for(const k of ownStorageKeys()){
  if(map.get(k)!==localStorage.getItem(k))throw Error('偵測到其他版本留下不同的明文資料，請先備份再處理');
  localStorage.removeItem(k);
 }
}
function showVaultMode(){
 $('enableVault').hidden=!!vault;$('newVaultPass').hidden=!!vault;$('confirmVaultPass').hidden=!!vault;
 $('privacyHelp').textContent=vault?'已啟用加密。自動儲存、快照及新匯出的全部備份都使用密碼保護。唯讀分享檔仍可直接閱讀。':'目前使用明文自動儲存。啟用加密會一併轉換這個工作台可讀取的舊存檔與快照。請記住密碼，遺失後無法代為重設。';
}
async function enableEncryption(){
 if(storagePaused||vault||!autoSaveReady)return;
 const pass=$('newVaultPass').value;
 if(pass.length<10||pass!==$('confirmVaultPass').value){$('privacyHelp').textContent='請輸入至少 10 個字元，並再輸入相同密碼。';return;}
 const btn=$('enableVault');btn.disabled=true;
 try{
  if(!saveAutoNow())throw Error('現有進度無法儲存');
  checkWriter();const entries=new Map(ownStorageKeys().map(k=>[k,localStorage.getItem(k)]));
  const salt=crypto.getRandomValues(new Uint8Array(16)),key=await passwordKey(pass,salt);
  const raw=await sealData(Object.fromEntries(entries),key,salt,vaultFormat);
  checkWriter();
  if(ownStorageKeys().length!==entries.size||[...entries].some(([k,v])=>localStorage.getItem(k)!==v))throw Error('轉換期間資料已變動，請再試一次');
  localStorage.setItem(vaultId,raw);lastEnvelope=raw;vault={key,salt,entries,store:memoryStore(entries)};
  cleanupMigrated(entries);showVaultMode();autoStatus('● 已加密儲存');
 }catch(e){$('privacyHelp').textContent='加密轉換未完成：'+e.message;}
 finally{btn.disabled=false;$('newVaultPass').value='';$('confirmVaultPass').value='';}
}
function eraseLocalData(){
 if(!confirm('清除這個瀏覽器中的哨務名冊、所有月份、快照與密碼設定？已匯出的檔案需另行刪除。'))return;
 try{
  storagePaused=true;autoSaveReady=false;writeNumber++;clearTimeout(autoSaveTimer);
  localStorage.setItem(epochKey,String(Date.now())+'-'+Math.random());
  for(const k of [...ownStorageKeys(),vaultId])localStorage.removeItem(k);
  window.location.reload();
 }catch(e){autoStatus('未能完成清除：'+e.message,true);$('unlockHint').textContent='未能完成清除：'+e.message;}
}
function startProtectedStore(){
 window.addEventListener('beforeunload',e=>{
  if(vault&&!storagePaused&&(encryptedWritePending||autoSaveTimer!==null)){e.preventDefault();e.returnValue='';}
 });
 $('enableVault').onclick=enableEncryption;$('eraseLocal').onclick=eraseLocalData;$('eraseLocked').onclick=eraseLocalData;
 try{storageEpoch=localStorage.getItem(epochKey);lastEnvelope=localStorage.getItem(vaultId);}catch(e){initAutoSave();return;}
 if(!lastEnvelope){initAutoSave();return;}
 document.body.classList.add('vault-locked');$('unlockBox').hidden=false;$('unlockPass').focus();
 $('unlockForm').onsubmit=async e=>{
  e.preventDefault();if($('unlockVault').disabled)return;$('unlockVault').disabled=true;
  try{
   const {key,salt,payload}=await openData(JSON.parse(lastEnvelope),$('unlockPass').value,vaultFormat);
   const entries=new Map(Object.entries(payload));
   if(!entries.has(autoKey)||[...entries].some(([k,v])=>!ownedKey(k)||typeof v!=='string'))throw Error('invalid');
   checkWriter();vault={key,salt,entries,store:memoryStore(entries)};
   try{cleanupMigrated(entries);}catch(err){$('privacyHelp').textContent=err.message;throw err;}
   $('unlockPass').value='';$('unlockBox').hidden=true;document.body.classList.remove('vault-locked');showVaultMode();initAutoSave();
  }catch(err){vault=null;$('unlockHint').textContent=err.message.includes('明文')?err.message:'解鎖失敗。請核對密碼與存檔。';}
  finally{$('unlockVault').disabled=false;}
 };
}

function listSnapshots(){
 try{const keys=[];for(let i=0;i<storageTarget().length;i++){const k=storageTarget().key(i);if(k&&k.startsWith(snapshotPrefix))keys.push(k);}return keys.sort().reverse();}catch(_){return [];}
}
function keepSnapshotOf(previous,force=false){
 if(!previous)return false;
 const keys=listSnapshots(),latest=keys[0],lastTime=latest?Number(latest.slice(snapshotPrefix.length)):0;
 if(!force&&lastTime&&Date.now()-lastTime<6*3600000)return false;
 try{JSON.parse(previous);}catch(_){return false;} // corrupted payload is handled by the quarantine feature
 try{
  if(keys.some(k=>storageTarget().getItem(k)===previous))return false;
  const k=snapshotPrefix+Date.now();storageTarget().setItem(k,previous);
  listSnapshots().slice(2).forEach(old=>storageTarget().removeItem(old));return true;
 }catch(_){return false;}
}
function updateBackupUI(){
 const el=$('manualBackupInfo');if(el)el.textContent=appStore.lastManualBackupAt?`上次按下「手動備份」：${new Date(appStore.lastManualBackupAt).toLocaleString('zh-TW')}（仍請確認檔案確實儲存）`:'上次手動備份：尚無紀錄';
 const picker=$('snapshotPicker');if(!picker)return;
 const selected=picker.value,keys=listSnapshots();
 picker.innerHTML=keys.length?keys.map(k=>`<option value="${esc(k)}">${new Date(Number(k.slice(snapshotPrefix.length))).toLocaleString('zh-TW')}</option>`).join(''):'<option value="">目前沒有自動快照</option>';
 if(keys.includes(selected))picker.value=selected;
}
let snapshotRestoreArmed='';
$('restoreSnapshot').onclick=()=>{
 const key=$('snapshotPicker').value;if(!key)return;
 if(!autoSaveReady){$('snapshotNotice').textContent='⛔ 目前自動儲存受到保護，請先透過備份恢復。';return;}
 if(snapshotRestoreArmed!==key){snapshotRestoreArmed=key;$('snapshotNotice').textContent='⚠ 這會替換目前畫面的資料。確認要還原這份快照，請再按一次。';return;}
 snapshotRestoreArmed='';
 try{const data=storageTarget().getItem(key);if(!data)throw Error('找不到此快照');
  keepSnapshotOf(storageTarget().getItem(autoKey),true);
  applyBackup(JSON.parse(data));if(!saveAutoNow())throw Error('已載入畫面，但未能保存；請立即匯出備份');
  $('snapshotNotice').textContent='✅ 已還原指定快照，請檢查月份、名冊、勤務與班表。';showStep('home');
 }catch(e){$('snapshotNotice').textContent='⛔ 快照無法安全還原：'+e.message;}
 updateBackupUI();
};
function autoStatus(message,failed=false){const el=$('autoSaveStatus');el.textContent=message;el.classList.toggle('failed',failed);}
function saveAutoNow(){
 if(!autoSaveReady||storagePaused)return false;
 if(autoSaveTimer!==null){clearTimeout(autoSaveTimer);autoSaveTimer=null;}
 try{checkWriter();const backup=projectBackup();const orphans=checkHistoricalRosterRefs(backup);if(orphans.length)throw Error('名冊移除了歷史排班人員（'+orphans.slice(0,3).join('、')+'）。已停止覆寫自動存檔，請還原該人員編號。');appStore.global=backup.global;appStore.updatedAt=backup.updatedAt;appStore.activeMonth=backup.activeMonth;
  const previous=storageTarget().getItem(autoKey);const next=JSON.stringify(backup);
  if(previous!==next)keepSnapshotOf(previous);
  storageTarget().setItem(autoKey,next);
  if(vault)flushVault();else autoStatus('● 已儲存 · '+new Date().toLocaleTimeString('zh-TW',{hour:'2-digit',minute:'2-digit',hour12:false}));
  updateBackupUI();refreshDashboard();return true;
 }catch(e){autoStatus('⚠ '+(e?.message||'無法自動儲存，請備份全部資料'),true);return false;}
}
function saveAutoSoon(){if(!autoSaveReady)return;if(autoSaveTimer!==null)clearTimeout(autoSaveTimer);autoSaveTimer=setTimeout(saveAutoNow,350);}
function emptySolution(m,pool,saved){
 const pp=m.staff[pool],tasks=m.tasks[pool],options=new Map(),available=new Map(pp.map(p=>[p.key,0]));
 for(const t of tasks){const cs=pp.filter(p=>!staticReason(p,t));options.set(t.key,cs);cs.forEach(p=>available.set(p.key,available.get(p.key)+1));}
 const goals=calcGoals(m,pool,available),targets=calcActualTargets(m,pool,goals,available),res=new Map(),lookup=new Map((saved||[]).map(r=>[`${pool}:${r[0]}:${r[1]}`,r[2]]));
 if(lookup.size!==tasks.length)throw Error('儲存班表班次數與本月不一致');
 for(const t of tasks){if(!lookup.has(t.key))throw Error('缺少已儲存班次：'+t.key);
  const id=lookup.get(t.key),p=id===null?null:pp.find(p=>p.id===id);
  if(id!==null&&!p)throw Error('已排班人員已不在名冊：'+id);res.set(t.key,p);
 }
 return {tasks,res,options,goals,targets,missing:0,issues:[],stats:[]};
}
function restoreMonthResult(strict=false){
 loadMonthSettings();last=null;$('results').classList.add('hidden');$('noResults').classList.remove('hidden');
 const item=appStore.months[activeMonth];pinnedShifts={...(item?.pins||{})};
 if(!item?.schedule){loadedSig='';refreshDashboard();return;}
 try{const m=build();if(m.errors.length)throw Error(m.errors.slice(0,2).join('、'));
  const solutions={door:emptySolution(m,'door',item.schedule.door),officer:emptySolution(m,'officer',item.schedule.officer)};
  recountSolution(solutions.door,'door',m);recountSolution(solutions.officer,'officer',m);
  let scheduleRules=item.scheduleRules;
  if(item.inputSig===currentInputSig()){
   try{verifyOptimization(m,solutions,pinnedShifts);scheduleRules=8;}
   catch(e){
    if(scheduleRules>=8||independentScheduleAudit(m,solutions,pinnedShifts,scheduleRules!==7,true).length){
     if(item.locked)throw e;
     item.needsRuleRepair=true;
     loadedSig='';$('noResults').textContent='草稿未通過目前的規則巡檢。可以預覽修復，或重新排班。'+String(e.message);
     refreshDashboard();refreshMinimalPanel();return;
    }
   }
  }
  last={m,solutions,scheduleRules};
  loadedSig=item.inputSig||'';currentPool='door';missingOnly=false;allMissingMode=false;
  $('filterDate').value=initialViewDate(m.month);render();showIndependentAudit();$('noResults').classList.add('hidden');
  $('reviewHint').textContent=loadedSig!==currentInputSig()?'已載入舊版班表，資料已變更，請重新排班。':'已載入 '+activeMonth+' 班表。';
 }catch(e){if(strict)throw e;last=null;loadedSig='';$('noResults').textContent='本月有已儲存班表，但無法安全載入：'+e.message+'。請先檢查名冊與勤務；備份仍保留。';}
 refreshDashboard();
}
// Import gate: inspect every month's shift grid BEFORE changing current working state.
// Only checks structural integrity and roster references, not every unit-specific duty rule.
function validateBackupMonthShapes(backup){
 if(!backup.months||Array.isArray(backup.months)||typeof backup.months!=='object')throw Error('備份月份資料不是有效物件');
 const available={};
 for(const pool of ['door','officer']){
  available[pool]=new Set(String(backup.global?.[pool]||'').split(/\r?\n/).filter(r=>r.trim()&&!r.trim().startsWith('#')).map(r=>csvFields(r)[0]).filter(x=>x&&!/^(人員編號|編號)$/.test(x)));
 }
 for(const [month,item] of Object.entries(backup.months)){
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)||!item||typeof item!=='object'||Array.isArray(item))throw Error('備份包含無效月份資料：'+month);
  if(!item.schedule)continue;
  const [y,mo]=month.split('-').map(Number),days=new Date(Date.UTC(y,mo,0)).getUTCDate(),first=dateOf(y,mo,1),last=dateOf(y,mo+1,0);
  for(const pool of ['door','officer']){
   const data=item.schedule[pool],expected=days*slots[pool].length;
   if(!Array.isArray(data)||data.length!==expected)throw Error(month+' '+names[pool]+' 儲存班次數不符，已拒絕還原');
   const seen=new Set();
   for(const row of data){
    if(!Array.isArray(row)||row.length!==3)throw Error(month+' '+names[pool]+' 班次格式無效');
    const [day,num,id]=row,k=`${pool}:${day}:${num}`;
    if(!Number.isInteger(day)||day<first||day>last||!Number.isInteger(num)||!slots[pool].some(t=>t.num===num)||seen.has(k))throw Error(month+' 班次日期、時段或唯一性不正確：'+k);
    if(id!==null&&(typeof id!=='string'||!available[pool].has(id)))throw Error(month+' '+names[pool]+' 排班人員編號不存在：'+String(id));
    seen.add(k);
   }
  }
  for(const [k,id] of Object.entries(item.pins||{})){
   const match=/^(door|officer):(-?\d+):(\d+)$/.exec(k);
   if(!match)throw Error(month+' 的人工固定班次格式無效');
   const pool=match[1],day=Number(match[2]),num=Number(match[3]);
   if(day<first||day>last||!slots[pool].some(t=>t.num===num)||!available[pool].has(id))throw Error(month+' 的人工固定班次參照無效：'+k);
  }
 }
 return true;
}
function dateDisplaySafe(str){
 const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(str||'');if(!m)return '';
 const [y,mo,d]=m.slice(1).map(Number);
 return dateText(dateOf(y,mo,d));
}
function applyBackup(o){
 if(!o||typeof o!=='object')throw Error('不是有效的備份內容');
 let v4;
 if(['guard-offline-v5','guard-offline-v4.2','guard-offline-v4'].includes(o.format)){
  if(!o.global||!o.months||!o.activeMonth||typeof o.months!=='object')throw Error('備份欄位不足');
  v4=JSON.parse(JSON.stringify(o));
 }else if(['guard-offline-v1','guard-offline-v2'].includes(o.format)){
  if(!o.data||typeof o.data!=='object')throw Error('舊版備份缺少資料');
  v4={format:'guard-offline-v5',global:{...o.data},months:{},activeMonth:o.data.month||todayMonth(),updatedAt:new Date().toISOString()};
  delete v4.global.month;
  if(o.schedule)v4.months[v4.activeMonth]={schedule:o.schedule,pins:{},inputSig:textSig(v4.global),updatedAt:v4.updatedAt};
 }else throw Error('這不是本工具支援的備份版本');
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(v4.activeMonth))throw Error('備份月份格式不正確');
 // 舊版把業參、補償錯放在所有月份共用：移到「備份當時的工作月份」。
 if(monthFieldIds.some(id=>Object.prototype.hasOwnProperty.call(v4.global,id))){
  const item=v4.months[v4.activeMonth]||{};item.settings=item.settings||{};
  monthFieldIds.forEach(id=>{if(typeof v4.global[id]==='string'&&typeof item.settings[id]!=='string')item.settings[id]=v4.global[id];delete v4.global[id];});
  v4.months[v4.activeMonth]=item;
 }
 v4.format='guard-offline-v5';
 if(v4.lifecycle===undefined)v4.lifecycle={};
 if(!v4.lifecycle||typeof v4.lifecycle!=='object'||Array.isArray(v4.lifecycle))throw Error('離單位資料格式無效');
 for(const [key,date] of Object.entries(v4.lifecycle)){
  if(!/^(door|officer):[^:\s]+$/.test(key)||typeof date!=='string'||!/^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/.test(date)||dateDisplaySafe(date)!==date)throw Error('停用日期或人員編號無效：'+key);
  const pool=key.split(':')[0],id=key.split(':')[1];
  if(!String(v4.global?.[pool]||'').split(/\r?\n/).some(row=>csvFields(row)[0]===id))throw Error('停用紀錄找不到人員：'+key);
 }
 if(v4.lastManualBackupAt===undefined)v4.lastManualBackupAt='';
 if(typeof v4.lastManualBackupAt!=='string')throw Error('備份時間格式無效');
 validateBackupMonthShapes(v4);
 const prevStore=appStore,prevData=raw(),prevLast=last,prevMonth=activeMonth,prevPins=pinnedShifts,prevSig=loadedSig;
 try{appStore=v4;activeMonth=v4.activeMonth;put({...Object.fromEntries(ids.map(id=>[id,''])),...v4.global,month:activeMonth});loadMonthSettings();ensureNextIds();
  last=null;refreshUX();rosterDisplay();renderRecordEditor();restoreMonthResult(true);$('monthTop').value=activeMonth;updateBackupUI();
 }catch(e){appStore=prevStore;activeMonth=prevMonth;put(prevData);last=prevLast;loadedSig=prevSig;pinnedShifts=prevPins;$('monthTop').value=prevMonth;refreshUX();rosterDisplay();renderRecordEditor();if(last){render();$('results').classList.remove('hidden');$('noResults').classList.add('hidden');}throw e;}
}
function closeClearMonthPrompt(message=''){
 $('clearMonthPrompt').classList.add('hidden');
 delete $('clearMonthPrompt').dataset.month;
 $('clearMonthSchedule').setAttribute('aria-expanded','false');
 $('clearMonthNotice').textContent=message;
}
function clearMonthSchedule(confirming=false){
 const month=activeMonth,prompt=$('clearMonthPrompt');
 if(confirming&&prompt.dataset.month!==month){closeClearMonthPrompt();return;}
 if(isLocked()){closeClearMonthPrompt(month+' 已封存。如需清除，請先到每日班表解除封存。');return;}
 if(!last&&!appStore.months[month]?.schedule){closeClearMonthPrompt(month+' 尚未排班。');return;}
 if(scheduleBusy||repairBusy||minimalBusy){
  closeClearMonthPrompt('本月正在排班或最佳化，請等運算結束後再清除。');return;
 }
 if(!autoSaveReady||storagePaused){
  closeClearMonthPrompt('目前無法儲存，班表已保留。'+$('autoSaveStatus').textContent);return;
 }
 if(!confirming){
  prompt.dataset.month=month;
  $('clearMonthQuestion').textContent='清除 '+month+' 的大門與安官班表？名冊、勤務紀錄、人工固定班次與其他月份都會保留。';
  $('clearMonthNotice').textContent='';
  prompt.classList.remove('hidden');$('clearMonthSchedule').setAttribute('aria-expanded','true');
  $('confirmClearMonth').focus();return;
 }
 closeClearMonthPrompt();
 stopOffline('');
 const previous=appStore.months[month],previousResult=last,previousSig=loadedSig;
 const cleared={...previous,pins:{...pinnedShifts},updatedAt:new Date().toISOString()};
 delete cleared.schedule;delete cleared.goals;delete cleared.inputSig;delete cleared.needsRuleRepair;
 appStore.months[month]=cleared;last=null;loadedSig='';
 if(!saveAutoNow()){
  appStore.months[month]=previous;last=previousResult;loadedSig=previousSig;
  refreshDashboard();
  closeClearMonthPrompt('清除未能存檔，'+month+' 班表已保留。'+$('autoSaveStatus').textContent);return;
 }
 if(undoTimer!==null)clearTimeout(undoTimer);
 undoTimer=null;undoState=null;$('undoToast').classList.add('hidden');
 discardMinimal();
 restoreMonthResult();refreshReadonlyPanel();refreshMinimalPanel();
 closeClearMonthPrompt(month+' 的大門與安官班表已清除。');
 $('noResults').textContent=month+' 大門與安官班表已清除。可按「一鍵排班」重新安排。';
}
function changeMonth(next){
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(next)||next===activeMonth){
  $('month').value=activeMonth;$('monthTop').value=activeMonth;return;
 }
 stopOffline('');discardMinimal();
 saveMonthSettings(activeMonth);cacheCurrentSchedule(activeMonth);if(undoTimer!==null)clearTimeout(undoTimer);undoTimer=null;undoState=null;$('undoToast').classList.add('hidden');activeMonth=next;appStore.activeMonth=next;unlockArmed=false;if(unlockTimer!==null)clearTimeout(unlockTimer);unlockTimer=null;
 $('month').value=next;$('monthTop').value=next;
 refreshUX();renderRecordEditor();restoreMonthResult();saveAutoNow();showStep('home');
}
let autosaveQuarantined=false,recoveryBackupValidated=false;
function quarantineBadPayload(payload){
 if(!payload)return false;
 const prefix=autoKey+'-corrupt-';
 const snapshots=[];
 try{for(let i=0;i<storageTarget().length;i++){
  const k=storageTarget().key(i);
  if(k&&k.startsWith(prefix))snapshots.push(k);
 }}catch(_){return false;}
 // 舊版若已累積重複副本，也會收斂成最多兩份不同內容。
 function compactSnapshots(){
  try{
   const keys=[];for(let i=0;i<storageTarget().length;i++){
    const k=storageTarget().key(i);if(k&&k.startsWith(prefix))keys.push(k);
   }
   keys.sort().reverse();const seen=new Set();let kept=0;
   for(const k of keys){const value=storageTarget().getItem(k);
    if(seen.has(value)||kept>=2)storageTarget().removeItem(k);
    else{seen.add(value);kept++;}
   }
  }catch(_){}
 }
 if(snapshots.some(k=>{try{return storageTarget().getItem(k)===payload;}catch(_){return false;}})){
  compactSnapshots();return true;
 }
 snapshots.sort();
 const save=()=>storageTarget().setItem(prefix+Date.now()+'-'+String(textSig(payload)),payload);
 try{save();}
 catch(_){
  // 儲存空間已滿時，只清除本功能最舊的異常副本；原始存檔永不動。
  if(!snapshots.length)return false;
  try{storageTarget().removeItem(snapshots.shift());save();}catch(_){return false;}
 }
 compactSnapshots();
 return true;
}

function initAutoSave(){
 let sourceKey='',sourcePayload='';
 try{
  storageTarget().setItem(autoKey+'-test','1');storageTarget().removeItem(autoKey+'-test');
  const oldKeys=legacyKeys;
  const saved=storageTarget().getItem(autoKey);const oldKey=oldKeys.find(k=>storageTarget().getItem(k));
  if(saved){sourceKey=autoKey;sourcePayload=saved;applyBackup(JSON.parse(saved));autoSaveReady=true;autoStatus('● 已載入儲存進度');showStep('home');}
  else if(oldKey){sourceKey=oldKey;sourcePayload=storageTarget().getItem(oldKey);applyBackup(JSON.parse(sourcePayload));autoSaveReady=true;autoStatus('● 已移轉舊版進度');saveAutoNow();showStep('home');}
  else{autoSaveReady=true;activeMonth=$('month').value;appStore.activeMonth=activeMonth;$('monthTop').value=activeMonth;ensureNextIds();saveAutoNow();showStep('home');}
 }catch(e){
  // 關鍵：任何讀檔失敗都進入保護狀態，包括 pagehide；不覆蓋可救援的原資料。
  autoSaveReady=false;autosaveQuarantined=true;
  const copied=quarantineBadPayload(sourcePayload);
  autoStatus(`⛔ 讀取本機資料失敗，已停止自動覆寫！${copied?'另存了一份異常原始資料。':'原始存檔未被更動。'} 請先使用備份還原。原因：${e?.message||e}`,true);
 }
 ids.forEach(id=>$(id).addEventListener('input',()=>{saveAutoSoon();}));
 $('month').addEventListener('change',e=>{e.stopImmediatePropagation();changeMonth($('month').value);},true);
 $('monthTop').addEventListener('change',()=>changeMonth($('monthTop').value));
 $('recoverAutosave').onclick=()=>{
  if(!autosaveQuarantined||!recoveryBackupValidated)return;
  autoSaveReady=true;
  if(saveAutoNow()){autosaveQuarantined=false;recoveryBackupValidated=false;$('recoverAutosave').classList.add('hidden');autoStatus('✅ 已用確認還原的備份恢復自動儲存。');}
  else{autoSaveReady=false;autoStatus('⛔ 恢復自動儲存失敗，原存檔仍可能受保護；請自行保留備份。',true);}
 };
 window.addEventListener('pagehide',()=>{if(!vault)saveAutoNow();});
 document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'&&vault&&autoSaveTimer!==null)saveAutoNow();});
 updateBackupUI();refreshDashboard();
}
function beforeDelete(){return {data:raw(),schedule:last,step:currentStep,pins:{...pinnedShifts},months:JSON.parse(JSON.stringify(appStore.months)),lifecycle:{...(appStore.lifecycle||{})},inputSig:loadedSig,month:activeMonth};}
function offerUndo(snapshot,description){
 undoState=snapshot;$('undoText').textContent=description;$('undoToast').classList.remove('hidden');
 if(undoTimer!==null)clearTimeout(undoTimer);
 undoTimer=setTimeout(()=>{undoState=null;$('undoToast').classList.add('hidden');},15000);
}
$('undoDelete').onclick=()=>{
 if(!undoState)return;
 const snapshot=undoState;undoState=null;if(undoTimer!==null)clearTimeout(undoTimer);$('undoToast').classList.add('hidden');
 put(snapshot.data);activeMonth=snapshot.month;appStore.activeMonth=activeMonth;$('monthTop').value=activeMonth;last=snapshot.schedule;loadedSig=snapshot.inputSig;pinnedShifts=snapshot.pins;appStore.months=snapshot.months;appStore.lifecycle=snapshot.lifecycle||{};
 editingLine=null;cancelPersonEdit();refreshUX();rosterDisplay();renderRecordEditor();
 if(last){render();$('noResults').classList.add('hidden');}else{$('results').classList.add('hidden');$('noResults').classList.remove('hidden');}
 saveAutoNow();$('personStatus').textContent='✅ 已撤銷刪除，資料恢復。';$('recordStatus').textContent='✅ 已撤銷刪除，資料恢復。';
};
$('save').onclick=async()=>{
 try{const backup=projectBackup(),body=vault?await sealData(backup,vault.key,vault.salt,backupFormat):JSON.stringify(backup,null,2);
 download(vault?'哨務工作台_加密備份.json':'哨務工作台_全部月份備份.json',body,'application/json;charset=utf-8');
 appStore.lastManualBackupAt=new Date().toISOString();saveAutoNow();updateBackupUI();}
 catch(e){autoStatus('備份失敗：'+e.message,true);}
};
$('restoreButton').onclick=()=>$('restore').click();
$('restore').onchange=async e=>{
 const f=e.target.files?.[0];if(!f)return;
 try{let data=JSON.parse(await f.text());
 if(data?.format===backupFormat){
  if(!vault&&!confirm('目前工作台採明文儲存。要將這份加密備份還原為本機明文存檔嗎？取消後可先啟用本機加密。'))return;
  const dlg=$('backupPassDialog');dlg.returnValue='';$('backupPass').value='';
  const pass=await new Promise(resolve=>{dlg.onclose=()=>resolve(dlg.returnValue==='open'?$('backupPass').value:null);dlg.showModal();});
  $('backupPass').value='';if(pass===null)return;
  try{data=(await openData(data,pass,backupFormat)).payload;}catch{throw Error('備份解密失敗，請核對密碼');}
 }
 applyBackup(data);
   if(autosaveQuarantined){
    recoveryBackupValidated=true;$('recoverAutosave').classList.remove('hidden');
    autoStatus('⛔ 備份已還原至畫面，但為保護原存檔仍未覆寫。請按上方「確認用已還原備份恢復自動儲存」。',true);
   }else saveAutoNow();
   showStep(last?'results':'home');setStatus('✅ 已還原備份（包含所有月份）。');}
 catch(err){setStatus('讀取備份失敗：'+err.message,'error');showStep('review');}finally{e.target.value='';}
};
$('missingToggle').onclick=()=>{missingOnly=!missingOnly;render();};document.querySelectorAll('[data-pool]').forEach(b=>b.onclick=()=>{currentPool=b.dataset.pool;$('agendaSearch').value='';$('loadDetails').open=false;$('assignPanel').classList.add('hidden');render();});
function loadDemoData(){
 $('yearReviewed').checked=false;const make=(prefix,num,rank)=>Array.from({length:num},(_,i)=>`${prefix}${pad(i+1).padStart(3,'0')}\t${rank}\t測試${prefix}${pad(i+1)}\t${i%2?'女':'男'}`).join('\n');
 ids.forEach(id=>{if(id!=='month')$(id).value='';});activeMonth='2026-12';appStore.activeMonth=activeMonth;$('month').value=activeMonth;$('monthTop').value=activeMonth;loadMonthSettings();$('door').value=make('H',56,'上兵');$('officer').value=make('P',50,'中士');
 $('leave').value='H001\t2026/12/03\t2026/12/08\nP001\t2026/12/10\t2026/12/14';
 $('training').value='H002\t2026/12/04\t2026/12/11';$('duty').value='P002\t2026/12/01\t2026/12/07';
 $('meal').value='P003\t2026/12/05';$('nightcheck').value='P004\t2026/12/12';$('driver').value='H003\t2026/12/15';
 $('exempt').value='H010\t免夜哨\t2026/12/01\t2026/12/31';$('business').value='H015\t0.333333';$('carry').value='P005\t2';
 last=null;$('results').classList.add('hidden');setStatus('已載入虛構測試資料：大門56人、安官50人，工作月份已切換為 2026 年 12 月，可以進行測試。');
 refreshUX();saveAutoNow();showStep('setup');}


// Guided workflow and inline record editor. All entries are stored in the original
// text fields, so the existing offline scheduling and backup formats still work.
const recordDefs={
 leave:{title:'休假',tip:'填「休假最後一天」，不是收假日；收假隔日才可恢復候選。',hint:'人員 / 假期起日 / 假期最後一天',end:true},
 training:{title:'受訓',tip:'受訓前一天到結訓當日都不可排班。',hint:'人員 / 開始日 / 結束日',end:true},
 duty:{title:'值星',tip:'僅安官人員；開始前一天到結束後一天禁排。',hint:'安官人員 / 開始日 / 結束日',end:true,pool:'officer'},
 meal:{title:'督伙',tip:'僅安官人員；一次督伙折抵一班，並檢查休息限制。',hint:'安官人員 / 日期',pool:'officer'},
 nightcheck:{title:'夜查',tip:'夜查前一天、當天、後一天全天禁排；主副查都要登錄。',hint:'人員 / 夜查日'},
 driver:{title:'車勤',tip:'出車前一天禁夜哨；出車當天全天禁排；次日大門自 08–10 班起、安官自 06–12 班起可排。',hint:'人員 / 出車日'},
 exempt:{title:'勤務資格',tip:'義務役週六、週日全天禁排。日期都留空表示長期適用。',hint:'人員 / 限制類型 / 生效日 / 結束日',type:true,end:true,optional:true},
 kitchen:{title:'固定伙房',tip:'固定伙房人員不參與大門或安官排班。',hint:'人員'},
 businessDay:{title:'業參實際日期',tip:'登記當天的業務。排班會優先避開已登記日；若當天確實全天不能輪值，請另外登記全面免哨。',hint:'人員 / 日期'},
 business:{title:'業參權重',tip:'人員本月排班參考權重，預設 1/3；仍須符合禁排條件。',hint:'人員 / 權重',weight:true},
 carry:{title:'跨月補償',tip:'只輸入上月「多站應減班」整數；不追欠班。',hint:'人員 / 應減班數',carry:true},
 history:{title:'上月已排班次',tip:'填前月末班次供跨月檢查；建議包含前月最後兩天及上一週日留守。',hint:'大門或安官 / 日期 / 時段編號 / 人員',history:true,pool:'history'}
};
let currentCat='leave',editingLine=null,currentStep='setup';
const recordIds=Object.keys(recordDefs);
function countRows(id){return lines(id).filter(x=>!skipHeader(x)).length;}
function rosterPersons(pool){return lines(pool).filter(x=>!skipHeader(x)&&!x.error).map(x=>normalizeRosterFields(x.fields,pool)).filter(p=>p.id&&p.name);}
function lifecycleKey(pool,id){return pool+':'+id;}
function isInactiveAtMonthStart(pool,id){const date=appStore.lifecycle?.[lifecycleKey(pool,id)];return !!date&&date<=activeMonth+'-01';}
function dateDisplay(value){try{const d=parseDate(value,monthVal());return d===null?'':dateText(d);}catch(e){return '';}}

// #endregion
