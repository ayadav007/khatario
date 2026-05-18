import { HowToImage } from './HowToImage';
import type { HowToSection } from '@/lib/help/how-to-articles';
import { Lightbulb } from 'lucide-react';

type Props = {
  sections: HowToSection[];
};

export function HowToSectionBlocks({ sections }: Props) {
  return (
    <div className="prose prose-neutral max-w-none text-slate-800 dark:prose-invert dark:text-slate-200">
      {sections.map((section, i) => {
        switch (section.type) {
          case 'h2':
            return (
              <h2
                key={i}
                className="not-prose mb-3 mt-8 font-serif text-xl font-bold tracking-tight text-text-primary first:mt-0 sm:text-2xl"
              >
                {section.text}
              </h2>
            );
          case 'p':
            return (
              <p key={i} className="not-prose mb-5 text-[17px] leading-[1.75] text-text-secondary">
                {section.text}
              </p>
            );
          case 'ol':
            return (
              <ol key={i} className="not-prose mb-4 list-decimal space-y-2 pl-6 text-text-secondary">
                {section.items.map((item, j) => (
                  <li key={j} className="leading-relaxed">
                    {item}
                  </li>
                ))}
              </ol>
            );
          case 'ul':
            return (
              <ul key={i} className="not-prose mb-4 list-disc space-y-2 pl-6 text-text-secondary">
                {section.items.map((item, j) => (
                  <li key={j} className="leading-relaxed">
                    {item}
                  </li>
                ))}
              </ul>
            );
          case 'tip':
            return (
              <div
                key={i}
                className="not-prose my-5 flex gap-3 rounded-lg border border-amber-200/80 bg-amber-50/90 px-4 py-3 dark:border-amber-800/50 dark:bg-amber-950/40"
                role="note"
              >
                <Lightbulb className="h-5 w-5 flex-shrink-0 text-amber-600 dark:text-amber-400" />
                <p className="text-sm leading-relaxed text-amber-950 dark:text-amber-100/95">{section.text}</p>
              </div>
            );
          case 'image':
            return <HowToImage key={i} src={section.src} alt={section.alt} caption={section.caption} />;
          default:
            return null;
        }
      })}
    </div>
  );
}
