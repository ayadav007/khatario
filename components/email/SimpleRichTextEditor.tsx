'use client';

import React, { useCallback, useEffect, useRef } from 'react';
import { Bold, Italic, List, ListOrdered, Underline } from 'lucide-react';
import { clsx } from 'clsx';

interface SimpleRichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
  className?: string;
  minHeightClass?: string;
}

function ToolbarButton({
  onClick,
  label,
  children,
}: {
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onMouseDown={(e) => {
        e.preventDefault();
        onClick();
      }}
      className="rounded p-1.5 text-gray-600 hover:bg-gray-200"
    >
      {children}
    </button>
  );
}

export function SimpleRichTextEditor({
  value,
  onChange,
  className,
  minHeightClass = 'min-h-[220px]',
}: SimpleRichTextEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);

  const exec = useCallback(
    (command: string, valueArg?: string) => {
      document.execCommand(command, false, valueArg);
      if (editorRef.current) {
        onChange(editorRef.current.innerHTML);
      }
    },
    [onChange]
  );

  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    if (el.innerHTML !== value) {
      el.innerHTML = value;
    }
  }, [value]);

  return (
    <div className={clsx('overflow-hidden rounded-lg border border-border bg-white', className)}>
      <div className="flex flex-wrap items-center gap-0.5 border-b border-border bg-gray-50 px-2 py-1">
        <ToolbarButton onClick={() => exec('bold')} label="Bold">
          <Bold className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton onClick={() => exec('italic')} label="Italic">
          <Italic className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton onClick={() => exec('underline')} label="Underline">
          <Underline className="h-4 w-4" />
        </ToolbarButton>
        <span className="mx-1 h-5 w-px bg-gray-300" />
        <ToolbarButton onClick={() => exec('insertUnorderedList')} label="Bullet list">
          <List className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton onClick={() => exec('insertOrderedList')} label="Numbered list">
          <ListOrdered className="h-4 w-4" />
        </ToolbarButton>
        <select
          className="ml-1 h-8 rounded border border-gray-200 bg-white px-1 text-xs text-gray-700"
          defaultValue="3"
          onChange={(e) => exec('fontSize', e.target.value)}
          aria-label="Font size"
        >
          <option value="2">12px</option>
          <option value="3">16px</option>
          <option value="4">18px</option>
          <option value="5">24px</option>
        </select>
      </div>
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline
        className={clsx(
          'px-4 py-3 text-base text-gray-900 outline-none focus:ring-2 focus:ring-inset focus:ring-primary-500',
          minHeightClass
        )}
        onInput={() => {
          if (editorRef.current) onChange(editorRef.current.innerHTML);
        }}
      ></div>
    </div>
  );
}
