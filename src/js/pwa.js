
// 網頁版（https）才啟用：離線快取、新版本提示、請瀏覽器長期保存本機資料。用 Documents 等直接開檔時不會執行。
(()=>{
 if(!/^https?:$/.test(location.protocol))return;
 if('serviceWorker' in navigator)window.addEventListener('load',async()=>{
  // 新版本裝好時（controllerchange）只顯示提示，不自動重新載入；第一次安裝（原本沒有 controller）不提示
  const hadController=!!navigator.serviceWorker.controller;
  let reg;try{reg=await navigator.serviceWorker.register('sw.js');}catch(_){return;}
  const bar=document.getElementById('updateBar'),btn=document.getElementById('updateNow'),later=document.getElementById('updateLater'),msg=document.getElementById('updateMsg');
  navigator.serviceWorker.addEventListener('controllerchange',()=>{if(hadController&&bar){bar.hidden=false;msg.textContent='網站已更新，重新整理即可使用新版。';btn.disabled=false;}});
  btn&&btn.addEventListener('click',()=>{
   const busy=window.rosterUpdateBlocker?window.rosterUpdateBlocker():'';
   if(busy){msg.textContent=busy+'，完成後再按「重新整理」。';return;}
   btn.disabled=true;msg.textContent='正在重新整理…';
   try{window.rosterFlushSave&&window.rosterFlushSave();}catch(_){}
   setTimeout(()=>location.reload(),150);
  });
  later&&later.addEventListener('click',()=>{bar.hidden=true;});
  // 開著不關的分頁也會發現新版本（每 6 小時、以及從背景切回來時檢查）
  const check=()=>reg.update().catch(()=>{});
  setInterval(check,6*3600*1000);
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')check();});
 });
 try{if(navigator.storage&&navigator.storage.persist)navigator.storage.persisted().then(p=>p||navigator.storage.persist()).catch(()=>{});}catch(_){}
 const standalone=(window.matchMedia&&matchMedia('(display-mode: standalone)').matches)||navigator.standalone===true;
 const hint=window.updatePwaHint=()=>{const h=document.getElementById('pwaHint');if(!h)return;const d=document.getElementById('door'),o=document.getElementById('officer');
  h.hidden=!(standalone&&d&&o&&!d.value.trim()&&!o.value.trim());};
 window.addEventListener('load',()=>{hint();for(const id of ['door','officer'])document.getElementById(id)?.addEventListener('input',hint);
  document.getElementById('restore')?.addEventListener('change',()=>setTimeout(hint,800));setTimeout(hint,1500);});
})();
