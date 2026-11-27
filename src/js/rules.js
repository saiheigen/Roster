
'use strict';
// 單一規則表：個人勤務事件（休假、受訓、車勤…）對班次的禁排範圍，只在這裡定義一次。
// r=[錨點,偏移,錨點,偏移]：S=事件起日、E=事件迄日，涵蓋 [錨點1+偏移1, 錨點2+偏移2] 的日期。
// slots：night=22–06 夜哨、noon=12 時開始之午間班、early=次日清晨（大門 08 時前、安官 06 時前）。
// pool：只適用該勤務。weekend：只限週六、週日。why：排班與巡檢顯示的原因。
// 排班判定（staticReason）與獨立巡檢（schedule-audit）各自以不同寫法讀取這張表，彼此交叉核對。
const GUARD_EVENT_RULES=Object.freeze({
 '休假':[{r:['S',0,'E',1],why:'休假／收假'},{r:['S',-1,'S',-1],slots:'night',why:'假前夜哨'}],
 '受訓':[{r:['S',-1,'E',0],why:'受訓'}],
 '值星':[{r:['S',-1,'E',1],pool:'officer',why:'值星'}],
 '督伙':[{r:['S',-1,'E',1],pool:'officer',why:'督伙／安官休息'}],
 '夜查':[{r:['S',-1,'E',1],why:'夜查'}],
 '車勤':[{r:['S',0,'E',0],why:'車勤'},
         {r:['E',1,'E',1],slots:'early',why:'車勤次日（大門08時起、安官06時起可排）'},
         {r:['S',-1,'S',-1],slots:'night',why:'出車前夜哨'}],
 '義務役':[{r:['S',0,'E',0],weekend:true,why:'義務役週末禁排'}],
 'all':[{r:['S',0,'E',0],why:'全面免哨'}],
 'night':[{r:['S',0,'E',0],slots:'night',why:'免夜哨'}],
 'noon':[{r:['S',0,'E',0],slots:'noon',why:'免午間艱苦哨'}]
});
// 班與班之間的規則（不屬於個人事件）。排班判定、獨立巡檢、局部修復、最少異動與人力估算都讀這裡。
const GUARD_SHIFT_RULES=({
 door:({
  maxConsecutiveDays:2, // 大門最多連站幾天（2＝不可連續三天）
  restHours:6,          // 兩班之間至少休息幾小時（同日與跨日都算）
  dailyMaxHours:6,      // 同一天最多幾小時
  dailyMaxShifts:3,     // 同一天最多幾班
  twoDayMaxShifts:3     // 相鄰兩天合計最多幾班
 }),
 officer:({
  minGapDays:1,         // 安官兩班至少相隔幾天（1＝可相鄰日；2＝站一歇一）
  maxConsecutiveDays:2, // 安官最多連站幾天（2＝不可連續三天）；一天最多一班
  restHours:6           // 安官跨日兩班之間至少休息幾小時（例：22–24 接隔天 06–12 可，接 00–02 不可）
 }),
 shared:({
  sameSlotWindowDays:2, // 幾天內不可重複同一時段
  sundayStayGapWeeks:1  // 星期日留守後幾週內不可再留守（1＝不可連續兩週）
 })
});
// 離線精算引擎（HiGHS）直接讀取上表，數值改變時模型與最優證明跟著改變。
// 每人每月班數「軟上限」：建議實站班數不超過上限，超出的班數按比例轉給還沒到上限的人；
// 只有所有人都到上限仍排不下時才會超過，並在班表頁列出。
const GUARD_FAIRNESS=({
 monthlyCapRatio:1.5,                              // 上限＝本月可排人員平均班數 × 此倍數（無條件進位）；0＝不設上限
 monthlyCapFixed:({door:null,officer:null}), // 填數字則改用固定上限，例如 door:12
 // 勤務負擔點數：每一班依時段給點數，假日再加點；在「每人總班數已最公平」的前提下平衡點數，並跨月累計。
 burdenMode:1,          // 1＝依勤務負擔點數平衡；0＝舊算法（夜哨、午哨分開平衡）
 holidayBonus:0.5,      // 假日班額外加的點數
 holidayWeight:1,       // 假日班數平均的重要性：1＝多 1 個假日班視同多 1 點的差距；0＝只靠假日加點
 points:({
  door:[1.5,2,2,2,1,1,1,1.5,1,1,1,1],   // 22–24、00–02、02–04、04–06、06–08、08–10、10–12、12–14、14–16、16–18、18–20、20–22
  officer:[1.5,2,2,2,3,3.5,2]          // 22–24、00–02、02–04、04–06、06–12、12–18、18–22
 })
});
// 預設值＝上方表格的數值；各月份的自訂值存在「排班規則與每人上限」設定（#ruleSettings，只存與預設不同的項目）。
const GUARD_RULE_DEFAULTS=JSON.parse(JSON.stringify({shift:GUARD_SHIFT_RULES,fairness:GUARD_FAIRNESS}));
const GUARD_RULE_FIELDS=[
 ['shift.door.maxConsecutiveDays','大門最多連站','天',1,7,1],
 ['shift.door.restHours','兩班之間至少休息','小時',0,20,1],
 ['shift.door.dailyMaxShifts','大門同一天最多','班',1,12,1],
 ['shift.door.dailyMaxHours','大門同一天最多','小時',2,24,1],
 ['shift.door.twoDayMaxShifts','大門相鄰兩天合計最多','班',1,24,1],
 ['shift.officer.minGapDays','安官兩班至少相隔','天（1＝可相鄰日；2＝站一歇一）',1,7,1],
 ['shift.officer.maxConsecutiveDays','安官最多連站','天（一天最多一班）',1,7,1],
 ['shift.officer.restHours','安官跨日兩班至少休息','小時',0,20,1],
 ['shift.shared.sameSlotWindowDays','同一時段幾天內不重複','天',1,7,1],
 ['shift.shared.sundayStayGapWeeks','星期日留守後幾週內不再留守','週',0,4,1],
 ['fairness.monthlyCapRatio','每人每月上限＝可排人員平均的','倍（0＝不設上限）',0,5,0.1],
 ['fairness.monthlyCapFixed.door','大門固定上限（留空＝依倍數）','班',1,62,1,true],
 ['fairness.monthlyCapFixed.officer','安官固定上限（留空＝依倍數）','班',1,62,1,true],
 ['fairness.burdenMode','公平計算方式','1＝勤務負擔點數；0＝夜哨午哨分開（舊）',0,1,1],
 ['fairness.holidayBonus','假日班額外加','點',0,3,0.5],
 ['fairness.holidayWeight','假日班數平均的重要性','1＝多 1 個假日班視同差 1 點',0,3,0.5],
 ...['22–24','00–02','02–04','04–06','06–08','08–10','10–12','12–14','14–16','16–18','18–20','20–22'].map((t,i)=>['fairness.points.door.'+i,'大門 '+t,'點',0.5,5,0.5]),
 ...['22–24','00–02','02–04','04–06','06–12','12–18','18–22'].map((t,i)=>['fairness.points.officer.'+i,'安官 '+t,'點',0.5,8,0.5])
];
// 每一班的負擔點數（×2 取整數，供精算引擎使用）；舊算法時回傳 null
function burdenScaled(pool,t){return Math.round(2*((GUARD_FAIRNESS.points[pool][t.num-1]||1)+(t.holiday?GUARD_FAIRNESS.holidayBonus:0)));}
function burdenOn(){return GUARD_FAIRNESS.burdenMode===1;}
function guardRulePath(root,path){const keys=path.split('.'),last=keys.pop();let o=root;for(const k of keys)o=o?.[k];return [o,last];}
// 依設定文字套用規則；文字無法解讀時回傳錯誤訊息（並維持預設值）。
function applyRuleSettings(text){
 let custom={},error='';
 if(text&&text.trim()){try{custom=JSON.parse(text);if(!custom||typeof custom!=='object')throw Error();}catch(_){custom={};error='排班規則設定無法讀取，已暫用預設值';}}
 const live={shift:GUARD_SHIFT_RULES,fairness:GUARD_FAIRNESS};
 for(const [path] of GUARD_RULE_FIELDS){
  const [def,key]=guardRulePath(GUARD_RULE_DEFAULTS,path),[target]=guardRulePath(live,path),[given]=guardRulePath(custom,path);
  target[key]=given&&Object.prototype.hasOwnProperty.call(given,key)?given[key]:def[key];
 }
 return error;
}
function ruleSettingsProblems(){
 const bad=[],live={shift:GUARD_SHIFT_RULES,fairness:GUARD_FAIRNESS};
 for(const [path,label,unit,lo,hi,step,nullable] of GUARD_RULE_FIELDS){
  const [o,k]=guardRulePath(live,path),v=o[k];
  if(nullable&&v==null)continue;
  const okNumber=typeof v==='number'&&Number.isFinite(v)&&(step<1||Number.isInteger(v));
  const okRange=okNumber&&(path==='fairness.monthlyCapRatio'?(v===0||(v>=1&&v<=hi)):(v>=lo&&v<=hi))&&(step!==0.5||Math.abs(v*2-Math.round(v*2))<1e-9);
  if(!okRange)bad.push(label+'須為 '+(path==='fairness.monthlyCapRatio'?'0 或 1–'+hi:lo+'–'+hi)+(nullable?'（或留空）':''));
 }
 return bad;
}
function customRuleCount(){
 const live={shift:GUARD_SHIFT_RULES,fairness:GUARD_FAIRNESS};
 return GUARD_RULE_FIELDS.filter(([path])=>{const [a,k]=guardRulePath(live,path),[b]=guardRulePath(GUARD_RULE_DEFAULTS,path);return a[k]!==b[k];}).length;
}
function monthlyCap(pool,shifts,eligible){
 const fixed=GUARD_FAIRNESS.monthlyCapFixed[pool];if(fixed!=null)return fixed;
 const r=GUARD_FAIRNESS.monthlyCapRatio;if(!r||!eligible)return Infinity;
 return Math.ceil(r*shifts/eligible);
}
function guardNumeral(n){return '〇一二三四五六七八九十'[n]||String(n);}
function sundayStayRepeat(delta){const w=GUARD_SHIFT_RULES.shared.sundayStayGapWeeks;return delta>0&&delta%7===0&&delta<=7*w;}
