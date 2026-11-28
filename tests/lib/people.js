'use strict';
// 給被排的人的功能：個人班表連結（加入行事曆）與休假填報
//   1. 個人班表分享附上的連結，打開後列出的班次和工作台一致
//   2. 下載的 .ics：每班一個事件、時間正確（台灣時間換成 UTC）、每行不超過 75 位元組、有提醒
//   3. 休假填報頁：選日期產生的文字正確（連續日期合併成區間）
//   4. 工作台「收集休假」：貼上多則填報（夾雜聊天文字）→ 對到名冊、找不到的人列出來、加入休假；再貼一次不會重複加入
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
    const nameOf = id => roster.find(r => r.id === id).name;

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

    // 3. 休假填報頁
    const form = await page.context().browser().newPage(); const formErrors = []; form.on('pageerror', e => formErrors.push(e.message));
    await form.goto(fileUrl + '#leave=' + month); await form.waitForTimeout(600);
    const fill = async (name, days) => {
      await form.fill('.mini-form input >> nth=0', name);
      await form.evaluate(() => { const b = [...document.querySelectorAll('.mini-link')].find(x => x.textContent.includes('清除')); b && b.click(); });
      for (const d of days) await form.click(`.mini-day:text-is("${d}")`);
      return form.evaluate(() => document.querySelector('.mini-preview').textContent);
    };
    const officer = { id: dump.officer.people[1].id, name: nameOf(dump.officer.people[1].id) }, doorA = { id: door.people[2].id, name: nameOf(door.people[2].id) }, [y, m] = month.split('-');
    const lineA = await fill(doorA.name, [3, 4, 5, 20]);
    ok('填報頁：連續日期合併成區間', lineA === `休假填報 ${y}/${m} ${doorA.name}：${m}/03-${m}/05、${m}/20`, lineA);
    const lineB = await fill(officer.name, []);
    ok('填報頁：沒有休假時產生「無」', lineB.endsWith('：無'), lineB);
    if (formErrors.length) ok('填報頁沒有錯誤', false, formErrors[0]);
    await form.close();

    // 4. 工作台收集休假
    const paste = ['下午 3:02 ' + doorA.name, lineA, '收到 謝謝', lineB, `休假填報 ${y}/${m} 查無此人：${m}/10`].join('\n');
    const before = await page.evaluate(() => document.getElementById('leave').value.split('\n').filter(Boolean).length);
    await page.evaluate(() => document.querySelector('[data-step="records"]').click());
    await page.evaluate(p => { document.getElementById('leaveCollect').open = true; document.getElementById('leaveInbox').value = p; document.getElementById('leaveInboxCheck').click(); }, paste);
    const check = await page.evaluate(() => ({ text: document.getElementById('leaveInboxResult').innerText, apply: document.getElementById('leaveInboxApply').textContent, disabled: document.getElementById('leaveInboxApply').disabled }));
    ok('收集休假：讀到 3 則、可加入 2 筆、找不到的人有標示', /讀到 3 則填報：可加入 2 筆休假；已回覆 2 人/.test(check.text) && /找不到「查無此人」/.test(check.text) && !check.disabled, check.text.split('\n').slice(0, 2).join(' / '));
    await page.evaluate(() => document.getElementById('leaveInboxApply').click()); await page.waitForTimeout(300);
    const leave = await page.evaluate(() => document.getElementById('leave').value.split('\n').filter(Boolean));
    const want = [`${doorA.id}\t${y}/${m}/03\t${y}/${m}/05`, `${doorA.id}\t${y}/${m}/20\t${y}/${m}/20`];
    ok('收集休假：加入休假紀錄', leave.length === before + 2 && want.every(w => leave.includes(w)), `原本 ${before} 筆，現在 ${leave.length} 筆`);
    await page.evaluate(() => document.getElementById('leaveInboxCheck').click());
    const again = await page.evaluate(() => document.getElementById('leaveInboxResult').innerText);
    ok('收集休假：同一份填報再貼一次不會重複加入', /可加入 0 筆休假/.test(again) && /已登記/.test(again), again.split('\n')[1] || again.slice(0, 80));
    // 休假加入後重新排班，這兩段休假期間此人沒有被排班
    await K.schedule(page);
    const after = await K.dumpSchedule(page);
    const first = Math.min(...after.door.tasks.map(t => t.day)), off = new Set([3, 4, 5, 20].map(d => first + d - 1));
    const clash = after.door.tasks.filter(t => t.who === doorA.id && off.has(t.day)).length;
    ok('匯入的休假在重新排班後生效', clash === 0, '休假日仍有班 ' + clash);
  } catch (e) { ok('流程執行', false, e.stack.split('\n').slice(0, 2).join(' ')); }
  if (errors.length) ok('工作台沒有頁面錯誤', false, errors[0]);
  await page.close();
  return steps;
}

module.exports = { peopleFeatures };
