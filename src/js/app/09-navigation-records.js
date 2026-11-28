// #region 工作台導覽與輸入檢查
function showStep(step){
 if(!['home','setup','records','review','results'].includes(step))return;
 closeClearMonthPrompt();
 currentStep=step;
 document.body.dataset.step=step;
 document.querySelectorAll('.panel').forEach(el=>el.classList.toggle('active',el.id==='page-'+step));
 document.querySelectorAll('[data-step]').forEach(el=>el.classList.toggle('active',el.dataset.step===step));
 if(step==='home')refreshDashboard();
 if(step==='review')reviewInputs();
 if(step==='records')renderRecordEditor();
 if(step==='results'&&!last){$('noResults').classList.remove('hidden');$('results').classList.add('hidden');}if(step==='results')refreshMinimalPanel();
 window.scrollTo({top:0,behavior:'instant'});
}
function refreshUX(){
 const door=rosterPersons('door'),off=rosterPersons('officer');
 $('doorCount').textContent=door.length;$('officerCount').textContent=off.length;
 for(const [id,people] of [['door',door],['officer',off]]){
  $(id+'Preview').textContent=people.length?`已辨識：${people.slice(0,4).map(p=>p.name+'（'+p.id+'）').join('、')}${people.length>4?'……':''}`:'還沒輸入人員。';
 }
 try{let mo=monthVal();$('monthInfo').textContent=`${mo.y} 年 ${mo.m} 月｜大門 ${mo.days*12} 班、安官 ${mo.days*7} 班`;$('monthDays').textContent=mo.days+' 天';}
 catch(e){$('monthInfo').textContent='請選擇有效月份';}
 try{const month=monthVal(),errors=[],days=holidaySet(month,$('holidayOverrides').value,errors);
 $('holidayDates').textContent=errors.length?errors.join('、'):'本月計入：'+([...days].sort((a,b)=>a-b).map(d=>d-month.first+1+' 日').join('、')||'無');}catch{}
 const selector=$('recordCategory');
 selector.innerHTML=recordIds.map(id=>'<option value="'+id+'">'+recordDefs[id].title+'</option>').join('');
 selector.value=currentCat;
 $('setupStatus').textContent=`大門 ${door.length} 人 · 安官 ${off.length} 人`;refreshPersonOptions();
}
function refreshPersonOptions(){
 let pool=recordDefs[currentCat].pool;
 if(pool==='history')pool=$('historyPool').value==='大門'?'door':'officer';
 const roster=[...(pool==='officer'?[]:rosterPersons('door').map((p,i)=>({...p,pool:'door',i}))),...(pool==='door'?[]:rosterPersons('officer').map((p,i)=>({...p,pool:'officer',i})))].filter(p=>currentCat==='history'||!isInactiveAtMonthStart(p.pool,p.id));
 const query=$('personFilter').value.trim().toLocaleLowerCase();
 const filtered=roster.filter(p=>[p.name,p.id,p.rank,names[p.pool]].some(v=>String(v||'').toLocaleLowerCase().includes(query)));
 const el=$('personPicker'),before=el.value;
 let out=`<option value="">${filtered.length?'請選擇人員':'沒有符合條件的人員'}</option>`;
 for(const kind of ['officer','door']){
  const group=filtered.filter(p=>p.pool===kind).sort((a,b)=>{
   const ranks=selectableRanks[kind],ra=ranks.indexOf(a.rank),rb=ranks.indexOf(b.rank);
   return (ra<0?ranks.length:ra)-(rb<0?ranks.length:rb)||a.i-b.i;
  });
  if(!group.length)continue;
  const ranks=selectableRanks[kind];
  for(const rank of [...ranks,'其他／未分類']){
   const members=group.filter(p=>rank==='其他／未分類'?!ranks.includes(p.rank):p.rank===rank);
   if(!members.length)continue;
   out+=`<optgroup label="${names[kind]} · ${rank}（${members.length} 人）">`;
   out+=members.map(p=>`<option value="${esc(p.id)}">${esc(p.name+' · '+p.id)}</option>`).join('')+'</optgroup>';
  }
 }
 el.innerHTML=out;
 if([...el.options].some(o=>o.value===before))el.value=before;
 $('personPickerHint').textContent=query?`符合搜尋 ${filtered.length} 人。請再點選正確姓名。`:`共 ${filtered.length} 人，依階級分組；輸入姓名可快速篩選。`;
}
function slotPicker(){const pool=$('historyPool').value==='大門'?'door':'officer';let current=$('historySlot').value;
 $('historySlot').innerHTML=slots[pool].map(t=>`<option value="${t.num}">第 ${t.num} 班｜${pad(t.start)}–${pad(t.end)}</option>`).join('');
 if([...$('historySlot').options].some(o=>o.value===current))$('historySlot').value=current;
}
function renderRecordEditor(){
 const def=recordDefs[currentCat];$('categoryHelp').textContent=def.tip;$('bulkInfo').textContent='每行一筆，依序填入'+def.hint;
 $('recordCategory').value=currentCat;
 document.querySelectorAll('[data-raw]').forEach(el=>el.classList.toggle('active',el.dataset.raw===currentCat));
 for(const [name,visible] of [['poolField',!!def.history],['startField',!def.weight&&!def.carry&&currentCat!=='kitchen'],['endField',!!def.end],['typeField',!!def.type],['weightField',!!def.weight],['carryField',!!def.carry],['slotField',!!def.history]])$(name).classList.toggle('hidden',!visible);
 $('dateStartLabel').textContent=def.history?'值勤日期':currentCat==='leave'?'休假起日':currentCat==='meal'||currentCat==='nightcheck'||currentCat==='driver'?'勤務日期':currentCat==='exempt'?'生效日（可留空）':'開始日期';
 $('dateEndLabel').textContent=currentCat==='leave'?'休假最後一天':currentCat==='exempt'?'結束日（可留空）':'結束日期';
 slotPicker();refreshPersonOptions();renderRecords();
 $('recordSubmit').textContent=editingLine===null?'＋ 新增這筆紀錄':'儲存這筆修改';
 $('cancelEdit').style.display=editingLine===null?'none':'';
}
function displayRecord(row,id){const f=row.fields,people=[...rosterPersons('door'),...rosterPersons('officer')], personToken=id==='history'?f[3]:f[0];const p=people.find(p=>p.id===personToken);
 let desc=(p?p.name+'（'+personToken+'）':personToken);const dates=f.slice(id==='history'?1:id==='exempt'?2:1);
 if(id==='history')return `${f[0]||''} · ${f[1]||''} · 第${f[2]||''}班 · ${desc}`;
 if(id==='kitchen')return desc;
 if(id==='business')return desc+' · 權重 '+(f[1]||'1/3');
 if(id==='carry')return desc+' · 減班 '+(f[1]||'0');
 if(id==='exempt')return desc+' · '+(f[1]||'')+' · '+(f[2]||'永久')+(f[3]?' ～ '+f[3]:'');
 return desc+' · '+(dates[0]||'')+(dates[1]?' ～ '+dates[1]:'');
}
// ---- 人員查詢 ----
let lookupId=null;
function lookupPeople(){return [...rosterPersons('door').map(p=>({...p,pool:'door'})),...rosterPersons('officer').map(p=>({...p,pool:'officer'}))];}
function recordRowsFor(cat,person){
 const out=[];
 $(cat).value.split(/\r?\n/).forEach((raw,idx)=>{
  if(!raw.trim()||raw.trim().startsWith('#'))return;
  const row={raw,idx,fields:csvFields(raw)};if(skipHeader(row))return;
  const token=String((cat==='history'?row.fields[3]:row.fields[0])||'').trim();
  if(token===person.id||token===person.name)out.push(row);
 });
 return out.sort(byRecordDate(cat));
}
function renderLookupMatches(){
 const box=$('lookupMatches'),q=$('lookupQuery').value.trim().toLocaleLowerCase();
 if(!q){box.innerHTML='';return;}
 const hits=lookupPeople().filter(p=>[p.name,p.id].some(v=>String(v||'').toLocaleLowerCase().includes(q)));
 box.innerHTML=hits.length?hits.slice(0,15).map(p=>`<button type="button" class="lookup-chip" data-lookup="${esc(p.id)}">${esc(p.name)} · ${esc(p.id)} · ${names[p.pool]}</button>`).join('')+(hits.length>15?`<span class="help">還有 ${hits.length-15} 人，請再多打幾個字。</span>`:''):'<span class="help">名冊中找不到符合的人員。</span>';
 box.querySelectorAll('[data-lookup]').forEach(b=>b.onclick=()=>{lookupId=b.dataset.lookup;$('lookupQuery').value='';box.innerHTML='';renderLookup();$('lookupResult').scrollIntoView({block:'nearest',behavior:'smooth'});});
}
function renderLookup(){
 const box=$('lookupResult');if(!box)return;
 if(!lookupId){box.innerHTML='';return;}
 const p=lookupPeople().find(x=>x.id===lookupId);
 if(!p){box.innerHTML='<p class="help">名冊中已沒有這個人。</p>';lookupId=null;return;}
 const week='日一二三四五六',wd=day=>week[new Date(dateText(day)+'T00:00:00').getDay()];
 let html=`<div class="lookup-head"><div><b>${esc(p.name)}</b>　${esc(p.id)}${p.rank?'　'+esc(p.rank):''}　${names[p.pool]}</div><button type="button" class="mini ghost" id="lookupClose">關閉</button></div>`;
 let total=0;
 for(const cat of recordIds){
  const rows=recordRowsFor(cat,p);if(!rows.length)continue;total+=rows.length;
  html+=`<h4>${recordDefs[cat].title}（${rows.length} 筆）</h4><ul class="lookup-list">${rows.map(r=>`<li><span>${esc(displayRecord(r,cat).replace(/^[^·]*· /,''))}</span><span class="lookup-actions"><button type="button" class="mini" data-lk-edit="${cat}|${r.idx}">修改</button><button type="button" class="mini danger" data-lk-del="${cat}|${r.idx}">刪除</button></span></li>`).join('')}</ul>`;
 }
 if(!total)html+='<p class="help">這個人目前沒有任何休假或勤務紀錄。</p>';
 html+=`<div class="actions"><button type="button" class="mini" id="lookupAdd">＋ 為 ${esc(p.name)} 新增紀錄</button></div>`;
 const monthKey=last&&last.m?`${last.m.month.y}-${pad(last.m.month.m)}`:'';
 const staff=monthKey===activeMonth?last.m.staff[p.pool].find(x=>x.id===p.id):null;
 if(staff){
  const mine=personShifts(p.pool,staff);
  const pts=burdenOn()?mine.reduce((a,t)=>a+burdenScaled(p.pool,t)/2,0):null;
  html+=`<h4>本月班次（${mine.length} 班${pts!==null?'，勤務點數 '+pts.toFixed(1):''}）</h4>`+
   (mine.length?`<ul class="lookup-shifts">${mine.map(t=>`<li>${dateText(t.day).slice(5)}（${wd(t.day)}）${fmt(t)}${t.holiday?' <span class="tag">假日</span>':''}</li>`).join('')}</ul>`:'<p class="help">本月沒有排到班。</p>')+
   `<label class="share-consent lookup-consent"><input id="lookupConsent" type="checkbox" ${$('shareConsent').checked?'checked':''}/><span>我了解內容包含姓名與勤務時間，會確認分享對象與管道符合單位規定。</span></label>`+
   `<div class="actions"><button type="button" class="mini primary" id="lookupCopy">📋 複製此人班表</button>${navigator.share?'<button type="button" class="mini ghost" id="lookupSend">📤 分享</button>':''}</div>`+
   `<p class="help" id="lookupShareStatus" role="status"></p><textarea aria-label="此人班表內容" class="person-share-text hidden" id="lookupShareText" readonly spellcheck="false"></textarea>`;
 }else html+='<p class="help">'+(last?'':'排班後')+'這裡會列出本月班次'+(last?'（資料修改後請重新排班）':'')+'。</p>';
 box.innerHTML=html;
 $('lookupClose').onclick=()=>{lookupId=null;renderLookup();};
 if(staff){
  const say=m=>$('lookupShareStatus').textContent=m;
  $('lookupConsent').onchange=e=>{$('shareConsent').checked=e.target.checked;$('shareConsent').dispatchEvent(new Event('change',{bubbles:true}));};
  const ready=()=>{const reason=readonlyEligibility();if(reason){say('⚠ '+reason);return false;}if(!$('lookupConsent').checked){say('⚠ 請先勾選上方的分享確認。');return false;}return true;};
  const text=()=>personShareHeader().replace('個人班表','班表')+'\n'+personShiftText(p.pool,staff,'block')+'\n'+personShareFooter;
  $('lookupCopy').onclick=()=>{if(ready())copyPlainText(text(),$('lookupShareText'),say);};
  if($('lookupSend'))$('lookupSend').onclick=async()=>{if(!ready())return;try{await navigator.share({title:p.name+' 班表',text:text()});say('✅ 已開啟分享。');}catch(e){if(e&&e.name!=='AbortError')say('ℹ 這個 App 不支援系統分享，請改用「複製此人班表」。');}};
 }
 $('lookupAdd').onclick=()=>{
  if(recordDefs[currentCat].pool&&recordDefs[currentCat].pool!==p.pool)currentCat='leave';
  editingLine=null;$('personFilter').value='';renderRecordEditor();$('personPicker').value=p.id;
  $('recordStatus').textContent='請選擇紀錄項目與日期，為 '+p.name+' 新增紀錄。';$('recordCategory').scrollIntoView({block:'center',behavior:'smooth'});
 };
 box.querySelectorAll('[data-lk-edit]').forEach(b=>b.onclick=()=>{const [cat,idx]=b.dataset.lkEdit.split('|');currentCat=cat;editRecord(Number(idx));$('recordStatus').textContent='正在修改 '+p.name+' 的'+recordDefs[cat].title+'紀錄；改好按「儲存這筆修改」。';});
 box.querySelectorAll('[data-lk-del]').forEach(b=>b.onclick=()=>{const [cat,idx]=b.dataset.lkDel.split('|');currentCat=cat;deleteRecord(Number(idx));$('recordStatus').textContent='✅ 已刪除 '+p.name+' 的 1 筆'+recordDefs[cat].title+'紀錄；15 秒內可按下方撤銷。';});
}
// 紀錄依日期由小到大（沒有日期的排最後；同日維持原輸入順序）
function recordDateKey(r,cat){
 const shift=cat==='history'?1:cat==='exempt'?2:1;
 const p=String(r.fields[shift]||'').trim().replace(/[年月.\-]/g,'/').replace(/日/g,'').split('/').map(Number);
 if(p.length===3&&p.every(Number.isFinite))return p[0]*10000+p[1]*100+p[2];
 if(p.length===2&&p.every(Number.isFinite))return Number(activeMonth.slice(0,4))*10000+p[0]*100+p[1];
 return Infinity;
}
function byRecordDate(cat){return (a,b)=>{const x=recordDateKey(a,cat),y=recordDateKey(b,cat);return x===y?0:x<y?-1:1;};}
function renderRecords(){
 try{renderLookup();}catch(e){console.warn('lookup',e);}
 const source=$(currentCat).value.split(/\r?\n/);
 const rows=source.map((raw,i)=>({raw,idx:i,fields:csvFields(raw)})).filter(r=>r.raw.trim()&&!r.raw.trim().startsWith('#')&&!skipHeader(r)).sort(byRecordDate(currentCat));
 $('recordCount').textContent=rows.length+' 筆';$('recordStatus').textContent='';
 if(!rows.length){$('recordList').innerHTML='<div class="empty-state">尚無紀錄。</div>';return;}
 $('recordList').innerHTML=`<div class="tablewrap smalltable"><table><thead><tr><th>#</th><th>紀錄</th><th>操作</th></tr></thead><tbody>${rows.map((r,i)=>`<tr><td>${i+1}</td><td>${esc(displayRecord(r,currentCat))}</td><td><button type="button" class="mini" data-edit="${r.idx}">修改</button> <button type="button" class="mini danger" data-delete="${r.idx}">刪除</button></td></tr>`).join('')}</tbody></table></div>`;
 $('recordList').querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>editRecord(Number(b.dataset.edit)));
 $('recordList').querySelectorAll('[data-delete]').forEach(b=>b.onclick=()=>deleteRecord(Number(b.dataset.delete)));
}
function editRecord(i){const fields=csvFields($(currentCat).value.split(/\r?\n/)[i]);$('personFilter').value='';
 editingLine=i;if(currentCat==='history'){$('historyPool').value=fields[0]||'大門';slotPicker();$('historySlot').value=fields[2]||'1';refreshPersonOptions();}
 const token=currentCat==='history'?fields[3]||'':fields[0]||'';
 const matches=[...rosterPersons('door'),...rosterPersons('officer')].filter(p=>p.name===token);
 $('personPicker').value=matches.length===1?matches[0].id:token;
 if(currentCat==='exempt')$('restrictionType').value=fields[1]||'全面免哨';
 if(currentCat==='business')$('weight').value=fields[1]||'0.333333';
 if(currentCat==='carry')$('carryNum').value=fields[1]||'0';
 const shift=currentCat==='history'?1:currentCat==='exempt'?2:1;
 $('dateStart').value=dateDisplay(fields[shift]);$('dateEnd').value=dateDisplay(fields[shift+1]);
 renderRecordEditor();$('recordStatus').textContent='正在修改這筆紀錄；改好按「儲存這筆修改」。';$('recordSubmit').scrollIntoView({block:'nearest',behavior:'smooth'});
}
function deleteRecord(i){let a=$(currentCat).value.split(/\r?\n/);if(i<0||i>=a.length)return;
 const snapshot=beforeDelete();a.splice(i,1);$(currentCat).value=a.join('\n');editingLine=null;
 invalidateResult();refreshUX();renderRecordEditor();saveAutoNow();
 offerUndo(snapshot,'已刪除 1 筆'+recordDefs[currentCat].title+'紀錄');$('recordStatus').textContent='✅ 已刪除；15 秒內可按下方撤銷。';}
