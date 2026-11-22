import { useEffect, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { actionFields } from "@hatch/space-sdk/fields" with { type: "macro" };
import { api, type ApiResponse } from "./api";
import type { Actions } from "../../server/src/actions";
import { Icons, MethodLogo, applyThemeMode, fmt, fmtDate, fmtDateTime, getThemeMode, isAuthError } from "./lib";
import { fileToBase64 } from "@hatch/space-sdk/client";
import { FooterThemePill, Wordmark } from "./App";

const FIELDS = actionFields<typeof Actions>();

export type DashboardTab =
  | "dashboard"
  | "offers"
  | "surveys"
  | "playtime"
  | "apps"
  | "partners"
  | "leaderboard"
  | "level"
  | "cashout"
  | "withdraw"
  | "invite"
  | "referrals"
  | "history"
  | "profile"
  | "help"
  | "contact";

const TABS: { id: DashboardTab; label: string; icon: (c?: string) => ReactNode }[] = [
  { id: "dashboard", label: "Dashboard", icon: Icons.home },
  { id: "offers", label: "Offers", icon: Icons.grid },
  { id: "surveys", label: "Surveys", icon: Icons.survey },
  { id: "playtime", label: "Playtime", icon: Icons.game },
  { id: "apps", label: "Apps", icon: Icons.grid },
  { id: "partners", label: "Surveys partners", icon: Icons.users },
  { id: "leaderboard", label: "Leaderboard", icon: Icons.trophy },
  { id: "level", label: "Level & Privileges", icon: Icons.chart },
  { id: "cashout", label: "Live Cashout", icon: Icons.wallet },
  { id: "withdraw", label: "Withdraw", icon: Icons.wallet },
  { id: "invite", label: "Invite Friends", icon: Icons.users },
  { id: "referrals", label: "Referrals", icon: Icons.users },
  { id: "history", label: "History", icon: Icons.history },
  { id: "profile", label: "Profile", icon: Icons.user },
  { id: "help", label: "Help", icon: Icons.mail },
  { id: "contact", label: "Contact us", icon: Icons.mail },
];

type MeData = ApiResponse<typeof api, "getMe">;
type User = MeData["user"];

const KIND_LABELS: Record<string, string> = {
  offer_credit: "Offer earning",
  affiliate_earning: "Affiliate commission",
  affiliate_spending: "Affiliate spending commission",
  withdrawal_hold: "Withdrawal requested",
  withdrawal_refund: "Withdrawal refund",
  admin_adjust: "Adjustment",
  checkin_bonus: "Check-in bonus",
  contest_prize: "Daily contest prize",
  level_reward: "Level reward",
};

function StatusChip({ status }: { status: "pending" | "approved" | "rejected" }) {
  const styles = {
    pending: "bg-[var(--gold)]/15 text-[#9a6200] dark:text-[var(--gold)]",
    approved: "bg-[var(--brand)]/15 text-[var(--brand-deep)] dark:text-[var(--brand)]",
    rejected: "bg-red-500/10 text-red-600 dark:text-red-400",
  } as const;
  const labels = { pending: "Pending", approved: "Approved", rejected: "Rejected" } as const;
  return (
    <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${styles[status]}`}>
      {labels[status]}
    </span>
  );
}

export function Dashboard({
  token,
  onSignOut,
}: {
  token: string;
  onSignOut: () => void;
}) {
  const [tab, setTab] = useState<DashboardTab>(() => {
    try {
      const saved = window.localStorage.getItem("tapone3.tab");
      if (saved && TABS.some((t) => t.id === saved)) return saved as DashboardTab;
    } catch {
      /* ignore */
    }
    return "dashboard";
  });
  const [menuOpen, setMenuOpen] = useState(false);
  const [avatarOpen, setAvatarOpen] = useState(false);
  const [themeMode, setThemeMode] = useState<"light" | "dark">(() => getThemeMode());
  const queryClient = useQueryClient();

  const me = useQuery({
    queryKey: ["me", token],
    queryFn: () => api.getMe({ token }),
    // Transient failures (a phone connection hiccup while the
    // dashboard is opening) are retried — the session is still valid.
    // Only a dead session fails fast. An earlier version used
    // retry:false + sign-out on ANY error, so one hiccup right after
    // signing in silently threw the visitor back to the homepage and
    // the sign-in looked like it did nothing.
    retry: (count, err) => !isAuthError(err) && count < 2,
  });

  const home = useQuery({
    queryKey: ["public-home"],
    queryFn: () => api.getPublicHome({}),
  });
  const socialLinks = home.data?.socialLinks ?? [];

  // Sign out ONLY when the session itself is dead (signed out /
  // account gone / blocked). A network error keeps the session and
  // shows the retry panel below instead of ejecting the user.
  const bouncedRef = useRef(false);
  useEffect(() => {
    if (me.isError && isAuthError(me.error) && !bouncedRef.current) {
      bouncedRef.current = true;
      onSignOut();
    }
  }, [me.isError, me.error, onSignOut]);

  const user = me.data?.user;

  // The dark/light choice saved on the account wins over the device copy.
  const savedTheme = user?.theme;
  useEffect(() => {
    if (savedTheme) {
      applyThemeMode(savedTheme === "dark" ? "dark" : "light");
      setThemeMode(savedTheme === "dark" ? "dark" : "light");
    }
  }, [savedTheme]);

  const pick = (t: DashboardTab) => {
    setTab(t);
    setMenuOpen(false);
    try {
      window.localStorage.setItem("tapone3.tab", t);
    } catch {
      /* ignore */
    }
    void queryClient.invalidateQueries();
  };

  const navButton = (t: (typeof TABS)[number]) => (
    <button
      key={t.id}
      type="button"
      onClick={() => pick(t.id)}
      aria-current={tab === t.id ? "page" : undefined}
      className={`flex w-full items-center gap-3 rounded-full px-3.5 py-2.5 text-sm font-semibold transition ${
        tab === t.id
          ? "bg-[var(--brand)] text-white shadow-md shadow-[var(--brand)]/25"
          : "text-[var(--dim)] hover:bg-[var(--surface)] hover:text-[var(--text)]"
      }`}
    >
      {t.icon("h-5 w-5")}
      {t.label}
      {(t.id === "help" || t.id === "contact") && me.data && me.data.unreadMessages > 0 && (
        <span className="ml-auto rounded-full bg-[var(--gold)] px-2 py-0.5 text-xs font-bold text-[var(--ink)]">
          {me.data.unreadMessages}
        </span>
      )}
    </button>
  );

  return (
    <div className="min-h-screen bg-[var(--dash-bg)] text-[var(--text)] lg:flex">
      {/* desktop sidebar — light grey, orange active pill */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col overflow-y-auto bg-[var(--surface-2)] p-4 lg:flex">
        <Wordmark />
        {user && (
          <div className="mt-5 flex items-center gap-3 rounded-2xl bg-[var(--surface)] p-3 ring-1 ring-[var(--border)]">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[var(--avatar)] font-display font-extrabold text-white">
              {user.pictureUrl ? (
                <img src={user.pictureUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                user.name.charAt(0).toUpperCase()
              )}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-bold">{user.name}</span>
              <span className="block truncate text-xs text-[var(--dim)]">{user.email}</span>
            </span>
          </div>
        )}
        <nav className="mt-5 flex-1 space-y-1" aria-label="Dashboard">
          {TABS.map((t) => navButton(t))}
        </nav>
        <button
          type="button"
          onClick={onSignOut}
          className="flex items-center gap-3 rounded-full px-3.5 py-2.5 text-sm font-semibold text-[var(--dim)] transition hover:bg-[var(--surface)] hover:text-[var(--text)]"
        >
          {Icons.logout("h-5 w-5")} Sign out
        </button>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* top bar — white on mobile and desktop */}
        <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--surface)] px-4 pb-3 pt-safe lg:py-3">
          <span className="lg:hidden">
            <Wordmark />
          </span>
          <span className="hidden font-display text-base font-bold lg:block">
            {TABS.find((t) => t.id === tab)?.label ?? "Dashboard"}
          </span>
          <span className="flex items-center gap-2.5">
            {user && (
              <span className="rounded-full bg-[var(--pill)] px-3.5 py-1.5 font-display text-sm font-bold text-[var(--text)] ring-1 ring-[var(--border)]">
                Balance {fmt(user.balanceCents)}
              </span>
            )}
            {user && <NotificationBell token={token} />}
            {user && (
              <span className="relative">
                <button
                  type="button"
                  aria-label="Profile menu"
                  aria-haspopup="menu"
                  aria-expanded={avatarOpen}
                  onClick={() => setAvatarOpen((v) => !v)}
                  className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full bg-[var(--avatar)] font-display text-base font-extrabold text-white ring-2 ring-[var(--border)]"
                >
                  {user.pictureUrl ? (
                    <img src={user.pictureUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    user.name.charAt(0).toUpperCase()
                  )}
                </button>
                {avatarOpen && (
                  <>
                    <button
                      type="button"
                      aria-label="Close profile menu"
                      className="fixed inset-0 z-10 cursor-default"
                      onClick={() => setAvatarOpen(false)}
                    />
                    <span
                      role="menu"
                      className="absolute right-0 z-20 mt-2 block w-60 overflow-hidden rounded-2xl bg-[var(--surface)] text-left shadow-xl ring-1 ring-[var(--border)]"
                    >
                      <span className="block border-b border-[var(--border)] px-4 py-3">
                        <span className="block truncate text-sm font-bold">{user.name}</span>
                        <span className="block truncate text-xs text-[var(--dim)]">{user.email}</span>
                      </span>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => { setAvatarOpen(false); pick("profile"); }}
                        className="flex w-full items-center gap-3 px-4 py-3 text-sm font-semibold hover:bg-[var(--surface-2)]"
                      >
                        {Icons.user("h-5 w-5")} Account
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => { setAvatarOpen(false); pick("history"); }}
                        className="flex w-full items-center gap-3 px-4 py-3 text-sm font-semibold hover:bg-[var(--surface-2)]"
                      >
                        {Icons.history("h-5 w-5")} History
                      </button>
                      <span className="flex items-center justify-between gap-3 border-t border-[var(--border)] px-4 py-3">
                        <span className="text-sm font-semibold">Currency</span>
                        <span className="font-display text-sm font-bold">$ USD</span>
                      </span>
                      <span className="flex items-center justify-between gap-3 border-t border-[var(--border)] px-4 py-3">
                        <span className="flex items-center gap-2 text-sm font-semibold">
                          Interface
                          <span className="rounded-full bg-[var(--gold)] px-2 py-0.5 text-[10px] font-extrabold text-[var(--ink)]">NEW</span>
                        </span>
                        <span className="flex overflow-hidden rounded-full ring-1 ring-[var(--border)]">
                          {(["light", "dark"] as const).map((m) => (
                            <button
                              key={m}
                              type="button"
                              aria-pressed={themeMode === m}
                              onClick={() => { applyThemeMode(m); setThemeMode(m); void api.setThemePreference({ token, mode: m }).catch(() => undefined); }}
                              className={`px-3 py-1.5 text-xs font-bold capitalize ${
                                themeMode === m
                                  ? "bg-[var(--brand)] text-white"
                                  : "bg-[var(--surface)] text-[var(--dim)]"
                              }`}
                            >
                              {m}
                            </button>
                          ))}
                        </span>
                      </span>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => { setAvatarOpen(false); onSignOut(); }}
                        className="flex w-full items-center gap-3 border-t border-[var(--border)] px-4 py-3 text-sm font-semibold text-red-600 hover:bg-[var(--surface-2)] dark:text-red-400"
                      >
                        {Icons.logout("h-5 w-5")} Logout
                      </button>
                    </span>
                  </>
                )}
              </span>
            )}
          </span>
        </header>

        <main className="mx-auto w-full max-w-5xl flex-1 px-3 pb-28 pt-4 sm:px-4 sm:pt-5 lg:pb-10 lg:pt-8">
          {me.isError && !isAuthError(me.error) ? (
            <div className="py-16 text-center">
              <p className="font-display text-lg font-bold text-[var(--text)]">
                Couldn't load your dashboard
              </p>
              <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-[var(--dim)]">
                The connection hiccuped while loading your account. Your
                sign-in is still saved — try again.
              </p>
              <button
                type="button"
                onClick={() => void me.refetch()}
                disabled={me.isFetching}
                className="mt-5 rounded-full bg-[var(--brand)] px-6 py-2.5 font-display text-sm font-bold text-white transition hover:bg-[var(--brand-deep)] disabled:opacity-60"
              >
                {me.isFetching ? "Trying again…" : "Try again"}
              </button>
            </div>
          ) : me.isPending || !user ? (
            <p className="py-16 text-center text-sm text-[var(--dim)]">Loading your account…</p>
          ) : (
            <>
              {tab === "dashboard" && (
                <DashboardHome token={token} user={user} go={pick} />
              )}
              {tab === "offers" && (<><ContentSection token={token} kind="offerwall" includeSurveyWalls /><MyOffersPanel token={token} /></>)}
              {tab === "surveys" && <SurveysSection token={token} />}
              {tab === "playtime" && <GamesSection token={token} />}
              {tab === "apps" && <ContentSection token={token} kind="offerwall" heading="Apps" />}
              {tab === "partners" && <ContentSection token={token} kind="survey" heading="Surveys partners" />}
              {tab === "cashout" && <WithdrawTab token={token} />}
              {tab === "withdraw" && <WithdrawTab token={token} />}
              {tab === "history" && <HistoryTab token={token} />}
              {tab === "leaderboard" && <LeaderboardTab token={token} />}
              {tab === "level" && <LevelTab token={token} go={pick} />}
              {tab === "invite" && <AffiliateTab token={token} />}
              {tab === "referrals" && <AffiliateTab token={token} />}
              {tab === "profile" && <ProfileTab token={token} user={user} go={pick} onSignOut={onSignOut} />}
              {tab === "help" && <HelpTab token={token} />}
              {tab === "contact" && <ContactTab />}
            </>
          )}
        </main>

        <footer className="bg-[var(--ink-soft)] px-4 py-5 pb-24 text-center text-xs text-white/60 lg:pb-5">
          {/* Follow Us row — social links only. NO RSS/WiFi icon
              here (owner order 2026-11-20): the hidden owner entry
              lives ONLY in the pre-login homepage footer; inside a
              signed-in account nothing may open the admin panel. */}
          <div className="mb-4 flex flex-wrap items-center justify-center gap-2" aria-label="Follow us">
            <span className="font-display text-sm font-bold text-white">Follow us</span>
            {socialLinks.map((s) => (
              <a
                key={s.platform}
                href={s.url}
                target="_blank"
                rel="noreferrer"
                className="rounded-full bg-white/10 px-4 py-2 text-sm font-bold text-white ring-1 ring-white/15 transition hover:bg-[var(--brand)]"
              >
                {s.label}
              </a>
            ))}
          </div>
          <span className="flex flex-wrap items-center justify-center gap-3 lg:justify-start">
            <FooterThemePill token={token} />
            <span>© 2026 TapOne. All rights reserved. · Launched 19 November 2026 · All amounts in USD.</span>
          </span>
        </footer>

        {/* mobile bottom nav — white bar, orange active */}
        <nav
          className="fixed inset-x-0 bottom-0 z-30 border-t border-[var(--border)] bg-[var(--surface)] pb-safe text-[var(--text)] lg:hidden"
          aria-label="Dashboard"
        >
          <div className="grid grid-cols-5">
            {(
              [
                TABS.find((t) => t.id === "dashboard"),
                TABS.find((t) => t.id === "offers"),
                TABS.find((t) => t.id === "playtime"),
                TABS.find((t) => t.id === "withdraw"),
                undefined,
              ] as ((typeof TABS)[number] | undefined)[]
            ).map((t, i) =>
              t ? (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => pick(t.id)}
                  aria-current={tab === t.id ? "page" : undefined}
                  className={`flex flex-col items-center gap-1 py-2.5 text-[11px] font-semibold ${
                    tab === t.id ? "text-[var(--brand-deep)]" : "text-[var(--dim)]"
                  }`}
                >
                  {t.icon("h-6 w-6")}
                  {t.label}
                </button>
              ) : (
                <button
                  key={`more-${i}`}
                  type="button"
                  onClick={() => setMenuOpen(true)}
                  className="flex flex-col items-center gap-1 py-2.5 text-[11px] font-semibold text-[var(--dim)]"
                >
                  {Icons.grid("h-6 w-6")}
                  More
                </button>
              ),
            )}
          </div>
        </nav>

        {/* mobile "more" sheet */}
        {menuOpen && (
          <div className="fixed inset-0 z-40 bg-black/50 lg:hidden" role="dialog" aria-label="All sections">
            <div className="absolute inset-x-0 bottom-0 rounded-t-3xl bg-[var(--surface)] p-5 pb-safe">
              <div className="mb-4 flex items-center justify-between">
                <p className="font-display text-lg font-bold">All sections</p>
                <button
                  type="button"
                  aria-label="Close menu"
                  onClick={() => setMenuOpen(false)}
                  className="rounded-full bg-[var(--surface-2)] p-2"
                >
                  {Icons.x("h-5 w-5")}
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {TABS.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => pick(t.id)}
                    className={`flex items-center gap-2.5 rounded-xl px-3.5 py-3 text-sm font-semibold ${
                      tab === t.id
                        ? "bg-[var(--brand)] text-white"
                        : "bg-[var(--surface-2)] text-[var(--text)]"
                    }`}
                  >
                    {t.icon("h-5 w-5")}
                    {t.label}
                    {t.id === "help" && me.data && me.data.unreadMessages > 0 && (
                      <span className="ml-auto rounded-full bg-[var(--gold)] px-2 py-0.5 text-xs font-bold text-[var(--ink)]">
                        {me.data.unreadMessages}
                      </span>
                    )}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={onSignOut}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-red-500/10 px-4 py-3 text-sm font-bold text-red-600 dark:text-red-400"
              >
                {Icons.logout("h-5 w-5")} Sign out
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------ dashboard tab

function DashboardHome({
  token,
  user,
  go,
}: {
  token: string;
  user: User;
  go: (t: DashboardTab) => void;
}) {
  const dash = useQuery({
    queryKey: ["dashboard", token],
    queryFn: () => api.getDashboard({ token }),
  });
  return (
    <div>
      <p className="text-sm font-semibold text-[var(--dim)]">Welcome</p>
      <h1 className="mt-0.5 font-display text-2xl font-extrabold sm:text-3xl">
        Hi, {user.name.split(" ")[0]}
      </h1>

      {/* balance hero */}
      <section className="mt-5 overflow-hidden rounded-3xl bg-[var(--pill)] p-5 ring-1 ring-[var(--border)] sm:p-7" aria-label="Balance">
        <p className="text-sm font-semibold text-[var(--dim)]">Available balance</p>
        <p className="mt-1 font-display text-4xl font-extrabold tracking-tight text-[var(--text)] sm:text-5xl">
          {fmt(user.balanceCents)}
        </p>
        <p className="mt-2 text-sm text-[var(--dim)]">
          Total earned: <span className="font-bold text-[var(--text)]">{fmt(user.totalEarnedCents)}</span>
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => go("withdraw")}
            className="rounded-full bg-[var(--brand)] px-6 py-3 font-display text-base font-bold text-white transition hover:bg-[var(--brand-deep)]"
          >
            Withdraw
          </button>
          <button
            type="button"
            onClick={() => go("offers")}
            className="rounded-full bg-[var(--surface)] px-6 py-3 font-display text-base font-bold text-[var(--text)] ring-1 ring-[var(--border)] transition hover:ring-[var(--brand)]"
          >
            Earn more
          </button>
        </div>
      </section>

      {/* level progress — real level from lifetime earnings */}
      <LevelCard token={token} go={go} />

      {/* quick stats */}
      <section className="mt-4 grid grid-cols-3 gap-2 sm:gap-3" aria-label="Quick stats">
        <div className="rounded-2xl bg-[var(--surface)] p-4 ring-1 ring-[var(--border)]">
          <p className="font-display text-xl font-extrabold">{dash.data?.pendingWithdrawals ?? "–"}</p>
          <p className="mt-0.5 text-xs font-semibold text-[var(--dim)]">Pending withdrawals</p>
        </div>
        <div className="rounded-2xl bg-[var(--surface)] p-4 ring-1 ring-[var(--border)]">
          <p className="font-display text-xl font-extrabold">{dash.data?.referralCount ?? "–"}</p>
          <p className="mt-0.5 text-xs font-semibold text-[var(--dim)]">Referrals</p>
        </div>
        <div className="rounded-2xl bg-[var(--surface)] p-4 ring-1 ring-[var(--border)]">
          <p className="font-display text-xl font-extrabold">
            {dash.data ? fmt(dash.data.affiliateEarnedCents) : "–"}
          </p>
          <p className="mt-0.5 text-xs font-semibold text-[var(--dim)]">Affiliate earned</p>
        </div>
      </section>

      {/* earn shortcuts */}
      <section className="mt-4 grid grid-cols-3 gap-3" aria-label="Earn">
        {(
          [
            { tab: "offers" as DashboardTab, icon: Icons.grid("h-6 w-6"), label: "Offers" },
            { tab: "surveys" as DashboardTab, icon: Icons.survey("h-6 w-6"), label: "Surveys" },
            { tab: "playtime" as DashboardTab, icon: Icons.game("h-6 w-6"), label: "Playtime" },
          ]
        ).map((s) => (
          <button
            key={s.tab}
            type="button"
            onClick={() => go(s.tab)}
            className="flex flex-col items-center gap-2 rounded-2xl bg-[var(--surface)] px-3 py-5 ring-1 ring-[var(--border)] transition hover:ring-[var(--brand)]"
          >
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--pill)] text-[var(--brand)]">
              {s.icon}
            </span>
            <span className="text-sm font-bold">{s.label}</span>
          </button>
        ))}
      </section>

      {/* recent activity */}
      <section className="mt-6" aria-label="Recent activity">
        <h2 className="font-display text-lg font-bold">Recent activity</h2>
        {dash.isPending ? (
          <p className="mt-3 text-sm text-[var(--dim)]">Loading…</p>
        ) : dash.data && dash.data.recent.length > 0 ? (
          <ul className="mt-3 divide-y divide-[var(--border)] rounded-2xl bg-[var(--surface)] px-4 ring-1 ring-[var(--border)]">
            {dash.data.recent.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{t.note || KIND_LABELS[t.kind] || t.kind}</p>
                  <p className="text-xs text-[var(--dim)]">{fmtDateTime(t.createdAt)}</p>
                </div>
                <span
                  className={`font-display text-sm font-bold ${
                    t.amountCents >= 0 ? "text-[var(--brand-deep)] dark:text-[var(--brand)]" : "text-[var(--dim)]"
                  }`}
                >
                  {t.amountCents >= 0 ? "+" : ""}
                  {fmt(t.amountCents)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="mt-3 rounded-2xl border-2 border-dashed border-[var(--border)] bg-[var(--surface)] px-5 py-8 text-center">
            <p className="text-sm leading-relaxed text-[var(--dim)]">
              Nothing here yet. Complete your first offer, survey or game and
              your earnings will show up here.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------- check-in bonus

function CheckinBonus({ token }: { token: string }) {
  const checkin = useQuery({
    queryKey: ["checkin", token],
    queryFn: () => api.getCheckin({ token }),
  });
  const d = checkin.data;
  const todayPct = d
    ? Math.min(100, Math.round((d.todayEarnedCents / d.goalCents) * 100))
    : 0;
  return (
    <section className="mb-6 rounded-3xl bg-[var(--surface)] p-5 ring-1 ring-[var(--border)] sm:p-6" aria-label="Weekly check-in">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-extrabold">
            📅 Weekly Check-in{d ? ` — earn up to ${fmt(d.weekTotalCents)} every week` : ""}
          </h2>
          <p className="mt-1 max-w-md text-sm leading-relaxed text-[var(--dim)]">
            Earn {d ? fmt(d.goalCents) : "$1.00"} in a day — from offers,
            surveys, games or friends you invited — and that day's check-in
            completes by itself. The bonus lands in your balance right
            away; there is no button to press. Every day pays its own
            amount — Monday {d ? fmt(d.scheduleCents[0] ?? 20) : "$0.20"} up
            to Sunday {d ? fmt(d.scheduleCents[6] ?? 70) : "$0.70"} — and
            missing a day never lowers the next day's amount. A new week
            starts every Monday.
          </p>
        </div>
        <span className="rounded-full bg-[var(--pill)] px-3.5 py-1.5 font-display text-sm font-bold text-[var(--text)] ring-1 ring-[var(--border)]">
          📅 Day {d ? Math.max(1, d.days.findIndex((x) => x.isToday) + 1) : 1} of 7
        </span>
      </div>

      <div className="mt-4 flex gap-2" aria-label="This week, Monday to Sunday">
        {(d?.days ?? []).map((day) => (
          <span
            key={day.dayKey}
            className={`flex h-16 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl px-1 text-center ${
              day.completed
                ? "bg-[var(--brand)] text-white"
                : day.isToday
                  ? "bg-[var(--pill)] text-[var(--brand-deep)] ring-2 ring-[var(--brand)]"
                  : day.missed
                    ? "bg-[var(--surface-2)] text-[var(--dim)] opacity-60"
                    : "bg-[var(--surface-2)] text-[var(--dim)]"
            }`}
          >
            <span className="text-xs font-extrabold tracking-wide">{day.label}</span>
            <span className="font-display text-[13px] font-extrabold leading-none">
              {fmt(day.rewardCents)}
            </span>
            <span className="text-[10px] font-bold leading-none" aria-hidden="true">
              {day.completed ? "✓ Done" : day.missed ? "Missed" : day.isToday ? "Today" : ""}
            </span>
          </span>
        ))}
      </div>

      {checkin.isPending ? (
        <p className="mt-4 text-sm text-[var(--dim)]">Loading your week…</p>
      ) : d ? (
        <div className="mt-5 border-t border-[var(--border)] pt-4">
          {d.todayCompleted ? (
            <p role="status" className="text-sm font-semibold text-[var(--brand-deep)] dark:text-[var(--brand)]">
              ✓ Today's check-in is complete — {fmt(d.todayRewardCents)} was
              added to your balance. Come back tomorrow and earn{" "}
              {fmt(d.goalCents)} again for tomorrow's bonus.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-display text-sm font-bold">
                  Today: {fmt(d.todayEarnedCents)} of {fmt(d.goalCents)} earned
                </p>
                <span className="text-xs font-bold text-[var(--dim)]">
                  {fmt(Math.max(0, d.goalCents - d.todayEarnedCents))} to go —
                  completes for {fmt(d.todayRewardCents)}
                </span>
              </div>
              <div className="mt-2.5 h-2.5 overflow-hidden rounded-full bg-[var(--surface-2)]">
                <div
                  className="h-full rounded-full bg-[var(--brand)]"
                  style={{ width: `${todayPct}%` }}
                />
              </div>
              <p className="mt-1.5 text-xs font-semibold text-[var(--dim)]">
                Every dollar you earn today counts — offers, surveys, games
                and invite commissions all add up.
              </p>
            </>
          )}
          <p className="mt-3 text-xs font-semibold text-[var(--dim)]">
            Check-in bonuses earned this week: {fmt(d.weekBonusCents)}
            {d.totalCheckinCents > 0
              ? ` · All time: ${fmt(d.totalCheckinCents)}`
              : ""}
          </p>
        </div>
      ) : null}
    </section>
  );
}

// ------------------------------------------------------------ section stats

function SectionStats({ token, kind }: { token: string; kind: "offerwall" | "survey" | "game" }) {
  const stats = useQuery({
    queryKey: ["my-stats", token],
    queryFn: () => api.getMyStats({ token }),
  });
  const d = stats.data;
  const cells: [string, string][] =
    kind === "survey"
      ? [
          ["Surveys Completed", d ? String(d.surveysCompleted) : "–"],
          ["Survey Earnings", d ? fmt(d.surveyEarningsCents) : "–"],
          ["Pending Earnings", d ? fmt(d.pendingCents) : "–"],
        ]
      : kind === "game"
        ? [
            ["Challenges Completed", d ? String(d.challengesCompleted) : "–"],
            ["Challenge Earnings", d ? fmt(d.challengeEarningsCents) : "–"],
            ["Pending Earnings", d ? fmt(d.pendingCents) : "–"],
          ]
        : [
            ["Offers Completed", d ? String(d.offersCompleted) : "–"],
            ["Offer Earnings", d ? fmt(d.offerEarningsCents) : "–"],
            ["Pending Earnings", d ? fmt(d.pendingCents) : "–"],
          ];
  return (
    <section className="mb-6 grid grid-cols-3 gap-2 sm:gap-3" aria-label="Your stats in this section">
      {cells.map(([label, value]) => (
        <div key={label} className="rounded-2xl bg-[var(--surface)] p-3 ring-1 ring-[var(--border)] sm:p-4">
          <p className="font-display text-lg font-extrabold text-[var(--brand)] sm:text-xl">{value}</p>
          <p className="mt-0.5 text-[11px] font-semibold text-[var(--dim)] sm:text-xs">{label}</p>
        </div>
      ))}
    </section>
  );
}

// ------------------------------------------------------------ content tabs

type ContentListItem = ApiResponse<typeof api, "listContent">["items"][number];

/**
 * Collapses duplicate rows for the same partner to a single card,
 * preferring the featured row (the server dedupes within each kind
 * too; this covers the Offers tab merging offerwalls + survey walls).
 */
function dedupePartners(items: ContentListItem[]): ContentListItem[] {
  const kept: ContentListItem[] = [];
  const indexByPartner = new Map<string, number>();
  for (const item of items) {
    const key =
      (item.provider || "").trim().toLowerCase() ||
      (item.title || "").trim().toLowerCase();
    const at = indexByPartner.get(key);
    if (at === undefined) {
      indexByPartner.set(key, kept.length);
      kept.push(item);
    } else {
      const existing = kept[at];
      if (existing && !existing.featured && item.featured) kept[at] = item;
    }
  }
  return kept;
}

/**
 * Offerwalls card (owner order 2026-11-21, TimeBucks model): ONLY the
 * partner's logo centred on a white card with its name below — no
 * payout, no description, no other text. A small badge (e.g. "+20%")
 * shows when the admin set one for that wall. Tapping the card opens
 * the partner's own wall website in a new tab — that IS the intended
 * behaviour on this tab; the wall itself is the partner's own page
 * with its own offers, TapOne only links to it. Individual surveys
 * and games live on their own tabs, never as wall cards.
 */
function OfferwallCard({ item }: { item: ContentListItem }) {
  const [imgOk, setImgOk] = useState(true);
  const name = item.provider || item.title;
  const inner = (
    <>
      {item.badge && (
        <span className="absolute right-3 top-3 rounded-full bg-green-500 px-2 py-0.5 text-xs font-extrabold text-white">
          {item.badge}
        </span>
      )}
      <span className="flex h-16 items-center justify-center sm:h-20">
        {item.imageUrl && imgOk ? (
          <img
            src={item.imageUrl}
            alt={name}
            className="max-h-16 max-w-[75%] object-contain sm:max-h-20"
            loading="lazy"
            onError={() => setImgOk(false)}
          />
        ) : (
          <span
            className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--surface-2)] font-display text-xl font-extrabold text-[var(--brand)]"
            aria-hidden="true"
          >
            {name.slice(0, 1).toUpperCase()}
          </span>
        )}
      </span>
      <span className="mt-3 block truncate text-center font-display text-sm font-bold text-[var(--text)] sm:text-base">
        {name}
      </span>
    </>
  );
  const cls =
    "relative block rounded-2xl bg-[var(--surface)] px-4 py-6 ring-1 ring-[var(--border)] transition hover:ring-[var(--brand)]";
  return item.url ? (
    <a
      href={item.url}
      target="_blank"
      rel="noreferrer"
      aria-label={`Open ${name}`}
      className={cls}
    >
      {inner}
    </a>
  ) : (
    <div className={cls} aria-label={name}>
      {inner}
    </div>
  );
}

function ContentSection({
  token,
  kind,
  heading,
  includeSurveyWalls,
}: {
  token: string;
  kind: "offerwall" | "survey" | "game";
  heading?: string;
  /**
   * Offerwalls tab only (owner order 2026-11-21): survey partner
   * WALLS — TheoremReach, CPX and the like — are offerwalls and their
   * cards belong here, next to the offerwall rows. Individual surveys
   * never appear as cards anywhere: the Surveys tab lists them from
   * the partners' own feeds.
   */
  includeSurveyWalls?: boolean;
}) {
  const query = useQuery({
    queryKey: ["content", kind, token],
    queryFn: () => api.listContent({ token, kind }),
  });
  const wallsQuery = useQuery({
    queryKey: ["content", "survey", token],
    queryFn: () => api.listContent({ token, kind: "survey" }),
    enabled: includeSurveyWalls === true,
  });
  const meta = {
    offerwall: {
      title: "Offerwalls",
      icon: Icons.grid("h-10 w-10"),
      empty:
        "No offerwalls are live yet. Our partners are reviewing TapOne — as soon as one approves us, its offers will appear here for you.",
    },
    survey: {
      title: "Surveys",
      icon: Icons.survey("h-10 w-10"),
      empty:
        "No survey partners are live yet. When a survey network approves TapOne, surveys for you will appear here.",
    },
    game: {
      title: "Games",
      icon: Icons.game("h-10 w-10"),
      empty:
        "No games are live yet. Game partners are reviewing TapOne — approved games will appear here, with the best ones featured on the home page.",
    },
  }[kind];
  // One card per partner (owner order 2026-11-21): the merged lists
  // can hold the same partner twice — TheoremReach showed two cards
  // in Offers — so duplicates collapse here as well as server-side.
  const allItems = dedupePartners([
    ...(query.data?.items ?? []),
    ...(includeSurveyWalls ? (wallsQuery.data?.items ?? []) : []),
  ]);
  const loading =
    query.isPending || (includeSurveyWalls === true && wallsQuery.isPending);
  return (
    <div>
      {kind === "survey" && <CheckinBonus token={token} />}
      <h1 className="font-display text-2xl font-extrabold sm:text-3xl">{heading ?? meta.title}</h1>
      <p className="mt-1 text-sm text-[var(--dim)]">
        Showing what's available for your account. This space fills as
        partners are approved and added.
      </p>
      <div className="mt-5">
        <SectionStats token={token} kind={kind} />
      </div>
      {loading ? (
        <p className="mt-8 text-sm text-[var(--dim)]">Loading…</p>
      ) : allItems.length > 0 ? (
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 xl:grid-cols-4">
          {allItems.map((item) => (
            <OfferwallCard key={item.id} item={item} />
          ))}
        </div>
      ) : (
        <div className="mt-8 rounded-3xl border-2 border-dashed border-[var(--border)] bg-[var(--surface)] px-6 py-12 text-center">
          <span className="text-[var(--brand)]">{meta.icon}</span>
          <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-[var(--dim)]">{meta.empty}</p>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------- surveys tab

type FeedSurvey = ApiResponse<typeof api, "listSurveyFeed">["surveys"][number];
type FeedGame = ApiResponse<typeof api, "listGameFeed">["games"][number];

/**
 * Surveys tab (owner order 2026-11-21, TimeBucks model): ONE merged
 * list of INDIVIDUAL surveys from EVERY survey partner the admin has
 * added — the server pulls each partner's own survey feed for this
 * user (listSurveyFeed), so the surveys are the ones matched to the
 * user's IP/account, each with its picture, its price and its
 * minutes. There are NO partner cards and NO partner website links
 * here: tapping a survey card opens THAT survey directly.
 */
function SurveysSection({ token }: { token: string }) {
  const query = useQuery({
    queryKey: ["survey-feed", token],
    queryFn: () => api.listSurveyFeed({ token }),
    staleTime: 60_000,
  });
  const surveys = query.data?.surveys ?? [];
  const [provider, setProvider] = useState("all");
  const providers = Array.from(new Set(surveys.map((s) => s.provider)));
  const shown =
    provider === "all"
      ? surveys
      : surveys.filter((s) => s.provider === provider);
  const totalPotential = surveys.reduce((sum, s) => sum + s.payoutCents, 0);
  return (
    <div>
      <CheckinBonus token={token} />
      <h1 className="font-display text-2xl font-extrabold sm:text-3xl">Surveys</h1>
      <p className="mt-1 text-sm text-[var(--dim)]">
        The latest surveys matched to your account from every survey
        partner — tap a survey to start it.
      </p>
      <div className="mt-5">
        <SectionStats token={token} kind="survey" />
      </div>
      {query.isPending ? (
        <p className="mt-8 text-sm text-[var(--dim)]">Loading surveys…</p>
      ) : query.isError ? (
        <div className="mt-8 rounded-3xl border-2 border-dashed border-[var(--border)] bg-[var(--surface)] px-6 py-12 text-center">
          <p className="mx-auto max-w-md text-sm leading-relaxed text-[var(--dim)]">
            Surveys could not be loaded just now.
          </p>
          <button
            type="button"
            onClick={() => void query.refetch()}
            disabled={query.isFetching}
            className="mt-4 rounded-full bg-[var(--brand)] px-6 py-2.5 font-display text-sm font-bold text-white transition hover:bg-[var(--brand-deep)] disabled:opacity-60"
          >
            {query.isFetching ? "Trying again…" : "Try again"}
          </button>
        </div>
      ) : surveys.length === 0 ? (
        <div className="mt-8 rounded-3xl border-2 border-dashed border-[var(--border)] bg-[var(--surface)] px-6 py-12 text-center">
          <span className="text-[var(--brand)]">{Icons.survey("h-10 w-10")}</span>
          <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-[var(--dim)]">
            No surveys are available for your account right now. Survey
            partners match new surveys to accounts through the day —
            check back soon.
          </p>
        </div>
      ) : (
        <>
          <div className="mt-6 flex flex-wrap items-center gap-x-8 gap-y-2 rounded-2xl bg-[var(--surface)] px-5 py-4 ring-1 ring-[var(--border)]">
            <p className="font-display text-lg font-extrabold sm:text-xl">
              {surveys.length} Available Surveys
            </p>
            <p className="text-sm font-semibold text-[var(--dim)]">
              Total Potential Earnings{" "}
              <span className="font-display text-lg font-extrabold text-green-600 dark:text-green-400">
                {fmt(totalPotential)}
              </span>
            </p>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <label htmlFor="survey-provider-filter" className="text-sm font-bold">
              Filter by Provider
            </label>
            <select
              id="survey-provider-filter"
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              className="rounded-xl bg-[var(--surface)] px-3.5 py-2.5 text-sm font-semibold ring-1 ring-[var(--border)] outline-none focus:ring-[var(--brand)]"
            >
              <option value="all">All Providers</option>
              {providers.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
            {provider !== "all" && (
              <button
                type="button"
                onClick={() => setProvider("all")}
                className="rounded-full bg-red-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-red-700"
              >
                Show All
              </button>
            )}
          </div>
          {shown.length > 0 ? (
            <div className="mt-5 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4">
              {shown.map((s) => (
                <SurveyCard key={s.key} survey={s} />
              ))}
            </div>
          ) : (
            <p className="mt-6 text-sm text-[var(--dim)]">
              No surveys from {provider} right now — pick another
              provider or press Show All.
            </p>
          )}
        </>
      )}
    </div>
  );
}

/**
 * One survey, TimeBucks style: big payout top-left, green arrow
 * button top-right, clock + minutes under the payout, the provider's
 * logo bottom-right — no title, no description. The whole card is the
 * survey's own entry link: tapping opens that one survey directly,
 * never the partner's website.
 */
function SurveyCard({ survey }: { survey: FeedSurvey }) {
  const logo = survey.imageUrl ?? survey.providerImageUrl;
  return (
    <a
      href={survey.url}
      target="_blank"
      rel="noreferrer"
      aria-label={`Survey from ${survey.provider} paying ${fmt(survey.payoutCents)}${survey.minutes != null ? `, about ${survey.minutes} minutes` : ""}`}
      className="relative flex min-h-[132px] flex-col rounded-2xl bg-[var(--surface)] p-4 ring-1 ring-[var(--border)] transition hover:ring-[var(--brand)]"
    >
      <span className="flex items-start justify-between gap-2">
        <span className="font-display text-2xl font-extrabold text-[var(--text)]">
          {fmt(survey.payoutCents)}
        </span>
        <span
          className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-green-500 text-white"
          aria-hidden="true"
        >
          {Icons.chevronRight("h-5 w-5")}
        </span>
      </span>
      {survey.minutes != null && (
        <span className="mt-1.5 flex items-center gap-1.5 text-sm font-semibold text-[var(--dim)]">
          {Icons.clock("h-4 w-4")} {survey.minutes} min
        </span>
      )}
      <span className="mt-auto flex items-end justify-between gap-2 pt-3">
        <span className="min-w-0 truncate text-xs font-semibold text-[var(--dim)]">
          {survey.title ?? ""}
        </span>
        {logo ? (
          <img
            src={logo}
            alt={survey.provider}
            className="h-6 max-w-[76px] flex-none object-contain"
            loading="lazy"
          />
        ) : (
          <span className="flex-none text-xs font-bold uppercase tracking-wide text-[var(--dim)]">
            {survey.provider}
          </span>
        )}
      </span>
    </a>
  );
}

// -------------------------------------------------------------- games tab

type GameItem = ContentListItem;

/** A game's total payout: its milestones added up, else its set reward. */
function gameTotalCents(item: GameItem): number {
  if (item.milestones.length > 0)
    return item.milestones.reduce((sum, m) => sum + m.amountCents, 0);
  return item.rewardCents ?? 0;
}

/** The visitor's own device platform — the Games toggle's default. */
function detectDevicePlatform(): "android" | "ios" {
  if (
    typeof navigator !== "undefined" &&
    /iphone|ipad|ipod/i.test(navigator.userAgent)
  )
    return "ios";
  return "android";
}

function PlatformIcon({
  platform,
  className,
}: {
  platform: string;
  className?: string;
}) {
  if (platform === "ios") {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className}
        aria-hidden="true"
      >
        <rect x="7" y="2.5" width="10" height="19" rx="2" />
        <path d="M11 18.5h2" />
      </svg>
    );
  }
  if (platform === "both") return Icons.globe(className);
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M8.5 9 7 5.5M15.5 9 17 5.5" />
      <rect x="5" y="9" width="14" height="10" rx="2" />
      <circle cx="9.5" cy="14" r="0.5" fill="currentColor" stroke="none" />
      <circle cx="14.5" cy="14" r="0.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

/**
 * One carousel row: scrolls left/right with arrow buttons, and when
 * there are enough games the row's content is duplicated so scrolling
 * wraps around seamlessly (the TimeBucks loop).
 */
function LoopRow<T,>({
  items,
  renderCard,
  label,
  keyOf,
}: {
  items: T[];
  renderCard: (item: T, key: string) => ReactNode;
  label: string;
  keyOf: (item: T) => string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const loop = items.length > 3;
  const onScroll = () => {
    const el = ref.current;
    if (!el || !loop) return;
    const half = el.scrollWidth / 2;
    if (half > 0 && el.scrollLeft >= half) el.scrollLeft -= half;
  };
  const nudge = (dir: 1 | -1) =>
    ref.current?.scrollBy({ left: dir * 340, behavior: "smooth" });
  return (
    <div>
      <div className="mb-2 flex justify-end gap-2">
        <button
          type="button"
          onClick={() => nudge(-1)}
          aria-label={`Scroll ${label} left`}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--surface)] ring-1 ring-[var(--border)] transition hover:ring-[var(--brand)]"
        >
          {Icons.chevronLeft("h-5 w-5")}
        </button>
        <button
          type="button"
          onClick={() => nudge(1)}
          aria-label={`Scroll ${label} right`}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--surface)] ring-1 ring-[var(--border)] transition hover:ring-[var(--brand)]"
        >
          {Icons.chevronRight("h-5 w-5")}
        </button>
      </div>
      <div
        ref={ref}
        onScroll={onScroll}
        className="flex gap-3 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        role="list"
        aria-label={label}
      >
        {items.map((item) => renderCard(item, `a-${keyOf(item)}`))}
        {loop && items.map((item) => renderCard(item, `b-${keyOf(item)}`))}
      </div>
    </div>
  );
}

/**
 * One game card (TimeBucks model): large square artwork on top, the
 * title below it, the total payout in large bold green at the bottom
 * left and a small platform icon at the bottom right. The card itself
 * is the button — no Start button, no description, no rating.
 */
function GameCard({
  item,
  onOpen,
}: {
  item: GameItem;
  onOpen: () => void;
}) {
  const [imgOk, setImgOk] = useState(true);
  const total = gameTotalCents(item);
  return (
    <button
      type="button"
      role="listitem"
      onClick={onOpen}
      aria-label={`${item.title} — earn up to ${fmt(total)}`}
      className="w-36 flex-none overflow-hidden rounded-2xl bg-[var(--surface)] text-left ring-1 ring-[var(--border)] transition hover:ring-[var(--brand)] sm:w-44"
    >
      {item.imageUrl && imgOk ? (
        <img
          src={item.imageUrl}
          alt={item.title}
          className="aspect-square w-full object-cover"
          loading="lazy"
          onError={() => setImgOk(false)}
        />
      ) : (
        <span className="flex aspect-square w-full items-center justify-center bg-[var(--surface-2)] text-[var(--brand)]">
          {Icons.game("h-12 w-12")}
        </span>
      )}
      <span className="block px-3 pb-3 pt-2">
        <span className="block truncate font-display text-sm font-bold text-[var(--text)]">
          {item.title}
        </span>
        <span className="mt-1.5 flex items-end justify-between gap-2">
          <span className="font-display text-lg font-extrabold leading-none text-green-600 dark:text-green-400">
            {fmt(total)}
          </span>
          <PlatformIcon
            platform={item.platform}
            className="h-[18px] w-[18px] flex-none text-[var(--dim)]"
          />
        </span>
      </span>
    </button>
  );
}

/**
 * One game from a partner's own items feed (listGameFeed): the same
 * card as an admin-added game — artwork, title, payout — but tapping
 * opens that game's own link directly, exactly like a survey card
 * (feed games carry no milestone table, so there is no popup).
 */
function FeedGameCard({ game }: { game: FeedGame }) {
  const [imgOk, setImgOk] = useState(true);
  const art = game.imageUrl ?? game.providerImageUrl;
  const title = game.title ?? game.provider;
  return (
    <a
      href={game.url}
      target="_blank"
      rel="noreferrer"
      role="listitem"
      aria-label={`${title} — earn ${fmt(game.payoutCents)}`}
      className="w-36 flex-none overflow-hidden rounded-2xl bg-[var(--surface)] text-left ring-1 ring-[var(--border)] transition hover:ring-[var(--brand)] sm:w-44"
    >
      {art && imgOk ? (
        <img
          src={art}
          alt={title}
          className="aspect-square w-full object-cover"
          loading="lazy"
          onError={() => setImgOk(false)}
        />
      ) : (
        <span className="flex aspect-square w-full items-center justify-center bg-[var(--surface-2)] text-[var(--brand)]">
          {Icons.game("h-12 w-12")}
        </span>
      )}
      <span className="block px-3 pb-3 pt-2">
        <span className="block truncate font-display text-sm font-bold text-[var(--text)]">
          {title}
        </span>
        <span className="mt-1.5 flex items-end justify-between gap-2">
          <span className="font-display text-lg font-extrabold leading-none text-green-600 dark:text-green-400">
            {fmt(game.payoutCents)}
          </span>
          <span className="min-w-0 truncate text-xs font-semibold text-[var(--dim)]">
            {game.provider}
          </span>
        </span>
      </span>
    </a>
  );
}

/**
 * Game detail popup — opens INSIDE TapOne (the page never navigates):
 * green header with the game name and an X, the large thumbnail, the
 * EVENT / CASH milestone table adding up to the total payout, and the
 * green PLAY AND EARN button, which opens that game offerwall's
 * game/install page directly.
 */
function GamePopup({
  item,
  onClose,
}: {
  item: GameItem;
  onClose: () => void;
}) {
  const total = gameTotalCents(item);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={item.title}
      onClick={onClose}
    >
      <div
        className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-[var(--surface)] shadow-2xl sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 bg-green-600 px-5 py-4 text-white">
          <h2 className="min-w-0 truncate font-display text-lg font-extrabold">
            {item.title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-white/15 transition hover:bg-white/25"
          >
            {Icons.x("h-5 w-5")}
          </button>
        </div>
        {item.imageUrl && (
          <img
            src={item.imageUrl}
            alt={item.title}
            className="aspect-video w-full object-cover"
          />
        )}
        <div className="px-5 py-4">
          {item.provider && (
            <p className="text-xs font-bold uppercase tracking-wide text-[var(--dim)]">
              {item.provider}
            </p>
          )}
          {item.description && (
            <p className="mt-2 text-sm leading-relaxed text-[var(--dim)]">
              {item.description}
            </p>
          )}
          {item.milestones.length > 0 ? (
            <table className="mt-4 w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-left text-xs font-extrabold uppercase tracking-wide text-[var(--dim)]">
                  <th scope="col" className="py-2 pr-3">Event</th>
                  <th scope="col" className="py-2 text-right">Cash</th>
                </tr>
              </thead>
              <tbody>
                {item.milestones.map((m, i) => (
                  <tr
                    key={`${m.event}-${i}`}
                    className="border-b border-[var(--border)]/60"
                  >
                    <td className="py-2.5 pr-3 font-semibold text-[var(--text)]">
                      {m.event}
                    </td>
                    <td className="py-2.5 text-right font-display font-extrabold text-green-600 dark:text-green-400">
                      {fmt(m.amountCents)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td className="py-2.5 pr-3 font-display font-extrabold text-[var(--text)]">
                    Total
                  </td>
                  <td className="py-2.5 text-right font-display font-extrabold text-green-600 dark:text-green-400">
                    {fmt(total)}
                  </td>
                </tr>
              </tfoot>
            </table>
          ) : total > 0 ? (
            <p className="mt-4 text-sm font-semibold text-[var(--dim)]">
              Complete this game to earn{" "}
              <span className="font-display font-extrabold text-green-600 dark:text-green-400">
                {fmt(total)}
              </span>
              .
            </p>
          ) : null}
          {item.url ? (
            <a
              href={item.url}
              target="_blank"
              rel="noreferrer"
              className="mt-5 block rounded-full bg-green-600 px-6 py-3.5 text-center font-display text-base font-extrabold uppercase tracking-wide text-white transition hover:bg-green-700"
            >
              Play and Earn {fmt(total)}
            </a>
          ) : (
            <p className="mt-5 rounded-2xl bg-[var(--surface-2)] px-4 py-3 text-center text-sm font-semibold text-[var(--dim)]">
              This game is not open for play yet.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

type GameEntry =
  | { source: "admin"; name: string; platform: string; item: GameItem }
  | { source: "feed"; name: string; platform: string; item: FeedGame };

/**
 * Games tab (owner order 2026-11-21, TimeBucks model): ONE merged
 * list of every game from every game partner — the games the admin
 * added one by one (listContent) AND the individual games pulled
 * live from game walls that expose an items feed (listGameFeed).
 * Both lists are already matched to the user's country (login IP)
 * server-side; here the Android/iOS pills filter by device, with
 * the visitor's own device selected by default (feed games carry no
 * platform, so they show on both). Nothing is copied from anywhere:
 * games appear only from partners the admin added after approval.
 */
function GamesSection({ token }: { token: string }) {
  const query = useQuery({
    queryKey: ["content", "game", token],
    queryFn: () => api.listContent({ token, kind: "game" }),
  });
  const feedQuery = useQuery({
    queryKey: ["game-feed", token],
    queryFn: () => api.listGameFeed({ token }),
    staleTime: 60_000,
  });
  const adminGames = query.data?.items ?? [];
  const entries: GameEntry[] = [
    ...adminGames.map(
      (item): GameEntry => ({
        source: "admin",
        name: item.provider || item.title,
        platform: item.platform,
        item,
      }),
    ),
    ...(feedQuery.data?.games ?? []).map(
      (item): GameEntry => ({
        source: "feed",
        name: item.provider,
        platform: "both",
        item,
      }),
    ),
  ];
  const [platform, setPlatform] = useState<"android" | "ios">(() =>
    detectDevicePlatform(),
  );
  const [partner, setPartner] = useState<string | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);

  const partnerNames: string[] = [];
  const partnerCounts = new Map<string, number>();
  for (const e of entries) {
    if (!partnerCounts.has(e.name)) partnerNames.push(e.name);
    partnerCounts.set(e.name, (partnerCounts.get(e.name) ?? 0) + 1);
  }

  const forPlatform = entries.filter(
    (e) => e.platform === platform || e.platform === "both",
  );
  const visible = partner
    ? forPlatform.filter((e) => e.name === partner)
    : forPlatform;
  const rowA = visible.filter((_, i) => i % 2 === 0);
  const rowB = visible.filter((_, i) => i % 2 === 1);
  const openItem = adminGames.find((g) => g.id === openId) ?? null;

  const renderCard = (entry: GameEntry, key: string) =>
    entry.source === "admin" ? (
      <GameCard
        key={key}
        item={entry.item}
        onOpen={() => setOpenId(entry.item.id)}
      />
    ) : (
      <FeedGameCard key={key} game={entry.item} />
    );

  return (
    <div>
      <h1 className="font-display text-2xl font-extrabold sm:text-3xl">Games</h1>
      <p className="mt-1 text-sm text-[var(--dim)]">
        Games matched to your account and your device, from every game
        partner. Tap a game to see how its payout adds up.
      </p>
      <div className="mt-5">
        <SectionStats token={token} kind="game" />
      </div>
      <div
        className="mt-2 flex gap-2"
        role="group"
        aria-label="Choose your device platform"
      >
        {(["android", "ios"] as const).map((p) => (
          <button
            key={p}
            type="button"
            aria-pressed={platform === p}
            onClick={() => setPlatform(p)}
            className={`flex items-center gap-2 rounded-full px-4 py-2 text-sm font-bold ring-1 transition ${
              platform === p
                ? "bg-[var(--brand)] text-white ring-[var(--brand)]"
                : "bg-[var(--surface)] text-[var(--text)] ring-[var(--border)] hover:ring-[var(--brand)]"
            }`}
          >
            <PlatformIcon platform={p} className="h-[18px] w-[18px]" />
            {p === "android" ? "Android" : "iOS"}
          </button>
        ))}
      </div>

      {query.isPending || feedQuery.isPending ? (
        <p className="mt-8 text-sm text-[var(--dim)]">Loading games…</p>
      ) : entries.length === 0 ? (
        <div className="mt-8 rounded-3xl border-2 border-dashed border-[var(--border)] bg-[var(--surface)] px-6 py-12 text-center">
          <span className="text-[var(--brand)]">{Icons.game("h-10 w-10")}</span>
          <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-[var(--dim)]">
            No games are live yet. Game partners are reviewing TapOne —
            as soon as one approves us and its games are added, they
            will appear here for your device.
          </p>
        </div>
      ) : (
        <>
          {partner && (
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <p className="text-sm font-semibold text-[var(--dim)]">
                Showing games from{" "}
                <span className="font-bold text-[var(--text)]">{partner}</span>
              </p>
              <button
                type="button"
                onClick={() => setPartner(null)}
                className="rounded-full bg-[var(--surface)] px-4 py-2 text-sm font-bold ring-1 ring-[var(--border)] transition hover:ring-[var(--brand)]"
              >
                Show all games
              </button>
            </div>
          )}
          {visible.length > 0 ? (
            <div className="mt-5 space-y-5">
              <LoopRow items={rowA} renderCard={renderCard} label="Games row 1" keyOf={(e) => (e.source === "admin" ? `a${e.item.id}` : e.item.key)} />
              {rowB.length > 0 && (
                <LoopRow items={rowB} renderCard={renderCard} label="Games row 2" keyOf={(e) => (e.source === "admin" ? `a${e.item.id}` : e.item.key)} />
              )}
            </div>
          ) : (
            <div className="mt-6 rounded-3xl border-2 border-dashed border-[var(--border)] bg-[var(--surface)] px-6 py-10 text-center">
              <p className="mx-auto max-w-md text-sm leading-relaxed text-[var(--dim)]">
                No {platform === "ios" ? "iOS" : "Android"} games
                {partner ? ` from ${partner}` : ""} right now — try the
                other platform{partner ? " or show all games" : ""}.
              </p>
            </div>
          )}

          {partnerNames.length > 0 && (
            <section aria-label="Gaming Partners" className="mt-10">
              <h2 className="font-display text-xl font-extrabold">
                Gaming Partners
              </h2>
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 xl:grid-cols-4">
                {partnerNames.map((name) => {
                  const count = partnerCounts.get(name) ?? 0;
                  const active = partner === name;
                  return (
                    <button
                      key={name}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setPartner(active ? null : name)}
                      className={`rounded-2xl bg-[var(--surface)] px-4 py-5 text-left ring-1 transition ${
                        active
                          ? "ring-2 ring-[var(--brand)]"
                          : "ring-[var(--border)] hover:ring-[var(--brand)]"
                      }`}
                    >
                      <span
                        className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[var(--surface-2)] font-display text-lg font-extrabold text-[var(--brand)]"
                        aria-hidden="true"
                      >
                        {name.slice(0, 1).toUpperCase()}
                      </span>
                      <span className="mt-3 block truncate font-display text-sm font-bold text-[var(--text)] sm:text-base">
                        {name}
                      </span>
                      <span className="mt-0.5 block text-xs font-semibold text-[var(--dim)]">
                        {count} {count === 1 ? "game" : "games"}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          )}
        </>
      )}
      {openItem && (
        <GamePopup item={openItem} onClose={() => setOpenId(null)} />
      )}
    </div>
  );
}

// ------------------------------------------------------------- withdraw tab

function WithdrawTab({ token }: { token: string }) {
  const queryClient = useQueryClient();
  const info = useQuery({
    queryKey: ["withdraw-info", token],
    queryFn: () => api.getWithdrawInfo({ token }),
  });
  const [methodId, setMethodId] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [details, setDetails] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const methods = info.data?.methods ?? [];
  const selected = methods.find((m) => m.id === methodId) ?? methods[0];

  const request = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error("No payment method is available.");
      const dollars = Number.parseFloat(amount);
      if (!Number.isFinite(dollars) || dollars <= 0)
        throw new Error("Enter a valid amount.");
      return api.requestWithdrawal({
        token,
        amountCents: Math.round(dollars * 100),
        method: selected.id,
        details,
      });
    },
    onSuccess: () => {
      setSuccess("Request sent. You will see the status here as soon as it is reviewed.");
      setAmount("");
      setDetails({});
      void queryClient.invalidateQueries({ queryKey: ["withdraw-info", token] });
      void queryClient.invalidateQueries({ queryKey: ["me", token] });
    },
    onError: (error) => setFormError(error.message),
  });

  return (
    <div>
      <h1 className="font-display text-2xl font-extrabold sm:text-3xl">Withdraw</h1>
      <p className="mt-1 text-sm text-[var(--dim)]">
        Payment methods available for your account.
        Minimum withdrawal {info.data ? fmt(info.data.minWithdrawCents) : "…"}. No fees taken by TapOne.
      </p>

      <section className="mt-5 rounded-3xl bg-[var(--pill)] p-6 ring-1 ring-[var(--border)]" aria-label="Balance">
        <p className="text-sm font-semibold text-[var(--dim)]">Available balance</p>
        <p className="mt-1 font-display text-4xl font-extrabold text-[var(--text)]">
          {info.data ? fmt(info.data.balanceCents) : "…"}
        </p>
      </section>

      <form
        className="mt-5 rounded-3xl bg-[var(--surface)] p-5 ring-1 ring-[var(--border)] sm:p-6"
        onSubmit={(e) => {
          e.preventDefault();
          setFormError(null);
          setSuccess(null);
          if (!selected) {
            setFormError("No payment method is available for your account yet.");
            return;
          }
          for (const field of selected.fields) {
            if (!details[field.key]?.trim()) {
              setFormError(`Please fill in: ${field.label}.`);
              return;
            }
          }
          request.mutate();
        }}
      >
        <p className="font-display text-base font-bold">Payment method</p>
        <div className="mt-3 flex flex-wrap gap-2" role="radiogroup" aria-label="Payment method">
          {methods.map((m) => (
            <button
              key={m.id}
              type="button"
              role="radio"
              aria-checked={selected?.id === m.id}
              onClick={() => {
                setMethodId(m.id);
                setDetails({});
              }}
              className={`flex items-center gap-2.5 rounded-full py-1.5 pl-1.5 pr-4 text-sm font-bold ring-1 transition ${
                selected?.id === m.id
                  ? "bg-[var(--brand)] text-white ring-[var(--brand)]"
                  : "bg-[var(--surface)] ring-[var(--border)] hover:ring-[var(--brand)]"
              }`}
            >
              <MethodLogo methodId={m.id} imageUrl={m.imageUrl} label={m.label} />
              {m.label}
            </button>
          ))}
        </div>

        {selected && (
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            {selected.fields.map((field) => (
              <div key={field.key}>
                <label htmlFor={`wd-${field.key}`} className="text-sm font-semibold">
                  {field.label}
                </label>
                <input
                  id={`wd-${field.key}`}
                  value={details[field.key] ?? ""}
                  onChange={(e) =>
                    setDetails((d) => ({ ...d, [field.key]: e.target.value }))
                  }
                  autoComplete="off"
                  className="mt-1 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 outline-none focus:border-[var(--brand)]"
                />
              </div>
            ))}
            <div>
              <label htmlFor="wd-amount" className="text-sm font-semibold">
                Amount (USD)
              </label>
              <input
                id="wd-amount"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                inputMode="decimal"
                placeholder="10.00"
                className="mt-1 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 outline-none focus:border-[var(--brand)]"
              />
            </div>
          </div>
        )}

        {formError && (
          <p role="alert" className="mt-4 text-sm font-medium text-red-600 dark:text-red-400">
            {formError}
          </p>
        )}
        {success && (
          <p role="status" className="mt-4 text-sm font-medium text-[var(--brand-deep)] dark:text-[var(--brand)]">
            {success}
          </p>
        )}
        <button
          type="submit"
          disabled={request.isPending || !selected}
          className="mt-5 w-full rounded-full bg-[var(--brand)] px-6 py-3 font-display text-base font-bold text-white transition hover:bg-[var(--brand-deep)] disabled:opacity-60 sm:w-auto"
        >
          {request.isPending ? "Sending…" : "Request withdrawal"}
        </button>
      </form>

      <section className="mt-6" aria-label="My withdrawal requests">
        <h2 className="font-display text-lg font-bold">My requests</h2>
        {info.isPending ? (
          <p className="mt-3 text-sm text-[var(--dim)]">Loading…</p>
        ) : info.data && info.data.withdrawals.length > 0 ? (
          <ul className="mt-3 space-y-3">
            {info.data.withdrawals.map((w) => (
              <li key={w.id} className="rounded-2xl bg-[var(--surface)] p-4 ring-1 ring-[var(--border)]">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-display text-lg font-extrabold">{fmt(w.amountCents)}</span>
                  <StatusChip status={w.status} />
                </div>
                <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-[var(--dim)]">
                  <MethodLogo
                    methodId={w.method}
                    imageUrl={methods.find((m) => m.id === w.method)?.imageUrl}
                    label={w.methodLabel}
                  />
                  <span>
                    {w.methodLabel} · Requested {fmtDateTime(w.createdAt)}
                    {w.decidedAt ? ` · Decided ${fmtDateTime(w.decidedAt)}` : ""}
                  </span>
                </p>
                {w.adminNote && (
                  <p className="mt-1.5 text-sm">
                    <span className="font-semibold">Note:</span> {w.adminNote}
                  </p>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-[var(--dim)]">You have not requested a withdrawal yet.</p>
        )}
      </section>
    </div>
  );
}

// -------------------------------------------------------------- history tab

function HistoryTab({ token }: { token: string }) {
  const history = useQuery({
    queryKey: ["history", token],
    queryFn: () => api.getHistory({ token, limit: 100 }),
  });
  return (
    <div>
      <h1 className="font-display text-2xl font-extrabold sm:text-3xl">History</h1>
      <p className="mt-1 text-sm text-[var(--dim)]">Every dollar in and out of your account.</p>
      {history.isPending ? (
        <p className="mt-6 text-sm text-[var(--dim)]">Loading…</p>
      ) : history.data && history.data.entries.length > 0 ? (
        <ul className="mt-5 divide-y divide-[var(--border)] rounded-2xl bg-[var(--surface)] px-4 ring-1 ring-[var(--border)]">
          {history.data.entries.map((t) => (
            <li key={t.id} className="flex items-center justify-between gap-3 py-3.5">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{t.note || KIND_LABELS[t.kind] || t.kind}</p>
                <p className="text-xs text-[var(--dim)]">
                  {KIND_LABELS[t.kind] ?? t.kind} · {fmtDateTime(t.createdAt)}
                </p>
              </div>
              <span
                className={`font-display text-base font-bold ${
                  t.amountCents >= 0 ? "text-[var(--brand-deep)] dark:text-[var(--brand)]" : "text-[var(--dim)]"
                }`}
              >
                {t.amountCents >= 0 ? "+" : ""}
                {fmt(t.amountCents)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="mt-6 rounded-3xl border-2 border-dashed border-[var(--border)] bg-[var(--surface)] px-6 py-10 text-center text-sm text-[var(--dim)]">
          No history yet — your earnings and withdrawals will appear here.
        </div>
      )}
    </div>
  );
}

// --------------------------------------------------------------- level tab

function LevelCard({ token, go }: { token: string; go: (t: DashboardTab) => void }) {
  const lvl = useQuery({ queryKey: ["level", token], queryFn: () => api.getLevel({ token }) });
  const d = lvl.data;
  return (
    <button
      type="button"
      onClick={() => go("level")}
      className="mt-4 block w-full rounded-3xl bg-[var(--surface)] p-5 text-left ring-1 ring-[var(--border)] transition hover:ring-[var(--brand)]"
      aria-label="Your level and progress"
    >
      <span className="flex items-center justify-between gap-3">
        <span className="font-display text-base font-bold">
          ⭐ Lv.{d?.level ?? "–"}
          {d?.title && <span className="ml-2 text-sm font-semibold text-[var(--brand-deep)]">{d.title}</span>}
        </span>
        <span className="text-sm font-bold text-[var(--brand-deep)]">Privileges →</span>
      </span>
      <span className="mt-3 block h-3 overflow-hidden rounded-full bg-[var(--surface-2)]">
        <span className="block h-full rounded-full bg-[var(--brand)]" style={{ width: `${d?.progressPct ?? 0}%` }} />
      </span>
      <span className="mt-2 block text-xs font-semibold text-[var(--dim)]">
        {d
          ? d.nextTitle
            ? `${fmt(d.totalEarnedCents)} earned · Progress to ${d.nextTitle.name} — ${d.progressPct}%`
            : `${fmt(d.totalEarnedCents)} earned · Highest title reached`
          : "Loading your progress…"}
      </span>
    </button>
  );
}

function LevelTab({ token, go }: { token: string; go: (t: DashboardTab) => void }) {
  void go;
  const lvl = useQuery({ queryKey: ["level", token], queryFn: () => api.getLevel({ token }) });
  const d = lvl.data;
  return (
    <div>
      <h1 className="font-display text-2xl font-extrabold sm:text-3xl">Level &amp; Privileges</h1>
      <p className="mt-1 max-w-xl text-sm leading-relaxed text-[var(--dim)]">
        Every $1 you earn raises you one level. The moment you reach a new
        title, its one-time Level Reward is credited to your balance
        automatically
        {d && d.titles.length > 0
          ? ` — ${fmt(d.titles.reduce((s, t) => s + t.rewardCents, 0))} in total across all ${d.titles.length} titles`
          : ""}
        {" "}— and it is saved in your history, not just shown here.
      </p>
      <section className="mt-5 rounded-3xl bg-[var(--pill)] p-6 ring-1 ring-[var(--border)]" aria-label="Your level">
        <p className="text-sm font-semibold text-[var(--dim)]">Your level</p>
        <p className="mt-1 font-display text-5xl font-extrabold text-[var(--text)]">
          {d ? `Lv.${d.level}` : "…"}
          {d?.title && (
            <span className="ml-3 align-middle font-display text-xl font-extrabold text-[var(--brand-deep)]">
              {d.title}
            </span>
          )}
        </p>
        <div className="mt-4 h-3.5 overflow-hidden rounded-full bg-white">
          <div className="h-full rounded-full bg-[var(--brand)]" style={{ width: `${d?.progressPct ?? 0}%` }} />
        </div>
        <p className="mt-2 text-sm font-semibold text-[var(--dim)]">
          {d
            ? d.nextTitle
              ? `Progress to ${d.nextTitle.name} — ${d.progressPct}% · ${fmt(d.totalEarnedCents)} earned in total`
              : `${fmt(d.totalEarnedCents)} earned in total · Master title reached`
            : "Loading…"}
        </p>
        <p className="mt-3 inline-block rounded-full bg-[var(--surface)] px-3.5 py-1.5 text-sm font-bold ring-1 ring-[var(--border)]">
          {d?.nextTitle
            ? `Next reward: ${fmt(d.nextTitle.rewardCents)} when you reach ${d.nextTitle.name} (Level ${d.nextTitle.level.toLocaleString()})`
            : d
              ? `Every title reward collected — ${fmt(d.titles.reduce((s, t) => s + t.rewardCents, 0))} in total`
              : "Loading your rewards…"}
        </p>
      </section>

      <section className="mt-6" aria-label="Titles">
        <h2 className="font-display text-lg font-bold">Titles &amp; Level Rewards</h2>
        <ul className="mt-3 divide-y divide-[var(--border)] rounded-2xl bg-[var(--surface)] px-4 ring-1 ring-[var(--border)]">
          {(d?.titles ?? []).map((title) => (
            <li key={title.name} className="flex items-center gap-3 py-3">
              <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full font-display text-sm font-extrabold ${title.reached ? "bg-[var(--brand)] text-white" : "bg-[var(--surface-2)] text-[var(--dim)]"}`}>
                {title.name.charAt(0)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-bold">{title.name}</span>
                <span className="block text-xs text-[var(--dim)]">
                  Unlocks at Level {title.level.toLocaleString()} · One-time reward {fmt(title.rewardCents)}
                </span>
              </span>
              <span className="shrink-0 font-display text-base font-extrabold text-[var(--brand-deep)]">
                {fmt(title.rewardCents)}
              </span>
              {title.current ? (
                <span className="rounded-full bg-[var(--pill)] px-2.5 py-1 text-xs font-bold text-[var(--brand-deep)] ring-1 ring-[var(--border)]">Your title</span>
              ) : title.reached ? (
                <span className="text-sm font-bold text-[var(--brand-deep)]">✓ Paid</span>
              ) : null}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs leading-relaxed text-[var(--dim)]">
          Each title pays its reward once, the moment you reach it — every
          user, automatically, no claiming needed.
          {d && d.titles.length > 0
            ? ` Together the ${d.titles.length} titles pay ${fmt(d.titles.reduce((s, t) => s + t.rewardCents, 0))}.`
            : ""}
          {" "}Chargebacks can reduce your level and title, but a reward
          already paid is never taken back.
        </p>
      </section>

      <section className="mt-6" aria-label="Level reward history">
        <h2 className="font-display text-lg font-bold">Level Rewards you received</h2>
        {lvl.isPending ? (
          <p className="mt-3 text-sm text-[var(--dim)]">Loading…</p>
        ) : d && d.rewardHistory.length > 0 ? (
          <ul className="mt-3 divide-y divide-[var(--border)] rounded-2xl bg-[var(--surface)] px-4 ring-1 ring-[var(--border)]">
            {d.rewardHistory.map((h) => (
              <li key={h.id} className="flex items-center justify-between gap-3 py-3">
                <span>
                  <span className="block text-sm font-semibold">{h.note}</span>
                  <span className="block text-xs text-[var(--dim)]">{fmtDateTime(h.createdAt)}</span>
                </span>
                <span className="font-display text-base font-bold text-[var(--brand)]">+{fmt(h.amountCents)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 rounded-2xl border-2 border-dashed border-[var(--border)] bg-[var(--surface)] px-5 py-8 text-center text-sm text-[var(--dim)]">
            {(() => {
              const first = d?.titles.find((t) => t.rewardCents > 0);
              return first
                ? `No Level Rewards yet — your first one, ${fmt(first.rewardCents)}, is credited the moment you reach ${first.name} at Level ${first.level.toLocaleString()}.`
                : "No Level Rewards yet — rewards are credited the moment you reach a title.";
            })()}
          </p>
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------- leaderboard tab

/**
 * Live countdown to the end of the current Affiliate month (days,
 * hours, minutes, seconds, ticking every second). When it reaches
 * zero the board refetches: the server settles the finished month and
 * returns the fresh month's board.
 */
function MonthCountdown({ endsAt, onElapsed }: { endsAt: string; onElapsed: () => void }) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  const elapsedRef = useRef(false);
  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const leftMs = Math.max(0, new Date(endsAt).getTime() - nowMs);
  useEffect(() => {
    if (leftMs <= 0 && !elapsedRef.current) {
      elapsedRef.current = true;
      onElapsed();
    }
  }, [leftMs, onElapsed]);
  const totalSec = Math.floor(leftMs / 1000);
  const cells: [string, number][] = [
    ["Days", Math.floor(totalSec / 86400)],
    ["Hours", Math.floor((totalSec % 86400) / 3600)],
    ["Minutes", Math.floor((totalSec % 3600) / 60)],
    ["Seconds", totalSec % 60],
  ];
  return (
    <div className="mt-4" aria-label="Time left in this month's contest">
      <div className="flex gap-2">
        {cells.map(([label, value]) => (
          <span
            key={label}
            className="flex min-w-16 flex-1 flex-col items-center rounded-2xl bg-[var(--surface)] px-2 py-2.5 ring-1 ring-[var(--border)]"
          >
            <span className="font-display text-2xl font-extrabold tabular-nums text-[var(--text)]">
              {String(value).padStart(2, "0")}
            </span>
            <span className="text-[11px] font-bold uppercase tracking-wide text-[var(--dim)]">
              {label}
            </span>
          </span>
        ))}
      </div>
      <p className="mt-2 text-xs font-semibold text-[var(--dim)]">
        When the timer hits zero, the winners are listed for the owner,
        who pays the prizes from the admin panel — and a fresh board
        starts.
      </p>
    </div>
  );
}

/** One leaderboard row: rank badge, the user's profile picture (or
 *  their initial in the blue avatar circle when they have no picture),
 *  name, and their earnings/prize. Used for the board itself and for
 *  the standings inside the Join Now view — every ranked user shows
 *  with name + picture + earnings, Top 100, both contests. */
function StandingRow({
  rank,
  name,
  pictureUrl,
  main,
  sub,
}: {
  rank: number;
  name: string;
  pictureUrl: string | null;
  main: string;
  sub: string;
}) {
  return (
    <li className="flex items-center gap-3 py-3">
      <span
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full font-display text-sm font-extrabold ${
          rank === 1
            ? "bg-[var(--gold)] text-[var(--ink)]"
            : rank === 2
              ? "bg-slate-300 text-[var(--ink)]"
              : rank === 3
                ? "bg-amber-700 text-white"
                : "bg-[var(--surface-2)] text-[var(--dim)]"
        }`}
      >
        {rank}
      </span>
      <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[var(--avatar)] font-display text-sm font-extrabold text-white">
        {pictureUrl ? (
          <img src={pictureUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          name.charAt(0).toUpperCase()
        )}
      </span>
      <span className="min-w-0 flex-1 truncate text-sm font-semibold">{name}</span>
      <span className="text-right">
        <span className="block font-display text-base font-bold text-[var(--brand-deep)] dark:text-[var(--brand)]">
          {main}
        </span>
        <span className="block text-xs text-[var(--dim)]">{sub}</span>
      </span>
    </li>
  );
}

function LeaderboardTab({ token }: { token: string }) {
  const [contest, setContest] = useState<"daily" | "affiliate">("daily");
  const [showPrizes, setShowPrizes] = useState(false);
  const board = useQuery({
    queryKey: ["leaderboard", token],
    queryFn: () => api.getLeaderboard({ token }),
  });
  const d = board.data;
  const tiers = d ? (contest === "daily" ? d.dailyTiers : d.affiliateTiers) : [];
  const rows = d
    ? contest === "daily"
      ? d.daily.map((r) => ({
          rank: r.rank,
          name: r.name,
          pictureUrl: r.pictureUrl,
          main: fmt(r.earnedCents),
          sub: "earned today",
        }))
      : d.affiliateStandings.map((r) => ({
          rank: r.rank,
          name: r.name,
          pictureUrl: r.pictureUrl,
          main: r.prizeCents > 0 ? fmt(r.prizeCents) : "—",
          sub: `${r.referrals} ${r.referrals === 1 ? "referral" : "referrals"} brought · Score ${r.score}`,
        }))
    : [];
  const affiliateMonthLabel = d
    ? new Date(`${d.affiliateMonthKey}-01T00:00:00`).toLocaleString("en-US", {
        month: "long",
        year: "numeric",
      })
    : "";
  return (
    <div>
      <h1 className="font-display text-2xl font-extrabold sm:text-3xl">Leaderboard</h1>
      <div className="mt-5 flex gap-2" role="tablist" aria-label="Contest">
        {(
          [
            { id: "daily" as const, label: "🏆 Daily contest" },
            { id: "affiliate" as const, label: "👥 Affiliate contest" },
          ]
        ).map((c) => (
          <button
            key={c.id}
            type="button"
            role="tab"
            aria-selected={contest === c.id}
            onClick={() => setContest(c.id)}
            className={`rounded-full px-4 py-2.5 text-sm font-bold ring-1 transition ${
              contest === c.id
                ? "bg-[var(--brand)] text-white ring-[var(--brand)]"
                : "bg-[var(--surface)] ring-[var(--border)]"
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>
      <div className="mt-4 overflow-hidden rounded-3xl bg-[var(--pill)] p-6 ring-1 ring-[var(--border)]">
        <p className="text-sm font-semibold text-[var(--dim)]">
          {contest === "daily" ? "Daily contest prize pool" : "Affiliate contest prize pool"}
        </p>
        <p className="mt-1 font-display text-4xl font-extrabold text-[var(--brand)]">
          {d ? fmt(contest === "daily" ? d.dailyPoolCents : d.affiliatePoolCents) : "…"}
        </p>
        <p className="mt-2 max-w-md text-sm leading-relaxed text-[var(--dim)]">
          {contest === "daily"
            ? "Entry is automatic — every dollar you earn today enters you. When the day ends, the winners are listed for the owner, who pays each prize from the admin panel — it lands straight in the winner's balance."
            : `This board is for ${affiliateMonthLabel} only — it starts fresh on the 1st of every month, and when the month ends the winners are listed for the owner, who pays each prize from the admin panel. Score = qualified referrals + 0.2 × their earnings this month (capped at $400 each) + 3 × referrals whose first withdrawal landed this month. A qualified referral has earned at least $0.10 this month.`}
        </p>
        {contest === "affiliate" && d && (
          <>
            <p className="mt-4 font-display text-sm font-bold text-[var(--text)]">
              ⏳ {affiliateMonthLabel} contest ends in
            </p>
            <MonthCountdown endsAt={d.affiliateEndsAt} onElapsed={() => void board.refetch()} />
          </>
        )}
        <button
          type="button"
          aria-expanded={showPrizes}
          onClick={() => setShowPrizes((v) => !v)}
          className="mt-4 rounded-full bg-[var(--brand)] px-8 py-3 font-display text-base font-bold text-white transition hover:bg-[var(--brand-deep)]"
        >
          Join Now
        </button>
        {showPrizes && (
          <div className="mt-4 rounded-2xl bg-[var(--surface)] p-4 ring-1 ring-[var(--border)]">
            <p className="text-sm font-bold">
              {contest === "daily" ? "Who is winning today" : "Who is winning this month"}
            </p>
            {board.isPending ? (
              <p className="mt-2 text-sm text-[var(--dim)]">Loading…</p>
            ) : rows.length > 0 ? (
              <ol className="mt-1 divide-y divide-[var(--border)]">
                {rows.map((r) => (
                  <StandingRow key={r.rank} {...r} />
                ))}
              </ol>
            ) : (
              <p className="mt-2 text-sm text-[var(--dim)]">
                {contest === "affiliate"
                  ? "Nobody is on this month's board yet — invite friends to be the first."
                  : "Nobody is on the board yet — be the first."}
              </p>
            )}
            <p className="mt-3 text-sm font-bold">
              {contest === "daily" ? "Daily contest prizes" : "Affiliate contest prizes"}
            </p>
            <ul className="mt-2 divide-y divide-[var(--border)]">
              {tiers.map((tier) => (
                <li key={tier.label} className="flex items-center justify-between py-2 text-sm">
                  <span className="font-semibold">{tier.label}</span>
                  <span className="font-display font-bold text-[var(--brand-deep)] dark:text-[var(--brand)]">
                    {tier.prizeCents > 0 ? fmt(tier.prizeCents) : "$0"}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs font-semibold text-[var(--dim)]">
              You are in automatically — just earn. No sign-up step needed.
            </p>
          </div>
        )}
      </div>
      {d?.lastDailyPayout && (
        <p className="mt-4 rounded-2xl bg-[var(--pill)] px-4 py-3 text-sm font-semibold ring-1 ring-[var(--border)]" role="status">
          🏆 Yesterday's Daily winner: <span className="font-display font-extrabold">{d.lastDailyPayout.winnerName}</span>{" "}
          took 1st place (<span className="font-display font-extrabold text-[var(--brand)]">{fmt(d.lastDailyPayout.amountCents)}</span>)
          — the owner pays the prizes from the admin panel.
        </p>
      )}
      {contest === "affiliate" && d?.lastAffiliatePayout && (
        <p className="mt-4 rounded-2xl bg-[var(--pill)] px-4 py-3 text-sm font-semibold ring-1 ring-[var(--border)]" role="status">
          🏆 Last month's Affiliate winner: <span className="font-display font-extrabold">{d.lastAffiliatePayout.winnerName}</span>{" "}
          took 1st place (<span className="font-display font-extrabold text-[var(--brand)]">{fmt(d.lastAffiliatePayout.amountCents)}</span>)
          — the owner pays the prizes from the admin panel.
        </p>
      )}
      {board.isPending ? (
        <p className="mt-6 text-sm text-[var(--dim)]">Loading…</p>
      ) : rows.length > 0 ? (
        <ol className="mt-5 divide-y divide-[var(--border)] rounded-2xl bg-[var(--surface)] px-4 ring-1 ring-[var(--border)]">
          {rows.map((r) => (
            <StandingRow key={r.rank} {...r} />
          ))}
        </ol>
      ) : (
        <div className="mt-5 rounded-3xl border-2 border-dashed border-[var(--border)] bg-[var(--surface)] px-6 py-10 text-center text-sm text-[var(--dim)]">
          {contest === "affiliate"
            ? "Nobody is on this month's board yet — invite friends to be the first."
            : "Nobody is on the board yet — be the first."}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------ affiliate tab

function AffiliateTab({ token }: { token: string }) {
  const aff = useQuery({
    queryKey: ["affiliate", token],
    queryFn: () => api.getAffiliate({ token }),
  });
  const [copied, setCopied] = useState(false);
  const link = aff.data ? `https://tapone.store/?r=${aff.data.referralCode}` : "";
  return (
    <div>
      <h1 className="font-display text-2xl font-extrabold sm:text-3xl">Affiliate</h1>
      <p className="mt-1 max-w-xl text-sm leading-relaxed text-[var(--dim)]">
        Invite friends with your link. You earn{" "}
        <strong className="text-[var(--text)]">{aff.data?.earningPct ?? 8}% of everything they earn</strong>{" "}
        and <strong className="text-[var(--text)]">{aff.data?.spendingPct ?? 5}% of what they spend</strong> —
        for life, paid in dollars.
      </p>

      <section className="mt-5 rounded-3xl bg-[var(--surface)] p-5 ring-1 ring-[var(--border)] sm:p-6" aria-label="Referral link">
        <p className="text-sm font-semibold text-[var(--dim)]">Your referral link</p>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          <code className="flex-1 truncate rounded-xl bg-[var(--surface-2)] px-4 py-3 text-sm font-semibold">
            {link || "Loading…"}
          </code>
          <button
            type="button"
            disabled={!link}
            onClick={() => {
              void navigator.clipboard?.writeText(link).then(() => {
                setCopied(true);
                window.setTimeout(() => setCopied(false), 2000);
              });
            }}
            className="rounded-full bg-[var(--brand)] px-5 py-3 text-sm font-bold text-white transition hover:bg-[var(--brand-deep)] disabled:opacity-60"
          >
            {copied ? "Copied!" : "Copy link"}
          </button>
        </div>
        <p className="mt-3 text-sm text-[var(--dim)]">
          Your code: <span className="font-display font-bold text-[var(--text)]">{aff.data?.referralCode ?? "…"}</span>
        </p>
      </section>

      <section className="mt-4 grid grid-cols-2 gap-3" aria-label="Affiliate stats">
        <div className="rounded-2xl bg-[var(--surface)] p-5 ring-1 ring-[var(--border)]">
          <p className="font-display text-2xl font-extrabold">{aff.data?.referrals.length ?? "–"}</p>
          <p className="mt-0.5 text-xs font-semibold text-[var(--dim)]">Total referrals</p>
        </div>
        <div className="rounded-2xl bg-[var(--surface)] p-5 ring-1 ring-[var(--border)]">
          <p className="font-display text-2xl font-extrabold">
            {aff.data ? fmt(aff.data.totalCommissionCents) : "–"}
          </p>
          <p className="mt-0.5 text-xs font-semibold text-[var(--dim)]">Commission earned</p>
        </div>
      </section>

      <section className="mt-6" aria-label="My referrals">
        <h2 className="font-display text-lg font-bold">My referrals</h2>
        <p className="mt-1 text-sm text-[var(--dim)]">
          Everyone who signed up with your link — every signup, what each
          of them has earned, and the commission they made for you.
        </p>
        {aff.isPending ? (
          <p className="mt-3 text-sm text-[var(--dim)]">Loading…</p>
        ) : aff.data && aff.data.referrals.length > 0 ? (
          <div className="mt-3 overflow-hidden rounded-2xl bg-[var(--surface)] ring-1 ring-[var(--border)]">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-left text-xs text-[var(--dim)]">
                  <th scope="col" className="px-3 py-3 font-bold sm:px-4">Name</th>
                  <th scope="col" className="px-2 py-3 font-bold">Joined</th>
                  <th scope="col" className="px-2 py-3 text-right font-bold">They earned</th>
                  <th scope="col" className="px-3 py-3 text-right font-bold sm:px-4">Your commission</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {aff.data.referrals.map((r, i) => (
                  <tr key={i}>
                    <td className="break-words px-3 py-3 font-semibold sm:px-4">{r.name}</td>
                    <td className="whitespace-nowrap px-2 py-3 text-xs text-[var(--dim)]">{fmtDate(r.joinedAt)}</td>
                    <td className="px-2 py-3 text-right font-semibold">{fmt(r.totalEarnedCents)}</td>
                    <td className="px-3 py-3 text-right font-display font-bold text-[var(--brand-deep)] dark:text-[var(--brand)] sm:px-4">
                      +{fmt(r.earnedForYouCents)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-[var(--border)] bg-[var(--surface-2)] font-bold">
                  <td className="px-3 py-3 sm:px-4" colSpan={2}>
                    Total · {aff.data.referrals.length}{" "}
                    {aff.data.referrals.length === 1 ? "referral" : "referrals"}
                  </td>
                  <td className="px-2 py-3 text-right">
                    {fmt(aff.data.referrals.reduce((s, r) => s + r.totalEarnedCents, 0))}
                  </td>
                  <td className="px-3 py-3 text-right sm:px-4">
                    +{fmt(aff.data.referrals.reduce((s, r) => s + r.earnedForYouCents, 0))}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        ) : (
          <p className="mt-3 text-sm text-[var(--dim)]">
            No referrals yet. Share your link and start earning commission.
          </p>
        )}
      </section>
    </div>
  );
}

// ------------------------------------------------------------- my offers

function MyOffersPanel({ token }: { token: string }) {
  const [sub, setSub] = useState<"completed" | "offers" | "surveys" | "chargebacks" | "started">("completed");
  const stats = useQuery({ queryKey: ["my-stats", token], queryFn: () => api.getMyStats({ token }) });
  const mine = useQuery({ queryKey: ["my-offers", token], queryFn: () => api.getMyOffers({ token }) });
  const s = stats.data;
  const items = (mine.data?.items ?? []).filter((i) =>
    sub === "completed" ? true : sub === "offers" ? i.kind === "offer" : sub === "surveys" ? i.kind === "survey" : false,
  );
  const cells: [string, string][] = [
    ["Offers Completed", s ? String(s.offersCompleted) : "–"],
    ["Offer Earnings", s ? fmt(s.offerEarningsCents) : "–"],
    ["Pending Earnings", s ? fmt(s.pendingCents) : "–"],
    ["% Chargeback Rate", s ? `${s.chargebackRatePct}%` : "–"],
  ];
  return (
    <section className="mt-8" aria-label="My Offers">
      <h2 className="font-display text-xl font-extrabold">My Offers</h2>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
        {cells.map(([label, value]) => (
          <div key={label} className="rounded-2xl bg-[var(--surface)] p-3 ring-1 ring-[var(--border)] sm:p-4">
            <p className="font-display text-lg font-extrabold text-[var(--brand)] sm:text-xl">{value}</p>
            <p className="mt-0.5 text-[11px] font-semibold text-[var(--dim)] sm:text-xs">{label}</p>
          </div>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap gap-2" role="tablist" aria-label="My Offers filter">
        {(
          [
            { id: "completed" as const, label: "Completed" },
            { id: "offers" as const, label: "Offers" },
            { id: "surveys" as const, label: "Surveys" },
            { id: "chargebacks" as const, label: "Chargebacks" },
            { id: "started" as const, label: "Started" },
          ]
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={sub === tab.id}
            onClick={() => setSub(tab.id)}
            className={`rounded-full px-4 py-2 text-sm font-bold ring-1 transition ${
              sub === tab.id
                ? "bg-[var(--brand)] text-white ring-[var(--brand)]"
                : "bg-[var(--surface)] ring-[var(--border)]"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {sub === "chargebacks" ? (
        <p className="mt-4 rounded-2xl border-2 border-dashed border-[var(--border)] bg-[var(--surface)] px-5 py-8 text-center text-sm text-[var(--dim)]">
          No chargebacks recorded on your account.
        </p>
      ) : sub === "started" ? (
        <p className="mt-4 rounded-2xl border-2 border-dashed border-[var(--border)] bg-[var(--surface)] px-5 py-8 text-center text-sm text-[var(--dim)]">
          Offers you start will appear here.
        </p>
      ) : mine.isPending ? (
        <p className="mt-4 text-sm text-[var(--dim)]">Loading…</p>
      ) : items.length > 0 ? (
        <ul className="mt-4 divide-y divide-[var(--border)] rounded-2xl bg-[var(--surface)] px-4 ring-1 ring-[var(--border)]">
          {items.map((i) => (
            <li key={i.id} className="flex items-center justify-between gap-3 py-3">
              <span>
                <span className="block text-sm font-semibold">{i.network}</span>
                <span className="block text-xs text-[var(--dim)]">
                  {i.kind === "survey" ? "Survey" : "Offer"} · {fmtDateTime(i.createdAt)}
                </span>
              </span>
              <span className="font-display text-base font-bold text-[var(--brand)]">+{fmt(i.creditedCents)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 rounded-2xl border-2 border-dashed border-[var(--border)] bg-[var(--surface)] px-5 py-8 text-center text-sm text-[var(--dim)]">
          Nothing completed yet — finished offers and surveys land here with their earnings.
        </p>
      )}
    </section>
  );
}

// -------------------------------------------------------------- profile tab

function ProfileTab({
  token,
  user,
  go,
  onSignOut,
}: {
  token: string;
  user: User;
  go: (t: DashboardTab) => void;
  onSignOut: () => void;
}) {
  const queryClient = useQueryClient();
  const lvl = useQuery({ queryKey: ["level", token], queryFn: () => api.getLevel({ token }) });
  const stats = useQuery({ queryKey: ["my-stats", token], queryFn: () => api.getMyStats({ token }) });
  const [uploadError, setUploadError] = useState<string | null>(null);
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const firstName = user.name.split(" ")[0] ?? user.name;

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const { dataBase64, mimeType } = await fileToBase64(file);
      return api.updateProfilePicture({ token, dataBase64, mimeType });
    },
    onSuccess: () => {
      setUploadError(null);
      void queryClient.invalidateQueries({ queryKey: ["me", token] });
    },
    onError: (e) => setUploadError(e.message),
  });
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const saveName = useMutation({
    mutationFn: async () => {
      const name = nameDraft.trim();
      if (!name) throw new Error("Type a display name.");
      return api.updateDisplayName({ token, name });
    },
    onSuccess: () => {
      setNameError(null);
      setEditingName(false);
      void queryClient.invalidateQueries({ queryKey: ["me", token] });
    },
    onError: (e) => setNameError(e.message),
  });
  const [tokenCopied, setTokenCopied] = useState(false);
  // Profile shows NO IP address, NO country and NO login method —
  // IP and country are admin-only (never even sent to this client)
  // and sign-in is Google-only, so there is no method to show.
  // The Offer Token IS shown: it is this user's own unique token —
  // every TapOne user has a different one.
  const rows: [string, string][] = [
    ["Email", user.email],
    ["Offer Token", user.offerToken],
    ["Member since", fmtDate(user.createdAt)],
  ];
  const d = lvl.data;
  return (
    <div>
      <h1 className="font-display text-2xl font-extrabold sm:text-3xl">Profile</h1>
      <section className="mt-5 rounded-3xl bg-[var(--surface)] p-5 ring-1 ring-[var(--border)] sm:p-6">
        <div className="flex flex-wrap items-center gap-4">
          {user.pictureUrl ? (
            <img src={user.pictureUrl} alt="" className="h-16 w-16 rounded-full object-cover" />
          ) : (
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-[var(--avatar)] font-display text-2xl font-extrabold text-white">
              {user.name.charAt(0).toUpperCase()}
            </span>
          )}
          <div className="min-w-0">
            <p className="font-display text-xl font-bold">
              {greeting}, {firstName}
            </p>
            <p className="text-sm text-[var(--dim)]">{user.email}</p>
            <label className="mt-2 inline-block cursor-pointer rounded-full bg-[var(--surface-2)] px-4 py-2 text-sm font-bold ring-1 ring-[var(--border)] transition hover:ring-[var(--brand)]">
              {upload.isPending ? "Uploading…" : "Choose File"}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="sr-only"
                aria-label="Choose a new profile picture"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) upload.mutate(f);
                  e.target.value = "";
                }}
              />
            </label>
            {uploadError && (
              <p role="alert" className="mt-2 text-sm font-medium text-red-600 dark:text-red-400">{uploadError}</p>
            )}
          </div>
        </div>

        <div className="mt-6 rounded-2xl bg-[var(--surface-2)] p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-semibold text-[var(--dim)]">Display name</p>
              <p className="mt-0.5 truncate font-display text-base font-bold">{user.name}</p>
            </div>
            {!editingName &&
              (user.nameChangesLeft > 0 ? (
                <button
                  type="button"
                  onClick={() => {
                    setNameDraft(user.name);
                    setNameError(null);
                    setEditingName(true);
                  }}
                  className="rounded-full bg-[var(--surface)] px-4 py-2 text-sm font-bold ring-1 ring-[var(--border)] transition hover:ring-[var(--brand)]"
                >
                  Change name
                </button>
              ) : (
                <span className="rounded-full bg-[var(--surface)] px-4 py-2 text-sm font-bold text-[var(--dim)] ring-1 ring-[var(--border)]">
                  Name locked
                </span>
              ))}
          </div>
          {editingName && (
            <form
              className="mt-3"
              onSubmit={(e) => {
                e.preventDefault();
                setNameError(null);
                if (!nameDraft.trim()) {
                  setNameError("Type a display name.");
                  return;
                }
                saveName.mutate();
              }}
            >
              <label htmlFor="profile-display-name" className="sr-only">Display name</label>
              <input
                id="profile-display-name"
                {...FIELDS.updateDisplayName.name}
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                autoComplete="off"
                className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm outline-none focus:border-[var(--brand)]"
                placeholder="Your display name"
              />
              {nameError && (
                <p role="alert" className="mt-2 text-sm font-medium text-red-600 dark:text-red-400">{nameError}</p>
              )}
              <div className="mt-3 flex gap-2">
                <button
                  type="submit"
                  disabled={saveName.isPending}
                  className="rounded-full bg-[var(--brand)] px-5 py-2 text-sm font-bold text-white transition hover:bg-[var(--brand-deep)] disabled:opacity-60"
                >
                  {saveName.isPending ? "Saving…" : "Save name"}
                </button>
                <button
                  type="button"
                  onClick={() => setEditingName(false)}
                  className="rounded-full bg-[var(--surface)] px-5 py-2 text-sm font-bold ring-1 ring-[var(--border)]"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
          <p className="mt-2 text-xs leading-relaxed text-[var(--dim)]">
            This is the name shown on the leaderboard and to your referrals.
            Your email address stays the same. You can change your display
            name 3 times in total —{" "}
            <strong className="text-[var(--text)]">
              {user.nameChangesLeft}{" "}
              {user.nameChangesLeft === 1 ? "change" : "changes"} left
            </strong>
            {user.nameChangesLeft === 0
              ? ", so your name is now locked."
              : "."}
          </p>
        </div>

        <div className="mt-4 rounded-2xl bg-[var(--surface-2)] p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-display text-base font-bold">
              Lv.{d?.level ?? user.level}
              {d?.title && <span className="ml-2 text-[var(--brand-deep)]">{d.title}</span>}
            </p>
            <button
              type="button"
              onClick={() => go("level")}
              className="text-sm font-bold text-[var(--brand-deep)]"
            >
              Privilege →
            </button>
          </div>
          <div className="mt-3 h-3 overflow-hidden rounded-full bg-[var(--surface)]">
            <div className="h-full rounded-full bg-[var(--brand)]" style={{ width: `${d?.progressPct ?? 0}%` }} />
          </div>
          <p className="mt-1.5 text-xs font-semibold text-[var(--dim)]">
            {d?.nextTitle
              ? `Progress to ${d.nextTitle.name} — ${d.progressPct}%`
              : "Highest title reached"}
          </p>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl bg-[var(--pill)] p-4 ring-1 ring-[var(--border)]">
            <p className="text-xs font-semibold text-[var(--dim)]">Main Balance</p>
            <p className="mt-1 font-display text-2xl font-extrabold">{fmt(user.balanceCents)}</p>
            <button
              type="button"
              onClick={() => go("withdraw")}
              className="mt-2 rounded-full bg-[var(--brand)] px-5 py-2 text-sm font-bold text-white transition hover:bg-[var(--brand-deep)]"
            >
              Cashout
            </button>
          </div>
          <div className="rounded-2xl bg-[var(--surface-2)] p-4 ring-1 ring-[var(--border)]">
            <p className="text-xs font-semibold text-[var(--dim)]">Total Cashout</p>
            <p className="mt-1 font-display text-2xl font-extrabold">
              {stats.data ? fmt(stats.data.totalCashoutCents) : "…"}
            </p>
            <button
              type="button"
              onClick={() => go("history")}
              className="mt-2 rounded-full bg-[var(--surface)] px-5 py-2 text-sm font-bold ring-1 ring-[var(--border)]"
            >
              History
            </button>
          </div>
        </div>

        <dl className="mt-6 divide-y divide-[var(--border)]">
          {rows.map(([label, value]) => (
            <div key={label} className="flex items-center justify-between gap-4 py-3">
              <dt className="text-sm font-semibold text-[var(--dim)]">{label}</dt>
              <dd className="text-right font-display text-sm font-bold">
                {label === "Offer Token" ? (
                  <span className="flex items-center justify-end gap-2">
                    <span className="break-all">{value}</span>
                    <button
                      type="button"
                      aria-label="Copy your Offer Token"
                      onClick={() => {
                        void navigator.clipboard?.writeText(value).then(() => {
                          setTokenCopied(true);
                          window.setTimeout(() => setTokenCopied(false), 2000);
                        });
                      }}
                      className="shrink-0 rounded-full bg-[var(--pill)] px-3 py-1.5 font-sans text-xs font-bold text-[var(--brand-deep)] ring-1 ring-[var(--border)] transition hover:ring-[var(--brand)]"
                    >
                      {tokenCopied ? "Copied!" : "Copy"}
                    </button>
                  </span>
                ) : (
                  value
                )}
              </dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 rounded-xl bg-[var(--surface-2)] px-4 py-3 text-xs leading-relaxed text-[var(--dim)]">
          Your Offer Token is unique to your account — every TapOne user
          has a different one. Offers, surveys, games and payment methods
          are matched to your account automatically.
        </p>
      </section>

      <section className="mt-5 rounded-3xl bg-[var(--surface)] p-5 ring-1 ring-[var(--border)] sm:p-6" aria-label="Settings">
        <h2 className="font-display text-lg font-bold">Settings</h2>
        <div className="mt-3 divide-y divide-[var(--border)]">
          <div className="flex items-center justify-between gap-4 py-3">
            <span>
              <span className="block text-sm font-bold">Wallet</span>
              <span className="block text-xs text-[var(--dim)]">Your balance and cashout methods</span>
            </span>
            <button
              type="button"
              onClick={() => go("withdraw")}
              className="rounded-full bg-[var(--surface-2)] px-4 py-2 text-sm font-bold ring-1 ring-[var(--border)]"
            >
              Open
            </button>
          </div>
        </div>
        <button
          type="button"
          onClick={onSignOut}
          className="mt-5 flex items-center gap-2 rounded-full bg-red-500/10 px-5 py-2.5 text-sm font-bold text-red-600 dark:text-red-400"
        >
          {Icons.logout("h-4 w-4")} Sign out
        </button>
      </section>
    </div>
  );
}

// ------------------------------------------------------------ contact tab

// Contact Us: the owner's social channels, read live from the same
// admin Social Links settings that feed the footer (getPublicHome), so
// whatever link the owner saves in Admin → Settings shows here for ALL
// users and opens directly on tap. Platforms the owner hasn't added
// yet show as "not added yet" instead of a dead link.
const CONTACT_PLATFORMS: { id: string; label: string; blurb: string }[] = [
  { id: "youtube", label: "YouTube", blurb: "Watch our videos and updates" },
  { id: "tiktok", label: "TikTok", blurb: "Short videos and announcements" },
  { id: "facebook", label: "Facebook", blurb: "Follow our page and message us" },
  { id: "twitter", label: "Twitter", blurb: "Follow us on X (Twitter)" },
];

function ContactTab() {
  const home = useQuery({
    queryKey: ["public-home"],
    queryFn: () => api.getPublicHome({}),
  });
  const links = home.data?.socialLinks ?? [];
  return (
    <div>
      <h1 className="font-display text-2xl font-extrabold sm:text-3xl">Contact Us</h1>
      <p className="mt-1 max-w-xl text-sm leading-relaxed text-[var(--dim)]">
        Reach the TapOne team on our social channels — tap one to open it
        directly and contact us there. For account questions, you can also
        use Help &amp; Mailbox.
      </p>
      <section className="mt-5 grid gap-3 sm:grid-cols-2" aria-label="Contact us on social media">
        {CONTACT_PLATFORMS.map((p) => {
          const link = links.find((s) => s.platform === p.id);
          return link ? (
            <a
              key={p.id}
              href={link.url}
              target="_blank"
              rel="noreferrer"
              aria-label={`Contact us on ${p.label} (opens in a new tab)`}
              className="flex items-center justify-between gap-3 rounded-2xl bg-[var(--surface)] p-5 ring-1 ring-[var(--border)] transition hover:ring-[var(--brand)]"
            >
              <span>
                <span className="block font-display text-base font-bold">{p.label}</span>
                <span className="mt-0.5 block text-sm text-[var(--dim)]">{p.blurb}</span>
              </span>
              <span className="shrink-0 rounded-full bg-[var(--brand)] px-4 py-2 text-sm font-bold text-white">
                Open
              </span>
            </a>
          ) : (
            <div
              key={p.id}
              className="flex items-center justify-between gap-3 rounded-2xl bg-[var(--surface)] p-5 opacity-70 ring-1 ring-[var(--border)]"
            >
              <span>
                <span className="block font-display text-base font-bold">{p.label}</span>
                <span className="mt-0.5 block text-sm text-[var(--dim)]">{p.blurb}</span>
              </span>
              <span className="shrink-0 rounded-full bg-[var(--surface-2)] px-4 py-2 text-sm font-bold text-[var(--dim)] ring-1 ring-[var(--border)]">
                {home.isPending ? "Loading…" : "Not added yet"}
              </span>
            </div>
          );
        })}
      </section>
    </div>
  );
}

// ------------------------------------------------- notification bell
//
// Owner broadcasts (announcements + events) land here for every user:
// the bell sits next to Balance, shows the unread count, and opens the
// list. Opening an item (or "Mark all as read") marks it read and the
// badge drops.

function NotificationBell({ token }: { token: string }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const list = useQuery({
    queryKey: ["announcements", token],
    queryFn: () => api.getAnnouncements({ token }),
  });
  const unread = list.data?.unreadCount ?? 0;

  const mark = useMutation({
    mutationFn: async (announcementId?: number) =>
      api.markAnnouncementsRead({ token, announcementId }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["announcements", token] });
    },
  });

  return (
    <span className="relative">
      <button
        type="button"
        aria-label={`Notifications${unread > 0 ? `, ${unread} unread` : ""}`}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="relative flex h-10 w-10 items-center justify-center rounded-full bg-[var(--pill)] text-[var(--text)] ring-1 ring-[var(--border)]"
      >
        {Icons.bell("h-5 w-5")}
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[11px] font-bold text-white">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>
      {open && (
        <>
          <button
            type="button"
            aria-label="Close notifications"
            className="fixed inset-0 z-10 cursor-default"
            onClick={() => setOpen(false)}
          />
          <span className="absolute right-0 z-20 mt-2 block w-80 max-w-[85vw] overflow-hidden rounded-2xl bg-[var(--surface)] text-left shadow-xl ring-1 ring-[var(--border)]">
            <span className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
              <span className="font-display text-sm font-bold">Notifications</span>
              {unread > 0 && (
                <button
                  type="button"
                  disabled={mark.isPending}
                  onClick={() => mark.mutate(undefined)}
                  className="text-xs font-bold text-[var(--brand-deep)] disabled:opacity-60"
                >
                  Mark all as read
                </button>
              )}
            </span>
            <span className="block max-h-96 overflow-y-auto">
              {list.isPending ? (
                <span className="block px-4 py-6 text-center text-sm text-[var(--dim)]">Loading…</span>
              ) : list.data && list.data.announcements.length > 0 ? (
                list.data.announcements.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => {
                      if (!a.read) mark.mutate(a.id);
                    }}
                    className={`block w-full border-b border-[var(--border)] px-4 py-3 text-left last:border-b-0 ${
                      a.read ? "" : "bg-[var(--pill)]"
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ${
                          a.kind === "event"
                            ? "bg-[var(--gold)] text-[var(--ink)]"
                            : "bg-[var(--surface-2)] text-[var(--dim)]"
                        }`}
                      >
                        {a.kind === "event" ? "Event" : "Announcement"}
                      </span>
                      {!a.read && (
                        <span className="rounded-full bg-red-600 px-2 py-0.5 text-[11px] font-bold text-white">
                          NEW
                        </span>
                      )}
                      <span className="ml-auto shrink-0 text-[11px] text-[var(--dim)]">
                        {fmtDate(a.createdAt)}
                      </span>
                    </span>
                    <span className="mt-1 block text-sm font-bold">{a.title}</span>
                    <span className="mt-0.5 block whitespace-pre-wrap text-sm leading-relaxed text-[var(--dim)]">
                      {a.body}
                    </span>
                  </button>
                ))
              ) : (
                <span className="block px-4 py-6 text-center text-sm text-[var(--dim)]">
                  No announcements yet. New events and updates from TapOne will appear here.
                </span>
              )}
            </span>
          </span>
        </>
      )}
    </span>
  );
}

// ----------------------------------------------------------------- help tab

function HelpTab({ token }: { token: string }) {
  const queryClient = useQueryClient();
  const mailbox = useQuery({
    queryKey: ["mailbox", token],
    queryFn: () => api.getMailbox({ token }),
  });
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageData, setImageData] = useState<{
    dataBase64: string;
    mimeType: string;
  } | null>(null);

  const pickImage = async (file: File | undefined) => {
    setFormError(null);
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      setFormError("Please choose a PNG, JPG or WebP image.");
      return;
    }
    if (file.size > 2_200_000) {
      setFormError("That image is too large — please pick one under 2 MB.");
      return;
    }
    const { dataBase64, mimeType } = await fileToBase64(file);
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
    setImageData({ dataBase64, mimeType });
  };

  const send = useMutation({
    mutationFn: async () =>
      api.sendHelpMessage({
        token,
        subject: subject.trim(),
        body: body.trim(),
        ...(imageData
          ? {
              imageDataBase64: imageData.dataBase64,
              imageMimeType: imageData.mimeType,
            }
          : {}),
      }),
    onSuccess: () => {
      setSubject("");
      setBody("");
      setImageFile(null);
      setImagePreview(null);
      setImageData(null);
      setSent(true);
      void queryClient.invalidateQueries({ queryKey: ["mailbox", token] });
      void queryClient.invalidateQueries({ queryKey: ["me", token] });
    },
    onError: (error) => setFormError(error.message),
  });

  return (
    <div>
      <h1 className="font-display text-2xl font-extrabold sm:text-3xl">Help &amp; Mailbox</h1>
      <p className="mt-1 text-sm text-[var(--dim)]">
        Messages go straight to the TapOne team. Replies appear right here in your mailbox.
      </p>

      <h2 className="mt-6 font-display text-lg font-bold">📬 Mailbox</h2>
      <section className="mt-3 space-y-3" aria-label="Mailbox">
        {mailbox.isPending ? (
          <p className="text-sm text-[var(--dim)]">Loading…</p>
        ) : mailbox.data && mailbox.data.messages.length > 0 ? (
          mailbox.data.messages.map((m) => (
            <div key={m.id} className={`flex ${m.sender === "user" ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[85%] rounded-2xl px-4 py-3 sm:max-w-[70%] ${
                  m.sender === "user"
                    ? "bg-[var(--brand)] text-white"
                    : "bg-[var(--surface)] ring-1 ring-[var(--border)]"
                }`}
              >
                {m.subject && <p className="text-sm font-bold">{m.subject}</p>}
                <p className="whitespace-pre-wrap text-sm leading-relaxed">{m.body}</p>
                {m.imageUrl && (
                  <a href={m.imageUrl} target="_blank" rel="noreferrer" className="mt-2 block">
                    <img
                      src={m.imageUrl}
                      alt="Photo attached to this message"
                      className="max-h-40 rounded-xl object-cover ring-1 ring-white/40"
                    />
                  </a>
                )}
                {m.sender === "user" && (
                  <p className="mt-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
                        m.status === "approved" ? "bg-green-600 text-white" : "bg-amber-500 text-white"
                      }`}
                    >
                      {m.status === "approved" ? "Approved" : "Pending"}
                    </span>
                  </p>
                )}
                <p className={`mt-1.5 text-[11px] ${m.sender === "user" ? "text-white/70" : "text-[var(--dim)]"}`}>
                  {m.sender === "user" ? "You" : "TapOne team"} · {fmtDateTime(m.createdAt)}
                </p>
              </div>
            </div>
          ))
        ) : (
          <p className="rounded-2xl border-2 border-dashed border-[var(--border)] bg-[var(--surface)] px-5 py-8 text-center text-sm text-[var(--dim)]">
            No messages yet. Ask us anything below.
          </p>
        )}
      </section>

      <form
        className="mt-6 rounded-3xl bg-[var(--surface)] p-5 ring-1 ring-[var(--border)] sm:p-6"
        onSubmit={(e) => {
          e.preventDefault();
          setFormError(null);
          setSent(false);
          if (!body.trim()) {
            setFormError("Please write your message first.");
            return;
          }
          send.mutate();
        }}
      >
        <p className="font-display text-base font-bold">✉️ Help — send a message</p>
        <div className="mt-3">
          <label htmlFor="help-subject" className="text-sm font-semibold">
            Subject <span className="font-normal text-[var(--dim)]">(optional)</span>
          </label>
          <input
            id="help-subject"
            {...FIELDS.sendHelpMessage.subject}
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="e.g. Withdrawal question"
            className="mt-1 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 outline-none focus:border-[var(--brand)]"
          />
        </div>
        <div className="mt-3">
          <label htmlFor="help-body" className="text-sm font-semibold">
            Message
          </label>
          <textarea
            id="help-body"
            {...FIELDS.sendHelpMessage.body}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={4}
            placeholder="How can we help?"
            className="mt-1 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 outline-none focus:border-[var(--brand)]"
          />
        </div>
        <div className="mt-3">
          <label htmlFor="help-image" className="text-sm font-semibold">
            Photo <span className="font-normal text-[var(--dim)]">(optional — a screenshot of the problem)</span>
          </label>
          <input
            id="help-image"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(e) => {
              void pickImage(e.target.files?.[0]);
              e.target.value = "";
            }}
            className="mt-1 block w-full text-sm text-[var(--dim)] file:mr-3 file:rounded-full file:border-0 file:bg-[var(--surface-2)] file:px-4 file:py-2 file:text-sm file:font-bold file:text-[var(--text)]"
          />
          {imagePreview && (
            <div className="mt-2 flex items-start gap-3">
              <img
                src={imagePreview}
                alt="Photo you attached"
                className="h-20 w-20 rounded-xl object-cover ring-1 ring-[var(--border)]"
              />
              <div>
                <p className="break-all text-sm font-semibold">{imageFile?.name}</p>
                <button
                  type="button"
                  onClick={() => {
                    setImageFile(null);
                    setImagePreview(null);
                    setImageData(null);
                  }}
                  className="mt-1 text-sm font-bold text-red-600 dark:text-red-400"
                >
                  Remove photo
                </button>
              </div>
            </div>
          )}
        </div>
        {formError && (
          <p role="alert" className="mt-3 text-sm font-medium text-red-600 dark:text-red-400">
            {formError}
          </p>
        )}
        {sent && (
          <p role="status" className="mt-3 text-sm font-medium text-[var(--brand-deep)] dark:text-[var(--brand)]">
            Message sent. We will reply here in your mailbox.
          </p>
        )}
        <button
          type="submit"
          disabled={send.isPending}
          className="mt-4 flex items-center gap-2 rounded-full bg-[var(--brand)] px-6 py-3 font-display text-sm font-bold text-white transition hover:bg-[var(--brand-deep)] disabled:opacity-60"
        >
          {Icons.send("h-4 w-4")} {send.isPending ? "Sending…" : "Send message"}
        </button>
      </form>
    </div>
  );
}
