// Must stay in sync with TIER_ORDER in backend/main.py.
export type Tier = "free" | "plus" | "pro" | "ultimate";

export const TIERS: Tier[] = ["free", "plus", "pro", "ultimate"];

const TIER_ORDER: Record<Tier, number> = {
  free: 0,
  plus: 1,
  pro: 2,
  ultimate: 3,
};

export const TIER_LABELS: Record<Tier, string> = {
  free: "Free",
  plus: "Plus",
  pro: "Pro",
  ultimate: "Ultimate",
};

export function hasTier(tier: string | undefined, minimum: Tier): boolean {
  const level = TIER_ORDER[tier as Tier] ?? 0;
  return level >= TIER_ORDER[minimum];
}
