'use client';

import type { FlowNode } from '@/lib/whatsapp/flows/schema';
import { WA_LIMITS } from '@/lib/whatsapp/wa-limits';
import { newNodeId } from './flow-convert';

const field =
  'w-full rounded-md border border-border bg-white px-2 py-1.5 text-xs text-text-primary nodrag nopan nowheel dark:border-border-dark dark:bg-surface-dark';
const label = 'block text-[10px] font-medium text-text-muted';

export function FlowNodeEditor({
  node,
  onChange,
  compact,
}: {
  node: FlowNode;
  onChange: (node: FlowNode) => void;
  compact?: boolean;
}) {
  const setData = (data: FlowNode['data']) => onChange({ ...node, data } as FlowNode);

  if (node.type === 'start') {
    return (
      <div className="space-y-2">
        <p className={label}>Type, press Enter to add keyword</p>
        <KeywordInput
          values={node.data.hardPhrases}
          onChange={(hardPhrases) => setData({ ...node.data, hardPhrases })}
          placeholder="Enter keywords"
        />
        <label className="flex items-center justify-between gap-2 text-[10px] text-text-secondary">
          <span>Regex (substring). Toggle for case-sensitive.</span>
          <input
            type="checkbox"
            className="nodrag"
            checked={!!node.data.regexCaseSensitive}
            onChange={(e) => setData({ ...node.data, regexCaseSensitive: e.target.checked })}
          />
        </label>
        <input
          className={field}
          placeholder="Enter regex"
          value={(node.data.hardRegex || [])[0] || ''}
          onChange={(e) =>
            setData({
              ...node.data,
              hardRegex: e.target.value.trim() ? [e.target.value.trim()] : [],
            })
          }
        />
        <label className="flex items-center gap-2 text-[10px] text-text-secondary">
          <input
            type="checkbox"
            className="nodrag"
            checked={!!node.data.firstMessage}
            onChange={(e) => setData({ ...node.data, firstMessage: e.target.checked })}
          />
          First message in a chat
        </label>
        {!compact ? (
          <>
            <p className={label}>Soft intents (AI router, one per line)</p>
            <textarea
              className={field}
              rows={2}
              value={(node.data.softIntents || []).join('\n')}
              onChange={(e) =>
                setData({
                  ...node.data,
                  softIntents: e.target.value
                    .split('\n')
                    .map((s) => s.trim())
                    .filter(Boolean),
                })
              }
            />
            <p className="text-[10px] text-text-muted">
              Meta templates and ads do not start a Khatario flow. Submit templates under Settings → WhatsApp →
              Templates.
            </p>
          </>
        ) : null}
      </div>
    );
  }

  if (node.type === 'message') {
    return (
      <div className="space-y-2">
        <HeaderBodyFooter
          header={node.data.header || ''}
          body={node.data.body}
          footer={node.data.footer || ''}
          onHeader={(header) => setData({ ...node.data, header })}
          onBody={(body) => setData({ ...node.data, body })}
          onFooter={(footer) => setData({ ...node.data, footer })}
        />
        <p className={label}>Media</p>
        <select
          className={field}
          value={node.data.mediaType || 'none'}
          onChange={(e) =>
            setData({ ...node.data, mediaType: e.target.value as typeof node.data.mediaType })
          }
        >
          <option value="none">No media</option>
          <option value="image">Image URL</option>
          <option value="video">Video URL</option>
        </select>
        {node.data.mediaType && node.data.mediaType !== 'none' ? (
          <input
            className={field}
            placeholder="https://…"
            value={node.data.mediaUrl || ''}
            onChange={(e) => setData({ ...node.data, mediaUrl: e.target.value })}
          />
        ) : null}
        <p className={label}>Delay (seconds, 0–30)</p>
        <input
          className={field}
          type="number"
          min={0}
          max={30}
          value={node.data.delaySeconds || 0}
          onChange={(e) => setData({ ...node.data, delaySeconds: Number(e.target.value) || 0 })}
        />
      </div>
    );
  }

  if (node.type === 'buttons') {
    return (
      <div className="space-y-2">
        <HeaderBodyFooter
          header={node.data.header || ''}
          body={node.data.body}
          footer={node.data.footer || ''}
          onHeader={(header) => setData({ ...node.data, header })}
          onBody={(body) => setData({ ...node.data, body })}
          onFooter={(footer) => setData({ ...node.data, footer })}
        />
        {(node.data.buttons || []).map((b, i) => (
          <div key={b.id} className="flex gap-1">
            <input
              className={field}
              value={b.title}
              maxLength={WA_LIMITS.buttonTitle}
              onChange={(e) => {
                const buttons = node.data.buttons.map((x, j) => (j === i ? { ...x, title: e.target.value } : x));
                setData({ ...node.data, buttons });
              }}
            />
            {node.data.buttons.length > 1 ? (
              <button
                type="button"
                className="nodrag shrink-0 text-[10px] text-red-600"
                onClick={() =>
                  setData({ ...node.data, buttons: node.data.buttons.filter((_, j) => j !== i) })
                }
              >
                ✕
              </button>
            ) : null}
          </div>
        ))}
        {node.data.buttons.length < WA_LIMITS.buttonsMax ? (
          <button
            type="button"
            className="nodrag w-full rounded-md border border-dashed border-border py-1 text-[11px] text-primary-700 dark:border-border-dark"
            onClick={() =>
              setData({
                ...node.data,
                buttons: [...node.data.buttons, { id: newNodeId(), title: 'Option' }],
              })
            }
          >
            + Add button
          </button>
        ) : null}
      </div>
    );
  }

  if (node.type === 'list') {
    return (
      <div className="space-y-2">
        <HeaderBodyFooter
          header={node.data.header || ''}
          body={node.data.body}
          footer={node.data.footer || ''}
          onHeader={(header) => setData({ ...node.data, header })}
          onBody={(body) => setData({ ...node.data, body })}
          onFooter={(footer) => setData({ ...node.data, footer })}
        />
        <p className={label}>List button</p>
        <input
          className={field}
          maxLength={WA_LIMITS.listButton}
          value={node.data.buttonText}
          onChange={(e) => setData({ ...node.data, buttonText: e.target.value })}
        />
        {(node.data.rows || []).map((row, i) => (
          <div key={row.id} className="space-y-1 rounded-md border border-border p-1.5 dark:border-border-dark">
            <input
              className={field}
              placeholder="Title"
              maxLength={WA_LIMITS.listRowTitle}
              value={row.title}
              onChange={(e) => {
                const rows = node.data.rows.map((x, j) => (j === i ? { ...x, title: e.target.value } : x));
                setData({ ...node.data, rows });
              }}
            />
            <input
              className={field}
              placeholder="Description"
              maxLength={WA_LIMITS.listRowDescription}
              value={row.description || ''}
              onChange={(e) => {
                const rows = node.data.rows.map((x, j) => (j === i ? { ...x, description: e.target.value } : x));
                setData({ ...node.data, rows });
              }}
            />
            {node.data.rows.length > 1 ? (
              <button
                type="button"
                className="nodrag text-[10px] text-red-600"
                onClick={() => setData({ ...node.data, rows: node.data.rows.filter((_, j) => j !== i) })}
              >
                Remove row
              </button>
            ) : null}
          </div>
        ))}
        {node.data.rows.length < WA_LIMITS.listRowsMax ? (
          <button
            type="button"
            className="nodrag w-full rounded-md border border-dashed border-border py-1 text-[11px] text-primary-700 dark:border-border-dark"
            onClick={() =>
              setData({
                ...node.data,
                rows: [...node.data.rows, { id: newNodeId(), title: 'Item', description: '' }],
              })
            }
          >
            + Add section / row
          </button>
        ) : null}
      </div>
    );
  }

  if (node.type === 'ask') {
    return (
      <div className="space-y-2">
        <p className={label}>Body</p>
        <textarea className={field} rows={3} value={node.data.body} onChange={(e) => setData({ ...node.data, body: e.target.value })} />
        <p className={label}>Save as</p>
        <input className={field} value={node.data.storeAs} onChange={(e) => setData({ ...node.data, storeAs: e.target.value })} />
        <select
          className={field}
          value={node.data.input}
          onChange={(e) => setData({ ...node.data, input: e.target.value as typeof node.data.input })}
        >
          <option value="text">Text</option>
          <option value="number">Number</option>
          <option value="phone">Phone</option>
          <option value="email">Email</option>
        </select>
      </div>
    );
  }

  if (node.type === 'action') {
    return (
      <div className="space-y-2">
        <select
          className={field}
          value={node.data.kind}
          onChange={(e) => setData({ ...node.data, kind: e.target.value as typeof node.data.kind })}
        >
          <option value="open_shop">Catalogue / open shop</option>
          <option value="handoff">Handoff to team</option>
          <option value="assign_to_user_id">Assign agent</option>
          <option value="add_labels">Add labels</option>
          <option value="remove_labels">Remove labels</option>
        </select>
        {node.data.kind === 'open_shop' ? (
          <>
            <p className={label}>Body</p>
            <textarea
              className={field}
              rows={2}
              value={node.data.catalogBody || ''}
              onChange={(e) => setData({ ...node.data, catalogBody: e.target.value })}
            />
            <p className={label}>Footer</p>
            <input
              className={field}
              value={node.data.catalogFooter || ''}
              onChange={(e) => setData({ ...node.data, catalogFooter: e.target.value })}
            />
          </>
        ) : null}
      </div>
    );
  }

  if (node.type === 'branch') {
    return (
      <div className="space-y-2">
        <input className={field} value={node.data.field} onChange={(e) => setData({ ...node.data, field: e.target.value })} />
        <input
          className={field}
          placeholder="Equals (optional)"
          value={node.data.equals || ''}
          onChange={(e) => setData({ ...node.data, equals: e.target.value })}
        />
      </div>
    );
  }

  return <p className="text-[10px] text-text-muted">End of flow.</p>;
}

