/**
 * /api — the web page's shared data layer, backed by the same five Notion
 * boards the LINE bot writes to.
 *
 *   GET    /api/state              → { members, prefs, ideas, slots, expenses, tasks }
 *   PUT    /api/:coll/:id  (json)  → upsert one document (tasks: only { status } is written)
 *   DELETE /api/:coll/:id          → archive it (members and tasks can't be deleted)
 *
 * Document shapes are exactly what korea/index.html keeps in its `D` object,
 * so the page needs no knowledge of Notion. Ids: the page's own ids are
 * stored in a "Client ID" text property; rows the bot created have none and
 * are addressed by their Notion page id (32 hex chars).
 */

import { notion, plainTitle, plainText, checklist, itineraryDates, setTaskStatus } from "./notion.js";
import { evaluate } from "./checklist.js";

import { TRIP, DAYS } from "./config.js";
const SEATS = Object.fromEntries(TRIP.members.map(m => [m.seat, { name: m.name, flag: m.flag, c: m.c }]));
const EXTRA_C = ["--p6", "--p7", "--p8", "--p9"];
const DEFAULT_CUR = TRIP.settleCurrency;

/* page option keys ↔ Notion option names */
const ACT  = { food: "Food", sight: "Sights", shop: "Shopping", cafe: "Cafes", night: "Nightlife", nature: "Autumn leaves", kpop: "K-pop", spa: "Jjimjilbang", photo: "Photo spots" };
const AREA = { hongdae: "Hongdae", yeonnam: "Yeonnam / Hapjeong", myeongdong: "Myeongdong", insadong: "Insadong", ikseon: "Ikseon", bukchon: "Bukchon / Samcheong", dongdaemun: "Dongdaemun", itaewon: "Itaewon / Hannam", yongsan: "Yongsan / Seoul Station", seongsu: "Seongsu", gangnam: "Gangnam", apgujeong: "Apgujeong / Cheongdam", jamsil: "Jamsil" };
const STAY = { hotel: "Hotel", guesthouse: "Guesthouse", airbnb: "Apartment", hostel: "Hostel" };
const PACE = { chill: "Chill", balanced: "Balanced", packed: "Packed" };
const BUDGET = { b0: "≤ ฿1000", b1: "฿1000–2000", b2: "฿2000–3000", b3: "฿3000–4500", b4: "฿4500+" };   // Notion select names can't contain commas
const HABIT = { solo: "Need alone time", together: "Move as a group", early: "Early riser", late: "Night owl", walk: "Happy to walk", taxi: "Taxi over subway", plan: "Fixed plan", flow: "Go with the flow", photo: "Stops for photos", queue: "Queues for food" };
const FOOD = { halal: "Halal", pork: "No pork", beef: "No beef", veg: "Vegetarian", seafood: "Seafood allergy", spicy: "Not spicy" };
const CAT  = { food: "Food", cafe: "Cafe", sight: "Sight", shop: "Shop", night: "Night", other: "Other" };
const inv = m => Object.fromEntries(Object.entries(m).map(([k, v]) => [v, k]));
const ACT_R = inv(ACT), AREA_R = inv(AREA), STAY_R = inv(STAY), PACE_R = inv(PACE), FOOD_R = inv(FOOD), CAT_R = inv(CAT), HABIT_R = inv(HABIT), BUDGET_R = inv(BUDGET);

const ALLOWED_ORIGINS = [...TRIP.pageOrigins, /^http:\/\/localhost(:\d+)?$/, /^http:\/\/127\.0\.0\.1(:\d+)?$/];

/* ── entry ──────────────────────────────────────────────────── */
export async function handleApi(req, env) {
  const origin = req.headers.get("Origin") || "";
  const cors = corsHeaders(origin);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (origin && !ALLOWED_ORIGINS.some(re => re.test(origin))) return json({ error: "origin not allowed" }, 403, cors);

  const url = new URL(req.url);
  const parts = url.pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean);

  try {
    if (req.method === "GET" && parts[0] === "state") return json(await state(env), 200, cors);

    const [coll, rawId] = parts;
    const id = rawId ? decodeURIComponent(rawId) : null;
    if (!coll || !id || !["members", "prefs", "ideas", "slots", "expenses", "tasks"].includes(coll))
      return json({ error: "not found" }, 404, cors);

    if (req.method === "PUT") {
      const body = await req.json();
      invalidate();
      const out = await upsert(env, coll, id, body || {});
      return json(out, 200, cors);
    }
    if (req.method === "DELETE") {
      if (coll === "members" || coll === "prefs" || coll === "tasks") return json({ error: `${coll} can't be deleted` }, 405, cors);
      invalidate();
      await remove(env, coll, id);
      return json({ ok: true }, 200, cors);
    }
    return json({ error: "method" }, 405, cors);
  } catch (err) {
    console.error("api", req.method, url.pathname, String(err));
    return json({ error: String(err.message || err) }, 500, cors);
  }
}

