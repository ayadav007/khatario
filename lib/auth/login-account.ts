export type LoginCandidate = {
  id: string;
  is_primary_admin?: boolean | null;
};

/**
 * Main sign-in has no business slug. One password match opens that account.
 * When the same password matches the owner and another account, open the owner.
 * Two owner accounts, or two non-owner accounts, are not guessed.
 */
export function chooseMainLoginUser<T extends LoginCandidate>(
  matches: T[],
): { user: T } | { ambiguous: true } | null {
  if (matches.length === 0) return null;
  if (matches.length === 1) return { user: matches[0] };
  const owners = matches.filter((row) => row.is_primary_admin === true);
  if (owners.length === 1) return { user: owners[0] };
  return { ambiguous: true };
}
