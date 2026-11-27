// #region 唯讀分享與匯出
function readonlyPayload(){
 const result={format:'guard-readonly-snapshot-v1',month:activeMonth,createdAt:new Date().toISOString(),status:isLocked()?'archived':'draft',reference:scheduleReferenceCode(),ambiguous:{door:[],officer:[]}};
 for(const pool of ['door','officer'])result[pool]=last.solutions[pool].tasks.slice().sort((a,b)=>a.day-b.day||a.num-b.num).map(t=>{
  const p=last.solutions[pool].res.get(t.key);
  return {d:dateText(t.day),n:t.num,t:fmt(t),rank:p?.rank||'',nm:p?.name||'',h:t.dur,night:!!night(t),noon:!!noon(t)};
 });
  for(const pool of ['door','officer']){
   const counts=new Map();for(const p of last.m.staff[pool])counts.set(p.name,(counts.get(p.name)||0)+1);
   result.ambiguous[pool]=[...counts].filter(([,n])=>n>1).map(([name])=>name);
  }
  return result;
}
function auditCurrentAssignments(model){
 if(model.errors.length)return model.errors;
 const solutions={};
 for(const pool of ['door','officer']){
  const old=last.solutions[pool],current=new Map(model.staff[pool].map(p=>[p.id,p]));
  const res=new Map();
  for(const [key,person] of old.res)res.set(key,person?(current.get(person.id)||person):null);
  solutions[pool]={...old,res};
 }
 return independentScheduleAudit(model,solutions,pinnedShifts);
}
function readonlyEligibility(){
 if(!last||!last.solutions)return '本月尚未建立班表，請先排班。';
 const model=build();
 if(yearReviewRequired(model))return '疑似年份筆誤尚未核對。請先到資料檢查頁確認，再匯出班表。';
 if(activeMonth!==`${last.m.month.y}-${pad(last.m.month.m)}`)return '當前月份與班表不符，請重新載入。';
 if(!loadedSig||loadedSig!==currentInputSig())return '班表所依據的人員／勤務／前月資料已變動，請重新排班後再分享。';
 const issues=auditCurrentAssignments(model);
 if(issues.length)return '班表未通過目前資料的巡檢：'+issues.slice(0,3).join('、');
 const count=last.solutions.door.issues.length+last.solutions.officer.issues.length;
 if(count)return `發現 ${count} 筆規則違反，請修正後再匯出。`;
 return '';
}
function readonlyFingerprint(){
 if(!last)return '';
 const state={month:activeMonth,sig:loadedSig,locked:isLocked()};
 for(const pool of ['door','officer'])state[pool]=last.solutions[pool].tasks.map(t=>last.solutions[pool].res.get(t.key)?.id||'');
 return textSig(state);
}
// 內嵌預覽直接使用 DOM 文字節點；不需要 iframe、外部連結或 srcdoc。
let inlineSnap=null,inlinePool='door',inlineDay='';
function inlineReadonlyDate(d){return /^\d{4}-\d{2}-\d{2}$/.test(d)?d:'';}
function inlineReadonlyAdd(el,tag,cls,value){const n=document.createElement(tag);if(cls)n.className=cls;if(value!==undefined)n.textContent=String(value);el.appendChild(n);return n;}
function renderReadonlyInline(){
 if(!inlineSnap)return;
 const p=inlineSnap,term=$('roInlineSearch').value.trim().toLocaleLowerCase();
 const rows=p[inlinePool].filter(r=>term?String(r.nm||'').toLocaleLowerCase().includes(term):r.d===inlineDay);
 $('roInlineDoor').classList.toggle('active',inlinePool==='door');$('roInlineOfficer').classList.toggle('active',inlinePool==='officer');
 $('roInlineTitle').textContent=term?'整月搜尋':inlineDay;
 $('roInlineDate').disabled=!!term;
 $('roInlinePrev').disabled=!!term||inlineDay<=$('roInlineDate').min;
 $('roInlineNext').disabled=!!term||inlineDay>=$('roInlineDate').max;
 $('roInlineInfo').textContent=(inlinePool==='door'?'大門衛哨':'安全士官')+'｜'+(term?'全月找到 '+rows.length+' 班':`已排 ${rows.filter(r=>!!r.nm).length} / ${rows.length} 班`);
 const host=$('roInlineEntries');host.replaceChildren();
 if(!rows.length){inlineReadonlyAdd(host,'div','ro-inline-empty',term?'查無符合姓名的班次。':'當日沒有班次。');return;}
 for(const r of rows){
  const card=inlineReadonlyAdd(host,'div','ro-inline-entry'+(r.nm?'':' missing'));
  const time=inlineReadonlyAdd(card,'div','ro-inline-time',r.t);inlineReadonlyAdd(time,'small','',term?r.d+' · 第 '+r.n+' 班':'第 '+r.n+' 班');
  const person=inlineReadonlyAdd(card,'div','ro-inline-person',r.nm||'尚未排人');inlineReadonlyAdd(person,'small','',r.rank||'待補人員');
  inlineReadonlyAdd(card,'span','ro-inline-state',r.nm?'已排':'缺班');
 }
}
function moveReadonlyInlineDay(delta){if(!inlineSnap)return;const d=new Date(inlineDay+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+delta);const v=d.toISOString().slice(0,10);if(v<$('roInlineDate').min||v>$('roInlineDate').max)return;inlineDay=v;$('roInlineDate').value=v;renderReadonlyInline();}
function closeReadonlyPreview(){
 sharePreviewFingerprint='';inlineSnap=null;$('sharePreviewBox').classList.add('hidden');$('roInlineEntries').replaceChildren();
}