function corsHeaders(origin) {
  const ok = ALLOWED_ORIGINS.some(re => re.test(origin)) ? origin : new URL(TRIP.pageUrl).origin;
  return {
    "Access-Control-Allow-Origin": ok,
    "Access-Control-Allow-Methods": "GET, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}
const json = (o, status = 200, extra = {}) =>
  new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...extra } });

/* ── read ───────────────────────────────────────────────────── */
let cache = { at: 0, data: null };
const CACHE_MS = 3000;

/* Live exchange rates, KRW per 1 unit of each currency, refreshed twice a day.
   Source: open.er-api.com (free, no key). Falls back to the seeds if it is down. */
const RATE_SEED = { KRW: 1, THB: 42, TWD: 45, JPY: 9.5, HKD: 185, IDR: 0.088, USD: 1440 };
let rateCache = { at: 0, data: RATE_SEED, live: false };
async function rates() {
  if (Date.now() - rateCache.at < 12 * 3600 * 1000) return rateCache;
  try {
    const r = await fetch("https://open.er-api.com/v6/latest/KRW", { cf: { cacheTtl: 3600 } });
    const j = await r.json();
    if (j.result !== "success" || !j.rates?.THB) throw new Error("bad payload");
    const out = { KRW: 1 };
    for (const c of Object.keys(RATE_SEED)) if (j.rates[c]) out[c] = 1 / j.rates[c];   // 1 THB = out.THB KRW
    rateCache = { at: Date.now(), data: out, live: true, asOf: j.time_last_update_utc };
  } catch (err) {
    console.error("rates", String(err));
    rateCache = { ...rateCache, at: Date.now() - 11 * 3600 * 1000 };   // retry in an hour
  }
  return rateCache;
}
const invalidate = () => { cache = { at: 0, data: null }; };

