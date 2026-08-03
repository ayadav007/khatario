'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Loader2, LogOut, Upload } from 'lucide-react';
import { useCandidatePortal } from './CandidatePortalContext';

type Offer = Record<string, unknown> | null;
type Doc = {
  id: string;
  document_type: string;
  file_name: string;
  verification_status: string;
  rejection_reason?: string | null;
};

function formatMoney(v: unknown) {
  return `₹${Number(v ?? 0).toLocaleString('en-IN')}`;
}

export function CandidatePortalHome() {
  const { session, logout, refresh } = useCandidatePortal();
  const [offer, setOffer] = useState<Offer>(null);
  const [documents, setDocuments] = useState<Doc[]>([]);
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [docType, setDocType] = useState('aadhaar');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [offerRes, docsRes] = await Promise.all([
        fetch('/api/public/candidate/session/offer', { credentials: 'include' }),
        fetch('/api/public/candidate/session/documents', { credentials: 'include' }),
      ]);
      if (offerRes.ok) {
        const data = await offerRes.json();
        setOffer(data.offer ?? null);
      }
      if (docsRes.ok) {
        const data = await docsRes.json();
        setDocuments(data.documents ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const acceptOffer = async () => {
    setAccepting(true);
    setError(null);
    try {
      const res = await fetch('/api/public/candidate/session/offer', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'accept' }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Could not accept offer');
        return;
      }
      setMessage('Offer accepted. Please upload your documents below.');
      await refresh();
      await load();
    } finally {
      setAccepting(false);
    }
  };

  const uploadDoc = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('document_type', docType);
      const res = await fetch('/api/public/candidate/session/documents', {
        method: 'POST',
        credentials: 'include',
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Upload failed');
        return;
      }
      setMessage('Document uploaded for verification.');
      await load();
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  if (!session) return null;

  const canAccept = offer && ['sent', 'viewed'].includes(String(offer.status));
  const canUpload = offer && ['accepted'].includes(String(offer.status)) ||
    ['offer_accepted', 'docs_submitted', 'docs_verified', 'ready_to_join'].includes(session.candidate.status);

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-white px-4 py-4">
        <div className="mx-auto flex max-w-3xl items-center justify-between">
          <div>
            <p className="text-sm text-text-secondary">{session.business.name}</p>
            <h1 className="text-lg font-semibold text-text-primary">Hello, {session.candidate.name}</h1>
            <p className="text-sm text-text-muted">{session.candidate.job_title}</p>
          </div>
          <button type="button" onClick={logout} className="flex items-center gap-1 text-sm text-text-secondary">
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-4 p-4">
        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-text-muted" />
          </div>
        ) : (
          <>
            {message && (
              <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
                {message}
              </div>
            )}
            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                {error}
              </div>
            )}

            <Card className="p-4">
              <h2 className="text-base font-semibold text-text-primary">Offer letter</h2>
              {!offer ? (
                <p className="mt-2 text-sm text-text-secondary">No offer has been released yet.</p>
              ) : (
                <div className="mt-3 space-y-2 text-sm">
                  <p><span className="text-text-secondary">Designation:</span> {String(offer.designation)}</p>
                  <p><span className="text-text-secondary">Joining date:</span> {String(offer.joining_date).slice(0, 10)}</p>
                  <p><span className="text-text-secondary">Basic salary:</span> {formatMoney(offer.basic_salary)}</p>
                  <p><span className="text-text-secondary">Status:</span> {String(offer.status)}</p>
                  {offer.terms_text ? (
                    <p className="whitespace-pre-wrap text-text-secondary">{String(offer.terms_text)}</p>
                  ) : null}
                  {canAccept && (
                    <Button onClick={acceptOffer} disabled={accepting} className="mt-3">
                      {accepting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Accept offer'}
                    </Button>
                  )}
                </div>
              )}
            </Card>

            {(canUpload || documents.length > 0) && (
              <Card className="p-4">
                <h2 className="text-base font-semibold text-text-primary">Documents</h2>
                <p className="mt-1 text-sm text-text-secondary">
                  Upload Aadhaar, PAN, and other documents for HR verification.
                </p>

                {canUpload && (
                  <div className="mt-4 flex flex-wrap items-end gap-3">
                    <label className="text-sm text-text-secondary">
                      Document type
                      <select
                        className="mt-1 block w-full rounded-md border border-border px-3 py-2 text-sm"
                        value={docType}
                        onChange={(e) => setDocType(e.target.value)}
                      >
                        <option value="aadhaar">Aadhaar</option>
                        <option value="pan">PAN</option>
                        <option value="resume">Resume</option>
                        <option value="other">Other</option>
                      </select>
                    </label>
                    <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-2 text-sm">
                      <Upload className="h-4 w-4" />
                      {uploading ? 'Uploading…' : 'Choose file'}
                      <input type="file" className="hidden" accept=".pdf,image/*" onChange={uploadDoc} disabled={uploading} />
                    </label>
                  </div>
                )}

                <ul className="mt-4 divide-y divide-border">
                  {documents.map((d) => (
                    <li key={d.id} className="flex items-center justify-between py-2 text-sm">
                      <span>{d.document_type}: {d.file_name}</span>
                      <span className={
                        d.verification_status === 'approved'
                          ? 'text-green-700'
                          : d.verification_status === 'rejected'
                            ? 'text-red-600'
                            : 'text-amber-700'
                      }>
                        {d.verification_status}
                      </span>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </>
        )}
      </main>
    </div>
  );
}
