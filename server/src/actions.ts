// TapOne actions: Google sign-in with IP/country lock + VPN block, content
// (offerwalls / surveys / games) managed by the admin and read by everyone,
// dollar withdrawals by country, admin approve/reject, help + mailbox,
// leaderboards, affiliate commissions, and the offerwall postback endpoint.

import {
defineAction,
z,
type ActionsModule,
type Ctx,
} from "@hatch/space-sdk";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import * as schema from "./schema";

type DB = ReturnType<Ctx["db"]>;

// ---------------------------------------------------------------- settings

const DEFAULT_SETTINGS: Record<string, string> = {
  google_client_id:
    "34580127521-1jbjmo47er7e64jd42s4b13m2kkje2r1.apps.googleusercontent.com",
  admin_username: "admin",
  admin_password: "tapone-admin-2026",
  daily_pool_cents: "10000",
  affiliate_pool_cents: "150000",
  min_withdraw_cents: "500",
  user_share_pct: "70",
  affiliate_earning_pct: "8",
  affiliate_spending_pct: "5",
  postback_secret: "",
  // TheoremReach app Secret Key (publisher dashboard → app details).
  // Used ONLY to verify the HMAC-SHA1 signature on TheoremReach reward
  // callbacks; empty = callbacks are accepted unverified (not safe).
  theoremreach_secret: "",
  checkin_bonus_cents: "5",
  level_reward_cents: "50",
  // Weekly check-in (owner-editable in Admin → Settings → Money): the
  // daily earnings goal and the 7 calendar-day rewards Mon..Sun, in
  // cents. Defaults are the owner's decided ladder ($3.00/week total).
  checkin_goal_cents: "100",
  checkin_rewards_cents: "20,25,30,40,50,65,70",
  // Levels (owner-editable in Admin → Settings → Levels & Title
  // Bonuses): cents of lifetime earnings per level, and the title
  // table as JSON [{name, level, standardPct, enhancedPct}]. Empty
  // JSON = the built-in RewardJoy-verified table below.
  level_cents_per_level: "100",
  level_titles_json: "",
  // Contest prize tiers by rank, comma-separated cents. Empty = the
  // built-in RewardJoy-verified tables (Daily: 100 ranks summing to
  // $100; Affiliate: 25 ranks summing to $1,500). Owner-editable in
  // Admin → Settings → Contest prize tiers.
  daily_tiers_cents: "",
  affiliate_tiers_cents: "",
};

async function getSettings(db: DB): Promise<Record<string, string>> {
  const rows = await db.select().from(schema.settings);
  const out: Record<string, string> = { ...DEFAULT_SETTINGS };
  for (const row of rows) out[row.key] = row.value;
  return out;
}

const SOCIAL_PLATFORMS: { id: string; label: string; key: string }[] = [
  { id: "discord", label: "Discord", key: "social_discord" },
  { id: "twitter", label: "X", key: "social_twitter" },
  { id: "telegram", label: "Telegram", key: "social_telegram" },
  { id: "facebook", label: "Facebook", key: "social_facebook" },
  { id: "youtube", label: "YouTube", key: "social_youtube" },
  { id: "tiktok", label: "TikTok", key: "social_tiktok" },
  { id: "instagram", label: "Instagram", key: "social_instagram" },
];

function socialLinksFrom(settings: Record<string, string>) {
  return SOCIAL_PLATFORMS.map((s) => ({
    platform: s.id,
    label: s.label,
    url: (settings[s.key] ?? "").trim(),
  })).filter((s) => s.url !== "");
}

function settingInt(settings: Record<string, string>, key: string): number {
  const n = Number.parseInt(settings[key] ?? "0", 10);
  return Number.isFinite(n) ? n : 0;
}

// ---------------------------------------------------------------- helpers

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function randomCode(length: number): string {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return out;
}

function newToken(prefix: string): string {
  return `${prefix}_${globalThis.crypto.randomUUID().replaceAll("-", "")}${randomCode(8)}`;
}

type UserRow = typeof schema.users.$inferSelect;

function publicUser(u: UserRow, titles: readonly TitleDef[] = DEFAULT_TITLES) {
  return {
    id: u.id,
    userCode: u.userCode,
    // The user's OWN unique Offer Token (shown on their Profile; every
    // user has a different one). Falls back to the user code only for
    // rows created before the offer_token column existed.
    offerToken: u.offerToken ?? u.userCode,
    name: u.name,
    email: u.email,
    pictureUrl: u.pictureUrl ?? null,
    loginMethod: u.loginMethod,
    // NOTE: no `ip` and no country fields here on purpose — a user's IP
    // and country are visible ONLY to the admin (adminListUsers adds
    // them back for admins). They are never sent to the user's own
    // client, so no country or IP can show anywhere in the user's site.
    // The country still lives on the user row and still drives withdraw
    // methods, content visibility and country rules server-side.
    balanceCents: u.balanceCents,
    totalEarnedCents: u.totalEarnedCents,
    level: u.level,
    title: titleForLevel(u.level, titles)?.name ?? null,
    theme: u.theme === "dark" ? "dark" : "light",
    referralCode: u.referralCode,
    blocked: u.blocked === 1,
    createdAt: u.createdAt.toISOString(),
  };
}

/** Generates an Offer Token that no other user has (DB-unique column). */
async function uniqueOfferToken(db: DB): Promise<string> {
  let offerToken = `OT-${randomCode(10)}`;
  for (let attempt = 0; attempt < 5; attempt++) {
    const clash = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.offerToken, offerToken))
      .limit(1);
    if (!clash[0]) break;
    offerToken = `OT-${randomCode(10)}`;
  }
  return offerToken;
}

async function requireUser(ctx: Ctx, token: string): Promise<UserRow> {
  const db = ctx.db<typeof schema>();
  const rows = await db
    .select()
    .from(schema.sessions)
    .where(eq(schema.sessions.token, token))
    .limit(1);
  const session = rows[0];
  if (!session || session.userId <= 0) throw new Error("Please sign in again.");
  const userRows = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, session.userId))
    .limit(1);
  const user = userRows[0];
  if (!user) throw new Error("Account not found. Please sign in again.");
  if (user.blocked === 1)
    throw new Error("This account has been blocked. Contact support via Help.");
  return user;
}

async function requireAdmin(ctx: Ctx, token: string): Promise<void> {
  const db = ctx.db<typeof schema>();
  const rows = await db
    .select()
    .from(schema.sessions)
    .where(eq(schema.sessions.token, token))
    .limit(1);
  const session = rows[0];
  if (!session || session.userId !== -1)
    throw new Error("Admin sign-in required.");
  const ageMs = Date.now() - session.createdAt.getTime();
  if (ageMs > 24 * 60 * 60 * 1000)
    throw new Error("Admin session expired. Sign in again.");
}

// ------------------------------------------------------- network detection

const VPN_KEYWORDS = [
  "vpn",
  "proxy",
  "nordvpn",
  "expressvpn",
  "surfshark",
  "mullvad",
  "proton",
  "cyberghost",
  "private internet",
  "hidemyass",
  "tunnelbear",
  "windscribe",
  "m247",
  "datacamp",
  "choopa",
  "hosting",
  "data center",
  "datacenter",
];

interface GeoResult {
  ip: string | null;
  countryCode: string | null;
  countryName: string | null;
  flagEmoji: string | null;
  isp: string | null;
  vpnSuspected: boolean;
}

async function lookupGeo(ip: string | null): Promise<GeoResult> {
  const fallback: GeoResult = {
    ip,
    countryCode: null,
    countryName: null,
    flagEmoji: null,
    isp: null,
    vpnSuspected: false,
  };
  try {
    const url = ip ? `https://ipwho.is/${encodeURIComponent(ip)}` : "https://ipwho.is/";
    const res = await fetch(url, {
      signal: AbortSignal.timeout(5000),
      headers: { accept: "application/json" },
    });
    if (!res.ok) return fallback;
    const data = (await res.json()) as {
      success?: boolean;
      ip?: string;
      country_code?: string;
      country?: string;
      flag?: { emoji?: string };
      connection?: { org?: string; isp?: string };
    };
    if (data.success === false) return fallback;
    const org = `${data.connection?.org ?? ""} ${data.connection?.isp ?? ""}`;
    const lower = org.toLowerCase();
    return {
      ip: data.ip ?? ip,
      countryCode: data.country_code ?? null,
      countryName: data.country ?? null,
      flagEmoji: data.flag?.emoji ?? null,
      isp: org.trim() || null,
      vpnSuspected: VPN_KEYWORDS.some((k) => lower.includes(k)),
    };
  } catch {
    return fallback;
  }
}

// ------------------------------------------------------- withdraw methods

interface MethodField {
  key: string;
  label: string;
}
interface MethodDef {
  id: string;
  label: string;
  fields: MethodField[];
  /**
   * Logo image link (owner-added methods). Built-in methods carry
   * null here — the client renders their official bundled logos by
   * method id (METHOD_LOGOS in client/src/lib.tsx).
   */
  imageUrl?: string | null;
}

const NAME_FIELD: MethodField = { key: "accountName", label: "Account holder name" };

const METHODS: Record<string, MethodDef> = {
  easypaisa: {
    id: "easypaisa",
    label: "Easypaisa",
    fields: [NAME_FIELD, { key: "accountNumber", label: "Easypaisa mobile number" }],
  },
  jazzcash: {
    id: "jazzcash",
    label: "JazzCash",
    fields: [NAME_FIELD, { key: "accountNumber", label: "JazzCash mobile number" }],
  },
  bank: {
    id: "bank",
    label: "Bank Transfer",
    fields: [
      { key: "bankName", label: "Bank name" },
      NAME_FIELD,
      { key: "accountNumber", label: "Account number / IBAN" },
    ],
  },
  bank_ach: {
    id: "bank_ach",
    label: "Bank Transfer (ACH)",
    fields: [
      { key: "bankName", label: "Bank name" },
      NAME_FIELD,
      { key: "routingNumber", label: "Routing number" },
      { key: "accountNumber", label: "Account number" },
    ],
  },
  paypal: {
    id: "paypal",
    label: "PayPal",
    fields: [{ key: "email", label: "PayPal email" }],
  },
  binance: {
    id: "binance",
    label: "Binance USDT",
    fields: [{ key: "wallet", label: "Binance USDT address / UID" }],
  },
  wise: {
    id: "wise",
    label: "Wise",
    fields: [{ key: "email", label: "Wise email" }],
  },
  payoneer: {
    id: "payoneer",
    label: "Payoneer",
    fields: [{ key: "email", label: "Payoneer email" }],
  },
  upi: {
    id: "upi",
    label: "UPI",
    fields: [NAME_FIELD, { key: "upiId", label: "UPI ID" }],
  },
};

const METHODS_BY_COUNTRY: Record<string, string[]> = {
  PK: ["easypaisa", "jazzcash", "bank", "paypal", "binance"],
  US: ["paypal", "bank_ach", "wise", "payoneer", "binance"],
  GB: ["paypal", "bank", "wise", "payoneer"],
  IN: ["paypal", "upi", "bank"],
};
const DEFAULT_METHOD_IDS = ["paypal", "bank", "wise"];

function methodsForCountry(countryCode: string | null): MethodDef[] {
  const ids =
    (countryCode ? METHODS_BY_COUNTRY[countryCode.toUpperCase()] : undefined) ??
    DEFAULT_METHOD_IDS;
  return ids
    .map((id) => METHODS[id])
    .filter((m): m is MethodDef => m != null);
}

// --------------------------------- owner-added withdraw methods
// The owner can add EXTRA withdraw methods for any country from Admin
// → Withdraw Methods (owner order 2026-11-19 ~23:49 PST). They live in
// the withdraw_methods table and are merged into that country's
// method list everywhere the list is used — the Withdraw page
// (getWithdrawInfo) and submission validation (requestWithdrawal) —
// so a method added for a country shows to ALL users whose locked
// (login-IP) country matches, next to the built-in methods above,
// which stay exactly as they are. A custom method's id is
// "custom_<row id>".

type WithdrawMethodRow = typeof schema.withdrawMethods.$inferSelect;

function customMethodDef(row: WithdrawMethodRow): MethodDef {
  let fields: MethodField[] = [];
  try {
    const parsed: unknown = JSON.parse(row.fieldsJson);
    if (Array.isArray(parsed)) {
      fields = parsed
        .filter(
          (f): f is MethodField =>
            !!f &&
            typeof f === "object" &&
            typeof (f as MethodField).key === "string" &&
            typeof (f as MethodField).label === "string",
        )
        .map((f) => ({ key: f.key, label: f.label }));
    }
  } catch {
    fields = [];
  }
  if (fields.length === 0)
    fields = [{ key: "account", label: "Account details" }];
  return {
    id: `custom_${row.id}`,
    label: row.label,
    fields,
    imageUrl: row.imageUrl ?? null,
  };
}

/** A method as sent to clients: imageUrl always present (null when
 *  the method has no logo link — built-ins use bundled logos). */
interface MethodDefOut {
  id: string;
  label: string;
  fields: MethodField[];
  imageUrl: string | null;
}

/** Built-in methods for the country PLUS the owner's active custom ones. */
async function methodsForCountryWithCustom(
  db: DB,
  countryCode: string | null,
): Promise<MethodDefOut[]> {
  const builtins = methodsForCountry(countryCode);
  if (!countryCode)
    return builtins.map((m) => ({
      id: m.id,
      label: m.label,
      fields: m.fields,
      imageUrl: m.imageUrl ?? null,
    }));
  const rows = await db
    .select()
    .from(schema.withdrawMethods)
    .where(
      and(
        eq(schema.withdrawMethods.countryCode, countryCode.toUpperCase()),
        eq(schema.withdrawMethods.active, 1),
      ),
    )
    .orderBy(schema.withdrawMethods.id);
  const seen = new Set(builtins.map((m) => m.label.toLowerCase()));
  const custom = rows
    .map(customMethodDef)
    .filter((m) => !seen.has(m.label.toLowerCase()));
  // Normalise: every method the client receives has an explicit
  // imageUrl (null for built-ins — their logos are bundled client-side).
  return [...builtins, ...custom].map((m) => ({
    id: m.id,
    label: m.label,
    fields: m.fields,
    imageUrl: m.imageUrl ?? null,
  }));
}

/** id → label for every custom method ever added (incl. removed ones,
    so past withdrawals keep showing the method's real name). */
async function customMethodLabels(db: DB): Promise<Map<string, string>> {
  const rows = await db.select().from(schema.withdrawMethods);
  return new Map(rows.map((r) => [`custom_${r.id}`, r.label]));
}

// ------------------------------------------------------------ levels
// RewardJoy Title Bonus system (verified by inspection 2026-11-19):
// every $1 earned = +1 level. Titles: Bronze L5, Silver L31, Gold L101,
// (the pace and the title table below are the DEFAULTS — the owner can
// change both in Admin → Settings → Levels & Title Bonuses, stored in
// the level_cents_per_level / level_titles_json settings and read live
// by levelConfigFrom on every use.)
// Diamond L501, Champion L2001, Master L10001. A Title Bonus is settled
// automatically at every 10 new levels (first settled after Level 15,
// i.e. at Level 20): the title's percentage of the $10 earned in that
// 10-level block. Rate is Enhanced when the user's chargeback rate is
// under 3%, Standard at 3-5%, and no bonus above 5%. TapOne records no
// partner chargebacks yet, so the recorded rate is 0% (Enhanced) until a
// chargeback source exists. Because the level derives from lifetime
// earnings, a negative adjustment (chargeback) lowers it again.

interface TitleDef {
  name: string;
  level: number;
  standardPct: number;
  enhancedPct: number;
}

/** Built-in title table (RewardJoy-verified) — used until the owner
 *  saves his own in Admin → Settings → Levels & Title Bonuses. */
const DEFAULT_TITLES: TitleDef[] = [
  { name: "Bronze", level: 5, standardPct: 1, enhancedPct: 2 },
  { name: "Silver", level: 31, standardPct: 3, enhancedPct: 4 },
  { name: "Gold", level: 101, standardPct: 5, enhancedPct: 6 },
  { name: "Diamond", level: 501, standardPct: 7, enhancedPct: 8 },
  { name: "Champion", level: 2001, standardPct: 9, enhancedPct: 10 },
  { name: "Master", level: 10001, standardPct: 11, enhancedPct: 12 },
];

interface LevelConfig {
  titles: TitleDef[];
  centsPerLevel: number;
}

/**
 * The live level configuration: the owner's title table from settings
 * (`level_titles_json`) when it is present and valid — 1–8 titles with
 * strictly increasing levels and 0–100 percentages — otherwise the
 * built-in table. `level_cents_per_level` is how many cents of
 * lifetime earnings make one level (default 100 = $1 per level).
 */
function levelConfigFrom(settings: Record<string, string>): LevelConfig {
  const centsRaw = settingInt(settings, "level_cents_per_level");
  const centsPerLevel =
    centsRaw >= 1 && centsRaw <= 1_000_000 ? centsRaw : 100;
  const raw = (settings["level_titles_json"] ?? "").trim();
  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length >= 1 && parsed.length <= 8) {
        const out: TitleDef[] = [];
        let prev = 0;
        let valid = true;
        for (const entry of parsed) {
          if (typeof entry !== "object" || entry === null) {
            valid = false;
            break;
          }
          const r = entry as Record<string, unknown>;
          const name = typeof r.name === "string" ? r.name.trim() : "";
          const level = typeof r.level === "number" ? r.level : Number.NaN;
          const standardPct =
            typeof r.standardPct === "number" ? r.standardPct : Number.NaN;
          const enhancedPct =
            typeof r.enhancedPct === "number" ? r.enhancedPct : Number.NaN;
          if (
            !name ||
            name.length > 30 ||
            !Number.isInteger(level) ||
            level <= prev ||
            level > 1_000_000 ||
            !Number.isFinite(standardPct) ||
            standardPct < 0 ||
            standardPct > 100 ||
            !Number.isFinite(enhancedPct) ||
            enhancedPct < 0 ||
            enhancedPct > 100
          ) {
            valid = false;
            break;
          }
          prev = level;
          out.push({ name, level, standardPct, enhancedPct });
        }
        if (valid && out.length > 0) return { titles: out, centsPerLevel };
      }
    } catch {
      // Invalid stored JSON — fall back to the built-in table.
    }
  }
  return { titles: DEFAULT_TITLES, centsPerLevel };
}

function levelForEarned(totalEarnedCents: number, centsPerLevel = 100): number {
  return Math.max(0, Math.floor(totalEarnedCents / Math.max(1, centsPerLevel)));
}

function titleForLevel(
  level: number,
  titles: readonly TitleDef[] = DEFAULT_TITLES,
): TitleDef | null {
  let found: TitleDef | null = null;
  for (const title of titles) {
    if (level >= title.level) found = title;
  }
  return found;
}

function nextTitleForLevel(
  level: number,
  titles: readonly TitleDef[] = DEFAULT_TITLES,
): TitleDef | null {
  for (const title of titles) {
    if (level < title.level) return title;
  }
  return null;
}

/** Chargeback rate for a user, in percent. No chargebacks are recorded yet. */
async function chargebackRatePct(db: DB, userId: number): Promise<number> {
  const rows = await db
    .select()
    .from(schema.transactions)
    .where(
      and(
        eq(schema.transactions.userId, userId),
        eq(schema.transactions.kind, "admin_adjust"),
      ),
    )
    .limit(1000);
  const reversed = rows
    .filter((r) => r.amountCents < 0 && r.note.toLowerCase().includes("chargeback"))
    .reduce((s, r) => s - r.amountCents, 0);
  if (reversed <= 0) return 0;
  const userRows = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  const earned = userRows[0]?.totalEarnedCents ?? 0;
  if (earned <= 0) return 100;
  return Math.min(100, (reversed / earned) * 100);
}

