import type { MenuPicture } from '@/lib/store/engine/types';
import type { ResolvedItem } from '@/lib/store/engine/menus';

/** A menu entry: a link when it has one, else plain text (a group heading without a link). */
export function MenuLink({ label, href, className }: { label: string; href: string; className?: string }) {
  return href ? (
    <a className={className} href={href}>
      {label}
    </a>
  ) : (
    <span className={className}>{label}</span>
  );
}

function Picture({ picture }: { picture: MenuPicture }) {
  if (!picture.image) return null;
  const body = (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={picture.image} alt={picture.caption} loading="lazy" />
      {picture.caption ? <span>{picture.caption}</span> : null}
    </>
  );
  return picture.link ? (
    <a className="kh-pic" href={picture.link}>
      {body}
    </a>
  ) : (
    <div className="kh-pic">{body}</div>
  );
}

function ViewAll({ item }: { item: ResolvedItem }) {
  return item.href ? (
    <a className="kh-viewall" href={item.href}>
      View all {item.label}
    </a>
  ) : null;
}

/**
 * What a top item's dropdown shows: a small list of links, mega columns (one per group), or the automatic category
 * list. Starts with "View all <label>" when the item has its own link; the picture sits on the right.
 */
export function MenuPanel({ item }: { item: ResolvedItem }) {
  const picture = item.picture?.image ? <Picture picture={item.picture} /> : null;

  if (item.kind === 'categories') {
    const cats = item.categories ?? [];
    return (
      <div className="kh-panel-body">
        <div className="kh-panel-main">
          <ViewAll item={item} />
          <ul className={`kh-cats${item.categoryPhotos ? ' photos' : ''}`}>
            {cats.map((c) => (
              <li key={c.id}>
                <a href={`/catalog/${encodeURIComponent(c.id)}`}>
                  {item.categoryPhotos ? (
                    c.image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img className="kh-cat-pic" src={c.image_url} alt="" loading="lazy" />
                    ) : (
                      <span className="kh-cat-pic" aria-hidden="true">
                        {Array.from(c.name)[0] ?? ''}
                      </span>
                    )
                  ) : null}
                  <span>{c.name}</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
        {picture}
      </div>
    );
  }

  if (item.kind === 'mega') {
    return (
      <div className="kh-panel-body">
        <div className="kh-panel-main">
          <ViewAll item={item} />
          <div className="kh-mega-cols">
            {item.children.map((group) => (
              <div key={group.id} className="kh-mega-col">
                <MenuLink className="kh-mega-head" label={group.label} href={group.href} />
                {group.children.length ? (
                  <ul>
                    {group.children.map((link) => (
                      <li key={link.id}>
                        <MenuLink label={link.label} href={link.href} />
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ))}
          </div>
        </div>
        {picture}
      </div>
    );
  }

  return (
    <div className="kh-panel-body">
      <div className="kh-panel-main">
        <ViewAll item={item} />
        <ul className="kh-drop-list">
          {item.children.map((link) => (
            <li key={link.id}>
              <MenuLink label={link.label} href={link.href} />
            </li>
          ))}
        </ul>
      </div>
      {picture}
    </div>
  );
}
