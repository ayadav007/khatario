'use client';

import { useId, useState } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { PRINTER_PROFILES, getProfile } from '@/lib/bluetooth/printer-profiles';
import type { PrinterProfileId, SavedBluetoothPrinter } from '@/lib/bluetooth/types';

type Props = {
  printer: SavedBluetoothPrinter;
  onSave: (printer: SavedBluetoothPrinter) => void;
  onCancel: () => void;
};

const field = 'w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary';
const label = 'mb-1 block text-xs font-medium text-text-secondary';

/** Edit one saved printer: name, model (sets the command language), paper, bill and label options. */
export function PrinterSettingsDialog({ printer, onSave, onCancel }: Props) {
  const titleId = useId();
  const [draft, setDraft] = useState<SavedBluetoothPrinter>(printer);
  const profile = getProfile(draft.profileId);
  const isLabel = profile.language === 'TSPL' || profile.language === 'ZPL';
  const set = (patch: Partial<SavedBluetoothPrinter>) => setDraft((d) => ({ ...d, ...patch }));

  const changeModel = (id: PrinterProfileId) => {
    const next = getProfile(id);
    set({ profileId: id, paperWidthMm: next.paperWidthMm, dpi: undefined });
  };

  return (
    <div className="fixed inset-0 z-[10060] flex items-center justify-center bg-black/50 p-4">
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="max-h-[90vh] w-full max-w-md space-y-4 overflow-y-auto rounded-2xl bg-surface p-6 shadow-xl"
        onSubmit={(e) => {
          e.preventDefault();
          onSave({ ...draft, name: draft.name.trim() || printer.name });
        }}
      >
        <div className="flex items-start justify-between gap-3">
          <h2 id={titleId} className="text-lg font-bold text-text-primary">
            Printer settings
          </h2>
          <button type="button" onClick={onCancel} className="text-text-muted hover:text-text-primary" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div>
          <label className={label} htmlFor={`${titleId}-name`}>
            Name
          </label>
          <input id={`${titleId}-name`} className={field} value={draft.name} onChange={(e) => set({ name: e.target.value })} />
        </div>

        <div>
          <label className={label} htmlFor={`${titleId}-model`}>
            Printer type
          </label>
          <select
            id={`${titleId}-model`}
            className={field}
            value={draft.profileId}
            onChange={(e) => changeModel(e.target.value as PrinterProfileId)}
          >
            <optgroup label="Bill / receipt printers">
              {PRINTER_PROFILES.filter((p) => p.language === 'ESCPOS').map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </optgroup>
            <optgroup label="Barcode / label printers">
              {PRINTER_PROFILES.filter((p) => p.language !== 'ESCPOS').map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </optgroup>
          </select>
          <p className="mt-1 text-xs text-text-muted">{profile.description}</p>
        </div>

        {!isLabel ? (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={label} htmlFor={`${titleId}-paper`}>
                  Paper width
                </label>
                <select
                  id={`${titleId}-paper`}
                  className={field}
                  value={draft.paperWidthMm === 80 ? 80 : 58}
                  onChange={(e) => set({ paperWidthMm: Number(e.target.value) as 58 | 80 })}
                >
                  <option value={58}>58 mm (2 inch)</option>
                  <option value={80}>80 mm (3 inch)</option>
                </select>
              </div>
              <div>
                <label className={label} htmlFor={`${titleId}-copies`}>
                  Copies per bill
                </label>
                <select
                  id={`${titleId}-copies`}
                  className={field}
                  value={draft.copies ?? 1}
                  onChange={(e) => set({ copies: Number(e.target.value) })}
                >
                  <option value={1}>1</option>
                  <option value={2}>2 (shop copy marked Duplicate)</option>
                  <option value={3}>3</option>
                </select>
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm text-text-primary">
              <input type="checkbox" checked={draft.autoCut !== false} onChange={(e) => set({ autoCut: e.target.checked })} />
              Cut paper after each bill
            </label>
            <div>
              <label className={label} htmlFor={`${titleId}-drawer`}>
                Cash drawer (plugged into this printer)
              </label>
              <select
                id={`${titleId}-drawer`}
                className={field}
                value={draft.cashDrawer ?? 'never'}
                onChange={(e) => set({ cashDrawer: e.target.value as SavedBluetoothPrinter['cashDrawer'] })}
              >
                <option value="never">No cash drawer</option>
                <option value="cash">Open for cash sales</option>
                <option value="always">Open for every bill</option>
              </select>
            </div>
          </>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={label} htmlFor={`${titleId}-density`}>
                  Darkness ({draft.labelDensity ?? 8})
                </label>
                <input
                  id={`${titleId}-density`}
                  type="range"
                  min={0}
                  max={15}
                  value={draft.labelDensity ?? 8}
                  onChange={(e) => set({ labelDensity: Number(e.target.value) })}
                  className="w-full"
                />
              </div>
              <div>
                <label className={label} htmlFor={`${titleId}-speed`}>
                  Speed ({draft.labelSpeed ?? 4} in/s)
                </label>
                <input
                  id={`${titleId}-speed`}
                  type="range"
                  min={1}
                  max={6}
                  value={draft.labelSpeed ?? 4}
                  onChange={(e) => set({ labelSpeed: Number(e.target.value) })}
                  className="w-full"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={label} htmlFor={`${titleId}-gap`}>
                  Gap between labels
                </label>
                <select
                  id={`${titleId}-gap`}
                  className={field}
                  value={draft.labelGapMm ?? 2}
                  onChange={(e) => set({ labelGapMm: Number(e.target.value) })}
                >
                  <option value={0}>None (continuous roll)</option>
                  <option value={2}>2 mm (most rolls)</option>
                  <option value={3}>3 mm</option>
                  <option value={4}>4 mm</option>
                </select>
              </div>
              <div>
                <label className={label} htmlFor={`${titleId}-dpi`}>
                  Resolution
                </label>
                <select
                  id={`${titleId}-dpi`}
                  className={field}
                  value={draft.dpi ?? profile.dpi}
                  onChange={(e) => set({ dpi: Number(e.target.value) as 203 | 300 })}
                >
                  <option value={203}>203 dpi (most printers)</option>
                  <option value={300}>300 dpi</option>
                </select>
              </div>
            </div>
            <p className="text-xs text-text-muted">Label size and layout come from Settings › Label templates.</p>
          </>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit">Save</Button>
        </div>
      </form>
    </div>
  );
}
