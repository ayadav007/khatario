'use client';

import Link from 'next/link';
import { Mail, X } from 'lucide-react';
import { EmailSettingsTab } from '@/components/settings/EmailSettingsTab';
import { Button } from '@/components/ui/Button';

export interface ConfigureBusinessEmailModalProps {
  open: boolean;
  businessId: string;
  onClose: () => void;
  /** Called after SMTP is saved and ready — typically open the compose modal. */
  onConfigured: () => void;
  /** User can send documents but cannot update settings. */
  forbidden?: boolean;
}

export function ConfigureBusinessEmailModal({
  open,
  businessId,
  onClose,
  onConfigured,
  forbidden = false,
}: ConfigureBusinessEmailModalProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[130] flex items-start justify-center overflow-y-auto bg-black/50 p-4 md:p-8">
      <div
        className="my-4 flex w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-border bg-white shadow-xl"
        role="dialog"
        aria-modal
        aria-labelledby="configure-business-email-title"
      >
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 rounded-lg bg-primary-50 p-2 text-primary-700">
              <Mail className="h-5 w-5" />
            </div>
            <div>
              <h2 id="configure-business-email-title" className="text-lg font-semibold text-gray-900">
                Set up email to send documents
              </h2>
              <p className="mt-1 text-sm text-text-secondary">
                Add your SMTP details once. Then you can email invoices, sales orders, and other
                documents with a PDF attachment.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-gray-500 hover:bg-gray-100"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="max-h-[min(70vh,640px)] overflow-y-auto px-5 py-4">
          {forbidden ? (
            <div className="space-y-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
              <p className="font-medium">Email is not set up for this business</p>
              <p>
                Ask an admin to configure SMTP under Settings → Email. You need permission to change
                settings to set this up yourself.
              </p>
              <div className="flex flex-wrap gap-2">
                <Link href="/settings/email">
                  <Button variant="secondary" size="sm">
                    Open Email settings
                  </Button>
                </Link>
                <Button variant="secondary" size="sm" onClick={onClose}>
                  Close
                </Button>
              </div>
            </div>
          ) : (
            <EmailSettingsTab
              businessId={businessId}
              preferEnabledWhenEmpty
              onReady={onConfigured}
              readyActionLabel="Save & continue to email"
            />
          )}
        </div>
      </div>
    </div>
  );
}
