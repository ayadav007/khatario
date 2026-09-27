'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Check as CheckIcon,
  CloudOff,
  Eye,
  GripVertical,
  Loader2,
  Monitor,
  Plus,
  Redo2,
  ShoppingCart,
  Smartphone,
  Tablet,
  Trash2,
  Undo2,
  User,
} from 'lucide-react';
import {
  GALLERY_PACKS,
  type StoreAppearanceMode,
  type StoreTestimonial,
  type StoreThemePack,
  type StoreThemePreset,
} from '@/lib/store/store-theme';
import { STUDIO_EYEBROW, splitList, studioVars } from '@/lib/store/studio-layout';
import {
  StudioAddButton,
  StudioAnnouncement,
  StudioBanner,
  StudioCategoriesSection,
  StudioFooter,
  StudioHeader,
  StudioHero,
  StudioProductTile,
  StudioProductsSection,
  StudioRichText,
  StudioTestimonials,
} from '@/components/store/studio-theme/StudioSections';
import {
  PUBLISHED_ONLY_PAGES,
  SAMPLE_TESTIMONIALS,
  STUDIO_PAGES,
  isSavedSection,
  type StudioPageId,
  type StudioPagesState,
  type StudioSection,
  type StudioSettings,
} from './studio-map';
import { PagePreview, PageSettings } from './StudioPages';
import {
  Check,
  Field,
  IconGlyph,
  IconPicker,
  ImagePicker,
  StudioLayoutContext,
  type PickedIcon,
  type StudioCategory,
  type StudioProduct,
} from './studio-ui';
import './theme-studio.css';

export type { StudioCategory, StudioProduct } from './studio-ui';
export { categoryFallbackImage } from './studio-ui';

type Device = 'desktop' | 'tablet' | 'mobile';
type Tab = 'content' | 'style' | 'advanced';
export type StudioSaveState = 'idle' | 'saving' | 'saved' | 'error';

interface StudioDoc {
  sections: StudioSection[];
  pages: StudioPagesState;
}

