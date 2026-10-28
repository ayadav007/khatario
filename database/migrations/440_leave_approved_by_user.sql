-- leave_requests.approved_by pointed at employees(id), but every approve and reject path stores the
-- signed-in approver's users.id (app/api/employees/leave-requests/[id], lib/hr/leave/leave-request-approval).
-- An owner or manager is a user, so approving or rejecting any leave failed with
-- leave_requests_approved_by_fkey (staging QA F-027). The column now references users(id).
-- A value that is not a user (an employee id written before) is cleared; it identified no approver
-- the app could show.

ALTER TABLE leave_requests DROP CONSTRAINT IF EXISTS leave_requests_approved_by_fkey;

UPDATE leave_requests lr
   SET approved_by = NULL
 WHERE approved_by IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = lr.approved_by);

ALTER TABLE leave_requests
  ADD CONSTRAINT leave_requests_approved_by_fkey
  FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL;
