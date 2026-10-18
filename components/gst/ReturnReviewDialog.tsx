'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/Button';
import type { AckIssue } from '@/lib/gst/acknowledgements';
import { describeAckIssue, reviewHeading } from '@/lib/gst/ack-issue-copy';
import { registerReturnReviewPrompt } from '@/lib/gst/return-review-prompt';

type ReviewRequest = {
  issues: AckIssue[];
  resolve: (accepted: boolean) => void;
};

export function ReturnReviewDialogHost() {
  const [request, setRequest] = useState<ReviewRequest | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    registerReturnReviewPrompt((next) => setRequest(next));
    return () => registerReturnReviewPrompt(null);
  }, []);

  function close(accepted: boolean) {
    request?.resolve(accepted);
    setRequest(null);
  }

  useEffect(() => {
    if (!request) return;
    const current = request;
    function onKey(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      current.resolve(false);
      setRequest(null);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [request]);

  if (!mounted || !request) return null;
  const items = request.issues.map((issue, index) => ({ id: `${issue.key}-${index}`, ...describeAckIssue(issue) }));

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/40 p-4 sm:items-center" role="presentation">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="return-review-title"
        className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-4 shadow-xl sm:p-6"
      >
        <h2 id="return-review-title" className="text-xl font-semibold text-slate-900">
          Review before download
        </h2>
        <p className="mt-2 text-base text-slate-700">{reviewHeading(request.issues.length)}</p>
        <ul className="mt-4 space-y-3">
          {items.map((item) => (
            <li key={item.id} className="rounded-xl bg-amber-50 px-3 py-3 text-slate-800">
              <p className="text-sm font-semibold">{item.title}</p>
              <p className="mt-1 text-sm leading-6">{item.detail}</p>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-sm leading-6 text-slate-600">
          The file is for upload only. Filing is recorded separately when you mark the return as filed.
        </p>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => close(false)}>Cancel</Button>
          <Button type="button" onClick={() => close(true)}>Continue</Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
