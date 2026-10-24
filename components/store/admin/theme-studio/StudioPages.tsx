'use client';

import { useState, type CSSProperties, type ReactNode } from 'react';
import { Heart, Instagram, Mail, MessageCircle, Minus, Phone, Plus, Search, ShoppingCart } from 'lucide-react';
import type { StoreCategoryStyle, StoreContactForm, StoreFormFieldMode } from '@/lib/store/store-theme';
import type { StudioPageId, StudioPagesState } from './studio-map';
import {
  CategoryTiles,
  Check,
  Field,
  ImagePicker,
  rupees,
  type StudioCategory,
  type StudioProduct,
} from './studio-ui';

type UpdatePages = (patch: Partial<StudioPagesState>) => void;
type Device = 'desktop' | 'tablet' | 'mobile';

const STYLE_LABELS: Record<StoreCategoryStyle, string> = { letter: 'Letter', icon: 'Icon', photo: 'Photo' };
const FIELD_MODE_OPTIONS: Array<{ value: StoreFormFieldMode; label: string }> = [
  { value: 'required', label: 'Required' },
  { value: 'optional', label: 'Optional' },
  { value: 'off', label: 'Hidden' },
];

function Seg<T extends string | number>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (v: T) => void;
}) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button type="button" key={String(o.value)} className={value === o.value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function PageSettings({
  page,
  section,
  pages,
  update,
  categories,
}: {
  page: StudioPageId;
  section: string;
  pages: StudioPagesState;
  update: UpdatePages;
  categories: StudioCategory[];
}) {
  const key = `${page}:${section}`;
  switch (key) {
    case 'products:search':
      return (
        <>
          <Field label="Search placeholder">
            <input
              value={pages.searchPlaceholder}
              maxLength={80}
              placeholder="Search products…"
              onChange={(e) => update({ searchPlaceholder: e.target.value })}
            />
          </Field>
          <p className="note">Category chips come from the categories of items you show in the store.</p>
        </>
      );
    case 'products:grid':
      return (
        <>
          <Field label="Columns on mobile">
            <Seg
              value={pages.mobileColumns}
              options={[
                { value: 2, label: '2 per row' },
                { value: 3, label: '3 per row' },
              ]}
              onChange={(mobileColumns) => update({ mobileColumns })}
            />
          </Field>
          <Check label="Show Add button on product cards" checked={pages.showListingAdd} onChange={(showListingAdd) => update({ showListingAdd })} />
          <p className="note">Switch the preview to Mobile to see the column setting.</p>
        </>
      );
    case 'collections:grid': {
      const real = categories.filter((c) => !c.id.startsWith('sample-'));
      return (
        <>
          <Field label="Tile style">
            <Seg
              value={pages.categoryStyle}
              options={(['letter', 'icon', 'photo'] as const).map((v) => ({ value: v, label: STYLE_LABELS[v] }))}
              onChange={(categoryStyle) => update({ categoryStyle })}
            />
          </Field>
          {pages.categoryStyle === 'photo' ? (
            real.length ? (
              real.map((c) => (
                <Field key={c.id} label={c.name}>
                  <ImagePicker
                    value={pages.categoryImages[c.id] ?? ''}
                    onChange={(url) => {
                      const next = { ...pages.categoryImages };
                      if (url) next[c.id] = url;
                      else delete next[c.id];
                      update({ categoryImages: next });
                    }}
                  />
                </Field>
              ))
            ) : (
              <p className="note">Add items with categories and mark them “Show in store” to set category photos.</p>
            )
          ) : null}
        </>
      );
    }
    case 'product:details':
      return (
        <p className="note">
          Name, photos, price, MRP and description come from each item. Edit them under Items. The minimum order line is set on the Cart page.
        </p>
      );
    case 'product:buy':
      return (
        <>
          <Check label="Sticky Buy now bar on mobile" checked={pages.stickyBuyNow} onChange={(stickyBuyNow) => update({ stickyBuyNow })} />
          <p className="note">Keeps Add to cart and Buy now pinned to the bottom of the screen while shoppers scroll.</p>
        </>
      );
    case 'cart:items':
      return <p className="note">Shows whatever the shopper adds. Quantities and prices update automatically.</p>;
    case 'cart:summary':
      return (
        <>
          <Field label="Minimum order amount (₹)">
            <input
              type="number"
              min={0}
              value={pages.minOrder || ''}
              placeholder="0 = no minimum"
              onChange={(e) => update({ minOrder: Math.max(0, Number(e.target.value) || 0) })}
            />
          </Field>
          <p className="note">Checkout stays disabled until the cart reaches this amount. It also shows on product pages.</p>
        </>
      );
    case 'checkout:address':
      return <p className="note">Name, phone and delivery address are always collected. Delivery zones are set under Store setup.</p>;
    case 'checkout:payment':
      return (
        <>
          <Check label="Allow Cash on delivery" checked={pages.allowCod} onChange={(allowCod) => update({ allowCod })} />
          <p className="note">Online payment appears when Razorpay is connected under Settings → Payments.</p>
        </>
      );
    case 'about:content':
      return (
        <>
          <Field label="About your store">
            <textarea
              rows={12}
              value={pages.aboutMd}
              placeholder="Tell shoppers who you are, what you sell and why they can trust you."
              onChange={(e) => update({ aboutMd: e.target.value })}
            />
          </Field>
          <p className="note">If left empty, the store shows your tagline.</p>
        </>
      );
    case 'contact:content':
      return (
        <>
          <Field label="Contact details">
            <textarea
              rows={10}
              value={pages.contactMd}
              placeholder={'Phone: 98xxxxxx10\nEmail: hello@yourstore.in\nAddress: …\nHours: 9am – 9pm'}
              onChange={(e) => update({ contactMd: e.target.value })}
            />
          </Field>
          <p className="note">If left empty, the store shows your business phone and email.</p>
          <Check
            label="Show quick contact buttons (Call, WhatsApp, Email)"
            checked={pages.contactForm.quick_links}
            onChange={(quick_links) => update({ contactForm: { ...pages.contactForm, quick_links } })}
          />
          <p className="note">Buttons use your business phone and email, and the WhatsApp link from Social links.</p>
        </>
      );
    case 'contact:form':
      return <ContactFormSettings form={pages.contactForm} onChange={(contactForm) => update({ contactForm })} />;
    case 'contact:social':
      return (
        <>
          <Field label="WhatsApp number or link">
            <input value={pages.whatsappUrl} placeholder="+91 98xxxxxx10 or https://wa.me/…" onChange={(e) => update({ whatsappUrl: e.target.value })} />
          </Field>
          <Field label="Instagram link">
            <input value={pages.instagramUrl} placeholder="https://instagram.com/yourstore" onChange={(e) => update({ instagramUrl: e.target.value })} />
          </Field>
          <p className="note">These also appear in the store footer on every page.</p>
        </>
      );
    default:
      return <div className="info">Select a section to customize it.</div>;
  }
}

const LAYOUT_OPTIONS: Array<{ value: StoreContactForm['layout']; label: string }> = [
  { value: 'stacked', label: 'Stacked' },
  { value: 'text-form', label: 'Text | Form' },
  { value: 'form-text', label: 'Form | Text' },
];
const ALIGN_OPTIONS: Array<{ value: StoreContactForm['align']; label: string }> = [
  { value: 'left', label: 'Left' },
  { value: 'center', label: 'Center' },
  { value: 'right', label: 'Right' },
];
const WIDTH_OPTIONS: Array<{ value: StoreContactForm['width']; label: string }> = [
  { value: 'narrow', label: 'Narrow' },
  { value: 'medium', label: 'Medium' },
  { value: 'wide', label: 'Wide' },
];
const BOX_OPTIONS: Array<{ value: StoreContactForm['style']; label: string }> = [
  { value: 'card', label: 'Card' },
  { value: 'filled', label: 'Tinted' },
  { value: 'plain', label: 'Plain' },
];

function ContactFormSettings({ form, onChange }: { form: StoreContactForm; onChange: (f: StoreContactForm) => void }) {
  const [tab, setTab] = useState<'content' | 'layout'>('content');
  const set = (patch: Partial<StoreContactForm>) => onChange({ ...form, ...patch });
  const setMode = (field: 'phone' | 'email', mode: StoreFormFieldMode) => {
    const other = field === 'phone' ? 'email' : 'phone';
    const next = { ...form, [field]: mode };
    if (next.phone !== 'required' && next.email !== 'required') next[other] = 'required';
    onChange(next);
  };

  return (
    <>
      <Check label="Show a contact form on the Contact page" checked={form.enabled} onChange={(enabled) => set({ enabled })} />
      {!form.enabled ? null : (
        <>
          <div className="tabs">
            <button type="button" className={tab === 'content' ? 'on' : ''} onClick={() => setTab('content')}>
              Content
            </button>
            <button type="button" className={tab === 'layout' ? 'on' : ''} onClick={() => setTab('layout')}>
              Layout &amp; style
            </button>
          </div>
          {tab === 'content' ? (
            <>
              <Field label="Form title">
                <input value={form.title} maxLength={80} onChange={(e) => set({ title: e.target.value })} />
              </Field>
              <Field label="Intro text (optional)">
                <textarea
                  rows={2}
                  value={form.intro}
                  maxLength={300}
                  placeholder="We usually reply within a few hours."
                  onChange={(e) => set({ intro: e.target.value })}
                />
              </Field>
              <Field label="Phone field">
                <Seg value={form.phone} options={FIELD_MODE_OPTIONS} onChange={(m) => setMode('phone', m)} />
              </Field>
              <Field label="Email field">
                <Seg value={form.email} options={FIELD_MODE_OPTIONS} onChange={(m) => setMode('email', m)} />
              </Field>
              <p className="note">Name and message are always asked. Phone or email stays required so you can reply.</p>
              <Field label="Topic dropdown (one per line, optional)">
                <textarea
                  rows={3}
                  value={form.topics.join('\n')}
                  placeholder={'Bulk order\nOrder status\nCustom request'}
                  onChange={(e) => set({ topics: e.target.value.split('\n').slice(0, 8) })}
                />
              </Field>
              <Field label="Message placeholder">
                <input
                  value={form.message_placeholder}
                  maxLength={120}
                  placeholder="e.g. Tell us the product and quantity you need"
                  onChange={(e) => set({ message_placeholder: e.target.value })}
                />
              </Field>
              <Field label="Button text">
                <input value={form.button} maxLength={32} onChange={(e) => set({ button: e.target.value })} />
              </Field>
              <Field label="Thank-you message">
                <textarea rows={3} value={form.success} maxLength={240} onChange={(e) => set({ success: e.target.value })} />
              </Field>
              <p className="note">
                Messages arrive in Online Store → Enquiries, as a Khatario notification and on your business WhatsApp.
                Spam is filtered with a hidden trap field and a limit of 3 messages per visitor every 10 minutes.
              </p>
            </>
          ) : (
            <>
              <Field label="Layout">
                <Seg value={form.layout} options={LAYOUT_OPTIONS} onChange={(layout) => set({ layout })} />
              </Field>
              <p className="note">
                {form.layout === 'stacked'
                  ? 'Contact details on top, form below.'
                  : 'Contact details and form sit side by side on desktop, and stack on phones. If you have no contact details, the form uses the stacked layout.'}
              </p>
              {form.layout === 'stacked' ? (
                <>
                  <Field label="Form position">
                    <Seg value={form.align} options={ALIGN_OPTIONS} onChange={(align) => set({ align })} />
                  </Field>
                  <Field label="Form width">
                    <Seg value={form.width} options={WIDTH_OPTIONS} onChange={(width) => set({ width })} />
                  </Field>
                </>
              ) : null}
              <Field label="Form box">
                <Seg value={form.style} options={BOX_OPTIONS} onChange={(style) => set({ style })} />
              </Field>
              <Field label="Field labels">
                <Seg
                  value={form.labels_inside ? 'inside' : 'above'}
                  options={[
                    { value: 'above', label: 'Above field' },
                    { value: 'inside', label: 'Inside field' },
                  ]}
                  onChange={(v) => set({ labels_inside: v === 'inside' })}
                />
              </Field>
              <Field label="Button width">
                <Seg
                  value={form.button_full ? 'full' : 'auto'}
                  options={[
                    { value: 'full', label: 'Full width' },
                    { value: 'auto', label: 'Fit text' },
                  ]}
                  onChange={(v) => set({ button_full: v === 'full' })}
                />
              </Field>
            </>
          )}
        </>
      )}
    </>
  );
}

function Block({
  id,
  selected,
  select,
  children,
  className = '',
}: {
  id: string;
  selected: string | null;
  select: (id: string) => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`editable ${selected === id ? 'selectedPreview' : ''} ${className}`} onClick={() => select(id)}>
      {children}
    </div>
  );
}