function refreshReadonlyPanel(){
 const el=$('sharePanel');if(!el)return;
 const error=readonlyEligibility(),locked=isLocked();
 $('shareBadge').textContent=locked?'已封存 · 非核定':'草稿 · 未封存';
 $('shareBadge').className='share-pill'+(locked?'':' draft');
 const gaps=last?(last.solutions.door.missing+last.solutions.officer.missing):0;
 $('shareGuard').textContent=error?'⚠ '+error:
 locked?'🔒 本月已封存。產生的是當前封存班表的快照；仍不代表正式核定。':
 '⚠ 目前為草稿'+(gaps?`（尚缺 ${gaps} 班）`:'')+'；下載檔案會明顯標記草稿，不應當成正式班表。';
 $('sharePreview').disabled=!!error;
 $('shareFile').disabled=!!error; $('shareText').disabled=!!error;
 if(sharePreviewFingerprint&&(error||sharePreviewFingerprint!==readonlyFingerprint()))closeReadonlyPreview();
 if(!$('shareCopyBox').classList.contains('hidden'))$('shareCopyBox').classList.add('hidden');
}
function buildReadonlyHtml(payload){
 // 防止姓名等來源字串結束 JSON script 元素或注入 HTML。
 const packed=JSON.stringify(payload).replace(/[<>&\u2028\u2029]/g,c=>({'<':'\\u003c','>':'\\u003e','&':'\\u0026','\u2028':'\\u2028','\u2029':'\\u2029'}[c]));
 const template=`${'<'}!doctype html>
${'<'}html lang="zh-Hant">${'<'}head>${'<'}meta charset="utf-8">${'<'}meta name="viewport" content="width=device-width,initial-scale=1">${'<'}meta name="color-scheme" content="light">${'<'}meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; connect-src 'none'; form-action 'none'">${'<'}title>唯讀勤務班表${'<'}/title>
${'<'}style>
:root{color-scheme:light;font-family:system-ui,-apple-system,"Microsoft JhengHei",sans-serif;color:#20384a;background:#f3f7f8;font-size:15px}*{box-sizing:border-box}body{margin:0}button,input,select{font:inherit}button{cursor:pointer;border:1px solid #d4e1e4;border-radius:10px;background:white;padding:10px 12px;color:#285c68;font-weight:700}button.active{background:#166d72;color:white;border-color:#166d72}button:focus-visible,input:focus-visible{outline:3px solid #59bfb7;outline-offset:2px}
header{background:#183b50;color:white;padding:25px max(14px,calc((100% - 920px)/2));}h1{font-size:clamp(1.35rem,3vw,1.9rem);margin:6px 0 10px}header p{color:#d9e5ec;font-size:13px;line-height:1.8;margin:0}.status{display:inline-block;border-radius:100px;padding:6px 11px;font-size:12px;font-weight:750;background:#bfe6dd;color:#18584b}.status.draft{background:#ffe2a6;color:#78511a}.container{max-width:948px;padding:18px 14px 35px;margin:auto}.notice{border:1px solid #e7d4ae;color:#775c27;background:#fff9eb;border-radius:12px;padding:12px 15px;font-size:12px;line-height:1.7;margin-bottom:15px}.card{border:1px solid #dce8ea;background:white;border-radius:15px;padding:16px 17px;box-shadow:0 4px 12px #1436430b;margin-bottom:14px}.controls{display:flex;flex-wrap:wrap;gap:10px;align-items:end}.controls>div{flex:1 1 170px}.controls label{font-weight:700;font-size:12px;display:block;margin-bottom:6px;color:#476371}.controls input{min-height:43px;border:1px solid #cbdde0;border-radius:10px;width:100%;padding:9px 11px}.tabs{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px}.tabs button{flex:1 1 150px}.move{display:flex;gap:8px;align-items:center;justify-content:space-between;margin:14px 0}.move strong{font-size:17px;color:#173e50}.move button{min-height:44px}.summary{font-size:12px;color:#647b88;margin:12px 0}.entries{display:grid;gap:8px}.shift{display:grid;grid-template-columns:110px minmax(0,1fr) auto;gap:10px;align-items:center;border:1px solid #e1ebed;border-radius:12px;padding:11px 13px}.shift .time{font-weight:800;color:#184d60}.shift .time small,.shift .name small{display:block;color:#768895;font-size:11px;margin-top:4px;font-weight:500}.shift .name{font-size:14px;font-weight:750;min-width:0;overflow-wrap:anywhere}.shift.empty{background:#fff8e9;border-color:#f0dcc1}.tag{font-size:11px;color:#54717a;background:#f0f6f7;border-radius:50px;padding:4px 8px}.tag.miss{color:#8c611e;background:#ffe8c3}.blank{padding:24px;text-align:center;color:#6f8492}.foot{font-size:12px;color:#738594;line-height:1.8;margin:18px 2px}input[type=search]{appearance:none}
@media(max-width:580px){button{min-height:44px;min-width:44px}header{padding:21px 14px}.container{padding:13px 10px 25px}.card{padding:14px}.shift{grid-template-columns:91px 1fr auto;padding:11px 9px;gap:6px}.shift .time{font-size:12px}.shift .name{font-size:13px}.tag{padding:4px 6px}.move strong{font-size:14px}.move button{font-size:12px;padding:9px 8px}}
@media print{body{background:white}header{background:white;color:#222;padding:8px 0;border-bottom:2px solid #333}header p{color:#333}.container{max-width:none;padding:10px 0}.controls,.tabs,.move button,#printButton,.notice{display:none!important}.card{box-shadow:none;border:0;padding:0}.shift{break-inside:avoid;padding:5px 8px}.foot{color:#222}.status{color:#222;border:1px solid #333}}
${'<'}/style>${'<'}/head>${'<'}body>
${'<'}header>${'<'}span class="status" id="state">讀取中${'<'}/span>${'<'}h1 id="title">勤務班表｜唯讀版${'<'}/h1>${'<'}p id="meta">${'<'}/p>${'<'}/header>
${'<'}main class="container">${'<'}div class="notice" id="notice">${'<'}/div>
${'<'}section class="card controls">${'<'}div>${'<'}label for="day">查看日期${'<'}/label>${'<'}input id="day" type="date">${'<'}/div>${'<'}div>${'<'}label for="search">搜尋姓名（自動查詢整個月）${'<'}/label>${'<'}input id="search" type="search" placeholder="輸入姓名">${'<'}/div>${'<'}button id="reset" type="button">清除搜尋${'<'}/button>${'<'}button id="printButton" type="button">列印目前畫面${'<'}/button>${'<'}/section>
${'<'}section class="card">${'<'}div class="tabs">${'<'}button type="button" id="door" class="active">大門衛哨${'<'}/button>${'<'}button type="button" id="officer">安全士官${'<'}/button>${'<'}/div>
${'<'}div class="move">${'<'}button id="prev" type="button">← 前一天${'<'}/button>${'<'}strong id="dayTitle">${'<'}/strong>${'<'}button id="next" type="button">後一天 →${'<'}/button>${'<'}/div>
${'<'}p class="summary" id="summary">${'<'}/p>${'<'}div class="entries" id="entries">${'<'}/div>${'<'}/section>
${'<'}details class="card" id="personStats">${'<'}summary style="cursor:pointer;font-weight:800;min-height:44px;padding:10px 0">👤 查本月個人站哨統計（請先搜尋姓名）${'<'}/summary>${'<'}div class="summary" id="statsInfo">${'<'}/div>${'<'}div class="entries" id="statsList">${'<'}/div>${'<'}/details>
${'<'}footer class="foot">此檔僅供查看，不含排班管理功能，也不連接網路。唯讀代表無法在此介面改動來源班表，並非防竄改或正式核定證明。資料是產生當下的快照，原排班變更後不會自動更新。${'<'}/footer>
${'<'}/main>
${'<'}scr${"ipt"} type="application/json" id="snapshotData">__RO_DATA__${'<'}/scr${"ipt"}>
${'<'}scr${"ipt"}>
'use strict';
(function(){
 const byId=function(id){return document.getElementById(id);};
 const snapshot=JSON.parse(byId('snapshotData').textContent);
 const pools={door:'大門衛哨',officer:'安全士官'};
 const weekday=function(value){return '日一二三四五六'[new Date(value+'T12:00:00Z').getUTCDay()];};
 const total=function(a){return a.length;};
 const add=function(parent,tag,cls,value){const e=document.createElement(tag);if(cls)e.className=cls;if(value!==undefined)e.textContent=value;parent.appendChild(e);return e;};
 let pool='door',day=snapshot.month+'-01',allDays=false;
 byId('title').textContent=snapshot.month+' 勤務班表｜唯讀版';
 document.title=snapshot.month+' 勤務班表｜唯讀';
 const archived=snapshot.status==='archived';
 byId('state').className='status'+(archived?'':' draft');
 byId('state').textContent=archived?'已封存版 · 非單位核定':'草稿版 · 尚未封存';
 byId('meta').textContent='產出時間：'+new Date(snapshot.createdAt).toLocaleString('zh-TW',{hour12:false})+'　｜　大門 '+snapshot.door.filter(function(x){return !!x.nm;}).length+'/'+total(snapshot.door)+' 班　｜　安官 '+snapshot.officer.filter(function(x){return !!x.nm;}).length+'/'+total(snapshot.officer)+' 班　｜　版本：'+(snapshot.reference||'未標記');
 byId('notice').textContent=(archived?'本月班表已在管理工具封存，但仍需人工審核與單位核定。':'⚠ 此為尚未封存的草稿，請勿當成正式勤務表。')+' 本檔版次：'+(snapshot.reference||'未標記')+'；離線檔不會自動知道是否被新版取代，請與最新公布版核對代碼。分享前請確認單位資訊安全規範。';
 const dayInput=byId('day');dayInput.value=day;dayInput.min=snapshot.month+'-01';
 const monthEnd=new Date(Date.UTC(Number(snapshot.month.slice(0,4)),Number(snapshot.month.slice(5,7)),0)).getUTCDate();
 dayInput.max=snapshot.month+'-'+String(monthEnd).padStart(2,'0');
 const search=byId('search');
 function move(shift){const d=new Date(day+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+shift);const next=d.toISOString().slice(0,10);if(next${'<'}dayInput.min||next>dayInput.max)return;day=next;dayInput.value=day;render();}
  function renderStats(){
   const host=byId('statsList'),tip=byId('statsInfo');host.replaceChildren();
   const term=search.value.trim().toLocaleLowerCase();
   const grouped=new Map(),all=snapshot[pool].filter(function(r){return !!r.nm;});
   all.forEach(function(r){const key=r.rank+'|'+r.nm;let e=grouped.get(key);if(!e){e={name:r.nm,rank:r.rank,count:0,hours:0,night:0,noon:0};grouped.set(key,e);}
     e.count++;e.hours+=Number(r.h)||0;e.night+=r.night?1:0;e.noon+=r.noon?1:0;});
   const vals=[...grouped.values()],counts=vals.map(function(p){return p.count;});
   tip.textContent='本月有班人員 '+vals.length+' 組；班數範圍 '+(counts.length?Math.min(...counts)+'～'+Math.max(...counts):'無')+'。班數不等於時數。';
   if(!term){add(host,'div','blank','在上方「搜尋姓名」輸入姓名，即可看到班數、時數、夜哨和午間班；同名者不會被誤當成同一人統計。');return;}
   const matches=vals.filter(function(e){return e.name.toLocaleLowerCase().includes(term);});
   if(!matches.length){add(host,'div','blank','找不到符合的人員統計。');return;}
   for(const e of matches){const card=add(host,'div','shift');card.style.gridTemplateColumns='1fr';
      add(card,'strong','',e.rank+' '+e.name);
      if((snapshot.ambiguous&&snapshot.ambiguous[pool]||[]).includes(e.name)){
       add(card,'div','summary','⚠ 同勤務類別有同名人員；唯讀檔未包含識別編號，無法準確區分個人，本項不顯示合計。');continue;
      }
      add(card,'div','summary','本月 '+e.count+' 班／'+e.hours+' 小時 · 夜哨 '+e.night+' 班 · 午間 '+e.noon+' 班');
   }
  }
  function render(){
   const term=search.value.trim().toLocaleLowerCase();
   renderStats();
  const base=snapshot[pool];const entries=base.filter(function(r){return term?(r.nm||'').toLocaleLowerCase().includes(term):r.d===day;});
  byId('dayTitle').textContent=term?'整月姓名搜尋結果':day+'（星期'+weekday(day)+'）';
  byId('summary').textContent=term?'找到 '+entries.length+' 班｜'+pools[pool]+'｜'+snapshot.month+' 全月':pools[pool]+'｜'+day+'｜已排 '+entries.filter(function(x){return !!x.nm;}).length+' / '+entries.length+' 班';
  byId('prev').disabled=!!term||day${'<'}=dayInput.min;byId('next').disabled=!!term||day>=dayInput.max;dayInput.disabled=!!term;
  const host=byId('entries');host.replaceChildren();
  if(!entries.length){add(host,'div','blank',term?'查無符合姓名的班次。':'當天沒有班次。');return;}
  for(const r of entries){const card=add(host,'div','shift'+(r.nm?'':' empty'));
   const clock=add(card,'div','time',r.t);add(clock,'small','',term?r.d+' · 第 '+r.n+' 班':'第 '+r.n+' 班');
   const person=add(card,'div','name',r.nm||'⚠ 尚未排人');add(person,'small','',r.rank||'待補人員');
   add(card,'span','tag'+(r.nm?'':' miss'),r.nm?'已安排':'缺班');
  }
 }
 byId('door').onclick=function(){pool='door';byId('door').classList.add('active');byId('officer').classList.remove('active');render();};
 byId('officer').onclick=function(){pool='officer';byId('officer').classList.add('active');byId('door').classList.remove('active');render();};
 byId('prev').onclick=function(){move(-1);};byId('next').onclick=function(){move(1);};
 dayInput.onchange=function(){if(dayInput.value>=dayInput.min&&dayInput.value${'<'}=dayInput.max){day=dayInput.value;render();}};
 search.oninput=render;byId('reset').onclick=function(){search.value='';render();};
 byId('printButton').onclick=function(){window.print();};render();
})();
${'<'}/scr${"ipt"}>${'<'}/body>${'<'}/html>`;
 return template.replace('__RO_DATA__',()=>packed);
}
function getShareDocument(){
 const reason=readonlyEligibility();
 if(reason)throw Error(reason);
 return buildReadonlyHtml(readonlyPayload());
}
function previewReadonly(){
 $('uxPublish').open=true;
 try{
  const reason=readonlyEligibility();if(reason)throw Error(reason);
  inlineSnap=readonlyPayload();inlinePool='door';inlineDay=inlineSnap.month+'-01';
  const input=$('roInlineDate');const y=Number(inlineSnap.month.slice(0,4)),m=Number(inlineSnap.month.slice(5,7));
  input.min=inlineDay;input.max=inlineSnap.month+'-'+String(new Date(Date.UTC(y,m,0)).getUTCDate()).padStart(2,'0');input.value=inlineDay;
  $('roInlineSearch').value='';$('roInlineMonth').textContent=inlineSnap.month+' 唯讀班表 · '+(inlineSnap.reference||'未標記');
  $('roInlineBadge').textContent=inlineSnap.status==='archived'?'已封存 · 非核定':'草稿 · 未封存';
  $('roInlineBadge').className='share-pill'+(inlineSnap.status==='archived'?'':' draft');
  $('roInlineSummary').textContent='大門 '+inlineSnap.door.filter(r=>r.nm).length+'/'+inlineSnap.door.length+' 班 · 安官 '+inlineSnap.officer.filter(r=>r.nm).length+'/'+inlineSnap.officer.length+' 班';
  sharePreviewFingerprint=readonlyFingerprint();$('sharePreviewBox').classList.remove('hidden');renderReadonlyInline();
  $('shareStatus').textContent='✅ 已在本頁顯示唯讀班表。這是預覽，尚未產生分享檔。';
  $('sharePreviewBox').scrollIntoView({block:'nearest',behavior:'smooth'});
 }catch(e){$('shareStatus').textContent='⚠ '+e.message;refreshReadonlyPanel();}
}

