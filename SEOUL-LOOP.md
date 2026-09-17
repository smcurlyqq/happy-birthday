# Seoul Loop — 交接筆記

首爾四日旅行（2026/10/17 六 – 10/20 二）的共同計畫工具。五個人來自五個國家：
Amber 🇹🇼 · Akiha 🇯🇵 · Hye Yeon 🇰🇷 · Gigi 🇭🇰 · Nadia 🇮🇩

這份文件是給「接手繼續做的人」看的 —— 包含現在的狀態、所有 ID、已經做過的決定和踩過的坑。

---

## 現在有三個東西

| | 位置 | 狀態 |
|---|---|---|
| **網頁** | `korea/index.html` | ✅ 已合併到 `main`（PR #3，2026-09-11），公開網址已生效 |
| **Notion** | 見下方連結 | ✅ 五個資料庫都建好、資料已填；已開「任何有連結的人 → 可編輯」 |
| **LINE bot** | `bot/` | ✅ 已部署到 Cloudflare Worker，webhook 已接上 LINE；**尚未在真實群組實測** |

分支 `claude/korea-trip-planner-tou9gc` 已合併，之後直接在 `main` 上改。

---

## 一、網頁

`korea/index.html` — 單一檔案，無建置步驟，無外部相依（字型走 Google Fonts）。

**功能**：進入頁（選語言＋選你是誰）、倒數、進度卡（Checklist 表：個人任務一人一個頭像，點自己的切換完成；全員任務一個勾；自動判定的不能手動改）、出發前檢查清單、五國語言（zh/ja/ko/en/id 自動偵測）、喜好蒐集與即時統計、口袋名單投票、每日行程、多幣別記帳與最少轉帳結清、複製 LINE 摘要。

**資料層（`connect()` 自動判斷）**：
- 2026-09-11 深夜起：靜態託管時走 bot Worker 的 `/api`，背後就是 Notion 五個表，所以**大家在網頁上看到的是同一份**。每 15 秒輪詢、寫入後 1 秒再拉。匯率留在各自裝置。
- 當作 Claude Artifact 開啟 → 仍用 `claude.use("db")`。
- 兩個都不行才退回 `localStorage`。

Artifact 網址：<https://claude.ai/code/artifact/eaf9ed37-cc32-4be6-be16-f1ef6a601103>
（⚠️ 宣告了共享資料庫的 artifact 屬於組織內部，**不能公開分享**，所以朋友打不開。這就是 Notion 存在的原因。）

外觀 2026-09-11 晚上改成圓潤風（Inter + Noto Sans，暖奶油底、橘色重點、圓角卡片），Bodoni 雜誌風被 Amber 否決。顯示幣別一律泰銖（五個人都住泰國），記帳輸入一律韓元。成員卡顯示抵達首爾時間。Taste 表單：住宿型態多選、住宿預算每人每晚（THB）、旅行習慣多選、13 個住宿區域。所有日期時間都是首爾時區。

推到 `main` 之後，既有的 `.github/workflows/pages.yml` 會自動部署到：
```
https://smcurlyqq.github.io/happy-birthday/korea/
```
這個網址是公開的，可以直接貼 LINE 群。**已生效（2026-09-11）。**

要改的地方都在 `index.html` 的常數區：`DAYS`（四天日期）、`SEATS`（五個人與代表色）、`RATES0`（預設匯率）。

---

## 二、Notion

主頁：<https://www.notion.so/3d6b331a325081989f75d13d4fff3184>

| 資料庫 | Database ID |
|---|---|
| 1 · 成員與喜好 Crew & taste | `c730a79cc4694546942f11785f80cb66` |
| 2 · 口袋名單 Ideas | `883484141f0c4f3c85e713cbbc6a51cb` |
| 3 · 每日行程 Itinerary | `31a197b2431b43d29e66018af9e01086` |
| 4 · 記帳 Expenses | `e7220d9f26ef46008598a0e8583bcd0b` |
| 5 · 住宿候選 Stays | `d2986ee9b16b45c5b4db8938235fdfab` |
| 6 · 出發前任務 Checklist | `70f44f67014a44e084feb8c116b7efd7` |
| 7 · 機器人設定 Bot config | `23b6501d3a7640d0ae2a7f8326055bd1` |

**已完成**：Notion 右上 Share → Anyone with the link → **Can edit**（2026-09-11）。

**匯率是寫死在公式裡的**（1 TWD = 45 KRW、1 JPY = 9.5、1 HKD = 185、1 IDR = 0.088、1 USD = 1440）。
出發前要更新的話，得去改公式，不是改欄位。網頁上的匯率則可以直接編輯。

2026-09-11 晚上整個 Notion 改成純英文：資料庫叫 Crew / Ideas / Itinerary / Expenses / Stays，欄位名與選項值都去掉中文，主頁說明文也是英文。bot 程式裡寫死的欄位名跟這個對應，改欄位名要一起改 `bot/src/notion.js`。Crew 的 `LINE ID` 欄位是給 bot 綁定用的。