export function ThemeStudio({
  initialSections,
  initialPages,
  accent,
  onAccentChange,
  appearance,
  canvas,
  onAppearanceChange,
  pack,
  livePack,
  onChooseTheme,
  livePreviewSrc,
  logoUrl,
  products,
  categories,
  testimonials,
  contactFallback,
  saving,
  previewing,
  saveState,
  notice,
  message,
  onChange,
  onPublish,
  onPreview,
}: {
  initialSections: StudioSection[];
  initialPages: StudioPagesState;
  accent: string;
  onAccentChange: (hex: string) => void;
  appearance: StoreAppearanceMode;
  /** The storefront's real page background for the current theme and appearance. */
  canvas: string;
  onAppearanceChange: (mode: StoreAppearanceMode) => void;
  /** Theme being edited (draft). */
  pack: StoreThemePack;
  /** Theme shoppers see right now. */
  livePack: StoreThemePack;
  onChooseTheme: (preset: Exclude<StoreThemePreset, 'custom'>) => void;
  /** Real storefront URL with the draft applied; used for packs that don't render Studio sections. */
  livePreviewSrc: string | null;
  logoUrl: string;
  products: StudioProduct[];
  categories: StudioCategory[];
  testimonials: StoreTestimonial[];
  contactFallback: { phone?: string; email?: string };
  saving: boolean;
  previewing: boolean;
  saveState: StudioSaveState;
  /** Shown under the top bar, e.g. "Resumed unpublished changes". */
  notice?: ReactNode;
  message: { kind: 'ok' | 'err'; text: string } | null;
  onChange: (sections: StudioSection[], pages: StudioPagesState) => void;
  onPublish: (sections: StudioSection[], pages: StudioPagesState) => void;
  onPreview: (sections: StudioSection[], pages: StudioPagesState, page: StudioPageId) => void;
}) {
  const [doc, setDoc] = useState<StudioDoc>({ sections: initialSections, pages: initialPages });
  const studioPack = pack === 'studio';
  const themeName = GALLERY_PACKS.find((p) => p.pack === pack)?.label ?? 'Studio';
  const firstDoc = useRef(true);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  useEffect(() => {
    if (firstDoc.current) {
      firstDoc.current = false;
      return;
    }
    onChangeRef.current(doc.sections, doc.pages);
  }, [doc]);
  const [page, setPage] = useState<StudioPageId>('home');
  const [selected, setSelected] = useState<string | null>('hero');
  const [pageSelected, setPageSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('content');
  const [device, setDevice] = useState<Device>('desktop');
  const [history, setHistory] = useState<StudioDoc[]>([]);
  const [future, setFuture] = useState<StudioDoc[]>([]);
  const { sections, pages } = doc;
  const current = sections.find((s) => s.id === selected);
  const pageDef = STUDIO_PAGES.find((p) => p.id === page)!;
  const pageSection = pageDef.sections.find((s) => s.id === pageSelected) ?? null;

  const remember = (next: StudioDoc) => {
    setHistory((h) => [...h, doc]);
    setFuture([]);
    setDoc(next);
  };
  const setSections = (next: StudioSection[]) => remember({ ...doc, sections: next });
  const updatePages = (patch: Partial<StudioPagesState>) => remember({ ...doc, pages: { ...pages, ...patch } });
  const update = (patch: Partial<StudioSettings>) =>
    setSections(sections.map((s) => (s.id === selected ? { ...s, settings: { ...s.settings, ...patch } } : s)));
  const reorder = (from: number, to: number) => {
    if (from === to || Number.isNaN(from)) return;
    const copy = [...sections];
    const [item] = copy.splice(from, 1);
    copy.splice(to, 0, item);
    setSections(copy);
  };
  const undo = () => {
    const prev = history[history.length - 1];
    if (!prev) return;
    setFuture((f) => [...f, doc]);
    setHistory((h) => h.slice(0, -1));
    setDoc(prev);
  };
  const redo = () => {
    const next = future[future.length - 1];
    if (!next) return;
    setHistory((h) => [...h, doc]);
    setFuture((f) => f.slice(0, -1));
    setDoc(next);
  };
  const addSection = () => {
    const id = `custom-${Date.now()}`;
    setSections([
      ...sections,
      { id, type: 'richtext', name: 'New Text Section', enabled: true, settings: { title: 'Your heading', text: 'Add your content here.' } },
    ]);
    setSelected(id);
  };
  const removeSection = () => {
    if (!current) return;
    if (isSavedSection(current.type)) {
      setSections(sections.map((s) => (s.id === current.id ? { ...s, enabled: false } : s)));
      return;
    }
    const next = sections.filter((s) => s.id !== current.id);
    setSections(next);
    setSelected(next[0]?.id ?? null);
  };
  const openPage = (id: StudioPageId) => {
    setPage(id);
    setPageSelected(STUDIO_PAGES.find((p) => p.id === id)?.sections[0]?.id ?? null);
  };

  const headerSection = sections.find((s) => s.type === 'header');
  const footerSection = sections.find((s) => s.type === 'footer');
  const rootStyle = studioVars(accent, canvas);
  const footerLinks = (s: StudioSettings) => [
    ...splitList(s.links, 'Shop, About, Contact, Privacy').map((label) => ({ label })),
    ...(pages.instagramUrl ? [{ label: 'Instagram' }] : []),
    ...(pages.whatsappUrl ? [{ label: 'WhatsApp' }] : []),
  ];

  return (
    <StudioLayoutContext.Provider value={studioPack}>
    <div className="ks-root">
      <header className="topbar">
        <Link href="/settings/online-store" className="back">
          <ArrowLeft />
          Online Store
        </Link>
        <div className="crumb">
          Studio <span>›</span> <b>{themeName}</b>
          {pack !== livePack ? <i className="draftTag">Draft theme</i> : null}
        </div>
        <SaveStatus state={saveState} />
        <div className="devices">
          <button type="button" className={device === 'desktop' ? 'active' : ''} onClick={() => setDevice('desktop')}>
            <Monitor />
            Desktop
          </button>
          <button type="button" className={device === 'tablet' ? 'active' : ''} onClick={() => setDevice('tablet')}>
            <Tablet />
            Tablet
          </button>
          <button type="button" className={device === 'mobile' ? 'active' : ''} onClick={() => setDevice('mobile')}>
            <Smartphone />
            Mobile
          </button>
        </div>
        <div className="actions">
          <button type="button" onClick={undo} disabled={!history.length} aria-label="Undo">
            <Undo2 />
          </button>
          <button type="button" onClick={redo} disabled={!future.length} aria-label="Redo">
            <Redo2 />
          </button>
          <button type="button" className="preview" onClick={() => onPreview(sections, pages, page)} disabled={previewing}>
            {previewing ? <Loader2 className="animate-spin" /> : <Eye />} Preview on store
          </button>
          <button type="button" className="save" onClick={() => onPublish(sections, pages)} disabled={saving}>
            {saving ? 'Publishing…' : 'Publish'}
          </button>
        </div>
      </header>
      {message ? <div className={`banner-msg ${message.kind}`}>{message.text}</div> : null}
      {notice ? <div className="banner-msg info">{notice}</div> : null}
      <div className="workspace">
        <aside className="left">
          <h4 style={{ marginTop: 0 }}>Themes</h4>
          <div className="themeList">
            {GALLERY_PACKS.map((t) => {
              const editing = t.pack === pack;
              return (
                <div key={t.pack} className={`themeCard ${editing ? 'editing' : ''}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img className="thumb" src={`/store/themes/${t.pack}.svg`} alt="" />
                  <div className="themeMeta">
                    <b>{t.label}</b>
                    <span className="tags">
                      {t.pack === livePack ? <span className="live">Live</span> : null}
                      {editing ? <span className="edit">Editing</span> : null}
                    </span>
                  </div>
                  {editing ? null : (
                    <button type="button" className="customise" onClick={() => onChooseTheme(t.preset)}>
                      Customise
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          <p className="themeHint">
            Switching theme only changes your draft. Shoppers keep seeing the live theme until you Publish.
          </p>
          <label className="accentRow">
            <input type="color" value={accent} onChange={(e) => onAccentChange(e.target.value)} />
            <span>Brand colour</span>
          </label>
          <div className="appearanceRow">
            <span>Page colour</span>
            <div className="seg">
              {(['light', 'dim', 'dark'] as const).map((mode) => (
                <button
                  type="button"
                  key={mode}
                  className={appearance === mode ? 'on' : ''}
                  onClick={() => onAppearanceChange(mode)}
                >
                  {mode === 'light' ? 'Light' : mode === 'dim' ? 'Dim' : 'Dark'}
                </button>
              ))}
            </div>
          </div>
          <h4>Pages</h4>
          {STUDIO_PAGES.map((p) => (
            <button
              type="button"
              className={`page ${page === p.id ? 'sel' : ''}`}
              key={p.id}
              onClick={() => openPage(p.id)}
            >
              {p.icon} {p.label}
            </button>
          ))}
          <h4>Sections ({pageDef.label})</h4>
          {page === 'home' ? (
            <>
              <div className="sectionList">
                {sections.map((s, i) => (
                  <div
                    draggable
                    onDragStart={(e) => e.dataTransfer.setData('from', String(i))}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => reorder(Number(e.dataTransfer.getData('from')), i)}
                    onClick={() => setSelected(s.id)}
                    className={`sectionItem ${selected === s.id ? 'selected' : ''} ${s.enabled ? '' : 'off'}`}
                    key={s.id}
                  >
                    <GripVertical />
                    <span>{s.name}</span>
                    <b>⠿</b>
                  </div>
                ))}
              </div>
              <button type="button" className="add" onClick={addSection}>
                <Plus /> Add Section
              </button>
            </>
          ) : (
            <div className="sectionList">
              {pageDef.sections.map((s) => (
                <div
                  onClick={() => setPageSelected(s.id)}
                  className={`sectionItem pageSectionItem ${pageSelected === s.id ? 'selected' : ''}`}
                  key={s.id}
                >
                  <span>{s.name}</span>
                </div>
              ))}
            </div>
          )}
        </aside>
        <aside className="settings">
          {page !== 'home' ? (
            pageSection ? (
              <>
                <div className="settingsHead">
                  <div>
                    <h2>{pageSection.name}</h2>
                    <p>{pageDef.label} page · saved when you Publish.</p>
                  </div>
                </div>
                <PageSettings
                  page={page}
                  section={pageSection.id}
                  pages={pages}
                  update={updatePages}
                  categories={categories}
                />
                {PUBLISHED_ONLY_PAGES.includes(page) ? (
                  <p className="note">Preview on store shows the published version of this page. Publish to see these changes live.</p>
                ) : null}
              </>
            ) : (
              <div className="info">Select a section to customize it.</div>
            )
          ) : current ? (
            <>
              <div className="settingsHead">
                <div>
                  <h2>{current.name}</h2>
                  <p>
                    {studioPack || isSavedSection(current.type)
                      ? 'Customize this section.'
                      : `Only shows on the Studio theme. ${themeName} doesn't use this section.`}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={removeSection}
                  aria-label={isSavedSection(current.type) ? 'Hide section' : 'Delete section'}
                >
                  <Trash2 />
                </button>
              </div>
              <div className="tabs">
                <button type="button" className={tab === 'content' ? 'on' : ''} onClick={() => setTab('content')}>
                  Content
                </button>
                <button type="button" className={tab === 'style' ? 'on' : ''} onClick={() => setTab('style')}>
                  Style
                </button>
                <button type="button" className={tab === 'advanced' ? 'on' : ''} onClick={() => setTab('advanced')}>
                  Advanced
                </button>
              </div>
              {tab === 'content' ? (
                <Content current={current} update={update} pages={pages} updatePages={updatePages} themeName={themeName} studioPack={studioPack} />
              ) : null}
              {tab === 'style' ? <Style current={current} update={update} accent={accent} studioPack={studioPack} /> : null}
              {tab === 'advanced' ? (
                <Advanced
                  studioPack={studioPack}
                  current={current}
                  updateEnabled={(enabled) =>
                    setSections(sections.map((s) => (s.id === selected ? { ...s, enabled } : s)))
                  }
                />
              ) : null}
            </>
          ) : (
            <div className="info">Select a section to customize it.</div>
          )}
        </aside>
        <main className="previewArea">
          {!studioPack ? (
            <div className={`liveFrame ${device}`}>
              <p className="liveNote">
                Live preview of {themeName} with your draft. It refreshes a moment after each change.
              </p>
              {livePreviewSrc ? (
                <iframe key={livePreviewSrc} src={livePreviewSrc} title={`${themeName} preview`} />
              ) : (
                <div className="liveEmpty">
                  <Loader2 className="animate-spin" /> Preparing preview…
                </div>
              )}
            </div>
          ) : (
          <div className={`store st-root st-cq ${device}`} style={rootStyle}>
            {page === 'home' ? (
              <Store
                sections={sections}
                select={setSelected}
                selected={selected}
                products={products}
                categories={categories}
                testimonials={testimonials}
                pages={pages}
                logoUrl={logoUrl}
                footerLinks={footerLinks}
                mobileColumns={device === 'mobile' ? pages.mobileColumns : 2}
              />
            ) : (
              <PagePreview
                page={page}
                pages={pages}
                products={products}
                categories={categories}
                header={headerSection?.enabled ? <StudioHeader s={headerSection.settings} logoUrl={logoUrl} /> : null}
                footer={
                  footerSection?.enabled ? (
                    <StudioFooter s={footerSection.settings} links={footerLinks(footerSection.settings)} />
                  ) : null
                }
                selected={pageSelected}
                select={setPageSelected}
                device={device}
                storeName={headerSection?.settings.logo || 'This store'}
                tagline={headerSection?.settings.tagline || ''}
                contactFallback={contactFallback}
              />
            )}
          </div>
          )}
        </main>
      </div>
    </div>
    </StudioLayoutContext.Provider>
  );
}

function SaveStatus({ state }: { state: StudioSaveState }) {
  if (state === 'idle') return null;
  return (
    <span className={`saveStatus ${state}`} aria-live="polite">
      {state === 'saving' ? <Loader2 className="animate-spin" /> : state === 'saved' ? <CheckIcon /> : <CloudOff />}
      {state === 'saving' ? 'Saving draft…' : state === 'saved' ? 'Draft saved' : 'Draft not saved'}
    </span>
  );
}

function IconChoice({
  label,
  name,
  svg,
  fallback,
  query,
  onChange,
}: {
  label: string;
  name: string | undefined;
  svg: string | undefined;
  fallback: ReactNode;
  query: string;
  onChange: (icon: PickedIcon | undefined) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="field">
      <span>{label}</span>
      <div className="iconChoice">
        <div className="iconPreview">
          <IconGlyph svg={svg} fallback={fallback} size={22} />
        </div>
        <div>
          <button type="button" className="fileBtn" onClick={() => setOpen(true)}>
            Change icon
          </button>
          <small className="iconName">{name ?? 'Theme default'}</small>
        </div>
      </div>
      {open ? (
        <IconPicker
          title={`Choose ${label.replace(' ◇', '').toLowerCase()}`}
          initialQuery={query}
          current={name}
          onPick={(icon) => {
            onChange(icon);
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </div>
  );
}

function Range({
  label,
  value,
  min = 0,
  max = 80,
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  onChange: (v: number) => void;
}) {
  return (
    <Field label={label}>
      <input type="range" min={min} max={max} value={value} onChange={(e) => onChange(+e.target.value)} />
      <small>{value}px</small>
    </Field>
  );
}

function Eyebrow({ s, update, fallback }: { s: StudioSettings; update: (p: Partial<StudioSettings>) => void; fallback: string }) {
  return (
    <Field label="Small label above heading ◇">
      <input
        value={s.eyebrow ?? fallback}
        maxLength={60}
        placeholder="Leave empty to hide"
        onChange={(e) => update({ eyebrow: e.target.value })}
      />
    </Field>
  );
}

function Content({
  current,
  update,
  pages,
  updatePages,
  themeName,
  studioPack,
}: {
  current: StudioSection;
  update: (p: Partial<StudioSettings>) => void;
  pages: StudioPagesState;
  updatePages: (p: Partial<StudioPagesState>) => void;
  themeName: string;
  studioPack: boolean;
}) {
  const s = current.settings;
  const PreviewOnly = () =>
    studioPack ? null : (
      <p className="note">Fields marked ◇ only change the Studio theme. {themeName} keeps its own design for them.</p>
    );
  if (current.type === 'hero') {
    return (
      <>
        <PreviewOnly />
        <Eyebrow s={s} update={update} fallback="" />
        <Field label="Layout ◇">
          <select value={s.layout} onChange={(e) => update({ layout: e.target.value as StudioSettings['layout'] })}>
            <option value="image-text">Image + Text</option>
            <option value="text-image">Text + Image</option>
            <option value="full">Full Width Image</option>
          </select>
        </Field>
        <Field label="Heading">
          <textarea value={s.heading ?? ''} maxLength={80} onChange={(e) => update({ heading: e.target.value })} />
        </Field>
        <Field label="Description">
          <textarea value={s.description ?? ''} maxLength={160} onChange={(e) => update({ description: e.target.value })} />
        </Field>
        <Field label="Image">
          <ImagePicker value={s.image ?? ''} onChange={(image) => update({ image })} />
        </Field>
        <Field label="Button text">
          <input value={s.buttonText ?? ''} maxLength={32} onChange={(e) => update({ buttonText: e.target.value })} />
        </Field>
        <Field label="Highlights ◇">
          <input
            value={s.benefits ?? ''}
            maxLength={200}
            placeholder="Fresh stock, Same day delivery"
            onChange={(e) => update({ benefits: e.target.value })}
          />
        </Field>
        <p className="styleHint">Short points under the button, separated by commas. Leave empty to hide.</p>
        <Field label="Text alignment ◇">
          <div className="seg">
            {(['left', 'center', 'right'] as const).map((a, i) => (
              <button type="button" key={a} className={s.align === a ? 'on' : ''} onClick={() => update({ align: a })}>
                {['☰', '≡', '☷'][i]}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Overlay on image ◇">
          <input type="range" min="0" max="60" value={s.overlay ?? 0} onChange={(e) => update({ overlay: +e.target.value })} />
          <small>{s.overlay ?? 0}%</small>
        </Field>
        <Field label="Section height ◇">
          <select value={s.height} onChange={(e) => update({ height: e.target.value as StudioSettings['height'] })}>
            <option value="small">Small</option>
            <option value="medium">Medium</option>
            <option value="large">Large</option>
          </select>
        </Field>
      </>
    );
  }
  if (current.type === 'header') {
    return (
      <>
        <PreviewOnly />
        <Field label="Store name ◇">
          <input value={s.logo ?? ''} onChange={(e) => update({ logo: e.target.value })} />
        </Field>
        <Field label="Tagline">
          <input value={s.tagline ?? ''} onChange={(e) => update({ tagline: e.target.value })} />
        </Field>
        <Check label="Show search ◇" checked={s.showSearch !== false} onChange={(showSearch) => update({ showSearch })} />
        <Check label="Show navigation ◇" checked={s.showNav !== false} onChange={(showNav) => update({ showNav })} />
        <Field label="Navigation links ◇">
          <textarea value={s.navLinks ?? ''} onChange={(e) => update({ navLinks: e.target.value })} />
        </Field>
        <p className="styleHint">Separate links with commas. Remove a word here to drop it from the menu.</p>
        <Field label="Highlighted link ◇">
          <select value={s.highlightLink ?? ''} onChange={(e) => update({ highlightLink: e.target.value })}>
            <option value="">None</option>
            {splitList(s.navLinks, '').map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </Field>
        <h3 className="styleSub">Account & cart icons</h3>
        <Field label="Icon position ◇">
          <div className="seg">
            {(['left', 'right'] as const).map((p) => (
              <button
                type="button"
                key={p}
                className={(s.iconsPosition ?? 'right') === p ? 'on' : ''}
                onClick={() => update({ iconsPosition: p })}
              >
                {p === 'left' ? 'Left of logo' : 'Right side'}
              </button>
            ))}
          </div>
        </Field>
        <Check label="Show account icon ◇" checked={s.showAccount !== false} onChange={(showAccount) => update({ showAccount })} />
        {s.showAccount !== false ? (
          <IconChoice
            label="Account icon ◇"
            name={s.accountIcon}
            svg={s.accountIconSvg}
            fallback={<User />}
            query="user"
            onChange={(icon) => update({ accountIcon: icon?.name, accountIconSvg: icon?.svg })}
          />
        ) : null}
        <Check label="Show cart icon ◇" checked={s.showCart !== false} onChange={(showCart) => update({ showCart })} />
        {s.showCart !== false ? (
          <>
            <IconChoice
              label="Cart icon ◇"
              name={s.cartIcon}
              svg={s.cartIconSvg}
              fallback={<ShoppingCart />}
              query="cart"
              onChange={(icon) => update({ cartIcon: icon?.name, cartIconSvg: icon?.svg })}
            />
            <Check label="Show cart item count ◇" checked={s.showCartCount !== false} onChange={(showCartCount) => update({ showCartCount })} />
          </>
        ) : null}
      </>
    );
  }
  if (current.type === 'footer') {
    return (
      <>
        <PreviewOnly />
        <Field label="Brand ◇">
          <input value={s.brand ?? ''} onChange={(e) => update({ brand: e.target.value })} />
        </Field>
        <Field label="Tagline ◇">
          <input value={s.tagline ?? ''} onChange={(e) => update({ tagline: e.target.value })} />
        </Field>
        <Field label="Links ◇">
          <textarea value={s.links ?? ''} onChange={(e) => update({ links: e.target.value })} />
        </Field>
      </>
    );
  }
  if (current.type === 'announcement') {
    const auto = s.announceMode === 'auto' && !!s.autoText;
    const length = [s.text, s.extra].map((v) => v?.trim()).filter(Boolean).join(' · ').length;
    return (
      <>
        {s.autoText ? (
          <Field label="What to show">
            <div className="seg">
              <button type="button" className={auto ? '' : 'on'} onClick={() => update({ announceMode: 'custom' })}>
                My message
              </button>
              <button type="button" className={auto ? 'on' : ''} onClick={() => update({ announceMode: 'auto' })}>
                Automatic
              </button>
            </div>
          </Field>
        ) : null}
        {auto ? (
          <p className="note">
            Automatic shows your best current offer, or your tagline when nothing is discounted. Right now: “{s.autoText}”
          </p>
        ) : (
          <>
            <Field label="Announcement text">
              <input value={s.text ?? ''} maxLength={160} onChange={(e) => update({ text: e.target.value })} />
            </Field>
            <Field label="Second message (optional)">
              <input value={s.extra ?? ''} onChange={(e) => update({ extra: e.target.value })} />
            </Field>
            <p className={length > 160 ? 'note warnNote' : 'styleHint'}>
              {length}/160 characters. Both messages are joined with “·” on the store.
            </p>
          </>
        )}
        <Field label="Link (optional)">
          <input
            value={s.link ?? ''}
            placeholder="/about or https://…"
            onChange={(e) => update({ link: e.target.value })}
          />
        </Field>
        <p className="styleHint">Colours and alignment are under Style. All of this is saved when you Publish.</p>
      </>
    );
  }
  if (current.type === 'categories') {
    return (
      <>
        <PreviewOnly />
        <Eyebrow s={s} update={update} fallback={STUDIO_EYEBROW.categories ?? ''} />
        <Field label="Heading ◇">
          <input value={s.title ?? ''} onChange={(e) => update({ title: e.target.value })} />
        </Field>
        <Field label="Columns ◇">
          <select value={s.columns} onChange={(e) => update({ columns: +e.target.value })}>
            {[3, 4, 5, 6].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Tile style">
          <div className="seg">
            {(['letter', 'icon', 'photo'] as const).map((v) => (
              <button
                type="button"
                key={v}
                className={pages.categoryStyle === v ? 'on' : ''}
                onClick={() => updatePages({ categoryStyle: v })}
              >
                {v[0].toUpperCase() + v.slice(1)}
              </button>
            ))}
          </div>
        </Field>
        <p className="note">Category photos are set on the Collections page.</p>
      </>
    );
  }
  if (current.type === 'products') {
    return (
      <>
        <PreviewOnly />
        <Eyebrow s={s} update={update} fallback={STUDIO_EYEBROW.products ?? ''} />
        <Field label="Heading ◇">
          <input value={s.title ?? ''} onChange={(e) => update({ title: e.target.value })} />
        </Field>
        <Field label="Columns on desktop ◇">
          <select value={s.columns ?? 5} onChange={(e) => update({ columns: +e.target.value })}>
            {[2, 3, 4, 5, 6].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </Field>
        <Check label="Show price ◇" checked={s.showPrice !== false} onChange={(showPrice) => update({ showPrice })} />
        <Check
          label="Show Add button"
          checked={pages.showListingAdd}
          onChange={(showListingAdd) => updatePages({ showListingAdd })}
        />
      </>
    );
  }
  if (current.type === 'banner') {
    return (
      <>
        <PreviewOnly />
        <Eyebrow s={s} update={update} fallback={STUDIO_EYEBROW.banner ?? ''} />
        <Field label="Title">
          <input value={s.title ?? ''} maxLength={120} onChange={(e) => update({ title: e.target.value })} />
        </Field>
        <Field label="Text ◇">
          <textarea value={s.text ?? ''} onChange={(e) => update({ text: e.target.value })} />
        </Field>
        <Field label="Button">
          <input value={s.button ?? ''} maxLength={40} onChange={(e) => update({ button: e.target.value })} />
        </Field>
        <Field label="Background image">
          <ImagePicker value={s.image ?? ''} onChange={(image) => update({ image })} />
        </Field>
      </>
    );
  }
  if (current.type === 'testimonials') {
    return (
      <>
        <PreviewOnly />
        <Eyebrow s={s} update={update} fallback={STUDIO_EYEBROW.testimonials ?? ''} />
        <Field label="Heading ◇">
          <input value={s.title ?? ''} onChange={(e) => update({ title: e.target.value })} />
        </Field>
        <p className="note">Customer quotes come from Appearance → Testimonials in the store editor.</p>
      </>
    );
  }
  return (
    <>
      <PreviewOnly />
      <Field label="Heading ◇">
        <input value={s.title ?? ''} onChange={(e) => update({ title: e.target.value })} />
      </Field>
      <Field label="Text ◇">
        <textarea value={s.text ?? ''} onChange={(e) => update({ text: e.target.value })} />
      </Field>
    </>
  );
}

function Style({
  current,
  update,
  accent,
  studioPack,
}: {
  current: StudioSection;
  update: (p: Partial<StudioSettings>) => void;
  accent: string;
  studioPack: boolean;
}) {
  const s = current.settings;
  const isAnnounce = current.type === 'announcement';
  if (isAnnounce) return <AnnouncementStyle s={s} update={update} accent={accent} studioPack={studioPack} />;
  return (
    <>
      {studioPack ? null : <p className="note">Section styling only applies to the Studio theme.</p>}
      <h3 className="styleSub">Section Style</h3>
      <Field label="Background">
        <input
          type="color"
          value={s.background || '#f3eee6'}
          onChange={(e) => update({ background: e.target.value })}
        />
      </Field>
      <Range label="Spacing top" min={0} max={120} value={s.spacingTop ?? 60} onChange={(spacingTop) => update({ spacingTop })} />
      <Range label="Spacing bottom" min={0} max={120} value={s.spacingBottom ?? 60} onChange={(spacingBottom) => update({ spacingBottom })} />
      <Range label="Corner radius" min={0} max={30} value={s.radius ?? 8} onChange={(radius) => update({ radius })} />
    </>
  );
}

function ColorField({
  label,
  value,
  fallback,
  onChange,
}: {
  label: string;
  value: string | undefined;
  fallback: string;
  onChange: (v: string | undefined) => void;
}) {
  return (
    <Field label={label}>
      <div className="colorRow">
        <input type="color" value={value || fallback} onChange={(e) => onChange(e.target.value)} />
        {value ? (
          <button type="button" className="linkBtn" onClick={() => onChange(undefined)}>
            Use theme default
          </button>
        ) : (
          <small>Theme default</small>
        )}
      </div>
    </Field>
  );
}

function AnnouncementStyle({
  s,
  update,
  accent,
  studioPack,
}: {
  s: StudioSettings;
  update: (p: Partial<StudioSettings>) => void;
  accent: string;
  studioPack: boolean;
}) {
  const tint = s.tone === 'tint';
  return (
    <>
      <h3 className="styleSub">Bar colours</h3>
      <ColorField
        label="Background"
        value={s.background}
        fallback={tint ? '#f3eee6' : accent}
        onChange={(background) => update({ background })}
      />
      <ColorField
        label="Text colour"
        value={s.textColor}
        fallback={tint ? '#1c1917' : '#ffffff'}
        onChange={(textColor) => update({ textColor })}
      />
      <AnnouncementPosition s={s} update={update} studioPack={studioPack} />
    </>
  );
}

function AnnouncementPosition({
  s,
  update,
  studioPack,
}: {
  s: StudioSettings;
  update: (p: Partial<StudioSettings>) => void;
  studioPack: boolean;
}) {
  const align = s.textAlign || 'center';
  const valign = s.textVAlign || 'center';
  return (
    <>
      <h3 className="styleSub">Text position</h3>
      <Field label="Alignment">
        <div className="seg">
          {(['left', 'center', 'right'] as const).map((a) => (
            <button type="button" key={a} className={align === a ? 'on' : ''} onClick={() => update({ textAlign: a })}>
              {a[0].toUpperCase() + a.slice(1)}
            </button>
          ))}
        </div>
      </Field>
      {studioPack ? null : (
        <p className="note">Height, inner spacing and corners below only apply to the Studio theme.</p>
      )}
      <Range label="Extra height top" min={0} max={60} value={s.spacingTop ?? 0} onChange={(spacingTop) => update({ spacingTop })} />
      <Range label="Extra height bottom" min={0} max={60} value={s.spacingBottom ?? 0} onChange={(spacingBottom) => update({ spacingBottom })} />
      <Range label="Corner radius" min={0} max={30} value={s.radius ?? 0} onChange={(radius) => update({ radius })} />
      <Field label="Vertical">
        <div className="seg">
          {(['top', 'center', 'bottom'] as const).map((a) => (
            <button type="button" key={a} className={valign === a ? 'on' : ''} onClick={() => update({ textVAlign: a })}>
              {a === 'center' ? 'Middle' : a[0].toUpperCase() + a.slice(1)}
            </button>
          ))}
        </div>
      </Field>
      <div className="insetGrid">
        <Range label="From top" value={s.textPadTop ?? 0} onChange={(textPadTop) => update({ textPadTop })} />
        <Range label="From right" value={s.textPadRight ?? 0} onChange={(textPadRight) => update({ textPadRight })} />
        <Range label="From bottom" value={s.textPadBottom ?? 0} onChange={(textPadBottom) => update({ textPadBottom })} />
        <Range label="From left" value={s.textPadLeft ?? 0} onChange={(textPadLeft) => update({ textPadLeft })} />
      </div>
    </>
  );
}

function Advanced({
  current,
  updateEnabled,
  studioPack,
}: {
  current: StudioSection;
  updateEnabled: (v: boolean) => void;
  studioPack: boolean;
}) {
  return (
    <>
      <div className="field">
        <span>Section visibility</span>
        <button type="button" className="visibilityBtn" onClick={() => updateEnabled(!current.enabled)}>
          {current.enabled ? 'Visible' : 'Hidden'}
        </button>
      </div>
      <div className="info">
        {studioPack
          ? 'Visibility and section order are saved to your store when you Publish. Drag sections in the left panel to reorder.'
          : 'Visibility is saved when you Publish. Section order and custom text sections only apply to the Studio theme.'}
      </div>
    </>
  );
}

function Store({
  sections,
  select,
  selected,
  products,
  categories,
  testimonials,
  pages,
  logoUrl,
  footerLinks,
  mobileColumns,
}: {
  sections: StudioSection[];
  select: (id: string) => void;
  selected: string | null;
  products: StudioProduct[];
  categories: StudioCategory[];
  testimonials: StoreTestimonial[];
  pages: StudioPagesState;
  logoUrl: string;
  footerLinks: (s: StudioSettings) => Array<{ label: string }>;
  mobileColumns: 2 | 3;
}) {
  return (
    <>
      {sections
        .filter((s) => s.enabled)
        .map((s) => (
          <div
            key={s.id}
            className={`editable ${selected === s.id ? 'selectedPreview' : ''}`}
            onClick={() => select(s.id)}
          >
            {s.type === 'announcement' ? <StudioAnnouncement s={s.settings} /> : null}
            {s.type === 'header' ? (
              <StudioHeader s={s.settings} logoUrl={logoUrl} />
            ) : null}
            {s.type === 'hero' ? <StudioHero s={s.settings} /> : null}
            {s.type === 'categories' ? (
              <StudioCategoriesSection
                s={s.settings}
                categories={categories}
                style={pages.categoryStyle}
                images={pages.categoryImages}
              />
            ) : null}
            {s.type === 'products' ? (
              <StudioProductsSection s={s.settings} mobileColumns={mobileColumns}>
                {products.map((p) => (
                  <StudioProductTile
                    key={p.id}
                    name={p.name}
                    unit={p.unit}
                    price={p.price}
                    mrp={p.mrp}
                    image={p.image}
                    showPrice={s.settings.showPrice !== false}
                    add={pages.showListingAdd ? <StudioAddButton /> : null}
                  />
                ))}
              </StudioProductsSection>
            ) : null}
            {s.type === 'banner' ? <StudioBanner s={s.settings} /> : null}
            {s.type === 'testimonials' ? (
              <StudioTestimonials
                s={s.settings}
                testimonials={testimonials.length ? testimonials : SAMPLE_TESTIMONIALS}
                sample={!testimonials.length}
              />
            ) : null}
            {s.type === 'footer' ? <StudioFooter s={s.settings} links={footerLinks(s.settings)} /> : null}
            {s.type === 'richtext' ? <StudioRichText s={s.settings} /> : null}
          </div>
        ))}
    </>
  );
}

