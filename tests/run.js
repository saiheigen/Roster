#!/usr/bin/env node
'use strict';
// 哨務工作台測試包
// 用法：node run.js <工作台.html> [--baseline 舊版.html] [--quick]
//        [--leave 休假.tsv --door 56 --officer 56 [--golden 標準答案.json | --write-golden 標準答案.json]]
//        [--expect-exact-variants] [--report report.json]
//        [--only selftest,demo,stress,variants,consistency,update,people,portfolio,settings,burden,equivalence,real]
const fs = require('fs');
const K = require('./lib/page');
const { verifySchedule, holidayImbalance } = require('./lib/verify');
const Consistency = require('./lib/consistency');
const { updateFlow } = require('./lib/update');
const { peopleFeatures } = require('./lib/people');

const args = process.argv.slice(2);
const opt = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const flag = n => args.includes(n);
const target = args[0];
if (!target || !fs.existsSync(target)) { console.error('請指定工作台 HTML 檔'); process.exit(2); }

const results = [];
function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}
function rng(seed) { let n = seed >>> 0; return () => { n = (Math.imul(1664525, n) + 1013904223) >>> 0; return n / 4294967296; }; }
function syntheticLeave(prefix, n, frac, seed) {
  const r = rng(seed), out = [];
  for (let i = 1; i <= n; i++) if (r() < frac) {
    const s = 1 + Math.floor(r() * 20), e = Math.min(31, s + 4 + Math.floor(r() * 8));
    out.push(`${prefix}${String(i).padStart(3, '0')}\t2026/12/${String(s).padStart(2, '0')}\t2026/12/${String(e).padStart(2, '0')}`);
  }
  return out.join('\n');
}
function checkDump(name, dump, errors, extra = '') {
  if (!dump) return record(name, false, '沒有產生班表');
  const v = verifySchedule(dump);
  const kinds = [...new Set(v.map(x => x.kind))];
  const ok = dump.audit.length === 0 && v.length === 0 && errors.length === 0;
  record(name, ok, `缺班 ${dump.door.missing}/${dump.officer.missing}，巡檢 ${dump.audit.length}，獨立驗算 ${v.length}${kinds.length ? '（' + kinds.join('、') + '）' : ''}，頁面錯誤 ${errors.length}${extra ? '，' + extra : ''}`);
}

// 規則參數變體：用來確認「改規則表數值」確實讓排班、巡檢、修復與精算都跟著改。
const VARIANTS = {
  '預設': [],
  '休息8小時': [['restHours:6,', 'restHours:8,']],
  '最多連站1天': [['maxConsecutiveDays:2, // 大門', 'maxConsecutiveDays:1, // 大門']],
  '同時段3天內不重複': [['sameSlotWindowDays:2,', 'sameSlotWindowDays:3,']],
  '安官站一歇一（v9.0 以前）': [['minGapDays:1,', 'minGapDays:2,']],
  '安官隔3天': [['minGapDays:1,', 'minGapDays:3,']],
  '安官最多連站1天': [['maxConsecutiveDays:2, // 安官', 'maxConsecutiveDays:1, // 安官']],
  '安官休息10小時': [['restHours:6           // 安官', 'restHours:10          // 安官']],
  '留守隔2週': [['sundayStayGapWeeks:1 ', 'sundayStayGapWeeks:2 ']],
  '同日最多2班': [['dailyMaxShifts:3,', 'dailyMaxShifts:2,'], ['twoDayMaxShifts:3 ', 'twoDayMaxShifts:2 ']]
};

async function suiteSelfTest() {
  const { page, errors } = await K.open(target);
  const text = await K.selfTest(page);
  const m = /(\d+)\/(\d+) 項通過/.exec(text);
  record('內建規則自測', !!m && m[1] === m[2] && errors.length === 0, m ? `${m[1]}/${m[2]}` : '找不到結果');
  await page.close();
}

