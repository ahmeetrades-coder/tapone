// TapOne actions: Google / email sign-in with IP/country lock
// (VPN connections are allowed since 2026-11-27 — owner order:
// a VPN sign-up must create the account; the offerwalls reject such
// users' offers themselves), content (offerwalls / surveys / games)
// (offerwalls / surveys / games) managed by the admin and read by everyone,
// dollar withdrawals by country, admin approve/reject, help + live chat,
// affiliate commissions, and the offerwall postback endpoint.

import {
defineAction,
z,
type ActionsModule,
type Ctx,
} from "@hatch/space-sdk";
import { and, desc, eq, gt, gte, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import * as schema from "./schema";
import { createHash, randomBytes, randomInt, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);

type DB = ReturnType<Ctx["db"]>;

// ---------------------------------------------------------------- settings

const DEFAULT_SETTINGS: Record<string, string> = {
  google_client_id:
    "34580127521-1jbjmo47er7e64jd42s4b13m2kkje2r1.apps.googleusercontent.com",
  admin_username: "admin",
  admin_password: "tapone-admin-2026",
  min_withdraw_cents: "500",
  user_share_pct: "70",
  affiliate_earning_pct: "8",
  affiliate_spending_pct: "5",
  postback_secret: "",
  // TheoremReach app Secret Key (publisher dashboard → app details).
  // Used ONLY to verify the HMAC-SHA1 signature on TheoremReach reward
  // callbacks; empty = callbacks are accepted unverified (not safe).
  theoremreach_secret: "",
  // Offerwall.GG JSON API secret key (Offerwall.GG dashboard -> API).
  // Server-only: never sent to any client. Used ONLY as the
  // X-Api-Key header when fetching the Offerwall.GG games feed.
  // Empty = the Games tab shows no Offerwall.GG games (and no error).
  offerwallgg_api_key: "",
  // PubScale S2S secret key (PubScale dashboard → Settings → API Key,
  // provided along with the App API key). Used ONLY to verify the MD5
  // signature on PubScale reward callbacks; empty = PubScale callbacks
  // are refused (never credited unverified).
  pubscale_secret_key: "",
  checkin_bonus_cents: "5",
  level_reward_cents: "50",
  // Weekly check-in (owner-editable in Admin → Settings → Money): the
  // daily earnings goal and the 7 calendar-day rewards Mon..Sun, in
  // cents. Defaults are the owner's decided ladder ($3.00/week total).
  checkin_goal_cents: "100",
  checkin_rewards_cents: "20,25,30,40,50,65,70",
  // Levels (owner-editable in Admin → Settings → Levels & Title
  // Rewards): cents of lifetime earnings per level, and the title
  // table as JSON [{name, level, standardPct, enhancedPct,
  // rewardCents}]. Empty JSON = the built-in table below (unlock
  // levels RewardJoy-verified; rewards the owner's $1,000 split).
  level_cents_per_level: "100",
  level_titles_json: "",
  // Daily Contest (owner-approved 2026-11-26, Admin → Settings →
  // Money): the total prize pool paid out every day, in cents.
  // Default $20.00. The owner can lower or raise it; the ladder
  // below rescales proportionally (dailyContestLadder).
  daily_contest_total_cents: "2000",
  // Built-in withdraw methods per country, as JSON
  // { "PK": ["easypaisa", ...], "DEFAULT": [...] } written from
  // Admin → Withdraw Methods. Empty = the built-in table in code
  // (METHODS_BY_COUNTRY). A country key present here REPLACES that
  // country's built-in set, so the owner can add/remove built-in
  // methods per country without a redeploy.
  withdraw_methods_json: "",
};

async function getSettings(db: DB): Promise<Record<string, string>> {
  const rows = await db.select().from(schema.settings);
  const out: Record<string, string> = { ...DEFAULT_SETTINGS };
  for (const row of rows) out[row.key] = row.value;
  return out;
}

// Social links — the owner's social channels, shown with their logo
// in the Redeem Code section (and as text pills in the public footer).
// The list is stored as JSON in the `social_links_json` setting:
// [{ id, label, url, imageUrl, active }] — fully admin-managed (add /
// remove / edit / show / hide), no hard-coded list. When no JSON has
// been saved yet, the list is seeded from the legacy `social_*`
// settings keys, so links the owner already saved keep working: only
// Facebook is shown (active = 1) — TikTok, Twitter, YouTube and the
// rest start hidden (owner order 2026-11-27: "abhi sirf Facebook
// dena"). Default logo images come from the Simple Icons CDN
// (cdn.simpleicons.org — verified 200 for every slug below); the
// owner can replace any image link from the Admin panel.
const SOCIAL_PLATFORMS: { id: string; label: string; key: string }[] = [
  { id: "discord", label: "Discord", key: "social_discord" },
  { id: "twitter", label: "X", key: "social_twitter" },
  { id: "telegram", label: "Telegram", key: "social_telegram" },
  { id: "facebook", label: "Facebook", key: "social_facebook" },
  { id: "youtube", label: "YouTube", key: "social_youtube" },
  { id: "tiktok", label: "TikTok", key: "social_tiktok" },
  { id: "instagram", label: "Instagram", key: "social_instagram" },
];

const SOCIAL_ICON_SLUGS: Record<string, string> = {
  discord: "discord",
  twitter: "x",
  telegram: "telegram",
  facebook: "facebook",
  youtube: "youtube",
  tiktok: "tiktok",
  instagram: "instagram",
};

export type SocialLink = {
  id: string;
  label: string;
  url: string;
  imageUrl: string;
  active: number;
};

function defaultSocialImage(id: string): string {
  return `https://cdn.simpleicons.org/${SOCIAL_ICON_SLUGS[id] ?? id}`;
}

function normalizeSocialLink(raw: unknown): SocialLink | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === "string" ? r.id.trim().toLowerCase() : "";
  if (!/^[a-z0-9][a-z0-9_-]{0,29}$/.test(id)) return null;
  const label = typeof r.label === "string" ? r.label.trim().slice(0, 30) : "";
  if (!label) return null;
  const url = typeof r.url === "string" ? r.url.trim().slice(0, 500) : "";
  const imageUrl =
    typeof r.imageUrl === "string" && r.imageUrl.trim() !== ""
      ? r.imageUrl.trim().slice(0, 500)
      : defaultSocialImage(id);
  return {
    id,
    label,
    url,
    imageUrl,
    active: r.active === 0 || r.active === false ? 0 : 1,
  };
}

// The full admin-managed list (every entry, even one with no URL yet
// and even a hidden one — the Admin editor needs them all). Falls back
// to the legacy per-platform settings keys when no JSON is saved yet.
function parseSocialLinks(settings: Record<string, string>): SocialLink[] {
  const raw = (settings["social_links_json"] ?? "").trim();
  if (raw !== "") {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const links = parsed
          .map(normalizeSocialLink)
          .filter((l): l is SocialLink => l !== null)
          .slice(0, 50);
        if (links.length > 0) return links;
      }
    } catch {
      // Corrupt JSON: fall through to the legacy seed below.
    }
  }
  // Seed from the legacy social_* keys. Only Facebook is shown — the
  // owner decides the rest from the Admin panel.
  return SOCIAL_PLATFORMS.map((s) => ({
    id: s.id,
    label: s.label,
    url: (settings[s.key] ?? "").trim(),
    imageUrl: defaultSocialImage(s.id),
    active: s.id === "facebook" ? 1 : 0,
  }));
}

// What getPublicHome returns: every link that has a URL (same rule as
// before, so the public footer keeps showing every saved link). The
// Redeem Code section filters on `active` itself; the footer does not.
function socialLinksFrom(settings: Record<string, string>) {
  return parseSocialLinks(settings).map((s) => ({
    platform: s.id,
    label: s.label,
    url: s.url,
    imageUrl: s.imageUrl,
    active: s.active,
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

// A user may change their display name at most 3 times in the whole
// life of the account (owner rule 2026-11-21). The count lives on the
// user row (users.name_changes); at the limit the name is locked.
const MAX_NAME_CHANGES = 3;

function nameChangesLeft(u: UserRow): number {
  return Math.max(0, MAX_NAME_CHANGES - u.nameChanges);
}

// Usernames are UNIQUE, case-insensitively (owner order 2026-11-27):
// no two accounts may hold the same username, however it is cased
// ("Nexon" and "nexon" are the same username). The check is code-only
// on purpose — there is NO unique DB constraint, so names that already
// exist in duplicate can never break a migration or a deploy.
async function isUsernameTaken(
  db: DB,
  username: string,
  excludeUserId?: number,
): Promise<boolean> {
  const rows = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(sql`lower(${schema.users.name}) = ${username.toLowerCase()}`)
    .limit(1);
  const found = rows[0];
  if (!found) return false;
  if (excludeUserId !== undefined && found.id === excludeUserId) return false;
  return true;
}

// Returns a username that is free, appending a number (2, 3, …) when
// the base is taken. Used for names the user did not choose — the
// email-prefix default at email sign-up and the Google account name
// at Google sign-up — so a sign-up is never blocked by a collision
// and never creates a duplicate.
async function uniqueUsername(db: DB, base: string): Promise<string> {
  const clean = base.trim() || "TapOne User";
  if (!(await isUsernameTaken(db, clean))) return clean;
  const stem = clean.length > 38 ? clean.slice(0, 38) : clean;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${stem}${n}`;
    if (!(await isUsernameTaken(db, candidate))) return candidate;
  }
  return `${stem}${Date.now() % 100000}`;
}

function publicUser(u: UserRow, titles: readonly TitleDef[] = DEFAULT_TITLES) {
  return {
    id: u.id,
    userCode: u.userCode,
    // The user's OWN unique Offer Token (shown on their Profile; every
    // user has a different one). Falls back to the user code only for
    // rows created before the offer_token column existed.
    offerToken: u.offerToken ?? u.userCode,
    name: u.name,
    nameChangesLeft: nameChangesLeft(u),
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

// ------------------------------------------------------- outbound help email
//
// Every new Help appeal is also emailed to the business inbox
// (info@tapone.store). There is no SMTP server in this stack, so mail is
// sent with the Resend HTTP API (plain fetch — no new dependency).
// BLOCKED ON KEY: this only runs when RESEND_API_KEY is set in the
// server environment (FadeHost → environment variables). Without the key
// the appeal is still saved and still shows in the admin Inbox — the
// email step is skipped and a warning is logged, never a user-facing
// failure. The owner creates the key at resend.com (free tier) and sets
// RESEND_API_KEY; HELP_EMAIL overrides the destination if ever needed.
const HELP_EMAIL_TO =
  process.env.HELP_EMAIL?.trim() || "info@tapone.store";

async function notifyHelpByEmail(args: {
  userName: string;
  userEmail: string;
  subject: string;
  body: string;
  imageUrl: string | null;
  messageId: number;
}): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    console.warn(
      "[tapone] RESEND_API_KEY is not set — help appeal #" +
        args.messageId +
        " was saved but NOT emailed to " +
        HELP_EMAIL_TO +
        ". Set RESEND_API_KEY in the server environment to enable it.",
    );
    return;
  }
  const esc = (s: string) =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  const subjectLine =
    "New Help appeal" +
    (args.subject ? ": " + args.subject : "") +
    " — " +
    args.userName;
  const text =
    "A user sent a new Help appeal on TapOne.\n\n" +
    "User: " +
    args.userName +
    " <" +
    args.userEmail +
    ">\n" +
    "Subject: " +
    (args.subject || "(none)") +
    "\n\n" +
    args.body +
    "\n\n" +
    (args.imageUrl
      ? "Attached image: " + args.imageUrl + "\n\n"
      : "") +
    "Status: Pending — approve it in Admin → Inbox after solving it.";
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "TapOne <info@tapone.store>",
        to: [HELP_EMAIL_TO],
        subject: subjectLine,
        text,
        html:
          "<p>A user sent a new Help appeal on TapOne.</p>" +
          "<p><strong>User:</strong> " +
          esc(args.userName) +
          " &lt;" +
          esc(args.userEmail) +
          "&gt;</p>" +
          "<p><strong>Subject:</strong> " +
          esc(args.subject || "(none)") +
          "</p>" +
          "<p>" +
          esc(args.body).replace(/\n/g, "<br>") +
          "</p>" +
          (args.imageUrl
            ? '<p><strong>Attached image:</strong> <a href="' +
              esc(args.imageUrl) +
              '">view image</a></p>'
            : "") +
          "<p><strong>Status:</strong> Pending — approve it in Admin → Inbox after solving it.</p>",
      }),
    });
    if (!res.ok) {
      console.warn(
        "[tapone] Help email to " +
          HELP_EMAIL_TO +
          " failed (" +
          res.status +
          "): " +
          (await res.text()).slice(0, 300),
      );
    }
  } catch (e) {
    console.warn(
      "[tapone] Help email to " + HELP_EMAIL_TO + " failed: " + String(e),
    );
  }
}

// ------------------------------------------------------- outbound help reply
//
// When the admin replies to a Help appeal from Admin → Inbox, the reply
// is emailed DIRECTLY to the user, from the business address
// info@tapone.store. There is no in-site Mailbox any more (owner order
// 2026-11-26): the user sees only a note in Help — "Your reply will be
// sent to your email by TapOne." — and the reply itself lands in their
// email inbox. Best effort like notifyHelpByEmail: a mail failure never
// loses the reply itself (it is still saved in the admin Inbox thread).
async function notifyHelpReplyByEmail(args: {
  userName: string;
  userEmail: string;
  subject: string;
  body: string;
}): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    console.warn(
      "[tapone] RESEND_API_KEY is not set — help reply to " +
        args.userEmail +
        " was saved but NOT emailed. Set RESEND_API_KEY in the server environment to enable it.",
    );
    return;
  }
  const esc = (s: string) =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  const subjectLine =
    "TapOne Help — reply to your message" +
    (args.subject ? ": " + args.subject : "");
  const text =
    "Hi " +
    args.userName +
    ",\n\n" +
    args.body +
    "\n\n— The TapOne team\n\n(You sent a Help message on TapOne; this is our reply.)";
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "TapOne <info@tapone.store>",
        to: [args.userEmail],
        subject: subjectLine,
        text,
        html:
          "<p>" +
          esc(args.body).replace(/\n/g, "<br>") +
          "</p>" +
          "<p>— The TapOne team</p>" +
          "<p><small>You sent a Help message on TapOne; this is our reply.</small></p>",
      }),
    });
    if (!res.ok) {
      console.warn(
        "[tapone] Help reply email to " +
          args.userEmail +
          " failed (" +
          res.status +
          "): " +
          (await res.text()).slice(0, 300),
      );
    }
  } catch (e) {
    console.warn(
      "[tapone] Help reply email to " +
        args.userEmail +
        " failed: " +
        String(e),
    );
  }
}

// ------------------------------------------------- email + password login
//
// Email sign-up / login (owner order 2026-11-27) sits next to Google
// on the login page. Passwords are stored ONLY as a
// scrypt hash (salt + hash, never the password itself). A new email
// account activates ONLY after the owner of the address types the
// 6-digit code sent to that address; the code itself is never stored
// — only its SHA-256 hash — and it lives 15 minutes with 5 wrong
// attempts. Codes are sent with the same Resend setup as the Help
// mail, from the same business address (info@tapone.store).

const EMAIL_CODE_TTL_MS = 15 * 60 * 1000;
const EMAIL_CODE_MAX_ATTEMPTS = 5;
const EMAIL_CODE_RESEND_MS = 60 * 1000;

function normalizeEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  if (email.length > 254) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = (await scryptAsync(password, salt, 64)) as Buffer;
  return `scrypt$v1$${salt.toString("hex")}$${hash.toString("hex")}`;
}

async function verifyPassword(
  password: string,
  stored: string | null,
): Promise<boolean> {
  if (!stored) return false;
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "scrypt" || parts[1] !== "v1")
    return false;
  try {
    const salt = Buffer.from(parts[2] ?? "", "hex");
    const expected = Buffer.from(parts[3] ?? "", "hex");
    if (salt.length === 0 || expected.length === 0) return false;
    const hash = (await scryptAsync(password, salt, expected.length)) as Buffer;
    if (hash.length !== expected.length) return false;
    return timingSafeEqual(hash, expected);
  } catch {
    return false;
  }
}

/** Plain Resend send, shared by the code mails below. Best effort:
 *  returns false (and logs) when the key is missing or the send
 *  fails — the caller turns that into a user-facing message. */
async function sendResendEmail(args: {
  to: string;
  subject: string;
  text: string;
  html: string;
}): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    console.warn(
      "[tapone] RESEND_API_KEY is not set — email to " +
        args.to +
        " was NOT sent. Set RESEND_API_KEY in the server environment to enable it.",
    );
    return false;
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "TapOne <info@tapone.store>",
        to: [args.to],
        subject: args.subject,
        text: args.text,
        html: args.html,
      }),
    });
    if (!res.ok) {
      console.warn(
        "[tapone] Email to " +
          args.to +
          " failed (" +
          res.status +
          "): " +
          (await res.text()).slice(0, 300),
      );
      return false;
    }
    return true;
  } catch (e) {
    console.warn("[tapone] Email to " + args.to + " failed: " + String(e));
    return false;
  }
}

/** What a 6-digit code is for. Only two purposes exist: "signup"
 *  (email sign-up verification) and "reset" (forgot-password reset).
 *  The Profile change-password flow — and its "change" purpose — were
 *  removed completely by owner order 2026-11-27, so no code is ever
 *  issued or checked for it any more. One live code per (email,
 *  purpose), so the two flows never overwrite each other's codes. */
type EmailCodePurpose = "signup" | "reset";

function sendVerificationCodeEmail(
  email: string,
  code: string,
  purpose: EmailCodePurpose,
): Promise<boolean> {
  const subject =
    purpose === "reset"
      ? "Your TapOne password reset code"
      : "Your TapOne verification code";
  const line =
    purpose === "reset"
      ? "You asked to reset your TapOne password. Use this code to set a new password:"
      : "Use this code to verify your email and activate your TapOne account:";
  return sendResendEmail({
    to: email,
    subject,
    text:
      "Hi,\n\n" +
      line +
      "\n\n" +
      code +
      "\n\nThis code expires in 15 minutes. If you did not ask for this, ignore this email.\n\n— The TapOne team",
    html:
      "<p>Hi,</p><p>" +
      line +
      "</p><p style=\"font-size:24px;font-weight:bold;letter-spacing:4px;\">" +
      code +
      "</p><p>This code expires in 15 minutes. If you did not ask for this, ignore this email.</p><p>— The TapOne team</p>",
  });
}

/**
 * Issues a fresh 6-digit code for (email, purpose): deletes every
 * older row for that pair, stores only the SHA-256 hash, and emails
 * the code. Returns "sent" when the mail went out, "unavailable"
 * when Resend is not set up or the send failed, and "too_soon" when
 * a code was sent less than a minute ago (the caller tells the user
 * to wait — no second mail is sent).
 */
async function issueEmailCode(
  db: DB,
  email: string,
  purpose: EmailCodePurpose,
): Promise<"sent" | "unavailable" | "too_soon"> {
  const now = new Date();
  const prior = await db
    .select()
    .from(schema.emailVerifications)
    .where(
      and(
        eq(schema.emailVerifications.email, email),
        eq(schema.emailVerifications.purpose, purpose),
      ),
    )
    .orderBy(desc(schema.emailVerifications.id))
    .limit(1);
  if (
    prior[0] &&
    now.getTime() - prior[0].createdAt.getTime() < EMAIL_CODE_RESEND_MS
  ) {
    return "too_soon";
  }
  const code = String(randomInt(100000, 1000000));
  await db
    .delete(schema.emailVerifications)
    .where(
      and(
        eq(schema.emailVerifications.email, email),
        eq(schema.emailVerifications.purpose, purpose),
      ),
    );
  await db.insert(schema.emailVerifications).values({
    email,
    codeHash: createHash("sha256").update(code).digest("hex"),
    purpose,
    attempts: 0,
    expiresAt: new Date(now.getTime() + EMAIL_CODE_TTL_MS),
  });
  const sent = await sendVerificationCodeEmail(email, code, purpose);
  return sent ? "sent" : "unavailable";
}

type CodeCheck = "ok" | "not_found" | "expired" | "wrong" | "too_many";

/** Deletes every code row for (email, purpose). Used whenever a code
 *  reaches a terminal outcome (used, expired, or guessed too many
 *  times) so no older code for the same address stays live behind
 *  it — a code is a single-factor credential, and only the newest
 *  one may ever work. */
async function deleteCodes(
  db: DB,
  email: string,
  purpose: EmailCodePurpose,
): Promise<void> {
  await db
    .delete(schema.emailVerifications)
    .where(
      and(
        eq(schema.emailVerifications.email, email),
        eq(schema.emailVerifications.purpose, purpose),
      ),
    );
}

/**
 * Checks a 6-digit code against the live row for (email, purpose).
 * Wrong attempts are counted on the row; at 5 the code is dead.
 * An expired row is dead too. "ok" deletes every row for the pair —
 * a code works exactly once.
 */
async function checkEmailCode(
  db: DB,
  email: string,
  purpose: EmailCodePurpose,
  code: string,
): Promise<CodeCheck> {
  const rows = await db
    .select()
    .from(schema.emailVerifications)
    .where(
      and(
        eq(schema.emailVerifications.email, email),
        eq(schema.emailVerifications.purpose, purpose),
      ),
    )
    .orderBy(desc(schema.emailVerifications.id))
    .limit(1);
  const row = rows[0];
  if (!row) return "not_found";
  if (row.expiresAt.getTime() < Date.now()) {
    await deleteCodes(db, email, purpose);
    return "expired";
  }
  if (row.attempts >= EMAIL_CODE_MAX_ATTEMPTS) {
    await deleteCodes(db, email, purpose);
    return "too_many";
  }
  const hash = createHash("sha256").update(code.trim()).digest("hex");
  if (hash !== row.codeHash) {
    const attempts = row.attempts + 1;
    if (attempts >= EMAIL_CODE_MAX_ATTEMPTS) {
      await deleteCodes(db, email, purpose);
      return "too_many";
    }
    await db
      .update(schema.emailVerifications)
      .set({ attempts })
      .where(eq(schema.emailVerifications.id, row.id));
    return "wrong";
  }
  await deleteCodes(db, email, purpose);
  return "ok";
}

/** Creates a signed-in session for an already-loaded user row. */
async function issueSession(
  db: DB,
  ctx: Ctx,
  user: UserRow,
  settings: Record<string, string>,
): Promise<SignInResult> {
  const token = newToken("sess");
  await db.insert(schema.sessions).values({ token, userId: user.id });
  ctx.invalidateQueries();
  return {
    status: "ok",
    token,
    user: publicUser(user, levelConfigFrom(settings).titles),
  };
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

// Built-in withdraw method sets per country (owner spec 2026-11-21,
// superseding the earlier lists): Pakistan — Easypaisa, JazzCash,
// Binance, Payoneer. India — Payoneer, UPI, PayPal + Bank Transfer.
// USA — PayPal, Bank Transfer (ACH), Wise, Payoneer, Binance USDT.
// UK — PayPal, Bank Transfer, Wise, Payoneer. Every other country —
// PayPal + Bank Transfer + Wise. The owner can REPLACE any of these
// sets from Admin → Withdraw Methods (stored in the
// withdraw_methods_json setting) without a redeploy — see
// builtinMethodIdsFor below.
const METHODS_BY_COUNTRY: Record<string, string[]> = {
  PK: ["easypaisa", "jazzcash", "binance", "payoneer"],
  US: ["paypal", "bank_ach", "wise", "payoneer", "binance"],
  GB: ["paypal", "bank", "wise", "payoneer"],
  IN: ["payoneer", "upi", "paypal", "bank"],
};
const DEFAULT_METHOD_IDS = ["paypal", "bank", "wise"];

/** The owner's Admin → Withdraw Methods override of the built-in
 *  per-country sets, parsed from the withdraw_methods_json setting.
 *  Keys are ISO country codes or "DEFAULT"; values are method ids
 *  from the METHODS catalogue (unknown ids are dropped). A malformed
 *  setting yields no overrides — the code table above applies. */
function builtinMethodsOverride(
  settings: Record<string, string>,
): Record<string, string[]> {
  const raw = (settings["withdraw_methods_json"] ?? "").trim();
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return {};
    const out: Record<string, string[]> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (!Array.isArray(value)) continue;
      const ids = value.filter(
        (v): v is string => typeof v === "string" && METHODS[v] != null,
      );
      out[key.toUpperCase()] = [...new Set(ids)];
    }
    return out;
  } catch {
    return {};
  }
}

/** Built-in method ids for a country: the owner's admin override for
 *  that country (or for DEFAULT) wins over the code table. */
function builtinMethodIdsFor(
  settings: Record<string, string> | undefined,
  countryCode: string | null,
): string[] {
  const override = settings ? builtinMethodsOverride(settings) : {};
  const code = countryCode ? countryCode.toUpperCase() : null;
  if (code && override[code] !== undefined) return override[code];
  if (override["DEFAULT"] !== undefined && !(code && METHODS_BY_COUNTRY[code]))
    return override["DEFAULT"];
  return (code ? METHODS_BY_COUNTRY[code] : undefined) ?? DEFAULT_METHOD_IDS;
}

function methodsForCountry(
  countryCode: string | null,
  settings?: Record<string, string>,
): MethodDef[] {
  return builtinMethodIdsFor(settings, countryCode)
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
  const builtins = methodsForCountry(countryCode, await getSettings(db));
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
// Levels (pace + title unlock levels verified against RewardJoy
// 2026-11-19): every $1 earned = +1 level. Titles: Bronze L5, Silver
// L31, Gold L101, Diamond L501, Champion L2001, Master L10001.
// (The pace and the title table below are the DEFAULTS — the owner can
// change both in Admin → Settings → Levels & Title Rewards, stored in
// the level_cents_per_level / level_titles_json settings and read live
// by levelConfigFrom on every use.)
//
// LEVEL REWARDS (owner-confirmed scheme, 2026-11-21): each title pays a
// ONE-TIME cash reward the moment a user reaches it — automatically,
// for every user, exactly once per title per user (tracked in
// users.title_rewards_paid_json). The six default rewards total
// exactly $1,000: Bronze $5, Silver $5, Gold $15, Diamond $25,
// Champion $50, Master $900. This REPLACES the old per-10-levels
// percentage Title Bonus — that bonus is gone, so a user can never
// collect more than the title rewards. A user who passed a title
// before this scheme existed is paid that title's reward on their
// next earning (checkLevelUps pays every reached-but-unpaid title).
// The standardPct / enhancedPct fields survive only so title tables
// saved by the older admin panel keep parsing; nothing pays from them.
// Because the level derives from lifetime earnings, a negative
// adjustment (chargeback) lowers it again — but a reward already paid
// is never taken back and never paid twice.

interface TitleDef {
  name: string;
  level: number;
  standardPct: number;
  enhancedPct: number;
  /** One-time reward (cents) credited when a user first reaches this
   *  title. 0 = the title pays no reward. */
  rewardCents: number;
}

/** Built-in title table — used until the owner saves his own in
 *  Admin → Settings → Levels & Title Rewards. */
const DEFAULT_TITLES: TitleDef[] = [
  { name: "Bronze", level: 5, standardPct: 1, enhancedPct: 2, rewardCents: 500 },
  { name: "Silver", level: 31, standardPct: 3, enhancedPct: 4, rewardCents: 500 },
  { name: "Gold", level: 101, standardPct: 5, enhancedPct: 6, rewardCents: 1500 },
  { name: "Diamond", level: 501, standardPct: 7, enhancedPct: 8, rewardCents: 2500 },
  { name: "Champion", level: 2001, standardPct: 9, enhancedPct: 10, rewardCents: 5000 },
  { name: "Master", level: 10001, standardPct: 11, enhancedPct: 12, rewardCents: 90000 },
];

/** The built-in one-time reward for a title name (case-insensitive),
 *  or 0 when the name is not one of the built-in titles. Used when a
 *  stored title table predates the reward field. */
function defaultRewardForTitle(name: string): number {
  const found = DEFAULT_TITLES.find(
    (t) => t.name.toLowerCase() === name.trim().toLowerCase(),
  );
  return found?.rewardCents ?? 0;
}

interface LevelConfig {
  titles: TitleDef[];
  centsPerLevel: number;
}

/**
 * The live level configuration: the owner's title table from settings
 * (`level_titles_json`) when it is present and valid — 1–8 titles with
 * strictly increasing levels and 0–100 percentages — otherwise the
 * built-in table. A stored entry without a valid `rewardCents` (a
 * table saved before Level Rewards existed) falls back to the
 * built-in reward for a title of the same name, else 0.
 * `level_cents_per_level` is how many cents of lifetime earnings make
 * one level (default 100 = $1 per level).
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
          const rewardCents =
            typeof r.rewardCents === "number" &&
            Number.isInteger(r.rewardCents) &&
            r.rewardCents >= 0 &&
            r.rewardCents <= 100_000_000
              ? r.rewardCents
              : defaultRewardForTitle(name);
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
          out.push({ name, level, standardPct, enhancedPct, rewardCents });
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

/** Title names whose one-time Level Reward a user has already been
 *  paid, parsed from users.title_rewards_paid_json. Corrupt JSON reads
 *  as "nothing paid" — the ledger check in checkLevelUps still stops
 *  a double payment in that case. */
function paidTitleRewards(user: UserRow): Set<string> {
  try {
    const parsed: unknown = JSON.parse(user.titleRewardsPaidJson || "[]");
    if (Array.isArray(parsed)) {
      return new Set(
        parsed.filter((x): x is string => typeof x === "string"),
      );
    }
  } catch {
    // fall through to the empty set
  }
  return new Set();
}

/**
 * Syncs a user's stored level with their lifetime earnings and pays
 * any due one-time Level Rewards. Called after every credit (and
 * lazily from getLevel), so level, progress and rewards are never
 * display-only.
 *
 * A title's reward is paid when ALL of these hold: the user's level
 * has reached the title, the title's reward is above $0, and the
 * title is not in the user's paid set. The paid set lives on the user
 * row AND every payment writes a `level_reward` ledger row whose note
 * names the title; before paying, the ledger is checked too, so even
 * a lost/corrupt paid set can never pay a title twice. Rewards count
 * toward lifetime earnings (and therefore the level), exactly like
 * the old Title Bonus did — the loop re-checks after each payment
 * because a reward can itself carry the user into the next title.
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
  // Settings → Levels & Title Rewards), defaulting to $1 per level and
  // the built-in table with the $1,000 reward split.
  const levelCfg = levelConfigFrom(await getSettings(db));
  const paid = paidTitleRewards(user);
  // Belt-and-braces duplicate guard: titles already present in the
  // ledger as a Level Reward count as paid even if the row's paid set
  // was lost. Old per-10-levels bonus rows ("Title Bonus — Level …")
  // do NOT match the "Level Reward — " prefix, so they never block a
  // title's one-time reward.
  const ledger = await db
    .select()
    .from(schema.transactions)
    .where(
      and(
        eq(schema.transactions.userId, userId),
        eq(schema.transactions.kind, "level_reward"),
      ),
    );
  for (const row of ledger) {
    for (const title of levelCfg.titles) {
      if (row.note.startsWith(`Level Reward — ${title.name} `)) {
        paid.add(title.name);
      }
    }
  }
  let totalEarned = user.totalEarnedCents;
  let balance = user.balanceCents;
  const rewardRows: { amountCents: number; note: string }[] = [];
  for (let guard = 0; guard < 20; guard++) {
    const levelNow = levelForEarned(totalEarned, levelCfg.centsPerLevel);
    const due = levelCfg.titles.find(
      (t) => levelNow >= t.level && t.rewardCents > 0 && !paid.has(t.name),
    );
    if (!due) break;
    paid.add(due.name);
    rewardRows.push({
      amountCents: due.rewardCents,
      note: `Level Reward — ${due.name} (Level ${due.level})`,
    });
    balance += due.rewardCents;
    totalEarned += due.rewardCents;
  }
  const newLevel = levelForEarned(totalEarned, levelCfg.centsPerLevel);
  const paidJson = JSON.stringify([...paid]);
  if (
    newLevel === user.level &&
    rewardRows.length === 0 &&
    paidJson === (user.titleRewardsPaidJson || "[]")
  ) {
    return;
  }
  const statements: BatchItem<"sqlite">[] = [
    db
      .update(schema.users)
      .set({
        level: newLevel,
        titleRewardsPaidJson: paidJson,
        balanceCents: balance,
        totalEarnedCents: totalEarned,
      })
      .where(eq(schema.users.id, user.id)),
  ];
  for (const r of rewardRows) {
    statements.push(
      db.insert(schema.transactions).values({
        userId: user.id,
        kind: "level_reward",
        amountCents: r.amountCents,
        note: r.note,
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

// ------------------------------------------------------- daily contest
// DAILY CONTEST (owner-approved 2026-11-26, "haan bana do"). A NEW
// feature — NOT the old Leaderboard with its Daily $100 / Affiliate
// $1500 contests, which the owner ordered removed on 2026-11-22
// (commit d4474b8). Nothing from that removal is restored: the old
// contestJoins / contestPayouts / contestAwards tables are dead
// leftovers and this feature does not touch them.
//
// Rules, exactly as approved:
//  - One contest per UTC calendar day (dayKey "YYYY-MM-DD", 00:00 UTC
//    to 24:00 UTC). The dashboard shows a live countdown to the next
//    UTC midnight; at midnight the contest refreshes.
//  - Ranking: each user's earnings during that UTC day, top 30 only.
//    ONLY offerwall / survey / game earnings count — transactions of
//    kind "offer_credit" (every postback credit lands there). Affiliate
//    commissions, check-in bonuses, level rewards and earlier contest
//    prizes never count, so a contest prize can never feed the next
//    day's ranking (no feedback loop). $0 earners never appear.
//  - Prize pool: the owner's setting daily_contest_total_cents
//    (default $20.00 = 2000 cents). The ladder below is the approved
//    $20.00 split; any other total rescales it proportionally.
//  - Settlement: when a UTC day ends, the top-30 prizes are credited
//    IN FULL to the winners' balances (no 70/30 split — the prize is
//    not an offerwall payout). Settlement is lazy: it runs on the
//    first dashboard / contest read after midnight (getDashboard,
//    getDailyContest) and on the admin's Settle button, because this
//    server has no cron. It is idempotent per day (see
//    settleDailyContestDay): a redeploy or a repeated call can never
//    double-pay.
//  - A prize is a transactions row of kind "contest_prize", so it
//    shows in the winner's History as "Daily contest prize". It does
//    NOT touch totalEarnedCents and never calls checkLevelUps —
//    contest prizes do not move level progress ($1 earned = 1 level
//    stays based on offerwall / survey / game earnings only).

const DAILY_CONTEST_MAX_RANK = 30;
const DAILY_CONTEST_DEFAULT_TOTAL_CENTS = 2000;

// Owner-approved ladder at the $20.00 default total, rank 1..30 in
// cents. Sums to exactly 2000: 400+250+150+120+80, then 5×60, 5×50,
// 5×40, 5×30, 5×20.
const DAILY_CONTEST_BASE_LADDER_CENTS: number[] = [
  400, 250, 150, 120, 80,
  60, 60, 60, 60, 60,
  50, 50, 50, 50, 50,
  40, 40, 40, 40, 40,
  30, 30, 30, 30, 30,
  20, 20, 20, 20, 20,
];

interface DailyContestWinner {
  userId: number;
  rank: number;
  earnedCents: number;
  prizeCents: number;
}

/** UTC calendar day key "YYYY-MM-DD" for a date (never local time). */
function utcDayKeyOf(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Milliseconds since epoch of 00:00 UTC on the given UTC day key. */
function utcDayStartMs(dayKey: string): number {
  const [y = 1970, m = 1, d = 1] = dayKey.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

/** The UTC day key `delta` days after `dayKey`. */
function shiftUtcDayKey(dayKey: string, delta: number): string {
  return utcDayKeyOf(new Date(utcDayStartMs(dayKey) + delta * 86400000));
}

/** Milliseconds since epoch of the next UTC midnight after `now`. */
function nextUtcMidnightMs(now = new Date()): number {
  return utcDayStartMs(utcDayKeyOf(now)) + 86400000;
}

/** The owner's daily prize pool, in cents (default $20.00). */
function dailyContestTotalFrom(settings: Record<string, string>): number {
  const n = settingInt(settings, "daily_contest_total_cents");
  return n >= 0 && n <= 100_000_000 ? n : DAILY_CONTEST_DEFAULT_TOTAL_CENTS;
}

/**
 * The prize ladder for a given pool total, rank 1..30 in cents.
 * Each rung is the $20.00 base rung scaled by total/2000 and rounded
 * to cents; the rounding drift (at most a few cents either way) is
 * put on rank 1, so the ladder ALWAYS sums to exactly totalCents —
 * the site never pays a cent more or less than the owner's setting.
 * A total of 0 pays nothing (all rungs 0).
 */
function dailyContestLadder(totalCents: number): number[] {
  if (totalCents <= 0)
    return DAILY_CONTEST_BASE_LADDER_CENTS.map(() => 0);
  const scaled = DAILY_CONTEST_BASE_LADDER_CENTS.map((c) =>
    Math.round((c * totalCents) / DAILY_CONTEST_DEFAULT_TOTAL_CENTS),
  );
  const drift = totalCents - scaled.reduce((s, c) => s + c, 0);
  scaled[0] = (scaled[0] ?? 0) + drift;
  return scaled;
}

/**
 * Top-30 standings for one UTC day: userId + offer_credit earnings
 * in [day 00:00 UTC, next day 00:00 UTC), highest first. Only users
 * with earnings > $0 appear (the site-wide rule: $0 never shows).
 */
async function dailyContestStandings(
  db: DB,
  dayKey: string,
): Promise<{ userId: number; earnedCents: number }[]> {
  const start = new Date(utcDayStartMs(dayKey));
  const end = new Date(utcDayStartMs(dayKey) + 86400000);
  const rows = await db
    .select({
      userId: schema.transactions.userId,
      earnedCents:
        sql<number>`coalesce(sum(${schema.transactions.amountCents}), 0)`,
    })
    .from(schema.transactions)
    .where(
      and(
        eq(schema.transactions.kind, "offer_credit"),
        gte(schema.transactions.createdAt, start),
        lt(schema.transactions.createdAt, end),
      ),
    )
    .groupBy(schema.transactions.userId)
    .orderBy(desc(sql`sum(${schema.transactions.amountCents})`))
    .limit(DAILY_CONTEST_MAX_RANK);
  return rows
    .map((r) => ({ userId: r.userId, earnedCents: r.earnedCents }))
    .filter((r) => r.earnedCents > 0);
}

/**
 * Settle one finished UTC day: credit the top-30 prizes in full.
 * IDEMPOTENT — the settlement row (UNIQUE day_key) is inserted FIRST
 * with onConflictDoNothing; if it already exists (or another request
 * won the race) nothing is paid again. Returns settled:false when the
 * day was already settled. Prizes are balance-only: totalEarnedCents
 * is untouched and checkLevelUps is never called, so prizes do not
 * move level progress. The total used is the owner's setting at
 * settlement time.
 */
async function settleDailyContestDay(
  db: DB,
  dayKey: string,
  totalCents: number,
): Promise<{
  settled: boolean;
  winners: DailyContestWinner[];
  totalPaidCents: number;
}> {
  const existing = await db
    .select()
    .from(schema.dailyContestSettlements)
    .where(eq(schema.dailyContestSettlements.dayKey, dayKey))
    .limit(1);
  if (existing.length > 0)
    return { settled: false, winners: [], totalPaidCents: 0 };
  const standings = await dailyContestStandings(db, dayKey);
  const ladder = dailyContestLadder(totalCents);
  const winners: DailyContestWinner[] = standings
    .map((s, i) => ({
      userId: s.userId,
      rank: i + 1,
      earnedCents: s.earnedCents,
      prizeCents: ladder[i] ?? 0,
    }))
    .filter((w) => w.prizeCents > 0);
  // Marker first: if a concurrent settle already inserted this day,
  // onConflictDoNothing returns no row and we pay nothing.
  const inserted = await db
    .insert(schema.dailyContestSettlements)
    .values({
      dayKey,
      totalCents,
      winnersJson: JSON.stringify(winners),
    })
    .onConflictDoNothing()
    .returning();
  if (inserted.length === 0)
    return { settled: false, winners: [], totalPaidCents: 0 };
  if (winners.length > 0) {
    const users = await db
      .select()
      .from(schema.users)
      .where(
        inArray(
          schema.users.id,
          winners.map((w) => w.userId),
        ),
      );
    const byId = new Map(users.map((u) => [u.id, u]));
    const statements: BatchItem<"sqlite">[] = [];
    for (const w of winners) {
      const user = byId.get(w.userId);
      if (!user) continue;
      statements.push(
        db
          .update(schema.users)
          .set({ balanceCents: user.balanceCents + w.prizeCents })
          .where(eq(schema.users.id, w.userId)),
        db.insert(schema.transactions).values({
          userId: w.userId,
          kind: "contest_prize",
          amountCents: w.prizeCents,
          note: `Daily Contest prize — Rank #${w.rank} — ${dayKey}`,
        }),
      );
    }
    const [first, ...rest] = statements;
    if (first) await db.batch([first, ...rest]);
  }
  return {
    settled: true,
    winners,
    totalPaidCents: winners.reduce((s, w) => s + w.prizeCents, 0),
  };
}

