// TapOne data model. All money is integer cents; the UI shows dollars only.
//
// users        — one row per Google account; country/IP locked at sign-in
// sessions     — opaque session tokens issued at sign-in
// contentItems — offerwalls / surveys / games the admin manages; every
//                client reads these rows, so admin edits reach everyone
// transactions — the earnings ledger (offer credits, affiliate commissions)
// withdrawals  — user requests the admin approves or rejects
// messages     — help requests and admin mailbox replies (one thread table)
// postbacks    — offerwall conversion log; txn_id unique = idempotent credit
// settings     — key/value site settings (Google client id, admin login,
//                contest pools, minimum withdrawal)
// bannedCountries — countries the owner has banned; no new account may be
//                created from a banned country (checked server-side at sign-up)
// withdrawMethods — EXTRA withdraw payment methods the owner adds per
//                country from the admin panel; they appear on the
//                Withdraw page of every user whose locked country
//                matches, alongside the built-in per-country methods
// adminNotifications — owner alerts, e.g. every new registration with the
//                user's name, email, country, flag and IP
// partnerCallbacks — owner-configured reward callbacks for partners that
//                do NOT match the built-in generic postback or the
//                TheoremReach callback: for each partner the owner sets
//                which query parameter carries the user ID, the
//                transaction ID and the payout, and how the call is
//                authenticated (no secret / a shared secret parameter /
//                HMAC-SHA1 / HMAC-SHA256). Adding a partner is then pure
//                admin data — no code change or redeploy.

