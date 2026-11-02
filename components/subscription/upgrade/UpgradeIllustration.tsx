import type { ReactNode } from 'react';
import type { UpgradeArtObject, UpgradeBadge, UpgradeChip, UpgradeCopy, UpgradeIcon } from '@/lib/upgrade/upgrade-copy';

const ORANGE = '#F58220';
const GREEN = '#032B23';
const CREAM = '#F8F3E9';
const PEACH = '#feecde';
const LIGHT_ORANGE = '#fcd7b8';
const LINE = '#eadfd2';

/** Main object, drawn in a 120×70 box around (60, 38); the badge sits at (82, 54). */
const OBJECTS: Record<UpgradeArtObject, ReactNode> = {
  bill: (
    <>
      <rect x="40" y="10" width="40" height="52" rx="5" fill="#fff" />
      <rect x="46" y="17" width="18" height="4" rx="2" fill={GREEN} />
      <rect x="46" y="26" width="28" height="3" rx="1.5" fill={LINE} />
      <rect x="46" y="33" width="24" height="3" rx="1.5" fill={LINE} />
      <rect x="46" y="40" width="28" height="3" rx="1.5" fill={LINE} />
      <rect x="58" y="50" width="16" height="4" rx="2" fill={ORANGE} />
    </>
  ),
  users: (
    <>
      <circle cx="50" cy="28" r="9" fill="#fff" />
      <rect x="36" y="40" width="28" height="20" rx="10" fill="#fff" />
      <circle cx="72" cy="30" r="7" fill="#fef6ef" stroke="#d9c6b0" strokeDasharray="2 2" />
      <rect x="61" y="40" width="22" height="16" rx="8" fill="#fef6ef" stroke="#d9c6b0" strokeDasharray="2 2" />
    </>
  ),
  chat: (
    <>
      <rect x="34" y="14" width="46" height="30" rx="8" fill="#fff" />
      <path d="M44 44l-4 9 11-9z" fill="#fff" />
      <rect x="41" y="22" width="26" height="3.5" rx="1.75" fill={GREEN} />
      <rect x="41" y="30" width="32" height="3" rx="1.5" fill={LINE} />
      <rect x="56" y="38" width="30" height="20" rx="7" fill="#1f9d6a" />
      <rect x="61" y="45" width="18" height="3" rx="1.5" fill="#fff" />
    </>
  ),
  cal: (
    <>
      <rect x="38" y="14" width="44" height="46" rx="6" fill="#fff" />
      <rect x="38" y="14" width="44" height="11" rx="6" fill={ORANGE} />
      <rect x="38" y="20" width="44" height="5" fill={ORANGE} />
      {[
        [44, 31],
        [53, 31],
        [62, 31],
        [44, 40],
        [53, 40],
      ].map(([x, y]) => (
        <rect key={`${x}-${y}`} x={x} y={y} width="6" height="6" rx="1.5" fill={LINE} />
      ))}
      <rect x="62" y="40" width="6" height="6" rx="1.5" fill={ORANGE} />
    </>
  ),
  laptop: (
    <>
      <rect x="30" y="16" width="56" height="36" rx="4" fill="#fff" />
      <rect x="34" y="20" width="48" height="28" rx="2" fill="#efe6da" />
      <rect x="24" y="52" width="68" height="5" rx="2.5" fill="#d9c6b0" />
      <rect x="80" y="30" width="18" height="32" rx="4" fill={ORANGE} />
      <rect x="82.5" y="34" width="13" height="24" rx="2" fill="#fff" />
    </>
  ),
};

const BADGES: Record<UpgradeBadge, ReactNode> = {
  lock: (
    <>
      <rect x="77.5" y="53" width="9" height="7" rx="1.5" fill={ORANGE} />
      <path d="M79.5 53v-2a2.5 2.5 0 0 1 5 0v2" fill="none" stroke={ORANGE} strokeWidth="1.6" />
    </>
  ),
  full: (
    <>
      <path d="M77 57a5 5 0 0 1 10 0" fill="none" stroke={ORANGE} strokeWidth="2" />
      <path d="M82 57l3-3" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
    </>
  ),
  plus: <path d="M82 50v8M78 54h8" stroke={ORANGE} strokeWidth="2.2" strokeLinecap="round" />,
  clock: (
    <>
      <circle cx="82" cy="54" r="5" fill="none" stroke={ORANGE} strokeWidth="1.6" />
      <path d="M82 51.5V54l2 1.5" fill="none" stroke={ORANGE} strokeWidth="1.6" strokeLinecap="round" />
    </>
  ),
};

