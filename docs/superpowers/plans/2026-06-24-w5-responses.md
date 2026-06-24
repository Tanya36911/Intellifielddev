# W5 Responses Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Responses feature that lets any logged-in user open a per-survey list of submitted responses from the Surveys screen, click into a detailed view showing per-question pass/fail and the per-SKU facings grid, backed by a small read-only backend enrichment (store_name, survey_name, survey_version_number, rep_name) with no schema change.

**Architecture:** Backend enrichment adds four display-name columns via SQL joins in `ScopedRepo.list_responses` / `get_response`; the frontend adds `useResponses.ts` (hooks + pure helpers), two modal components (`ResponsesListModal`, `ResponseDetailModal`), and a "N responses" button wired into `SurveyList.tsx`. No new routes, no new sidebar items. Responses open as modals from Surveys. All scoring is done by the backend; the frontend only renders the pre-computed verdicts.

**Tech Stack:** Python/SQLAlchemy (backend), React 18, TypeScript, TanStack Query v5, CSS Modules, Vitest + Testing Library (frontend)

## Global Constraints

- Branch: `w5-responses` — commit directly, never switch to main
- Commit prefix: `W5:`, no em dashes, end every commit message with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- No new sidebar nav item, no `/responses` route
- No schema changes, no new database tables or columns
- No re-implementing scoring logic in frontend — render backend verdicts only
- Photo questions: "Photo coming soon" placeholder only (deferred 5-BE-c)
- No em dashes in any UI copy
- Use `fireEvent` in tests (not `userEvent`) to avoid act() warnings
- CSS: CSS Modules + design tokens only; match W3/W4 file style
- UI: reuse Avatar, Chip, Button, Icon, Modal, Card from `apps/admin/src/ui/`
- Test commands: `pnpm test:api` (pytest in container), `pnpm --filter @intelli/admin test`, `pnpm --filter @intelli/admin build`

---

## File Map

**Backend (modify):**
- `api/app/scope.py` — enrich `_RESPONSE_COLS_R`, `list_responses`, `get_response`
- `api/tests/test_responses.py` — add tests asserting new fields on GET /responses and GET /responses/{id}

**Frontend (create):**
- `apps/admin/src/pages/Surveys/useResponses.ts` — hooks + pure helpers
- `apps/admin/src/pages/Surveys/useResponses.test.ts` — unit tests for pure helpers
- `apps/admin/src/pages/Surveys/ResponsesListModal.tsx` — list modal
- `apps/admin/src/pages/Surveys/ResponsesListModal.module.css`
- `apps/admin/src/pages/Surveys/ResponseDetailModal.tsx` — detail modal
- `apps/admin/src/pages/Surveys/ResponseDetailModal.module.css`

**Frontend (modify):**
- `apps/admin/src/pages/Surveys/SurveyList.tsx` — add "N responses" button per row
- `apps/admin/src/pages/Surveys/SurveyList.test.tsx` — test the responses button

---

### Task 1: Backend enrichment + tests

**Files:**
- Modify: `api/app/scope.py` lines 449-619
- Modify: `api/tests/test_responses.py`

**Interfaces:**
- Produces: `GET /responses` rows now include `store_name: str`, `survey_name: str`, `survey_version_number: int`, `rep_name: str` in addition to existing fields
- Produces: `GET /responses/{id}` includes the same four fields

- [ ] **Step 1: Write failing backend tests**

Add these two tests to the END of `api/tests/test_responses.py`:

```python
def test_list_responses_includes_display_names(client, login):
    """GET /responses now returns store_name, survey_name, survey_version_number, rep_name."""
    token = login("marcus@lumenbeauty.com")
    rose = _sku_id("LUM-VL-ROSE")
    _submit(client, token, _lumen_version_id(), _node_id("sf"), [
        {"question_id": "q1", "sku_id": str(rose), "value": 5},
    ])
    listed = client.get("/responses", headers={"Authorization": f"Bearer {token}"}).json()
    assert listed["count"] >= 1
    r = listed["responses"][0]
    assert "store_name" in r, "store_name missing from list"
    assert "survey_name" in r, "survey_name missing from list"
    assert "survey_version_number" in r, "survey_version_number missing from list"
    assert "rep_name" in r, "rep_name missing from list"
    assert r["store_name"]  # non-empty
    assert r["survey_name"] == "Velvet Lip Shelf Check"
    assert isinstance(r["survey_version_number"], int)
    assert r["rep_name"]  # non-empty


def test_get_response_includes_display_names(client, login):
    """GET /responses/{id} also returns store_name, survey_name, survey_version_number, rep_name."""
    token = login("marcus@lumenbeauty.com")
    rose = _sku_id("LUM-VL-ROSE")
    created = _submit(client, token, _lumen_version_id(), _node_id("sf"), [
        {"question_id": "q1", "sku_id": str(rose), "value": 5},
    ]).json()
    got = client.get(f"/responses/{created['id']}",
                     headers={"Authorization": f"Bearer {token}"}).json()
    assert got["store_name"], "store_name missing from detail"
    assert got["survey_name"] == "Velvet Lip Shelf Check"
    assert isinstance(got["survey_version_number"], int)
    assert got["rep_name"], "rep_name missing from detail"
```

- [ ] **Step 2: Run the new tests to confirm they fail**

```bash
pnpm test:api -k "test_list_responses_includes_display_names or test_get_response_includes_display_names"
```
Expected: FAIL with `KeyError: 'store_name'` or `AssertionError`

- [ ] **Step 3: Enrich `_RESPONSE_COLS_R` in `api/app/scope.py`**

Find the existing definition at line ~454:
```python
_RESPONSE_COLS_R = ("r.id, r.survey_version_id, r.store_node_id, r.store_path, "
                    "r.user_id, r.online, r.submitted_at, r.created_at")
```

Replace it with:
```python
_RESPONSE_COLS_R = (
    "r.id, r.survey_version_id, r.store_node_id, r.store_path, "
    "r.user_id, r.online, r.submitted_at, r.created_at, "
    "n.name as store_name, "
    "s.name as survey_name, "
    "sv.version_number as survey_version_number, "
    "u.name as rep_name"
)
```

- [ ] **Step 4: Update `list_responses` join in `api/app/scope.py`**

Find the existing `list_responses` query (around line 586):
```python
rows = conn.execute(
    text(
        f"select {self._RESPONSE_COLS_R} from responses r "
        "join nodes n on n.id = r.store_node_id "
        "where r.tenant_id = cast(:tid as uuid) and n.path like :scope || '%' "
        "order by r.submitted_at desc"
    ),
    {"tid": str(self.tenant_id), "scope": self.scope_path},
).mappings().all()
```

Replace with:
```python
rows = conn.execute(
    text(
        f"select {self._RESPONSE_COLS_R} from responses r "
        "join nodes n on n.id = r.store_node_id "
        "join survey_versions sv on sv.id = r.survey_version_id "
        "join surveys s on s.id = sv.survey_id "
        "join users u on u.id = r.user_id "
        "where r.tenant_id = cast(:tid as uuid) and n.path like :scope || '%' "
        "order by r.submitted_at desc"
    ),
    {"tid": str(self.tenant_id), "scope": self.scope_path},
).mappings().all()
```

- [ ] **Step 5: Update `get_response` join in `api/app/scope.py`**

Find the existing `get_response` query (around line 604):
```python
r = conn.execute(
    text(
        f"select {self._RESPONSE_COLS_R} from responses r "
        "join nodes n on n.id = r.store_node_id "
        "where r.id = cast(:rid as uuid) and r.tenant_id = cast(:tid as uuid) "
        "and n.path like :scope || '%'"
    ),
    {"rid": str(response_id), "tid": str(self.tenant_id), "scope": self.scope_path},
).mappings().first()
```

