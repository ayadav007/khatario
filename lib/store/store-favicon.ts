// Client-safe: the one `<link rel="icon">` the storefront manages (old store theme or engine theme).

const SELECTOR = 'link[data-store-favicon="1"]';

/** Points the store favicon link at `url`, or removes the link when there is none. */
export function setStoreFavicon(url: string | null): void {
  let link = document.querySelector<HTMLLinkElement>(SELECTOR);
  if (!url) {
    link?.remove();
    return;
  }
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    link.setAttribute('data-store-favicon', '1');
    document.head.appendChild(link);
  }
  link.href = url;
}
