'use client';

import { useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';

export interface DeleteTenantModalProps {
  businessId: string;
  businessName: string;
  deleting?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * Destructive confirm: admin must type the exact business name.
 */
export function DeleteTenantModal({
  businessId,
  businessName,
  deleting = false,
  onCancel,
  onConfirm,
}: DeleteTenantModalProps) {
  const [typedName, setTypedName] = useState('');
  const nameMatches = typedName.trim() === businessName.trim();

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-lg p-6 max-w-md w-full">
        <div className="flex items-start gap-3 mb-4">
          <div className="rounded-full bg-red-100 p-2 shrink-0">
            <AlertTriangle className="w-5 h-5 text-red-700" />
          </div>
          <div>
            <h2 className="text-xl font-semibold text-gray-900">Delete tenant permanently</h2>
            <p className="text-sm text-gray-600 mt-1">
              This cannot be undone. All data for <strong>{businessName}</strong> will be removed.
            </p>
          </div>
        </div>

        <ul className="list-disc list-inside text-sm text-gray-600 mb-4 space-y-1">
          <li>Users, employees, and portal access</li>
          <li>Customers, suppliers, items, invoices</li>
          <li>Subscriptions, modules, and billing history</li>
          <li>Financial / HR / WhatsApp records for this business</li>
        </ul>

        <p className="text-xs text-gray-500 mb-2 font-mono break-all">ID: {businessId}</p>

        <label className="block text-sm font-medium text-gray-700 mb-1">
          Type <span className="font-semibold text-gray-900">{businessName}</span> to confirm
        </label>
        <input
          type="text"
          value={typedName}
          onChange={(e) => setTypedName(e.target.value)}
          disabled={deleting}
          autoFocus
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-6 focus:ring-2 focus:ring-red-500 focus:border-red-500 disabled:opacity-50"
          placeholder="Business name"
        />

        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={deleting}
            className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!nameMatches || deleting}
            className="inline-flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {deleting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Deleting…
              </>
            ) : (
              'Delete permanently'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
