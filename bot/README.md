# Seoul Loop — LINE collector bot

Lives in the trip's LINE group and files things into Notion so nobody has to open Notion mid-conversation.

```
Gigi:   this one looks nice https://www.airbnb.com/rooms/12345
bot:    🏠 Filed under Stays · Sunny Hanok Stay · airbnb.com
        [I’m in]  Wrong kind? [Food] [Cafe] [Sight] [Shop] [Night]

Nadia:  we should try Gwangjang Market!! the mung bean pancakes
bot:    🍽 Filed under Ideas › Food · Gwangjang Market
        [I’m in] …

Akiha:  廣藏市場行きたい！
bot:    ✓ Akiha is in · Gwangjang Market · 2 votes

Gigi:   paid 45000 for dinner at Mangwon
bot:    💸 45,000 KRW · dinner at Mangwon · paid by Gigi · split 5 ways

Amber:  10/18 下午兩點景福宮，5號出口集合
bot:    📅 Sun, Oct 18 · 14:00 · Gyeongbokgung Palace · meet at exit 5

Gigi:   booked my flight!! arriving sat morning
bot:    ✓ Book flights · Gigi done · still waiting on Nadia

Amber:  remind everyone to buy a T-money card by Oct 10
bot:    📋 Added · Buy a T-money card · Oct 10 · everyone

Hye Yeon: ㅋㅋㅋㅋ 사진 보내줘
bot:    (nothing — it stays out of the conversation)

bot:    (18:00 Bangkok, three days before a deadline, unprompted)
        📋 3 days left
        ✈️ Book flights (Sep 21) — Gigi, Nadia.
        🛂 Korea tourist visa (Sep 21) — Nadia.
        Say “done” in here or tick it on the page → https://…/korea/
```

## How it decides

