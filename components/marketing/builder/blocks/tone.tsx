'use client';

import { createContext, useContext, type ReactNode } from 'react';

export type Tone = 'light' | 'dark';

const ToneContext = createContext<Tone>('light');

export function ToneProvider({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <ToneContext.Provider value={tone}>{children}</ToneContext.Provider>;
}

export function useTone(): Tone {
  return useContext(ToneContext);
}

export type Align = 'left' | 'center' | 'right';

export const TEXT_ALIGN: Record<Align, string> = {
  left: 'text-left',
  center: 'text-center',
  right: 'text-right',
};

export const JUSTIFY: Record<Align, string> = {
  left: 'justify-start',
  center: 'justify-center',
  right: 'justify-end',
};

export const ITEMS_ALIGN: Record<Align, string> = {
  left: 'items-start',
  center: 'items-center',
  right: 'items-end',
};

export function cleanAnchor(value?: string): string | undefined {
  const v = (value ?? '').replace(/[^A-Za-z0-9_-]/g, '');
  return v ? v : undefined;
}
