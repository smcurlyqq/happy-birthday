/**
 * Checklist reminder logic against a fixture — no network, no API key.
 *   node bot/test/remind.mjs
 *
 * The fixture mirrors the real board on 2026-09-17: eight rows, two of them
 * personal flight rows (Gigi, Nadia), Nadia's visa, and five group rows.
 */
import assert from "node:assert/strict";
import { evaluate, selectDue, reminderText, progressText, daysBetween } from "../src/checklist.js";

const crew = [
  { id: "c-gigi",  name: "Gigi",     flights: "" },
  { id: "c-akiha", name: "Akiha",    flights: "" },
  { id: "c-hye",   name: "Hye Yeon", flights: "KE656" },
  { id: "c-amber", name: "Amber",    flights: "B77026" },
  { id: "c-nadia", name: "Nadia",    flights: "" },
];
const row = (id, title, cat, due, whoIds = [], extra = {}) =>
  ({ id, title, cat, due, whoIds, status: "todo", mute: false, note: "", ts: 0, ...extra });
const rows = [
  row("t-plan",  "行程定案",        "plan",    "2026-10-12"),
  row("t-area",  "決定住哪一區",    "stay",    "2026-09-28"),
  row("t-keta",  "確認要不要申請 K-ETA", "visa", "2026-10-03"),
  row("t-book",  "訂住宿",          "stay",    "2026-10-01"),
  row("t-fl-g",  "訂機票",          "flights", "2026-09-21", ["c-gigi"]),
  row("t-fl-n",  "訂機票",          "flights", "2026-09-21", ["c-nadia"], { note: "簽證有譜了再訂。" }),
  row("t-money", "更新匯率、換點現金", "money",  "2026-10-14", ["c-amber"]),
  row("t-visa",  "韓國觀光簽證送件", "visa",   "2026-09-21", ["c-nadia"]),
];
const names = { "t-fl-g": { title: "Book flights", note: "" }, "t-fl-n": { title: "Book flights", note: "Book once the visa is in sight." }, "t-visa": { title: "Korea tourist visa", note: "" }, "t-area": { title: "Decide the area", note: "" } };

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };

/* auto rules */
{
  const flightsBooked = evaluate({ rows: [row("x", "訂機票", "flights", "2026-09-21", ["c-amber"])], crew, itineraryDates: new Set() })[0];
  ok(flightsBooked.autoDone && flightsBooked.done, "flight number in Crew ⇒ flights row auto-done");
  const b = evaluate({ rows, crew, itineraryDates: new Set() });
  ok(!b.find(r => r.id === "t-fl-g").done, "Gigi has no flight yet ⇒ open");
  ok(b.find(r => r.id === "t-area").group, "empty Who ⇒ group row");
  const full = new Set(["2026-10-17", "2026-10-18", "2026-10-19", "2026-10-20"]);
  ok(evaluate({ rows, crew, itineraryDates: full }).find(r => r.id === "t-plan").done, "all four days planned ⇒ plan row auto-done");
  ok(!evaluate({ rows, crew, itineraryDates: new Set(["2026-10-17"]) }).find(r => r.id === "t-plan").done, "one day planned ⇒ plan row still open");
  const muted = evaluate({ rows: [row("m", "x", "other", "2026-09-20", [], { mute: true })], crew, itineraryDates: new Set() });
  ok(selectDue(muted, "2026-09-17").soon.length === 0, "muted rows are never selected");
  const done = evaluate({ rows: [row("d", "x", "other", "2026-09-20", [], { status: "done" })], crew, itineraryDates: new Set() });
  ok(selectDue(done, "2026-09-17").soon.length === 0, "done rows are never selected");
}

/* the calendar */
const board = evaluate({ rows, crew, itineraryDates: new Set() });
const on = day => selectDue(board, day);
ok(daysBetween("2026-09-18", "2026-09-21") === 3, "daysBetween");
ok(reminderText(on("2026-09-17")) === null, "09-17: silent");
{
  const sel = on("2026-09-18");
  ok(sel.soon.map(r => r.id).sort().join() === "t-fl-g,t-fl-n,t-visa", "09-18: three days before the 21st → both flights + visa");
  const msg = reminderText(sel, names);
  ok(msg.startsWith("📋 3 days left"), "09-18 header");
  ok(msg.includes("✈️ Book flights (Sep 21) — Gigi, Nadia."), "09-18 collapses the two flight rows into one line");
  ok(msg.includes("🛂 Korea tourist visa (Sep 21) — Nadia."), "09-18 names Nadia for the visa");
  ok(msg.includes("Book once the visa is in sight."), "09-18 appends the English note");
  ok(!msg.includes("Amber") && !msg.includes("Hye Yeon"), "09-18 never names people without an open row");
}
ok(reminderText(on("2026-09-19")) === null, "09-19: silent (only lead day and due day speak)");
{
  const msg = reminderText(on("2026-09-21"), names);
  ok(msg.startsWith("📋 Due today"), "09-21 header");
  ok(!msg.includes("3 days left"), "09-21 has no lead section");
}
ok(reminderText(on("2026-09-22")) === null, "09-22: past due ⇒ silent, no nagging forever");
{
  const msg = reminderText(on("2026-09-25"), names);
  ok(msg.includes("🏠 Decide the area (Sep 28) — everyone."), "09-25: group row says everyone");
}
{
  const sel = on("2026-09-28");
  ok(sel.today.map(r => r.id).join() === "t-area" && sel.soon.map(r => r.id).join() === "t-book", "09-28: area due today, booking due in 3 days");
  const msg = reminderText(sel, names);
  ok(msg.indexOf("Due today") < msg.indexOf("3 days left"), "09-28: today section comes first");
}
ok(reminderText(on("2026-10-09")).includes("行程定案"), "10-09: untranslated title falls back to the Chinese one");

/* Gigi books: only Nadia stays */
{
  const crew2 = crew.map(m => m.name === "Gigi" ? { ...m, flights: "TG658" } : m);
  const b2 = evaluate({ rows, crew: crew2, itineraryDates: new Set() });
  const msg = reminderText(selectDue(b2, "2026-09-18"), names);
  ok(msg.includes("Book flights (Sep 21) — Nadia.") && !msg.includes("Gigi"), "flight number filled ⇒ Gigi drops out of the reminder");
}

/* progress board */
{
  const txt = progressText(board, names, "2026-09-17");
  ok(txt.startsWith("📋 Progress · Sep 17"), "progress header");
  ok(txt.includes("Book flights (Sep 21) — Gigi, Nadia."), "progress lists open personal rows");
  ok(txt.includes("Decide the area (Sep 28) — everyone."), "progress lists open group rows");
  ok(!txt.includes("✓ Done"), "nothing done yet ⇒ no done line");
  const crew2 = crew.map(m => m.name === "Gigi" ? { ...m, flights: "TG658" } : m);
  const txt2 = progressText(evaluate({ rows, crew: crew2, itineraryDates: new Set() }), names, "2026-09-17");
  ok(txt2.includes("✓ Done: Book flights — Gigi"), "done line names who finished");
}

console.log(`remind: ${checks} checks passed`);