| Message | Path |
|---|---|
| Has a link | The page is fetched (Naver Map links via the mobile place page, whose embedded JSON gives category, address and review tags), then Claude turns title + description + visible text into an “English (Korean)” title, kind, area and a short note. If Claude is unavailable, host/word rules take over. |
| Is an image | Claude Haiku 4.5 looks at it: a shop / map / listing / review screenshot becomes an idea (or stay, or a vote if it's already listed); selfies, memes and chat screenshots are ignored. |
| No link | Claude Haiku 4.5 classifies it as expense / idea / itinerary / vote / bind / help / progress / task / ignore. Anything unclear → ignore, silently. |

The classifier sees today's date (Seoul and Bangkok), the trip dates, the five names, the current Ideas/Stays titles and the open checklist rows, so "I'm in for Gwangjang" and "booked my flight" resolve to the right row.

Every card has an **I'm in** button — that is the vote. Wrong category? Tap the right one.

## Commands (any of the five languages)

| Type | Effect |
|---|---|
| `I am Gigi` · `我是 Gigi` · `私は Gigi` · `저는 Gigi` · `saya Gigi` | Links your LINE account to the Crew row, once. Needed before expenses and votes are credited to you. |
| `help` · `說明` · `ヘルプ` · `도움말` · `bantuan` | Shows the help text again. |
| `unlink me` · `解除綁定` · `連携解除` · `연결 해제` · `lepas tautan` | Frees your seat. A seat linked to one LINE account can't be claimed by another until then; one account holds at most one seat. |
| `progress` · `status` · `進度` · `進捗` · `진행` · `kemajuan` | The pre-trip checklist right now: what is still open, who is outstanding, what is done. |
| `group id` | This group's LINE id and whether the bot is registered here (diagnostic). |
| `use this group` | Registers this group for reminders when none is registered yet. |

Names must match the Crew table: Amber · Akiha · Hye Yeon · Gigi · Nadia.

## What gets written where

| Intent | Notion board | Fields |
|---|---|---|
| link / idea | Ideas (or Stays) | Place, Link, Kind, Area, Note, Added by, Status = Idea |
| expense | Expenses | Item, Amount, Currency (default KRW), Category, Date (today, Seoul), Paid by = you, Split with (everyone unless you name people) |
| itinerary | Itinerary | What, Date (10/17–20 only), Time, Where, Kind, Owner |
| vote | Ideas / Stays | adds you to Who's in |
| progress | Checklist | sets the row's 狀態 Status to 完成 Done — your own row, or a row that is for everyone |
| task | Checklist | one new row per named person (or one for everyone): 任務 Task, 類別 Category, 截止 Due, 誰 Who |

## The pre-trip checklist

Board 6 (`出發前任務 Checklist`) lists what has to happen before the trip. A row with one person in `誰 Who` is that person's; a row with nobody is for the whole group. The bot works out "done" from the data before it asks anyone:

| Category | Counts as done when |
|---|---|
| 機票 Flights (one person) | that person's `Flights` field in Crew is filled in |
| 行程 Plan (everyone) | all four trip dates have at least one Itinerary row |
| anything else | `狀態 Status` is 完成 Done — set in Notion, by saying it in the group, or by ticking it on the web page |

When the data proves a row done, the bot writes 完成 Done back so Notion and the page agree. `靜音 Mute` hides a row from every reminder.

People who have linked their LINE account (`I am <name>`) are @-mentioned in reminders and on the `progress` board; anyone unlinked appears as a plain name. LINE caps a message at 20 mentions, so beyond that the rest fall back to names.

**Reminders** go out once a day at 18:00 Bangkok (the cron line in `wrangler.toml` is UTC): three days before a deadline and on the day itself, naming only the people who are still outstanding. Nothing due → nothing sent. Rows past their date are not repeated. Chinese titles and notes are turned into short English lines by Claude (cached); if that fails the original text is sent.

## Only your group

The bot serves one group and registers it itself: the first time it is invited into a group it writes that group's id into board 7 (`機器人設定 Bot config`, key `line_group_id`). From then on it leaves any other group it is added to and never calls Claude or Notion for them, and the daily reminder is pushed to the registered group. To move it, clear the value in Notion and invite the bot again (or type `use this group` in the new group once the value is empty). One-to-one chats are always ignored.

## Setup

Secrets in the repo (Settings → Secrets and variables → Actions):

| Secret | From |
|---|---|
| `CLOUDFLARE_API_TOKEN` | dash.cloudflare.com/profile/api-tokens → "Edit Cloudflare Workers" template. Account Resources and Zone Resources must both be filled in. |
| `CLOUDFLARE_ACCOUNT_ID` | the 32-char id in the dashboard URL |
| `LINE_CHANNEL_SECRET` | LINE Developers → channel → Basic settings |
| `LINE_CHANNEL_ACCESS_TOKEN` | LINE Developers → Messaging API → Issue |
| `NOTION_TOKEN` | notion.so/profile/integrations → the integration's secret. The integration must be connected to the Seoul Loop page. |
| `ANTHROPIC_API_KEY` | console.anthropic.com → API keys |

Then Actions → **Deploy LINE bot** → Run workflow. The Worker lands at `https://seoul-loop-bot.<account>.workers.dev`; the LINE webhook URL is that plus `/webhook`. The same deploy installs the daily cron trigger.

LINE side: Messaging API → Use webhook on, Allow bot to join group chats on, Auto-reply messages off, and in the Official Account Manager the chat mode must be **Bot**.

## Testing

Actions → **Test bot classifier** → Run workflow. First runs the checklist reminder logic against a fixture (`test/remind.mjs`, no key needed), then feeds ~45 messages in five languages through the real classifier and prints intent, confidence and latency for each. Costs a few cents.

After a deploy, type `progress` in the group and compare with the Notion board by eye — that is the same code path as the daily push, minus the sending.

## The web page's API

The same Worker serves `/api` for `korea/index.html`, so the page and the bot share one set of Notion boards:

| Route | Does |
|---|---|
| `GET /api/state` | everything the page needs — members, prefs, ideas (Stays included as `cat: stay`), slots, expenses, tasks |
| `PUT /api/:coll/:id` | upsert one document (`members`, `prefs`, `ideas`, `slots`, `expenses`; for `tasks` only `status` is written) |
| `DELETE /api/:coll/:id` | archive it |

Only `https://smcurlyqq.github.io` (and localhost) may call it. Page ids are kept in each board's `Client ID` property. Field mappings are the tables at the top of `src/api.js`; if a Notion option is renamed, change it there too.

## Code

- `src/index.js` — webhook entry, routing, the intent handlers
- `src/classify.js` — the Claude call and the output schema
- `src/checklist.js` — the pre-trip checklist: auto rules, who is outstanding, the daily reminder, the `progress` board
- `src/notion.js` — reads and writes for the seven boards (English property names on the trip boards, bilingual on Checklist / Bot config)
- `src/line.js` — replies, pushes, help text, the Flex card, leaving groups
- `src/links.js` — URL extraction, page metadata, host/word rules
- `src/api.js` — the web page's `/api` data layer over the same boards

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Bot never answers | Chat mode isn't Bot, or Use webhook is off |
| Verify fails | Webhook URL is missing `/webhook` |
| `notion 404` in logs | Integration not connected to the page |
| `notion 401` | Wrong NOTION_TOKEN |
| `classify failed` in logs | Wrong ANTHROPIC_API_KEY, or no credits |
| Filed but the title is a bare URL | That site blocks crawlers (Instagram, mostly). Fix the title in Notion. |
| Expense/vote answered "Tell me who you are first" | Type `I am <name>` once |
| No reminder arrived | `line_group_id` in Bot config is empty (type `use this group`), or nothing was due that day — `progress` shows the board |
| Reminder is in Chinese | Claude was unreachable at 18:00; the original text is sent instead |

Logs: Cloudflare dashboard → Workers & Pages → seoul-loop-bot → Logs, or `npx wrangler tail` locally.
