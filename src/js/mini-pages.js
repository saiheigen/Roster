
// 給「被排的人」用的小頁面，用網址 # 後面的內容開啟，不載入工作台的資料：
//   #my=…      個人班表：列出這個人的班次，可一鍵加入手機行事曆（.ics）
//   #roster=…  全單位班表：搜尋自己的姓名看自己的班（同樣可加入行事曆），或依日期查看當天所有班
// # 後面的內容不會送到網站伺服器，資料就在連結本身。
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

 function renderMy(data,back){
  const shifts=shiftsOf(data),[y,m]=data.m.split('-').map(Number);
  const root=open((data.n||'個人')+' '+m+' 月班表');
  if(back){const b=el('button','mini-back','← 換一個人／依日期查看');b.type='button';b.onclick=back;root.append(b);}
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

 // ---------- 全單位班表 ----------
 // 連結裡的資料（v3，壓縮後放在 # 後面；134 人整月約 2,800 字元，LINE 單則上限約 5,000 字）：
 //   {v:3,m:'YYYY-MM',st,ref,c,n:[姓名…],r:[級職清單],pr:[每人級職序…],h:[假日的日期…],
 //    k:{door:{s:[[開始時,時數,班序]…],d:[每天幾班…],x:'每班的時段序（每字一班，若每天依序排滿則省略）',a:'每班的人員序（每兩字一班，__ 為缺班）'},officer:{…}}}
 // 讀進來後轉成 {p:[[姓名,級職]…],k:{door:{s,t:[日,時段序,人員序(-1 缺班),…]}}} 給畫面使用
 // 壓縮用瀏覽器內建的 CompressionStream（排班人的裝置）；解壓縮用自帶的 RosterInflate，舊手機也能開
 async function deflateRaw(bytes){
  const run=format=>new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream(format))).arrayBuffer().then(b=>new Uint8Array(b));
  try{return await run('deflate-raw');}catch(_){}
  const z=await run('deflate');return z.subarray(2,z.length-4); // zlib 格式去掉 2 位元組標頭與 4 位元組檢查碼即為 raw deflate
 }
 async function packRoster(data){
  const bytes=new TextEncoder().encode(JSON.stringify(data));
  let out;try{if(typeof CompressionStream!=='function')throw 0;out=await deflateRaw(bytes);}catch(_){return 'j'+encode(data);}
  let bin='';for(let i=0;i<out.length;i+=0x8000)bin+=String.fromCharCode.apply(null,out.subarray(i,i+0x8000));
  return 'z'+btoa(bin).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
 }
 async function unpackRoster(text){
  if(text[0]==='j')return decode(text.slice(1));
  if(text[0]!=='z')throw Error('格式不符');
  const b=text.slice(1).replace(/-/g,'+').replace(/_/g,'/'),bin=atob(b+'==='.slice((b.length+3)%4));
  return JSON.parse(new TextDecoder().decode(RosterInflate.inflate(Uint8Array.from(bin,c=>c.charCodeAt(0)))));
 }
 const B64='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
 async function rosterLink(data){return baseUrl()+'#roster='+await packRoster(data);}
 function expandRoster(R){
  if(R.v!==3)throw Error('格式不符');
  const p=R.n.map((name,i)=>[name,R.r[R.pr[i]]||'']),k={};
  for(const [pool,P] of Object.entries(R.k)){
   const t=[];let j=0;
   P.d.forEach((count,di)=>{for(let q=0;q<count;q++,j++){
    const si=P.x?B64.indexOf(P.x[j]):q,v=B64.indexOf(P.a[2*j])*64+B64.indexOf(P.a[2*j+1]);
    t.push(di+1,si,v===4095?-1:v);}});
   k[pool]={s:P.s,t};
  }
  return {...R,p,k};
 }
 // 把全單位資料轉成某個人的個人班表資料（與 #my= 同格式），沿用個人班表頁
 function personOf(R,idx){
  const hol=new Set(R.h||[]),out={};
  for(const k of ['door','officer']){
   const P=R.k[k];if(!P)continue;const s=[];
   for(let i=0;i<P.t.length;i+=3)if(P.t[i+2]===idx){const [start,dur,num]=P.s[P.t[i+1]];s.push([P.t[i],start,dur,num,hol.has(P.t[i])?1:0]);}
   if(s.length)out[k]=s;
  }
  return out;
 }
 function renderRoster(R){
  const [y,m]=R.m.split('-').map(Number),days=new Date(Date.UTC(y,m,0)).getUTCDate();
  const show=view=>{
   const root=open(m+' 月勤務班表');
   header(root,y+' 年 '+m+' 月','勤務班表',(R.st==='a'?'已封存的班表':'草稿班表（尚未封存）')+'・'+(R.c||'')+' 產生'+(R.ref?'・版次 '+R.ref:''));
   const tabs=el('div','mini-tabs'),meBtn=el('button','','查我的班'),dayBtn=el('button','','依日期查看');
   meBtn.type=dayBtn.type='button';meBtn.setAttribute('aria-pressed',String(view==='me'));dayBtn.setAttribute('aria-pressed',String(view==='day'));
   meBtn.onclick=()=>show('me');dayBtn.onclick=()=>show('day');tabs.append(meBtn,dayBtn);root.append(tabs);
   if(view==='me'){
    const box=el('section','mini-actions'),label=el('label','mini-field');label.append(el('span','','輸入你的姓名'));
    const q=el('input');q.type='search';q.placeholder='例如 王小明';q.autocomplete='name';label.append(q);
    const list=el('ul','mini-people');box.append(label,list);root.append(box);
    const draw=()=>{
     list.replaceChildren();const t=q.value.trim();if(!t){list.append(el('li','mini-help','輸入姓名中的任一字即可。'));return;}
     const hits=R.p.map((x,i)=>({x,i})).filter(({x})=>x[0].includes(t)).slice(0,20);
     if(!hits.length){list.append(el('li','mini-help','找不到「'+t+'」。請確認姓名，或向排班人詢問。'));return;}
     for(const {x,i} of hits){
      const own=personOf(R,i),n=(own.door||[]).length+(own.officer||[]).length,li=el('li'),b=el('button','mini-person');b.type='button';
      b.append(el('b','',(x[1]?x[1]+' ':'')+x[0]),el('small','',n?'本月 '+n+' 班':'本月沒有班'));
      b.onclick=()=>{store.set('roster.me',x[0]);openPerson(i);};li.append(b);list.append(li);
     }
    };
    q.oninput=draw;draw();
   }else{
    const box=el('section','mini-actions'),label=el('label','mini-field');label.append(el('span','','日期'));
    const sel=el('select');for(let d=1;d<=days;d++){const o=el('option','',pad(m)+'/'+pad(d)+'（'+WEEK[new Date(Date.UTC(y,m-1,d)).getUTCDay()]+'）');o.value=d;sel.append(o);}
    const now=new Date(),today=now.getFullYear()===y&&now.getMonth()+1===m?now.getDate():1;sel.value=String(today);
    label.append(sel);box.append(label);const out=el('div','mini-day-list');box.append(out);root.append(box);
    const draw=()=>{
     out.replaceChildren();const d=Number(sel.value);
     for(const k of ['door','officer']){
      const P=R.k[k];if(!P)continue;const rows=[];
      for(let i=0;i<P.t.length;i+=3)if(P.t[i]===d)rows.push({slot:P.s[P.t[i+1]],who:P.t[i+2]});
      rows.sort((a,b)=>a.slot[2]-b.slot[2]);
      out.append(el('h2','mini-pool',poolName(k)));
      const ol=el('ol','mini-shifts');
      for(const r of rows){const [start,dur,num]=r.slot,li=el('li','mini-shift'+(start>=22||start<6?' is-night':''));
       const who=r.who>=0?R.p[r.who]:null;
       li.append(el('b','mini-time',pad(start)+'–'+pad((start+dur)%24||24)),el('span','mini-date',who?(who[1]?who[1]+' ':'')+who[0]:'缺班'),el('small','','第 '+num+' 班'));ol.append(li);}
      if(!rows.length)ol.append(el('li','mini-empty','當天沒有班。'));
      out.append(ol);
     }
    };
    sel.onchange=draw;draw();
   }
   root.append(el('p','mini-foot','班表若有異動，以單位最新公告為準。這個頁面的資料就在連結本身，不會傳到任何伺服器，但拿到連結的人都看得到全單位的班表。'));
  };
  const openPerson=i=>{
   const x=R.p[i],own=personOf(R,i),k=own.door?'door':own.officer?'officer':'door';
   renderMy({m:R.m,n:x[0],r:x[1],k,st:R.st,ref:R.ref,c:R.c,s:own[k]||[]},()=>show('me'));
  };
  const me=store.get('roster.me'),mine=me?R.p.findIndex(x=>x[0]===me):-1;
  if(mine>=0)openPerson(mine);else show('me');
 }

 async function route(){
  const h=location.hash;
  try{
   if(h.startsWith('#my=')){renderMy(decode(h.slice(4)));return;}
   if(h.startsWith('#roster=')){open('勤務班表');renderRoster(expandRoster(await unpackRoster(h.slice(8))));return;}
  }catch(e){const root=open('連結無法開啟');
   header(root,'哨務工作台','連結無法開啟','這個連結不完整或已損壞（可能複製時被截斷），請向排班人重新索取。');return;}
  close();
 }
 window.RosterMini={personalLink,rosterLink,calendarFile,decode,unpackRoster,expandRoster,B64};
 route();
 window.addEventListener('hashchange',route);
})();
