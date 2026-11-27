# 修改程式的方法

網站和離線使用的都是同一個檔案 `index.html`，但**不要直接改 `index.html`**。
它是由 `src/`（程式）與 `vendor/`（外部套件）組合出來的；改完原始碼後執行：

```bash
node build.js          # 產生 index.html，並更新 sw.js 的版本號
node build.js --check  # 只檢查 index.html、sw.js 是否和原始碼一致
```

`build.js` 不需要安裝任何套件。`index.html` 與 `sw.js` 仍要一起提交（GitHub Pages 與離線版直接使用它們）。

## 檔案在哪裡

| 位置 | 內容 |
|---|---|
| `src/index.html` | 畫面結構（HTML）與各檔的組合順序 |
| `src/css/base.css` → `controls.css` → `touch.css` → `theme.css` | 樣式，依序疊加；配色與字級等設計值在 `theme.css` 開頭的 `--duty-*` |
| `src/js/rules.js` | **規則表**：事件禁排（休假、車勤…）與班與班之間的規則數值 |
| `src/js/app/01`～`13-*.js` | 工作台主程式，依編號串接成同一段程式（共用變數），檔名即內容 |
| `src/js/audit.js` | 獨立巡檢（第二套規則判定，只檢查、不排班） |
| `src/worker/zero.js`、`precision.js`、`objectives.js` | 背景精算（HiGHS 整數規劃模型） |
| `src/js/pwa.js`、`sw.js` | 離線快取與「有新版本」提示 |
| `vendor/` | HiGHS 求解器（WebAssembly）與授權條款，不要修改 |
| `tests/` | 自動測試包 |

## 新增或修改一條排班規則（檢查清單）

規則刻意由**三套各自撰寫的程式**判定，任何一套寫錯，另外兩套會抓到。因此改規則時三處都要改：

1. **規則表** `src/js/rules.js`：若只是改數值（例如休息 6 → 8 小時），只改這裡即可，其他程式都讀這張表。
2. **排班判定** `src/js/app/02-eligibility-targets.js`：`eventRuleReason()`、`staticReason()`（個人事件）、`conflict()`（班與班之間）。
3. **獨立巡檢** `src/js/audit.js`：`independentScheduleAudit()`。不要從第 2 點複製程式碼，請依規章重新寫一次。
4. **測試驗算器** `tests/lib/verify.js`：同樣自己重寫一次。
5. **精算模型**（若規則限制「誰能站哪一班」）：`src/worker/precision.js` 的 `incompatibleDoorSlots()`、`officerRunsOk()` 與模型限制式，`src/worker/zero.js` 的初排模型。精算結果都會再經過第 2、3 點檢查，寫錯不會放出違規班表，但可能錯失最佳解或誤判「已證明最優」。
6. **規則設定頁**（若要讓使用者在畫面上調整）：`src/js/app/04-precision.js` 的 `renderRuleSettings()`。
7. **內建自測** `src/js/app/03-fill-repair-selftest.js` 的 `runRuleSelfTests()`：加幾個「應該擋下／應該允許」的例子。
8. **測試包**：`tests/run.js` 的 `VARIANTS` 加一個改這條規則數值的變體；新事件類型請加進 `tests/lib/consistency.js` 的 `loadEventRich()`。

然後執行 `node build.js` 與測試。**「三套規則一致」** 測試會把班表隨機改壞上千次，比對三套判定出的違規人員是否完全相同；任何一處漏改都會失敗並列出例子。

## 測試

```bash
cd tests && npm install && npx playwright install chromium
node run.js ../index.html --quick --only selftest,demo,consistency,update,stress,settings,burden   # 約 10 分鐘，和 GitHub 上的自動測試相同
node run.js ../index.html --expect-exact-variants                                          # 完整測試，約 1 小時
node run.js ../index.html --baseline 舊版.html --only equivalence                           # 改版前後規則判定是否完全相同
```

真實休假紀錄只在自己電腦用 `--leave` 測試，**不要放進儲存庫**；備份檔也不要上傳。

## 發布

推送到 `main` 後，GitHub Actions（`.github/workflows/test-and-deploy.yml`）會：

1. 檢查 `index.html`、`sw.js` 與原始碼一致；
2. 執行自動測試；
3. **全部通過才發布**到 GitHub Pages。失敗時網站維持上一版。

使用者端不會被強制換版：開啟時一律用已存下的版本，新版本在背景下載好後畫面下方出現「有新版本可以使用」，按「更新」才切換（排班或精算進行中會請他稍後再按）。

需要退回上一版時，在 GitHub 上把該次提交 revert，自動測試通過後即重新發布。

更新紀錄寫在 `CHANGELOG.md`。
