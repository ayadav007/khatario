import type { LucideIcon } from 'lucide-react';
import {
  ArrowLeftRight,
  BarChart3,
  Barcode,
  Building2,
  Layers,
  Link2,
  RefreshCw,
  Scale,
} from 'lucide-react';
import { LANDING_INTRO_SUBTEXT, LANDING_MAX_WIDE, LANDING_PAGE_GUTTER, LANDING_SECTION_INTRO } from '@/lib/marketing-layout';

const FEATURES: { id: string; icon: LucideIcon; title: string; body: string }[] = [
  {
    id: 'txn-stock',
    icon: RefreshCw,
    title: 'Stock updates with every bill and purchase',
    body: 'Sales, purchases, and returns land in one place — quantities stay in sync with the voucher, not a delayed import.',
  },
  {
    id: 'branch-warehouse',
    icon: Building2,
    title: 'Branches and warehouses in one picture',
    body: 'Run more than one shop or storeroom and still see who holds what, without parallel notebooks.',
  },
  {
    id: 'batch-serial',
    icon: Layers,
    title: 'Batches, expiry, and serials when you need them',
    body: 'Track lots and dates for FMCG and pharma-style items, or serials for high-value pieces — turned on per product.',
  },
  {
    id: 'valuation',
    icon: Scale,
    title: 'Costing: FIFO, LIFO, weighted average, and more',
    body: 'Value stock using methods that match how you buy and sell — so margins and reports stay explainable.',
  },
  {
    id: 'adjust-transfer',
    icon: ArrowLeftRight,
    title: 'Adjustments and transfers you can trust',
    body: 'Fix stock after a count, record damage or theft, or move goods between locations with a clear trail.',
  },
  {
    id: 'books',
    icon: Link2,
    title: 'Inventory talks to your accounts',
    body: 'Closing stock and cost of goods connect to how you run the business — fewer surprises at month-end.',
  },
  {
    id: 'reports',
    icon: BarChart3,
    title: 'Reports: summary, value, movement, low stock, expiry',
    body: 'See what sold, what moved, what is running low, and what is nearing expiry — in plain lists you can act on.',
  },
  {
    id: 'barcode',
    icon: Barcode,
    title: 'Barcodes on items and labels',
    body: 'Store barcodes on products and variants for faster lookup at billing — less typing at a busy counter.',
  },
];

export function InventoryFeaturesSection() {
  return (
    <section className="scroll-mt-24 border-t border-slate-200/80 bg-white py-16 2xl:py-24" aria-labelledby="inventory-features-heading">
      <div className={LANDING_PAGE_GUTTER}>
        <div className={LANDING_SECTION_INTRO}>
          <h2 id="inventory-features-heading" className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl 2xl:text-5xl">
            How Khatario keeps stock under control
          </h2>
          <p className={LANDING_INTRO_SUBTEXT}>
            Retail inventory systems only help if they match real life: bills, godowns, returns, and reports in one flow.
          </p>
        </div>
        <div
          className={`mt-12 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 lg:gap-8 2xl:mt-14 2xl:gap-10 ${LANDING_MAX_WIDE}`}
        >
          {FEATURES.map(({ id, icon: Icon, title, body }) => (
            <article
              key={id}
              id={id}
              className="scroll-mt-24 rounded-2xl border border-slate-200 bg-slate-50/40 p-6 shadow-sm transition hover:shadow-md 2xl:p-8"
            >
              <Icon className="h-10 w-10 text-slate-700 2xl:h-12 2xl:w-12" strokeWidth={1.5} aria-hidden />
              <h3 className="mt-4 text-lg font-bold text-slate-900 2xl:text-xl">{title}</h3>
              <p className="mt-2 text-slate-600 2xl:text-lg 2xl:leading-relaxed">{body}</p>
            </article>
          ))}
        </div>
        <p className="mt-10 text-sm text-slate-500 2xl:mt-12 2xl:text-base">
          <span className="font-medium text-slate-700">Inventory management software</span> should shrink work at the
          counter — not add another job after closing time.
        </p>
      </div>
    </section>
  );
}
