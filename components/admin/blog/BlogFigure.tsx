'use client';

import Image from '@tiptap/extension-image';
import { NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from '@tiptap/react';

function FigureView({ node, updateAttributes, selected }: ReactNodeViewProps) {
  const align = String(node.attrs.align || 'center');
  const size = String(node.attrs.size || 'large');
  const wrap = String(node.attrs.wrap || 'none');
  return (
    <NodeViewWrapper
      as="figure"
      className={`blog-figure${selected ? ' is-selected' : ''}`}
      data-align={align}
      data-size={size}
      data-wrap={wrap}
    >
      <img src={node.attrs.src} alt={node.attrs.alt || ''} />
      <input
        className="blog-caption w-full border-0 bg-transparent text-center"
        value={node.attrs.caption || ''}
        placeholder="Caption (optional)"
        onChange={(event) => updateAttributes({ caption: event.target.value })}
        onMouseDown={(event) => event.stopPropagation()}
      />
      <input
        className="mt-1 w-full border-0 bg-transparent text-center text-xs text-slate-500"
        value={node.attrs.alt || ''}
        placeholder="Alt text"
        onChange={(event) => updateAttributes({ alt: event.target.value })}
        onMouseDown={(event) => event.stopPropagation()}
      />
    </NodeViewWrapper>
  );
}

export const BlogFigure = Image.extend({
  addAttributes() {
    return {
      src: { default: null },
      alt: { default: '' },
      caption: { default: '' },
      align: { default: 'center' },
      size: { default: 'large' },
      wrap: { default: 'none' },
    };
  },
  parseHTML() {
    return [
      {
        tag: 'figure.blog-figure',
        getAttrs(element) {
          const el = element as HTMLElement;
          const img = el.querySelector('img');
          return {
            src: img?.getAttribute('src'),
            alt: img?.getAttribute('alt') || '',
            caption: el.querySelector('figcaption')?.textContent || '',
            align: el.getAttribute('data-align') || 'center',
            size: el.getAttribute('data-size') || 'large',
            wrap: el.getAttribute('data-wrap') || 'none',
          };
        },
      },
      {
        tag: 'img[src]',
        getAttrs(element) {
          const img = element as HTMLElement;
          return {
            src: img.getAttribute('src'),
            alt: img.getAttribute('alt') || '',
            caption: '',
            align: 'center',
            size: 'large',
            wrap: 'none',
          };
        },
      },
    ];
  },
  renderHTML({ HTMLAttributes }) {
    const align = HTMLAttributes.align || 'center';
    const size = HTMLAttributes.size || 'large';
    const wrap = HTMLAttributes.wrap || 'none';
    const caption = HTMLAttributes.caption || '';
    const children: Array<['img', { src: string; alt: string }] | ['figcaption', Record<string, never>, string]> = [
      ['img', { src: HTMLAttributes.src, alt: HTMLAttributes.alt || '' }],
    ];
    if (caption) children.push(['figcaption', {}, caption]);
    return ['figure', { class: 'blog-figure', 'data-align': align, 'data-size': size, 'data-wrap': wrap }, ...children];
  },
  addNodeView() {
    return ReactNodeViewRenderer(FigureView);
  },
});