/** White glyphs inside a 23×23 orange tile. */
const ICONS: Record<UpgradeIcon, ReactNode> = {
  chart: (
    <>
      <rect x="6" y="13" width="3" height="5" rx="1" fill="#fff" />
      <rect x="10" y="10" width="3" height="8" rx="1" fill="#fff" />
      <rect x="14" y="6" width="3" height="12" rx="1" fill="#fff" />
    </>
  ),
  rupee: (
    <text x="11.5" y="16.5" textAnchor="middle" fontSize="13" fontWeight="500" fill="#fff" fontFamily="sans-serif">
      ₹
    </text>
  ),
  users: (
    <>
      <circle cx="11.5" cy="8.5" r="3" fill="#fff" />
      <rect x="6" y="12.5" width="11" height="6" rx="3" fill="#fff" />
    </>
  ),
  lock: (
    <>
      <rect x="7" y="10" width="9" height="7" rx="1.5" fill="#fff" />
      <path d="M9 10V8a2.5 2.5 0 0 1 5 0v2" fill="none" stroke="#fff" strokeWidth="1.6" />
    </>
  ),
  chat: (
    <>
      <rect x="5" y="6" width="13" height="9" rx="3" fill="#fff" />
      <path d="M8 15l-1 3 4-3z" fill="#fff" />
    </>
  ),
  bolt: <path d="M13 4l-6 9h4l-1 6 6-9h-4z" fill="#fff" />,
  clock: (
    <>
      <circle cx="11.5" cy="11.5" r="6" fill="none" stroke="#fff" strokeWidth="1.8" />
      <path d="M11.5 8.5v3l2 1.5" fill="none" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
    </>
  ),
  check: <path d="M7 12l3 3 6-6" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />,
  phone: <rect x="8" y="5" width="7.5" height="13" rx="1.8" fill="#fff" />,
  box: (
    <>
      <rect x="6" y="9" width="11" height="9" rx="1" fill="#fff" />
      <path d="M6 9l5.5-3 5.5 3" fill="none" stroke="#fff" strokeWidth="1.5" />
    </>
  ),
};

function Tile({ x, y, icon, scale = 1 }: { x: number; y: number; icon: UpgradeIcon; scale?: number }) {
  return (
    <g transform={`translate(${x},${y}) scale(${scale})`}>
      <rect width="23" height="23" rx="7" fill={ORANGE} />
      {ICONS[icon]}
    </g>
  );
}

function Chip({ x, y, chip }: { x: number; y: number; chip: UpgradeChip }) {
  return (
    <g transform={`translate(${x},${y})`}>
      <rect width="118" height="38" rx="11" fill="#fff" stroke="#f6c9a2" strokeWidth="1.2" />
      <Tile x={8} y={7.5} icon={chip.icon} />
      <text x="38" y="17" fontSize="11" fontWeight="500" fill={GREEN} fontFamily="sans-serif">
        {chip.title.length > 15 ? `${chip.title.slice(0, 14)}…` : chip.title}
      </text>
      <text x="38" y="30" fontSize="9.5" fill="#7a6c5d" fontFamily="sans-serif">
        {chip.subtitle.length > 17 ? `${chip.subtitle.slice(0, 16)}…` : chip.subtitle}
      </text>
    </g>
  );
}

function RoundTile({ cx, cy, r, icon }: { cx: number; cy: number; r: number; icon: UpgradeIcon }) {
  const s = r / 14;
  return (
    <g>
      <circle cx={cx} cy={cy} r={r} fill={ORANGE} />
      <g transform={`translate(${cx - 11.5 * s},${cy - 11.5 * s}) scale(${s})`}>{ICONS[icon]}</g>
    </g>
  );
}

/**
 * Header band of the upgrade popup: dashed orange orbit and floating chips like the home page
 * hero, with the version's object and badge in the middle (docs/plan/UNIFIED_UPGRADE_POPUP.md).
 */
export function UpgradeIllustration({ copy, className }: { copy: UpgradeCopy; className?: string }) {
  return (
    <svg viewBox="0 0 380 158" className={className} role="img" aria-label={copy.tag}>
      <rect width="380" height="158" fill={CREAM} />
      <ellipse cx="190" cy="84" rx="150" ry="58" fill="none" stroke={ORANGE} strokeWidth="1.3" strokeDasharray="3 5" opacity="0.75" />
      <circle cx="190" cy="84" r="54" fill={PEACH} />
      <circle cx="190" cy="84" r="40" fill={LIGHT_ORANGE} opacity="0.55" />
      <g transform="translate(100,28) scale(1.5)">
        {OBJECTS[copy.object]}
        <circle cx="82" cy="54" r="11" fill={GREEN} />
        {BADGES[copy.badge]}
      </g>
      <Chip x={14} y={18} chip={copy.chips[0]} />
      <Chip x={248} y={100} chip={copy.chips[1]} />
      <RoundTile cx={330} cy={30} r={15} icon={copy.tiles[0]} />
      <RoundTile cx={46} cy={124} r={12} icon={copy.tiles[1]} />
      <circle cx="292" cy="62" r="2.5" fill={ORANGE} />
      <circle cx="96" cy="78" r="2" fill={GREEN} opacity="0.5" />
      <circle cx="246" cy="22" r="2" fill={GREEN} opacity="0.5" />
      <path d="M150 132l2 4 4 2-4 2-2 4-2-4-4-2 4-2z" fill={ORANGE} opacity="0.8" />
    </svg>
  );
}
