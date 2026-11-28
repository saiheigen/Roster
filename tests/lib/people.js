'use strict';
// 給被排的人：個人班表連結（加入行事曆）
//   1. 個人班表分享附上的連結，打開後列出的班次和工作台一致
//   2. 下載的 .ics：每班一個事件、時間正確（台灣時間換成 UTC）、每行不超過 75 位元組、有提醒
const fs = require('fs');

async function peopleFeatures(K, target) {
  const steps = [], ok = (name, cond, detail = '') => steps.push({ name, ok: !!cond, detail: String(detail) });
  const { page, errors } = await K.open(target);
  const fileUrl = page.url().split('#')[0];
  const local = url => url.replace(/^https:\/\/saiheigen\.github\.io\/Roster\//, fileUrl);
  try {
    await K.loadDemo(page); await K.schedule(page);
    const dump = await K.dumpSchedule(page);
    const month = await page.evaluate(() => document.getElementById('month').value);
    // 範例名冊格式：編號、級職、姓名、性別（以 Tab 分隔）
    const roster = await page.evaluate(() => ['door', 'officer'].flatMap(pool => document.getElementById(pool).value.split('\n').filter(Boolean).map(l => { const f = l.split('\t'); return { pool, id: f[0], rank: f[1], name: f[2] }; })));

    // 1. 個人班表文字附上連結
    await page.evaluate(() => { const c = document.getElementById('shareConsent'); c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); });
    await page.evaluate(() => { document.getElementById('personShareScope').value = 'all'; document.getElementById('personShareLinks').checked = true; document.getElementById('personShareCopy').click(); });
    await page.waitForTimeout(400);
    const text = await page.evaluate(() => document.getElementById('personShareText').value);
    const links = [...text.matchAll(/https:\/\/saiheigen\.github\.io\/Roster\/#my=[A-Za-z0-9_-]+/g)].map(m => m[0]);
    const withShifts = ['door', 'officer'].reduce((n, pool) => n + dump[pool].people.filter(p => dump[pool].tasks.some(t => t.who === p.id)).length, 0);
    ok('個人班表附上行事曆連結', links.length === withShifts, `連結 ${links.length}，有班的人 ${withShifts}`);

    // 找一位有夜哨（22 時開始）的大門人員，打開他的連結
    const decode = l => JSON.parse(Buffer.from(l.split('#my=')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    const door = dump.door, payloads = links.map(l => ({ l, d: decode(l) })).filter(x => x.d.k === 'door');
    const pick = payloads.find(x => x.d.s.some(e => e[1] === 22)) || payloads[0];
    const link = pick.l, data = pick.d, person = { id: roster.find(r => r.name === data.n && r.pool === 'door').id, name: data.n };
    const mine = door.tasks.filter(t => t.who === person.id);
    ok('連結長度適合傳 LINE', link.length < 1200, link.length + ' 字元');
    const browser = page.context().browser();
    const my = await browser.newPage(); const myErrors = []; my.on('pageerror', e => myErrors.push(e.message));
    await my.goto(local(link)); await my.waitForTimeout(800);
    const shown = await my.evaluate(() => ({ mini: document.documentElement.classList.contains('mini-mode'), items: document.querySelectorAll('.mini-shift').length, title: document.querySelector('.mini-head h1')?.textContent || '', workbench: [...document.body.children].filter(e => e.id !== 'miniPage' && e.offsetParent !== null).length }));
    ok('個人班表頁列出的班次和工作台一致，且不顯示工作台', shown.mini && shown.items === mine.length && data.s.length === mine.length && shown.title.includes(person.name) && shown.workbench === 0, `頁面 ${shown.items} 班，工作台 ${mine.length} 班，其他可見區塊 ${shown.workbench}`);

    // 2. 行事曆檔
    const [dl] = await Promise.all([my.waitForEvent('download', { timeout: 10000 }), my.click('.mini-primary')]);
    const ics = fs.readFileSync(await dl.path(), 'utf8');
    const events = ics.split('BEGIN:VEVENT').length - 1;
    const tooLong = ics.split('\r\n').filter(l => Buffer.byteLength(l) > 75).length;
    const night = data.s.find(e => e[1] === 22);
    let timeOk = true, detail = '';
    if (night) { // 22:00 台灣時間 = 當天 14:00 UTC
      const d = data.m.replace('-', '') + String(night[0]).padStart(2, '0'); timeOk = ics.includes('DTSTART:' + d + 'T140000Z'); detail = '夜哨 ' + d + ' 22:00 → ' + d + 'T140000Z';
    }
    ok('行事曆檔：每班一個事件、時間與提醒正確', events === mine.length && timeOk && ics.includes('TRIGGER:-PT30M') && /^BEGIN:VCALENDAR\r\n/.test(ics) && ics.endsWith('END:VCALENDAR\r\n'), `事件 ${events}／${mine.length}；${detail}`);
    ok('行事曆檔：每行不超過 75 位元組（中文已折行）', tooLong === 0, tooLong + ' 行過長');
    if (myErrors.length) ok('個人班表頁沒有錯誤', false, myErrors[0]);
    await my.close();

  } catch (e) { ok('流程執行', false, e.stack.split('\n').slice(0, 2).join(' ')); }
  if (errors.length) ok('工作台沒有頁面錯誤', false, errors[0]);
  await page.close();
  return steps;
}

module.exports = { peopleFeatures };
