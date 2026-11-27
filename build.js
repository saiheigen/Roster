#!/usr/bin/env node
'use strict';
// 把 src/ 與 vendor/ 組合成單一檔案 index.html（網站與離線使用都是這一個檔）。
//
//   node build.js           產生 index.html
//   node build.js --check   只檢查 index.html 是否和原始碼一致（CI 用；不一致時結束碼 1）
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

if (process.argv.includes('--check')) {
  const current = fs.existsSync(OUTPUT) ? fs.readFileSync(OUTPUT, 'utf8') : '';
  if (current !== html) {
    console.error('index.html 與 src/ 不一致：請執行 node build.js 後再提交。');
    console.error('  目前 ' + sha(current) + '，應為 ' + sha(html));
    process.exit(1);
  }
  console.log('index.html 與原始碼一致（' + files.length + ' 個來源檔，' + sha(html) + '）');
} else {
  fs.writeFileSync(OUTPUT, html);
  console.log('已產生 index.html（' + files.length + ' 個來源檔，' + (Buffer.byteLength(html) / 1048576).toFixed(2) + ' MB，' + sha(html) + '）');
}
