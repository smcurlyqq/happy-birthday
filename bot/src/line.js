/**
 * LINE Messaging API: replies, the help text, the Flex card, leaving groups.
 * Everything user-facing is English.
 */

const LINE = "https://api.line.me/v2/bot";

import { TRIP, MEMBER_LIST, PAGE_URL } from "./config.js";
export { MEMBER_LIST, PAGE_URL };

/* One welcome message: English first, then the same guide in Japanese, Korean,
   Cantonese and Indonesian. Example messages stay in English everywhere — the group talks in English. */
const EX = {
  link:  "https://www.airbnb.com/rooms/…",
  idea:  "“Let’s try Gwangjang Market”",
  vote:  "“I’m in for Gwangjang”",
  paid:  "“Paid 45,000 for dinner”",
  plan:  "“Oct 18 2pm Gyeongbokgung, meet at exit 5”",
  iam:   "“I am <your name>”",
};

const HELP_TEXT = [
  `🇰🇷 ${TRIP.name} bot`,
  "Everything you tell me lands on our trip page:",
  PAGE_URL,
  "",
  "Just type normally — I pick up:",
  `• A link or a screenshot of a place → Ideas (hotels go to Stays)`,
  `• ${EX.idea} → Ideas`,
  `• ${EX.vote}, or tap I’m in on a card → your vote`,
  `• ${EX.paid} → Expenses, in won, split 5 ways unless you name people`,
  `• ${EX.plan} → Itinerary`,
  `First, type ${EX.iam} once (${MEMBER_LIST}). Type “help” to see this again. Otherwise I stay quiet.`,
  "",
  "🇯🇵 ここで伝えたことは旅のページにまとまります。普通に書くだけでOK：",
  `• リンクや店のスクショ → Ideas（ホテルは Stays）`,
  `• ${EX.idea} → Ideas`,
  `• ${EX.vote} またはカードの I’m in → 投票`,
  `• ${EX.paid} → Expenses（ウォン。名前を書かなければ5人で割り勘）`,
  `• ${EX.plan} → Itinerary`,
  `最初に一度 ${EX.iam} と送ってください。「help」でこの説明を再表示。それ以外は黙っています。`,
  "",
  "🇰🇷 여기서 말한 건 전부 여행 페이지에 정리돼요. 평소처럼 쓰면 돼요:",
  `• 링크나 장소 스크린샷 → Ideas (호텔은 Stays)`,
  `• ${EX.idea} → Ideas`,
  `• ${EX.vote} 또는 카드의 I’m in → 투표`,
  `• ${EX.paid} → Expenses (원화, 이름을 안 쓰면 5명이 나눔)`,
  `• ${EX.plan} → Itinerary`,
  `먼저 ${EX.iam} 을 한 번 보내 주세요. “help” 를 치면 이 안내를 다시 볼 수 있어요. 그 외엔 조용히 있을게요.`,
  "",
  "🇭🇰 你喺度講嘅嘢全部會入晒去我哋個旅行網頁。照平時咁打就得：",
  `• 貼 link 或者店嘅 screenshot → Ideas（酒店入 Stays）`,
  `• ${EX.idea} → Ideas`,
  `• ${EX.vote} 或者撳張卡上面嘅 I’m in → 投票`,
  `• ${EX.paid} → Expenses（韓圜，唔寫名就五個人夾）`,
  `• ${EX.plan} → Itinerary`,
  `一開始先打一次 ${EX.iam}。打 “help” 可以再睇一次呢段。其他時候我唔會出聲。`,
  "",
  "🇮🇩 Semua yang kamu tulis di sini masuk ke halaman trip kita. Tulis seperti biasa saja:",
  `• Tautan atau screenshot tempat → Ideas (hotel masuk Stays)`,
  `• ${EX.idea} → Ideas`,
  `• ${EX.vote}, atau tekan I’m in di kartu → vote kamu`,
  `• ${EX.paid} → Expenses, dalam won, dibagi 5 kecuali kamu sebut nama`,
  `• ${EX.plan} → Itinerary`,
  `Pertama, ketik ${EX.iam} sekali. Ketik “help” untuk lihat ini lagi. Selain itu aku diam.`,
].join("\n");

/** The welcome / help reply: one message, five languages, English examples. */
export const HELP_MESSAGES = [{ type: "text", text: HELP_TEXT }];
export const HELP = HELP_TEXT;

export const BIND_FIRST = `Tell me who you are first — type “I am <your name>” (${MEMBER_LIST}).`;

export const text = t => ({ type: "text", text: t });

/** Download an image someone sent. The full rendition first (screenshots need legible text);
    LINE's small preview only as a fallback when the original is over Claude's 5 MB cap. */
