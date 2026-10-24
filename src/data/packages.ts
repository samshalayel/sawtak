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
}

// Launch offer: bonus points until the end of 2026 (Jerusalem time)
export const OFFER_ENDS_AT = new Date('2026-12-31T23:59:59+02:00');

export const PACKAGES: CreditPackage[] = [
  { id: 'p50',  points: 500,  priceIls: 1,   bonusPoints: 0   },
  { id: 'p100', points: 1000, priceIls: 20,  bonusPoints: 100 },
  { id: 'p250', points: 2500, priceIls: 50,  bonusPoints: 500, popular: true },
  { id: 'p500', points: 5000, priceIls: 100, bonusPoints: 1000 },
];

export const WORDS_PER_MINUTE_TYPICAL = 100;

export function isOfferActive(now = new Date()): boolean {
  return now <= OFFER_ENDS_AT;
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
export const packageBonusMinutes = (pkg: CreditPackage, now = new Date()) => packageBonusPoints(pkg, now) / POINTS_PER_MINUTE;
export const packageTotalMinutes  = (pkg: CreditPackage, now = new Date()) => packageTotalPoints(pkg, now)  / POINTS_PER_MINUTE;
