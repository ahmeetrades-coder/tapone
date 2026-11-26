import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { actionFields } from "@hatch/space-sdk/fields" with { type: "macro" };
import { api, type ApiResponse } from "./api";
import type { Actions } from "../../server/src/actions";
import {
COUNTRIES,
Icons,
MethodLogo,
flagEmojiFor,
fmt,
fmtDate,
fmtDateTime,
getAdminToken,
getGoogleRedirectUri,
getSiteOrigin,
setAdminToken,
} from "./lib";
import { Wordmark, goHome } from "./App";

const FIELDS = actionFields<typeof Actions>();

type AdminTab = "overview" | "users" | "stats" | "withdrawals" | "methods" | "content" | "inbox" | "notifications" | "announcements" | "countries" | "postbacks" | "callbacks" | "settings" | "deploy";

const ADMIN_TABS: { id: AdminTab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "users", label: "Users" },
  { id: "stats", label: "Challenge Stats" },
  { id: "withdrawals", label: "Withdrawals" },
  { id: "methods", label: "Withdraw Methods" },
  { id: "content", label: "Offerwalls / Surveys / Games" },
  { id: "inbox", label: "Inbox" },
  { id: "notifications", label: "Notifications" },
  { id: "announcements", label: "Announcements" },
  { id: "countries", label: "Countries" },
  { id: "postbacks", label: "Postbacks" },
  { id: "callbacks", label: "Partner Callbacks" },
  { id: "settings", label: "Settings" },
  { id: "deploy", label: "GitHub & Deploy" },
];

function NotifBadge({ token }: { token: string }) {
  const q = useQuery({
    queryKey: ["admin-notifications", token],
    queryFn: () => api.adminListNotifications({ adminToken: token, limit: 100 }),
  });
  if (!q.data || q.data.unreadCount === 0) return null;
  return (
    <span className="ml-1.5 rounded-full bg-[var(--gold)] px-2 py-0.5 text-xs font-bold text-[var(--ink)]">
      {q.data.unreadCount}
    </span>
  );
}

function toCents(dollars: string): number | null {
  const n = Number.parseFloat(dollars);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

export function Admin() {
  const [token, setToken] = useState<string | null>(() => getAdminToken());
  const [tab, setTab] = useState<AdminTab>("overview");

  if (!token) {
    return (
      <AdminLogin
        onLogin={(t) => {
          setAdminToken(t);
          setToken(t);
        }}
      />
    );
  }

  const signOut = () => {
    setAdminToken(null);
    setToken(null);
    // Owner order 2026-11-20: logging out of the panel goes to the
    // public homepage (Start earning now / Sign in), never straight
    // back to the admin login screen.
    goHome();
  };

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text)]">
      <header className="border-b border-[var(--border)] bg-[var(--surface)]">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3.5">
          <span className="flex items-center gap-3">
            <Wordmark />
            <span className="rounded-full bg-[var(--gold)] px-2.5 py-1 text-xs font-bold text-[var(--ink)]">
              OWNER PANEL
            </span>
          </span>
          <button
            type="button"
            onClick={signOut}
            aria-label="Log out of the owner panel"
            className="flex items-center gap-2 rounded-full bg-[var(--brand)] px-5 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-[var(--brand-deep)]"
          >
            {Icons.logout("h-4 w-4")} Logout
          </button>
        </div>
        <nav className="mx-auto flex max-w-6xl gap-1.5 overflow-x-auto px-4 pb-3" aria-label="Admin">
          {ADMIN_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              aria-current={tab === t.id ? "page" : undefined}
              className={`whitespace-nowrap rounded-full px-4 py-2 text-sm font-bold transition ${
                tab === t.id ? "bg-[var(--brand)] text-white" : "bg-[var(--surface-2)] text-[var(--dim)] hover:text-[var(--text)]"
              }`}
            >
              {t.label}
              {t.id === "notifications" && <NotifBadge token={token} />}
            </button>
          ))}
        </nav>
      </header>

      <main className="mx-auto w-full max-w-6xl px-3 py-5 pb-16 sm:px-4 sm:py-6">
        {tab === "overview" && <Overview token={token} onAuthFail={signOut} />}
        {tab === "users" && <UsersTab token={token} />}
        {tab === "stats" && <StatsTab token={token} />}
        {tab === "withdrawals" && <WithdrawalsTab token={token} />}
        {tab === "methods" && <WithdrawMethodsTab token={token} />}
        {tab === "content" && <ContentTab token={token} />}
        {tab === "inbox" && <InboxTab token={token} />}
        {tab === "notifications" && <NotificationsTab token={token} />}
        {tab === "announcements" && <AnnouncementsTab token={token} />}
        {tab === "countries" && <CountriesTab token={token} />}
        {tab === "postbacks" && <PostbacksTab token={token} />}
        {tab === "callbacks" && <PartnerCallbacksTab token={token} />}
        {tab === "settings" && <SettingsTab token={token} />}
        {tab === "deploy" && <DeployTab token={token} />}

        <div className="mt-10 flex justify-center border-t border-[var(--border)] pt-6">
          <button
            type="button"
            onClick={signOut}
            aria-label="Log out of the owner panel"
            className="flex items-center gap-2 rounded-full bg-[var(--brand)] px-6 py-3 text-base font-bold text-white shadow-sm transition hover:bg-[var(--brand-deep)]"
          >
            {Icons.logout("h-5 w-5")} Logout
          </button>
        </div>
      </main>
    </div>
  );
}

