'use client';

import Link from 'next/link';
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { BLOCKING_GAPS, REVIEW_GAP_LABELS, type ReviewItem } from '@/lib/items/scan-add-review';
import type { ScanAddSessionEntry, ScanAddSessionSummary } from '@/lib/items/scan-add-session';

type Filter = 'all' | 'details' | 'failed';

interface Props {
  summary: ScanAddSessionSummary;
  entries: ScanAddSessionEntry[];
  items: ReviewItem[];
  loading: boolean;
  filter: Filter;
  retrying: string | null;
  onFilter: (f: Filter) => void;
  onRefresh: () => void;
  onRetry: (entry: ScanAddSessionEntry) => void;
  onEdit: (entry: ScanAddSessionEntry) => void;
  onDiscard: (key: string) => void;
  onFinish: () => void;
  onBack: () => void;
}

function Tile({ label, value, tone }: { label: string; value: number; tone?: 'warn' | 'bad' }) {
  const color = tone === 'bad' && value > 0 ? 'text-red-600' : tone === 'warn' && value > 0 ? 'text-amber-600' : 'text-text-primary';
  return (
    <div className="rounded-lg border border-border px-3 py-2">
      <div className={`text-xl font-semibold tabular-nums ${color}`}>{value}</div>
      <div className="text-xs text-text-secondary">{label}</div>
    </div>
  );
}

/**
 * End of a Scan & Add session: what was done, which items still need details, and saves that
 * did not go through. Item details are read fresh, so fixes made on the item page show here.
 */
export function ScanAddReview(p: Props) {
  const { summary, items } = p;
  const failed = p.entries.filter((e) => e.outcome === 'failed');
  const needDetails = items.filter((i) => i.gaps.some((g) => BLOCKING_GAPS.includes(g)));
  const shown = p.filter === 'details' ? needDetails : p.filter === 'failed' ? [] : items;

  return (
    <div className="space-y-4">
      <Card className="space-y-3 p-4">
        <div className="flex items-center justify-between gap-2">
          <p className="font-semibold">Session review</p>
          <Button size="sm" variant="ghost" onClick={p.onRefresh} disabled={p.loading}>
            {p.loading ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1 h-4 w-4" />}
            Refresh
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Tile label="Scanned" value={summary.scanned} />
          <Tile label="New items" value={summary.created} />
          <Tile label="Already in shop" value={summary.existing} />
          <Tile label="With stock entered" value={summary.withStock} />
          <Tile label="Stock added" value={summary.stockAdded} />
          <Tile label="Sizes added" value={summary.sizesAdded} />
          <Tile label="Need details" value={summary.needDetails} tone="warn" />
          <Tile label="Not saved" value={summary.failed} tone="bad" />
        </div>
        <p className="text-xs text-text-secondary">
          New items: {summary.fromDatabase} from a product database, {summary.fromPhoto} read from photos, {summary.typedByHand} typed in.
          {summary.barcodeConflicts > 0 ? ` ${summary.barcodeConflicts} refused because the barcode is on another item.` : ''}
        </p>
        <div className="flex flex-wrap gap-2">
          {(
            [
              ['all', `All items (${items.length})`],
              ['details', `Need details (${needDetails.length})`],
              ['failed', `Not saved (${failed.length})`],
            ] as const
          ).map(([key, label]) => (
            <Button key={key} size="sm" variant={p.filter === key ? 'primary' : 'secondary'} onClick={() => p.onFilter(key)}>
              {label}
            </Button>
          ))}
        </div>
      </Card>

      {p.filter === 'failed' || (p.filter === 'all' && failed.length > 0) ? (
        <Card className="p-4">
          <p className="mb-2 font-semibold">Not saved</p>
          {failed.length === 0 ? (
            <p className="text-sm text-text-secondary">Every product in this session was saved.</p>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {failed.map((e) => (
                <li key={e.key} className="space-y-2 py-2">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
                    <div className="min-w-0">
                      <p className="truncate font-medium">{e.name}</p>
                      <p className="text-xs text-text-secondary">
                        {e.barcode ? `Barcode ${e.barcode} · ` : ''}
                        {e.error}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" onClick={() => p.onRetry(e)} disabled={p.retrying === e.key}>
                      {p.retrying === e.key ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
                      Try again
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => p.onEdit(e)}>
                      Edit
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => p.onDiscard(e.key)}>
                      Discard
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : null}

      {p.filter !== 'failed' ? (
        <Card className="p-4">
          {p.loading && items.length === 0 ? (
            <p className="flex items-center gap-2 text-sm text-text-secondary">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading items…
            </p>
          ) : shown.length === 0 ? (
            <p className="text-sm text-text-secondary">
              {p.filter === 'details' ? 'No item in this session is missing HSN or prices.' : 'No saved items in this session yet.'}
            </p>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {shown.map((i) => (
                <li key={i.id} className="flex items-start justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{i.name}</p>
                    <p className="text-xs text-text-secondary">
                      {i.has_variants ? `${i.variants.length} sizes · ` : ''}
                      Stock {i.has_variants ? i.variants.reduce((s, v) => s + v.current_stock, 0) : i.current_stock}
                      {i.next_expiry ? ` · Expires ${i.next_expiry}` : ''}
                      {i.from_database ? ' · From product database' : ''}
                    </p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {i.gaps.length === 0 ? (
                        <span className="inline-flex items-center gap-1 text-xs text-success">
                          <CheckCircle2 className="h-3 w-3" /> Ready
                        </span>
                      ) : (
                        i.gaps.map((g) => (
                          <span
                            key={g}
                            className={`rounded px-1.5 py-0.5 text-xs ${
                              BLOCKING_GAPS.includes(g) ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-text-secondary'
                            }`}
                          >
                            {REVIEW_GAP_LABELS[g]}
                          </span>
                        ))
                      )}
                    </div>
                  </div>
                  <Link href={`/items/new?edit=${i.id}`} className="shrink-0">
                    <Button size="sm" variant={i.gaps.length ? 'secondary' : 'ghost'}>
                      {i.gaps.length ? 'Fix' : 'Open'}
                    </Button>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button onClick={p.onFinish}>Finish session</Button>
        <Button variant="secondary" onClick={p.onBack}>
          Back to scanning
        </Button>
      </div>
    </div>
  );
}
