/**
 * Everything that is specific to THIS trip lives here. Change this file (and the
 * matching constants at the top of the web page) to reuse the bot for another trip.
 */
export const TRIP = {
  name: "Seoul Loop",
  city: "Seoul",
  dates: ["2026-10-17", "2026-10-18", "2026-10-19", "2026-10-20"],   // every date/time in the app is in timeZone
  timeZone: "Asia/Seoul",
  /** Where the shared page lives; cards and help text link here. */
  pageUrl: "https://smcurlyqq.github.io/happy-birthday/korea/",
  /** Origins allowed to call /api (the page's host). localhost is always allowed for previews. */
  pageOrigins: [/^https:\/\/smcurlyqq\.github\.io$/],
  /** One entry per traveller. `seat` is the short id the page uses; `c` is its colour token. */
  members: [
    { seat: "tw", name: "Amber",    flag: "🇹🇼", c: "--p1" },
    { seat: "jp", name: "Akiha",    flag: "🇯🇵", c: "--p2" },
    { seat: "kr", name: "Hye Yeon", flag: "🇰🇷", c: "--p3" },
    { seat: "hk", name: "Gigi",     flag: "🇭🇰", c: "--p4" },
    { seat: "id", name: "Nadia",    flag: "🇮🇩", c: "--p5" },
  ],
  /** Currency everyone settles in (the page shows conversions in this). */
  settleCurrency: "THB",
  /** Currency people pay in on the ground. */
  localCurrency: "KRW",
};

/**
 * Pre-trip checklist reminders. Everyone lives in Thailand, so "today" for deadlines is
 * Bangkok, not the trip city. The hour itself is the cron line in wrangler.toml (UTC).
 */
export const REMIND = {
  timeZone: "Asia/Bangkok",
  leadDays: 3,              // first nudge this many days before a deadline; second on the day
};

/** Calendar date (YYYY-MM-DD) in a time zone. */
export const todayIn = (timeZone, now = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);

export const MEMBER_NAMES = TRIP.members.map(m => m.name);
export const MEMBER_LIST = MEMBER_NAMES.join(" · ");
export const PAGE_URL = TRIP.pageUrl;
export const DAYS = TRIP.dates;
const fmt = d => new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
export const TRIP_SPAN = `${TRIP.dates[0]} (${fmt(TRIP.dates[0])}) to ${TRIP.dates[TRIP.dates.length - 1]} (${fmt(TRIP.dates[TRIP.dates.length - 1])})`;
export const GROUP_SIZE = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"][TRIP.members.length - 1] || String(TRIP.members.length);