2026-09-17 新增兩張表（欄位名是中英雙語，bot 用 `bot/src/notion.js` 裡的 `CL` / `STATUS` / `CATS` 常數對應）：

- **6 · 出發前任務 Checklist**：出發前要做的事。`誰 Who` 填一個人 = 個人任務（一人一列，例如訂機票有 Gigi、Nadia 兩列）；空白 = 全員任務。`截止 Due` 是提醒的依據，`靜音 Mute` 勾了就不提醒。設計文件：`docs/superpowers/specs/2026-09-17-checklist-reminders-design.md`。
- **7 · 機器人設定 Bot config**：key/value。目前只有 `line_group_id`，bot 第一次被邀進群會自己填，之後定時提醒推到這個群。要換群就把值清空再邀一次。

---

## 三、LINE bot（v2，2026-09-11 晚上上線）

`bot/` — Cloudflare Worker。設計文件：`docs/superpowers/specs/2026-09-11-bot-v2-ai-collector-design.md`，使用說明：`bot/README.md`。

**行為**：
- 有連結的訊息 → 抓網頁（Naver 短網址轉 m.place，從內嵌 JSON 拿類別／地址／評論標籤）→ Claude 整理成「英文（韓文）」標題、類別、區域、備註。Claude 掛掉才退回網域規則。
- 沒有連結的訊息 → 全部丟給 Claude Haiku 4.5（結構化輸出），判成 expense / idea / itinerary / vote / bind / help / ignore。ignore 或信心 < 0.7 就完全不回。
- 每張卡片有「I'm in」按鈕 = 投票；打錯類別按一下改。
- 歡迎／說明是一則訊息五段（en/ja/ko/粵/id），範例句一律英文，附旅行網頁網址，不提 Notion。其他回覆純英文；指令字五語都認（我是／私は／저는／saya／I am；說明／ヘルプ／도움말／bantuan／help）。
- 圖片訊息也會收：抓 LINE 原圖丟給 Haiku 看，認得出店家就收 idea（飯店進 Stays、已在名單就投票），看不出來安靜。測試圖在 `bot/test/fixtures/`。
- Naver 地圖短網址（naver.me）會轉去抓 m.place.naver.com 拿店名，因為桌面版地圖頁沒有標題。
- 「let's try X」不管 X 認不認得都收；帶問號的時間提議（wanna / should we / 〜行かない？）不記行程。
- 群裡打 `group id` 會回群組 ID 和「是否已登記」；`use this group` 在還沒登記時把這個群登記進 Bot config。卡片和回覆只連旅行網頁，不連 Notion。
- 記帳、投票需要先綁定（I am 名字），否則 bot 會請他先綁。
- **出發前任務追蹤（2026-09-17）**：每天曼谷 18:00（`wrangler.toml` 的 cron `0 11 * * *`，UTC）跑一次，讀 Checklist 表，截止前 3 天和當天各點名一次還沒完成的人，沒東西到期就不出聲，過期不再追。機票類看 Crew 的 Flights 欄有沒有填、行程類看 Itinerary 四天是否都有東西，資料證明完成就自動把狀態寫成 完成 Done。群裡說「booked my flight」「visa submitted」會標完成（只能標自己的列或全員列）；「remind everyone to X by Oct 10」會新增一列。打 `progress` 立刻看整張進度板，這也是上線後的測試路徑。有綁定（I am 名字）的人在提醒和進度板裡會被真的 @ 到（LINE textV2 mention），沒綁的只顯示名字。中文標題和備註送出前會請 Claude 翻成英文短句（有快取），Claude 掛了就直接送中文。

**只服務一個群**：bot 第一次被邀進群，就把群組 ID 寫進 Notion Bot config 的 `line_group_id`。之後被拉進別的群會自動退出，也不會為別的群呼叫 Claude 或 Notion。還沒登記前（值空白）任何群都能用，方便測試；但定時提醒要有登記才會發。一對一私訊一律不理。`wrangler.toml` 已經沒有 `ALLOWED_GROUP_IDS`。

**程式結構**：`src/index.js`（路由與各意圖處理、cron 入口）、`src/classify.js`（Claude：分類、連結整理、標題翻譯）、`src/checklist.js`（任務進度：自動判定、點名、進度板）、`src/notion.js`（七個資料庫的讀寫）、`src/line.js`（回覆、推播、說明、卡片、退群）、`src/links.js`（連結路徑）、`src/api.js`（網頁資料層）。

### 部署狀態

