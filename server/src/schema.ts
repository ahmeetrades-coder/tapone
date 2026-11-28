// TapOne data model. All money is integer cents; the UI shows dollars only.
//
// users        — one row per account (Google or email +
//                password sign-up); country/IP locked at sign-in
//                (VPN connections are allowed since 2026-11-27 —
//                owner order: a VPN sign-up must create the account;
//                the offerwalls reject such users' offers themselves).
// sessions     — opaque session tokens issued at sign-in
// contentItems — offerwalls / surveys / games the admin manages; every
//                client reads these rows, so admin edits reach everyone
// transactions — the earnings ledger (offer credits, affiliate commissions)
// withdrawals  — user requests the admin approves or rejects
// messages     — help requests and admin mailbox replies (one thread table)
// chatMessages — the public Live Chat inside Help (one shared room)
// chatBlocks   — Live Chat send blocks (permanent or timed); a blocked
//                user can still read the chat, just not send
// postbacks    — offerwall conversion log; txn_id unique = idempotent credit
// settings     — key/value site settings (Google client id, admin login,
//                contest pools, minimum withdrawal)
// redeemCodes  — owner-created redeem codes for the Redeem Code section:
//                code text (unique), dollar amount, max uses, used count,
//                active flag. A code stops working when its max uses are
//                reached or the owner deactivates it.
// redeemRedemptions — one row per successful code redemption: who, which
//                code, how much, when. UNIQUE (code_id, user_id) = one
//                user can redeem the same code only once, ever. The code
//                text is stored on the row too, so the history survives
//                even if the owner later deletes the code itself.
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
  // Email + password accounts only: scrypt hash of the password
  // ("scrypt$v1$<salt hex>$<hash hex>"), null for Google accounts,
  // which never have a password. Never a plain password.
  passwordHash: text("password_hash"),
  // Email + password accounts only: 0 until the owner of the address
  // proves it with the 6-digit code sent to that email. Google
  // accounts are 1 — the provider already verified the
  // address. Default 1 so the existing Google rows stay verified.
  emailVerified: integer("email_verified").notNull().default(1),
  pictureUrl: text("picture_url"),
  // "google" | "email" — how the account was created.
  // Shown in Admin → Users. A later sign-in with another method for
  // the same verified email signs into the SAME account and does not
  // change this label.
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
  // Live Chat manager: the owner can make a user a chat manager from the
  // Admin panel. A manager's chat messages carry a Manager tick, and a
  // manager can also block / unblock chat users. Only the owner can
  // appoint or remove a manager.
  isChatManager: integer("is_chat_manager").notNull().default(0),
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

