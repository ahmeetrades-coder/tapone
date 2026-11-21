import type { ReactNode } from "react";

// ------------------------------------------------------------------ money

export function fmt(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// -------------------------------------------------------------- countries

// Full ISO 3166-1 alpha-2 country list (249 codes). Names come from
// the platform's own region names (Intl.DisplayNames) so the list is
// complete without shipping a name table; sorted by name.
const COUNTRY_CODES =
  "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW".split(
    " ",
  );

export const COUNTRIES: { code: string; name: string }[] = (() => {
  let display: Intl.DisplayNames | null = null;
  try {
    display = new Intl.DisplayNames(["en"], { type: "region" });
  } catch {
    display = null;
  }
  return COUNTRY_CODES.map((code) => {
    let name = code;
    try {
      name = display?.of(code) ?? code;
    } catch {
      name = code;
    }
    return { code, name };
  }).sort((a, b) => a.name.localeCompare(b.name));
})();

export function flagEmojiFor(countryCode: string): string {
  const code = countryCode.toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return "🌐";
  return String.fromCodePoint(
    ...[...code].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65),
  );
}

// ---------------------------------------------------------------- session

const SESSION_KEY = "tapone3.session";
const SESSION_COOKIE = "tapone3_session";
const ADMIN_KEY = "tapone3.admin";
const REF_KEY = "tapone3.ref";

function readSessionCookie(): string | null {
  try {
    const match = document.cookie
      .split("; ")
      .find((row) => row.startsWith(`${SESSION_COOKIE}=`));
    if (!match) return null;
    const value = decodeURIComponent(match.slice(SESSION_COOKIE.length + 1));
    return value || null;
  } catch {
    return null;
  }
}

function writeSessionCookie(token: string | null) {
  try {
    if (token) {
      const secure = window.location.protocol === "https:" ? "; Secure" : "";
      document.cookie = `${SESSION_COOKIE}=${encodeURIComponent(token)}; path=/; max-age=2592000; SameSite=Lax${secure}`;
    } else {
      document.cookie = `${SESSION_COOKIE}=; path=/; max-age=0; SameSite=Lax`;
    }
  } catch {
    /* cookies unavailable */
  }
}

export function getSessionToken(): string | null {
  try {
    const stored = window.localStorage.getItem(SESSION_KEY);
    if (stored) return stored;
  } catch {
    /* storage unavailable — fall through to the cookie mirror */
  }
  // Cookie mirror: some phone webviews evict localStorage between
  // visits while keeping cookies (or the reverse). Either store alone
  // losing the token used to sign the visitor out silently and made
  // sign-in look dead after a reload.
  return readSessionCookie();
}
export function setSessionToken(token: string | null) {
  try {
    if (token) window.localStorage.setItem(SESSION_KEY, token);
    else window.localStorage.removeItem(SESSION_KEY);
  } catch {
    /* storage unavailable */
  }
  writeSessionCookie(token);
}
/**
 * True only when an action error is one of the server's own session
 * errors from `requireUser` in actions.ts ("Please sign in again.",
 * "Account not found. Please sign in again.", "This account has been
 * blocked."). Anything else — a network failure, a gateway 404/500
 * while a new build rolls out, a timeout — is transient: the session
 * is still valid and must NOT be thrown away. An earlier loose match
 * on /not found/ treated a plain "404 Not Found" transport error as a
 * dead session, so the dashboard bounced straight back to the
 * homepage (deleting the brand-new session) and sign-in looked like
 * it did nothing.
 */
export function isAuthError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : "";
  return /sign in again|account has been blocked/i.test(msg);
}

export function getAdminToken(): string | null {
  try {
    return window.localStorage.getItem(ADMIN_KEY);
  } catch {
    return null;
  }
}
export function setAdminToken(token: string | null) {
  try {
    if (token) window.localStorage.setItem(ADMIN_KEY, token);
    else window.localStorage.removeItem(ADMIN_KEY);
  } catch {
    /* storage unavailable */
  }
}

