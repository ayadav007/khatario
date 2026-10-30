// Client-safe: the one `<link rel="icon">` the storefront manages (old store theme or engine theme).

export function setStoreFavicon(url: string): void {
  let link = document.querySelector<HTMLLinkElement>('link[data-store-favicon="1"]');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    link.setAttribute('data-store-favicon', '1');
    document.head.appendChild(link);
  }
  link.href = url;
}