/**
 * Syncs a user's stored level with their lifetime earnings and pays any
 * due Title Bonuses. Called after every credit (and lazily from
 * getLevel), so level, progress and bonuses are never display-only.
 */
async function checkLevelUps(db: DB, userId: number): Promise<void> {
  const rows = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  const user = rows[0];
  if (!user) return;
  // Level pace + title table come from the owner's settings (Admin →
  // Settings → Levels & Title Bonuses), defaulting to $1 per level and
  // the built-in RewardJoy table.
  const levelCfg = levelConfigFrom(await getSettings(db));
  const cbRate = await chargebackRatePct(db, userId);
  let totalEarned = user.totalEarnedCents;
  let balance = user.balanceCents;
  let paidLevel = user.titleBonusPaidLevel;
  const bonusRows: { amountCents: number; note: string }[] = [];
  for (let i = 0; i < 300; i++) {
    const levelNow = levelForEarned(totalEarned, levelCfg.centsPerLevel);
    const nextMilestone = Math.floor(paidLevel / 10) * 10 + 10;
    if (nextMilestone > levelNow) break;
    paidLevel = nextMilestone;
    if (nextMilestone < 20) continue; // first settled after Level 15
    const title = titleForLevel(nextMilestone, levelCfg.titles);
    if (!title) continue;
    const pct =
      cbRate < 3 ? title.enhancedPct : cbRate <= 5 ? title.standardPct : 0;
    if (pct <= 0) continue;
    // The 10-level block is 10 × the per-level earnings; the bonus is
    // pct% of that block ($10 at the default $1-per-level pace).
    const bonus = Math.round(10 * levelCfg.centsPerLevel * (pct / 100));
    if (bonus <= 0) continue;
    bonusRows.push({
      amountCents: bonus,
      note: `Title Bonus — Level ${nextMilestone} (${title.name}, ${cbRate < 3 ? "Enhanced" : "Standard"} ${pct}%)`,
    });
    balance += bonus;
    totalEarned += bonus;
  }
  const newLevel = levelForEarned(totalEarned, levelCfg.centsPerLevel);
  if (
    newLevel === user.level &&
    paidLevel === user.titleBonusPaidLevel &&
    bonusRows.length === 0
  ) {
    return;
  }
  const statements: BatchItem<"sqlite">[] = [
    db
      .update(schema.users)
      .set({
        level: newLevel,
        titleBonusPaidLevel: paidLevel,
        balanceCents: balance,
        totalEarnedCents: totalEarned,
      })
      .where(eq(schema.users.id, user.id)),
  ];
  for (const b of bonusRows) {
    statements.push(
      db.insert(schema.transactions).values({
        userId: user.id,
        kind: "level_reward",
        amountCents: b.amountCents,
        note: b.note,
      }),
    );
  }
  const [first, ...rest] = statements;
  if (first) await db.batch([first, ...rest]);
}

// ------------------------------------------------------------ check-in

function dayKeyOf(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function shiftDayKey(dayKey: string, delta: number): string {
  const [y = 1970, m = 1, d = 1] = dayKey.split("-").map(Number);
  const dt = new Date(y, m - 1, d + delta);
  return dayKeyOf(dt);
}



// ------------------------------------------------------- weekly check-in
// WEEKLY CHECK-IN (owner spec 2026-11-19 ~23:30 PST; reward rule
// corrected by owner order 2026-11-19 ~23:44 PST): a Monday–Sunday
// week of 7 days (shown M T W T F S S). There is NO claim button: a
// day completes automatically the moment the user has earned $1 that
// day — from ANY earning source: offers/surveys/games (offer_credit)
// and invite-friend commissions (affiliate_earning /
// affiliate_spending). The day's bonus is credited to the balance in
// the same moment (the postback handler calls syncWeeklyCheckin right
// after crediting, and getCheckin settles any missed day lazily).
//
// REWARD RULE — each CALENDAR day pays its own ladder amount, always:
// Monday $0.20, Tuesday $0.25, Wednesday $0.30, Thursday $0.40,
// Friday $0.50, Saturday $0.65, Sunday $0.70 = exactly $3.00 for a
// full week. The amount follows the weekday, NOT a streak: missing a
// day loses only that day's bonus — the next day still pays its own
// full calendar amount (Friday pays $0.50 even if Thursday was
// missed). The earlier streak-position rule ("miss a day and the
// reward restarts at Day 1") is REMOVED at the owner's order — it
// made a Friday completion show and pay $0.20 instead of $0.50.
// The ladder amounts above and the daily earnings goal are the
// DEFAULTS — the owner can change every one of them in Admin →
// Settings → Money (settings keys checkin_rewards_cents /
// checkin_goal_cents); the helpers below read the live values.
const DEFAULT_CHECKIN_REWARDS_CENTS = [20, 25, 30, 40, 50, 65, 70];
const DEFAULT_CHECKIN_GOAL_CENTS = 100;

/** The 7 calendar-day check-in rewards (Mon..Sun) from settings. */
function checkinRewardsFrom(settings: Record<string, string>): number[] {
  const parts = (settings["checkin_rewards_cents"] ?? "")
    .split(",")
    .map((s) => Number.parseInt(s.trim(), 10));
  if (
    parts.length === 7 &&
    parts.every((n) => Number.isFinite(n) && n >= 0 && n <= 100_000)
  ) {
    return parts;
  }
  return [...DEFAULT_CHECKIN_REWARDS_CENTS];
}

/** The daily earnings goal that completes a check-in day, from settings. */
function checkinGoalFrom(settings: Record<string, string>): number {
  const n = settingInt(settings, "checkin_goal_cents");
  return n >= 1 && n <= 1_000_000 ? n : DEFAULT_CHECKIN_GOAL_CENTS;
}
const CHECKIN_EARNING_KINDS = [
  "offer_credit",
  "affiliate_earning",
  "affiliate_spending",
] as const;
const WEEKDAY_LABELS = ["M", "T", "W", "T", "F", "S", "S"] as const;

/** Monday (as a dayKey) of the week containing the given dayKey. */
function mondayKeyOf(dayKey: string): string {
  const [y = 1970, m = 1, d = 1] = dayKey.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  const dow = dt.getDay(); // 0 = Sunday … 6 = Saturday
  const sinceMonday = (dow + 6) % 7;
  return shiftDayKey(dayKey, -sinceMonday);
}

interface WeekCheckinState {
  weekStartKey: string;
  todayKey: string;
  /** Earnings (counted kinds) per dayKey of this week. */
  earnedByDay: Map<string, number>;
  /** Paid check-in rows of this week, by dayKey. */
  paidByDay: Map<string, number>;
  /** Consecutive qualified days ending at the given day (within this week). */
  runLengthAt: (dayKey: string) => number;
  /** The streak position that applies TODAY if it completes (0 = not yet). */
  todayRun: number;
  currentStreak: number;
}

async function loadWeekCheckinState(
  db: DB,
  userId: number,
  goalCents: number = DEFAULT_CHECKIN_GOAL_CENTS,
): Promise<WeekCheckinState> {
  const todayKey = dayKeyOf(new Date());
  const weekStartKey = mondayKeyOf(todayKey);
  const weekKeys = Array.from({ length: 7 }, (_, i) =>
    shiftDayKey(weekStartKey, i),
  );
  const [wy = 1970, wm = 1, wd = 1] = weekStartKey.split("-").map(Number);
  const weekStart = new Date(wy, wm - 1, wd);
  const txns = await db
    .select()
    .from(schema.transactions)
    .where(
      and(
        eq(schema.transactions.userId, userId),
        gte(schema.transactions.createdAt, weekStart),
      ),
    )
    .limit(10000);
  const earnedByDay = new Map<string, number>();
  for (const key of weekKeys) earnedByDay.set(key, 0);
  for (const t of txns) {
    if (!(CHECKIN_EARNING_KINDS as readonly string[]).includes(t.kind))
      continue;
    if (t.amountCents <= 0) continue;
    const key = dayKeyOf(t.createdAt);
    if (earnedByDay.has(key))
      earnedByDay.set(key, (earnedByDay.get(key) ?? 0) + t.amountCents);
  }
  const paidRows = await db
    .select()
    .from(schema.checkins)
    .where(eq(schema.checkins.userId, userId))
    .limit(1000);
  const paidByDay = new Map<string, number>();
  for (const r of paidRows) {
    if (earnedByDay.has(r.dayKey)) paidByDay.set(r.dayKey, r.amountCents);
  }
  const qualified = (key: string) =>
    (earnedByDay.get(key) ?? 0) >= goalCents;
  const runLengthAt = (dayKey: string): number => {
    let run = 0;
    let cursor = dayKey;
    while (weekKeys.includes(cursor) && qualified(cursor)) {
      run += 1;
      cursor = shiftDayKey(cursor, -1);
    }
    return run;
  };
  // Current streak = run ending at the most recent day (today if it is
  // qualified, else yesterday's run if that day qualified, else 0).
  let currentStreak = 0;
  if (qualified(todayKey)) currentStreak = runLengthAt(todayKey);
  else {
    const yesterday = shiftDayKey(todayKey, -1);
    if (weekKeys.includes(yesterday) && qualified(yesterday))
      currentStreak = runLengthAt(yesterday);
  }
  return {
    weekStartKey,
    todayKey,
    earnedByDay,
    paidByDay,
    runLengthAt,
    todayRun: runLengthAt(todayKey),
    currentStreak,
  };
}

/**
 * Pays this week's completed-but-unpaid check-in days into the balance.
 * Called right after every credit in the postback handler (so the bonus
 * lands the moment the $1 goal is crossed) and at the start of
 * getCheckin (lazy settle for any other path). Idempotent: a day pays
 * at most once, via its checkins row.
 */
async function syncWeeklyCheckin(db: DB, userId: number): Promise<void> {
  // Goal + ladder are the owner's live settings (Admin → Settings).
  const settings = await getSettings(db);
  const goalCents = checkinGoalFrom(settings);
  const rewardsCents = checkinRewardsFrom(settings);
  const state = await loadWeekCheckinState(db, userId, goalCents);
  const userRows = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  const user = userRows[0];
  if (!user) return;
  let balance = user.balanceCents;
  let totalEarned = user.totalEarnedCents;
  const statements: BatchItem<"sqlite">[] = [];
  for (let i = 0; i < 7; i++) {
    const key = shiftDayKey(state.weekStartKey, i);
    if (key > state.todayKey) break; // future days cannot be complete
    if (state.paidByDay.has(key)) continue;
    if ((state.earnedByDay.get(key) ?? 0) < goalCents)
      continue;
    // The reward is the day's own CALENDAR ladder amount (Mon index 0
    // → Sun index 6) — never a streak position.
    const reward = rewardsCents[i] ?? 0;
    if (reward <= 0) continue;
    statements.push(
      db.insert(schema.checkins).values({
        userId,
        dayKey: key,
        amountCents: reward,
      }),
    );
    statements.push(
      db.insert(schema.transactions).values({
        userId,
        kind: "checkin_bonus",
        amountCents: reward,
        note: `Weekly check-in — ${"Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday".split("|")[i] ?? "Day"} (earned $${(goalCents / 100).toFixed(2)} that day)`,
      }),
    );
    balance += reward;
    totalEarned += reward;
  }
  if (statements.length === 0) return;
  statements.push(
    db
      .update(schema.users)
      .set({ balanceCents: balance, totalEarnedCents: totalEarned })
      .where(eq(schema.users.id, userId)),
  );
  const [first, ...rest] = statements;
  if (first) await db.batch([first, ...rest]);
  await checkLevelUps(db, userId);
}

/** Daily $100 prize tiers by rank (RewardJoy-verified): sums to $100. */
const DEFAULT_DAILY_TIERS_CENTS: number[] = [
  2500, 1000, 500, 400, 300, // 1st-5th
  200, 200, 200, 200, 200, // 6th-10th
  ...Array(10).fill(100), // 11th-20th
  ...Array(30).fill(60), // 21st-50th
  ...Array(50).fill(30), // 51st-100th
];

/** Parses a comma-separated cents tier list from settings; any
 *  malformed value falls back to the built-in table. */
function parseTierList(
  raw: string | undefined,
  fallback: number[],
  maxLen: number,
): number[] {
  const parts = (raw ?? "")
    .split(",")
    .map((s) => Number.parseInt(s.trim(), 10));
  if (
    parts.length >= 1 &&
    parts.length <= maxLen &&
    parts.every((n) => Number.isFinite(n) && n >= 0 && n <= 100_000_000)
  ) {
    return parts;
  }
  return [...fallback];
}

function dailyTiersFrom(settings: Record<string, string>): number[] {
  return parseTierList(settings["daily_tiers_cents"], DEFAULT_DAILY_TIERS_CENTS, 150);
}

function affiliateTiersFrom(settings: Record<string, string>): number[] {
  return parseTierList(
    settings["affiliate_tiers_cents"],
    DEFAULT_AFFILIATE_TIERS_CENTS,
    100,
  );
}

function dailyPrizeForRank(
  rank: number,
  tiers: readonly number[] = DEFAULT_DAILY_TIERS_CENTS,
): number {
  if (rank < 1 || rank > 150) return 0;
  return tiers[rank - 1] ?? 0;
}

function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

/** Groups a tier list into display rows: consecutive ranks with the
 *  same prize collapse into one "6th–10th" style row. */
function tierSummary(
  tiers: readonly number[],
): { label: string; prizeCents: number }[] {
  const out: { label: string; prizeCents: number }[] = [];
  let start = 0;
  for (let i = 1; i <= tiers.length; i++) {
    if (i === tiers.length || tiers[i] !== tiers[start]) {
      const from = start + 1;
      const to = i;
      out.push({
        label: from === to ? ordinal(from) : `${ordinal(from)}–${ordinal(to)}`,
        prizeCents: tiers[start] ?? 0,
      });
      start = i;
    }
  }
  return out;
}

/**
 * Settles the Daily contest for a finished day using the prize tiers.
 * Entry is automatic by earning. NO money moves here (owner order
 * 2026-11-19 ~23:48 PST): the winners are only RECORDED as pending
 * contest_awards — the owner pays each prize himself from Admin →
 * Contest Payouts, and only then does the prize land in the winner's
 * balance and history. Users whose chargeback rate is above 7% are
 * excluded. Idempotent via contest_awards rows.
 */
async function settleDailyContestFor(
  db: DB,
  periodKey: string,
): Promise<{ status: "paid" | "already_settled" | "no_earners"; winnerUserId: number | null; amountCents: number }> {
  // A day that has not finished yet (today or a future day) must never
  // be settled: its standings are still changing, and writing the
  // no-earners marker now would freeze the day and hide its real winner
  // later. Legitimate callers only ever pass finished days.
  if (periodKey >= dayKeyOf(new Date())) {
    return { status: "no_earners", winnerUserId: null, amountCents: 0 };
  }
  const existing = await db
    .select()
    .from(schema.contestAwards)
    .where(eq(schema.contestAwards.periodKey, periodKey))
    .limit(1);
  if (existing[0]) {
    const top = await db
      .select()
      .from(schema.contestAwards)
      .where(
        and(
          eq(schema.contestAwards.periodKey, periodKey),
          eq(schema.contestAwards.rank, 1),
        ),
      )
      .limit(1);
    const all = await db
      .select()
      .from(schema.contestAwards)
      .where(eq(schema.contestAwards.periodKey, periodKey));
    // Self-heal the winner-summary row from the recorded rank-1 award,
    // so the leaderboard's "last winner" banner is right even if an old
    // no-earners marker row exists for this day.
    if (top[0]) {
      await db
        .insert(schema.contestPayouts)
        .values({
          contest: "daily",
          periodKey,
          winnerUserId: top[0].userId,
          amountCents: top[0].amountCents,
        })
        .onConflictDoUpdate({
          target: [schema.contestPayouts.contest, schema.contestPayouts.periodKey],
          set: {
            winnerUserId: top[0].userId,
            amountCents: top[0].amountCents,
          },
        });
    }
    return {
      status: "already_settled",
      winnerUserId: top[0]?.userId ?? null,
      amountCents: all.reduce((s, a) => s + a.amountCents, 0),
    };
  }
  // Prize tiers are the owner's live settings (Admin → Settings).
  const dailyTiers = dailyTiersFrom(await getSettings(db));
  const [y = 1970, m = 1, d = 1] = periodKey.split("-").map(Number);
  const dayStart = new Date(y, m - 1, d);
  const dayEnd = new Date(y, m - 1, d + 1);
  const txns = await db
    .select()
    .from(schema.transactions)
    .where(
      and(
        eq(schema.transactions.kind, "offer_credit"),
        gte(schema.transactions.createdAt, dayStart),
      ),
    )
    .limit(10000);
  const dayTxns = txns.filter((tx) => tx.createdAt < dayEnd);
  const byUser = new Map<number, number>();
  for (const tx of dayTxns)
    byUser.set(tx.userId, (byUser.get(tx.userId) ?? 0) + tx.amountCents);
  const ranked: { userId: number; earned: number }[] = [];
  for (const [uid, sum] of byUser) {
    if (sum <= 0) continue;
    const rate = await chargebackRatePct(db, uid);
    if (rate > 7) continue; // chargeback above 7% is excluded
    ranked.push({ userId: uid, earned: sum });
  }
  ranked.sort((a, b) => b.earned - a.earned || a.userId - b.userId);
  if (ranked.length === 0) {
    await db
      .insert(schema.contestPayouts)
      .values({
        contest: "daily",
        periodKey,
        winnerUserId: null,
        amountCents: 0,
      })
      .onConflictDoNothing();
    return { status: "no_earners", winnerUserId: null, amountCents: 0 };
  }
  const statements: BatchItem<"sqlite">[] = [];
  let total = 0;
  ranked.slice(0, 150).forEach((entry, i) => {
    const rank = i + 1;
    const prize = dailyPrizeForRank(rank, dailyTiers);
    if (prize <= 0) return;
    total += prize;
    // Recorded as PENDING — the owner pays it from Admin → Contest
    // Payouts; nothing is credited to any balance here.
    statements.push(
      db.insert(schema.contestAwards).values({
        contest: "daily",
        periodKey,
        userId: entry.userId,
        rank,
        amountCents: prize,
        status: "pending",
        releaseAt: null,
      }),
    );
  });
  statements.push(
    db
      .insert(schema.contestPayouts)
      .values({
        contest: "daily",
        periodKey,
        winnerUserId: ranked[0]?.userId ?? null,
        amountCents: dailyPrizeForRank(1, dailyTiers),
      })
      // Upsert, not do-nothing: if a no-earners marker row somehow
      // exists for this day already, the real winner must replace it —
      // the leaderboard's "last winner" banner reads this row.
      .onConflictDoUpdate({
        target: [schema.contestPayouts.contest, schema.contestPayouts.periodKey],
        set: {
          winnerUserId: ranked[0]?.userId ?? null,
          amountCents: dailyPrizeForRank(1, dailyTiers),
        },
      }),
  );
  const [first, ...rest] = statements;
  if (first) await db.batch([first, ...rest]);
  return {
    status: "paid",
    winnerUserId: ranked[0]?.userId ?? null,
    amountCents: total,
  };
}

/** Records yesterday's Daily winners (pending owner payment). Never throws. */
async function settleYesterdayIfNeeded(db: DB): Promise<void> {
  try {
    const yesterday = shiftDayKey(dayKeyOf(new Date()), -1);
    await settleDailyContestFor(db, yesterday);
  } catch {
    /* settlement must never break a page load; the schedule retries */
  }
}

// ------------------------------------------ affiliate contest (monthly)
// AFFILIATE CONTEST — MONTHLY (owner orders 2026-11-19 ~23:46 PST):
// the $1,500 Affiliate contest runs per CALENDAR month. The board
// shows, for every ranked user: how many people they brought that
// month (referral signups in the month), their Score, and the prize
// for their rank — rank 1 is the highest score, then descending.
// Score = Q + 0.2 × E + 3 × W, computed on THIS month's referrals
// only: Q = of this month's signups, those who earned at least $0.10
// this month; E = those referrals' offer earnings this month, in
// dollars, capped at $400 each; W = of this month's signups, those
// whose first approved withdrawal landed this month. When the month
// ends the board starts fresh and the finished month's winners are
// recorded as pending awards — the owner pays each prize himself
// from Admin → Contest Payouts (no automatic payout). Settlement is
// idempotent and runs lazily from getLeaderboard and from the daily
// settlement schedule.
/** Affiliate $1,500 prize tiers by rank (sums to exactly $1,500). */
const DEFAULT_AFFILIATE_TIERS_CENTS: number[] = [
  50000, 30000, 15000, 8500, 6500, // 1st–5th
  5000, 4500, 4000, 3500, 3000, // 6th–10th
  ...Array(5).fill(2000), // 11th–15th
  ...Array(5).fill(1500), // 16th–20th
  ...Array(5).fill(500), // 21st–25th
];

function affiliatePrizeForRank(
  rank: number,
  tiers: readonly number[] = DEFAULT_AFFILIATE_TIERS_CENTS,
): number {
  if (rank < 1) return 0;
  return tiers[rank - 1] ?? 0;
}

/** "YYYY-MM" for the month containing the date (server-local). */
function monthKeyOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthRange(monthKey: string): { start: Date; end: Date } {
  const [y = 1970, m = 1] = monthKey.split("-").map(Number);
  return { start: new Date(y, m - 1, 1), end: new Date(y, m, 1) };
}

function previousMonthKey(monthKey: string): string {
  const [y = 1970, m = 1] = monthKey.split("-").map(Number);
  return monthKeyOf(new Date(y, m - 2, 1));
}

interface AffiliateStandingRow {
  userId: number;
  /** People this user brought in the month (all referral signups). */
  referrals: number;
  /** Of those, how many earned at least $0.10 in the month. */
  qualifiedReferrals: number;
  score: number;
}

/** The month's Affiliate standings, best score first. */
async function computeAffiliateStandings(
  db: DB,
  monthKey: string,
): Promise<AffiliateStandingRow[]> {
  const { start, end } = monthRange(monthKey);
  const allUsers = await db.select().from(schema.users);
  const monthRefs = allUsers.filter(
    (u) => u.referredById != null && u.createdAt >= start && u.createdAt < end,
  );
  if (monthRefs.length === 0) return [];
  const monthRefIds = new Set(monthRefs.map((u) => u.id));
  const txns = await db
    .select()
    .from(schema.transactions)
    .where(
      and(
        eq(schema.transactions.kind, "offer_credit"),
        gte(schema.transactions.createdAt, start),
      ),
    )
    .limit(10000);
  const earnedInMonth = new Map<number, number>();
  for (const t of txns) {
    if (t.createdAt >= end) continue;
    if (!monthRefIds.has(t.userId)) continue;
    earnedInMonth.set(t.userId, (earnedInMonth.get(t.userId) ?? 0) + t.amountCents);
  }
  const approved = await db
    .select()
    .from(schema.withdrawals)
    .where(eq(schema.withdrawals.status, "approved"));
  const firstWithdrawalAt = new Map<number, Date>();
  for (const w of approved) {
    const at = w.decidedAt ?? w.createdAt;
    const cur = firstWithdrawalAt.get(w.userId);
    if (!cur || at < cur) firstWithdrawalAt.set(w.userId, at);
  }
  const byInviter = new Map<number, AffiliateStandingRow>();
  for (const r of monthRefs) {
    const inviterId = r.referredById;
    if (inviterId == null) continue;
    const row = byInviter.get(inviterId) ?? {
      userId: inviterId,
      referrals: 0,
      qualifiedReferrals: 0,
      score: 0,
    };
    row.referrals += 1;
    const earned = earnedInMonth.get(r.id) ?? 0;
    if (earned >= 10) {
      row.qualifiedReferrals += 1;
      row.score += 1;
    }
    row.score += 0.2 * (Math.min(40000, earned) / 100);
    const fw = firstWithdrawalAt.get(r.id);
    if (fw && fw >= start && fw < end) row.score += 3;
    byInviter.set(inviterId, row);
  }
  const rows = [...byInviter.values()]
    .map((r) => ({ ...r, score: Math.round(r.score * 100) / 100 }))
    .filter((r) => r.score > 0);
  rows.sort((a, b) => b.score - a.score || a.userId - b.userId);
  return rows;
}

/**
 * Settles a finished Affiliate month: RECORDS every winner (ranks
 * 1–25) as a pending contest award. NO money moves here — the owner
 * pays each prize himself from Admin → Contest Payouts.
 * Idempotent via the contest_payouts marker row.
 */
async function settleAffiliateMonthFor(db: DB, monthKey: string): Promise<void> {
  const marker = await db
    .select()
    .from(schema.contestPayouts)
    .where(
      and(
        eq(schema.contestPayouts.contest, "affiliate"),
        eq(schema.contestPayouts.periodKey, monthKey),
      ),
    )
    .limit(1);
  if (marker[0]) return;
  // Prize tiers are the owner's live settings (Admin → Settings).
  const affiliateTiers = affiliateTiersFrom(await getSettings(db));
  const standings = await computeAffiliateStandings(db, monthKey);
  const statements: BatchItem<"sqlite">[] = [];
  standings.slice(0, 100).forEach((row, i) => {
    const rank = i + 1;
    const prize = affiliatePrizeForRank(rank, affiliateTiers);
    if (prize <= 0) return;
    statements.push(
      db.insert(schema.contestAwards).values({
        contest: "affiliate",
        periodKey: monthKey,
        userId: row.userId,
        rank,
        amountCents: prize,
        status: "pending",
        releaseAt: null,
      }),
    );
  });
  statements.push(
    db
      .insert(schema.contestPayouts)
      .values({
        contest: "affiliate",
        periodKey: monthKey,
        winnerUserId: standings[0]?.userId ?? null,
        amountCents: standings.length > 0 ? affiliatePrizeForRank(1, affiliateTiers) : 0,
      })
      .onConflictDoNothing(),
  );
  const [first, ...rest] = statements;
  if (first) await db.batch([first, ...rest]);
}

/** Records last month's Affiliate winners (pending owner payment). Never throws. */
async function settleAffiliateMonthIfNeeded(db: DB): Promise<void> {
  try {
    await settleAffiliateMonthFor(db, previousMonthKey(monthKeyOf(new Date())));
  } catch {
    /* settlement must never break a page load; the schedule retries */
  }
}

/**
 * Pays ONE pending contest award into the winner's balance — the only
 * path that ever moves contest prize money (owner order 2026-11-19
 * ~23:48 PST: no automatic contest payout; the owner pays from Admin
 * → Contest Payouts). Marks the award paid, credits balance + total
 * earned, and writes the contest_prize ledger row the winner sees in
 * their history. Idempotent: an already-paid award pays nothing again.
 */
async function payContestAward(
  db: DB,
  award: typeof schema.contestAwards.$inferSelect,
): Promise<"paid" | "already_paid"> {
  if (award.status !== "pending") return "already_paid";
  const contestLabel = award.contest === "affiliate" ? "Affiliate" : "Daily";
  await db.batch([
    db
      .update(schema.contestAwards)
      .set({ status: "paid" })
      .where(eq(schema.contestAwards.id, award.id)),
    db
      .update(schema.users)
      .set({
        balanceCents: sql`${schema.users.balanceCents} + ${award.amountCents}`,
        totalEarnedCents: sql`${schema.users.totalEarnedCents} + ${award.amountCents}`,
      })
      .where(eq(schema.users.id, award.userId)),
    db.insert(schema.transactions).values({
      userId: award.userId,
      kind: "contest_prize",
      amountCents: award.amountCents,
      note: `${contestLabel} contest prize — rank #${award.rank} for ${award.periodKey}`,
    }),
  ]);
  await checkLevelUps(db, award.userId);
  return "paid";
}

const SURVEY_NETWORK_HINTS = ["survey", "cpx", "bitlabs", "theorem", "cherries", "prime opinion", "prime"];

function isSurveyNetwork(network: string): boolean {
  const n = network.toLowerCase();
  return SURVEY_NETWORK_HINTS.some((h) => n.includes(h));
}

// ------------------------------------------------------------- zod shapes

const userShape = z.object({
  id: z.number(),
  userCode: z.string(),
  offerToken: z.string(),
  name: z.string(),
  email: z.string(),
  pictureUrl: z.string().nullable(),
  loginMethod: z.string(),
  // No `ip` and no country fields in the user-facing shape: IP and
  // country are admin-only (adminListUsers extends this shape with
  // them for the owner). The country still drives methods, content
  // and rules server-side from the user row.
  balanceCents: z.number(),
  totalEarnedCents: z.number(),
  level: z.number(),
  title: z.string().nullable(),
  theme: z.string(),
  referralCode: z.string(),
  blocked: z.boolean(),
  createdAt: z.string(),
});

const contentShape = z.object({
  id: z.number(),
  kind: z.enum(["offerwall", "survey", "game"]),
  title: z.string(),
  provider: z.string(),
  description: z.string(),
  rewardCents: z.number().nullable(),
  url: z.string(),
  imageUrl: z.string().nullable(),
  countries: z.string(),
  featured: z.boolean(),
  active: z.boolean(),
  sortOrder: z.number(),
  createdAt: z.string(),
});

function publicContent(row: typeof schema.contentItems.$inferSelect) {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    provider: row.provider,
    description: row.description,
    rewardCents: row.rewardCents ?? null,
    url: row.url,
    imageUrl: row.imageUrl ?? null,
    countries: row.countries,
    featured: row.featured === 1,
    active: row.active === 1,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Personalises a partner URL for one signed-in user: `{user_id}` becomes
 * the user's OWN Offer Token (the OT-… ID on their Profile — this is the
 * ID partners send back in their postback/callback, so it is how a
 * completed offer finds its user) and `{transaction_id}` becomes a
 * fresh unique ID for this view/click. URLs without placeholders are
 * returned unchanged.
 */
function personalizeContentUrl(url: string, user: UserRow): string {
  if (!url) return url;
  let out = url;
  if (out.includes("{user_id}")) {
    out = out
      .split("{user_id}")
      .join(encodeURIComponent(user.offerToken ?? user.userCode));
  }
  if (out.includes("{transaction_id}")) {
    out = out.split("{transaction_id}").join(newToken("txn"));
  }
  return out;
}

/**
 * TheoremReach signature: base64url( HMAC-SHA1(secret_key, url_string) )
 * over the RAW binary digest — the scheme in TheoremReach's docs
 * (theoremreach.com/docs/web + /docs/surveys_api). The url_string is the
 * full callback URL exactly as TheoremReach called it, minus the
 * trailing `&hash=…` they append.
 */
async function theoremReachSignature(
  secret: string,
  urlString: string,
): Promise<string> {
  const enc = new TextEncoder();
  const key = await globalThis.crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const raw = new Uint8Array(
    await globalThis.crypto.subtle.sign("HMAC", key, enc.encode(urlString)),
  );
  let bin = "";
  for (const b of raw) bin += String.fromCharCode(b);
  return btoa(bin).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

/**
 * The one reward-credit path, shared by the generic offerwall postback
 * and the TheoremReach callback: inserts the postback log row (its
 * unique txn_id is what makes a second call a duplicate — callers check
 * for an existing row BEFORE calling this), credits the user their
 * share (user_share_pct, default 70%) of the payout, writes the ledger
 * row, pays the referrer's earning commission, then settles level-ups
 * and the weekly check-in for both. Returns the credited cents.
 */
async function applyRewardCredit(
  db: DB,
  settings: Record<string, string>,
  user: UserRow,
  opts: {
    network: string;
    txnId: string;
    payout: number;
    note: string;
    rawJson: string;
  },
): Promise<number> {
  const sharePct = settingInt(settings, "user_share_pct") || 70;
  const creditedCents = Math.round(opts.payout * 100 * (sharePct / 100));
  const statements: BatchItem<"sqlite">[] = [
    db.insert(schema.postbacks).values({
      txnId: opts.txnId,
      network: opts.network,
      userId: user.id,
      payout: opts.payout,
      creditedCents,
      status: "credited",
      rawJson: opts.rawJson,
    }),
    db
      .update(schema.users)
      .set({
        balanceCents: user.balanceCents + creditedCents,
        totalEarnedCents: user.totalEarnedCents + creditedCents,
      })
      .where(eq(schema.users.id, user.id)),
    db.insert(schema.transactions).values({
      userId: user.id,
      kind: "offer_credit",
      amountCents: creditedCents,
      note: opts.note,
    }),
  ];
  if (user.referredById != null && creditedCents > 0) {
    const pct = settingInt(settings, "affiliate_earning_pct");
    const commission = Math.round(creditedCents * (pct / 100));
    if (commission > 0) {
      const referrers = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, user.referredById))
        .limit(1);
      const referrer = referrers[0];
      if (referrer) {
        statements.push(
          db
            .update(schema.users)
            .set({
              balanceCents: referrer.balanceCents + commission,
              totalEarnedCents: referrer.totalEarnedCents + commission,
            })
            .where(eq(schema.users.id, referrer.id)),
          db.insert(schema.transactions).values({
            userId: referrer.id,
            kind: "affiliate_earning",
            amountCents: commission,
            note: `Referral earning commission from ${user.name}`,
            refId: user.id,
          }),
        );
      }
    }
  }
  const [first, ...rest] = statements;
  if (first) await db.batch([first, ...rest]);
  // Level-ups are real: pay any level rewards this credit unlocked,
  // for the earner and for their referrer (commission counts too).
  await checkLevelUps(db, user.id);
  if (user.referredById != null) await checkLevelUps(db, user.referredById);
  // Weekly check-in: this credit may have crossed someone's $1 daily
  // goal — if so, that day's check-in bonus lands right now.
  await syncWeeklyCheckin(db, user.id);
  if (user.referredById != null) await syncWeeklyCheckin(db, user.referredById);
  return creditedCents;
}