/** Captures ?r=CODE from the page URL once and keeps it for sign-up. */
export function captureReferralCode(): string | null {
  try {
    const params = new URLSearchParams(window.location.search);
    const fromUrl = params.get("r");
    if (fromUrl) {
      window.localStorage.setItem(REF_KEY, fromUrl.toUpperCase());
      return fromUrl.toUpperCase();
    }
    return window.localStorage.getItem(REF_KEY);
  } catch {
    return null;
  }
}
export function clearReferralCode() {
  try {
    window.localStorage.removeItem(REF_KEY);
  } catch {
    /* ignore */
  }
}

// ------------------------------------------------------- network detection

export interface NetworkInfo {
  ip: string | null;
  countryCode: string | null;
  countryName: string | null;
  flagEmoji: string | null;
  vpnSuspected: boolean;
}

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
  "tunnelbear",
  "windscribe",
  "m247",
  "datacamp",
  "choopa",
];

/** Browser-side lookup so the IP/country are the visitor's own, not the server's. */
export async function detectNetworkClient(): Promise<NetworkInfo> {
  try {
    const res = await fetch("https://ipwho.is/", {
      signal: AbortSignal.timeout(5000),
      headers: { accept: "application/json" },
    });
    if (!res.ok) throw new Error("geo lookup failed");
    const data = (await res.json()) as {
      success?: boolean;
      ip?: string;
      country_code?: string;
      country?: string;
      flag?: { emoji?: string };
      connection?: { org?: string; isp?: string };
    };
    if (data.success === false) throw new Error("geo lookup failed");
    const org = `${data.connection?.org ?? ""} ${data.connection?.isp ?? ""}`.toLowerCase();
    return {
      ip: data.ip ?? null,
      countryCode: data.country_code ?? null,
      countryName: data.country ?? null,
      flagEmoji: data.flag?.emoji ?? null,
      vpnSuspected: VPN_KEYWORDS.some((k) => org.includes(k)),
    };
  } catch {
    return {
      ip: null,
      countryCode: null,
      countryName: null,
      flagEmoji: null,
      vpnSuspected: false,
    };
  }
}

// ------------------------------------------------------------ Google GIS

interface GoogleIdApi {
  initialize: (config: {
    client_id: string;
    callback: (response: { credential: string }) => void;
    ux_mode?: "popup" | "redirect";
    login_uri?: string;
  }) => void;
  renderButton: (
    parent: HTMLElement,
    options: Record<string, string | number>,
  ) => void;
}

declare global {
  interface Window {
    google?: { accounts: { id: GoogleIdApi } };
  }
}

let gisPromise: Promise<boolean> | null = null;
let gisScriptEl: HTMLScriptElement | null = null;

/**
 * Loads Google's sign-in library. With `forceRetry`, a previously failed
 * load is discarded and the script is fetched again — the sign-in card's
 * "Try again" button depends on this; without it one blocked load would
 * leave the card empty forever.
 */
export function loadGoogleIdentity(forceRetry = false): Promise<boolean> {
  if (window.google?.accounts?.id) return Promise.resolve(true);
  if (gisPromise && !forceRetry) return gisPromise;
  if (forceRetry) {
    gisScriptEl?.remove();
    gisScriptEl = null;
    gisPromise = null;
  }
  gisPromise = new Promise<boolean>((resolve) => {
    const script = document.createElement("script");
    gisScriptEl = script;
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = () => resolve(Boolean(window.google?.accounts?.id));
    script.onerror = () => resolve(false);
    document.head.appendChild(script);
    window.setTimeout(() => resolve(Boolean(window.google?.accounts?.id)), 6000);
  });
  return gisPromise;
}

/** This page's origin — the value Google checks against the OAuth client's
 *  Authorized JavaScript origins. Shown in the sign-in help and in Admin →
 *  Settings so the owner can approve this exact address in Google Cloud
 *  Console (the app has no address bar to copy it from). */
export function getSiteOrigin(): string {
  try {
    return window.location.origin;
  } catch {
    return "";
  }
}

/** The redirect URI the full-page Google sign-in returns to: this page's
 *  own address. It must be registered under Authorized redirect URIs. */
export function getGoogleRedirectUri(): string {
  try {
    return window.location.origin + window.location.pathname;
  } catch {
    return "";
  }
}

const GOOGLE_STATE_KEY = "tapone3.gstate";