async function state(env) {
  if (cache.data && Date.now() - cache.at < CACHE_MS) return cache.data;
  const [crew, ideas, stays, slots, expenses, tasks] = await Promise.all([
    rows(env, env.NOTION_MEMBERS_DB), rows(env, env.NOTION_IDEAS_DB), rows(env, env.NOTION_STAYS_DB),
    rows(env, env.NOTION_ITINERARY_DB), rows(env, env.NOTION_EXPENSES_DB), checklist(env),
  ]);
  const crewIx = crewIndex(crew);                      // notionPageId → docId
  const seat = pid => crewIx[pid] || null;

  const fx = await rates();
  const out = { members: {}, prefs: {}, ideas: {}, slots: {}, expenses: {}, tasks: {}, rates: fx.data, ratesLive: fx.live, ratesAsOf: fx.asOf || null, ts: Date.now() };

  let extra = 0;
  for (const p of crew) {
    const P = p.properties, id = crewIx[p.id];
    const seatDef = SEATS[id];
    out.members[id] = {
      name: plainTitle(P["Name"]),
      flight: plainText(P["Flights"]),
      arrive: (P["Arrival"]?.date?.start || "").slice(0, 16),   // wall-clock Seoul time, no zone
      flag: seatDef?.flag || flagOf(P["From"]?.select?.name) || "🌏",
      c: seatDef?.c || EXTRA_C[extra++ % EXTRA_C.length],
      cur: P["Currency"]?.select?.name || DEFAULT_CUR,
    };
    const pref = {
      acts:  (P["Want to do"]?.multi_select || []).map(o => ACT_R[o.name]).filter(Boolean),
      areas: (P["Area"]?.multi_select || []).map(o => AREA_R[o.name]).filter(Boolean),
      food:  (P["Diet"]?.multi_select || []).map(o => FOOD_R[o.name]).filter(Boolean),
      stays: (P["Stay type"]?.multi_select || []).map(o => STAY_R[o.name]).filter(Boolean),
      habits: (P["Habits"]?.multi_select || []).map(o => HABIT_R[o.name]).filter(Boolean),
      pace:  PACE_R[P["Pace"]?.select?.name] || "",
      budget: BUDGET_R[P["Stay budget / night"]?.select?.name] || "",
      cur:   P["Currency"]?.select?.name || DEFAULT_CUR,
      note:  plainText(P["Must-do"]),
      ts:    Date.parse(p.last_edited_time) || 0,
    };
    if (pref.acts.length || pref.areas.length || pref.food.length || pref.stays.length || pref.habits.length || pref.pace || pref.budget || pref.note) out.prefs[id] = pref;
  }

  const ideaDoc = (p, cat) => {
    const P = p.properties;
    const votes = {};
    for (const r of P["Who's in"]?.relation || []) { const s = seat(r.id); if (s) votes[s] = 1; }
    return {
      title: plainTitle(P["Place"]),
      cat,
      link: P["Link"]?.url || "",
      note: plainText(P["Note"]),
      by: seat(P["Added by"]?.relation?.[0]?.id) || "",
      votes,
      ts: Date.parse(p.created_time) || 0,
    };
  };
  for (const p of ideas) out.ideas[docId(p)] = ideaDoc(p, CAT_R[p.properties["Kind"]?.select?.name] || "other");
  for (const p of stays) out.ideas[docId(p)] = ideaDoc(p, "stay");

  for (const p of slots) {
    const P = p.properties;
    const where = plainText(P["Where"]), note = plainText(P["Note"]);
    out.slots[docId(p)] = {
      day: Math.max(0, DAYS.indexOf((P["Date"]?.date?.start || "").slice(0, 10))),
      time: plainText(P["Time"]),
      title: plainTitle(P["What"]),
      note: [where ? `📍 ${where}` : "", note].filter(Boolean).join(" · "),
      by: seat(P["Owner"]?.relation?.[0]?.id) || "",
      ts: Date.parse(p.created_time) || 0,
    };
  }

  for (const p of expenses) {
    const P = p.properties;
    const payer = seat(P["Paid by"]?.relation?.[0]?.id) || "";
    out.expenses[docId(p)] = {
      desc: plainTitle(P["Item"]),
      amt: P["Amount"]?.number || 0,
      cur: P["Currency"]?.select?.name || TRIP.localCurrency,
      payer,
      with: (P["Split with"]?.relation || []).map(r => seat(r.id)).filter(Boolean),
      day: Math.max(0, DAYS.indexOf((P["Date"]?.date?.start || "").slice(0, 10))),
      by: payer,
      ts: Date.parse(p.created_time) || 0,
    };
  }

  // Checklist: the same auto rules as the bot (a flight number in Crew = flights booked, …).
  const crewLite = crew.map(p => ({ id: p.id, name: plainTitle(p.properties["Name"]), flights: plainText(p.properties["Flights"]) }));
  const dates = new Set(slots.map(p => (p.properties["Date"]?.date?.start || "").slice(0, 10)).filter(Boolean));
  for (const r of evaluate({ rows: tasks, crew: crewLite, itineraryDates: dates })) {
    out.tasks[r.id.replace(/-/g, "")] = {
      title: r.title, cat: r.cat, who: r.who ? seat(r.who.id) : null, due: r.due,
      status: r.status, done: r.done, auto: r.autoDone, mute: r.mute, note: r.note, ts: r.ts,
    };
  }

  cache = { at: Date.now(), data: out };
  return out;
}

async function rows(env, dbId) {
  const r = await notion(env, `/databases/${dbId}/query`, "POST", { page_size: 100 });
  return r.results;
}

/** docId for a non-crew row: Client ID if set, else the page id without dashes. */
const docId = p => plainText(p.properties["Client ID"]) || p.id.replace(/-/g, "");
const isPageId = id => /^[0-9a-f]{32}$/i.test(id);
const dashed = id => id.replace(/-/g, "").replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5");

/** Crew rows → { notionPageId: docId }. Seat ids come from Client ID, or from the name for the five founders. */
function crewIndex(crew) {
  const byName = Object.fromEntries(Object.entries(SEATS).map(([k, v]) => [v.name.toLowerCase(), k]));
  const ix = {};
  for (const p of crew) {
    const cid = plainText(p.properties["Client ID"]);
    ix[p.id] = cid || byName[plainTitle(p.properties["Name"]).toLowerCase()] || p.id.replace(/-/g, "");
  }
  return ix;
}
function flagOf(from) { const m = (from || "").match(/^\p{RI}\p{RI}/u); return m ? m[0] : null; }