function visibleInCountry(countries: string, countryCode: string | null): boolean {
  const list = countries
    .split(",")
    .map((c) => c.trim().toUpperCase())
    .filter(Boolean);
  if (list.length === 0 || list.includes("ALL")) return true;
  if (!countryCode) return false;
  return list.includes(countryCode.toUpperCase());
}

const withdrawalShape = z.object({
  id: z.number(),
  userId: z.number(),
  amountCents: z.number(),
  method: z.string(),
  methodLabel: z.string(),
  details: z.record(z.string(), z.string()),
  status: z.enum(["pending", "approved", "rejected"]),
  adminNote: z.string(),
  createdAt: z.string(),
  decidedAt: z.string().nullable(),
});

function publicWithdrawal(
  row: typeof schema.withdrawals.$inferSelect,
  customLabels?: Map<string, string>,
) {
  let details: Record<string, string> = {};
  try {
    const parsed: unknown = JSON.parse(row.detailsJson);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      details = Object.fromEntries(
        Object.entries(parsed as Record<string, unknown>).map(([k, v]) => [
          k,
          String(v),
        ]),
      );
    }
  } catch {
    details = {};
  }
  return {
    id: row.id,
    userId: row.userId,
    amountCents: row.amountCents,
    method: row.method,
    methodLabel:
      METHODS[row.method]?.label ?? customLabels?.get(row.method) ?? row.method,
    details,
    status: row.status,
    adminNote: row.adminNote,
    createdAt: row.createdAt.toISOString(),
    decidedAt: row.decidedAt ? row.decidedAt.toISOString() : null,
  };
}

const signInResponse = z.object({
  status: z.enum(["ok", "vpn_blocked", "blocked", "country_banned"]),
  token: z.string().nullable(),
  user: userShape.nullable(),
  // No banned-country name/code/flag fields: no country is ever sent
  // to the user's client, even on the country-banned sign-in screen.
});
type SignInResult = z.infer<typeof signInResponse>;

function flagFromCountryCode(code: string | null | undefined): string | null {
  if (!code || code.length !== 2) return null;
  const upper = code.toUpperCase();
  const a = upper.codePointAt(0);
  const b = upper.codePointAt(1);
  if (a == null || b == null) return null;
  return String.fromCodePoint(127397 + a, 127397 + b);
}

async function findBannedCountry(
  db: DB,
  countryCode: string | null,
): Promise<typeof schema.bannedCountries.$inferSelect | null> {
  if (!countryCode) return null;
  const rows = await db
    .select()
    .from(schema.bannedCountries)
    .where(eq(schema.bannedCountries.countryCode, countryCode.toUpperCase()))
    .limit(1);
  return rows[0] ?? null;
}

// ------------------------------------------------------------------ actions

