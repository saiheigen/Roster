'use strict';
// 以無頭瀏覽器操作哨務工作台。測試時把一行偵錯掛鉤注入「暫存副本」，原檔不會被修改。
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');

const ANCHOR = "let last=null,currentPool='door',missingOnly=false;";
const HOOK = ANCHOR + "window.__kit={get last(){return last},staticReason,conflict," +
  "audit:()=>independentScheduleAudit(last.m,last.solutions,{})};";

function instrument(htmlPath, edits = []) {
  let s = fs.readFileSync(htmlPath, 'utf8');
  if (s.split(ANCHOR).length !== 2) throw Error('找不到注入點，工作台結構可能已改變：' + htmlPath);
  s = s.replace(ANCHOR, HOOK);
  // 只修改規則表（GUARD_SHIFT_RULES）那一段，不碰精算引擎內的預設值
  const start = s.indexOf('const GUARD_SHIFT_RULES=');
  const end = start < 0 ? -1 : s.indexOf('});', start);
  if (edits.length && (start < 0 || end < 0)) throw Error('找不到規則表 GUARD_SHIFT_RULES');
  for (const [from, to] of edits) {
    const table = s.slice(start, end);
    if (table.split(from).length !== 2) throw Error('規則表修改點不唯一或不存在：' + from);
    s = s.slice(0, start) + table.replace(from, to) + s.slice(end);
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'roster-kit-'));
  const out = path.join(dir, 'page.html');
  fs.writeFileSync(out, s);
  return out;
}

let browser = null;
async function launch() { if (!browser) browser = await chromium.launch(); return browser; }
async function close() { if (browser) await browser.close(); browser = null; }

async function open(htmlPath, edits) {
  const b = await launch();
  const page = await b.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [], dialogs = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', async d => { dialogs.push(d.message()); await d.accept(); });
  await page.goto('file://' + instrument(htmlPath, edits));
  await page.waitForTimeout(1200);
  return { page, errors, dialogs };
}

const waitIdle = (page, timeout = 600000) => page.waitForTimeout(700)
  .then(() => page.waitForFunction(() => document.getElementById('runProgress').hidden, null, { timeout }))
  .then(() => page.waitForTimeout(700));

async function loadDemo(page) {
  await page.evaluate(() => { const d = document.querySelector('#demo'); d.closest('details').open = true; d.click(); });
  await page.waitForTimeout(800);
}

function roster(prefix, rank, n) {
  return Array.from({ length: n }, (_, i) => `${prefix}${String(i + 1).padStart(3, '0')}\t${rank}\t測試${prefix}${i + 1}\t男`).join('\n');
}

async function loadData(page, { month = '2026-12', door, officer, leave = '' }) {
  await page.evaluate(({ month, door, officer, leave }) => {
    const m = document.getElementById('monthTop'); m.value = month; m.dispatchEvent(new Event('change', { bubbles: true }));
    const set = (id, v) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); };
    set('door', door); set('officer', officer); set('leave', leave);
  }, { month, door, officer, leave });
  await page.waitForTimeout(800);
}

async function schedule(page) {
  const t0 = Date.now();
  await page.evaluate(() => document.getElementById('overviewRun').click());
  await waitIdle(page);
  return Date.now() - t0;
}

const clickInside = (page, id) => page.evaluate(id => {
  const e = document.getElementById(id); let q = e.closest('details');
  while (q) { q.open = true; q = q.parentElement && q.parentElement.closest('details'); }
  e.click();
}, id);

// 精算大門與安官，回傳 {door, officer} 各自的完成狀態文字。
// v8.0 起是單一按鈕（#precisionAll）；舊版為兩個按鈕。
// 精算是「不限時」的；測試時最多等 capMs，逾時就像使用者一樣按「停止」，結果記為未完成證明。
// v9.0 起勤務負擔點數的證明每個哨最多 180 秒，兩個哨合計可能超過 6 分鐘，因此預設上限 480 秒。
// doorOnly：只需要大門結果時（規則變體），大門完成後即停止，節省時間。
async function precisionBoth(page, capMs = 480000, { doorOnly = false } = {}) {
  if (await page.$('#precisionAll')) {
    await page.evaluate(() => { for (const id of ['precisionPanel', 'officerPrecisionPanel']) delete document.getElementById(id).dataset.status; });
    await clickInside(page, 'precisionAll');
    const finished = () => page.waitForFunction(doorOnly => doorOnly ? !!document.getElementById('precisionPanel').dataset.status :
      !!document.getElementById('officerPrecisionPanel').dataset.status && document.getElementById('runProgress').hidden,
      doorOnly, { timeout: capMs }).then(() => true, () => false);
    if (!(await finished()) || doorOnly) {
      await page.evaluate(() => { const b = document.getElementById('runInterrupt'); if (b && !document.getElementById('runProgress').hidden) b.click(); });
      await page.waitForFunction(() => document.getElementById('runProgress').hidden, null, { timeout: 120000 });
    }
    await page.waitForTimeout(700);
    return page.evaluate(() => ({ door: document.getElementById('precisionPanel').dataset.status || '',
      officer: document.getElementById('officerPrecisionPanel').dataset.status || '' }));
  }
  const out = {};
  for (const pool of ['door', 'officer']) {
    await clickInside(page, pool === 'door' ? 'precisionRun' : 'officerPrecisionRun');
    await waitIdle(page);
    out[pool] = await page.evaluate(() => document.getElementById('offlineReport').innerText);
  }
  return out;
}

async function selfTest(page) {
  await clickInside(page, 'ruleSelfTest');
  await page.waitForTimeout(3000);
  return page.evaluate(() => document.getElementById('ruleSelfTestResult').innerText);
}

async function dumpSchedule(page) {
  return page.evaluate(() => {
    const l = window.__kit.last; if (!l) return null;
    const out = { shiftRules: GUARD_SHIFT_RULES, eventRules: GUARD_EVENT_RULES, audit: window.__kit.audit() };
    for (const pool of ['door', 'officer']) {
      const sol = l.solutions[pool];
      out[pool] = {
        missing: sol.missing,
        tasks: sol.tasks.map(t => ({ key: t.key, day: t.day, num: t.num, start: t.start, end: t.end, dur: t.dur, holiday: !!t.holiday, who: (sol.res.get(t.key) || {}).id || null })),
        people: l.m.staff[pool].map(p => ({ id: p.id, inactiveFrom: p.inactiveFrom ?? null, kitchen: !!p.kitchen,
          events: p.events.map(e => ({ type: e.type, start: e.start, end: e.end })),
          history: p.history.map(t => ({ day: t.day, num: t.num, start: t.start, end: t.end, dur: t.dur })) }))
      };
    }
    return out;
  });
}

module.exports = { open, close, loadDemo, loadData, schedule, precisionBoth, selfTest, dumpSchedule, roster, instrument };
