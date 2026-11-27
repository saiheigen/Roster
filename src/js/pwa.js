
// 網頁版（https）才啟用：離線快取、請瀏覽器長期保存本機資料。用 Documents 等直接開檔時不會執行。
(()=>{
 if(!/^https?:$/.test(location.protocol))return;
 if('serviceWorker' in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('sw.js').catch(()=>{}));
 try{if(navigator.storage&&navigator.storage.persist)navigator.storage.persisted().then(p=>p||navigator.storage.persist()).catch(()=>{});}catch(_){}
 const standalone=(window.matchMedia&&matchMedia('(display-mode: standalone)').matches)||navigator.standalone===true;
 const hint=window.updatePwaHint=()=>{const h=document.getElementById('pwaHint');if(!h)return;const d=document.getElementById('door'),o=document.getElementById('officer');
  h.hidden=!(standalone&&d&&o&&!d.value.trim()&&!o.value.trim());};
 window.addEventListener('load',()=>{hint();for(const id of ['door','officer'])document.getElementById(id)?.addEventListener('input',hint);
  document.getElementById('restore')?.addEventListener('change',()=>setTimeout(hint,800));setTimeout(hint,1500);});
})();
