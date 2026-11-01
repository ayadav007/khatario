import type { EngineSectionProps } from '../registry';
import { EngineCountdown } from './EngineCountdown';
import { str, withDefaults } from './shared';

export function Countdown({ section }: EngineSectionProps) {
  const v = withDefaults(section);
  const endsAt = str(v.ends_at).trim();
  if (!endsAt || !Number.isFinite(Date.parse(endsAt))) return null;
  return (
    <EngineCountdown
      heading={str(v.heading)}
      endsAt={endsAt}
      link={str(v.link)}
      buttonLabel={str(v.button_label)}
      hideWhenOver={v.hide_when_over !== false}
    />
  );
}
