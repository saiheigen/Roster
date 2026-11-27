'use strict';
// 第三套獨立驗算器：只讀規則表的「數值」，判斷邏輯完全自行實作，
// 不呼叫工作台內的 staticReason／conflict／巡檢程式。
// 輸入為 page.js 的 dumpSchedule() 結果。

const weekday = d => (d + 4) % 7; // 1970-01-01 為星期四；0=星期日
const isNight = t => t.start < 6 || t.start >= 22;
const isNoon = t => t.start === 12;
const isSundayStay = t => weekday(t.day) === 0 &&
  (t.pool === 'door' ? t.start >= 6 && t.start < 22 : t.start === 18);

function eventBlocks(rules, e, t, pool) {
  for (const rule of rules[e.type] || []) {
    if (rule.pool && rule.pool !== pool) continue;
    const at = { S: e.start, E: e.end };
    const lo = at[rule.r[0]] + rule.r[1], hi = at[rule.r[2]] + rule.r[3];
    if (t.day < lo || t.day > hi) continue;
    if (rule.weekend && ![0, 6].includes(weekday(t.day))) continue;
    if (rule.slots === 'night' && !isNight(t)) continue;
    if (rule.slots === 'noon' && !isNoon(t)) continue;
    if (rule.slots === 'early' && t.start >= (pool === 'door' ? 8 : 6)) continue;
    return true;
  }
  return false;
}

function verifySchedule(dump) {
  const R = dump.shiftRules, E = dump.eventRules;
  const D = R.door, O = R.officer, S = R.shared;
  const problems = [];
  const add = (kind, detail) => problems.push({ kind, detail });
  for (const pool of ['door', 'officer']) {
    const people = new Map(dump[pool].people.map(p => [p.id, p]));
    const own = new Map(dump[pool].people.map(p => [p.id, p.history.map(t => ({ ...t, pool, hist: true }))]));
    for (const t of dump[pool].tasks) {
      if (!t.who) continue;
      const p = people.get(t.who);
      if (!p) { add('unknown-person', t.who); continue; }
      const task = { ...t, pool, hist: false };
      own.get(t.who).push(task);
      if (p.inactiveFrom != null && t.day >= p.inactiveFrom) add('inactive', `${t.who} ${t.day}`);
      if (p.kitchen) add('kitchen', t.who);
      for (const e of p.events) if (eventBlocks(E, e, task, pool)) add('event:' + e.type, `${t.who} day ${t.day} #${t.num}`);
    }
    for (const [who, list] of own) {
      const cur = list.filter(t => !t.hist);
      const byDay = new Map();
      for (const t of list) { if (!byDay.has(t.day)) byDay.set(t.day, []); byDay.get(t.day).push(t); }
      for (const t of cur) for (const u of list) {
        if (u === t) continue;
        const gap = Math.abs(u.day - t.day);
        if (gap <= S.sameSlotWindowDays && u.num === t.num) add(pool + ':same-slot', `${who} ${t.day}/${u.day}`);
        if (pool === 'door' && gap === 1) {
          const [a, b] = u.day < t.day ? [u, t] : [t, u];
          if (24 + b.start - a.end < D.restHours) add('door:cross-day-rest', `${who} ${a.day}`);
        }
        if (pool === 'officer' && gap > 0 && gap < O.minGapDays) add('officer:gap', `${who} ${t.day}/${u.day}`);
        if (pool === 'officer' && gap === 1 && O.restHours) {
          const [a, b] = u.day < t.day ? [u, t] : [t, u];
          if (24 + b.start - a.end < O.restHours) add('officer:cross-day-rest', `${who} ${a.day}`);
        }
        if (gap > 0 && gap % 7 === 0 && gap <= 7 * S.sundayStayGapWeeks && isSundayStay(t) && isSundayStay(u))
          add(pool + ':sunday-stay', `${who} ${t.day}/${u.day}`);
      }
      for (const [day, g] of byDay) {
        const touchesMonth = g.some(t => !t.hist) || (byDay.get(day + 1) || []).some(t => !t.hist);
        if (!touchesMonth) continue;
        if (pool === 'officer') {
          if (g.length > 1) add('officer:same-day', `${who} ${day}`);
          if (O.maxConsecutiveDays) {
            let run = 1; while (byDay.has(day + run)) run++;
            if (!byDay.has(day - 1) && run > O.maxConsecutiveDays) add('officer:consecutive', `${who} ${day} run ${run}`);
          }
          continue;
        }
        if (g.reduce((n, t) => n + t.dur, 0) > D.dailyMaxHours) add('door:daily-hours', `${who} ${day}`);
        if (g.length > D.dailyMaxShifts) add('door:daily-shifts', `${who} ${day}`);
        const o = g.slice().sort((a, b) => a.start - b.start);
        for (let k = 1; k < o.length; k++) if (o[k].start - o[k - 1].end < D.restHours) add('door:same-day-rest', `${who} ${day}`);
        if (g.length + (byDay.get(day + 1) || []).length > D.twoDayMaxShifts) add('door:two-day', `${who} ${day}`);
        let run = 1; while (byDay.has(day + run)) run++;
        if (!byDay.has(day - 1) && run > D.maxConsecutiveDays) add('door:consecutive', `${who} ${day} run ${run}`);
      }
    }
  }
  return problems;
}

function holidayImbalance(dump, pool) {
  const count = new Map(), hol = new Map(); let F = 0, H = 0;
  for (const t of dump[pool].tasks) {
    if (!t.who) continue; F++; count.set(t.who, (count.get(t.who) || 0) + 1);
    if (t.holiday) { H++; hol.set(t.who, (hol.get(t.who) || 0) + 1); }
  }
  let sum = 0; for (const [w, c] of count) sum += (F * (hol.get(w) || 0) - H * c) ** 2;
  return F ? sum / (F * F) : 0;
}

module.exports = { verifySchedule, holidayImbalance };
