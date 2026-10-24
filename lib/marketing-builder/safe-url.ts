const MEDIA_PATH_RE = /^\/media\/marketing\/[a-f0-9]{64}\.webp$/;

/** Links authors may use: site paths, anchors, http(s), mailto and tel. */
export function isSafeHref(value: string): boolean {
  const v = value.trim();
  if (!v) return true;
  if (v.startsWith('#')) return /^#[A-Za-z][\w-]*$/.test(v);
  if (v.startsWith('/')) return !v.startsWith('//') && !/[\s\\]/.test(v);
  if (/^mailto:[^\s]+$/i.test(v)) return true;
  if (/^tel:\+?[\d\s-]{3,20}$/i.test(v)) return true;
  try {
    const url = new URL(v);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

/** Images: uploaded builder media, bundled /marketing assets, or https URLs. */
export function isSafeImageSrc(value: string): boolean {
  const v = value.trim();
  if (!v) return true;
  if (MEDIA_PATH_RE.test(v)) return true;
  if (/^\/(marketing|images)\/[\w./-]+\.(png|jpe?g|webp|avif|svg)$/i.test(v) && !v.includes('..')) {
    return true;
  }
  try {
    return new URL(v).protocol === 'https:';
  } catch {
    return false;
  }
}

export function isRemoteImage(src: string): boolean {
  return /^https?:\/\//i.test(src);
}

/** Extracts an 11-char YouTube id from common URL shapes, or null. */
export function youtubeId(value: string): string | null {
  const v = value.trim();
  if (/^[\w-]{11}$/.test(v)) return v;
  try {
    const url = new URL(v);
    const host = url.hostname.replace(/^www\./, '');
    let id: string | null = null;
    if (host === 'youtu.be') id = url.pathname.slice(1);
    else if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtube-nocookie.com') {
      if (url.pathname === '/watch') id = url.searchParams.get('v');
      else {
        const m = url.pathname.match(/^\/(embed|shorts|live)\/([\w-]{11})/);
        id = m ? m[2] : null;
      }
    }
    return id && /^[\w-]{11}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}
