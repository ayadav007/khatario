'use client';

import { HelpCircle } from 'lucide-react';
import { PRINTER_BLE_VS_CLASSIC_HELP } from '@/lib/printer/copy';

/**
 * Expandable BLE vs Classic Bluetooth explainer for printer settings.
 */
export function BleVsClassicHelp({ className = '' }: { className?: string }) {
  return (
    <details className={`group text-sm ${className}`}>
      <summary className="cursor-pointer list-none inline-flex items-center gap-1.5 text-primary-600 hover:text-primary-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 rounded">
        <HelpCircle className="w-4 h-4 shrink-0" aria-hidden />
        <span className="link-primary font-medium">BLE vs Classic Bluetooth</span>
      </summary>
      <p className="mt-2 text-text-secondary whitespace-pre-line leading-relaxed pl-0.5 border-l-2 border-border pl-3">
        {PRINTER_BLE_VS_CLASSIC_HELP}
      </p>
    </details>
  );
}