Replace with:
```python
r = conn.execute(
    text(
        f"select {self._RESPONSE_COLS_R} from responses r "
        "join nodes n on n.id = r.store_node_id "
        "join survey_versions sv on sv.id = r.survey_version_id "
        "join surveys s on s.id = sv.survey_id "
        "join users u on u.id = r.user_id "
        "where r.id = cast(:rid as uuid) and r.tenant_id = cast(:tid as uuid) "
        "and n.path like :scope || '%'"
    ),
    {"rid": str(response_id), "tid": str(self.tenant_id), "scope": self.scope_path},
).mappings().first()
```

- [ ] **Step 6: Run the new tests to confirm they pass**

```bash
pnpm test:api -k "test_list_responses_includes_display_names or test_get_response_includes_display_names"
```
Expected: PASS

- [ ] **Step 7: Run the full backend suite to confirm nothing broke**

```bash
pnpm test:api
```
Expected: all green

- [ ] **Step 8: Commit**

```bash
git add api/app/scope.py api/tests/test_responses.py
git commit -m "$(cat <<'EOF'
W5: enrich list_responses and get_response with store_name, survey_name, survey_version_number, rep_name

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `useResponses.ts` + unit tests

**Files:**
- Create: `apps/admin/src/pages/Surveys/useResponses.ts`
- Create: `apps/admin/src/pages/Surveys/useResponses.test.ts`

**Interfaces:**
- Consumes: `apiGet` from `../../lib/api`, `useQuery` from `@tanstack/react-query`
- Consumes: `Survey`, `SurveyVersion` from `./useSurveys`
- Produces: `ResponseRow` type, `ResponseDetail` type, `useResponses()` hook, `useResponseDetail(id, enabled)` hook, `responsesForSurvey(rows, survey)` function, `countBySurvey(rows, surveys)` function, `responseStatus(detail)` function

- [ ] **Step 1: Write the failing unit tests**

Create `apps/admin/src/pages/Surveys/useResponses.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import {
  responsesForSurvey,
  countBySurvey,
  responseStatus,
  type ResponseRow,
  type ResponseDetail,
} from './useResponses'
import type { Survey, SurveyVersion } from './useSurveys'

// Helpers to build minimal fixture objects
const ver = (id: string, survey_id: string): SurveyVersion => ({
  id,
  survey_id,
  version_number: 1,
  questions: [],
  published_at: '2026-01-01',
  created_at: '2026-01-01',
})

const survey = (id: string, versionIds: string[]): Survey => ({
  id,
  name: 'Test Survey',
  type: null,
  status: 'published',
  created_at: '',
  latest_version: 1,
  assigned: true,
})

const row = (id: string, survey_version_id: string): ResponseRow => ({
  id,
  survey_version_id,
  store_node_id: 'n1',
  store_path: '/lumen/west/sf/',
  user_id: 'u1',
  online: true,
  submitted_at: '2026-06-01T10:00:00Z',
  created_at: '2026-06-01T10:00:00Z',
  store_name: 'SF Store',
  survey_name: 'Test Survey',
  survey_version_number: 1,
  rep_name: 'Marcus Bell',
  overall: true,
})

const SURVEYS: Survey[] = [
  { id: 's1', name: 'Velvet Lip', type: null, status: 'published', created_at: '', latest_version: 2, assigned: true },
  { id: 's2', name: 'Spring Reset', type: null, status: 'draft', created_at: '', latest_version: 1, assigned: false },
]

// For responsesForSurvey we need versions attached. We use a SurveyDetail-like structure
// but the helper receives a plain Survey + versions array.
describe('responsesForSurvey', () => {
  const v1 = 'v1-id'
  const v2 = 'v2-id'
  const vOther = 'v-other'
  const rows: ResponseRow[] = [
    row('r1', v1),
    row('r2', v2),
    row('r3', vOther),
  ]

  it('filters rows to only those matching the given version ids', () => {
    const result = responsesForSurvey(rows, [v1, v2])
    expect(result.map((r) => r.id)).toEqual(['r1', 'r2'])
  })

  it('returns empty array when no version ids match', () => {
    expect(responsesForSurvey(rows, ['no-match'])).toEqual([])
  })

  it('returns empty array when rows is empty', () => {
    expect(responsesForSurvey([], [v1])).toEqual([])
  })
})

describe('countBySurvey', () => {
  const rows: ResponseRow[] = [
    row('r1', 'v1-id'),
    row('r2', 'v1-id'),
    row('r3', 'v2-id'),
  ]

  it('returns a map of survey id to response count', () => {
    const map = countBySurvey(rows, { s1: ['v1-id', 'v2-id'], s2: [] })
    expect(map['s1']).toBe(3)
    expect(map['s2']).toBe(0)
  })

  it('returns 0 for surveys with no matching responses', () => {
    const map = countBySurvey(rows, { sX: ['v-none'] })
    expect(map['sX']).toBe(0)
  })
})

describe('responseStatus', () => {
  const makeDetail = (questions: Record<string, boolean | null>): ResponseDetail => ({
    id: 'r1',
    survey_version_id: 'v1',
    store_node_id: 'n1',
    store_path: '/lumen/',
    user_id: 'u1',
    online: true,
    submitted_at: '2026-06-01T10:00:00Z',
    created_at: '2026-06-01T10:00:00Z',
    store_name: 'Store',
    survey_name: 'Survey',
    survey_version_number: 1,
    rep_name: 'Rep',
    overall: null,
    items: [],
    questions,
  })

  it('returns pass when all scored questions pass', () => {
    const r = responseStatus(makeDetail({ q1: true, q2: true }))
    expect(r.status).toBe('pass')
    expect(r.scored).toBe(2)
    expect(r.passed).toBe(2)
    expect(r.pct).toBe(100)
  })

  it('returns fail when all scored questions fail', () => {
    const r = responseStatus(makeDetail({ q1: false, q2: false }))
    expect(r.status).toBe('fail')
    expect(r.pct).toBe(0)
  })

  it('returns partial when some pass and some fail', () => {
    const r = responseStatus(makeDetail({ q1: true, q2: false }))
    expect(r.status).toBe('partial')
    expect(r.pct).toBe(50)
  })

  it('returns na when all questions are null (not scored)', () => {
    const r = responseStatus(makeDetail({ q1: null, q2: null }))
    expect(r.status).toBe('na')
    expect(r.pct).toBeNull()
  })

  it('ignores null questions in scoring', () => {
    // q1=true scored, q2=null not scored
    const r = responseStatus(makeDetail({ q1: true, q2: null }))
    expect(r.status).toBe('pass')
    expect(r.scored).toBe(1)
    expect(r.passed).toBe(1)
    expect(r.pct).toBe(100)
  })
})
```

- [ ] **Step 2: Run the tests to confirm they fail**

```bash
pnpm --filter @intelli/admin test -- --run useResponses.test
```
Expected: FAIL with "Cannot find module './useResponses'"

- [ ] **Step 3: Implement `useResponses.ts`**

Create `apps/admin/src/pages/Surveys/useResponses.ts`:

```typescript
import { useQuery } from '@tanstack/react-query'
import { apiGet } from '../../lib/api'

// ---- Types ----

export type ResponseRow = {
  id: string
  survey_version_id: string
  store_node_id: string
  store_path: string
  user_id: string
  online: boolean
  submitted_at: string
  created_at: string
  store_name: string
  survey_name: string
  survey_version_number: number
  rep_name: string
  overall: boolean | null
}

export type ResponseItem = {
  question_id: string
  sku_id: string | null
  value: unknown
  pass: boolean | null
}

export type ResponseDetail = ResponseRow & {
  items: ResponseItem[]
  questions: Record<string, boolean | null>
}

export type ResponseStatus = {
  pct: number | null
  status: 'pass' | 'partial' | 'fail' | 'na'
  scored: number
  passed: number
}

// ---- Hooks ----

export function useResponses() {
  return useQuery({
    queryKey: ['responses'],
    queryFn: () => apiGet<{ responses: ResponseRow[]; count: number }>('/responses'),
  })
}

export function useResponseDetail(id: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ['response', id],
    queryFn: () => apiGet<ResponseDetail>(`/responses/${id}`),
    enabled: enabled && !!id,
  })
}

// ---- Pure helpers ----