function resetRecord(){editingLine=null;$('personFilter').value='';$('dateStart').value='';$('dateEnd').value='';$('personPicker').value='';$('carryNum').value='0';$('weight').value='0.333333';renderRecordEditor();}
function submitRecord(e){e.preventDefault();const def=recordDefs[currentCat];const p=$('personPicker').value;
 if(!p){$('recordStatus').textContent='請先從名冊選人。';return;}
 const s=$('dateStart').value,ed=$('dateEnd').value;
 if(!['kitchen','business','carry'].includes(currentCat)&&!s&&!def.optional){$('recordStatus').textContent='請選擇日期。';return;}
 if(def.end&&!def.optional&&!ed){$('recordStatus').textContent='請選擇結束日期。';return;}
 if(s&&ed&&ed<s){$('recordStatus').textContent='結束日期不能早於開始日期。';return;}
 if(def.optional&&Boolean(s)!==Boolean(ed)){$('recordStatus').textContent='長期適用請留空兩個日期；指定期間請填起日與迄日。';return;}
 let f;
 if(def.history)f=[$('historyPool').value,s,$('historySlot').value,p];
 else if(def.type)f=[p,$('restrictionType').value,s,ed];
 else if(def.weight)f=[p,$('weight').value];
 else if(def.carry)f=[p,$('carryNum').value];
 else if(currentCat==='kitchen')f=[p];
 else if(def.end)f=[p,s,ed];
 else f=[p,s];
 if(def.weight&&(Number(f[1])<=0||Number(f[1])>1)){$('recordStatus').textContent='權重請填 0～1 之間（不含 0）。';return;}
 if(def.carry&&(!Number.isInteger(Number(f[1]))||Number(f[1])<0)){$('recordStatus').textContent='減班數只能填 0 以上整數。';return;}
 const txt=f.join('\t'),el=$(currentCat),arr=el.value?el.value.split(/\r?\n/):[];
 if(editingLine===null){if(arr.length&&arr[arr.length-1].trim()==='')arr.pop();arr.push(txt);}else arr[editingLine]=txt;
 el.value=arr.join('\n');resetRecord();refreshUX();invalidateResult();
 const label=p+' '+def.title+(s?' '+s:'')+(ed&&ed!==s?' ～ '+ed:'');
 const saved=saveAutoNow();
 $('recordStatus').textContent=saved?(vault?'已登記 '+label+'。加密存檔狀態見頁首。':'已儲存 '+label+'。'):'⚠ '+label+' 已登記在本頁，但本機存檔失敗。請先備份再關閉。';
}
function invalidateResult(){stopOffline('');discardMinimal();closeReadonlyPreview();$('shareTextArea').value='';$('shareCopyBox').classList.add('hidden');if(last){cacheCurrentSchedule();last=null;loadedSig='';$('results').classList.add('hidden');$('noResults').classList.remove('hidden');}refreshDashboard();}
function reviewInputs(){refreshUX();$('reviewDoor').textContent=rosterPersons('door').length+' 人';$('reviewOfficer').textContent=rosterPersons('officer').length+' 人';$('reviewEvents').textContent=recordIds.reduce((s,id)=>s+countRows(id),0)+' 筆';
 try{const m=build();
  const hasDistantDate=m.warnings.some(w=>w.code==='DATE_YEAR_FAR');
  const hasSuspectYear=m.warnings.some(w=>w.code==='DATE_YEAR_SUSPECT');
  const hasOverlap=m.warnings.some(w=>w.code==='FIXED_DUTY_OVERLAP');
  const hasRosterWarning=m.warnings.some(w=>['RANK_MISSING','RANK_UNKNOWN','RANK_OUTSIDE_POOL','SEX_UNKNOWN'].includes(w.code));
  const confirmedYear=syncYearReviewCheckbox(m);
  const mustReviewYear=hasSuspectYear&&!confirmedYear;
  $('yearReviewBox').classList.toggle('hidden',!hasSuspectYear);
  const messages=m.errors.length?`⚠ 發現 ${m.errors.length} 個需要修正的問題：\n`+m.errors.slice(0,40).map(s=>'• '+s).join('\n')+(m.errors.length>40?'\n…其餘請重新檢查':''):
    mustReviewYear?'⛔ 發現疑似年份筆誤，請先核對下方紀錄並勾選確認；未確認前不執行排班。':
    hasOverlap?'⚠ 同一人有勤務紀錄重疊，請查看下方編號與日期。':
    (hasSuspectYear||hasDistantDate||hasRosterWarning)?'⚠ 資料可解析，但仍有年份、級職或性別需要核對；請閱讀下方提醒。':'✅ 基本資料檢查通過。可開始排班。';
  $('reviewValidation').className='message '+(m.errors.length?'error':mustReviewYear?'error':hasOverlap||hasSuspectYear||hasDistantDate||hasRosterWarning?'warn':'');$('reviewValidation').textContent=messages;
  $('run').disabled=m.errors.length>0||mustReviewYear;$('reviewClearPins').classList.toggle('hidden',!Object.keys(pinnedShifts).length);
  $('reviewInfo').textContent=m.warnings.length?m.warnings.map(w=>w.msg).join('\n'):'已提供跨月已排班次。';
  if(m.warnings.length)$('reviewInfo').className='message warn';else $('reviewInfo').className='review-info';
  return m;
 }catch(e){$('reviewValidation').className='message error';$('reviewValidation').textContent='資料讀取錯誤：'+e.message;$('run').disabled=true;return null;}
}
let progressOwner=null;
function openProgress(title,stopLabel,interrupt){
 const view={focus:document.activeElement,interrupt};
 progressOwner=view;
 $('runTitle').textContent=title;$('runPhase').textContent='準備中';$('runBar').value=0;
 $('runInterrupt').textContent=stopLabel;$('runInterrupt').disabled=false;
 $('runInterrupt').onclick=()=>{if(progressOwner===view)view.interrupt();};
 document.body.classList.add('roster-working');$('runProgress').hidden=false;$('runTitle').focus();
 return view;
}
function paintProgress(view,percent,text){
 if(progressOwner!==view)return;
 $('runBar').value=percent;
 $('runBar').setAttribute('aria-valuetext',text);
 $('runPhase').textContent=text;
}
function closeProgress(view){
 if(progressOwner!==view)return;
 progressOwner=null;$('runProgress').hidden=true;document.body.classList.remove('roster-working');
 $('runInterrupt').onclick=null;
 if(view.focus?.isConnected)view.focus.focus();
}
function allowProgressPaint(){return new Promise(resolve=>setTimeout(resolve,32));}

let scheduleBusy=false,scheduleGeneration=0,repairBusy=false,repairGeneration=0;
function setScheduleButtonsBusy(busy){
 for(const id of ['quickRun','mobileRun','overviewRun','recordsRun','resultsRun'])if($(id))$(id).disabled=busy;
}

// #endregion
