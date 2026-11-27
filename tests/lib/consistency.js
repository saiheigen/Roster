'use strict';
// 三套規則判定一致性（模糊測試）
// 同一份班表交給三套各自實作的規則判定：
//   1. 工作台排班用的 staticReason()／conflict()（經 recountSolution 對每一班檢查）
//   2. 工作台的獨立巡檢 independentScheduleAudit()
//   3. 測試包的 verify.js
// 做法：從合法班表出發，隨機把 1～5 個班次改派給別人（不管規則），
// 比較三套各自認為「哪些人違規」。三套結果必須完全相同；任何差異都代表某一套規則寫錯或漏寫。
const { verifySchedule, eventBlocks } = require('./verify');

// 在頁面內產生突變班表並取得 1、2 的判定。回傳每一輪的班表（供 verify.js）與判定結果。
async function mutateInPage(page, { trials, seed }) {
  return page.evaluate(({ trials, seed }) => {
    const K = window.__kit, last = K.last, m = last.m;
    let n = seed >>> 0; const r = () => { n = (Math.imul(1664525, n) + 1013904223) >>> 0; return n / 4294967296; };
    const pick = a => a[Math.floor(r() * a.length)];
    const out = [];
    for (let i = 0; i < trials; i++) {
      const sols = {};
      for (const pool of ['door', 'officer']) { const s = last.solutions[pool]; sols[pool] = { ...s, res: new Map(s.res) }; }
      const changed = [], give = (pool, t, p) => { sols[pool].res.set(t.key, p); changed.push(t.key + '>' + p.id); };
      const mode = i % 5, pool = r() < 0.5 ? 'door' : 'officer', sol = sols[pool], staff = m.staff[pool];
      if (mode === 0) give(pool, pick(sol.tasks), pick(staff));                         // 隨機改派一班
      else if (mode === 1) for (let k = 1 + Math.floor(r() * 5); k--;) {                // 隨機改派數班（兩種勤務都可能）
        const q = r() < 0.5 ? 'door' : 'officer'; give(q, pick(sols[q].tasks), pick(m.staff[q]));
      } else if (mode === 2) {                                                          // 同一人在相鄰幾天被塞好幾班
        const p = pick(staff), d = pick(sol.tasks).day, near = sol.tasks.filter(t => t.day >= d && t.day <= d + 2);
        for (let k = 2 + Math.floor(r() * 3); k--;) give(pool, pick(near), p);
      } else if (mode === 3) {                                                          // 清空某人前後幾天的班，再在兩、三天內隨機給他幾班：
        const p = pick(staff), d = pick(sol.tasks).day;                                 // 只違反一條規則（例如兩日合計班數）的情況才測得出來
        for (const t of sol.tasks) if (t.day >= d - 3 && t.day <= d + 5 && sol.res.get(t.key) === p) { sol.res.set(t.key, null); changed.push(t.key + '>空'); }
        const near = sol.tasks.filter(t => t.day >= d && t.day <= d + (pool === 'door' ? 1 : 2));
        for (let k = 2 + Math.floor(r() * 3); k--;) give(pool, pick(near), p);
      } else {                                                                          // 排在某人事件期間或前後幾天
        const withEvents = staff.filter(p => p.events.length || p.kitchen);
        const p = withEvents.length ? pick(withEvents) : pick(staff), e = p.events.length ? pick(p.events) : null;
        const lo = e ? Math.max(e.start, sol.tasks[0].day) - 2 : sol.tasks[0].day, hi = e ? Math.min(e.end, sol.tasks.at(-1).day) + 2 : lo + 3;
        // 一半機會挑事件的邊界日（開始前一天、開始、結束、結束後一天），規則的起訖差一天最容易寫錯
        const edge = e && r() < 0.5 ? new Set([e.start - 1, e.start, e.end, e.end + 1]) : null;
        const near = sol.tasks.filter(t => edge ? edge.has(t.day) : t.day >= lo && t.day <= hi);
        give(pool, pick(near.length ? near : sol.tasks), p);
      }
      const main = {}, who = {};
      for (const pool of ['door', 'officer']) {
        // 排班判定：每一班都用 staticReason()／conflict() 對「此人其他班＋上月班」檢查（同工作台排班時的判定）
        const sol = sols[pool], own = new Map(m.staff[pool].map(p => [p.key, [...p.history]])), bad = new Set();
        let missing = 0;
        for (const t of sol.tasks) { const p = sol.res.get(t.key); if (p) own.get(p.key).push(t); else missing++; }
        for (const t of sol.tasks) {
          const p = sol.res.get(t.key); if (!p || bad.has(p.id)) continue;
          if (K.staticReason(p, t) || K.conflict(p, t, new Map([[p.key, own.get(p.key).filter(x => x !== t)]]))) bad.add(p.id);
        }
        // 讓巡檢的「班數統計、缺班數」比對通過（這兩項不是本測試要比的規則）
        sol.missing = missing;
        sol.stats = m.staff[pool].map(p => { const cur = own.get(p.key).filter(t => !t.hist); return { p, count: cur.length, hours: cur.reduce((n, t) => n + t.dur, 0) }; });
        main[pool] = [...bad].sort();
        who[pool] = sol.tasks.map(t => sol.res.get(t.key)?.id || null);
      }
      const ids = new Set(['door', 'officer'].flatMap(pool => m.staff[pool].map(p => p.id)));
      const messages = K.auditOf(sols);
      const audit = { door: new Set(), officer: new Set() }, other = [];
      const poolOf = new Map(['door', 'officer'].flatMap(pool => m.staff[pool].map(p => [p.id, pool])));
      for (const msg of messages) {
        const hit = msg.split(/[\s：]/).filter(x => ids.has(x));
        if (!hit.length) { other.push(msg); continue; }
        for (const id of hit) audit[poolOf.get(id)].add(id);
      }
      out.push({ changed, who, main, audit: { door: [...audit.door].sort(), officer: [...audit.officer].sort() }, messages, other });
    }
    return out;
  }, { trials, seed });
}

