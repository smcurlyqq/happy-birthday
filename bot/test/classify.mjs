/**
 * Runs the classifier against a fixed set of messages and checks the intent.
 * Needs ANTHROPIC_API_KEY in the environment (the GitHub Action provides it).
 *
 *   node bot/test/classify.mjs
 */
import { classify } from "../src/classify.js";

const candidates = [
  { id: "3d6b331a-3250-81df-9a00-f1dfbc1d655a", board: "ideas", title: "Gwangjang Market" },
  { id: "3d6b331a-3250-81ab-a618-d915bcb2036d", board: "ideas", title: "Bukchon Hanok Village" },
  { id: "3d6b331a-3250-81bd-8342-fb33f6405279", board: "ideas", title: "Seongsu cafe hop" },
  { id: "3d6b331a-3250-81ed-a9e9-c26a3be6d6dd", board: "ideas", title: "N Seoul Tower" },
];

const cases = [
  // expenses
  ["Gigi",     "paid 45000 for dinner at Mangwon",                         "expense"],
  ["Amber",    "我付了計程車 18000",                                        "expense"],
  ["Akiha",    "夕食は私が払った、62,000ウォン。GigiとNadiaと割り勘で",     "expense"],
  ["Hye Yeon", "택시 15000원 내가 냈어",                                     "expense"],
  ["Nadia",    "aku bayar tiket museum Rp 300.000 buat semua",             "expense"],
  // ideas
  ["Nadia",    "we should try Tosokchon Samgyetang!! the ginseng chicken", "idea"],
  ["Amber",    "想去弘大的 Object 逛逛，文青雜貨店",                        "idea"],
  ["Akiha",    "聖水洞のOnion行きたい",                                      "idea"],
  ["Hye Yeon", "익선동 한옥 카페 가보자",                                     "idea"],
  // itinerary
  ["Amber",    "10/18 下午兩點景福宮，5號出口集合",                          "itinerary"],
  ["Gigi",     "Sunday morning 10am Bukchon, meet at Anguk exit 2",        "itinerary"],
  ["Akiha",    "最終日は朝ホテルをチェックアウトして空港へ",                 "itinerary"],
  // votes
  ["Hye Yeon", "I'm down for Gwangjang",                                    "vote"],
  ["Nadia",    "aku ikut ke N Seoul Tower",                                "vote"],
  ["Akiha",    "廣藏市場行きたい！",                                        "vote"],
  ["Amber",    "聖水咖啡 +1",                                               "vote"],
  // bind / help
  ["unknown",  "I am Gigi",                                                 "bind"],
  ["unknown",  "what can you do?",                                          "help"],
  // chatter that must be ignored
  ["Gigi",     "lol that dinner was so good",                               "ignore"],
  ["Nadia",    "hahaha",                                                    "ignore"],
  ["Amber",    "你們幾點到機場？",                                          "ignore"],
  ["Akiha",    "寒いらしいから上着持ってきてね",                             "ignore"],
  ["Hye Yeon", "ㅋㅋㅋㅋ 사진 보내줘",                                       "ignore"],
  ["Gigi",     "maybe we should think about where to stay at some point",   "ignore"],
  ["Nadia",    "omg the exchange rate went up again",                       "ignore"],
  ["Amber",    "do you guys wanna go grab coffee on oct 18th?",             "ignore"],
  ["Gigi",     "should we do Bukchon on Sunday morning?",                   "ignore"],
  ["Akiha",    "18日の午後、カフェ行かない？",                               "ignore"],
  ["Amber",    "ok confirmed: Oct 18 3pm Onion Seongsu, meet at the entrance", "itinerary"],
  // "let's try …" in the wild
  ["Amber",    "let's try Onion",                                           "idea"],
  ["Amber",    "let's try Myeongdong Kyoja",                                "idea"],
  ["Gigi",     "lets try that tteokbokki place in Sindang",                 "idea"],
  ["Nadia",    "let's try OOO",                                             "idea"],
  ["Hye Yeon", "let's try the cafe from that video",                        "idea"],
  ["Akiha",    "let's try Gwangjang Market",                                "vote"],
];