function AdminLogin({ onLogin }: { onLogin: (token: string) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const login = useMutation({
    mutationFn: async () => api.adminLogin({ username: username.trim(), password }),
    onSuccess: (r) => onLogin(r.token),
    onError: (e) => setError(e.message),
  });
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--bg)] px-4">
      <form
        className="w-full max-w-sm rounded-3xl bg-[var(--surface)] p-6 text-[var(--text)] shadow-2xl"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          login.mutate();
        }}
      >
        <Wordmark />
        <p className="mt-4 font-display text-xl font-bold">Owner sign in</p>
        <p className="mt-1 text-sm text-[var(--dim)]">This panel is not linked anywhere on the site.</p>
        <div className="mt-5">
          <label htmlFor="adm-user" className="text-sm font-semibold">
            Username
          </label>
          <input
            id="adm-user"
            {...FIELDS.adminLogin.username}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            className="mt-1 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 outline-none focus:border-[var(--brand)]"
          />
        </div>
        <div className="mt-3">
          <label htmlFor="adm-pass" className="text-sm font-semibold">
            Password
          </label>
          <input
            id="adm-pass"
            type="password"
            {...FIELDS.adminLogin.password}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            className="mt-1 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 outline-none focus:border-[var(--brand)]"
          />
        </div>
        {error && (
          <p role="alert" className="mt-3 text-sm font-medium text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={login.isPending}
          className="mt-5 w-full rounded-full bg-[var(--brand)] px-5 py-3 font-display text-base font-bold text-white transition hover:bg-[var(--brand-deep)] disabled:opacity-60"
        >
          {login.isPending ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}

// --------------------------------------------------------------- overview

function Overview({
  token,
  onAuthFail,
}: {
  token: string;
  onAuthFail: () => void;
}) {
  const overview = useQuery({
    queryKey: ["admin-overview", token],
    queryFn: () => api.adminGetOverview({ adminToken: token }),
    retry: false,
  });
  const partnerCallbacks = useQuery({
    queryKey: ["admin-partner-callbacks", token],
    queryFn: () => api.adminListPartnerCallbacks({ adminToken: token }),
  });
  if (overview.isError) {
    onAuthFail();
    return null;
  }
  const stats = overview.data?.stats;
  const cards: [string, string][] = stats
    ? [
        ["Users", String(stats.users)],
        ["Blocked users", String(stats.blockedUsers)],
        ["Pending withdrawals", `${stats.pendingWithdrawals} · ${fmt(stats.pendingCents)}`],
        ["Paid out (approved)", fmt(stats.paidOutCents)],
        ["Credited via postbacks", fmt(stats.creditedCents)],
        ["Unread help messages", String(stats.unreadMessages)],
        ["Live content items", String(stats.contentItems)],
        ["Banned countries", String(stats.bannedCountries)],
        ["New registrations", `${stats.unreadNotifications} new · ${stats.totalNotifications} total`],
      ]
    : [];
  return (
    <div>
      <h1 className="font-display text-2xl font-extrabold">Overview</h1>
      {overview.isPending ? (
        <p className="mt-4 text-sm text-[var(--dim)]">Loading…</p>
      ) : (
        <>
          <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {cards.map(([label, value]) => (
              <div key={label} className="rounded-2xl bg-[var(--surface)] p-4 ring-1 ring-[var(--border)]">
                <p className="font-display text-xl font-extrabold">{value}</p>
                <p className="mt-0.5 text-xs font-semibold text-[var(--dim)]">{label}</p>
              </div>
            ))}
          </div>

          <section className="mt-6 rounded-3xl bg-[var(--surface)] p-5 ring-1 ring-[var(--border)] sm:p-6" aria-label="Postback setup">
            <h2 className="font-display text-lg font-bold">Offerwall postback — give this to partners (e.g. MM Wall)</h2>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[var(--dim)]">
              When a user completes an offer, the partner calls the postback and TapOne
              credits the user <strong className="text-[var(--text)]">70% of the payout</strong> in
              dollars (plus 8% earning commission to their referrer). Each transaction ID
              credits only once. In this workspace the postback is the{" "}
              <code className="font-semibold text-[var(--text)]">postback</code> action with
              these parameters — the same parameters plug into the public site's postback
              URL when it is deployed:
            </p>
            <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
              {[
                ["network", "Partner name, e.g. MM Wall"],
                ["user_code", "The user's TapOne ID (shown on their Profile), e.g. TO-AB12CD"],
                ["payout", "Gross payout in dollars, e.g. 1.50"],
                ["txn_id", "Partner's unique transaction ID (prevents double credit)"],
                ["secret", "Only if a postback secret is set in Settings"],
              ].map(([k, v]) => (
                <div key={k} className="rounded-xl bg-[var(--surface-2)] px-4 py-3">
                  <dt className="font-display font-bold">{k}</dt>
                  <dd className="mt-0.5 text-[var(--dim)]">{v}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-4 rounded-xl bg-[var(--ink)] px-4 py-3 font-mono text-xs leading-relaxed text-[#7ee2b8]">
              postback?network=MMWall&amp;user_code={"{user_id}"}&amp;payout={"{payout}"}&amp;txn_id={"{transaction_id}"}
            </p>

            <h3 className="mt-6 font-display text-base font-bold">TheoremReach callback — paste this into the TheoremReach app</h3>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[var(--dim)]">
              In the TheoremReach publisher dashboard, open the TapOne app and
              set its server-side reward callback to your site address plus
              this path (for example{" "}
              <code className="font-semibold text-[var(--text)]">https://www.tapone.store/theoremreach-callback?...</code>).
              When a user finishes a survey, TheoremReach calls it, TapOne
              checks the signature with the Secret Key from Settings →
              Postback security, and credits the user{" "}
              <strong className="text-[var(--text)]">70% of the reward</strong> —
              the <code className="font-semibold text-[var(--text)]">{"{user_id}"}</code> that
              comes back is the Offer Token from the user&apos;s survey link,
              so the money lands on the right account. Each{" "}
              <code className="font-semibold text-[var(--text)]">{"{tx_id}"}</code> credits
              only once.
            </p>
            <p className="mt-4 rounded-xl bg-[var(--ink)] px-4 py-3 font-mono text-xs leading-relaxed text-[#7ee2b8]">
              theoremreach-callback?user_id={"{user_id}"}&amp;tx_id={"{tx_id}"}&amp;reward={"{reward}"}&amp;reward_amount_in_dollars={"{reward_amount_in_dollars}"}&amp;external_transaction_id={"{external_transaction_id}"}
            </p>

            <h3 className="mt-6 font-display text-base font-bold">Partner callbacks — one address per partner you add</h3>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[var(--dim)]">
              Every partner you set up in the{" "}
              <strong className="text-[var(--text)]">Partner Callbacks</strong> tab gets its
              own callback address below — paste it into that partner&apos;s dashboard and
              its rewards credit the right user <strong className="text-[var(--text)]">70%</strong>,
              exactly like the built-in postbacks, with no code change and no redeploy.
              The parameter names and the secret check are the ones you saved for that
              partner.
            </p>
            {partnerCallbacks.data && partnerCallbacks.data.partners.length > 0 ? (
              <div className="mt-4 space-y-3">
                {partnerCallbacks.data.partners.map((p) => (
                  <div key={p.id}>
                    <p className="text-sm font-bold">
                      {p.name}{" "}
                      <span className="font-semibold text-[var(--dim)]">
                        · {AUTH_METHOD_LABELS[p.authMethod]}
                        {(p.authMethod === "hmac_sha1" || p.authMethod === "hmac_sha256") && (
                          <> ({SIG_FORMAT_LABELS[p.sigFormat]})</>
                        )}
                        {p.active ? "" : " · switched off"}
                      </span>
                    </p>
                    <p className="mt-1 overflow-x-auto rounded-xl bg-[var(--ink)] px-4 py-3 font-mono text-xs leading-relaxed whitespace-nowrap text-[#7ee2b8]">
                      {partnerCallbackUrl(getSiteOrigin(), p)}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-3 text-sm text-[var(--dim)]">
                No partner callbacks set up yet — add the first one in the Partner
                Callbacks tab (for example CPX Research) and its address will appear here.
              </p>
            )}
          </section>
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ deploy

function CopyBlock({ label, text }: { label: string; text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold">{label}</p>
        <button
          type="button"
          aria-label={`Copy ${label}`}
          onClick={() => {
            void navigator.clipboard?.writeText(text).then(() => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 2000);
            });
          }}
          className="rounded-full bg-[var(--surface-2)] px-3.5 py-1.5 text-xs font-bold text-[var(--dim)] transition hover:text-[var(--text)]"
        >
          {copied ? "Copied ✓" : "Copy"}
        </button>
      </div>
      <pre className="mt-1.5 overflow-x-auto rounded-xl bg-[#2b211a] px-4 py-3 font-mono text-xs leading-relaxed whitespace-pre-wrap text-[#ffd9ae]">
        {text}
      </pre>
    </div>
  );
}

function DeployTab({ token }: { token: string }) {
  const info = useQuery({
    queryKey: ["admin-deploy-info", token],
    queryFn: () => api.adminGetDeployInfo({ adminToken: token }),
  });
  const d = info.data;
  const origin = getSiteOrigin();
  const redirectUri = getGoogleRedirectUri();

  const pushFiles: [string, string][] = [
    ["client/", "React app — src (App, Dashboard, Admin), index.html, build.mjs, tsconfig.json"],
    ["server/", "Bun server — src/actions.ts (all actions + postback), src/server.ts (standalone entry point: PORT + DATABASE_PATH + /actions + static client), src/schema.ts, tsconfig.json"],
    ["drizzle/", "SQLite migrations 0001–0013, applied in order on a fresh database"],
    ["package.json + bun.lock", "Dependencies and the install / build / start scripts"],
    ["bunfig.toml + tsconfig.base.json", "Bun and shared TypeScript config"],
    ["space.json", "App metadata"],
    ["CNAME", "Custom domain declaration — the file's single line is tapone.store, so the published site opens on the owner's own domain"],
    ["README.md + DEPLOY.md", "Full source guide and step-by-step deploy instructions (in the repo root)"],
    [".env.example", "Every configuration value a host needs, with names"],
    [".gitignore", "Keeps the live database and build output OUT of the repo"],
  ];
  const neverPush: [string, string][] = [
    ["app.db (+ app.db-wal / app.db-shm)", "LIVE database — real user accounts, balances and the admin password. The repo is public. Excluded by .gitignore."],
    ["node_modules/ + .bun-cache/", "Dependencies — rebuilt by bun install on the host"],
    ["client/dist/ + server/dist/ + .space-build*/", "Build output — rebuilt by bun run build"],
    [".harness/ + audits/", "Authoring-workspace internals, not app code"],
  ];
  const pushCommands = [
    "git clone https://github.com/ahmeetrades-coder/tapone.git",
    "# copy the files listed in Step 1 into the clone — NOT app.db",
    "cd tapone",
    "git add .",
    "git status   # check: app.db must NOT appear",
    'git commit -m "TapOne full source"',
    "git push origin main",
  ].join("\n");
  const hostCommands = [
    "bun install",
    "bun run build:client             # client -> client/dist/",
    "DATABASE_PATH=/data/app.db bun run start   # standalone server (PORT comes from the host)",
    "# The server applies drizzle/ migrations itself on first run and",
    "# Copy the existing app.db to /data/app.db first to keep all users,",
    "# balances and settings (never through git — the repo is public).",
  ].join("\n");

  return (
    <div>
      <h1 className="font-display text-2xl font-extrabold">GitHub &amp; Deploy</h1>
      <p className="mt-2 max-w-3xl text-sm leading-relaxed text-[var(--dim)]">
        The full TapOne source (client + Bun server + SQLite migrations + settings reference) is
        prepared to push to your GitHub repo. The push itself happens from a computer with git and
        your GitHub sign-in — it cannot run from inside this panel — so this tab lists exactly what
        is needed: the files, the commands, and the live configuration values. The same guide ships
        in the repo as <strong className="text-[var(--text)]">README.md</strong> and{" "}
        <strong className="text-[var(--text)]">DEPLOY.md</strong>.
      </p>

      <section className="mt-6 rounded-3xl bg-[var(--surface)] p-5 ring-1 ring-[var(--border)] sm:p-6" aria-label="GitHub repository">
        <h2 className="font-display text-lg font-bold">Your repository</h2>
        {info.isPending ? (
          <p className="mt-3 text-sm text-[var(--dim)]">Loading…</p>
        ) : d ? (
          <>
            <p className="mt-3">
              <a
                href={d.repoUrl}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-sm font-bold break-all text-[var(--brand-deep)] underline"
              >
                {d.repoUrl}
              </a>
            </p>
            <p className="mt-2 text-sm leading-relaxed text-[var(--dim)]">
              The repo exists and is public, currently empty. Nothing has been pushed yet — follow
              the steps below. Because the repo is public, the live database file must never be
              uploaded (Step 1 lists what stays out, and the included{" "}
              <code className="font-semibold text-[var(--text)]">.gitignore</code> blocks it
              automatically).
            </p>
          </>
        ) : (
          <p className="mt-3 text-sm text-[var(--dim)]">Could not load the deploy info — reload the panel and try again.</p>
        )}
      </section>

      <section className="mt-6 rounded-3xl bg-[var(--surface)] p-5 ring-1 ring-[var(--border)] sm:p-6" aria-label="Files to push">
        <h2 className="font-display text-lg font-bold">Step 1 — Files to push</h2>
        <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
          {pushFiles.map(([k, v]) => (
            <div key={k} className="rounded-xl bg-[var(--surface-2)] px-4 py-3">
              <dt className="font-mono font-bold">{k}</dt>
              <dd className="mt-0.5 text-[var(--dim)]">{v}</dd>
            </div>
          ))}
        </dl>
        <h3 className="mt-5 font-display text-base font-bold text-red-600">Never push these</h3>
        <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
          {neverPush.map(([k, v]) => (
            <div key={k} className="rounded-xl bg-[var(--surface-2)] px-4 py-3 ring-1 ring-red-400">
              <dt className="font-mono font-bold">{k}</dt>
              <dd className="mt-0.5 text-[var(--dim)]">{v}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="mt-6 rounded-3xl bg-[var(--surface)] p-5 ring-1 ring-[var(--border)] sm:p-6" aria-label="Commands">
        <h2 className="font-display text-lg font-bold">Step 2 — Commands</h2>
        <p className="mt-2 text-sm leading-relaxed text-[var(--dim)]">
          Push from a computer signed in to GitHub as the repo owner:
        </p>
        <CopyBlock label="Push commands" text={pushCommands} />
        <p className="mt-5 text-sm leading-relaxed text-[var(--dim)]">
          On the host, the app builds and runs with Bun (the host must run Bun + SQLite —{" "}
          <strong className="text-[var(--text)]">GitHub Pages cannot run this app</strong>, it only
          serves static files; deploy from the repo to a Bun host such as DOM Cloud or a VPS):
        </p>
        <CopyBlock label="Install · build · start" text={hostCommands} />
        <p className="mt-3 text-sm leading-relaxed text-[var(--dim)]">
          Serve <code className="font-semibold text-[var(--text)]">client/dist/</code> on the same
          origin as the server. On a fresh disk, create{" "}
          <code className="font-semibold text-[var(--text)]">app.db</code> by applying the{" "}
          <code className="font-semibold text-[var(--text)]">drizzle/</code> migrations in order —
          or copy the existing <code className="font-semibold text-[var(--text)]">app.db</code>{" "}
          file directly (never through git) to carry over users, balances and settings.
        </p>
      </section>

      {d && (
        <section className="mt-6 rounded-3xl bg-[var(--surface)] p-5 ring-1 ring-[var(--border)] sm:p-6" aria-label="Configuration values">
          <h2 className="font-display text-lg font-bold">Step 3 — Configuration the host needs</h2>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-[var(--dim)]">
            TapOne keeps its configuration in the database settings (edited in the Settings tab) —
            there are no secret files to upload.{" "}
            <code className="font-semibold text-[var(--text)]">.env.example</code> in the repo lists
            the same values with environment-variable names. These are the live values right now:
          </p>
          <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
            <div className="rounded-xl bg-[var(--surface-2)] px-4 py-3 sm:col-span-2">
              <dt className="font-display font-bold">GOOGLE_CLIENT_ID</dt>
              <dd className="mt-0.5 font-mono text-xs break-all">{d.googleClientId || "— not set —"}</dd>
              <dd className="mt-1 text-[var(--dim)]">
                In Google Cloud Console add the site's address under Authorized JavaScript
                origins and Authorized redirect URIs, and publish the OAuth app (Testing mode
                allows test users only). For the live domain these are origin{" "}
                <span className="font-mono font-semibold text-[var(--text)]">https://tapone.store</span>{" "}
                and redirect URI{" "}
                <span className="font-mono font-semibold text-[var(--text)]">https://tapone.store/</span>{" "}
                — without them, sign-in fails on tapone.store. This test version's own address:{" "}
                <span className="font-mono font-semibold text-[var(--text)]">{origin}</span> ·
                redirect URI:{" "}
                <span className="font-mono font-semibold text-[var(--text)]">{redirectUri}</span>
              </dd>
            </div>
            <div className="rounded-xl bg-[var(--surface-2)] px-4 py-3">
              <dt className="font-display font-bold">ADMIN_USERNAME</dt>
              <dd className="mt-0.5 font-mono">{d.adminUsername}</dd>
              <dd className="mt-1 text-[var(--dim)]">
                Admin password is set in the Settings tab and is never shown here — change it
                before the site goes public.
              </dd>
            </div>
            <div className="rounded-xl bg-[var(--surface-2)] px-4 py-3">
              <dt className="font-display font-bold">POSTBACK_SECRET</dt>
              <dd className="mt-0.5">
                {d.postbackSecretSet ? (
                  <span className="font-bold text-emerald-600">Set ✓</span>
                ) : (
                  <span className="font-bold text-red-600">NOT SET — set one in Settings before connecting a live offerwall; without it, postbacks are accepted with no secret.</span>
                )}
              </dd>
            </div>
            {(
              [
                ["MIN_WITHDRAW_CENTS", `${fmt(d.minWithdrawCents)} minimum withdrawal`],
                ["USER_SHARE_PCT", `${d.userSharePct}% of each postback payout goes to the user`],
                ["AFFILIATE_EARNING_PCT", `${d.affiliateEarningPct}% referral earning commission`],
                ["AFFILIATE_SPENDING_PCT", `${d.affiliateSpendingPct}% referral spending commission`],
              ] as [string, string][]
            ).map(([k, v]) => (
              <div key={k} className="rounded-xl bg-[var(--surface-2)] px-4 py-3">
                <dt className="font-mono font-bold">{k}</dt>
                <dd className="mt-0.5 text-[var(--dim)]">{v}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      <section className="mt-6 rounded-3xl bg-[var(--surface)] p-5 ring-1 ring-[var(--border)] sm:p-6" aria-label="Custom domain">
        <h2 className="font-display text-lg font-bold">Step 4 — Custom domain: tapone.store</h2>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-[var(--dim)]">
          The published site opens on your own domain <strong className="text-[var(--text)]">tapone.store</strong>{" "}
          (registered at Hostinger), not on the host's default address. Three pieces:
        </p>
        <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
          <div className="rounded-xl bg-[var(--surface-2)] px-4 py-3">
            <dt className="font-mono font-bold">CNAME file (repo root)</dt>
            <dd className="mt-0.5 text-[var(--dim)]">
              Already prepared — one line: <span className="font-mono font-semibold text-[var(--text)]">tapone.store</span>.
              It is GitHub's custom-domain declaration for the repo; keep it in the push (Step 1).
            </dd>
          </div>
          <div className="rounded-xl bg-[var(--surface-2)] px-4 py-3">
            <dt className="font-mono font-bold">DNS records — Hostinger</dt>
            <dd className="mt-0.5 text-[var(--dim)]">
              hPanel → Domains → tapone.store → DNS Zone Editor: an{" "}
              <strong className="text-[var(--text)]">A record</strong> (name{" "}
              <span className="font-mono">@</span>) to the Bun host's IP and a{" "}
              <strong className="text-[var(--text)]">CNAME record</strong> (name{" "}
              <span className="font-mono">www</span>) to the host's hostname — the exact values
              come from the host's custom-domain screen. Delete old @/www records pointing at a
              previous host. Changes can take a few hours to spread.
            </dd>
          </div>
          <div className="rounded-xl bg-[var(--surface-2)] px-4 py-3">
            <dt className="font-mono font-bold">HTTPS</dt>
            <dd className="mt-0.5 text-[var(--dim)]">
              Enable HTTPS on the host so the site opens as{" "}
              <span className="font-mono font-semibold text-[var(--text)]">https://tapone.store</span>{" "}
              — Google sign-in only works on the exact registered HTTPS origin.
            </dd>
          </div>
          <div className="rounded-xl bg-[var(--surface-2)] px-4 py-3">
            <dt className="font-mono font-bold">Google OAuth for the domain</dt>
            <dd className="mt-0.5 text-[var(--dim)]">
              Authorized JavaScript origins:{" "}
              <span className="font-mono font-semibold text-[var(--text)]">https://tapone.store</span>;
              Authorized redirect URIs:{" "}
              <span className="font-mono font-semibold text-[var(--text)]">https://tapone.store/</span>{" "}
              (Step 3). Both must be present or sign-in fails on the live domain.
            </dd>
          </div>
        </dl>
        <p className="mt-3 text-sm leading-relaxed text-[var(--dim)]">
          Note: a <code className="font-semibold text-[var(--text)]">CNAME</code> file + GitHub
          Pages alone would only serve static files — the live app still needs the Bun host from
          Step 2, with the DNS records above pointing tapone.store at that host.
        </p>
      </section>

      <section className="mt-6 rounded-3xl bg-[var(--surface)] p-5 ring-1 ring-[var(--border)] sm:p-6" aria-label="After deploy">
        <h2 className="font-display text-lg font-bold">Step 5 — After deploy</h2>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-relaxed text-[var(--dim)]">
          <li>Attach <strong className="text-[var(--text)]">tapone.store</strong> (Step 4) and confirm the site opens at <strong className="text-[var(--text)]">https://tapone.store</strong>.</li>
          <li>Register <strong className="text-[var(--text)]">https://tapone.store</strong> in Google Cloud Console (origin + redirect URI) and publish the OAuth app.</li>
          <li>Change the admin password in the Settings tab.</li>
          <li>Set a postback secret, then give partners the postback parameters from the Overview tab.</li>
          <li>Test: Google sign-in creates an account, a test postback credits 70% once, a withdrawal approves from the Withdrawals tab.</li>
        </ol>
      </section>
    </div>
  );
}

// ------------------------------------------------------------------ users

function UsersTab({ token }: { token: string }) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [adjustFor, setAdjustFor] = useState<number | null>(null);
  const [adjustAmount, setAdjustAmount] = useState("");
  const [adjustNote, setAdjustNote] = useState("");
  const [countryFor, setCountryFor] = useState<number | null>(null);
  const [countryPick, setCountryPick] = useState("");
  const [rowError, setRowError] = useState<string | null>(null);
  const [rowOk, setRowOk] = useState<string | null>(null);

  const users = useQuery({
    queryKey: ["admin-users", token],
    queryFn: () => api.adminListUsers({ adminToken: token, limit: 200 }),
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["admin-users", token] });
    void queryClient.invalidateQueries({ queryKey: ["admin-overview", token] });
  };

  const block = useMutation({
    mutationFn: async (input: { userId: number; blocked: boolean }) =>
      api.adminSetUserBlocked({ adminToken: token, ...input }),
    onSuccess: refresh,
    onError: (e) => setRowError(e.message),
  });

  const adjust = useMutation({
    mutationFn: async (userId: number) => {
      const dollars = Number.parseFloat(adjustAmount);
      if (!Number.isFinite(dollars) || dollars === 0)
        throw new Error("Enter an amount (use a minus sign to debit).");
      return api.adminAdjustBalance({
        adminToken: token,
        userId,
        amountCents: Math.round(dollars * 100),
        note: adjustNote.trim() || "Admin adjustment",
      });
    },
    onSuccess: () => {
      setRowOk("Balance updated — it is already in the user's history.");
      setAdjustFor(null);
      setAdjustAmount("");
      setAdjustNote("");
      refresh();
    },
    onError: (e) => setRowError(e.message),
  });

  const fixCountry = useMutation({
    mutationFn: async (userId: number) => {
      const country = COUNTRIES.find((c) => c.code === countryPick);
      if (!country) throw new Error("Pick the correct country first.");
      return api.adminSetUserCountry({
        adminToken: token,
        userId,
        countryCode: country.code,
        countryName: country.name,
      });
    },
    onSuccess: () => {
      setRowOk("Country corrected — the user's withdraw methods now follow the new country.");
      setCountryFor(null);
      setCountryPick("");
      refresh();
    },
    onError: (e) => setRowError(e.message),
  });

  const filtered = (users.data?.users ?? []).filter((u) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      u.name.toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q) ||
      u.userCode.toLowerCase().includes(q)
    );
  });

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-extrabold">Users</h1>
        <input
          aria-label="Search users"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, email or ID…"
          className="w-full max-w-xs rounded-full border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-sm outline-none focus:border-[var(--brand)]"
        />
      </div>
      {rowError && (
        <p role="alert" className="mt-3 text-sm font-medium text-red-600 dark:text-red-400">{rowError}</p>
      )}
      {rowOk && (
        <p role="status" className="mt-3 text-sm font-medium text-[var(--brand-deep)] dark:text-[var(--brand)]">{rowOk}</p>
      )}
      {users.isPending ? (
        <p className="mt-4 text-sm text-[var(--dim)]">Loading…</p>
      ) : filtered.length === 0 ? (
        <p className="mt-6 rounded-2xl border-2 border-dashed border-[var(--border)] bg-[var(--surface)] px-5 py-10 text-center text-sm text-[var(--dim)]">
          No users yet. Accounts appear here the moment someone signs in with Google.
        </p>
      ) : (
        <ul className="mt-4 space-y-3">
          {filtered.map((u) => (
            <li key={u.id} className="rounded-2xl bg-[var(--surface)] p-4 ring-1 ring-[var(--border)] sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  {u.pictureUrl ? (
                    <img src={u.pictureUrl} alt="" className="h-11 w-11 rounded-full object-cover" />
                  ) : (
                    <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--avatar)] font-display text-lg font-extrabold text-white">
                      {u.name.charAt(0).toUpperCase()}
                    </span>
                  )}
                  <div>
                    <p className="font-display font-bold">
                      {u.name}{" "}
                      {u.blocked && (
                        <span className="ml-1 rounded-full bg-red-500/10 px-2 py-0.5 text-xs font-bold text-red-600 dark:text-red-400">
                          BLOCKED
                        </span>
                      )}
                    </p>
                    <p className="text-sm text-[var(--dim)]">{u.email}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-display text-lg font-extrabold">{fmt(u.balanceCents)}</p>
                  <p className="text-xs text-[var(--dim)]">earned {fmt(u.totalEarnedCents)}</p>
                </div>
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-4">
                {[
                  ["User ID", u.userCode],
                  ["Offer Token", u.offerToken],
                  ["Level", `Level ${u.level}`],
                  ["Country", `${u.flagEmoji ?? "🌍"} ${u.countryName ?? "—"}`],
                  ["IP address", u.ip ?? "—"],
                  ["ISP", u.isp ?? "—"],
                  ["Login method", "Google"],
                  ["Referral code", u.referralCode],
                  ["Invited by", u.referredByCode ?? "—"],
                  ["Joined", fmtDate(u.createdAt)],
                  ["Last seen", fmtDateTime(u.lastSeenAt)],
                ].map(([k, v]) => (
                  <div key={k}>
                    <dt className="font-semibold uppercase tracking-wide text-[var(--dim)]">{k}</dt>
                    <dd className="mt-0.5 break-all font-semibold">{v}</dd>
                  </div>
                ))}
              </dl>
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setRowError(null);
                    block.mutate({ userId: u.id, blocked: !u.blocked });
                  }}
                  className={`flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-bold ${
                    u.blocked
                      ? "bg-[var(--brand)]/15 text-[var(--brand-deep)] dark:text-[var(--brand)]"
                      : "bg-red-500/10 text-red-600 dark:text-red-400"
                  }`}
                >
                  {Icons.ban("h-4 w-4")} {u.blocked ? "Unblock account" : "Block account"}
                </button>
                <button
                  type="button"
                  onClick={() => setAdjustFor(adjustFor === u.id ? null : u.id)}
                  className="flex items-center gap-1.5 rounded-full bg-[var(--surface-2)] px-4 py-2 text-sm font-bold"
                >
                  {Icons.dollar("h-4 w-4")} Adjust balance
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCountryFor(countryFor === u.id ? null : u.id);
                    setCountryPick(u.countryCode ?? "");
                  }}
                  className="flex items-center gap-1.5 rounded-full bg-[var(--surface-2)] px-4 py-2 text-sm font-bold"
                >
                  {Icons.globe("h-4 w-4")} Fix country
                </button>
              </div>
              {countryFor === u.id && (
                <form
                  className="mt-3 flex flex-col gap-2 rounded-xl bg-[var(--surface-2)] p-3 sm:flex-row sm:items-end"
                  onSubmit={(e) => {
                    e.preventDefault();
                    setRowError(null);
                    setRowOk(null);
                    fixCountry.mutate(u.id);
                  }}
                >
                  <div className="flex-1">
                    <label htmlFor={`fix-country-${u.id}`} className="text-xs font-semibold text-[var(--dim)]">
                      Account country — set at sign-up from the login IP and locked since.
                      Use this when the sign-up connection resolved to the wrong country;
                      the user's withdraw methods follow it at once.
                    </label>
                    <select
                      id={`fix-country-${u.id}`}
                      value={countryPick}
                      onChange={(e) => setCountryPick(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:border-[var(--brand)]"
                    >
                      <option value="">Pick the correct country…</option>
                      {COUNTRIES.map((c) => (
                        <option key={c.code} value={c.code}>
                          {flagEmojiFor(c.code)} {c.name} ({c.code})
                        </option>
                      ))}
                    </select>
                  </div>
                  <button
                    type="submit"
                    disabled={fixCountry.isPending || !countryPick}
                    className="rounded-full bg-[var(--brand)] px-4 py-2 text-sm font-bold text-white disabled:opacity-60"
                  >
                    {fixCountry.isPending ? "Saving…" : "Save country"}
                  </button>
                </form>
              )}
              {adjustFor === u.id && (
                <form
                  className="mt-3 flex flex-col gap-2 rounded-xl bg-[var(--surface-2)] p-3 sm:flex-row"
                  onSubmit={(e) => {
                    e.preventDefault();
                    setRowError(null);
                    setRowOk(null);
                    adjust.mutate(u.id);
                  }}
                >
                  <input
                    aria-label="Adjustment amount in dollars"
                    value={adjustAmount}
                    onChange={(e) => setAdjustAmount(e.target.value)}
                    inputMode="decimal"
                    placeholder="Amount $ (e.g. 5 or -2.50)"
                    className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:border-[var(--brand)]"
                  />
                  <input
                    aria-label="Adjustment note"
                    {...FIELDS.adminAdjustBalance.note}
                    value={adjustNote}
                    onChange={(e) => setAdjustNote(e.target.value)}
                    placeholder="Note (shows in user history)"
                    className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:border-[var(--brand)]"
                  />
                  <button
                    type="submit"
                    disabled={adjust.isPending}
                    className="rounded-full bg-[var(--brand)] px-4 py-2 text-sm font-bold text-white disabled:opacity-60"
                  >
                    Apply
                  </button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ------------------------------------------------------------- withdrawals


function WithdrawalsTab({ token }: { token: string }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<"pending" | "approved" | "rejected" | "all">("pending");
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);

  const list = useQuery({
    queryKey: ["admin-withdrawals", token, status],
    queryFn: () => api.adminListWithdrawals({ adminToken: token, status, limit: 100 }),
  });

  const decide = useMutation({
    mutationFn: async (input: { id: number; decision: "approved" | "rejected" }) =>
      api.adminDecideWithdrawal({
        adminToken: token,
        withdrawalId: input.id,
        decision: input.decision,
        note: notes[input.id]?.trim() ?? "",
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin-withdrawals", token] });
      void queryClient.invalidateQueries({ queryKey: ["admin-overview", token] });
    },
    onError: (e) => setError(e.message),
  });

  return (
    <div>
      <h1 className="font-display text-2xl font-extrabold">Withdrawals</h1>
      <p className="mt-1 text-sm text-[var(--dim)]">
        Pay the user first, then Approve — the user sees the new status immediately. Reject
        returns the amount to their balance.
      </p>
      <div className="mt-4 flex flex-wrap gap-2" role="tablist" aria-label="Status filter">
        {(["pending", "approved", "rejected", "all"] as const).map((s) => (
          <button
            key={s}
            type="button"
            role="tab"
            aria-selected={status === s}
            onClick={() => setStatus(s)}
            className={`rounded-full px-4 py-2 text-sm font-bold capitalize ring-1 transition ${
              status === s ? "bg-[var(--brand)] text-white ring-[var(--brand)]" : "bg-[var(--surface)] ring-[var(--border)]"
            }`}
          >
            {s}
          </button>
        ))}
      </div>
      {error && (
        <p role="alert" className="mt-3 text-sm font-medium text-red-600 dark:text-red-400">{error}</p>
      )}
      {list.isPending ? (
        <p className="mt-4 text-sm text-[var(--dim)]">Loading…</p>
      ) : list.data && list.data.withdrawals.length > 0 ? (
        <ul className="mt-4 space-y-3">
          {list.data.withdrawals.map((w) => (
            <li key={w.id} className="rounded-2xl bg-[var(--surface)] p-4 ring-1 ring-[var(--border)] sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-display text-xl font-extrabold">{fmt(w.amountCents)}</p>
                  <p className="mt-0.5 text-sm font-semibold">
                    {w.userName} <span className="font-normal text-[var(--dim)]">({w.userCode} · {w.userEmail})</span>
                  </p>
                  <p className="text-xs text-[var(--dim)]">
                    {w.methodLabel} · Requested {fmtDateTime(w.createdAt)}
                    {w.decidedAt ? ` · Decided ${fmtDateTime(w.decidedAt)}` : ""}
                  </p>
                </div>
                <span
                  className={`rounded-full px-3 py-1 text-xs font-bold ${
                    w.status === "pending"
                      ? "bg-[var(--gold)]/15 text-[#9a6200] dark:text-[var(--gold)]"
                      : w.status === "approved"
                        ? "bg-[var(--brand)]/15 text-[var(--brand-deep)] dark:text-[var(--brand)]"
                        : "bg-red-500/10 text-red-600 dark:text-red-400"
                  }`}
                >
                  {w.status.toUpperCase()}
                </span>
              </div>
              <dl className="mt-3 grid gap-1.5 rounded-xl bg-[var(--surface-2)] px-4 py-3 text-sm sm:grid-cols-2">
                {Object.entries(w.details).map(([k, v]) => (
                  <div key={k} className="flex gap-2">
                    <dt className="font-semibold capitalize text-[var(--dim)]">{k}:</dt>
                    <dd className="break-all font-semibold">{v}</dd>
                  </div>
                ))}
              </dl>
              {w.status === "pending" ? (
                <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                  <input
                    aria-label={`Note for withdrawal ${w.id}`}
                    {...FIELDS.adminDecideWithdrawal.note}
                    value={notes[w.id] ?? ""}
                    onChange={(e) => setNotes((n) => ({ ...n, [w.id]: e.target.value }))}
                    placeholder="Note for the user (optional)"
                    className="flex-1 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm outline-none focus:border-[var(--brand)]"
                  />
                  <button
                    type="button"
                    disabled={decide.isPending}
                    onClick={() => {
                      setError(null);
                      decide.mutate({ id: w.id, decision: "approved" });
                    }}
                    className="flex items-center justify-center gap-1.5 rounded-full bg-[var(--brand)] px-5 py-2.5 text-sm font-bold text-white disabled:opacity-60"
                  >
                    {Icons.check("h-4 w-4")} Approve
                  </button>
                  <button
                    type="button"
                    disabled={decide.isPending}
                    onClick={() => {
                      setError(null);
                      decide.mutate({ id: w.id, decision: "rejected" });
                    }}
                    className="flex items-center justify-center gap-1.5 rounded-full bg-red-500/10 px-5 py-2.5 text-sm font-bold text-red-600 disabled:opacity-60 dark:text-red-400"
                  >
                    {Icons.x("h-4 w-4")} Reject
                  </button>
                </div>
              ) : (
                w.adminNote && <p className="mt-2 text-sm"><span className="font-semibold">Your note:</span> {w.adminNote}</p>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-6 rounded-2xl border-2 border-dashed border-[var(--border)] bg-[var(--surface)] px-5 py-10 text-center text-sm text-[var(--dim)]">
          No {status === "all" ? "" : status} withdrawals.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- content

type ContentItemData = ApiResponse<typeof api, "adminListContent">["items"][number];

interface ContentForm {
  id?: number;
  kind: "offerwall" | "survey" | "game";
  title: string;
  provider: string;
  description: string;
  rewardDollars: string;
  url: string;
  feedUrl: string;
  feedAuthKind: "none" | "bearer";
  feedSecret: string;
  feedCategory: string;
  feedCategoryMode: "include" | "exclude";
  imageUrl: string;
  badge: string;
  platform: "android" | "ios" | "both";
  milestonesText: string;
  countries: string;
  featured: boolean;
  active: boolean;
  sortOrder: string;
}

const EMPTY_FORM: ContentForm = {
  kind: "offerwall",
  title: "",
  provider: "",
  description: "",
  rewardDollars: "",
  url: "",
  feedUrl: "",
  feedAuthKind: "none",
  feedSecret: "",
  feedCategory: "",
  feedCategoryMode: "include",
  imageUrl: "",
  badge: "",
  platform: "android",
  milestonesText: "",
  countries: "ALL",
  featured: false,
  active: true,
  sortOrder: "0",
};

function WithdrawMethodsTab({ token }: { token: string }) {
  const queryClient = useQueryClient();
  const [countryCode, setCountryCode] = useState("");
  const [label, setLabel] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [fieldLabels, setFieldLabels] = useState<string[]>([""]);
  const [editing, setEditing] = useState<{
    id: number;
    label: string;
    imageUrl: string;
    fieldLabels: string[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const inputCls =
    "w-full rounded-xl bg-[var(--surface)] px-3.5 py-2.5 text-sm font-semibold ring-1 ring-[var(--border)] outline-none focus:ring-[var(--brand)]";

  const list = useQuery({
    queryKey: ["admin-withdraw-methods", token],
    queryFn: () => api.adminListWithdrawMethods({ adminToken: token }),
  });

  const invalidate = () =>
    void queryClient.invalidateQueries({ queryKey: ["admin-withdraw-methods", token] });

  const add = useMutation({
    mutationFn: async () => {
      const country = COUNTRIES.find((c) => c.code === countryCode);
      const usedKeys = new Set<string>();
      const fields = fieldLabels
        .map((f) => f.trim())
        .filter(Boolean)
        .map((f, i) => {
          let key =
            f
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, "_")
              .replace(/^_+|_+$/g, "")
              .slice(0, 30) || `field${i + 1}`;
          if (!/^[a-z]/.test(key)) key = `f_${key}`;
          while (usedKeys.has(key)) key = `${key}_x`;
          usedKeys.add(key);
          return { key, label: f };
        });
      return api.adminAddWithdrawMethod({
        adminToken: token,
        countryCode,
        countryName: country?.name ?? countryCode,
        label: label.trim(),
        imageUrl: imageUrl.trim() || undefined,
        fields,
      });
    },
    onSuccess: () => {
      setNotice(
        `"${label.trim()}" added — it now shows on the Withdraw page of every user from the picked country.`,
      );
      setLabel("");
      setImageUrl("");
      setFieldLabels([""]);
      setError(null);
      invalidate();
    },
    onError: (e) => setError(e.message),
  });

  const update = useMutation({
    mutationFn: async () => {
      if (!editing) throw new Error("Nothing is being edited.");
      const usedKeys = new Set<string>();
      const fields = editing.fieldLabels
        .map((f) => f.trim())
        .filter(Boolean)
        .map((f, i) => {
          let key =
            f
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, "_")
              .replace(/^_+|_+$/g, "")
              .slice(0, 30) || `field${i + 1}`;
          if (!/^[a-z]/.test(key)) key = `f_${key}`;
          while (usedKeys.has(key)) key = `${key}_x`;
          usedKeys.add(key);
          return { key, label: f };
        });
      if (!editing.label.trim())
        throw new Error("Give the method a name.");
      if (fields.length === 0)
        throw new Error("Add at least one detail field.");
      return api.adminUpdateWithdrawMethod({
        adminToken: token,
        id: editing.id,
        label: editing.label.trim(),
        imageUrl: editing.imageUrl.trim() || null,
        fields,
      });
    },
    onSuccess: () => {
      setNotice("Method updated — the change shows on users' Withdraw pages right away.");
      setEditing(null);
      setError(null);
      invalidate();
    },
    onError: (e) => setError(e.message),
  });

  const remove = useMutation({
    mutationFn: async (input: { id: number }) =>
      api.adminRemoveWithdrawMethod({ adminToken: token, id: input.id }),
    onSuccess: () => {
      setNotice("Method removed — it no longer shows to that country's users.");
      invalidate();
    },
    onError: (e) => setError(e.message),
  });

  // Built-in per-country sets: the owner's ticked method ids per group,
  // seeded from the server's effective sets whenever they reload. A
  // Save writes the override to site settings — it applies to every
  // user of that country at once, no redeploy.
  const [builtinEdits, setBuiltinEdits] = useState<Record<string, string[]>>({});
  useEffect(() => {
    if (!list.data) return;
    setBuiltinEdits(
      Object.fromEntries(
        list.data.builtIns.map((g) => [g.countryCode, g.methods.map((m) => m.id)]),
      ),
    );
  }, [list.data]);

  const saveBuiltins = useMutation({
    mutationFn: async (input: { countryCode: string; methodIds: string[] }) =>
      api.adminSetBuiltinWithdrawMethods({
        adminToken: token,
        groups: [input],
        resetGroups: [],
      }),
    onSuccess: (_data, input) => {
      setNotice(
        `Built-in methods for ${input.countryCode} saved — every user from that country sees the new set on their Withdraw page right away.`,
      );
      setError(null);
      invalidate();
    },
    onError: (e) => setError(e.message),
  });

  const resetBuiltins = useMutation({
    mutationFn: async (input: { countryCode: string }) =>
      api.adminSetBuiltinWithdrawMethods({
        adminToken: token,
        groups: [],
        resetGroups: [input.countryCode],
      }),
    onSuccess: (_data, input) => {
      setNotice(`Built-in methods for ${input.countryCode} are back to the site defaults.`);
      setError(null);
      invalidate();
    },
    onError: (e) => setError(e.message),
  });

  const submit = () => {
    if (!countryCode) {
      setError("Pick a country first.");
      return;
    }
    if (!label.trim()) {
      setError("Give the method a name, e.g. Alipay.");
      return;
    }
    if (fieldLabels.every((f) => !f.trim())) {
      setError("Add at least one detail field — what the user must type when withdrawing, e.g. Alipay account.");
      return;
    }
    setError(null);
    add.mutate();
  };

  const groups = new Map<string, NonNullable<typeof list.data>["methods"]>();
  for (const m of list.data?.methods ?? []) {
    const g = groups.get(m.countryCode) ?? [];
    g.push(m);
    groups.set(m.countryCode, g);
  }

  return (
    <div>
      <h1 className="font-display text-2xl font-extrabold">Withdraw Methods</h1>
      <p className="mt-1 max-w-xl text-sm text-[var(--dim)]">
        Every withdraw method is listed on this page: the built-in methods
        for each country first, then the extra methods you add. Add a payment
        method for a country and it appears on the Withdraw page of{" "}
        <strong className="text-[var(--text)]">every user whose login country is that country</strong>,
        next to that country's built-in methods.
      </p>
      {error && (
        <p role="alert" className="mt-3 text-sm font-medium text-red-600 dark:text-red-400">{error}</p>
      )}
      {notice && (
        <p role="status" className="mt-3 text-sm font-semibold text-[var(--brand-deep)] dark:text-[var(--brand)]">{notice}</p>
      )}

      <section className="mt-5 rounded-2xl bg-[var(--surface)] p-4 ring-1 ring-[var(--border)] sm:p-5" aria-label="Add a withdraw method">
        <h2 className="font-display text-base font-extrabold">Add a method</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="wm-country" className="text-sm font-semibold">Country</label>
            <select
              id="wm-country"
              value={countryCode}
              onChange={(e) => setCountryCode(e.target.value)}
              className={inputCls}
            >
              <option value="">Pick a country…</option>
              {COUNTRIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {flagEmojiFor(c.code)} {c.name} ({c.code})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="wm-label" className="text-sm font-semibold">Method name</label>
            <input
              id="wm-label"
              {...FIELDS.adminAddWithdrawMethod.label}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              className={inputCls}
              placeholder="e.g. Alipay"
            />
          </div>
          <div>
            <label htmlFor="wm-image" className="text-sm font-semibold">Logo image link <span className="font-normal text-[var(--dim)]">(optional)</span></label>
            <input
              id="wm-image"
              {...FIELDS.adminAddWithdrawMethod.imageUrl}
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
              className={inputCls}
              placeholder="https://… logo image URL"
              inputMode="url"
            />
            <p className="mt-1 text-xs text-[var(--dim)]">
              Shown next to the method's name on the Withdraw page, like the
              built-in methods' logos.
            </p>
          </div>
        </div>
        <div className="mt-3">
          <p className="text-sm font-semibold">Details the user must fill in</p>
          <p className="mt-0.5 text-xs text-[var(--dim)]">
            One field per line — all are required when the user withdraws with this method.
          </p>
          <div className="mt-2 space-y-2">
            {fieldLabels.map((f, i) => (
              <div key={i} className="flex gap-2">
                <input
                  aria-label={`Detail field ${i + 1}`}
                  {...FIELDS.adminAddWithdrawMethod.fields.label}
                  value={f}
                  onChange={(e) =>
                    setFieldLabels((prev) => prev.map((x, j) => (j === i ? e.target.value : x)))
                  }
                  className={inputCls}
                  placeholder={i === 0 ? "e.g. Alipay account / email" : "e.g. Account holder name"}
                />
                {fieldLabels.length > 1 && (
                  <button
                    type="button"
                    aria-label={`Remove detail field ${i + 1}`}
                    onClick={() => setFieldLabels((prev) => prev.filter((_, j) => j !== i))}
                    className="shrink-0 rounded-xl px-3 text-sm font-bold text-red-600 ring-1 ring-[var(--border)] dark:text-red-400"
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
          </div>
          {fieldLabels.length < 5 && (
            <button
              type="button"
              onClick={() => setFieldLabels((prev) => [...prev, ""])}
              className="mt-2 rounded-full px-4 py-2 text-sm font-bold ring-1 ring-[var(--border)]"
            >
              + Add another field
            </button>
          )}
        </div>
        <button
          type="button"
          disabled={add.isPending}
          onClick={submit}
          className="mt-4 rounded-full bg-[var(--brand)] px-6 py-2.5 text-sm font-bold text-white transition hover:bg-[var(--brand-deep)] disabled:opacity-60"
        >
          {add.isPending ? "Adding…" : "Add method"}
        </button>
      </section>

      <h2 className="mt-8 font-display text-lg font-bold">Built-in methods — set per country</h2>
      <p className="mt-1 max-w-xl text-sm text-[var(--dim)]">
        Tick which built-in methods each country gets, then Save. The change
        applies at once to <strong className="text-[var(--text)]">every user whose account country matches</strong> —
        no redeploy, nothing else to publish. Every country must keep at
        least one method ticked.
      </p>
      {list.isPending ? (
        <p className="mt-3 text-sm text-[var(--dim)]">Loading…</p>
      ) : (
        <div className="mt-3 space-y-3">
          {(list.data?.builtIns ?? []).map((g) => {
            const picked = builtinEdits[g.countryCode] ?? g.methods.map((m) => m.id);
            const serverIds = g.methods.map((m) => m.id);
            const dirty =
              picked.length !== serverIds.length ||
              picked.some((id) => !serverIds.includes(id));
            return (
              <div key={g.countryCode} className="rounded-2xl bg-[var(--surface)] p-4 ring-1 ring-[var(--border)] sm:p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-display text-base font-extrabold">
                    {g.countryCode === "DEFAULT" ? "🌍" : flagEmojiFor(g.countryCode)} {g.countryName}{" "}
                    <span className="text-sm font-bold text-[var(--dim)]">({g.countryCode})</span>
                  </p>
                  {g.overridden && (
                    <span className="rounded-full bg-[var(--brand)]/15 px-3 py-1 text-xs font-bold text-[var(--brand-deep)] ring-1 ring-[var(--border)] dark:text-[var(--brand)]">
                      Customised by you
                    </span>
                  )}
                </div>
                <ul className="mt-2 divide-y divide-[var(--border)]">
                  {(list.data?.catalogue ?? []).map((m) => {
                    const on = picked.includes(m.id);
                    return (
                      <li key={m.id} className="py-1.5">
                        <label className="flex cursor-pointer flex-wrap items-center gap-3 py-1">
                          <input
                            type="checkbox"
                            checked={on}
                            aria-label={`${m.label} for ${g.countryName}`}
                            onChange={(e) =>
                              setBuiltinEdits((prev) => ({
                                ...prev,
                                [g.countryCode]: e.target.checked
                                  ? [...(prev[g.countryCode] ?? serverIds), m.id]
                                  : (prev[g.countryCode] ?? serverIds).filter((id) => id !== m.id),
                              }))
                            }
                            className="h-5 w-5 shrink-0 accent-[var(--brand)]"
                          />
                          <MethodLogo methodId={m.id} imageUrl={m.imageUrl} label={m.label} />
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-semibold">{m.label}</span>
                            <span className="block text-xs text-[var(--dim)]">
                              Asks for: {m.fields.map((f) => f.label).join(" · ")}
                            </span>
                          </span>
                          <span className={`rounded-full px-3 py-1 text-xs font-bold ring-1 ring-[var(--border)] ${on ? "bg-[var(--brand)] text-white" : "bg-[var(--surface-2)] text-[var(--dim)]"}`}>
                            {on ? "Shown" : "Hidden"}
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={!dirty || picked.length === 0 || saveBuiltins.isPending}
                    onClick={() =>
                      saveBuiltins.mutate({ countryCode: g.countryCode, methodIds: picked })
                    }
                    className="rounded-full bg-[var(--brand)] px-5 py-2 text-sm font-bold text-white transition hover:bg-[var(--brand-deep)] disabled:opacity-50"
                  >
                    {saveBuiltins.isPending ? "Saving…" : `Save ${g.countryName} methods`}
                  </button>
                  {picked.length === 0 && (
                    <span className="text-xs font-semibold text-red-600 dark:text-red-400">
                      Tick at least one method before saving.
                    </span>
                  )}
                  {g.overridden && (
                    <button
                      type="button"
                      disabled={resetBuiltins.isPending}
                      onClick={() => resetBuiltins.mutate({ countryCode: g.countryCode })}
                      className="rounded-full px-4 py-2 text-sm font-bold ring-1 ring-[var(--border)] transition hover:ring-[var(--brand)] disabled:opacity-60"
                    >
                      Reset to site defaults
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <h2 className="mt-8 font-display text-lg font-bold">Added methods</h2>
      {list.isPending ? (
        <p className="mt-3 text-sm text-[var(--dim)]">Loading…</p>
      ) : groups.size > 0 ? (
        <div className="mt-3 space-y-3">
          {[...groups.entries()].map(([code, methods]) => (
            <div key={code} className="rounded-2xl bg-[var(--surface)] p-4 ring-1 ring-[var(--border)] sm:p-5">
              <p className="font-display text-base font-extrabold">
                {flagEmojiFor(code)} {methods[0]?.countryName || code}{" "}
                <span className="text-sm font-bold text-[var(--dim)]">({code})</span>
              </p>
              <ul className="mt-2 divide-y divide-[var(--border)]">
                {methods.map((m) => (
                  <li key={m.id} className="py-2.5">
                    <div className="flex flex-wrap items-center gap-3">
                      <MethodLogo methodId={`custom_${m.id}`} imageUrl={m.imageUrl} label={m.label} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold">{m.label}</span>
                        <span className="block text-xs text-[var(--dim)]">
                          Asks for: {m.fields.map((f) => f.label).join(" · ")}
                        </span>
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setEditing({
                            id: m.id,
                            label: m.label,
                            imageUrl: m.imageUrl ?? "",
                            fieldLabels: m.fields.map((f) => f.label),
                          })
                        }
                        className="rounded-full px-4 py-1.5 text-xs font-bold ring-1 ring-[var(--border)] transition hover:ring-[var(--brand)]"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        disabled={remove.isPending}
                        onClick={() => remove.mutate({ id: m.id })}
                        className="rounded-full px-4 py-1.5 text-xs font-bold text-red-600 ring-1 ring-[var(--border)] transition hover:bg-red-500/10 disabled:opacity-60 dark:text-red-400"
                      >
                        Remove
                      </button>
                    </div>
                    {editing?.id === m.id && (
                      <div className="mt-3 rounded-xl bg-[var(--surface-2)] p-3 ring-1 ring-[var(--border)]">
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div>
                            <label htmlFor={`wm-edit-label-${m.id}`} className="text-sm font-semibold">Method name</label>
                            <input
                              id={`wm-edit-label-${m.id}`}
                              {...FIELDS.adminUpdateWithdrawMethod.label}
                              value={editing.label}
                              onChange={(e) => setEditing({ ...editing, label: e.target.value })}
                              className={inputCls}
                            />
                          </div>
                          <div>
                            <label htmlFor={`wm-edit-image-${m.id}`} className="text-sm font-semibold">Logo image link <span className="font-normal text-[var(--dim)]">(blank = no logo)</span></label>
                            <input
                              id={`wm-edit-image-${m.id}`}
                              {...FIELDS.adminUpdateWithdrawMethod.imageUrl}
                              value={editing.imageUrl}
                              onChange={(e) => setEditing({ ...editing, imageUrl: e.target.value })}
                              className={inputCls}
                              placeholder="https://… logo image URL"
                              inputMode="url"
                            />
                          </div>
                        </div>
                        <p className="mt-3 text-sm font-semibold">Details the user must fill in</p>
                        <div className="mt-2 space-y-2">
                          {editing.fieldLabels.map((f, i) => (
                            <div key={i} className="flex gap-2">
                              <input
                                aria-label={`Edit detail field ${i + 1}`}
                                {...FIELDS.adminUpdateWithdrawMethod.fields.label}
                                value={f}
                                onChange={(e) =>
                                  setEditing({
                                    ...editing,
                                    fieldLabels: editing.fieldLabels.map((x, j) => (j === i ? e.target.value : x)),
                                  })
                                }
                                className={inputCls}
                              />
                              {editing.fieldLabels.length > 1 && (
                                <button
                                  type="button"
                                  aria-label={`Remove edit detail field ${i + 1}`}
                                  onClick={() =>
                                    setEditing({
                                      ...editing,
                                      fieldLabels: editing.fieldLabels.filter((_, j) => j !== i),
                                    })
                                  }
                                  className="shrink-0 rounded-xl px-3 text-sm font-bold text-red-600 ring-1 ring-[var(--border)] dark:text-red-400"
                                >
                                  ✕
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                        {editing.fieldLabels.length < 5 && (
                          <button
                            type="button"
                            onClick={() =>
                              setEditing({ ...editing, fieldLabels: [...editing.fieldLabels, ""] })
                            }
                            className="mt-2 rounded-full px-4 py-2 text-sm font-bold ring-1 ring-[var(--border)]"
                          >
                            + Add another field
                          </button>
                        )}
                        <div className="mt-3 flex flex-wrap gap-2">
                          <button
                            type="button"
                            disabled={update.isPending}
                            onClick={() => { setError(null); update.mutate(); }}
                            className="rounded-full bg-[var(--brand)] px-5 py-2 text-sm font-bold text-white transition hover:bg-[var(--brand-deep)] disabled:opacity-60"
                          >
                            {update.isPending ? "Saving…" : "Save changes"}
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditing(null)}
                            className="rounded-full px-5 py-2 text-sm font-bold ring-1 ring-[var(--border)]"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-2 text-sm text-[var(--dim)]">
          No added methods yet. Pick a country above and add the first one.
        </p>
      )}
    </div>
  );
}

function ContentTab({ token }: { token: string }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<ContentForm | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
  const [kindFilter, setKindFilter] = useState<"all" | ContentForm["kind"]>("all");

  const list = useQuery({
    queryKey: ["admin-content", token],
    queryFn: () => api.adminListContent({ adminToken: token }),
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["admin-content", token] });
    void queryClient.invalidateQueries({ queryKey: ["public-home"] });
  };

  const save = useMutation({
    mutationFn: async (f: ContentForm) => {
      const rewardCents =
        f.rewardDollars.trim() === "" ? null : toCents(f.rewardDollars.trim());
      if (f.rewardDollars.trim() !== "" && rewardCents === null)
        throw new Error("Reward must be a valid dollar amount.");
      // Game milestones: one per line, "Event | dollars". They are
      // the popup's EVENT / CASH table and add up to the total
      // payout on the game card.
      const milestones = f.milestonesText
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .map((line) => {
          const at = line.lastIndexOf("|");
          const event = at >= 0 ? line.slice(0, at).trim() : "";
          const cents = at >= 0 ? toCents(line.slice(at + 1).trim()) : null;
          if (!event || cents === null)
            throw new Error(
              `Milestone "${line}" is not in the form: Event | 0.50`,
            );
          return { event, amountCents: cents };
        });
      return api.adminUpsertContent({
        adminToken: token,
        id: f.id,
        kind: f.kind,
        title: f.title.trim(),
        provider: f.provider.trim(),
        description: f.description.trim(),
        rewardCents,
        url: f.url.trim(),
        feedUrl: f.feedUrl.trim() === "" ? null : f.feedUrl.trim(),
        feedAuthKind: f.feedAuthKind,
        feedSecret: f.feedSecret.trim() === "" ? undefined : f.feedSecret.trim(),
        feedCategory: f.feedCategory.trim(),
        feedCategoryMode: f.feedCategoryMode,
        imageUrl: f.imageUrl.trim() === "" ? null : f.imageUrl.trim(),
        badge: f.badge.trim() === "" ? null : f.badge.trim(),
        platform: f.platform,
        milestones,
        countries: f.countries.trim() || "ALL",
        featured: f.featured,
        active: f.active,
        sortOrder: Number.parseInt(f.sortOrder, 10) || 0,
      });
    },
    onSuccess: () => {
      setOkMsg("Saved — it is now live for every user.");
      setForm(null);
      refresh();
    },
    onError: (e) => setError(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: number) => api.adminDeleteContent({ adminToken: token, id }),
    onSuccess: () => {
      setOkMsg("Removed for every user.");
      setConfirmDelete(null);
      refresh();
    },
    onError: (e) => setError(e.message),
  });

  const editForm = (item: ContentItemData): ContentForm => ({
    id: item.id,
    kind: item.kind,
    title: item.title,
    provider: item.provider,
    description: item.description,
    rewardDollars: item.rewardCents != null ? (item.rewardCents / 100).toFixed(2) : "",
    url: item.url,
    feedUrl: item.feedUrl ?? "",
    feedAuthKind: item.feedAuthKind,
    feedSecret: "",
    feedCategory: item.feedCategory,
    feedCategoryMode: item.feedCategoryMode,
    imageUrl: item.imageUrl ?? "",
    badge: item.badge ?? "",
    platform:
      item.platform === "ios" || item.platform === "both"
        ? item.platform
        : "android",
    milestonesText: item.milestones
      .map((m) => `${m.event} | ${(m.amountCents / 100).toFixed(2)}`)
      .join("\n"),
    countries: item.countries,
    featured: item.featured,
    active: item.active,
    sortOrder: String(item.sortOrder),
  });

  const items = (list.data?.items ?? []).filter(
    (i) => kindFilter === "all" || i.kind === kindFilter,
  );
  const kindLabel = { offerwall: "Offerwall", survey: "Survey", game: "Game" } as const;

  const fieldCls =
    "mt-1 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm outline-none focus:border-[var(--brand)]";

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-extrabold">Content</h1>
        <button
          type="button"
          onClick={() => {
            setError(null);
            setOkMsg(null);
            setForm({ ...EMPTY_FORM });
          }}
          className="flex items-center gap-1.5 rounded-full bg-[var(--brand)] px-4 py-2.5 text-sm font-bold text-white"
        >
          {Icons.plus("h-4 w-4")} Add item
        </button>
      </div>
      <p className="mt-1 text-sm text-[var(--dim)]">
        Everything saved here goes live for all users immediately — add an offerwall,
        survey or game when a partner approves it.
      </p>
      <div className="mt-4 flex flex-wrap gap-2" role="tablist" aria-label="Kind filter">
        {(["all", "offerwall", "survey", "game"] as const).map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={kindFilter === k}
            onClick={() => setKindFilter(k)}
            className={`rounded-full px-4 py-2 text-sm font-bold capitalize ring-1 transition ${
              kindFilter === k ? "bg-[var(--brand)] text-white ring-[var(--brand)]" : "bg-[var(--surface)] ring-[var(--border)]"
            }`}
          >
            {k === "all" ? "All" : `${kindLabel[k]}s`}
          </button>
        ))}
      </div>
      {error && (
        <p role="alert" className="mt-3 text-sm font-medium text-red-600 dark:text-red-400">{error}</p>
      )}
      {okMsg && (
        <p role="status" className="mt-3 text-sm font-medium text-[var(--brand-deep)] dark:text-[var(--brand)]">{okMsg}</p>
      )}

      {form && (
        <form
          className="mt-5 rounded-3xl bg-[var(--surface)] p-5 ring-1 ring-[var(--border)] sm:p-6"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            setOkMsg(null);
            if (!form.title.trim()) {
              setError("Title is required.");
              return;
            }
            save.mutate(form);
          }}
        >
          <p className="font-display text-lg font-bold">{form.id ? "Edit item" : "Add item"}</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="ct-kind" className="text-sm font-semibold">Section</label>
              <select
                id="ct-kind"
                value={form.kind}
                onChange={(e) => setForm({ ...form, kind: e.target.value as ContentForm["kind"] })}
                className={fieldCls}
              >
                <option value="offerwall">Offerwall</option>
                <option value="survey">Survey</option>
                <option value="game">Game</option>
              </select>
            </div>
            <div>
              <label htmlFor="ct-title" className="text-sm font-semibold">Title</label>
              <input id="ct-title" {...FIELDS.adminUpsertContent.title} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className={fieldCls} placeholder="e.g. MM Wall" />
            </div>
            <div>
              <label htmlFor="ct-provider" className="text-sm font-semibold">Provider / partner</label>
              <input id="ct-provider" {...FIELDS.adminUpsertContent.provider} value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value })} className={fieldCls} placeholder="e.g. MM Wall, Torox, CPX Research" />
            </div>
            <div>
              <label htmlFor="ct-reward" className="text-sm font-semibold">Reward shown to users ($) <span className="font-normal text-[var(--dim)]">(optional)</span></label>
              <input id="ct-reward" value={form.rewardDollars} onChange={(e) => setForm({ ...form, rewardDollars: e.target.value })} inputMode="decimal" placeholder="e.g. 2.50" className={fieldCls} />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="ct-desc" className="text-sm font-semibold">Description</label>
              <textarea id="ct-desc" {...FIELDS.adminUpsertContent.description} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} className={fieldCls} placeholder="What does the user do to earn?" />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="ct-url" className="text-sm font-semibold">Offer URL <span className="font-normal text-[var(--dim)]">(the partner link, with the user's ID if the partner supports it)</span></label>
              <input id="ct-url" {...FIELDS.adminUpsertContent.url} value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://…" className={fieldCls} />
            </div>
            {(form.kind === "survey" || form.kind === "game") && (
              <div className="sm:col-span-2">
                <label htmlFor="ct-feed" className="text-sm font-semibold">Items feed URL <span className="font-normal text-[var(--dim)]">(optional — the partner's JSON feed of individual {form.kind === "game" ? "games" : "surveys"}; they list automatically in the {form.kind === "game" ? "Games" : "Surveys"} tab, matched to each user)</span></label>
                <input id="ct-feed" {...FIELDS.adminUpsertContent.feedUrl} value={form.feedUrl} onChange={(e) => setForm({ ...form, feedUrl: e.target.value })} placeholder="https://…?user_id={user_id}&ip={ip}&country={country}" className={fieldCls} />
                <p className="mt-1 text-xs leading-relaxed text-[var(--dim)]">
                  Placeholders: {"{user_id}"} = the user's Offer Token, {"{ip}"} = their sign-in IP, {"{country}"} = their country code. Leave empty for partners TapOne already reads directly (TheoremReach, CPX Research, Offerwall.GG games).
                </p>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="ct-feed-auth" className="text-sm font-semibold">Feed auth</label>
                    <select
                      id="ct-feed-auth"
                      value={form.feedAuthKind}
                      onChange={(e) => setForm({ ...form, feedAuthKind: e.target.value as ContentForm["feedAuthKind"] })}
                      className={fieldCls}
                    >
                      <option value="none">None — open feed URL</option>
                      <option value="bearer">Bearer token — send the feed secret below</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="ct-feed-secret" className="text-sm font-semibold">
                      Feed secret{" "}
                      {form.id !== undefined && (
                        <span className="font-normal text-[var(--dim)]">(leave blank to keep the saved one)</span>
                      )}
                    </label>
                    <input id="ct-feed-secret" type="password" autoComplete="off" value={form.feedSecret} onChange={(e) => setForm({ ...form, feedSecret: e.target.value })} className={fieldCls} placeholder="Partner API key for this feed" />
                  </div>
                  <div>
                    <label htmlFor="ct-feed-category" className="text-sm font-semibold">Category filter (optional)</label>
                    <input id="ct-feed-category" value={form.feedCategory} onChange={(e) => setForm({ ...form, feedCategory: e.target.value })} className={fieldCls} placeholder="e.g. game or survey" />
                  </div>
                  <div>
                    <label htmlFor="ct-feed-category-mode" className="text-sm font-semibold">Category mode</label>
                    <select
                      id="ct-feed-category-mode"
                      value={form.feedCategoryMode}
                      onChange={(e) => setForm({ ...form, feedCategoryMode: e.target.value as ContentForm["feedCategoryMode"] })}
                      className={fieldCls}
                    >
                      <option value="include">Include — only this category lists</option>
                      <option value="exclude">Exclude — drop this category</option>
                    </select>
                  </div>
                </div>
                <p className="mt-1 text-xs leading-relaxed text-[var(--dim)]">
                  Feed auth and the category filter are how a future partner&apos;s games or surveys list from Admin alone: paste its API key as the feed secret, and set the category to &quot;game&quot; on a Games row or &quot;survey&quot; on a Surveys row. The secret is server-only and never shown to users.
                </p>
              </div>
            )}
            <div>
              <label htmlFor="ct-img" className="text-sm font-semibold">Image URL <span className="font-normal text-[var(--dim)]">(optional)</span></label>
              <input id="ct-img" {...FIELDS.adminUpsertContent.imageUrl} value={form.imageUrl} onChange={(e) => setForm({ ...form, imageUrl: e.target.value })} placeholder="https://…" className={fieldCls} />
            </div>
            <div>
              <label htmlFor="ct-badge" className="text-sm font-semibold">Badge <span className="font-normal text-[var(--dim)]">(optional — small label on the Offerwalls card, e.g. +20%)</span></label>
              <input id="ct-badge" {...FIELDS.adminUpsertContent.badge} value={form.badge} onChange={(e) => setForm({ ...form, badge: e.target.value })} placeholder="+20%" className={fieldCls} />
            </div>
            <div>
              <label htmlFor="ct-countries" className="text-sm font-semibold">Countries <span className="font-normal text-[var(--dim)]">(ALL, or codes like PK,US,GB)</span></label>
              <input id="ct-countries" {...FIELDS.adminUpsertContent.countries} value={form.countries} onChange={(e) => setForm({ ...form, countries: e.target.value })} className={fieldCls} />
            </div>
            {form.kind === "game" && (
              <>
                <div>
                  <label htmlFor="ct-platform" className="text-sm font-semibold">Platform <span className="font-normal text-[var(--dim)]">(the Games tab filters on this; each visitor's own device is preselected)</span></label>
                  <select
                    id="ct-platform"
                    value={form.platform}
                    onChange={(e) => setForm({ ...form, platform: e.target.value as ContentForm["platform"] })}
                    className={fieldCls}
                  >
                    <option value="android">Android</option>
                    <option value="ios">iOS</option>
                    <option value="both">Android &amp; iOS</option>
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label htmlFor="ct-milestones" className="text-sm font-semibold">Milestones <span className="font-normal text-[var(--dim)]">(one per line: Event | dollars)</span></label>
                  <textarea
                    id="ct-milestones"
                    value={form.milestonesText}
                    onChange={(e) => setForm({ ...form, milestonesText: e.target.value })}
                    rows={4}
                    placeholder={"Install and open the game | 0.10\nReach level 10 | 0.50\nReach level 20 | 1.50"}
                    className={fieldCls}
                  />
                  <p className="mt-1 text-xs leading-relaxed text-[var(--dim)]">
                    Shown as the EVENT / CASH table in the game's popup — the amounts add up to the
                    total payout on the game card and its PLAY AND EARN button. Leave empty to use
                    the single Reward amount above instead.
                  </p>
                </div>
              </>
            )}
            <div>
              <label htmlFor="ct-sort" className="text-sm font-semibold">Sort order</label>
              <input id="ct-sort" value={form.sortOrder} onChange={(e) => setForm({ ...form, sortOrder: e.target.value })} inputMode="numeric" className={fieldCls} />
            </div>
            <div className="flex flex-wrap items-end gap-5 pb-1">
              <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold">
                <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} className="h-5 w-5 accent-[var(--brand)]" />
                Active (visible to users)
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold">
                <input type="checkbox" checked={form.featured} onChange={(e) => setForm({ ...form, featured: e.target.checked })} className="h-5 w-5 accent-[var(--brand)]" />
                Featured (games: home page)
              </label>
            </div>
          </div>
          <div className="mt-5 flex gap-2">
            <button type="submit" disabled={save.isPending} className="rounded-full bg-[var(--brand)] px-6 py-2.5 font-display text-sm font-bold text-white disabled:opacity-60">
              {save.isPending ? "Saving…" : form.id ? "Save changes" : "Add item"}
            </button>
            <button type="button" onClick={() => setForm(null)} className="rounded-full bg-[var(--surface-2)] px-5 py-2.5 text-sm font-bold">
              Cancel
            </button>
          </div>
        </form>
      )}

      {list.isPending ? (
        <p className="mt-4 text-sm text-[var(--dim)]">Loading…</p>
      ) : items.length > 0 ? (
        <ul className="mt-5 space-y-3">
          {items.map((item) => (
            <li key={item.id} className="flex flex-wrap items-center gap-3 rounded-2xl bg-[var(--surface)] p-4 ring-1 ring-[var(--border)]">
              <div className="min-w-0 flex-1">
                <p className="font-display font-bold">
                  {item.title}{" "}
                  <span className="ml-1 rounded-full bg-[var(--surface-2)] px-2 py-0.5 text-xs font-bold text-[var(--dim)]">
                    {kindLabel[item.kind]}
                  </span>
                  {item.featured && (
                    <span className="ml-1 rounded-full bg-[var(--gold)]/20 px-2 py-0.5 text-xs font-bold text-[#9a6200] dark:text-[var(--gold)]">Featured</span>
                  )}
                  {!item.active && (
                    <span className="ml-1 rounded-full bg-red-500/10 px-2 py-0.5 text-xs font-bold text-red-600 dark:text-red-400">Hidden</span>
                  )}
                </p>
                <p className="truncate text-sm text-[var(--dim)]">
                  {item.provider || "—"} · {item.rewardCents != null ? fmt(item.rewardCents) : "no set reward"} · {item.countries}
                  {item.kind === "game" ? ` · ${item.platform}${item.milestones.length > 0 ? ` · ${item.milestones.length} milestones` : ""}` : ""}
                  {item.badge ? ` · badge ${item.badge}` : ""}
                  {item.feedUrl ? ` · feed: ${item.feedAuthKind === "bearer" ? "bearer" : "open"}${item.feedSecretSet ? " · feed key set" : ""}${item.feedCategory ? ` · category ${item.feedCategoryMode === "exclude" ? "excludes" : "only"} ${item.feedCategory}` : ""}` : ""}
                </p>
              </div>
              <button type="button" onClick={() => setForm(editForm(item))} className="flex items-center gap-1.5 rounded-full bg-[var(--surface-2)] px-4 py-2 text-sm font-bold">
                {Icons.edit("h-4 w-4")} Edit
              </button>
              {confirmDelete === item.id ? (
                <span className="flex gap-2">
                  <button type="button" disabled={remove.isPending} onClick={() => remove.mutate(item.id)} className="rounded-full bg-red-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-60">
                    Confirm delete
                  </button>
                  <button type="button" onClick={() => setConfirmDelete(null)} className="rounded-full bg-[var(--surface-2)] px-4 py-2 text-sm font-bold">
                    Keep
                  </button>
                </span>
              ) : (
                <button type="button" onClick={() => setConfirmDelete(item.id)} className="flex items-center gap-1.5 rounded-full bg-red-500/10 px-4 py-2 text-sm font-bold text-red-600 dark:text-red-400">
                  {Icons.trash("h-4 w-4")} Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-6 rounded-2xl border-2 border-dashed border-[var(--border)] bg-[var(--surface)] px-5 py-10 text-center text-sm text-[var(--dim)]">
          Nothing here yet. When an offerwall, survey network or game partner approves
          TapOne, add it with the Add item button — it shows to every user right away.
        </p>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ inbox

function InboxTab({ token }: { token: string }) {
  const queryClient = useQueryClient();
  const [openUserId, setOpenUserId] = useState<number | null>(null);
  const [reply, setReply] = useState("");
  const [error, setError] = useState<string | null>(null);

  const threads = useQuery({
    queryKey: ["admin-threads", token],
    queryFn: () => api.adminListThreads({ adminToken: token }),
  });
  const thread = useQuery({
    queryKey: ["admin-thread", token, openUserId],
    queryFn: () => api.adminGetThread({ adminToken: token, userId: openUserId ?? 0 }),
    enabled: openUserId != null,
  });

  const send = useMutation({
    mutationFn: async () => {
      if (openUserId == null) throw new Error("Open a conversation first.");
      return api.adminReply({ adminToken: token, userId: openUserId, body: reply.trim() });
    },
    onSuccess: () => {
      setReply("");
      void queryClient.invalidateQueries({ queryKey: ["admin-thread", token, openUserId] });
      void queryClient.invalidateQueries({ queryKey: ["admin-threads", token] });
    },
    onError: (e) => setError(e.message),
  });

  const approve = useMutation({
    mutationFn: async (messageId: number) =>
      api.adminApproveHelpMessage({ adminToken: token, messageId }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin-thread", token, openUserId] });
      void queryClient.invalidateQueries({ queryKey: ["admin-threads", token] });
    },
    onError: (e) => setError(e.message),
  });

  if (openUserId != null) {
    const meta = threads.data?.threads.find((t) => t.userId === openUserId);
    return (
      <div>
        <button type="button" onClick={() => setOpenUserId(null)} className="text-sm font-semibold text-[var(--dim)]">
          ← All conversations
        </button>
        <h1 className="mt-2 font-display text-2xl font-extrabold">
          {meta?.userName ?? "User"} <span className="text-base font-semibold text-[var(--dim)]">({meta?.userCode ?? ""})</span>
        </h1>
        <p className="text-sm text-[var(--dim)]">{meta?.userEmail ?? ""}</p>
        <section className="mt-5 space-y-3" aria-label="Thread">
          {thread.isPending ? (
            <p className="text-sm text-[var(--dim)]">Loading…</p>
          ) : (
            thread.data?.messages.map((m) => (
              <div key={m.id} className={`flex ${m.sender === "admin" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[85%] rounded-2xl px-4 py-3 sm:max-w-[70%] ${
                    m.sender === "admin" ? "bg-[var(--brand)] text-white" : "bg-[var(--surface)] ring-1 ring-[var(--border)]"
                  }`}
                >
                  {m.subject && <p className="text-sm font-bold">{m.subject}</p>}
                  <p className="whitespace-pre-wrap text-sm leading-relaxed">{m.body}</p>
                  {m.imageUrl && (
                    <a href={m.imageUrl} target="_blank" rel="noreferrer" className="mt-2 block">
                      <img
                        src={m.imageUrl}
                        alt="Photo attached by the user"
                        className="max-h-48 rounded-xl object-cover ring-1 ring-white/40"
                      />
                    </a>
                  )}
                  {m.sender === "user" && (
                    <span className="mt-2 flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
                          m.status === "approved" ? "bg-green-600 text-white" : "bg-amber-500 text-white"
                        }`}
                      >
                        {m.status === "approved" ? "Approved" : "Pending"}
                      </span>
                      {m.status === "pending" && (
                        <button
                          type="button"
                          disabled={approve.isPending}
                          onClick={() => approve.mutate(m.id)}
                          className="rounded-full bg-green-600 px-3 py-1 text-[11px] font-bold text-white disabled:opacity-60"
                        >
                          {approve.isPending ? "Approving…" : "Approve"}
                        </button>
                      )}
                    </span>
                  )}
                  <p className={`mt-1.5 text-[11px] ${m.sender === "admin" ? "text-white/60" : "text-[var(--dim)]"}`}>
                    {m.sender === "admin" ? "You (admin)" : meta?.userName ?? "User"} · {fmtDateTime(m.createdAt)}
                  </p>
                </div>
              </div>
            ))
          )}
        </section>
        <form
          className="mt-5 rounded-3xl bg-[var(--surface)] p-5 ring-1 ring-[var(--border)]"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            if (!reply.trim()) {
              setError("Write a reply first.");
              return;
            }
            send.mutate();
          }}
        >
          <label htmlFor="adm-reply" className="font-display text-base font-bold">
            Reply — the user sees it in their Mailbox
          </label>
          <textarea
            id="adm-reply"
            {...FIELDS.adminReply.body}
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            rows={3}
            className="mt-2 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm outline-none focus:border-[var(--brand)]"
          />
          {error && (
            <p role="alert" className="mt-2 text-sm font-medium text-red-600 dark:text-red-400">{error}</p>
          )}
          <button type="submit" disabled={send.isPending} className="mt-3 flex items-center gap-2 rounded-full bg-[var(--brand)] px-6 py-2.5 font-display text-sm font-bold text-white disabled:opacity-60">
            {Icons.send("h-4 w-4")} {send.isPending ? "Sending…" : "Send reply"}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div>
      <h1 className="font-display text-2xl font-extrabold">Inbox</h1>
      <p className="mt-1 text-sm text-[var(--dim)]">Help messages from users. Open one to reply — replies land in the user's Mailbox.</p>
      {threads.isPending ? (
        <p className="mt-4 text-sm text-[var(--dim)]">Loading…</p>
      ) : threads.data && threads.data.threads.length > 0 ? (
        <ul className="mt-4 divide-y divide-[var(--border)] rounded-2xl bg-[var(--surface)] px-4 ring-1 ring-[var(--border)]">
          {threads.data.threads.map((t) => (
            <li key={t.userId}>
              <button type="button" onClick={() => setOpenUserId(t.userId)} className="flex w-full items-center gap-3 py-4 text-left">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--avatar)] font-display font-extrabold text-white">
                  {t.userName.charAt(0).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 font-display text-sm font-bold">
                    {t.userName}
                    {t.unread > 0 && (
                      <span className="rounded-full bg-[var(--gold)] px-2 py-0.5 text-xs font-bold text-[var(--ink)]">{t.unread} new</span>
                    )}
                    {t.pending > 0 && (
                      <span className="rounded-full bg-amber-500 px-2 py-0.5 text-xs font-bold text-white">{t.pending} pending</span>
                    )}
                  </span>
                  <span className="block truncate text-sm text-[var(--dim)]">{t.lastBody}</span>
                </span>
                <span className="shrink-0 text-xs text-[var(--dim)]">{fmtDateTime(t.lastAt)}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-6 rounded-2xl border-2 border-dashed border-[var(--border)] bg-[var(--surface)] px-5 py-10 text-center text-sm text-[var(--dim)]">
          No messages yet. User help requests will appear here.
        </p>
      )}
    </div>
  );
}

// --------------------------------------------------------- challenge stats

function StatsTab({ token }: { token: string }) {
  const stats = useQuery({
    queryKey: ["admin-user-stats", token],
    queryFn: () => api.adminGetUserStats({ adminToken: token, limit: 200 }),
  });
  const totals = stats.data?.totals;
  return (
    <div>
      <h1 className="font-display text-2xl font-extrabold">Challenge stats</h1>
      <p className="mt-1 max-w-2xl text-sm leading-relaxed text-[var(--dim)]">
        Per user: how many challenges and surveys each person has completed
        (counted from credited partner postbacks — survey networks count as
        surveys, everything else as challenges), their check-ins and how much
        they have earned in total.
      </p>
      {totals && (
        <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
          {[
            ["Users", String(totals.users)],
            ["Challenges done", String(totals.challenges)],
            ["Surveys done", String(totals.surveys)],
            ["Check-ins", String(totals.checkins)],
            ["Total earned by users", fmt(totals.earnedCents)],
          ].map(([label, value]) => (
            <div key={label} className="rounded-2xl bg-[var(--surface)] p-4 ring-1 ring-[var(--border)]">
              <p className="font-display text-xl font-extrabold">{value}</p>
              <p className="mt-0.5 text-xs font-semibold text-[var(--dim)]">{label}</p>
            </div>
          ))}
        </div>
      )}
      {stats.isPending ? (
        <p className="mt-4 text-sm text-[var(--dim)]">Loading…</p>
      ) : stats.data && stats.data.users.length > 0 ? (
        <ul className="mt-5 space-y-3">
          {stats.data.users.map((u, i) => (
            <li key={u.userId} className="rounded-2xl bg-[var(--surface)] p-4 ring-1 ring-[var(--border)] sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-display font-bold">
                    <span className="text-[var(--dim)]">#{i + 1}</span> {u.flagEmoji ?? "🌍"} {u.name}{" "}
                    <span className="font-normal text-[var(--dim)]">({u.userCode})</span>
                  </p>
                  <p className="break-all text-sm text-[var(--dim)]">{u.email} · {u.countryName ?? "—"}</p>
                </div>
                <div className="text-right">
                  <p className="font-display text-lg font-extrabold text-[var(--brand)]">{fmt(u.totalEarnedCents)}</p>
                  <p className="text-xs text-[var(--dim)]">total earned · balance {fmt(u.balanceCents)}</p>
                </div>
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-3 lg:grid-cols-6">
                {[
                  ["Challenges completed", String(u.challengesCompleted)],
                  ["Surveys completed", String(u.surveysCompleted)],
                  ["All offers completed", String(u.offersCompleted)],
                  ["Check-ins", `${u.checkins} (${fmt(u.checkinCents)})`],
                  ["Referrals", String(u.referrals)],
                ].map(([k, v]) => (
                  <div key={k}>
                    <dt className="font-semibold uppercase tracking-wide text-[var(--dim)]">{k}</dt>
                    <dd className="mt-0.5 font-display text-base font-extrabold">{v}</dd>
                  </div>
                ))}
              </dl>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-6 rounded-2xl border-2 border-dashed border-[var(--border)] bg-[var(--surface)] px-5 py-10 text-center text-sm text-[var(--dim)]">
          No users yet — stats appear here as people join and complete
          challenges and surveys.
        </p>
      )}
    </div>
  );
}

// ------------------------------------------------------------ countries

const COMMON_COUNTRIES: { code: string; name: string; flag: string }[] = [
  { code: "PK", name: "Pakistan", flag: "🇵🇰" },
  { code: "IN", name: "India", flag: "🇮🇳" },
  { code: "BD", name: "Bangladesh", flag: "🇧🇩" },
  { code: "US", name: "United States", flag: "🇺🇸" },
  { code: "GB", name: "United Kingdom", flag: "🇬🇧" },
  { code: "AE", name: "United Arab Emirates", flag: "🇦🇪" },
  { code: "SA", name: "Saudi Arabia", flag: "🇸🇦" },
  { code: "NG", name: "Nigeria", flag: "🇳🇬" },
  { code: "PH", name: "Philippines", flag: "🇵🇭" },
  { code: "ID", name: "Indonesia", flag: "🇮🇩" },
  { code: "BR", name: "Brazil", flag: "🇧🇷" },
  { code: "TR", name: "Turkey", flag: "🇹🇷" },
  { code: "EG", name: "Egypt", flag: "🇪🇬" },
  { code: "KE", name: "Kenya", flag: "🇰🇪" },
  { code: "ZA", name: "South Africa", flag: "🇿🇦" },
  { code: "CA", name: "Canada", flag: "🇨🇦" },
  { code: "AU", name: "Australia", flag: "🇦🇺" },
  { code: "DE", name: "Germany", flag: "🇩🇪" },
  { code: "FR", name: "France", flag: "🇫🇷" },
  { code: "NP", name: "Nepal", flag: "🇳🇵" },
  { code: "LK", name: "Sri Lanka", flag: "🇱🇰" },
  { code: "MM", name: "Myanmar", flag: "🇲🇲" },
  { code: "VN", name: "Vietnam", flag: "🇻🇳" },
  { code: "MX", name: "Mexico", flag: "🇲🇽" },
];

function CountriesTab({ token }: { token: string }) {
  const queryClient = useQueryClient();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [flag, setFlag] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [confirmCode, setConfirmCode] = useState<string | null>(null);

  const list = useQuery({
    queryKey: ["admin-banned-countries", token],
    queryFn: () => api.adminListBannedCountries({ adminToken: token }),
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["admin-banned-countries", token] });
    void queryClient.invalidateQueries({ queryKey: ["admin-overview", token] });
  };

  const ban = useMutation({
    mutationFn: async (input: { countryCode: string; countryName: string; flagEmoji?: string }) =>
      api.adminBanCountry({ adminToken: token, ...input }),
    onSuccess: (_r, input) => {
      setOkMsg(`${input.countryName || input.countryCode} is now banned — no new account can be created from there.`);
      setConfirmCode(null);
      setCode("");
      setName("");
      setFlag("");
      refresh();
    },
    onError: (e) => setError(e.message),
  });

  const unban = useMutation({
    mutationFn: async (countryCode: string) =>
      api.adminUnbanCountry({ adminToken: token, countryCode }),
    onSuccess: (_r, countryCode) => {
      setOkMsg(`${countryCode} is unbanned — signups from there work again right away.`);
      setConfirmCode(null);
      refresh();
    },
    onError: (e) => setError(e.message),
  });

  const banned = list.data?.banned ?? [];
  const known = list.data?.knownCountries ?? [];
  const bannedCodes = new Set(banned.map((b) => b.countryCode.toUpperCase()));
  const fieldCls =
    "mt-1 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm outline-none focus:border-[var(--brand)]";

  return (
    <div>
      <h1 className="font-display text-2xl font-extrabold">Countries — ban / unban</h1>
      <p className="mt-1 max-w-2xl text-sm leading-relaxed text-[var(--dim)]">
        Banning a country stops <strong className="text-[var(--text)]">new account creation</strong> from
        that country completely — anyone signing up from a banned country&apos;s IP sees a clear
        message and no account is made. Existing accounts are not deleted. Unbanning lets
        signups from that country through again immediately. The list is stored on the
        server, so it applies to every visitor.
      </p>
      {error && (
        <p role="alert" className="mt-3 text-sm font-medium text-red-600 dark:text-red-400">{error}</p>
      )}
      {okMsg && (
        <p role="status" className="mt-3 text-sm font-medium text-[var(--brand-deep)] dark:text-[var(--brand)]">{okMsg}</p>
      )}

      {/* currently banned */}
      <section className="mt-5" aria-label="Banned countries">
        <h2 className="font-display text-lg font-bold">Banned right now ({banned.length})</h2>
        {list.isPending ? (
          <p className="mt-3 text-sm text-[var(--dim)]">Loading…</p>
        ) : banned.length > 0 ? (
          <ul className="mt-3 space-y-2.5">
            {banned.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center gap-3 rounded-2xl bg-[var(--surface)] p-4 ring-1 ring-red-300 dark:ring-red-900">
                <span className="text-2xl" aria-hidden="true">{b.flagEmoji ?? "🌍"}</span>
                <span className="min-w-0 flex-1">
                  <span className="block font-display font-bold">{b.countryName} ({b.countryCode})</span>
                  <span className="block text-xs text-[var(--dim)]">Banned since {fmtDate(b.createdAt)} · No new signups from here</span>
                </span>
                {confirmCode === `unban-${b.countryCode}` ? (
                  <span className="flex gap-2">
                    <button type="button" disabled={unban.isPending} onClick={() => { setError(null); unban.mutate(b.countryCode); }} className="rounded-full bg-[var(--brand)] px-4 py-2 text-sm font-bold text-white disabled:opacity-60">
                      Confirm unban
                    </button>
                    <button type="button" onClick={() => setConfirmCode(null)} className="rounded-full bg-[var(--surface-2)] px-4 py-2 text-sm font-bold">Keep banned</button>
                  </span>
                ) : (
                  <button type="button" onClick={() => setConfirmCode(`unban-${b.countryCode}`)} className="rounded-full bg-[var(--brand)]/15 px-4 py-2 text-sm font-bold text-[var(--brand-deep)] dark:text-[var(--brand)]">
                    Unban country
                  </button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 rounded-2xl border-2 border-dashed border-[var(--border)] bg-[var(--surface)] px-5 py-8 text-center text-sm text-[var(--dim)]">
            No country is banned. Signups are open worldwide (except VPN connections).
          </p>
        )}
      </section>

      {/* countries seen from users */}
      {known.length > 0 && (
        <section className="mt-6" aria-label="Countries from your users">
          <h2 className="font-display text-lg font-bold">Countries your users come from</h2>
          <ul className="mt-3 space-y-2.5">
            {known.map((k) => (
              <li key={k.countryCode} className="flex flex-wrap items-center gap-3 rounded-2xl bg-[var(--surface)] p-4 ring-1 ring-[var(--border)]">
                <span className="text-2xl" aria-hidden="true">{k.flagEmoji ?? "🌍"}</span>
                <span className="min-w-0 flex-1">
                  <span className="block font-display font-bold">
                    {k.countryName} ({k.countryCode})
                    {k.banned && <span className="ml-2 rounded-full bg-red-500/10 px-2 py-0.5 text-xs font-bold text-red-600 dark:text-red-400">BANNED</span>}
                  </span>
                  <span className="block text-xs text-[var(--dim)]">{k.userCount} existing account{k.userCount === 1 ? "" : "s"}</span>
                </span>
                {k.banned ? (
                  <button type="button" disabled={unban.isPending} onClick={() => { setError(null); unban.mutate(k.countryCode); }} className="rounded-full bg-[var(--brand)]/15 px-4 py-2 text-sm font-bold text-[var(--brand-deep)] disabled:opacity-60 dark:text-[var(--brand)]">
                    Unban
                  </button>
                ) : confirmCode === `ban-${k.countryCode}` ? (
                  <span className="flex gap-2">
                    <button type="button" disabled={ban.isPending} onClick={() => { setError(null); ban.mutate({ countryCode: k.countryCode, countryName: k.countryName, flagEmoji: k.flagEmoji ?? undefined }); }} className="rounded-full bg-red-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-60">Confirm ban</button>
                    <button type="button" onClick={() => setConfirmCode(null)} className="rounded-full bg-[var(--surface-2)] px-4 py-2 text-sm font-bold">Cancel</button>
                  </span>
                ) : (
                  <button type="button" onClick={() => setConfirmCode(`ban-${k.countryCode}`)} className="flex items-center gap-1.5 rounded-full bg-red-500/10 px-4 py-2 text-sm font-bold text-red-600 dark:text-red-400">
                    {Icons.ban("h-4 w-4")} Ban country
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* quick ban list */}
      <section className="mt-6" aria-label="Ban a country">
        <h2 className="font-display text-lg font-bold">Ban a country</h2>
        <p className="mt-1 text-sm text-[var(--dim)]">Tap a country to ban it, or enter any country below.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {COMMON_COUNTRIES.filter((c) => !bannedCodes.has(c.code)).map((c) => (
            <button
              key={c.code}
              type="button"
              disabled={ban.isPending}
              onClick={() => { setError(null); setOkMsg(null); ban.mutate({ countryCode: c.code, countryName: c.name, flagEmoji: c.flag }); }}
              className="rounded-full bg-[var(--surface)] px-3.5 py-2 text-sm font-bold ring-1 ring-[var(--border)] transition hover:ring-red-400 disabled:opacity-60"
            >
              {c.flag} {c.name}
            </button>
          ))}
        </div>
        <form
          className="mt-4 grid gap-3 rounded-3xl bg-[var(--surface)] p-5 ring-1 ring-[var(--border)] sm:grid-cols-3"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            setOkMsg(null);
            const cc = code.trim().toUpperCase();
            if (cc.length !== 2) {
              setError("Country code must be exactly 2 letters, e.g. PK, IN, US, GB.");
              return;
            }
            if (!name.trim()) {
              setError("Please enter the country name.");
              return;
            }
            ban.mutate({ countryCode: cc, countryName: name.trim(), flagEmoji: flag.trim() || undefined });
          }}
        >
          <div>
            <label htmlFor="ban-code" className="text-sm font-semibold">Country code</label>
            <input id="ban-code" {...FIELDS.adminBanCountry.countryCode} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="e.g. PK" className={fieldCls} />
          </div>
          <div>
            <label htmlFor="ban-name" className="text-sm font-semibold">Country name</label>
            <input id="ban-name" {...FIELDS.adminBanCountry.countryName} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Pakistan" className={fieldCls} />
          </div>
          <div>
            <label htmlFor="ban-flag" className="text-sm font-semibold">Flag emoji <span className="font-normal text-[var(--dim)]">(optional)</span></label>
            <input id="ban-flag" {...FIELDS.adminBanCountry.flagEmoji} value={flag} onChange={(e) => setFlag(e.target.value)} placeholder="🇵🇰" className={fieldCls} />
          </div>
          <button type="submit" disabled={ban.isPending} className="flex items-center justify-center gap-1.5 rounded-full bg-red-600 px-5 py-2.5 text-sm font-bold text-white disabled:opacity-60 sm:col-span-3 sm:w-fit">
            {Icons.ban("h-4 w-4")} {ban.isPending ? "Banning…" : "Ban this country"}
          </button>
        </form>
      </section>
    </div>
  );
}

// ---------------------------------------------------------- notifications

function NotificationsTab({ token }: { token: string }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const list = useQuery({
    queryKey: ["admin-notifications", token],
    queryFn: () => api.adminListNotifications({ adminToken: token, limit: 100 }),
  });
  const mark = useMutation({
    mutationFn: async (notificationId?: number) =>
      api.adminMarkNotificationsRead({ adminToken: token, notificationId }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin-notifications", token] });
      void queryClient.invalidateQueries({ queryKey: ["admin-overview", token] });
    },
    onError: (e) => setError(e.message),
  });

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-extrabold">Notifications</h1>
        {list.data && list.data.unreadCount > 0 && (
          <button type="button" disabled={mark.isPending} onClick={() => { setError(null); mark.mutate(undefined); }} className="rounded-full bg-[var(--surface)] px-4 py-2 text-sm font-bold ring-1 ring-[var(--border)] disabled:opacity-60">
            Mark all as read ({list.data.unreadCount} new)
          </button>
        )}
      </div>
      <p className="mt-1 text-sm text-[var(--dim)]">
        Every new registration lands here the moment the account is created — with the
        user&apos;s name, email, country, flag and IP address.
      </p>
      {error && (
        <p role="alert" className="mt-3 text-sm font-medium text-red-600 dark:text-red-400">{error}</p>
      )}
      {list.isPending ? (
        <p className="mt-4 text-sm text-[var(--dim)]">Loading…</p>
      ) : list.data && list.data.notifications.length > 0 ? (
        <ul className="mt-4 space-y-3">
          {list.data.notifications.map((n) => (
            <li key={n.id} className={`rounded-2xl bg-[var(--surface)] p-4 ring-1 sm:p-5 ${n.read ? "ring-[var(--border)]" : "ring-[var(--gold)]"}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--avatar)] font-display text-lg font-extrabold text-white">
                    {n.userName.charAt(0).toUpperCase() || "?"}
                  </span>
                  <div className="min-w-0">
                    <p className="font-display font-bold">
                      New registration — {n.userName}{" "}
                      {!n.read && <span className="ml-1 rounded-full bg-[var(--gold)] px-2 py-0.5 text-xs font-bold text-[var(--ink)]">NEW</span>}
                    </p>
                    <p className="break-all text-sm text-[var(--dim)]">{n.userEmail}</p>
                  </div>
                </div>
                {!n.read && (
                  <button type="button" disabled={mark.isPending} onClick={() => { setError(null); mark.mutate(n.id); }} className="rounded-full bg-[var(--surface-2)] px-4 py-2 text-sm font-bold disabled:opacity-60">
                    Mark read
                  </button>
                )}
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-4">
                {[
                  ["User ID", n.userCode || "—"],
                  ["Country", `${n.flagEmoji ?? "🌍"} ${n.countryName ?? "—"}${n.countryCode ? ` (${n.countryCode})` : ""}`],
                  ["IP address", n.ip ?? "—"],
                  ["Registered", fmtDateTime(n.createdAt)],
                ].map(([k, v]) => (
                  <div key={k}>
                    <dt className="font-semibold uppercase tracking-wide text-[var(--dim)]">{k}</dt>
                    <dd className="mt-0.5 break-all font-semibold">{v}</dd>
                  </div>
                ))}
              </dl>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-6 rounded-2xl border-2 border-dashed border-[var(--border)] bg-[var(--surface)] px-5 py-10 text-center text-sm text-[var(--dim)]">
          No registrations yet. As soon as someone creates an account, their details
          will appear here.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------- announcements
//
// Owner broadcasts to ALL users: post an announcement or an event and it
// appears in every user's notification bell at once — no deploy, no
// GitHub, no Muse needed. Edit or delete any post from here.

type AnnouncementKind = "announcement" | "event";

function AnnouncementsTab({ token }: { token: string }) {
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<AnnouncementKind>("announcement");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editKind, setEditKind] = useState<AnnouncementKind>("announcement");
  const [editTitle, setEditTitle] = useState("");
  const [editBody, setEditBody] = useState("");

  const list = useQuery({
    queryKey: ["admin-announcements", token],
    queryFn: () => api.adminListAnnouncements({ adminToken: token }),
  });
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["admin-announcements", token] });
    void queryClient.invalidateQueries({ queryKey: ["announcements"] });
  };

  const create = useMutation({
    mutationFn: async () =>
      api.adminCreateAnnouncement({
        adminToken: token,
        kind,
        title: title.trim(),
        body: body.trim(),
      }),
    onSuccess: () => {
      setTitle("");
      setBody("");
      invalidate();
    },
    onError: (e) => setError(e.message),
  });

  const update = useMutation({
    mutationFn: async (id: number) =>
      api.adminUpdateAnnouncement({
        adminToken: token,
        id,
        kind: editKind,
        title: editTitle.trim(),
        body: editBody.trim(),
      }),
    onSuccess: () => {
      setEditingId(null);
      invalidate();
    },
    onError: (e) => setError(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: number) => api.adminDeleteAnnouncement({ adminToken: token, id }),
    onSuccess: () => invalidate(),
    onError: (e) => setError(e.message),
  });

  return (
    <div>
      <h1 className="font-display text-2xl font-extrabold">Announcements &amp; Events</h1>
      <p className="mt-1 text-sm text-[var(--dim)]">
        Post once and every user sees it in their notification bell right away — no deploy
        needed. Use “Event” for something coming up, “Announcement” for news.
      </p>

      <form
        className="mt-5 rounded-3xl bg-[var(--surface)] p-5 ring-1 ring-[var(--border)]"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          if (!title.trim() || !body.trim()) {
            setError("Write a title and a message first.");
            return;
          }
          create.mutate();
        }}
      >
        <p className="font-display text-base font-bold">📣 Post to all users</p>
        <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Type">
          {(["announcement", "event"] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              aria-pressed={kind === k}
              className={`rounded-full px-4 py-2 text-sm font-bold ring-1 ${
                kind === k
                  ? "bg-[var(--brand)] text-white ring-[var(--brand)]"
                  : "bg-[var(--surface-2)] text-[var(--dim)] ring-[var(--border)]"
              }`}
            >
              {k === "event" ? "🎉 Event" : "📣 Announcement"}
            </button>
          ))}
        </div>
        <div className="mt-3">
          <label htmlFor="ann-title" className="text-sm font-semibold">
            Title
          </label>
          <input
            id="ann-title"
            {...FIELDS.adminCreateAnnouncement.title}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Double rewards weekend"
            className="mt-1 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 outline-none focus:border-[var(--brand)]"
          />
        </div>
        <div className="mt-3">
          <label htmlFor="ann-body" className="text-sm font-semibold">
            Message
          </label>
          <textarea
            id="ann-body"
            {...FIELDS.adminCreateAnnouncement.body}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={3}
            placeholder="What should every user know?"
            className="mt-1 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 outline-none focus:border-[var(--brand)]"
          />
        </div>
        {error && (
          <p role="alert" className="mt-3 text-sm font-medium text-red-600 dark:text-red-400">{error}</p>
        )}
        <button
          type="submit"
          disabled={create.isPending}
          className="mt-4 flex items-center gap-2 rounded-full bg-[var(--brand)] px-6 py-3 font-display text-sm font-bold text-white transition hover:bg-[var(--brand-deep)] disabled:opacity-60"
        >
          {Icons.send("h-4 w-4")} {create.isPending ? "Posting…" : "Post to all users"}
        </button>
      </form>

      {list.isPending ? (
        <p className="mt-6 text-sm text-[var(--dim)]">Loading…</p>
      ) : list.data && list.data.announcements.length > 0 ? (
        <ul className="mt-6 space-y-3">
          {list.data.announcements.map((a) => (
            <li key={a.id} className="rounded-2xl bg-[var(--surface)] p-4 ring-1 ring-[var(--border)] sm:p-5">
              {editingId === a.id ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    setError(null);
                    if (!editTitle.trim() || !editBody.trim()) {
                      setError("Write a title and a message first.");
                      return;
                    }
                    update.mutate(a.id);
                  }}
                >
                  <div className="flex flex-wrap gap-2" role="group" aria-label="Type">
                    {(["announcement", "event"] as const).map((k) => (
                      <button
                        key={k}
                        type="button"
                        onClick={() => setEditKind(k)}
                        aria-pressed={editKind === k}
                        className={`rounded-full px-4 py-2 text-sm font-bold ring-1 ${
                          editKind === k
                            ? "bg-[var(--brand)] text-white ring-[var(--brand)]"
                            : "bg-[var(--surface-2)] text-[var(--dim)] ring-[var(--border)]"
                        }`}
                      >
                        {k === "event" ? "🎉 Event" : "📣 Announcement"}
                      </button>
                    ))}
                  </div>
                  <input
                    aria-label="Title"
                    {...FIELDS.adminUpdateAnnouncement.title}
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    className="mt-3 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 outline-none focus:border-[var(--brand)]"
                  />
                  <textarea
                    aria-label="Message"
                    {...FIELDS.adminUpdateAnnouncement.body}
                    value={editBody}
                    onChange={(e) => setEditBody(e.target.value)}
                    rows={3}
                    className="mt-2 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 outline-none focus:border-[var(--brand)]"
                  />
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="submit"
                      disabled={update.isPending}
                      className="rounded-full bg-[var(--brand)] px-5 py-2 text-sm font-bold text-white disabled:opacity-60"
                    >
                      {update.isPending ? "Saving…" : "Save changes"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingId(null)}
                      className="rounded-full bg-[var(--surface-2)] px-5 py-2 text-sm font-bold"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              ) : (
                <>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2 font-display font-bold">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ${
                            a.kind === "event"
                              ? "bg-[var(--gold)] text-[var(--ink)]"
                              : "bg-[var(--surface-2)] text-[var(--dim)]"
                          }`}
                        >
                          {a.kind === "event" ? "Event" : "Announcement"}
                        </span>
                        {a.title}
                      </p>
                      <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-[var(--dim)]">{a.body}</p>
                      <p className="mt-1.5 text-xs text-[var(--dim)]">
                        Posted {fmtDateTime(a.createdAt)}
                        {a.updatedAt !== a.createdAt && ` · edited ${fmtDateTime(a.updatedAt)}`}
                      </p>
                    </div>
                    <span className="flex shrink-0 gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingId(a.id);
                          setEditKind(a.kind);
                          setEditTitle(a.title);
                          setEditBody(a.body);
                        }}
                        className="rounded-full bg-[var(--surface-2)] px-4 py-2 text-sm font-bold"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        disabled={remove.isPending}
                        onClick={() => {
                          if (window.confirm("Delete this post for all users?")) remove.mutate(a.id);
                        }}
                        className="rounded-full bg-red-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-60"
                      >
                        Delete
                      </button>
                    </span>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-6 rounded-2xl border-2 border-dashed border-[var(--border)] bg-[var(--surface)] px-5 py-10 text-center text-sm text-[var(--dim)]">
          Nothing posted yet. Your first announcement or event will show in every user&apos;s
          notification bell the moment you post it.
        </p>
      )}
    </div>
  );
}

// ------------------------------------------------------- partner callbacks

type PartnerCallbackRow = ApiResponse<typeof api, "adminListPartnerCallbacks">["partners"][number];

const AUTH_METHOD_LABELS: Record<PartnerCallbackRow["authMethod"], string> = {
  none: "No secret check",
  secret: "Secret parameter",
  hmac_sha1: "HMAC-SHA1 signature",
  hmac_sha256: "HMAC-SHA256 signature",
};

const SIG_FORMAT_LABELS: Record<PartnerCallbackRow["sigFormat"], string> = {
  params: "sorted name=value pairs",
  colon: "user:transaction:amount",   moonetix: "tx:user:reward:status",
  custom: "custom template",
};

/**
 * The exact callback address to paste into a partner's dashboard: the
 * site's own address + /partner-callback/<key> + the parameter names
 * the owner configured, with {placeholders} for the values the partner
 * fills in per conversion.
 */
function partnerCallbackUrl(origin: string, p: {
  key: string;
  userParam: string;
  txnParam: string;
  payoutParam: string;
  authMethod: PartnerCallbackRow["authMethod"];   sigFormat: PartnerCallbackRow["sigFormat"];
  secretParam: string;
  statusParam: string;
}): string {
  let url = `${origin}/partner-callback/${p.key}?${p.userParam}={user_id}&${p.txnParam}={transaction_id}&${p.payoutParam}={payout}`;
  if (p.authMethod === "secret" && p.secretParam)
    url += `&${p.secretParam}={secret}`;
  else if (p.authMethod !== "none" && p.secretParam)
    url += `&${p.secretParam}={signature}`;
  if (p.sigFormat === "moonetix") url += "&status={status}&reward={reward}";
  else if (p.statusParam) url += `&${p.statusParam}={status}`;
  return url;
}

// -------------------------------------------------------------- postbacks

function PostbacksTab({ token }: { token: string }) {
  const list = useQuery({
    queryKey: ["admin-postbacks", token],
    queryFn: () => api.adminListPostbacks({ adminToken: token, limit: 100 }),
  });
  return (
    <div>
      <h1 className="font-display text-2xl font-extrabold">Postbacks</h1>
      <p className="mt-1 text-sm text-[var(--dim)]">
        Every conversion partners send. Credited = 70% of the payout, paid to the user.
      </p>
      {list.isPending ? (
        <p className="mt-4 text-sm text-[var(--dim)]">Loading…</p>
      ) : list.data && list.data.postbacks.length > 0 ? (
        <ul className="mt-4 space-y-2.5">
          {list.data.postbacks.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-[var(--surface)] px-4 py-3.5 ring-1 ring-[var(--border)]">
              <div className="min-w-0">
                <p className="truncate text-sm font-bold">
                  {p.network || "Partner"} · <span className="font-mono font-semibold">{p.txnId}</span>
                </p>
                <p className="text-xs text-[var(--dim)]">
                  User {p.userCode ?? "unknown"} · {fmtDateTime(p.createdAt)}
                </p>
              </div>
              <div className="text-right">
                <p className="font-display text-sm font-bold">
                  payout ${p.payout.toFixed(2)} → credited {fmt(p.creditedCents)}
                </p>
                <p className={`text-xs font-bold ${p.status === "credited" ? "text-[var(--brand-deep)] dark:text-[var(--brand)]" : "text-[#9a6200] dark:text-[var(--gold)]"}`}>
                  {p.status}
                </p>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-6 rounded-2xl border-2 border-dashed border-[var(--border)] bg-[var(--surface)] px-5 py-10 text-center text-sm text-[var(--dim)]">
          No postbacks received yet. They will appear here when a partner sends a conversion.
        </p>
      )}
    </div>
  );
}

// ------------------------------------------------------- partner callbacks

type PartnerCallbackForm = {
  id: number | null;
  key: string;
  name: string;
  userParam: string;
  txnParam: string;
  payoutParam: string;
  payoutInCents: boolean;
  sigFormat: PartnerCallbackRow["sigFormat"];
  sigTemplate: string;
  statusParam: string;
  statusCreditValue: string;
  linkHashSalt: string;
  linkHashParam: string;
  payoutDivisor: number;
  authMethod: PartnerCallbackRow["authMethod"];
  secretParam: string;
  secret: string;
  active: boolean;
};

const EMPTY_PARTNER_FORM: PartnerCallbackForm = {
  id: null,
  key: "",
  name: "",
  userParam: "user_id",
  txnParam: "txn_id",
  payoutParam: "payout",
  payoutInCents: false,
  sigFormat: "params",
  sigTemplate: "",
  statusParam: "",
  statusCreditValue: "1",
  linkHashSalt: "",
  linkHashParam: "hash",
  payoutDivisor: 1,
  authMethod: "none",
  secretParam: "",
  secret: "",
  active: true,
};

function slugifyPartnerKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function PartnerCallbacksTab({ token }: { token: string }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<PartnerCallbackForm | null>(null);
  const [keyTouched, setKeyTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const fieldCls =
    "mt-1 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm outline-none focus:border-[var(--brand)]";

  const list = useQuery({
    queryKey: ["admin-partner-callbacks", token],
    queryFn: () => api.adminListPartnerCallbacks({ adminToken: token }),
  });

  const invalidate = () =>
    void queryClient.invalidateQueries({ queryKey: ["admin-partner-callbacks", token] });

  const save = useMutation({
    mutationFn: async (f: PartnerCallbackForm) => {
      if (!f.name.trim()) throw new Error("Give the partner a name.");
      if (!f.key.trim())
        throw new Error("Give the partner a callback key — it is the end of its callback address.");
      if (!f.userParam.trim() || !f.txnParam.trim() || !f.payoutParam.trim())
        throw new Error("Fill in all three parameter names: user ID, transaction ID and payout.");
      if (!Number.isFinite(f.payoutDivisor) || f.payoutDivisor <= 0)
        throw new Error("Units per $1 must be a number above 0.");
      if (f.authMethod !== "none") {
        if (!f.secretParam.trim())
          throw new Error("Name the parameter that carries the secret / signature.");
        if (f.id === null && !f.secret.trim())
          throw new Error("Type the partner's secret.");
      }
      if (f.sigFormat === "custom" && !f.sigTemplate.trim())
        throw new Error("Type the signature template — e.g. {tx}:{user}:{amount}:{status}.");
      return api.adminUpsertPartnerCallback({
        adminToken: token,
        id: f.id ?? undefined,
        key: f.key.trim(),
        name: f.name.trim(),
        userParam: f.userParam.trim(),
        txnParam: f.txnParam.trim(),
        payoutParam: f.payoutParam.trim(),
        payoutInCents: f.payoutInCents,
        sigFormat: f.sigFormat,
        sigTemplate: f.sigTemplate.trim(),
        statusParam: f.statusParam.trim(),
        statusCreditValue: f.statusCreditValue.trim() || "1",
        linkHashSalt: f.linkHashSalt.trim() === "" ? undefined : f.linkHashSalt.trim(),
        linkHashParam: f.linkHashParam.trim() || "hash",
        payoutDivisor: f.payoutDivisor,
        authMethod: f.authMethod,
        secretParam: f.secretParam.trim(),
        secret: f.secret.trim() === "" ? undefined : f.secret.trim(),
        active: f.active,
      });
    },
    onSuccess: (_data, f) => {
      setNotice(
        f.id
          ? `"${f.name.trim()}" updated — its callbacks now follow the new settings.`
          : `"${f.name.trim()}" added — paste its callback address (below, and in Overview) into the partner's dashboard and rewards will start crediting.`,
      );
      setForm(null);
      setKeyTouched(false);
      setError(null);
      invalidate();
    },
    onError: (e) => setError(e.message),
  });

  const setActive = useMutation({
    mutationFn: async (input: { id: number; active: boolean }) =>
      api.adminSetPartnerCallbackActive({ adminToken: token, id: input.id, active: input.active }),
    onSuccess: (_data, input) => {
      setNotice(
        input.active
          ? "Partner switched on — its callbacks credit again."
          : "Partner switched off — its callbacks are refused until you switch it back on.",
      );
      setError(null);
      invalidate();
    },
    onError: (e) => setError(e.message),
  });

  const remove = useMutation({
    mutationFn: async (input: { id: number }) =>
      api.adminRemovePartnerCallback({ adminToken: token, id: input.id }),
    onSuccess: () => {
      setNotice("Partner removed — its callback address no longer works. Past credits stay in the postback log.");
      setError(null);
      invalidate();
    },
    onError: (e) => setError(e.message),
  });

  const startEdit = (p: PartnerCallbackRow) => {
    setError(null);
    setNotice(null);
    setKeyTouched(true);
    setForm({
      id: p.id,
      key: p.key,
      name: p.name,
      userParam: p.userParam,
      txnParam: p.txnParam,
      payoutParam: p.payoutParam,
      payoutInCents: p.payoutInCents,
      sigFormat: p.sigFormat,
      sigTemplate: p.sigTemplate ?? "",
      statusParam: p.statusParam,
      statusCreditValue: p.statusCreditValue,
      linkHashSalt: "",
      linkHashParam: p.linkHashParam,
      payoutDivisor: p.payoutDivisor,
      authMethod: p.authMethod,
      secretParam: p.secretParam,
      secret: "",
      active: p.active,
    });
  };

  const origin = getSiteOrigin();

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-extrabold">Partner Callbacks</h1>
        <button
          type="button"
          onClick={() => {
            setError(null);
            setNotice(null);
            setKeyTouched(false);
            setForm({ ...EMPTY_PARTNER_FORM });
          }}
          className="flex items-center gap-1.5 rounded-full bg-[var(--brand)] px-4 py-2.5 text-sm font-bold text-white"
        >
          {Icons.plus("h-4 w-4")} Add partner
        </button>
      </div>
      <p className="mt-1 max-w-3xl text-sm leading-relaxed text-[var(--dim)]">
        Connect any new offerwall or survey partner (CPX Research, BitLabs, anyone)
        from here alone — no code change, no upload, no redeploy. For each partner you
        say which parameters its callback sends for the user ID, the transaction ID and
        the payout, and how the call proves itself. Paste the partner&apos;s callback
        address into its dashboard; from then on its rewards credit the right user{" "}
        <strong className="text-[var(--text)]">70%</strong> automatically — duplicate
        transactions never credit twice, and the referrer commission, level-ups and the
        weekly check-in all follow from the same credit. The built-in generic postback
        and the TheoremReach callback keep working exactly as before.
      </p>
      <p className="mt-2 max-w-3xl text-sm leading-relaxed text-[var(--dim)]">
        The user ID a partner sends back must be the one from the user&apos;s offer
        link — their <strong className="text-[var(--text)]">Offer Token</strong> (the{" "}
        <code className="font-semibold text-[var(--text)]">{"{user_id}"}</code> in the
        partner link you add under Offerwalls / Surveys / Games). For an HMAC partner,
        the signature is the lowercase hex HMAC of every other parameter sorted by
        name and joined as <code className="font-semibold text-[var(--text)]">name=value&amp;name=value</code> —
        unless the partner signs the <em>user:transaction:amount</em> format instead
        (Offerwall.GG does), in which case pick that format when you add it. Moonetix signs transaction, user, reward and status joined with colons, and a status 2 reversal never credits.
      </p>

      {error && (
        <p role="alert" className="mt-3 text-sm font-medium text-red-600 dark:text-red-400">{error}</p>
      )}
      {notice && (
        <p role="status" className="mt-3 text-sm font-medium text-[var(--brand-deep)] dark:text-[var(--brand)]">{notice}</p>
      )}

      {form && (
        <form
          className="mt-5 rounded-3xl bg-[var(--surface)] p-5 ring-1 ring-[var(--border)] sm:p-6"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            setNotice(null);
            save.mutate(form);
          }}
        >
          <p className="font-display text-lg font-bold">{form.id ? "Edit partner" : "Add partner"}</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="pc-name" className="text-sm font-semibold">Partner name</label>
              <input
                id="pc-name"
                {...FIELDS.adminUpsertPartnerCallback.name}
                value={form.name}
                onChange={(e) => {
                  const name = e.target.value;
                  setForm({
                    ...form,
                    name,
                    key: keyTouched ? form.key : slugifyPartnerKey(name),
                  });
                }}
                className={fieldCls}
                placeholder="e.g. CPX Research"
              />
            </div>
            <div>
              <label htmlFor="pc-key" className="text-sm font-semibold">Callback key <span className="font-normal text-[var(--dim)]">(end of the callback address)</span></label>
              <input
                id="pc-key"
                {...FIELDS.adminUpsertPartnerCallback.key}
                value={form.key}
                onChange={(e) => {
                  setKeyTouched(true);
                  setForm({ ...form, key: e.target.value.toLowerCase() });
                }}
                className={fieldCls}
                placeholder="e.g. cpx-research"
              />
            </div>
            <div>
              <label htmlFor="pc-user-param" className="text-sm font-semibold">User ID parameter name</label>
              <input id="pc-user-param" {...FIELDS.adminUpsertPartnerCallback.userParam} value={form.userParam} onChange={(e) => setForm({ ...form, userParam: e.target.value })} className={fieldCls} placeholder="e.g. user_id" />
              <p className="mt-1 text-xs text-[var(--dim)]">The parameter that carries the user&apos;s Offer Token.</p>
            </div>
            <div>
              <label htmlFor="pc-txn-param" className="text-sm font-semibold">Transaction ID parameter name</label>
              <input id="pc-txn-param" {...FIELDS.adminUpsertPartnerCallback.txnParam} value={form.txnParam} onChange={(e) => setForm({ ...form, txnParam: e.target.value })} className={fieldCls} placeholder="e.g. txn_id" />
              <p className="mt-1 text-xs text-[var(--dim)]">The partner&apos;s unique ID per conversion — this is what stops double credit.</p>
            </div>
            <div>
              <label htmlFor="pc-payout-param" className="text-sm font-semibold">Payout parameter name</label>
              <input id="pc-payout-param" {...FIELDS.adminUpsertPartnerCallback.payoutParam} value={form.payoutParam} onChange={(e) => setForm({ ...form, payoutParam: e.target.value })} className={fieldCls} placeholder="e.g. payout" />
            </div>
            <div>
              <label htmlFor="pc-payout-unit" className="text-sm font-semibold">Payout arrives as</label>
              <select
                id="pc-payout-unit"
                value={form.payoutInCents ? "cents" : "dollars"}
                onChange={(e) => setForm({ ...form, payoutInCents: e.target.value === "cents" })}
                className={fieldCls}
              >
                <option value="dollars">Dollars (e.g. 1.50)</option>
                <option value="cents">Cents (e.g. 150 = $1.50)</option>
              </select>
            </div>
            <div>
              <label htmlFor="pc-payout-divisor" className="text-sm font-semibold">Units per $1 <span className="font-normal text-[var(--dim)]">(1 = payout is already dollars)</span></label>
              <input
                id="pc-payout-divisor"
                {...FIELDS.adminUpsertPartnerCallback.payoutDivisor}
                type="number"
                inputMode="decimal"
                min="0"
                step="any"
                value={form.payoutDivisor}
                onChange={(e) => setForm({ ...form, payoutDivisor: Number(e.target.value) })}
                className={fieldCls}
                placeholder="e.g. 1000"
              />
              <p className="mt-1 text-xs text-[var(--dim)]">How many payout units make $1 — e.g. 1000 for a wall that prices in 1000 units per $1.</p>
            </div>
            <div>
              <label htmlFor="pc-auth" className="text-sm font-semibold">Signature / secret check</label>
              <select
                id="pc-auth"
                value={form.authMethod}
                onChange={(e) => {
                  const authMethod = e.target.value as PartnerCallbackForm["authMethod"];
                  setForm({
                    ...form,
                    authMethod,
                    secretParam:
                      form.secretParam ||
                      (authMethod === "secret"
                        ? "secret"
                        : authMethod === "none"
                          ? ""
                          : "signature"),
                  });
                }}
                className={fieldCls}
              >
                <option value="none">No secret — accept without a check (not recommended)</option>
                <option value="secret">Secret — a parameter must match the secret</option>
                <option value="hmac_sha1">HMAC-SHA1 signature</option>
                <option value="hmac_sha256">HMAC-SHA256 signature</option>
              </select>
            </div>
            {form.authMethod !== "none" && (
              <>
                {(form.authMethod === "hmac_sha1" || form.authMethod === "hmac_sha256") && (
                  <div>
                    <label htmlFor="pc-sig-format" className="text-sm font-semibold">Signature format</label>
                    <select
                      id="pc-sig-format"
                      value={form.sigFormat}
                      onChange={(e) => setForm({ ...form, sigFormat: e.target.value as PartnerCallbackForm["sigFormat"] })}
                      className={fieldCls}
                    >
                      <option value="params">Parameters — HMAC of sorted name=value&amp;name=value pairs</option>
                      <option value="colon">User:transaction:amount — HMAC of &quot;{"{user}"}:{"{txn}"}:{"{payout}"}&quot; (Offerwall.GG)</option> <option value="moonetix">Transaction:user:reward:status — HMAC of &quot;{"{txn}"}:{"{user}"}:{"{reward}"}:{"{status}"}&quot; (Moonetix)</option>
                      <option value="custom">Custom template — HMAC of a template you type below</option>
                    </select>
                    <p className="mt-1 text-xs text-[var(--dim)]">Pick the one the partner&apos;s docs describe — Offerwall.GG signs the three values joined with colons. Moonetix signs transaction, user, reward and status joined with colons, and a status 2 reversal never credits. A new partner with a different order uses Custom template below — no code change needed.</p>
                    {form.sigFormat === "custom" && (
                      <div className="mt-3">
                        <label htmlFor="pc-sig-template" className="text-sm font-semibold">Signature template</label>
                        <input id="pc-sig-template" value={form.sigTemplate} onChange={(e) => setForm({ ...form, sigTemplate: e.target.value })} className={fieldCls} placeholder="{tx}:{user}:{amount}:{status}" />
                        <p className="mt-1 text-xs text-[var(--dim)]">Use {"{user}"} {"{tx}"} {"{amount}"} {"{status}"} or any parameter name above in braces, joined exactly as the partner&apos;s docs show. Values are used exactly as received.</p>
                      </div>
                    )}
                    <div className="mt-3 grid grid-cols-2 gap-3">
                      <div>
                        <label htmlFor="pc-status-param" className="text-sm font-semibold">Status parameter (optional)</label>
                        <input id="pc-status-param" value={form.statusParam} onChange={(e) => setForm({ ...form, statusParam: e.target.value })} className={fieldCls} placeholder="e.g. status" />
                      </div>
                      <div>
                        <label htmlFor="pc-status-credit" className="text-sm font-semibold">Status value that credits</label>
                        <input id="pc-status-credit" value={form.statusCreditValue} onChange={(e) => setForm({ ...form, statusCreditValue: e.target.value })} className={fieldCls} placeholder="1" />
                      </div>
                    </div>
                    <p className="mt-1 text-xs text-[var(--dim)]">When the partner sends a status, only this value credits — any other value is rejected with no credit and no debit (reversals). Leave the parameter blank if the partner sends no status.</p>
                  </div>
                )}
                <div>
                  <label htmlFor="pc-secret-param" className="text-sm font-semibold">Secret / signature parameter name</label>
                  <input id="pc-secret-param" {...FIELDS.adminUpsertPartnerCallback.secretParam} value={form.secretParam} onChange={(e) => setForm({ ...form, secretParam: e.target.value })} className={fieldCls} placeholder={form.authMethod === "secret" ? "e.g. secret" : "e.g. signature"} />
                </div>
                <div>
                  <label htmlFor="pc-secret" className="text-sm font-semibold">
                    Secret value{" "}
                    {form.id !== null && (
                      <span className="font-normal text-[var(--dim)]">(leave blank to keep the saved one)</span>
                    )}
                  </label>
                  <input id="pc-secret" {...FIELDS.adminUpsertPartnerCallback.secret} type="password" autoComplete="off" value={form.secret} onChange={(e) => setForm({ ...form, secret: e.target.value })} className={fieldCls} placeholder="The secret from the partner's dashboard" />
                </div>
              </>
            )}
            <div>
              <label htmlFor="pc-link-salt" className="text-sm font-semibold">
                Wall link salt{" "}
                {form.id !== null && (
                  <span className="font-normal text-[var(--dim)]">(leave blank to keep the saved one)</span>
                )}
              </label>
              <input id="pc-link-salt" type="password" autoComplete="off" value={form.linkHashSalt} onChange={(e) => setForm({ ...form, linkHashSalt: e.target.value })} className={fieldCls} placeholder="Salt from the partner's dashboard, for signed wall links" />
              <p className="mt-1 text-xs text-[var(--dim)]">Optional. When set, each user&apos;s wall link is signed HMAC-SHA256(salt, user Offer Token) and sent as the parameter below, so the partner&apos;s hash check can stay on. Leave blank for an unsigned link.</p>
            </div>
            <div>
              <label htmlFor="pc-link-param" className="text-sm font-semibold">Wall link signature parameter</label>
              <input id="pc-link-param" value={form.linkHashParam} onChange={(e) => setForm({ ...form, linkHashParam: e.target.value })} className={fieldCls} placeholder="hash" />
            </div>
            <div className="flex items-end pb-1">
              <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold">
                <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} className="h-5 w-5 accent-[var(--brand)]" />
                Active (callbacks credit)
              </label>
            </div>
          </div>

          <div className="mt-5">
            <p className="text-sm font-semibold">Callback address for this partner</p>
            <p className="mt-1.5 overflow-x-auto rounded-xl bg-[var(--ink)] px-4 py-3 font-mono text-xs leading-relaxed whitespace-nowrap text-[#7ee2b8]">
              {partnerCallbackUrl(origin, form)}
            </p>
            <p className="mt-1.5 text-xs text-[var(--dim)]">
              Paste this into the partner&apos;s dashboard, keeping the{" "}
              <code className="font-semibold">{"{...}"}</code> parts as they are — the
              partner replaces them with real values on every conversion.
            </p>
          </div>

          <div className="mt-5 flex gap-2">
            <button type="submit" disabled={save.isPending} className="rounded-full bg-[var(--brand)] px-6 py-2.5 font-display text-sm font-bold text-white disabled:opacity-60">
              {save.isPending ? "Saving…" : form.id ? "Save changes" : "Add partner"}
            </button>
            <button
              type="button"
              onClick={() => {
                setForm(null);
                setKeyTouched(false);
              }}
              className="rounded-full bg-[var(--surface-2)] px-6 py-2.5 font-display text-sm font-bold text-[var(--dim)]"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {list.isPending ? (
        <p className="mt-4 text-sm text-[var(--dim)]">Loading…</p>
      ) : list.data && list.data.partners.length > 0 ? (
        <ul className="mt-5 space-y-3">
          {list.data.partners.map((p) => (
            <li key={p.id} className="rounded-3xl bg-[var(--surface)] p-5 ring-1 ring-[var(--border)]">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-display text-base font-bold">
                    {p.name}{" "}
                    <span className={`ml-1 rounded-full px-2.5 py-0.5 text-xs font-bold ${p.active ? "bg-[var(--pill)] text-[var(--brand-deep)] dark:text-[var(--brand)]" : "bg-[var(--surface-2)] text-[var(--dim)]"}`}>
                      {p.active ? "Active" : "Off"}
                    </span>
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-[var(--dim)]">
                    User ID in <code className="font-semibold text-[var(--text)]">{p.userParam}</code> ·
                    transaction in <code className="font-semibold text-[var(--text)]">{p.txnParam}</code> ·
                    payout in <code className="font-semibold text-[var(--text)]">{p.payoutParam}</code> ({p.payoutInCents ? "cents" : "dollars"}
                    {p.payoutDivisor !== 1 ? `, ${p.payoutDivisor} units per $1` : ""}) ·{" "}
                    {AUTH_METHOD_LABELS[p.authMethod]}
                    {(p.authMethod === "hmac_sha1" || p.authMethod === "hmac_sha256") && (
                      <> ({SIG_FORMAT_LABELS[p.sigFormat]})</>
                    )}
                    {p.sigFormat === "custom" && p.sigTemplate && (
                      <> · template <code className="font-semibold text-[var(--text)]">{p.sigTemplate}</code></>
                    )}
                    {p.statusParam && (
                      <> · status <code className="font-semibold text-[var(--text)]">{p.statusParam}</code>={p.statusCreditValue} credits</>
                    )}
                    {p.linkHashSaltSet && <> · wall link signed</>}
                    {p.authMethod !== "none" && (
                      <>
                        {" "}in <code className="font-semibold text-[var(--text)]">{p.secretParam}</code> ·{" "}
                        {p.secretSet ? "secret saved" : "NO SECRET SAVED — callbacks will be refused"}
                      </>
                    )}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => startEdit(p)}
                    className="rounded-full bg-[var(--surface-2)] px-4 py-2 text-xs font-bold text-[var(--dim)] transition hover:text-[var(--text)]"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    disabled={setActive.isPending}
                    onClick={() => setActive.mutate({ id: p.id, active: !p.active })}
                    className="rounded-full bg-[var(--surface-2)] px-4 py-2 text-xs font-bold text-[var(--dim)] transition hover:text-[var(--text)] disabled:opacity-60"
                  >
                    {p.active ? "Switch off" : "Switch on"}
                  </button>
                  <button
                    type="button"
                    disabled={remove.isPending}
                    onClick={() => remove.mutate({ id: p.id })}
                    className="rounded-full bg-[var(--surface-2)] px-4 py-2 text-xs font-bold text-red-600 transition hover:text-red-700 disabled:opacity-60 dark:text-red-400"
                  >
                    Remove
                  </button>
                </div>
              </div>
              <p className="mt-3 overflow-x-auto rounded-xl bg-[var(--ink)] px-4 py-3 font-mono text-xs leading-relaxed whitespace-nowrap text-[#7ee2b8]">
                {partnerCallbackUrl(origin, p)}
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-6 rounded-2xl border-2 border-dashed border-[var(--border)] bg-[var(--surface)] px-5 py-10 text-center text-sm text-[var(--dim)]">
          No partner callbacks yet. Tap “Add partner” to connect the first one — its
          callback address will show here and in Overview.
        </p>
      )}
    </div>
  );
}

// --------------------------------------------------------------- settings

function SettingsTab({ token }: { token: string }) {
  const queryClient = useQueryClient();
  const overview = useQuery({
    queryKey: ["admin-overview", token],
    queryFn: () => api.adminGetOverview({ adminToken: token }),
  });
  const s = overview.data?.settings;

  const [googleClientId, setGoogleClientId] = useState("");
  const [minWithdraw, setMinWithdraw] = useState("");
  const [userSharePct, setUserSharePct] = useState("");
  const [affiliateEarningPct, setAffiliateEarningPct] = useState("");
  const [affiliateSpendingPct, setAffiliateSpendingPct] = useState("");
  const [postbackSecret, setPostbackSecret] = useState("");
  const [theoremReachSecret, setTheoremReachSecret] = useState("");
  const [offerwallggApiKey, setOfferwallggApiKey] = useState("");
  const [pubscaleSecretKey, setPubscaleSecretKey] = useState("");
  const [checkinGoal, setCheckinGoal] = useState("");
  const [checkinDays, setCheckinDays] = useState<string[]>(["", "", "", "", "", "", ""]);
  const [centsPerLevel, setCentsPerLevel] = useState("");
  const [titleRows, setTitleRows] = useState<
    { name: string; level: string; standardPct: string; enhancedPct: string; reward: string }[]
  >([]);
  const [social, setSocial] = useState<Record<string, string>>({});
  const [adminUsername, setAdminUsername] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [loginMsg, setLoginMsg] = useState<string | null>(null);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  useEffect(() => {
    if (s && !hydrated) {
      setGoogleClientId(s.googleClientId);
      setMinWithdraw((s.minWithdrawCents / 100).toFixed(2));
      setUserSharePct(String(s.userSharePct));
      setAffiliateEarningPct(String(s.affiliateEarningPct));
      setAffiliateSpendingPct(String(s.affiliateSpendingPct));
      setAdminUsername(s.adminUsername);
      setCheckinGoal((s.checkinGoalCents / 100).toFixed(2));
      setCheckinDays(s.checkinRewardsCents.map((c) => (c / 100).toFixed(2)));
      setCentsPerLevel((s.levelCentsPerLevel / 100).toFixed(2));
      setTitleRows(
        s.levelTitles.map((t) => ({
          name: t.name,
          level: String(t.level),
          standardPct: String(t.standardPct),
          enhancedPct: String(t.enhancedPct),
          reward: (t.rewardCents / 100).toFixed(2),
        })),
      );
      setSocial(s.socialLinks ?? {});
      setHydrated(true);
    }
  }, [s, hydrated]);

  const save = useMutation({
    mutationFn: async () => {
      const minWithdrawCents = toCents(minWithdraw);
      if (minWithdrawCents === null)
        throw new Error("Minimum withdrawal must be a valid dollar amount.");
      const pct = (raw: string, label: string) => {
        const n = Number.parseInt(raw, 10);
        if (!Number.isFinite(n) || n < 0 || n > 100)
          throw new Error(`${label} must be between 0 and 100.`);
        return n;
      };
      // Weekly check-in: daily goal + the 7 day amounts (Mon..Sun).
      const checkinGoalCents = toCents(checkinGoal);
      if (checkinGoalCents === null || checkinGoalCents < 1)
        throw new Error("The check-in daily goal must be a valid amount above $0.");
      const checkinRewardsCents = checkinDays.map((d) => toCents(d));
      if (checkinRewardsCents.some((c) => c === null))
        throw new Error("Every check-in day amount (Monday to Sunday) must be a valid dollar amount.");
      // Levels: earnings per level + the title table.
      const levelCentsPerLevel = toCents(centsPerLevel);
      if (levelCentsPerLevel === null || levelCentsPerLevel < 1)
        throw new Error("Earnings per level must be a valid amount above $0.");
      if (titleRows.length === 0)
        throw new Error("Keep at least one title in the Levels table.");
      const levelTitles = titleRows.map((t, i) => {
        const level = Number.parseInt(t.level, 10);
        if (!t.name.trim())
          throw new Error(`Title ${i + 1}: give it a name.`);
        if (!Number.isFinite(level) || level < 1)
          throw new Error(`Title "${t.name}": its level must be a whole number above 0.`);
        const rewardCents = toCents(t.reward);
        if (rewardCents === null || rewardCents < 0)
          throw new Error(`Title "${t.name}": its one-time reward must be a valid dollar amount (0 = no reward).`);
        return {
          name: t.name.trim(),
          level,
          standardPct: pct(t.standardPct, `Title "${t.name}" standard bonus`),
          enhancedPct: pct(t.enhancedPct, `Title "${t.name}" enhanced bonus`),
          rewardCents,
        };
      });
      for (let i = 1; i < levelTitles.length; i++) {
        if ((levelTitles[i]?.level ?? 0) <= (levelTitles[i - 1]?.level ?? 0))
          throw new Error("Title levels must increase from one title to the next.");
      }
      return api.adminUpdateSettings({
        adminToken: token,
        googleClientId: googleClientId.trim(),
        minWithdrawCents,
        userSharePct: pct(userSharePct, "User share"),
        affiliateEarningPct: pct(affiliateEarningPct, "Affiliate earning commission"),
        affiliateSpendingPct: pct(affiliateSpendingPct, "Affiliate spending commission"),
        postbackSecret: postbackSecret.trim() === "" ? undefined : postbackSecret.trim(),
        theoremReachSecret: theoremReachSecret.trim() === "" ? undefined : theoremReachSecret.trim(),
        offerwallggApiKey: offerwallggApiKey.trim() === "" ? undefined : offerwallggApiKey.trim(),
        pubscaleSecretKey: pubscaleSecretKey.trim() === "" ? undefined : pubscaleSecretKey.trim(),
        checkinGoalCents,
        checkinRewardsCents: checkinRewardsCents as number[],
        levelCentsPerLevel,
        levelTitles,
        socialDiscord: (social["discord"] ?? "").trim(),
        socialYoutube: (social["youtube"] ?? "").trim(),
        socialTiktok: (social["tiktok"] ?? "").trim(),
        socialTwitter: (social["twitter"] ?? "").trim(),
        socialFacebook: (social["facebook"] ?? "").trim(),
        socialInstagram: (social["instagram"] ?? "").trim(),
        socialTelegram: (social["telegram"] ?? "").trim(),
        adminUsername: adminUsername.trim() || undefined,
        adminPassword: adminPassword === "" ? undefined : adminPassword,
      });
    },
    onSuccess: () => {
      setOkMsg("Settings saved — they apply across the whole site right away.");
      setPostbackSecret("");
      setTheoremReachSecret("");
      setOfferwallggApiKey("");
      setAdminPassword("");
      void queryClient.invalidateQueries({ queryKey: ["admin-overview", token] });
      void queryClient.invalidateQueries({ queryKey: ["public-home"] });
    },
    onError: (e) => setError(e.message),
  });

  // Dedicated save for the Admin login section ONLY: writes the new
  // username/password to the server settings, where adminLogin checks
  // them — so after saving, the old credentials stop working and the
  // next admin login works only with the new ones. The current admin
  // session stays signed in.
  const saveLogin = useMutation({
    mutationFn: async () => {
      const u = adminUsername.trim();
      if (u.length < 3)
        throw new Error("Admin username must be at least 3 characters.");
      if (adminPassword !== "" && adminPassword.length < 6)
        throw new Error(
          "New admin password must be at least 6 characters — or leave it blank to keep the current password.",
        );
      return api.adminUpdateSettings({
        adminToken: token,
        adminUsername: u,
        adminPassword: adminPassword === "" ? undefined : adminPassword,
      });
    },
    onSuccess: () => {
      setLoginError(null);
      setLoginMsg(
        "Admin login saved on the server. Next time, sign in with the new username and password — the old ones no longer work.",
      );
      setAdminPassword("");
      void queryClient.invalidateQueries({ queryKey: ["admin-overview", token] });
    },
    onError: (e) => {
      setLoginMsg(null);
      setLoginError(e.message);
    },
  });

  const fieldCls =
    "mt-1 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm outline-none focus:border-[var(--brand)]";

  if (overview.isPending) return <p className="text-sm text-[var(--dim)]">Loading…</p>;

  return (
    <div>
      <h1 className="font-display text-2xl font-extrabold">Settings</h1>
      {error && (
        <p role="alert" className="mt-3 text-sm font-medium text-red-600 dark:text-red-400">{error}</p>
      )}
      {okMsg && (
        <p role="status" className="mt-3 text-sm font-medium text-[var(--brand-deep)] dark:text-[var(--brand)]">{okMsg}</p>
      )}
      <form
        className="mt-5 space-y-6"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          setOkMsg(null);
          save.mutate();
        }}
      >
        <section className="rounded-3xl bg-[var(--surface)] p-5 ring-1 ring-[var(--border)] sm:p-6">
          <h2 className="font-display text-lg font-bold">Google sign-in</h2>
          <div className="mt-3">
            <label htmlFor="set-gcid" className="text-sm font-semibold">Google OAuth Client ID</label>
            <input id="set-gcid" {...FIELDS.adminUpdateSettings.googleClientId} value={googleClientId} onChange={(e) => setGoogleClientId(e.target.value)} className={fieldCls} />
            <p className="mt-1.5 text-xs leading-relaxed text-[var(--dim)]">
              Project TapOne (tapone-515305). Sign-in verifies against this ID, and Google
              only allows it from web addresses approved in Google Cloud Console.
            </p>
            <div className="mt-3 rounded-xl bg-[var(--surface-2)] p-3 ring-1 ring-[var(--border)]">
              <p className="text-xs font-semibold">
                This version's address — add it in Google Cloud Console → Credentials → the
                TapOne OAuth client, or Google refuses sign-in here:
              </p>
              <p className="mt-2 text-xs text-[var(--dim)]">Authorized JavaScript origins:</p>
              <p className="mt-0.5 select-all break-all font-mono text-xs">{getSiteOrigin()}</p>
              <p className="mt-2 text-xs text-[var(--dim)]">Authorized redirect URIs (for the full-page sign-in):</p>
              <p className="mt-0.5 select-all break-all font-mono text-xs">{getGoogleRedirectUri()}</p>
              <p className="mt-2 text-xs leading-relaxed text-[var(--dim)]">
                https://tapone.store is already approved. The test version runs on the
                address above, so its Google button stays empty until this address is
                added too. While the OAuth app is in Testing mode, the Google account
                must also be listed under Test users in the consent screen.
              </p>
            </div>
          </div>
        </section>

        <section className="rounded-3xl bg-[var(--surface)] p-5 ring-1 ring-[var(--border)] sm:p-6">
          <h2 className="font-display text-lg font-bold">Social links — shown in the footer to all users</h2>
          <p className="mt-1 text-sm leading-relaxed text-[var(--dim)]">
            Paste the full link for each page and press “Save settings” at the
            bottom. Saved links are stored in the database and appear in the
            footer of the homepage and the dashboard for every user right
            away. Leave a field blank to hide that platform.
          </p>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            {(
              [
                ["youtube", "YouTube", "socialYoutube"],
                ["tiktok", "TikTok", "socialTiktok"],
                ["facebook", "Facebook", "socialFacebook"],
                ["discord", "Discord", "socialDiscord"],
                ["twitter", "X (Twitter)", "socialTwitter"],
                ["telegram", "Telegram", "socialTelegram"],
                ["instagram", "Instagram", "socialInstagram"],
              ] as const
            ).map(([id, label, field]) => (
              <div key={id}>
                <label htmlFor={`set-${id}`} className="text-sm font-semibold">{label} link</label>
                <input
                  id={`set-${id}`}
                  {...FIELDS.adminUpdateSettings[field]}
                  value={social[id] ?? ""}
                  onChange={(e) => setSocial((prev) => ({ ...prev, [id]: e.target.value }))}
                  placeholder={`https://… your ${label} page`}
                  inputMode="url"
                  className={fieldCls}
                />
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-3xl bg-[var(--surface)] p-5 ring-1 ring-[var(--border)] sm:p-6">
          <h2 className="font-display text-lg font-bold">Money</h2>
          <div className="mt-3 grid gap-4 sm:grid-cols-3">
            <div>
              <label htmlFor="set-min" className="text-sm font-semibold">Minimum withdrawal ($)</label>
              <input id="set-min" value={minWithdraw} onChange={(e) => setMinWithdraw(e.target.value)} inputMode="decimal" className={fieldCls} />
            </div>
            <div>
              <label htmlFor="set-checkin-goal" className="text-sm font-semibold">Check-in daily goal ($)</label>
              <input id="set-checkin-goal" value={checkinGoal} onChange={(e) => setCheckinGoal(e.target.value)} inputMode="decimal" className={fieldCls} />
              <p className="mt-1 text-xs leading-relaxed text-[var(--dim)]">
                A check-in day completes automatically when the user earns
                this much that day (offers, surveys or invite commissions).
              </p>
            </div>

            <div>
              <label htmlFor="set-share" className="text-sm font-semibold">User share of payouts (%)</label>
              <input id="set-share" {...FIELDS.adminUpdateSettings.userSharePct} value={userSharePct} onChange={(e) => setUserSharePct(e.target.value)} inputMode="numeric" className={fieldCls} />
            </div>
            <div>
              <label htmlFor="set-aep" className="text-sm font-semibold">Affiliate earning commission (%)</label>
              <input id="set-aep" {...FIELDS.adminUpdateSettings.affiliateEarningPct} value={affiliateEarningPct} onChange={(e) => setAffiliateEarningPct(e.target.value)} inputMode="numeric" className={fieldCls} />
            </div>
            <div>
              <label htmlFor="set-asp" className="text-sm font-semibold">Affiliate spending commission (%)</label>
              <input id="set-asp" {...FIELDS.adminUpdateSettings.affiliateSpendingPct} value={affiliateSpendingPct} onChange={(e) => setAffiliateSpendingPct(e.target.value)} inputMode="numeric" className={fieldCls} />
            </div>
          </div>
          <div className="mt-5 border-t border-[var(--border)] pt-4">
            <p className="text-sm font-semibold">Weekly check-in — each day's bonus ($)</p>
            <p className="mt-1 text-xs leading-relaxed text-[var(--dim)]">
              Each calendar day pays its own amount when the user reaches the
              daily goal above; the bonus is credited at that moment. A missed
              day loses only that day — the next day still pays its own full
              amount. Week total:{" "}
              <strong className="text-[var(--text)]">
                $
                {checkinDays
                  .reduce((sum, d) => sum + (Number.parseFloat(d) || 0), 0)
                  .toFixed(2)}
              </strong>
            </p>
            <div className="mt-3 grid grid-cols-4 gap-3 sm:grid-cols-7">
              {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day, i) => (
                <div key={day}>
                  <label htmlFor={`set-checkin-${i}`} className="text-sm font-semibold">{day}</label>
                  <input
                    id={`set-checkin-${i}`}
                    value={checkinDays[i] ?? ""}
                    onChange={(e) =>
                      setCheckinDays((prev) => prev.map((x, j) => (j === i ? e.target.value : x)))
                    }
                    inputMode="decimal"
                    className={fieldCls}
                  />
                </div>
              ))}
            </div>
          </div>
        </section>


        <section className="rounded-3xl bg-[var(--surface)] p-5 ring-1 ring-[var(--border)] sm:p-6">
          <h2 className="font-display text-lg font-bold">Levels &amp; Title Rewards</h2>
          <p className="mt-1 text-sm leading-relaxed text-[var(--dim)]">
            A user's level is their lifetime earnings divided by the amount
            per level. The moment a user reaches a title, that title's
            one-time reward is credited to their balance automatically —
            once per title per user, never twice. With the built-in amounts
            (Bronze $5, Silver $5, Gold $15, Diamond $25, Champion $50,
            Master $900) the rewards total exactly $1,000 per user. A user
            who already passed a title gets its reward on their next
            earning. Changing an amount here applies to rewards paid after
            the save; a title already paid to a user is never paid again.
            (The Standard/Enhanced % columns are kept from the old bonus
            table and no longer pay anything.)
          </p>
          <div className="mt-3 max-w-xs">
            <label htmlFor="set-per-level" className="text-sm font-semibold">Earnings per level ($)</label>
            <input id="set-per-level" value={centsPerLevel} onChange={(e) => setCentsPerLevel(e.target.value)} inputMode="decimal" className={fieldCls} />
          </div>
          <div className="mt-4 space-y-2">
            {titleRows.map((t, i) => (
              <div key={i} className="grid grid-cols-2 gap-3 rounded-2xl bg-[var(--surface-2)] p-3 ring-1 ring-[var(--border)] sm:grid-cols-[1fr_110px_110px_110px_110px_auto]">
                <div>
                  <label htmlFor={`title-name-${i}`} className="text-xs font-semibold text-[var(--dim)]">Title</label>
                  <input
                    id={`title-name-${i}`}
                    value={t.name}
                    onChange={(e) =>
                      setTitleRows((prev) => prev.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))
                    }
                    className={fieldCls}
                  />
                </div>
                <div>
                  <label htmlFor={`title-level-${i}`} className="text-xs font-semibold text-[var(--dim)]">From level</label>
                  <input
                    id={`title-level-${i}`}
                    value={t.level}
                    onChange={(e) =>
                      setTitleRows((prev) => prev.map((x, j) => (j === i ? { ...x, level: e.target.value } : x)))
                    }
                    inputMode="numeric"
                    className={fieldCls}
                  />
                </div>
                <div>
                  <label htmlFor={`title-std-${i}`} className="text-xs font-semibold text-[var(--dim)]">Standard %</label>
                  <input
                    id={`title-std-${i}`}
                    value={t.standardPct}
                    onChange={(e) =>
                      setTitleRows((prev) => prev.map((x, j) => (j === i ? { ...x, standardPct: e.target.value } : x)))
                    }
                    inputMode="numeric"
                    className={fieldCls}
                  />
                </div>
                <div>
                  <label htmlFor={`title-enh-${i}`} className="text-xs font-semibold text-[var(--dim)]">Enhanced %</label>
                  <input
                    id={`title-enh-${i}`}
                    value={t.enhancedPct}
                    onChange={(e) =>
                      setTitleRows((prev) => prev.map((x, j) => (j === i ? { ...x, enhancedPct: e.target.value } : x)))
                    }
                    inputMode="numeric"
                    className={fieldCls}
                  />
                </div>
                <div>
                  <label htmlFor={`title-reward-${i}`} className="text-xs font-semibold text-[var(--dim)]">One-time reward ($)</label>
                  <input
                    id={`title-reward-${i}`}
                    value={t.reward}
                    onChange={(e) =>
                      setTitleRows((prev) => prev.map((x, j) => (j === i ? { ...x, reward: e.target.value } : x)))
                    }
                    inputMode="decimal"
                    className={fieldCls}
                  />
                </div>
                <div className="flex items-end">
                  <button
                    type="button"
                    aria-label={`Remove title ${t.name || i + 1}`}
                    disabled={titleRows.length <= 1}
                    onClick={() => setTitleRows((prev) => prev.filter((_, j) => j !== i))}
                    className="rounded-xl px-3 py-2.5 text-sm font-bold text-red-600 ring-1 ring-[var(--border)] disabled:opacity-40 dark:text-red-400"
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-3 text-sm font-semibold">
            Total one-time rewards across all titles: $
            {titleRows.reduce((sum, t) => sum + (Number.parseFloat(t.reward) || 0), 0).toFixed(2)}
            {" "}per user
          </p>
          {titleRows.length < 8 && (
            <button
              type="button"
              onClick={() =>
                setTitleRows((prev) => [
                  ...prev,
                  { name: "", level: "", standardPct: "", enhancedPct: "", reward: "" },
                ])
              }
              className="mt-3 rounded-full px-4 py-2 text-sm font-bold ring-1 ring-[var(--border)]"
            >
              + Add a title
            </button>
          )}
        </section>

        <section className="rounded-3xl bg-[var(--surface)] p-5 ring-1 ring-[var(--border)] sm:p-6">
          <h2 className="font-display text-lg font-bold">Postback security</h2>
          <div className="mt-3">
            <label htmlFor="set-secret" className="text-sm font-semibold">
              Postback secret {s?.postbackSecretSet ? <span className="text-[var(--brand-deep)] dark:text-[var(--brand)]">(currently set)</span> : <span className="text-[var(--dim)]">(not set — postbacks are open)</span>}
            </label>
            <input id="set-secret" {...FIELDS.adminUpdateSettings.postbackSecret} value={postbackSecret} onChange={(e) => setPostbackSecret(e.target.value)} placeholder="Type a new secret to change it" className={fieldCls} />
          </div>
          <div className="mt-5">
            <label htmlFor="set-tr-secret" className="text-sm font-semibold">
              TheoremReach secret key {s?.theoremReachSecretSet ? <span className="text-[var(--brand-deep)] dark:text-[var(--brand)]">(currently set — callbacks are signature-checked)</span> : <span className="text-[var(--dim)]">(not set — TheoremReach callbacks are NOT verified)</span>}
            </label>
            <input id="set-tr-secret" {...FIELDS.adminUpdateSettings.theoremReachSecret} value={theoremReachSecret} onChange={(e) => setTheoremReachSecret(e.target.value)} placeholder="Paste the Secret Key from your TheoremReach app" className={fieldCls} />
            <p className="mt-1.5 text-xs leading-relaxed text-[var(--dim)]">
              Find it in the TheoremReach publisher dashboard, in the TapOne
              app&apos;s details. TapOne uses it to verify the signature on
              every TheoremReach reward callback — a callback with a wrong
              signature never credits anyone. Set the callback URL in the
              same app (see Overview → TheoremReach callback).
            </p>
          </div>
          <div className="mt-5">
            <label htmlFor="set-owgg-key" className="text-sm font-semibold">
              Offerwall.GG API key {s?.offerwallggApiKeySet ? <span className="text-[var(--brand-deep)] dark:text-[var(--brand)]">(currently set — Offerwall.GG games can list in the Games tab)</span> : <span className="text-[var(--dim)]">(not set — no Offerwall.GG games will list)</span>}
            </label>
            <input id="set-owgg-key" value={offerwallggApiKey} onChange={(e) => setOfferwallggApiKey(e.target.value)} placeholder="Paste the secret key from your Offerwall.GG dashboard (API page)" className={fieldCls} />
            <p className="mt-1.5 text-xs leading-relaxed text-[var(--dim)]">
              Server-only — it is sent only as the X-Api-Key header when
              TapOne fetches Offerwall.GG games for a user, and is never
              shown to users. Find it in the Offerwall.GG publisher
              dashboard. The Games tab also needs a Games Content row for
              Offerwall.GG (Items feed URL: https://offerwall.gg/api/v1/offers).
            </p>
          </div>
          <div className="mt-5">
            <label htmlFor="set-ps-secret" className="text-sm font-semibold">
              PubScale S2S secret key {s?.pubscaleSecretSet ? <span className="text-[var(--brand-deep)] dark:text-[var(--brand)]">(currently set — PubScale callbacks are signature-checked)</span> : <span className="text-[var(--dim)]">(not set — PubScale callbacks are refused, nothing credits)</span>}
            </label>
            <input id="set-ps-secret" value={pubscaleSecretKey} onChange={(e) => setPubscaleSecretKey(e.target.value)} placeholder="Paste the S2S secret key from your PubScale dashboard (Settings → API Key)" className={fieldCls} />
            <p className="mt-1.5 text-xs leading-relaxed text-[var(--dim)]">
              Server-only — TapOne uses it to verify the MD5 signature on
              every PubScale reward callback, and it is never shown to
              users. Find it in the PubScale dashboard, provided along
              with the App API key. The PubScale wall card also needs the
              S2S Callback URL set in the PubScale dashboard to
              https://www.tapone.store/pubscale-callback — without it,
              wall completions never reach TapOne.
            </p>
          </div>
        </section>

        <section className="rounded-3xl bg-[var(--surface)] p-5 ring-1 ring-[var(--border)] sm:p-6">
          <h2 className="font-display text-lg font-bold">Admin login — change username &amp; password</h2>
          <p className="mt-1.5 text-sm leading-relaxed text-[var(--dim)]">
            Change the username and password for this admin panel. The
            change is saved on the server: after saving, the old username
            and password stop working, and the next admin login works only
            with the new ones. You stay signed in here.
          </p>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="set-admuser" className="text-sm font-semibold">Admin username</label>
              <input id="set-admuser" {...FIELDS.adminUpdateSettings.adminUsername} value={adminUsername} onChange={(e) => setAdminUsername(e.target.value)} className={fieldCls} />
            </div>
            <div>
              <label htmlFor="set-admpass" className="text-sm font-semibold">New admin password <span className="font-normal text-[var(--dim)]">(blank = keep current)</span></label>
              <input id="set-admpass" type="password" {...FIELDS.adminUpdateSettings.adminPassword} value={adminPassword} onChange={(e) => setAdminPassword(e.target.value)} className={fieldCls} />
            </div>
          </div>
          {loginError && (
            <p role="alert" className="mt-3 text-sm font-medium text-red-600 dark:text-red-400">{loginError}</p>
          )}
          {loginMsg && (
            <p role="status" className="mt-3 text-sm font-medium text-[var(--brand-deep)] dark:text-[var(--brand)]">{loginMsg}</p>
          )}
          <button
            type="button"
            disabled={saveLogin.isPending}
            onClick={() => { setLoginMsg(null); setLoginError(null); saveLogin.mutate(); }}
            className="mt-4 rounded-full bg-[var(--brand)] px-6 py-2.5 font-display text-sm font-bold text-white transition hover:bg-[var(--brand-deep)] disabled:opacity-60"
          >
            {saveLogin.isPending ? "Saving…" : "Save admin login"}
          </button>
        </section>

        <button type="submit" disabled={save.isPending} className="rounded-full bg-[var(--brand)] px-8 py-3 font-display text-base font-bold text-white transition hover:bg-[var(--brand-deep)] disabled:opacity-60">
          {save.isPending ? "Saving…" : "Save settings"}
        </button>
      </form>
    </div>
  );
}
