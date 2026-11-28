
// 給「被排的人」用的兩個小頁面，用網址 # 後面的內容開啟，不載入工作台的資料：
//   #my=…      個人班表：列出這個人的班次，可一鍵加入手機行事曆（.ics）
//   #leave=YYYY-MM  休假填報：選日期後產生一段文字，傳回給排班人貼進工作台
// # 後面的內容不會送到網站伺服器；個人班表的資料就在連結本身。
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

 // ---------- 休假填報 ----------
 // 一行文字，人看得懂、也能一次貼多則給工作台讀取：
 //   休假填報 2026/12 王小明（H012）：12/03-12/05、12/20
 //   休假填報 2026/12 王小明：無
 function leaveLine(month,name,id,days){
  const [y,m]=month.split('-').map(Number),who=name.trim()+(id.trim()?'（'+id.trim()+'）':'');
  const sorted=[...new Set(days)].sort(),ranges=[];
  for(const d of sorted){const last=ranges[ranges.length-1];
   if(last&&dayDiff(last[1],d)===1)last[1]=d;else ranges.push([d,d]);}
  const md=s=>s.slice(5,7)+'/'+s.slice(8,10);
  const text=ranges.length?ranges.map(([a,b])=>a===b?md(a):md(a)+'-'+md(b)).join('、'):'無';
  return {text:'休假填報 '+y+'/'+pad(m)+' '+who+'：'+text,ranges,days:sorted.length};
 }
 function dayDiff(a,b){return Math.round((Date.parse(b+'T00:00:00Z')-Date.parse(a+'T00:00:00Z'))/86400000);}
 // 讀回多則填報（可以直接貼上 LINE 聊天紀錄，其他文字會略過）
 function parseLeave(text){
  const out=[];
  for(const raw of String(text).split(/\r?\n/)){
   const m=/休假填報\s*(\d{4})\s*[\/\-年.]\s*(\d{1,2})\s*月?\s+(.+?)\s*[：:]\s*(.+?)\s*$/.exec(raw);if(!m)continue;
   const y=Number(m[1]),mo=Number(m[2]),who=/^(.+?)\s*[（(]\s*([^）)]+?)\s*[）)]$/.exec(m[3].trim());
   const item={line:raw.trim(),y,m:mo,month:y+'-'+pad(mo),name:(who?who[1]:m[3]).trim(),id:who?who[2].trim():'',ranges:[],none:false,error:''};
   if(/^無$|^沒有$|^0$/.test(m[4].trim())){item.none=true;out.push(item);continue;}
   for(const seg of m[4].split(/[、,，;；\s]+/).filter(Boolean)){
    const r=/^(\d{1,2})\/(\d{1,2})(?:\s*[-–~～]\s*(?:(\d{1,2})\/)?(\d{1,2}))?$/.exec(seg);
    if(!r){item.error='看不懂的日期「'+seg+'」';break;}
    const date=(mm,dd)=>{let yy=y;if(mm<mo-6)yy++;else if(mm>mo+6)yy--;const t=new Date(Date.UTC(yy,mm-1,dd));
     if(t.getUTCMonth()!==mm-1||t.getUTCDate()!==dd)throw Error('不存在的日期 '+mm+'/'+dd);return yy+'/'+pad(mm)+'/'+pad(dd);};
    try{const a=date(Number(r[1]),Number(r[2])),b=r[4]?date(Number(r[3]||r[1]),Number(r[4])):a;
     if(b<a)throw Error('日期「'+seg+'」結束早於開始');item.ranges.push([a,b]);}
    catch(e){item.error=e.message;break;}
   }
   out.push(item);
  }
  return out;
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

 function renderLeave(month){
  let [y,m]=month.split('-').map(Number);const first=y+'-'+pad(m);
  const root=open(m+' 月休假填報');
  header(root,'休假填報',y+' 年 '+m+' 月','點選休假的日期（最後一天選到休假的最後一天，不是收假日），再把產生的文字傳給排班人。');
  const form=el('section','mini-form');
  const nameField=el('label','mini-field');nameField.append(el('span','','姓名'));const name=el('input');name.autocomplete='name';name.placeholder='例如 王小明';name.value=store.get('roster.leaveName');nameField.append(name);
  const idField=el('label','mini-field');idField.append(el('span','','人員編號（知道再填，同名時需要）'));const pid=el('input');pid.placeholder='例如 H012';pid.value=store.get('roster.leaveId');idField.append(pid);
  form.append(nameField,idField);root.append(form);
  const picked=new Set();let view={y,m};
  const cal=el('section','mini-cal');root.append(cal);
  const out=el('section','mini-actions');root.append(out);
  const preview=el('p','mini-preview'),send=el('button','mini-primary','📤 傳給排班人'),copy=el('button','mini-ghost','📋 複製文字'),msg=el('p','mini-help');
  send.type=copy.type='button';send.hidden=!navigator.share;
  out.append(preview,send,copy,msg);
  const line=()=>leaveLine(first,name.value,pid.value,[...picked]);
  function refresh(){
   const l=line(),ok=name.value.trim().length>0;
   preview.textContent=ok?l.text:'請先填姓名';send.disabled=copy.disabled=!ok;
   msg.textContent=l.days?'已選 '+l.days+' 天。':'沒有休假也可以傳「無」，讓排班人知道你已回覆。';
   store.set('roster.leaveName',name.value.trim());store.set('roster.leaveId',pid.value.trim());
  }
  function drawCal(){
   cal.replaceChildren();
   const nav=el('div','mini-cal-nav'),prev=el('button','mini-ghost','‹'),next=el('button','mini-ghost','›'),title=el('b','',view.y+' 年 '+view.m+' 月');
   prev.type=next.type='button';prev.setAttribute('aria-label','上個月');next.setAttribute('aria-label','下個月');
   const offset=(view.y-y)*12+view.m-m;prev.disabled=offset<=-1;next.disabled=offset>=1;
   prev.onclick=()=>{view=view.m===1?{y:view.y-1,m:12}:{y:view.y,m:view.m-1};drawCal();};
   next.onclick=()=>{view=view.m===12?{y:view.y+1,m:1}:{y:view.y,m:view.m+1};drawCal();};
   nav.append(prev,title,next);cal.append(nav);
   const grid=el('div','mini-cal-grid');for(const w of WEEK)grid.append(el('span','mini-wd',w));
   const start=new Date(Date.UTC(view.y,view.m-1,1)).getUTCDay(),days=new Date(Date.UTC(view.y,view.m,0)).getUTCDate();
   for(let i=0;i<start;i++)grid.append(el('span',''));
   for(let d=1;d<=days;d++){
    const key=view.y+'-'+pad(view.m)+'-'+pad(d),b=el('button','mini-day',String(d));b.type='button';
    const wd=(start+d-1)%7;if(wd===0||wd===6)b.classList.add('mini-weekend');
    const sync=()=>{b.classList.toggle('on',picked.has(key));b.setAttribute('aria-pressed',String(picked.has(key)));};sync();
    b.onclick=()=>{if(picked.has(key))picked.delete(key);else picked.add(key);sync();refresh();};
    grid.append(b);
   }
   cal.append(grid);
   const clear=el('button','mini-link','清除全部日期');clear.type='button';clear.onclick=()=>{picked.clear();drawCal();refresh();};cal.append(clear);
  }
  name.oninput=pid.oninput=refresh;
  copy.onclick=async()=>{const t=line().text;try{await navigator.clipboard.writeText(t);msg.textContent='✅ 已複製，請貼到 LINE 傳給排班人。';}catch(_){preview.focus();msg.textContent='請長按上面的文字手動複製。';}};
  send.onclick=async()=>{try{await navigator.share({text:line().text});msg.textContent='✅ 已開啟分享。';}catch(e){if(e&&e.name!=='AbortError')msg.textContent='這個 App 不支援分享，請改用「複製文字」。';}};
  drawCal();refresh();
 }

 function route(){
  const h=location.hash;
  try{
   if(h.startsWith('#my=')){renderMy(decode(h.slice(4)));return;}
   if(h.startsWith('#leave')){const m=/^#leave=(\d{4})-(\d{2})$/.exec(h);let month;
    if(m&&Number(m[2])>=1&&Number(m[2])<=12)month=m[1]+'-'+m[2];
    else{const d=new Date();d.setMonth(d.getMonth()+1);month=d.getFullYear()+'-'+pad(d.getMonth()+1);}
    renderLeave(month);return;}
  }catch(e){const root=open('連結無法開啟');header(root,'哨務工作台','連結無法開啟','這個連結不完整或已損壞，請向排班人重新索取。');return;}
  close();
 }
 window.RosterMini={personalLink,calendarFile,leaveLine,parseLeave,leaveLink:month=>baseUrl()+'#leave='+month,decode};
 route();
 window.addEventListener('hashchange',route);
})();
