# W5: Responses (list + detail) design

Approved via browser mockup by Tanya on 2026-06-24
([docs/superpowers/mockups/w5-responses-mockup.html](../mockups/w5-responses-mockup.html)).
Lean/balanced pace. Ported from the prototype
[response-detail.jsx](../../../../hi-fi-intelli/project/apps/admin/screens/response-detail.jsx)
and [surveys.jsx](../../../../hi-fi-intelli/project/apps/admin/screens/surveys.jsx).

## Goal

See what reps submitted in store, scored live. **Responses are NOT a sidebar item**
(matching the prototype): they open as modals from the **Surveys** screen (each
survey row shows its response count, which opens a per-survey responses list, which
opens a single response's detail) and the same detail can open from the Analytics
drill. Pass/fail is computed live by the backend from each question's rule. Reuses
the W1/W3/W4 design system + UI kit. One small read-only backend enrichment; no
schema change.

## Backend (small read-only enrichment, no schema change)

`GET /responses` and `GET /responses/{id}` rows gain display names so the screen
reads naturally, via additive joins in `ScopedRepo.list_responses` /
`get_response` (api/app/scope.py):
- `store_name` (from the existing `nodes n` join, `n.name`),
- `survey_name` + `survey_version_number` (join `survey_versions` -> `surveys`),
- `rep_name` (join `users` on `r.user_id`).

Everything stays branch-scoped exactly as today; `overall`, `items`, and the
per-question `questions` verdict map are unchanged. No new columns, no new tables.

## Frontend (in `apps/admin/src/pages/Surveys/`, the entry point)

- **`useResponses.ts` (+ test):** `useResponses()` = `useQuery(['responses'], GET
  /responses)`; a pure `responsesForSurvey(rows, survey)` helper that filters rows
  to a survey's version ids and a `countBySurvey` helper for the row badge;
  `useResponseDetail(id, enabled)` = `useQuery(['response', id], GET
  /responses/{id})`. A pure `responseStatus(detail)` -> `{ pct, status:
  pass|partial|fail|na, scored, passed }` computed from the per-question verdicts
  (mirrors the prototype `responseSummary`).
- **`ResponsesListModal.tsx` (+ css):** opened for one survey. Title = "Submitted
  responses", subtitle = the survey name. Rows: rep `Avatar` + name, `store_name` +
  city/node, date, online/offline chip, the live result (% + pass/partial/fail
  `Chip`). Click a row -> the detail. Empty state when none.
- **`ResponseDetailModal.tsx` (+ css):** uses `useResponseDetail` for the answers
  (items + per-question verdicts + overall) and reuses `useSurveys`
  (the survey version's question definitions: text, type, pass rule, per-product
  flag) and `useCatalog` (SKU variant + colour) to render. Shows: a verdict header
  (rep `Avatar`, store, big % + status), a meta strip (node path, sync, frozen
  version), then per-question Answers: a type badge, a per-SKU chip, the pass-rule
  chip, a result badge (Pass/Fail/Not scored), and the answer body, including the
  **per-SKU facings grid** (one tinted cell per shade using the catalog colour, with
  the count and a pass/fail tick). Photo questions render a **"Photo coming soon"**
  placeholder (deferred to 5-BE-c). A "All responses" back button when opened from
  the list.
- **Wire into `SurveyList.tsx`:** each survey row gains a **"N responses"** button
  (count from `countBySurvey`, visible to all roles since viewing is not admin-only)
  that opens `ResponsesListModal` for that survey. Disabled at 0.
- **Analytics drill (optional, include if low-risk):** the dashboard's store-level
  drill can open `ResponseDetailModal` for that store's latest response. If it adds
  meaningful surface, defer it with a note rather than expand scope.

## Deliberately deferred
- **Shelf photos** (need object storage, 5-BE-c): placeholders only.
- **A rich response export** (there is `/export/responses`): not in W5; the
  dashboard already has a compliance CSV. Add later if wanted.
- **A standalone Responses page / sidebar item:** intentionally none (prototype parity).

## Tests (gate)
- **Backend** (`api/tests/test_responses.py`): assert `GET /responses` and
  `/responses/{id}` now include `store_name`, `survey_name`,
  `survey_version_number`, `rep_name`, still branch-scoped; full backend suite green.
- **Frontend:** `useResponses.test.ts` (the pure helpers: `responsesForSurvey`,
  `countBySurvey`, `responseStatus` for pass/partial/fail/na); `ResponsesListModal`
  renders rows and opens the detail; `ResponseDetailModal` renders the per-SKU grid
  with pass/fail and the photo placeholder; `SurveyList` shows the responses button
  and opens the modal. Suite green + `pnpm --filter @intelli/admin build` clean.

## Done = `pnpm test:api` + `pnpm test:admin` + build all green; the Surveys rows
open a per-survey responses list; a response opens the detail with live pass/fail
and the per-shade grid; docs updated; merged to `main` and deployed on Tanya's OK.