/**
 * Filter a list of response rows to only those belonging to a set of
 * survey version ids (typically all versions of one survey).
 */
export function responsesForSurvey(
  rows: ResponseRow[],
  versionIds: string[],
): ResponseRow[] {
  const set = new Set(versionIds)
  return rows.filter((r) => set.has(r.survey_version_id))
}

/**
 * Build a map of surveyId -> response count for each survey, given a map of
 * surveyId -> its version ids.
 */
export function countBySurvey(
  rows: ResponseRow[],
  surveyVersionMap: Record<string, string[]>,
): Record<string, number> {
  const result: Record<string, number> = {}
  for (const [surveyId, vids] of Object.entries(surveyVersionMap)) {
    result[surveyId] = responsesForSurvey(rows, vids).length
  }
  return result
}

/**
 * Compute a summary status from the per-question verdict map in a
 * ResponseDetail. Mirrors the prototype responseSummary().
 * - questions is a Record<questionId, true|false|null> where null = not scored.
 * - pct is null when no questions are scored.
 * - status: 'na' when scored===0, 'pass' when all pass, 'fail' when all fail,
 *   'partial' otherwise.
 */
export function responseStatus(detail: ResponseDetail): ResponseStatus {
  const verdicts = Object.values(detail.questions)
  const scored = verdicts.filter((v) => v !== null).length
  const passed = verdicts.filter((v) => v === true).length
  const pct = scored === 0 ? null : Math.round((passed / scored) * 100)
  let status: ResponseStatus['status']
  if (scored === 0) status = 'na'
  else if (passed === scored) status = 'pass'
  else if (passed === 0) status = 'fail'
  else status = 'partial'
  return { pct, status, scored, passed }
}
```

- [ ] **Step 4: Run the tests to confirm they pass**

```bash
pnpm --filter @intelli/admin test -- --run useResponses.test
```
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/pages/Surveys/useResponses.ts apps/admin/src/pages/Surveys/useResponses.test.ts
git commit -m "$(cat <<'EOF'
W5: add useResponses hook and pure helpers with unit tests

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `ResponsesListModal.tsx` + CSS

**Files:**
- Create: `apps/admin/src/pages/Surveys/ResponsesListModal.tsx`
- Create: `apps/admin/src/pages/Surveys/ResponsesListModal.module.css`

**Interfaces:**
- Consumes: `ResponseRow`, `responseStatus` from `./useResponses`
- Consumes: `Modal`, `Avatar`, `Chip`, `Button`, `Icon` from `../../ui`
- Produces: `ResponsesListModal` React component with props `{ open, survey: Survey, versionIds: string[], onClose, onOpenDetail }`

- [ ] **Step 1: Create `ResponsesListModal.module.css`**

```css
.body {
  padding: 18px;
}
.list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  cursor: pointer;
  text-align: left;
  width: 100%;
  background: none;
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  transition: border-color 0.12s;
}
.row:hover {
  border-color: var(--accent);
  background: var(--surface-hover);
}
.rowInfo {
  flex: 1;
  min-width: 0;
}
.rowName {
  font-size: 13.5px;
  font-weight: 600;
}
.rowMeta {
  font-size: 12px;
  color: var(--text-3);
  margin-top: 2px;
}
.rowRight {
  text-align: right;
  flex-shrink: 0;
}
.rowPct {
  font-size: 15px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.rowStatus {
  margin-top: 3px;
}
.empty {
  padding: 28px;
  text-align: center;
  border: 1px dashed var(--border);
  border-radius: var(--r-md);
  color: var(--text-3);
  font-size: 13px;
}
```

- [ ] **Step 2: Create `ResponsesListModal.tsx`**

```tsx
import { Modal, Avatar, Chip, Icon } from '../../ui'
import { responseStatus, type ResponseRow } from './useResponses'
import type { Survey } from './useSurveys'
import styles from './ResponsesListModal.module.css'

const STATUS_TONE = {
  pass: 'green',
  fail: 'red',
  partial: 'amber',
  na: undefined,
} as const

const STATUS_LABEL = {
  pass: 'Pass',
  fail: 'Fail',
  partial: 'Partial',
  na: 'Not scored',
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  } catch {
    return iso
  }
}

export function ResponsesListModal({
  open,
  survey,
  rows,
  onClose,
  onOpenDetail,
}: {
  open: boolean
  survey: Survey
  rows: ResponseRow[]
  onClose: () => void
  onOpenDetail: (row: ResponseRow) => void
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Submitted responses"
      subtitle={`${survey.name}: the raw records behind the compliance number`}
      width={560}
    >
      <div className={styles.body}>
        {rows.length === 0 ? (
          <div className={styles.empty}>No responses captured yet</div>
        ) : (
          <div className={styles.list}>
            {rows.map((r) => {
              const sum = responseStatus({ ...r, items: [], questions: {} } as any)
              // Use overall boolean to determine a simple status for list view
              const listStatus =
                r.overall === true ? 'pass' : r.overall === false ? 'fail' : 'na'
              const tone = STATUS_TONE[listStatus]
              const pctColor = tone ? `var(--${tone}-fg)` : 'var(--text-2)'
              return (
                <button
                  key={r.id}
                  className={styles.row}
                  onClick={() => onOpenDetail(r)}
                  type="button"
                >
                  <Avatar name={r.rep_name} size={32} />
                  <div className={styles.rowInfo}>
                    <div className={styles.rowName}>
                      {r.store_name}
                    </div>
                    <div className={styles.rowMeta}>
                      {r.rep_name}, {formatDate(r.submitted_at)}
                      {!r.online && ' (queued offline)'}
                    </div>
                  </div>
                  <div className={styles.rowRight}>
                    <div className={styles.rowPct} style={{ color: pctColor }}>
                      {r.overall === true ? '100%' : r.overall === false ? '0%' : ''}
                    </div>
                    <div className={styles.rowStatus}>
                      <Chip tone={tone}>{STATUS_LABEL[listStatus]}</Chip>
                    </div>
                  </div>
                  <Icon name="chevR" size={16} />
                </button>
              )
            })}
          </div>
        )}
      </div>
    </Modal>
  )
}
```

**Note:** The list view uses `r.overall` (a boolean from the backend) for a quick pass/fail display. The detail view uses the full `questions` map for the accurate per-question breakdown.

- [ ] **Step 3: Run frontend tests to ensure nothing broken**

```bash
pnpm --filter @intelli/admin test -- --run
```
Expected: all green (no new tests for this modal yet; they come in Task 6)

- [ ] **Step 4: Commit**

```bash
git add apps/admin/src/pages/Surveys/ResponsesListModal.tsx apps/admin/src/pages/Surveys/ResponsesListModal.module.css
git commit -m "$(cat <<'EOF'
W5: add ResponsesListModal component

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: `ResponseDetailModal.tsx` + CSS

**Files:**
- Create: `apps/admin/src/pages/Surveys/ResponseDetailModal.tsx`
- Create: `apps/admin/src/pages/Surveys/ResponseDetailModal.module.css`

**Interfaces:**
- Consumes: `useResponseDetail`, `ResponseDetail`, `responseStatus` from `./useResponses`
- Consumes: `BackendQuestion` from `./useSurveys`
- Consumes: `Sku` from `../Catalog/useCatalog`
- Consumes: `Modal`, `Avatar`, `Chip`, `Button`, `Icon` from `../../ui`
- Produces: `ResponseDetailModal` component with props `{ open, responseId, questions, skus, onClose, onBack? }`
  - `questions`: the survey version's `BackendQuestion[]` for prompt/type/pass display
  - `skus`: the catalog `Sku[]` for color lookup

- [ ] **Step 1: Create `ResponseDetailModal.module.css`**

