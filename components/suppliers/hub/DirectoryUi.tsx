import type { ReactNode } from 'react';
import { clsx } from 'clsx';
import { BadgeCheck, Package } from 'lucide-react';
import { isValidGstin } from '@/lib/tax/gstin';

/**
 * Shared pieces for the Find suppliers list and the supplier profile:
 * logo-or-initials avatar, tinted product tiles, and the GSTIN badge.
 */

/** Dark logo field + light initials, and the matching light tile for product photos. */
const TINTS = [
  { logo: 'bg-[#7A4B1E] text-[#FFF4E5]', tile: 'bg-[#F6EBDD] text-[#6B4E31]', cover: 'bg-[#F3E3CC]' },
  { logo: 'bg-[#1D4E89] text-[#E8F0FB]', tile: 'bg-[#E9EFF8] text-[#1D4E89]', cover: 'bg-[#DCE6F4]' },
  { logo: 'bg-[#0F5C46] text-[#E6F4EE]', tile: 'bg-[#E6F1EC] text-[#0F5C46]', cover: 'bg-[#DDEBE4]' },
  { logo: 'bg-[#6B2D5C] text-[#F8E9F4]', tile: 'bg-[#F4E8F1] text-[#6B2D5C]', cover: 'bg-[#EEDDE9]' },
] as const;

export function supplierTint(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return TINTS[h % TINTS.length];
}

export function initialsOf(name: string): string {
  const words = name
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

export const headingFont = '[font-family:var(--font-dm-sans),var(--font-inter),sans-serif]';

export function SupplierAvatar({
  id,
  name,
  logoUrl,
  className,
}: {
  id: string;
  name: string;
  logoUrl?: string | null;
  className?: string;
}) {
  const tint = supplierTint(id);
  if (logoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={logoUrl}
        alt=""
        className={clsx('shrink-0 rounded-2xl border-[3px] border-white bg-white object-contain', className)}
      />
    );
  }
  return (
    <div
      aria-hidden="true"
      className={clsx(
        'flex shrink-0 items-center justify-center rounded-2xl border-[3px] border-white font-bold',
        headingFont,
        tint.logo,
        className,
      )}
    >
      {initialsOf(name)}
    </div>
  );
}

export function ProductTile({
  seed,
  imageUrl,
  className,
}: {
  seed: string;
  imageUrl?: string | null;
  className?: string;
}) {
  if (imageUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={imageUrl} alt="" loading="lazy" className={clsx('w-full bg-white object-cover', className)} />
    );
  }
  return (
    <div
      aria-hidden="true"
      className={clsx('flex w-full items-center justify-center', supplierTint(seed).tile, className)}
    >
      <Package className="h-7 w-7 opacity-80" strokeWidth={1.6} />
    </div>
  );
}

/**
 * Shown when the GSTIN on file passes the format and checksum test. That is not proof the
 * registration is active, so the label says the number was checked, not that the business was.
 */
export function GstinBadge({ gstin, compact = false }: { gstin: string | null | undefined; compact?: boolean }) {
  if (!gstin || !isValidGstin(gstin)) return null;
  if (compact) {
    return (
      <BadgeCheck
        role="img"
        aria-label="GSTIN checked"
        className="h-[18px] w-[18px] shrink-0 fill-[#0F7A5A] text-white"
      />
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-[#E3F2EB] px-2.5 py-1 font-sans text-[13px] font-semibold text-[#0B5E45]">
      <BadgeCheck aria-hidden="true" className="h-4 w-4 fill-[#0F7A5A] text-white" />
      GSTIN checked
    </span>
  );
}

export function CategoryChip({ children }: { children: ReactNode }) {
  return <span className="rounded-full bg-[#E6EFEB] px-2.5 py-1 text-xs font-medium text-[#1F4A3F]">{children}</span>;
}

export function formatPlace(city: string | null | undefined, state: string | null | undefined): string {
  return [city, state].filter(Boolean).join(', ');
}