// 用 page.js 的 dumpSchedule() 取得人員、規則、班次定義，再把每一輪的指派換進去給 verify.js
function verifyPeople(base, who) {
  const dump = JSON.parse(JSON.stringify(base));
  for (const pool of ['door', 'officer']) dump[pool].tasks.forEach((t, i) => { t.who = who[pool][i]; });
  const byPool = { door: new Set(), officer: new Set() };
  for (const v of verifySchedule(dump)) {
    const id = v.detail.split(' ')[0], pool = v.kind.startsWith('officer') ? 'officer' : v.kind.startsWith('door') ? 'door' :
      dump.door.people.some(p => p.id === id) ? 'door' : 'officer';
    byPool[pool].add(id);
  }
  return { door: [...byPool.door].sort(), officer: [...byPool.officer].sort() };
}

async function compare(page, dumpSchedule, { trials = 300, seed = 1 } = {}) {
  const base = await dumpSchedule(page);
  const rounds = await mutateInPage(page, { trials, seed });
  const diffs = []; let flagged = 0;
  for (const x of rounds) {
    const ver = verifyPeople(base, x.who);
    for (const pool of ['door', 'officer']) {
      const a = x.main[pool].join(','), b = x.audit[pool].join(','), c = ver[pool].join(',');
      if (a) flagged++;
      if (a !== b || a !== c) diffs.push({ pool, changed: x.changed, main: a, audit: b, verify: c, messages: x.messages.slice(0, 6) });
    }
    if (x.other.length) diffs.push({ pool: '-', changed: x.changed, other: x.other.slice(0, 4) });
  }
  return { trials: rounds.length, flagged, diffs };
}