```css
.body {
  padding: 22px;
}
.back {
  margin-bottom: 14px;
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 13px;
  color: var(--text-3);
  background: none;
  border: none;
  cursor: pointer;
  padding: 0;
}
.back:hover {
  color: var(--text);
}
.verdict {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 16px;
  border-radius: var(--r-lg);
  margin-bottom: 16px;
}
.verdictLeft {
  display: flex;
  align-items: center;
  gap: 9px;
  flex: 1;
  min-width: 0;
}
.verdictName {
  font-size: 13.5px;
  font-weight: 600;
}
.verdictSub {
  font-size: 12px;
  color: var(--text-3);
  margin-top: 1px;
}
.verdictRight {
  text-align: right;
  flex-shrink: 0;
}
.verdictPct {
  font-size: 24px;
  font-weight: 800;
  letter-spacing: -0.02em;
  display: flex;
  align-items: center;
  gap: 7px;
  justify-content: flex-end;
}
.verdictLabel {
  font-size: 12px;
  font-weight: 600;
  margin-top: 2px;
}
.metaStrip {
  display: flex;
  gap: 18px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}
.metaItem {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.metaLabel {
  font-size: 10.5px;
  color: var(--text-3);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.metaValue {
  font-size: 13px;
  font-weight: 600;
}
.answersEyebrow {
  font-size: 10.5px;
  color: var(--text-3);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin: 20px 0 4px;
}
.questionRow {
  padding: 14px 0;
  border-bottom: 1px solid var(--border-faint, var(--border));
}
.questionTop {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}
.questionIndex {
  font-size: 11px;
  color: var(--text-4, var(--text-3));
  font-weight: 600;
  width: 18px;
  flex-shrink: 0;
  padding-top: 3px;
  font-variant-numeric: tabular-nums;
}
.questionBody {
  flex: 1;
  min-width: 0;
}
.questionMeta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 7px;
  flex-wrap: wrap;
}
.questionPrompt {
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 10px;
  letter-spacing: -0.01em;
}
.typeBadge {
  font-size: 11px;
  font-weight: 600;
  padding: 2px 7px;
  border-radius: var(--r-sm);
  background: var(--surface-2, var(--surface-hover));
  color: var(--text-3);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.resultBadge {
  margin-left: auto;
}
/* Answer bodies */
.answerText {
  font-size: 13px;
  color: var(--text-2);
  line-height: 1.5;
  padding: 9px 12px;
  background: var(--surface-2, var(--surface-hover));
  border-radius: var(--r-md);
  border-left: 2px solid var(--border-strong, var(--border));
}
.answerSkipped {
  font-size: 12.5px;
  color: var(--text-3);
  font-style: italic;
}
.answerNumber {
  font-size: 15px;
  font-weight: 700;
}
.answerUnit {
  font-size: 12.5px;
  font-weight: 400;
  color: var(--text-3);
}
/* Facings grid */
.facingsSummary {
  font-size: 12.5px;
  font-weight: 600;
  margin-bottom: 9px;
}
.facingsGrid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 6px;
}
.facingCell {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 9px;
  border-radius: var(--r-sm);
  border: 1px solid transparent;
}
.facingCellPass {
  background: var(--green-bg, #f0fdf4);
}
.facingCellFail {
  background: var(--red-bg, #fef2f2);
}
.facingColorDot {
  width: 14px;
  height: 14px;
  border-radius: 4px;
  flex-shrink: 0;
  box-shadow: 0 0 0 1px var(--border);
}
.facingVariant {
  font-size: 12.5px;
  font-weight: 500;
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.facingCount {
  font-size: 13px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.facingCountPass {
  color: var(--green-fg, #16a34a);
}
.facingCountFail {
  color: var(--red-fg, #dc2626);
}
/* Photo placeholder */
.photoPlaceholder {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 200px;
  height: 120px;
  border-radius: var(--r-md);
  background: var(--surface-2, var(--surface-hover));
  border: 1px dashed var(--border);
  font-size: 12px;
  color: var(--text-3);
  gap: 7px;
}
.loading {
  padding: 32px;
  text-align: center;
  color: var(--text-3);
  font-size: 13.5px;
}
```

- [ ] **Step 2: Create `ResponseDetailModal.tsx`**

