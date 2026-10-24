'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Plus } from 'lucide-react';

export type SearchableOption = { id: string; label: string };

export function SearchableSelect({
  value,
  options,
  placeholder,
  onChange,
  addLabel,
  onAdd,
  buttonClassName,
}: {
  value: string;
  options: SearchableOption[];
  placeholder: string;
  onChange: (id: string) => void;
  addLabel?: string;
  onAdd?: () => void;
  buttonClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [box, setBox] = useState<{ top: number; left: number; width: number } | null>(null);

  const selected = options.find((option) => option.id === value);
  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return options;
    return options.filter((option) => option.label.toLowerCase().includes(needle));
  }, [options, query]);

  useEffect(() => {
    if (!open) return;
    function place() {
      const element = buttonRef.current;
      if (!element) return;
      const rect = element.getBoundingClientRect();
      setBox({ top: rect.bottom + 4, left: rect.left, width: rect.width });
    }
    place();
    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    }
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    document.addEventListener('mousedown', onPointerDown);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      document.removeEventListener('mousedown', onPointerDown);
    };
  }, [open]);

  return (
    <div ref={rootRef}>
      <button
        type="button"
        ref={buttonRef}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => {
          setQuery('');
          setOpen((current) => !current);
        }}
        className={
          buttonClassName ||
          'mt-1 flex min-h-11 w-full items-center justify-between rounded-lg border border-gray-300 bg-white px-3 py-2 text-left text-base'
        }
      >
        <span className={selected ? 'truncate text-gray-900' : 'truncate text-gray-500'}>
          {selected?.label || placeholder}
        </span>
        <ChevronDown className="ml-2 h-4 w-4 shrink-0 text-gray-400" />
      </button>
      {open && box &&
        createPortal(
          <div
            ref={menuRef}
            role="listbox"
            style={{ position: 'fixed', top: box.top, left: box.left, width: Math.max(box.width, 240), zIndex: 80 }}
            className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg"
          >
            <div className="border-b border-gray-100 p-2">
              <input
                autoFocus
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search"
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-base"
              />
            </div>
            <div className="max-h-60 overflow-y-auto">
              {matches.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  role="option"
                  aria-selected={option.id === value}
                  className="block w-full px-3 py-2.5 text-left text-sm hover:bg-gray-50"
                  onClick={() => {
                    onChange(option.id);
                    setOpen(false);
                  }}
                >
                  {option.label}
                </button>
              ))}
              {matches.length === 0 && <p className="px-3 py-3 text-sm text-gray-500">No matches</p>}
            </div>
            {onAdd && addLabel && (
              <button
                type="button"
                className="flex w-full items-center gap-2 border-t border-gray-100 px-3 py-2.5 text-left text-sm font-medium text-primary-600 hover:bg-gray-50"
                onClick={() => {
                  setOpen(false);
                  onAdd();
                }}
              >
                <Plus className="h-4 w-4" />
                {addLabel}
              </button>
            )}
          </div>,
          document.body
        )}
    </div>
  );
}
