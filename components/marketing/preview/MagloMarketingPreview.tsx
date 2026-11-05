'use client';

import Link from 'next/link';
import {
  ArrowRight,
  BadgeCheck,
  BarChart3,
  FileText,
  MessageCircle,
  Package,
  Shield,
  Store,
  Users,
} from 'lucide-react';
import './maglo-marketing-preview.css';

/**
 * Design-only marketing preview inspired by Maglo (ui.live Financial Management kit).
 * Uses real Khatario product copy. Does not replace the live landing page.
 */
export function MagloMarketingPreview() {
  return (
    <div className="maglo-mkt">
      <div className="maglo-mkt__banner" role="status">
        Design preview · Maglo layout language · Khatario product copy ·{' '}
        <Link href="/">Back to live site</Link>
      </div>

      <header className="maglo-mkt__nav">
        <div className="maglo-mkt__nav-inner">
          <Link href="/" className="maglo-mkt__logo" aria-label="Khatario home">
            <span className="maglo-mkt__logo-mark" aria-hidden />
            Khatario
          </Link>
          <nav className="maglo-mkt__nav-links" aria-label="Preview">
            <a href="#product">Product</a>
            <a href="#proof">Why shops</a>
            <a href="#features">Features</a>
            <a href="#pricing">Pricing</a>
          </nav>
          <div className="maglo-mkt__nav-actions">
            <Link href="/login" className="maglo-mkt__link-quiet">
              Sign in
            </Link>
            <Link href="/signup" className="maglo-mkt__btn maglo-mkt__btn--lime">
              Start free
            </Link>
          </div>
        </div>
      </header>

      <main>
        <section className="maglo-mkt__hero">
          <div className="maglo-mkt__hero-copy">
            <div className="maglo-mkt__badges">
              <span>
                <BadgeCheck size={14} aria-hidden /> Free plan: unlimited GST bills
              </span>
              <span>
                <Shield size={14} aria-hidden /> Made in India
              </span>
            </div>
            <h1>
              GST billing for Indian shops.
              <span className="maglo-mkt__accent-text"> Close the day the calmer way.</span>
            </h1>
            <p className="maglo-mkt__lead">
              Make a GST bill in seconds, send it on WhatsApp and collect by UPI. Then run your
              online store, WhatsApp offers and staff attendance from the same app.
            </p>
            <div className="maglo-mkt__hero-cta">
              <Link href="/signup" className="maglo-mkt__btn maglo-mkt__btn--dark">
                Start Billing trial
                <ArrowRight size={16} aria-hidden />
              </Link>
              <Link href="/book-demo" className="maglo-mkt__btn maglo-mkt__btn--ghost">
                Book a demo
              </Link>
            </div>
            <p className="maglo-mkt__footnote">
              No credit card to start · Works on phone &amp; computer · HR Lite for up to 30 staff
              included
            </p>
          </div>

          <div className="maglo-mkt__hero-visual" aria-hidden={false} aria-label="Product preview">
            <MagloDashboardMock />
          </div>
        </section>

        <section id="proof" className="maglo-mkt__kpis">
          <KpiCard dark title="₹0" label="to start, no card" />
          <KpiCard title="Unlimited" label="GST bills on Free" />
          <KpiCard title="13" label="languages on your bill" />
          <KpiCard title="4-in-1" label="billing, store, WhatsApp, staff" />
        </section>

        <section id="product" className="maglo-mkt__section">
          <p className="maglo-mkt__eyebrow">Built for the counter</p>
          <h2>
            Everything a shop needs, <em>nothing it does not.</em>
          </h2>
          <div className="maglo-mkt__fact-grid">
            {[
              { value: '20+', label: 'GST-ready invoice, challan and note templates' },
              { value: '58 & 80mm', label: 'Thermal receipt printing for busy counters' },
              { value: '13', label: 'Languages your bills can print in' },
              { value: 'GSTR-1 & 3B', label: 'Plus 2B matching and GSTR-9, from your own bills' },
            ].map((f) => (
              <article key={f.label} className="maglo-mkt__fact">
                <p className="maglo-mkt__fact-value">{f.value}</p>
                <p className="maglo-mkt__fact-label">{f.label}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="features" className="maglo-mkt__section maglo-mkt__section--muted">
          <p className="maglo-mkt__eyebrow">One app for the shop</p>
          <h2>Run billing, stock, WhatsApp and staff without switching tools</h2>
          <div className="maglo-mkt__feature-grid">
            {[
              {
                icon: FileText,
                title: 'GST invoices',
                body: 'Tax invoices, estimates, challans and credit notes — ready for Indian GST rules.',
              },
              {
                icon: MessageCircle,
                title: 'WhatsApp send',
                body: 'Share bills on WhatsApp the moment you save them. Collect faster with UPI.',
              },
              {
                icon: Package,
                title: 'Inventory',
                body: 'Stock, batches and low-stock alerts so the counter never sells what you do not have.',
              },
              {
                icon: Store,
                title: 'Online store',
                body: 'Put your catalogue online and take orders that land back in Khatario.',
              },
              {
                icon: BarChart3,
                title: 'GST reports',
                body: 'GSTR-1, 3B, 2B matching and books that stay tied to your real invoices.',
              },
              {
                icon: Users,
                title: 'Staff & attendance',
                body: 'HR Lite for up to 30 staff — attendance and simple payroll with billing.',
              },
            ].map((f) => (
              <article key={f.title} className="maglo-mkt__feature">
                <span className="maglo-mkt__feature-icon">
                  <f.icon size={18} aria-hidden />
                </span>
                <h3>{f.title}</h3>
                <p>{f.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="maglo-mkt__section">
          <p className="maglo-mkt__eyebrow">Who it is for</p>
          <h2>Retail, wholesale, F&amp;B and trades that bill every day</h2>
          <div className="maglo-mkt__chips">
            {[
              'Retail & grocery',
              'Restaurants & F&B',
              'Distribution & wholesale',
              'Services & repairs',
              'Pharmacy & wellness',
              'Electricals & hardware',
              'Mobile & electronics',
              'Garments & footwear',
              'Auto parts',
              'Building materials',
            ].map((label) => (
              <span key={label} className="maglo-mkt__chip">
                {label}
              </span>
            ))}
          </div>
        </section>

        <section id="pricing" className="maglo-mkt__cta-band">
          <div className="maglo-mkt__cta-inner">
            <div>
              <p className="maglo-mkt__eyebrow maglo-mkt__eyebrow--on-dark">Free to start</p>
              <h2>Try Khatario on your next bill — not on a demo script</h2>
              <p>
                Unlimited GST bills on Free. Upgrade when you need more branches, staff roles or
                WhatsApp automation.
              </p>
            </div>
            <div className="maglo-mkt__cta-actions">
              <Link href="/signup" className="maglo-mkt__btn maglo-mkt__btn--lime">
                Start Billing trial
                <ArrowRight size={16} aria-hidden />
              </Link>
              <Link href="/#pricing" className="maglo-mkt__btn maglo-mkt__btn--on-dark-ghost">
                See live pricing
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="maglo-mkt__footer">
        <span>© {new Date().getFullYear()} Khatario</span>
        <span>Preview only — Maglo visual language for evaluation</span>
      </footer>
    </div>
  );
}

function KpiCard({
  title,
  label,
  dark,
}: {
  title: string;
  label: string;
  dark?: boolean;
}) {
  return (
    <article className={`maglo-mkt__kpi${dark ? ' maglo-mkt__kpi--dark' : ''}`}>
      <p className="maglo-mkt__kpi-value">{title}</p>
      <p className="maglo-mkt__kpi-label">{label}</p>
    </article>
  );
}

function MagloDashboardMock() {
  return (
    <div className="maglo-dash">
      <aside className="maglo-dash__side">
        <div className="maglo-dash__brand">
          <span className="maglo-mkt__logo-mark maglo-mkt__logo-mark--sm" />
          Khatario
        </div>
        <ul>
          <li className="is-active">Dashboard</li>
          <li>Invoices</li>
          <li>Parties</li>
          <li>Inventory</li>
          <li>Reports</li>
          <li>Settings</li>
        </ul>
      </aside>
      <div className="maglo-dash__main">
        <header className="maglo-dash__top">
          <div>
            <p className="maglo-dash__hello">Good morning</p>
            <h3>Shop overview</h3>
          </div>
          <button type="button" className="maglo-dash__pill">
            This month
          </button>
        </header>

        <div className="maglo-dash__stats">
          <div className="maglo-dash__stat maglo-dash__stat--dark">
            <span>Today&apos;s sales</span>
            <strong>₹1,24,580</strong>
          </div>
          <div className="maglo-dash__stat">
            <span>Outstanding</span>
            <strong>₹48,220</strong>
          </div>
          <div className="maglo-dash__stat">
            <span>Stock value</span>
            <strong>₹6,12,400</strong>
          </div>
        </div>

        <div className="maglo-dash__panels">
          <div className="maglo-dash__chart">
            <div className="maglo-dash__chart-head">
              <span>Working capital</span>
              <span className="maglo-dash__legend">
                <i className="is-income" /> Income <i className="is-expense" /> Expenses
              </span>
            </div>
            <svg viewBox="0 0 320 120" className="maglo-dash__svg" aria-hidden>
              <path
                d="M0 90 C40 88, 60 70, 90 72 S140 40, 170 48 S230 20, 260 28 S300 10, 320 18"
                fill="none"
                stroke="#9BE15D"
                strokeWidth="3"
              />
              <path
                d="M0 100 C50 95, 80 85, 110 88 S160 70, 190 78 S250 60, 280 68 S310 55, 320 58"
                fill="none"
                stroke="#F5C542"
                strokeWidth="3"
              />
            </svg>
          </div>
          <div className="maglo-dash__list">
            <div className="maglo-dash__chart-head">
              <span>Recent invoices</span>
              <span className="maglo-dash__muted">Today</span>
            </div>
            {[
              { party: 'Sharma Traders', amt: '₹12,450', status: 'Paid' },
              { party: 'City Kirana', amt: '₹3,280', status: 'Due' },
              { party: 'Mehta Electricals', amt: '₹18,900', status: 'Paid' },
              { party: 'Green Leaf Cafe', amt: '₹2,140', status: 'Partial' },
            ].map((row) => (
              <div key={row.party} className="maglo-dash__row">
                <div>
                  <strong>{row.party}</strong>
                  <span>{row.status}</span>
                </div>
                <em>{row.amt}</em>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
