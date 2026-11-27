// #region 資料結構、日期與輸入解析

const $=id=>document.getElementById(id);
const ids=['month','door','officer','leave','training','duty','meal','nightcheck','driver','exempt','kitchen','business','carry','history','businessDay','holidayOverrides','ruleSettings'];
const names={door:'大門',officer:'安官'};
// 唯一級職字典：兩種勤務的 UI 快選，以及可辨識的歷史／特殊級職。
const RANKS=Object.freeze({
 door:Object.freeze(['上兵','一兵','二兵']),
 officer:Object.freeze(['上士','中士','下士']),
 other:Object.freeze(['士官長','一等士官長','二等士官長','三等士官長','少尉','中尉','上尉','少校','中校','上校'])
});
const selectableRanks={door:RANKS.door,officer:RANKS.officer};
const isKnownRank=rank=>Object.values(RANKS).some(a=>a.includes(String(rank||'').trim()));
const normalizeSexToken=sex=>{
 const s=String(sex||'').trim();if(!s)return {value:'',unknown:false};
 if(['男','男性','M','m','male','Male'].includes(s))return {value:'男',unknown:false};
 if(['女','女性','F','f','female','Female'].includes(s))return {value:'女',unknown:false};
 if(['其他','X','x','O','o'].includes(s))return {value:'其他',unknown:false};
 return {value:'',unknown:true};
};
const slots={
 door:[{num:1,start:22,end:24},{num:2,start:0,end:2},{num:3,start:2,end:4},{num:4,start:4,end:6},{num:5,start:6,end:8},{num:6,start:8,end:10},{num:7,start:10,end:12},{num:8,start:12,end:14},{num:9,start:14,end:16},{num:10,start:16,end:18},{num:11,start:18,end:20},{num:12,start:20,end:22}],
 officer:[{num:1,start:22,end:24},{num:2,start:0,end:2},{num:3,start:2,end:4},{num:4,start:4,end:6},{num:5,start:6,end:12},{num:6,start:12,end:18},{num:7,start:18,end:22}]
};
let last=null,currentPool='door',missingOnly=false;
const pad=n=>String(n).padStart(2,'0');
const dateText=(day)=>new Date(day*86400000).toISOString().slice(0,10);
const weekday=day=>'日一二三四五六'[new Date(day*86400000).getUTCDay()];
const {independentScheduleAudit}=createScheduleAudit({slots,weekday,dateText});
const dateOf=(y,m,d)=>Math.round(Date.UTC(y,m-1,d)/86400000);
const todayMonth=()=>{const d=new Date();return d.getFullYear()+'-'+pad(d.getMonth()+1);};
const monthVal=()=>{let m=$('month').value;if(!/^\d{4}-\d\d$/.test(m))throw Error('請先選擇正確月份');let [y,mo]=m.split('-').map(Number);if(mo<1||mo>12)throw Error('月份無效');return {y,m:mo,first:dateOf(y,mo,1),last:dateOf(y,mo+1,0),days:new Date(Date.UTC(y,mo,0)).getUTCDate()};};
function parseDate(s,month,meta){s=String(s||'').trim();if(!s)return null;
 if(meta){meta.original=s;meta.format='unknown';}
 if(/^\d+(?:\.0+)?$/.test(s)){let n=Number(s);if(n>20000&&n<90000){if(meta)meta.format='excel';return dateOf(1899,12,30)+n;}}
 s=s.replace(/[年月.]/g,'/').replace(/日/g,'').replace(/-/g,'/').replace(/\s/g,'');
 if(!/^\d+(?:\/\d+){1,2}$/.test(s))throw Error('無法辨識日期：'+s);
 let a=s.split('/').map(Number),y,m,d;
 if(a.length===3){[y,m,d]=a;
   // 國軍常用民國年：115/12/03 → 2026/12/03。禁止把 115 年誤當西元 115 年。
   if(!Number.isInteger(y)||y<=0)throw Error('年份無效：'+s);
   if(meta){meta.inputYear=y;meta.format=y<100?'two-digit':y<1911?'roc':'gregorian';}
   if(y<100)y+=2000; // 26/12/03 → 2026
   else if(y<1911)y+=1911; // 115/12/03 → 2026
   if(meta)meta.resolvedYear=y;
  }
 else if(a.length===2){if(meta)meta.format='inferred';[m,d]=a;const years=[month.y-1,month.y,month.y+1];y=years.sort((x,z)=>Math.abs(dateOf(x,m,d)-month.first)-Math.abs(dateOf(z,m,d)-month.first))[0];}
 else throw Error('無法辨識日期：'+s);
 if(!Number.isInteger(m)||m<1||m>12||!Number.isInteger(d)||d<1||d>31)throw Error('日期無效：'+s);
 const day=dateOf(y,m,d),dt=new Date(day*86400000);if(dt.getUTCFullYear()!==y||dt.getUTCMonth()+1!==m||dt.getUTCDate()!==d)throw Error('不存在的日期：'+s);
 return day;
}
// 可測試的年份筆誤判斷：明確年份、相鄰一年、且同月份重合。
function adjacentYearTypo(month,start,end,a,b){
 const explicit=meta=>meta&&['gregorian','roc','two-digit'].includes(meta.format);
 const sameMonthPriorOrNext=day=>{
  if(day===null)return false;
  const dt=new Date(day*86400000);
  return Math.abs(dt.getUTCFullYear()-month.y)===1&&dt.getUTCMonth()+1===month.m;
 };
 return (explicit(a)&&sameMonthPriorOrNext(start))||(explicit(b)&&sameMonthPriorOrNext(end));
}
function csvFields(line){
 // 回傳欄位陣列；格式錯誤時附 parseError，永不從底層拋出錯誤（避免連累簽章和自動存檔）。
 line=String(line??'');
 const issue=(fields,msg)=>{Object.defineProperty(fields,'parseError',{value:msg,enumerable:false});return fields;};
 const hasQuote=line.includes('"'),hasTab=line.includes('\t');
 if(!hasQuote&&hasTab)return line.split('\t').map(v=>v.trim());
 if(!hasQuote&&!/[,，;\t]/.test(line)){
  const parts=line.trim().split(/[ \u3000]+/).filter(Boolean);
  if(parts.length>=3&&/^[HP]\d+$/i.test(parts[0])){
   const last=parts[parts.length-1],hasSex=!!last&&!normalizeSexToken(last).unknown&&!!normalizeSexToken(last).value;
   const known=isKnownRank(parts[1]);
   if(known)return [parts[0],parts[1],parts.slice(2,hasSex?-1:undefined).join(' '),hasSex?last:''];
   if(hasSex)return [parts[0],'',parts.slice(1,-1).join(' '),last];
  }
  return parts;
 }
 let out=[],cur='',quote=false;
 for(let i=0;i<line.length;i++){
  const c=line[i];
  if(c==='"'){
   if(quote&&line[i+1]==='"'){cur+='"';i++;}
   else quote=!quote;
  }else if(((hasTab&&c==='\t')||(!hasTab&&(c===','||c==='，'||c===';')))&&!quote){out.push(cur.trim());cur='';}
  else cur+=c;
 }
 out.push(cur.trim());
 return quote?issue(out,'CSV 引號未成對，請將引號補齊或刪除'):out;
}
// 同一個正規化函式同時服務匯入、名冊顯示、修改及自測。
function normalizeRosterFields(fields,pool){
 const f=Array.isArray(fields)?fields:[],id=String(f[0]||'').trim();
 let rank=String(f[1]||'').trim(),name=String(f[2]||'').trim(),rawSex=String(f[3]||'').trim();
 if(f.length===2){name=rank;rank='';}
 if(f.length===3&&!isKnownRank(rank)&&normalizeSexToken(name).value){rawSex=name;name=rank;rank='';}
 const sn=normalizeSexToken(rawSex);
 const issues=[];
 if(!rank)issues.push({code:'RANK_MISSING',msg:'缺少級職，舊資料可讀取；請確認人員勤務資格'});
 else if(!isKnownRank(rank))issues.push({code:'RANK_UNKNOWN',msg:`級職「${rank}」不在級職字典內，請核對`});
 else if(!selectableRanks[pool].includes(rank))issues.push({code:'RANK_OUTSIDE_POOL',msg:`級職「${rank}」不在本勤務一般快選清單，請核對勤務資格`});
 if(sn.unknown)issues.push({code:'SEX_UNKNOWN',msg:`性別「${rawSex}」無法辨識，暫留空白`});
 return {id,rank,name,sex:sn.value,issues};
}
function lines(id){return $(id).value.split(/\r?\n/).map((s,i)=>{const raw=s.trim(),fields=csvFields(s);return {fields,line:i+1,raw,error:fields.parseError||''};}).filter(x=>x.raw&&!x.raw.startsWith('#'));}
const skipHeader=row=>/^(人員編號|編號|姓名|級職|勤務類別|類型|日期|人員|序號)$/.test(String(row.fields[0]||'').replace(/\s/g,''));
function raw(){return Object.fromEntries(ids.map(id=>[id,$(id).value]));}
function put(o){ids.forEach(id=>{if(typeof o[id]==='string')$(id).value=o[id];});}
function setStatus(s,kind=''){const el=$('status');el.className='message'+(kind?' '+kind:'');el.textContent=s;}
// Civilian government calendar reference. Unit overrides can add/remove dates by month.
function holidaySet(month,overrides,errors){
 const tables={2026:[[1,1,1],[2,14,22],[2,27,28],[3,1,1],[4,3,6],[5,1,3],[6,19,21],[9,25,28],[10,9,11],[10,24,26],[12,25,27]],
  // 2027：依媒體彙整的116年行事曆（開國、春節2/4–2/10、228、清明兒童、勞動、端午、中秋、教師節、國慶、光復、行憲、2028元旦補假）；請以人事行政總處公告核對。
  2027:[[1,1,3],[2,4,10],[2,27,28],[3,1,1],[4,3,6],[4,30,30],[5,1,2],[6,9,9],[9,15,15],[9,28,28],[10,9,11],[10,23,25],[12,24,26],[12,31,31]]};
 const ranges=tables[month.y]||[];
 const result=new Set();
 for(const [m,first,last] of ranges)if(m===month.m)
  for(let d=first;d<=last;d++)result.add(dateOf(month.y,m,d));
 for(const token of overrides.trim().split(/[\s,，]+/).filter(Boolean)){
  const match=/^([+-]?)(\d{1,2})$/.exec(token),d=Number(match?.[2]);
  if(!match||d<1||d>month.days){errors.push('假期設定「'+token+'」不是本月有效日期');continue;}
  const day=month.first+d-1;if(match[1]==='-')result.delete(day);else result.add(day);
 }
 return result;
}
function build(){const month=monthVal(),warnings=[],errors=[],staff={door:[],officer:[]},byKey=new Map(),byToken=new Map();
 {const e=applyRuleSettings($('ruleSettings').value);if(e)errors.push(e);}
 const warn=(code,msg)=>warnings.push({code,msg});
 // 一次收集全部輸入資料的解析錯誤，不讓壞掉的單行污染下游運算。
 const sectionNames={door:'大門名冊',officer:'安官名冊',leave:'休假',training:'受訓',duty:'值星',meal:'督伙',nightcheck:'夜查',driver:'車勤',exempt:'勤務資格',kitchen:'固定伙房',businessDay:'業參實際日期',business:'業參',carry:'跨月補償',history:'跨月班次'};
 const parsedInput={};for(const id of ids){if(id==='month')continue;
  parsedInput[id]=lines(id);
  for(const row of parsedInput[id])if(row.error)errors.push(`${sectionNames[id]}第 ${row.line} 行：${row.error}`);
 }
 const validLines=id=>parsedInput[id].filter(row=>!row.error);

 function addToken(t,p){t=String(t||'').trim();if(!t)return;let a=byToken.get(t)||[];a.push(p);byToken.set(t,a);}
 for(const pool of ['door','officer'])for(const row of validLines(pool)){
  if(skipHeader(row))continue;
  const f=row.fields,{id,rank,name,sex,issues}=normalizeRosterFields(f,pool);
  if(!id){errors.push(names[pool]+'名冊第 '+row.line+' 行缺少人員編號');continue;}
  if(f.length>4||f.length<2){errors.push(`${names[pool]}名冊第 ${row.line} 行欄位數異常（${f.length} 欄），請檢查分隔符號及姓名`);continue;}
  if(!name){errors.push(`${names[pool]}名冊第 ${row.line} 行缺少姓名，至少需要編號＋姓名`);continue;}
  for(const issue of issues)warn(issue.code,`${names[pool]}名冊第 ${row.line} 行（${id}／${name}）：${issue.msg}。`);

  const key=pool+':'+id;if(byKey.has(key)){errors.push(`${names[pool]}名冊重複編號 ${id}`);continue;}
  const leaveDate=appStore.lifecycle?.[key]||'';
  const p={key,id,rank,name,sex,pool,weight:1,carry:0,events:[],history:[],mealCredit:0,
   inactiveFrom:leaveDate?parseDate(leaveDate,month):null};staff[pool].push(p);byKey.set(key,p);addToken(id,p);addToken(name,p);
 }
 function resolve(token,section,line,pool){token=String(token||'').trim();
  // 永久編號優先；姓名可能重複，絕不可因同名自動挑其中一人。
  const exactIds=[...staff.door,...staff.officer].filter(p=>p.id===token&&(!pool||p.pool===pool));
  let a=exactIds.length?exactIds:(byToken.get(token)||[]).filter(p=>!pool||p.pool===pool);
  if(a.length!==1){errors.push(`${section}第 ${line} 行：${a.length?'姓名不唯一，請改填人員編號':'找不到名冊人員'}「${token}」`);return null;}return a[0];}
 const seenIds=new Map();for(const p of [...staff.door,...staff.officer]){const other=seenIds.get(p.id);if(other)errors.push(`人員編號 ${p.id} 同時屬於 ${names[other.pool]}與${names[p.pool]}；為避免勤務錯置，請先修正重複編號。`);else seenIds.set(p.id,p);}
 if(!staff.door.length||!staff.officer.length)errors.push('請輸入大門與安官兩份名冊；不接受空名冊。');
 for(const row of validLines('kitchen')){if(skipHeader(row))continue;const p=resolve(row.fields[0],'固定伙房',row.line);if(p)p.kitchen=true;}
 const distantRecords=[];
 // 相距超過一個「曆年」才提醒；合法的歷史資料不應每月都產生 60 日噪音。
 const dateIsFar=(start,end)=>end<month.first-366||start>month.last+366;
 const possibleYearTypos=[],yearSuspectRows=[];
 const eventTypes=[['leave','休假'],['training','受訓'],['duty','值星'],['meal','督伙'],['nightcheck','夜查'],['driver','車勤'],['businessDay','業參日']];
 for(const [id,type] of eventTypes)for(const row of validLines(id)){
  if(skipHeader(row))continue;const p=resolve(row.fields[0],type,row.line,type==='值星'||type==='督伙'?'officer':null);if(!p)continue;
  try{const ma={},mb={},start=parseDate(row.fields[1],month,ma),end=parseDate(row.fields[2]||row.fields[1],month,mb);
   if(start===null||end===null)throw Error('缺少日期');if(end<start)throw Error('結束日早於開始日');
    if(adjacentYearTypo(month,start,end,ma,mb)){
     possibleYearTypos.push(`${type}第 ${row.line} 行：${dateText(start)}～${dateText(end)}（目前排 ${month.y}/${pad(month.m)}，請確認年份）`);
     yearSuspectRows.push([id,row.fields.map(x=>String(x||'').trim()).join('\u001f')]);
    }
    else if(dateIsFar(start,end))distantRecords.push(`${type}第 ${row.line} 行：${dateText(start)}～${dateText(end)}`);
    p.events.push({type,start,end});
  }catch(e){errors.push(`${type}第 ${row.line} 行：${e.message}`);}
 }
 for(const row of validLines('exempt')){
  if(skipHeader(row))continue;const p=resolve(row.fields[0],'勤務資格',row.line);if(!p)continue;
  const kind=String(row.fields[1]||'').trim();let typ='';if(kind==='義務役'||kind==='義務役（週六、日禁排）')typ='義務役';else if(/全面|全免|免哨/.test(kind))typ='all';else if(/免夜|不用夜/.test(kind))typ='night';else if(/免午|午間/.test(kind))typ='noon';
  if(!typ){errors.push('勤務資格第 '+row.line+' 行限制類型無法辨識：'+kind);continue;}
  try{const ma={},mb={},start=parseDate(row.fields[2],month,ma),end=parseDate(row.fields[3],month,mb);
   if((start===null)!==(end===null))throw Error('生效日與結束日請同時填寫，或同時留空表示永久');
    if(start!==null&&end<start)throw Error('結束日早於開始日');
    if(start!==null&&adjacentYearTypo(month,start,end,ma,mb)){
     possibleYearTypos.push(`勤務資格第 ${row.line} 行：${dateText(start)}～${dateText(end)}（目前排 ${month.y}/${pad(month.m)}）`);
     yearSuspectRows.push(['exempt',row.fields.map(x=>String(x||'').trim()).join('\u001f')]);
    }
    else if(start!==null&&dateIsFar(start,end))distantRecords.push(`勤務資格第 ${row.line} 行：${dateText(start)}～${dateText(end)}`);
    p.events.push({type:typ,start:start??-999999,end:end??999999});
  }catch(e){errors.push('勤務資格第 '+row.line+' 行：'+e.message);}
 }
 if(possibleYearTypos.length)warn('DATE_YEAR_SUSPECT',`⚠ 發現 ${possibleYearTypos.length} 筆疑似填成前一年／後一年的紀錄，休假或禁排可能因此失效。請核對：\n${possibleYearTypos.slice(0,6).join('\n')}${possibleYearTypos.length>6?'\n…其餘請到勤務紀錄核對':''}`);
 if(distantRecords.length)warn('DATE_YEAR_FAR',`⚠ 有 ${distantRecords.length} 筆紀錄的年份與本月相差超過 1 年，可能是歷史資料或年份錯誤；請核對：\n${distantRecords.slice(0,6).join('\n')}${distantRecords.length>6?'\n…其餘請核對原始紀錄':''}`);
 const seenBusiness=new Set();
 for(const row of validLines('business')){if(skipHeader(row))continue;const p=resolve(row.fields[0],'業參',row.line);if(!p)continue;
  const val=row.fields[1]?Number(row.fields[1]):1/3;if(!Number.isFinite(val)||val<=0||val>1){errors.push('業參第 '+row.line+' 行：權重須大於 0 且不超過 1');continue;}
  if(seenBusiness.has(p.key)){errors.push(`業參第 ${row.line} 行：${p.name} 重複設定，請保留一筆`);continue;}
  seenBusiness.add(p.key);p.weight=val;}
 const manualCarry=new Set();
 for(const row of validLines('carry')){if(skipHeader(row))continue;const p=resolve(row.fields[0],'跨月補償',row.line);if(!p)continue;
  const val=Number(row.fields[1]);if(!Number.isInteger(val)||val<0){errors.push('跨月補償第 '+row.line+' 行：須輸入非負整數');continue;}
  if(manualCarry.has(p.key)){errors.push(`跨月補償第 ${row.line} 行：${p.name} 重複登記，請保留一筆`);continue;}
  p.carry=val;p.carrySource='手動';manualCarry.add(p.key);}
 const priorKey=dateText(month.first-1).slice(0,7),prior=appStore?.months?.[priorKey];let autoCarry=0,autoCarryPeople=0;
 const priorStale=!!(prior?.schedule&&(prior.needsRuleRepair||prior.inputSig!==signatureForMonth(priorKey)));
 if(priorStale)errors.push('前月 '+priorKey+' 班表已過期（不論是否封存），不可依賴舊班次作跨月驗證；請先更新前月班表。');
 if(prior?.locked&&prior.compensationOut&&!priorStale){
  for(const pool of ['door','officer'])for(const p of staff[pool]){
   const amount=Number(prior.compensationOut?.[pool]?.[p.id]||0);
   if(!manualCarry.has(p.key)&&Number.isSafeInteger(amount)&&amount>0){p.carry=amount;p.carrySource='前月自動';autoCarry+=amount;autoCarryPeople++;}
  }
  if(autoCarryPeople)warn('AUTO_CARRY',`已從封存前月帶入 ${autoCarryPeople} 人、共 ${autoCarry} 班待減額；手動輸入者優先，請核對。`);
  if(manualCarry.size)warn('MANUAL_CARRY','有手動跨月補償紀錄：已優先使用手動數字，不會再與前月待減額相加。');
 }else if(prior?.schedule)warn('PRIOR_UNLOCKED','前月已有班表但尚未封存，或缺少補償快照：本月不會自動套用跨月補償。');
 const hist=[];
 for(const row of validLines('history')){
  if(skipHeader(row))continue;const f=row.fields,pool=/^(大門|door|衛哨)$/i.test(f[0])?'door':/^(安官|officer|安全士官)$/i.test(f[0])?'officer':null;
  if(!pool){errors.push('跨月班次第 '+row.line+' 行：勤務類別須為「大門」或「安官」');continue;}
  const p=resolve(f[3],'跨月班次',row.line,pool);if(!p)continue;
  try{const day=parseDate(f[1],month),num=Number(f[2]);const slot=slots[pool].find(s=>s.num===num);
   if(day===null)throw Error('缺少日期');
   if(!slot)throw Error('無效時段編號 '+f[2]);if(day>=month.first&&day<=month.last)throw Error('此欄只收跨月班次，當月班次由系統產生');
   const t={pool,day,num,start:slot.start,end:slot.end,dur:slot.end-slot.start,key:`${pool}:${day}:${num}`,hist:true};
   if(hist.some(z=>z.key===t.key))throw Error('重複班次');p.history.push(t);hist.push({...t,person:p});
  }catch(e){errors.push('跨月班次第 '+row.line+' 行：'+e.message);}
 }
 // 由已儲存的上一月班表，自動參照月底班次；不覆寫人工跨月紀錄。
 let autoHistory=0;
 const prevKey=dateText(month.first-1).slice(0,7),prev=appStore?.months?.[prevKey];
 if(prev?.schedule){
  for(const pool of ['door','officer'])for(const entry of (prev.schedule[pool]||[])){
   const [day,num,who]=entry;
   if(!who||day<month.first-14||day>=month.first)continue;
   const slot=slots[pool].find(s=>s.num===Number(num)),p=staff[pool].find(p=>p.id===who);
   if(!slot||!p){warn('PRIOR_ID_MISSING','前月部分歷史班次無法對應現行名冊，跨月檢查不完整。');continue;}
   const key=`${pool}:${day}:${num}`;if(hist.some(t=>t.key===key))continue;
   const t={pool,day,num:Number(num),start:slot.start,end:slot.end,dur:slot.end-slot.start,key,hist:true};
   p.history.push(t);hist.push({...t,person:p});autoHistory++;
  }
  if(autoHistory)warn('PRIOR_HISTORY',`已自動參照 ${prevKey} 月末 ${autoHistory} 筆勤務，供跨月限制檢查；如上月班表尚未核定，請先確認。`);
 }
 if(!validLines('history').length&&!autoHistory)warn('NO_HISTORY','未輸入跨月既有班次：月初「前月連站天數／同時段／星期日留守」無法完整驗證。');
 {const bad=ruleSettingsProblems();if(bad.length)errors.push('排班規則設定不正確：'+bad.join('；'));}
 const holidays=holidaySet(month,$('holidayOverrides').value,errors);
 if(month.y!==2026&&month.y!==2027)warn('HOLIDAY_YEAR','本程式未預置 '+month.y+' 年國定假日：請在「國定假日與連假」手動輸入，否則假日班會被當成平日。');
 else if(month.y===2027)warn('HOLIDAY_2027','2027 年國定假日為依媒體彙整的行事曆預置，請對照人事行政總處公告核對。');
 const tasks={door:[],officer:[]};for(const pool of ['door','officer'])for(let day=month.first;day<=month.last;day++)for(const sl of slots[pool]){
  const t={pool,day,holiday:holidays.has(day),num:sl.num,start:sl.start,end:sl.end,dur:sl.end-sl.start,key:`${pool}:${day}:${sl.num}`,hist:false};tasks[pool].push(t);
 }
 // 安官督伙日遇到多筆重複記錄，按獨立日期計一次折抵。
 for(const p of staff.officer){
  const days=new Set();
  for(const e of p.events)if(e.type==='督伙'){
   for(let day=Math.max(month.first,e.start);day<=Math.min(month.last,e.end);day++)days.add(day);
  }
  p.mealCredit=days.size;
 }
 const overlaps=new Map();
 for(const p of [...staff.door,...staff.officer]){
  const leaves=p.events.filter(e=>e.type==='休假');
  const meals=new Set(),drives=new Set();
  for(const e of p.events){
   if(e.type!=='督伙'&&e.type!=='車勤')continue;
   const dates=e.type==='督伙'?meals:drives;
   for(let d=Math.max(month.first,e.start);d<=Math.min(month.last,e.end);d++)dates.add(d);
  }
  function mark(label,day){if(!overlaps.has(label))overlaps.set(label,[]);overlaps.get(label).push(p.id+' '+dateText(day).slice(5));}
  for(const day of meals){
   if(leaves.some(e=>e.start<=day&&day<=e.end))mark('休假期間另登督伙',day);
   if(drives.has(day))mark('同日登記督伙及車勤',day);
   if(meals.has(day-1))mark('連續兩日登記督伙（列第二天）',day);
  }
  for(const day of drives)if(leaves.some(e=>e.start<=day&&day<=e.end))mark('休假期間另登車勤',day);
 }
 for(const [label,entries] of overlaps)warn('FIXED_DUTY_OVERLAP',label+' '+entries.length+' 筆：'+entries.join('、')+'。請核對原始紀錄。'+(label==='休假期間另登督伙'?'目前督伙仍計入折抵。':''));
 return {month,staff,tasks,hist,warnings,errors,autoCarry,autoCarryPeople,yearSuspectRows};
}
function night(t){return t.start<6||t.start>=22;}
function noon(t){return (t.pool==='door'&&t.start===12)||(t.pool==='officer'&&t.start===12);}
function sundayStay(t){return weekday(t.day)==='日'&&(t.pool==='door'? t.start>=6&&t.start<22:t.start===18);}

// #endregion
