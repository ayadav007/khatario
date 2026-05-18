import Link from 'next/link';
import { FileText } from 'lucide-react';
import { LANDING_PAGE_GUTTER } from '@/lib/marketing-layout';

export function LandingFooter() {
  return (
    <footer className="bg-slate-950 py-12 text-slate-400">
      <div className={`${LANDING_PAGE_GUTTER} w-full text-center sm:text-left`}>
        <Link href="/" className="mb-4 inline-flex w-full items-center justify-center gap-2 text-slate-100 sm:justify-start">
          <FileText className="h-6 w-6 text-slate-300" aria-hidden />
          <span className="text-xl font-bold">Khatario</span>
        </Link>
        <p className="text-sm">© 2026 Khatario. All rights reserved.</p>
        <p className="mt-2 text-xs text-slate-500">Made for Indian businesses — billing, stock, and trust at the counter.</p>
        <nav className="mt-6 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-sm sm:justify-start" aria-label="Legal and help">
          <Link href="/privacy" className="text-slate-300 hover:text-white">
            Privacy
          </Link>
          <span className="text-slate-600" aria-hidden>
            ·
          </span>
          <Link href="/terms" className="text-slate-300 hover:text-white">
            Terms
          </Link>
          <span className="text-slate-600" aria-hidden>
            ·
          </span>
          <Link href="/guides" className="text-slate-300 hover:text-white">
            Guides
          </Link>
          <span className="text-slate-600" aria-hidden>
            ·
          </span>
          <Link href="/book-demo" className="text-slate-300 hover:text-white">
            Book a demo
          </Link>
        </nav>
      </div>
    </footer>
  );
}