function ProductCard({ p, showAdd }: { p: StudioProduct; showAdd: boolean }) {
  const off = p.mrp && p.mrp > p.price ? Math.round(((p.mrp - p.price) / p.mrp) * 100) : 0;
  return (
    <div className="product">
      <div className="pimg">
        {off ? <em>{off}% OFF</em> : null}
        <Heart />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {p.image ? <img src={p.image} alt="" /> : null}
      </div>
      <div className="pname">{p.name}</div>
      <small>{p.unit}</small>
      <div className="price">
        {off ? <del>{rupees(p.mrp!)}</del> : null} {rupees(p.price)}
      </div>
      {showAdd ? (
        <button type="button" className="addBtn">
          <ShoppingCart /> Add
        </button>
      ) : null}
    </div>
  );
}

export function PagePreview({
  page,
  pages,
  products,
  categories,
  header,
  footer,
  selected,
  select,
  device,
  storeName,
  tagline,
  contactFallback,
}: {
  page: StudioPageId;
  pages: StudioPagesState;
  products: StudioProduct[];
  categories: StudioCategory[];
  header: ReactNode;
  footer: ReactNode;
  selected: string | null;
  select: (id: string) => void;
  device: Device;
  storeName: string;
  tagline: string;
  contactFallback: { phone?: string; email?: string };
}) {
  const b = (id: string, children: ReactNode, className?: string) => (
    <Block id={id} selected={selected} select={select} className={className}>
      {children}
    </Block>
  );
  const listCols = device === 'mobile' ? pages.mobileColumns : device === 'tablet' ? 3 : 5;
  const product = products[0];
  const cartItems = products.slice(0, 2);
  const subtotal = cartItems.reduce((sum, p) => sum + p.price, 0);
  const belowMin = pages.minOrder > 0 && subtotal < pages.minOrder;

  let body: ReactNode = null;
  if (page === 'products') {
    body = (
      <>
        {b(
          'search',
          <section className="pl">
            <div className="plSearch">
              <Search />
              <span>{pages.searchPlaceholder || 'Search products…'}</span>
            </div>
            <div className="chips">
              <span className="on">All</span>
              {categories.map((c) => (
                <span key={c.id}>{c.name}</span>
              ))}
            </div>
          </section>,
        )}
        {b(
          'grid',
          <section>
            <div className="plGrid" style={{ '--pl-cols': String(listCols) } as CSSProperties}>
              {products.concat(products).slice(0, 10).map((p, i) => (
                <ProductCard key={`${p.id}-${i}`} p={p} showAdd={pages.showListingAdd} />
              ))}
            </div>
          </section>,
        )}
      </>
    );
  } else if (page === 'collections') {
    body = b(
      'grid',
      <section>
        <div className="sectionTitle">
          <div>
            <small>SHOP BY CATEGORY</small>
            <h2>All categories</h2>
          </div>
        </div>
        <CategoryTiles
          categories={categories}
          style={pages.categoryStyle}
          images={pages.categoryImages}
          columns={device === 'mobile' ? 3 : 6}
        />
      </section>,
    );
  } else if (page === 'product' && product) {
    const off = product.mrp && product.mrp > product.price ? Math.round(((product.mrp - product.price) / product.mrp) * 100) : 0;
    body = (
      <>
        {b(
          'details',
          <section className="pd">
            <div className="pdImg">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {product.image ? <img src={product.image} alt="" /> : null}
            </div>
            <div className="pdInfo">
              <small>{product.unit}</small>
              <h1>{product.name}</h1>
              <div className="pdPrice">
                {rupees(product.price)} {off ? <del>{rupees(product.mrp!)}</del> : null} {off ? <em>{off}% off</em> : null}
              </div>
              <p className="muted">Inclusive of all taxes</p>
              {pages.minOrder > 0 ? <p className="minNote">Minimum order {rupees(pages.minOrder)}</p> : null}
              <div className="qty">
                <Minus /> <b>1</b> <Plus />
              </div>
            </div>
          </section>,
        )}
        {b(
          'buy',
          <div className={pages.stickyBuyNow ? 'buyBar sticky' : 'buyBar'}>
            <button type="button" className="ghost">
              <ShoppingCart /> Add to cart
            </button>
            <button type="button" className="solid">Buy now</button>
            {pages.stickyBuyNow ? <span className="stickyTag">Pinned on mobile</span> : null}
          </div>,
        )}
      </>
    );
  } else if (page === 'cart') {
    body = (
      <section className="cartWrap">
        <h1 className="pageTitle">Your cart</h1>
        <div className="cartGrid">
          {b(
            'items',
            <div className="cartItems">
              {cartItems.map((p) => (
                <div className="cartRow" key={p.id}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {p.image ? <img src={p.image} alt="" /> : <div className="ph" />}
                  <div>
                    <b>{p.name}</b>
                    <small>{p.unit}</small>
                  </div>
                  <div className="qty">
                    <Minus /> <b>1</b> <Plus />
                  </div>
                  <b>{rupees(p.price)}</b>
                </div>
              ))}
            </div>,
          )}
          {b(
            'summary',
            <div className="summary">
              <div>
                <span>Subtotal</span>
                <b>{rupees(subtotal)}</b>
              </div>
              <div>
                <span>Delivery</span>
                <span className="muted">At checkout</span>
              </div>
              {belowMin ? (
                <p className="warn">
                  Minimum order {rupees(pages.minOrder)}. Add {rupees(pages.minOrder - subtotal)} more.
                </p>
              ) : null}
              <button type="button" className="solid" disabled={belowMin}>
                Checkout
              </button>
            </div>,
          )}
        </div>
      </section>
    );
  } else if (page === 'checkout') {
    body = (
      <section className="cartWrap">
        <h1 className="pageTitle">Checkout</h1>
        <div className="cartGrid">
          {b(
            'address',
            <div className="form">
              <h3>Delivery details</h3>
              {['Full name', 'Phone number', 'House / flat, street', 'Area / locality', 'City', 'PIN code'].map((l) => (
                <div className="input" key={l}>
                  {l}
                </div>
              ))}
            </div>,
          )}
          {b(
            'payment',
            <div className="summary">
              <h3>Payment</h3>
              {pages.allowCod ? (
                <label className="pay on">
                  <span className="dot" /> Cash on delivery
                </label>
              ) : null}
              <label className={pages.allowCod ? 'pay' : 'pay on'}>
                <span className="dot" /> Pay online (UPI / card)
              </label>
              {!pages.allowCod ? <p className="muted">Cash on delivery is off.</p> : null}
              <button type="button" className="solid">
                Place order
              </button>
            </div>,
          )}
        </div>
      </section>
    );
  } else if (page === 'about') {
    body = b(
      'content',
      <section className="doc">
        <h1 className="pageTitle">About</h1>
        <div className="docBody">{pages.aboutMd || tagline || `${storeName} is powered by Khatario.`}</div>
      </section>,
    );
  } else if (page === 'contact') {
    const form = pages.contactForm;
    const split = form.enabled && form.layout !== 'stacked';
    const centered = form.enabled && !split && form.align === 'center';
    const topics = form.topics.map((t) => t.trim()).filter(Boolean);
    const input = (label: string, optional = false, tall = false) => {
      const insideText = form.labels_inside ? `${label}${optional ? ' (optional)' : ''}` : null;
      const placeholder = tall && form.message_placeholder ? form.message_placeholder : insideText;
      return (
        <label>
          {form.labels_inside ? null : (
            <>
              {label}
              {optional ? <em> (optional)</em> : null}
            </>
          )}
          <span className={`fakeInput ${tall ? 'tall' : ''}`}>{placeholder}</span>
        </label>
      );
    };

    const detailsBlock = b(
      'content',
      <section className={`doc ${centered ? 'centered' : ''}`}>
        <h1 className="pageTitle">Contact</h1>
        <div className="docBody">
          {pages.contactMd ||
            [contactFallback.phone && `Phone: ${contactFallback.phone}`, contactFallback.email && `Email: ${contactFallback.email}`]
              .filter(Boolean)
              .join('\n') ||
            'Add contact details so shoppers can reach you.'}
        </div>
        {form.quick_links ? (
          <div className="quickLinks">
            {contactFallback.phone ? (
              <span>
                <Phone /> Call us
              </span>
            ) : null}
            {pages.whatsappUrl ? (
              <span>
                <MessageCircle /> WhatsApp
              </span>
            ) : null}
            {contactFallback.email ? (
              <span>
                <Mail /> Email
              </span>
            ) : null}
          </div>
        ) : null}
      </section>,
    );

    const formBlock = b(
      'form',
      form.enabled ? (
        <section className={split ? 'doc' : `doc formWrap w-${form.width} a-${form.align}`}>
          <div className={`contactForm box-${form.style} ${centered ? 'centered' : ''}`}>
            <div>
              <h3>{form.title}</h3>
              {form.intro ? <p className="formIntro">{form.intro}</p> : null}
            </div>
            {input('Name')}
            {form.phone !== 'off' ? input('Phone', form.phone === 'optional') : null}
            {form.email !== 'off' ? input('Email', form.email === 'optional') : null}
            {topics.length > 0 ? (
              <label>
                {form.labels_inside ? null : 'Topic'}
                <span className="fakeInput select">{form.labels_inside ? 'Topic' : 'Choose a topic'} ▾</span>
              </label>
            ) : null}
            {input('Message', false, true)}
            <button type="button" className={`solid ${form.button_full ? 'full' : ''}`}>
              {form.button}
            </button>
          </div>
        </section>
      ) : (
        <section className="doc">
          <span className="muted">Contact form is off. Select this block to turn it on.</span>
        </section>
      ),
    );

    body = (
      <>
        {split ? (
          <div className="contactSplit">
            {form.layout === 'text-form' ? (
              <>
                {detailsBlock}
                {formBlock}
              </>
            ) : (
              <>
                {formBlock}
                {detailsBlock}
              </>
            )}
          </div>
        ) : (
          <>
            {detailsBlock}
            {formBlock}
          </>
        )}
        {b(
          'social',
          <section className="doc social">
            {pages.whatsappUrl ? (
              <span className="socialBtn">
                <MessageCircle /> WhatsApp
              </span>
            ) : null}
            {pages.instagramUrl ? (
              <span className="socialBtn">
                <Instagram /> Instagram
              </span>
            ) : null}
            {!pages.whatsappUrl && !pages.instagramUrl ? <span className="muted">No social links yet.</span> : null}
          </section>,
        )}
      </>
    );
  }

  return (
    <>
      {header}
      {body}
      {footer}
    </>
  );
}
