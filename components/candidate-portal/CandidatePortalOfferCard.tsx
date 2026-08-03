'use client';



import { useCallback, useEffect, useState } from 'react';

import { CheckCircle2, Download, Loader2, X } from 'lucide-react';

import { Button } from '@/components/ui/Button';

import { Card } from '@/components/ui/Card';

import { SignaturePad } from '@/components/common/SignaturePad';



function formatAcceptedDate(iso: string) {

  return new Date(iso).toLocaleDateString('en-IN', {

    day: 'numeric',

    month: 'long',

    year: 'numeric',

  });

}



export function CandidatePortalOfferCard({ onAccepted }: { onAccepted?: () => void }) {

  const [loading, setLoading] = useState(true);

  const [offer, setOffer] = useState<Record<string, unknown> | null>(null);

  const [pdfUrl, setPdfUrl] = useState<string | null>(null);

  const [lockedReason, setLockedReason] = useState<string | null>(null);

  const [accepting, setAccepting] = useState(false);

  const [error, setError] = useState<string | null>(null);

  const [signModalOpen, setSignModalOpen] = useState(false);

  const [signature, setSignature] = useState<string | null>(null);



  const load = useCallback(async () => {

    setLoading(true);

    try {

      const res = await fetch('/api/public/candidate/session/offer', { credentials: 'include' });

      const data = await res.json();

      setOffer(data.offer ?? null);

      setPdfUrl(data.pdf_url ?? null);

      setLockedReason(data.locked_reason ?? null);

    } finally {

      setLoading(false);

    }

  }, []);



  useEffect(() => {

    void load();

  }, [load]);



  const accept = async () => {

    if (!signature) {

      setError('Please draw your signature');

      return;

    }

    setAccepting(true);

    setError(null);

    try {

      const res = await fetch('/api/public/candidate/session/offer', {

        method: 'PATCH',

        credentials: 'include',

        headers: { 'Content-Type': 'application/json' },

        body: JSON.stringify({ action: 'accept', signature_url: signature }),

      });

      const data = await res.json();

      if (!res.ok) {

        setError(data.error || 'Could not accept offer');

        return;

      }

      setSignModalOpen(false);

      await load();

      onAccepted?.();

    } finally {

      setAccepting(false);

    }

  };



  if (loading) {

    return (

      <Card className="flex justify-center p-8">

        <Loader2 className="h-6 w-6 animate-spin text-text-muted" />

      </Card>

    );

  }



  if (lockedReason && !offer) {

    return (

      <Card className="p-4">

        <h2 className="text-base font-semibold text-text-primary">Offer letter</h2>

        <p className="mt-2 text-sm text-text-secondary">{lockedReason}</p>

      </Card>

    );

  }



  if (!offer) return null;



  const status = String(offer.status);

  const canAccept = ['sent', 'viewed'].includes(status);

  const isAccepted = status === 'accepted';



  return (

    <>

      {isAccepted && offer.accepted_at ? (

        <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">

          <CheckCircle2 className="h-5 w-5 shrink-0" />

          <span>Offer letter accepted on {formatAcceptedDate(String(offer.accepted_at))}</span>

        </div>

      ) : null}



      <Card className="overflow-hidden p-0">

        <div className="flex items-center justify-between border-b border-border px-4 py-3">

          <h2 className="text-base font-semibold text-text-primary">Offer letter</h2>

          {pdfUrl ? (

            <a

              href={pdfUrl}

              download="offer-letter.pdf"

              className="inline-flex items-center gap-1 text-sm text-text-secondary hover:text-text-primary"

            >

              <Download className="h-4 w-4" />

              Download

            </a>

          ) : null}

        </div>



        {pdfUrl ? (

          <iframe

            src={pdfUrl}

            title="Offer letter"

            className="h-[min(70vh,720px)] w-full border-0 bg-white"

          />

        ) : (

          <div className="p-4 text-sm text-text-secondary">Offer document is not available yet.</div>

        )}



        {error ? <p className="px-4 pb-2 text-sm text-red-600">{error}</p> : null}



        {canAccept ? (

          <div className="border-t border-border px-4 py-3">

            <Button onClick={() => setSignModalOpen(true)} disabled={accepting}>

              Review &amp; accept offer

            </Button>

          </div>

        ) : null}

      </Card>



      {signModalOpen && (

        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">

          <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl bg-white shadow-lg">

            <div className="flex items-center justify-between border-b border-border px-4 py-3">

              <h3 className="font-semibold text-text-primary">Sign to accept</h3>

              <button type="button" onClick={() => setSignModalOpen(false)}>

                <X className="h-5 w-5 text-text-muted" />

              </button>

            </div>

            <div className="space-y-3 p-4">

              <p className="text-sm text-text-secondary">

                I agree to and accept the terms as set forth in this Offer letter. Draw your signature below.

              </p>

              <SignaturePad onChange={setSignature} />

              <div className="flex justify-end gap-2">

                <Button type="button" variant="secondary" onClick={() => setSignModalOpen(false)}>

                  Cancel

                </Button>

                <Button type="button" onClick={accept} disabled={accepting || !signature}>

                  {accepting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Accept offer'}

                </Button>

              </div>

            </div>

          </div>

        </div>

      )}

    </>

  );

}


