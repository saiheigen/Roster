// #region 勤務資格及跨日衝突
function eventRuleReason(e,t,p){
 for(const rule of (GUARD_EVENT_RULES[e.type]||[])){
  if(rule.pool&&rule.pool!==p.pool)continue;
  const lo=(rule.r[0]==='S'?e.start:e.end)+rule.r[1],hi=(rule.r[2]==='S'?e.start:e.end)+rule.r[3],d=t.day;
  if(d<lo||d>hi)continue;
  if(rule.weekend&&!['六','日'].includes(weekday(d)))continue;
  if(rule.slots==='night'&&!night(t))continue;
  if(rule.slots==='noon'&&!noon(t))continue;
  if(rule.slots==='early'&&!(t.start<(t.pool==='door'?8:6)))continue;
  return rule.why;
 }
 return '';
}
function staticReason(p,t){if(p.inactiveFrom!==null&&p.inactiveFrom!==undefined&&t.day>=p.inactiveFrom)return '離單位／停用';if(p.kitchen)return '固定伙房人員';
 for(const e of p.events){const why=eventRuleReason(e,t,p);if(why)return why;}return '';
}
function conflict(p,t,occupied){const own=occupied.get(p.key)||[];let sameDay=0,hours=0;
 const D=GUARD_SHIFT_RULES.door,O=GUARD_SHIFT_RULES.officer,S=GUARD_SHIFT_RULES.shared,K=D.maxConsecutiveDays;
 let prev=0,next=0;const near=new Set();
 for(const a of own){const diff=Math.abs(a.day-t.day);
  if(t.pool==='door'){
   const offset=a.day-t.day;
   if(offset<0&&offset>=-K)near.add(offset);
   if(offset>0&&offset<=K)near.add(offset);
   if(offset===-1)prev++;
   if(offset===1)next++;
   let left=0,right=0;while(near.has(-(left+1)))left++;while(near.has(right+1))right++;
   if(left+right+1>K)return '大門不可連續'+guardNumeral(K+1)+'天站哨';
   if(diff===1 && (offset<0?24+t.start-a.end:24+a.start-t.end)<D.restHours)return '大門跨日休息不足'+guardNumeral(D.restHours)+'小時';
  }else{
   if(diff>0&&diff<O.minGapDays)return O.minGapDays===2?'安官站一歇一／相鄰兩日':'安官兩班需相隔'+guardNumeral(O.minGapDays)+'天';
   const offset=a.day-t.day,KO=O.maxConsecutiveDays;
   if(offset!==0&&Math.abs(offset)<=KO)near.add(offset);
   let left=0,right=0;while(near.has(-(left+1)))left++;while(near.has(right+1))right++;
   if(left+right+1>KO)return '安官不可連續'+guardNumeral(KO+1)+'天站哨';
   if(diff===1&&(offset<0?24+t.start-a.end:24+a.start-t.end)<O.restHours)return '安官跨日休息不足'+guardNumeral(O.restHours)+'小時';
  }
  if(diff<=S.sameSlotWindowDays&&a.num===t.num)return (S.sameSlotWindowDays===2?'兩':guardNumeral(S.sameSlotWindowDays))+'日內同時段重複';
  if(sundayStay(a)&&sundayStay(t)&&sundayStayRepeat(diff))return '連續兩週星期日留守';
  if(diff===0){sameDay++;hours+=a.dur;if(t.pool==='officer')return '安官同日已有班次';
   if(!(a.end+D.restHours<=t.start||t.end+D.restHours<=a.start))return '大門同日勤務間隔不足'+guardNumeral(D.restHours)+'小時';
  }
 }
 if(t.pool==='door'&&sameDay+1+Math.max(prev,next)>D.twoDayMaxShifts)return '大門相鄰兩日合計最多'+guardNumeral(D.twoDayMaxShifts)+'班';
 if(t.pool==='door'&&(sameDay>=D.dailyMaxShifts||hours+t.dur>D.dailyMaxHours))return '大門同日總時數超過'+guardNumeral(D.dailyMaxHours)+'小時';
 return '';
}
function calcGoals(m,pool,staticOpts){
 const people=m.staff[pool],count=m.tasks[pool].length;
 const weights=people.map(p=>Math.max(0,staticOpts.get(p.key)||0)*p.weight);
 const total=weights.reduce((a,b)=>a+b,0),goals=new Map();
 if(total===0){people.forEach(p=>goals.set(p.key,0));return goals;}
 let base=weights.map(w=>Math.floor(count*w/total));
 let left=count-base.reduce((a,b)=>a+b,0);
 const ranking=weights.map((w,i)=>({i,rem:count*w/total-base[i]})).sort((a,b)=>b.rem-a.rem||a.i-b.i);
 for(let j=0;j<left;j++)base[ranking[j].i]++;
 people.forEach((p,i)=>goals.set(p.key,base[i]));return goals;
}
// v6.1: base goals are used for 1:1 compensation accounting; actual-targets are
// separate planning targets so redistributed shifts do not erase next-month credit.
// Soft target only: all hard eligibility/rest restrictions still take precedence.
function planTargets(m,pool,goals,staticAvailability,cap=Infinity,realistic=null){
 const people=m.staff[pool],n=m.tasks[pool].length;
 const credits=people.map(p=>Math.max(0,Number(p.carry||0)+Number(p.mealCredit||0)));
 const base=people.map(p=>Math.max(0,goals.get(p.key)||0));
 const target=base.map((b,i)=>Math.max(0,b-credits[i]));
 const slotCapacity=people.map(p=>Math.max(0,staticAvailability.get(p.key)||0));
 const capacity=slotCapacity.map((c,i)=>realistic?Math.min(c,realistic[i]):c);
 const eligible=people.map((p,i)=>i).filter(i=>slotCapacity[i]>0);
 let free=n-target.reduce((a,b)=>a+b,0);
 if(free<0)throw Error('整數配額出現不合理的總目標');
 for(let i=0;i<target.length;i++)if(target[i]>cap){free+=target[i]-cap;target[i]=cap;}
 const limit=i=>Math.min(capacity[i],cap);
 while(free>0){
  let candidates=eligible.filter(i=>target[i]<limit(i)&&credits[i]===0);
  if(!candidates.length)candidates=eligible.filter(i=>target[i]<limit(i));
  if(candidates.length){
   candidates.sort((a,b)=>{
    const wa=Math.max(.01,capacity[a]*people[a].weight),wb=Math.max(.01,capacity[b]*people[b].weight);
    return (target[a]-base[a])/wa-(target[b]-base[b])/wb||a-b;
   });
  }else{
   // 所有人都到上限仍排不下：由目前目標最少、仍有空檔的人依序多分一班（盡量分散，不集中在一人）
   candidates=eligible.filter(i=>target[i]<slotCapacity[i]);
   if(!candidates.length)break; // availability limitations: target is guidance, not fabricated capacity
   candidates.sort((a,b)=>target[a]-target[b]||a-b);
  }
  target[candidates[0]]++;free--;
 }
 return new Map(people.map((p,i)=>[p.key,target[i]]));
}
function calcActualTargets(m,pool,goals,staticAvailability){
 const plan=planTargets(m,pool,goals,staticAvailability);
 const people=m.staff[pool],n=m.tasks[pool].length;
 const eligibleCount=people.filter(p=>(staticAvailability.get(p.key)||0)>0).length;
 const cap=monthlyCap(pool,n,eligibleCount),avg=n/Math.max(1,eligibleCount);
 m.capInfo=m.capInfo||{};
 const highest=map=>Math.max(0,...map.values());
 if(!Number.isFinite(cap)||highest(plan)<=cap){m.capInfo[pool]={cap,avg,applied:false,over:[],before:highest(plan),after:highest(plan)};return plan;}
 // 轉移時用「實際能站的上限」估算，避免把班推給名義上可排、實際排不下的人
 const R=GUARD_SHIFT_RULES;
 const realistic=people.map(p=>{
  const D=new Set(m.tasks[pool].filter(t=>!staticReason(p,t)).map(t=>t.day)).size;
  return pool==='door'?D-Math.floor(D/(R.door.maxConsecutiveDays+1)):R.officer.minGapDays>1?Math.ceil(D/R.officer.minGapDays):D-Math.floor(D/(R.officer.maxConsecutiveDays+1));
 });
 const capped=planTargets(m,pool,goals,staticAvailability,cap,realistic);
 const over=people.filter(p=>capped.get(p.key)>cap).map(p=>p.id);
 m.capInfo[pool]={cap,avg,applied:true,over,before:highest(plan),after:highest(capped)};
 return capped;
}
function seeded(s){let n=s>>>0;return ()=>{n=(Math.imul(1664525,n)+1013904223)>>>0;return n/4294967296;};}

// #endregion
