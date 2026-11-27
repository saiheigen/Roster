'use strict';
// 「有新版本」流程：用本機網站伺服器模擬發布新版本，確認
//   1. 第一次開啟不會出現提示；
//   2. 發布新版後重新整理，仍是原版本，並出現「有新版本可以使用」；
//   3. 排班或精算中按「更新」不會切換；
//   4. 按「更新」後換成新版本；
//   5. 離線也能開啟。
// 需要與 index.html 同一資料夾內的 sw.js、manifest.webmanifest、icon-*.png。
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { chromium } = require('playwright');

async function updateFlow(target) {
  const src = path.dirname(path.resolve(target));
  const site = fs.mkdtempSync(path.join(os.tmpdir(), 'roster-site-'));
  for (const f of fs.readdirSync(src)) if (/^(sw\.js|manifest\.webmanifest|icon-.*\.png)$/.test(f)) fs.copyFileSync(path.join(src, f), path.join(site, f));
  fs.copyFileSync(target, path.join(site, 'index.html'));
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
  const browser = await chromium.launch(), ctx = await browser.newContext(), page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  const steps = [], ok = (name, cond, detail = '') => steps.push({ name, ok: !!cond, detail });
  const title = () => page.evaluate(() => document.title);
  const bar = () => page.evaluate(() => { const b = document.getElementById('updateBar'); return !!b && !b.hidden; });
  try {
    await page.goto(url);
    await page.waitForFunction(() => navigator.serviceWorker.controller, null, { timeout: 30000 });
    await page.reload(); await page.waitForTimeout(1500);
    const original = await title();
    ok('第一次開啟不出現提示', !(await bar()));
    // 發布新版本：改標題，sw.js 版本號跟著變
    fs.writeFileSync(path.join(site, 'index.html'), fs.readFileSync(target, 'utf8').replace(/<title>[^<]*<\/title>/, '<title>NEXT</title>'));
    fs.writeFileSync(path.join(site, 'sw.js'), fs.readFileSync(path.join(src, 'sw.js'), 'utf8').replace(/const VERSION = '[0-9a-f]*'/, "const VERSION = 'test-next'"));
    await page.reload();
    await page.waitForFunction(() => { const b = document.getElementById('updateBar'); return b && !b.hidden; }, null, { timeout: 30000 }).catch(() => {});
    ok('發布後仍是原版本並出現提示', (await title()) === original && await bar(), await title());
    await page.evaluate(() => { window.__keep = window.rosterUpdateBlocker; window.rosterUpdateBlocker = () => '正在排班或精算'; document.getElementById('updateNow').click(); });
    await page.waitForTimeout(1500);
    ok('運算中按更新不會切換', (await title()) === original, await page.evaluate(() => document.getElementById('updateMsg').textContent));
    await page.evaluate(() => { window.rosterUpdateBlocker = window.__keep; });
    await Promise.all([page.waitForEvent('load', { timeout: 30000 }), page.evaluate(() => document.getElementById('updateNow').click())]);
    await page.waitForTimeout(1500);
    ok('按更新後換成新版本', (await title()) === 'NEXT' && !(await bar()), await title());
    await ctx.setOffline(true); await page.reload(); await page.waitForTimeout(1500);
    ok('離線開啟', (await title()) === 'NEXT', await title());
  } catch (e) { ok('流程執行', false, e.message); }
  await browser.close(); server.close(); fs.rmSync(site, { recursive: true, force: true });
  return { steps, errors };
}

module.exports = { updateFlow };
