/**
 * Seoul Loop — LINE collector bot (v2)
 *
 * Links are filed deterministically (see links.js). Everything else goes
 * through Claude (classify.js), which decides whether the message is an
 * expense, an idea, an itinerary item, a vote, a bind, a help request —
 * or chatter, in which case the bot says nothing.
 *
 * The bot serves one LINE group: the first group it is invited into writes
 * its id to the Notion "Bot config" board (line_group_id). It leaves any
 * other group it is added to and never calls Claude for them. Until a group
 * is registered it answers in any group (setup mode).
 *
 * A daily cron (wrangler.toml) sends the pre-trip checklist reminder — see checklist.js.
 *
 * /api/* is the web page's data layer (see api.js) — same Notion boards.
 */

import { classify, classifyImage, describeLink, CONFIDENCE_FLOOR, seoulToday } from "./classify.js";
import * as db from "./notion.js";
import { reply, leave, text, mentionText, escapeBraces, card, imageContent, HELP_MESSAGES, BIND_FIRST, KINDS, kindKey, PAGE_URL, MEMBER_LIST } from "./line.js";
import { extractUrls, resolve, classifyLink, guessArea } from "./links.js";
import { handleApi } from "./api.js";
import { remind, progressBoard, loadBoard, boardNames, fmtDay as fmtDue, Mentions } from "./checklist.js";

/* ── worker entry ───────────────────────────────────────────── */
export default {
  /** Cron trigger from wrangler.toml — the daily checklist reminder. */
  async scheduled(event, env, ctx) {
    ctx.waitUntil(remind(env).catch(err => console.error("remind failed", String(err))));
  },

  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/api")) return handleApi(req, env);
    if (req.method === "GET") return new Response("Seoul Loop bot is awake 🇰🇷", { status: 200 });
    if (req.method !== "POST" || url.pathname !== "/webhook") return new Response("not found", { status: 404 });

    const raw = await req.text();
    if (!(await validSignature(raw, req.headers.get("x-line-signature"), env.LINE_CHANNEL_SECRET)))
      return new Response("bad signature", { status: 401 });

    let body;
    try { body = JSON.parse(raw); } catch { return new Response("bad json", { status: 400 }); }

    // LINE wants a 200 straight away; the work continues in the background.
    ctx.waitUntil(Promise.all((body.events || []).map(ev => handle(ev, env).catch(err => console.error("event failed", err)))));
    return new Response("ok");
  },
};

/* ── routing ────────────────────────────────────────────────── */
async function handle(ev, env) {
  const src = ev.source || {};
  const gid = src.groupId || src.roomId;
  if (!gid) return;                                   // 1:1 chats: ignore entirely

  const registered = await db.config(env, "line_group_id");
  if (registered && registered !== gid) {
    console.log("uninvited group, leaving", gid);
    if (ev.type === "join") await leave(env, src);
    return;
  }

  if (ev.type === "join") {
    if (!registered) { await db.setConfig(env, "line_group_id", gid); console.log("registered group", gid); }
    else console.log("re-joined registered group", gid);
    return reply(env, ev.replyToken, HELP_MESSAGES);
  }
  if (ev.type === "postback") return onPostback(ev, env);
  if (ev.type === "message" && ev.message?.type === "text") return onText(ev, env);
  if (ev.type === "message" && ev.message?.type === "image") return onImage(ev, env);
}

