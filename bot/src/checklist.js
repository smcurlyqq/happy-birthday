/**
 * Pre-trip checklist: who still has to do what, and the daily reminder.
 *
 * The pure parts (evaluate, selectDue, reminderText, progressText) take plain
 * data and are unit-tested without the network. remind() and progressBoard()
 * wire them to Notion, Claude and LINE.
 */

import * as db from "./notion.js";
import { push, text } from "./line.js";
import { englishFor } from "./classify.js";
import { DAYS, PAGE_URL, REMIND, todayIn } from "./config.js";

export const EMOJI = { flights: "✈️", visa: "🛂", stay: "🏠", data: "📶", insurance: "🩺", plan: "📅", money: "💴", other: "📌" };

/* ── pure ───────────────────────────────────────────────────── */

/** Whole days from a to b (both YYYY-MM-DD); positive when b is later. */
export const daysBetween = (a, b) => Math.round((Date.parse(b + "T12:00:00Z") - Date.parse(a + "T12:00:00Z")) / 864e5);

/**
 * Annotate Checklist rows with what the data already proves.
 * @param rows            from db.checklist()
 * @param crew            from db.members()  [{ id, name, flights }]
 * @param itineraryDates  Set of dates that have an Itinerary row
 * @returns rows + { who: member|null, group: bool, autoDone: bool, done: bool }
 */
export function evaluate({ rows, crew, itineraryDates }) {
  const byId = Object.fromEntries(crew.map(m => [m.id, m]));
  return rows.map(r => {
    const who = r.whoIds.length === 1 ? byId[r.whoIds[0]] || null : null;
    if (r.whoIds.length && !who) console.log("checklist: unknown crew page on row", r.id, r.whoIds);
    const group = !who;
    let autoDone = false;
    if (r.cat === "flights" && who) autoDone = !!(who.flights || "").trim();
    if (r.cat === "plan" && group) autoDone = DAYS.every(d => itineraryDates.has(d));
    return { ...r, who, group, autoDone, done: r.status === "done" || autoDone };
  });
}

/** Open, unmuted, dated rows that are exactly `lead` days out or due today. */
export function selectDue(rows, today, lead = REMIND.leadDays) {
  const open = rows.filter(r => !r.done && !r.mute && r.due);
  return {
    soon:  open.filter(r => daysBetween(today, r.due) === lead),
    today: open.filter(r => daysBetween(today, r.due) === 0),
  };
}

export function fmtDay(iso) {
  return new Date(iso + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/** Rows with the same title collapse to one line listing everyone still outstanding. */
function lines(rows, names) {
  const groups = new Map();
  for (const r of rows) {
    const key = r.title + "|" + r.due;
    const g = groups.get(key) || { title: names[r.id]?.title || r.title, note: "", cat: r.cat, due: r.due, people: [], group: false };
    if (!g.note) g.note = names[r.id]?.note || r.note || "";       // first row with a note wins
    if (r.group) g.group = true; else g.people.push(r.who.name);
    groups.set(key, g);
  }
  return [...groups.values()].map(g => {
    const who = g.group ? "everyone" : g.people.join(", ");
    const note = g.note ? ` ${g.note}` : "";
    return `${EMOJI[g.cat] || "📌"} ${g.title} (${fmtDay(g.due)}) — ${who}.${note}`;
  });
}

const FOOT = `Say “done” in here or tick it on the page → ${PAGE_URL}`;

/** The daily message, or null when there is nothing to say. */
export function reminderText({ soon, today }, names = {}) {
  if (!soon.length && !today.length) return null;
  const out = [];
  if (today.length) out.push("📋 Due today", ...lines(today, names));
  if (soon.length) {
    if (out.length) out.push("");
    out.push(`📋 ${REMIND.leadDays} days left`, ...lines(soon, names));
  }
  out.push("", FOOT);
  return out.join("\n");
}

/** The full board for the `progress` command. */
export function progressText(rows, names = {}, today) {
  const open = rows.filter(r => !r.done && !r.mute).sort((a, b) => (a.due || "9999").localeCompare(b.due || "9999"));
  const done = rows.filter(r => r.done && !r.mute);
  const out = [`📋 Progress · ${fmtDay(today)}`];
  if (!open.length) out.push("Nothing left on the list 🎉");
  for (const l of lines(open.filter(r => r.due), names)) out.push(l);
  for (const r of open.filter(r => !r.due)) out.push(`${EMOJI[r.cat] || "📌"} ${names[r.id]?.title || r.title} — ${r.group ? "everyone" : r.who.name}.`);
  if (done.length) {
    const byTitle = new Map();
    for (const r of done) { const t = names[r.id]?.title || r.title; byTitle.set(t, [...(byTitle.get(t) || []), r.group ? null : r.who.name]); }
    out.push("", "✓ Done: " + [...byTitle].map(([t, ppl]) => ppl.some(p => p === null) ? t : `${t} — ${ppl.join(", ")}`).join(" · "));
  }
  out.push("", FOOT);
  return out.join("\n");
}

/* ── wired ──────────────────────────────────────────────────── */

/** Read everything, apply the auto rules, and write Done back where the data proves it. */
export async function loadBoard(env) {
  const [rows, crew, dates] = await Promise.all([db.checklist(env), db.members(env), db.itineraryDates(env)]);
  const board = evaluate({ rows, crew, itineraryDates: dates });
  await Promise.all(board
    .filter(r => r.autoDone && r.status !== "done")
    .map(r => db.setTaskStatus(env, r.id, "done").catch(err => console.error("checklist auto-done write failed", r.id, String(err)))));
  return board;
}

/** English titles/notes for the rows, keyed by row id. Falls back to the originals. */
export async function boardNames(env, board) {
  const wanted = board.map(r => ({ id: r.id, title: r.title, note: r.note }));
  return englishFor(env, wanted);
}

/** The scheduled entry point. Returns the message it sent, or null. */
export async function remind(env, now = new Date()) {
  const gid = await db.config(env, "line_group_id");
  if (!gid) { console.log("remind: no group registered yet"); return null; }
  const board = await loadBoard(env);
  const today = todayIn(REMIND.timeZone, now);
  const sel = selectDue(board, today);
  if (!sel.soon.length && !sel.today.length) { console.log("remind: nothing due", today); return null; }
  const names = await boardNames(env, [...sel.soon, ...sel.today]);
  const msg = reminderText(sel, names);
  await push(env, gid, [text(msg)]);
  console.log("remind: sent", today, sel.soon.length, "soon,", sel.today.length, "today");
  return msg;
}

/** Text for the `progress` command. */
export async function progressBoard(env, now = new Date()) {
  const board = await loadBoard(env);
  const names = await boardNames(env, board);
  return progressText(board, names, todayIn(REMIND.timeZone, now));
}