async function suiteDemo() {
  const { page, errors } = await K.open(target);
  await K.loadDemo(page);
  const ms = await K.schedule(page);
  const d1 = await K.dumpSchedule(page);
  checkDump('範例名冊一鍵排班', d1, errors, `${ms} ms`);
  await K.schedule(page);
  const d2 = await K.dumpSchedule(page);
  const same = JSON.stringify(d1.door.tasks) === JSON.stringify(d2.door.tasks) && JSON.stringify(d1.officer.tasks) === JSON.stringify(d2.officer.tasks);
  record('同樣資料重排結果相同', same);
  // 驗算器自我檢查：故意塞入違規，確認抓得到（避免驗算器永遠回報 0）
  {
    const bad = JSON.parse(JSON.stringify(d1));
    const o = bad.officer.tasks, firstDay = o[0].day, who = o.find(t => t.day === firstDay).who, OR = d1.shiftRules.officer;
    let officerKind = 'officer:gap';
    if (OR.minGapDays > 1) o.find(t => t.day === firstDay + 1).who = who;  // 安官相鄰日
    else {                                                                    // 安官連站超過上限
      const K = OR.maxConsecutiveDays || 2;
      for (let k = 0; k <= K; k++) o.find(t => t.day === firstDay + k && t.num === [5, 6, 7][k % 3]).who = who;
      officerKind = 'officer:consecutive';
    }
    const p = bad.door.people.find(x => x.id === bad.door.tasks[100].who);
    p.events.push({ type: '休假', start: bad.door.tasks[100].day, end: bad.door.tasks[100].day }); // 休假日被排班
    const dt = bad.door.tasks, w = dt[28].who; dt[29].who = w;              // 大門同日 06–08 接 08–10
    const kinds = new Set(verifySchedule(bad).map(x => x.kind));
    const want = [officerKind, 'event:休假', 'door:same-day-rest'];
    record('驗算器能抓到故意塞入的違規', want.every(k => kinds.has(k)), [...kinds].join('、'));
  }
  const before = await K.dumpSchedule(page);
  const st = await K.precisionBoth(page);
  const after = await K.dumpSchedule(page);
  for (const pool of ['door', 'officer']) {
    const status = st[pool], proven = /已證明最優/.test(status), holidayProven = /均已證明最優/.test(status);
    checkDump(`精算引擎（${pool === 'door' ? '大門' : '安官'}）`, after, errors,
      `${holidayProven ? '全部目標（含假日）已證明最優' : proven ? '主要目標已證明最優，次要項（勤務負擔點數／假日）未全部證明' : '未完成證明'}，假日失衡 ${holidayImbalance(before, pool).toFixed(2)}→${holidayImbalance(after, pool).toFixed(2)}`);
    if (!proven) record(`精算引擎（${pool}）證明`, false, status.slice(0, 120));
  }
  await page.close();
}

async function suiteStress() {
  const cases = [['40%人休假 56/50', 56, 50, .4], ['人力吃緊 30/20', 30, 20, .1], ['大單位 150/120', 150, 120, .2]];
  if (!flag('--quick')) cases.push(['嚴重不足 22/14', 22, 14, 0]);
  for (const [name, nd, no, frac] of cases) {
    const { page, errors } = await K.open(target);
    await K.loadData(page, { door: K.roster('H', '上兵', nd), officer: K.roster('P', '中士', no),
      leave: [syntheticLeave('H', nd, frac, 7), syntheticLeave('P', no, frac, 9)].filter(Boolean).join('\n') });
    const ms = await K.schedule(page);
    checkDump('壓力情境：' + name, await K.dumpSchedule(page), errors, `${ms} ms`);
    await page.close();
  }
}

async function suiteVariants() {
  for (const [name, edits] of Object.entries(VARIANTS)) {
    const { page, errors } = await K.open(target, edits);
    await K.loadData(page, { door: K.roster('H', '上兵', 30), officer: K.roster('P', '中士', 20) });
    await K.schedule(page);
    const status = (await K.precisionBoth(page, 480000, { doorOnly: true })).door;
    const dump = await K.dumpSchedule(page);
    const proven = /已證明最優/.test(status);
    checkDump('規則變體：' + name, dump, errors, proven ? '精算已證明最優' : /未啟動/.test(status) ? '精算停用（參數非原設定）' : '精算：' + status.slice(0, 40));
    if (flag('--expect-exact-variants') && !proven) record('規則變體精算：' + name, false, status.slice(0, 120));
    await page.close();
  }
}

