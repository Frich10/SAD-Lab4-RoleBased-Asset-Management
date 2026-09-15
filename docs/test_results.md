# Functional Test Results — Lab 4-A

Run each scenario against your **own deployed instance** (GitHub Pages URL + your
Supabase project) using at least three accounts: one Requester, one Staff, one Admin.
Fill in the **Actual Result** and **Pass/Fail** columns yourself — these can't be
completed until the app is deployed with real data.

| Test ID | Scenario | Expected Result | Actual Result | Pass/Fail |
|---|---|---|---|---|
| TC-A4-01 | Requester tries to open an Admin-only view (Approvals/Users/Audit Log) | Access denied / redirected to Dashboard | | |
| TC-A4-02 | Staff submits a borrowing request | Request saved as Pending | | |
| TC-A4-03 | Administrator approves a request | Status becomes Approved; audit log entry created | | |
| TC-A4-04 | Administrator rejects a request | Status becomes Rejected | | |
| TC-A4-05 | Attempt to release a Rejected request | Operation blocked with an error | | |
| TC-A4-06 | Release an Approved request | Equipment status becomes Borrowed | | |
| TC-A4-07 | Return a Released item | Transaction becomes Returned; equipment becomes Available (or Damaged) | | |
| TC-A4-08 | Check audit log after an approval | Approval entry visible with correct user/time | | |
| TC-A4-09 | Staff attempts a restricted action (e.g. deleting equipment) | Operation blocked (button hidden in UI, and rejected by RLS if called directly) | | |
| TC-A4-10 | Log out and open a protected page/URL | Redirected to login screen | | |

## Extra rule-specific checks (recommended)
| Check | Expected Result | Actual Result | Pass/Fail |
|---|---|---|---|
| Requester tries to request equipment already Borrowed/Maintenance | Blocked (button disabled in UI; insert rejected by trigger if forced) | | |
| Admin tries to approve their own submitted request | Blocked with "cannot approve your own request" error (BR-A4-02) | | |
| Staff tries to mark the same transaction Returned twice | Second attempt blocked (BR-A4-08) | | |

## Capturing the audit-log screenshot for submission
1. Log in as Administrator on your deployed site.
2. Perform a few actions first (submit, approve, release, return) so the log has entries.
3. Open **Audit Log** in the sidebar.
4. Take a screenshot showing at least 3–5 rows with Time / User / Action / Module / Description visible.
5. Save it as `docs/audit-log-screenshot.png` in your repository before submitting.
