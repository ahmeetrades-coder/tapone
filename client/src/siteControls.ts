// Site Controls — owner-managed visibility, names and custom links for
// the signed-in dashboard (owner order 2026-11-28: everything he used
// to do in GitHub should be doable from the Admin panel).
//
// One JSON setting (`site_controls_json`) holds the whole config; the
// server validates it on save (see parseSiteControls in
// server/src/actions.ts) and the dashboard reads it from getPublicHome.
// No redeploy is ever needed: save in Admin → Site Controls, and every
// user sees it on their next dashboard load or tab tap.
//
// Rules (mirrored server-side — keep the two in sync):
// - Every dashboard tab can be hidden except "dashboard" itself, or
//   users would have nowhere to land. Every tab can be renamed.
// - The Dashboard home blocks (Balance, Level progress, Quick stats,
//   Earn shortcuts, Weekly check-in) can be hidden. They have no menu
//   names, so they are not renamed — only the tabs are.
// - Custom links (max 20) open in a new tab and show in the desktop
//   sidebar and in the mobile "All sections" sheet.
// - Anything missing or malformed falls back to "everything visible
//   with its built-in name", so a bad save can never blank the site.

export type SiteControlTabId =
  | "dashboard"
  | "offers"
  | "surveys"
  | "playtime"
  | "partners"
  | "level"
  | "cashout"
  | "contest"
  | "affiliate-contest"
  | "withdraw"
  | "invite"
  | "history"
  | "profile"
  | "help"
  | "contact";

// The 15 dashboard tabs, in menu order — the same list as TABS in
// Dashboard.tsx. `canHide: false` only for the Dashboard itself.
export const SITE_CONTROL_TABS: { id: SiteControlTabId; label: string; canHide: boolean }[] = [
  { id: "dashboard", label: "Dashboard", canHide: false },
  { id: "offers", label: "Offers", canHide: true },
  { id: "surveys", label: "Surveys", canHide: true },
  { id: "playtime", label: "Playtime", canHide: true },
  { id: "partners", label: "Surveys partners", canHide: true },
  { id: "level", label: "Level & Privileges", canHide: true },
  { id: "cashout", label: "Live Cashout", canHide: true },
  { id: "contest", label: "Daily Contest", canHide: true },
  { id: "affiliate-contest", label: "Affiliate Contest", canHide: true },
  { id: "withdraw", label: "Withdraw", canHide: true },
  { id: "invite", label: "Invite Friends", canHide: true },
  { id: "history", label: "History", canHide: true },
  { id: "profile", label: "Profile", canHide: true },
  { id: "help", label: "Help", canHide: true },
  { id: "contact", label: "Redeem Code", canHide: true },
];

export type SiteControlHomeId = "balance" | "level" | "quickstats" | "earn" | "checkin";

// The blocks on the Dashboard home tab — plus the Weekly check-in
// block, which lives at the top of the Surveys / Surveys partners tabs.
export const SITE_CONTROL_HOME: { id: SiteControlHomeId; label: string }[] = [
  { id: "balance", label: "Balance" },
  { id: "level", label: "Level progress" },
  { id: "quickstats", label: "Quick stats" },
  { id: "earn", label: "Earn shortcuts" },
  { id: "checkin", label: "Weekly check-in" },
];

export type SiteControlSection = { visible: boolean; label: string };
export type SiteControlLink = { id: string; label: string; url: string };
export type SiteControls = {
  tabs: Record<string, SiteControlSection>;
  home: Record<string, SiteControlSection>;
  customLinks: SiteControlLink[];
};

export function defaultSiteControls(): SiteControls {
  return {
    tabs: Object.fromEntries(
      SITE_CONTROL_TABS.map((t) => [t.id, { visible: true, label: t.label }]),
    ),
    home: Object.fromEntries(
      SITE_CONTROL_HOME.map((s) => [s.id, { visible: true, label: s.label }]),
    ),
    customLinks: [],
  };
}

function asSection(raw: unknown, fallbackLabel: string, forceVisible: boolean): SiteControlSection {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const label =
    typeof r.label === "string" && r.label.trim() !== ""
      ? r.label.trim().slice(0, 30)
      : fallbackLabel;
  // Anything that is not an explicit "off" counts as on, so older or
  // hand-edited configs never hide a section by accident.
  const visible = forceVisible ? true : r.visible !== false && r.visible !== 0;
  return { visible, label };
}

// Defensive parse: unknown, partial or corrupt input always yields a
// complete, safe config (never throws).
export function normalizeSiteControls(raw: unknown): SiteControls {
  const d = defaultSiteControls();
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const tabsRaw = (r.tabs && typeof r.tabs === "object" ? r.tabs : {}) as Record<string, unknown>;
  const homeRaw = (r.home && typeof r.home === "object" ? r.home : {}) as Record<string, unknown>;
  const tabs: Record<string, SiteControlSection> = {};
  for (const t of SITE_CONTROL_TABS)
    tabs[t.id] = asSection(tabsRaw[t.id], t.label, !t.canHide);
  const home: Record<string, SiteControlSection> = {};
  for (const s of SITE_CONTROL_HOME)
    home[s.id] = asSection(homeRaw[s.id], s.label, false);
  const linksRaw = Array.isArray(r.customLinks) ? r.customLinks : [];
  const customLinks: SiteControlLink[] = [];
  const seen = new Set<string>();
  for (const entry of linksRaw.slice(0, 20)) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const label = typeof e.label === "string" ? e.label.trim().slice(0, 40) : "";
    const url = typeof e.url === "string" ? e.url.trim().slice(0, 500) : "";
    if (!label) continue;
    if (!url.startsWith("http://") && !url.startsWith("https://")) continue;
    const id =
      typeof e.id === "string" && e.id.trim() !== ""
        ? e.id.trim().slice(0, 40)
        : `link_${customLinks.length + 1}`;
    if (seen.has(id)) continue;
    seen.add(id);
    customLinks.push({ id, label, url });
  }
  return { tabs: { ...d.tabs, ...tabs }, home: { ...d.home, ...home }, customLinks };
}

export function tabVisible(c: SiteControls, id: string): boolean {
  return c.tabs[id]?.visible ?? true;
}

export function tabLabel(c: SiteControls, id: string, fallback: string): string {
  const l = c.tabs[id]?.label;
  return l && l.trim() !== "" ? l : fallback;
}

export function homeVisible(c: SiteControls, id: string): boolean {
  return c.home[id]?.visible ?? true;
}