// 三套規則判定（排班用、獨立巡檢、verify.js）對隨機改壞的班表必須判定出同一批違規人員。
// 每個規則變體都跑，確認改規則表數值時三套都跟著改。
async function suiteConsistency() {
  const trials = flag('--quick') ? 120 : 300;
  for (const [name, edits] of Object.entries(VARIANTS)) {
    for (const data of ['範例名冊', '吃緊＋各類事件']) {
      const { page, errors } = await K.open(target, edits);
      if (data === '範例名冊') await K.loadDemo(page);
      else await Consistency.loadEventRich(page, K, syntheticLeave);
      await K.schedule(page);
      if (name === '預設') {
        const ev = await Consistency.compareEvents(page, K.dumpSchedule);
        const eg = ev.diffs[0] ? '；例：' + JSON.stringify(ev.diffs[0]).slice(0, 300) : '';
        record(`三套事件禁排逐一比對／${data}`, ev.diffs.length === 0, `${ev.pairs} 個人員×班次組合，禁排 ${ev.blocked}，不一致 ${ev.diffs.length}${eg}`);
      }
      const r = await Consistency.compare(page, K.dumpSchedule, { trials, seed: 1 + name.length * 31 + data.length });
      const sample = r.diffs[0] ? '；例：' + JSON.stringify(r.diffs[0]).slice(0, 400) : '';
      record(`三套規則一致：${name}／${data}`, r.diffs.length === 0 && errors.length === 0,
        `${r.trials} 份改壞的班表，有違規 ${r.flagged} 份次，判定不一致 ${r.diffs.length}${sample}`);
      await page.close();
    }
  }
}

// 網站版的「有新版本」提示：新版本下載好後要等使用者按「更新」才切換（需要同資料夾的 sw.js）。
async function suiteUpdate() {
  if (!fs.existsSync(require('path').join(require('path').dirname(target), 'sw.js'))) return;
  const { steps, errors } = await updateFlow(target);
  for (const s of steps) record('網站更新：' + s.name, s.ok, s.detail);
  if (errors.length) record('網站更新：頁面錯誤', false, errors.slice(0, 2).join('；'));
}

// 給被排的人：個人班表連結與行事曆檔
async function suitePeople() {
  for (const s of await peopleFeatures(K, target)) record('給被排的人：' + s.name, s.ok, s.detail);
}

// 多個背景引擎同時精算（假裝裝置有 4 核心 → 大門、安官各 2 個引擎）：班表巡檢與驗算都要通過，安官要能證明最優
async function suitePortfolio() {
  const { page, errors } = await K.open(target);
  await page.evaluate(() => Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 4 }));
  const workers = []; page.on('worker', w => workers.push(w));
  await K.loadDemo(page); await K.schedule(page);
  const before = workers.length, st = await K.precisionBoth(page, 600000), d = await K.dumpSchedule(page);
  const v = verifySchedule(d), opened = workers.length - before;
  record('多引擎精算：範例名冊', opened >= 4 && d.audit.length === 0 && v.length === 0 && errors.length === 0 && /均已證明最優/.test(st.officer),
    `背景引擎 ${opened} 個，巡檢 ${d.audit.length}，獨立驗算 ${v.length}，頁面錯誤 ${errors.length}；${st.officer.slice(0, 40)}`);
  await page.close();
}