/**
 * Settle every finished UTC day that is not settled yet, from the
 * contest's start day (the first day this code ran — prizes are never
 * paid for days before the feature existed) up to yesterday. The
 * start day is recorded once in settings the first time this runs.
 * Safe to call on any read: already-settled days are skipped, and a
 * failure settles nothing — the next read retries.
 */
async function settleDueDailyContests(
  db: DB,
): Promise<{ settledDays: string[] }> {
  const settings = await getSettings(db);
  const totalCents = dailyContestTotalFrom(settings);
  const todayKey = utcDayKeyOf(new Date());
  let startKey = (settings["daily_contest_start_day"] ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startKey)) {
    startKey = todayKey;
    await db
      .insert(schema.settings)
      .values({ key: "daily_contest_start_day", value: startKey })
      .onConflictDoNothing();
  }
  const settledDays: string[] = [];
  let day = startKey;
  let guard = 0;
  while (day < todayKey && guard++ < 366) {
    const r = await settleDailyContestDay(db, day, totalCents);
    if (r.settled) settledDays.push(day);
    day = shiftUtcDayKey(day, 1);
  }
  return { settledDays };
}

/** Settle due days, but never let a settlement failure break a read. */
async function settleDueDailyContestsBestEffort(db: DB): Promise<void> {
  try {
    await settleDueDailyContests(db);
  } catch {
    // The next read retries; the page must still load.
  }
}

const SURVEY_NETWORK_HINTS = ["survey", "cpx", "bitlabs", "theorem", "cherries", "prime opinion", "prime"];

function isSurveyNetwork(network: string): boolean {
  const n = network.toLowerCase();
  return SURVEY_NETWORK_HINTS.some((h) => n.includes(h));
}

/**
 * Live-wall check — the source of truth is the admin's Content card:
 * a completion only shows in the public / personal feeds when a card
 * for that network exists AND is Active. A wall whose approval never
 * came (no card, or its card switched off) has its old completions
 * hidden everywhere the feed is used — no rows are deleted, and the
 * wall reappears automatically if the admin adds / reactivates its
 * card. Uses the same fuzzy provider/title match as wallFor, so
 * "TheoremReach" matches a card titled/provider "TheoremReach" and
 * "offerwallgg" matches "Offerwall.GG".
 */
function isLiveNetwork(
  network: string,
  walls: {
    provider: string;
    title: string;
    imageUrl: string | null;
    active: number;
  }[],
): boolean {
  return wallFor(
    network,
    walls.filter((w) => w.active === 1),
  ) != null;
}

// ------------------------------------------------------------- zod shapes

const userShape = z.object({
  id: z.number(),
  userCode: z.string(),
  offerToken: z.string(),
  name: z.string(),
  nameChangesLeft: z.number(),
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
  badge: z.string().nullable(),
  platform: z.string(),
  milestones: z.array(
    z.object({ event: z.string(), amountCents: z.number() }),
  ),
  countries: z.string(),
  featured: z.boolean(),
  active: z.boolean(),
  sortOrder: z.number(),
  createdAt: z.string(),
});

// Admin-only extension: the partner feed URL is never exposed to
// user-facing payloads (it can carry a partner API key).
const adminContentShape = contentShape.extend({
  feedUrl: z.string().nullable(),
  // Generic feed controls (see schema.ts). The feed secret itself is
  // NEVER sent to the client — only whether one is stored.
  feedAuthKind: z.enum(["none", "bearer"]),
  feedCategory: z.string(),
  feedCategoryMode: z.enum(["include", "exclude"]),
  feedSecretSet: z.boolean(),
});