function randomStateToken(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Full-page Google sign-in (OAuth 2.0 implicit flow) — the fallback for
 * when the embedded GIS button cannot render on this address. Navigates
 * the top frame to Google and returns here with the ID token in the URL
 * fragment; `consumeGoogleRedirectResult` picks it up. Google only honours
 * this when the redirect URI above is registered in the OAuth client.
 * Returns false when navigation could not even be started.
 */
export function startGoogleRedirectSignIn(clientId: string): boolean {
  if (!clientId) return false;
  try {
    const state = randomStateToken();
    window.sessionStorage.setItem(GOOGLE_STATE_KEY, state);
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: getGoogleRedirectUri(),
      response_type: "id_token",
      scope: "openid email profile",
      nonce: state,
      state,
      prompt: "select_account",
    });
    const url = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
    try {
      (window.top ?? window).location.href = url;
    } catch {
      window.location.href = url;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Reads a full-page Google sign-in result out of the URL fragment
 * (`#id_token=…` or `#error=…`), verifies the anti-forgery state value,
 * and scrubs the fragment so the token does not linger in the address.
 * Returns an empty object when this page load is not a Google return.
 */
export function consumeGoogleRedirectResult(): { idToken?: string; error?: string } {
  try {
    const hash = window.location.hash;
    if (!hash.startsWith("#id_token=") && !hash.startsWith("#error")) return {};
    const params = new URLSearchParams(hash.slice(1));
    window.history.replaceState(
      null,
      "",
      window.location.pathname + window.location.search,
    );
    const error = params.get("error");
    if (error) return { error };
    const idToken = params.get("id_token");
    if (!idToken) return {};
    const expected = window.sessionStorage.getItem(GOOGLE_STATE_KEY);
    window.sessionStorage.removeItem(GOOGLE_STATE_KEY);
    if (expected && params.get("state") !== expected) {
      return { error: "state_mismatch" };
    }
    return { idToken };
  } catch {
    return {};
  }
}

export function renderGoogleButton(
  el: HTMLElement,
  clientId: string,
  onCredential: (idToken: string) => void,
): boolean {
  const idApi = window.google?.accounts?.id;
  if (!idApi) return false;
  idApi.initialize({
    client_id: clientId,
    callback: (response) => {
      if (response.credential) onCredential(response.credential);
    },
  });
  el.innerHTML = "";
  idApi.renderButton(el, {
    theme: "filled_blue",
    size: "large",
    text: "continue_with",
    shape: "pill",
    width: 280,
  });
  return true;
}

// ------------------------------------------------------------------ icons

function Icon({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className ?? "h-5 w-5"}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}


// ------------------------------------------------------------ dark / light

export type ThemeMode = "light" | "dark";

export function getThemeMode(): ThemeMode {
  try {
    return window.localStorage.getItem("tapone3.theme") === "dark"
      ? "dark"
      : "light";
  } catch {
    return "light";
  }
}

export function applyThemeMode(mode: ThemeMode) {
  document.documentElement.dataset.theme = mode;
  try {
    window.localStorage.setItem("tapone3.theme", mode);
  } catch {
    /* ignore */
  }
}

export function initTheme() {
  document.documentElement.dataset.theme = getThemeMode();
}

export const Icons = {
  home: (c?: string) => (
    <Icon className={c}>
      <path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" />
    </Icon>
  ),
  grid: (c?: string) => (
    <Icon className={c}>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </Icon>
  ),
  survey: (c?: string) => (
    <Icon className={c}>
      <rect x="5" y="4" width="14" height="17" rx="2" />
      <path d="M9 4.5V3h6v1.5" />
      <path d="m9 13 2 2 4-4" />
    </Icon>
  ),
  game: (c?: string) => (
    <Icon className={c}>
      <path d="M6 9h12a4 4 0 0 1 4 4.6c0 2.3-1.9 4.4-4 4.4-1.2 0-2-.5-2.7-1.3L14.5 16h-5l-.8.7C8 17.5 7.2 18 6 18c-2.1 0-4-2.1-4-4.4A4 4 0 0 1 6 9z" />
      <path d="M7 12v4M5 14h4" />
      <circle cx="16" cy="13" r="0.5" fill="currentColor" />
      <circle cx="18" cy="15" r="0.5" fill="currentColor" />
    </Icon>
  ),
  wallet: (c?: string) => (
    <Icon className={c}>
      <path d="M20 7H4a2 2 0 0 1 0-4h14v4" />
      <path d="M4 7v12a2 2 0 0 0 2 2h14a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1" />
      <circle cx="16.5" cy="14" r="1" fill="currentColor" />
    </Icon>
  ),
  history: (c?: string) => (
    <Icon className={c}>
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <path d="M3 3v5h5" />
      <path d="M12 7v5l3 3" />
    </Icon>
  ),
  trophy: (c?: string) => (
    <Icon className={c}>
      <path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z" />
      <path d="M7 6H4a1 1 0 0 0-1 1c0 2 1.5 3.5 4 3.5M17 6h3a1 1 0 0 1 1 1c0 2-1.5 3.5-4 3.5" />
    </Icon>
  ),
  users: (c?: string) => (
    <Icon className={c}>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20c.8-3.2 3.4-5 6.5-5s5.7 1.8 6.5 5" />
      <path d="M16 5.2a3.5 3.5 0 0 1 0 5.6M18.5 15.4c1.7.7 2.7 2 3.1 4.6" />
    </Icon>
  ),
  user: (c?: string) => (
    <Icon className={c}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c1-4 4.2-6 8-6s7 2 8 6" />
    </Icon>
  ),
  mail: (c?: string) => (
    <Icon className={c}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 7 9 6 9-6" />
    </Icon>
  ),
  shield: (c?: string) => (
    <Icon className={c}>
      <path d="M12 3 5 5.8v5.4c0 4.6 3 7.7 7 9.3 4-1.6 7-4.7 7-9.3V5.8z" />
      <path d="m9 11.5 2.2 2.2L15.5 9" />
    </Icon>
  ),
  chart: (c?: string) => (
    <Icon className={c}>
      <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
    </Icon>
  ),
  settings: (c?: string) => (
    <Icon className={c}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3 1a7 7 0 0 0-2-1.2L14.2 3h-4l-.4 2.5a7 7 0 0 0-2 1.2l-2.3-1-2 3.4 2 1.5A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.5 2 3.4 2.3-1a7 7 0 0 0 2 1.2l.4 2.5h4l.4-2.5a7 7 0 0 0 2-1.2l2.3 1 2-3.4-2-1.5c.1-.4.1-.8.1-1.2z" />
    </Icon>
  ),
  moon: (c?: string) => (
    <Icon className={c}>
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </Icon>
  ),
  sun: (c?: string) => (
    <Icon className={c}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </Icon>
  ),

  logout: (c?: string) => (
    <Icon className={c}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="m16 17 5-5-5-5M21 12H9" />
    </Icon>
  ),
  globe: (c?: string) => (
    <Icon className={c}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.5 2.6 3.8 5.7 3.8 9S14.5 18.4 12 21c-2.5-2.6-3.8-5.7-3.8-9S9.5 5.6 12 3z" />
    </Icon>
  ),
  send: (c?: string) => (
    <Icon className={c}>
      <path d="m22 2-7 20-4-9-9-4z" />
      <path d="M22 2 11 13" />
    </Icon>
  ),
  check: (c?: string) => (
    <Icon className={c}>
      <path d="M20 6 9 17l-5-5" />
    </Icon>
  ),
  x: (c?: string) => (
    <Icon className={c}>
      <path d="M18 6 6 18M6 6l12 12" />
    </Icon>
  ),
  ban: (c?: string) => (
    <Icon className={c}>
      <circle cx="12" cy="12" r="9" />
      <path d="m5.5 5.5 13 13" />
    </Icon>
  ),
  plus: (c?: string) => (
    <Icon className={c}>
      <path d="M12 5v14M5 12h14" />
    </Icon>
  ),
  trash: (c?: string) => (
    <Icon className={c}>
      <path d="M4 7h16M9 7V4h6v3M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" />
    </Icon>
  ),
  edit: (c?: string) => (
    <Icon className={c}>
      <path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z" />
    </Icon>
  ),
  dollar: (c?: string) => (
    <Icon className={c}>
      <path d="M12 2v20M17 6.5C16.2 5.4 14.3 4.8 12 4.8c-2.8 0-5 1.5-5 3.7 0 5 10 2.6 10 7.3 0 2.2-2.2 3.7-5 3.7-2.3 0-4.2-.7-5-1.8" />
    </Icon>
  ),
};
