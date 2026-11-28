// $1 unlock gate for the Daily Contest and Affiliate Contest (owner order
// 2026-11-28). Both contest sections stay LOCKED until the user's LIFETIME
// total earnings reach $1.00. Cumulative — it does not matter how long it
// takes (a minute or ten days); earnings keep counting toward the $1.
// Permanent: lifetime earnings never reset, so once unlocked the section
// never re-locks (not daily, not weekly). Applies to every user: new
// signups, old users, later accounts. The gate reads the viewer's lifetime
// total (myLifetimeEarnedCents) returned by getDailyContest /
// getAffiliateContest.
//
// Pure functions only — no React, no DOM — so the scratch-DB smoke test
// can import and check them directly.

export const CONTEST_UNLOCK_CENTS = 100;

export function isContestUnlocked(lifetimeEarnedCents: number): boolean {
  return lifetimeEarnedCents >= CONTEST_UNLOCK_CENTS;
}

export function contestUnlockProgress(lifetimeEarnedCents: number): {
  earnedCents: number;
  remainingCents: number;
} {
  const earnedCents = Math.max(0, lifetimeEarnedCents);
  return {
    earnedCents,
    remainingCents: Math.max(0, CONTEST_UNLOCK_CENTS - earnedCents),
  };
}
