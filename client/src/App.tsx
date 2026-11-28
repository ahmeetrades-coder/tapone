import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { SafeAreaTopScrim } from "@hatch/space-sdk/client";
import { api, type ApiResponse } from "./api";
import {
Icons,
captureReferralCode,
clearReferralCode,
applyThemeMode,
consumeGoogleRedirectResult,
detectNetworkClient,
getSiteOrigin,
getThemeMode,
isAuthError,
fmt,
getSessionToken,
loadGoogleIdentity,
renderGoogleButton,
setSessionToken,
type NetworkInfo,
} from "./lib";
import { Dashboard, type DashboardTab } from "./Dashboard";
import { Admin } from "./Admin";
import squirrelMascot from "./assets/squirrel-mascot.png";


type HomeData = ApiResponse<typeof api, "getPublicHome">;
type ContentItem = HomeData["featuredGames"][number];

export type StaticPage = "about" | "privacy" | "terms" | "contact" | "faq" | "cookies" | "forum" | "testimonials" | "careers";

// ------------------------------------------------------------- sign-in card

export function SignInCard({
  googleClientId,
  onSignedIn,
  compact, onOpenLegal,
}: {
  googleClientId: string;
  onSignedIn: (token: string) => void;
  compact?: boolean; onOpenLegal?: (page: "terms" | "privacy") => void;
}) {
  const [network, setNetwork] = useState<NetworkInfo | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [blockedMsg, setBlockedMsg] = useState<string | null>(null); const [consented, setConsented] = useState(false); const [consentError, setConsentError] = useState<string | null>(null); const consentedRef = useRef(false);
  const gisRef = useRef<HTMLDivElement>(null);
  // The Google button's load state is always visible: "loading" shows a
  // note, "failed" shows the setup help panel — never a silent empty box.
  const [gisState, setGisState] = useState<"loading" | "ready" | "failed">("loading");
  const [gisAttempt, setGisAttempt] = useState(0);
  const [siteOrigin] = useState(() => getSiteOrigin());

  useEffect(() => {
    let alive = true;
    void detectNetworkClient().then((info) => {
      if (alive) setNetwork(info);
    });
    return () => {
      alive = false;
    };
  }, []);

  const signIn = useMutation({
    mutationFn: async (input: { idToken: string }) => {
      const referralCode = captureReferralCode() ?? undefined;
      return api.signInWithGoogle({
        ...input,
        ip: network?.ip ?? undefined,
        referralCode,
      });
    },
    onSuccess: (result) => {
      if (result.status === "ok" && result.token) {
        setSessionToken(result.token);
        clearReferralCode();
        onSignedIn(result.token);
      } else if (result.status === "blocked") {
        setBlockedMsg("blocked");
      } else if (result.status === "country_banned") {
        setBlockedMsg("country_banned");
      }
    },
    onError: (error) => setFormError(error.message),
  });

  // ------------------------------------------------ email + password
  //
  // Email sign-up / login (owner order 2026-11-27) sits next to the
  // Google button. Sign-up sends a 6-digit code to the address; the
  // account activates only after the code is typed in. The Terms /
  // Privacy tick gates email sign-in exactly like Google.
  const [emailView, setEmailView] = useState<"main" | "code" | "forgot">("main");
  // The email screen is a SECOND step (owner order 2026-11-27): the
  // main card shows only the Google button + a "Continue with email"
  // button; tapping it opens this email screen, where the Sign up /
  // Login choice lives. Google stays untouched on the main card.
  const [showEmail, setShowEmail] = useState(false);
  const [codePurpose, setCodePurpose] = useState<"signup" | "reset">("signup");
  const [emailMode, setEmailMode] = useState<"login" | "signup">("login");
  const [emailUsername, setEmailUsername] = useState("");
  const [emailAddr, setEmailAddr] = useState("");
  const [emailPass, setEmailPass] = useState("");
  const [codeEmail, setCodeEmail] = useState("");
  const [code, setCode] = useState("");
  const [forgotEmail, setForgotEmail] = useState("");
  const [newPass, setNewPass] = useState("");
  const [emailInfo, setEmailInfo] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);

  const needConsent = () => {
    if (consentedRef.current) return true;
    setConsentError("Please tick the box above to agree to the Terms of Service and Privacy Policy before signing in.");
    return false;
  };

  const signedInFromEmail = (result: { status: string; token: string | null }) => {
    if (result.status === "ok" && result.token) {
      setSessionToken(result.token);
      clearReferralCode();
      onSignedIn(result.token);
    } else if (result.status === "blocked") {
      setBlockedMsg("blocked");
    } else if (result.status === "country_banned") {
      setBlockedMsg("country_banned");
    }
    // No "email_not_verified" branch on purpose: login is email +
    // password only (owner order 2026-11-27) — an unverified account
    // simply gets "Wrong email or password." Signing up again with
    // the same email sends a fresh code.
  };

  const emailSignUp = useMutation({
    mutationFn: async () => {
      const referralCode = captureReferralCode() ?? undefined;
      return api.signUpWithEmail({
        email: emailAddr.trim(),
        password: emailPass,
        name: emailUsername.trim() || undefined,
        ip: network?.ip ?? undefined,
        referralCode,
      });
    },
    onSuccess: (result) => {
      if (result.status === "code_sent") {
        setCodePurpose("signup");
        setCodeEmail(emailAddr.trim().toLowerCase());
        setCode("");
        setEmailInfo(`We sent a 6-digit code to ${emailAddr.trim()} — enter it below to activate your account.`);
        setEmailView("code");
      } else if (result.status === "email_in_use") {
        setEmailError("This email already has an account — please log in instead.");
      } else if (result.status === "email_unavailable") {
        setEmailError("We could not send the verification email right now — please try again later.");
      } else if (result.status === "country_banned") {
        setBlockedMsg("country_banned");
      }
    },
    onError: (error) => setEmailError(error.message),
  });

  const emailSignIn = useMutation({
    mutationFn: async () =>
      api.signInWithEmail({
        email: emailAddr.trim(),
        password: emailPass,
        ip: network?.ip ?? undefined,
      }),
    onSuccess: (result) => signedInFromEmail(result),
    onError: (error) => setEmailError(error.message),
  });

  const verifyCode = useMutation({
    mutationFn: async () =>
      api.verifyEmailCode({
        email: codeEmail,
        code: code.trim(),
        ip: network?.ip ?? undefined,
      }),
    onSuccess: (result) => signedInFromEmail(result),
    onError: (error) => setEmailError(error.message),
  });

  const resendCode = useMutation({
    mutationFn: async () => api.resendEmailCode({ email: codeEmail }),
    onSuccess: (result) => {
      if (result.status === "code_sent") setEmailInfo("A new code was sent — check your email.");
      else if (result.status === "email_unavailable") setEmailError("We could not send the email right now — please try again later.");
      else setEmailError("This account is not waiting for a code — sign in instead.");
    },
    onError: (error) => setEmailError(error.message),
  });

  const forgotRequest = useMutation({
    mutationFn: async () => api.requestPasswordReset({ email: forgotEmail.trim() }),
    onSuccess: (result) => {
      if (result.status === "google_account") {
        // A Google-only account has no password to reset and no code
        // was sent — stay on the forgot screen and say so, instead of
        // showing the code screen for a code that will never arrive.
        setEmailInfo("This account was created with Google — please sign in with Google instead. No reset code was sent.");
        return;
      }
      setCodePurpose("reset");
      setCodeEmail(forgotEmail.trim().toLowerCase());
      setCode("");
      setNewPass("");
      setEmailInfo("If an account uses this email, a reset code is on its way — enter it below with a new password.");
      setEmailView("code");
    },
    onError: (error) => setEmailError(error.message),
  });

  const resetPass = useMutation({
    mutationFn: async () =>
      api.resetPasswordWithCode({
        email: codeEmail,
        code: code.trim(),
        newPassword: newPass,
      }),
    onSuccess: () => {
      setEmailView("main");
      setEmailMode("login");
      setEmailPass("");
      setCode("");
      setNewPass("");
      setEmailInfo("Password changed — sign in with your new password.");
    },
    onError: (error) => setEmailError(error.message),
  });

  const submitEmailMain = () => {
    setEmailError(null);
    setEmailInfo(null);
    if (!needConsent()) return;
    if (!emailAddr.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailAddr.trim())) {
      setEmailError("Enter a valid email address.");
      return;
    }
    if (emailMode === "signup") {
      if (!emailUsername.trim()) {
        setEmailError("Please enter a username.");
        return;
      }
      if (emailPass.length < 8) {
        setEmailError("Password must be at least 8 characters.");
        return;
      }
      emailSignUp.mutate();
    } else {
      if (!emailPass) {
        setEmailError("Enter your password.");
        return;
      }
      emailSignIn.mutate();
    }
  };

  const submitCode = () => {
    setEmailError(null);
    setEmailInfo(null);
    if (code.trim().length !== 6) {
      setEmailError("Enter the 6-digit code from your email.");
      return;
    }
    if (codePurpose === "reset") {
      if (newPass.length < 8) {
        setEmailError("New password must be at least 8 characters.");
        return;
      }
      resetPass.mutate();
    } else {
      if (!needConsent()) return;
      verifyCode.mutate();
    }
  };

  // Returning from the full-page Google sign-in: the credential (or an
  // error) arrives in the URL fragment. Consume it once on mount.
  useEffect(() => {
    const result = consumeGoogleRedirectResult();
    if (result.idToken) {
      signIn.mutate({ idToken: result.idToken });
    } else if (result.error) {
      setGisState("failed");
      setFormError(
        result.error === "state_mismatch"
          ? "Google sign-in could not be verified. Please try again."
          : `Google refused the sign-in (${result.error}). This test version's address must be approved in Google Cloud Console first — the steps are shown below.`,
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // The Google button renders once into the gisRef div; the div
    // unmounts while the email screen is open, which destroys the
    // rendered button — so it is re-rendered whenever the main card
    // is shown again (owner order 2026-11-27: Back must never lose
    // the Google button).
    if (!googleClientId || showEmail) return;
    let cancelled = false;
    let timer: number | undefined;
    setGisState("loading");
    void loadGoogleIdentity(gisAttempt > 0).then((ok) => {
      if (cancelled) return;
      if (!ok || !gisRef.current) {
        setGisState("failed");
        return;
      }
      const rendered = renderGoogleButton(gisRef.current, googleClientId, (idToken) =>
        !consentedRef.current ? setConsentError("Please tick the box above to agree to the Terms of Service and Privacy Policy before signing in with Google.") : signIn.mutate({ idToken }),
      );
      if (!rendered) {
        setGisState("failed");
        return;
      }
      // Google inserts the button iframe asynchronously; if this address
      // is not an authorized origin it inserts nothing at all. Poll
      // briefly, then declare failure so the help panel appears instead
      // of an empty box.
      let checks = 0;
      timer = window.setInterval(() => {
        if (cancelled) {
          window.clearInterval(timer);
          return;
        }
        checks += 1;
        if (gisRef.current && gisRef.current.childElementCount > 0) {
          window.clearInterval(timer);
          setGisState("ready");
        } else if (checks >= 10) {
          window.clearInterval(timer);
          setGisState("failed");
        }
      }, 300);
    });
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [googleClientId, gisAttempt, showEmail]);

  // VPN is NOT blocked any more (owner order 2026-11-27): a VPN
  // sign-up creates the account and a VPN login signs in normally,
  // so there is no VPN screen here at all. The connection is still
  // detected (network.ip) so the server can lock the account's
  // country from the login IP, as before.
  if (blockedMsg === "blocked") {
    return (
      <div className="rounded-2xl border border-red-300 bg-red-50 p-5 text-left dark:border-red-900 dark:bg-red-950/40">
        <p className="font-display text-base font-bold text-red-700 dark:text-red-300">
          Account blocked
        </p>
        <p className="mt-1 text-sm text-red-700/90 dark:text-red-200/90">
          This account has been blocked. If you think this is a mistake, sign
          in and contact us from the Help section.
        </p>
      </div>
    );
  }
  if (blockedMsg === "country_banned") {
    // Generic on purpose: no country is ever named or shown to users,
    // even here — the server enforces the ban without sending which
    // country it is.
    return (
      <div className="rounded-2xl border border-red-300 bg-red-50 p-5 text-left dark:border-red-900 dark:bg-red-950/40">
        <div className="flex items-start gap-3">
          <span className="text-red-600 dark:text-red-400">{Icons.ban("h-7 w-7")}</span>
          <div>
            <p className="font-display text-base font-bold text-red-700 dark:text-red-300">
              Signups are not available right now
            </p>
            <p className="mt-1 text-sm text-red-700/90 dark:text-red-200/90">
              New accounts cannot be created from your current connection
              right now. If you already have an account, please try signing
              in — this block only stops new signups.
            </p>
            <button
              type="button"
              onClick={() => setBlockedMsg(null)}
              className="mt-3 rounded-full bg-red-600 px-4 py-2 text-sm font-bold text-white"
            >
              Try again
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={compact ? "" : "rounded-3xl bg-[var(--surface)] p-5 shadow-xl shadow-black/5 ring-1 ring-[var(--border)] sm:p-6"}>
      {!compact && (
        <>
          <p className="font-display text-lg font-bold text-[var(--text)]">
            Start earning in seconds
          </p>
          <p className="mt-1 text-sm text-[var(--dim)]">
            {showEmail
              ? "Sign up or log in with your email and a password. Email sign-up needs a 6-digit code we send you."
              : "Sign up or log in with Google, or with your email and a password. Email sign-up needs a 6-digit code we send you."}
          </p>
        </>
      )}
      <label className="mt-4 flex cursor-pointer items-start gap-2.5 text-left text-sm leading-relaxed text-[var(--text)]"><input type="checkbox" checked={consented} onChange={(e) => { setConsented(e.target.checked); consentedRef.current = e.target.checked; if (e.target.checked) setConsentError(null); }} className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--brand)]" /><span>I agree to the{" "}<button type="button" onClick={() => onOpenLegal?.("terms")} className="font-semibold text-[var(--brand-deep)] underline">Terms of Service</button>{" "}and{" "}<button type="button" onClick={() => onOpenLegal?.("privacy")} className="font-semibold text-[var(--brand-deep)] underline">Privacy Policy</button>.</span></label>{consentError && (<p role="alert" className="mt-2 text-center text-sm font-medium text-red-600 dark:text-red-400">{consentError}</p>)}{!showEmail && (<div className="relative mt-4"><div className="flex min-h-[44px] justify-center" ref={gisRef} aria-label="Continue with Google" />{!consented && (<button type="button" aria-label="Tick the box above to continue with Google" title="Tick the box above to agree to the Terms of Service and Privacy Policy" onClick={() => setConsentError("Please tick the box above to agree to the Terms of Service and Privacy Policy before signing in with Google.")} className="absolute inset-0 cursor-not-allowed rounded-xl bg-[var(--surface)]/60" />)}</div>)}
      {!showEmail && formError && (
        <p role="alert" className="mt-3 text-center text-sm font-medium text-red-600 dark:text-red-400">
          {formError}
        </p>
      )}
      {!showEmail ? (
        <button
          type="button"
          onClick={() => {
            // The Terms / Privacy tick gates the email screen exactly
            // like Google sign-in (owner order 2026-11-27): without
            // the tick, the email screen does not open at all.
            if (!needConsent()) return;
            setEmailError(null);
            setEmailInfo(null);
            setEmailView("main");
            setShowEmail(true);
          }}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-full bg-[var(--brand)] px-5 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-[var(--brand-deep)]"
        >
          {Icons.mail("h-5 w-5")} Continue with email
        </button>
      ) : (
        <div className="mt-4">
          <button
            type="button"
            onClick={() => {
              setEmailError(null);
              setEmailInfo(null);
              setEmailView("main");
              setShowEmail(false);
            }}
            className="text-sm font-semibold text-[var(--dim)]"
          >
            ← Back
          </button>
          <p className="mt-2 font-display text-base font-bold text-[var(--text)]">
            Continue with email
          </p>
        </div>
      )}
      {showEmail && emailInfo && (
        <p role="status" className="mt-3 text-center text-sm font-medium text-[var(--brand-deep)] dark:text-[var(--brand)]">
          {emailInfo}
        </p>
      )}
      {showEmail && emailError && (
        <p role="alert" className="mt-3 text-center text-sm font-medium text-red-600 dark:text-red-400">
          {emailError}
        </p>
      )}
      {showEmail && emailView === "main" && (
        <div className="mt-4">
          <div className="grid grid-cols-2 gap-2 rounded-full bg-[var(--surface-2)] p-1" role="tablist" aria-label="Email log in or sign up">
            {(["login", "signup"] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={emailMode === m}
                onClick={() => {
                  setEmailMode(m);
                  setEmailError(null);
                  setEmailInfo(null);
                }}
                className={`rounded-full px-3 py-2 text-sm font-bold ${emailMode === m ? "bg-[var(--brand)] text-white" : "text-[var(--dim)]"}`}
              >
                {m === "login" ? "Log in" : "Sign up"}
              </button>
            ))}
          </div>
          <div className="mt-3 space-y-3">
            {emailMode === "signup" && (
              <div>
                <label htmlFor="email-username" className="text-sm font-semibold">Username</label>
                <input id="email-username" type="text" value={emailUsername} onChange={(e) => setEmailUsername(e.target.value)} placeholder="Username" autoComplete="username" className="mt-1 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm outline-none focus:border-[var(--brand)]" />
              </div>
            )}
            <div>
              <label htmlFor="email-addr" className="text-sm font-semibold">Email</label>
              <input id="email-addr" type="email" value={emailAddr} onChange={(e) => setEmailAddr(e.target.value)} placeholder="you@example.com" autoComplete="email" className="mt-1 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm outline-none focus:border-[var(--brand)]" />
            </div>
            <div>
              <label htmlFor="email-pass" className="text-sm font-semibold">Password {emailMode === "signup" && <span className="font-normal text-[var(--dim)]">(at least 8 characters)</span>}</label>
              <input id="email-pass" type="password" value={emailPass} onChange={(e) => setEmailPass(e.target.value)} placeholder="Your password" autoComplete={emailMode === "signup" ? "new-password" : "current-password"} className="mt-1 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm outline-none focus:border-[var(--brand)]" />
              {emailMode === "signup" && (
                <p aria-live="polite" className={`mt-1 text-xs font-medium ${emailPass.length >= 8 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
                  {emailPass.length >= 8 ? "✓ Password is long enough" : "✗ Password must be at least 8 characters"}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={submitEmailMain}
              disabled={emailSignUp.isPending || emailSignIn.isPending}
              className="w-full rounded-full bg-[var(--brand)] px-5 py-3 text-sm font-bold text-white transition hover:bg-[var(--brand-deep)] disabled:opacity-50"
            >
              {emailSignUp.isPending || emailSignIn.isPending
                ? "Please wait…"
                : emailMode === "signup"
                  ? "Sign up with email"
                  : "Log in with email"}
            </button>
            {emailMode === "login" && (
              <p className="text-center text-sm">
                <button
                  type="button"
                  onClick={() => {
                    setForgotEmail(emailAddr);
                    setEmailError(null);
                    setEmailInfo(null);
                    setEmailView("forgot");
                  }}
                  className="font-semibold text-[var(--brand-deep)] underline"
                >
                  Forgot password?
                </button>
              </p>
            )}
          </div>
        </div>
      )}
      {showEmail && emailView === "code" && (
        <div className="mt-4 space-y-3">
          <p className="text-sm leading-relaxed text-[var(--dim)]">
            {codePurpose === "reset"
              ? `Enter the reset code sent to ${codeEmail} and choose a new password.`
              : `Enter the 6-digit code sent to ${codeEmail}.`}
          </p>
          <div>
            <label htmlFor="email-code" className="text-sm font-semibold">6-digit code</label>
            <input
              id="email-code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, "").slice(0, 6))}
              placeholder="123456"
              className="mt-1 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-center text-lg font-bold tracking-[0.3em] outline-none focus:border-[var(--brand)]"
            />
            <p className="mt-1 text-xs leading-relaxed text-[var(--dim)]">
              Check your inbox or spam folder.
            </p>
          </div>
          {codePurpose === "reset" && (
            <div>
              <label htmlFor="email-newpass" className="text-sm font-semibold">New password <span className="font-normal text-[var(--dim)]">(at least 8 characters)</span></label>
              <input id="email-newpass" type="password" value={newPass} onChange={(e) => setNewPass(e.target.value)} placeholder="New password" autoComplete="new-password" className="mt-1 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm outline-none focus:border-[var(--brand)]" />
              <p aria-live="polite" className={`mt-1 text-xs font-medium ${newPass.length >= 8 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
                {newPass.length >= 8 ? "✓ Password is long enough" : "✗ Password must be at least 8 characters"}
              </p>
            </div>
          )}
          <button
            type="button"
            onClick={submitCode}
            disabled={verifyCode.isPending || resetPass.isPending}
            className="w-full rounded-full bg-[var(--brand)] px-5 py-3 text-sm font-bold text-white transition hover:bg-[var(--brand-deep)] disabled:opacity-50"
          >
            {verifyCode.isPending || resetPass.isPending
              ? "Please wait…"
              : codePurpose === "reset"
                ? "Set new password"
                : "Verify and continue"}
          </button>
          <p className="text-center text-sm">
            {codePurpose === "signup" ? (
              <button
                type="button"
                onClick={() => {
                  setEmailError(null);
                  setEmailInfo(null);
                  resendCode.mutate();
                }}
                disabled={resendCode.isPending}
                className="font-semibold text-[var(--brand-deep)] underline disabled:opacity-50"
              >
                Send a new code
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setEmailError(null);
                  setEmailInfo(null);
                  setForgotEmail(codeEmail);
                  setEmailView("forgot");
                }}
                className="font-semibold text-[var(--brand-deep)] underline"
              >
                Send a new code
              </button>
            )}
            {" · "}
            <button
              type="button"
              onClick={() => {
                setEmailError(null);
                setEmailInfo(null);
                setEmailView("main");
              }}
              className="font-semibold text-[var(--brand-deep)] underline"
            >
              Back
            </button>
          </p>
        </div>
      )}
      {showEmail && emailView === "forgot" && (
        <div className="mt-4 space-y-3">
          <p className="text-sm leading-relaxed text-[var(--dim)]">
            Enter the email of your account. If it uses email sign-in, a reset code will be sent.
          </p>
          <div>
            <label htmlFor="forgot-email" className="text-sm font-semibold">Email</label>
            <input id="forgot-email" type="email" value={forgotEmail} onChange={(e) => setForgotEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" className="mt-1 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm outline-none focus:border-[var(--brand)]" />
          </div>
          <button
            type="button"
            onClick={() => {
              setEmailError(null);
              setEmailInfo(null);
              if (!forgotEmail.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(forgotEmail.trim())) {
                setEmailError("Enter a valid email address.");
                return;
              }
              forgotRequest.mutate();
            }}
            disabled={forgotRequest.isPending}
            className="w-full rounded-full bg-[var(--brand)] px-5 py-3 text-sm font-bold text-white transition hover:bg-[var(--brand-deep)] disabled:opacity-50"
          >
            {forgotRequest.isPending ? "Please wait…" : "Send reset code"}
          </button>
          <p className="text-center text-sm">
            <button
              type="button"
              onClick={() => {
                setEmailError(null);
                setEmailInfo(null);
                setEmailView("main");
              }}
              className="font-semibold text-[var(--brand-deep)] underline"
            >
              Back to log in
            </button>
          </p>
        </div>
      )}
      {!showEmail && !googleClientId && (
        <p className="mt-3 text-center text-sm leading-relaxed text-[var(--dim)]">
          Google sign-in is being set up — please check back shortly.
        </p>
      )}
      {!showEmail && googleClientId && gisState === "loading" && (
        <p className="mt-2 text-center text-sm text-[var(--dim)]" role="status">
          Loading the Google button…
        </p>
      )}
      {!showEmail && googleClientId && gisState === "failed" && (
        <div className="mt-4 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-left dark:border-amber-900 dark:bg-amber-950/40">
          <p className="font-display text-sm font-bold text-amber-800 dark:text-amber-200">
            The Google button didn't load on this test version
          </p>
          <p className="mt-1 text-sm leading-relaxed text-amber-800/90 dark:text-amber-100/90">
            Google only shows its sign-in button on web addresses approved in
            Google Cloud Console. Right now only https://tapone.store is
            approved — this test version runs on the address below, so Google
            refuses its button until the address is added:
          </p>
          {siteOrigin && (
            <p className="mt-2 select-all break-all rounded-lg bg-white/70 px-3 py-2 font-mono text-xs text-amber-900 dark:bg-black/30 dark:text-amber-100">
              {siteOrigin}
            </p>
          )}
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm leading-relaxed text-amber-800/90 dark:text-amber-100/90">
            <li>Open Google Cloud Console → APIs &amp; Services → Credentials.</li>
            <li>Open the TapOne OAuth client → “Authorized JavaScript origins” → Add URI → paste the address above → Save.</li>
            <li>Come back here and tap “Try again”.</li>
          </ol>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                setFormError(null);
                setGisAttempt((a) => a + 1);
              }}
              className="rounded-full bg-amber-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-amber-700"
            >
              Try again
            </button>
          </div>
        </div>
      )}
      <p className="mt-3 text-center text-xs leading-relaxed text-[var(--dim)]">
        {showEmail
          ? "You can sign in with your email and password. New email accounts are verified with a code sent to your email."
          : "You can sign in with Google or with email + password. New email accounts are verified with a code sent to your email. VPN connections are not allowed."}
      </p>
    </div>
  );
}

