# Roster

大門衛哨與安全士官的排班工具（單一 HTML 程式）。

- 網址：https://saiheigen.github.io/Roster/
- 名冊、休假、班表等資料**只存在使用者自己的瀏覽器**，不會上傳到任何伺服器。
- 第一次開過之後，沒有網路也能使用（離線快取 `sw.js`）。有網路時開啟一律是最新版；已經開著的頁面在網站更新後，畫面下方會出現「網站已更新」，按「重新整理」即可。
- iPhone：Safari 打開網址 › 分享 ›「加入主畫面」；Android：Chrome › ⋮ ›「加到主畫面／安裝應用程式」。
  主畫面 App 的資料和瀏覽器分頁分開保存，第一次使用請用「備份與還原 › 還原備份資料」載入備份檔。

## 給被排的人

- **班表連結**：班表頁「分享唯讀班表 › 複製班表連結」，貼到 LINE 群組；每個人點開後輸入自己的姓名，就能看到自己的班、加入手機行事曆，也能依日期查看當天所有班。連結本身帶著全單位的姓名與班次（不經過伺服器），拿到連結的人都看得到。
- **個人班表連結**：班表頁「個人班表」勾選「附上每人的行事曆連結」後複製貼到 LINE；每個人點自己的連結就能看到自己的班，按「加入手機行事曆」即可加入並設定提醒。連結本身帶著姓名與班次（不經過伺服器），拿到連結的人都看得到。

**請勿把「備份全部」產生的備份檔上傳到這個儲存庫。**

## 檔案

| 檔案 | 用途 |
|---|---|
| `index.html` | 程式本體（含離線精算引擎 HiGHS WebAssembly）。由 `src/`、`vendor/` 以 `node build.js` 組合而成，**請改原始碼，不要直接改這個檔** |
| `src/`、`vendor/`、`build.js` | 原始碼、外部套件、組合程式；修改方法見 `CONTRIBUTING.md` |
| `sw.js` | 離線快取與新版本提示（版本號由 `build.js` 自動更新） |
| `manifest.webmanifest`、`icon-*.png` | 加入主畫面時的名稱與圖示 |
| `tests/` | 自動測試包（不含任何真實資料） |
| `.github/workflows/` | 推送後自動測試，通過才發布到 GitHub Pages |
| `CHANGELOG.md` | 更新紀錄 |

## 測試

在電腦上：

```bash
node build.js --check          # index.html 與原始碼一致
cd tests && npm install && npx playwright install chromium
node run.js ../index.html --quick --only selftest,demo,consistency,update,people,portfolio,stress,settings,burden
```

真實休假紀錄只在本機用 `--leave` 測試，不要放進這個儲存庫。