// 40 位大門、28 位安官（人力不吃緊，一鍵排班幾秒內完成），休假之外再加上受訓、值星、督伙、夜查、車勤、義務役、免夜哨、免午哨、全面免哨與固定伙房，
// 讓每一種個人事件規則都會被測到。
async function loadEventRich(page, K, syntheticLeave) {
  let n = 20261201; const r = () => { n = (Math.imul(1664525, n) + 1013904223) >>> 0; return n / 4294967296; };
  const id = (pre, k) => pre + String(k).padStart(3, '0'), day = d => '2026/12/' + String(d).padStart(2, '0');
  const range = (pre, count, len) => Array.from({ length: count }, () => {
    const s = 1 + Math.floor(r() * 28); return `${id(pre, 1 + Math.floor(r() * (pre === 'H' ? 40 : 28)))}\t${day(s)}\t${day(Math.min(31, s + Math.floor(r() * len)))}`;
  }).join('\n');
  await K.loadData(page, { door: K.roster('H', '上兵', 40), officer: K.roster('P', '中士', 28),
    leave: [syntheticLeave('H', 40, 0.3, 11), syntheticLeave('P', 28, 0.3, 13)].join('\n') });
  const fields = {
    training: range('H', 3, 4) + '\n' + range('P', 2, 3),
    duty: range('P', 4, 2), meal: range('P', 4, 2),
    nightcheck: range('H', 4, 1) + '\n' + range('P', 3, 1),
    driver: range('H', 6, 1) + '\n' + range('P', 4, 1),
    exempt: [`H004\t義務役\t\t`, `H009\t免夜哨\t\t`, `H014\t免午間\t${day(5)}\t${day(20)}`, `P006\t免夜哨\t\t`, `P011\t全面免哨\t${day(10)}\t${day(14)}`, `H021\t義務役\t\t`].join('\n'),
    kitchen: 'H027'
  };
  await page.evaluate(fields => {
    for (const [k, v] of Object.entries(fields)) { const e = document.getElementById(k); e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); }
  }, fields);
  await page.waitForTimeout(800);
}

// 個人事件（休假、車勤…）、停用、固定伙房的禁排與其他班無關，所以逐一檢查「每個人 × 每一班」全部組合，
// 不靠隨機抽樣：三套判定對每一個組合都必須相同。
async function compareEvents(page, dumpSchedule) {
  const base = await dumpSchedule(page);
  const inPage = await page.evaluate(() => {
    const K = window.__kit, last = K.last, m = last.m, out = {};
    const relevant = /不符合|離單位|伙房/;
    for (const pool of ['door', 'officer']) {
      const tasks = last.solutions[pool].tasks;
      out[pool] = m.staff[pool].map(p => tasks.map(t => {
        const sols = {};
        for (const q of ['door', 'officer']) {
          const s = last.solutions[q];
          sols[q] = { ...s, res: new Map(s.tasks.map(x => [x.key, null])), missing: s.tasks.length, stats: [] };
        }
        sols[pool].res.set(t.key, p); sols[pool].missing--;
        const audit = K.auditOf(sols).some(x => relevant.test(x));
        return [K.staticReason(p, t) ? 1 : 0, audit ? 1 : 0];
      }));
    }
    return out;
  });
  const diffs = []; let pairs = 0, blocked = 0;
  for (const pool of ['door', 'officer']) base[pool].people.forEach((p, i) => base[pool].tasks.forEach((t, j) => {
    const task = { ...t, pool }, [main, audit] = inPage[pool][i][j];
    const ver = (p.inactiveFrom != null && t.day >= p.inactiveFrom) || p.kitchen || p.events.some(e => eventBlocks(base.eventRules, e, task, pool)) ? 1 : 0;
    pairs++; blocked += main;
    if (main !== audit || main !== ver) diffs.push({ pool, who: p.id, day: t.day, num: t.num, main, audit, verify: ver, events: p.events });
  }));
  return { pairs, blocked, diffs };
}

module.exports = { compare, compareEvents, loadEventRich };
