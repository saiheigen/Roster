
// 網頁版（https）才啟用：離線快取、新版本提示、請瀏覽器長期保存本機資料。用 Documents 等直接開檔時不會執行。
(()=>{
 if(!/^https?:$/.test(location.protocol))return;
 if('serviceWorker' in navigator)window.addEventListener('load',async()=>{
  let reg;try{reg=await navigator.serviceWorker.register('sw.js');}catch(_){return;}
  const bar=document.getElementById('updateBar'),btn=document.getElementById('updateNow'),later=document.getElementById('updateLater'),msg=document.getElementById('updateMsg');
  // 第一次安裝時沒有舊版本，不需要提示；只有「已有版本在用、新版本在等待」才提示
  const offer=()=>{if(reg.waiting&&navigator.serviceWorker.controller&&bar){bar.hidden=false;msg.textContent='有新版本可以使用。';btn.disabled=false;}};
  offer();
  reg.addEventListener('updatefound',()=>{const w=reg.installing;w&&w.addEventListener('statechange',()=>{if(w.state==='installed')offer();});});
  let reloading=false;
  navigator.serviceWorker.addEventListener('controllerchange',()=>{if(reloading)return;reloading=true;location.reload();});
  btn&&btn.addEventListener('click',()=>{
   const busy=window.rosterUpdateBlocker?window.rosterUpdateBlocker():'';
   if(busy){msg.textContent=busy+'，完成後再按「更新」。';return;}
   if(!reg.waiting){bar.hidden=true;return;}
   btn.disabled=true;msg.textContent='正在更新…';
   try{window.rosterFlushSave&&window.rosterFlushSave();}catch(_){}
   reg.waiting.postMessage('activate-update');
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