export const Actions = {
  getPublicHome: defineAction({
    description:
      "Public landing data: Google client id, featured games, priced items for all three sections (offerwalls, surveys, games), section counts, contest pools, recent approved payouts.",
    request: z.object({}),
    response: z.object({
      googleClientId: z.string(),
      featuredGames: z.array(contentShape),
      offerwalls: z.array(contentShape),
      surveys: z.array(contentShape),
      games: z.array(contentShape),
      counts: z.object({
        offerwalls: z.number(),
        surveys: z.number(),
        games: z.number(),
      }),
      dailyPoolCents: z.number(),
      affiliatePoolCents: z.number(),
      minWithdrawCents: z.number(),
      socialLinks: z.array(
        z.object({ platform: z.string(), label: z.string(), url: z.string() }),
      ),
      recentPayouts: z.array(
        z.object({
          name: z.string(),
          amountCents: z.number(),
          methodLabel: z.string(),
          decidedAt: z.string().nullable(),
        }),
      ),
    }),
    async handler(ctx) {
      const db = ctx.db<typeof schema>();
      const settings = await getSettings(db);
      const items = await db
        .select()
        .from(schema.contentItems)
        .where(eq(schema.contentItems.active, 1));
      const payouts = await db
        .select({
          amountCents: schema.withdrawals.amountCents,
          method: schema.withdrawals.method,
          decidedAt: schema.withdrawals.decidedAt,
          name: schema.users.name,
        })
        .from(schema.withdrawals)
        .innerJoin(schema.users, eq(schema.withdrawals.userId, schema.users.id))
        .where(eq(schema.withdrawals.status, "approved"))
        .orderBy(desc(schema.withdrawals.id))
        .limit(5);
      const customLabels = await customMethodLabels(db);
      return {
        googleClientId: settings["google_client_id"] ?? "",
        featuredGames: items
          .filter((i) => i.kind === "game" && i.featured === 1)
          .sort((a, b) => a.sortOrder - b.sortOrder || b.id - a.id)
          .map(publicContent),
        offerwalls: items
          .filter((i) => i.kind === "offerwall")
          .sort((a, b) => a.sortOrder - b.sortOrder || b.id - a.id)
          .slice(0, 6)
          .map(publicContent),
        surveys: items
          .filter((i) => i.kind === "survey")
          .sort((a, b) => a.sortOrder - b.sortOrder || b.id - a.id)
          .slice(0, 6)
          .map(publicContent),
        games: items
          .filter((i) => i.kind === "game")
          .sort((a, b) => a.sortOrder - b.sortOrder || b.id - a.id)
          .slice(0, 6)
          .map(publicContent),
        counts: {
          offerwalls: items.filter((i) => i.kind === "offerwall").length,
          surveys: items.filter((i) => i.kind === "survey").length,
          games: items.filter((i) => i.kind === "game").length,
        },
        dailyPoolCents: settingInt(settings, "daily_pool_cents"),
        affiliatePoolCents: settingInt(settings, "affiliate_pool_cents"),
        minWithdrawCents: settingInt(settings, "min_withdraw_cents"),
        socialLinks: socialLinksFrom(settings),
        recentPayouts: payouts.map((p) => ({
          name: p.name.split(" ")[0] ?? p.name,
          amountCents: p.amountCents,
          methodLabel: METHODS[p.method]?.label ?? customLabels.get(p.method) ?? p.method,
          decidedAt: p.decidedAt ? p.decidedAt.toISOString() : null,
        })),
      };
    },
  }),

  detectNetwork: defineAction({
    description:
      "Detects the caller's IP, country, flag, VPN suspicion and whether new signups from that country are banned (no account needed).",
    request: z.object({ ip: z.string().max(64).optional() }),
    response: z.object({
      ip: z.string().nullable(),
      countryCode: z.string().nullable(),
      countryName: z.string().nullable(),
      flagEmoji: z.string().nullable(),
      vpnSuspected: z.boolean(),
      countryBanned: z.boolean(),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const geo = await lookupGeo(args.ip?.trim() ? args.ip.trim() : null);
      const banned = await findBannedCountry(db, geo.countryCode);
      return {
        ip: geo.ip,
        countryCode: geo.countryCode,
        countryName: geo.countryName,
        flagEmoji: geo.flagEmoji,
        vpnSuspected: geo.vpnSuspected,
        countryBanned: banned != null,
      };
    },
  }),

  signInWithGoogle: defineAction({
    description:
      "Signs a user in or up with Google ONLY (verified ID token from the real Google button — no email or password form exists), locks country from the login IP, blocks VPN, blocked accounts and new signups from banned countries, captures referral codes, and notifies the admin on every new registration.",
    request: z.object({
      idToken: z.string().min(1).max(4096),
      ip: z.string().max(64).optional(),
      referralCode: z.string().trim().max(32).optional(),
    }),
    response: signInResponse,
    async handler(ctx, args): Promise<SignInResult> {
      const db = ctx.db<typeof schema>();
      const settings = await getSettings(db);

      let email: string | undefined;
      let name: string | undefined;
      let pictureUrl: string | undefined;

      if (args.idToken) {
        const res = await fetch("https://oauth2.googleapis.com/tokeninfo", {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ id_token: args.idToken }),
          signal: AbortSignal.timeout(6000),
        });
        if (!res.ok)
          throw new Error("Google sign-in could not be verified. Try again.");
        const info = (await res.json()) as {
          email?: string;
          name?: string;
          picture?: string;
          aud?: string;
          email_verified?: string;
        };
        const expectedAud = settings["google_client_id"] ?? "";
        if (expectedAud && info.aud && info.aud !== expectedAud)
          throw new Error("Google sign-in could not be verified. Try again.");
        if (!info.email)
          throw new Error("Google did not return an email address.");
        email = info.email.toLowerCase();
        name = info.name ?? name;
        pictureUrl = info.picture ?? pictureUrl;
      }
      if (!email) throw new Error("Google sign-in could not be verified. Try again.");
      if (!name) name = email.split("@")[0] ?? "TapOne User";

      const geo = await lookupGeo(args.ip?.trim() ? args.ip.trim() : null);
      // VPN = direct ban at login: checked BEFORE any account lookup,
      // creation or session issuance, so a VPN user — new or existing —
      // gets no login at all. The client shows the "You use VPN" block.
      if (geo.vpnSuspected) {
        return { status: "vpn_blocked", token: null, user: null };
      }

      const existing = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.email, email))
        .limit(1);
      let user = existing[0];

      if (user && user.blocked === 1) {
        return { status: "blocked", token: null, user: null };
      }

      if (!user) {
        const banned = await findBannedCountry(db, geo.countryCode);
        if (banned) {
          // The ban is enforced here server-side; WHICH country is
          // banned is not sent back — the client shows a generic
          // "not available" message with no country named.
          return { status: "country_banned", token: null, user: null };
        }
        let referredById: number | null = null;
        if (args.referralCode) {
          const referrers = await db
            .select()
            .from(schema.users)
            .where(
              eq(
                schema.users.referralCode,
                args.referralCode.trim().toUpperCase(),
              ),
            )
            .limit(1);
          if (referrers[0]) referredById = referrers[0].id;
        }
        let userCode = `TO-${randomCode(6)}`;
        for (let attempt = 0; attempt < 5; attempt++) {
          const clash = await db
            .select()
            .from(schema.users)
            .where(eq(schema.users.userCode, userCode))
            .limit(1);
          if (!clash[0]) break;
          userCode = `TO-${randomCode(6)}`;
        }
        const inserted = await db
          .insert(schema.users)
          .values({
            userCode,
            name,
            email,
            pictureUrl: pictureUrl ?? null,
            loginMethod: "google",
            ip: geo.ip,
            countryCode: geo.countryCode,
            countryName: geo.countryName,
            flagEmoji: geo.flagEmoji,
            isp: geo.isp,
            referralCode: randomCode(8),
            offerToken: await uniqueOfferToken(db),
            referredById,
          })
          .returning();
        user = inserted[0];
        if (!user) throw new Error("Could not create your account.");
        // Registration alert for the owner — stored on the server so it
        // shows in the admin Notifications / Inbox for every new account.
        await db.insert(schema.adminNotifications).values({
          type: "registration",
          userId: user.id,
          userName: user.name,
          userEmail: user.email,
          userCode: user.userCode,
          countryCode: user.countryCode,
          countryName: user.countryName,
          flagEmoji: user.flagEmoji ?? flagFromCountryCode(user.countryCode),
          ip: user.ip,
          read: 0,
        });
      } else {
        await db
          .update(schema.users)
          .set({
            name,
            pictureUrl: pictureUrl ?? user.pictureUrl,
            ip: geo.ip ?? user.ip,
            countryCode: geo.countryCode ?? user.countryCode,
            countryName: geo.countryName ?? user.countryName,
            flagEmoji: geo.flagEmoji ?? user.flagEmoji,
            isp: geo.isp ?? user.isp,
            lastSeenAt: new Date(),
          })
          .where(eq(schema.users.id, user.id));
        const refreshed = await db
          .select()
          .from(schema.users)
          .where(eq(schema.users.id, user.id))
          .limit(1);
        user = refreshed[0] ?? user;
      }

      const token = newToken("sess");
      await db.insert(schema.sessions).values({ token, userId: user.id });
      ctx.invalidateQueries();
      return {
        status: "ok",
        token,
        user: publicUser(user, levelConfigFrom(settings).titles),
      };
    },
  }),

  getMe: defineAction({
    description: "Returns the signed-in user's profile, balance and unread mailbox count.",
    request: z.object({ token: z.string().min(1).max(200) }),
    response: z.object({
      user: userShape,
      unreadMessages: z.number(),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const user = await requireUser(ctx, args.token);
      const unread = await db
        .select()
        .from(schema.messages)
        .where(
          and(
            eq(schema.messages.userId, user.id),
            eq(schema.messages.sender, "admin"),
            eq(schema.messages.readByUser, 0),
          ),
        );
      const settings = await getSettings(db);
      return {
        user: publicUser(user, levelConfigFrom(settings).titles),
        unreadMessages: unread.length,
      };
    },
  }),

  signOut: defineAction({
    description: "Ends the current session.",
    request: z.object({ token: z.string().min(1).max(200) }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const db = ctx.db<typeof schema>();
      await db
        .delete(schema.sessions)
        .where(eq(schema.sessions.token, args.token));
      return { ok: true };
    },
  }),

  listContent: defineAction({
    description:
      "Lists active offerwalls, surveys or games visible in the signed-in user's country (all active items when signed out). For a signed-in user, partner URLs are personalised: {user_id} is replaced with the user's Offer Token and {transaction_id} with a fresh unique ID.",
    request: z.object({
      token: z.string().max(200).optional(),
      kind: z.enum(["offerwall", "survey", "game"]),
    }),
    response: z.object({ items: z.array(contentShape) }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      let countryCode: string | null = null;
      let viewer: UserRow | null = null;
      if (args.token) {
        try {
          viewer = await requireUser(ctx, args.token);
          countryCode = viewer.countryCode;
        } catch {
          countryCode = null;
          viewer = null;
        }
      }
      const rows = await db
        .select()
        .from(schema.contentItems)
        .where(
          and(
            eq(schema.contentItems.kind, args.kind),
            eq(schema.contentItems.active, 1),
          ),
        )
        .orderBy(schema.contentItems.sortOrder, desc(schema.contentItems.id));
      return {
        items: rows
          .filter((r) => visibleInCountry(r.countries, countryCode))
          .map((r) => {
            const item = publicContent(r);
            // Signed-in users get a personal link: {user_id} → their
            // Offer Token, {transaction_id} → a fresh unique ID, so a
            // completed offer/survey can be credited back to them.
            if (viewer) item.url = personalizeContentUrl(item.url, viewer);
            return item;
          }),
      };
    },
  }),

  getDashboard: defineAction({
    description:
      "Dashboard summary for the signed-in user: balance, totals, recent activity, pending withdrawals.",
    request: z.object({ token: z.string().min(1).max(200) }),
    response: z.object({
      user: userShape,
      pendingWithdrawals: z.number(),
      referralCount: z.number(),
      affiliateEarnedCents: z.number(),
      recent: z.array(
        z.object({
          id: z.number(),
          kind: z.string(),
          amountCents: z.number(),
          note: z.string(),
          createdAt: z.string(),
        }),
      ),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const user = await requireUser(ctx, args.token);
      const pending = await db
        .select()
        .from(schema.withdrawals)
        .where(
          and(
            eq(schema.withdrawals.userId, user.id),
            eq(schema.withdrawals.status, "pending"),
          ),
        );
      const referrals = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.referredById, user.id));
      const txns = await db
        .select()
        .from(schema.transactions)
        .where(eq(schema.transactions.userId, user.id))
        .orderBy(desc(schema.transactions.id))
        .limit(8);
      const affiliateEarned = txns
        .filter((t) => t.kind === "affiliate_earning")
        .reduce((sum, t) => sum + t.amountCents, 0);
      const allAffiliate = await db
        .select()
        .from(schema.transactions)
        .where(
          and(
            eq(schema.transactions.userId, user.id),
            eq(schema.transactions.kind, "affiliate_earning"),
          ),
        );
      const dashSettings = await getSettings(db);
      return {
        user: publicUser(user, levelConfigFrom(dashSettings).titles),
        pendingWithdrawals: pending.length,
        referralCount: referrals.length,
        affiliateEarnedCents:
          allAffiliate.reduce((sum, t) => sum + t.amountCents, 0) ||
          affiliateEarned,
        recent: txns.map((t) => ({
          id: t.id,
          kind: t.kind,
          amountCents: t.amountCents,
          note: t.note,
          createdAt: t.createdAt.toISOString(),
        })),
      };
    },
  }),

  getWithdrawInfo: defineAction({
    description:
      "Withdraw methods for the user's locked country — the built-in methods for that country plus any extra methods the owner added for it in the admin panel (chosen server-side; the country itself is never sent to the user's client) — the minimum withdrawal, balance, and the user's own withdrawal requests.",
    request: z.object({ token: z.string().min(1).max(200) }),
    response: z.object({
      balanceCents: z.number(),
      minWithdrawCents: z.number(),
      methods: z.array(
        z.object({
          id: z.string(),
          label: z.string(),
          imageUrl: z.string().nullable(),
          fields: z.array(z.object({ key: z.string(), label: z.string() })),
        }),
      ),
      withdrawals: z.array(withdrawalShape),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const settings = await getSettings(db);
      const user = await requireUser(ctx, args.token);
      const rows = await db
        .select()
        .from(schema.withdrawals)
        .where(eq(schema.withdrawals.userId, user.id))
        .orderBy(desc(schema.withdrawals.id))
        .limit(50);
      const customLabels = await customMethodLabels(db);
      return {
        balanceCents: user.balanceCents,
        minWithdrawCents: settingInt(settings, "min_withdraw_cents"),
        methods: await methodsForCountryWithCustom(db, user.countryCode),
        withdrawals: rows.map((r) => publicWithdrawal(r, customLabels)),
      };
    },
  }),

  requestWithdrawal: defineAction({
    description:
      "Creates a withdrawal request: validates the method against the user's country, holds the amount from the balance, and sends it to the admin queue.",
    request: z.object({
      token: z.string().min(1).max(200),
      amountCents: z.number().int().positive().max(100_000_000),
      method: z.string().min(1).max(40),
      details: z.record(z.string().max(60), z.string().trim().min(1).max(200)),
    }),
    response: z.object({ withdrawal: withdrawalShape }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const settings = await getSettings(db);
      const user = await requireUser(ctx, args.token);
      const min = settingInt(settings, "min_withdraw_cents");
      if (args.amountCents < min)
        throw new Error(
          `Minimum withdrawal is $${(min / 100).toFixed(2)}.`,
        );
      if (args.amountCents > user.balanceCents)
        throw new Error("Amount is more than your available balance.");
      const allowed = await methodsForCountryWithCustom(db, user.countryCode);
      const method = allowed.find((m) => m.id === args.method);
      if (!method)
        throw new Error("That payment method is not available for your account.");
      for (const field of method.fields) {
        if (!args.details[field.key]?.trim())
          throw new Error(`Please fill in: ${field.label}.`);
      }
      const statements: BatchItem<"sqlite">[] = [
        db
          .update(schema.users)
          .set({ balanceCents: user.balanceCents - args.amountCents })
          .where(eq(schema.users.id, user.id)),
        db.insert(schema.withdrawals).values({
          userId: user.id,
          amountCents: args.amountCents,
          method: method.id,
          detailsJson: JSON.stringify(args.details),
          status: "pending",
        }),
        db.insert(schema.transactions).values({
          userId: user.id,
          kind: "withdrawal_hold",
          amountCents: -args.amountCents,
          note: `Withdrawal requested via ${method.label}`,
        }),
      ];
      const [first, ...rest] = statements;
      if (first) await db.batch([first, ...rest]);
      const rows = await db
        .select()
        .from(schema.withdrawals)
        .where(eq(schema.withdrawals.userId, user.id))
        .orderBy(desc(schema.withdrawals.id))
        .limit(1);
      const created = rows[0];
      if (!created) throw new Error("Withdrawal could not be saved.");
      ctx.invalidateQueries();
      return { withdrawal: publicWithdrawal(created, await customMethodLabels(db)) };
    },
  }),

  getHistory: defineAction({
    description: "The signed-in user's full money history: earnings, commissions, withdrawal holds and refunds.",
    request: z.object({
      token: z.string().min(1).max(200),
      limit: z.number().int().positive().max(100).default(50),
    }),
    response: z.object({
      entries: z.array(
        z.object({
          id: z.number(),
          kind: z.string(),
          amountCents: z.number(),
          note: z.string(),
          createdAt: z.string(),
        }),
      ),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const user = await requireUser(ctx, args.token);
      const rows = await db
        .select()
        .from(schema.transactions)
        .where(eq(schema.transactions.userId, user.id))
        .orderBy(desc(schema.transactions.id))
        .limit(args.limit);
      return {
        entries: rows.map((t) => ({
          id: t.id,
          kind: t.kind,
          amountCents: t.amountCents,
          note: t.note,
          createdAt: t.createdAt.toISOString(),
        })),
      };
    },
  }),

  getLeaderboard: defineAction({
    description:
      "Daily contest (today's offer earnings) and Affiliate contest leaderboards. The Affiliate contest is MONTHLY: standings cover the current calendar month only — for every ranked user, how many people they brought this month, their score (highest first) and the prize for their rank — plus the exact moment the month ends (for the live countdown) and last month's winner. Opening this board records yesterday's Daily winners and last month's Affiliate winners (as pending awards the owner pays from the admin panel) if they are due.",
    request: z.object({ token: z.string().max(200).optional() }),
    response: z.object({
      dailyPoolCents: z.number(),
      affiliatePoolCents: z.number(),
      affiliateMonthKey: z.string(),
      affiliateEndsAt: z.string(),
      lastDailyPayout: z
        .object({
          periodKey: z.string(),
          winnerName: z.string(),
          amountCents: z.number(),
        })
        .nullable(),
      lastAffiliatePayout: z
        .object({
          periodKey: z.string(),
          winnerName: z.string(),
          amountCents: z.number(),
        })
        .nullable(),
      dailyTiers: z.array(
        z.object({ label: z.string(), prizeCents: z.number() }),
      ),
      affiliateTiers: z.array(
        z.object({ label: z.string(), prizeCents: z.number() }),
      ),
      affiliateStandings: z.array(
        z.object({
          rank: z.number(),
          name: z.string(),
          referrals: z.number(),
          qualifiedReferrals: z.number(),
          score: z.number(),
          prizeCents: z.number(),
        }),
      ),
      daily: z.array(
        z.object({
          rank: z.number(),
          name: z.string(),
          earnedCents: z.number(),
        }),
      ),
    }),
    async handler(ctx) {
      const db = ctx.db<typeof schema>();
      await settleYesterdayIfNeeded(db);
      await settleAffiliateMonthIfNeeded(db);
      const settings = await getSettings(db);
      const dayStart = new Date();
      dayStart.setHours(0, 0, 0, 0);
      const todays = await db
        .select()
        .from(schema.transactions)
        .where(
          and(
            eq(schema.transactions.kind, "offer_credit"),
            gte(schema.transactions.createdAt, dayStart),
          ),
        )
        .limit(5000);
      const allUsers = await db.select().from(schema.users);
      const userById = new Map(allUsers.map((u) => [u.id, u]));
      const dailyMap = new Map<number, number>();
      for (const t of todays)
        dailyMap.set(t.userId, (dailyMap.get(t.userId) ?? 0) + t.amountCents);
      const daily = [...dailyMap.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 100)
        .map(([userId, earned], i) => ({
          rank: i + 1,
          name: userById.get(userId)?.name ?? "User",
          earnedCents: earned,
        }));
      // Affiliate contest: THIS calendar month's standings only — a
      // fresh board every month. Rank 1 is the highest score.
      const currentMonth = monthKeyOf(new Date());
      const monthStandings = await computeAffiliateStandings(db, currentMonth);
      const affiliateTiers = affiliateTiersFrom(settings);
      const affiliateStandings = monthStandings.slice(0, 100).map((row, i) => ({
        rank: i + 1,
        name: userById.get(row.userId)?.name ?? "User",
        referrals: row.referrals,
        qualifiedReferrals: row.qualifiedReferrals,
        score: row.score,
        prizeCents: affiliatePrizeForRank(i + 1, affiliateTiers),
      }));
      const payoutRows = await db
        .select()
        .from(schema.contestPayouts)
        .orderBy(desc(schema.contestPayouts.id))
        .limit(20);
      const lastPaidDaily = payoutRows.find(
        (r) => r.contest === "daily" && r.winnerUserId != null && r.amountCents > 0,
      );
      const lastDailyPayout = lastPaidDaily
        ? {
            periodKey: lastPaidDaily.periodKey,
            winnerName: userById.get(lastPaidDaily.winnerUserId ?? -1)?.name ?? "Winner",
            amountCents: lastPaidDaily.amountCents,
          }
        : null;
      const lastPaidAffiliate = payoutRows.find(
        (r) => r.contest === "affiliate" && r.winnerUserId != null && r.amountCents > 0,
      );
      const lastAffiliatePayout = lastPaidAffiliate
        ? {
            periodKey: lastPaidAffiliate.periodKey,
            winnerName: userById.get(lastPaidAffiliate.winnerUserId ?? -1)?.name ?? "Winner",
            amountCents: lastPaidAffiliate.amountCents,
          }
        : null;
      return {
        dailyPoolCents: settingInt(settings, "daily_pool_cents"),
        affiliatePoolCents: settingInt(settings, "affiliate_pool_cents"),
        affiliateMonthKey: currentMonth,
        affiliateEndsAt: monthRange(currentMonth).end.toISOString(),
        lastDailyPayout,
        lastAffiliatePayout,
        // Prize tables shown to users are derived from the owner's
        // live tier settings, so an admin edit shows here at once.
        dailyTiers: tierSummary(dailyTiersFrom(settings)),
        affiliateTiers: tierSummary(affiliateTiers),
        affiliateStandings,
        daily,
      };
    },
  }),

  getAffiliate: defineAction({
    description:
      "The user's referral code, commission rates (8% earning / 5% spending), and the COMPLETE referral table: every user who signed up with this user's invite link (no limit, nothing hidden), each with their name, signup date, their own total earnings, and the total commission this user earned from that referral.",
    request: z.object({ token: z.string().min(1).max(200) }),
    response: z.object({
      referralCode: z.string(),
      earningPct: z.number(),
      spendingPct: z.number(),
      totalCommissionCents: z.number(),
      referrals: z.array(
        z.object({
          name: z.string(),
          joinedAt: z.string(),
          totalEarnedCents: z.number(),
          earnedForYouCents: z.number(),
        }),
      ),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const settings = await getSettings(db);
      const user = await requireUser(ctx, args.token);
      // EVERY signup made with this user's invite link — no limit and
      // no filtering: the inviter sees all of them.
      const refs = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.referredById, user.id))
        .orderBy(desc(schema.users.id));
      // All commission this user has ever received, of both kinds
      // (earning + spending), attributed per referral via refId.
      const myTxns = await db
        .select()
        .from(schema.transactions)
        .where(eq(schema.transactions.userId, user.id))
        .limit(10000);
      const commissions = myTxns.filter(
        (t) =>
          t.kind === "affiliate_earning" || t.kind === "affiliate_spending",
      );
      const perRef = new Map<number, number>();
      for (const t of commissions) {
        if (t.refId != null)
          perRef.set(t.refId, (perRef.get(t.refId) ?? 0) + t.amountCents);
      }
      return {
        referralCode: user.referralCode,
        earningPct: settingInt(settings, "affiliate_earning_pct"),
        spendingPct: settingInt(settings, "affiliate_spending_pct"),
        totalCommissionCents: commissions.reduce(
          (sum, t) => sum + t.amountCents,
          0,
        ),
        referrals: refs.map((r) => ({
          name: r.name,
          joinedAt: r.createdAt.toISOString(),
          totalEarnedCents: r.totalEarnedCents,
          earnedForYouCents: perRef.get(r.id) ?? 0,
        })),
      };
    },
  }),

  sendHelpMessage: defineAction({
    description: "Sends a help message from the signed-in user to the admin inbox.",
    request: z.object({
      token: z.string().min(1).max(200),
      subject: z.string().trim().max(120).default(""),
      body: z.string().trim().min(1).max(2000),
    }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const db = ctx.db<typeof schema>();
      const user = await requireUser(ctx, args.token);
      await db.insert(schema.messages).values({
        userId: user.id,
        sender: "user",
        subject: args.subject,
        body: args.body,
        readByAdmin: 0,
        readByUser: 1,
      });
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  getMailbox: defineAction({
    description: "The signed-in user's help thread with admin replies; marks admin replies as read.",
    request: z.object({ token: z.string().min(1).max(200) }),
    response: z.object({
      messages: z.array(
        z.object({
          id: z.number(),
          sender: z.enum(["user", "admin"]),
          subject: z.string(),
          body: z.string(),
          createdAt: z.string(),
        }),
      ),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const user = await requireUser(ctx, args.token);
      const rows = await db
        .select()
        .from(schema.messages)
        .where(eq(schema.messages.userId, user.id))
        .orderBy(schema.messages.id)
        .limit(200);
      await db
        .update(schema.messages)
        .set({ readByUser: 1 })
        .where(
          and(
            eq(schema.messages.userId, user.id),
            eq(schema.messages.sender, "admin"),
          ),
        );
      return {
        messages: rows.map((m) => ({
          id: m.id,
          sender: m.sender,
          subject: m.subject,
          body: m.body,
          createdAt: m.createdAt.toISOString(),
        })),
      };
    },
  }),

  getCheckin: defineAction({
    description:
      "Weekly check-in state (Monday–Sunday, M T W T F S S): settles any completed day first, then returns each day's earnings toward the daily goal, completion, that calendar day's own ladder reward, the current streak and the week's schedule. The goal and the 7 day amounts are the owner's settings (Admin → Settings → Money; defaults $1 goal, Mon $0.20 … Sun $0.70). There is no claim action — a day completes automatically when the user earns the goal amount that day from offers, surveys or invite commissions, and its bonus is credited at that moment. Rewards follow the calendar weekday, never a streak position.",
    request: z.object({ token: z.string().min(1).max(200) }),
    response: z.object({
      goalCents: z.number(),
      scheduleCents: z.array(z.number()),
      weekTotalCents: z.number(),
      currentStreak: z.number(),
      todayEarnedCents: z.number(),
      todayCompleted: z.boolean(),
      todayRewardCents: z.number(),
      weekBonusCents: z.number(),
      totalCheckinCents: z.number(),
      days: z.array(
        z.object({
          dayKey: z.string(),
          label: z.string(),
          isToday: z.boolean(),
          isPast: z.boolean(),
          earnedCents: z.number(),
          completed: z.boolean(),
          missed: z.boolean(),
          rewardCents: z.number(),
          paidCents: z.number().nullable(),
        }),
      ),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const user = await requireUser(ctx, args.token);
      const settings = await getSettings(db);
      const goalCents = checkinGoalFrom(settings);
      const rewardsCents = checkinRewardsFrom(settings);
      // Settle first: any day that crossed the goal gets its bonus now.
      await syncWeeklyCheckin(db, user.id);
      const state = await loadWeekCheckinState(db, user.id, goalCents);
      const allRows = await db
        .select()
        .from(schema.checkins)
        .where(eq(schema.checkins.userId, user.id))
        .limit(1000);
      const days = Array.from({ length: 7 }, (_, i) => {
        const key = shiftDayKey(state.weekStartKey, i);
        const earned = state.earnedByDay.get(key) ?? 0;
        const paid = state.paidByDay.get(key) ?? null;
        const isToday = key === state.todayKey;
        const isPast = key < state.todayKey;
        // Display reward: what was paid, else that calendar day's own
        // ladder amount (index i = Mon 0 … Sun 6). Never a streak
        // position — Friday shows $0.50 even after a missed day.
        return {
          dayKey: key,
          label: WEEKDAY_LABELS[i] ?? "M",
          isToday,
          isPast,
          earnedCents: earned,
          completed: paid != null,
          missed: isPast && paid == null,
          rewardCents: paid ?? (rewardsCents[i] ?? 0),
          paidCents: paid,
        };
      });
      const todayPaid = state.paidByDay.get(state.todayKey) ?? null;
      const todayIndex = Math.max(
        0,
        Math.round(
          (new Date(`${state.todayKey}T00:00:00`).getTime() -
            new Date(`${state.weekStartKey}T00:00:00`).getTime()) /
            86400000,
        ),
      );
      return {
        goalCents,
        scheduleCents: [...rewardsCents],
        weekTotalCents: rewardsCents.reduce((s, r) => s + r, 0),
        currentStreak: state.currentStreak,
        todayEarnedCents: state.earnedByDay.get(state.todayKey) ?? 0,
        todayCompleted: todayPaid != null,
        todayRewardCents:
          todayPaid ?? (rewardsCents[todayIndex] ?? 0),
        weekBonusCents: [...state.paidByDay.values()].reduce(
          (s, v) => s + v,
          0,
        ),
        totalCheckinCents: allRows.reduce((s, r) => s + r.amountCents, 0),
        days,
      };
    },
  }),

  getMyStats: defineAction({
    description:
      "The signed-in user's own per-section statistics: offers completed + offer earnings, surveys completed + survey earnings, challenges completed, check-in totals, and pending earnings (amounts in pending withdrawals). Each section of the dashboard shows its own stats.",
    request: z.object({ token: z.string().min(1).max(200) }),
    response: z.object({
      offersCompleted: z.number(),
      offerEarningsCents: z.number(),
      surveysCompleted: z.number(),
      surveyEarningsCents: z.number(),
      challengesCompleted: z.number(),
      challengeEarningsCents: z.number(),
      checkins: z.number(),
      checkinCents: z.number(),
      pendingCents: z.number(),
      totalCashoutCents: z.number(),
      chargebackRatePct: z.number(),
      totalEarnedCents: z.number(),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const user = await requireUser(ctx, args.token);
      const credited = await db
        .select()
        .from(schema.postbacks)
        .where(
          and(
            eq(schema.postbacks.userId, user.id),
            eq(schema.postbacks.status, "credited"),
          ),
        )
        .limit(10000);
      let offersCompleted = 0;
      let offerEarningsCents = 0;
      let surveysCompleted = 0;
      let surveyEarningsCents = 0;
      for (const pb of credited) {
        if (isSurveyNetwork(pb.network)) {
          surveysCompleted += 1;
          surveyEarningsCents += pb.creditedCents;
        } else {
          offersCompleted += 1;
          offerEarningsCents += pb.creditedCents;
        }
      }
      const myCheckins = await db
        .select()
        .from(schema.checkins)
        .where(eq(schema.checkins.userId, user.id))
        .limit(1000);
      const pending = await db
        .select()
        .from(schema.withdrawals)
        .where(
          and(
            eq(schema.withdrawals.userId, user.id),
            eq(schema.withdrawals.status, "pending"),
          ),
        );
      return {
        offersCompleted,
        offerEarningsCents,
        surveysCompleted,
        surveyEarningsCents,
        challengesCompleted: offersCompleted,
        challengeEarningsCents: offerEarningsCents,
        checkins: myCheckins.length,
        checkinCents: myCheckins.reduce((s, c) => s + c.amountCents, 0),
        pendingCents: pending.reduce((s, w) => s + w.amountCents, 0),
        totalCashoutCents: (
          await db
            .select()
            .from(schema.withdrawals)
            .where(
              and(
                eq(schema.withdrawals.userId, user.id),
                eq(schema.withdrawals.status, "approved"),
              ),
            )
        ).reduce((s, w) => s + w.amountCents, 0),
        chargebackRatePct: await chargebackRatePct(db, user.id),
        totalEarnedCents: user.totalEarnedCents,
      };
    },
  }),

  getMyContest: defineAction({
    description:
      "Whether the signed-in user has joined today's Daily contest and the Affiliate contest, with both prize pools.",
    request: z.object({ token: z.string().min(1).max(200) }),
    response: z.object({
      dailyPoolCents: z.number(),
      affiliatePoolCents: z.number(),
      dailyJoined: z.boolean(),
      affiliateJoined: z.boolean(),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const settings = await getSettings(db);
      const user = await requireUser(ctx, args.token);
      const joins = await db
        .select()
        .from(schema.contestJoins)
        .where(eq(schema.contestJoins.userId, user.id));
      const todayKey = dayKeyOf(new Date());
      return {
        dailyPoolCents: settingInt(settings, "daily_pool_cents"),
        affiliatePoolCents: settingInt(settings, "affiliate_pool_cents"),
        dailyJoined: joins.some((j) => j.contest === "daily" && j.periodKey === todayKey),
        affiliateJoined: joins.some((j) => j.contest === "affiliate"),
      };
    },
  }),

  joinContest: defineAction({
    description:
      "Joins the signed-in user to the Daily contest (today) or the Affiliate contest. Joining twice is a no-op.",
    request: z.object({
      token: z.string().min(1).max(200),
      contest: z.enum(["daily", "affiliate"]),
    }),
    response: z.object({ ok: z.literal(true), alreadyJoined: z.boolean() }),
    async handler(ctx, args): Promise<{ ok: true; alreadyJoined: boolean }> {
      const db = ctx.db<typeof schema>();
      const user = await requireUser(ctx, args.token);
      const periodKey = args.contest === "daily" ? dayKeyOf(new Date()) : "ALL";
      const existing = await db
        .select()
        .from(schema.contestJoins)
        .where(
          and(
            eq(schema.contestJoins.userId, user.id),
            eq(schema.contestJoins.contest, args.contest),
            eq(schema.contestJoins.periodKey, periodKey),
          ),
        )
        .limit(1);
      if (existing[0]) return { ok: true, alreadyJoined: true };
      await db.insert(schema.contestJoins).values({
        userId: user.id,
        contest: args.contest,
        periodKey,
      });
      ctx.invalidateQueries();
      return { ok: true, alreadyJoined: false };
    },
  }),

  getLevel: defineAction({
    description:
      "The signed-in user's Level & Privileges (Title Bonus system): level from lifetime earnings ($1 = 1 level), current and next title, progress to the next title, all titles with their bonus rates, and Title Bonus history. Syncs level and pays due bonuses first.",
    request: z.object({ token: z.string().min(1).max(200) }),
    response: z.object({
      level: z.number(),
      totalEarnedCents: z.number(),
      title: z.string().nullable(),
      nextTitle: z
        .object({
          name: z.string(),
          level: z.number(),
          standardPct: z.number(),
          enhancedPct: z.number(),
        })
        .nullable(),
      progressPct: z.number(),
      chargebackRatePct: z.number(),
      titles: z.array(
        z.object({
          name: z.string(),
          level: z.number(),
          standardPct: z.number(),
          enhancedPct: z.number(),
          reached: z.boolean(),
          current: z.boolean(),
        }),
      ),
      rewardHistory: z.array(
        z.object({ id: z.number(), amountCents: z.number(), note: z.string(), createdAt: z.string() }),
      ),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const user0 = await requireUser(ctx, args.token);
      await checkLevelUps(db, user0.id);
      const rows = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, user0.id))
        .limit(1);
      const user = rows[0] ?? user0;
      const levelCfg = levelConfigFrom(await getSettings(db));
      const level = user.level;
      const current = titleForLevel(level, levelCfg.titles);
      const next = nextTitleForLevel(level, levelCfg.titles);
      const prevThreshold = (current?.level ?? 0) * levelCfg.centsPerLevel;
      const nextThreshold = next ? next.level * levelCfg.centsPerLevel : prevThreshold;
      const progressPct = next
        ? Math.min(
            100,
            Math.max(
              0,
              Math.floor(
                ((user.totalEarnedCents - prevThreshold) /
                  Math.max(1, nextThreshold - prevThreshold)) *
                  100,
              ),
            ),
          )
        : 100;
      const history = await db
        .select()
        .from(schema.transactions)
        .where(
          and(
            eq(schema.transactions.userId, user.id),
            eq(schema.transactions.kind, "level_reward"),
          ),
        )
        .orderBy(desc(schema.transactions.id))
        .limit(20);
      return {
        level,
        totalEarnedCents: user.totalEarnedCents,
        title: current?.name ?? null,
        nextTitle: next
          ? {
              name: next.name,
              level: next.level,
              standardPct: next.standardPct,
              enhancedPct: next.enhancedPct,
            }
          : null,
        progressPct,
        chargebackRatePct: await chargebackRatePct(db, user.id),
        titles: levelCfg.titles.map((title) => ({
          name: title.name,
          level: title.level,
          standardPct: title.standardPct,
          enhancedPct: title.enhancedPct,
          reached: level >= title.level,
          current: current?.name === title.name,
        })),
        rewardHistory: history.map((h) => ({
          id: h.id,
          amountCents: h.amountCents,
          note: h.note,
          createdAt: h.createdAt.toISOString(),
        })),
      };
    },
  }),

  getMyOffers: defineAction({
    description:
      "My Offers: the signed-in user's completed offers and surveys from credited postbacks, newest first, with the chargeback rate.",
    request: z.object({ token: z.string().min(1).max(200) }),
    response: z.object({
      chargebackRatePct: z.number(),
      items: z.array(
        z.object({
          id: z.number(),
          network: z.string(),
          kind: z.enum(["offer", "survey"]),
          creditedCents: z.number(),
          createdAt: z.string(),
        }),
      ),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const user = await requireUser(ctx, args.token);
      const rows = await db
        .select()
        .from(schema.postbacks)
        .where(
          and(
            eq(schema.postbacks.userId, user.id),
            eq(schema.postbacks.status, "credited"),
          ),
        )
        .orderBy(desc(schema.postbacks.id))
        .limit(200);
      return {
        chargebackRatePct: await chargebackRatePct(db, user.id),
        items: rows.map((r) => ({
          id: r.id,
          network: r.network,
          kind: isSurveyNetwork(r.network) ? ("survey" as const) : ("offer" as const),
          creditedCents: r.creditedCents,
          createdAt: r.createdAt.toISOString(),
        })),
      };
    },
  }),

  updateProfilePicture: defineAction({
    description:
      "Uploads a new profile picture for the signed-in user. The image is stored as a site blob and its URL saved on the user row, so it shows everywhere the user's avatar appears.",
    request: z.object({
      token: z.string().min(1).max(200),
      dataBase64: z.string().min(1).max(3_000_000),
      mimeType: z.string().min(1).max(60),
    }),
    response: z.object({ pictureUrl: z.string() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const user = await requireUser(ctx, args.token);
      if (!["image/png", "image/jpeg", "image/webp"].includes(args.mimeType))
        throw new Error("Please choose a PNG, JPG or WebP image.");
      const bytes = Buffer.from(args.dataBase64, "base64");
      if (bytes.length === 0 || bytes.length > 2_200_000)
        throw new Error("That image is too large — please pick one under 2 MB.");
      const key = `avatars/user-${user.id}-${Date.now()}`;
      await ctx.blobs.put(key, bytes, { contentType: args.mimeType });
      const url = await ctx.blobs.getUrl(key);
      await db
        .update(schema.users)
        .set({ pictureUrl: url })
        .where(eq(schema.users.id, user.id));
      ctx.invalidateQueries();
      return { pictureUrl: url };
    },
  }),

  // NOTE: sign-in is Google-only, so Profile/Settings carries no
  // extra account-verification preference — the owner removed that
  // option entirely on 2026-11-19.

  setThemePreference: defineAction({
    description: "Saves the signed-in user's dark/light choice on their account so it persists across devices and reloads.",
    request: z.object({
      token: z.string().min(1).max(200),
      mode: z.enum(["light", "dark"]),
    }),
    response: z.object({ ok: z.literal(true), mode: z.enum(["light", "dark"]) }),
    async handler(ctx, args): Promise<{ ok: true; mode: "light" | "dark" }> {
      const db = ctx.db<typeof schema>();
      const user = await requireUser(ctx, args.token);
      await db
        .update(schema.users)
        .set({ theme: args.mode })
        .where(eq(schema.users.id, user.id));
      ctx.invalidateQueries();
      return { ok: true, mode: args.mode };
    },
  }),

  // NOTE: there is deliberately NO delete-account action. Users can
  // never delete their own (or any) account from the user side — the
  // owner removed that option entirely (2026-11-19). The admin's Block
  // account option (adminSetUserBlocked) is separate and stays.

  settleDailyContest: defineAction({
    description:
      "Records the Daily contest winners for yesterday (or a given finished day) using the prize tiers, as pending awards — no money moves; the owner pays each prize from Admin → Contest Payouts. Also records last month's Affiliate winners if due. Idempotent — safe for the daily schedule to call.",
    request: z.object({ periodKey: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }),
    response: z.object({
      status: z.enum(["paid", "already_settled", "no_earners"]),
      periodKey: z.string(),
      winnerUserId: z.number().nullable(),
      winnerName: z.string().nullable(),
      amountCents: z.number(),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const todayKey = dayKeyOf(new Date());
      const periodKey = args.periodKey ?? shiftDayKey(todayKey, -1);
      if (periodKey >= todayKey)
        throw new Error("Only a finished day can be settled.");
      const result = await settleDailyContestFor(db, periodKey);
      // The daily schedule also records last month's Affiliate winners
      // the first time it runs in a new month.
      await settleAffiliateMonthIfNeeded(db);
      let winnerName: string | null = null;
      if (result.winnerUserId != null) {
        const rows = await db
          .select()
          .from(schema.users)
          .where(eq(schema.users.id, result.winnerUserId))
          .limit(1);
        winnerName = rows[0]?.name ?? null;
      }
      ctx.invalidateQueries();
      return { ...result, periodKey, winnerName };
    },
  }),

  postback: defineAction({
    description:
      "Offerwall postback endpoint: credits the user 70% of the payout (idempotent per transaction id) and pays the referrer 8% earning commission.",
    request: z.object({
      network: z.string().max(80).default(""),
      user_code: z.string().trim().max(32).optional(),
      user_id: z.number().int().positive().optional(),
      payout: z.number().nonnegative().max(100000),
      txn_id: z.string().trim().min(1).max(120),
      secret: z.string().max(200).optional(),
    }),
    response: z.object({
      status: z.enum(["credited", "duplicate", "unknown_user"]),
      creditedCents: z.number(),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const settings = await getSettings(db);
      const secret = settings["postback_secret"] ?? "";
      if (secret && args.secret !== secret)
        throw new Error("Invalid postback secret.");

      const existing = await db
        .select()
        .from(schema.postbacks)
        .where(eq(schema.postbacks.txnId, args.txn_id))
        .limit(1);
      if (existing[0]) {
        return {
          status: "duplicate" as const,
          creditedCents: existing[0].creditedCents,
        };
      }

      let user: UserRow | undefined;
      if (args.user_code) {
        const rows = await db
          .select()
          .from(schema.users)
          .where(eq(schema.users.userCode, args.user_code))
          .limit(1);
        user = rows[0];
      } else if (args.user_id) {
        const rows = await db
          .select()
          .from(schema.users)
          .where(eq(schema.users.id, args.user_id))
          .limit(1);
        user = rows[0];
      }

      if (!user) {
        await db.insert(schema.postbacks).values({
          txnId: args.txn_id,
          network: args.network,
          userId: null,
          payout: args.payout,
          creditedCents: 0,
          status: "unknown_user",
          rawJson: JSON.stringify(args),
        });
        return { status: "unknown_user" as const, creditedCents: 0 };
      }

      const creditedCents = await applyRewardCredit(db, settings, user, {
        network: args.network,
        txnId: args.txn_id,
        payout: args.payout,
        note: args.network
          ? `${args.network} offer completed`
          : "Offer completed",
        rawJson: JSON.stringify(args),
      });
      ctx.invalidateQueries();
      return { status: "credited" as const, creditedCents };
    },
  }),

  theoremReachCallback: defineAction({
    description:
      "TheoremReach server-to-server reward callback: verifies the HMAC-SHA1 signature with the app's Secret Key (Admin → Settings), then credits the user — found by the Offer Token TheoremReach sends back as user_id — 70% of the reward. Idempotent per TheoremReach tx_id; reversals never credit.",
    request: z.object({
      // All values are strings on purpose: they arrive as URL query
      // parameters and the exact text is part of the signed string.
      user_id: z.string().trim().min(1).max(64),
      tx_id: z.string().trim().min(1).max(120),
      reward: z.string().trim().max(32).optional(),
      reward_amount_in_dollars: z.string().trim().max(32).optional(),
      external_transaction_id: z.string().trim().max(160).optional(),
      reversal: z.string().trim().max(16).optional(),
      hash: z.string().trim().max(120).optional(),
      // The full callback URL exactly as TheoremReach called it, minus
      // the trailing &hash=… — supplied by the standalone server's
      // /theoremreach-callback route from the raw request, because the
      // signature covers that exact string.
      signed_url: z.string().trim().max(4000).optional(),
    }),
    response: z.object({
      status: z.enum(["credited", "duplicate", "unknown_user", "rejected"]),
      creditedCents: z.number(),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const settings = await getSettings(db);

      // When the signed URL is present its query parameters are the
      // authoritative values — they are exactly what the signature
      // covers, so the credited user/amount can never be swapped for
      // different unsigned arguments.
      let userId = args.user_id;
      let txId = args.tx_id;
      let reward = args.reward;
      let rewardDollars = args.reward_amount_in_dollars;
      let externalTxId = args.external_transaction_id;
      let reversal = args.reversal;
      if (args.signed_url) {
        try {
          const q = new URL(args.signed_url).searchParams;
          userId = q.get("user_id") ?? userId;
          txId = q.get("tx_id") ?? txId;
          reward = q.get("reward") ?? reward;
          rewardDollars =
            q.get("reward_amount_in_dollars") ?? rewardDollars;
          externalTxId =
            q.get("external_transaction_id") ?? externalTxId;
          reversal = q.get("reversal") ?? reversal;
        } catch {
          throw new Error("Invalid signed callback URL.");
        }
      }

      // Signature verification (TheoremReach docs): the callback is
      // signed with the app's Secret Key as
      // base64url(HMAC-SHA1(secret, full callback URL without &hash=)).
      // Enforced whenever a secret is set in Admin → Settings.
      const secret = settings["theoremreach_secret"] ?? "";
      if (secret) {
        if (!args.hash || !args.signed_url)
          throw new Error("Missing callback signature.");
        const expected = await theoremReachSignature(secret, args.signed_url);
        // A TLS-terminating proxy can make the received URL read http
        // where TheoremReach signed https — that variant is still an
        // HMAC over the exact parameters with the secret, so try it too.
        const httpsVariant = args.signed_url.startsWith("http://")
          ? `https://${args.signed_url.slice("http://".length)}`
          : null;
        const expectedHttps = httpsVariant
          ? await theoremReachSignature(secret, httpsVariant)
          : null;
        if (args.hash !== expected && args.hash !== expectedHttps)
          throw new Error("Invalid callback signature.");
      }

      // The reward: prefer the explicit USD amount; the app's currency
      // is Dollar at exchange rate 1, so `reward` is dollars too.
      const payoutText = rewardDollars ?? reward ?? "";
      const payout = Number.parseFloat(payoutText);
      if (!Number.isFinite(payout))
        throw new Error("Invalid reward amount.");

      // Reversals (negative reward / reversal=true) never credit and
      // never debit automatically — the owner reconciles them by hand.
      if (reversal === "true" || payout <= 0) {
        return { status: "rejected" as const, creditedCents: 0 };
      }

      // Idempotent per TheoremReach transaction ID (namespaced so it
      // can never collide with another network's transaction IDs).
      const txnKey = `theoremreach:${txId}`;
      const existing = await db
        .select()
        .from(schema.postbacks)
        .where(eq(schema.postbacks.txnId, txnKey))
        .limit(1);
      if (existing[0]) {
        return {
          status: "duplicate" as const,
          creditedCents: existing[0].creditedCents,
        };
      }

      // user_id is the publisher user ID from the entry link = the
      // user's Offer Token (OT-…); fall back to the user code.
      let userRows = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.offerToken, userId))
        .limit(1);
      if (!userRows[0]) {
        userRows = await db
          .select()
          .from(schema.users)
          .where(eq(schema.users.userCode, userId))
          .limit(1);
      }
      const user = userRows[0];
      const rawJson = JSON.stringify({
        network: "TheoremReach",
        user_id: userId,
        tx_id: txId,
        reward,
        reward_amount_in_dollars: rewardDollars,
        external_transaction_id: externalTxId,
      });
      if (!user) {
        await db.insert(schema.postbacks).values({
          txnId: txnKey,
          network: "TheoremReach",
          userId: null,
          payout,
          creditedCents: 0,
          status: "unknown_user",
          rawJson,
        });
        return { status: "unknown_user" as const, creditedCents: 0 };
      }

      const creditedCents = await applyRewardCredit(db, settings, user, {
        network: "TheoremReach",
        txnId: txnKey,
        payout,
        note: "TheoremReach survey completed",
        rawJson,
      });
      ctx.invalidateQueries();
      return { status: "credited" as const, creditedCents };
    },
  }),

  // ------------------------------------------------------------ admin auth

  adminLogin: defineAction({
    description: "Signs the site owner into the hidden admin panel with username and password.",
    request: z.object({
      username: z.string().trim().min(1).max(80),
      password: z.string().min(1).max(200),
    }),
    response: z.object({ token: z.string() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const settings = await getSettings(db);
      if (
        args.username !== (settings["admin_username"] ?? "") ||
        args.password !== (settings["admin_password"] ?? "")
      )
        throw new Error("Wrong username or password.");
      const token = newToken("adm");
      await db.insert(schema.sessions).values({ token, userId: -1 });
      return { token };
    },
  }),

  adminGetOverview: defineAction({
    description:
      "Admin overview: site stats, current settings, and the postback parameter template for offerwall partners.",
    request: z.object({ adminToken: z.string().min(1).max(200) }),
    response: z.object({
      stats: z.object({
        users: z.number(),
        blockedUsers: z.number(),
        pendingWithdrawals: z.number(),
        pendingCents: z.number(),
        paidOutCents: z.number(),
        creditedCents: z.number(),
        unreadMessages: z.number(),
        contentItems: z.number(),
        bannedCountries: z.number(),
        unreadNotifications: z.number(),
        totalNotifications: z.number(),
      }),
      settings: z.object({
        googleClientId: z.string(),
        adminUsername: z.string(),
        dailyPoolCents: z.number(),
        affiliatePoolCents: z.number(),
        minWithdrawCents: z.number(),
        userSharePct: z.number(),
        affiliateEarningPct: z.number(),
        affiliateSpendingPct: z.number(),
        postbackSecretSet: z.boolean(),
        theoremReachSecretSet: z.boolean(),
        checkinBonusCents: z.number(),
        levelRewardCents: z.number(),
        checkinGoalCents: z.number(),
        checkinRewardsCents: z.array(z.number()),
        dailyTiersCents: z.array(z.number()),
        affiliateTiersCents: z.array(z.number()),
        levelCentsPerLevel: z.number(),
        levelTitles: z.array(
          z.object({
            name: z.string(),
            level: z.number(),
            standardPct: z.number(),
            enhancedPct: z.number(),
          }),
        ),
        socialLinks: z.record(z.string(), z.string()),
      }),
    }),
    async handler(ctx, args) {
      await requireAdmin(ctx, args.adminToken);
      const db = ctx.db<typeof schema>();
      const settings = await getSettings(db);
      const allUsers = await db.select().from(schema.users);
      const pending = await db
        .select()
        .from(schema.withdrawals)
        .where(eq(schema.withdrawals.status, "pending"));
      const approved = await db
        .select()
        .from(schema.withdrawals)
        .where(eq(schema.withdrawals.status, "approved"));
      const credited = await db
        .select()
        .from(schema.postbacks)
        .where(eq(schema.postbacks.status, "credited"));
      const unread = await db
        .select()
        .from(schema.messages)
        .where(
          and(
            eq(schema.messages.sender, "user"),
            eq(schema.messages.readByAdmin, 0),
          ),
        );
      const content = await db.select().from(schema.contentItems);
      const bannedRows = await db.select().from(schema.bannedCountries);
      const notifRows = await db.select().from(schema.adminNotifications);
      return {
        stats: {
          users: allUsers.length,
          blockedUsers: allUsers.filter((u) => u.blocked === 1).length,
          pendingWithdrawals: pending.length,
          pendingCents: pending.reduce((s, w) => s + w.amountCents, 0),
          paidOutCents: approved.reduce((s, w) => s + w.amountCents, 0),
          creditedCents: credited.reduce((s, p) => s + p.creditedCents, 0),
          unreadMessages: unread.length,
          contentItems: content.length,
          bannedCountries: bannedRows.length,
          unreadNotifications: notifRows.filter((n) => n.read === 0).length,
          totalNotifications: notifRows.length,
        },
        settings: {
          googleClientId: settings["google_client_id"] ?? "",
          adminUsername: settings["admin_username"] ?? "",
          dailyPoolCents: settingInt(settings, "daily_pool_cents"),
          affiliatePoolCents: settingInt(settings, "affiliate_pool_cents"),
          minWithdrawCents: settingInt(settings, "min_withdraw_cents"),
          userSharePct: settingInt(settings, "user_share_pct"),
          affiliateEarningPct: settingInt(settings, "affiliate_earning_pct"),
          affiliateSpendingPct: settingInt(settings, "affiliate_spending_pct"),
          postbackSecretSet: (settings["postback_secret"] ?? "") !== "",
          theoremReachSecretSet: (settings["theoremreach_secret"] ?? "") !== "",
          checkinBonusCents: settingInt(settings, "checkin_bonus_cents"),
          levelRewardCents: settingInt(settings, "level_reward_cents"),
          checkinGoalCents: checkinGoalFrom(settings),
          checkinRewardsCents: checkinRewardsFrom(settings),
          dailyTiersCents: dailyTiersFrom(settings),
          affiliateTiersCents: affiliateTiersFrom(settings),
          levelCentsPerLevel: levelConfigFrom(settings).centsPerLevel,
          levelTitles: levelConfigFrom(settings).titles.map((t) => ({
            name: t.name,
            level: t.level,
            standardPct: t.standardPct,
            enhancedPct: t.enhancedPct,
          })),
          socialLinks: Object.fromEntries(
            SOCIAL_PLATFORMS.map((s) => [s.id, settings[s.key] ?? ""]),
          ),
        },
      };
    },
  }),

  adminListUsers: defineAction({
    description:
      "Admin user list with full details: unique user ID, email, IP, country, login method, balances, referral and block state.",
    request: z.object({
      adminToken: z.string().min(1).max(200),
      limit: z.number().int().positive().max(200).default(100),
    }),
    response: z.object({
      users: z.array(
        userShape.extend({
          // Admin-only fields: the user's IP, ISP and country are
          // visible ONLY in this admin response — never anywhere in
          // the user's own site (not Profile, not the dashboard).
          ip: z.string().nullable(),
          isp: z.string().nullable(),
          countryCode: z.string().nullable(),
          countryName: z.string().nullable(),
          flagEmoji: z.string().nullable(),
          referredByCode: z.string().nullable(),
          lastSeenAt: z.string(),
        }),
      ),
    }),
    async handler(ctx, args) {
      await requireAdmin(ctx, args.adminToken);
      const db = ctx.db<typeof schema>();
      const rows = await db
        .select()
        .from(schema.users)
        .orderBy(desc(schema.users.id))
        .limit(args.limit);
      const byId = new Map(rows.map((u) => [u.id, u]));
      const all = await db.select().from(schema.users);
      const allById = new Map(all.map((u) => [u.id, u]));
      void byId;
      const settings = await getSettings(db);
      const titles = levelConfigFrom(settings).titles;
      return {
        users: rows.map((u) => ({
          ...publicUser(u, titles),
          ip: u.ip ?? null,
          isp: u.isp ?? null,
          countryCode: u.countryCode ?? null,
          countryName: u.countryName ?? null,
          flagEmoji: u.flagEmoji ?? null,
          referredByCode:
            u.referredById != null
              ? (allById.get(u.referredById)?.userCode ?? null)
              : null,
          lastSeenAt: u.lastSeenAt.toISOString(),
        })),
      };
    },
  }),

  adminSetUserBlocked: defineAction({
    description: "Blocks or unblocks a user account; blocked users cannot sign in or use the site.",
    request: z.object({
      adminToken: z.string().min(1).max(200),
      userId: z.number().int().positive(),
      blocked: z.boolean(),
    }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      await requireAdmin(ctx, args.adminToken);
      const db = ctx.db<typeof schema>();
      await db
        .update(schema.users)
        .set({ blocked: args.blocked ? 1 : 0 })
        .where(eq(schema.users.id, args.userId));
      if (args.blocked) {
        await db
          .delete(schema.sessions)
          .where(eq(schema.sessions.userId, args.userId));
      }
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  adminAdjustBalance: defineAction({
    description: "Manually credits or debits a user's dollar balance with a note (recorded in their history).",
    request: z.object({
      adminToken: z.string().min(1).max(200),
      userId: z.number().int().positive(),
      amountCents: z.number().int().min(-100_000_000).max(100_000_000),
      note: z.string().trim().max(200).default("Admin adjustment"),
    }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      await requireAdmin(ctx, args.adminToken);
      const db = ctx.db<typeof schema>();
      const rows = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, args.userId))
        .limit(1);
      const user = rows[0];
      if (!user) throw new Error("User not found.");
      const newBalance = user.balanceCents + args.amountCents;
      if (newBalance < 0)
        throw new Error("That would take the balance below $0.00.");
      const statements: BatchItem<"sqlite">[] = [
        db
          .update(schema.users)
          .set({
            balanceCents: newBalance,
            totalEarnedCents:
              args.amountCents > 0
                ? user.totalEarnedCents + args.amountCents
                : user.totalEarnedCents,
          })
          .where(eq(schema.users.id, user.id)),
        db.insert(schema.transactions).values({
          userId: user.id,
          kind: "admin_adjust",
          amountCents: args.amountCents,
          note: args.note || "Admin adjustment",
        }),
      ];
      const [first, ...rest] = statements;
      if (first) await db.batch([first, ...rest]);
      if (args.amountCents > 0) await checkLevelUps(db, user.id);
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  adminListWithdrawals: defineAction({
    description: "Admin withdrawal queue with the user's payout details, filterable by status.",
    request: z.object({
      adminToken: z.string().min(1).max(200),
      status: z.enum(["pending", "approved", "rejected", "all"]).default("pending"),
      limit: z.number().int().positive().max(200).default(100),
    }),
    response: z.object({
      withdrawals: z.array(
        withdrawalShape.extend({
          userName: z.string(),
          userCode: z.string(),
          userEmail: z.string(),
        }),
      ),
    }),
    async handler(ctx, args) {
      await requireAdmin(ctx, args.adminToken);
      const db = ctx.db<typeof schema>();
      const base = db
        .select({
          w: schema.withdrawals,
          name: schema.users.name,
          code: schema.users.userCode,
          email: schema.users.email,
        })
        .from(schema.withdrawals)
        .innerJoin(schema.users, eq(schema.withdrawals.userId, schema.users.id));
      const rows =
        args.status === "all"
          ? await base.orderBy(desc(schema.withdrawals.id)).limit(args.limit)
          : await base
              .where(eq(schema.withdrawals.status, args.status))
              .orderBy(desc(schema.withdrawals.id))
              .limit(args.limit);
      const customLabels = await customMethodLabels(db);
      return {
        withdrawals: rows.map((r) => ({
          ...publicWithdrawal(r.w, customLabels),
          userName: r.name,
          userCode: r.code,
          userEmail: r.email,
        })),
      };
    },
  }),

  adminDecideWithdrawal: defineAction({
    description:
      "Approves a withdrawal (user sees Approved) or rejects it (amount refunded to the user's balance, user sees Rejected).",
    request: z.object({
      adminToken: z.string().min(1).max(200),
      withdrawalId: z.number().int().positive(),
      decision: z.enum(["approved", "rejected"]),
      note: z.string().trim().max(300).default(""),
    }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      await requireAdmin(ctx, args.adminToken);
      const db = ctx.db<typeof schema>();
      const rows = await db
        .select()
        .from(schema.withdrawals)
        .where(eq(schema.withdrawals.id, args.withdrawalId))
        .limit(1);
      const w = rows[0];
      if (!w) throw new Error("Withdrawal not found.");
      if (w.status !== "pending")
        throw new Error("This withdrawal was already decided.");
      const statements: BatchItem<"sqlite">[] = [
        db
          .update(schema.withdrawals)
          .set({
            status: args.decision,
            adminNote: args.note,
            decidedAt: new Date(),
          })
          .where(eq(schema.withdrawals.id, w.id)),
      ];
      if (args.decision === "rejected") {
        const userRows = await db
          .select()
          .from(schema.users)
          .where(eq(schema.users.id, w.userId))
          .limit(1);
        const user = userRows[0];
        if (user) {
          statements.push(
            db
              .update(schema.users)
              .set({ balanceCents: user.balanceCents + w.amountCents })
              .where(eq(schema.users.id, user.id)),
            db.insert(schema.transactions).values({
              userId: user.id,
              kind: "withdrawal_refund",
              amountCents: w.amountCents,
              note: "Withdrawal rejected — amount returned to balance",
            }),
          );
        }
      }
      const [first, ...rest] = statements;
      if (first) await db.batch([first, ...rest]);
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  adminListContestPayouts: defineAction({
    description:
      "Contest Payouts for the owner: Daily and Affiliate winner groups by finished day/month — every winner's rank, username and prize, each award pending or paid — plus the most recently paid prizes. Contest prizes are never paid automatically; the owner pays them from here.",
    request: z.object({ adminToken: z.string().min(1).max(200) }),
    response: z.object({
      daily: z.array(
        z.object({
          periodKey: z.string(),
          pendingCents: z.number(),
          awards: z.array(
            z.object({
              id: z.number(),
              rank: z.number(),
              userName: z.string(),
              amountCents: z.number(),
              status: z.enum(["pending", "paid"]),
            }),
          ),
        }),
      ),
      affiliate: z.array(
        z.object({
          periodKey: z.string(),
          pendingCents: z.number(),
          awards: z.array(
            z.object({
              id: z.number(),
              rank: z.number(),
              userName: z.string(),
              amountCents: z.number(),
              status: z.enum(["pending", "paid"]),
            }),
          ),
        }),
      ),
      recentPaid: z.array(
        z.object({
          contest: z.enum(["daily", "affiliate"]),
          periodKey: z.string(),
          rank: z.number(),
          userName: z.string(),
          amountCents: z.number(),
        }),
      ),
    }),
    async handler(ctx, args) {
      await requireAdmin(ctx, args.adminToken);
      const db = ctx.db<typeof schema>();
      // Make sure finished periods are recorded before listing.
      await settleYesterdayIfNeeded(db);
      await settleAffiliateMonthIfNeeded(db);
      const awards = await db
        .select()
        .from(schema.contestAwards)
        .orderBy(desc(schema.contestAwards.id))
        .limit(2000);
      const users = await db.select().from(schema.users);
      const nameById = new Map(users.map((u) => [u.id, u.name]));
      const group = (contest: "daily" | "affiliate", maxGroups: number) => {
        const byPeriod = new Map<string, typeof awards>();
        for (const a of awards) {
          if (a.contest !== contest) continue;
          const list = byPeriod.get(a.periodKey) ?? [];
          list.push(a);
          byPeriod.set(a.periodKey, list);
        }
        return [...byPeriod.entries()]
          .sort((a, b) => (a[0] < b[0] ? 1 : -1))
          .slice(0, maxGroups)
          .map(([periodKey, list]) => ({
            periodKey,
            pendingCents: list
              .filter((a) => a.status === "pending")
              .reduce((s, a) => s + a.amountCents, 0),
            awards: [...list]
              .sort((a, b) => a.rank - b.rank)
              .map((a) => ({
                id: a.id,
                rank: a.rank,
                userName: nameById.get(a.userId) ?? "User",
                amountCents: a.amountCents,
                status: a.status,
              })),
          }));
      };
      const recentPaid = awards
        .filter((a) => a.status === "paid")
        .slice(0, 20)
        .map((a) => ({
          contest: a.contest,
          periodKey: a.periodKey,
          rank: a.rank,
          userName: nameById.get(a.userId) ?? "User",
          amountCents: a.amountCents,
        }));
      return {
        daily: group("daily", 14),
        affiliate: group("affiliate", 6),
        recentPaid,
      };
    },
  }),

  adminPayContestAward: defineAction({
    description:
      "Pays one pending contest prize into the winner's balance (the winner sees it in their balance and history). Already-paid awards pay nothing again.",
    request: z.object({
      adminToken: z.string().min(1).max(200),
      awardId: z.number().int().positive(),
    }),
    response: z.object({
      status: z.enum(["paid", "already_paid"]),
      userName: z.string(),
      amountCents: z.number(),
    }),
    async handler(ctx, args) {
      await requireAdmin(ctx, args.adminToken);
      const db = ctx.db<typeof schema>();
      const rows = await db
        .select()
        .from(schema.contestAwards)
        .where(eq(schema.contestAwards.id, args.awardId))
        .limit(1);
      const award = rows[0];
      if (!award) throw new Error("Contest award not found.");
      const status = await payContestAward(db, award);
      const userRows = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, award.userId))
        .limit(1);
      ctx.invalidateQueries();
      return {
        status,
        userName: userRows[0]?.name ?? "User",
        amountCents: award.amountCents,
      };
    },
  }),

  adminPayAllContestAwards: defineAction({
    description:
      "Pays every pending contest prize for one finished day (Daily) or month (Affiliate) into the winners' balances at once.",
    request: z.object({
      adminToken: z.string().min(1).max(200),
      contest: z.enum(["daily", "affiliate"]),
      periodKey: z.string().trim().min(4).max(10),
    }),
    response: z.object({ paidCount: z.number(), totalCents: z.number() }),
    async handler(ctx, args) {
      await requireAdmin(ctx, args.adminToken);
      const db = ctx.db<typeof schema>();
      const rows = await db
        .select()
        .from(schema.contestAwards)
        .where(
          and(
            eq(schema.contestAwards.contest, args.contest),
            eq(schema.contestAwards.periodKey, args.periodKey),
            eq(schema.contestAwards.status, "pending"),
          ),
        )
        .limit(500);
      let paidCount = 0;
      let totalCents = 0;
      for (const award of rows) {
        const status = await payContestAward(db, award);
        if (status === "paid") {
          paidCount += 1;
          totalCents += award.amountCents;
        }
      }
      ctx.invalidateQueries();
      return { paidCount, totalCents };
    },
  }),

  adminListWithdrawMethods: defineAction({
    description:
      "Every withdraw method in one place: the built-in per-country methods (Pakistan, USA, UK, India and the default set for all other countries) plus all extra methods the owner has added per country.",
    request: z.object({ adminToken: z.string().min(1).max(200) }),
    response: z.object({
      builtIns: z.array(
        z.object({
          countryCode: z.string(),
          countryName: z.string(),
          methods: z.array(
            z.object({
              id: z.string(),
              label: z.string(),
              imageUrl: z.string().nullable(),
              fields: z.array(z.object({ key: z.string(), label: z.string() })),
            }),
          ),
        }),
      ),
      methods: z.array(
        z.object({
          id: z.number(),
          countryCode: z.string(),
          countryName: z.string(),
          label: z.string(),
          imageUrl: z.string().nullable(),
          fields: z.array(z.object({ key: z.string(), label: z.string() })),
        }),
      ),
    }),
    async handler(ctx, args) {
      await requireAdmin(ctx, args.adminToken);
      const db = ctx.db<typeof schema>();
      const rows = await db
        .select()
        .from(schema.withdrawMethods)
        .where(eq(schema.withdrawMethods.active, 1))
        .orderBy(schema.withdrawMethods.countryCode, schema.withdrawMethods.id);
      const BUILT_IN_GROUP_NAMES: Record<string, string> = {
        PK: "Pakistan",
        US: "United States",
        GB: "United Kingdom",
        IN: "India",
      };
      const builtIns = [
        ...Object.keys(METHODS_BY_COUNTRY).map((code) => ({
          countryCode: code,
          countryName: BUILT_IN_GROUP_NAMES[code] ?? code,
          methods: methodsForCountry(code).map((m) => ({
            id: m.id,
            label: m.label,
            imageUrl: m.imageUrl ?? null,
            fields: m.fields,
          })),
        })),
        {
          countryCode: "DEFAULT",
          countryName: "All other countries (default)",
          methods: methodsForCountry(null).map((m) => ({
            id: m.id,
            label: m.label,
            imageUrl: m.imageUrl ?? null,
            fields: m.fields,
          })),
        },
      ];
      return {
        builtIns,
        methods: rows.map((r) => {
          const def = customMethodDef(r);
          return {
            id: r.id,
            countryCode: r.countryCode,
            countryName: r.countryName,
            label: r.label,
            imageUrl: def.imageUrl ?? null,
            fields: def.fields,
          };
        }),
      };
    },
  }),

  adminAddWithdrawMethod: defineAction({
    description:
      "Adds a new withdraw payment method for one country, with an optional logo image link shown next to its name on the Withdraw page. It appears for every user whose locked country matches, next to the built-in methods. The fields are the details the user must fill in when withdrawing with it.",
    request: z.object({
      adminToken: z.string().min(1).max(200),
      countryCode: z.string().trim().regex(/^[A-Za-z]{2}$/),
      countryName: z.string().trim().min(1).max(80),
      label: z.string().trim().min(1).max(60),
      imageUrl: z.string().trim().max(1000).optional(),
      fields: z
        .array(
          z.object({
            key: z.string().trim().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,29}$/),
            label: z.string().trim().min(1).max(60),
          }),
        )
        .min(1)
        .max(5),
    }),
    response: z.object({ id: z.number() }),
    async handler(ctx, args) {
      await requireAdmin(ctx, args.adminToken);
      const db = ctx.db<typeof schema>();
      const code = args.countryCode.toUpperCase();
      // A custom method must not shadow a built-in method of that
      // country (same name would confuse users and the merge dedupes).
      const builtinLabels = new Set(
        methodsForCountry(code).map((m) => m.label.toLowerCase()),
      );
      if (builtinLabels.has(args.label.toLowerCase()))
        throw new Error(
          `"${args.label}" is already a built-in method for ${args.countryName}. Pick a different name.`,
        );
      const existing = await db
        .select()
        .from(schema.withdrawMethods)
        .where(
          and(
            eq(schema.withdrawMethods.countryCode, code),
            eq(schema.withdrawMethods.active, 1),
          ),
        );
      if (
        existing.some((r) => r.label.toLowerCase() === args.label.toLowerCase())
      )
        throw new Error(
          `"${args.label}" already exists for ${args.countryName}.`,
        );
      const inserted = await db
        .insert(schema.withdrawMethods)
        .values({
          countryCode: code,
          countryName: args.countryName,
          label: args.label,
          imageUrl: args.imageUrl?.trim() ? args.imageUrl.trim() : null,
          fieldsJson: JSON.stringify(args.fields),
          active: 1,
        })
        .returning({ id: schema.withdrawMethods.id });
      const row = inserted[0];
      if (!row) throw new Error("The method could not be saved.");
      ctx.invalidateQueries();
      return { id: row.id };
    },
  }),

  adminUpdateWithdrawMethod: defineAction({
    description:
      "Edits an owner-added withdraw method: its name, logo image link and the detail fields users fill in. The change shows on the Withdraw page of every user in that country at once. The country itself does not change — remove and re-add to move a method.",
    request: z.object({
      adminToken: z.string().min(1).max(200),
      id: z.number().int().positive(),
      label: z.string().trim().min(1).max(60),
      imageUrl: z.string().trim().max(1000).nullable().optional(),
      fields: z
        .array(
          z.object({
            key: z.string().trim().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,29}$/),
            label: z.string().trim().min(1).max(60),
          }),
        )
        .min(1)
        .max(5),
    }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      await requireAdmin(ctx, args.adminToken);
      const db = ctx.db<typeof schema>();
      const rows = await db
        .select()
        .from(schema.withdrawMethods)
        .where(eq(schema.withdrawMethods.id, args.id))
        .limit(1);
      const row = rows[0];
      if (!row || row.active !== 1)
        throw new Error("That method no longer exists.");
      const builtinLabels = new Set(
        methodsForCountry(row.countryCode).map((m) => m.label.toLowerCase()),
      );
      if (builtinLabels.has(args.label.toLowerCase()))
        throw new Error(
          `"${args.label}" is already a built-in method for ${row.countryName}. Pick a different name.`,
        );
      const siblings = await db
        .select()
        .from(schema.withdrawMethods)
        .where(
          and(
            eq(schema.withdrawMethods.countryCode, row.countryCode),
            eq(schema.withdrawMethods.active, 1),
          ),
        );
      if (
        siblings.some(
          (r) => r.id !== args.id && r.label.toLowerCase() === args.label.toLowerCase(),
        )
      )
        throw new Error(`"${args.label}" already exists for ${row.countryName}.`);
      await db
        .update(schema.withdrawMethods)
        .set({
          label: args.label,
          imageUrl:
            args.imageUrl === undefined
              ? row.imageUrl
              : args.imageUrl?.trim()
                ? args.imageUrl.trim()
                : null,
          fieldsJson: JSON.stringify(args.fields),
        })
        .where(eq(schema.withdrawMethods.id, args.id));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  adminRemoveWithdrawMethod: defineAction({
    description:
      "Removes an owner-added withdraw method (soft delete: it disappears from users' Withdraw pages at once, while past withdrawals keep showing its name).",
    request: z.object({
      adminToken: z.string().min(1).max(200),
      id: z.number().int().positive(),
    }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      await requireAdmin(ctx, args.adminToken);
      const db = ctx.db<typeof schema>();
      await db
        .update(schema.withdrawMethods)
        .set({ active: 0 })
        .where(eq(schema.withdrawMethods.id, args.id));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  adminListContent: defineAction({
    description: "All offerwalls, surveys and games (including inactive) for admin management.",
    request: z.object({ adminToken: z.string().min(1).max(200) }),
    response: z.object({ items: z.array(contentShape) }),
    async handler(ctx, args) {
      await requireAdmin(ctx, args.adminToken);
      const db = ctx.db<typeof schema>();
      const rows = await db
        .select()
        .from(schema.contentItems)
        .orderBy(schema.contentItems.kind, schema.contentItems.sortOrder, desc(schema.contentItems.id));
      return { items: rows.map(publicContent) };
    },
  }),

  adminUpsertContent: defineAction({
    description:
      "Adds or edits an offerwall, survey or game. Saved rows are served to every user immediately.",
    request: z.object({
      adminToken: z.string().min(1).max(200),
      id: z.number().int().positive().optional(),
      kind: z.enum(["offerwall", "survey", "game"]),
      title: z.string().trim().min(1).max(160),
      provider: z.string().trim().max(120).default(""),
      description: z.string().trim().max(600).default(""),
      rewardCents: z.number().int().nonnegative().max(100_000_000).nullable().default(null),
      url: z.string().trim().max(1000).default(""),
      imageUrl: z.string().trim().max(1000).nullable().default(null),
      countries: z.string().trim().max(300).default("ALL"),
      featured: z.boolean().default(false),
      active: z.boolean().default(true),
      sortOrder: z.number().int().min(0).max(10000).default(0),
    }),
    response: z.object({ id: z.number() }),
    async handler(ctx, args) {
      await requireAdmin(ctx, args.adminToken);
      const db = ctx.db<typeof schema>();
      const values = {
        kind: args.kind,
        title: args.title,
        provider: args.provider,
        description: args.description,
        rewardCents: args.rewardCents,
        url: args.url,
        imageUrl: args.imageUrl,
        countries: args.countries || "ALL",
        featured: args.featured ? 1 : 0,
        active: args.active ? 1 : 0,
        sortOrder: args.sortOrder,
      };
      if (args.id) {
        await db
          .update(schema.contentItems)
          .set(values)
          .where(eq(schema.contentItems.id, args.id));
        ctx.invalidateQueries();
        return { id: args.id };
      }
      const inserted = await db
        .insert(schema.contentItems)
        .values(values)
        .returning({ id: schema.contentItems.id });
      const row = inserted[0];
      if (!row) throw new Error("Could not save the item.");
      ctx.invalidateQueries();
      return { id: row.id };
    },
  }),

  adminDeleteContent: defineAction({
    description: "Permanently removes an offerwall, survey or game for all users.",
    request: z.object({
      adminToken: z.string().min(1).max(200),
      id: z.number().int().positive(),
    }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      await requireAdmin(ctx, args.adminToken);
      const db = ctx.db<typeof schema>();
      await db
        .delete(schema.contentItems)
        .where(eq(schema.contentItems.id, args.id));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  adminListThreads: defineAction({
    description: "Admin inbox: every user help thread with unread counts and the latest message.",
    request: z.object({ adminToken: z.string().min(1).max(200) }),
    response: z.object({
      threads: z.array(
        z.object({
          userId: z.number(),
          userName: z.string(),
          userCode: z.string(),
          userEmail: z.string(),
          unread: z.number(),
          lastBody: z.string(),
          lastAt: z.string(),
        }),
      ),
    }),
    async handler(ctx, args) {
      await requireAdmin(ctx, args.adminToken);
      const db = ctx.db<typeof schema>();
      const msgs = await db
        .select()
        .from(schema.messages)
        .orderBy(desc(schema.messages.id))
        .limit(1000);
      const users = await db.select().from(schema.users);
      const byId = new Map(users.map((u) => [u.id, u]));
      const seen = new Map<number, (typeof msgs)[number]>();
      const unread = new Map<number, number>();
      for (const m of msgs) {
        if (!seen.has(m.userId)) seen.set(m.userId, m);
        if (m.sender === "user" && m.readByAdmin === 0)
          unread.set(m.userId, (unread.get(m.userId) ?? 0) + 1);
      }
      return {
        threads: [...seen.entries()].map(([userId, m]) => ({
          userId,
          userName: byId.get(userId)?.name ?? "User",
          userCode: byId.get(userId)?.userCode ?? "",
          userEmail: byId.get(userId)?.email ?? "",
          unread: unread.get(userId) ?? 0,
          lastBody: m.body.slice(0, 140),
          lastAt: m.createdAt.toISOString(),
        })),
      };
    },
  }),

  adminGetThread: defineAction({
    description: "One user's full help thread for the admin; marks user messages as read.",
    request: z.object({
      adminToken: z.string().min(1).max(200),
      userId: z.number().int().positive(),
    }),
    response: z.object({
      messages: z.array(
        z.object({
          id: z.number(),
          sender: z.enum(["user", "admin"]),
          subject: z.string(),
          body: z.string(),
          createdAt: z.string(),
        }),
      ),
    }),
    async handler(ctx, args) {
      await requireAdmin(ctx, args.adminToken);
      const db = ctx.db<typeof schema>();
      const rows = await db
        .select()
        .from(schema.messages)
        .where(eq(schema.messages.userId, args.userId))
        .orderBy(schema.messages.id)
        .limit(300);
      await db
        .update(schema.messages)
        .set({ readByAdmin: 1 })
        .where(
          and(
            eq(schema.messages.userId, args.userId),
            eq(schema.messages.sender, "user"),
          ),
        );
      return {
        messages: rows.map((m) => ({
          id: m.id,
          sender: m.sender,
          subject: m.subject,
          body: m.body,
          createdAt: m.createdAt.toISOString(),
        })),
      };
    },
  }),

  adminReply: defineAction({
    description: "Sends a mailbox reply from the admin to a user; it appears in the user's mailbox.",
    request: z.object({
      adminToken: z.string().min(1).max(200),
      userId: z.number().int().positive(),
      body: z.string().trim().min(1).max(2000),
    }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      await requireAdmin(ctx, args.adminToken);
      const db = ctx.db<typeof schema>();
      await db.insert(schema.messages).values({
        userId: args.userId,
        sender: "admin",
        subject: "",
        body: args.body,
        readByAdmin: 1,
        readByUser: 0,
      });
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  adminListPostbacks: defineAction({
    description: "Recent offerwall postback log: network, user, payout, credited amount and status.",
    request: z.object({
      adminToken: z.string().min(1).max(200),
      limit: z.number().int().positive().max(200).default(50),
    }),
    response: z.object({
      postbacks: z.array(
        z.object({
          id: z.number(),
          txnId: z.string(),
          network: z.string(),
          userCode: z.string().nullable(),
          payout: z.number(),
          creditedCents: z.number(),
          status: z.string(),
          createdAt: z.string(),
        }),
      ),
    }),
    async handler(ctx, args) {
      await requireAdmin(ctx, args.adminToken);
      const db = ctx.db<typeof schema>();
      const rows = await db
        .select({
          p: schema.postbacks,
          code: schema.users.userCode,
        })
        .from(schema.postbacks)
        .leftJoin(schema.users, eq(schema.postbacks.userId, schema.users.id))
        .orderBy(desc(schema.postbacks.id))
        .limit(args.limit);
      return {
        postbacks: rows.map((r) => ({
          id: r.p.id,
          txnId: r.p.txnId,
          network: r.p.network,
          userCode: r.code ?? null,
          payout: r.p.payout,
          creditedCents: r.p.creditedCents,
          status: r.p.status,
          createdAt: r.p.createdAt.toISOString(),
        })),
      };
    },
  }),

  adminGetUserStats: defineAction({
    description:
      "Admin Challenge stats per user: completed challenges, completed surveys (from credited postbacks), check-ins, referrals and total earnings for every user.",
    request: z.object({
      adminToken: z.string().min(1).max(200),
      limit: z.number().int().positive().max(200).default(100),
    }),
    response: z.object({
      totals: z.object({
        users: z.number(),
        challenges: z.number(),
        surveys: z.number(),
        checkins: z.number(),
        earnedCents: z.number(),
      }),
      users: z.array(
        z.object({
          userId: z.number(),
          userCode: z.string(),
          name: z.string(),
          email: z.string(),
          flagEmoji: z.string().nullable(),
          countryName: z.string().nullable(),
          challengesCompleted: z.number(),
          surveysCompleted: z.number(),
          offersCompleted: z.number(),
          checkins: z.number(),
          checkinCents: z.number(),
          contestPrizeCents: z.number(),
          referrals: z.number(),
          totalEarnedCents: z.number(),
          balanceCents: z.number(),
        }),
      ),
    }),
    async handler(ctx, args) {
      await requireAdmin(ctx, args.adminToken);
      const db = ctx.db<typeof schema>();
      const allUsers = await db
        .select()
        .from(schema.users)
        .orderBy(desc(schema.users.totalEarnedCents))
        .limit(args.limit);
      const credited = await db
        .select()
        .from(schema.postbacks)
        .where(eq(schema.postbacks.status, "credited"))
        .limit(10000);
      const allCheckins = await db.select().from(schema.checkins).limit(10000);
      const offersByUser = new Map<number, number>();
      const surveysByUser = new Map<number, number>();
      for (const pb of credited) {
        if (pb.userId == null) continue;
        offersByUser.set(pb.userId, (offersByUser.get(pb.userId) ?? 0) + 1);
        if (isSurveyNetwork(pb.network))
          surveysByUser.set(pb.userId, (surveysByUser.get(pb.userId) ?? 0) + 1);
      }
      const checkinsByUser = new Map<number, { count: number; cents: number }>();
      for (const c of allCheckins) {
        const cur = checkinsByUser.get(c.userId) ?? { count: 0, cents: 0 };
        cur.count += 1;
        cur.cents += c.amountCents;
        checkinsByUser.set(c.userId, cur);
      }
      const referralCounts = new Map<number, number>();
      const everyone = await db.select().from(schema.users);
      for (const u of everyone) {
        if (u.referredById != null)
          referralCounts.set(u.referredById, (referralCounts.get(u.referredById) ?? 0) + 1);
      }
      const prizeTxns = await db
        .select()
        .from(schema.transactions)
        .where(eq(schema.transactions.kind, "contest_prize"))
        .limit(10000);
      const prizeByUser = new Map<number, number>();
      for (const tx of prizeTxns)
        prizeByUser.set(tx.userId, (prizeByUser.get(tx.userId) ?? 0) + tx.amountCents);
      const users = allUsers.map((u) => {
        const offers = offersByUser.get(u.id) ?? 0;
        const surveys = surveysByUser.get(u.id) ?? 0;
        const ci = checkinsByUser.get(u.id) ?? { count: 0, cents: 0 };
        return {
          userId: u.id,
          userCode: u.userCode,
          name: u.name,
          email: u.email,
          flagEmoji: u.flagEmoji ?? null,
          countryName: u.countryName ?? null,
          challengesCompleted: offers - surveys,
          surveysCompleted: surveys,
          offersCompleted: offers,
          checkins: ci.count,
          checkinCents: ci.cents,
          contestPrizeCents: prizeByUser.get(u.id) ?? 0,
          referrals: referralCounts.get(u.id) ?? 0,
          totalEarnedCents: u.totalEarnedCents,
          balanceCents: u.balanceCents,
        };
      });
      return {
        totals: {
          users: users.length,
          challenges: users.reduce((s, u) => s + u.challengesCompleted, 0),
          surveys: users.reduce((s, u) => s + u.surveysCompleted, 0),
          checkins: users.reduce((s, u) => s + u.checkins, 0),
          earnedCents: users.reduce((s, u) => s + u.totalEarnedCents, 0),
        },
        users,
      };
    },
  }),

  adminListBannedCountries: defineAction({
    description:
      "Lists banned countries (no new accounts can be created from them) plus countries seen from existing users, so the owner can ban or unban any country.",
    request: z.object({ adminToken: z.string().min(1).max(200) }),
    response: z.object({
      banned: z.array(
        z.object({
          id: z.number(),
          countryCode: z.string(),
          countryName: z.string(),
          flagEmoji: z.string().nullable(),
          createdAt: z.string(),
        }),
      ),
      knownCountries: z.array(
        z.object({
          countryCode: z.string(),
          countryName: z.string(),
          flagEmoji: z.string().nullable(),
          userCount: z.number(),
          banned: z.boolean(),
        }),
      ),
    }),
    async handler(ctx, args) {
      await requireAdmin(ctx, args.adminToken);
      const db = ctx.db<typeof schema>();
      const bannedRows = await db
        .select()
        .from(schema.bannedCountries)
        .orderBy(schema.bannedCountries.countryName);
      const bannedSet = new Set(bannedRows.map((b) => b.countryCode.toUpperCase()));
      const allUsers = await db.select().from(schema.users);
      const map = new Map<
        string,
        { countryCode: string; countryName: string; flagEmoji: string | null; userCount: number }
      >();
      for (const u of allUsers) {
        if (!u.countryCode) continue;
        const code = u.countryCode.toUpperCase();
        const existing = map.get(code);
        if (existing) existing.userCount += 1;
        else
          map.set(code, {
            countryCode: code,
            countryName: u.countryName ?? code,
            flagEmoji: u.flagEmoji ?? flagFromCountryCode(code),
            userCount: 1,
          });
      }
      // Also surface banned countries that have no users yet in known list.
      for (const b of bannedRows) {
        const code = b.countryCode.toUpperCase();
        if (!map.has(code)) {
          map.set(code, {
            countryCode: code,
            countryName: b.countryName || code,
            flagEmoji: b.flagEmoji ?? flagFromCountryCode(code),
            userCount: 0,
          });
        }
      }
      return {
        banned: bannedRows.map((b) => ({
          id: b.id,
          countryCode: b.countryCode,
          countryName: b.countryName,
          flagEmoji: b.flagEmoji ?? null,
          createdAt: b.createdAt.toISOString(),
        })),
        knownCountries: [...map.values()]
          .sort((a, b) => a.countryName.localeCompare(b.countryName))
          .map((k) => ({ ...k, banned: bannedSet.has(k.countryCode) })),
      };
    },
  }),

  adminBanCountry: defineAction({
    description:
      "Bans a country: stored on the server, so no new account can be created from that country until it is unbanned.",
    request: z.object({
      adminToken: z.string().min(1).max(200),
      countryCode: z.string().trim().min(2).max(2),
      countryName: z.string().trim().max(120).default(""),
      flagEmoji: z.string().trim().max(16).optional(),
    }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      await requireAdmin(ctx, args.adminToken);
      const db = ctx.db<typeof schema>();
      const code = args.countryCode.toUpperCase();
      const flag = args.flagEmoji?.trim() ? args.flagEmoji.trim() : flagFromCountryCode(code);
      const existing = await findBannedCountry(db, code);
      if (!existing) {
        await db.insert(schema.bannedCountries).values({
          countryCode: code,
          countryName: args.countryName.trim() || code,
          flagEmoji: flag,
        });
      } else if (args.countryName.trim()) {
        await db
          .update(schema.bannedCountries)
          .set({ countryName: args.countryName.trim(), flagEmoji: flag ?? existing.flagEmoji })
          .where(eq(schema.bannedCountries.id, existing.id));
      }
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  adminUnbanCountry: defineAction({
    description:
      "Unbans a country: signups from that country work again immediately.",
    request: z.object({
      adminToken: z.string().min(1).max(200),
      countryCode: z.string().trim().min(2).max(2),
    }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      await requireAdmin(ctx, args.adminToken);
      const db = ctx.db<typeof schema>();
      await db
        .delete(schema.bannedCountries)
        .where(eq(schema.bannedCountries.countryCode, args.countryCode.toUpperCase()));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  adminListNotifications: defineAction({
    description:
      "Admin notifications inbox: every new registration with the user's name, email, country, flag and IP, newest first.",
    request: z.object({
      adminToken: z.string().min(1).max(200),
      limit: z.number().int().positive().max(200).default(100),
    }),
    response: z.object({
      unreadCount: z.number(),
      notifications: z.array(
        z.object({
          id: z.number(),
          type: z.string(),
          userId: z.number().nullable(),
          userName: z.string(),
          userEmail: z.string(),
          userCode: z.string(),
          countryCode: z.string().nullable(),
          countryName: z.string().nullable(),
          flagEmoji: z.string().nullable(),
          ip: z.string().nullable(),
          read: z.boolean(),
          createdAt: z.string(),
        }),
      ),
    }),
    async handler(ctx, args) {
      await requireAdmin(ctx, args.adminToken);
      const db = ctx.db<typeof schema>();
      const rows = await db
        .select()
        .from(schema.adminNotifications)
        .orderBy(desc(schema.adminNotifications.id))
        .limit(args.limit);
      const all = await db.select().from(schema.adminNotifications);
      return {
        unreadCount: all.filter((n) => n.read === 0).length,
        notifications: rows.map((n) => ({
          id: n.id,
          type: n.type,
          userId: n.userId ?? null,
          userName: n.userName,
          userEmail: n.userEmail,
          userCode: n.userCode,
          countryCode: n.countryCode ?? null,
          countryName: n.countryName ?? null,
          flagEmoji: n.flagEmoji ?? null,
          ip: n.ip ?? null,
          read: n.read === 1,
          createdAt: n.createdAt.toISOString(),
        })),
      };
    },
  }),

  adminMarkNotificationsRead: defineAction({
    description: "Marks admin notifications as read — one notification, or all when no id is given.",
    request: z.object({
      adminToken: z.string().min(1).max(200),
      notificationId: z.number().int().positive().optional(),
    }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      await requireAdmin(ctx, args.adminToken);
      const db = ctx.db<typeof schema>();
      if (args.notificationId) {
        await db
          .update(schema.adminNotifications)
          .set({ read: 1 })
          .where(eq(schema.adminNotifications.id, args.notificationId));
      } else {
        await db.update(schema.adminNotifications).set({ read: 1 });
      }
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  adminUpdateSettings: defineAction({
    description:
      "Updates site settings: Google client ID, contest pools, minimum withdrawal, revenue share, affiliate rates, postback secret, TheoremReach secret key, the weekly check-in goal + 7 day rewards, the Daily and Affiliate contest prize tiers, the level pace and title table, and the admin username/password.",
    request: z.object({
      adminToken: z.string().min(1).max(200),
      googleClientId: z.string().trim().max(300).optional(),
      dailyPoolCents: z.number().int().nonnegative().max(100_000_000).optional(),
      affiliatePoolCents: z.number().int().nonnegative().max(100_000_000).optional(),
      minWithdrawCents: z.number().int().nonnegative().max(100_000_000).optional(),
      userSharePct: z.number().int().min(1).max(100).optional(),
      affiliateEarningPct: z.number().int().min(0).max(100).optional(),
      affiliateSpendingPct: z.number().int().min(0).max(100).optional(),
      postbackSecret: z.string().max(200).optional(),
      theoremReachSecret: z.string().max(200).optional(),
      checkinBonusCents: z.number().int().min(0).max(100000).optional(),
      levelRewardCents: z.number().int().min(0).max(100000).optional(),
      checkinGoalCents: z.number().int().min(1).max(1_000_000).optional(),
      checkinRewardsCents: z
        .array(z.number().int().min(0).max(100_000))
        .length(7)
        .optional(),
      dailyTiersCents: z
        .array(z.number().int().min(0).max(100_000_000))
        .min(1)
        .max(150)
        .optional(),
      affiliateTiersCents: z
        .array(z.number().int().min(0).max(100_000_000))
        .min(1)
        .max(100)
        .optional(),
      levelCentsPerLevel: z.number().int().min(1).max(1_000_000).optional(),
      levelTitles: z
        .array(
          z.object({
            name: z.string().trim().min(1).max(30),
            level: z.number().int().min(1).max(1_000_000),
            standardPct: z.number().int().min(0).max(100),
            enhancedPct: z.number().int().min(0).max(100),
          }),
        )
        .min(1)
        .max(8)
        .optional(),
      socialDiscord: z.string().trim().max(500).optional(),
      socialYoutube: z.string().trim().max(500).optional(),
      socialTiktok: z.string().trim().max(500).optional(),
      socialTwitter: z.string().trim().max(500).optional(),
      socialFacebook: z.string().trim().max(500).optional(),
      socialInstagram: z.string().trim().max(500).optional(),
      socialTelegram: z.string().trim().max(500).optional(),
      adminUsername: z.string().trim().min(3).max(80).optional(),
      adminPassword: z.string().min(6).max(200).optional(),
    }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      await requireAdmin(ctx, args.adminToken);
      const db = ctx.db<typeof schema>();
      const updates: [string, string][] = [];
      if (args.googleClientId !== undefined)
        updates.push(["google_client_id", args.googleClientId]);
      if (args.dailyPoolCents !== undefined)
        updates.push(["daily_pool_cents", String(args.dailyPoolCents)]);
      if (args.affiliatePoolCents !== undefined)
        updates.push(["affiliate_pool_cents", String(args.affiliatePoolCents)]);
      if (args.minWithdrawCents !== undefined)
        updates.push(["min_withdraw_cents", String(args.minWithdrawCents)]);
      if (args.userSharePct !== undefined)
        updates.push(["user_share_pct", String(args.userSharePct)]);
      if (args.affiliateEarningPct !== undefined)
        updates.push(["affiliate_earning_pct", String(args.affiliateEarningPct)]);
      if (args.affiliateSpendingPct !== undefined)
        updates.push(["affiliate_spending_pct", String(args.affiliateSpendingPct)]);
      if (args.postbackSecret !== undefined)
        updates.push(["postback_secret", args.postbackSecret]);
      if (args.theoremReachSecret !== undefined)
        updates.push(["theoremreach_secret", args.theoremReachSecret]);
      if (args.checkinBonusCents !== undefined)
        updates.push(["checkin_bonus_cents", String(args.checkinBonusCents)]);
      if (args.levelRewardCents !== undefined)
        updates.push(["level_reward_cents", String(args.levelRewardCents)]);
      if (args.checkinGoalCents !== undefined)
        updates.push(["checkin_goal_cents", String(args.checkinGoalCents)]);
      if (args.checkinRewardsCents !== undefined)
        updates.push(["checkin_rewards_cents", args.checkinRewardsCents.join(",")]);
      if (args.dailyTiersCents !== undefined)
        updates.push(["daily_tiers_cents", args.dailyTiersCents.join(",")]);
      if (args.affiliateTiersCents !== undefined)
        updates.push(["affiliate_tiers_cents", args.affiliateTiersCents.join(",")]);
      if (args.levelCentsPerLevel !== undefined)
        updates.push(["level_cents_per_level", String(args.levelCentsPerLevel)]);
      if (args.levelTitles !== undefined) {
        // Title levels must strictly increase, or the table is
        // meaningless — refuse the save instead of storing a bad one.
        for (let i = 1; i < args.levelTitles.length; i++) {
          if ((args.levelTitles[i]?.level ?? 0) <= (args.levelTitles[i - 1]?.level ?? 0))
            throw new Error("Title levels must increase from one title to the next.");
        }
        updates.push(["level_titles_json", JSON.stringify(args.levelTitles)]);
      }
      const socialArgs: [string | undefined, string][] = [
        [args.socialDiscord, "social_discord"],
        [args.socialYoutube, "social_youtube"],
        [args.socialTiktok, "social_tiktok"],
        [args.socialTwitter, "social_twitter"],
        [args.socialFacebook, "social_facebook"],
        [args.socialInstagram, "social_instagram"],
        [args.socialTelegram, "social_telegram"],
      ];
      for (const [value, key] of socialArgs) {
        if (value !== undefined) updates.push([key, value]);
      }
      if (args.adminUsername !== undefined)
        updates.push(["admin_username", args.adminUsername]);
      if (args.adminPassword !== undefined)
        updates.push(["admin_password", args.adminPassword]);
      for (const [key, value] of updates) {
        await db
          .insert(schema.settings)
          .values({ key, value })
          .onConflictDoUpdate({
            target: schema.settings.key,
            set: { value },
          });
      }
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  adminGetDeployInfo: defineAction({
    description:
      "Admin GitHub & deploy checklist data: the target GitHub repo and the live configuration values a host needs (Google Client ID, admin username, postback secret state, money settings). The admin password is never returned.",
    request: z.object({ adminToken: z.string().min(1).max(200) }),
    response: z.object({
      repoUrl: z.string(),
      googleClientId: z.string(),
      adminUsername: z.string(),
      postbackSecretSet: z.boolean(),
      dailyPoolCents: z.number(),
      affiliatePoolCents: z.number(),
      minWithdrawCents: z.number(),
      userSharePct: z.number(),
      affiliateEarningPct: z.number(),
      affiliateSpendingPct: z.number(),
    }),
    async handler(ctx, args) {
      await requireAdmin(ctx, args.adminToken);
      const db = ctx.db<typeof schema>();
      const settings = await getSettings(db);
      return {
        // The owner's GitHub repo for this app (created by the owner,
        // public). The code is pushed there from a computer with git —
        // the panel only shows the checklist and the live values.
        repoUrl: "https://github.com/ahmeetrades-coder/tapone",
        googleClientId: settings["google_client_id"] ?? "",
        adminUsername: settings["admin_username"] ?? "",
        postbackSecretSet: (settings["postback_secret"] ?? "") !== "",
        dailyPoolCents: settingInt(settings, "daily_pool_cents"),
        affiliatePoolCents: settingInt(settings, "affiliate_pool_cents"),
        minWithdrawCents: settingInt(settings, "min_withdraw_cents"),
        userSharePct: settingInt(settings, "user_share_pct"),
        affiliateEarningPct: settingInt(settings, "affiliate_earning_pct"),
        affiliateSpendingPct: settingInt(settings, "affiliate_spending_pct"),
      };
    },
  }),
} satisfies ActionsModule;