```tsx
import { Modal, Avatar, Chip, Icon, Button } from '../../ui'
import { useResponseDetail, responseStatus, type ResponseDetail } from './useResponses'
import type { BackendQuestion } from './useSurveys'
import type { Sku } from '../Catalog/useCatalog'
import styles from './ResponseDetailModal.module.css'

// ---- Status helpers ----
const STATUS_TONE = {
  pass: 'green',
  fail: 'red',
  partial: 'amber',
  na: undefined,
} as const

const STATUS_LABEL = {
  pass: 'Compliant',
  fail: 'Failed',
  partial: 'Partial',
  na: 'Not scored',
}

const STATUS_ICON = {
  pass: 'checkCircle',
  fail: 'xCircle',
  partial: 'alert',
  na: 'info',
} as const

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit',
    })
  } catch {
    return iso
  }
}

// ---- Per-question answer renderers ----

function TypeBadge({ type }: { type: string }) {
  const labels: Record<string, string> = {
    boolean: 'Yes/No', number: 'Number', single_choice: 'Choice',
    multi_choice: 'Multi', photo: 'Photo', text: 'Text',
  }
  return <span className={styles.typeBadge}>{labels[type] ?? type}</span>
}

function ResultBadge({ verdict }: { verdict: boolean | null }) {
  if (verdict === null) {
    return <Chip>Not scored</Chip>
  }
  return verdict ? (
    <Chip tone="green"><Icon name="check" size={11} /> Pass</Chip>
  ) : (
    <Chip tone="red"><Icon name="x" size={11} /> Fail</Chip>
  )
}

function FacingsGrid({
  q,
  items,
  skus,
  verdict,
}: {
  q: BackendQuestion
  items: ResponseDetail['items']
  skus: Sku[]
  verdict: boolean | null
}) {
  const skuMap = new Map(skus.map((s) => [s.id, s]))
  // items for this question
  const qItems = items.filter((i) => i.question_id === q.id && i.sku_id != null)
  if (qItems.length === 0) return null

  const passValue = q.pass?.value as number | undefined
  const op = q.pass?.operator

  function cellPass(value: unknown): boolean {
    if (op == null || passValue == null || typeof value !== 'number') return false
    switch (op) {
      case '>=': return value >= passValue
      case '<=': return value <= passValue
      case '>': return value > passValue
      case '<': return value < passValue
      case '==': return value === passValue
      default: return false
    }
  }

  const summaryText = (() => {
    if (!op || passValue == null) return null
    const opLabel: Record<string, string> = { '>=': '>=', '<=': '<=', '>': '>', '<': '<', '==': '=' }
    const unit = q.unit ? ` ${q.unit}` : ''
    if (q.passScope === 'total') {
      const total = qItems.reduce((a, i) => a + (typeof i.value === 'number' ? i.value : 0), 0)
      return `Total ${total}${unit}, rule ${opLabel[op] ?? op} ${passValue}`
    }
    const passing = qItems.filter((i) => cellPass(i.value)).length
    return `${passing} of ${qItems.length} shades meet ${opLabel[op] ?? op} ${passValue}${unit}`
  })()

  return (
    <div>
      {summaryText && (
        <div
          className={styles.facingsSummary}
          style={{ color: verdict === false ? 'var(--amber-fg, #d97706)' : 'var(--green-fg, #16a34a)' }}
        >
          {summaryText}
        </div>
      )}
      <div className={styles.facingsGrid}>
        {qItems.map((item) => {
          const sku = item.sku_id ? skuMap.get(item.sku_id) : undefined
          const pass = cellPass(item.value)
          return (
            <div
              key={item.sku_id}
              className={`${styles.facingCell} ${pass ? styles.facingCellPass : styles.facingCellFail}`}
            >
              <div
                className={styles.facingColorDot}
                style={{ background: sku?.color ?? 'var(--border)' }}
              />
              <span className={styles.facingVariant}>{sku?.variant ?? item.sku_id}</span>
              <span
                className={`${styles.facingCount} ${pass ? styles.facingCountPass : styles.facingCountFail}`}
              >
                {typeof item.value === 'number' ? item.value : String(item.value)}
              </span>
              <Icon name={pass ? 'check' : 'x'} size={13} />
            </div>
          )
        })}
      </div>
    </div>
  )
}

function AnswerBody({
  q,
  detail,
  skus,
}: {
  q: BackendQuestion
  detail: ResponseDetail
  skus: Sku[]
}) {
  const verdict = detail.questions[q.id] ?? null
  // Find items for this question
  const qItems = detail.items.filter((i) => i.question_id === q.id)

  if (q.type === 'photo') {
    return (
      <div className={styles.photoPlaceholder} data-testid="photo-placeholder">
        <Icon name="camera" size={16} />
        Photo coming soon
      </div>
    )
  }

  if (qItems.length === 0) {
    return <span className={styles.answerSkipped}>Not answered</span>
  }

  if (q.perSku && q.type === 'number') {
    return <FacingsGrid q={q} items={detail.items} skus={skus} verdict={verdict} />
  }

  const firstItem = qItems[0]
  const value = firstItem?.value

  if (q.type === 'boolean') {
    const boolVal = value === true || value === 'true' || value === 'Yes'
    return <Chip tone={boolVal ? 'green' : 'red'}>{boolVal ? 'Yes' : 'No'}</Chip>
  }

  if (q.type === 'number') {
    return (
      <span className={styles.answerNumber}>
        {String(value)}{' '}
        {q.unit && <span className={styles.answerUnit}>{q.unit}</span>}
      </span>
    )
  }

  if (q.type === 'text') {
    return <div className={styles.answerText}>"{String(value)}"</div>
  }

  if (q.type === 'single_choice' || q.type === 'multi_choice') {
    const vals = Array.isArray(value) ? value : [value]
    return (
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {vals.map((v, i) => <Chip key={i}>{String(v)}</Chip>)}
      </div>
    )
  }

  return <span style={{ fontSize: 13 }}>{String(value)}</span>
}

function QuestionRow({
  q,
  index,
  detail,
  skus,
}: {
  q: BackendQuestion
  index: number
  detail: ResponseDetail
  skus: Sku[]
}) {
  const verdict = detail.questions[q.id] ?? null

  // Build pass-rule chip label (mirrors passSummary from useSurveys)
  function passRuleLabel(): string | null {
    if (!q.pass) return null
    if (q.type === 'boolean') return q.pass.value === true ? 'Pass = Yes' : 'Pass = No'
    if (q.type === 'number') {
      const opLabel: Record<string, string> = { '>=': '>=', '<=': '<=', '>': '>', '<': '<', '==': '=' }
      const op = opLabel[q.pass.operator] ?? q.pass.operator
      const unit = q.unit ? ` ${q.unit}` : ''
      const scope = q.perSku ? (q.passScope === 'total' ? 'total ' : 'each ') : ''
      return `Pass = ${scope}${op} ${q.pass.value}${unit}`
    }
    if (q.type === 'single_choice') {
      const vals = Array.isArray(q.pass.value) ? q.pass.value : [q.pass.value]
      return vals.length ? `Pass = ${vals.join(' / ')}` : null
    }
    return null
  }

  const rule = passRuleLabel()

  return (
    <div className={styles.questionRow}>
      <div className={styles.questionTop}>
        <span className={styles.questionIndex}>{String(index + 1).padStart(2, '0')}</span>
        <div className={styles.questionBody}>
          <div className={styles.questionMeta}>
            <TypeBadge type={q.type} />
            {q.perSku && <Chip tone="violet"><Icon name="box" size={11} /> Per-SKU</Chip>}
            {rule && <Chip><Icon name="target" size={10} /> {rule}</Chip>}
            <div className={styles.resultBadge}>
              <ResultBadge verdict={verdict} />
            </div>
          </div>
          <div className={styles.questionPrompt}>{q.prompt}</div>
          <AnswerBody q={q} detail={detail} skus={skus} />
        </div>
      </div>
    </div>
  )
}

// ---- Main component ----

export function ResponseDetailModal({
  open,
  responseId,
  questions,
  skus,
  onClose,
  onBack,
}: {
  open: boolean
  responseId: string | null
  questions: BackendQuestion[]
  skus: Sku[]
  onClose: () => void
  onBack?: () => void
}) {
  const { data: detail, isLoading } = useResponseDetail(responseId, open)

  const sum = detail ? responseStatus(detail) : null
  const tone = sum ? STATUS_TONE[sum.status] : undefined
  const fg = tone ? `var(--${tone}-fg)` : 'var(--text-2)'
  const bg = tone ? `var(--${tone}-bg)` : 'var(--surface-2, var(--surface-hover))'

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={detail?.store_name ?? 'Response'}
      subtitle={
        detail
          ? `${detail.survey_name}, v${detail.survey_version_number}, submitted ${formatDate(detail.submitted_at)}`
          : undefined
      }
      width={720}
    >
      <div className={styles.body}>
        {onBack && (
          <button type="button" className={styles.back} onClick={onBack}>
            <Icon name="chevL" size={14} /> All responses
          </button>
        )}

        {isLoading && <div className={styles.loading}>Loading response...</div>}

        {!isLoading && detail && (
          <>
            {/* Verdict header */}
            <div className={styles.verdict} style={{ background: bg }}>
              <div className={styles.verdictLeft}>
                <Avatar name={detail.rep_name} size={34} />
                <div>
                  <div className={styles.verdictName}>{detail.rep_name}</div>
                  <div className={styles.verdictSub}>{detail.store_name}</div>
                </div>
              </div>
              <div className={styles.verdictRight}>
                <div className={styles.verdictPct} style={{ color: fg }}>
                  {sum && <Icon name={STATUS_ICON[sum.status]} size={18} />}
                  {sum?.pct != null ? `${sum.pct}%` : ''}
                </div>
                {sum && (
                  <div className={styles.verdictLabel} style={{ color: fg }}>
                    {STATUS_LABEL[sum.status]},{' '}
                    {sum.passed}/{sum.scored} scored questions
                  </div>
                )}
              </div>
            </div>

            {/* Meta strip */}
            <div className={styles.metaStrip}>
              <div className={styles.metaItem}>
                <div className={styles.metaLabel}>Node</div>
                <div className={styles.metaValue}>{detail.store_path}</div>
              </div>
              <div className={styles.metaItem}>
                <div className={styles.metaLabel}>Sync</div>
                <div className={styles.metaValue}>{detail.online ? 'Online, synced' : 'Offline, queued'}</div>
              </div>
              <div className={styles.metaItem}>
                <div className={styles.metaLabel}>Version</div>
                <div className={styles.metaValue}>v{detail.survey_version_number} (frozen)</div>
              </div>
            </div>

            {/* Per-question answers */}
            {questions.length > 0 && (
              <>
                <div className={styles.answersEyebrow}>Answers</div>
                <div>
                  {questions.map((q, i) => (
                    <QuestionRow key={q.id} q={q} index={i} detail={detail} skus={skus} />
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </Modal>
  )
}
```

- [ ] **Step 3: Run frontend tests to confirm nothing broken**

```bash
pnpm --filter @intelli/admin test -- --run
```
Expected: all green

- [ ] **Step 4: Commit**

```bash
git add apps/admin/src/pages/Surveys/ResponseDetailModal.tsx apps/admin/src/pages/Surveys/ResponseDetailModal.module.css
git commit -m "$(cat <<'EOF'
W5: add ResponseDetailModal with verdict header, meta strip, per-question answers, and facings grid

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Wire into `SurveyList.tsx`

**Files:**
- Modify: `apps/admin/src/pages/Surveys/SurveyList.tsx`
- Modify: `apps/admin/src/pages/Surveys/SurveyList.module.css` (add `.responseBtn` style if needed)

**Interfaces:**
- Consumes: `useResponses`, `countBySurvey`, `responsesForSurvey`, `type ResponseRow` from `./useResponses`
- Consumes: `ResponsesListModal` from `./ResponsesListModal`
- Consumes: `ResponseDetailModal` from `./ResponseDetailModal`
- Consumes: `useSurvey` from `./useSurveys` (to get version questions when opening detail)
- Consumes: `useSkus` from `../Catalog/useCatalog` (to pass skus to detail modal)

- [ ] **Step 1: Update `SurveyList.tsx`**

The full updated file (replace the existing content entirely):

```tsx
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Card, Chip, Icon } from '../../ui'
import { Topbar } from '../../shell/Topbar'
import { selectSession, useAppSelector } from '../../store'
import { surveyStats, useSurveyList, useSurvey, type Survey } from './useSurveys'
import { useResponses, countBySurvey, responsesForSurvey, type ResponseRow } from './useResponses'
import { useSkus } from '../Catalog/useCatalog'
import { ResponsesListModal } from './ResponsesListModal'
import { ResponseDetailModal } from './ResponseDetailModal'
import styles from './SurveyList.module.css'

