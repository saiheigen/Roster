
'use strict';
// v6.8.1 · 唯讀檢查器的依賴由工作台傳入；兩套檢查各自判斷結果。
function createScheduleAudit({slots, weekday, dateText}){
// v6.1: independent output-only audit. It never chooses a candidate or changes assignments.
// The checks below are intentionally written separately from staticReason()/conflict().
function independentScheduleAudit(model,solutions,pins={},previousSundayRule=false,previousTwoDayRule=false){
 const out=[],add=m=>{if(out.length<100)out.push(m);};
 if(!model||!solutions?.door||!solutions?.officer){add('班表資料不完整');return out;}
 const actualNames={door:'大門',officer:'安官'};
 const wday=d=>new Date(d*86400000).getUTCDay();
 for(const pool of ['door','officer']){
  const shifts=solutions[pool].tasks||[],rows=slots[pool],people=model.staff[pool]||[],map=new Map(people.map(p=>[p.key,p]));
  const got=new Set(),assignments=new Map(people.map(p=>[p.key,[...(p.history||[])]]));
  let missed=0;
  if(shifts.length!==model.month.days*rows.length)add(actualNames[pool]+' 班次總數不符');
  for(const t of shifts){
   if(got.has(t.key))add('重複班次：'+t.key);got.add(t.key);
   const template=rows.find(row=>row.num===t.num);
   if(!template||t.pool!==pool||t.day<model.month.first||t.day>model.month.last||t.start!==template.start||t.end!==template.end||t.key!==`${pool}:${t.day}:${t.num}`)add('不合法的班次定義：'+t.key);
   const p=solutions[pool].res.get(t.key);
   if(!p){missed++;continue;}
   if(map.get(p.key)!==p){add('人員身分或勤務類別不符：'+t.key);continue;}
   assignments.get(p.key).push(t);
   for(const e of (p.events||[])){
    const d=t.day,anchor={S:e.start,E:e.end};
    let blocked=false;
    for(const rule of (GUARD_EVENT_RULES[e.type]||[])){
     if(rule.pool&&rule.pool!==pool)continue;
     // 永久的勤務資格限制以 ±999999 天表示，因此用區間比較，不逐日列舉
     if(d<anchor[rule.r[0]]+rule.r[1]||d>anchor[rule.r[2]]+rule.r[3])continue;
     if(rule.weekend&&!(wday(d)===0||wday(d)===6))continue;
     if(rule.slots==='night'&&!(t.start<6||t.start>=22))continue;
     if(rule.slots==='noon'&&t.start!==12)continue;
     if(rule.slots==='early'&&t.start>=(pool==='door'?8:6))continue;
     blocked=true;break;
    }
    if(blocked)add(actualNames[pool]+' '+dateText(d)+' '+p.id+' 不符合'+e.type+'禁排');
   }
   if(p.inactiveFrom!==null&&p.inactiveFrom!==undefined&&t.day>=p.inactiveFrom)add(actualNames[pool]+' '+p.id+' 離單位生效日後仍被排班');
   if(p.kitchen)add(actualNames[pool]+' '+p.id+' 是固定伙房人員');
  }
  if(missed!==solutions[pool].missing)add(actualNames[pool]+' 缺班計數和實際班表不一致');
  const statRows=new Map((solutions[pool].stats||[]).map(st=>[st.p.key,st]));
  for(const [pkey,all] of assignments){
   const p=map.get(pkey),current=all.filter(t=>!t.hist),sum=current.reduce((n,t)=>n+t.dur,0),s=statRows.get(pkey);
   if(!s||s.count!==current.length||s.hours!==sum)add(actualNames[pool]+' '+p.id+' 個人班數或時數統計不一致');
   const dayGroups=new Map();for(const t of all){if(!dayGroups.has(t.day))dayGroups.set(t.day,[]);dayGroups.get(t.day).push(t);}
   for(const [day,group] of dayGroups){
    
    const prior=dayGroups.get(day-1),RD=GUARD_SHIFT_RULES.door;
    if(pool==='door'&&!previousTwoDayRule&&prior&&group.length+prior.length>RD.twoDayMaxShifts&&
       (group.some(t=>!t.hist)||prior.some(t=>!t.hist)))add(p.id+' '+dateText(day-1)+' ～ '+dateText(day)+' 大門兩日合計超過三班');
    if(pool==='door'){if(Array.from({length:RD.maxConsecutiveDays},(_,k)=>day-k-1).every(x=>dayGroups.has(x)))add(dateText(day)+' '+p.id+' 大門連續'+guardNumeral(RD.maxConsecutiveDays+1)+'天站哨');}
    if(pool==='officer'&&group.length>1)add(dateText(day)+' '+p.id+' 安官同日多班');
    if(pool==='officer'&&GUARD_SHIFT_RULES.officer.minGapDays<=1){const KO=GUARD_SHIFT_RULES.officer.maxConsecutiveDays,span=Array.from({length:KO},(_,k)=>day-k-1);
     if(span.every(x=>dayGroups.has(x))&&[day,...span].some(x=>dayGroups.get(x).some(t=>!t.hist)))add(dateText(day)+' '+p.id+' 安官連續'+guardNumeral(KO+1)+'天站哨');}
    if(pool==='door'){
     if(group.reduce((n,t)=>n+t.dur,0)>RD.dailyMaxHours)add(dateText(day)+' '+p.id+' 大門勤務超過'+RD.dailyMaxHours+'小時');
     if(group.length>RD.dailyMaxShifts)add(dateText(day)+' '+p.id+' 大門同日超過'+RD.dailyMaxShifts+'班');
     const ordered=group.slice().sort((a,b)=>a.start-b.start);
     for(let k=1;k<ordered.length;k++)if(ordered[k].start-ordered[k-1].end<RD.restHours)add(dateText(day)+' '+p.id+' 兩班休息少於'+RD.restHours+'小時');
    }
   }
   for(let i=0;i<all.length;i++)for(let j=i+1;j<all.length;j++){
    const a=all[i],b=all[j];
    const delta=Math.abs(a.day-b.day);
    if(delta>0&&delta<GUARD_SHIFT_RULES.officer.minGapDays && pool==='officer')add(p.id+' 安官相鄰日期站哨');
    if(delta===1 && pool==='officer' && GUARD_SHIFT_RULES.officer.minGapDays<=1){
     const [early,late]=a.day<b.day?[a,b]:[b,a];
     if(24+late.start-early.end<GUARD_SHIFT_RULES.officer.restHours)add(p.id+' 安官跨日休息少於'+GUARD_SHIFT_RULES.officer.restHours+'小時');
    }
    if(delta===1 && pool==='door'){
     const [early,late]=a.day<b.day?[a,b]:[b,a];
     if(24+late.start-early.end<GUARD_SHIFT_RULES.door.restHours)add(p.id+' 大門跨日休息少於'+GUARD_SHIFT_RULES.door.restHours+'小時');
    }
    if(delta<=GUARD_SHIFT_RULES.shared.sameSlotWindowDays&&a.num===b.num)add(p.id+' 兩日內同時段重複');
    const isStay=t=>wday(t.day)===0&&(t.pool==='door'?t.start>=6&&t.end<=(previousSundayRule?20:22):t.start===18);
    if(delta>0&&delta%7===0&&delta<=7*GUARD_SHIFT_RULES.shared.sundayStayGapWeeks&&(!a.hist||!b.hist)&&isStay(a)&&isStay(b))add(p.id+' 連續週日留守');
   }
  }
  for(const t of shifts){
   const pin=pins[t.key];if(pin!==undefined&&solutions[pool].res.get(t.key)?.id!==pin)add('人工固定班次遭變動：'+t.key);
  }
 }
 return [...new Set(out)];
}
 return Object.freeze({independentScheduleAudit});
}
