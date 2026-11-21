# Deploying TapOne from GitHub

Repo: https://github.com/ahmeetrades-coder/tapone

TapOne is a **server app** (Bun + SQLite), not a static site. GitHub holds
the code; a host runs it. GitHub Pages will **not** work — it cannot run
the Bun server or the SQLite database.

## 1. Push the code to GitHub

You need: a computer with `git` installed and a sign-in to the GitHub
account that owns the repo (`ahmeetrades-coder`).

```sh
git clone https://github.com/ahmeetrades-coder/tapone.git
# Copy into the clone (see README "Files that go into the repo"):
#   client/  server/  drizzle/  vendor/  package.json  bun.lock  bunfig.toml
#   tsconfig.base.json  space.json  README.md  DEPLOY.md
#   .env.example  .gitignore  CNAME
# vendor/ holds the @hatch/space-sdk tarball the app needs to build — the
# SDK is NOT on npm, so it is vendored in the repo (file:./vendor/space-sdk.tgz).
# Do NOT copy: app.db, app.db-wal, app.db-shm, node_modules, .bun-cache,
# .harness, audits, .space-build*, client/dist, server/dist
cd tapone
git add .
git status        # confirm app.db is NOT listed — .gitignore excludes it
git commit -m "TapOne full source"
git push origin main
```

## 2. Pick a host that runs Bun + SQLite

Any of these work; the host must run a long-lived Bun process and keep a
writable persistent disk for the database:

- **FadeHost** (first app free forever, no card, Bun supported, GitHub
  deploy) — the app directory is read-only there, so the database MUST
  live on the persistent disk: set `DATABASE_PATH=/data/app.db`.
- **A VPS** (any Linux box) — install Bun, clone the repo, run the start
  command under a process manager (systemd / pm2), put Nginx/Caddy in
  front for HTTPS.
- A container host that accepts a Bun image and a persistent volume.

## 3. Build and start commands (same on every host)

```sh
bun install
HATCH_SPACES_BUILD_DRIVER=1 bun run build:client   # client -> client/dist/
# NOTE: the env var above is REQUIRED — the SDK's bundler refuses to run
# without it. It only gates the standalone build; it does not touch the
# Hatch artifact. Without it the build fails with "cannot be built by hand".
DATABASE_PATH=/data/app.db bun run start
                                   # standalone server: server/src/server.ts
                                   # listens on the host's PORT env var
```

- The standalone server serves `client/dist/` itself on the **same
  origin** as `POST /actions` — no separate static host or proxy rules
  needed (behind a VPS reverse proxy, forward everything to the Bun
  port).
- First run on an empty disk: the server creates the database at
  `DATABASE_PATH` and applies every `drizzle/` migration itself, in
  filename order. To carry over the existing site instead, copy the
  current `app.db` to the `DATABASE_PATH` location BEFORE first start
  (copy the file directly — never through git); the server recognises
  it as already migrated and all users, balances and settings carry
  over.
- No host cron needed: the server runs the `settleDailyContest` action
  in-process once a day at 00:15 America/Los_Angeles (`SETTLE_TIME` /
  `SETTLE_TZ` env vars change it). It records contest winners only;
  prizes are paid by the owner from Admin → Contest Payouts.

## 4. Configuration checklist (Admin → Settings, or the `settings` table)

Full list with meanings: README → Configuration, and `.env.example`.

1. **Google Client ID** — already in settings. In Google Cloud Console
   for that OAuth client:
   - *Authorized JavaScript origins*: add `https://tapone.store`
   - *Authorized redirect URIs*: add `https://tapone.store/`
   - Publish the OAuth consent screen (while it is in *Testing*, only
     listed test users can sign in).
2. **Admin password** — change it from the first-boot default before the
   site is public (Admin → Settings → "Admin login"). The panel is
   reached via the site address + `#/admin`, or the small RSS icon at
   the end of the footer Follow Us row.
3. **Postback secret** — set one, then give partners the postback
   parameters from Admin → Overview including the secret.
4. Money settings (pools, minimum withdrawal, 70% share, 8%/5%
   affiliate) ship with the defaults in `.env.example`; change only if
   intended.

## 5. Attach the custom domain: tapone.store

The domain is registered at Hostinger; the published site must open on
**tapone.store**, not on the host's default address.

1. **Repo side (done):** the `CNAME` file in the repo root contains the
   single line `tapone.store` — GitHub's custom-domain declaration for
   this repo. Keep it in the push (Step 1).
2. **DNS side (Hostinger):** hPanel → Domains → tapone.store → DNS
   Zone Editor. FadeHost asks for **CNAME records only** (no A record):
   - `CNAME` — name `@` (tapone.store) — value `tapone.fadehost.app`
   - `CNAME` — name `www` (www.tapone.store) — value `tapone.fadehost.app`
   Remove the old records for `@`/`www` that point at Netlify (A @ →
   75.2.60.5, CNAME www → peaceful-faun-19e615.netlify.app), or the
   domain will keep opening the old place. DNS changes can take a few
   hours to spread. If a domain is still "Waiting for DNS" after an
   hour, FadeHost also asks for a TXT record: name
   `_cf-custom-hostname.tapone.store`, value
   `0c787530-66cc-4160-a098-696997e0cc88`.
   *(GitHub Pages variant, for a static page only: `A` records for `@`
   to 185.199.108.153, 185.199.109.153, 185.199.110.153, 185.199.111.153
   and `www` CNAME to `ahmeetrades-coder.github.io`. Pages cannot run
   this app's server — the live site uses the Bun host records above.)*
3. **HTTPS:** enable it on the host (free auto-certificate on DOM
   Cloud / Let's Encrypt behind Nginx/Caddy) — the site must open as
   `https://tapone.store`.
4. **Google OAuth (step 4.1) must match the domain exactly:**
   - Authorized JavaScript origins: `https://tapone.store`
   - Authorized redirect URIs: `https://tapone.store/`
   Without these two entries, Google sign-in fails on the live domain
   even though it worked on the test address.

## 6. Go-live checks

- [ ] Open the site, sign in with Google (a non-test account) — account
      is created, country detected from the sign-in IP.
- [ ] Owner panel opens, admin login works with the NEW password.
- [ ] Send a test postback with a unique `txn_id` — user balance rises
      by 70% of the payout; sending the same `txn_id` again credits
      nothing.
- [ ] Request a small withdrawal and approve it from the panel.
- [ ] Confirm `app.db` is not in the GitHub repo (public repo — user
      data and the admin password live in that file).