export function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
      <path fill="#fff" d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.9h5.4a4.6 4.6 0 0 1-2 3v2.6h3.2c1.9-1.8 3-4.4 3-7.5z" opacity=".95" />
      <path fill="#fff" d="M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.2H3.1v2.6A10 10 0 0 0 12 22z" opacity=".8" />
      <path fill="#fff" d="M6.4 13.9a6 6 0 0 1 0-3.8V7.5H3.1a10 10 0 0 0 0 9l3.3-2.6z" opacity=".65" />
      <path fill="#fff" d="M12 5.9c1.5 0 2.8.5 3.8 1.5L18.6 4A10 10 0 0 0 3.1 7.5l3.3 2.6C7.2 7.7 9.4 5.9 12 5.9z" opacity=".5" />
    </svg>
  );
}


// ---------------------------------------------------------- theme toggle

export function ThemeToggle() {
  const [mode, setMode] = useState<"light" | "dark">(() => getThemeMode());
  return (
    <button
      type="button"
      aria-label={mode === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      title={mode === "dark" ? "Light mode" : "Dark mode"}
      onClick={() => {
        const next = mode === "dark" ? "light" : "dark";
        applyThemeMode(next);
        setMode(next);
      }}
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--surface)] text-[var(--dim)] ring-1 ring-[var(--border)] transition hover:text-[var(--text)]"
    >
      {mode === "dark" ? Icons.sun("h-5 w-5") : Icons.moon("h-5 w-5")}
    </button>
  );
}


