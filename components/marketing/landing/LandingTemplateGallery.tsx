'use client';

import { clsx } from 'clsx';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { ArrowRight, ChevronLeft, ChevronRight, X } from 'lucide-react';
import {
  LANDING_INTRO_SUBTEXT,
  LANDING_PAGE_GUTTER,
  LANDING_SECTION_INTRO,
} from '@/lib/marketing-layout';
import { useLandingProduct } from '@/components/marketing/landing/LandingProductContext';
import { withDefaults } from '@/lib/marketing-builder/merge';

type Group = 'invoice' | 'document' | 'thermal';

/** Images come from `scripts/capture-marketing-screens.mjs` (TEMPLATE_IDS there must match). */
const TEMPLATES: { id: string; name: string; group: Group; blurb: string }[] = [
  { id: 'gst_standard', name: 'GST Standard', group: 'invoice', blurb: 'The everyday tax invoice most CAs expect.' },
  { id: 'modern', name: 'Modern', group: 'invoice', blurb: 'Bold header band in your brand colour.' },
  { id: 'tally_style', name: 'Tally Style', group: 'invoice', blurb: 'Familiar boxed layout with an acknowledgement slip.' },
  { id: 'classic', name: 'Classic', group: 'invoice', blurb: 'Traditional ruled layout.' },
  { id: 'elegant', name: 'Elegant', group: 'invoice', blurb: 'Quiet typography for premium shops.' },
  { id: 'minimal', name: 'Minimal', group: 'invoice', blurb: 'Just the essentials, lots of white space.' },
  { id: 'business_pro', name: 'Business Pro', group: 'invoice', blurb: 'Detailed layout for B2B customers.' },
  { id: 'gst_detailed', name: 'GST Detailed', group: 'invoice', blurb: 'HSN-wise tax summary on the bill.' },
  { id: 'export_invoice', name: 'Export Invoice', group: 'invoice', blurb: 'Ports, Incoterms and LUT declaration.' },
  { id: 'composition_standard', name: 'Bill of Supply', group: 'document', blurb: 'For composition dealers — no tax charged.' },
  { id: 'credit_standard', name: 'Credit Note', group: 'document', blurb: 'Returns and price corrections.' },
  { id: 'challan_standard', name: 'Delivery Challan', group: 'document', blurb: 'Goods in transit under GST Rule 55.' },
  { id: 'thermal_80mm', name: 'Thermal 80mm', group: 'thermal', blurb: 'Standard counter receipt printer.' },
  { id: 'thermal_58mm', name: 'Thermal 58mm', group: 'thermal', blurb: 'Compact and Bluetooth printers.' },
];

const FILTERS: { id: Group | 'all'; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'invoice', label: 'Tax invoices' },
  { id: 'document', label: 'Challans & notes' },
  { id: 'thermal', label: 'Thermal receipts' },
];

export type LandingTemplateGalleryContent = {
  heading: string;
  subtext: string;
  modalNote: string;
  modalCta: string;
};

export const LANDING_TEMPLATE_GALLERY_DEFAULTS: LandingTemplateGalleryContent = {
  heading: '20+ ready-made GST templates',
  subtext: 'Pick a look, add your logo and colours, and every bill, challan and receipt comes out the same way.',
  modalNote: 'Sample data shown. Your logo, colours and bank details go here.',
  modalCta: 'Start free with this template',
};

