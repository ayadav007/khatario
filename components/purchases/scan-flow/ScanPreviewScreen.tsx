'use client';

import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';

interface Props {
  pages: File[];
  onAddPage: (file: File) => void;
  onRemovePage: (index: number) => void;
  onProceed: () => void;
  onBack: () => void;
}

function PageThumb({ file, onRemove }: { file: File; onRemove: () => void }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    const url = URL.createObjectURL(file);
    setSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  return (
    <div className="relative">
      {src && (
        <img
          src={src}
          alt={file.name}
          className="h-20 w-16 rounded-lg border border-border object-cover shadow-sm"
        />
      )}
      <button
        type="button"
        onClick={onRemove}
        className="absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full bg-gray-700 text-white shadow"
        aria-label="Remove page"
      >
        <X className="h-3 w-3" />
      </button>
      <span className="mt-1 block text-center text-[10px] text-text-muted">
        {src ? '' : '…'}
      </span>
    </div>
  );
}

export function ScanPreviewScreen({ pages, onAddPage, onRemovePage, onProceed, onBack }: Props) {
  const [mainSrc, setMainSrc] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!pages[0]) return;
    const url = URL.createObjectURL(pages[0]);
    setMainSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [pages[0]]);

  const handleAddFile: React.ChangeEventHandler<HTMLInputElement> = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) onAddPage(file);
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <button
          type="button"
          onClick={onBack}
          className="flex h-9 w-9 items-center justify-center rounded-lg text-text-secondary active:bg-slate-100"
          aria-label="Back"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h1 className="text-base font-semibold text-text-primary">Purchase Bill Preview</h1>
      </div>

      {/* Main image */}
      <div className="flex flex-1 items-center justify-center overflow-hidden bg-slate-100 dark:bg-slate-900">
        {mainSrc && (
          <img
            src={mainSrc}
            alt="Invoice page 1"
            className="max-h-full max-w-full object-contain"
          />
        )}
      </div>

      {/* Bottom bar */}
      <div
        className="shrink-0 border-t border-border bg-background px-4 py-4"
        style={{ paddingBottom: `calc(1rem + env(safe-area-inset-bottom, 0px))` }}
      >
        {/* Page thumbnails + add button */}
        <div className="mb-4 flex items-center gap-3">
          {pages.map((page, i) => (
            <PageThumb
              key={i}
              file={page}
              onRemove={() => onRemovePage(i)}
            />
          ))}

          {/* Add more pages */}
          {pages.length < 5 && (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex h-20 w-16 flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-border text-text-muted active:bg-slate-50"
            >
              <Plus className="h-5 w-5" />
              <span className="text-[10px]">Add</span>
            </button>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            onChange={handleAddFile}
          />
        </div>

        {/* Info banner */}
        <p className="mb-3 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
          <span className="font-semibold">ⓘ</span> Please ensure all pages belong to the{' '}
          <span className="font-semibold">same invoice</span>. Multi-invoice uploads are not supported yet.
        </p>

        <Button
          type="button"
          variant="primary"
          className="w-full"
          onClick={onProceed}
        >
          Proceed ({pages.length} {pages.length === 1 ? 'page' : 'pages'})
        </Button>
      </div>
    </div>
  );
}
