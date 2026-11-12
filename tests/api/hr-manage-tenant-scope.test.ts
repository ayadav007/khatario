/**
 * Exit checklist, convert-to-employee and interview writes act only inside the session business.
 * A foreign exit / reporting manager / interviewer id is refused with 404 and nothing is written.
 * DB, session and authorization are mocked.
 */
import { NextRequest } from 'next/server';

type Call = { sql: string; params: unknown[] };
const calls: Call[] = [];

const OWN_EXIT = 'e0000000-0000-4000-8000-000000000001';
const FOREIGN_EXIT = 'e0000000-0000-4000-8000-000000000002';
const OWN_EMP = 'a0000000-0000-4000-8000-000000000001';
const FOREIGN_EMP = 'a0000000-0000-4000-8000-000000000002';
const OWN_USER = 'b0000000-0000-4000-8000-000000000001';
const FOREIGN_USER = 'b0000000-0000-4000-8000-000000000002';
const CAND = 'c0000000-0000-4000-8000-000000000001';

function answer(sql: string, params: unknown[] = []) {
  calls.push({ sql, params });
  const inSession = params.includes('biz-session');
  if (/^\s*SELECT[\s\S]*FROM employee_exits\b/i.test(sql)) {
    return { rows: params[0] === OWN_EXIT && inSession ? [{ id: OWN_EXIT }] : [] };
  }
  if (/^\s*SELECT[\s\S]*FROM employees\b/i.test(sql)) {
    return { rows: params[0] === OWN_EMP && inSession ? [{ id: OWN_EMP }] : [] };
  }
  // Membership: OWN_USER belongs to the session business through user_businesses, whatever its home business is.
  if (/^\s*SELECT[\s\S]*FROM user_businesses\b/i.test(sql)) {
    return { rows: params[0] === OWN_USER && inSession ? [{ one: 1 }] : [] };
  }
  if (/^\s*SELECT[\s\S]*FROM users\b/i.test(sql)) return { rows: [] }; // a home-business lookup would refuse the member
  if (/^\s*SELECT[\s\S]*FROM hr_exit_tasks\b/i.test(sql)) {
    return { rows: params[0] === OWN_EXIT && params[1] === 't1' ? [{ id: 't1' }] : [] };
  }
  if (/^\s*SELECT[\s\S]*FROM recruitment_candidates\b/i.test(sql)) {
    return { rows: inSession && params[0] === CAND ? [{ id: CAND, job_id: 'job-1' }] : [] };
  }
  if (/^\s*SELECT[\s\S]*FROM recruitment_job_interview_stages\b/i.test(sql)) return { rows: [{ id: 'stage-1' }] };
  return { rows: [{ id: 'row' }], rowCount: 1 };
}

jest.mock('@/lib/db', () => ({
  query: async (sql: string, params?: unknown[]) => answer(sql, params),
  queryOne: async (sql: string, params?: unknown[]) => answer(sql, params).rows[0] ?? null,
  queryRows: async (sql: string, params?: unknown[]) => answer(sql, params).rows,
}));
jest.mock('@/lib/authorization', () => ({
  authorize: jest.fn().mockResolvedValue(undefined),
  AuthorizationError: class extends Error {
    toNextResponse() {
      return new Response('denied', { status: 403 });
    }
  },
}));
const convert = jest.fn().mockResolvedValue({ employee_id: 'emp', salary_structure_id: 'sal' });
jest.mock('@/lib/hr/recruitment/convert-candidate', () => ({
  convertCandidateToEmployee: (...a: unknown[]) => convert(...a),
}));
jest.mock('@/lib/hr/exit-approval', () => ({ decideExitApproval: jest.fn() }));

import { PATCH as exitPatch } from '@/app/api/hr/exits/[id]/route';
import { POST as convertPost } from '@/app/api/hr/recruitment/candidates/[id]/convert/route';
import { POST as interviewPost } from '@/app/api/hr/recruitment/candidates/[id]/interviews/route';
import { PATCH as interviewPatch } from '@/app/api/hr/recruitment/candidates/[id]/interviews/[interviewId]/route';

const headers = {
  'content-type': 'application/json',
  'x-authenticated-user-id': 'user-1',
  'x-authenticated-business-id': 'biz-session',
};
const req = (method: string, body: unknown) =>
  new NextRequest('http://localhost/x', { method, headers, body: JSON.stringify(body) });
const writes = () => calls.filter((c) => /^\s*(INSERT|UPDATE|DELETE)/i.test(c.sql));

beforeEach(() => {
  calls.length = 0;
  convert.mockClear();
});

describe('exit checklist', () => {
  it('foreign exit: 404, nothing written', async () => {
    const res = await exitPatch(req('PATCH', { action: 'update_task', task_id: 't1', status: 'completed' }), { params: { id: FOREIGN_EXIT } });
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('Exit not found');
    expect(writes()).toHaveLength(0);
  });
  it('own exit, task of another exit: 404 Task not found, nothing written', async () => {
    const res = await exitPatch(req('PATCH', { action: 'update_task', task_id: 'other-task', status: 'completed' }), { params: { id: OWN_EXIT } });
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('Task not found');
    expect(writes()).toHaveLength(0);
  });
  it('own exit: updates, scoped to the business', async () => {
    const res = await exitPatch(req('PATCH', { action: 'update_task', task_id: 't1', status: 'completed' }), { params: { id: OWN_EXIT } });
    expect(res.status).toBe(200);
    const w = writes();
    expect(w).toHaveLength(1);
    expect(w[0].params).toContain('biz-session');
    expect(w[0].sql).toMatch(/business_id/);
  });
});

describe('convert to employee', () => {
  it('foreign reporting manager: 404, convert not called', async () => {
    const res = await convertPost(req('POST', { physical_documents_verified: true, reporting_manager_id: FOREIGN_EMP }), { params: { id: CAND } });
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('Reporting manager not found');
    expect(convert).not.toHaveBeenCalled();
  });
  it('own reporting manager: converts', async () => {
    const res = await convertPost(req('POST', { physical_documents_verified: true, reporting_manager_id: OWN_EMP }), { params: { id: CAND } });
    expect(res.status).toBe(200);
    expect(convert).toHaveBeenCalledTimes(1);
  });
  it('no reporting manager: converts', async () => {
    const res = await convertPost(req('POST', { physical_documents_verified: true }), { params: { id: CAND } });
    expect(res.status).toBe(200);
  });
});

describe('interviews', () => {
  it('schedule with foreign interviewer: 404, nothing written', async () => {
    const res = await interviewPost(req('POST', { stage_id: 'stage-1', interviewer_user_id: FOREIGN_USER }), { params: { id: CAND } });
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('Interviewer not found');
    expect(writes()).toHaveLength(0);
  });
  it('schedule with a member whose home business is elsewhere: 201', async () => {
    const res = await interviewPost(req('POST', { stage_id: 'stage-1', interviewer_user_id: OWN_USER }), { params: { id: CAND } });
    expect(res.status).toBe(201);
  });
  it('update with foreign interviewer: 404, nothing written', async () => {
    const res = await interviewPatch(req('PATCH', { interviewer_user_id: FOREIGN_USER }), { params: { id: CAND, interviewId: 'i1' } });
    expect(res.status).toBe(404);
    expect(writes()).toHaveLength(0);
  });
  it('update with a member whose home business is elsewhere: 200', async () => {
    const res = await interviewPatch(req('PATCH', { interviewer_user_id: OWN_USER }), { params: { id: CAND, interviewId: 'i1' } });
    expect(res.status).toBe(200);
  });
});
