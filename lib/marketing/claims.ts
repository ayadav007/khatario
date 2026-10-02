/** Returns the first banned phrase found in the text, or null. */
export function bannedClaimHit(text: string, bannedRaw: string): string | null {
  const claims = bannedRaw
    .split(/[\n,]/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 2);
  const hay = text.toLowerCase();
  for (const claim of claims) {
    if (hay.includes(claim.toLowerCase())) return claim;
  }
  return null;
}

export function assertNoBannedClaims(text: string, bannedRaw: string): void {
  const hit = bannedClaimHit(text, bannedRaw);
  if (hit) {
    throw new Error(`Remove the banned claim “${hit}” before this can be approved`);
  }
}