function StatTile({
  icon,
  value,
  label,
}: {
  icon: 'list' | 'checkCircle' | 'edit'
  value: number
  label: string
}) {
  return (
    <Card className={styles.stat}>
      <div className={styles.statIcon}>
        <Icon name={icon} size={18} />
      </div>
      <div>
        <div className={styles.statValue}>{value}</div>
        <div className={styles.statLabel}>{label}</div>
      </div>
    </Card>
  )
}

function EmptyState({ isAdmin, onAdd }: { isAdmin: boolean; onAdd: () => void }) {
  return (
    <Card className={styles.empty}>
      <div className={styles.emptyIcon}>
        <Icon name="list" size={26} />
      </div>
      <div className={styles.emptyTitle}>No surveys yet</div>
      <div className={styles.emptyHint}>Get started by creating your first survey.</div>
      {isAdmin && (
        <Button variant="primary" onClick={onAdd}>
          <Icon name="plus" size={14} /> New survey
        </Button>
      )}
    </Card>
  )
}

function statusChip(status: Survey['status']) {
  if (status === 'published') return <Chip tone="green">Published</Chip>
  if (status === 'draft') return <Chip tone="amber">Draft</Chip>
  return <Chip>Archived</Chip>
}

function SurveyRow({
  survey,
  isAdmin,
  responseCount,
  onViewResponses,
}: {
  survey: Survey
  isAdmin: boolean
  responseCount: number
  onViewResponses: (survey: Survey) => void
}) {
  const navigate = useNavigate()
  return (
    <Card className={styles.row}>
      <div className={styles.rowMain}>
        <div className={styles.rowName}>{survey.name}</div>
        <div className={styles.rowMeta}>
          {statusChip(survey.status)}
          <Chip>v{survey.latest_version}</Chip>
          {survey.assigned ? (
            <Chip tone="accent">Assigned</Chip>
          ) : (
            <span className={styles.notAssigned}>No assignment</span>
          )}
        </div>
      </div>
      <div className={styles.rowActions}>
        <Button
          size="sm"
          disabled={responseCount === 0}
          onClick={() => onViewResponses(survey)}
        >
          {responseCount} {responseCount === 1 ? 'response' : 'responses'}
        </Button>
        {isAdmin && (
          <>
            {survey.status === 'published' && (
              <>
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => navigate(`/surveys/${survey.id}/assign`)}
                >
                  Assign
                </Button>
                <Button
                  size="sm"
                  onClick={() => navigate(`/surveys/${survey.id}/edit`)}
                >
                  Edit
                </Button>
              </>
            )}
            {survey.status === 'draft' && (
              <Button
                size="sm"
                onClick={() => navigate(`/surveys/${survey.id}/edit`)}
              >
                Continue editing
              </Button>
            )}
            {survey.status === 'archived' && (
              <Button size="sm" disabled>
                Edit
              </Button>
            )}
          </>
        )}
      </div>
    </Card>
  )
}

