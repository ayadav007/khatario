'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  X,
  Mail,
  MessageCircle,
  Link as LinkIcon,
  Download,
  Check,
  Loader2,
  FileText,
  Image as ImageIcon,
} from 'lucide-react';
import {
  canUseNativeInvoiceShare,
  shareInvoiceNative,
  type InvoiceShareFormat,
} from '@/lib/share-invoice';
import { useAuth } from '@/contexts/AuthContext';
import { useToastContext } from '@/contexts/ToastContext';
import { copyTextToClipboard } from '@/lib/clipboard';

interface ShareInvoiceModalProps {
  invoiceId: string;
  invoiceNumber: string;
  customerEmail?: string;
  customerPhone?: string;
  onClose: () => void;
  onCreateAnother?: () => void;
}

export function ShareInvoiceModal({
  invoiceId,
  invoiceNumber,
  customerEmail,
  customerPhone,
  onClose,
  onCreateAnother,
}: ShareInvoiceModalProps) {
  const { business, user } = useAuth();
  const toast = useToastContext();
  const [sending, setSending] = useState(false);
  const [waSending, setWaSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [waSent, setWaSent] = useState(false);
  const [copied, setCopied] = useState(false);
  const [sendViaApi, setSendViaApi] = useState(true); // Toggle between API and WA Web
  const [publicShareUrl, setPublicShareUrl] = useState<string | null>(null);
  const [linkLoading, setLinkLoading] = useState(true);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [nativeFormatLoading, setNativeFormatLoading] = useState<InvoiceShareFormat | null>(null);
  const showNativeShare = canUseNativeInvoiceShare();

  const resolvePublicUrl = useCallback(async (): Promise<string | null> => {
    if (publicShareUrl) return publicShareUrl;
    const res = await fetch(`/api/invoices/${invoiceId}/public-link`);
    const data = await res.json();
    if (!res.ok) {
      setLinkError(data.error || 'Public link not available');
      return null;
    }
    setPublicShareUrl(data.public_url);
    setLinkError(null);
    return data.public_url as string;
  }, [invoiceId, publicShareUrl]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLinkLoading(true);
      const res = await fetch(`/api/invoices/${invoiceId}/public-link`);
      const data = await res.json();
      if (cancelled) return;
      if (res.ok) {
        setPublicShareUrl(data.public_url);
        setLinkError(null);
      } else {
        setLinkError(data.error || 'Finalize the invoice to get a share link.');
      }
      setLinkLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [invoiceId]);

  async function handleEmailSend() {
    if (!customerEmail) {
      toast.warning('Customer email not available');
      return;
    }

    setSending(true);
    try {
      const response = await fetch(`/api/invoices/${invoiceId}/email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipient_email: customerEmail,
        }),
      });

      if (response.ok) {
        setSent(true);
        setTimeout(() => {
          setSent(false);
        }, 3000);
      } else {
        const error = await response.json();
        toast.error(error.error || 'Failed to send email');
      }
    } catch (error) {
      console.error('Error sending email:', error);
        toast.error(
          'Failed to send email. Configure SMTP under Settings → Email for your business.'
        );
    } finally {
      setSending(false);
    }
  }

  async function handleWhatsAppSend() {
    if (!customerPhone) {
      toast.warning('Customer phone number not available');
      return;
    }

    const shareUrl = (await resolvePublicUrl()) ?? `${window.location.origin}/invoices/${invoiceId}/view`;
    const message = `Hello! Please view your invoice ${invoiceNumber} here: ${shareUrl}`;

    if (sendViaApi) {
        setWaSending(true);
        try {
            // First, generate the PDF to get a URL (assuming we have an endpoint that returns a public/temp URL)
            // Or, we can construct the PDF URL if the backend can access it locally.
            // Since we are running locally, let's assume the backend can render it on the fly.
            // We'll pass the invoice PDF endpoint as the mediaUrl.
            // Note: Baileys needs a reachable URL or a Buffer. 
            // If the backend is on the same server, we can handle this inside the send API 
            // by passing `invoiceId` instead of `mediaUrl` and letting the backend generate it.
            // But for now, let's stick to the interface and pass the PDF API URL.
            // Warning: If localhost, Baileys might not be able to fetch "localhost" if running in a container differently.
            // But usually, it works if they share network. Let's try passing the absolute URL.
            
            const response = await fetch(`/api/whatsapp/send`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    business_id: business?.id,
                    to: customerPhone,
                    message: message,
                    invoiceId: invoiceId // Pass ID to generate PDF on backend
                }),
            });

            const data = await response.json();

            if (response.ok) {
                setWaSent(true);
                setTimeout(() => setWaSent(false), 3000);
            } else {
                // If backend fails (e.g. not connected), fall back to Web or alert
                if (data.error && data.error.includes('not connected')) {
                    if (confirm('WhatsApp API is not connected. Open WhatsApp Web instead?')) {
                        openWhatsAppWeb(customerPhone, message);
                    }
                } else {
                    toast.error(data.error || 'Failed to send WhatsApp message');
                }
            }
        } catch (error) {
            console.error('Error sending WA:', error);
            toast.error('Failed to send via WhatsApp API');
        } finally {
            setWaSending(false);
        }
    } else {
        openWhatsAppWeb(customerPhone, message);
    }
  }

  function openWhatsAppWeb(phone: string, text: string) {
    const whatsappUrl = `https://wa.me/${phone.replace(/[^0-9]/g, '')}?text=${encodeURIComponent(text)}`;
    window.open(whatsappUrl, '_blank');
  }

  async function handleCopyLink() {
    const shareUrl = await resolvePublicUrl();
    if (!shareUrl) {
      toast.warning(linkError || 'Share link not available');
      return;
    }
    const ok = await copyTextToClipboard(shareUrl);
    if (!ok) {
      toast.error('Could not copy link. Try Download PDF or share via WhatsApp.');
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleDownloadPDF() {
    window.open(`/api/invoices/${invoiceId}/pdf?user_id=${user?.id}`, '_blank');
  }

  async function handleNativeShare(format: InvoiceShareFormat) {
    if (!user?.id) {
      toast.warning('Session not ready. Please try again.');
      return;
    }
    setNativeFormatLoading(format);
    try {
      const result = await shareInvoiceNative({
        invoiceId,
        invoiceNumber,
        businessName: business?.name,
        format,
        userId: user.id,
        businessId: business?.id,
      });
      if (result === 'shared' || result === 'cancelled') {
        onClose();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not share invoice';
      toast.error(message);
    } finally {
      setNativeFormatLoading(null);
    }
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl max-w-md w-full p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold text-gray-900">Share Invoice</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {sent && (
          <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-lg flex items-center space-x-2">
            <Check className="w-5 h-5 text-green-600" />
            <span className="text-sm text-green-800">Invoice sent successfully!</span>
          </div>
        )}

        <p className="text-gray-600 mb-6">
          Invoice: <span className="font-semibold">{invoiceNumber}</span>
        </p>

        {/* Share Options */}
        <div className="space-y-3">
          {showNativeShare && (
            <div className="space-y-2 rounded-lg border-2 border-gray-200 p-3">
              <p className="text-sm font-semibold text-gray-900 px-1">Share with apps</p>
              <p className="text-xs text-gray-500 px-1 mb-2">WhatsApp, Gmail, Drive — attach PDF or image</p>
              {(
                [
                  { format: 'pdf' as const, label: 'PDF attachment', icon: FileText, color: 'text-red-600' },
                  { format: 'image' as const, label: 'Image attachment', icon: ImageIcon, color: 'text-blue-600' },
                  { format: 'link' as const, label: 'Link only', icon: LinkIcon, color: 'text-purple-600' },
                ] as const
              ).map(({ format, label, icon: Icon, color }) => (
                <button
                  key={format}
                  type="button"
                  onClick={() => void handleNativeShare(format)}
                  disabled={nativeFormatLoading !== null || linkLoading}
                  className="w-full flex items-center gap-3 p-3 rounded-lg hover:bg-slate-50 transition disabled:opacity-60"
                >
                  <Icon className={`w-5 h-5 shrink-0 ${color}`} />
                  <span className="flex-1 text-left text-sm font-medium text-gray-900">{label}</span>
                  {nativeFormatLoading === format && (
                    <Loader2 className="w-4 h-4 animate-spin text-primary-600" />
                  )}
                </button>
              ))}
            </div>
          )}

          {/* Email */}
          <button
            onClick={handleEmailSend}
            disabled={sending || !customerEmail}
            className={`w-full flex items-center space-x-4 p-4 rounded-lg border-2 transition ${
              customerEmail
                ? 'border-gray-200 hover:border-primary-500 hover:bg-slate-50'
                : 'border-gray-100 bg-gray-50 cursor-not-allowed opacity-50'
            }`}
          >
            <div className="bg-slate-100 p-3 rounded-lg">
              <Mail className="w-6 h-6 text-primary-600" />
            </div>
            <div className="flex-1 text-left">
              <p className="font-semibold text-gray-900">Send via Email</p>
              <p className="text-sm text-gray-600">
                {customerEmail || 'No email available'}
              </p>
            </div>
            {sending && <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-primary-600"></div>}
          </button>

          {/* WhatsApp */}
          <div className="space-y-2">
            <button
              onClick={handleWhatsAppSend}
              disabled={!customerPhone || waSending}
              className={`w-full flex items-center space-x-4 p-4 rounded-lg border-2 transition ${
                customerPhone
                  ? 'border-gray-200 hover:border-green-500 hover:bg-green-50'
                  : 'border-gray-100 bg-gray-50 cursor-not-allowed opacity-50'
              }`}
            >
              <div className="bg-green-100 p-3 rounded-lg">
                {waSending ? (
                    <Loader2 className="w-6 h-6 text-green-600 animate-spin" />
                ) : waSent ? (
                    <Check className="w-6 h-6 text-green-600" />
                ) : (
                    <MessageCircle className="w-6 h-6 text-green-600" />
                )}
              </div>
              <div className="flex-1 text-left">
                <p className="font-semibold text-gray-900">
                    {waSent ? 'Sent Successfully!' : 'Send via WhatsApp'}
                </p>
                <p className="text-sm text-gray-600">
                  {customerPhone || 'No phone number available'}
                </p>
              </div>
            </button>
            <div className="flex items-center justify-end px-1">
                <label className="flex items-center space-x-2 cursor-pointer text-xs text-gray-500">
                    <input 
                        type="checkbox" 
                        checked={sendViaApi} 
                        onChange={(e) => setSendViaApi(e.target.checked)}
                        className="rounded border-gray-300 text-green-600 focus:ring-green-500"
                    />
                    <span>Use Connected Account (Baileys)</span>
                </label>
            </div>
          </div>

          {/* Copy Link */}
          <button
            onClick={handleCopyLink}
            className="w-full flex items-center space-x-4 p-4 rounded-lg border-2 border-gray-200 hover:border-purple-500 hover:bg-purple-50 transition"
          >
            <div className="bg-purple-100 p-3 rounded-lg">
              <LinkIcon className="w-6 h-6 text-purple-600" />
            </div>
            <div className="flex-1 text-left">
              <p className="font-semibold text-gray-900">Copy Link</p>
              <p className="text-sm text-gray-600">
                {copied ? 'Link copied!' : 'Share via any app'}
              </p>
            </div>
          </button>

          {/* Download PDF */}
          <button
            onClick={handleDownloadPDF}
            className="w-full flex items-center space-x-4 p-4 rounded-lg border-2 border-gray-200 hover:border-orange-500 hover:bg-orange-50 transition"
          >
            <div className="bg-orange-100 p-3 rounded-lg">
              <Download className="w-6 h-6 text-orange-600" />
            </div>
            <div className="flex-1 text-left">
              <p className="font-semibold text-gray-900">Download PDF</p>
              <p className="text-sm text-gray-600">Save to your device</p>
            </div>
          </button>
        </div>

        {/* Create Another Invoice Button */}
        {onCreateAnother && (
          <div className="mt-6 pt-6 border-t border-gray-200">
            <button
              onClick={() => {
                onCreateAnother();
                onClose();
              }}
              className="w-full flex items-center justify-center space-x-2 p-4 rounded-lg bg-primary-600 hover:bg-primary-700 text-white font-semibold transition"
            >
              <span>Create Another Invoice</span>
            </button>
            <p className="text-xs text-center text-gray-500 mt-2">
              Start a new invoice with a clean form
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

