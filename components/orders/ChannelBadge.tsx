import { clsx } from 'clsx';
import { Globe, MessageCircle, Store, FileText, ClipboardList } from 'lucide-react';
import { CHANNEL_LABEL, isInvoiceChannel, type InvoiceChannel } from '@/lib/invoices/channel';

const STYLE: Record<InvoiceChannel, { icon: typeof Globe; cls: string }> = {
  online_store: { icon: Globe, cls: 'bg-sky-50 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300' },
  whatsapp: { icon: MessageCircle, cls: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' },
  counter: { icon: Store, cls: 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' },
  sales_order: { icon: ClipboardList, cls: 'bg-violet-50 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300' },
  manual: { icon: FileText, cls: 'bg-slate-100 text-slate-600 dark:bg-slate-700/60 dark:text-slate-300' },
};

export function ChannelBadge({ channel, className }: { channel: unknown; className?: string }) {
  const c: InvoiceChannel = isInvoiceChannel(channel) ? channel : 'manual';
  const { icon: Icon, cls } = STYLE[c];
  return (
    <span
      className={clsx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium', cls, className)}
      title={`Source: ${CHANNEL_LABEL[c]}`}
    >
      <Icon className="h-3 w-3" aria-hidden />
      {CHANNEL_LABEL[c]}
    </span>
  );
}