/** Parses the stored game-milestones JSON; anything malformed = none. */
function parseMilestones(
  json: string | null | undefined,
): { event: string; amountCents: number }[] {
  if (!json) return [];
  try {
    const value: unknown = JSON.parse(json);
    if (!Array.isArray(value)) return [];
    const out: { event: string; amountCents: number }[] = [];
    for (const m of value) {
      if (m === null || typeof m !== "object" || Array.isArray(m)) continue;
      const rec = m as Record<string, unknown>;
      const event = typeof rec.event === "string" ? rec.event : "";
      const amountCents =
        typeof rec.amountCents === "number" && Number.isFinite(rec.amountCents)
          ? Math.max(0, Math.round(rec.amountCents))
          : null;
      if (event && amountCents !== null) out.push({ event, amountCents });
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * One partner = one card (owner order 2026-11-21: TheoremReach showed
 * TWICE in Offers because two rows existed for it). Partners are keyed
 * by their provider name, falling back to the title when no provider
 * is set.
 */
function partnerKeyOf(provider: string, title: string): string {
  return (
    (provider || "").trim().toLowerCase() ||
    (title || "").trim().toLowerCase()
  );
}

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
    badge: row.badge ?? null,
    platform: row.platform ?? "android",
    milestones: parseMilestones(row.milestonesJson),
    countries: row.countries,
    featured: row.featured === 1,
    active: row.active === 1,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt.toISOString(),
  };
}

function adminContent(row: typeof schema.contentItems.$inferSelect) {
  return {
    ...publicContent(row),
    feedUrl: row.feedUrl ?? null,
    feedAuthKind: row.feedAuthKind === "bearer" ? ("bearer" as const) : ("none" as const),
    feedCategory: row.feedCategory ?? "",
    feedCategoryMode:
      row.feedCategoryMode === "exclude" ? ("exclude" as const) : ("include" as const),
    feedSecretSet: row.feedSecret !== "",
  };
}

/**
 * Personalises a partner URL for one signed-in user: `{user_id}` becomes
 * the user's OWN Offer Token (the OT-… ID on their Profile — this is the
 * ID partners send back in their postback/callback, so it is how a
 * completed offer finds its user) and `{transaction_id}` becomes a
 * fresh unique ID for this view/click. Feed URLs may also use `{ip}`
 * (the user's sign-in IP) and `{country}` (their locked country code)
 * so the partner matches its items to that user. URLs without
 * placeholders are returned unchanged.
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
  if (out.includes("{ip}")) {
    out = out.split("{ip}").join(encodeURIComponent(user.ip ?? ""));
  }
  if (out.includes("{country}")) {
    out = out
      .split("{country}")
      .join(encodeURIComponent(user.countryCode ?? ""));
  }
  return out;
}

// ------------------------------------------------------------ partner feeds
//
// The Surveys and Games tabs show INDIVIDUAL items — never partner
// cards and never a partner's website (owner order 2026-11-21,
// TimeBucks model). For every partner the admin has added, an adapter
// below asks that partner for the items matched to THIS user (the
// partner does the IP/profile matching for the identity we send —
// the user's Offer Token, sign-in IP and locked country, the same
// identity its callbacks credit). Each item keeps its own entry
// link, so tapping a card opens that one survey/game directly, and
// completion money arrives through the same partner-agnostic
// postback/callback crediting as every other partner.
//
// Adapters, in order: a dedicated one where TapOne speaks the
// partner's own API (TheoremReach — signed Surveys API; CPX), and
// ONE generic JSON-feed adapter for every other partner, present or
// future: when the admin saves an "Items feed URL" on the partner's
// row, its individual surveys/games list automatically — no new code
// per partner (owner order 2026-11-21: fix the feed once, for all
// partners). A partner with neither simply contributes no items —
// nothing is invented.

const surveyFeedItemShape = z.object({
  key: z.string(),
  // The NUMERIC Offerwall.GG offer id (the `id` in the /offers list
  // response) — only Offerwall.GG feed games carry one. The Games-tab
  // popup calls GET /api/v1/offers/{offerId} with it to fetch that
  // game's goal ladder. Null for every other partner's feed items.
  offerId: z.string().nullable(),
  provider: z.string(),
  providerImageUrl: z.string().nullable(),
  imageUrl: z.string().nullable(),
  title: z.string().nullable(),
  // What the USER earns for this survey: the partner payout with the
  // site's revenue share applied — the same share the reward callback
  // will credit on completion (user_share_pct, default 70%).
  payoutCents: z.number(),
  minutes: z.number().nullable(),
  url: z.string(),
});
type SurveyFeedItem = z.infer<typeof surveyFeedItemShape>;

function feedRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function feedList(json: unknown): unknown[] | null {
  if (Array.isArray(json)) return json;
  const rec = feedRecord(json);
  if (!rec) return null;
  for (const k of ["offers", "surveys", "data", "results", "items"]) {
    const v = rec[k];
    if (Array.isArray(v)) return v;
  }
  return null;
}

function feedNum(
  rec: Record<string, unknown>,
  names: string[],
): number | null {
  for (const n of names) {
    const v = rec[n];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string") {
      const p = Number.parseFloat(v.replace(/[^0-9.\-]/g, ""));
      if (Number.isFinite(p)) return p;
    }
  }
  return null;
}

function feedStr(
  rec: Record<string, unknown>,
  names: string[],
): string | null {
  for (const n of names) {
    const v = rec[n];
    if (typeof v === "string" && v.trim() !== "") return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return null;
}

/**
 * Maps one raw partner-API survey onto the feed shape. Field names
 * differ per network, so every known alias is tried; a survey without
 * a usable entry link or a positive payout is dropped, never guessed.
 */
function mapFeedSurvey(
  raw: unknown,
  index: number,
  partner: { name: string; imageUrl: string | null },
  sharePct: number,
): SurveyFeedItem | null {
  const rec = feedRecord(raw);
  if (!rec) return null;
  const url = feedStr(rec, [
    // TheoremReach's Surveys API names the per-survey link
    // "entry_link" — it must win over any generic field.
    "entry_link",
    "clickUrl",
    "click_url",
    "start_url",
    "link",
    "url",
    "offer_url",
    "entry_url",
    "survey_url",
    "href",
  ]);
  if (!url || !/^https?:\/\//i.test(url)) return null;
  const centsDirect = feedNum(rec, [
    "payout_cents",
    "reward_cents",
    "amount_cents",
    "cents",
  ]);
  const dollars = feedNum(rec, [
    "payout",
    "reward",
    "amount",
    "cpi",
    "price",
    "payout_usd",
    "usd",
  ]);
  const grossCents =
    centsDirect != null
      ? Math.round(centsDirect)
      : dollars != null
        ? Math.round(dollars * 100)
        : null;
  if (grossCents == null || grossCents <= 0) return null;
  const mins = feedNum(rec, [
    "loi",
    "length",
    "minutes",
    "duration",
    "estimated_loi",
    "time_required",
  ]);
  const offerId =
    feedStr(rec, ["campaign_id", "offer_id", "survey_id", "id"]) ??
    String(index);
  return {
    key: `${partner.name}:${offerId}:${index}`,
    // No Offerwall.GG numeric offer id: the generic survey mapper
    // covers every other partner, and only Offerwall.GG games get
    // a detail popup (see mapOfferwallGgOffer).
    offerId: null,
    provider: partner.name,
    providerImageUrl: partner.imageUrl,
    imageUrl: feedStr(rec, [
      "image",
      "image_url",
      "thumbnail_url",
      "thumbnail",
      "icon",
    ]),
    title: feedStr(rec, ["name", "title"]),
    payoutCents: Math.max(1, Math.round((grossCents * sharePct) / 100)),
    minutes: mins != null && mins > 0 && mins <= 600 ? Math.round(mins) : null,
    url,
  };
}

async function fetchFeedJson(
  url: string,
  extraHeaders?: Record<string, string>,
): Promise<unknown | null> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  // Log failures minimally so a dead feed is diagnosable in the
  // server logs instead of silently returning []. Log ONLY the
  // host, the HTTP status and the API's own error text — never the
  // URL (it can carry user tokens) and never any header/key.
  let host = "feed";
  try {
    host = new URL(url).host;
  } catch {
    // keep the fallback
  }
  try {
    const res = await fetch(url, {
      headers: { accept: "application/json", ...(extraHeaders ?? {}) },
      signal: ctl.signal,
    });
    if (!res.ok) {
      let detail = "";
      try {
        detail = (await res.text()).slice(0, 200);
      } catch {
        // ignore — the status alone is still useful
      }
      console.warn(`[feed] ${host} HTTP ${res.status}${detail ? `: ${detail}` : ""}`);
      return null;
    }
    return (await res.json()) as unknown;
  } catch (err) {
    console.warn(
      `[feed] ${host} request failed: ${err instanceof Error ? err.message : "unknown error"}`,
    );
    return null;
  } finally {
    clearTimeout(timer);
  }
}

type ContentRow = typeof schema.contentItems.$inferSelect;

/** Shared context every partner feed adapter receives. */
type PartnerFeedCtx = {
  sharePct: number;
  // TheoremReach app Secret Key (Admin → Settings). Required to sign
  // Surveys API requests and the per-survey entry links.
  theoremReachSecret: string;
  // Offerwall.GG JSON API credentials for the games feed below.
  // offerwallggApiKey is the secret key (Admin → Settings,
  // server-only); offerwallggAppId is the 32-character PUBLIC key
  // read from the Offerwall.GG wall URL in Admin → Content.
  // device is the Games tab toggle ("android" | "iphone") and
  // userAgent is the visitor's browser user agent, forwarded so
  // Offerwall.GG matches per-user offers instead of the server's.
  offerwallggApiKey: string;
  offerwallggAppId: string;
  device: "android" | "iphone";
  userAgent: string;
};

/**
 * Category filter for generic feeds (Admin → Content → Category on
 * a survey/game row). Raw items carry their category either as a
 * `category` string or a `categories` array (Offerwall.GG uses the
 * array). Empty category = no filtering. "include" keeps only that
 * category; "exclude" drops it. An item with no category info at
 * all is dropped by "include" and kept by "exclude".
 */
function feedCategoryMatches(
  raw: unknown,
  category: string,
  mode: string,
): boolean {
  const wanted = category.trim().toLowerCase();
  if (!wanted) return true;
  const rec = feedRecord(raw);
  const cats: string[] = [];
  if (rec) {
    const single = rec["category"];
    if (typeof single === "string" && single.trim())
      cats.push(single.trim().toLowerCase());
    const many = rec["categories"];
    if (Array.isArray(many))
      for (const c of many)
        if (typeof c === "string" && c.trim())
          cats.push(c.trim().toLowerCase());
  }
  const hit = cats.includes(wanted);
  return mode === "exclude" ? !hit : hit;
}

// Per-user cache for the Offerwall.GG games feed: Offerwall.GG
// allows 120 /offers requests per minute per IP, and the Games tab
// refetches on every toggle — 120s per user+device is plenty.
const offerwallGgGamesCache = new Map<
  string,
  { at: number; items: SurveyFeedItem[] }
>();

// Placement-level exchange rate (units per $1) for Offerwall.GG.
// ROOT CAUSE of the popup never loading (2026-11-25): the DETAIL
// endpoint GET /api/v1/offers/{offer} returns ONLY
// { success, data: { offer } } — there is NO data.currency in that
// response (Offerwall.GG OpenAPI 3.1: the detail 200 schema requires
// only data.offer; Currency is echoed ONLY by the LIST endpoint
// /offers, as data.currency). The popup handler read perUsd from
// data.currency, got null, and silently returned found:false for
// EVERY game — which is exactly the live symptom (error line on
// every popup, no steps, no description, no Total row), with no
// server-log error because the fetch itself succeeded (200).
// The rate is a property of the placement, not of one offer, so it
// is read once from the list endpoint (limit=1) and cached 10 min.
let offerwallGgPerUsdCache: { at: number; perUsd: number } | null = null;
async function getOfferwallGgPerUsd(
  apiKey: string,
  appId: string,
): Promise<number | null> {
  if (
    offerwallGgPerUsdCache &&
    Date.now() - offerwallGgPerUsdCache.at < 600_000
  )
    return offerwallGgPerUsdCache.perUsd;
  const json = await fetchFeedJson(
    `https://offerwall.gg/api/v1/offers?${new URLSearchParams({
      appId,
      limit: "1",
    }).toString()}`,
    { "X-Api-Key": apiKey },
  );
  const perUsd = feedNum(
    feedRecord(feedRecord(feedRecord(json)?.["data"])?.["currency"]) ?? {},
    ["perUsd"],
  );
  if (perUsd != null && perUsd > 0) {
    offerwallGgPerUsdCache = { at: Date.now(), perUsd };
    return perUsd;
  }
  return offerwallGgPerUsdCache?.perUsd ?? null;
}

/**
 * Offerwall.GG games feed (offerwall.gg/developers, OpenAPI 3.1).
 *
 *   GET https://offerwall.gg/api/v1/offers?appId=<public key>
 *       &userId=<Offer Token>&country=<locked country>
 *       &device=android|iphone&ip=<sign-in IP>&userAgent=…
 *       &category=game&limit=50&sort=recommended
 *   Header: X-Api-Key: <secret key from Admin → Settings>
 *
 * Offerwall.GG targets the offers itself from the country, device,
 * IP and user agent we send, so each user sees the games matched to
 * THEIR country/IP — the same rule as the wall. `category=game`
 * (SINGULAR) keeps only games — the API returns 0 offers for
 * `category=games` (plural) for every country/device, and 37
 * offers for PK/Android with `category=game` (API test, live,
 * 2026-11-25; the key itself was fine, no 401/403). Surveys live
 * in their own adapter (offerwallGgSurveys, GET /api/v1/surveys)
 * — the 2026-11-23 no-surveys order was superseded by the owner
 * on 2026-11-25; this adapter still never asks for them. The
 * per-offer `clickUrl` is only returned
 * when userId is passed, so tapping a card opens that one game
 * through Offerwall.GG's click tracker and the completion credits
 * through the existing Offerwall.GG partner callback.
 *
 * PAYOUT — read from the live callback code, not guessed (see
 * PATCH.md for the full derivation):
 *   - The API `reward` is in the placement's own currency, and
 *     `data.currency.perUsd` says how many units make $1 (TapOne's
 *     placement: 1000). Gross publisher revenue in dollars is
 *     therefore reward / perUsd — the same dollars the postback
 *     computes as currencyAmount / payoutDivisor (1000).
 *   - The user is credited 70% of that gross by applyRewardCredit
 *     (user_share_pct), exactly as the postback does.
 *   - So the card shows payoutCents = round(reward / perUsd * 100)
 *     * 70 / 100, with the 70% applied ONCE here. Passing the gross
 *     through mapFeedSurvey would apply it a second time (49%),
 *     which is why this adapter has its own mapper.
 */
function mapOfferwallGgOffer(
  raw: unknown,
  index: number,
  partner: { name: string; imageUrl: string | null },
  perUsd: number,
  sharePct: number,
): SurveyFeedItem | null {
  const rec = feedRecord(raw);
  if (!rec) return null;
  const clickUrl = feedStr(rec, ["clickUrl", "click_url"]);
  if (!clickUrl || !/^https?:\/\//i.test(clickUrl)) return null;
  const reward = feedNum(rec, ["reward"]);
  if (reward == null || reward <= 0 || !Number.isFinite(perUsd) || perUsd <= 0)
    return null;
  const grossCents = Math.round((reward / perUsd) * 100);
  if (grossCents <= 0) return null;
  // The user's true share, rounded ONCE from the raw reward — the
  // same formula applyRewardCredit uses (round of gross dollars x
  // share), so the card never promises more than the postback will
  // credit. The old code rounded twice (gross to whole cents, then
  // 70% of that) and floored at 1 cent: a 7-coin reward is $0.007
  // gross, $0.0049 to the user, yet displayed $0.01 while crediting
  // $0.00. OWNER RULE 2026-11-25: no game under $1.00 lists at all —
  // every $0.xx price ($0.01, $0.03, $0.25, any $0.xx) is dropped,
  // only games paying $1.00+ show. NOTE: this deliberately replaces
  // the double-rounded payout, so a few displayed prices move by 1c
  // (e.g. a 3577-coin game: $2.51 -> $2.50) — that is the exact
  // amount the user will actually be credited.
  const userCents = Math.round((reward / perUsd) * sharePct);
  if (userCents < 100) return null;
  const offerId =
    feedStr(rec, ["id", "externalId", "offer_id"]) ?? String(index);
  // The detail endpoint takes ONLY the numeric `id` — the network's
  // own externalId (e.g. "32-21022-...") 404s there — so record it
  // separately. feedNum guards against a non-numeric id.
  const numericId = feedNum(rec, ["id"]);
  return {
    key: `Offerwall.GG:${offerId}:${index}`,
    offerId:
      numericId != null && Number.isInteger(numericId)
        ? String(numericId)
        : null,
    provider: partner.name,
    providerImageUrl: partner.imageUrl,
    imageUrl: feedStr(rec, ["image", "image_url", "thumbnail_url", "thumbnail", "icon"]),
    title: feedStr(rec, ["name", "title"]),
    payoutCents: userCents,
    minutes: null,
    url: clickUrl,
  };
}

async function offerwallGgGames(
  item: ContentRow,
  user: UserRow,
  ctx: PartnerFeedCtx,
): Promise<SurveyFeedItem[]> {
  if (!ctx.offerwallggApiKey || !ctx.offerwallggAppId) return [];
  const cacheKey = `${user.id}:${ctx.device}`;
  const cached = offerwallGgGamesCache.get(cacheKey);
  if (cached && Date.now() - cached.at < 120_000) return cached.items;
  const params = new URLSearchParams({
    appId: ctx.offerwallggAppId,
    userId: user.offerToken ?? user.userCode,
    category: "game",
    limit: "50",
    sort: "recommended",
    device: ctx.device,
  });
  if (user.countryCode) params.set("country", user.countryCode);
  if (user.ip) params.set("ip", user.ip);
  if (ctx.userAgent) params.set("userAgent", ctx.userAgent);
  const json = await fetchFeedJson(
    `https://offerwall.gg/api/v1/offers?${params.toString()}`,
    { "X-Api-Key": ctx.offerwallggApiKey },
  );
  const dataRec = feedRecord(json)?.["data"];
  const data = feedRecord(dataRec);
  const perUsd = data ? feedNum(feedRecord(data["currency"]) ?? {}, ["perUsd"]) : null;
  const list = data && Array.isArray(data["offers"]) ? data["offers"] : null;
  if (!list || perUsd == null) return [];
  const partner = {
    name: item.provider || item.title,
    imageUrl: item.imageUrl ?? null,
  };
  const items = list
    .map((raw, i) => mapOfferwallGgOffer(raw, i, partner, perUsd, ctx.sharePct))
    .filter((s): s is SurveyFeedItem => s !== null);
  offerwallGgGamesCache.set(cacheKey, { at: Date.now(), items });
  return items;
}

// Per-user cache for the Offerwall.GG surveys feed — same 120 s
// per user+device as games (the panels keep a list for a few
// minutes per user anyway; /surveys is rate-limited separately).
const offerwallGgSurveysCache = new Map<
  string,
  { at: number; items: SurveyFeedItem[] }
>();

/**
 * Offerwall.GG surveys feed — a SEPARATE endpoint from the offers
 * catalogue (offerwall.gg/developers, OpenAPI 3.1, tag "Surveys"):
 *
 *   GET https://offerwall.gg/api/v1/surveys?appId=<public key>
 *       &userId=<Offer Token>&ip=<sign-in IP>&country=<locked country>
 *       &device=android|iphone&userAgent=…&limit=50
 *   Header: X-Api-Key: <secret key from Admin → Settings>
 *
 * NOT /api/v1/offers?category=survey(s): the offers endpoint has
 * no survey category that returns these panels' surveys — the
 * dedicated /surveys endpoint is the only route, and it is the
 * one the wall itself draws its Surveys tab from. userId, ip and
 * country are REQUIRED (missing any of them = HTTP 422); the
 * panels match per person from the ip / country / userAgent WE
 * send, so each user sees the surveys matched to THEIR country/IP
 * — the same rule as the wall and the games feed. userAgent is
 * strongly recommended: without it the panels see the server's
 * own agent, treat it as a bot, and return nothing per-user.
 *
 * RESPONSE (data.surveys[], data.currency, data.user):
 *   { id, title ("Survey · 12 min"), description, image,
 *     lengthMinutes (null when the panel does not say),
 *     rating (null when unpublished),
 *     payoutUsd (what the placement earns, in USD),
 *     reward (the same amount in the placement's currency),
 *     rewardFormatted, rewardIsVariable, clickUrl }
 * There is NO panel/provider name or logo field on a survey — the
 * survey's own `image` is the only picture the API returns (and
 * the worked example in the spec has image: ""), so the card
 * falls back to the Offerwall.GG logo from the Content row
 * (SurveyCard already does imageUrl ?? providerImageUrl).
 * Prime Survey / CPX / any other panel are therefore NOT
 * identified per survey — do not claim a card shows "the Prime
 * Survey logo" unless the API starts returning one.
 *
 * PAYOUT — same one-step formula as the games mapper, read from
 * the live callback code, not guessed:
 *   - The postback sends currencyAmount in the placement's
 *     currency; payout = currencyAmount / payoutDivisor (1000);
 *     applyRewardCredit credits round(payout * 100 * share/100).
 *   - payoutUsd IS that gross in dollars (reward / perUsd), so
 *     userCents = round(payoutUsd * sharePct). Worked example
 *     from the spec: payoutUsd 0.875, reward 875, perUsd 1000 →
 *     userCents = round(0.875 * 70) = 61¢ — exactly what the
 *     postback credits (875 units → $0.875 → 61¢). The reward /
 *     perUsd path is kept only as a fallback for a survey that
 *     carries no payoutUsd. The 70% is applied ONCE here; routing
 *     through mapFeedSurvey would read `reward` as DOLLARS
 *     (875 → $875 gross → $612.50 on the card), which is why this
 *     adapter has its own mapper.
 *   - NO $1 minimum (owner rule 2026-11-25): surveys typically
 *     pay $0.10–$2.00, so every survey that rounds to at least 1¢
 *     for the user lists. Dropped only: no clickUrl, no positive
 *     payout, or a user share that rounds to $0.00 (that would
 *     credit $0.00 — the same $0 rule as everywhere else).
 * Click opens the survey's clickUrl in a new tab (SurveyCard
 * already does this); completion credits through the existing
 * Offerwall.GG partner callback (colon, divisor 1000) — no new
 * callback, no popup, no levels: surveys are click-and-open.
 */
function mapOfferwallGgSurvey(
  raw: unknown,
  index: number,
  partner: { name: string; imageUrl: string | null },
  perUsd: number,
  sharePct: number,
): SurveyFeedItem | null {
  const rec = feedRecord(raw);
  if (!rec) return null;
  const clickUrl = feedStr(rec, ["clickUrl", "click_url"]);
  if (!clickUrl || !/^https?:\/\//i.test(clickUrl)) return null;
  // payoutUsd first (direct gross dollars); reward/perUsd fallback.
  const payoutUsd = feedNum(rec, ["payoutUsd", "payout_usd"]);
  const reward = feedNum(rec, ["reward"]);
  const userCents =
    payoutUsd != null && payoutUsd > 0
      ? Math.round(payoutUsd * sharePct)
      : reward != null && reward > 0 && Number.isFinite(perUsd) && perUsd > 0
        ? Math.round((reward / perUsd) * sharePct)
        : null;
  if (userCents == null || userCents < 1) return null;
  const mins = feedNum(rec, [
    "lengthMinutes",
    "length_minutes",
    "length",
    "minutes",
    "loi",
    "duration",
  ]);
  const surveyId = feedStr(rec, ["id", "survey_id"]) ?? String(index);
  return {
    key: `Offerwall.GG:survey:${surveyId}:${index}`,
    // No popup for surveys: no numeric offer id is ever needed.
    offerId: null,
    provider: partner.name,
    providerImageUrl: partner.imageUrl,
    // The survey's own image when the panel sent one (often ""); the
    // card falls back to the Offerwall.GG logo when this is null.
    imageUrl: feedStr(rec, ["image", "image_url", "thumbnail_url", "thumbnail", "icon"]),
    title: feedStr(rec, ["title", "name"]),
    payoutCents: userCents,
    minutes: mins != null && mins > 0 && mins <= 600 ? Math.round(mins) : null,
    url: clickUrl,
  };
}

async function offerwallGgSurveys(
  item: ContentRow,
  user: UserRow,
  ctx: PartnerFeedCtx,
): Promise<SurveyFeedItem[]> {
  if (!ctx.offerwallggApiKey || !ctx.offerwallggAppId) return [];
  // /surveys is 422 without the user's own ip + country — never
  // call it with the server's identity (the panels would answer
  // for the data centre and usually return nothing).
  if (!user.ip || !user.countryCode) return [];
  const cacheKey = `${user.id}:${ctx.device}`;
  const cached = offerwallGgSurveysCache.get(cacheKey);
  if (cached && Date.now() - cached.at < 120_000) return cached.items;
  const params = new URLSearchParams({
    appId: ctx.offerwallggAppId,
    userId: user.offerToken ?? user.userCode,
    ip: user.ip,
    country: user.countryCode,
    device: ctx.device,
    limit: "50",
  });
  if (ctx.userAgent) params.set("userAgent", ctx.userAgent);
  const json = await fetchFeedJson(
    `https://offerwall.gg/api/v1/surveys?${params.toString()}`,
    { "X-Api-Key": ctx.offerwallggApiKey },
  );
  const dataRec = feedRecord(json)?.["data"];
  const data = feedRecord(dataRec);
  const perUsd = data ? feedNum(feedRecord(data["currency"]) ?? {}, ["perUsd"]) : null;
  const list = data && Array.isArray(data["surveys"]) ? data["surveys"] : null;
  if (!list || perUsd == null) return [];
  const partner = {
    name: item.provider || item.title,
    imageUrl: item.imageUrl ?? null,
  };
  const items = list
    .map((raw, i) => mapOfferwallGgSurvey(raw, i, partner, perUsd, ctx.sharePct))
    .filter((s): s is SurveyFeedItem => s !== null);
  offerwallGgSurveysCache.set(cacheKey, { at: Date.now(), items });
  return items;
}

/**
 * TheoremReach Surveys API (theoremreach.com/docs/surveys_api).
 *
 * ROOT CAUSE of the empty Surveys list (fixed 2026-11-21): the old
 * adapter called https://theoremreach.com/api/offers/v1/offers —
 * a path that answers 404 — unsigned, with no IP/country, and the
 * shared mapper did not know the response's `entry_link` field, so
 * even a good answer would have been dropped item by item. The wall
 * worked because it is a different, browser-side product.
 *
 * The real API:
 *   GET https://api.theoremreach.com/api/publishers/v1/surveys
 *       ?api_key=…&user_id=…&ip=…&country_code=…&hash=…
 * Every request must be SIGNED — hash = base64url(HMAC-SHA1(secret,
 * the exact URL)), appended last; theoremReachSignature below is
 * that scheme (the same one the reward callback uses). Matching is
 * driven by the ip / country_code WE send, so we send the user's own
 * sign-in IP and locked country — the identity the respondent wall
 * sees when the user opens it. If that attempt returns nothing, we
 * retry with user_id alone, so TheoremReach matches from the stored
 * respondent profile it built for this user from their wall visits
 * (the very profile the wall shows its surveys for). Each returned
 * survey's entry_link arrives UNSIGNED and must be signed the same
 * way before a user may open it — unsigned links fail at
 * TheoremReach with a hash-signature error.
 *
 * External prerequisites on TheoremReach's side (not fixable in
 * code): the app's Publisher API must be enabled by TheoremReach
 * (part of the Go Live review) and the Secret Key must be saved in
 * Admin → Settings — without the secret no signed request exists.
 * The API key is read from the entry URL the admin saved for the
 * partner (it carries ?api_key=…).
 */
async function theoremReachSurveys(
  item: ContentRow,
  user: UserRow,
  ctx: PartnerFeedCtx,
): Promise<SurveyFeedItem[]> {
  const secret = ctx.theoremReachSecret;
  if (!secret) return [];
  let apiKey = "";
  try {
    apiKey = new URL(item.url).searchParams.get("api_key") ?? "";
  } catch {
    apiKey = "";
  }
  if (!apiKey) return [];
  const partner = {
    name: item.provider || item.title,
    imageUrl: item.imageUrl ?? null,
  };
  const uid = user.offerToken ?? user.userCode;
  const attempts: string[][] = [
    [
      `api_key=${encodeURIComponent(apiKey)}`,
      `user_id=${encodeURIComponent(uid)}`,
      ...(user.ip ? [`ip=${encodeURIComponent(user.ip)}`] : []),
      ...(user.countryCode
        ? [`country_code=${encodeURIComponent(user.countryCode)}`]
        : []),
    ],
    [
      `api_key=${encodeURIComponent(apiKey)}`,
      `user_id=${encodeURIComponent(uid)}`,
    ],
  ];
  for (const params of attempts) {
    const base =
      `https://api.theoremreach.com/api/publishers/v1/surveys?${params.join("&")}`;
    const hash = await theoremReachSignature(secret, base);
    const json = await fetchFeedJson(`${base}&hash=${hash}`);
    const list = json == null ? null : feedList(json);
    if (!list) continue;
    const mapped = list
      .map((raw, i) => mapFeedSurvey(raw, i, partner, ctx.sharePct))
      .filter((s): s is SurveyFeedItem => s !== null);
    if (mapped.length === 0) continue;
    // Sign every entry link before it reaches the client.
    return Promise.all(
      mapped.map(async (s) => {
        const sep = s.url.includes("?") ? "&" : "?";
        const sig = await theoremReachSignature(secret, s.url);
        return { ...s, url: `${s.url}${sep}hash=${sig}` };
      }),
    );
  }
  return [];
}

/**
 * CPX Research survey API: app_id is read from the wall URL the admin
 * saved (it carries ?app_id=…); output_method=api returns the surveys
 * CPX has matched to this ext_user_id as JSON instead of the wall.
 */
async function cpxSurveys(
  item: ContentRow,
  user: UserRow,
  ctx: PartnerFeedCtx,
): Promise<SurveyFeedItem[]> {
  let appId = "";
  try {
    appId = new URL(item.url).searchParams.get("app_id") ?? "";
  } catch {
    appId = "";
  }
  if (!appId) return [];
  const partner = {
    name: item.provider || item.title,
    imageUrl: item.imageUrl ?? null,
  };
  const json = await fetchFeedJson(
    `https://offers.cpx-research.com/index.php?app_id=${encodeURIComponent(appId)}&ext_user_id=${encodeURIComponent(user.offerToken ?? user.userCode)}&output_method=api`,
  );
  const list = json == null ? null : feedList(json);
  if (!list) return [];
  return list
    .map((raw, i) => mapFeedSurvey(raw, i, partner, ctx.sharePct))
    .filter((s): s is SurveyFeedItem => s !== null);
}

/**
 * Generic partner feed — the one-size adapter for every partner
 * without a dedicated one, present or future (Prime Survey, game
 * walls, any wall added later). When the admin saves an Items feed
 * URL on the partner's row (Admin → Content), the server fetches
 * that JSON feed FOR THIS USER — personalizeContentUrl substitutes
 * {user_id} (Offer Token), {ip} and {country} — so the partner
 * returns the items matched to this user's IP/country, and the
 * shared mapper turns them into cards that open each item's own
 * link. Crediting needs nothing partner-specific: completions come
 * back through the postback / partner-callback endpoints keyed by
 * the same Offer Token.
 */
async function genericFeedItems(
  item: ContentRow,
  user: UserRow,
  sharePct: number,
): Promise<SurveyFeedItem[]> {
  const feedUrl = item.feedUrl?.trim();
  if (!feedUrl) return [];
  const partner = {
    name: item.provider || item.title,
    imageUrl: item.imageUrl ?? null,
  };
  // Bearer auth for feeds that need it (Admin → Content → Feed
  // auth on this row): the secret is server-only and never reaches
  // a browser — it travels only in this server-to-partner request.
  const headers =
    item.feedAuthKind === "bearer" && item.feedSecret
      ? { Authorization: `Bearer ${item.feedSecret}` }
      : undefined;
  const json = await fetchFeedJson(
    personalizeContentUrl(feedUrl, user),
    headers,
  );
  const list = json == null ? null : feedList(json);
  if (!list) return [];
  return list
    .filter((raw) =>
      feedCategoryMatches(
        raw,
        item.feedCategory ?? "",
        item.feedCategoryMode ?? "include",
      ),
    )
    .map((raw, i) => mapFeedSurvey(raw, i, partner, sharePct))
    .filter((s): s is SurveyFeedItem => s !== null);
}

/** Routes one survey partner to its feed adapter, by provider name. */
function surveyFeedForPartner(
  item: ContentRow,
  user: UserRow,
  ctx: PartnerFeedCtx,
): Promise<SurveyFeedItem[]> {
  const key = partnerKeyOf(item.provider, item.title);
  if (key.includes("theoremreach") || key.includes("theorem reach"))
    return theoremReachSurveys(item, user, ctx);
  if (key.includes("cpx")) return cpxSurveys(item, user, ctx);
  // Offerwall.GG has its own Surveys API (see offerwallGgSurveys):
  // its surveys come from GET /api/v1/surveys, never from the
  // generic feed — the generic mapper would read its unit rewards
  // as dollars (875 units → $875 on the card).
  if (key.includes("offerwall.gg") || key.includes("offerwallgg"))
    return offerwallGgSurveys(item, user, ctx);
  // No dedicated adapter: the generic feed still lists this
  // partner's individual surveys when the admin saved a Feed URL
  // for it; otherwise it contributes nothing here (its wall card
  // still lives in the Offerwalls tab).
  return genericFeedItems(item, user, ctx.sharePct);
}

/** Routes one game partner to its feed adapter. */
function gameFeedForPartner(
  item: ContentRow,
  user: UserRow,
  ctx: PartnerFeedCtx,
): Promise<SurveyFeedItem[]> {
  const key = partnerKeyOf(item.provider, item.title);
  // Offerwall.GG has its own JSON API (see offerwallGgGames): its
  // games come from that API, never from the generic feed — the
  // generic mapper would read its unit rewards as dollars.
  if (key.includes("offerwall.gg") || key.includes("offerwallgg"))
    return offerwallGgGames(item, user, ctx);
  // Every other game partner: the generic feed is the route — a game
  // wall with an Items feed URL lists its individual games in the
  // Games tab exactly like survey partners list surveys. The row's
  // Category filter (e.g. "game") is applied inside genericFeedItems.
  // OWNER RULE 2026-11-25: no game under $1.00 lists — the same
  // $1.00 minimum as mapOfferwallGgOffer, applied here as a filter
  // (not inside mapFeedSurvey, which is SHARED with the Surveys tab
  // and must keep listing sub-$1 surveys). At present no other game
  // partner has a feed row, so this is future-proofing only.
  // (gameFeedForPartner is not async, so the filter rides on .then.)
  return genericFeedItems(item, user, ctx.sharePct).then((items) =>
    items.filter((s) => s.payoutCents >= 100),
  );
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
 * Hex HMAC (SHA-1 or SHA-256) for owner-configured partner callbacks
 * (Admin → Partner Callbacks). Two signature formats are supported:
 *   params — the signed string is every callback parameter EXCEPT the
 *            signature parameter itself, sorted by parameter name and
 *            joined as `name=value&name=value` with the values exactly
 *            as received — the scheme the admin panel documents for the
 *            owner, so a partner (or the owner, testing by hand) can
 *            reproduce it from the config alone.
 *   colon  — the signed string is "{user}:{txn}:{payout}" — the user ID,
 *            transaction ID and payout values joined with colons, in
 *            that order (the scheme Offerwall.GG uses).
 */
async function partnerHmacHexRaw(
  secret: string,
  canonical: string,
  hash: "SHA-1" | "SHA-256",
): Promise<string> {
  const enc = new TextEncoder();
  const key = await globalThis.crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash },
    false,
    ["sign"],
  );
  const raw = new Uint8Array(
    await globalThis.crypto.subtle.sign("HMAC", key, enc.encode(canonical)),
  );
  return [...raw].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function partnerHmacHex(
  secret: string,
  params: Record<string, string>,
  signatureParam: string,
  hash: "SHA-1" | "SHA-256",
): Promise<string> {
  const canonical = Object.keys(params)
    .filter((k) => k !== signatureParam)
    .sort()
    .map((k) => `${k}=${params[k] ?? ""}`)
    .join("&");
  return partnerHmacHexRaw(secret, canonical, hash);
}

/**
 * Replaces every {placeholder} in an admin-typed signature template
 * with the value exactly as received. Placeholders are the four
 * roles every callback carries — {user} {tx} {amount} {status} —
 * plus any parameter name the admin configured for this partner.
 * Returns null when the template has an unclosed brace or a
 * placeholder that is neither a role nor a configured parameter
 * name. A null here is a config error (the admin is told at save
 * time), never a silent mismatch. Templates are only string
 * substitution — no code runs from them.
 */
function resolveSigTemplate(
  template: string,
  values: { user: string; tx: string; amount: string; status: string },
  params: Record<string, string>,
): string | null {
  let out = "";
  let i = 0;
  while (i < template.length) {
    const open = template.indexOf("{", i);
    if (open === -1) {
      out += template.slice(i);
      break;
    }
    out += template.slice(i, open);
    const close = template.indexOf("}", open + 1);
    if (close === -1) return null;
    const name = template.slice(open + 1, close).trim();
    if (name === "user") out += values.user;
    else if (name === "tx") out += values.tx;
    else if (name === "amount") out += values.amount;
    else if (name === "status") out += values.status;
    else if (name !== "" && name in params) out += params[name] ?? "";
    else return null;
    i = close + 1;
  }
  return out;
}

/**
 * Save-time check for an admin-typed template: returns an error
 * message for the admin, or null when the template is usable.
 * `paramNames` are the parameter names configured for this partner
 * (user / transaction / payout / status — never the secret
 * parameter, which must never be part of the signed string).
 */
function sigTemplateError(
  template: string,
  paramNames: string[],
): string | null {
  if (!template.trim())
    return "Type the signature template — e.g. {tx}:{user}:{amount}:{status}.";
  if (template.length > 200)
    return "The signature template must be 200 characters or fewer.";
  const probe = resolveSigTemplate(
    template,
    { user: "", tx: "", amount: "", status: "" },
    Object.fromEntries(paramNames.filter(Boolean).map((n) => [n, ""])),
  );
  if (probe === null)
    return "The signature template has an unknown {placeholder} or an unclosed brace. Allowed: {user} {tx} {amount} {status} and the parameter names you configured for this partner.";
  return null;
}

/** Constant-time string compare for secrets and signatures. */
function secretsEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

type PartnerCallbackRow = typeof schema.partnerCallbacks.$inferSelect;

const partnerCallbackShape = z.object({
  id: z.number(),
  key: z.string(),
  name: z.string(),
  userParam: z.string(),
  txnParam: z.string(),
  payoutParam: z.string(),
  payoutInCents: z.boolean(),
  sigFormat: z.enum(["params", "colon", "moonetix", "custom"]),
  sigTemplate: z.string().nullable(),
  statusParam: z.string(),
  statusCreditValue: z.string(),
  payoutDivisor: z.number(),
  authMethod: z.enum(["none", "secret", "hmac_sha1", "hmac_sha256"]),
  secretParam: z.string(),
  // The secret value itself is NEVER sent back to the client — only
  // whether one is stored (same rule as the postback secrets).
  secretSet: z.boolean(),
  // The wall-link salt itself is NEVER sent back either — only
  // whether one is stored.
  linkHashSaltSet: z.boolean(),
  linkHashParam: z.string(),
  active: z.boolean(),
  createdAt: z.string(),
});

function publicPartnerCallback(
  row: PartnerCallbackRow,
): z.infer<typeof partnerCallbackShape> {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    userParam: row.userParam,
    txnParam: row.txnParam,
    payoutParam: row.payoutParam,
    payoutInCents: row.payoutInCents === 1,
    sigFormat: row.sigFormat,
    sigTemplate: row.sigTemplate ?? null,
    statusParam: row.statusParam,
    statusCreditValue: row.statusCreditValue,
    payoutDivisor: row.payoutDivisor,
    authMethod: row.authMethod,
    secretParam: row.secretParam,
    secretSet: row.secret !== "",
    linkHashSaltSet: row.linkHashSalt !== "",
    linkHashParam: row.linkHashParam,
    active: row.active === 1,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 *  * The one reward-credit path, shared by the generic offerwall postback, */ function offerInfoFromRaw(rawJson: string): { title: string | null; imageUrl: string | null } { try { const v = JSON.parse(rawJson) as Record<string, unknown>; const str = (x: unknown): string | null => typeof x === "string" && x.trim() ? x.trim() : null; return { title: str(v.offer_name) ?? str(v.offer_title) ?? str(v.offername) ?? str(v.title) ?? str(v.name), imageUrl: str(v.offer_image) ?? str(v.offer_image_url) ?? str(v.image_url) ?? str(v.image) ?? str(v.icon) }; } catch { return { title: null, imageUrl: null }; } } function wallFor(network: string, walls: { provider: string; title: string; imageUrl: string | null }[]): { provider: string; title: string; imageUrl: string | null } | null { const n = network.trim().toLowerCase(); if (!n) return null; return (walls.filter((w) => { const p = (w.provider || "").trim().toLowerCase().replace(/[^a-z0-9]/g, ""); const t = (w.title || "").trim().toLowerCase().replace(/[^a-z0-9]/g, ""); const m = n.replace(/[^a-z0-9]/g, ""); return m.length > 0 && ((p.length > 0 && (p === m || p.includes(m) || m.includes(p))) || (t.length > 0 && (t === m || t.includes(m) || m.includes(t)))); }).sort((a, b) => ((b.imageUrl || "").trim() !== "" ? 1 : 0) - ((a.imageUrl || "").trim() !== "" ? 1 : 0))[0] ?? null); } /** * The one reward-credit path, shared by the generic offerwall postback,
 * the TheoremReach callback and every owner-configured partner
 * callback: inserts the postback log row (its
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
  const creditedCents = Math.round(opts.payout * 100 * (sharePct / 100)); if (creditedCents <= 0) return 0; const offerInfo = offerInfoFromRaw(opts.rawJson);
  const statements: BatchItem<"sqlite">[] = [
    db.insert(schema.postbacks).values({
      txnId: opts.txnId,
      network: opts.network,
      userId: user.id,
      payout: opts.payout,
      creditedCents,
      status: "credited",
      rawJson: opts.rawJson, offerTitle: offerInfo.title, offerImageUrl: offerInfo.imageUrl, kind: isSurveyNetwork(opts.network) ? "survey" : "offer",
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
  // "vpn_blocked" was removed 2026-11-27 (owner order): VPN sign-ups
  // and logins now work, so no sign-in ever returns it.
  status: z.enum(["ok", "blocked", "country_banned"]),
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

// ------------------------------------------------------- live chat helpers
//
// One shared public chat (inside Help). Roles: "user", "manager" (a user
// the owner made a chat manager — Manager tick, can also block/unblock)
// and "owner" (the owner replying from the Admin panel — Official TapOne
// tick, stored with user_id -1). A blocked user can still READ the chat,
// just not send.

const chatMessageShape = z.object({
  id: z.number(),
  userId: z.number(),
  role: z.enum(["user", "manager", "owner"]),
  name: z.string(),
  pictureUrl: z.string().nullable(),
  body: z.string(),
  createdAt: z.string(),
});

// The active send-block for a user, if any. An expired timed block is
// cleared lazily and no longer counts.
async function activeChatBlock(
  db: DB,
  userId: number,
): Promise<typeof schema.chatBlocks.$inferSelect | null> {
  const rows = await db
    .select()
    .from(schema.chatBlocks)
    .where(eq(schema.chatBlocks.userId, userId))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) {
    await db
      .delete(schema.chatBlocks)
      .where(eq(schema.chatBlocks.userId, userId));
    return null;
  }
  return row;
}

const CHAT_BLOCK_DAYS = [1, 7, 30] as const;

// Blocks a user from sending in Live Chat. days must be 1 / 7 / 30 for a
// timed block; null/undefined = permanent. One active block per user —
// blocking again replaces the previous block (new expiry, new blocker).
async function blockChatUser(
  db: DB,
  userId: number,
  blockedBy: number,
  days?: number | null,
): Promise<void> {
  if (days != null && !(CHAT_BLOCK_DAYS as readonly number[]).includes(days))
    throw new Error("Block length must be 1, 7 or 30 days, or permanent.");
  const target = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  if (!target[0]) throw new Error("That user no longer exists.");
  const expiresAt =
    days != null ? new Date(Date.now() + days * 24 * 60 * 60 * 1000) : null;
  await db
    .insert(schema.chatBlocks)
    .values({ userId, blockedBy, expiresAt, createdAt: new Date() })
    .onConflictDoUpdate({
      target: schema.chatBlocks.userId,
      set: { blockedBy, expiresAt, createdAt: new Date() },
    });
}

// Newest chat messages (oldest first for display) with each sender's
// current name + profile picture, plus the currently-blocked users.
async function loadChatMessages(db: DB, limit = 100) {
  const rows = await db
    .select()
    .from(schema.chatMessages)
    .orderBy(desc(schema.chatMessages.id))
    .limit(limit);
  rows.reverse();
  const users = await db.select().from(schema.users);
  const byId = new Map(users.map((u) => [u.id, u]));
  const blocks = await db.select().from(schema.chatBlocks);
  const now = Date.now();
  const blocked = blocks
    .filter((b) => !b.expiresAt || b.expiresAt.getTime() > now)
    .map((b) => ({
      userId: b.userId,
      expiresAt: b.expiresAt ? b.expiresAt.toISOString() : null,
    }));
  return {
    messages: rows.map((m) => {
      const u = m.userId > 0 ? byId.get(m.userId) : undefined;
      return {
        id: m.id,
        userId: m.userId,
        role: m.role,
        name: m.role === "owner" ? "TapOne" : (u?.name ?? "User"),
        pictureUrl: m.role === "owner" ? null : (u?.pictureUrl ?? null),
        body: m.body,
        createdAt: m.createdAt.toISOString(),
      };
    }),
    blocked,
  };
}

// ------------------------------------------------------------------ actions

export const Actions = {
  getPublicHome: defineAction({
    description:
      "Public landing data: Google client id, featured games, priced items for all three sections (offerwalls, surveys, games), section counts, recent approved payouts.",
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
      minWithdrawCents: z.number(),
      socialLinks: z.array(
        z.object({
          platform: z.string(),
          label: z.string(),
          url: z.string(),
          imageUrl: z.string(),
          // 1 = the owner shows this link in the Redeem Code section;
          // 0 = hidden there (the public footer still lists every link
          // that has a URL, as before).
          active: z.number(),
        }),
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

    getLiveCompletions: defineAction({ description: "Public latest-completed feed (Live Cashout): the newest credited offer/survey/game completions from every user, newest first. Only the newest 4 ever show, rolling — each new completion pushes the oldest off the list. No login needed. Only first names and profile pictures are returned — never email, IP, country or account IDs.", request: z.object({}), response: z.object({ items: z.array(z.object({ id: z.number(), userName: z.string(), userPictureUrl: z.string().nullable(), network: z.string(), title: z.string(), imageUrl: z.string().nullable(), kind: z.enum(["offer", "survey"]), creditedCents: z.number(), createdAt: z.string() })) }), async handler(ctx) { const db = ctx.db<typeof schema>(); const rows = await db.select().from(schema.postbacks).where(and(eq(schema.postbacks.status, "credited"), gt(schema.postbacks.creditedCents, 0))).orderBy(desc(schema.postbacks.id)).limit(100); const userIds = [...new Set(rows.map((r) => r.userId).filter((id): id is number => id != null))]; const users = userIds.length ? await db.select().from(schema.users).where(inArray(schema.users.id, userIds)) : []; const byId = new Map(users.map((u) => [u.id, u])); const walls = await db.select().from(schema.contentItems); return { items: rows.filter((r) => isLiveNetwork(r.network, walls)).map((r) => { const u = r.userId != null ? byId.get(r.userId) : undefined; const stored = offerInfoFromRaw(r.rawJson); const wall = wallFor(r.network, walls); return { id: r.id, userName: (u?.name ?? "TapOne user").split(" ")[0] ?? "TapOne user", userPictureUrl: u?.pictureUrl ?? null, network: r.network, title: r.offerTitle ?? stored.title ?? wall?.title ?? wall?.provider ?? r.network, imageUrl: r.offerImageUrl ?? stored.imageUrl ?? wall?.imageUrl ?? null, kind: isSurveyNetwork(r.network) ? ("survey" as const) : ("offer" as const), creditedCents: r.creditedCents, createdAt: r.createdAt.toISOString() }; }).slice(0, 4) }; }, }),  getTopEarners: defineAction({ description: "Public Top 100 earners: the 100 users with the highest lifetime earnings, ranked by total earned, each with picture, first name, total earning and total cashout (approved withdrawals only). No contests, no prizes. No login needed; no email, IP, country or account IDs are ever returned.", request: z.object({}), response: z.object({ items: z.array(z.object({ rank: z.number(), name: z.string(), pictureUrl: z.string().nullable(), totalEarnedCents: z.number(), totalCashoutCents: z.number() })) }), async handler(ctx) { const db = ctx.db<typeof schema>(); const top = await db.select().from(schema.users).where(gt(schema.users.totalEarnedCents, 0)).orderBy(desc(schema.users.totalEarnedCents)).limit(100); const ids = top.map((u) => u.id); const paid = ids.length ? await db.select().from(schema.withdrawals).where(and(inArray(schema.withdrawals.userId, ids), eq(schema.withdrawals.status, "approved"))) : []; const cashout = new Map<number, number>(); for (const w of paid) cashout.set(w.userId, (cashout.get(w.userId) ?? 0) + w.amountCents); return { items: top.map((u, i) => ({ rank: i + 1, name: u.name.split(" ")[0] ?? u.name, pictureUrl: u.pictureUrl ?? null, totalEarnedCents: u.totalEarnedCents, totalCashoutCents: cashout.get(u.id) ?? 0 })) }; }, }),  detectNetwork: defineAction({
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
      "Signs a user in or up with Google (verified ID token from the real Google button), locks country from the login IP, blocks blocked accounts and new signups from banned countries, captures referral codes, and notifies the admin on every new registration. VPN connections are allowed (owner order 2026-11-27): a VPN sign-up creates the account.",
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
      // Usernames are unique (owner order 2026-11-27): if the Google
      // account name is already taken, a number is appended (2, 3, …)
      // until it is free — a Google sign-up is never blocked by a
      // collision and never creates a duplicate username.
      name = await uniqueUsername(db, name);

      const geo = await lookupGeo(args.ip?.trim() ? args.ip.trim() : null);
      // VPN is NOT blocked (owner order 2026-11-27): a VPN sign-up
      // must create the account, and a VPN login signs in normally.
      // The offerwalls reject such users' offers themselves.

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
            // NOTE: the stored display name is deliberately NOT
            // overwritten with the Google account name here — a name
            // the user picked in Profile (they get 3 lifetime changes)
            // must survive every later sign-in.
            pictureUrl: user.pictureUrl ?? pictureUrl,
            // COUNTRY + IP LOCK (owner rule 2026-11-21): the country
            // and IP stored at ACCOUNT CREATION decide the user's
            // withdraw methods and content for the account's whole
            // life, so a later sign-in must NEVER overwrite them —
            // re-detecting on every login silently flipped accounts
            // to whatever country the latest connection resolved to
            // (a Pakistan account lost Easypaisa/JazzCash that way).
            // Only the owner can correct a locked country, from
            // Admin → Users (adminSetUserCountry). The fresh geo is
            // still used above for the ban check on THIS login.
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

  signUpWithEmail: defineAction({
    description:
      "Starts an email + password sign-up: creates the account UNVERIFIED and emails a 6-digit code to that address. The account activates only when verifyEmailCode succeeds — no session is issued here, and the admin registration alert is sent at activation, not at this step. One account per email (owner order 2026-11-27): an address that already has an activated account — email or Google — returns email_in_use and creates nothing. A username is REQUIRED (owner order 2026-11-27): an empty username is refused with an error and creates nothing, and the old email-prefix default is no longer used. Usernames are unique, case-insensitively (owner order 2026-11-27): a typed username that is already taken is refused with an error and creates nothing. Signing up again with an unverified address just sends a fresh code (and updates the password). VPN connections are allowed (owner order 2026-11-27).",
    request: z.object({
      email: z.string().trim().min(3).max(254),
      // No zod minimum here on purpose: the handler below throws the
      // clear "Password must be at least 8 characters." error (owner
      // rule 2026-11-27) instead of a generic validation message.
      password: z.string().max(128),
      name: z.string().trim().max(80).optional(),
      ip: z.string().max(64).optional(),
      referralCode: z.string().trim().max(32).optional(),
    }),
    response: z.object({
      status: z.enum([
        "code_sent",
        "email_in_use",
        "email_unavailable",
        "country_banned",
      ]),
    }),
    async handler(
      ctx,
      args,
    ): Promise<{
      status: "code_sent" | "email_in_use" | "email_unavailable" | "country_banned";
    }> {
      const email = normalizeEmail(args.email);
      if (!email) throw new Error("Enter a valid email address.");
      if (args.password.length < 8)
        throw new Error("Password must be at least 8 characters.");
      // A username is REQUIRED (owner order 2026-11-27): an empty
      // username is refused before anything is created or any code is
      // sent. This sits before the account lookup, so it covers both
      // the new-account path and the unverified re-send path below.
      if (!args.name?.trim())
        throw new Error("Please enter a username.");
      const db = ctx.db<typeof schema>();

      const existing = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.email, email))
        .limit(1);
      const user = existing[0];
      if (user) {
        if (user.loginMethod === "email" && user.emailVerified === 0) {
          // Still unverified: a fresh code, and the password they just
          // typed becomes the account password.
          const typedName = args.name?.trim();
          // Usernames are unique (owner order 2026-11-27): a typed
          // username that belongs to someone else is refused before
          // anything is updated and before any code is sent.
          if (
            typedName &&
            typedName.toLowerCase() !== user.name.toLowerCase() &&
            (await isUsernameTaken(db, typedName, user.id))
          )
            throw new Error(
              "This username is already taken — please choose another.",
            );
          await db
            .update(schema.users)
            .set({
              passwordHash: await hashPassword(args.password),
              name: typedName || user.name,
            })
            .where(eq(schema.users.id, user.id));
          const issued = await issueEmailCode(db, email, "signup");
          if (issued === "too_soon")
            throw new Error(
              "A code was just sent — please wait a minute before asking again.",
            );
          if (issued === "unavailable") return { status: "email_unavailable" };
          return { status: "code_sent" };
        }
        return { status: "email_in_use" }; // Activated account of
        // either kind — one account per email (owner order
        // 2026-11-27); no duplicate is created.
      }

      // Usernames are unique (owner order 2026-11-27): a typed username
      // that is already taken is refused BEFORE any account is created
      // and before any code is sent. The username is required (see the
      // check at the top of this handler) — the old email-prefix
      // default is no longer used for an empty username.
      const typedUsername = args.name?.trim() ?? "";
      if (await isUsernameTaken(db, typedUsername))
        throw new Error(
          "This username is already taken — please choose another.",
        );
      const username = typedUsername;

      const geo = await lookupGeo(args.ip?.trim() ? args.ip.trim() : null);
      // VPN is allowed (owner order 2026-11-27) — no check here.
      const banned = await findBannedCountry(db, geo.countryCode);
      if (banned) {
        return { status: "country_banned" };
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
          name: username,
          email,
          passwordHash: await hashPassword(args.password),
          emailVerified: 0,
          pictureUrl: null,
          loginMethod: "email",
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
      const created = inserted[0];
      if (!created) throw new Error("Could not create your account.");
      const issued = await issueEmailCode(db, email, "signup");
      if (issued === "unavailable") return { status: "email_unavailable" };
      return { status: "code_sent" };
    },
  }),

  verifyEmailCode: defineAction({
    description:
      "Verifies the 6-digit sign-up code sent to an email address and signs the user in: the email account activates here (the admin registration alert is sent now, not at sign-up). The code works exactly once.",
    request: z.object({
      email: z.string().trim().min(3).max(254),
      code: z.string().trim().min(6).max(6),
      ip: z.string().max(64).optional(),
    }),
    response: signInResponse,
    async handler(ctx, args): Promise<SignInResult> {
      const email = normalizeEmail(args.email);
      if (!email) throw new Error("Enter a valid email address.");
      const db = ctx.db<typeof schema>();
      const settings = await getSettings(db);
      const check = await checkEmailCode(db, email, "signup", args.code);
      if (check === "not_found")
        throw new Error("No code was sent to this email — request a new one.");
      if (check === "expired")
        throw new Error("That code has expired — request a new one.");
      if (check === "wrong")
        throw new Error(
          "Wrong code — check the code in your email and try again.",
        );
      if (check === "too_many")
        throw new Error("Too many wrong attempts — request a new code.");
      const rows = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.email, email))
        .limit(1);
      const user = rows[0];
      if (!user) throw new Error("No account for this email — sign up first.");
      if (user.loginMethod !== "email")
        throw new Error("This email does not use email sign-in.");
      if (user.blocked === 1) {
        return { status: "blocked", token: null, user: null };
      }
      if (user.emailVerified === 0) {
        await db
          .update(schema.users)
          .set({ emailVerified: 1 })
          .where(eq(schema.users.id, user.id));
        // Registration alert for the owner — the account becomes a
        // real account only now, when the email is proven.
        const geo = await lookupGeo(args.ip?.trim() ? args.ip.trim() : null);
        await db.insert(schema.adminNotifications).values({
          type: "registration",
          userId: user.id,
          userName: user.name,
          userEmail: user.email,
          userCode: user.userCode,
          countryCode: user.countryCode,
          countryName: user.countryName,
          flagEmoji: user.flagEmoji ?? flagFromCountryCode(user.countryCode),
          ip: user.ip ?? geo.ip,
          read: 0,
        });
      }
      const refreshed = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, user.id))
        .limit(1);
      return issueSession(db, ctx, refreshed[0] ?? user, settings);
    },
  }),

  signInWithEmail: defineAction({
    description:
      "Signs in with email + password ONLY — no code step at login, ever (owner order 2026-11-27: the verification code lives only in the sign-up flow). An account whose email was never verified at sign-up was never activated and cannot log in; signing up again with the same email sends a fresh code. 'No such email' and 'wrong password' share one message so the form cannot probe which emails exist.",
    request: z.object({
      email: z.string().trim().min(3).max(254),
      password: z.string().min(1).max(128),
      ip: z.string().max(64).optional(),
    }),
    response: signInResponse,
    async handler(ctx, args): Promise<SignInResult> {
      const email = normalizeEmail(args.email);
      if (!email) throw new Error("Enter a valid email address.");
      const db = ctx.db<typeof schema>();
      const settings = await getSettings(db);
      const rows = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.email, email))
        .limit(1);
      const user = rows[0];
      if (!user) throw new Error("Wrong email or password.");
      if (user.loginMethod === "google")
        throw new Error(
          "This email uses Google sign-in — use the Google button instead.",
        );
      if (!(await verifyPassword(args.password, user.passwordHash)))
        throw new Error("Wrong email or password.");
      if (user.blocked === 1) {
        return { status: "blocked", token: null, user: null };
      }
      // An email account that was never verified at sign-up was never
      // activated, so it cannot log in at all (owner order
      // 2026-11-27: the code step lives ONLY in the sign-up flow, never
      // at login). Same generic message as a wrong password — the
      // account is simply not usable yet. Signing up again with the
      // same email sends a fresh code and finishes the activation.
      if (user.emailVerified === 0) throw new Error("Wrong email or password.");
      await db
        .update(schema.users)
        .set({ lastSeenAt: new Date() })
        .where(eq(schema.users.id, user.id));
      const refreshed = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, user.id))
        .limit(1);
      return issueSession(db, ctx, refreshed[0] ?? user, settings);
    },
  }),

  requestPasswordReset: defineAction({
    description:
      "Sends a 6-digit password-reset code to an email account. Returns code_sent when a code was actually issued (or the email is unknown, so nothing about the account is revealed); returns google_account — and sends no code — when the email belongs to a Google-only account, so the sign-in screen can point the user at Google instead of a code that will never arrive.",
    request: z.object({ email: z.string().trim().min(3).max(254) }),
    response: z.object({
      ok: z.literal(true),
      status: z.enum(["code_sent", "google_account"]),
    }),
    async handler(
      ctx,
      args,
    ): Promise<{ ok: true; status: "code_sent" | "google_account" }> {
      const email = normalizeEmail(args.email);
      const db = ctx.db<typeof schema>();
      if (email) {
        const rows = await db
          .select()
          .from(schema.users)
          .where(eq(schema.users.email, email))
          .limit(1);
        const user = rows[0];
        if (user && user.loginMethod !== "email") {
          // A Google-only account has no password to reset, so no code
          // is issued. The caller is told (rather than the generic
          // code screen) so the user is not left waiting for a code
          // that will never arrive. Signup already reveals that an
          // email has an account, so this is consistent with the
          // site's existing posture.
          return { ok: true, status: "google_account" };
        }
        if (user) {
          await issueEmailCode(db, email, "reset");
        }
      }
      return { ok: true, status: "code_sent" };
    },
  }),

  resetPasswordWithCode: defineAction({
    description:
      "Resets an email account's password with the 6-digit code sent to that email. The code works once, and every other session for the account is ended.",
    request: z.object({
      email: z.string().trim().min(3).max(254),
      code: z.string().trim().min(6).max(6),
      // No zod minimum here on purpose — see signUpWithEmail: the
      // handler throws the clear 8-character error instead.
      newPassword: z.string().max(128),
    }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const email = normalizeEmail(args.email);
      if (!email) throw new Error("Enter a valid email address.");
      if (args.newPassword.length < 8)
        throw new Error("New password must be at least 8 characters.");
      const db = ctx.db<typeof schema>();
      const check = await checkEmailCode(db, email, "reset", args.code);
      if (check === "not_found")
        throw new Error("No reset code was sent to this email — request a new one.");
      if (check === "expired")
        throw new Error("That code has expired — request a new one.");
      if (check === "wrong")
        throw new Error(
          "Wrong code — check the code in your email and try again.",
        );
      if (check === "too_many")
        throw new Error("Too many wrong attempts — request a new code.");
      const rows = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.email, email))
        .limit(1);
      const user = rows[0];
      if (!user || user.loginMethod !== "email")
        throw new Error("No email account for this address.");
      await db
        .update(schema.users)
        .set({ passwordHash: await hashPassword(args.newPassword) })
        .where(eq(schema.users.id, user.id));
      // A changed password ends every other session, so a session
      // opened before the reset cannot keep being used.
      await db
        .delete(schema.sessions)
        .where(eq(schema.sessions.userId, user.id));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  resendEmailCode: defineAction({
    description:
      "Re-sends the sign-up verification code to a still-unverified email account (at most one code per minute).",
    request: z.object({ email: z.string().trim().min(3).max(254) }),
    response: z.object({
      status: z.enum(["code_sent", "not_pending", "email_unavailable"]),
    }),
    async handler(
      ctx,
      args,
    ): Promise<{ status: "code_sent" | "not_pending" | "email_unavailable" }> {
      const email = normalizeEmail(args.email);
      if (!email) throw new Error("Enter a valid email address.");
      const db = ctx.db<typeof schema>();
      const rows = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.email, email))
        .limit(1);
      const user = rows[0];
      if (!user || user.loginMethod !== "email" || user.emailVerified === 1)
        return { status: "not_pending" };
      const issued = await issueEmailCode(db, email, "signup");
      if (issued === "too_soon")
        throw new Error(
          "A code was just sent — please wait a minute before asking again.",
        );
      if (issued === "unavailable") return { status: "email_unavailable" };
      return { status: "code_sent" };
    },
  }),

  getMe: defineAction({
    description: "Returns the signed-in user's profile, balance and unread message count.",
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
      const visible = rows.filter(
        (r) =>
          visibleInCountry(r.countries, countryCode) &&
          // Feed-marker game rows are NOT games: a kind:"game" row
          // with an Items feed URL exists only so listGameFeed
          // knows which partner feed to pull — its own items arrive
          // through the feed. Showing the row itself renders a
          // phantom "$0.00 / This game is not open for play yet"
          // card (no Offer URL, no milestones, no reward), so drop
          // it here, server-side, where its feedUrl is visible.
          // publicContent does not expose feedUrl, so the client
          // cannot tell a marker row from a real game — that is why
          // this is done here and not in GamesSection. Admin-added
          // games (no feed URL) are unaffected, and listGameFeed
          // still reads the marker rows directly from the DB.
          !(args.kind === "game" && (r.feedUrl ?? "").trim()),
      );
      // Wall-link signing salts, keyed by partner name: when the
      // admin saved a salt for a partner (Admin → Partner
      // Callbacks), the personalised wall link below is signed with
      // it, so the partner's hash check can stay ON. Partners
      // without a salt keep today's unsigned link.
      const signingRows = await db
        .select()
        .from(schema.partnerCallbacks)
        .where(eq(schema.partnerCallbacks.active, 1));
      const linkSigning = new Map<string, { salt: string; param: string }>();
      for (const cb of signingRows) {
        if (!cb.linkHashSalt) continue;
        linkSigning.set(partnerKeyOf(cb.name, cb.key), {
          salt: cb.linkHashSalt,
          param: cb.linkHashParam || "hash",
        });
      }
      // One card per partner in Offers / Surveys partners (owner
      // order 2026-11-21): duplicate rows for the same partner —
      // e.g. TheoremReach added twice — collapse to a single card,
      // preferring the featured row. Games are NOT deduped: every
      // game the admin adds shows.
      let deduped = visible;
      if (args.kind !== "game") {
        const kept: typeof visible = [];
        const indexByPartner = new Map<string, number>();
        for (const r of visible) {
          const k = partnerKeyOf(r.provider, r.title);
          const at = indexByPartner.get(k);
          if (at === undefined) {
            indexByPartner.set(k, kept.length);
            kept.push(r);
          } else {
            const existing = kept[at];
            if (existing && existing.featured !== 1 && r.featured === 1)
              kept[at] = r;
          }
        }
        deduped = kept;
      }
      return {
        items: await Promise.all(
          deduped.map(async (r) => {
            const item = publicContent(r);
            // Signed-in users get a personal link: {user_id} → their
            // Offer Token, {transaction_id} → a fresh unique ID, so a
            // completed offer/survey can be credited back to them.
            if (viewer) {
              item.url = personalizeContentUrl(item.url, viewer);
              // Signed wall link: HMAC-SHA256(salt, user Offer Token),
              // the scheme Moonetix documents for its wall links.
              // Only the server ever sees the salt.
              const signing = linkSigning.get(
                partnerKeyOf(r.provider, r.title),
              );
              if (signing && item.url) {
                const sig = await partnerHmacHexRaw(
                  signing.salt,
                  viewer.offerToken ?? viewer.userCode,
                  "SHA-256",
                );
                const sep = item.url.includes("?") ? "&" : "?";
                item.url = `${item.url}${sep}${signing.param}=${sig}`;
              }
            }
            return item;
          }),
        ),
      };
    },
  }),

  listSurveyFeed: defineAction({
    description:
      "The signed-in user's individual surveys, pulled live from every active survey partner the admin has added (TheoremReach, CPX, …) and visible in the user's country: the partner matched them to this user's account/IP, and each entry carries that survey's own entry link, the payout the user will earn (their revenue share) and its length in minutes. Partner walls/websites are never returned — only individual surveys.",
    request: z.object({
      token: z.string().min(1).max(200),
      // The visitor's device + user agent — the survey panels
      // match per person from these (same as the Games tab).
      device: z.enum(["android", "iphone"]).optional(),
      userAgent: z.string().max(512).optional(),
    }),
    response: z.object({ surveys: z.array(surveyFeedItemShape) }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const user = await requireUser(ctx, args.token);
      const settings = await getSettings(db);
      const sharePct = settingInt(settings, "user_share_pct") || 70;
      const device: "android" | "iphone" =
        args.device === "iphone" ? "iphone" : "android";
      // Offerwall.GG's appId is the 32-character PUBLIC key in its
      // own wall URL (Admin → Content → Offerwall.GG → Offer URL
      // …/wall/<publicKey>?userId=…). It is public, never a secret.
      // Same lookup as listGameFeed.
      const wallRows = await db
        .select()
        .from(schema.contentItems)
        .where(
          and(
            eq(schema.contentItems.kind, "offerwall"),
            eq(schema.contentItems.active, 1),
          ),
        );
      const offerwallGgWall = wallRows.find((r) =>
        partnerKeyOf(r.provider, r.title).includes("offerwall.gg"),
      );
      const offerwallggAppId =
        offerwallGgWall?.url.match(/\/wall\/([A-Za-z0-9]{32})/)?.[1] ?? "";
      const rows = await db
        .select()
        .from(schema.contentItems)
        .where(
          and(
            eq(schema.contentItems.kind, "survey"),
            eq(schema.contentItems.active, 1),
          ),
        )
        .orderBy(schema.contentItems.sortOrder, desc(schema.contentItems.id));
      // One feed per partner, from the partners visible in the
      // user's own (login-IP) country — the same IP rule as content.
      const seenPartners = new Set<string>();
      const partners = rows.filter((r) => {
        if (!visibleInCountry(r.countries, user.countryCode)) return false;
        const k = partnerKeyOf(r.provider, r.title);
        if (seenPartners.has(k)) return false;
        seenPartners.add(k);
        return true;
      });
      const feedCtx: PartnerFeedCtx = {
        sharePct,
        theoremReachSecret: settings["theoremreach_secret"] ?? "",
        offerwallggApiKey: settings["offerwallgg_api_key"] ?? "",
        offerwallggAppId,
        device,
        userAgent: args.userAgent?.trim() ?? "",
      };
      const perPartner = await Promise.all(
        partners.map((p) => surveyFeedForPartner(p, user, feedCtx)),
      );
      const byUrl = new Map<string, SurveyFeedItem>();
      for (const s of perPartner.flat())
        if (!byUrl.has(s.url)) byUrl.set(s.url, s);
      // Partners return their items in the order they recommend
      // showing them (TheoremReach is explicit about this) — keep
      // that order; do not re-sort by payout.
      const surveys = [...byUrl.values()].slice(0, 100);
      return { surveys };
    },
  }),

  listGameFeed: defineAction({
    description:
      "The signed-in user's individual games, pulled live from every active game partner that exposes an items feed (Admin → Content → Items feed URL) and visible in the user's country: each entry carries that game's own link and the payout the user will earn (their revenue share). This is how a game WALL's own games reach the same Games tab as admin-added games (listContent), with the same per-user IP/country matching and the same callback crediting on completion.",
    request: z.object({
      token: z.string().min(1).max(200),
      // The Games tab's Android/iOS toggle — Offerwall.GG (and any
      // device-aware feed) is asked for this device's games.
      device: z.enum(["android", "iphone"]).optional(),
      userAgent: z.string().max(512).optional(),
    }),
    response: z.object({ games: z.array(surveyFeedItemShape) }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const user = await requireUser(ctx, args.token);
      const settings = await getSettings(db);
      const device: "android" | "iphone" =
        args.device === "iphone" ? "iphone" : "android";
      // Offerwall.GG's appId is the 32-character PUBLIC key in its
      // own wall URL (Admin → Content → Offerwall.GG → Offer URL
      // …/wall/<publicKey>?userId=…). It is public, never a secret.
      const wallRows = await db
        .select()
        .from(schema.contentItems)
        .where(
          and(
            eq(schema.contentItems.kind, "offerwall"),
            eq(schema.contentItems.active, 1),
          ),
        );
      const offerwallGgWall = wallRows.find((r) =>
        partnerKeyOf(r.provider, r.title).includes("offerwall.gg"),
      );
      const offerwallggAppId =
        offerwallGgWall?.url.match(/\/wall\/([A-Za-z0-9]{32})/)?.[1] ?? "";
      const feedCtx: PartnerFeedCtx = {
        sharePct: settingInt(settings, "user_share_pct") || 70,
        theoremReachSecret: settings["theoremreach_secret"] ?? "",
        offerwallggApiKey: settings["offerwallgg_api_key"] ?? "",
        offerwallggAppId,
        device,
        userAgent: args.userAgent?.trim() ?? "",
      };
      const rows = await db
        .select()
        .from(schema.contentItems)
        .where(
          and(
            eq(schema.contentItems.kind, "game"),
            eq(schema.contentItems.active, 1),
          ),
        )
        .orderBy(schema.contentItems.sortOrder, desc(schema.contentItems.id));
      // One feed per partner, from the partners visible in the
      // user's own (login-IP) country — the same IP rule as surveys.
      const seenPartners = new Set<string>();
      const partners = rows.filter((r) => {
        if (!r.feedUrl) return false;
        if (!visibleInCountry(r.countries, user.countryCode)) return false;
        const k = partnerKeyOf(r.provider, r.title);
        if (seenPartners.has(k)) return false;
        seenPartners.add(k);
        return true;
      });
      const perPartner = await Promise.all(
        partners.map((p) => gameFeedForPartner(p, user, feedCtx)),
      );
      const byUrl = new Map<string, SurveyFeedItem>();
      for (const s of perPartner.flat())
        if (!byUrl.has(s.url)) byUrl.set(s.url, s);
      return { games: [...byUrl.values()].slice(0, 100) };
    },
  }),

  // One Offerwall.GG game's payout ladder, for the Games-tab popup:
  // GET /api/v1/offers/{offer} returns the same object /offers
  // returns, PLUS `goals` — the steps of a multi-step offer and what
  // each one pays (Offerwall.GG OpenAPI 3.1: Goal = { goalId,
  // description ("What the user has to do"), reward ("In your
  // currency"), optional (a bonus step) }). A single-step offer has
  // an empty goal list, so the popup falls back to the total only —
  // no levels are ever invented. Per-goal dollars use the SAME
  // one-step formula as the card (mapOfferwallGgOffer): round(reward
  // / perUsd * sharePct) — the exact amount applyRewardCredit will
  // credit for that goal. A goal that pays 0 after the share is
  // dropped, never shown as a $0.00 row. The secret key stays
  // server-only (X-Api-Key header); the client only ever sees the
  // game's own clickUrl, as before.
  //
  // COMPLETED-GOAL TICKS: the Offerwall.GG postback carries goalId
  // (which step completed) and offerId (the network's externalId).
  // partnerCallback stores every callback's params verbatim in
  // postbacks.rawJson, so this handler reads the user's credited
  // postbacks for THIS offer and returns their goalIds as
  // completedGoalIds — the popup ticks those rows. This only works
  // for postbacks recorded AFTER the Offerwall.GG dashboard
  // callback URL carries &offerId={offerId}&goalId={goalId}; the
  // signature covers only user:tx:amount, so adding those macros
  // never breaks verification. Older postbacks have no goalId and
  // their goals simply stay unticked — never faked.
  getOfferwallGgGameDetail: defineAction({
    description:
      "One Offerwall.GG game's goal ladder for the Games-tab popup: each step's description and the dollars the user earns for it (70% share, once), plus the game's description, requirements and play link, and the goalIds this user already completed (ticked in the popup). Single-step games return an empty goals list.",
    request: z.object({
      token: z.string().min(1).max(200),
      offerId: z.string().regex(/^\d{1,10}$/),
      // The card's own total, passed by the popup: last-resort way
      // to recover the placement rate (see perUsd resolution below).
      // Optional so older clients keep working.
      totalCents: z.number().int().min(0).optional(),
    }),
    response: z.object({
      found: z.boolean(),
      name: z.string().nullable(),
      description: z.string().nullable(),
      requirements: z.string().nullable(),
      imageUrl: z.string().nullable(),
      url: z.string().nullable(),
      totalCents: z.number(),
      goals: z.array(
        z.object({
          goalId: z.string(),
          event: z.string(),
          amountCents: z.number(),
          optional: z.boolean(),
        }),
      ),
      completedGoalIds: z.array(z.string()),
    }),
    async handler(ctx, args) {
      const empty = {
        found: false,
        name: null,
        description: null,
        requirements: null,
        imageUrl: null,
        url: null,
        totalCents: 0,
        goals: [] as {
          goalId: string;
          event: string;
          amountCents: number;
          optional: boolean;
        }[],
        completedGoalIds: [] as string[],
      };
      const db = ctx.db<typeof schema>();
      const user = await requireUser(ctx, args.token);
      const settings = await getSettings(db);
      const sharePct = settingInt(settings, "user_share_pct") || 70;
      const apiKey = settings["offerwallgg_api_key"] ?? "";
      const wallRows = await db
        .select()
        .from(schema.contentItems)
        .where(
          and(
            eq(schema.contentItems.kind, "offerwall"),
            eq(schema.contentItems.active, 1),
          ),
        );
      const offerwallGgWall = wallRows.find((r) =>
        partnerKeyOf(r.provider, r.title).includes("offerwall.gg"),
      );
      const appId =
        offerwallGgWall?.url.match(/\/wall\/([A-Za-z0-9]{32})/)?.[1] ?? "";
      if (!apiKey || !appId) return empty;
      const params = new URLSearchParams({
        appId,
        userId: user.offerToken ?? user.userCode,
      });
      const json = await fetchFeedJson(
        `https://offerwall.gg/api/v1/offers/${args.offerId}?${params.toString()}`,
        { "X-Api-Key": apiKey },
      );
      const offer = feedRecord(feedRecord(json)?.["data"])?.["offer"];
      const offerRec = feedRecord(offer);
      if (!offerRec) return empty;
      const reward = feedNum(offerRec, ["reward"]);
      // perUsd resolution, in order. (1) The detail response itself
      // carries no data.currency (see the note on
      // getOfferwallGgPerUsd) — read it if a future API version ever
      // adds it. (2) The placement rate, cached from the list
      // endpoint — the authoritative source (live: 1000). (3) Derive
      // it from the card's own total, which the list adapter computed
      // as round(reward / perUsd * sharePct): perUsd is then
      // reward * sharePct / totalCents. Exact up to the card's
      // 1-cent rounding, and only used when the list call also
      // failed. If all three fail, log it (previously this failed
      // silently) and return empty so the popup shows its honest
      // error line instead of invented steps.
      const dataRec = feedRecord(feedRecord(json)?.["data"]);
      let perUsd = dataRec
        ? feedNum(feedRecord(dataRec["currency"]) ?? {}, ["perUsd"])
        : null;
      if (perUsd == null || perUsd <= 0)
        perUsd = await getOfferwallGgPerUsd(apiKey, appId);
      if (
        (perUsd == null || perUsd <= 0) &&
        args.totalCents != null &&
        args.totalCents > 0 &&
        reward != null &&
        reward > 0
      )
        perUsd = (reward * sharePct) / args.totalCents;
      if (perUsd == null || perUsd <= 0) {
        console.warn(
          `[feed] offerwall.gg detail: no perUsd for offer ${args.offerId}`,
        );
        return empty;
      }
      const totalCents =
        reward == null || reward <= 0
          ? 0
          : Math.round((reward / perUsd) * sharePct);
      const goals: {
        goalId: string;
        event: string;
        amountCents: number;
        optional: boolean;
      }[] = [];
      const rawGoals = offerRec["goals"];
      if (Array.isArray(rawGoals)) {
        for (const raw of rawGoals) {
          const g = feedRecord(raw);
          if (!g) continue;
          const goalReward = feedNum(g, ["reward"]);
          if (goalReward == null || goalReward <= 0) continue;
          const amountCents = Math.round(
            (goalReward / perUsd) * sharePct,
          );
          if (amountCents <= 0) continue;
          goals.push({
            goalId: feedStr(g, ["goalId"]) ?? "",
            event:
              feedStr(g, ["description"]) ?? "Complete this step",
            amountCents,
            optional: g["optional"] === true,
          });
        }
      }
      // Completed goals for THIS user and THIS offer: the postback's
      // offerId is the network's externalId (Offer schema: externalId
      // "Appears on the postback as offerId"), and its goalId names
      // the step that paid. Both live in postbacks.rawJson verbatim
      // (partnerCallback stores { partner, params }); a credited row
      // whose params match this offer contributes its goalId.
      const completedGoalIds: string[] = [];
      const externalId = feedStr(offerRec, ["externalId"]);
      if (externalId) {
        const credited = await db
          .select()
          .from(schema.postbacks)
          .where(
            and(
              eq(schema.postbacks.userId, user.id),
              eq(schema.postbacks.status, "credited"),
              gt(schema.postbacks.creditedCents, 0),
            ),
          )
          .orderBy(desc(schema.postbacks.id))
          .limit(200);
        const done = new Set<string>();
        for (const row of credited) {
          try {
            const parsed = JSON.parse(row.rawJson) as {
              params?: Record<string, unknown>;
            };
            const cbParams = parsed?.params;
            if (!cbParams || typeof cbParams !== "object") continue;
            if (cbParams["offerId"] !== externalId) continue;
            const gid = cbParams["goalId"];
            if (typeof gid === "string" && gid.trim()) done.add(gid.trim());
          } catch {
            // A malformed stored row must never break the popup.
          }
        }
        completedGoalIds.push(...done);
      }
      return {
        found: true,
        name: feedStr(offerRec, ["name", "title"]),
        description: feedStr(offerRec, ["description"]),
        requirements: feedStr(offerRec, ["requirements"]),
        imageUrl: feedStr(offerRec, [
          "image",
          "image_url",
          "thumbnail_url",
          "thumbnail",
          "icon",
        ]),
        url: feedStr(offerRec, ["clickUrl", "click_url"]),
        totalCents,
        goals,
        completedGoalIds,
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
      // Daily Contest: settle any finished UTC day now, so prizes land
      // on the first dashboard visit after midnight even if nobody
      // opens the Contest tab. Best-effort — a settlement failure must
      // never break the dashboard.
      await settleDueDailyContestsBestEffort(db);
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
        .where(
          and(
            eq(schema.transactions.userId, user.id),
            ne(schema.transactions.amountCents, 0),
          ),
        )
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
        .where(
          and(
            eq(schema.transactions.userId, user.id),
            ne(schema.transactions.amountCents, 0),
          ),
        )
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
    description:
      "Sends a help message from the signed-in user to the admin inbox. Optional screenshot/photo (PNG/JPG/WebP, under 2 MB) is stored as a site blob. The appeal starts as Pending until the admin approves it, and a copy is emailed to the business inbox (info@tapone.store) when RESEND_API_KEY is set.",
    request: z.object({
      token: z.string().min(1).max(200),
      subject: z.string().trim().max(120).default(""),
      body: z.string().trim().min(1).max(2000),
      imageDataBase64: z.string().min(1).max(3_000_000).optional(),
      imageMimeType: z.string().min(1).max(60).optional(),
    }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const db = ctx.db<typeof schema>();
      const user = await requireUser(ctx, args.token);
      let imageUrl: string | null = null;
      if (args.imageDataBase64) {
        if (!args.imageMimeType)
          throw new Error("Please attach the image again.");
        if (
          !["image/png", "image/jpeg", "image/webp"].includes(
            args.imageMimeType,
          )
        )
          throw new Error("Please choose a PNG, JPG or WebP image.");
        const bytes = Buffer.from(args.imageDataBase64, "base64");
        if (bytes.length === 0 || bytes.length > 2_200_000)
          throw new Error("That image is too large — please pick one under 2 MB.");
        const key = `help/user-${user.id}-${Date.now()}`;
        await ctx.blobs.put(key, bytes, { contentType: args.imageMimeType });
        imageUrl = await ctx.blobs.getUrl(key);
      }
      const inserted = await db
        .insert(schema.messages)
        .values({
          userId: user.id,
          sender: "user",
          subject: args.subject,
          body: args.body,
          imageUrl,
          status: "pending",
          readByAdmin: 0,
          readByUser: 1,
        })
        .returning({ id: schema.messages.id });
      // Email copy to the business inbox — best effort: a mail failure
      // must never lose the appeal itself.
      await notifyHelpByEmail({
        userName: user.name,
        userEmail: user.email,
        subject: args.subject,
        body: args.body,
        imageUrl,
        messageId: inserted[0]?.id ?? 0,
      });
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  // ------------------------------------------------------- live chat
  //
  // Public Live Chat inside Help: one shared room where all signed-in
  // users can message each other. Messages are plain text (max 1000
  // chars) and show the sender's name + current profile picture. The
  // chat only loads when the user opens it (lazy) and refreshes every
  // few seconds while open. A blocked user can still READ the chat,
  // just not send. The owner replies from the Admin panel as
  // "Official TapOne" (verified tick); a chat manager's messages carry
  // a "Manager" tick and a manager can also block / unblock users.
  // Only the owner can appoint or remove a manager.

  getLiveChat: defineAction({
    description:
      "Live Chat (Help): the newest messages in the shared public chat, oldest first, with each sender's name, current profile picture and role. Also says whether the signed-in user can send (blocked users can read but not send) and which users are currently blocked.",
    request: z.object({ token: z.string().min(1).max(200) }),
    response: z.object({
      messages: z.array(chatMessageShape),
      blocked: z.array(
        z.object({
          userId: z.number(),
          expiresAt: z.string().nullable(),
        }),
      ),
      myUserId: z.number(),
      myRole: z.enum(["user", "manager"]),
      canSend: z.boolean(),
      blockedUntil: z.string().nullable(),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const user = await requireUser(ctx, args.token);
      const block = await activeChatBlock(db, user.id);
      const { messages, blocked } = await loadChatMessages(db, 100);
      return {
        messages,
        blocked,
        myUserId: user.id,
        myRole:
          user.isChatManager === 1 ? ("manager" as const) : ("user" as const),
        canSend: block == null,
        blockedUntil: block?.expiresAt ? block.expiresAt.toISOString() : null,
      };
    },
  }),

  sendChatMessage: defineAction({
    description:
      "Sends one message to the shared Live Chat. Blocked users cannot send (they can still read). A chat manager's message carries the Manager role.",
    request: z.object({
      token: z.string().min(1).max(200),
      body: z.string().trim().min(1).max(1000),
    }),
    response: z.object({ ok: z.literal(true), id: z.number() }),
    async handler(ctx, args): Promise<{ ok: true; id: number }> {
      const db = ctx.db<typeof schema>();
      const user = await requireUser(ctx, args.token);
      const block = await activeChatBlock(db, user.id);
      if (block) {
        throw new Error(
          "You are blocked from sending messages in Live Chat" +
            (block.expiresAt
              ? " until " + block.expiresAt.toISOString().slice(0, 10) + "."
              : " permanently."),
        );
      }
      const inserted = await db
        .insert(schema.chatMessages)
        .values({
          userId: user.id,
          role: user.isChatManager === 1 ? "manager" : "user",
          body: args.body,
        })
        .returning({ id: schema.chatMessages.id });
      ctx.invalidateQueries();
      return { ok: true, id: inserted[0]?.id ?? 0 };
    },
  }),

  managerBlockChatUser: defineAction({
    description:
      "A chat manager blocks a user from sending messages in Live Chat (the user can still read). days 1 / 7 / 30 = timed block; omitted = permanent.",
    request: z.object({
      token: z.string().min(1).max(200),
      userId: z.number().int().positive(),
      days: z.number().int().optional(),
    }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const db = ctx.db<typeof schema>();
      const manager = await requireUser(ctx, args.token);
      if (manager.isChatManager !== 1)
        throw new Error("Only a chat manager can do this.");
      if (args.userId === manager.id)
        throw new Error("You cannot block yourself.");
      await blockChatUser(db, args.userId, manager.id, args.days);
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  managerUnblockChatUser: defineAction({
    description:
      "A chat manager unblocks a user in Live Chat so they can send messages again.",
    request: z.object({
      token: z.string().min(1).max(200),
      userId: z.number().int().positive(),
    }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const db = ctx.db<typeof schema>();
      const manager = await requireUser(ctx, args.token);
      if (manager.isChatManager !== 1)
        throw new Error("Only a chat manager can do this.");
      await db
        .delete(schema.chatBlocks)
        .where(eq(schema.chatBlocks.userId, args.userId));
      ctx.invalidateQueries();
      return { ok: true };
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

  getDailyContest: defineAction({
    description:
      "The signed-in user's Daily Contest: today's UTC-day standings (top 30 by today's offer/survey/game earnings, $0 earners never shown), the prize ladder for the owner's current pool total, the live countdown target (next UTC midnight), the user's own rank/earnings/prize, and the most recent settled day. Settles any finished day first (lazy, idempotent — a day pays at most once).",
    request: z.object({ token: z.string().min(1).max(200) }),
    response: z.object({
      dayKey: z.string(),
      endsAt: z.string(),
      totalCents: z.number(),
      ladderCents: z.array(z.number()),
      standings: z.array(
        z.object({
          rank: z.number(),
          name: z.string(),
          pictureUrl: z.string().nullable(),
          earnedCents: z.number(),
          prizeCents: z.number(),
          isMe: z.boolean(),
        }),
      ),
      myRank: z.number().nullable(),
      myEarnedCents: z.number(),
      myPrizeCents: z.number(),
      lastSettlement: z
        .object({
          dayKey: z.string(),
          totalCents: z.number(),
          winners: z.number(),
          totalPaidCents: z.number(),
        })
        .nullable(),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const user = await requireUser(ctx, args.token);
      await settleDueDailyContestsBestEffort(db);
      const settings = await getSettings(db);
      const totalCents = dailyContestTotalFrom(settings);
      const dayKey = utcDayKeyOf(new Date());
      const standings = await dailyContestStandings(db, dayKey);
      const ladder = dailyContestLadder(totalCents);
      const ids = standings.map((s) => s.userId);
      const users = ids.length
        ? await db.select().from(schema.users).where(inArray(schema.users.id, ids))
        : [];
      const byId = new Map(users.map((u) => [u.id, u]));
      const rows = standings.map((s, i) => {
        const u = byId.get(s.userId);
        return {
          rank: i + 1,
          name: (u?.name ?? "TapOne user").split(" ")[0] ?? "TapOne user",
          pictureUrl: u?.pictureUrl ?? null,
          earnedCents: s.earnedCents,
          prizeCents: ladder[i] ?? 0,
          isMe: s.userId === user.id,
        };
      });
      const mine = rows.find((r) => r.isMe);
      const last = await db
        .select()
        .from(schema.dailyContestSettlements)
        .orderBy(desc(schema.dailyContestSettlements.id))
        .limit(1);
      const lastRow = last[0];
      let lastSettlement: {
        dayKey: string;
        totalCents: number;
        winners: number;
        totalPaidCents: number;
      } | null = null;
      if (lastRow) {
        const winners = JSON.parse(lastRow.winnersJson) as DailyContestWinner[];
        lastSettlement = {
          dayKey: lastRow.dayKey,
          totalCents: lastRow.totalCents,
          winners: winners.length,
          totalPaidCents: winners.reduce((s, w) => s + w.prizeCents, 0),
        };
      }
      return {
        dayKey,
        endsAt: new Date(nextUtcMidnightMs()).toISOString(),
        totalCents,
        ladderCents: ladder,
        standings: rows,
        myRank: mine?.rank ?? null,
        myEarnedCents: mine?.earnedCents ?? 0,
        myPrizeCents: mine?.prizeCents ?? 0,
        lastSettlement,
      };
    },
  }),

  adminGetDailyContest: defineAction({
    description:
      "Admin view of the Daily Contest: today's UTC-day standings, the prize ladder for the current pool total, the countdown target, and the recent settled days (day, pool total, winners, total paid). Settles any finished day first (lazy, idempotent).",
    request: z.object({ adminToken: z.string().min(1).max(200) }),
    response: z.object({
      dayKey: z.string(),
      endsAt: z.string(),
      totalCents: z.number(),
      ladderCents: z.array(z.number()),
      standings: z.array(
        z.object({
          rank: z.number(),
          name: z.string(),
          pictureUrl: z.string().nullable(),
          earnedCents: z.number(),
          prizeCents: z.number(),
        }),
      ),
      settlements: z.array(
        z.object({
          dayKey: z.string(),
          totalCents: z.number(),
          winners: z.number(),
          totalPaidCents: z.number(),
        }),
      ),
    }),
    async handler(ctx, args) {
      await requireAdmin(ctx, args.adminToken);
      const db = ctx.db<typeof schema>();
      await settleDueDailyContestsBestEffort(db);
      const settings = await getSettings(db);
      const totalCents = dailyContestTotalFrom(settings);
      const dayKey = utcDayKeyOf(new Date());
      const standings = await dailyContestStandings(db, dayKey);
      const ladder = dailyContestLadder(totalCents);
      const ids = standings.map((s) => s.userId);
      const users = ids.length
        ? await db.select().from(schema.users).where(inArray(schema.users.id, ids))
        : [];
      const byId = new Map(users.map((u) => [u.id, u]));
      const settled = await db
        .select()
        .from(schema.dailyContestSettlements)
        .orderBy(desc(schema.dailyContestSettlements.id))
        .limit(7);
      return {
        dayKey,
        endsAt: new Date(nextUtcMidnightMs()).toISOString(),
        totalCents,
        ladderCents: ladder,
        standings: standings.map((s, i) => {
          const u = byId.get(s.userId);
          return {
            rank: i + 1,
            name: (u?.name ?? "TapOne user").split(" ")[0] ?? "TapOne user",
            pictureUrl: u?.pictureUrl ?? null,
            earnedCents: s.earnedCents,
            prizeCents: ladder[i] ?? 0,
          };
        }),
        settlements: settled.map((row) => {
          const winners = JSON.parse(row.winnersJson) as DailyContestWinner[];
          return {
            dayKey: row.dayKey,
            totalCents: row.totalCents,
            winners: winners.length,
            totalPaidCents: winners.reduce((s, w) => s + w.prizeCents, 0),
          };
        }),
      };
    },
  }),

  adminSettleDailyContest: defineAction({
    description:
      "Admin button: settle every finished Daily Contest day that is not settled yet. Idempotent — a day that already settled pays nothing again. Returns the days settled by this call.",
    request: z.object({ adminToken: z.string().min(1).max(200) }),
    response: z.object({ settledDays: z.array(z.string()) }),
    async handler(ctx, args) {
      await requireAdmin(ctx, args.adminToken);
      const db = ctx.db<typeof schema>();
      const r = await settleDueDailyContests(db);
      ctx.invalidateQueries();
      return { settledDays: r.settledDays };
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
      for (const pb of credited) { if (pb.creditedCents <= 0) continue;
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



  getLevel: defineAction({
    description:
      "The signed-in user's Level & Privileges: level from lifetime earnings ($1 = 1 level), current and next title, progress to the next title, all titles with their one-time Level Reward amounts, and Level Reward history. Syncs level and pays due rewards first.",
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
          rewardCents: z.number(),
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
          rewardCents: z.number(),
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
              rewardCents: next.rewardCents,
            }
          : null,
        progressPct,
        chargebackRatePct: await chargebackRatePct(db, user.id),
        titles: levelCfg.titles.map((title) => ({
          name: title.name,
          level: title.level,
          standardPct: title.standardPct,
          enhancedPct: title.enhancedPct,
          rewardCents: title.rewardCents,
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
          network: z.string(), title: z.string(), imageUrl: z.string().nullable(),
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
            eq(schema.postbacks.userId, user.id), gt(schema.postbacks.creditedCents, 0),
            eq(schema.postbacks.status, "credited"),
          ),
        )
        .orderBy(desc(schema.postbacks.id))
        .limit(200); const walls = await db.select().from(schema.contentItems);
      return {
        chargebackRatePct: await chargebackRatePct(db, user.id),
        items: rows.filter((r) => isLiveNetwork(r.network, walls)).map((r) => {
          const stored = offerInfoFromRaw(r.rawJson);
          const wall = wallFor(r.network, walls);
          return {
            id: r.id,
            network: r.network,
            title:
              r.offerTitle ?? stored.title ?? wall?.title ?? wall?.provider ?? r.network,
            imageUrl:
              r.offerImageUrl ?? stored.imageUrl ?? wall?.imageUrl ?? null,
            kind: isSurveyNetwork(r.network)
            ? ("survey" as const)
              : ("offer" as const),
            creditedCents: r.creditedCents,
            createdAt: r.createdAt.toISOString(),
          };
        }),
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

  updateDisplayName: defineAction({
    description:
      "Changes the signed-in user's username (1–40 characters). Usernames are unique, case-insensitively (owner order 2026-11-27): a username another account already holds is refused and does NOT consume one of the 3 changes. Lifetime limit: 3 changes per account — every successful change is counted on the user row, and once all 3 are used the username is locked and further changes are refused. Saving the username the user already has is not a change and is never counted. The username lives on the user row, so a new username shows at once everywhere it appears — referrals, winner banners, admin lists. The Google email on the account never changes.",
    request: z.object({
      token: z.string().min(1).max(200),
      name: z
        .string()
        .trim()
        .min(1, "Type a username.")
        .max(40, "Username can be at most 40 characters."),
    }),
    response: z.object({ name: z.string(), nameChangesLeft: z.number() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const user = await requireUser(ctx, args.token);
      // Re-saving the current username is not a change — never counted,
      // and allowed even when the limit is used up.
      if (args.name === user.name) {
        return { name: user.name, nameChangesLeft: nameChangesLeft(user) };
      }
      if (user.nameChanges >= MAX_NAME_CHANGES)
        throw new Error(
          `You have used all ${MAX_NAME_CHANGES} username changes — your username is now locked as "${user.name}".`,
        );
      // Usernames are unique (owner order 2026-11-27): a taken
      // username is refused here, before any change is saved and
      // before one of the 3 lifetime changes is consumed.
      if (await isUsernameTaken(db, args.name, user.id))
        throw new Error(
          "This username is already taken — please choose another.",
        );
      const used = user.nameChanges + 1;
      await db
        .update(schema.users)
        .set({ name: args.name, nameChanges: used })
        .where(eq(schema.users.id, user.id));
      ctx.invalidateQueries();
      return {
        name: args.name,
        nameChangesLeft: Math.max(0, MAX_NAME_CHANGES - used),
      };
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
      status: z.enum(["credited", "duplicate", "unknown_user", "rejected"]),
      creditedCents: z.number(),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const settings = await getSettings(db);
      const secret = settings["postback_secret"] ?? "";
      if (secret && args.secret !== secret)
        throw new Error("Invalid postback secret."); if (args.payout <= 0) { return { status: "rejected" as const, creditedCents: 0 }; }

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
      if (creditedCents <= 0) { return { status: "rejected" as const, creditedCents: 0 }; } return { status: "credited" as const, creditedCents };
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

  pubscaleCallback: defineAction({
    description:
      "PubScale server-to-server reward callback: verifies the MD5 signature with the S2S secret key (Admin → Settings), then credits the user — found by the Offer Token PubScale sends back as user_id — 70% of the reward. Idempotent per PubScale token; zero/negative rewards never credit. The generic partner callback cannot verify PubScale: its signature is MD5, while the generic handler only does HMAC-SHA1/SHA-256 — hence this dedicated action, mirroring theoremReachCallback.",
    request: z.object({
      // All values are strings on purpose: they arrive as URL query
      // parameters and the exact text is part of the signed string.
      user_id: z.string().trim().min(1).max(64),
      value: z.string().trim().max(32),
      token: z.string().trim().min(1).max(120),
      signature: z.string().trim().max(120).optional(),
    }),
    response: z.object({
      status: z.enum(["credited", "duplicate", "unknown_user", "rejected"]),
      creditedCents: z.number(),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const settings = await getSettings(db);

      // Signature verification (PubScale S2S docs 1.0.6):
      //   signature = hex(MD5("<secret>.<user_id>.<int(value)>.<token>"))
      // The secret key is provided along with the App API key. The
      // value is converted from decimal to integer before signing.
      // Enforced whenever a secret is set in Admin → Settings; with
      // no secret stored, callbacks are refused, never waved through.
      const secret = settings["pubscale_secret_key"] ?? "";
      const payoutNumber = Number.parseFloat(args.value);
      if (!Number.isFinite(payoutNumber))
        throw new Error("Invalid reward amount.");
      if (!secret) throw new Error("PubScale callback secret is not set in Admin → Settings.");
      if (!args.signature) throw new Error("Missing callback signature.");
      const expected = createHash("md5")
        .update(
          `${secret}.${args.user_id}.${Math.trunc(payoutNumber)}.${args.token}`,
        )
        .digest("hex");
      if (!secretsEqual(args.signature.toLowerCase(), expected))
        throw new Error("Invalid callback signature.");

      // The reward value is in Coin — the PubScale dashboard's
      // currency for this offerwall is Coin, $1 = 1,000 Coin — so
      // dollars = value / 1000. UNCONFIRMED until a sandbox callback
      // test proves the unit: if PubScale ever sent dollars, this
      // divisor would under-credit 1000x. Do not call PubScale
      // earnings live until that test passes.
      const payout = payoutNumber / 1000;
      if (payout <= 0) {
        return { status: "rejected" as const, creditedCents: 0 };
      }

      // Idempotent per PubScale transaction token (namespaced so it
      // can never collide with another network's transaction IDs).
      const txnKey = `pubscale:${args.token}`;
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
        .where(eq(schema.users.offerToken, args.user_id))
        .limit(1);
      if (!userRows[0]) {
        userRows = await db
          .select()
          .from(schema.users)
          .where(eq(schema.users.userCode, args.user_id))
          .limit(1);
      }
      const user = userRows[0];
      const rawJson = JSON.stringify({
        network: "PubScale",
        user_id: args.user_id,
        value: args.value,
        token: args.token,
      });
      if (!user) {
        await db.insert(schema.postbacks).values({
          txnId: txnKey,
          network: "PubScale",
          userId: null,
          payout,
          creditedCents: 0,
          status: "unknown_user",
          rawJson,
        });
        return { status: "unknown_user" as const, creditedCents: 0 };
      }

      const creditedCents = await applyRewardCredit(db, settings, user, {
        network: "PubScale",
        txnId: txnKey,
        payout,
        note: "PubScale offer completed",
        rawJson,
      });
      ctx.invalidateQueries();
      return { status: "credited" as const, creditedCents };
    },
  }),

  pubscaleChargeback: defineAction({
    description:
      "PubScale chargeback/reversal callback: verifies the same MD5 signature as the reward callback with the S2S secret key (Admin → Settings), then deducts ONLY what the matching reward callback previously credited for that PubScale token — the 70% credited cents, never the full payout, never more than the user's current balance, never below $0.00. Idempotent per token; unknown tokens, unknown users and bad signatures deduct nothing. The reversal is a negative admin_adjust transaction whose note contains 'chargeback', so it shows in the user's History and counts in the existing chargeback rate. This is the ONLY place a PubScale callback ever deducts — /pubscale-callback credits and never debits.",
    request: z.object({
      // Same four parameters as the reward callback, same signed
      // string: the chargeback doc sends user_id/value/token/
      // signature with the identical MD5 template.
      user_id: z.string().trim().min(1).max(64),
      value: z.string().trim().max(32),
      token: z.string().trim().min(1).max(120),
      signature: z.string().trim().max(120).optional(),
    }),
    response: z.object({
      status: z.enum([
        "reversed",
        "duplicate",
        "unknown_user",
        "mismatched_user",
        "no_original_credit",
        "rejected",
      ]),
      deductedCents: z.number(),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const settings = await getSettings(db);

      // Same signature as the reward callback (PubScale chargeback
      // docs 1.0.10): signature =
      // hex(MD5("<secret>.<user_id>.<int(value)>.<token>")). Refuse
      // whenever the secret is unset or the signature is wrong or
      // missing — a chargeback that cannot be verified deducts
      // nothing, exactly like an unverified reward never credits.
      const secret = settings["pubscale_secret_key"] ?? "";
      const payoutNumber = Number.parseFloat(args.value);
      if (!Number.isFinite(payoutNumber))
        throw new Error("Invalid chargeback amount.");
      if (!secret) throw new Error("PubScale callback secret is not set in Admin → Settings.");
      if (!args.signature) throw new Error("Missing callback signature.");
      const expected = createHash("md5")
        .update(
          `${secret}.${args.user_id}.${Math.trunc(payoutNumber)}.${args.token}`,
        )
        .digest("hex");
      if (!secretsEqual(args.signature.toLowerCase(), expected))
        throw new Error("Invalid callback signature.");

      // The chargeback value is the reward value in Coin, same as the
      // earning callback (dollars = value / 1000). The amount deducted
      // does NOT come from this value: it comes from the original
      // credit stored for this token, so a chargeback can never take
      // more than the user was actually credited.
      const payout = payoutNumber / 1000;
      if (payout <= 0) {
        return { status: "rejected" as const, deductedCents: 0 };
      }

      // The original credit, by the same token the reward callback
      // stored it under (pubscale:<token>).
      const txnKey = `pubscale:${args.token}`;
      const original = await db
        .select()
        .from(schema.postbacks)
        .where(eq(schema.postbacks.txnId, txnKey))
        .limit(1);
      const originalRow = original[0];
      if (
        !originalRow ||
        originalRow.status !== "credited" ||
        originalRow.creditedCents <= 0
      ) {
        return { status: "no_original_credit" as const, deductedCents: 0 };
      }

      // user_id is the Offer Token PubScale sends back; fall back to
      // the user code — same lookup as pubscaleCallback.
      let userRows = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.offerToken, args.user_id))
        .limit(1);
      if (!userRows[0]) {
        userRows = await db
          .select()
          .from(schema.users)
          .where(eq(schema.users.userCode, args.user_id))
          .limit(1);
      }
      const user = userRows[0];
      if (!user) {
        return { status: "unknown_user" as const, deductedCents: 0 };
      }
      if (originalRow.userId !== user.id) {
        return { status: "mismatched_user" as const, deductedCents: 0 };
      }

      // Idempotent per token: the reversal is recorded as one negative
      // admin_adjust transaction whose note carries the token, so a
      // retried chargeback (PubScale retries 6 times) finds its own
      // row and deducts nothing a second time. The note contains
      // "chargeback", which is exactly what chargebackRatePct counts.
      const note = `PubScale chargeback (token ${args.token})`;
      const prior = await db
        .select()
        .from(schema.transactions)
        .where(
          and(
            eq(schema.transactions.userId, user.id),
            eq(schema.transactions.kind, "admin_adjust"),
            eq(schema.transactions.note, note),
          ),
        )
        .limit(1);
      if (prior[0]) {
        return {
          status: "duplicate" as const,
          deductedCents: -prior[0].amountCents,
        };
      }

      // Deduct only what was credited, capped at what the user still
      // holds: if they already withdrew or spent the credit, the
      // balance is never driven below $0.00 and the shortfall is not
      // chased. Lifetime earnings fall by the same amount (the level
      // derives from them — checkLevelUps below lowers the level if
      // needed, but a title reward already paid is never taken back).
      const deductCents = Math.min(
        originalRow.creditedCents,
        user.balanceCents,
      );
      if (deductCents <= 0) {
        return { status: "reversed" as const, deductedCents: 0 };
      }
      const statements: BatchItem<"sqlite">[] = [
        db
          .update(schema.users)
          .set({
            balanceCents: user.balanceCents - deductCents,
            totalEarnedCents: Math.max(
              0,
              user.totalEarnedCents - deductCents,
            ),
          })
          .where(eq(schema.users.id, user.id)),
        db.insert(schema.transactions).values({
          userId: user.id,
          kind: "admin_adjust",
          amountCents: -deductCents,
          note,
        }),
      ];
      const [first, ...rest] = statements;
      if (first) await db.batch([first, ...rest]);
      await checkLevelUps(db, user.id);
      ctx.invalidateQueries();
      return { status: "reversed" as const, deductedCents: deductCents };
    },
  }),

  partnerCallback: defineAction({
    description:
      "Reward callback for an owner-configured partner (Admin → Partner Callbacks): reads the user ID, transaction ID and payout from the parameter names the owner set for that partner, checks the secret/signature the owner configured (none / secret parameter / HMAC-SHA1 / HMAC-SHA256), then credits the user 70% through the same path as the built-in postbacks — referrer commission, level-ups and weekly check-in included. Idempotent per partner + transaction ID.",
    request: z.object({
      // The partner's key from its callback address:
      // /partner-callback/<key> on the standalone server.
      key: z.string().trim().min(1).max(60),
      // Every query parameter the partner sent, verbatim — which ones
      // mean user / transaction / payout / signature is decided by the
      // owner's saved config, never by fixed names here.
      params: z.record(z.string(), z.string()),
    }),
    response: z.object({
      status: z.enum(["credited", "duplicate", "unknown_user", "rejected"]),
      creditedCents: z.number(),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const settings = await getSettings(db);
      const key = args.key.toLowerCase();
      const rows = await db
        .select()
        .from(schema.partnerCallbacks)
        .where(eq(schema.partnerCallbacks.key, key))
        .limit(1);
      const config = rows[0];
      if (!config || config.active !== 1)
        throw new Error("Unknown partner callback.");

      const params = args.params;
      const userId = (params[config.userParam] ?? "").trim();
      const txId = (params[config.txnParam] ?? "").trim();
      const payoutRaw = (params[config.payoutParam] ?? "").trim();   
      const status = (params["status"] ?? "").trim();
      // Moonetix signs the reward (after its user split), not the
      // gross payout in "amount" — read it verbatim, never reformat.
      // Missing reward => "" => the HMAC below cannot match, so the 
      // callback is rejected with "Invalid callback signature."
      const rewardRaw = (params["reward"] ?? "").trim();
      if (!userId || !txId || !payoutRaw)
        throw new Error(
          `Missing callback parameters: this partner must send ${config.userParam}, ${config.txnParam} and ${config.payoutParam}.`,
        );

      // Authentication exactly as the owner configured it for this
      // partner. A stored secret is required for every method except
      // "none" — a config that names a method but has no secret is a
      // setup mistake, so the callback is refused, never waved through.
      if (config.authMethod !== "none") {
        if (!config.secret)
          throw new Error(
            "This partner's callback secret is not set in Admin → Partner Callbacks.",
          );
        const given = (params[config.secretParam] ?? "").trim();
        if (!given) throw new Error("Missing callback signature.");
        if (config.authMethod === "secret") {
          if (!secretsEqual(given, config.secret))
            throw new Error("Invalid callback secret.");
        } else {
          const hash = config.authMethod === "hmac_sha1" ? "SHA-1" : "SHA-256";
          // "colon" partners (e.g. Offerwall.GG) sign
          // "{user}:{txn}:{payout}" — the three values joined with
          // colons, in that order. Every other HMAC partner signs the
          // sorted name=value&name=value pairs.
          // "moonetix" (Moonetix) signs "{txn}:{user}:{reward}:{status}"
          // — the reward is the amount after Moonetix's user split;
          // the credit itself still uses the gross payout in "amount".
          // The status value, when the partner sends one: from the
          // admin-named status parameter, or "status" when none is
          // named (Moonetix sends "status").
          const statusRaw = (
            params[config.statusParam || "status"] ?? ""
          ).trim();
          // Which string this partner signs depends on its format:
          // "colon" (Offerwall.GG) signs "{user}:{txn}:{payout}";
          // "moonetix" signs "{txn}:{user}:{reward}:{status}" where
          // the reward is the amount AFTER Moonetix's user split
          // (the credit itself still uses the gross payout in
          // "amount"); "custom" signs the admin-typed template;
          // every other HMAC partner signs the sorted
          // name=value&name=value pairs. Values are used exactly
          // as received.
          let expected: string;
          if (config.sigFormat === "colon") {
            expected = await partnerHmacHexRaw(
              config.secret,
              `${userId}:${txId}:${payoutRaw}`,
              hash,
            );
          } else if (config.sigFormat === "moonetix") {
            expected = await partnerHmacHexRaw(
              config.secret,
              `${txId}:${userId}:${rewardRaw}:${statusRaw}`,
              hash,
            );
          } else if (config.sigFormat === "custom") {
            const canonical = resolveSigTemplate(
              config.sigTemplate ?? "",
              { user: userId, tx: txId, amount: payoutRaw, status: statusRaw },
              params,
            );
            if (canonical === null)
              throw new Error(
                "This partner's signature template cannot be resolved — check Admin → Partner Callbacks.",
              );
            expected = await partnerHmacHexRaw(config.secret, canonical, hash);
          } else {
            expected = await partnerHmacHex(
              config.secret,
              params,
              config.secretParam,
              hash,
            );
          }
          if (!secretsEqual(given.toLowerCase(), expected))
            throw new Error("Invalid callback signature.");
        }
      }

      // Generic status gate — the Moonetix status 1/2 rule, for any
      // partner whose admin named a status parameter: only the
      // configured credit value credits. Any other value the partner
      // actually sent is rejected with no credit and no debit, before
      // the duplicate check, so a reversal of an already-credited
      // transaction is not mistaken for a duplicate credit. The
      // Moonetix guard below still covers Moonetix rows whose admin
      // never set a status parameter; when one is set, both guards
      // agree. A partner that sends no status at all is not rejected
      // here — its signature (or lack of one) decides.
      if (config.statusParam) {
        const statusValue = (params[config.statusParam] ?? "").trim();
        if (statusValue !== "" && statusValue !== config.statusCreditValue) {
          return { status: "rejected" as const, creditedCents: 0 };
        }
      }

      const payoutNumber = Number.parseFloat(payoutRaw); if (config.sigFormat === "moonetix" && status !== "1") { return { status: "rejected" as const, creditedCents: 0 }; }
      if (!Number.isFinite(payoutNumber))
        throw new Error("Invalid payout amount.");
      let payout =
        config.payoutInCents === 1 ? payoutNumber / 100 : payoutNumber;
      // Partners that price in units (e.g. Offerwall.GG: 1000 units per
      // $1) divide by the configured divisor to reach dollars.
      const divisor =
        Number.isFinite(config.payoutDivisor) && config.payoutDivisor > 0
          ? config.payoutDivisor
          : 1;
      payout = payout / divisor;
      // Negative or zero payouts (reversals/chargebacks) never credit
      // and never debit automatically — same rule as TheoremReach.
      if (payout <= 0) {
        return { status: "rejected" as const, creditedCents: 0 };
      }

      // Idempotent per partner + transaction ID (namespaced so two
      // partners can reuse the same transaction ID safely, and so a
      // partner transaction can never collide with the generic
      // postback or TheoremReach namespaces).
      const txnKey = `partner:${config.key}:${txId}`;
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

      // The user ID is whatever the partner echoes back from the
      // user's entry link: the user's Offer Token first, then their
      // user code, then a plain numeric account ID.
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
      if (!userRows[0] && /^\d+$/.test(userId)) {
        userRows = await db
          .select()
          .from(schema.users)
          .where(eq(schema.users.id, Number.parseInt(userId, 10)))
          .limit(1);
      }
      const user = userRows[0];
      const rawJson = JSON.stringify({ partner: config.key, params });
      if (!user) {
        await db.insert(schema.postbacks).values({
          txnId: txnKey,
          network: config.name,
          userId: null,
          payout,
          creditedCents: 0,
          status: "unknown_user",
          rawJson,
        });
        return { status: "unknown_user" as const, creditedCents: 0 };
      }

      const creditedCents = await applyRewardCredit(db, settings, user, {
        network: config.name,
        txnId: txnKey,
        payout,
        note: `${config.name} completed`,
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
        minWithdrawCents: z.number(),
        userSharePct: z.number(),
        affiliateEarningPct: z.number(),
        affiliateSpendingPct: z.number(),
        postbackSecretSet: z.boolean(),
        theoremReachSecretSet: z.boolean(),
        offerwallggApiKeySet: z.boolean(),
        pubscaleSecretSet: z.boolean(),
        checkinBonusCents: z.number(),
        levelRewardCents: z.number(),
        dailyContestTotalCents: z.number(),
        checkinGoalCents: z.number(),
        checkinRewardsCents: z.array(z.number()),
        levelCentsPerLevel: z.number(),
        levelTitles: z.array(
          z.object({
            name: z.string(),
            level: z.number(),
            standardPct: z.number(),
            enhancedPct: z.number(),
            rewardCents: z.number(),
          }),
        ),
        socialLinks: z.record(z.string(), z.string()),
        // The full admin-managed social links list (every entry, even
        // one with no URL yet or switched off) — the Settings editor
        // reads and writes this; socialLinks above is the legacy
        // per-platform URL map, kept so older saves still read.
        socialLinksList: z.array(
          z.object({
            id: z.string(),
            label: z.string(),
            url: z.string(),
            imageUrl: z.string(),
            active: z.number(),
          }),
        ),
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
          minWithdrawCents: settingInt(settings, "min_withdraw_cents"),
          userSharePct: settingInt(settings, "user_share_pct"),
          affiliateEarningPct: settingInt(settings, "affiliate_earning_pct"),
          affiliateSpendingPct: settingInt(settings, "affiliate_spending_pct"),
          postbackSecretSet: (settings["postback_secret"] ?? "") !== "",
          theoremReachSecretSet: (settings["theoremreach_secret"] ?? "") !== "",
          offerwallggApiKeySet: (settings["offerwallgg_api_key"] ?? "") !== "",
          pubscaleSecretSet: (settings["pubscale_secret_key"] ?? "") !== "",
          checkinBonusCents: settingInt(settings, "checkin_bonus_cents"),
          levelRewardCents: settingInt(settings, "level_reward_cents"),
          dailyContestTotalCents: dailyContestTotalFrom(settings),
          checkinGoalCents: checkinGoalFrom(settings),
          checkinRewardsCents: checkinRewardsFrom(settings),
          levelCentsPerLevel: levelConfigFrom(settings).centsPerLevel,
          levelTitles: levelConfigFrom(settings).titles.map((t) => ({
            name: t.name,
            level: t.level,
            standardPct: t.standardPct,
            enhancedPct: t.enhancedPct,
            rewardCents: t.rewardCents,
          })),
          socialLinks: Object.fromEntries(
            SOCIAL_PLATFORMS.map((s) => [s.id, settings[s.key] ?? ""]),
          ),
          socialLinksList: parseSocialLinks(settings),
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

  adminSetUserCountry: defineAction({
    description:
      "Corrects a user's locked account country (set at sign-up from the login IP and never changed by later sign-ins). The user's withdraw methods and country-matched content follow the new country at once. For accounts whose sign-up connection resolved to the wrong country.",
    request: z.object({
      adminToken: z.string().min(1).max(200),
      userId: z.number().int().positive(),
      countryCode: z.string().trim().regex(/^[A-Za-z]{2}$/),
      countryName: z.string().trim().min(1).max(80),
    }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      await requireAdmin(ctx, args.adminToken);
      const db = ctx.db<typeof schema>();
      const code = args.countryCode.toUpperCase();
      const rows = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, args.userId))
        .limit(1);
      if (!rows[0]) throw new Error("User not found.");
      await db
        .update(schema.users)
        .set({
          countryCode: code,
          countryName: args.countryName,
          flagEmoji: flagFromCountryCode(code),
        })
        .where(eq(schema.users.id, args.userId));
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
      if (args.amountCents === 0)
        throw new Error("Amount must not be $0.00.");
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
      // Method label for the notification (built-in or owner-added method).
      const customLabels = await customMethodLabels(db);
      const methodLabel =
        METHODS[w.method]?.label ?? customLabels.get(w.method) ?? w.method;
      const amount = `$${(w.amountCents / 100).toFixed(2)}`;
      // Per-user bell notification, created in the SAME batch as the
      // decision — so the user is told about every approve/reject, with
      // no extra step for the admin. Only this user ever sees it (the
      // announcements bell filters by userId; see getAnnouncements).
      // The admin's optional note is appended when one was typed.
      const noteSuffix = args.note
        ? ` Note from admin: ${args.note}`
        : "";
      const statements: BatchItem<"sqlite">[] = [
        db
          .update(schema.withdrawals)
          .set({
            status: args.decision,
            adminNote: args.note,
            decidedAt: new Date(),
          })
          .where(eq(schema.withdrawals.id, w.id)),
        db.insert(schema.announcements).values({
          kind: "withdrawal",
          userId: w.userId,
          title:
            args.decision === "approved"
              ? "Withdrawal approved"
              : "Withdrawal rejected",
          body:
            args.decision === "approved"
              ? `Your withdrawal of ${amount} via ${methodLabel} was approved.${noteSuffix}`
              : `Your withdrawal of ${amount} via ${methodLabel} was rejected. The amount has been returned to your balance.${noteSuffix}`,
        }),
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




  adminListWithdrawMethods: defineAction({
    description:
      "Every withdraw method in one place: the EFFECTIVE built-in per-country methods (Pakistan, USA, UK, India and the default set for all other countries — the owner's saved override applied where set), the full built-in catalogue the owner can pick from per country, plus all extra methods the owner has added per country.",
    request: z.object({ adminToken: z.string().min(1).max(200) }),
    response: z.object({
      builtIns: z.array(
        z.object({
          countryCode: z.string(),
          countryName: z.string(),
          // True when this group's set comes from the owner's saved
          // override (Admin → Withdraw Methods) rather than the
          // built-in table — the UI offers Reset only then.
          overridden: z.boolean(),
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
      catalogue: z.array(
        z.object({
          id: z.string(),
          label: z.string(),
          imageUrl: z.string().nullable(),
          fields: z.array(z.object({ key: z.string(), label: z.string() })),
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
      const settings = await getSettings(db);
      const override = builtinMethodsOverride(settings);
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
      const methodOut = (m: MethodDef) => ({
        id: m.id,
        label: m.label,
        imageUrl: m.imageUrl ?? null,
        fields: m.fields,
      });
      const builtIns = [
        ...Object.keys(METHODS_BY_COUNTRY).map((code) => ({
          countryCode: code,
          countryName: BUILT_IN_GROUP_NAMES[code] ?? code,
          overridden: override[code] !== undefined,
          methods: methodsForCountry(code, settings).map(methodOut),
        })),
        {
          countryCode: "DEFAULT",
          countryName: "All other countries (default)",
          overridden: override["DEFAULT"] !== undefined,
          methods: methodsForCountry(null, settings).map(methodOut),
        },
      ];
      return {
        builtIns,
        catalogue: Object.values(METHODS).map(methodOut),
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

  adminSetBuiltinWithdrawMethods: defineAction({
    description:
      "Replaces the built-in withdraw method set for one or more country groups (ISO code, or DEFAULT for all other countries) with the owner's picked methods from the built-in catalogue. Saved in site settings and applied at once to every user whose locked country matches — no redeploy. A group named in resetGroups drops its override and returns to the built-in table.",
    request: z.object({
      adminToken: z.string().min(1).max(200),
      groups: z
        .array(
          z.object({
            countryCode: z
              .string()
              .trim()
              .regex(/^([A-Za-z]{2}|DEFAULT)$/),
            methodIds: z.array(z.string().trim().min(1).max(40)).min(1).max(20),
          }),
        )
        .max(10)
        .default([]),
      resetGroups: z
        .array(z.string().trim().regex(/^([A-Za-z]{2}|DEFAULT)$/))
        .max(10)
        .default([]),
    }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      await requireAdmin(ctx, args.adminToken);
      const db = ctx.db<typeof schema>();
      const settings = await getSettings(db);
      const override = builtinMethodsOverride(settings);
      for (const group of args.groups) {
        const ids = group.methodIds.filter((id) => METHODS[id] != null);
        if (ids.length === 0)
          throw new Error(
            "Pick at least one known method for each country — a country must keep at least one built-in withdraw method.",
          );
        override[group.countryCode.toUpperCase()] = [...new Set(ids)];
      }
      for (const code of args.resetGroups)
        delete override[code.toUpperCase()];
      await db
        .insert(schema.settings)
        .values({
          key: "withdraw_methods_json",
          value: JSON.stringify(override),
        })
        .onConflictDoUpdate({
          target: schema.settings.key,
          set: { value: JSON.stringify(override) },
        });
      ctx.invalidateQueries();
      return { ok: true };
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
        methodsForCountry(code, await getSettings(db)).map((m) =>
          m.label.toLowerCase(),
        ),
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
        methodsForCountry(row.countryCode, await getSettings(db)).map((m) =>
          m.label.toLowerCase(),
        ),
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
    response: z.object({ items: z.array(adminContentShape) }),
    async handler(ctx, args) {
      await requireAdmin(ctx, args.adminToken);
      const db = ctx.db<typeof schema>();
      const rows = await db
        .select()
        .from(schema.contentItems)
        .orderBy(schema.contentItems.kind, schema.contentItems.sortOrder, desc(schema.contentItems.id));
      return { items: rows.map(adminContent) };
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
      feedUrl: z.string().trim().max(2000).nullable().default(null),
      // Generic feed controls: Bearer auth for the feed (the secret
      // is server-only; blank while editing keeps the stored one)
      // and the category filter for this row's items.
      feedAuthKind: z.enum(["none", "bearer"]).default("none"),
      feedSecret: z.string().trim().max(300).optional(),
      feedCategory: z.string().trim().max(60).default(""),
      feedCategoryMode: z.enum(["include", "exclude"]).default("include"),
      imageUrl: z.string().trim().max(1000).nullable().default(null),
      badge: z.string().trim().max(24).nullable().default(null),
      platform: z.enum(["android", "ios", "both"]).default("android"),
      milestones: z
        .array(
          z.object({
            event: z.string().trim().min(1).max(120),
            amountCents: z.number().int().nonnegative().max(100_000_000),
          }),
        )
        .max(50)
        .default([]),
      countries: z.string().trim().max(300).default("ALL"),
      featured: z.boolean().default(false),
      active: z.boolean().default(true),
      sortOrder: z.number().int().min(0).max(10000).default(0),
    }),
    response: z.object({ id: z.number() }),
    async handler(ctx, args) {
      await requireAdmin(ctx, args.adminToken);
      const db = ctx.db<typeof schema>();
      // Blank feed secret while editing keeps the stored one (same
      // rule as partner-callback secrets); a new row starts empty.
      let storedFeedSecret = "";
      if (args.id) {
        const existing = await db
          .select()
          .from(schema.contentItems)
          .where(eq(schema.contentItems.id, args.id))
          .limit(1);
        storedFeedSecret = existing[0]?.feedSecret ?? "";
      }
      const values = {
        kind: args.kind,
        title: args.title,
        provider: args.provider,
        description: args.description,
        rewardCents: args.rewardCents,
        url: args.url,
        feedUrl: args.feedUrl,
        feedAuthKind: args.feedAuthKind,
        feedSecret:
          args.feedSecret !== undefined && args.feedSecret !== ""
            ? args.feedSecret
            : storedFeedSecret,
        feedCategory: args.feedCategory,
        feedCategoryMode: args.feedCategoryMode,
        imageUrl: args.imageUrl,
        badge: args.badge,
        platform: args.platform,
        milestonesJson: JSON.stringify(args.milestones),
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
    description: "Admin inbox: every user help thread with unread counts, pending-appeal counts and the latest message.",
    request: z.object({ adminToken: z.string().min(1).max(200) }),
    response: z.object({
      threads: z.array(
        z.object({
          userId: z.number(),
          userName: z.string(),
          userCode: z.string(),
          userEmail: z.string(),
          unread: z.number(),
          pending: z.number(),
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
      const pending = new Map<number, number>();
      for (const m of msgs) {
        if (!seen.has(m.userId)) seen.set(m.userId, m);
        if (m.sender === "user" && m.readByAdmin === 0)
          unread.set(m.userId, (unread.get(m.userId) ?? 0) + 1);
        if (m.sender === "user" && m.status === "pending")
          pending.set(m.userId, (pending.get(m.userId) ?? 0) + 1);
      }
      return {
        threads: [...seen.entries()].map(([userId, m]) => ({
          userId,
          userName: byId.get(userId)?.name ?? "User",
          userCode: byId.get(userId)?.userCode ?? "",
          userEmail: byId.get(userId)?.email ?? "",
          unread: unread.get(userId) ?? 0,
          pending: pending.get(userId) ?? 0,
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
          imageUrl: z.string().nullable(),
          status: z.string(),
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
          imageUrl: m.imageUrl,
          status: m.status,
          createdAt: m.createdAt.toISOString(),
        })),
      };
    },
  }),

  adminReply: defineAction({
    description:
      "Sends a reply from the admin to a user: it is emailed straight to the user's email from TapOne <info@tapone.store>, and also saved in the admin Inbox thread. There is no in-site Mailbox any more — the user sees only the note in Help that their reply will be sent to their email.",
    request: z.object({
      adminToken: z.string().min(1).max(200),
      userId: z.number().int().positive(),
      body: z.string().trim().min(1).max(2000),
    }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      await requireAdmin(ctx, args.adminToken);
      const db = ctx.db<typeof schema>();
      const userRows = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, args.userId))
        .limit(1);
      const user = userRows[0];
      if (!user) throw new Error("That user no longer exists.");
      // Subject line for the email: the subject of the user's latest
      // appeal in this thread, if any.
      const latest = await db
        .select()
        .from(schema.messages)
        .where(
          and(
            eq(schema.messages.userId, args.userId),
            eq(schema.messages.sender, "user"),
          ),
        )
        .orderBy(desc(schema.messages.id))
        .limit(1);
      await db.insert(schema.messages).values({
        userId: args.userId,
        sender: "admin",
        subject: "",
        body: args.body,
        imageUrl: null,
        status: "approved",
        readByAdmin: 1,
        // No in-site Mailbox any more, so there is no unread state to
        // carry for this reply — it is delivered by email instead.
        readByUser: 1,
      });
      // Email the reply directly to the user — best effort: a mail
      // failure must never lose the reply itself.
      await notifyHelpReplyByEmail({
        userName: user.name,
        userEmail: user.email,
        subject: latest[0]?.subject ?? "",
        body: args.body,
      });
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  adminApproveHelpMessage: defineAction({
    description:
      "Approves one user help appeal after the admin has read and solved it.",
    request: z.object({
      adminToken: z.string().min(1).max(200),
      messageId: z.number().int().positive(),
    }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      await requireAdmin(ctx, args.adminToken);
      const db = ctx.db<typeof schema>();
      const rows = await db
        .select()
        .from(schema.messages)
        .where(eq(schema.messages.id, args.messageId))
        .limit(1);
      const msg = rows[0];
      if (!msg) throw new Error("That message no longer exists.");
      if (msg.sender !== "user")
        throw new Error("Only a user's own appeal can be approved.");
      await db
        .update(schema.messages)
        .set({ status: "approved", readByAdmin: 1 })
        .where(eq(schema.messages.id, args.messageId));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  // ------------------------------------------------------- live chat (admin)
  //
  // The owner's Live Chat moderation view: read every message, reply as
  // "Official TapOne", block / unblock users (permanent or 1 / 7 / 30
  // days) and appoint / remove chat managers. Only the owner can
  // appoint or remove a manager.

  adminGetLiveChat: defineAction({
    description:
      "Admin Live Chat view: the newest chat messages with each sender's name, picture and role, plus every person who has chatted (or is a manager, or is blocked) with their manager / block state.",
    request: z.object({ adminToken: z.string().min(1).max(200) }),
    response: z.object({
      messages: z.array(chatMessageShape),
      blocked: z.array(
        z.object({
          userId: z.number(),
          expiresAt: z.string().nullable(),
        }),
      ),
      people: z.array(
        z.object({
          userId: z.number(),
          name: z.string(),
          pictureUrl: z.string().nullable(),
          isManager: z.boolean(),
          blockedUntil: z.string().nullable(),
        }),
      ),
    }),
    async handler(ctx, args) {
      await requireAdmin(ctx, args.adminToken);
      const db = ctx.db<typeof schema>();
      const { messages, blocked } = await loadChatMessages(db, 100);
      const blockedByUser = new Map(
        blocked.map((b) => [b.userId, b.expiresAt]),
      );
      const users = await db.select().from(schema.users);
      const chatterIds = new Set(
        messages.filter((m) => m.userId > 0).map((m) => m.userId),
      );
      const people = users
        .filter(
          (u) =>
            chatterIds.has(u.id) ||
            u.isChatManager === 1 ||
            blockedByUser.has(u.id),
        )
        .map((u) => ({
          userId: u.id,
          name: u.name,
          pictureUrl: u.pictureUrl,
          isManager: u.isChatManager === 1,
          blockedUntil: blockedByUser.get(u.id) ?? null,
        }));
      return { messages, blocked, people };
    },
  }),

  adminSendChatMessage: defineAction({
    description:
      "The owner replies in Live Chat from the Admin panel. Every user sees it as Official TapOne with a verified tick.",
    request: z.object({
      adminToken: z.string().min(1).max(200),
      body: z.string().trim().min(1).max(1000),
    }),
    response: z.object({ ok: z.literal(true), id: z.number() }),
    async handler(ctx, args): Promise<{ ok: true; id: number }> {
      await requireAdmin(ctx, args.adminToken);
      const db = ctx.db<typeof schema>();
      const inserted = await db
        .insert(schema.chatMessages)
        .values({ userId: -1, role: "owner", body: args.body })
        .returning({ id: schema.chatMessages.id });
      ctx.invalidateQueries();
      return { ok: true, id: inserted[0]?.id ?? 0 };
    },
  }),

  adminBlockChatUser: defineAction({
    description:
      "The owner blocks a user from sending messages in Live Chat (the user can still read). days 1 / 7 / 30 = timed block; omitted = permanent.",
    request: z.object({
      adminToken: z.string().min(1).max(200),
      userId: z.number().int().positive(),
      days: z.number().int().optional(),
    }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      await requireAdmin(ctx, args.adminToken);
      const db = ctx.db<typeof schema>();
      await blockChatUser(db, args.userId, -1, args.days);
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  adminUnblockChatUser: defineAction({
    description:
      "The owner unblocks a user in Live Chat so they can send messages again.",
    request: z.object({
      adminToken: z.string().min(1).max(200),
      userId: z.number().int().positive(),
    }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      await requireAdmin(ctx, args.adminToken);
      const db = ctx.db<typeof schema>();
      await db
        .delete(schema.chatBlocks)
        .where(eq(schema.chatBlocks.userId, args.userId));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  adminSetChatManager: defineAction({
    description:
      "The owner appoints or removes a chat manager. A manager's messages carry a Manager tick and a manager can also block / unblock chat users. Only the owner can do this.",
    request: z.object({
      adminToken: z.string().min(1).max(200),
      userId: z.number().int().positive(),
      isManager: z.boolean(),
    }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      await requireAdmin(ctx, args.adminToken);
      const db = ctx.db<typeof schema>();
      const target = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, args.userId))
        .limit(1);
      if (!target[0]) throw new Error("That user no longer exists.");
      await db
        .update(schema.users)
        .set({ isChatManager: args.isManager ? 1 : 0 })
        .where(eq(schema.users.id, args.userId));
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

  adminListPartnerCallbacks: defineAction({
    description:
      "All owner-configured partner callbacks (Admin → Partner Callbacks): each partner's callback key, the parameter names it sends for user ID / transaction ID / payout, and its authentication method. Secret values are never returned — only whether one is set.",
    request: z.object({ adminToken: z.string().min(1).max(200) }),
    response: z.object({ partners: z.array(partnerCallbackShape) }),
    async handler(ctx, args) {
      await requireAdmin(ctx, args.adminToken);
      const db = ctx.db<typeof schema>();
      const rows = await db
        .select()
        .from(schema.partnerCallbacks)
        .orderBy(schema.partnerCallbacks.id);
      return { partners: rows.map(publicPartnerCallback) };
    },
  }),

  adminUpsertPartnerCallback: defineAction({
    description:
      "Adds or edits a partner callback config: partner name + callback key, which parameters carry the user ID, transaction ID and payout (and whether the payout is in cents, and how many payout units make $1), and how callbacks are authenticated — no secret, a shared secret parameter, or an HMAC-SHA1 / HMAC-SHA256 signature — with the secret value and, for HMAC partners, which signature format they use (sorted name=value pairs, the user:transaction:amount colon format Offerwall.GG uses, or the Moonetix tx:user:amount:status format — transaction, user, amount and status joined with colons). Saved configs take effect on the very next callback; no redeploy. Leaving the secret blank while editing keeps the stored one.",
    request: z.object({
      adminToken: z.string().min(1).max(200),
      id: z.number().int().positive().optional(),
      key: z
        .string()
        .trim()
        .toLowerCase()
        .regex(
          /^[a-z0-9][a-z0-9-]{1,39}$/,
          "Callback key must be 2–40 characters: lowercase letters, numbers and dashes.",
        ),
      name: z.string().trim().min(1).max(80),
      userParam: z.string().trim().min(1).max(60),
      txnParam: z.string().trim().min(1).max(60),
      payoutParam: z.string().trim().min(1).max(60),
      payoutInCents: z.boolean().default(false),
      // How many payout units make $1 (1 = the payout already arrives
      // in dollars; e.g. 1000 for a partner whose wall prices in 1000
      // units per $1). Applied after the cents conversion.
      payoutDivisor: z.number().positive().max(1000000).default(1),
      // Which string an HMAC partner signs: the sorted name=value pairs
      // ("params") or "{user}:{txn}:{payout}" ("colon", Offerwall.GG), or "{txn}:{user}:{reward}:{status}" ("moonetix", Moonetix).
      // Only used for HMAC auth methods.
      sigFormat: z.enum(["params", "colon", "moonetix", "custom"]).default("params"),
      // Admin-typed template for sigFormat "custom" (see
      // resolveSigTemplate); ignored for every other format.
      sigTemplate: z.string().trim().max(200).default(""),
      // Status handling: the parameter carrying the conversion
      // status, and the one value that credits.
      statusParam: z.string().trim().max(60).default(""),
      statusCreditValue: z.string().trim().max(60).default("1"),
      authMethod: z
        .enum(["none", "secret", "hmac_sha1", "hmac_sha256"])
        .default("none"),
      secretParam: z.string().trim().max(60).default(""),
      // Blank while editing = keep the stored secret; on a new partner
      // with an auth method chosen, a secret is required.
      secret: z.string().trim().max(300).optional(),
      // Wall-link signing salt (blank while editing = keep the
      // stored salt, like the secret) and the query parameter its
      // signature is sent in.
      linkHashSalt: z.string().trim().max(300).optional(),
      linkHashParam: z.string().trim().max(60).default("hash"),
      active: z.boolean().default(true),
    }),
    response: z.object({ id: z.number() }),
    async handler(ctx, args) {
      await requireAdmin(ctx, args.adminToken);
      const db = ctx.db<typeof schema>();
      if (args.key === "theoremreach")
        throw new Error(
          '"theoremreach" is reserved for the built-in TheoremReach callback. Pick a different key.',
        );
      if (
        args.userParam === args.txnParam ||
        args.userParam === args.payoutParam ||
        args.txnParam === args.payoutParam
      )
        throw new Error(
          "User ID, transaction ID and payout must be three different parameter names.",
        );
      if (args.authMethod !== "none") {
        if (!args.secretParam)
          throw new Error(
            "Name the parameter that will carry the secret / signature.",
          );
        if (
          args.secretParam === args.userParam ||
          args.secretParam === args.txnParam ||
          args.secretParam === args.payoutParam
        )
          throw new Error(
            "The secret / signature parameter must be its own parameter name.",
          );
      }
      // A "custom" format needs a usable template, and the status
      // parameter — when one is named — must be its own parameter
      // name, like the secret parameter above.
      if (args.sigFormat === "custom") {
        const templateError = sigTemplateError(args.sigTemplate, [
          args.userParam,
          args.txnParam,
          args.payoutParam,
          args.statusParam,
        ]);
        if (templateError) throw new Error(templateError);
      }
      if (
        args.statusParam &&
        (args.statusParam === args.userParam ||
          args.statusParam === args.txnParam ||
          args.statusParam === args.payoutParam ||
          args.statusParam === args.secretParam)
      )
        throw new Error(
          "The status parameter must be its own parameter name.",
        );
      // The key is the partner's callback address — it must be unique.
      const sameKey = await db
        .select()
        .from(schema.partnerCallbacks)
        .where(eq(schema.partnerCallbacks.key, args.key))
        .limit(1);
      if (sameKey[0] && sameKey[0].id !== args.id)
        throw new Error(
          `Another partner already uses the callback key "${args.key}". Pick a different one.`,
        );

      const base = {
        key: args.key,
        name: args.name,
        userParam: args.userParam,
        txnParam: args.txnParam,
        payoutParam: args.payoutParam,
        payoutInCents: args.payoutInCents ? 1 : 0,
        sigFormat: args.sigFormat,
        sigTemplate: args.sigTemplate,
        statusParam: args.statusParam,
        statusCreditValue: args.statusCreditValue || "1",
        linkHashParam: args.linkHashParam || "hash",
        payoutDivisor: args.payoutDivisor,
        authMethod: args.authMethod,
        secretParam: args.authMethod === "none" ? "" : args.secretParam,
        active: args.active ? 1 : 0,
      };

      if (args.id) {
        const rows = await db
          .select()
          .from(schema.partnerCallbacks)
          .where(eq(schema.partnerCallbacks.id, args.id))
          .limit(1);
        const row = rows[0];
        if (!row) throw new Error("That partner no longer exists.");
        const secret =
          args.secret !== undefined && args.secret !== ""
            ? args.secret
            : row.secret;
        const linkHashSalt =
          args.linkHashSalt !== undefined && args.linkHashSalt !== ""
            ? args.linkHashSalt
            : row.linkHashSalt;
        if (args.authMethod !== "none" && !secret)
          throw new Error(
            "Type the partner's secret — this authentication method needs one.",
          );
        await db
          .update(schema.partnerCallbacks)
          .set({
            ...base,
            secret: args.authMethod === "none" ? row.secret : secret,
            linkHashSalt,
          })
          .where(eq(schema.partnerCallbacks.id, args.id));
        ctx.invalidateQueries();
        return { id: args.id };
      }

      const secret = args.secret ?? "";
      if (args.authMethod !== "none" && !secret)
        throw new Error(
          "Type the partner's secret — this authentication method needs one.",
        );
      const inserted = await db
        .insert(schema.partnerCallbacks)
        .values({ ...base, secret, linkHashSalt: args.linkHashSalt ?? "" })
        .returning({ id: schema.partnerCallbacks.id });
      const row = inserted[0];
      if (!row) throw new Error("The partner could not be saved.");
      ctx.invalidateQueries();
      return { id: row.id };
    },
  }),

  adminSetPartnerCallbackActive: defineAction({
    description:
      "Switches a partner callback on or off. While off, that partner's callbacks are refused and nothing is credited; the config itself is kept.",
    request: z.object({
      adminToken: z.string().min(1).max(200),
      id: z.number().int().positive(),
      active: z.boolean(),
    }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      await requireAdmin(ctx, args.adminToken);
      const db = ctx.db<typeof schema>();
      await db
        .update(schema.partnerCallbacks)
        .set({ active: args.active ? 1 : 0 })
        .where(eq(schema.partnerCallbacks.id, args.id));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  adminRemovePartnerCallback: defineAction({
    description:
      "Removes a partner callback config for good. Past credits from that partner stay in the postback log and users' history — only the callback address stops working.",
    request: z.object({
      adminToken: z.string().min(1).max(200),
      id: z.number().int().positive(),
    }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      await requireAdmin(ctx, args.adminToken);
      const db = ctx.db<typeof schema>();
      await db
        .delete(schema.partnerCallbacks)
        .where(eq(schema.partnerCallbacks.id, args.id));
      ctx.invalidateQueries();
      return { ok: true };
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

  // ------------------------------------------------- announcements (broadcast)
  //
  // Owner broadcasts: one row reaches EVERY user in the notification
  // bell — no code change or redeploy to post one. kind is
  // "announcement" (news) or "event" (an upcoming event). Read state is
  // per user (announcement_reads), so the bell badge counts only what
  // this user has not seen yet.

  getAnnouncements: defineAction({
    description:
      "All owner announcements/events for the signed-in user, newest first, with per-user read state and the unread count for the bell badge.",
    request: z.object({ token: z.string().min(1).max(200) }),
    response: z.object({
      announcements: z.array(
        z.object({
          id: z.number(),
          kind: z.enum(["announcement", "event", "withdrawal"]),
          title: z.string(),
          body: z.string(),
          createdAt: z.string(),
          read: z.boolean(),
        }),
      ),
      unreadCount: z.number(),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const user = await requireUser(ctx, args.token);
      // Broadcasts (userId null) plus this user's own notifications.
      // Another user's withdraw notice never reaches this user.
      const rows = await db
        .select()
        .from(schema.announcements)
        .where(
          or(
            isNull(schema.announcements.userId),
            eq(schema.announcements.userId, user.id),
          ),
        )
        .orderBy(desc(schema.announcements.id))
        .limit(100);
      const reads = await db
        .select()
        .from(schema.announcementReads)
        .where(eq(schema.announcementReads.userId, user.id));
      const readIds = new Set(reads.map((r) => r.announcementId));
      return {
        announcements: rows.map((a) => ({
          id: a.id,
          kind: a.kind,
          title: a.title,
          body: a.body,
          createdAt: a.createdAt.toISOString(),
          read: readIds.has(a.id),
        })),
        unreadCount: rows.filter((a) => !readIds.has(a.id)).length,
      };
    },
  }),

  markAnnouncementsRead: defineAction({
    description:
      "Marks announcements as read for the signed-in user — one announcement, or all when no id is given; the bell badge drops accordingly.",
    request: z.object({
      token: z.string().min(1).max(200),
      announcementId: z.number().int().positive().optional(),
    }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const db = ctx.db<typeof schema>();
      const user = await requireUser(ctx, args.token);
      const targets = args.announcementId
        ? [args.announcementId]
        : (
            await db
              .select({ id: schema.announcements.id })
              .from(schema.announcements)
              .where(
                or(
                  isNull(schema.announcements.userId),
                  eq(schema.announcements.userId, user.id),
                ),
              )
          ).map((a) => a.id);
      for (const id of targets) {
        await db
          .insert(schema.announcementReads)
          .values({ userId: user.id, announcementId: id })
          .onConflictDoNothing();
      }
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  adminListAnnouncements: defineAction({
    description: "Admin: every broadcast announcement/event, newest first.",
    request: z.object({ adminToken: z.string().min(1).max(200) }),
    response: z.object({
      announcements: z.array(
        z.object({
          id: z.number(),
          kind: z.enum(["announcement", "event", "withdrawal"]),
          title: z.string(),
          body: z.string(),
          createdAt: z.string(),
          updatedAt: z.string(),
        }),
      ),
    }),
    async handler(ctx, args) {
      await requireAdmin(ctx, args.adminToken);
      const db = ctx.db<typeof schema>();
      // Broadcasts only — per-user withdraw notices are not admin
      // content and must never be listed, edited or deleted here.
      const rows = await db
        .select()
        .from(schema.announcements)
        .where(isNull(schema.announcements.userId))
        .orderBy(desc(schema.announcements.id))
        .limit(200);
      return {
        announcements: rows.map((a) => ({
          id: a.id,
          kind: a.kind,
          title: a.title,
          body: a.body,
          createdAt: a.createdAt.toISOString(),
          updatedAt: a.updatedAt.toISOString(),
        })),
      };
    },
  }),

  adminCreateAnnouncement: defineAction({
    description:
      "Admin: posts a broadcast announcement/event — it appears in every user's notification bell immediately, no deploy needed.",
    request: z.object({
      adminToken: z.string().min(1).max(200),
      kind: z.enum(["announcement", "event"]),
      title: z.string().trim().min(1).max(120),
      body: z.string().trim().min(1).max(2000),
    }),
    response: z.object({ ok: z.literal(true), id: z.number() }),
    async handler(ctx, args) {
      await requireAdmin(ctx, args.adminToken);
      const db = ctx.db<typeof schema>();
      const inserted = await db
        .insert(schema.announcements)
        .values({ kind: args.kind, title: args.title, body: args.body })
        .returning({ id: schema.announcements.id });
      ctx.invalidateQueries();
      return { ok: true as const, id: inserted[0]?.id ?? 0 };
    },
  }),

  adminUpdateAnnouncement: defineAction({
    description: "Admin: edits a broadcast announcement/event; every user sees the new text at once.",
    request: z.object({
      adminToken: z.string().min(1).max(200),
      id: z.number().int().positive(),
      kind: z.enum(["announcement", "event"]),
      title: z.string().trim().min(1).max(120),
      body: z.string().trim().min(1).max(2000),
    }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      await requireAdmin(ctx, args.adminToken);
      const db = ctx.db<typeof schema>();
      await db
        .update(schema.announcements)
        .set({
          kind: args.kind,
          title: args.title,
          body: args.body,
          updatedAt: new Date(),
        })
        // Broadcasts only — a per-user withdraw notice can never be
        // edited from the admin panel.
        .where(
          and(
            eq(schema.announcements.id, args.id),
            isNull(schema.announcements.userId),
          ),
        );
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  adminDeleteAnnouncement: defineAction({
    description: "Admin: deletes a broadcast announcement/event; it disappears from every user's bell.",
    request: z.object({
      adminToken: z.string().min(1).max(200),
      id: z.number().int().positive(),
    }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      await requireAdmin(ctx, args.adminToken);
      const db = ctx.db<typeof schema>();
      await db
        .delete(schema.announcementReads)
        .where(eq(schema.announcementReads.announcementId, args.id));
      await db
        .delete(schema.announcements)
        // Broadcasts only — a per-user withdraw notice can never be
        // deleted from the admin panel.
        .where(
          and(
            eq(schema.announcements.id, args.id),
            isNull(schema.announcements.userId),
          ),
        );
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  adminUpdateSettings: defineAction({
    description:
      "Updates site settings: Google client ID, minimum withdrawal, revenue share, affiliate rates, postback secret, TheoremReach secret key, the weekly check-in goal + 7 day rewards, the level pace and title table, the Daily Contest total prize pool, and the admin username/password.",
    request: z.object({
      adminToken: z.string().min(1).max(200),
      googleClientId: z.string().trim().max(300).optional(),
      minWithdrawCents: z.number().int().nonnegative().max(100_000_000).optional(),
      dailyContestTotalCents: z.number().int().min(0).max(100_000_000).optional(),
      userSharePct: z.number().int().min(1).max(100).optional(),
      affiliateEarningPct: z.number().int().min(0).max(100).optional(),
      affiliateSpendingPct: z.number().int().min(0).max(100).optional(),
      postbackSecret: z.string().max(200).optional(),
      theoremReachSecret: z.string().max(200).optional(),
      offerwallggApiKey: z.string().max(200).optional(),
      pubscaleSecretKey: z.string().max(200).optional(),
      checkinBonusCents: z.number().int().min(0).max(100000).optional(),
      levelRewardCents: z.number().int().min(0).max(100000).optional(),
      checkinGoalCents: z.number().int().min(1).max(1_000_000).optional(),
      checkinRewardsCents: z
        .array(z.number().int().min(0).max(100_000))
        .length(7)
        .optional(),
      levelCentsPerLevel: z.number().int().min(1).max(1_000_000).optional(),
      levelTitles: z
        .array(
          z.object({
            name: z.string().trim().min(1).max(30),
            level: z.number().int().min(1).max(1_000_000),
            standardPct: z.number().int().min(0).max(100),
            enhancedPct: z.number().int().min(0).max(100),
            // One-time Level Reward for reaching this title, in cents.
            // Optional so older admin clients keep saving; a missing
            // value is filled from the built-in table by name.
            rewardCents: z.number().int().min(0).max(100_000_000).optional(),
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
      // The whole admin-managed social links list as JSON
      // ([{ id, label, url, imageUrl, active }], max 50 links) — the
      // Settings editor sends this instead of the fixed per-platform
      // fields above. Validated and stored as `social_links_json`.
      socialLinksJson: z.string().max(20000).optional(),
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
      if (args.minWithdrawCents !== undefined)
        updates.push(["min_withdraw_cents", String(args.minWithdrawCents)]);
      if (args.dailyContestTotalCents !== undefined)
        updates.push(["daily_contest_total_cents", String(args.dailyContestTotalCents)]);
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
      if (args.offerwallggApiKey !== undefined)
        updates.push(["offerwallgg_api_key", args.offerwallggApiKey]);
      if (args.pubscaleSecretKey !== undefined)
        updates.push(["pubscale_secret_key", args.pubscaleSecretKey]);
      if (args.checkinBonusCents !== undefined)
        updates.push(["checkin_bonus_cents", String(args.checkinBonusCents)]);
      if (args.levelRewardCents !== undefined)
        updates.push(["level_reward_cents", String(args.levelRewardCents)]);
      if (args.checkinGoalCents !== undefined)
        updates.push(["checkin_goal_cents", String(args.checkinGoalCents)]);
      if (args.checkinRewardsCents !== undefined)
        updates.push(["checkin_rewards_cents", args.checkinRewardsCents.join(",")]);
      if (args.levelCentsPerLevel !== undefined)
        updates.push(["level_cents_per_level", String(args.levelCentsPerLevel)]);
      if (args.levelTitles !== undefined) {
        // Title levels must strictly increase, or the table is
        // meaningless — refuse the save instead of storing a bad one.
        for (let i = 1; i < args.levelTitles.length; i++) {
          if ((args.levelTitles[i]?.level ?? 0) <= (args.levelTitles[i - 1]?.level ?? 0))
            throw new Error("Title levels must increase from one title to the next.");
        }
        updates.push([
          "level_titles_json",
          JSON.stringify(
            args.levelTitles.map((t) => ({
              ...t,
              rewardCents: t.rewardCents ?? defaultRewardForTitle(t.name),
            })),
          ),
        ]);
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
      if (args.socialLinksJson !== undefined) {
        // Validate the whole list before storing anything: bad JSON or
        // a bad entry refuses the save instead of breaking the footer
        // and the Redeem Code section for every user.
        let parsed: unknown;
        try {
          parsed = JSON.parse(args.socialLinksJson);
        } catch {
          throw new Error("Social links could not be saved — the list is not valid.");
        }
        if (!Array.isArray(parsed) || parsed.length > 50)
          throw new Error("Social links must be a list of at most 50 links.");
        const seen = new Set<string>();
        for (const entry of parsed) {
          const link = normalizeSocialLink(entry);
          if (!link) throw new Error("Each social link needs a name and a valid id.");
          if (seen.has(link.id))
            throw new Error(`Two social links use the id "${link.id}".`);
          seen.add(link.id);
          if (
            link.url !== "" &&
            !link.url.startsWith("http://") &&
            !link.url.startsWith("https://")
          )
            throw new Error(`"${link.label}": the link must start with https://.`);
          if (
            link.imageUrl !== "" &&
            !link.imageUrl.startsWith("http://") &&
            !link.imageUrl.startsWith("https://")
          )
            throw new Error(`"${link.label}": the image link must start with https://.`);
        }
        updates.push(["social_links_json", JSON.stringify(parsed)]);
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

  // ---------------------------------------------------------- redeem codes
  //
  // The Redeem Code section (replaces Contact Us, owner order
  // 2026-11-27): the owner creates a code from the Admin panel — the
  // code text itself is typed by the owner (TAPONE10, EID2026, any
  // text), plus a dollar amount of any value and a max number of uses.
  // A user types the code in the Redeem Code section and the FULL
  // amount lands in their balance — no 70/30 split, no affiliate
  // commission, the owner pays it in full. Rules enforced here:
  //   - a code stops working when its max uses are reached, or when
  //     the owner deactivates it;
  //   - one user can redeem the same code only once, ever (enforced
  //     by the UNIQUE (code_id, user_id) index on redeem_redemptions
  //     as well as the check below);
  //   - invalid / inactive / used-up codes credit nothing and return
  //     a plain-English error the section shows to the user.
  // Every successful redemption is recorded (who, which code, amount,
  // when) and listed for the admin. Redeem earnings count like other
  // earnings: they can unlock level rewards and the daily check-in
  // goal, exactly as offer credits do.
  redeemCode: defineAction({
    description:
      "Redeems a code from the Redeem Code section: credits its full amount to the signed-in user's balance. Fails with a plain error for an invalid, inactive or used-up code, or one the user already used.",
    request: z.object({
      token: z.string().min(1).max(200),
      code: z.string().trim().min(1).max(40),
    }),
    response: z.object({
      ok: z.literal(true),
      code: z.string(),
      amountCents: z.number(),
    }),
    async handler(ctx, args) {
      const user = await requireUser(ctx, args.token);
      const db = ctx.db<typeof schema>();
      const codeText = args.code.trim().toUpperCase();
      const rows = await db
        .select()
        .from(schema.redeemCodes)
        .where(eq(schema.redeemCodes.code, codeText))
        .limit(1);
      const row = rows[0];
      if (!row) throw new Error("That code is not valid. Check it and try again.");
      if (row.active !== 1)
        throw new Error("This code is no longer active.");
      if (row.usedCount >= row.maxUses)
        throw new Error("This code has already been used up.");
      const already = await db
        .select()
        .from(schema.redeemRedemptions)
        .where(
          and(
            eq(schema.redeemRedemptions.codeId, row.id),
            eq(schema.redeemRedemptions.userId, user.id),
          ),
        )
        .limit(1);
      if (already.length > 0)
        throw new Error("You have already used this code.");
      const statements: BatchItem<"sqlite">[] = [
        db.insert(schema.redeemRedemptions).values({
          codeId: row.id,
          code: row.code,
          userId: user.id,
          amountCents: row.amountCents,
        }),
        db
          .update(schema.redeemCodes)
          .set({ usedCount: row.usedCount + 1 })
          .where(eq(schema.redeemCodes.id, row.id)),
        db
          .update(schema.users)
          .set({
            balanceCents: user.balanceCents + row.amountCents,
            totalEarnedCents: user.totalEarnedCents + row.amountCents,
          })
          .where(eq(schema.users.id, user.id)),
        db.insert(schema.transactions).values({
          userId: user.id,
          kind: "redeem_code",
          amountCents: row.amountCents,
          note: `Redeem code ${row.code}`,
        }),
      ];
      const [first, ...rest] = statements;
      if (first) await db.batch([first, ...rest]);
      await checkLevelUps(db, user.id);
      await syncWeeklyCheckin(db, user.id);
      return { ok: true as const, code: row.code, amountCents: row.amountCents };
    },
  }),

  adminListRedeemCodes: defineAction({
    description:
      "Admin list of every redeem code with its used count, plus the latest redemptions (who redeemed which code, how much, when).",
    request: z.object({ adminToken: z.string().min(1).max(200) }),
    response: z.object({
      codes: z.array(
        z.object({
          id: z.number(),
          code: z.string(),
          amountCents: z.number(),
          maxUses: z.number(),
          usedCount: z.number(),
          active: z.number(),
          createdAt: z.string(),
        }),
      ),
      redemptions: z.array(
        z.object({
          id: z.number(),
          code: z.string(),
          userName: z.string(),
          amountCents: z.number(),
          createdAt: z.string(),
        }),
      ),
    }),
    async handler(ctx, args) {
      await requireAdmin(ctx, args.adminToken);
      const db = ctx.db<typeof schema>();
      const codes = await db
        .select()
        .from(schema.redeemCodes)
        .orderBy(desc(schema.redeemCodes.id));
      const reds = await db
        .select()
        .from(schema.redeemRedemptions)
        .orderBy(desc(schema.redeemRedemptions.id))
        .limit(50);
      const userIds = [...new Set(reds.map((r) => r.userId))];
      const users = userIds.length
        ? await db.select().from(schema.users).where(inArray(schema.users.id, userIds))
        : [];
      const byId = new Map(users.map((u) => [u.id, u]));
      return {
        codes: codes.map((c) => ({
          id: c.id,
          code: c.code,
          amountCents: c.amountCents,
          maxUses: c.maxUses,
          usedCount: c.usedCount,
          active: c.active,
          createdAt: c.createdAt.toISOString(),
        })),
        redemptions: reds.map((r) => ({
          id: r.id,
          code: r.code,
          userName: (byId.get(r.userId)?.name ?? "TapOne user").split(" ")[0] ?? "TapOne user",
          amountCents: r.amountCents,
          createdAt: r.createdAt.toISOString(),
        })),
      };
    },
  }),

  adminCreateRedeemCode: defineAction({
    description:
      "Admin creates a redeem code: the code text is typed by the owner (any text, e.g. TAPONE10), plus the dollar amount and the max number of uses. Leave the code blank and one is generated for you.",
    request: z.object({
      adminToken: z.string().min(1).max(200),
      code: z.string().trim().max(32).optional(),
      amountCents: z.number().int().min(1).max(1_000_000),
      maxUses: z.number().int().min(1).max(10000),
    }),
    response: z.object({ ok: z.literal(true), id: z.number(), code: z.string() }),
    async handler(ctx, args) {
      await requireAdmin(ctx, args.adminToken);
      const db = ctx.db<typeof schema>();
      const codeText =
        args.code && args.code.trim() !== ""
          ? args.code.trim().toUpperCase()
          : randomCode(8);
      if (!/^[A-Z0-9][A-Z0-9-]{3,31}$/.test(codeText))
        throw new Error(
          "The code must be 4–32 letters, numbers or dashes (e.g. TAPONE10).",
        );
      const existing = await db
        .select()
        .from(schema.redeemCodes)
        .where(eq(schema.redeemCodes.code, codeText))
        .limit(1);
      if (existing.length > 0)
        throw new Error("A code with this text already exists.");
      const inserted = await db
        .insert(schema.redeemCodes)
        .values({
          code: codeText,
          amountCents: args.amountCents,
          maxUses: args.maxUses,
        })
        .returning({ id: schema.redeemCodes.id });
      const id = inserted[0]?.id;
      if (!id) throw new Error("The code could not be created. Try again.");
      return { ok: true as const, id, code: codeText };
    },
  }),

  adminSetRedeemCodeActive: defineAction({
    description:
      "Admin activates or deactivates a redeem code. A deactivated code stops working at once; its past redemptions stay recorded.",
    request: z.object({
      adminToken: z.string().min(1).max(200),
      id: z.number().int().positive(),
      active: z.boolean(),
    }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args) {
      await requireAdmin(ctx, args.adminToken);
      const db = ctx.db<typeof schema>();
      const rows = await db
        .select()
        .from(schema.redeemCodes)
        .where(eq(schema.redeemCodes.id, args.id))
        .limit(1);
      if (!rows[0]) throw new Error("Code not found.");
      await db
        .update(schema.redeemCodes)
        .set({ active: args.active ? 1 : 0 })
        .where(eq(schema.redeemCodes.id, args.id));
      return { ok: true as const };
    },
  }),

  adminDeleteRedeemCode: defineAction({
    description:
      "Admin deletes a redeem code. Its past redemptions stay recorded (they carry the code text), so the history is not lost.",
    request: z.object({
      adminToken: z.string().min(1).max(200),
      id: z.number().int().positive(),
    }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args) {
      await requireAdmin(ctx, args.adminToken);
      const db = ctx.db<typeof schema>();
      const rows = await db
        .select()
        .from(schema.redeemCodes)
        .where(eq(schema.redeemCodes.id, args.id))
        .limit(1);
      if (!rows[0]) throw new Error("Code not found.");
      await db.delete(schema.redeemCodes).where(eq(schema.redeemCodes.id, args.id));
      return { ok: true as const };
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
        minWithdrawCents: settingInt(settings, "min_withdraw_cents"),
        userSharePct: settingInt(settings, "user_share_pct"),
        affiliateEarningPct: settingInt(settings, "affiliate_earning_pct"),
        affiliateSpendingPct: settingInt(settings, "affiliate_spending_pct"),
      };
    },
  }),
} satisfies ActionsModule;
