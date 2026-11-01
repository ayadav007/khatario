import type { EngineSectionProps } from '../registry';
import { EngineNewsletterForm } from './EngineNewsletterForm';
import { str, withDefaults } from './shared';

export function Newsletter({ section, store }: EngineSectionProps) {
  const v = withDefaults(section);
  const heading = str(v.heading);
  const text = str(v.text);
  return (
    <div className="eng-news">
      {heading ? <h2>{heading}</h2> : null}
      {text ? <p>{text}</p> : null}
      <EngineNewsletterForm
        subdomain={store.store_subdomain}
        buttonLabel={str(v.button_label) || 'Subscribe'}
        successText={str(v.success_text) || "Thanks, you're on the list."}
      />
    </div>
  );
}
