import type { AckIssue } from '@/lib/gst/acknowledgements';

type ReviewRequest = {
  issues: AckIssue[];
  resolve: (accepted: boolean) => void;
};

let opener: ((request: ReviewRequest) => void) | null = null;
const waiting: ReviewRequest[] = [];

export function registerReturnReviewPrompt(next: ((request: ReviewRequest) => void) | null) {
  opener = next;
  if (!next) return;
  const queued = waiting.splice(0);
  for (const request of queued) next(request);
}

export function confirmReturnReview(issues: AckIssue[]): Promise<boolean> {
  return new Promise((resolve) => {
    const request = { issues, resolve };
    if (opener) opener(request);
    else waiting.push(request);
  });
}
