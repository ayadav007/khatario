import type { EngineSectionProps } from '../registry';
import { withDefaults } from './shared';

/** Empty height; the phone height applies from the phone width of the store container. */
export function Spacer({ id, section }: EngineSectionProps) {
  const v = withDefaults(section);
  const clamp = (n: unknown, d: number) => (typeof n === 'number' && Number.isFinite(n) ? Math.min(160, Math.max(0, n)) : d);
  const height = clamp(v.height, 48);
  const mobile = clamp(v.height_mobile, 32);
  const cls = `eng-spacer-${id.replace(/[^a-z0-9_-]/gi, '')}`;
  return (
    <div className={cls} aria-hidden="true">
      <style>{`.${cls}{height:${height}px}@container store (max-width: 640px){.${cls}{height:${mobile}px}}`}</style>
    </div>
  );
}
