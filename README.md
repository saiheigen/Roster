# Roster

離線排班工具（單一 HTML）。資料只存在使用者自己的瀏覽器，不會上傳。

請勿把「備份全部」產生的備份檔上傳到這個儲存庫。

## 測試

`tests/` 是自動測試包（不含任何真實資料）。在電腦上：

```bash
cd tests && npm install && npx playwright install chromium
node run.js ../index.html
```

真實休假紀錄只在本機用 `--leave` 測試，不要放進這個儲存庫。
