/** A stored theme video (MP4 or WebM), told apart from an image by its extension. Safe in client code. */
export function isVideoUrl(url: string | undefined): boolean {
  return !!url && /\.(mp4|webm)(?:[?#]|$)/i.test(url);
}