import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userCode: text("user_code").notNull().unique(),
  name: text("name").notNull(),
  // How many times the user has changed their display name from the
  // Profile page. Lifetime limit is 3 (MAX_NAME_CHANGES in actions.ts);
  // at the limit the name is locked. Sign-in never resets it and never
  // overwrites a name the user chose.
  nameChanges: integer("name_changes").notNull().default(0),
  email: text("email").notNull().unique(),
  pictureUrl: text("picture_url"),
  loginMethod: text("login_method").notNull().default("google"),
  ip: text("ip"),
  countryCode: text("country_code"),
  countryName: text("country_name"),
  flagEmoji: text("flag_emoji"),
  isp: text("isp"),
  balanceCents: integer("balance_cents").notNull().default(0),
  totalEarnedCents: integer("total_earned_cents").notNull().default(0),
  // Current level: every $1 of lifetime earnings = 1 level (RewardJoy
  // rule). One-time per-title Level Rewards are paid by checkLevelUps
  // in actions.ts.
  level: integer("level").notNull().default(0),
  // Highest 10-level milestone whose Title Bonus has been settled.
  // Legacy: the per-10-levels Title Bonus was replaced by the one-time
  // per-title Level Rewards (owner scheme 2026-11-21); the column is
  // kept so old rows keep parsing, but nothing pays from it any more.
  titleBonusPaidLevel: integer("title_bonus_paid_level").notNull().default(0),
  // JSON array of title names whose one-time Level Reward this user
  // has already been paid (e.g. ["Bronze","Silver"]). A title is paid
  // at most once per user, ever — checkLevelUps in actions.ts is the
  // only writer.
  titleRewardsPaidJson: text("title_rewards_paid_json").notNull().default("[]"),
  // Dark/light choice, saved per user so it persists across devices.
  theme: text("theme").notNull().default("light"),
  referralCode: text("referral_code").notNull().unique(),
  // Offer Token shown on the user's own Profile. Every user gets their
  // OWN unique token (generated at sign-up, unique in the DB) — no two
  // users share one. Nullable only so pre-existing rows could be
  // backfilled by migration 0010; new rows always set it.
  offerToken: text("offer_token").unique(),
  referredById: integer("referred_by_id"),
  blocked: integer("blocked").notNull().default(0),
  lastSeenAt: integer("last_seen_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const sessions = sqliteTable("sessions", {
  token: text("token").primaryKey(),
  userId: integer("user_id").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const contentItems = sqliteTable("content_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  kind: text("kind", { enum: ["offerwall", "survey", "game"] }).notNull(),
  title: text("title").notNull(),
  provider: text("provider").notNull().default(""),
  description: text("description").notNull().default(""),
  rewardCents: integer("reward_cents"),
  url: text("url").notNull().default(""),
  // Optional JSON feed address for this partner's INDIVIDUAL items
  // (Admin → Content → Items feed URL). When set on a survey or game
  // row, the server fetches it per user — {user_id} / {ip} /
  // {country} placeholders — and lists the partner's own surveys or
  // games in the Surveys / Games tabs. Server-only: never sent to
  // user clients (a feed URL can carry a partner API key).
  feedUrl: text("feed_url"),
  imageUrl: text("image_url"),
  // Optional small badge on the Offerwalls card (e.g. "+20%"), set by
  // the owner in Admin → Content. Null = no badge.
  badge: text("badge"),
  // Games only: which devices the game runs on ("android" | "ios" |
  // "both"). The Games tab's Android/iOS pills filter on this and the
  // pill defaults to the visitor's own device.
  platform: text("platform").notNull().default("android"),
  // Games only: JSON array of { event, amountCents } — the milestone
  // table in the game's detail popup; the amounts add up to the total
  // payout shown on the game card. Edited in Admin → Content.
  milestonesJson: text("milestones_json").notNull().default("[]"),
  // Comma-separated ISO country codes, or "ALL".
  countries: text("countries").notNull().default("ALL"),
  featured: integer("featured").notNull().default(0),
  active: integer("active").notNull().default(1),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const transactions = sqliteTable("transactions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull(),
  kind: text("kind", {
    enum: [
      "offer_credit",
      "affiliate_earning",
      "affiliate_spending",
      "withdrawal_hold",
      "withdrawal_refund",
      "admin_adjust",
      "checkin_bonus",
      "contest_prize",
      "level_reward",
    ],
  }).notNull(),
  amountCents: integer("amount_cents").notNull(),
  note: text("note").notNull().default(""),
  refId: integer("ref_id"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const withdrawals = sqliteTable("withdrawals", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull(),
  amountCents: integer("amount_cents").notNull(),
  method: text("method").notNull(),
  detailsJson: text("details_json").notNull().default("{}"),
  status: text("status", { enum: ["pending", "approved", "rejected"] })
    .notNull()
    .default("pending"),
  adminNote: text("admin_note").notNull().default(""),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  decidedAt: integer("decided_at", { mode: "timestamp_ms" }),
});

export const messages = sqliteTable("messages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull(),
  sender: text("sender", { enum: ["user", "admin"] }).notNull(),
  subject: text("subject").notNull().default(""),
  body: text("body").notNull(),
  // Optional screenshot / photo the user attached to a help appeal
  // (blob URL, same storage as profile pictures).
  imageUrl: text("image_url"),
  // Help-appeal status: "pending" until the admin approves the appeal
  // in the Inbox; admin replies are stored as "approved".
  status: text("status").notNull().default("pending"),
  readByAdmin: integer("read_by_admin").notNull().default(0),
  readByUser: integer("read_by_user").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// announcements — owner broadcasts: every row is shown to ALL users in
// the notification bell. kind is "announcement" (news, e.g. "withdraw
// will be late") or "event" (an upcoming event). The admin creates,
// edits and deletes them from Admin → Announcements; posting one needs
// no code change or redeploy — it reaches every user immediately.
export const announcements = sqliteTable("announcements", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  kind: text("kind", { enum: ["announcement", "event"] })
    .notNull()
    .default("announcement"),
  title: text("title").notNull(),
  body: text("body").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// announcementReads — per-user read state for announcements; a row means
// this user has seen that announcement (the bell badge counts the rest).
export const announcementReads = sqliteTable("announcement_reads", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull(),
  announcementId: integer("announcement_id").notNull(),
  readAt: integer("read_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const postbacks = sqliteTable("postbacks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  txnId: text("txn_id").notNull().unique(),
  network: text("network").notNull().default(""),
  userId: integer("user_id"),
  payout: real("payout").notNull().default(0),
  creditedCents: integer("credited_cents").notNull().default(0),
  status: text("status", {
    enum: ["credited", "duplicate", "unknown_user"],
  }).notNull(),
  rawJson: text("raw_json").notNull().default("{}"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const bannedCountries = sqliteTable("banned_countries", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  countryCode: text("country_code").notNull().unique(),
  countryName: text("country_name").notNull().default(""),
  flagEmoji: text("flag_emoji"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const withdrawMethods = sqliteTable("withdraw_methods", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  countryCode: text("country_code").notNull(),
  countryName: text("country_name").notNull().default(""),
  label: text("label").notNull(),
  // Optional logo image link the owner pastes in Admin → Withdraw
  // Methods; shown next to the method's name on the Withdraw page.
  imageUrl: text("image_url"),
  // JSON array of { key, label } — the detail fields the user fills in
  // when withdrawing with this method (all required).
  fieldsJson: text("fields_json").notNull().default("[]"),
  // Removal is a soft delete (active = 0) so past withdrawals made
  // with the method keep resolving its label.
  active: integer("active").notNull().default(1),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const contestJoins = sqliteTable("contest_joins", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull(),
  contest: text("contest", { enum: ["daily", "affiliate"] }).notNull(),
  // Daily contest: the day key "YYYY-MM-DD". Affiliate contest: "ALL".
  periodKey: text("period_key").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const contestPayouts = sqliteTable("contest_payouts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  contest: text("contest", { enum: ["daily", "affiliate"] })
    .notNull()
    .default("daily"),
  // The day being settled, "YYYY-MM-DD". Unique per contest = settles once.
  periodKey: text("period_key").notNull(),
  winnerUserId: integer("winner_user_id"),
  amountCents: integer("amount_cents").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const checkins = sqliteTable("checkins", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull(),
  // Calendar day the bonus was claimed for, "YYYY-MM-DD" (server day).
  dayKey: text("day_key").notNull(),
  amountCents: integer("amount_cents").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const adminNotifications = sqliteTable("admin_notifications", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  type: text("type", { enum: ["registration"] }).notNull().default("registration"),
  userId: integer("user_id"),
  userName: text("user_name").notNull().default(""),
  userEmail: text("user_email").notNull().default(""),
  userCode: text("user_code").notNull().default(""),
  countryCode: text("country_code"),
  countryName: text("country_name"),
  flagEmoji: text("flag_emoji"),
  ip: text("ip"),
  read: integer("read").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const partnerCallbacks = sqliteTable("partner_callbacks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  // Short URL-safe key the partner's callback address ends with:
  // /partner-callback/<key>. Unique — one config per partner.
  key: text("key").notNull().unique(),
  // Partner display name; also the network name written on postback
  // log rows and the user's history note.
  name: text("name").notNull(),
  // Names of the query parameters THIS partner sends: which one holds
  // the user ID (the user's Offer Token / user code), which one the
  // unique transaction ID, and which one the payout amount.
  userParam: text("user_param").notNull().default("user_id"),
  txnParam: text("txn_param").notNull().default("txn_id"),
  payoutParam: text("payout_param").notNull().default("payout"),
  // 1 = the payout parameter arrives in cents (divided by 100 before
  // crediting); 0 = it arrives in dollars.
  payoutInCents: integer("payout_in_cents").notNull().default(0),
  // How an HMAC signature is computed (HMAC partners only):
  //   params — hex HMAC of every other parameter, sorted by name and
  //            joined as name=value&name=value (the original scheme)
  //   colon  — hex HMAC of "{user}:{txn}:{payout}" — the user ID,
  //            transaction ID and payout values joined with colons, in
  //            that order (the scheme Offerwall.GG uses).   //   moonetix — HMAC-SHA256 of "{txn}:{user}:{payout}:{status}".
  sigFormat: text("sig_format", { enum: ["params", "colon", "moonetix"] })
    .notNull()
    .default("params"),
  // Units of the partner's payout that make $1 (1 = the payout already
  // arrives in dollars; e.g. 1000 for a partner whose wall prices in
  // 1000 units per $1). Applied after the cents conversion.
  payoutDivisor: real("payout_divisor").notNull().default(1),
  // How the partner proves the callback is genuine:
  //   none        — no check (not recommended for live partners)
  //   secret      — a parameter (secretParam) must equal the secret
  //   hmac_sha1   — a parameter (secretParam) must equal the hex
  //   hmac_sha256   HMAC of every other parameter, sorted by name and
  //                 joined as name=value&name=value, keyed by the secret
  authMethod: text("auth_method", {
    enum: ["none", "secret", "hmac_sha1", "hmac_sha256"],
  })
    .notNull()
    .default("none"),
  // Name of the parameter that carries the secret / signature.
  secretParam: text("secret_param").notNull().default(""),
  secret: text("secret").notNull().default(""),
  active: integer("active").notNull().default(1),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const contestAwards = sqliteTable("contest_awards", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  contest: text("contest", { enum: ["daily", "affiliate"] })
    .notNull()
    .default("daily"),
  periodKey: text("period_key").notNull(),
  userId: integer("user_id").notNull(),
  rank: integer("rank").notNull(),
  amountCents: integer("amount_cents").notNull().default(0),
  // "pending" = winner recorded, waiting for the owner to pay it from
  // Admin → Contest Payouts; "paid" = the owner paid it into the
  // winner's balance. Contest prizes are NEVER paid automatically.
  status: text("status", { enum: ["pending", "paid"] }).notNull().default("paid"),
  releaseAt: integer("release_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});