function HeaderBodyFooter({
  header,
  body,
  footer,
  onHeader,
  onBody,
  onFooter,
}: {
  header: string;
  body: string;
  footer: string;
  onHeader: (v: string) => void;
  onBody: (v: string) => void;
  onFooter: (v: string) => void;
}) {
  return (
    <>
      <p className={label}>Header {header.length}/{WA_LIMITS.headerText}</p>
      <input className={field} maxLength={WA_LIMITS.headerText} value={header} onChange={(e) => onHeader(e.target.value)} />
      <p className={label}>Body {body.length}/{WA_LIMITS.interactiveBody}</p>
      <textarea className={field} rows={3} maxLength={WA_LIMITS.interactiveBody} value={body} onChange={(e) => onBody(e.target.value)} />
      <p className={label}>Footer {footer.length}/{WA_LIMITS.interactiveFooter}</p>
      <input className={field} maxLength={WA_LIMITS.interactiveFooter} value={footer} onChange={(e) => onFooter(e.target.value)} />
    </>
  );
}

function KeywordInput({
  values,
  onChange,
  placeholder,
}: {
  values: string[];
  onChange: (next: string[]) => void;
  placeholder: string;
}) {
  return (
    <div>
      <div className="mb-1 flex flex-wrap gap-1">
        {values.map((v) => (
          <button
            key={v}
            type="button"
            className="nodrag rounded-full bg-slate-100 px-2 py-0.5 text-[10px] dark:bg-slate-800"
            onClick={() => onChange(values.filter((x) => x !== v))}
          >
            {v} ×
          </button>
        ))}
      </div>
      <input
        className={field}
        placeholder={placeholder}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          const t = (e.target as HTMLInputElement).value.trim();
          if (!t || values.includes(t)) return;
          onChange([...values, t]);
          (e.target as HTMLInputElement).value = '';
        }}
      />
    </div>
  );
}