function readonlyShareName(){return `唯讀班表_${activeMonth}_${isLocked()?'已封存_非核定':'草稿'}.html`;}
function shareConsentOk(){
 if($('shareConsent').checked)return true;
 $('shareStatus').textContent='⚠ 請先確認分享對象與管道符合單位規定。';$('shareConsent').focus();return false;
}
// 使用手機的系統分享，不經任何伺服器；仍取決於 HTML Viewer 是否支援 Web Share API。
// 可用系統分享（iPhone 等）就分享檔案，否則直接下載。
async function shareOrDownload(){
 try{
  if(typeof File==='function'&&typeof navigator.share==='function'){
   const probe=new File(['x'],'probe.html',{type:'text/html'});
   if(typeof navigator.canShare!=='function'||navigator.canShare({files:[probe]}))return shareNativeReadonly();
  }
 }catch(_){}
 return downloadReadonly();
}
async function shareNativeReadonly(){
 if(!shareConsentOk())return;
 let content;
 try{content=getShareDocument();}catch(e){$('shareStatus').textContent='⚠ '+e.message;return;}
 if(typeof File!=='function'||typeof navigator.share!=='function'){
  $('shareStatus').textContent='⚠ 目前這個 HTML 檢視器不提供系統檔案分享。請改用「複製文字班表」。';return;
 }
 const file=new File([content],readonlyShareName(),{type:'text/html'});
 if(typeof navigator.canShare==='function'&&!navigator.canShare({files:[file]})){
  $('shareStatus').textContent='⚠ 目前這個 App 不支援分享 HTML 檔。請改用「複製文字班表」。';return;
 }
 try{await navigator.share({files:[file],title:`${activeMonth} 勤務班表｜唯讀`});
  $('shareStatus').textContent='✅ 已完成系統分享操作。請確認對方有收到檔案或已儲存；改班後請重新分享。';
 }catch(e){$('shareStatus').textContent=e?.name==='AbortError'?'ℹ 已取消分享，資料未變動。':`⚠ 分享功能遭 App 限制（${e?.name||'不支援'}）。請改用「複製文字班表」。`;}
}
function downloadReadonly(){
 if(!shareConsentOk())return;
 try{download(readonlyShareName(),getShareDocument(),'text/html;charset=utf-8');
  // No positive 'file saved' assertion: native HTML viewer may block blob downloads.
  $('shareStatus').textContent='ℹ 已要求瀏覽器下載；若沒有出現檔案，可能是 HTML 檢視器封鎖了本機下載連結。請改用「iPhone 分享檔案」或「複製文字班表」。';
 }catch(e){$('shareStatus').textContent='⚠ '+e.message;}
}
function readonlyPlainText(){
 const p=readonlyPayload(),rows=[`${p.month} 勤務班表｜${p.status==='archived'?'已封存（非核定）':'草稿（未封存）'}`,'對照碼：'+(p.reference||'未標記')+' ｜ 工作台 v10.2','此為產生時的快照，非正式核定；離線檔不會自動同步新版。'];
 for(const pool of ['door','officer']){
  rows.push('',`【${pool==='door'?'大門衛哨':'安全士官'}】`);
  let prev='';for(const r of p[pool]){
   if(r.d!==prev){rows.push('',r.d);prev=r.d;}
   rows.push(`${r.t}　${r.rank? r.rank+'　':''}${r.nm||'【缺班】'}`);
  }
 }
 rows.push('','※ 僅限核准的環境內閱覽，資料異動後請重新產生。');return rows.join('\n');
}
// ---- 個人班表 ----
function shiftClock(t){const h=x=>String(x).padStart(2,'0');return h(t.start)+'–'+h(t.end);}
function personShifts(pool,staff){const sol=last.solutions[pool];return sol.tasks.filter(t=>sol.res.get(t.key)?.key===staff.key).sort((a,b)=>a.day-b.day||a.start-b.start);}
function personShiftText(pool,staff,format='block'){
 const week='日一二三四五六',mo=last.m.month,label=pool==='door'?'大門衛哨':'安全士官';
 const item=t=>dateText(t.day).slice(5).replace('-','/')+'（'+week[new Date(dateText(t.day)+'T00:00:00').getDay()]+'）'+shiftClock(t)+(t.holiday?'（假日）':'');
 const mine=personShifts(pool,staff),name=staff.name||staff.id;
 if(format==='line')return name+'：'+(mine.length?mine.map(item).join('、')+'（共 '+mine.length+' 班）':'本月無班');
 return name+'（'+staff.id+'）'+mo.m+' 月'+label+'，共 '+mine.length+' 班'+(mine.length?'：\n'+mine.map(item).join('\n'):'。');
}
function personShareHeader(){
 const mo=last.m.month,locked=!!appStore.months?.[activeMonth]?.locked;
 return mo.y+' 年 '+mo.m+' 月 個人班表｜'+(locked?'已封存':'草稿（未封存）');
}
const personShareFooter='※ 依產生當下的班表；之後若有異動，以最新公告為準。';
function allPersonShiftText(scope,format){
 const rows=[personShareHeader()];
 for(const pool of scope==='all'?['door','officer']:[scope]){
  rows.push('','【'+(pool==='door'?'大門衛哨':'安全士官')+'】');
  for(const staff of last.m.staff[pool]){if(format==='block')rows.push('');rows.push(personShiftText(pool,staff,format));}
 }
 rows.push('',personShareFooter);return rows.join('\n');
}
async function copyPlainText(text,field,say){
 try{if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(text);say('✅ 已複製，可以直接貼到 LINE。');return true;}}catch(e){}
 field.value=text;field.classList.remove('hidden');field.focus();field.select();
 try{if(document.execCommand?.('copy')){say('✅ 已複製，可以直接貼到 LINE。');return true;}}catch(e){}
 say('ℹ 這個 App 不允許自動複製；已在下方顯示全文，請長按文字手動複製。');field.scrollIntoView({block:'nearest',behavior:'smooth'});return false;
}
function personShareBlocked(say){
 const reason=readonlyEligibility();if(reason){say('⚠ '+reason);return true;}
 if(!$('shareConsent').checked){say('⚠ 請先勾選上方「我了解檔案包含人員姓名…」的分享確認。');$('shareConsent').focus();return true;}
 return false;
}
async function copyPersonShare(){
 const say=m=>$('personShareStatus').textContent=m;if(personShareBlocked(say))return;
 const text=allPersonShiftText($('personShareScope').value,$('personShareFormat').value);
 $('personShareText').value=text;$('personShareText').classList.remove('hidden');
 await copyPlainText(text,$('personShareText'),say);
}
async function sendPersonShare(){
 const say=m=>$('personShareStatus').textContent=m;if(personShareBlocked(say))return;
 const text=allPersonShiftText($('personShareScope').value,$('personShareFormat').value);
 try{await navigator.share({title:personShareHeader(),text});say('✅ 已開啟分享。');}catch(e){if(e&&e.name!=='AbortError')say('ℹ 這個 App 不支援系統分享，請改用「複製個人班表」。');}
}
async function copyReadonlyText(){
 if(!shareConsentOk())return;
 let value;
 try{getShareDocument();value=readonlyPlainText();}catch(e){$('shareStatus').textContent='⚠ '+e.message;return;}
 const panel=$('shareCopyBox'),field=$('shareTextArea');field.value=value;panel.classList.remove('hidden');
 try{if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(value);$('shareStatus').textContent='✅ 本月文字班表已複製，請只貼到核准的地方。';return;}}catch(e){}
 field.focus();field.select();
 try{if(document.execCommand?.('copy')){$('shareStatus').textContent='✅ 文字班表已複製，請只貼到核准的地方。';return;}}catch(e){}
 $('shareStatus').textContent='ℹ 此 App 禁止自動複製；已顯示全文，請長按文字手動複製。';
 panel.scrollIntoView({block:'nearest',behavior:'smooth'});
}

function asCSV(rows){return '\ufeff'+rows.map(row=>row.map(v=>{let s=String(v??'');if(/^[\s\uFEFF]*[=+\-@]/.test(s))s="'"+s;return /[",\n\r]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;}).join(',')).join('\r\n');}
function download(filename,content,type){const blob=new Blob([content],{type:type||'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);}
/* 排班按鈕由新介面流程接管。 */
// v4: shared inputs, isolated monthly schedules and fixed assignments.

// #endregion