export function LandingTemplateGallery(props: Partial<LandingTemplateGalleryContent> = {}) {
  const c = withDefaults(LANDING_TEMPLATE_GALLERY_DEFAULTS, props);
  const router = useRouter();
  const { signupHref } = useLandingProduct();
  const [filter, setFilter] = useState<Group | 'all'>('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const rowRef = useRef<HTMLDivElement>(null);

  const visible = TEMPLATES.filter((t) => filter === 'all' || t.group === filter);
  const open = TEMPLATES.find((t) => t.id === openId) ?? null;

  useEffect(() => {
    rowRef.current?.scrollTo({ left: 0 });
  }, [filter]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenId(null);
    };
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const scrollBy = (dir: 1 | -1) => {
    const row = rowRef.current;
    if (row) row.scrollBy({ left: dir * row.clientWidth * 0.8, behavior: 'smooth' });
  };

  return (
    <section id="templates" className="scroll-mt-24 overflow-hidden bg-white py-20 2xl:py-24">
      <div className={LANDING_PAGE_GUTTER}>
        <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <div className={LANDING_SECTION_INTRO}>
            <h2 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl 2xl:text-5xl">
              {c.heading}
            </h2>
            {c.subtext && <p className={LANDING_INTRO_SUBTEXT}>{c.subtext}</p>}
          </div>
          <div className="hidden shrink-0 gap-2 md:flex">
            <button
              type="button"
              onClick={() => scrollBy(-1)}
              className="rounded-full border border-slate-200 bg-white p-2.5 text-slate-700 shadow-sm transition hover:bg-slate-50"
              aria-label="Scroll templates left"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={() => scrollBy(1)}
              className="rounded-full border border-slate-200 bg-white p-2.5 text-slate-700 shadow-sm transition hover:bg-slate-50"
              aria-label="Scroll templates right"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="mt-8 flex flex-wrap gap-2 max-md:justify-center" role="tablist" aria-label="Template type">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              role="tab"
              aria-selected={filter === f.id}
              onClick={() => setFilter(f.id)}
              className={clsx(
                'rounded-full px-4 py-2 text-sm font-semibold transition',
                filter === f.id
                  ? 'bg-slate-900 text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div
          ref={rowRef}
          className="-mx-4 mt-8 flex snap-x snap-mandatory gap-5 overflow-x-auto scroll-px-4 px-4 pb-4 [scrollbar-width:thin] sm:-mx-6 sm:scroll-px-6 sm:px-6 md:-mx-8 md:scroll-px-8 md:px-8 lg:-mx-10 lg:scroll-px-10 lg:px-10"
        >
          {visible.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setOpenId(t.id)}
              className="group w-52 shrink-0 snap-start text-left sm:w-60 2xl:w-64"
            >
              <div className="relative aspect-[794/1123] overflow-hidden rounded-xl border border-slate-200 bg-slate-50 shadow-sm transition duration-300 group-hover:-translate-y-1 group-hover:shadow-lg">
                <Image
                  src={`/marketing/templates/${t.id}.png`}
                  alt={`${t.name} invoice template preview`}
                  fill
                  sizes="256px"
                  className={t.group === 'thermal' ? 'object-contain p-4' : 'object-cover object-top'}
                />
              </div>
              <p className="mt-3 font-semibold text-slate-900">{t.name}</p>
              <p className="mt-0.5 text-sm text-slate-600">{t.blurb}</p>
            </button>
          ))}
        </div>
      </div>

      {open && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-8">
          <div
            className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            onClick={() => setOpenId(null)}
            role="presentation"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`${open.name} template`}
            className="relative flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
          >
            <div className="flex items-center justify-between gap-4 border-b border-slate-200 px-5 py-4">
              <div>
                <p className="text-lg font-bold text-slate-900">{open.name}</p>
                <p className="text-sm text-slate-600">{open.blurb}</p>
              </div>
              <button
                type="button"
                onClick={() => setOpenId(null)}
                className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                aria-label="Close preview"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto bg-slate-100 p-4 sm:p-6">
              <Image
                src={`/marketing/templates/${open.id}.png`}
                alt={`${open.name} invoice template, full preview`}
                width={open.group === 'thermal' ? 340 : 794}
                height={open.group === 'thermal' ? 700 : 1123}
                sizes="(min-width: 768px) 720px, 100vw"
                className="mx-auto h-auto w-full max-w-full rounded-lg bg-white shadow-md data-[thermal=true]:max-w-sm"
                data-thermal={open.group === 'thermal'}
              />
            </div>
            <div className="flex flex-col gap-3 border-t border-slate-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-slate-600">{c.modalNote}</p>
              <button
                type="button"
                onClick={() => router.push(signupHref)}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary-600 px-5 py-3 text-sm font-semibold text-white hover:bg-primary-700"
              >
                {c.modalCta}
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
