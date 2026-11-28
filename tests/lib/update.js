'use strict';
// 網站版的更新流程：用本機網站伺服器模擬發布新版本，確認
//   1. 第一次開啟不出現提示；
//   2. 頁面開著時發布新版：不會自己重新載入，畫面出現「網站已更新」；
//   3. 排班或精算中按「重新整理」不會切換；按了才換成新版本；
//   4. 新開的頁面（例如點 LINE 裡的連結）直接是最新版；
//   5. 離線也能開啟；
//   6. 手機上還留著舊版快取（v10.5，快取優先）時點新的班表連結，最後會換成新版並顯示班表。
// 需要與 index.html 同一資料夾內的 sw.js、manifest.webmanifest、icon-*.png；第 6 項另需 git 歷史中的 v10.5。
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const zlib = require('zlib');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');

function rosterHash() {
  const d = Array(31).fill(0); d[0] = 1;
  const data = { v: 3, m: '2026-12', st: 'd', ref: 'TEST', c: '2026-11-28', n: ['測試甲'], r: ['上兵'], pr: [0], h: [], k: { door: { s: [[22, 2, 1]], d, a: 'AA' } } };
  return '#roster=z' + zlib.deflateRawSync(Buffer.from(JSON.stringify(data))).toString('base64url');
}

async function updateFlow(target) {
  const src = path.dirname(path.resolve(target));
  const site = fs.mkdtempSync(path.join(os.tmpdir(), 'roster-site-'));
  const put = (name, content) => fs.writeFileSync(path.join(site, name), content);
  const publish = (title, version) => {
    put('index.html', fs.readFileSync(target, 'utf8').replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`));
    put('sw.js', fs.readFileSync(path.join(src, 'sw.js'), 'utf8').replace(/const VERSION = '[0-9a-f]*'/, `const VERSION = '${version}'`));
  };
  for (const f of fs.readdirSync(src)) if (/^(manifest\.webmanifest|icon-.*\.png)$/.test(f)) fs.copyFileSync(path.join(src, f), path.join(site, f));
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
  const server = http.createServer((q, r) => {
    let f = decodeURIComponent(q.url.split('?')[0]); if (f.endsWith('/')) f += 'index.html';
    const p = path.join(site, f);
    if (!p.startsWith(site) || !fs.existsSync(p)) { r.writeHead(404); return r.end(); }
    r.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    fs.createReadStream(p).pipe(r);
  });
  await new Promise(ok => server.listen(0, '127.0.0.1', ok));
  const url = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch();
  const steps = [], errors = [], ok = (name, cond, detail = '') => steps.push({ name, ok: !!cond, detail: String(detail) });
  const track = page => page.on('pageerror', e => errors.push(e.message));
  try {
    // 1～5：目前版本
    publish('FIRST', 'aaaa');
    let ctx = await browser.newContext(), page = await ctx.newPage(); track(page);
    const title = () => page.evaluate(() => document.title);
    const bar = () => page.evaluate(() => { const b = document.getElementById('updateBar'); return !!b && !b.hidden; });
    await page.goto(url);
    await page.waitForFunction(() => navigator.serviceWorker.controller, null, { timeout: 30000 });
    await page.reload(); await page.waitForTimeout(1500);
    ok('第一次開啟不出現提示', (await title()) === 'FIRST' && !(await bar()), await title());
    publish('SECOND', 'bbbb');
    await page.evaluate(() => navigator.serviceWorker.getRegistration().then(r => r.update()));
    await page.waitForFunction(() => { const b = document.getElementById('updateBar'); return b && !b.hidden; }, null, { timeout: 30000 }).catch(() => {});
    ok('頁面開著時發布新版：不自動重新載入，出現「網站已更新」', (await title()) === 'FIRST' && await bar(), await title());
    await page.evaluate(() => { window.__keep = window.rosterUpdateBlocker; window.rosterUpdateBlocker = () => '正在排班或精算'; document.getElementById('updateNow').click(); });
    await page.waitForTimeout(1200);
    ok('運算中按重新整理不會切換', (await title()) === 'FIRST', await page.evaluate(() => document.getElementById('updateMsg').textContent));
    await page.evaluate(() => { window.rosterUpdateBlocker = window.__keep; });
    await Promise.all([page.waitForEvent('load', { timeout: 30000 }), page.evaluate(() => document.getElementById('updateNow').click())]);
    await page.waitForTimeout(1000);
    ok('按重新整理後換成新版本', (await title()) === 'SECOND' && !(await bar()), await title());
    publish('THIRD', 'cccc');
    const fresh = await ctx.newPage(); track(fresh);
    await fresh.goto(url + rosterHash()); await fresh.waitForTimeout(1500);
    const freshState = await fresh.evaluate(() => ({ title: document.title, mini: document.documentElement.classList.contains('mini-mode') }));
    ok('新開的頁面（點連結）直接是最新版', freshState.mini && /勤務班表|測試甲/.test(freshState.title) && await fresh.evaluate(() => !!document.querySelector('.mini-head')), JSON.stringify(freshState));
    await fresh.close();
    await ctx.setOffline(true); await page.reload(); await page.waitForTimeout(1500);
    ok('離線開啟', (await title()) === 'THIRD', await title());
    await ctx.close();

    // 6：舊版快取（v10.5：快取優先、要按更新才換）＋新的班表連結
    let oldIndex = '', oldSw = '';
    try {
      const repo = execFileSync('git', ['-C', src, 'rev-parse', '--show-toplevel']).toString().trim();
      const rev = execFileSync('git', ['-C', repo, 'log', '--format=%H', '--grep=^v10.5:', '-n', '1']).toString().trim();
      if (rev) { oldIndex = execFileSync('git', ['-C', repo, 'show', rev + ':index.html'], { maxBuffer: 64 << 20 }).toString(); oldSw = execFileSync('git', ['-C', repo, 'show', rev + ':sw.js']).toString(); }
    } catch (_) {}
    if (oldIndex) {
      put('index.html', oldIndex.replace(/<title>[^<]*<\/title>/, '<title>OLD</title>')); put('sw.js', oldSw);
      ctx = await browser.newContext(); page = await ctx.newPage(); track(page);
      await page.goto(url); await page.waitForFunction(() => navigator.serviceWorker.controller, null, { timeout: 30000 });
      await page.reload(); await page.waitForTimeout(1000);
      const before = await page.evaluate(() => document.title);
      publish('NEW', 'dddd');
      await page.goto('about:blank'); await page.goto(url + rosterHash());
      const shown = await page.waitForFunction(() => document.documentElement.classList.contains('mini-mode') && !!document.querySelector('.mini-head'), null, { timeout: 30000 }).then(() => true, () => false);
      ok('手機留著舊版快取時點新班表連結，自動換新版並顯示班表', before === 'OLD' && shown, `原本 ${before}，現在 ${await page.evaluate(() => document.title)}`);
      await ctx.close();
    }
  } catch (e) { ok('流程執行', false, e.message); }
  await browser.close(); server.close(); fs.rmSync(site, { recursive: true, force: true });
  return { steps, errors };
}

module.exports = { updateFlow };
