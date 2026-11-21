# TapOne

TapOne is a rewards platform: users sign in with Google, complete offers,
surveys and games from partner offerwalls, earn dollars, join Daily ($100)
and Affiliate ($1,500) contests, invite friends for commission, and cash
out by country (Easypaisa, JazzCash, PayPal, UPI, bank transfer, Binance
USDT, Wise, Payoneer, …). An owner admin panel manages content, users,
withdrawals, contest payouts, countries, withdraw methods and settings.

- **Client:** React 19 + Tailwind CSS v4 (mobile-first, light/dark)
- **Server:** Bun + TypeScript server actions, Drizzle ORM
- **Database:** SQLite (`app.db`), schema applied by the SQL migrations in
  `drizzle/`
- **Sign-in:** Google only (ID token verified server-side against the
  Google Client ID in settings); IP/country is detected at sign-in
  (ipwho.is) and locked to the account; VPN sign-ins are refused
- **Money:** integer cents in the database, dollars in the UI. Offerwall
  postbacks credit the user 70% of the payout and the referrer 8%
  (earning) / 5% (spending) commission.

## Repository

Target repo (already created, public):

    https://github.com/ahmeetrades-coder/tapone

### Files that go into the repo

| Path | What it is |
| --- | --- |
| `client/` | React app — `src/` (App, Dashboard, Admin, lib), `index.html`, `build.mjs`, `tsconfig.json` |
| `server/` | Bun server — `src/actions.ts` (all actions incl. the postback endpoint), `src/server.ts` (standalone entry point for real hosts), `src/schema.ts`, `tsconfig.json` |
| `drizzle/` | SQLite migrations `0001`–`0013`, applied in order to a fresh database |
| `package.json`, `bun.lock` | Dependencies and scripts |
| `bunfig.toml`, `tsconfig.base.json` | Bun + shared TypeScript config |
| `space.json` | App metadata + the daily contest schedule definition |
| `CNAME` | Custom domain for the published site: `tapone.store` |
| `README.md`, `DEPLOY.md`, `.env.example`, `.gitignore` | This documentation |

### Files that must NEVER be committed (see `.gitignore`)

- `app.db`, `app.db-wal`, `app.db-shm` — the live database: real user
  accounts, balances and the admin password. The repo is **public**.
- `node_modules/`, `.bun-cache/` — dependencies (rebuilt by `bun install`)
- `client/dist/`, `server/dist/`, `.space-build*/` — build output
- `.harness/`, `audits/` — build/audit internals

## Quick start

