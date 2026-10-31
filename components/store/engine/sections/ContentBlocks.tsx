import type { ReactNode } from 'react';
import type { ContentBlock } from '@/lib/store/engine/content-blocks-map';
import { EngineCtaButton } from '../EngineViews';

type ButtonBlock = Extract<ContentBlock, { type: 'button' }>;

function renderBlock(b: Exclude<ContentBlock, { type: 'button' }>): ReactNode {
  switch (b.type) {
    case 'eyebrow':
      return (
        <p key={b.id} className="eng-cb eng-cb-eyebrow eyebrow">
          {b.text}
        </p>
      );
    case 'heading':
      return (
        <h2 key={b.id} className={`eng-cb eng-cb-heading eng-cb-size-${b.size}`}>
          {b.text}
        </h2>
      );
    case 'text':
      // `html` was re-sanitised by blockSettings before it got here.
      return <div key={b.id} className="eng-cb eng-cb-text eng-rt" dangerouslySetInnerHTML={{ __html: b.html }} />;
    case 'quote':
      return (
        <blockquote key={b.id} className="eng-cb eng-cb-quote">
          <p>{b.text}</p>
          {b.attribution ? <footer>{b.attribution}</footer> : null}
        </blockquote>
      );
    case 'checklist_item':
      return (
        <div key={b.id} className="eng-cb eng-cb-check">
          <span className="eng-cb-tick" aria-hidden="true">
            ✓
          </span>
          <div>
            <b>{b.title}</b>
            {b.text ? <span>{b.text}</span> : null}
          </div>
        </div>
      );
    case 'highlight_card':
      return (
        <aside key={b.id} className="eng-cb eng-cb-highlight">
          {b.eyebrow ? <p className="eyebrow">{b.eyebrow}</p> : null}
          {b.title ? <b>{b.title}</b> : null}
          {b.text ? <span>{b.text}</span> : null}
        </aside>
      );
  }
}

/** A section's content blocks, in order. Consecutive buttons sit in one row. */
export function ContentBlocks({ blocks }: { blocks: ContentBlock[] }) {
  const out: ReactNode[] = [];
  let row: ButtonBlock[] = [];
  const flush = () => {
    if (!row.length) return;
    out.push(
      <div key={`buttons-${row[0].id}`} className="eng-cb eng-cb-button eng-cb-buttons">
        {row.map((b) => (
          <EngineCtaButton key={b.id} label={b.label} link={b.link} style={b.style} />
        ))}
      </div>,
    );
    row = [];
  };
  for (const b of blocks) {
    if (b.type === 'button') {
      row.push(b);
      continue;
    }
    flush();
    out.push(renderBlock(b));
  }
  flush();
  return <>{out}</>;
}