// ------------------------------------------- footer dark/light pill
// RewardJoy places the single Dark/Light control at the footer bottom-left.

export function FooterThemePill({ token }: { token?: string | null }) {
  const [mode, setMode] = useState<"light" | "dark">(() => getThemeMode());
  return (
    <button
      type="button"
      aria-label={mode === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      onClick={() => {
        const next = mode === "dark" ? "light" : "dark";
        applyThemeMode(next);
        setMode(next);
        if (token) {
          void api.setThemePreference({ token, mode: next }).catch(() => undefined);
        }
      }}
      className="flex items-center gap-2 rounded-full bg-[#57493e] px-4 py-2 text-sm font-bold text-white ring-1 ring-white/15 transition hover:bg-[#6a594c]"
    >
      {Icons.moon("h-4 w-4")} {mode === "dark" ? "Light" : "Dark"}
    </button>
  );
}

// --------------------------------------------------------- owner entry

// THE hidden owner entry (owner decision 2026-11-19): the small
// RSS/WiFi icon at the end of the footer's Follow Us row — and nothing
// else. The old 5-tap-on-the-logo/mascot gesture is REMOVED at the
// owner's explicit order. The icon looks like an ordinary feed icon
// among the social links — no label, no tooltip, nothing that hints at
// admin — but a single tap on it opens the admin login (#/admin). It is
// a real <button> with a full-size touch target: the previous version
// was a bare 16px <span aria-hidden onClick>, which is why the owner's
// taps "did nothing" on his phone. Rendered ONLY in the pre-login
// homepage footer (owner order 2026-11-20): the signed-in dashboard
// footer must NOT carry it — once a user is inside their account there
// is no Wi-Fi/RSS admin entry anywhere. #/admin keeps working for
// anyone who can type it.
export const OPEN_ADMIN_EVENT = "tapone:open-admin";

/** Opens the admin login: updates the address AND notifies the app
    shell directly. Navigation must never rely on the `hashchange`
    event alone — the webview can swallow it (see `navigate` in App),
    which is exactly what made this entry look dead. */
export function openAdminLogin(): void {
  if (window.location.hash !== "#/admin") {
    window.location.hash = "#/admin";
  }
  window.dispatchEvent(new Event(OPEN_ADMIN_EVENT));
}

export const GO_HOME_EVENT = "tapone:go-home";

/** Returns to the public homepage (the pre-login page with "Start
    earning now" / "Sign in"). Used when the owner logs out of the
    admin panel: logout must land on the homepage, NOT drop straight
    back onto the admin login screen (owner order 2026-11-20). Like
    openAdminLogin, it notifies the shell directly instead of relying
    on a `hashchange` the webview might swallow. */
export function goHome(): void {
  if (window.location.hash !== "") {
    window.location.hash = "";
  }
  window.dispatchEvent(new Event(GO_HOME_EVENT));
}

export function FollowRssIcon() {
  return (
    <button
      type="button"
      aria-label="RSS feed"
      onClick={openAdminLogin}
      className="ml-1 inline-flex min-h-11 min-w-11 items-center justify-center rounded-full text-white/50 transition hover:text-white"
    >
      <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4" focusable="false" aria-hidden="true">
        <circle cx="5" cy="19" r="2" />
        <path d="M4 4v3c6.6 0 12 5.4 12 12h3C19 10.7 12.3 4 4 4z" />
        <path d="M4 10v3c3.3 0 6 2.7 6 6h3c0-5-4-9-9-9z" />
      </svg>
    </button>
  );
}

// --------------------------------------------------------------- wordmark

export function Wordmark({ light }: { light?: boolean }) {
  return (
    <span className="flex items-center gap-2">
      <img
        src={squirrelMascot}
        alt="TapOne logo"
        className="h-9 w-9 rounded-xl object-cover shadow-md"
      />
      <span
        className={`font-display text-xl font-extrabold tracking-tight ${
          light ? "text-white" : "text-[var(--text)]"
        }`}
      >
        Tap<span className="text-[var(--brand)]">One</span>
      </span>
    </span>
  );
}

// ------------------------------------------------------------ game cards

export function ContentCard({ item, big }: { item: ContentItem; big?: boolean }) {
  const [imgOk, setImgOk] = useState(true);
  return (
    <article
      className={`flex flex-col overflow-hidden rounded-2xl bg-[var(--surface)] ring-1 ring-[var(--border)] ${
        big ? "sm:flex-row" : ""
      }`}
    >
      <div
        className={`relative flex items-center justify-center bg-[var(--surface-2)] text-[var(--brand)] ${
          big ? "h-36 sm:h-auto sm:w-56" : "h-32"
        }`}
      >
        {item.imageUrl && imgOk ? (
          <img
            src={item.imageUrl}
            alt={item.title}
            className="absolute inset-0 h-full w-full object-cover"
            onError={() => setImgOk(false)}
          />
        ) : item.kind === "game" ? (
          Icons.game("h-12 w-12")
        ) : item.kind === "survey" ? (
          Icons.survey("h-12 w-12")
        ) : (
          Icons.grid("h-12 w-12")
        )}
        {item.featured === true && (
          <span className="absolute left-3 top-3 rounded-full bg-[var(--gold)] px-2.5 py-1 text-xs font-bold text-[var(--ink)]">
            Featured
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col p-4">
        <h3 className="font-display text-base font-bold text-[var(--text)]">{item.title}</h3>
        {item.provider && (
          <p className="mt-0.5 text-xs font-semibold uppercase tracking-wide text-[var(--dim)]">
            {item.provider}
          </p>
        )}
        {item.description && (
          <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-[var(--dim)]">
            {item.description}
          </p>
        )}
        <div className="mt-auto flex items-center justify-between pt-4">
          <span className="text-xs font-semibold text-[var(--dim)]">
            {item.countries === "ALL" ? "🌍 Worldwide" : `Available in ${item.countries}`}
          </span>
          {item.url ? (
            <a
              href={item.url}
              target="_blank"
              rel="noreferrer"
              className="rounded-full bg-[var(--brand)] px-4 py-2 text-sm font-bold text-white transition hover:bg-[var(--brand-deep)]"
            >
              Open
            </a>
          ) : (
            <span className="rounded-full bg-[var(--surface-2)] px-4 py-2 text-sm font-bold text-[var(--dim)]">
              Coming soon
            </span>
          )}
        </div>
      </div>
    </article>
  );
}

// ------------------------------------------------------------ static text

type StaticPageContent = { title: string; body: string[]; sections?: { heading: string; body: string[] }[]; }; const STATIC_PAGES: Record<StaticPage, StaticPageContent> = {
  about: {
    title: "About Us",
    body: [
      "TapOne is a rewards website. Members play games, complete offers and answer surveys from our partner networks, and earn real dollars for every completed task.",
      "You keep 70% of every offer payout — TapOne keeps 30%. Earnings are tracked in dollars only, and you can cash out to the payment methods shown in your account once you reach the minimum withdrawal.",
      "New offerwalls, surveys and games are added as our partners approve them, so the catalogue keeps growing over time.",
    ],
  },
  privacy: {
    title: "Privacy Policy",
    body: [
      "Last updated: 23 November 2026. TapOne launched on 19 November 2026. TapOne is available to users worldwide, including users in the European Union and in California, USA. This policy explains what personal data we collect, why we collect it, who we share it with, how long we keep it, and the rights you have over your data under the EU General Data Protection Regulation (GDPR) and the California Consumer Privacy Act (CCPA), as amended by the California Privacy Rights Act (CPRA). If you have any question about this policy, contact us at info@tapone.store or through Help inside your account.",
    ],
    sections: [
      {
        heading: "1. Who we are",
        body: [
          "TapOne is a rewards website. You can contact us about privacy at info@tapone.store or through Help inside your account.",
          "TapOne is the data controller for the personal data described in this policy. Our partner offerwalls and survey providers are separate controllers for the data they collect on their own pages, and their own privacy policies apply there.",
        ],
      },
      {
        heading: "2. What we collect",
        body: [
          "When you sign in we store your username, email address and profile picture so we can run your account. If you sign up with email and a password, we store a scrambled (hashed) copy of your password — never the password itself. We also give you a unique Offer Token (your TapOne user ID), which is shown in your Profile.",
          "We record the IP address of your sign-in connection, and the country derived from it. Your country decides which offers, surveys, games and payment methods you see, and it cannot be changed manually.",
          "We keep a record of your earnings, withdrawals, level and check-in progress, referrals, and the messages you send us through Help, so payments can be reviewed and paid correctly.",
          "We store only the settings needed to run the site: your dark/light choice and your referral code when you arrive from an invite link.",
          "We do not collect sensitive personal information such as your precise location, health information, or government ID numbers. We do not knowingly collect personal data from children under 16; if we learn that we have, we will delete it.",
        ],
      },
      {
        heading: "3. How we use your information",
        body: [
          "To run your account, match offers and payment methods to your country, credit your earnings, and review and pay your withdrawals.",
          "To prevent fraud: VPN and proxy connections are not allowed, and accounts using fake details, emulators or location-spoofing can be blocked.",
          "To reply to the messages you send us through Help, and to tell the admin when a new user registers.",
          "To improve TapOne and to meet our payment and record-keeping duties.",
        ],
      },
      {
        heading: "4. Lawful basis for processing (GDPR)",
        body: [
          "Consent: when you tick the box on the registration page agreeing to this Privacy Policy and our Terms of Service, you consent to us processing your data as described here. You can withdraw your consent at any time (see section 11).",
          "Contract: we process your account, earnings and withdrawal data because it is needed to provide the TapOne service you signed up for.",
          "Legitimate interests: we process IP address, country and completion records to prevent fraud, to pay the right person, and to keep TapOne secure.",
          "Legal obligation: we keep withdrawal and payment records for as long as needed for accounting and payment review.",
        ],
      },
      {
        heading: "5. What we share",
        body: [
          "We do not sell your personal information, and we do not share your personal information for cross-context behavioural advertising.",
          "Partner offerwalls and survey providers receive only your TapOne user ID (your Offer Token) so that a completed offer or survey can be credited to your account. They do not receive your email address, IP address or payment details from us.",
          "When you open a partner offerwall or survey, that partner may collect data directly from you on its own pages under its own privacy policy. TapOne does not control that collection.",
          "Your payment details are shared only with the payment method you choose when you request a withdrawal, so that the payment can be sent to you.",
          "We share data with Google only to sign you in with your Google account. Your password is never shared with anyone — it is stored scrambled on our server. We do not share your data with anyone else except when the law requires it.",
        ],
      },
      {
        heading: "6. Cookies",
        body: [
          "TapOne uses only the cookies and local storage needed to keep you signed in, remember your dark/light choice and keep your referral code when you arrive from an invite link.",
          "Partner offerwalls may set their own cookies when you open them, so completed offers can be credited to your account through the postback system.",
          "You can clear cookies in your browser at any time; you will simply need to sign in again.",
        ],
      },
      {
        heading: "7. Data retention",
        body: [
          "We keep your account data for as long as your account is active and you keep using TapOne.",
          "Earnings and withdrawal records are kept for as long as needed to review and pay withdrawals and to keep payment records, even after an account is closed.",
          "When you ask us to delete your data, we will delete what we can and tell you about anything we must keep for payment, fraud or legal reasons.",
        ],
      },
      {
        heading: "8. Data safety",
        body: [
          "Your data is stored on TapOne's server and is used only to run the site. Only the site owner (admin) can see users' full details, including IP address and country, so that payments and fraud can be checked.",
          "We take reasonable steps to protect your data, but no website can guarantee complete security. If you think your account has been misused, contact us through Help inside your account.",
        ],
      },
      {
        heading: "9. Your rights under the GDPR (EU users)",
        body: [
          "If you are in the European Union or the United Kingdom, you have the right to ask us for a copy of your personal data, to correct data that is wrong, and to ask us to delete your data or to limit how we use it.",
          "You also have the right to receive your data in a portable form, to object to processing based on legitimate interests, and to withdraw your consent at any time. Withdrawing consent does not make past processing unlawful.",
          "You have the right to complain to your local data protection authority if you think we have handled your data unfairly.",
          "To exercise any of these rights, email info@tapone.store or send a message through Help inside your account. We will answer within one month, and we may ask you to confirm your identity from your signed-in account so we do not give your data to someone else.",
        ],
      },
      {
        heading: "10. Your rights under the CCPA and CPRA (California users)",
        body: [
          "If you are a California resident, you have the right to know what personal information we collect about you, the categories and sources of that information, why we collect it, and who we share it with. This policy gives you that information in sections 2, 3 and 5.",
          "You have the right to ask us to delete your personal information and to correct information that is wrong, subject to the payment and fraud records described in section 7.",
          "You have the right to opt out of the sale or sharing of your personal information. TapOne does not sell your personal information and does not share it for cross-context behavioural advertising, so there is nothing to opt out of, but you can still send us an opt-out request and we will confirm it.",
          "We do not collect sensitive personal information, and we do not use or disclose sensitive personal information, so the CCPA right to limit the use of sensitive personal information does not apply.",
          "We will not discriminate against you for exercising any CCPA right. We will not charge you a different price, give you a different quality of service, or deny you TapOne because you exercised a right.",
          "To exercise any of these rights, email info@tapone.store or send a message through Help inside your account. We will verify your request from your signed-in account and answer within 45 days, as the CCPA requires. You may also use an authorised agent, who must show written permission from you.",
        ],
      },
      {
        heading: "11. Your choices and withdrawing consent",
        body: [
          "You can change your profile picture from your Profile, and you can change your username up to 3 times in your lifetime. Your country, flag and IP address are detected automatically from your sign-in connection and cannot be changed by you — they are visible only to the admin.",
          "You can sign out at any time. If you want your account and data reviewed or deleted, contact us through Help inside your account or at info@tapone.store.",
          "You can withdraw your consent at any time by asking us to close your account. TapOne needs the data in section 2 to run your account, credit earnings and pay withdrawals, so closing your account ends the service.",
        ],
      },
      {
        heading: "12. Changes to this policy",
        body: [
          "We may update this policy when TapOne changes or when privacy law changes. The date at the top of this page shows the latest version.",
          "If you keep using TapOne after a change, you accept the updated policy. If a change affects your rights, we will point it out on the site.",
        ],
      },
      {
        heading: "13. Contact",
        body: [
          "For any privacy question, or to exercise any right in sections 9, 10 or 11, email info@tapone.store or send a message through Help inside your account.",
        ],
      },
    ],
  },
  terms: {
    title: "Terms of Service",
    body: [
      "Last updated: 23 November 2026. TapOne launched on 19 November 2026. By signing in to TapOne you agree to these terms. If you have any question, contact us at info@tapone.store or through Help inside your account.", ], sections: [ { heading: "1. What TapOne is", body: [ "TapOne is a rewards website. Members complete surveys, offers and games from our partner networks (offerwalls), and earn real dollars for every completed task. All amounts are in US dollars (USD) only — there are no coins, points or other currencies.", "TapOne has no deposits and no gambling. You can only withdraw money you earned. There are no gift cards.", ], }, { heading: "2. Your account", body: [ "One person, one account. You sign up and log in with Google, or with your email and a password. Email accounts are verified with a code sent to your email.", "You must give accurate details. Using an emulator or fake details to fake your location or complete offers is not allowed and leads to a blocked account.", "You can change your username up to 3 times in your lifetime. After that the option locks. Your country is detected automatically from your sign-in connection and cannot be changed.", ], }, { heading: "3. How earnings work", body: [ "You keep 70% of every offer, survey and game payout, in dollars. TapOne keeps 30%.", "Offer payouts are credited only when our partner confirms the completion through the postback system. Reversed or fraudulent completions are removed from your balance.", "Level rewards and the weekly check-in bonus are credited automatically as shown in your account. When someone signs up with your invite code, you earn 8% of what they earn.", ], },
      { heading: "4. Withdrawals", body: [ "The minimum withdrawal is $5.00. Withdrawals are reviewed and paid manually by the admin.", "Payment methods are matched to your account from your sign-in connection, so the methods you see depend on your country — for example Easypaisa and JazzCash in Pakistan, UPI in India, and PayPal, bank transfer, Wise, Payoneer or Binance USDT in other countries. Every method is shown with its logo.", "Make sure your payment details are correct — payments sent to wrong details entered by you cannot be recovered.", ], }, { heading: "5. Fair use", body: [ "Do not create multiple accounts, do not complete offers for other people, and do not use bots, scripts or any other trick to fake completions. Accounts that break these rules can be blocked by the admin, and unpaid earnings on a blocked account are not paid out.", "The admin can also ban a country, in which case no account can be created from that country at all.", ], }, { heading: "6. Content and availability", body: [ "Offers, surveys and games come from our partners, so availability, payouts and payment methods can change at any time. A partner may stop an offer or reverse a completion, and TapOne cannot pay for completions a partner does not confirm.", "TapOne is provided as-is. We do our best to keep the site running, but we are not responsible for partner offers that change or disappear.", ], },
      { heading: "7. Changes to these terms", body: [ "We may update these terms when TapOne changes. The date at the top of this page shows the latest version. If you keep using TapOne after a change, you accept the updated terms.", ], },
       
    ],
  },
  faq: {
    title: "FAQ",
    body: [
      "How do I earn? Sign in, complete offers, surveys and games from our partners, and 70% of every payout lands in your TapOne balance in dollars.",
      "How do I withdraw? Reach the minimum withdrawal and request a payout to one of the payment methods shown in your account. Requests are reviewed and paid manually.",
      "Why do I see these payment methods? Offers and payment methods are matched to your account from your sign-in connection, so what you see is picked for you automatically.",
    ],
  },
  cookies: {
    title: "Cookie Policy",
    body: [
      "TapOne uses only the cookies and local storage needed to keep you signed in, remember your dark/light choice and keep your referral code when you arrive from an invite link.",
      "Partner offerwalls may set their own cookies when you open them, so completed offers can be credited to your account through the postback system.",
      "We do not sell cookie data. You can clear cookies in your browser at any time; you will simply need to sign in again.",
    ],
  },
  forum: {
    title: "Forum",
    body: [
      "Our community forum is not open yet. Until it launches, the fastest way to reach the TapOne team is the Help option inside your account — sign in, open Help, and send your message. To chat with other members, open Live Chat at the top of Help.",
    ],
  },
  testimonials: {
    title: "Testimonials",
    body: [
      "Member stories will appear here as TapOne members share them. TapOne launched on 19 November 2026, so this page is just getting started.",
    ],
  },
  careers: {
    title: "Careers",
    body: [
      "There are no open roles at TapOne right now. When a position opens it will be posted on this page.",
    ],
  },
  contact: {
    title: "Contact Us",
    body: [
      "The fastest way to reach us is the Help option inside your account — messages go straight to the TapOne team and your reply will be sent to your email by TapOne.",
      "Sign in, open Help from the menu, and send your message. We usually reply within a couple of days.",
    ],
  },
};

// ------------------------------------------------------------------- app

export function App() {
  const [hash, setHash] = useState(() => window.location.hash);
  const [token, setToken] = useState<string | null>(() => getSessionToken());
  const [staticPage, setStaticPage] = useState<StaticPage | null>(null);
  const tokenRef = useRef(token);
  tokenRef.current = token;

  // Navigation NEVER relies on the `hashchange` event alone: the hash
  // state is set directly in the same tap handler that changes the
  // address. An earlier version only assigned `window.location.hash`
  // and waited for the event — on the owner's phone the event could be
  // swallowed by the webview, so a successful sign-in left the page
  // sitting on the homepage and the tap read as "does nothing". The
  // listener below still handles back/forward and pasted links.
  const navigate = (next: string) => {
    if (window.location.hash !== next) {
      window.location.hash = next;
    }
    setHash(next);
  };

const hashLegalPage: "terms" | "privacy" | null = hash === "#/terms" ? "terms" : hash === "#/privacy" ? "privacy" : null; const shownStaticPage: StaticPage | null = hashLegalPage ?? staticPage; const openLegal = (page: "terms" | "privacy") => { setStaticPage(null); navigate(`#/${page}`); }; useEffect(() => {
    captureReferralCode(); if (window.location.pathname === "/terms" || window.location.pathname === "/privacy") { navigate(`#${window.location.pathname}`); }
    const onHash = () => setHash(window.location.hash);
    window.addEventListener("hashchange", onHash);
    // The footer's Wi-Fi/RSS owner entry notifies the shell directly —
    // the route state is set here, in the same tap, never left waiting
    // on a `hashchange` the webview might swallow.
    const onOpenAdmin = () => setHash("#/admin");
    window.addEventListener(OPEN_ADMIN_EVENT, onOpenAdmin);
    // Admin logout lands here: back on the public homepage.
    const onGoHome = () => setHash("");
    window.addEventListener(GO_HOME_EVENT, onGoHome);
    return () => {
      window.removeEventListener("hashchange", onHash);
      window.removeEventListener(OPEN_ADMIN_EVENT, onOpenAdmin);
      window.removeEventListener(GO_HOME_EVENT, onGoHome);
    };
  }, []);

  // Verify the active session token against the server. A stored token
  // may be a dead session left over from an older build: if the server
  // no longer knows it, drop it so the page returns to the true
  // signed-out state — header shows "Sign in" next to "Start earning
  // now" and the signed-in bottom bar (Home / Account) disappears.
  //
  // RACE GUARD: this check is keyed on the token it verified, and
  // before clearing anything it confirms that token is STILL the
  // active one. An earlier version cleared unconditionally when the
  // check settled — so a slow check of a dead token could land AFTER
  // a fresh sign-in, wiping the brand-new session (and resetting the
  // hash) a split second after it was created. The dashboard flashed
  // and vanished, or never appeared at all.
  useEffect(() => {
    if (!token) return;
    const verifiedToken = token;
    let alive = true;
    api
      .getMe({ token: verifiedToken })
      .then(() => {
        /* session confirmed — nothing to update */
      })
      .catch((e: unknown) => {
        if (!alive) return;
        if (!isAuthError(e)) return; // transient failure — keep the session
        if (tokenRef.current !== verifiedToken) return; // a newer sign-in won
        if (getSessionToken() !== verifiedToken) return; // storage moved on
        setSessionToken(null);
        setToken(null);
        if (window.location.hash.startsWith("#/app")) {
          navigate("");
        }
      });
    return () => {
      alive = false;
    };
  }, [token]);

  const home = useQuery({
    queryKey: ["public-home"],
    queryFn: () => api.getPublicHome({}),
  });

  if (hash.startsWith("#/admin")) {
    return <Admin />;
  }

  if (hash.startsWith("#/app")) {
    if (!token) {
      return (
        <div className="min-h-screen bg-[var(--bg)]">
          <SafeAreaTopScrim backgroundColor="var(--bg)" />
          <main className="mx-auto max-w-md px-4 py-10">
            <button
              type="button"
              onClick={() => navigate("")}
              className="mb-6 text-sm font-semibold text-[var(--dim)]"
            >
              ← Back to home
            </button>
            <SignInCard
              googleClientId={home.data?.googleClientId ?? ""}
              onSignedIn={(t) => setToken(t)} onOpenLegal={openLegal}
            />
          </main>
        </div>
      );
    }
    return (
      <Dashboard
        token={token}
        onSignOut={() => {
          void api.signOut({ token }).catch(() => undefined);
          setSessionToken(null);
          setToken(null);
          navigate("");
        }}
      />
    );
  }

  // Signed-in chrome (header "Open dashboard", the Home/Account bottom
  // bar) shows only with a session token. Before login there is no
  // bottom bar: Sign in lives in the header, next to "Start earning
  // now" (owner order). The token is verified against the server
  // above, so a dead leftover token is cleared and the chrome goes.
  const memberChrome = Boolean(token);

  const goApp = (tab?: DashboardTab) => {
    if (tab) {
      try {
        window.localStorage.setItem("tapone3.tab", tab);
      } catch {
        /* ignore */
      }
    }
    navigate("#/app");
  };

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text)]">
      <SafeAreaTopScrim backgroundColor="#ffffff" />

      {/* header — white, like RewardJoy */}
      <header className="border-b border-[var(--border)] bg-[var(--surface)]">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <Wordmark />
          {memberChrome ? (
            <button
              type="button"
              onClick={() => goApp()}
              className="flex items-center rounded-full bg-[var(--brand)] px-4 py-2 font-display text-sm font-bold text-white transition hover:bg-[var(--brand-deep)]"
            >
              Open dashboard
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <a
                href="#signup"
                className="flex shrink-0 items-center whitespace-nowrap rounded-full bg-[var(--surface)] px-4 py-2 font-display text-sm font-bold text-[var(--text)] ring-1 ring-[var(--border)] transition hover:ring-[var(--brand)]"
              >
                Sign in
              </a>
              <a
                href="#signup"
                className="flex shrink-0 items-center whitespace-nowrap rounded-full bg-[var(--brand)] px-4 py-2 font-display text-sm font-bold text-white transition hover:bg-[var(--brand-deep)]"
              >
                Start earning now
              </a>
            </div>
          )}
        </div>
      </header>

      {/* hero — centred Earn Smarter, mascot, sign-up / login right here */}
      <section className="mx-auto grid w-full max-w-6xl gap-6 px-4 pb-10 pt-6 sm:pb-12 lg:grid-cols-2 lg:items-center" aria-label="Earn Smarter">
        <div className="text-center lg:col-start-2 lg:text-left">
          <p aria-hidden="true" className="text-lg tracking-[0.5em] text-[var(--gold)]">✦ ✦ ✦</p>
          <h1 className="mt-2 font-display text-[40px] font-extrabold leading-[1.05] text-[var(--ink)] sm:text-6xl">
            Earn Smarter
          </h1>
          <p className="mx-auto mt-4 max-w-md text-base leading-relaxed text-[var(--dim)] lg:mx-0">
            Earn more with high-paying games, apps, and surveys — built for
            real users
          </p>
          <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-[var(--dim)] lg:mx-0">
            You keep <strong className="text-[var(--text)]">70% of every payout</strong>,
            in dollars only — no coins, no confusing points.
          </p>
          <a
            href="#signup"
            className="mt-6 inline-flex items-center rounded-full bg-[var(--brand)] px-8 py-3.5 font-display text-base font-bold text-white shadow-lg shadow-[var(--brand)]/30 transition hover:bg-[var(--brand-deep)]"
          >
            Start earning now
          </a>
          <div className="mt-6 flex flex-wrap justify-center gap-2 text-[13px] font-semibold lg:justify-start">
            <span className="rounded-full bg-[var(--pill)] px-3 py-1.5 text-[var(--text)] ring-1 ring-[var(--border)]">
              💵 Min. withdrawal {home.data ? fmt(home.data.minWithdrawCents) : "…"}
            </span>
          </div>
        </div>
        <div id="signup" className="lg:col-start-2">
          <p className="mb-2 text-center font-display text-sm font-bold uppercase tracking-wide text-[var(--dim)] lg:text-left">
            Sign up / Log in
          </p>
          <SignInCard
            googleClientId={home.data?.googleClientId ?? ""}
            onOpenLegal={openLegal} onSignedIn={(t) => {
              setToken(t);
              goApp();
            }}
          />
        </div>
        <div className="lg:col-start-1 lg:row-start-1 lg:row-span-2">
          <img
            src={squirrelMascot}
            alt="TapOne squirrel mascot waving, with gold coins floating around it"
            className="mx-auto w-full max-w-sm rounded-3xl lg:max-w-md"
          />
        </div>
      </section>

      <main className="mx-auto w-full max-w-6xl px-3 sm:px-4">
        {shownStaticPage ? (
          <section className="py-10">
            <button
              type="button"
              onClick={() => { setStaticPage(null); if (hashLegalPage) navigate(""); }}
              className="mb-5 text-sm font-semibold text-[var(--dim)]"
            >
              ← Back
            </button>
            <h1 className="font-display text-3xl font-extrabold">{STATIC_PAGES[shownStaticPage].title}</h1>
            <div className="mt-5 max-w-2xl space-y-4">
              {STATIC_PAGES[shownStaticPage].body.map((para) => (
                <p key={para.slice(0, 24)} className="leading-relaxed text-[var(--dim)]">
                  {para}
                </p>
              ))}{STATIC_PAGES[shownStaticPage].sections?.map((section) => (<div key={section.heading} className="mt-8 max-w-2xl"><h2 className="font-display text-xl font-bold">{section.heading}</h2><div className="mt-3 space-y-4">{section.body.map((para) => (<p key={para.slice(0, 24)} className="leading-relaxed text-[var(--dim)]">{para}</p>))}</div></div>))}
            </div>
          </section>
        ) : (
          <>
            {/* Offers, Surveys and Playtime/Games live ONLY
                inside the signed-in dashboard — never on this pre-login
                page (owner order). The public page is: hero + sign-in,
                how it works, FAQ, recent payouts. */}

            {/* how it works */}
            <section className="pb-10" aria-label="How it works">
              <h2 className="font-display text-2xl font-extrabold sm:text-3xl">How TapOne works</h2>
              <div className="mt-6 grid gap-4 sm:grid-cols-3">
                {[
                  {
                    n: "1",
                    title: "Sign in — Google or email",
                    text: "Sign in with Google, or with your email and a password. Offers and payment methods are matched to your account automatically.",
                  },
                  {
                    n: "2",
                    title: "Complete offers & play",
                    text: "Pick an offerwall, survey or game and finish the task. When the partner confirms, 70% of the payout lands in your balance.",
                  },
                  {
                    n: "3",
                    title: "Withdraw your dollars",
                    text: "Reach the minimum and cash out to Easypaisa, JazzCash, PayPal, bank, Wise, Payoneer, UPI or Binance USDT — whichever one you use.",
                  },
                ].map((step) => (
                  <div key={step.n} className="rounded-3xl bg-[var(--surface)] p-6 ring-1 ring-[var(--border)]">
                    <span className="font-display text-4xl font-extrabold text-[var(--brand)]">{step.n}</span>
                    <h3 className="mt-3 font-display text-lg font-bold">{step.title}</h3>
                    <p className="mt-1.5 text-sm leading-relaxed text-[var(--dim)]">{step.text}</p>
                  </div>
                ))}
              </div>
            </section>

            {/* FAQ — Start earning now (3rd place, like RewardJoy) */}
            <section className="pb-12" aria-label="FAQ">
              <h2 className="font-display text-2xl font-extrabold sm:text-3xl">Frequently asked questions</h2>
              <div className="mt-5 space-y-3">
                {[
                  {
                    q: "How do I sign up?",
                    a: "With the Google button at the top of this page, or with your email and a password — email sign-up needs a 6-digit code we send you.",
                  },
                  {
                    q: "How much of each payout do I keep?",
                    a: "You keep 70% of every offer, survey and game payout, in dollars. TapOne keeps 30%.",
                  },
                  {
                    q: "When can I withdraw?",
                    a: "As soon as your balance reaches the minimum withdrawal. Requests are reviewed and paid to the method you choose.",
                  },
                  {
                    q: "Why do I see these payment methods?",
                    a: "Payment methods are matched to your account automatically when you sign in.",
                  },
                ].map((item) => (
                  <details key={item.q} className="rounded-2xl bg-[var(--surface)] px-5 py-4 ring-1 ring-[var(--border)]">
                    <summary className="cursor-pointer font-display text-base font-bold">{item.q}</summary>
                    <p className="mt-2 text-sm leading-relaxed text-[var(--dim)]">{item.a}</p>
                  </details>
                ))}
              </div>
              <a
                href="#signup"
                className="mt-6 inline-flex items-center rounded-full bg-[var(--brand)] px-8 py-3.5 font-display text-base font-bold text-white shadow-lg shadow-[var(--brand)]/30 transition hover:bg-[var(--brand-deep)]"
              >
                Start earning now
              </a>
            </section>

            {/* recent payouts */}
            {home.data && home.data.recentPayouts.length > 0 && (
              <section className="pb-12" aria-label="Recent payouts">
                <h2 className="font-display text-2xl font-extrabold">Recent payouts</h2>
                <ul className="mt-4 divide-y divide-[var(--border)] rounded-3xl bg-[var(--surface)] px-5 ring-1 ring-[var(--border)]">
                  {home.data.recentPayouts.map((p, i) => (
                    <li key={i} className="flex items-center justify-between py-3.5">
                      <span className="text-sm font-semibold">
                        {p.name} <span className="font-normal text-[var(--dim)]">via {p.methodLabel}</span>
                      </span>
                      <span className="font-display text-base font-bold text-[var(--brand-deep)] dark:text-[var(--brand)]">
                        {fmt(p.amountCents)}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
           )}
          </>
        )}
      </main>

      {/* footer — dark #3E342D, RewardJoy column layout */}
      <footer className="bg-[var(--ink-soft)] text-white">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:grid-cols-2 lg:grid-cols-[1.3fr_1fr_1fr_1fr]">
          <div>
            <Wordmark light />
            <p className="mt-3 max-w-sm text-sm leading-relaxed text-white/65">
              Play games, complete offers and surveys, and withdraw real
              dollars. No deposits, no gambling — you only ever cash out what
              you earned.
            </p>
          </div>
          <nav aria-label="About">
            <p className="font-display text-sm font-bold uppercase tracking-wide text-white/50">About</p>
            <ul className="mt-3 space-y-2.5 text-sm font-semibold text-white/85">
              <li><button type="button" className="hover:text-white" onClick={() => setStaticPage("faq")}>FAQ</button></li>
              <li><button type="button" className="hover:text-white" onClick={() => openLegal("privacy")}>Privacy Policy</button></li>
              <li><button type="button" className="hover:text-white" onClick={() => setStaticPage("cookies")}>Cookie Policy</button></li>
              <li><button type="button" className="hover:text-white" onClick={() => openLegal("terms")}>Terms of Service</button></li>
            </ul>
          </nav>
          <nav aria-label="Services">
            <p className="font-display text-sm font-bold uppercase tracking-wide text-white/50">Services</p>
            <ul className="mt-3 space-y-2.5 text-sm font-semibold text-white/85">
              <li><button type="button" className="hover:text-white" onClick={() => goApp("help")}>Support</button></li>
              <li><button type="button" className="hover:text-white" onClick={() => goApp("invite")}>Affiliate</button></li>
            </ul>
          </nav>
          <nav aria-label="Info">
            <p className="font-display text-sm font-bold uppercase tracking-wide text-white/50">Info</p>
            <ul className="mt-3 space-y-2.5 text-sm font-semibold text-white/85">
              <li><button type="button" className="hover:text-white" onClick={() => setStaticPage("forum")}>Forum</button></li>
              <li><button type="button" className="hover:text-white" onClick={() => setStaticPage("testimonials")}>Testimonials</button></li>
              <li><button type="button" className="hover:text-white" onClick={() => goApp("cashout")}>Live Cashout</button></li>
              <li><button type="button" className="hover:text-white" onClick={() => setStaticPage("careers")}>Careers</button></li>
            </ul>
          </nav>
        </div>
        {/* Follow Us row — always rendered (like the TapOne blog) so
            the small RSS icon at its end is always present, with or
            without social links set. That icon is the ONLY hidden
            owner entry (see FollowRssIcon in App.tsx). */}
        <div className="border-t border-white/10 px-4 py-5">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2" aria-label="Follow us">
            <span className="font-display text-sm font-bold text-white">Follow us</span>
            {(home.data?.socialLinks ?? []).map((s) => (
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
            <FollowRssIcon />
          </div>
        </div>
        <div className={`border-t border-white/10 px-4 py-4 lg:pb-4 ${memberChrome ? "pb-24" : ""}`}>
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3">
            <FooterThemePill token={token} />
            <p className="text-xs text-white/45">
              © 2026 TapOne. All rights reserved. · Launched 19 November 2026 · All amounts in USD.
            </p>
          </div>
        </div>
      </footer>

      {/* mobile bottom navigation — signed-in members only. Before
          login there is NO bottom bar: Sign in lives in the header,
          next to "Start earning now" (owner order). */}
      {memberChrome && (
        <nav
          className="fixed inset-x-0 bottom-0 z-30 border-t border-[var(--border)] bg-[var(--surface)] pb-safe text-[var(--text)] lg:hidden"
          aria-label="Mobile"
        >
          <div className="grid grid-cols-2">
            <button type="button" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })} className="flex flex-col items-center gap-1 py-2.5 text-[11px] font-semibold text-[var(--brand-deep)]">
              {Icons.home("h-6 w-6")} Home
            </button>
            <button type="button" onClick={() => goApp()} className="flex flex-col items-center gap-1 py-2.5 text-[11px] font-semibold text-[var(--dim)]">
              {Icons.user("h-6 w-6")} Account
            </button>
          </div>
        </nav>
      )}
    </div>
  );
}