/* ── text messages ──────────────────────────────────────────── */
async function onText(ev, env) {
  const msg = (ev.message.text || "").trim();
  if (!msg) return;

  // Diagnostics: which group is this, and is it the one the bot serves?
  const gid = ev.source?.groupId || ev.source?.roomId;
  if (/^(group ?id|群組 ?id)$/i.test(msg)) {
    const registered = await db.config(env, "line_group_id");
    const state = registered === gid ? "this is the registered group" : "not registered yet — type “use this group” to register it";
    return reply(env, ev.replyToken, [text(`Group ID: ${gid}\n${state}`)]);
  }
  if (/^use this group$/i.test(msg)) {
    const registered = await db.config(env, "line_group_id");
    if (registered === gid) return reply(env, ev.replyToken, [text("Already registered here.")]);
    if (registered) return reply(env, ev.replyToken, [text("Another group is registered. Clear line_group_id in the Bot config board first.")]);
    await db.setConfig(env, "line_group_id", gid);
    return reply(env, ev.replyToken, [text("✓ Registered — reminders will come to this group.")]);
  }

  // Fast paths that need no AI.
  if (/^(help|說明|使用說明|ヘルプ|도움말|bantuan)$/i.test(msg))
    return reply(env, ev.replyToken, HELP_MESSAGES);

  if (/^(progress|status|進度|進捗|진행|진행 상황|kemajuan|checklist)$/i.test(msg))
    return reply(env, ev.replyToken, [await progressBoard(env)]);

  if (/^(unlink me|unbind|解除綁定|解綁|連携解除|연결 해제|lepas tautan)$/i.test(msg)) return onUnbind(ev, env);

  // "I am Gigi" binds — but only when the name is one of ours, so "I am so hungry" stays chatter.
  const bind = msg.match(/^(?:i\s*am|i'm|我是|我叫|私は|저는|saya)\s*(.{1,24})$/i);
  if (bind) {
    const m = await db.memberByName(env, bind[1].trim());
    if (m) return onBind(m, ev, env);
  }

  const links = extractUrls(msg);
  if (links.length) {
    const link = links[0];
    const note = msg.replace(link, "").trim().slice(0, 300);
    return collectLink(link, note, ev, env);
  }

  // Everything else: ask Claude what this is.
  const [me, cands, board] = await Promise.all([
    db.memberByLineId(env, ev.source?.userId),
    db.candidates(env),
    loadBoard(env).catch(err => { console.error("checklist load failed", String(err)); return []; }),
  ]);
  const openTasks = board.filter(r => !r.done).map(r => ({ id: r.id, title: r.title, cat: r.cat, who: r.who?.name || null, due: r.due }));
  const out = await classify(env, { text: msg, senderName: me?.name, candidates: cands, tasks: openTasks });
  if (!out || out.intent === "ignore" || out.confidence < CONFIDENCE_FLOOR) {
    console.log("ignored", JSON.stringify({ msg: msg.slice(0, 80), intent: out?.intent, c: out?.confidence }));
    return;
  }
  console.log("intent", out.intent, out.confidence, msg.slice(0, 80));

  try {
    switch (out.intent) {
      case "help":      return reply(env, ev.replyToken, HELP_MESSAGES);
      case "bind": {
        const m = await db.memberByName(env, out.bind?.name || "");
        return m ? onBind(m, ev, env) : reply(env, ev.replyToken, [text(`No member called “${out.bind?.name}”. Use one of: ${MEMBER_LIST}`)]);
      }
      case "expense":   return onExpense(out.expense, me, ev, env);
      case "idea":      return onIdea(out.idea, me, ev, env);
      case "itinerary": return onItinerary(out.itinerary, me, ev, env);
      case "vote":      return onVote(out.vote?.target_id, me, ev, env);
      case "progress":  return onProgress(out.progress?.target_id, me, board, ev, env);
      case "task":      return onTask(out.task, me, ev, env);
    }
  } catch (err) {
    console.error("handler failed", out.intent, String(err));
    return reply(env, ev.replyToken, [text("Couldn't save that — try again in a minute.")]);
  }
}

async function onBind(m, ev, env) {
  const userId = ev.source?.userId;
  if (!userId) return reply(env, ev.replyToken, [text("I can't read your LINE ID here — a group setting may be blocking it.")]);
  const r = await db.bindLineId(env, m.id, userId);
  if (r === "taken")
    return reply(env, ev.replyToken, [text(`${m.name} is already linked to another LINE account. If that's really you, ask them to type “unlink me” first.`)]);
  return reply(env, ev.replyToken, [text(`✓ Linked — you're ${m.name}. Links, expenses and votes will be credited to you.`)]);
}

async function onUnbind(ev, env) {
  const userId = ev.source?.userId;
  if (!userId) return;
  const name = await db.unbindLineId(env, userId);
  return reply(env, ev.replyToken, [text(name ? `✓ Unlinked from ${name}.` : "You weren't linked to anyone.")]);
}

/* ── links (no AI) ──────────────────────────────────────────── */
async function collectLink(link, note, ev, env) {
  const page = await resolve(link);
  const [dupeIdeas, dupeStays, me, cands] = await Promise.all([
    db.findByUrl(env, env.NOTION_IDEAS_DB, page.url), db.findByUrl(env, env.NOTION_STAYS_DB, page.url),
    db.memberByLineId(env, ev.source?.userId), db.candidates(env),
  ]);
  if (dupeIdeas || dupeStays) return reply(env, ev.replyToken, [text(`Already on the list → ${PAGE_URL}`)]);

  // Let Claude read what the page says (name in Korean, category, address…); fall back to the host/word rules.
  const tidy = await describeLink(env, { page, note, candidates: cands });
  if (tidy?.duplicate_of) return reply(env, ev.replyToken, [text(`Already on the list → ${PAGE_URL}`)]);

  let kind, sure, title, area, rowNote;
  if (tidy) {
    kind = tidy.kind === "Stay" ? "stay" : kindKey(tidy.kind);
    sure = true; title = tidy.title || page.title; area = tidy.area; rowNote = tidy.note;
  } else {
    ({ kind, sure } = classifyLink(page, note));
    title = page.title; area = guessArea(`${page.title} ${page.desc} ${note}`); rowNote = note;
  }
  const conf = KINDS[kind];
  const row = { title, url: page.url, note: rowNote, area, byId: me?.id, kind: conf.select };
  const created = conf.board === "stays" ? await db.createStay(env, row) : await db.createIdea(env, row);

  return reply(env, ev.replyToken, [card({ title, host: page.host, kind, sure, pageId: created.id })]);
}

/* ── screenshots ────────────────────────────────────────────── */
async function onImage(ev, env) {
  const img = await imageContent(env, ev.message.id);
  if (!img) return;
  const [me, cands] = await Promise.all([db.memberByLineId(env, ev.source?.userId), db.candidates(env)]);
  const out = await classifyImage(env, { ...img, senderName: me?.name, candidates: cands });
  if (!out || out.intent === "ignore" || out.confidence < CONFIDENCE_FLOOR) {
    console.log("image ignored", JSON.stringify({ intent: out?.intent, c: out?.confidence }));
    return;
  }
  console.log("image intent", out.intent, out.confidence, out.idea?.title);
  try {
    if (out.intent === "vote") return onVote(out.vote?.target_id, me, ev, env);
    const x = out.idea; if (!x) return;
    if (x.kind === "Stay") {
      const created = await db.createStay(env, { title: x.title, note: x.note, area: x.area, byId: me?.id });
      return reply(env, ev.replyToken, [card({ title: x.title, host: "", kind: "stay", sure: true, pageId: created.id })]);
    }
    return onIdea(x, me, ev, env);
  } catch (err) {
    console.error("image handler failed", String(err));
    return reply(env, ev.replyToken, [text("Couldn't save that — try again in a minute.")]);
  }
}

/* ── AI-classified intents ──────────────────────────────────── */
async function onExpense(x, me, ev, env) {
  if (!x) return;
  if (!me) return reply(env, ev.replyToken, [text(BIND_FIRST)]);
  const all = await db.members(env);
  const named = x.split_with.map(n => all.find(m => m.name.toLowerCase() === n.toLowerCase())).filter(Boolean);
  const split = named.length ? named : all;
  await db.createExpense(env, {
    item: x.item, amount: x.amount, currency: x.currency, category: x.category,
    date: seoulToday(), paidById: me.id, splitIds: split.map(m => m.id),
  });
  const who = named.length ? `split with ${named.map(m => m.name).join(", ")}` : `split ${all.length} ways`;
  return reply(env, ev.replyToken, [text(`💸 ${fmtAmount(x.amount, x.currency)} · ${x.item} · paid by ${me.name} · ${who}`)]);
}

async function onIdea(x, me, ev, env) {
  if (!x) return;
  const kind = kindKey(x.kind);
  const created = await db.createIdea(env, { title: x.title, note: x.note, area: x.area, byId: me?.id, kind: x.kind });
  return reply(env, ev.replyToken, [card({ title: x.title, host: "", kind, sure: true, pageId: created.id })]);
}

async function onItinerary(x, me, ev, env) {
  if (!x) return;
  await db.createItinerary(env, { what: x.what, date: x.date, time: x.time, where: x.where, kind: x.kind, ownerId: me?.id });
  const bits = [`📅 ${fmtDay(x.date)}`, x.time, x.what, x.where ? `meet at ${x.where}` : null].filter(Boolean);
  return reply(env, ev.replyToken, [text(bits.join(" · "))]);
}

async function onVote(pageId, me, ev, env) {
  if (!pageId) return;
  if (!me) return reply(env, ev.replyToken, [text(BIND_FIRST)]);
  const v = await db.addVote(env, pageId, me.id);
  const n = `${v.count} vote${v.count === 1 ? "" : "s"}`;
  return reply(env, ev.replyToken, [text(v.added ? `✓ ${me.name} is in · ${v.title} · ${n}` : `You're already in for ${v.title} · ${n}`)]);
}

/* ── checklist: "booked my flight", "remind everyone to … by …" ── */
const sameId = (a, b) => String(a || "").replace(/-/g, "") === String(b || "").replace(/-/g, "");

async function onProgress(targetId, me, board, ev, env) {
  if (!targetId) return;
  if (!me) return reply(env, ev.replyToken, [text(BIND_FIRST)]);
  const row = board.find(r => sameId(r.id, targetId));
  if (!row || row.done) return;
  if (!row.group && row.who?.id !== me.id) { console.log("progress: row belongs to someone else, ignoring", row.title, me.name); return; }
  await db.setTaskStatus(env, row.id, "done");
  const siblings = board.filter(r => r.title === row.title && r.id !== row.id && !r.done && !r.group);
  const names = await boardNames(env, [row]);
  const title = names[row.id]?.title || row.title;
  const mentions = new Mentions();
  const tail = row.group ? "done" : `${escapeBraces(me.name)} done` + (siblings.length ? ` · still waiting on ${siblings.map(r => mentions.person(r.who)).join(", ")}` : "");
  return reply(env, ev.replyToken, [mentionText(`✓ ${escapeBraces(title)} · ${tail}`, mentions.map)]);
}

async function onTask(x, me, ev, env) {
  if (!x || !/^\d{4}-\d{2}-\d{2}$/.test(x.due)) return;
  const all = await db.members(env);
  const named = x.who.map(n => all.find(m => m.name.toLowerCase() === n.toLowerCase())).filter(Boolean);
  if (named.length) await Promise.all(named.map(m => db.createTask(env, { title: x.title, cat: x.category, due: x.due, whoId: m.id })));
  else await db.createTask(env, { title: x.title, cat: x.category, due: x.due, whoId: null });
  const who = named.length ? named.map(m => m.name).join(", ") : "everyone";
  return reply(env, ev.replyToken, [text(`📋 Added · ${x.title} · ${fmtDue(x.due)} · ${who}`)]);
}

/* ── postbacks: vote button, recategorise ───────────────────── */
async function onPostback(ev, env) {
  const q = new URLSearchParams(ev.postback?.data || "");
  const pageId = q.get("p");
  if (!pageId) return;

  if (q.get("a") === "in") {
    const me = await db.memberByLineId(env, ev.source?.userId);
    return onVote(pageId, me, ev, env);
  }

  if (q.get("a") !== "rc") return;
  const from = q.get("s"), to = q.get("k");
  if (!KINDS[to]) return;
  const conf = KINDS[to];

  const page = await db.getPage(env, pageId);
  const props = page.properties || {};
  const name = db.plainTitle(props["Place"]);
  const url = props["Link"]?.url || "";
  const note = db.plainText(props["Note"]);
  const area = props["Area"]?.select?.name || null;
  const byId = props["Added by"]?.relation?.[0]?.id || null;

  if ((from === "stays") === (conf.board === "stays")) {
    if (conf.board === "ideas") await db.setKind(env, pageId, conf.select);
    return reply(env, ev.replyToken, [text(`${conf.emoji} Changed to ${conf.label}`)]);
  }

  // Different board — Notion can't move a page, so re-create and archive.
  const row = { title: name, url, note, area, byId, kind: conf.select };
  const made = conf.board === "stays" ? await db.createStay(env, row) : await db.createIdea(env, row);
  await db.archive(env, pageId);
  return reply(env, ev.replyToken, [text(`${conf.emoji} Moved to ${conf.board === "stays" ? "Stays" : `Ideas › ${conf.label}`}`)]);
}

/* ── formatting ─────────────────────────────────────────────── */
function fmtAmount(n, cur) {
  const digits = cur === "KRW" || cur === "JPY" || cur === "IDR" ? 0 : 2;
  return `${Number(n).toLocaleString("en-US", { maximumFractionDigits: digits })} ${cur}`;
}
function fmtDay(iso) {
  const d = new Date(iso + "T00:00:00Z");
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}

/* ── signature ──────────────────────────────────────────────── */
async function validSignature(raw, sig, secret) {
  if (!sig || !secret) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw));
  const mine = btoa(String.fromCharCode(...new Uint8Array(mac)));
  let diff = mine.length ^ sig.length;
  for (let i = 0; i < mine.length; i++) diff |= mine.charCodeAt(i) ^ sig.charCodeAt(i % sig.length);
  return diff === 0;
}
