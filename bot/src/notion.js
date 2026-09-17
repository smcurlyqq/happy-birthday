/**
 * Notion access for the Seoul Loop boards. The five trip boards use the
 * English property names set on 2026-09-11; the Checklist and Bot config
 * boards (added 2026-09-17) keep their bilingual names. Change them here if
 * the schema moves.
 */

const NOTION = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";

export async function notion(env, path, method = "GET", body) {
  const r = await fetch(NOTION + path, {
    method,
    headers: {
      Authorization: `Bearer ${env.NOTION_TOKEN}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`notion ${method} ${path} → ${r.status} ${await r.text()}`);
  return r.json();
}

const title = t => [{ text: { content: String(t).slice(0, 1900) } }];
const rich = t => (t ? [{ text: { content: String(t).slice(0, 1900) } }] : []);
export const plainTitle = p => (p?.title || []).map(t => t.plain_text).join("") || "";
export const plainText = p => (p?.rich_text || []).map(t => t.plain_text).join("") || "";

/* ── crew ───────────────────────────────────────────────────── */

/** All members: [{ id, name, lineId, flights }]. Five rows; one query. */
export async function members(env) {
  const r = await notion(env, `/databases/${env.NOTION_MEMBERS_DB}/query`, "POST", { page_size: 20 });
  return r.results.map(p => ({
    id: p.id,
    name: plainTitle(p.properties["Name"]),
    lineId: plainText(p.properties["LINE ID"]),
    flights: plainText(p.properties["Flights"]),
  }));
}

export async function memberByLineId(env, lineId) {
  if (!lineId) return null;
  return (await members(env)).find(m => m.lineId === lineId) || null;
}

/** Exact full name, or the first word of a two-word name ("Hye" → Hye Yeon). Never a loose substring. */
export async function memberByName(env, name) {
  const want = String(name || "").trim().toLowerCase();
  if (want.length < 2) return null;
  const all = await members(env);
  return all.find(m => m.name.toLowerCase() === want)
      || all.find(m => m.name.toLowerCase().split(" ")[0] === want)
      || null;
}

/**
 * Link a LINE account to a Crew row. One account owns at most one seat, and a seat
 * already owned by a different account is refused — the owner must unlink first.
 * @returns "ok" | "taken"
 */
export async function bindLineId(env, memberId, lineId) {
  const all = await members(env);
  const target = all.find(m => m.id === memberId);
  if (target?.lineId && target.lineId !== lineId) return "taken";
  for (const m of all) {
    if (m.id !== memberId && m.lineId === lineId)                 // moving seats: drop the old one
      await notion(env, `/pages/${m.id}`, "PATCH", { properties: { "LINE ID": { rich_text: [] } } });
  }
  if (target?.lineId !== lineId)
    await notion(env, `/pages/${memberId}`, "PATCH", { properties: { "LINE ID": { rich_text: rich(lineId) } } });
  return "ok";
}

/** Remove whatever seat this LINE account holds. @returns the member name, or null */
export async function unbindLineId(env, lineId) {
  const m = (await members(env)).find(x => x.lineId === lineId);
  if (!m) return null;
  await notion(env, `/pages/${m.id}`, "PATCH", { properties: { "LINE ID": { rich_text: [] } } });
  return m.name;
}

/* ── candidates for voting ──────────────────────────────────── */

/** Titles + ids of every Idea and Stay, for the classifier. */
export async function candidates(env) {
  const [ideas, stays] = await Promise.all([
    notion(env, `/databases/${env.NOTION_IDEAS_DB}/query`, "POST", { page_size: 100 }),
    notion(env, `/databases/${env.NOTION_STAYS_DB}/query`, "POST", { page_size: 100 }),
  ]);
  return [
    ...ideas.results.map(p => ({ id: p.id, board: "ideas", title: plainTitle(p.properties["Place"]) })),
    ...stays.results.map(p => ({ id: p.id, board: "stays", title: plainTitle(p.properties["Place"]) })),
  ];
}

/* ── create rows ────────────────────────────────────────────── */

export async function createIdea(env, { title: name, url, note, area, byId, kind }) {
  const props = {
    "Place": { title: title(name) },
    "Kind": { select: { name: kind } },
    "Status": { select: { name: "Idea" } },
  };
  if (url) props["Link"] = { url };
  if (note) props["Note"] = { rich_text: rich(note) };
  if (area) props["Area"] = { select: { name: area } };
  if (byId) props["Added by"] = { relation: [{ id: byId }] };
  return notion(env, "/pages", "POST", { parent: { database_id: env.NOTION_IDEAS_DB }, properties: props });
}

export async function createStay(env, { title: name, url, note, area, byId }) {
  const props = {
    "Place": { title: title(name) },
    "Status": { select: { name: "Idea" } },
  };
  if (url) props["Link"] = { url };
  if (note) props["Note"] = { rich_text: rich(note) };
  if (area) props["Area"] = { select: { name: area } };
  if (byId) props["Added by"] = { relation: [{ id: byId }] };
  return notion(env, "/pages", "POST", { parent: { database_id: env.NOTION_STAYS_DB }, properties: props });
}

export async function createItinerary(env, { what, date, time, where, kind, ownerId, note }) {
  const props = {
    "What": { title: title(what) },
    "Date": { date: { start: date } },
    "Kind": { select: { name: kind } },
  };
  if (time) props["Time"] = { rich_text: rich(time) };
  if (where) props["Where"] = { rich_text: rich(where) };
  if (note) props["Note"] = { rich_text: rich(note) };
  if (ownerId) props["Owner"] = { relation: [{ id: ownerId }] };
  return notion(env, "/pages", "POST", { parent: { database_id: env.NOTION_ITINERARY_DB }, properties: props });
}

export async function createExpense(env, { item, amount, currency, category, date, paidById, splitIds }) {
  const props = {
    "Item": { title: title(item) },
    "Amount": { number: amount },
    "Currency": { select: { name: currency } },
    "Category": { select: { name: category } },
    "Date": { date: { start: date } },
    "Paid by": { relation: [{ id: paidById }] },
    "Split with": { relation: splitIds.map(id => ({ id })) },
  };
  return notion(env, "/pages", "POST", { parent: { database_id: env.NOTION_EXPENSES_DB }, properties: props });
}

/* ── read / update rows ─────────────────────────────────────── */

export async function findByUrl(env, dbId, url) {
  try {
    const r = await notion(env, `/databases/${dbId}/query`, "POST", {
      filter: { property: "Link", url: { equals: url } }, page_size: 1,
    });
    return r.results[0] || null;
  } catch { return null; }
}

export const getPage = (env, pageId) => notion(env, `/pages/${pageId}`);

export const setKind = (env, pageId, kind) =>
  notion(env, `/pages/${pageId}`, "PATCH", { properties: { "Kind": { select: { name: kind } } } });

export const archive = (env, pageId) =>
  notion(env, `/pages/${pageId}`, "PATCH", { archived: true });

/**
 * Add a member to "Who's in" on an Idea or Stay. Idempotent.
 * @returns { count, added, title }
 */
export async function addVote(env, pageId, memberId) {
  const page = await getPage(env, pageId);
  const have = (page.properties["Who's in"]?.relation || []).map(r => r.id);
  const added = !have.includes(memberId);
  const next = added ? [...have, memberId] : have;
  if (added) {
    await notion(env, `/pages/${pageId}`, "PATCH", {
      properties: { "Who's in": { relation: next.map(id => ({ id })) } },
    });
  }
  return { count: next.length, added, title: plainTitle(page.properties["Place"]), url: page.url };
}


/* ── checklist (board 6) ────────────────────────────────────── */

/** Property names on the Checklist board, exactly as Amber created them. */
export const CL = { task: "任務 Task", cat: "類別 Category", who: "誰 Who", due: "截止 Due", status: "狀態 Status", mute: "靜音 Mute", note: "備註 Note" };
export const STATUS = { todo: "待辦 To do", doing: "進行中 Doing", done: "完成 Done" };
export const CATS = { flights: "機票 Flights", visa: "簽證 Visa", stay: "住宿 Stay", data: "網路 Data", insurance: "保險 Insurance", plan: "行程 Plan", money: "錢 Money", other: "其他 Other" };
const CAT_KEY = Object.fromEntries(Object.entries(CATS).map(([k, v]) => [v, k]));
const STATUS_KEY = Object.fromEntries(Object.entries(STATUS).map(([k, v]) => [v, k]));

/**
 * Every Checklist row, flattened:
 * { id, title, cat: "flights"|…|"other", whoIds: [crewPageId…], due: "YYYY-MM-DD"|"", status: "todo"|"doing"|"done", mute, note }
 */
export async function checklist(env) {
  const r = await notion(env, `/databases/${env.NOTION_CHECKLIST_DB}/query`, "POST", { page_size: 100 });
  return r.results.map(p => {
    const P = p.properties;
    return {
      id: p.id,
      title: plainTitle(P[CL.task]),
      cat: CAT_KEY[P[CL.cat]?.select?.name] || "other",
      whoIds: (P[CL.who]?.relation || []).map(x => x.id),
      due: (P[CL.due]?.date?.start || "").slice(0, 10),
      status: STATUS_KEY[P[CL.status]?.select?.name] || "todo",
      mute: !!P[CL.mute]?.checkbox,
      note: plainText(P[CL.note]),
      ts: Date.parse(p.last_edited_time) || 0,
    };
  });
}

export const setTaskStatus = (env, pageId, statusKey) =>
  notion(env, `/pages/${pageId}`, "PATCH", { properties: { [CL.status]: { select: { name: STATUS[statusKey] || STATUS.todo } } } });

/** One new row. whoId null = a task for the whole group. */
export async function createTask(env, { title: name, cat, due, whoId, note }) {
  const props = {
    [CL.task]: { title: title(name) },
    [CL.cat]: { select: { name: CATS[cat] || CATS.other } },
    [CL.status]: { select: { name: STATUS.todo } },
  };
  if (due) props[CL.due] = { date: { start: due } };
  if (whoId) props[CL.who] = { relation: [{ id: whoId }] };
  if (note) props[CL.note] = { rich_text: rich(note) };
  return notion(env, "/pages", "POST", { parent: { database_id: env.NOTION_CHECKLIST_DB }, properties: props });
}

/** The set of trip dates that have at least one Itinerary row. */
export async function itineraryDates(env) {
  const r = await notion(env, `/databases/${env.NOTION_ITINERARY_DB}/query`, "POST", { page_size: 100 });
  return new Set(r.results.map(p => (p.properties["Date"]?.date?.start || "").slice(0, 10)).filter(Boolean));
}

/* ── bot config (board 7) ───────────────────────────────────── */

const CFG = { key: "項目 Key", value: "值 Value" };
let cfgCache = { at: 0, rows: null };
const CFG_TTL = 60_000;

async function configRows(env) {
  if (cfgCache.rows && Date.now() - cfgCache.at < CFG_TTL) return cfgCache.rows;
  const r = await notion(env, `/databases/${env.NOTION_CONFIG_DB}/query`, "POST", { page_size: 50 });
  const rows = r.results.map(p => ({ id: p.id, key: plainTitle(p.properties[CFG.key]).trim(), value: plainText(p.properties[CFG.value]).trim() }));
  cfgCache = { at: Date.now(), rows };
  return rows;
}

/** A config value by key ("" when the row is missing or empty). Cached for a minute. */
export async function config(env, key) {
  return (await configRows(env)).find(r => r.key === key)?.value || "";
}

/** Write a config value, creating the row if it does not exist yet. */
export async function setConfig(env, key, value) {
  const hit = (await configRows(env)).find(r => r.key === key);
  const props = { [CFG.value]: { rich_text: rich(value) } };
  if (hit) await notion(env, `/pages/${hit.id}`, "PATCH", { properties: props });
  else await notion(env, "/pages", "POST", { parent: { database_id: env.NOTION_CONFIG_DB }, properties: { [CFG.key]: { title: title(key) }, ...props } });
  cfgCache = { at: 0, rows: null };
}
