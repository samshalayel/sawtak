// Credit packages (shared by the client pricing modal and the admin top-up buttons).
// Prices are in ILS; credits internally stored as seconds, displayed as points (1 pt = 6 sec = 0.1 min).

// 1 point = 6 seconds of audio = 1/10 of a minute
export const POINTS_PER_MINUTE = 10;

export interface CreditPackage {
  id: string;
  points: number;       // base points in this package
  priceIls: number;
  bonusPoints: number;  // bonus points while offer is active
  popular?: boolean;
  adminOnly?: boolean;  // shown and payable only by admins (a real ₪1 payment to test the gateway)
}

// Launch offer: bonus points until the end of 2026 (Jerusalem time)
export const OFFER_ENDS_AT = new Date('2026-12-31T23:59:59+02:00');

// The single price list: the server charges exactly these prices (server/jawwal.ts imports this file)
// (Ids name the points, so payments recorded under the old list — p50…p500 — keep their meaning.)
export const PACKAGES: CreditPackage[] = [
  { id: 'p80',   points: 80,   priceIls: 5,  bonusPoints: 0 },
  { id: 'p200',  points: 200,  priceIls: 10, bonusPoints: 0 },
  { id: 'p450',  points: 450,  priceIls: 20, bonusPoints: 0, popular: true },
  { id: 'p1000', points: 1000, priceIls: 50, bonusPoints: 0 },
  { id: 'test1', points: 50,   priceIls: 1,  bonusPoints: 0, adminOnly: true },
];

/** Packages an account may see and buy (customers never see the admin test package). */
export const packagesFor = (isAdmin: boolean) => PACKAGES.filter(p => isAdmin || !p.adminOnly);
export const CUSTOMER_PACKAGES = packagesFor(false);

export const WORDS_PER_MINUTE_TYPICAL = 100;

/** The launch offer shows only while it runs and some package still carries gift points. */
export function isOfferActive(now = new Date()): boolean {
  return now <= OFFER_ENDS_AT && PACKAGES.some(p => !p.adminOnly && p.bonusPoints > 0);
}

export function offerDaysLeft(now = new Date()): number {
  return Math.max(0, Math.ceil((OFFER_ENDS_AT.getTime() - now.getTime()) / 86_400_000));
}

export function packageBonusPoints(pkg: CreditPackage, now = new Date()): number {
  return isOfferActive(now) ? pkg.bonusPoints : 0;
}

export function packageTotalPoints(pkg: CreditPackage, now = new Date()): number {
  return pkg.points + packageBonusPoints(pkg, now);
}

// Total seconds to credit = total points × 6
export function packageTotalSeconds(pkg: CreditPackage, now = new Date()): number {
  return packageTotalPoints(pkg, now) * 6;
}

export function packageLabel(pkg: CreditPackage, now = new Date()): string {
  const bonus = packageBonusPoints(pkg, now);
  return `باقة ${pkg.points.toLocaleString('en-US')} نقطة${bonus ? ` + ${bonus} هدية` : ''} (₪${pkg.priceIls})`;
}

// Backwards compat helpers (minutes view)
export const packageBaseMinutes   = (pkg: CreditPackage) => pkg.points / POINTS_PER_MINUTE;
export const packageBonusMinutes = (pkg: CreditPackage, now = new Date()) => packageBonusPoints(pkg, now) / POINTS_PER_MINUTE;
export const packageTotalMinutes  = (pkg: CreditPackage, now = new Date()) => packageTotalPoints(pkg, now)  / POINTS_PER_MINUTE;