/* ── write ──────────────────────────────────────────────────── */
const title = t => [{ text: { content: String(t ?? "").slice(0, 1900) } }];
const rich = t => (t ? [{ text: { content: String(t).slice(0, 1900) } }] : []);
const sel = name => (name ? { select: { name } } : { select: null });
const multi = names => ({ multi_select: names.map(name => ({ name })) });
const rel = ids => ({ relation: ids.filter(Boolean).map(id => ({ id })) });

async function upsert(env, coll, id, body) {
  if (coll === "members") return putMember(env, id, body);
  if (coll === "prefs")   return putPrefs(env, id, body);
  if (coll === "ideas")   return putIdea(env, id, body);
  if (coll === "slots")   return putSlot(env, id, body);
  if (coll === "expenses") return putExpense(env, id, body);
  if (coll === "tasks")   return putTask(env, id, body);
}

/** The page may only flip a task's status; everything else about a task is edited in Notion or by the bot. */
async function putTask(env, id, tk) {
  if (!isPageId(id)) throw new Error("unknown task " + id);
  const status = ["todo", "doing", "done"].includes(tk.status) ? tk.status : "todo";
  await setTaskStatus(env, dashed(id), status);
  return { id };
}

/** Find the Crew page for a seat/doc id, creating it when the page adds a new person. */
async function crewPage(env, id, createWithName) {
  const crew = await rows(env, env.NOTION_MEMBERS_DB);
  const ix = crewIndex(crew);
  const hit = crew.find(p => ix[p.id] === id);
  if (hit) {
    if (!plainText(hit.properties["Client ID"])) // founders: stamp the seat id once
      await notion(env, `/pages/${hit.id}`, "PATCH", { properties: { "Client ID": { rich_text: rich(id) } } });
    return hit.id;
  }
  if (!createWithName) return null;
  const made = await notion(env, "/pages", "POST", {
    parent: { database_id: env.NOTION_MEMBERS_DB },
    properties: { "Name": { title: title(createWithName) }, "Client ID": { rich_text: rich(id) }, "Currency": sel(DEFAULT_CUR) },
  });
  return made.id;
}

async function crewPages(env, ids) {
  const crew = await rows(env, env.NOTION_MEMBERS_DB);
  const ix = crewIndex(crew);
  const back = Object.fromEntries(Object.entries(ix).map(([pid, did]) => [did, pid]));
  return (ids || []).map(d => back[d]).filter(Boolean);
}

async function putMember(env, id, m) {
  const pid = await crewPage(env, id, m.name || SEATS[id]?.name || "Someone");
  const props = {
    "Name": { title: title(m.name || SEATS[id]?.name || "") },
    "Flights": { rich_text: rich(m.flight) },
    "Arrival": m.arrive ? { date: { start: String(m.arrive).slice(0, 16), time_zone: "Asia/Seoul" } } : { date: null },
  };
  if (m.cur) props["Currency"] = sel(m.cur);
  await notion(env, `/pages/${pid}`, "PATCH", { properties: props });
  return { id };
}

async function putPrefs(env, id, p) {
  const pid = await crewPage(env, id, SEATS[id]?.name);
  if (!pid) throw new Error("unknown member " + id);
  const props = {
    "Want to do": multi((p.acts || []).map(k => ACT[k]).filter(Boolean)),
    "Area":       multi((p.areas || []).map(k => AREA[k]).filter(Boolean)),
    "Diet":       multi((p.food || []).map(k => FOOD[k]).filter(Boolean)),
    "Stay type":  multi((p.stays || (p.stay ? [p.stay] : [])).map(k => STAY[k]).filter(Boolean)),
    "Habits":     multi((p.habits || []).map(k => HABIT[k]).filter(Boolean)),
    "Pace":       sel(PACE[p.pace]),
    "Stay budget / night": sel(BUDGET[p.budget]),
    "Must-do":    { rich_text: rich(p.note) },
  };
  if (p.cur) props["Currency"] = sel(p.cur);
  await notion(env, `/pages/${pid}`, "PATCH", { properties: props });
  return { id };
}

/** Locate a row by doc id in one or more databases. */
async function findRow(env, dbIds, id) {
  if (isPageId(id)) {
    try { const p = await notion(env, `/pages/${dashed(id)}`); return p.archived ? null : p; } catch { return null; }
  }
  for (const db of dbIds) {
    const r = await notion(env, `/databases/${db}/query`, "POST", {
      filter: { property: "Client ID", rich_text: { equals: id } }, page_size: 1,
    });
    if (r.results[0]) return r.results[0];
  }
  return null;
}

