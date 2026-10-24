export type BlogIntent = 'save' | 'publish' | 'unpublish';
export type BlogStatus = 'draft' | 'published';

export type PublicationState = {
  status: BlogStatus;
  published_at: string | null;
};

/** Saving never publishes. Publishing keeps the original timestamp. Unpublishing keeps it too. */
export function nextPublication(
  current: PublicationState | null,
  intent: BlogIntent,
  nowIso: string,
): PublicationState {
  const status = current?.status ?? 'draft';
  const publishedAt = current?.published_at ?? null;
  if (intent === 'unpublish') return { status: 'draft', published_at: publishedAt };
  if (intent === 'publish') return { status: 'published', published_at: publishedAt ?? nowIso };
  return { status, published_at: publishedAt };
}

/** Old public URLs redirect only after the article has been published at least once. */
export function previousSlugToRedirect(
  current: { slug: string; published_at: string | null } | null,
  nextSlug: string,
): string | null {
  if (!current?.published_at) return null;
  if (current.slug === nextSlug) return null;
  return current.slug;
}
