
// 給「被排的人」用的個人班表頁，用網址 #my=… 開啟，不載入工作台的資料：
// 列出這個人的班次，可一鍵加入手機行事曆（.ics）。# 後面的內容不會送到網站伺服器，資料就在連結本身。
(()=>{
 'use strict';
 const PUBLIC_URL='https://saiheigen.github.io/Roster/';
 const WEEK='日一二三四五六';
 const pad=n=>String(n).padStart(2,'0');
 const baseUrl=()=>/^https?:$/.test(location.protocol)?location.origin+location.pathname:PUBLIC_URL;
 const store={get(k){try{return localStorage.getItem(k)||'';}catch(_){return '';}},set(k,v){try{localStorage.setItem(k,v);}catch(_){}}};

 // UTF-8 ↔ base64url（網址安全）
 function encode(obj){
  const bytes=new TextEncoder().encode(JSON.stringify(obj));let bin='';
  for(let i=0;i<bytes.length;i+=0x8000)bin+=String.fromCharCode.apply(null,bytes.subarray(i,i+0x8000));
  return btoa(bin).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
 }
 function decode(text){
  const b=String(text).replace(/-/g,'+').replace(/_/g,'/'),bin=atob(b+'==='.slice((b.length+3)%4));
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin,c=>c.charCodeAt(0))));
 }

 // ---------- 個人班表 ----------
 // 資料格式 v1：{v,m:'YYYY-MM',n:姓名,r:級職,k:'door'|'officer',st:'a'封存|'d'草稿,ref:版次,c:產生日,s:[[日,開始時,時數,班序,假日0/1],…]}
 const poolName=k=>k==='officer'?'安全士官':'大門衛哨';
 function personalLink(data){return baseUrl()+'#my='+encode({v:1,...data});}
 function shiftsOf(data){
  const [y,m]=data.m.split('-').map(Number);
  return (data.s||[]).map(([d,start,dur,num,holiday])=>({y,m,d,start,dur,num,holiday:!!holiday,date:`${y}-${pad(m)}-${pad(d)}`}))
   .sort((a,b)=>a.d-b.d||a.start-b.start);
 }
 // 台灣沒有日光節約，固定 UTC+8；直接寫成 UTC 時間，任何行事曆都不會換算錯
 function utcStamp(y,m,d,hour){
  const t=new Date(Date.UTC(y,m-1,d,hour-8,0,0));
  return t.getUTCFullYear()+pad(t.getUTCMonth()+1)+pad(t.getUTCDate())+'T'+pad(t.getUTCHours())+pad(t.getUTCMinutes())+'00Z';
 }
 const icsText=s=>String(s).replace(/\\/g,'\\\\').replace(/;/g,'\\;').replace(/,/g,'\\,').replace(/\r?\n/g,'\\n');
 // 每行最多 75 位元組（中文字一字 3 位元組），超過要折行，續行以空白開頭
 function fold(line){
  const enc=new TextEncoder();if(enc.encode(line).length<=75)return line;
  const out=[];let cur='',size=0,limit=75;
  for(const ch of line){const n=enc.encode(ch).length;if(size+n>limit){out.push(cur);cur=' '+ch;size=1+n;limit=75;}else{cur+=ch;size+=n;}}
  out.push(cur);return out.join('\r\n');
 }
 function calendarFile(data,alarmMinutes){
  const now=new Date(),stamp=now.getUTCFullYear()+pad(now.getUTCMonth()+1)+pad(now.getUTCDate())+'T'+pad(now.getUTCHours())+pad(now.getUTCMinutes())+'00Z';
  const label=poolName(data.k),rows=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//saiheigen//Roster//ZH-TW','CALSCALE:GREGORIAN','METHOD:PUBLISH','X-WR-CALNAME:'+icsText((data.n||'')+' '+data.m+' '+label)];
  for(const t of shiftsOf(data)){
   rows.push('BEGIN:VEVENT','UID:'+data.m+'-'+data.k+'-'+t.date+'-'+t.num+'-'+encode(data.n||'').slice(0,16)+'@roster',
    'DTSTAMP:'+stamp,'DTSTART:'+utcStamp(t.y,t.m,t.d,t.start),'DTEND:'+utcStamp(t.y,t.m,t.d,t.start+t.dur),
    'SUMMARY:'+icsText(label+' 第'+t.num+'班'),
    'DESCRIPTION:'+icsText((data.r?data.r+' ':'')+(data.n||'')+'｜'+pad(t.start)+':00–'+pad((t.start+t.dur)%24)+':00'+(t.holiday?'（假日）':'')+'\n依 '+(data.c||'')+' 產生的班表（'+(data.st==='a'?'已封存':'草稿')+'），異動以最新公告為準。'),
    'TRANSP:OPAQUE');
   if(alarmMinutes>0)rows.push('BEGIN:VALARM','ACTION:DISPLAY','DESCRIPTION:'+icsText(label+' 即將開始'),'TRIGGER:-PT'+alarmMinutes+'M','END:VALARM');
   rows.push('END:VEVENT');
  }
  rows.push('END:VCALENDAR');
  return rows.map(fold).join('\r\n')+'\r\n';
 }
 const isIOS=()=>/iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
 function saveCalendar(text,filename){
  // iPhone Safari：直接開 text/calendar 會出現「加入全部」；其他瀏覽器下載 .ics 後用行事曆開啟
  if(isIOS()){location.href='data:text/calendar;charset=utf-8,'+encodeURIComponent(text);return;}
  const url=URL.createObjectURL(new Blob([text],{type:'text/calendar;charset=utf-8'})),a=document.createElement('a');
  a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),4000);
 }

 // ---------- 畫面 ----------
 let host=null;
 const el=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e;};
 function open(title){
  document.documentElement.classList.add('mini-mode');document.title=title;
  if(!host){host=el('main','mini-page');host.id='miniPage';document.body.prepend(host);}
  host.replaceChildren();return host;
 }
 function close(){document.documentElement.classList.remove('mini-mode');if(host){host.remove();host=null;}}
 function header(root,kicker,title,sub){
  const h=el('header','mini-head');h.append(el('p','mini-kicker',kicker),el('h1','',title));if(sub)h.append(el('p','mini-sub',sub));root.append(h);return h;
 }

 function renderMy(data){
  const shifts=shiftsOf(data),[y,m]=data.m.split('-').map(Number);
  const root=open((data.n||'個人')+' '+m+' 月班表');
  header(root,y+' 年 '+m+' 月・'+poolName(data.k),(data.r?data.r+' ':'')+(data.n||''),'共 '+shifts.length+' 班・'+shifts.reduce((n,t)=>n+t.dur,0)+' 小時');
  const state=el('p','mini-note'+(data.st==='a'?'':' warn'),(data.st==='a'?'已封存的班表':'草稿班表（尚未封存）')+'・'+(data.c||'')+' 產生'+(data.ref?'・版次 '+data.ref:''));
  root.append(state);
  const list=el('ol','mini-shifts');
  for(const t of shifts){
   const li=el('li','mini-shift'+(t.start>=22||t.start<6?' is-night':''));
   const wd=WEEK[new Date(Date.UTC(t.y,t.m-1,t.d)).getUTCDay()];
   li.append(el('span','mini-date',pad(t.m)+'/'+pad(t.d)+'（'+wd+'）'),el('b','mini-time',pad(t.start)+'–'+pad((t.start+t.dur)%24||24)),el('small','','第 '+t.num+' 班'+(t.holiday?'・假日':'')));
   list.append(li);
  }
  if(!shifts.length)list.append(el('li','mini-empty','本月沒有排到班。'));
  root.append(list);
  if(shifts.length){
   const box=el('section','mini-actions');
   const label=el('label','mini-field');label.append(el('span','','提醒'));
   const sel=el('select');[['30','開始前 30 分鐘'],['60','開始前 1 小時'],['120','開始前 2 小時'],['0','不提醒']].forEach(([v,t])=>{const o=el('option','',t);o.value=v;sel.append(o);});
   sel.value=store.get('roster.alarm')||'30';sel.onchange=()=>store.set('roster.alarm',sel.value);label.append(sel);
   const btn=el('button','mini-primary','📅 加入手機行事曆');btn.type='button';
   btn.onclick=()=>saveCalendar(calendarFile(data,Number(sel.value)),(data.n||'班表')+'_'+data.m+'_'+poolName(data.k)+'.ics');
   box.append(label,btn,el('p','mini-help','iPhone：出現行事曆畫面後按「加入全部」。Android：下載完成後用「日曆」開啟。若在 LINE 裡按了沒反應，請點右上角選「用瀏覽器開啟」再按一次。'));
   root.append(box);
  }
  root.append(el('p','mini-foot','班表若有異動，以單位最新公告為準；已加入行事曆的舊班次需自行刪除。這個頁面的資料就在連結本身，不會傳到任何伺服器，但拿到連結的人都看得到。'));
 }

 function route(){
  const h=location.hash;
  try{
   if(h.startsWith('#my=')){renderMy(decode(h.slice(4)));return;}
  }catch(e){const root=open('連結無法開啟');header(root,'哨務工作台','連結無法開啟','這個連結不完整或已損壞，請向排班人重新索取。');return;}
  close();
 }
 window.RosterMini={personalLink,calendarFile,decode};
 route();
 window.addEventListener('hashchange',route);
})();
