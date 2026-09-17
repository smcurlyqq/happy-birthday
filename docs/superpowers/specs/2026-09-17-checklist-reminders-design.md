# Seoul Loop — pre-trip checklist follow-ups

Date: 2026-09-17. Agreed with Amber in conversation; this is the written record.

## Goal

Before the trip the bot follows up on the things that must happen (flights booked, Nadia's visa filed, area decided, stay booked, plan settled). It nags only around deadlines, never nags someone who is already done, and it works out "done" from data that already exists before asking anyone. People can report progress by saying it in the group or by ticking it on the web page.

## 1. Data — two Notion boards Amber already created

Nothing new is created. The bot reads and writes these exactly as they are.

**6 · 出發前任務 Checklist** (`70f44f67014a44e084feb8c116b7efd7`, data source `137d7c07-9b0f-4bfd-a13d-177560b9bc28`)

| Property | Type | Meaning |
|---|---|---|
| `任務 Task` | title | what to do |
| `類別 Category` | select | `機票 Flights` · `簽證 Visa` · `住宿 Stay` · `網路 Data` · `保險 Insurance` · `行程 Plan` · `錢 Money` · `其他 Other` |
| `誰 Who` | relation → Crew | one person = personal task; empty = the whole group |
| `截止 Due` | date | deadline (a date, no time) |
| `狀態 Status` | select | `待辦 To do` · `進行中 Doing` · `完成 Done` |
| `靜音 Mute` | checkbox | ticked = never remind |
| `備註 Note` | text | one line appended to the reminder |

Personal tasks are one row per person (e.g. two "訂機票" rows, one for Gigi, one for Nadia). Property names stay bilingual as they are; the bot addresses them by these exact strings in `bot/src/notion.js`.

**7 · 機器人設定 Bot config** (`23b6501d3a7640d0ae2a7f8326055bd1`, data source `64363940-5b1e-474c-8b4a-f4762e346604`)

Key/value rows: `項目 Key` (title), `值 Value` (text), `說明 Note` (text). One row exists: `line_group_id`, empty. The bot fills it the first time it is invited into a group; the scheduled reminder pushes there. It replaces the `ALLOWED_GROUP_IDS` variable in `wrangler.toml`.

Both database ids go into `wrangler.toml` `[vars]` as `NOTION_CHECKLIST_DB` and `NOTION_CONFIG_DB`.

## 2. Group id — self-registration replaces the allow-list

- `join` event, config value empty → write the group id to `line_group_id`, reply with the help text.
- `join` event, config value set and different → leave the group silently (as today for uninvited groups).
- Any other event from a group that is not the registered one → ignore (no Claude, no Notion).
- The `group id` command stays as a diagnostic: it replies with the current group's id whenever the sender's group is the registered one or none is registered yet.
- `ALLOWED_GROUP_IDS` is removed from `wrangler.toml`, `bot/README.md` and `SEOUL-LOOP.md`. To move the bot to another group: clear the value in Notion, invite the bot again.
- The config row is read on every event; a module-level cache holds it for 60 s so a burst of messages costs one Notion query.

## 3. What counts as done

For each Checklist row that is not `完成 Done` and not muted, `bot/src/checklist.js` computes `done` from data before it looks at the Status column:

| Category | Auto rule |
|---|---|
| `機票 Flights`, one person in Who | that person's Crew `Flights` text is non-empty |
| `行程 Plan`, Who empty | every one of the four trip dates has at least one Itinerary row |
| everything else | no auto rule; Status column only |

When an auto rule says done, the bot writes `狀態 Status = 完成 Done` to the row so Notion and the page agree. Auto never un-does a row.

"Who is outstanding" for a row = the person in Who if it is personal and not done; "everyone" if it is a group row and not done.

## 4. Scheduled reminder

`wrangler.toml` gets `[triggers] crons = ["0 11 * * *"]` — 18:00 Asia/Bangkok every day (all five live in Thailand; only in-trip times are Seoul). `src/index.js` exports a `scheduled` handler that calls `remind(env)`.

`remind(env)`:

1. Read config; if `line_group_id` is empty, log and stop.
2. Read Checklist, Crew, Itinerary. Apply §3 (this may write Done back).
3. `today` = calendar date in Asia/Bangkok. For every open, unmuted row with a Due date: it is *due-soon* when `Due − today` is exactly 3 days, and *due-today* when it is 0. Rows with no Due are never pushed.
4. If nothing is due-soon or due-today → send nothing.
5. Otherwise build one English message and push it to the group (`POST /v2/bot/message/push`, new `push()` in `line.js`). One message per day at most. Rows past their Due date are not repeated; the Due-day mention is the last one.

Message shape (one line per row, personal rows list the people still outstanding, group rows say "everyone"; the Note is appended when present; the page link closes the message):

```
📋 3 days left
✈️ Book flights (Sep 21) — Gigi, Nadia. Put the flight number in Crew when done.
🛂 Korea tourist visa (Sep 21) — Nadia. This is the tightest deadline of the trip.

Say “done” in here or tick it on the page → https://smcurlyqq.github.io/happy-birthday/korea/
```

Header is `📋 Due today` on the day itself. Task titles are pushed through the same Claude tidy call used for links so Chinese titles come out as short English lines; if Claude fails the Chinese title is sent as-is.

`progress` (also `status`, `進度`) typed in the group replies immediately with the full board: every open row with its due date and who is outstanding, plus a `✓` line for done rows. Same builder as the push, `reply` instead of `push`. This is the manual test path.

## 5. Reporting progress in the chat

Two new classifier intents in `bot/src/classify.js`:

- `progress` — the sender says they finished something: "booked my flight", "visa submitted", "we booked the airbnb", "done with the form". Output `{ target_id }` chosen from the open Checklist rows injected into the prompt (id, task, category, who). A personal row is only a valid target for its own person; a group row for anyone. Bot marks `狀態 Status = 完成 Done`, replies `✓ Book flights · Gigi done · still waiting on Nadia` (or `✓ Book the stay · done` for group rows). Requires binding, as expenses do. If the sender is not bound → `BIND_FIRST`.
- `task` — the sender asks the group to remember something with a date: "remind everyone to buy T-money by Oct 10", "we need to decide the meeting point by Oct 8". Output `{ title, due, category, who: string[] }`. Creates one row per named person, or one group row if none named. No date → `ignore`. Reply `📋 Added · Buy T-money · Oct 10 · everyone`.

Both go through the same confidence gate (`< 0.7` → silent). The `ignore` rule in the prompt is extended: a question ("did everyone book?") is not progress.

Flight screenshots are still `ignore` in the image classifier — out of scope.

## 6. Web page

`korea/index.html`, Trip pane, a **Progress** card above the pre-flight checklist:

- Personal rows grouped by task title: one line per task, five small avatars, done ones filled. Tapping your own avatar toggles your row's Status between To do and Done. Others' avatars are display-only.
- Group rows: one line with a single checkbox anyone can tick.
- Overdue and due-within-3-days rows show the date in the accent colour.
- Muted rows are hidden.
- Five-language strings for the card title, "everyone", "due", "done"; task titles come from Notion as written.

Data layer: `/api/state` gains `tasks: { [id]: { title, cat, who: seat|null, due, status, mute, note } }`; `PUT /api/tasks/:id` accepts `{ status }` only. No creating or deleting tasks from the page. Local-first window and 15 s polling as for the other collections.

## 7. Error handling

- Notion or LINE failing inside `scheduled` → log, do nothing, tomorrow's run is independent. No retry, no queue.
- Claude failing when tidying titles → send the raw titles.
- `progress` where the classifier picks a personal row belonging to someone else → treat as `ignore`.
- A row whose Who points at a Crew page the bot cannot map → treated as a group row and logged.

## 8. Tests

- `bot/test/classify.test.js` (the "Test bot classifier" workflow) gets samples for `progress` (5, incl. one question that must be ignored) and `task` (3, incl. one without a date that must be ignored).
- New `bot/test/remind.test.js`: pure function `buildReminder(rows, crew, itinerary, today)` run against a fixture for 2026-09-17 (silent), 09-18 (3 days before the 21st), 09-21 (due today), 09-25, 09-28, 10-09. Asserts who is named and that auto-done people are absent.
- After deploy: type `progress` in the group and compare with Notion by eye.

## 9. Docs

`SEOUL-LOOP.md` (new section for boards 6 and 7, cron, group-id registration; remove the allow-list next step), `bot/README.md` (commands `progress`, examples for progress/task), `bot/src/config.js` (reminder hour and lead days as constants). Syncing this into the `trip-loop` skill assets is a separate task after it has run in the real group.

## Out of scope

Flight-screenshot detection, adding tasks from the web page, per-person direct messages (the bot only ever speaks in the group), reminders for rows without a due date.