Requires [Bun](https://bun.sh) 1.3+.

```sh
bun install            # install dependencies
HATCH_SPACES_BUILD_DRIVER=1 bun run build:client   # client -> client/dist/ (static bundle)
bun run start          # standalone server: server/src/server.ts
```

The standalone server (`server/src/server.ts`) runs the same actions
module outside the Muse runtime: it listens on `PORT` (injected by the
host; default 3000), dispatches `POST /actions` in the exact envelope
the client sends, serves `client/dist/` on the same origin, and stores
profile pictures under `<DATABASE_PATH>.blobs/`. Configuration is by
environment: `DATABASE_PATH` (default `./app.db` — on FadeHost use
`/data/app.db`, the persistent disk; the app directory there is
read-only), `HOST`, `CLIENT_DIR`. On first run it applies every
`drizzle/` migration that has not run yet, in filename order; a database
copied from the live Muse version is recognised as already migrated,
so users, balances and settings carry over untouched.

The daily `settleDailyContest` job (00:15 America/Los_Angeles,
`SETTLE_TIME`/`SETTLE_TZ` to change) runs in-process on the standalone
server — no host cron needed. It only *records* contest winners — the
owner pays prizes manually from Admin → Contest Payouts. Inside Muse,
`space.json` declares the same schedule.

> **GitHub Pages cannot host this app.** Pages serves static files only;
> TapOne needs the Bun server + SQLite running. Push the code to GitHub,
> then deploy from the repo to a Bun-capable host — see `DEPLOY.md`.

## Configuration

There are no hard-coded secrets in the code. All live configuration sits
in the `settings` table of `app.db` and is edited in **Admin → Settings**
(open the site, then the owner panel). `.env.example` lists the same
values with environment-variable names for hosts that inject config that
way; the names map 1:1 to the settings keys.

| Setting (env name) | Meaning |
| --- | --- |
| `GOOGLE_CLIENT_ID` | Google OAuth Client ID. Sign-in verifies the ID token's audience against this value. Also add the live origin under *Authorized JavaScript origins* and the site URL under *Authorized redirect URIs* in Google Cloud Console, and publish the OAuth app (Testing mode = test users only). |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | Owner panel login. **Change the password before going live.** The password is never shown in the panel or sent to any user client. |
| `POSTBACK_SECRET` | Shared secret offerwall partners must send with each postback. Set it before connecting a live offerwall — while it is empty, postbacks are accepted without a secret. |
| `DAILY_POOL_CENTS` / `AFFILIATE_POOL_CENTS` | Contest pools (default 10000 = $100, 150000 = $1,500). |
| `MIN_WITHDRAW_CENTS` | Minimum withdrawal (default 500 = $5). |
| `USER_SHARE_PCT` | User share of each postback payout (default 70). |
| `AFFILIATE_EARNING_PCT` / `AFFILIATE_SPENDING_PCT` | Referral commissions (default 8 / 5). |
| `CHECKIN_BONUS_CENTS`, `LEVEL_REWARD_CENTS` | Check-in / level reward tuning. |
| `SOCIAL_*` | Footer + Contact-page social links (Discord, X, Telegram, Facebook, YouTube, TikTok, Instagram). Blank = hidden. |

## Offerwall postback

Partners (e.g. MM Wall) call the `postback` action with:

```
network     partner name, e.g. MMWall
user_code   the user's TapOne ID (on their Profile), e.g. TO-AB12CD
payout      gross payout in dollars, e.g. 1.50
txn_id      partner's unique transaction ID (a duplicate ID never credits twice)
secret      required only when POSTBACK_SECRET is set
```

The user is credited `USER_SHARE_PCT`% of `payout`; their referrer gets
the affiliate commissions. Admin → Overview shows the parameter template
to paste into the partner's form.

## Custom domain: tapone.store

The published site runs on the owner's own domain, **tapone.store**
(registered at Hostinger). Three pieces make the domain work:

1. **`CNAME` file** (repo root, already included) — its single line is
   `tapone.store`. This is the custom-domain declaration GitHub reads
   for the repo.
2. **DNS records** — set in the DNS zone of the domain (Hostinger:
   hPanel → Domains → tapone.store → DNS Zone Editor), pointing the
   domain at the host that runs the app:
   - `A` record, name `@`, value = the Bun host's IP address
   - `CNAME` record, name `www`, value = the Bun host's hostname
   (exact values come from the host when you deploy — see DEPLOY.md.
   If a static page is ever served via GitHub Pages, Pages instead
   needs `A` records for `@` to GitHub's Pages IPs 185.199.108.153,
   185.199.109.153, 185.199.110.153, 185.199.111.153 and a `www` CNAME
   to `ahmeetrades-coder.github.io` — but Pages alone cannot run this
   server app.)
3. **Google OAuth** — the TapOne OAuth client must carry the domain, or
   Google sign-in fails on the live site:
   - *Authorized JavaScript origins*: `https://tapone.store`
   - *Authorized redirect URIs*: `https://tapone.store/`
   Enable HTTPS on the host — Google requires the exact HTTPS origin.

## Pushing this code to GitHub

```sh
git clone https://github.com/ahmeetrades-coder/tapone.git
# copy the files listed above into the clone (NOT app.db / node_modules)
cd tapone
git add .
git commit -m "TapOne full source"
git push origin main
```

Pushing needs a GitHub sign-in (the repo owner's account) — it cannot be
done from inside the app. Full deploy steps: `DEPLOY.md`. The owner panel
also has a **GitHub & Deploy** tab with this same checklist and the live
configuration values.

v25 — sections restructure, embedded survey walls, payment logos, admin options (21 Nov 2026).