// v8.2 起：在「排班規則與每人上限」設定頁改數值，排班與驗算都必須依新設定，重新開啟後設定仍在。
async function suiteSettingsPage() {
  const { page, errors } = await K.open(target);
  if (!(await page.$('#ruleSettingsForm'))) { await page.close(); return; }
  await K.loadDemo(page);
  await page.evaluate(() => {
    document.querySelector('[data-step=setup]').click(); document.getElementById('ruleSettingsPanel').open = true;
    const i = document.querySelector('#ruleSettingsForm input[data-path="shift.door.restHours"]');
    i.value = '8'; i.dispatchEvent(new Event('change', { bubbles: true }));
    document.querySelector('[data-step=home]').click();
  });
  await page.waitForTimeout(500);
  await K.schedule(page);
  const dump = await K.dumpSchedule(page);
  const applied = dump && dump.shiftRules.door.restHours === 8;
  checkDump('設定頁：休息改 8 小時後排班', dump, errors, applied ? '已採用新設定' : '未採用新設定');
  if (!applied) record('設定頁：新設定生效', false);
  await page.waitForTimeout(1500);
  await page.reload(); await page.waitForTimeout(2000);
  const kept = await page.evaluate(() => GUARD_SHIFT_RULES.door.restHours === 8 && /自訂/.test(document.getElementById('ruleSettingsBadge').textContent));
  record('設定頁：重新開啟後設定仍在', kept);
  await page.close();
}