async function putIdea(env, id, it) {
  const wantStays = it.cat === "stay";
  const targetDb = wantStays ? env.NOTION_STAYS_DB : env.NOTION_IDEAS_DB;
  const [byPid, votePids] = await Promise.all([
    it.by ? crewPages(env, [it.by]) : [],
    crewPages(env, Object.keys(it.votes || {})),
  ]);
  const props = {
    "Place": { title: title(it.title) },
    "Link": { url: it.link || null },
    "Note": { rich_text: rich(it.note) },
    "Added by": rel(byPid),
    "Who's in": rel(votePids),
    "Client ID": { rich_text: rich(isPageId(id) ? "" : id) },
  };
  if (!wantStays) props["Kind"] = sel(CAT[it.cat] || "Other");

  const existing = await findRow(env, [env.NOTION_IDEAS_DB, env.NOTION_STAYS_DB], id);
  if (existing) {
    const inStays = existing.parent?.database_id?.replace(/-/g, "") === env.NOTION_STAYS_DB.replace(/-/g, "");
    if (inStays === wantStays) {
      await notion(env, `/pages/${existing.id}`, "PATCH", { properties: props });
      return { id };
    }
    // Board changed: Notion can't move pages, so re-create and archive.
    props["Status"] = sel("Idea");
    const made = await notion(env, "/pages", "POST", { parent: { database_id: targetDb }, properties: props });
    await notion(env, `/pages/${existing.id}`, "PATCH", { archived: true });
    return { id: isPageId(id) ? made.id.replace(/-/g, "") : id };
  }
  props["Status"] = sel("Idea");
  const made = await notion(env, "/pages", "POST", { parent: { database_id: targetDb }, properties: props });
  return { id: isPageId(id) ? made.id.replace(/-/g, "") : id };
}

async function putSlot(env, id, s) {
  const byPid = s.by ? await crewPages(env, [s.by]) : [];
  const props = {
    "What": { title: title(s.title) },
    "Date": { date: { start: DAYS[Number(s.day)] || DAYS[0] } },
    "Time": { rich_text: rich(s.time) },
    "Note": { rich_text: rich(String(s.note || "").replace(/^📍 [^·]+ · ?/, "")) },
    "Owner": rel(byPid),
    "Client ID": { rich_text: rich(isPageId(id) ? "" : id) },
  };
  const existing = await findRow(env, [env.NOTION_ITINERARY_DB], id);
  if (existing) { await notion(env, `/pages/${existing.id}`, "PATCH", { properties: props }); return { id }; }
  props["Kind"] = sel("Do");
  const made = await notion(env, "/pages", "POST", { parent: { database_id: env.NOTION_ITINERARY_DB }, properties: props });
  return { id: isPageId(id) ? made.id.replace(/-/g, "") : id };
}

async function putExpense(env, id, e) {
  const [payerPid, withPids] = await Promise.all([crewPages(env, [e.payer || e.by]), crewPages(env, e.with || [])]);
  const props = {
    "Item": { title: title(e.desc) },
    "Amount": { number: Number(e.amt) || 0 },
    "Currency": sel(e.cur || TRIP.localCurrency),
    "Date": { date: { start: DAYS[Number(e.day)] || DAYS[0] } },
    "Paid by": rel(payerPid),
    "Split with": rel(withPids),
    "Client ID": { rich_text: rich(isPageId(id) ? "" : id) },
  };
  const existing = await findRow(env, [env.NOTION_EXPENSES_DB], id);
  if (existing) { await notion(env, `/pages/${existing.id}`, "PATCH", { properties: props }); return { id }; }
  props["Category"] = sel("Other");
  const made = await notion(env, "/pages", "POST", { parent: { database_id: env.NOTION_EXPENSES_DB }, properties: props });
  return { id: isPageId(id) ? made.id.replace(/-/g, "") : id };
}

async function remove(env, coll, id) {
  const dbs = coll === "ideas" ? [env.NOTION_IDEAS_DB, env.NOTION_STAYS_DB]
            : coll === "slots" ? [env.NOTION_ITINERARY_DB] : [env.NOTION_EXPENSES_DB];
  const existing = await findRow(env, dbs, id);
  if (existing) await notion(env, `/pages/${existing.id}`, "PATCH", { archived: true });
}