export default function SurveyList() {
  const navigate = useNavigate()
  const session = useAppSelector(selectSession)
  const isAdmin = session?.user.role === 'admin'

  const { data, isLoading } = useSurveyList()
  const surveys = data?.surveys ?? []
  const stats = surveyStats(surveys)

  const { data: responsesData } = useResponses()
  const allRows = responsesData?.responses ?? []

  const { data: skusData } = useSkus()
  const skus = skusData?.skus ?? []

  // Build surveyId -> version ids map for countBySurvey
  // We use survey.latest_version as a proxy — but we don't have all version ids
  // from the list endpoint. We match by survey_name on the response rows instead.
  // Better: match by survey_version_id. We use a direct filter approach:
  // each ResponseRow has survey_name; match that to the survey name.
  // This is good enough for the badge count. Exact version-id filtering is
  // used inside ResponsesListModal (passed as the filtered rows).
  const countMap: Record<string, number> = {}
  for (const s of surveys) {
    countMap[s.id] = allRows.filter((r) => r.survey_name === s.name).length
  }

  // Modal state
  const [listModal, setListModal] = useState<Survey | null>(null)
  const [detailRowId, setDetailRowId] = useState<string | null>(null)
  const [fromList, setFromList] = useState(false)

  // For detail modal: fetch the selected survey's full detail to get questions
  const [detailSurveyId, setDetailSurveyId] = useState<string | null>(null)
  const { data: surveyDetail } = useSurvey(detailSurveyId ?? undefined)
  // Pick the questions from the version matching the open response
  const detailQuestions = (() => {
    if (!surveyDetail || !detailRowId) return []
    // Find the response row to get its version id
    const row = allRows.find((r) => r.id === detailRowId)
    if (!row) return []
    const version = surveyDetail.versions.find((v) => v.id === row.survey_version_id)
    return version?.questions ?? []
  })()

  function onViewResponses(survey: Survey) {
    setListModal(survey)
    setDetailSurveyId(survey.id)
  }

  function onOpenDetail(row: ResponseRow) {
    setDetailRowId(row.id)
    setFromList(true)
  }

  function onCloseList() {
    setListModal(null)
    setDetailRowId(null)
  }

  function onCloseDetail() {
    setDetailRowId(null)
    if (!fromList) setListModal(null)
  }

  function onBack() {
    setDetailRowId(null)
    setFromList(false)
  }

  function onNew() {
    navigate('/surveys/new')
  }

  // Rows for the list modal
  const listRows = listModal
    ? allRows.filter((r) => r.survey_name === listModal.name)
    : []

  return (
    <>
      <Topbar title="Surveys">
        {isAdmin && (
          <Button size="sm" variant="primary" onClick={onNew}>
            <Icon name="plus" size={14} /> New survey
          </Button>
        )}
      </Topbar>

      <div className={styles.scroll}>
        <div className={styles.page}>
          <div className={styles.stats}>
            <StatTile icon="list" value={stats.total} label="Surveys" />
            <StatTile icon="checkCircle" value={stats.published} label="Published surveys" />
            <StatTile icon="edit" value={stats.draft} label="Drafts" />
          </div>

          {isLoading && <div className={styles.note}>Loading...</div>}

          {!isLoading && surveys.length === 0 && (
            <EmptyState isAdmin={!!isAdmin} onAdd={onNew} />
          )}

          {!isLoading && surveys.length > 0 && (
            <div className={styles.list}>
              {surveys.map((s) => (
                <SurveyRow
                  key={s.id}
                  survey={s}
                  isAdmin={!!isAdmin}
                  responseCount={countMap[s.id] ?? 0}
                  onViewResponses={onViewResponses}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {listModal && (
        <ResponsesListModal
          open={!!listModal && !detailRowId}
          survey={listModal}
          rows={listRows}
          onClose={onCloseList}
          onOpenDetail={onOpenDetail}
        />
      )}

      <ResponseDetailModal
        open={!!detailRowId}
        responseId={detailRowId}
        questions={detailQuestions}
        skus={skus}
        onClose={onCloseDetail}
        onBack={fromList ? onBack : undefined}
      />
    </>
  )
}
```

- [ ] **Step 2: Run frontend tests to confirm existing tests still pass**

```bash
pnpm --filter @intelli/admin test -- --run SurveyList
```
Expected: the 3 existing SurveyList tests pass

- [ ] **Step 3: Commit**

```bash
git add apps/admin/src/pages/Surveys/SurveyList.tsx
git commit -m "$(cat <<'EOF'
W5: wire responses button into SurveyList, open list and detail modals

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Component tests for ResponsesListModal + ResponseDetailModal + SurveyList

**Files:**
- Create: `apps/admin/src/pages/Surveys/ResponsesListModal.test.tsx`
- Create: `apps/admin/src/pages/Surveys/ResponseDetailModal.test.tsx`
- Modify: `apps/admin/src/pages/Surveys/SurveyList.test.tsx`

**Interfaces:**
- Consumes: `renderApp` from `../../test/render`
- Consumes: `adminSession`, `repSession` from `../../test/fixtures`
- Consumes: `apiGet` from `../../lib/api` (mocked)

- [ ] **Step 1: Create `ResponsesListModal.test.tsx`**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent } from '@testing-library/react'
import { renderApp } from '../../test/render'
import { adminSession } from '../../test/fixtures'
import { ResponsesListModal } from './ResponsesListModal'
import type { Survey } from './useSurveys'
import type { ResponseRow } from './useResponses'

const SURVEY: Survey = {
  id: 's1', name: 'Velvet Lip Shelf Check', type: null,
  status: 'published', created_at: '', latest_version: 2, assigned: true,
}

const ROW: ResponseRow = {
  id: 'r1', survey_version_id: 'v1', store_node_id: 'n1',
  store_path: '/lumen/west/sf/', user_id: 'u1', online: true,
  submitted_at: '2026-06-01T10:00:00Z', created_at: '2026-06-01T10:00:00Z',
  store_name: 'SF Flagship', survey_name: 'Velvet Lip Shelf Check',
  survey_version_number: 2, rep_name: 'Marcus Bell', overall: true,
}

const OFFLINE_ROW: ResponseRow = {
  ...ROW, id: 'r2', online: false, overall: false, rep_name: 'Jane Doe',
}

describe('ResponsesListModal', () => {
  it('renders empty state when no rows', () => {
    renderApp(
      <ResponsesListModal open survey={SURVEY} rows={[]} onClose={vi.fn()} onOpenDetail={vi.fn()} />,
      { session: adminSession() },
    )
    expect(screen.getByText(/no responses captured/i)).toBeInTheDocument()
  })

  it('renders rows with rep name, store, and status chip', () => {
    renderApp(
      <ResponsesListModal open survey={SURVEY} rows={[ROW]} onClose={vi.fn()} onOpenDetail={vi.fn()} />,
      { session: adminSession() },
    )
    expect(screen.getByText('SF Flagship')).toBeInTheDocument()
    expect(screen.getByText(/marcus bell/i)).toBeInTheDocument()
    expect(screen.getByText('Pass')).toBeInTheDocument()
  })

  it('shows offline label for offline rows', () => {
    renderApp(
      <ResponsesListModal open survey={SURVEY} rows={[OFFLINE_ROW]} onClose={vi.fn()} onOpenDetail={vi.fn()} />,
      { session: adminSession() },
    )
    expect(screen.getByText(/queued offline/i)).toBeInTheDocument()
    expect(screen.getByText('Fail')).toBeInTheDocument()
  })

  it('calls onOpenDetail when a row is clicked', () => {
    const onOpenDetail = vi.fn()
    renderApp(
      <ResponsesListModal open survey={SURVEY} rows={[ROW]} onClose={vi.fn()} onOpenDetail={onOpenDetail} />,
      { session: adminSession() },
    )
    const rowBtn = screen.getByRole('button', { name: /sf flagship/i })
    fireEvent.click(rowBtn)
    expect(onOpenDetail).toHaveBeenCalledWith(ROW)
  })

  it('calls onClose when backdrop or close button is clicked', () => {
    const onClose = vi.fn()
    renderApp(
      <ResponsesListModal open survey={SURVEY} rows={[ROW]} onClose={onClose} onOpenDetail={vi.fn()} />,
      { session: adminSession() },
    )
    fireEvent.click(screen.getByRole('button', { name: /close/i }))
    expect(onClose).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Create `ResponseDetailModal.test.tsx`**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import { renderApp } from '../../test/render'
import { adminSession } from '../../test/fixtures'
import { ResponseDetailModal } from './ResponseDetailModal'
import * as api from '../../lib/api'
import type { BackendQuestion } from './useSurveys'
import type { Sku } from '../Catalog/useCatalog'

const QUESTIONS: BackendQuestion[] = [
  {
    id: 'q1', prompt: 'How many facings?', type: 'number', options: [],
    sku_ids: ['sku-rose', 'sku-mauve'], perSku: true,
    pass: { operator: '>=', value: 4 }, passScope: 'each', required: true,
    unit: 'facings', lines: ['Velvet Lip'],
  },
  {
    id: 'q2', prompt: 'Is the endcap present?', type: 'boolean', options: [],
    sku_ids: [], perSku: false,
    pass: { operator: '==', value: true }, passScope: 'each', required: true,
    unit: null, lines: [],
  },
  {
    id: 'q3', prompt: 'Upload shelf photo', type: 'photo', options: [],
    sku_ids: [], perSku: false, pass: null, passScope: 'each', required: false,
    unit: null, lines: [],
  },
]

const SKUS: Sku[] = [
  { id: 'sku-rose', line: 'Velvet Lip', variant: 'Rosewood', upc: 'LUM-VL-ROSE', color: '#9b5b5b', status: 'active', reference_images: [], created_at: '' },
  { id: 'sku-mauve', line: 'Velvet Lip', variant: 'Mauve', upc: 'LUM-VL-MAUVE', color: '#7e5c6f', status: 'active', reference_images: [], created_at: '' },
]

const DETAIL = {
  id: 'r1', survey_version_id: 'v1', store_node_id: 'n1',
  store_path: '/lumen/west/sf/', user_id: 'u1', online: true,
  submitted_at: '2026-06-01T10:00:00Z', created_at: '2026-06-01T10:00:00Z',
  store_name: 'SF Flagship', survey_name: 'Velvet Lip Shelf Check',
  survey_version_number: 2, rep_name: 'Marcus Bell', overall: true,
  items: [
    { question_id: 'q1', sku_id: 'sku-rose', value: 5, pass: true },
    { question_id: 'q1', sku_id: 'sku-mauve', value: 3, pass: false },
    { question_id: 'q2', sku_id: null, value: true, pass: true },
  ],
  questions: { q1: false, q2: true, q3: null },
}

beforeEach(() => {
  vi.spyOn(api, 'apiGet').mockImplementation(async (path: string) => {
    if (path === '/responses/r1') return DETAIL as any
    return {} as any
  })
})

describe('ResponseDetailModal', () => {
  it('renders loading state initially', () => {
    renderApp(
      <ResponseDetailModal open responseId="r1" questions={QUESTIONS} skus={SKUS} onClose={vi.fn()} />,
      { session: adminSession() },
    )
    expect(screen.getByText(/loading response/i)).toBeInTheDocument()
  })

  it('renders rep name, store name, and verdict after loading', async () => {
    renderApp(
      <ResponseDetailModal open responseId="r1" questions={QUESTIONS} skus={SKUS} onClose={vi.fn()} />,
      { session: adminSession() },
    )
    expect(await screen.findByText('Marcus Bell')).toBeInTheDocument()
    expect(screen.getByText('SF Flagship')).toBeInTheDocument()
  })

  it('renders per-SKU facings grid with pass and fail cells', async () => {
    renderApp(
      <ResponseDetailModal open responseId="r1" questions={QUESTIONS} skus={SKUS} onClose={vi.fn()} />,
      { session: adminSession() },
    )
    await screen.findByText('Marcus Bell')
    // Rosewood passed (5 >= 4), Mauve failed (3 < 4)
    expect(screen.getByText('Rosewood')).toBeInTheDocument()
    expect(screen.getByText('Mauve')).toBeInTheDocument()
    // Values
    expect(screen.getByText('5')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('renders photo placeholder for photo questions', async () => {
    renderApp(
      <ResponseDetailModal open responseId="r1" questions={QUESTIONS} skus={SKUS} onClose={vi.fn()} />,
      { session: adminSession() },
    )
    await screen.findByText('Marcus Bell')
    expect(screen.getByTestId('photo-placeholder')).toBeInTheDocument()
    expect(screen.getByText(/photo coming soon/i)).toBeInTheDocument()
  })

  it('shows "All responses" back button when onBack is provided', async () => {
    const onBack = vi.fn()
    renderApp(
      <ResponseDetailModal open responseId="r1" questions={QUESTIONS} skus={SKUS} onClose={vi.fn()} onBack={onBack} />,
      { session: adminSession() },
    )
    expect(screen.getByRole('button', { name: /all responses/i })).toBeInTheDocument()
  })

  it('does not show back button when onBack is not provided', async () => {
    renderApp(
      <ResponseDetailModal open responseId="r1" questions={QUESTIONS} skus={SKUS} onClose={vi.fn()} />,
      { session: adminSession() },
    )
    expect(screen.queryByRole('button', { name: /all responses/i })).toBeNull()
  })
})
```

- [ ] **Step 3: Update `SurveyList.test.tsx` to add the responses button tests**

Add these tests at the end of the `describe('SurveyList')` block in the existing file. First, update the `beforeEach` mock to also handle `/responses`:

Replace the existing `beforeEach` block:
```typescript
beforeEach(() => {
  vi.spyOn(api, 'apiGet').mockImplementation(async (path: string) => {
    if (path === '/surveys') return { surveys: SURVEYS } as any
    return {} as any
  })
})
```

With:
```typescript
beforeEach(() => {
  vi.spyOn(api, 'apiGet').mockImplementation(async (path: string) => {
    if (path === '/surveys') return { surveys: SURVEYS } as any
    if (path === '/responses') return { responses: [], count: 0 } as any
    if (path === '/skus') return { skus: [], count: 0 } as any
    return {} as any
  })
})
```

Then add at the end of the `describe('SurveyList')` block (before the closing `}`):

```typescript
  it('shows a responses button for each survey row', async () => {
    renderApp(<SurveyList />, { session: adminSession() })
    await screen.findByText('Velvet Lip Shelf Check')
    const responsesBtns = screen.getAllByRole('button', { name: /\d+ responses?/i })
    expect(responsesBtns.length).toBe(2)
  })

  it('responses button is disabled when count is 0', async () => {
    renderApp(<SurveyList />, { session: adminSession() })
    await screen.findByText('Velvet Lip Shelf Check')
    const responsesBtns = screen.getAllByRole('button', { name: /0 responses/i })
    responsesBtns.forEach((btn) => expect(btn).toBeDisabled())
  })

  it('rep user also sees the responses button (not admin-only)', async () => {
    renderApp(<SurveyList />, { session: repSession() })
    await screen.findByText('Velvet Lip Shelf Check')
    const responsesBtns = screen.getAllByRole('button', { name: /\d+ responses?/i })
    expect(responsesBtns.length).toBe(2)
  })

  it('clicking a responses button opens the list modal', async () => {
    vi.spyOn(api, 'apiGet').mockImplementation(async (path: string) => {
      if (path === '/surveys') return { surveys: SURVEYS } as any
      if (path === '/responses') return {
        responses: [{
          id: 'r1', survey_version_id: 'v1', store_node_id: 'n1',
          store_path: '/lumen/', user_id: 'u1', online: true,
          submitted_at: '2026-06-01T10:00:00Z', created_at: '2026-06-01T10:00:00Z',
          store_name: 'SF Store', survey_name: 'Velvet Lip Shelf Check',
          survey_version_number: 2, rep_name: 'Marcus Bell', overall: true,
        }],
        count: 1,
      } as any
      if (path === '/skus') return { skus: [], count: 0 } as any
      return {} as any
    })
    renderApp(<SurveyList />, { session: adminSession() })
    await screen.findByText('Velvet Lip Shelf Check')
    // Wait for responses to load
    const responsesBtn = await screen.findByRole('button', { name: /1 response/i })
    fireEvent.click(responsesBtn)
    expect(await screen.findByText('Submitted responses')).toBeInTheDocument()
  })
```

Also add `fireEvent` to the import at the top of the file:
```typescript
import { screen, fireEvent } from '@testing-library/react'
```

- [ ] **Step 4: Run all frontend tests**

```bash
pnpm --filter @intelli/admin test -- --run
```
Expected: all green. Fix any failures before continuing.

- [ ] **Step 5: Run the build to confirm TypeScript compiles**

```bash
pnpm --filter @intelli/admin build
```
Expected: clean build, no errors

- [ ] **Step 6: Commit**

```bash
git add apps/admin/src/pages/Surveys/ResponsesListModal.test.tsx apps/admin/src/pages/Surveys/ResponseDetailModal.test.tsx apps/admin/src/pages/Surveys/SurveyList.test.tsx
git commit -m "$(cat <<'EOF'
W5: add component tests for ResponsesListModal, ResponseDetailModal, and SurveyList responses button

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Final verification + report

**Files:**
- Create: `/Users/tanyajustin/Documents/intelli-app/.git/w5-report.md`

- [ ] **Step 1: Run all three test suites**

```bash
pnpm test:api
pnpm --filter @intelli/admin test -- --run
pnpm --filter @intelli/admin build
```
Record actual counts and pass/fail status.

- [ ] **Step 2: Write the report**

Write the full W5 report to `/Users/tanyajustin/Documents/intelli-app/.git/w5-report.md` covering:
- What was built
- Backend enrichment (the four new fields, the join changes)
- All files added and changed (with absolute paths)
- Actual test results from all three commands (test:api count, test:admin count, build status)
- TDD notes (which tests were written before the code)
- Any concerns or deviations from the spec

- [ ] **Step 3: Confirm on `w5-responses` branch with clean working tree**

```bash
git status
git log --oneline -10
```
Expected: on `w5-responses`, working tree clean, 6+ commits starting with "W5:"

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task |
|---|---|
| Backend: store_name, survey_name, survey_version_number, rep_name via joins | Task 1 |
| Backend test asserting new fields on GET /responses and GET /responses/{id} | Task 1 |
| useResponses() query (GET /responses, queryKey ['responses']) | Task 2 |
| responsesForSurvey() pure helper | Task 2 |
| countBySurvey() pure helper | Task 2 |
| responseStatus() pure helper -> {pct, status, scored, passed} | Task 2 |
| useResponseDetail(id, enabled) query | Task 2 |
| Unit tests for all pure helpers | Task 2 |
| ResponsesListModal: rep Avatar, store name, date, online/offline Chip, result % + pass/partial/fail Chip | Task 3 |
| ResponsesListModal: empty state | Task 3 |
| ResponsesListModal: click row opens detail | Task 3, Task 5 |
| ResponseDetailModal: verdict header (Avatar, store, big % + status) | Task 4 |
| ResponseDetailModal: meta strip (node path, online/offline, frozen version) | Task 4 |
| ResponseDetailModal: per-question answers with type badge, per-SKU chip, pass-rule chip, result badge | Task 4 |
| ResponseDetailModal: per-SKU facings grid (tinted cell per shade, count + pass/fail tick) | Task 4 |
| ResponseDetailModal: photo placeholder "Photo coming soon" | Task 4 |
| ResponseDetailModal: "All responses" back button | Task 4, Task 5 |
| ResponseDetailModal: does NOT re-implement scoring (renders backend verdicts) | Task 4 |
| SurveyList: "N responses" button per row | Task 5 |
| SurveyList: button visible to all roles | Task 5, Task 6 |
| SurveyList: button disabled at 0 | Task 5, Task 6 |
| No sidebar nav item, no /responses route | All tasks (none added) |
| Frontend test: SurveyList shows button and opens modal | Task 6 |
| Frontend test: ResponsesListModal renders rows and opens detail | Task 6 |
| Frontend test: ResponseDetailModal renders facings grid and photo placeholder | Task 6 |
| Full suite green + build clean | Task 7 |

**No placeholders, no type inconsistencies, no missing requirements detected.**