- Worker：`https://seoul-loop-bot.smcurlyqq.workers.dev`（GET 會回「Seoul Loop bot is awake」）
- LINE channel：provider `mbqq` → channel `mbpp`（channel id 2011563838）。群組裡顯示的名字是 mbpp。
- Webhook URL 已填 `…/webhook`，Use webhook 已開；Allow bot to join group chats 開、Auto-reply 關。
- Notion 整合「Seoul Loop bot」已 Connect 到首爾主頁，五個資料庫繼承權限。
- 六個 GitHub secrets 都已設定（Cloudflare ×2、LINE ×2、Notion、Anthropic）。要重新部署：Actions → Deploy LINE bot → Run workflow（推 `main` 不會自動部署）。
- 分類測試：Actions → Test bot classifier → Run workflow，先跑 `test/remind.mjs`（提醒邏輯，不用金鑰），再跑 46 則五語文字樣本（含 progress / task）+ 1 張截圖。2026-09-12 舊版結果 34/35，唯一沒對的是字面上的「let's try OOO」佔位符被略過，真實店名都會收。
- ❌ **尚未在真實群組實測**。下一步：Actions 重新部署（拿到 cron）→ 拉進群 → 它會自己登記群組 ID → 打 `progress` 對照 Notion → 各種訊息各試一則。

**Anthropic**：console.anthropic.com 帳號 ambre，key 名稱 seoul-loop-bot，已儲值 5 美元。Haiku 4.5 每則訊息幾百 token，整趟旅行預估不到 1 美元。

網頁 `/api` 見 `bot/src/api.js` 與 `bot/README.md`；Notion 每個表多了 `Client ID` 欄位對應網頁的 id，別刪。Checklist 沒有 `Client ID`，網頁用 Notion page id 當 id，而且只能改狀態，不能從網頁新增或刪除任務。

Cloudflare API token 建立時的坑：「Edit Cloudflare Workers」範本套完後，Account Resources 和 Zone Resources 兩格都是必填但預設空的，要分別選自己的帳號和 All zones，不然 Continue to summary 按不下去。

## 已打包成 skill

整套（bot、網頁、workflows、Notion schema、設定步驟）做成公開的 Claude Code skill：https://github.com/smcurlyqq/trip-loop 。本機也連結到 `~/.claude/skills/trip-loop`。所有朋友名字、ID、網址都換成佔位符；trip-specific 設定集中在 `bot/src/config.js` 與網頁頂端常數。之後這個 repo 的 bot 若有大改，記得同步到 skill 的 `assets/`。

## 踩過／預期會踩的坑

1. **LINE 聊天模式沒改成 Bot** → webhook 完全不觸發，bot 像死掉一樣。
   在 LINE Official Account Manager → 回應設定。同一頁還要開 **Webhook**、關 **自動回應訊息**。
   Developers Console 那邊則要開 **Allow bot to join group chats**。
2. **Notion 整合沒 Connect 到頁面** → 所有 API 呼叫回 404。
   建完整合一定要回 Notion 頁面 ⋯ → Connections → Connect to。
3. **IG / 小紅書 / 抖音擋機器人抓資料** → 只拿得到網址，標題會是一串 URL。
   這是預期行為，所以卡片上的「改分類」按鈕是必要功能不是裝飾。
4. **Notion 不能把頁面搬到別的資料庫** → 跨資料庫改分類是「新建 + 封存舊的」，所以會換一個網址。
5. **headless Chrome 最小視窗寬度是 500px** → 用 430 截圖看到的切邊是假象，不是版面 bug。

---

## 做過的決定（不用重新想）

- **Notion 當共享資料層，不是網頁** — 因為宣告 db 的 Claude artifact 不能公開分享，五個不同國家的朋友沒有同一個組織帳號。
- **bot v1 不接 LLM**，v2（同日晚上）改接 Claude Haiku 4.5 — Amber 要收記帳、行程、投票、無連結推薦，沒有 AI 就得逼大家記指令符號；她選了 AI 判讀。有連結的訊息仍走規則，不花錢。
- **視覺走雜誌編輯風** — Bodoni Moda + Archivo，暖報紙底、細線、無圓角無陰影，單一深紅重點色，五個人用低彩度丹青顏料當識別色。這是使用者從四個方向裡挑的，第一版的首爾地鐵配色被否決了。
- **進入頁同時選語言** — 不然日文和印尼文的朋友一進來看到瀏覽器亂猜的語言。
- **記帳的「結清計算」留在網頁**，bot 只負責把每一筆寫進 Expenses。

---

## 下一步（建議順序）

1. Actions → Deploy LINE bot 重新部署（這版才有 cron 與 Checklist）。
2. 把 mbpp 加好友（LINE Developers → Messaging API 分頁的 QR code）→ 邀進群 → 它會回英文說明並自己把群組 ID 寫進 Bot config。
3. 群裡打 `progress`，對照 Notion Checklist；再實測：一個 Airbnb 連結、一句記帳、一句推薦、一句行程、按一次 I'm in、一句「booked my flight」、一句閒聊（應該沒反應）。每個人打 I am 名字綁定。
4. 提醒 🇮🇩 Nadia：**韓國對印尼不免簽**，觀光簽要及早送件。距離出發只剩約五週。
5. 網頁與 Notion 連結貼進群。
