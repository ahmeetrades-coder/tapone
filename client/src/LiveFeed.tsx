// Public live feed + Top 100 earners (RewardJoy model, TapOne data only).
// Used on the pre-login homepage (App.tsx) and inside the signed-in
// dashboard (Dashboard.tsx). No login needed, no token is sent, and the
// server returns first names + pictures only — never email, IP, country
// or account IDs. No contests, no prizes: Top 100 is a plain ranking
// by lifetime earnings.
import { useQuery } from "@tanstack/react-query";
import { api, type ApiResponse } from "./api";
import { fmt, fmtDateTime } from "./lib";

type LiveItem = ApiResponse<typeof api, "getLiveCompletions">["items"][number];
type TopItem = ApiResponse<typeof api, "getTopEarners">["items"][number];

function Avatar({
  pictureUrl,
  name,
  size,
}: {
  pictureUrl: string | null | undefined;
  name: string;
  size: "md" | "lg";
}) {
  const cls =
    size === "lg"
      ? "h-11 w-11 text-base"
      : "h-10 w-10 text-sm";
  if (pictureUrl) {
    return (
      <img
        src={pictureUrl}
        alt={name}
        className={`${cls} shrink-0 rounded-full object-cover ring-1 ring-[var(--border)]`}
        loading="lazy"
      />
    );
  }
  return (
    <span
      className={`${cls} flex shrink-0 items-center justify-center rounded-full bg-[var(--surface-2)] font-display font-extrabold text-[var(--brand)] ring-1 ring-[var(--border)]`}
      aria-hidden="true"
    >
      {(name || "?").slice(0, 1).toUpperCase()}
    </span>
  );
}

function OfferThumb({
  imageUrl,
  name,
}: {
  imageUrl: string | null | undefined;
  name: string;
}) {
  if (imageUrl) {
    return (
      <img
        src={imageUrl}
        alt={name}
        className="h-10 w-10 shrink-0 rounded-xl object-contain bg-[var(--surface-2)] ring-1 ring-[var(--border)]"
        loading="lazy"
      />
    );
  }
  return (
    <span
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--surface-2)] font-display text-base font-extrabold text-[var(--brand)] ring-1 ring-[var(--border)]"
      aria-hidden="true"
    >
      {(name || "?").slice(0, 1).toUpperCase()}
    </span>
  );
}

export function LiveCompletionsFeed() {
  const q = useQuery({
    queryKey: ["live-completions"],
    queryFn: () => api.getLiveCompletions({}),
    refetchInterval: 30_000,
  });
  const items: LiveItem[] = q.data?.items ?? [];
  return (
    <section className="mt-8" aria-label="Latest completed">
      <h2 className="font-display text-xl font-extrabold">
        Latest completed
      </h2>
      <p className="mt-1 text-sm text-[var(--dim)]">
        The newest offers, surveys and games completed by TapOne users —
        live for everyone to see.
      </p>
      {q.isPending ? (
        <p className="mt-4 text-sm text-[var(--dim)]">Loading…</p>
      ) : items.length > 0 ? (
        <ul className="mt-4 divide-y divide-[var(--border)] rounded-2xl bg-[var(--surface)] px-4 ring-1 ring-[var(--border)]">
          {items.map((i) => (
            <li key={i.id} className="flex items-center justify-between gap-3 py-3">
              <span className="flex min-w-0 items-center gap-3">
                <Avatar pictureUrl={i.userPictureUrl} name={i.userName} size="md" />
                <OfferThumb imageUrl={i.imageUrl} name={i.title} />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold">
                    {i.userName} completed {i.title}
                  </span>
                  <span className="block text-xs text-[var(--dim)]">
                    {i.network} · {i.kind === "survey" ? "Survey" : "Offer"} ·{" "}
                    {fmtDateTime(i.createdAt)}
                  </span>
                </span>
              </span>
              <span className="shrink-0 font-display text-base font-bold text-[var(--brand)]">
                +{fmt(i.creditedCents)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 rounded-2xl border-2 border-dashed border-[var(--border)] bg-[var(--surface)] px-5 py-8 text-center text-sm text-[var(--dim)]">
          Nothing completed yet — the latest completions will show up here.
        </p>
      )}
    </section>
  );
}

export function TopEarnersList() {
  const q = useQuery({
    queryKey: ["top-earners"],
    queryFn: () => api.getTopEarners({}),
    refetchInterval: 60_000,
  });
  const items: TopItem[] = q.data?.items ?? [];
  return (
    <section className="mt-8" aria-label="Top 100 earners">
      <h2 className="font-display text-xl font-extrabold">Top 100 earners</h2>
      <p className="mt-1 text-sm text-[var(--dim)]">
        The users who earned the most on TapOne — total earning and total
        cashout for each.
      </p>
      {q.isPending ? (
        <p className="mt-4 text-sm text-[var(--dim)]">Loading…</p>
      ) : items.length > 0 ? (
        <ul className="mt-4 divide-y divide-[var(--border)] rounded-2xl bg-[var(--surface)] px-4 ring-1 ring-[var(--border)]">
          {items.map((u) => (
            <li key={u.rank} className="flex items-center gap-3 py-3">
              <span className="w-8 shrink-0 text-center font-display text-base font-extrabold text-[var(--brand)]">
                {u.rank}
              </span>
              <Avatar pictureUrl={u.pictureUrl} name={u.name} size="md" />
              <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                {u.name}
              </span>
              <span className="shrink-0 text-right">
                <span className="block font-display text-sm font-bold text-[var(--brand)]">
                  {fmt(u.totalEarnedCents)}
                </span>
                <span className="block text-xs text-[var(--dim)]">
                  earned · {fmt(u.totalCashoutCents)} cashed out
                </span>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 rounded-2xl border-2 border-dashed border-[var(--border)] bg-[var(--surface)] px-5 py-8 text-center text-sm text-[var(--dim)]">
          No earners yet — complete offers, surveys and games to get on
          this list.
        </p>
      )}
    </section>
  );
}

export function LiveCashoutTab({ onWithdraw }: { onWithdraw?: () => void }) {
  return (
    <div>
      <h1 className="font-display text-2xl font-extrabold sm:text-3xl">
        Live Cashout
      </h1>
      <p className="mt-1 text-sm text-[var(--dim)]">
        See what other TapOne users are completing and cashing out, live.
      </p>
      <LiveCompletionsFeed />
      <TopEarnersList />
      {onWithdraw && (
        <button
          type="button"
          onClick={onWithdraw}
          className="mt-6 rounded-full bg-[var(--brand)] px-6 py-3 font-display text-base font-bold text-white transition hover:bg-[var(--brand-deep)]"
        >
          Withdraw
        </button>
      )}
    </div>
  );
}
