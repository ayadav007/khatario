'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { FileText, HelpCircle, Loader2, Paperclip, X } from 'lucide-react';
import type { DocumentTable } from '@/lib/pdf-generator';
import {
  buildDocumentEmailTemplate,
  pdfFilenameForDocument,
} from '@/lib/document-email-templates';
import { SimpleRichTextEditor } from '@/components/email/SimpleRichTextEditor';
import { Button } from '@/components/ui/Button';
import { useToastContext } from '@/contexts/ToastContext';

export interface SendDocumentEmailModalProps {
  open: boolean;
  onClose: () => void;
  documentTable: DocumentTable;
  documentId: string;
  partyName: string;
  partyEmail?: string | null;
  documentNumber: string;
  documentDate?: string | null;
  amount?: number | string | null;
  businessName: string;
  fromEmail: string;
  fromName?: string;
  onSent?: () => void;
}

function htmlToPlainText(html: string): string {
  if (typeof document === 'undefined') return html;
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  return (tmp.textContent || tmp.innerText || '').replace(/\n{3,}/g, '\n\n').trim();
}

export function SendDocumentEmailModal({
  open,
  onClose,
  documentTable,
  documentId,
  partyName,
  partyEmail,
  documentNumber,
  documentDate,
  amount,
  businessName,
  fromEmail,
  fromName,
  onSent,
}: SendDocumentEmailModalProps) {
  const toast = useToastContext();
  const [to, setTo] = useState('');
  const [cc, setCc] = useState('');
  const [bcc, setBcc] = useState('');
  const [showCc, setShowCc] = useState(false);
  const [showBcc, setShowBcc] = useState(false);
  const [subject, setSubject] = useState('');
  const [bodyHtml, setBodyHtml] = useState('');
  const [attachPdf, setAttachPdf] = useState(true);
  const [sending, setSending] = useState(false);

  const template = useMemo(
    () =>
      buildDocumentEmailTemplate({
        documentTable,
        documentNumber,
        documentDate,
        amount,
        partyName,
        businessName,
      }),
    [documentTable, documentNumber, documentDate, amount, partyName, businessName]
  );

  useEffect(() => {
    if (!open) return;
    setTo(partyEmail?.trim() || '');
    setCc('');
    setBcc('');
    setShowCc(false);
    setShowBcc(false);
    setSubject(template.subject);
    setBodyHtml(template.bodyHtml);
    setAttachPdf(true);
  }, [open, partyEmail, template.subject, template.bodyHtml]);

  if (!open) return null;

  const fromDisplay = fromName ? `${fromName} <${fromEmail}>` : fromEmail;
  const pdfName = pdfFilenameForDocument(documentTable, documentNumber);

  async function handleSend() {
    if (!to.trim() || !to.includes('@')) {
      toast.warning('Enter a valid recipient email');
      return;
    }
    if (!subject.trim()) {
      toast.warning('Subject is required');
      return;
    }

    setSending(true);
    try {
      const res = await fetch(`/api/documents/${documentTable}/${documentId}/email`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: to.trim(),
          cc: cc.trim() || undefined,
          bcc: bcc.trim() || undefined,
          subject: subject.trim(),
          body_html: bodyHtml,
          body_text: htmlToPlainText(bodyHtml) || template.bodyText,
          attach_pdf: attachPdf,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.code === 'EMAIL_NOT_CONFIGURED') {
          toast.error(
            data.error ||
              'Configure your business SMTP under Settings → Email before sending.'
          );
        } else {
          toast.error(data.error || 'Failed to send email');
        }
        return;
      }
      toast.success('Email sent successfully');
      onSent?.();
      onClose();
    } catch {
      toast.error('Failed to send email');
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[120] flex items-start justify-center overflow-y-auto bg-black/50 p-4 md:p-8">
      <div
        className="my-4 flex w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-border bg-white shadow-xl"
        role="dialog"
        aria-modal
        aria-labelledby="send-document-email-title"
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 id="send-document-email-title" className="text-lg font-semibold text-gray-900">
            Email To {partyName}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="max-h-[calc(100vh-12rem)] overflow-y-auto px-5 py-4 space-y-4">
          <div className="grid gap-1 text-sm">
            <div className="flex items-center gap-1 text-text-secondary">
              <span className="w-14 shrink-0 font-medium text-gray-700">From</span>
              <HelpCircle className="h-3.5 w-3.5 text-gray-400" aria-hidden />
            </div>
            <p className="pl-14 text-gray-900">{fromDisplay}</p>
          </div>

          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <label className="w-14 shrink-0 text-sm font-medium text-gray-700">Send To</label>
              <input
                type="email"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="input min-h-10 flex-1 text-sm"
                placeholder="recipient@example.com"
              />
              <div className="flex gap-2 text-sm">
                {!showCc && (
                  <button
                    type="button"
                    className="text-primary-600 hover:text-primary-700"
                    onClick={() => setShowCc(true)}
                  >
                    Cc
                  </button>
                )}
                {!showBcc && (
                  <button
                    type="button"
                    className="text-primary-600 hover:text-primary-700"
                    onClick={() => setShowBcc(true)}
                  >
                    Bcc
                  </button>
                )}
              </div>
            </div>
            {showCc && (
              <div className="flex items-center gap-2">
                <label className="w-14 shrink-0 text-sm font-medium text-gray-700">Cc</label>
                <input
                  type="email"
                  value={cc}
                  onChange={(e) => setCc(e.target.value)}
                  className="input min-h-10 flex-1 text-sm"
                />
              </div>
            )}
            {showBcc && (
              <div className="flex items-center gap-2">
                <label className="w-14 shrink-0 text-sm font-medium text-gray-700">Bcc</label>
                <input
                  type="email"
                  value={bcc}
                  onChange={(e) => setBcc(e.target.value)}
                  className="input min-h-10 flex-1 text-sm"
                />
              </div>
            )}
            <div className="flex items-center gap-2">
              <label className="w-14 shrink-0 text-sm font-medium text-gray-700">Subject</label>
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="input min-h-10 flex-1 text-sm"
              />
            </div>
          </div>

          <SimpleRichTextEditor value={bodyHtml} onChange={setBodyHtml} minHeightClass="min-h-[240px]" />

          <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
            <label className="flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                checked={attachPdf}
                onChange={(e) => setAttachPdf(e.target.checked)}
                className="mt-1 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
              />
              <span className="text-sm font-medium text-gray-900">{template.attachmentLabel}</span>
            </label>
            {attachPdf && (
              <div className="mt-3 flex items-center gap-2 rounded border border-dashed border-blue-300 bg-white px-3 py-2">
                <FileText className="h-8 w-8 text-red-500" />
                <span className="text-sm font-medium text-gray-800">{pdfName}</span>
              </div>
            )}
            <button
              type="button"
              className="mt-3 flex items-center gap-1 text-sm text-gray-600"
              disabled
            >
              <Paperclip className="h-4 w-4" />
              0 Attachments
            </button>
          </div>
        </div>

        <div className="flex items-center gap-3 border-t border-border px-5 py-4">
          <Button onClick={handleSend} isLoading={sending} disabled={sending}>
            Send
          </Button>
          <Button variant="secondary" onClick={onClose} disabled={sending}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}