// Open checklist rows, as the bot passes them (id | title | cat | who | due).
const tasks = [
  { id: "3dbb331a-3250-8192-8dbc-c06e875005d7", title: "訂機票",          cat: "flights", who: "Gigi",  due: "2026-09-21" },
  { id: "3dbb331a-3250-81a1-b3a0-c92dbc4e52f2", title: "訂機票",          cat: "flights", who: "Akiha", due: "2026-09-21" },
  { id: "3dbb331a-3250-81b3-beb4-c9a30abec9ef", title: "確認要不要申請 K-ETA", cat: "visa", who: "Akiha", due: "2026-10-03" },
  { id: "3dbb331a-3250-8138-8b6e-c1b0e0865683", title: "決定住哪一區",    cat: "stay",    who: null,    due: "2026-09-28" },
  { id: "3dbb331a-3250-8184-a701-e3de910dda24", title: "訂住宿",          cat: "stay",    who: null,    due: "2026-10-01" },
];
const TASK_CASES = [
  // progress: finished a checklist item
  ["Gigi",     "booked my flight!! arriving sat morning",                  "progress", "3dbb331a-3250-8192-8dbc-c06e875005d7"],
  ["Akiha",    "K-ETA申請した！",                                          "progress", "3dbb331a-3250-81b3-beb4-c9a30abec9ef"],
  ["Akiha",    "航空券取ったよ",                                            "progress", "3dbb331a-3250-81a1-b3a0-c92dbc4e52f2"],
  ["Amber",    "we booked the airbnb, done",                               "progress", "3dbb331a-3250-8184-a701-e3de910dda24"],
  ["Hye Yeon", "숙소 예약 완료!",                                            "progress", "3dbb331a-3250-8184-a701-e3de910dda24"],
  ["Amber",    "did everyone book their flights?",                         "ignore"],
  ["Gigi",     "I'll book my flight tomorrow",                             "ignore"],
  // task: something new with a date
  ["Amber",    "remind everyone to buy a T-money card by Oct 10",          "task"],
  ["Gigi",     "we need to decide the meeting point by Oct 8",             "task"],
  ["Akiha",    "10/14までに保険入っておこう",                                "task"],
  ["Gigi",     "we should buy travel insurance at some point",             "ignore"],
];

const env = { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY };
if (!env.ANTHROPIC_API_KEY) { console.error("ANTHROPIC_API_KEY not set"); process.exit(2); }

let bad = 0;
for (const [sender, msg, want] of cases) {
  const t0 = Date.now();
  const out = await classify(env, { text: msg, senderName: sender === "unknown" ? null : sender, candidates });
  const ms = Date.now() - t0;
  const got = !out ? "null" : out.confidence < 0.7 ? `ignore(<0.7 ${out.intent} ${out.confidence})` : out.intent;
  const ok = got === want || (want === "ignore" && got.startsWith("ignore"));
  if (!ok) bad++;
  const detail = out?.[out.intent] ? " " + JSON.stringify(out[out.intent]) : "";
  console.log(`${ok ? "✓" : "✗"} ${want.padEnd(9)} got ${got.padEnd(9)} c=${out?.confidence ?? "-"} ${ms}ms  ${sender}: ${msg}${detail}`);
}
for (const [sender, msg, want, target] of TASK_CASES) {
  const t0 = Date.now();
  const out = await classify(env, { text: msg, senderName: sender, candidates, tasks });
  const ms = Date.now() - t0;
  const got = !out ? "null" : out.confidence < 0.7 ? `ignore(<0.7 ${out.intent} ${out.confidence})` : out.intent;
  let ok = got === want || (want === "ignore" && got.startsWith("ignore"));
  if (ok && want === "progress" && target && (out.progress?.target_id || "").replace(/-/g, "") !== target.replace(/-/g, "")) ok = false;
  if (ok && want === "task" && !/^\d{4}-\d{2}-\d{2}$/.test(out.task?.due || "")) ok = false;
  if (!ok) bad++;
  const detail = out?.[out.intent] ? " " + JSON.stringify(out[out.intent]) : "";
  console.log(`${ok ? "✓" : "✗"} ${want.padEnd(9)} got ${got.padEnd(9)} c=${out?.confidence ?? "-"} ${ms}ms  ${sender}: ${msg}${detail}`);
}

const total = cases.length + TASK_CASES.length;
console.log(`\n${total - bad}/${total} as expected`);
process.exit(bad > 2 ? 1 : 0);   // allow a couple of judgement calls to differ