// email_verifications — one row per 6-digit code sent to an email
// address (email sign-up verification and password reset). The code
// itself is never stored — only its SHA-256 hash — and a row is good
// for 15 minutes and 5 wrong attempts; issuing a new code deletes
// every older row for that email + purpose, so only one code is ever
// live. purpose is "signup" or "reset".
export const emailVerifications = sqliteTable("email_verifications", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  email: text("email").notNull(),
  codeHash: text("code_hash").notNull(),
  purpose: text("purpose", { enum: ["signup", "reset"] })
    .notNull()
    .default("signup"),
  attempts: integer("attempts").notNull().default(0),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
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
  // Generic feed controls (Admin -> Content, per survey/game row).
  // feed_auth_kind: "none" or "bearer" — when "bearer" the server
  // sends `Authorization: Bearer <feed_secret>` when fetching this
  // row's feed. feed_secret is server-only, never sent to clients.
  // feed_category: when set, only raw feed items in that category
  // are listed (e.g. "game" or "survey"); feed_category_mode is
  // "include" (keep only that category) or "exclude" (drop it).
  // Empty feed_category = no category filtering (as before).
  feedAuthKind: text("feed_auth_kind").notNull().default("none"),
  feedSecret: text("feed_secret").notNull().default(""),
  feedCategory: text("feed_category").notNull().default(""),
  feedCategoryMode: text("feed_category_mode").notNull().default("include"),
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
      "affiliate_contest_prize",
      "level_reward",
      "redeem_code",
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

// chat_messages — the public Live Chat inside Help: one shared room for
// all signed-in users. role is "user", "manager" (a user the owner made
// a chat manager) or "owner" (the owner replying from the Admin panel,
// stored with user_id -1). Bodies are plain text, max 1000 chars.
export const chatMessages = sqliteTable("chat_messages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull(),
  role: text("role", { enum: ["user", "manager", "owner"] })
    .notNull()
    .default("user"),
  body: text("body").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// chat_blocks — Live Chat send blocks: one active row per user.
// expires_at null = blocked permanently; set = blocked until that time.
// A blocked user can still READ the chat, just not send. Unblocking
// deletes the row. blocked_by is the admin (-1 = owner) or the manager's
// user id.
export const chatBlocks = sqliteTable("chat_blocks", {
  userId: integer("user_id").primaryKey(),
  blockedBy: integer("blocked_by").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// announcements — the notification bell. Most rows are owner broadcasts
// (userId null): every row is shown to ALL users. kind is "announcement"
// (news, e.g. "withdraw will be late") or "event" (an upcoming event).
// The admin creates, edits and deletes them from Admin → Announcements;
// posting one needs no code change or redeploy — it reaches every user
// immediately. Rows with a userId set are PER-USER notifications, not
// broadcasts: only that one user sees them in their bell. They are
// created server-side only (e.g. a withdraw approve/reject notice from
// adminDecideWithdrawal) and are never listed, edited or deleted from
// the admin Announcements panel.
export const announcements = sqliteTable("announcements", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  kind: text("kind", { enum: ["announcement", "event", "withdrawal"] })
    .notNull()
    .default("announcement"),
  // NULL = broadcast to every user; set = only this user sees it.
  userId: integer("user_id"),
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
  rawJson: text("raw_json").notNull().default("{}"), offerTitle: text("offer_title"), offerImageUrl: text("offer_image_url"), kind: text("kind"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// redeem_codes — owner-created codes for the Redeem Code section
// (replaces Contact Us, owner order 2026-11-27). code is the text the
// user types (stored uppercase, unique); amountCents is the full
// amount credited to the user's balance on redeem — no 70/30 split,
// no affiliate commission, the owner pays it in full. maxUses is how
// many different users may redeem it; usedCount tracks redemptions
// so far. active = 0 deactivates it without deleting its history.
export const redeemCodes = sqliteTable("redeem_codes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  code: text("code").notNull().unique(),
  amountCents: integer("amount_cents").notNull(),
  maxUses: integer("max_uses").notNull(),
  usedCount: integer("used_count").notNull().default(0),
  active: integer("active").notNull().default(1),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// redeem_redemptions — audit trail of every successful redemption.
// UNIQUE (codeId, userId) enforces "one user, one redeem per code" at
// the database level. code is denormalised here so the row still reads
// correctly if the owner deletes the code itself later.
export const redeemRedemptions = sqliteTable("redeem_redemptions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  codeId: integer("code_id").notNull(),
  code: text("code").notNull(),
  userId: integer("user_id").notNull(),
  amountCents: integer("amount_cents").notNull(),
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
  //            that order (the scheme Offerwall.GG uses).
  //   custom — hex HMAC of the admin-typed sig_template, with
  //            {user} {tx} {amount} {status} (or any configured
  //            parameter name in braces) replaced by the values
  //            exactly as received. This is how a future partner
  //            with a new hash order is added from Admin alone.
  sigFormat: text("sig_format", { enum: ["params", "colon", "custom"] })
    .notNull()
    .default("params"),
  // Admin-typed template for sigFormat "custom" (see above). Null
  // for every other format.
  sigTemplate: text("sig_template"),
  // Name of the parameter carrying the conversion status ("" = the
  // partner sends no status). When set, only statusCreditValue
  // credits; any other value the partner actually sends is rejected
  // with no credit and no debit.
  statusParam: text("status_param").notNull().default(""),
  statusCreditValue: text("status_credit_value").notNull().default("1"),
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
  // Salt for signing this partner's wall link per user ("" = the
  // wall link is sent unsigned, as today). Server-only: never sent
  // to the client. When set, listContent appends
  // &<linkHashParam>=HMAC-SHA256(salt, user Offer Token) to the
  // personalised wall URL, so the partner's hash check can stay ON.
  linkHashSalt: text("link_hash_salt").notNull().default(""),
  linkHashParam: text("link_hash_param").notNull().default("hash"),
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

// dailyContestSettlements — one row per settled day of the NEW Daily
// Contest (owner-approved 2026-11-26; NOT the old Leaderboard daily /
// affiliate contests removed 2026-11-22 — those tables above,
// contestJoins / contestPayouts / contestAwards, are dead leftovers
// and this feature deliberately does not use them). day_key is the UTC
// calendar day ("YYYY-MM-DD"); the UNIQUE index on it is the
// idempotency key — a day can be settled at most once, so a redeploy
// or a repeated settle call can never double-pay. winners_json is the
// settled ladder [{ userId, rank, earnedCents, prizeCents }] (the
// audit trail; each prize is also a transactions row of kind
// "contest_prize" so it shows in the winner's History).
export const dailyContestSettlements = sqliteTable(
  "daily_contest_settlements",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    dayKey: text("day_key").notNull(),
    totalCents: integer("total_cents").notNull().default(0),
    winnersJson: text("winners_json").notNull().default("[]"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
);

// affiliateContestSettlements — one row per settled week of the NEW
// Affiliate Contest (owner-approved 2026-11-28). week_key is the UTC
// Monday that starts the week ("YYYY-MM-DD"); the UNIQUE index on it
// is the idempotency key — a week can be settled at most once, so a
// redeploy or a repeated settle call can never double-pay.
// winners_json is the settled ladder
// [{ userId, rank, validInvites, prizeCents }] (the audit trail; each
// prize is also a transactions row of kind
// "affiliate_contest_prize" so it shows in the winner's History).
export const affiliateContestSettlements = sqliteTable(
  "affiliate_contest_settlements",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    weekKey: text("week_key").notNull(),
    totalCents: integer("total_cents").notNull().default(0),
    winnersJson: text("winners_json").notNull().default("[]"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
);

// affiliateWithdrawalCommissions — one row per referral commission
// paid on an approved withdrawal (owner-approved 2026-11-28: the
// inviter earns 8% of an invitee's FIRST approved withdrawal and 5%
// of every later approved withdrawal, for life). withdrawal_id is
// UNIQUE — the idempotency key: an approved withdrawal can pay its
// inviter at most once, so a retry or a repeated approve can never
// double-pay.
export const affiliateWithdrawalCommissions = sqliteTable(
  "affiliate_withdrawal_commissions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    withdrawalId: integer("withdrawal_id").notNull(),
    referrerId: integer("referrer_id").notNull(),
    inviteeId: integer("invitee_id").notNull(),
    pct: integer("pct").notNull(),
    commissionCents: integer("commission_cents").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
);
