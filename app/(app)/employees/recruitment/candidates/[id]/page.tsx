'use client';

export const dynamic = 'force-dynamic';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useAuthorizationGuard } from '@/hooks/useAuthorizationGuard';
import { AccessDenied } from '@/components/common/AccessDenied';
import { ListPageHeader } from '@/components/layout/ListPageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Chip } from '@/components/ui/Chip';
import { Toast, ToastType } from '@/components/ui/Toast';
import { InvitePortalModal } from '@/components/hr/recruitment/InvitePortalModal';
import { SubmitOfferApprovalModal } from '@/components/hr/recruitment/SubmitOfferApprovalModal';
import { OfferApprovalTimeline } from '@/components/hr/recruitment/OfferApprovalTimeline';
import type { OfferApprovalRow } from '@/lib/hr/recruitment/offer-approval';

export default function CandidateWorkflowPage() {
  const params = useParams();
  const router = useRouter();
  const candidateId = String(params?.id ?? '');
  const { business, user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [candidate, setCandidate] = useState<Record<string, unknown> | null>(null);
  const [stages, setStages] = useState<{ id: string; stage_name: string }[]>([]);
  const [interviews, setInterviews] = useState<Record<string, unknown>[]>([]);
  const [offer, setOffer] = useState<Record<string, unknown> | null>(null);
  const [offerApprovals, setOfferApprovals] = useState<OfferApprovalRow[]>([]);
  const [documents, setDocuments] = useState<Record<string, unknown>[]>([]);
  const [onboardingTasks, setOnboardingTasks] = useState<Record<string, unknown>[]>([]);
  const [scheduleStageId, setScheduleStageId] = useState('');
  const [scheduledAt, setScheduledAt] = useState('');
  const [offerForm, setOfferForm] = useState({
    designation: '',
    department: '',
    joining_date: '',
    basic_salary: '',
    work_location: '',
    annual_bonus: '',
    notice_period_days: '30',
    probation_months: '3',
    signatory_name: '',
    signatory_title: '',
    terms_text: '',
  });
  const [physicalVerified, setPhysicalVerified] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: ToastType } | null>(null);
  const [inviteModalOpen, setInviteModalOpen] = useState(false);
  const [approvalModalOpen, setApprovalModalOpen] = useState(false);
  const [approvalComment, setApprovalComment] = useState('');

  const { status: authStatus } = useAuthorizationGuard({
    resource: 'recruitment',
    action: 'read',
    skipCheck: !user?.id || !business?.id,
  });

  const qs = () =>
    new URLSearchParams({
      business_id: business!.id,
      user_id: user!.id,
    }).toString();

  const load = async () => {
    if (!business?.id || !user?.id) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/hr/recruitment/candidates/${candidateId}?${qs()}`);
      if (res.ok) {
        const data = await res.json();
        setCandidate(data.candidate);
        setStages(data.stages ?? []);
        setInterviews(data.interviews ?? []);
        setOffer(data.offer ?? null);
        setOfferApprovals(data.offer_approvals ?? []);
        setDocuments(data.documents ?? []);
        setOnboardingTasks(data.onboarding_tasks ?? []);
        if (data.offer) {
          const o = data.offer;
          setOfferForm({
            designation: String(o.designation ?? ''),
            department: String(o.department ?? ''),
            joining_date: String(o.joining_date ?? '').slice(0, 10),
            basic_salary: String(o.basic_salary ?? ''),
            work_location: String(o.work_location ?? ''),
            annual_bonus: String(o.annual_bonus ?? ''),
            notice_period_days: String(o.notice_period_days ?? '30'),
            probation_months: String(o.probation_months ?? '3'),
            signatory_name: String(o.signatory_name ?? ''),
            signatory_title: String(o.signatory_title ?? ''),
            terms_text: String(o.terms_text ?? ''),
          });
        }
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [business?.id, user?.id, candidateId]);

  const scheduleInterview = async () => {
    if (!scheduleStageId) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/hr/recruitment/candidates/${candidateId}/interviews?${qs()}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: business!.id,
          user_id: user!.id,
          stage_id: scheduleStageId,
          scheduled_at: scheduledAt || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setToast({ message: data.error || 'Failed to schedule', type: 'error' });
        return;
      }
      await load();
    } finally {
      setBusy(false);
    }
  };

  const updateInterview = async (interviewId: string, status: string) => {
    setBusy(true);
    try {
      await fetch(`/api/hr/recruitment/candidates/${candidateId}/interviews/${interviewId}?${qs()}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ business_id: business!.id, user_id: user!.id, status }),
      });
      await load();
    } finally {
      setBusy(false);
    }
  };

  const saveOffer = async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/hr/recruitment/candidates/${candidateId}/offer?${qs()}`, {
        method: offer ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: business!.id,
          user_id: user!.id,
          ...offerForm,
          basic_salary: Number(offerForm.basic_salary),
          annual_bonus: Number(offerForm.annual_bonus || 0),
          notice_period_days: Number(offerForm.notice_period_days || 30),
          probation_months: Number(offerForm.probation_months || 0),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setToast({ message: data.error || 'Failed to save offer', type: 'error' });
        return;
      }
      await load();
    } finally {
      setBusy(false);
    }
  };

  const sendOffer = async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/hr/recruitment/candidates/${candidateId}/offer?${qs()}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ business_id: business!.id, user_id: user!.id, action: 'send' }),
      });
      const data = await res.json();
      if (!res.ok) {
        setToast({ message: data.error || 'Failed to send offer', type: 'error' });
        return;
      }
      setToast({ message: `Offer sent. Portal: ${data.portal_url}`, type: 'success' });
      await load();
    } finally {
      setBusy(false);
    }
  };

  const resetOfferDraft = async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/hr/recruitment/candidates/${candidateId}/offer?${qs()}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ business_id: business!.id, user_id: user!.id, action: 'reset_to_draft' }),
      });
      const data = await res.json();
      if (!res.ok) {
        setToast({ message: data.error || 'Failed to reset offer', type: 'error' });
        return;
      }
      await load();
    } finally {
      setBusy(false);
    }
  };

  const decideOffer = async (action: 'approve' | 'reject') => {
    setBusy(true);
    try {
      const res = await fetch(`/api/hr/recruitment/candidates/${candidateId}/offer?${qs()}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: business!.id,
          user_id: user!.id,
          action,
          comments: approvalComment.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setToast({ message: data.error || 'Action failed', type: 'error' });
        return;
      }
      setApprovalComment('');
      setToast({
        message: action === 'approve' ? 'Offer approved' : 'Offer rejected',
        type: 'success',
      });
      await load();
    } finally {
      setBusy(false);
    }
  };

  const verifyDoc = async (documentId: string, verification_status: 'approved' | 'rejected') => {
    setBusy(true);
    try {
      await fetch(`/api/hr/recruitment/candidates/${candidateId}/documents?${qs()}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: business!.id,
          user_id: user!.id,
          document_id: documentId,
          verification_status,
        }),
      });
      await load();
    } finally {
      setBusy(false);
    }
  };

  const inviteToPortal = () => {
    setInviteModalOpen(true);
  };

  const reviewTask = async (taskId: string, action: 'approve' | 'request_changes') => {
    setBusy(true);
    try {
      const res = await fetch(
        `/api/hr/recruitment/candidates/${candidateId}/tasks/${taskId}/review?${qs()}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ business_id: business!.id, user_id: user!.id, action }),
        },
      );
      const data = await res.json();
      if (!res.ok) {
        setToast({ message: data.error || 'Review failed', type: 'error' });
        return;
      }
      await load();
    } finally {
      setBusy(false);
    }
  };

  const convertToEmployee = async () => {
    if (!physicalVerified) {
      setToast({ message: 'Confirm physical document verification first', type: 'error' });
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/hr/recruitment/candidates/${candidateId}/convert?${qs()}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: business!.id,
          user_id: user!.id,
          physical_documents_verified: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setToast({ message: data.error || 'Conversion failed', type: 'error' });
        return;
      }
      setToast({ message: 'Candidate converted to employee', type: 'success' });
      router.push(`/employees/${data.employee_id}`);
    } finally {
      setBusy(false);
    }
  };

  if (authStatus === 'loading' || loading) {
    return (
      <div className="flex h-[calc(100vh-100px)] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary-600" />
      </div>
    );
  }
  if (authStatus === 'denied') return <AccessDenied module="recruitment" action="read" />;

  const status = String(candidate?.status ?? '');
  const canConvert = !candidate?.employee_id && ['offer_accepted', 'docs_verified', 'docs_submitted', 'ready_to_join'].includes(status);
  const offerStatus = String(offer?.status ?? '');
  const canEditOffer = !offer || ['draft', 'approval_rejected'].includes(offerStatus);
  const activePendingApproval = [...offerApprovals]
    .filter((a) => a.status === 'pending')
    .sort((a, b) => a.approval_level - b.approval_level)[0];
  const isMyApprovalTurn =
    offerStatus === 'pending_approval' &&
    activePendingApproval &&
    user?.id === activePendingApproval.approver_user_id;
  const pdfPreviewUrl = offer
    ? `/api/hr/recruitment/candidates/${candidateId}/offer/pdf?${qs()}`
    : null;

  return (
    <div className="space-y-6 p-4 md:p-6">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      {business?.id && user?.id && (
        <SubmitOfferApprovalModal
          open={approvalModalOpen}
          onClose={() => setApprovalModalOpen(false)}
          businessId={business.id}
          userId={user.id}
          candidateId={candidateId}
          onSubmitted={() => {
            setToast({ message: 'Offer submitted for internal approval', type: 'success' });
            void load();
          }}
          onError={(msg) => setToast({ message: msg, type: 'error' })}
        />
      )}
      {business?.id && user?.id && (
        <InvitePortalModal
          open={inviteModalOpen}
          onClose={() => setInviteModalOpen(false)}
          candidateName={String(candidate?.full_name ?? 'Candidate')}
          businessId={business.id}
          userId={user.id}
          candidateId={candidateId}
          onSuccess={(msg) => {
            setToast({ message: msg, type: 'success' });
            void load();
          }}
          onError={(msg) => setToast({ message: msg, type: 'error' })}
        />
      )}
      <ListPageHeader
        title={String(candidate?.full_name ?? 'Candidate')}
        description={`${candidate?.job_title} · ${candidate?.email}`}
        actions={<Chip>{status.replace(/_/g, ' ')}</Chip>}
      />

      <Card className="space-y-3 p-4">
        <h2 className="font-semibold text-text-primary">Interviews</h2>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-sm">
            <span className="text-text-secondary">Round</span>
            <select
              className="mt-1 block rounded-md border border-border px-3 py-2 text-sm"
              value={scheduleStageId}
              onChange={(e) => setScheduleStageId(e.target.value)}
            >
              <option value="">Select round</option>
              {stages.map((s) => (
                <option key={s.id} value={s.id}>{s.stage_name}</option>
              ))}
            </select>
          </label>
          <Input
            label="Schedule"
            type="datetime-local"
            value={scheduledAt}
            onChange={(e) => setScheduledAt(e.target.value)}
          />
          <Button type="button" onClick={scheduleInterview} disabled={busy}>Schedule</Button>
        </div>
        <ul className="divide-y divide-border">
          {interviews.map((i) => (
            <li key={String(i.id)} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <span>{String(i.stage_name)} — {String(i.status)}</span>
              <div className="flex gap-2">
                <Button type="button" variant="secondary" size="sm" onClick={() => updateInterview(String(i.id), 'passed')}>Pass</Button>
                <Button type="button" variant="secondary" size="sm" onClick={() => updateInterview(String(i.id), 'failed')}>Fail</Button>
              </div>
            </li>
          ))}
        </ul>
      </Card>

      <Card className="space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold text-text-primary">Onboarding tasks</h2>
          <Button type="button" variant="secondary" size="sm" onClick={inviteToPortal} disabled={busy}>
            Invite to portal
          </Button>
        </div>
        <p className="text-sm text-text-secondary">
          Candidate completes info collection before you can send an offer. Approve each submitted task.
        </p>
        {onboardingTasks.length === 0 ? (
          <p className="text-sm text-text-muted">No tasks assigned — use Invite to portal.</p>
        ) : (
          <ul className="divide-y divide-border">
            {onboardingTasks.map((t) => (
              <li key={String(t.id)} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span>
                  {String(t.name)} — <span className="text-text-secondary">{String(t.status).replace(/_/g, ' ')}</span>
                </span>
                <div className="flex flex-wrap gap-2">
                  <Link href={`/employees/recruitment/candidates/${candidateId}/tasks/${String(t.id)}`}>
                    <Button type="button" variant="secondary" size="sm">
                      Review
                    </Button>
                  </Link>
                  {t.status === 'submitted' && (
                    <>
                      <Button type="button" variant="secondary" size="sm" onClick={() => reviewTask(String(t.id), 'approve')}>
                        Approve
                      </Button>
                      <Button type="button" variant="secondary" size="sm" onClick={() => reviewTask(String(t.id), 'request_changes')}>
                        Request changes
                      </Button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="space-y-3 p-4">
        <h2 className="font-semibold text-text-primary">Offer letter</h2>
        <p className="text-sm text-text-secondary">
          Save a draft, submit for internal approval (pick approvers per offer), then send to the candidate portal.
        </p>
        <div className="grid gap-3 md:grid-cols-2">
          <Input label="Designation" value={offerForm.designation} disabled={!canEditOffer} onChange={(e) => setOfferForm({ ...offerForm, designation: e.target.value })} />
          <Input label="Department" value={offerForm.department} disabled={!canEditOffer} onChange={(e) => setOfferForm({ ...offerForm, department: e.target.value })} />
          <Input label="Joining date" type="date" value={offerForm.joining_date} disabled={!canEditOffer} onChange={(e) => setOfferForm({ ...offerForm, joining_date: e.target.value })} />
          <Input label="Basic salary (monthly)" type="number" value={offerForm.basic_salary} disabled={!canEditOffer} onChange={(e) => setOfferForm({ ...offerForm, basic_salary: e.target.value })} />
          <Input label="Work location" value={offerForm.work_location} disabled={!canEditOffer} onChange={(e) => setOfferForm({ ...offerForm, work_location: e.target.value })} />
          <Input label="Annual bonus" type="number" value={offerForm.annual_bonus} disabled={!canEditOffer} onChange={(e) => setOfferForm({ ...offerForm, annual_bonus: e.target.value })} />
          <Input label="Notice period (days)" type="number" value={offerForm.notice_period_days} disabled={!canEditOffer} onChange={(e) => setOfferForm({ ...offerForm, notice_period_days: e.target.value })} />
          <Input label="Probation (months)" type="number" value={offerForm.probation_months} disabled={!canEditOffer} onChange={(e) => setOfferForm({ ...offerForm, probation_months: e.target.value })} />
          <Input label="Signatory name" value={offerForm.signatory_name} disabled={!canEditOffer} onChange={(e) => setOfferForm({ ...offerForm, signatory_name: e.target.value })} />
          <Input label="Signatory title" value={offerForm.signatory_title} disabled={!canEditOffer} onChange={(e) => setOfferForm({ ...offerForm, signatory_title: e.target.value })} />
        </div>
        <label className="block text-sm">
          <span className="text-text-secondary">Additional terms</span>
          <textarea
            className="mt-1 block w-full rounded-md border border-border px-3 py-2 text-sm disabled:bg-gray-50"
            rows={3}
            disabled={!canEditOffer}
            value={offerForm.terms_text}
            onChange={(e) => setOfferForm({ ...offerForm, terms_text: e.target.value })}
          />
        </label>

        {offerApprovals.length > 0 && <OfferApprovalTimeline approvals={offerApprovals} />}

        {isMyApprovalTurn && (
          <div className="rounded-lg border border-border bg-gray-50 p-3 space-y-2">
            <p className="text-sm font-medium text-text-primary">Your approval is required</p>
            <textarea
              className="w-full rounded-md border border-border px-3 py-2 text-sm"
              rows={2}
              placeholder="Optional comment"
              value={approvalComment}
              onChange={(e) => setApprovalComment(e.target.value)}
            />
            <div className="flex gap-2">
              <Button type="button" onClick={() => decideOffer('approve')} disabled={busy}>Approve</Button>
              <Button type="button" variant="secondary" onClick={() => decideOffer('reject')} disabled={busy}>Reject</Button>
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {canEditOffer && (
            <Button type="button" onClick={saveOffer} disabled={busy}>Save draft</Button>
          )}
          {offerStatus === 'draft' && (
            <Button type="button" variant="secondary" onClick={() => setApprovalModalOpen(true)} disabled={busy}>
              Submit for approval
            </Button>
          )}
          {offerStatus === 'approval_rejected' && (
            <Button type="button" variant="secondary" onClick={resetOfferDraft} disabled={busy}>
              Edit &amp; resubmit
            </Button>
          )}
          {offerStatus === 'approved' && (
            <Button type="button" onClick={sendOffer} disabled={busy}>Send to candidate</Button>
          )}
          {offer && pdfPreviewUrl && ['pending_approval', 'approved', 'sent', 'viewed', 'accepted'].includes(offerStatus) && (
            <a
              href={pdfPreviewUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm link-primary"
            >
              Preview PDF
            </a>
          )}
          {offer && (
            <p className="text-sm text-text-secondary">Status: {offerStatus.replace(/_/g, ' ')}</p>
          )}
        </div>
      </Card>

      <Card className="space-y-3 p-4">
        <h2 className="font-semibold text-text-primary">Documents</h2>
        {documents.length === 0 ? (
          <p className="text-sm text-text-secondary">No documents uploaded yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {documents.map((d) => (
              <li key={String(d.id)} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span>{String(d.document_type)} — {String(d.file_name)} ({String(d.verification_status)})</span>
                {d.verification_status === 'pending' && (
                  <div className="flex gap-2">
                    <Button type="button" variant="secondary" size="sm" onClick={() => verifyDoc(String(d.id), 'approved')}>Approve</Button>
                    <Button type="button" variant="secondary" size="sm" onClick={() => verifyDoc(String(d.id), 'rejected')}>Reject</Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {canConvert && (
        <Card className="space-y-3 border border-border p-4">
          <h2 className="font-semibold text-text-primary">Joining — convert to employee</h2>
          <p className="text-sm text-text-secondary">
            Manual step on joining date after physical document verification. Salary structure is created from the accepted offer.
          </p>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={physicalVerified} onChange={(e) => setPhysicalVerified(e.target.checked)} />
            Physical documents verified in person
          </label>
          <Button type="button" onClick={convertToEmployee} disabled={busy || !physicalVerified}>
            Convert to employee
          </Button>
        </Card>
      )}

      {candidate?.employee_id ? (
        <p className="text-sm">
          Already joined.{' '}
          <Link href={`/employees/${String(candidate.employee_id)}`} className="link-primary">
            View employee profile
          </Link>
        </p>
      ) : null}
    </div>
  );
}
