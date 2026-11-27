# Roster

大門衛哨與安全士官的排班工具（單一 HTML 程式）。

- 網址：https://saiheigen.github.io/Roster/
- 名冊、休假、班表等資料**只存在使用者自己的瀏覽器**，不會上傳到任何伺服器。
- 第一次開過之後，沒有網路也能使用（離線快取 `sw.js`）。
- iPhone：Safari 打開網址 › 分享 ›「加入主畫面」；Android：Chrome › ⋮ ›「加到主畫面／安裝應用程式」。
  主畫面 App 的資料和瀏覽器分頁分開保存，第一次使用請用「備份與還原 › 還原備份資料」載入備份檔。

**請勿把「備份全部」產生的備份檔上傳到這個儲存庫。**

## 檔案

| 檔案 | 用途 |
|---|---|
| `index.html` | 程式本體（含離線精算引擎 HiGHS WebAssembly） |
| `sw.js` | 離線快取：有網路時先抓最新版，沒網路時用上次存下的版本 |
| `manifest.webmanifest`、`icon-*.png` | 加入主畫面時的名稱與圖示 |
| `tests/` | 自動測試包（不含任何真實資料） |

## 測試

在電腦上：

```bash
cd tests && npm install && npx playwright install chromium
node run.js ../index.html
```

真實休假紀錄只在本機用 `--leave` 測試，不要放進這個儲存庫。