// v9.0 勤務負擔點數：統計表點數須與獨立計算相同；封存後下個月須帶入累計差額。
function burdenOf(dump, pool, fair) {
  const pts = new Map(), cnt = new Map(); let F = 0, P = 0;
  for (const t of dump[pool].tasks) {
    if (!t.who) continue;
    const v = fair.points[pool][t.num - 1] + (t.holiday ? fair.holidayBonus : 0);
    F++; P += v; pts.set(t.who, (pts.get(t.who) || 0) + v); cnt.set(t.who, (cnt.get(t.who) || 0) + 1);
  }
  const delta = new Map([...pts].map(([id, v]) => [id, v - P * cnt.get(id) / F]));
  return { pts, delta };
}
const statColumns = page => page.evaluate(() => {
  const head = [...document.querySelectorAll('#statBody')].map(b => b.closest('table').querySelector('thead').textContent)[0] || '';
  return { head, rows: [...document.querySelectorAll('#statBody tr')].map(r => [...r.children].map(c => c.textContent)) };
});
async function suiteBurden() {
  const { page, errors } = await K.open(target);
  const fair = await page.evaluate(() => typeof GUARD_FAIRNESS === 'object' && GUARD_FAIRNESS.points ? JSON.parse(JSON.stringify(GUARD_FAIRNESS)) : null);
  if (!fair || fair.burdenMode !== 1) { await page.close(); return; }
  await K.loadDemo(page);
  await K.schedule(page);
  const d1 = await K.dumpSchedule(page), b1 = burdenOf(d1, 'door', fair), t1 = await statColumns(page);
  const iPts = 11, iLed = 12;
  let bad = 0;
  for (const r of t1.rows) if (Math.abs(Number(r[iPts]) - (b1.pts.get(r[0]) || 0)) > 0.05) bad++;
  record('勤務負擔點數：統計表與獨立計算一致', /勤務點數/.test(t1.head) && t1.rows.length > 0 && bad === 0, `${t1.rows.length} 人，不符 ${bad}`);
  await page.evaluate(() => document.getElementById('archiveToggle').click());
  await page.waitForTimeout(1500);
  await page.evaluate(() => { const e = document.getElementById('monthTop'); const [y, m] = e.value.split('-').map(Number);
    e.value = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`; e.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.waitForTimeout(1500);
  await K.schedule(page);
  const d2 = await K.dumpSchedule(page), t2 = await statColumns(page);
  let carried = 0, wrong = 0;
  for (const r of t2.rows) {
    const want = b1.delta.get(r[0]); if (want === undefined) continue;
    carried++; if (r[iLed] === '—' || Math.abs(Number(r[iLed]) - want) > 0.06) wrong++;
  }
  // 上月落後（差額為負）的人，本月應傾向多得點數
  const b2 = burdenOf(d2, 'door', fair), xs = [], ys = [];
  for (const [id, x] of b1.delta) if (b2.delta.has(id)) { xs.push(x); ys.push(b2.delta.get(id)); }
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length, my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let sxy = 0, sxx = 0, syy = 0; xs.forEach((x, i) => { sxy += (x - mx) * (ys[i] - my); sxx += (x - mx) ** 2; syy += (ys[i] - my) ** 2; });
  const corr = sxx && syy ? sxy / Math.sqrt(sxx * syy) : 0;
  const before = xs.reduce((a, x) => a + Math.abs(x), 0), after = xs.reduce((a, x, i) => a + Math.abs(x + ys[i]), 0);
  record('勤務負擔點數：封存後下月帶入累計差額', carried > 0 && wrong === 0 && errors.length === 0, `${carried} 人帶入，不符 ${wrong}`);
  record('勤務負擔點數：下月往平衡方向修正', after <= before + 1e-9, `相關係數 ${corr.toFixed(2)}，累計差額絕對值合計 ${before.toFixed(1)}→${after.toFixed(1)} 點`);
  checkDump('勤務負擔點數：下月班表', d2, errors);
  await page.close();
}
// seedAssign：把舊版排出的班表原樣套到新版，再一起塞錯；排班演算法刻意改變時，巡檢比較仍針對同一份班表。
async function equivalencePayload(file, seedAssign = null) {
  const { page, errors } = await K.open(file);
  await K.loadDemo(page);
  await K.schedule(page);
  const out = await page.evaluate(seedAssign => {
    const kit = window.__kit, l = kit.last;
    if (seedAssign) for (const pool of ['door', 'officer']) {
      const byId = new Map(l.m.staff[pool].map(p => [p.id, p])), res = new Map();
      for (const [key, id] of seedAssign[pool]) if (byId.has(id)) res.set(key, byId.get(id));
      l.solutions[pool].res = res;
    }
    const assign = {}; for (const pool of ['door', 'officer']) assign[pool] = [...l.solutions[pool].res].map(([k, p]) => [k, p.id]);
    let seed = 12345; const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    const types = ['休假', '受訓', '值星', '督伙', '夜查', '車勤', '義務役', 'all', 'night', 'noon', '業參日'];
    const grid = [];
    for (const pool of ['door', 'officer']) for (const type of types) for (const [s, e] of [[0, 0], [0, 2], [-1, 3], [5, 12]]) {
      for (const t of l.m.tasks[pool].filter((_, i) => i % 5 === 0).slice(0, 60)) {
        const person = { pool, events: [{ type, start: t.day + s, end: t.day + e }], inactiveFrom: null, kitchen: false, key: 'x' };
        grid.push(kit.staticReason(person, t));
      }
    }
    const conf = [];
    for (const pool of ['door', 'officer']) {
      const tasks = l.m.tasks[pool], staff = l.m.staff[pool];
      for (let n = 0; n < 4000; n++) {
        const person = staff[Math.floor(rnd() * staff.length)], t = tasks[Math.floor(rnd() * tasks.length)];
        const own = [], k = 1 + Math.floor(rnd() * 5);
        for (let i = 0; i < k; i++) {
          const u = tasks[Math.max(0, Math.min(tasks.length - 1, tasks.indexOf(t) + Math.floor((rnd() - 0.5) * (pool === 'door' ? 110 : 60))))];
          if (u !== t && !own.includes(u)) own.push(u);
        }
        conf.push(kit.conflict(person, t, new Map([[person.key, own]])));
      }
    }
    const audits = [];
    for (let round = 0; round < 30; round++) {
      const backup = new Map();
      for (const pool of ['door', 'officer']) {
        const sol = l.solutions[pool], staff = l.m.staff[pool]; backup.set(pool, new Map(sol.res));
        for (let c = 0; c < 6; c++) { const t = sol.tasks[Math.floor(rnd() * sol.tasks.length)]; sol.res.set(t.key, staff[Math.floor(rnd() * staff.length)]); }
      }
      audits.push(kit.audit().filter(m => !/同日超過\d+班|統計不一致|缺班計數/.test(m)).sort());
      for (const pool of ['door', 'officer']) l.solutions[pool].res = backup.get(pool);
    }
    return { grid, conf, audits, assign };
  }, seedAssign);
  await page.close();
  return { ...out, errors };
}

async function suiteEquivalence(baseline) {
  const a = await equivalencePayload(baseline), b = await equivalencePayload(target, a.assign);
  const diff = (x, y) => x.reduce((n, v, i) => n + (JSON.stringify(v) !== JSON.stringify(y[i]) ? 1 : 0), 0);
  record('新舊版：個人事件禁排判定一致', diff(a.grid, b.grid) === 0, `${a.grid.length} 個情境，差異 ${diff(a.grid, b.grid)}`);
  record('新舊版：班與班衝突判定一致', diff(a.conf, b.conf) === 0, `${a.conf.length} 個情境，差異 ${diff(a.conf, b.conf)}`);
  record('新舊版：塞錯班表的巡檢結果一致', diff(a.audits, b.audits) === 0, `${a.audits.length} 輪，差異 ${diff(a.audits, b.audits)}`);
}

async function suiteReal() {
  const leave = fs.readFileSync(opt('--leave'), 'utf8').trim();
  const nd = Number(opt('--door') || 56), no = Number(opt('--officer') || 56);
  const { page, errors } = await K.open(target);
  await K.loadData(page, { door: K.roster('H', '上兵', nd), officer: K.roster('P', '中士', no), leave });
  await K.schedule(page);
  const proof = [];
  const both = await K.precisionBoth(page);
  for (const pool of ['door', 'officer']) {
    const st = both[pool];
    proof.push((pool === 'door' ? '大門' : '安官') + (/均已證明最優/.test(st) ? '全部已證明' : /已證明最優/.test(st) ? '次要項未全部證明' : '未完成證明'));
  }
  const dump = await K.dumpSchedule(page);
  checkDump(`真實休假資料（${nd}/${no} 人）`, dump, errors,
    `${proof.join('、')}，假日失衡 大門 ${holidayImbalance(dump, 'door').toFixed(2)}、安官 ${holidayImbalance(dump, 'officer').toFixed(2)}`);
  const compact = { door: dump.door.tasks.map(t => t.who), officer: dump.officer.tasks.map(t => t.who) };
  if (opt('--write-golden')) { fs.writeFileSync(opt('--write-golden'), JSON.stringify(compact)); record('寫入標準答案', true, opt('--write-golden')); }
  if (opt('--golden')) {
    const g = JSON.parse(fs.readFileSync(opt('--golden'), 'utf8'));
    const changed = ['door', 'officer'].reduce((n, p) => n + g[p].filter((w, i) => w !== compact[p][i]).length, 0);
    record('與標準答案相同', changed === 0, `不同的班次 ${changed}`);
  }
  await page.close();
}

(async () => {
  const t0 = Date.now();
  try {
    const only = opt('--only') ? opt('--only').split(',') : null, want = n => !only || only.includes(n);
    if (want('selftest')) await suiteSelfTest();
    if (want('demo')) await suiteDemo();
    if (want('stress')) await suiteStress();
    if (want('variants')) await suiteVariants();
    if (want('consistency')) await suiteConsistency();
    if (want('update')) await suiteUpdate();
    if (want('people')) await suitePeople();
    if (want('portfolio')) await suitePortfolio();
    if (want('settings')) await suiteSettingsPage();
    if (want('burden')) await suiteBurden();
    if (opt('--baseline') && want('equivalence')) await suiteEquivalence(opt('--baseline'));
    if (opt('--leave') && want('real')) await suiteReal();
  } catch (e) { record('測試執行', false, e.message); }
  await K.close();
  const failed = results.filter(r => !r.ok);
  console.log(`\n共 ${results.length} 項，失敗 ${failed.length} 項，耗時 ${Math.round((Date.now() - t0) / 1000)} 秒`);
  if (opt('--report')) fs.writeFileSync(opt('--report'), JSON.stringify({ target, results }, null, 2));
  process.exit(failed.length ? 1 : 0);
})();