export async function imageContent(env, messageId) {
  for (const path of [`/message/${messageId}/content`, `/message/${messageId}/content/preview`]) {
    const r = await fetch("https://api-data.line.me/v2/bot" + path, {
      headers: { Authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}` },
    });
    if (!r.ok) { console.error("line content", path, r.status); continue; }
    const type = (r.headers.get("content-type") || "image/jpeg").split(";")[0];
    const buf = new Uint8Array(await r.arrayBuffer());
    if (buf.byteLength > 4_500_000) continue;                // Claude's per-image cap is 5 MB
    let bin = ""; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    return { data: btoa(bin), mediaType: type };
  }
  return null;
}

export async function reply(env, replyToken, messages) {
  if (!replyToken) return;
  const r = await fetch(LINE + "/message/reply", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ replyToken, messages }),
  });
  if (!r.ok) console.error("line reply", r.status, await r.text());
}

/** Send to a group without a reply token — used by the scheduled reminder. */
export async function push(env, to, messages) {
  const r = await fetch(LINE + "/message/push", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ to, messages }),
  });
  if (!r.ok) throw new Error(`line push ${r.status} ${await r.text()}`);
}

/** Leave a group or room we were not invited to. */
export async function leave(env, source) {
  const path = source.groupId ? `/group/${source.groupId}/leave`
             : source.roomId  ? `/room/${source.roomId}/leave` : null;
  if (!path) return;
  const r = await fetch(LINE + path, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}` },
  });
  if (!r.ok) console.error("line leave", r.status, await r.text());
}

/* ── the card ───────────────────────────────────────────────── */

export const KINDS = {
  stay:  { emoji: "🏠", label: "Stays",  short: "Stay",  board: "stays" },
  food:  { emoji: "🍽", label: "Food",   short: "Food",  board: "ideas", select: "Food" },
  cafe:  { emoji: "☕️", label: "Cafe",   short: "Cafe",  board: "ideas", select: "Cafe" },
  sight: { emoji: "⛩", label: "Sight",  short: "Sight", board: "ideas", select: "Sight" },
  shop:  { emoji: "🛍", label: "Shop",   short: "Shop",  board: "ideas", select: "Shop" },
  night: { emoji: "🍶", label: "Night",  short: "Night", board: "ideas", select: "Night" },
  other: { emoji: "📌", label: "Other",  short: "Other", board: "ideas", select: "Other" },
};
export const BUTTON_ORDER = ["stay", "food", "cafe", "sight", "shop", "night"];

/** Kind key from a Notion select name ("Food" → "food"). */
export const kindKey = name => Object.keys(KINDS).find(k => KINDS[k].select === name) || "other";

/**
 * Flex card confirming a filed Idea/Stay, with an "I'm in" vote button and
 * one-tap recategorisation.
 */
export function card({ title, host, kind, sure, pageId }) {
  const conf = KINDS[kind];
  const board = conf.board;
  const head = !sure ? "📥 Got it — which kind is this?"
             : board === "stays" ? "🏠 Filed under Stays"
             : `${conf.emoji} Filed under Ideas › ${conf.label}`;
  const pid = pageId.replace(/-/g, "");
  const targets = BUTTON_ORDER.filter(k => k !== kind);

  // Small tappable chips: Flex "button" components can't go below ~40px tall.
  const btn = k => ({
    type: "box", layout: "vertical", flex: 1, backgroundColor: "#F1EADF", cornerRadius: "999px",
    paddingTop: "5px", paddingBottom: "5px", paddingStart: "4px", paddingEnd: "4px",
    contents: [{ type: "text", text: KINDS[k].short, size: "xs", align: "center", color: "#4A423B" }],
    action: { type: "postback", label: KINDS[k].short, data: `a=rc&s=${board}&p=${pid}&k=${k}`, displayText: `Change to ${KINDS[k].short}` },
  });

  return {
    type: "flex",
    altText: `${head}: ${title}`,
    contents: {
      type: "bubble",
      body: {
        type: "box", layout: "vertical", spacing: "sm",
        contents: [
          { type: "text", text: head, size: "xs", color: sure ? "#8C1D18" : "#A67C2E", weight: "bold" },
          { type: "text", text: title.slice(0, 120), wrap: true, weight: "bold", size: "md" },
          ...(host ? [{ type: "text", text: host, size: "xs", color: "#8E877D" }] : []),
          { type: "text", text: "Open the trip page →", size: "xs", color: "#2B4562",
            action: { type: "uri", uri: PAGE_URL } },
        ],
      },
      footer: {
        type: "box", layout: "vertical", spacing: "xs",
        contents: [
          { type: "button", style: "primary", height: "sm", color: "#8C1D18",
            action: { type: "postback", label: "I’m in", data: `a=in&b=${board}&p=${pid}`, displayText: "I’m in" } },
          { type: "text", text: "Wrong kind? Change to:", size: "xxs", color: "#8E877D", margin: "md" },
          { type: "box", layout: "horizontal", spacing: "xs", contents: targets.map(btn) },
        ],
      },
    },
  };
}
