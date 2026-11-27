#!/usr/bin/env node
'use strict';
// 把 src/ 與 vendor/ 組合成單一檔案 index.html（網站與離線使用都是這一個檔）。
//
//   node build.js           產生 index.html，並更新 sw.js 的版本號
//   node build.js --check   只檢查 index.html、sw.js 是否和原始碼一致（CI 用；不一致時結束碼 1）
//
// 樣板 src/index.html 內的標記：
//   <!--@include 路徑-->   換成該檔內容（原樣，不加任何字元）
//   <!--@base64 路徑-->    換成該檔的 base64（用於 HiGHS WebAssembly）
// 標記後若換行、下一行又是標記，這個換行不會輸出（方便一行列一個檔）。
// 不需要安裝任何套件。
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const TEMPLATE = path.join(ROOT, 'src', 'index.html');
const OUTPUT = path.join(ROOT, 'index.html');

function build() {
  const seen = new Set();
  const html = fs.readFileSync(TEMPLATE, 'utf8').replace(/<!--@(include|base64) ([^ >]+)-->(?:\n(?=<!--@))?/g, (_, kind, rel) => {
    const file = path.join(ROOT, rel);
    if (!fs.existsSync(file)) throw Error('找不到 ' + rel);
    seen.add(rel);
    return kind === 'base64' ? fs.readFileSync(file).toString('base64') : fs.readFileSync(file, 'utf8');
  });
  if (/<!--@/.test(html)) throw Error('樣板內有無法辨識的標記');
  return { html, files: [...seen] };
}

const sha = s => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);
const { html, files } = build();

// sw.js 的 VERSION 跟著網站內容變：內容一改，使用者的瀏覽器就會發現新版本並顯示「有新版本」提示。
const SW = path.join(ROOT, 'sw.js');
const ASSETS = ['manifest.webmanifest', 'icon-180.png', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png'];
const version = sha(Buffer.concat([Buffer.from(html), ...ASSETS.map(f => fs.readFileSync(path.join(ROOT, f)))]));
const swOld = fs.readFileSync(SW, 'utf8');
if (!/const VERSION = '[0-9a-f]*';/.test(swOld)) throw Error('sw.js 找不到 VERSION 行');
const swNew = swOld.replace(/const VERSION = '[0-9a-f]*';/, `const VERSION = '${version}';`);

if (process.argv.includes('--check')) {
  const current = fs.existsSync(OUTPUT) ? fs.readFileSync(OUTPUT, 'utf8') : '';
  let bad = false;
  if (current !== html) {
    console.error('index.html 與 src/ 不一致：請執行 node build.js 後再提交。');
    console.error('  目前 ' + sha(current) + '，應為 ' + sha(html));
    bad = true;
  }
  if (swOld !== swNew) { console.error('sw.js 的 VERSION 不是最新：請執行 node build.js 後再提交。'); bad = true; }
  if (bad) process.exit(1);
  console.log('index.html、sw.js 與原始碼一致（' + files.length + ' 個來源檔，版本 ' + version + '）');
} else {
  fs.writeFileSync(OUTPUT, html);
  fs.writeFileSync(SW, swNew);
  console.log('已產生 index.html（' + files.length + ' 個來源檔，' + (Buffer.byteLength(html) / 1048576).toFixed(2) + ' MB），sw.js 版本 ' + version);
}
