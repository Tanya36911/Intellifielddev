# W4 Survey Builder + Assignments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Admin "Surveys" area: a list of the company's surveys, a by-hand question builder (six types, pass rules, per-product lines), publish-freezes-the-version, and assign-to-an-org-node-with-a-deadline, all on the existing backend.

**Architecture:** Two tiny additive backend changes (no migration, no new endpoint): optional `required`/`unit`/`lines` fields on the question model, and `latest_version` + a scope-aware `assigned` boolean on `GET /surveys`. The frontend adds `apps/admin/src/pages/Surveys/` as four flat routes (list, new, edit, assign) plus a `useSurveys` hook with pure translation helpers, following the exact W1/W3 pattern (TanStack Query, shared UI kit, CSS Modules, Vitest + Testing Library).

**Tech Stack:** FastAPI + SQLAlchemy + Postgres (backend); React 19 + TypeScript + Vite + React Router v7 + TanStack Query v5 + CSS Modules (frontend); pytest (backend tests), Vitest + React Testing Library (frontend tests).

## Global Constraints

- No em dashes anywhere in UI copy or code comments.
- No database migration and no new endpoint in W4: backend changes are limited to the two additive edits in Tasks 1 and 2.
- Commit straight to `main` after each task (no feature branches, no PRs). Do not `git push` (push auto-deploys; the user must approve a push separately).
- Follow existing conventions exactly: screens render `<Topbar>` (from `apps/admin/src/shell/Topbar`) + a scroll/page wrapper; data via `useQuery`/`useMutation` with `useQueryClient().invalidateQueries({ queryKey: ['surveys'] })`; the role check is `session?.user.role === 'admin'` (lowercase); tests use `renderApp(ui, { route, session })` from `apps/admin/src/test/render.tsx`.
- Backend question stored shape (the `pass` key uses the Pydantic alias): `{ id, prompt, type, options, sku_ids, perSku, pass, passScope, required, unit, lines }`. Pass rule is `{ operator, value }`; operators are exactly `>= <= > < == != in not_in` (same in authoring and scoring).
- Scorable types (carry a pass rule): `boolean`, `number`, `single_choice`. `multi_choice`, `photo`, `text` are logged only (no `pass`).
- Run backend tests with the database up: `docker compose up -d` then `pnpm test:api`. Run frontend tests with `pnpm test:admin`.
- Keep all docs updated in the final task (Task 10), in the same change set as the code.

---

## File Structure

**Backend (modify only):**
- `api/app/surveys.py` - add `required`, `unit`, `lines` to the `Question` model.
- `api/app/scope.py` - widen `ScopedRepo.list_surveys` (read-only SQL) with `latest_version` + `assigned`.
- `api/tests/test_surveys.py` - new round-trip and list-enrichment tests.

**Frontend (new under `apps/admin/src/pages/Surveys/`):**
- `useSurveys.ts` - types, Query/Mutation hooks, and pure helpers (`mapToBackendQuestion`, `mapFromBackendQuestion`, `passSummary`, `expandLinesToSkuIds`, `surveyStats`, `blankQuestion`).
- `useSurveys.test.ts` - unit tests for the pure helpers (the translation crux).
- `SurveyList.tsx` + `SurveyList.module.css` + `SurveyList.test.tsx` - the landing list.
- `PassConditionEditor.tsx` - the type-adaptive pass-rule editor.
- `QuestionCard.tsx` + `QuestionCard.module.css` - one editable question (embeds `PassConditionEditor`).
- `Builder.tsx` + `Builder.module.css` + `Builder.test.tsx` - the canvas (owns the question array; new vs edit; save/publish).
- `PublishConfirm.tsx` - the freeze confirmation (uses the shared `Modal`).
- `AssignPanel.tsx` + `AssignPanel.module.css` + `AssignPanel.test.tsx` - publish confirm + assign panel.

**Frontend (modify):**
- `apps/admin/src/App.tsx` - four flat `/surveys*` routes inside the `<Shell/>` layout route.
- `apps/admin/src/shell/Sidebar.tsx` (or wherever the nav array lives) - drop the "Form Builder" item; make "Surveys" a live route.

**Docs (modify, Task 10):** `apps/admin/README.md`, `CODEBASE_MAP.md`, `CHECKING_THE_WORK.md`, `START_HERE.md`, `CONTEXT.md`, `ROADMAP.md`, the prototype handoff CHANGELOG, and fix the stale operator description in `CONTEXT.md`'s Phase 4a log.

---

## Task 1: Backend - `required` / `unit` / `lines` on the question model

**Files:**
- Modify: `api/app/surveys.py` (the `Question` model, ~lines 35-51)
- Test: `api/tests/test_surveys.py`

**Interfaces:**
- Produces: questions may now carry `required: bool` (default false), `unit: str | null` (default null), `lines: list[str]` (default []), stored in `survey_versions.questions` JSONB and returned unchanged by `GET /surveys/{id}`.

- [ ] **Step 1: Write the failing test**

Add to `api/tests/test_surveys.py`:

```python
def test_question_extra_fields_round_trip(client, login):
    token = login("dana@lumenbeauty.com")
    resp = client.post(
        "/surveys",
        headers={"Authorization": f"Bearer {token}"},
        json={"name": "Extra Fields", "type": None,
              "questions": [{"id": "q1", "prompt": "How many facings?", "type": "number",
                             "required": True, "unit": "facings", "lines": ["Velvet Lip"]}]},
    )
    assert resp.status_code == 200, resp.text
    sid = resp.json()["id"]
    full = client.get(f"/surveys/{sid}", headers={"Authorization": f"Bearer {token}"}).json()
    q = full["versions"][0]["questions"][0]
    assert q["required"] is True
    assert q["unit"] == "facings"
    assert q["lines"] == ["Velvet Lip"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker compose up -d && pnpm test:api -- -k test_question_extra_fields_round_trip`
Expected: FAIL (the stored question lacks `required`/`unit`/`lines` because Pydantic drops unknown fields).

- [ ] **Step 3: Add the three optional fields to the `Question` model**

In `api/app/surveys.py`, inside `class Question(BaseModel)` (after `passScope`), add:

```python
    required: bool = False
    unit: str | None = None
    lines: list[str] = []
```

(They serialize through the existing `_questions_json` via `model_dump(by_alias=True, mode="json")`; `compliance.py` ignores them.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test:api -- -k test_question_extra_fields_round_trip`
Expected: PASS

- [ ] **Step 5: Run the full surveys suite to confirm no regression**

Run: `pnpm test:api -- -k surveys`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add api/app/surveys.py api/tests/test_surveys.py
git commit -m "W4: add optional required/unit/lines to the survey question model

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Backend - enrich `GET /surveys` with `latest_version` + `assigned`

**Files:**
- Modify: `api/app/scope.py` (`ScopedRepo.list_surveys`, ~lines 165-174)
- Test: `api/tests/test_surveys.py`

**Interfaces:**
- Consumes: `self.tenant_id`, `self.scope_path` (None for an unpinned caller).
- Produces: each survey dict from `list_surveys` (and thus each item in `GET /surveys`) gains `latest_version: int` and `assigned: bool`. `assigned` is true iff an in-scope `survey_assignment` targets one of this survey's versions; false for every row when `scope_path is None`.

- [ ] **Step 1: Write the failing tests**

Add to `api/tests/test_surveys.py` (helpers `_create_draft`, `_find`, `_node_id`, `_published_version_id` already exist in the file):

```python
def _publish(client, token, name):
    s = _find(client, token, name)
    r = client.post(f"/surveys/{s['id']}/publish", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200, r.text
    return s["id"]


def test_list_surveys_has_latest_version_and_assigned(client, login):
    dana = login("dana@lumenbeauty.com")
    # an unassigned, freshly published survey
    _create_draft(client, dana, "W4 Unassigned")
    _publish(client, dana, "W4 Unassigned")
    unassigned = _find(client, dana, "W4 Unassigned")
    assert unassigned["latest_version"] == 1
    assert unassigned["assigned"] is False

    # a published survey assigned to West only
    _create_draft(client, dana, "W4 West Only")
    _publish(client, dana, "W4 West Only")
    vid = _published_version_id(client, dana, "W4 West Only")
    r = client.post(
        "/survey-assignments",
        headers={"Authorization": f"Bearer {dana}"},
        json={"survey_version_id": vid, "target_node_id": str(_node_id("west"))},
    )
    assert r.status_code == 200, r.text

    # Dana (admin, full scope) sees it assigned
    assert _find(client, dana, "W4 West Only")["assigned"] is True
    # Sarah (manager pinned at Central) does NOT see a West-only assignment
    sarah = login("sarah@lumenbeauty.com")
    assert _find(client, sarah, "W4 West Only")["assigned"] is False
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:api -- -k test_list_surveys_has_latest_version_and_assigned`
Expected: FAIL with `KeyError: 'latest_version'`.

- [ ] **Step 3: Rewrite `list_surveys`**

Replace `ScopedRepo.list_surveys` in `api/app/scope.py` with (keeps surveys company-wide; only `assigned` is scope-aware, with an explicit `None` guard):

```python
    def list_surveys(self) -> list[dict]:
        # `assigned` is scope-aware: an assignment targeting a node within the
        # caller's subtree. Unpinned caller -> no scope -> nothing assigned.
        if self.scope_path is None:
            assigned_join = "left join (select null::uuid as survey_id where false) a on false"
        else:
            assigned_join = (
                "left join (select distinct sv.survey_id from survey_assignments sa "
                "join survey_versions sv on sv.id = sa.survey_version_id "
                "join nodes n on n.id = sa.target_node_id "
                "where sa.tenant_id = cast(:tid as uuid) and n.path like :scope || '%') "
                "a on a.survey_id = s.id"
            )
        params = {"tid": str(self.tenant_id)}
        if self.scope_path is not None:
            params["scope"] = self.scope_path
        with engine.connect() as conn:
            rows = conn.execute(
                text(
                    f"select {', '.join('s.' + c.strip() for c in self._SURVEY_COLS.split(','))}, "
                    "coalesce(v.latest_version, 1) as latest_version, "
                    "(a.survey_id is not null) as assigned "
                    "from surveys s "
                    "left join (select survey_id, max(version_number) as latest_version "
                    "from survey_versions group by survey_id) v on v.survey_id = s.id "
                    f"{assigned_join} "
                    "where s.tenant_id = cast(:tid as uuid) order by s.name"
                ),
                params,
            ).mappings().all()
        return [dict(r) for r in rows]
```

(`_SURVEY_COLS` is `"id, name, type, status, created_at"`; the comprehension prefixes each with `s.` so the join columns are unambiguous.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test:api -- -k test_list_surveys_has_latest_version_and_assigned`
Expected: PASS

- [ ] **Step 5: Run the full backend suite**

Run: `pnpm test:api`
Expected: all green (190+ tests; the existing `test_company_isolation` etc. still pass because the survey columns and ordering are unchanged).

- [ ] **Step 6: Commit**

```bash
git add api/app/scope.py api/tests/test_surveys.py
git commit -m "W4: GET /surveys returns latest_version + scope-aware assigned

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Frontend - `useSurveys` hook + pure translation helpers

**Files:**
- Create: `apps/admin/src/pages/Surveys/useSurveys.ts`
- Test: `apps/admin/src/pages/Surveys/useSurveys.test.ts`

**Interfaces:**
- Produces (types): `QType`, `PassRule`, `BuilderQuestion`, `BackendQuestion`, `Survey`, `SurveyDetail`, `SurveyVersion`.
- Produces (hooks): `useSurveyList()`, `useSurvey(id)`, `useCreateSurvey()`, `useUpdateVersion()`, `usePublish()`, `useNewVersion()`, `useCreateAssignment()`, `useNodes()`.
- Produces (pure): `blankQuestion(type) -> BuilderQuestion`, `mapToBackendQuestion(q, catalog) -> BackendQuestion`, `mapFromBackendQuestion(b) -> BuilderQuestion`, `passSummary(q) -> string | null`, `expandLinesToSkuIds(lines, skus) -> string[]`, `surveyStats(surveys) -> {total, published, draft}`, `SCORABLE: Set<QType>`, `OP_LABEL`.
- Consumes: `apiGet`/`apiSend` from `../../lib/api`; `Sku` from `../Catalog/useCatalog`.

- [ ] **Step 1: Write the failing helper tests**

Create `apps/admin/src/pages/Surveys/useSurveys.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  mapToBackendQuestion,
  mapFromBackendQuestion,
  passSummary,
  expandLinesToSkuIds,
  surveyStats,
  blankQuestion,
  type BuilderQuestion,
} from './useSurveys'
import type { Sku } from '../Catalog/useCatalog'

const sku = (id: string, line: string, status: Sku['status'] = 'active'): Sku => ({
  id, line, variant: id, upc: id, color: null, status, reference_images: [], created_at: '',
})
const CATALOG: Sku[] = [
  sku('v1', 'Velvet Lip'), sku('v2', 'Velvet Lip'), sku('vDISC', 'Velvet Lip', 'discontinued'),
  sku('s1', 'Silk Foundation'),
]

describe('expandLinesToSkuIds', () => {
  it('returns only active sku ids for the chosen lines', () => {
    expect(expandLinesToSkuIds(['Velvet Lip'], CATALOG).sort()).toEqual(['v1', 'v2'])
  })
  it('excludes discontinued and other lines', () => {
    expect(expandLinesToSkuIds(['Velvet Lip'], CATALOG)).not.toContain('vDISC')
    expect(expandLinesToSkuIds(['Velvet Lip'], CATALOG)).not.toContain('s1')
  })
})

describe('mapToBackendQuestion', () => {
  it('maps a Yes pass rule to == true', () => {
    const q: BuilderQuestion = { ...blankQuestion('boolean'), prompt: 'Built?', pass: { operator: '==', value: true } }
    expect(mapToBackendQuestion(q, CATALOG).pass).toEqual({ operator: '==', value: true })
  })
  it('drops the pass rule for logged-only types (multi_choice/photo/text)', () => {
    const q: BuilderQuestion = { ...blankQuestion('multi_choice'), options: ['a'], pass: { operator: 'in', value: ['a'] } }
    expect(mapToBackendQuestion(q, CATALOG).pass).toBeNull()
  })
  it('forces passScope each for a non-number type', () => {
    const q: BuilderQuestion = { ...blankQuestion('single_choice'), perSku: true, passScope: 'total', options: ['a'] }
    expect(mapToBackendQuestion(q, CATALOG).passScope).toBe('each')
  })
  it('sends the captured sku_ids and lines verbatim, never re-deriving', () => {
    const q: BuilderQuestion = { ...blankQuestion('number'), perSku: true, lines: ['Velvet Lip'], skuIds: ['v1', 'v2'] }
    const b = mapToBackendQuestion(q, CATALOG)
    expect(b.sku_ids).toEqual(['v1', 'v2'])
    expect(b.lines).toEqual(['Velvet Lip'])
  })
})

describe('mapFromBackendQuestion round-trips', () => {
  it('restores lines, skuIds, pass, unit, passScope', () => {
    const b = {
      id: 'q1', prompt: 'Facings?', type: 'number' as const, options: [], sku_ids: ['v1', 'v2'],
      perSku: true, pass: { operator: '>=', value: 4 }, passScope: 'each' as const,
      required: true, unit: 'facings', lines: ['Velvet Lip'],
    }
    const q = mapFromBackendQuestion(b)
    expect(q.lines).toEqual(['Velvet Lip'])
    expect(q.skuIds).toEqual(['v1', 'v2'])
    expect(q.pass).toEqual({ operator: '>=', value: 4 })
    expect(q.unit).toBe('facings')
    expect(q.passScope).toBe('each')
    expect(q.required).toBe(true)
  })
})

describe('passSummary', () => {
  it('boolean', () => {
    expect(passSummary({ ...blankQuestion('boolean'), pass: { operator: '==', value: true } })).toBe('Pass = Yes')
  })
  it('per-product number, each', () => {
    const q: BuilderQuestion = { ...blankQuestion('number'), perSku: true, unit: 'facings', passScope: 'each', pass: { operator: '>=', value: 4 } }
    expect(passSummary(q)).toBe('Pass = each >= 4 facings')
  })
  it('single choice', () => {
    expect(passSummary({ ...blankQuestion('single_choice'), options: ['A', 'B'], pass: { operator: 'in', value: ['A'] } })).toBe('Pass = A')
  })
  it('returns null when unscored', () => {
    expect(passSummary(blankQuestion('photo'))).toBeNull()
  })
})

describe('surveyStats', () => {
  it('counts by status', () => {
    const s = surveyStats([
      { status: 'published' }, { status: 'published' }, { status: 'draft' }, { status: 'archived' },
    ] as any)
    expect(s).toEqual({ total: 4, published: 2, draft: 1 })
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test:admin -- useSurveys`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `useSurveys.ts`**

Create `apps/admin/src/pages/Surveys/useSurveys.ts`:

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiSend } from '../../lib/api'
import type { Sku } from '../Catalog/useCatalog'

export type QType = 'boolean' | 'number' | 'single_choice' | 'multi_choice' | 'photo' | 'text'
export type PassRule = { operator: string; value: boolean | number | string | (string | number)[] }

export type BuilderQuestion = {
  id: string
  type: QType
  prompt: string
  required: boolean
  unit: string
  options: string[]
  perSku: boolean
  lines: string[]
  skuIds: string[]
  passScope: 'each' | 'total'
  pass: PassRule | null
}

export type BackendQuestion = {
  id: string
  prompt: string
  type: QType
  options: string[]
  sku_ids: string[]
  perSku: boolean
  pass: PassRule | null
  passScope: 'each' | 'total'
  required: boolean
  unit: string | null
  lines: string[]
}

export type Survey = {
  id: string; name: string; type: string | null
  status: 'draft' | 'published' | 'archived'
  created_at: string; latest_version: number; assigned: boolean
}
export type SurveyVersion = {
  id: string; survey_id: string; version_number: number
  questions: BackendQuestion[]; published_at: string | null; created_at: string
}
export type SurveyDetail = Omit<Survey, 'latest_version' | 'assigned'> & { versions: SurveyVersion[] }

export type Node = {
  id: string; name: string; code: string; level_order: number
  parent_id: string | null; path: string
}

export const SCORABLE = new Set<QType>(['boolean', 'number', 'single_choice'])
export const OP_LABEL: Record<string, string> = {
  '>=': '>=', '<=': '<=', '>': '>', '<': '<', '==': '=',
}

// ----- hooks -----
export function useSurveyList() {
  return useQuery({ queryKey: ['surveys'], queryFn: () => apiGet<{ surveys: Survey[] }>('/surveys') })
}
export function useSurvey(id: string | undefined) {
  return useQuery({
    queryKey: ['surveys', id],
    queryFn: () => apiGet<SurveyDetail>(`/surveys/${id}`),
    enabled: !!id,
  })
}
export function useNodes() {
  return useQuery({ queryKey: ['nodes'], queryFn: () => apiGet<{ nodes: Node[] }>('/nodes') })
}
export function useCreateSurvey() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { name: string; questions: BackendQuestion[] }) =>
      apiSend<SurveyDetail>('POST', '/surveys', { ...body, type: null }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['surveys'] }),
  })
}
export function useUpdateVersion() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ surveyId, versionId, questions }: { surveyId: string; versionId: string; questions: BackendQuestion[] }) =>
      apiSend<SurveyVersion>('PATCH', `/surveys/${surveyId}/versions/${versionId}`, { questions }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['surveys'] }),
  })
}
export function usePublish() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (surveyId: string) => apiSend<SurveyDetail>('POST', `/surveys/${surveyId}/publish`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['surveys'] }),
  })
}
export function useNewVersion() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (surveyId: string) => apiSend<SurveyVersion>('POST', `/surveys/${surveyId}/versions`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['surveys'] }),
  })
}
export function useCreateAssignment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { survey_version_id: string; target_node_id: string; deadline: string | null; timezone_basis: string }) =>
      apiSend<{ id: string }>('POST', '/survey-assignments', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['surveys'] }),
  })
}

// ----- pure helpers -----
export function blankQuestion(type: QType): BuilderQuestion {
  return {
    id: 'q' + Math.random().toString(36).slice(2, 9),
    type, prompt: '', required: false, unit: '', options: type === 'single_choice' || type === 'multi_choice' ? ['Option 1'] : [],
    perSku: false, lines: [], skuIds: [], passScope: 'each', pass: null,
  }
}

export function expandLinesToSkuIds(lines: string[], skus: Sku[]): string[] {
  const set = new Set(lines)
  return skus.filter((s) => set.has(s.line) && s.status === 'active').map((s) => s.id)
}

export function mapToBackendQuestion(q: BuilderQuestion): BackendQuestion {
  const isNumber = q.type === 'number'
  const scored = SCORABLE.has(q.type) ? q.pass : null
  return {
    id: q.id,
    prompt: q.prompt,
    type: q.type,
    options: q.type === 'single_choice' || q.type === 'multi_choice' ? q.options : [],
    sku_ids: q.perSku ? q.skuIds : [],
    perSku: q.perSku,
    pass: scored,
    passScope: isNumber ? q.passScope : 'each',
    required: q.required,
    unit: isNumber && q.unit.trim() ? q.unit.trim() : null,
    lines: q.perSku ? q.lines : [],
  }
}

export function mapFromBackendQuestion(b: BackendQuestion): BuilderQuestion {
  return {
    id: b.id,
    type: b.type,
    prompt: b.prompt,
    required: b.required ?? false,
    unit: b.unit ?? '',
    options: b.options ?? [],
    perSku: b.perSku ?? false,
    lines: b.lines ?? [],
    skuIds: b.sku_ids ?? [],
    passScope: b.passScope ?? 'each',
    pass: b.pass ?? null,
  }
}

export function passSummary(q: BuilderQuestion): string | null {
  if (!q.pass) return null
  if (q.type === 'boolean') return q.pass.value === true ? 'Pass = Yes' : q.pass.value === false ? 'Pass = No' : null
  if (q.type === 'number') {
    const op = OP_LABEL[q.pass.operator] ?? q.pass.operator
    const unit = q.unit.trim() ? ` ${q.unit.trim()}` : ''
    const scope = q.perSku ? (q.passScope === 'total' ? 'total ' : 'each ') : ''
    return `Pass = ${scope}${op} ${q.pass.value}${unit}`
  }
  if (q.type === 'single_choice') {
    const vals = Array.isArray(q.pass.value) ? q.pass.value : [q.pass.value]
    return vals.length ? `Pass = ${vals.join(' / ')}` : null
  }
  return null
}

export function surveyStats(surveys: Pick<Survey, 'status'>[]): { total: number; published: number; draft: number } {
  return {
    total: surveys.length,
    published: surveys.filter((s) => s.status === 'published').length,
    draft: surveys.filter((s) => s.status === 'draft').length,
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test:admin -- useSurveys`
Expected: PASS (all helper tests).

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter admin exec tsc --noEmit` (or the repo's typecheck script)
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/admin/src/pages/Surveys/useSurveys.ts apps/admin/src/pages/Surveys/useSurveys.test.ts
git commit -m "W4: useSurveys hook + pure translation helpers (with tests)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Frontend - routing + nav

**Files:**
- Modify: `apps/admin/src/App.tsx`
- Modify: the sidebar nav source (`apps/admin/src/shell/Sidebar.tsx` - inspect for the nav item array)
- Test: extend `apps/admin/src/App.test.tsx` (or add a small nav test)

**Interfaces:**
- Consumes: `SurveyList`, `Builder`, `AssignPanel` (created in later tasks; for this task use a temporary inline placeholder if needed so routing compiles, then wire the real components in their tasks). To avoid placeholders, do Task 4 AFTER Tasks 5/8/9 OR import the components and accept that the route file references them. **Order note:** implement Task 4's route wiring last among the screen tasks if a fresh worker is doing strict TDD; the subagent runner will wire routes when the components exist.

- [ ] **Step 1: Update `App.tsx` routes**

Replace the `/surveys` and `/forms` lines in `apps/admin/src/App.tsx` with:

```tsx
import SurveyList from './pages/Surveys/SurveyList'
import Builder from './pages/Surveys/Builder'
import AssignPanel from './pages/Surveys/AssignPanel'
// ...
        <Route path="/surveys" element={<SurveyList />} />
        <Route path="/surveys/new" element={<Builder />} />
        <Route path="/surveys/:id/edit" element={<Builder />} />
        <Route path="/surveys/:id/assign" element={<AssignPanel />} />
        {/* remove the old /forms ComingSoon route */}
        <Route path="/hierarchy" element={<ComingSoon title="Hierarchy" />} />
```

- [ ] **Step 2: Update the sidebar nav**

In the sidebar nav array, remove the "Form Builder" / `/forms` item, and ensure the "Surveys" / `/surveys` item is a normal (not "coming soon") link. (Inspect `apps/admin/src/shell/Sidebar.tsx` for the exact array shape; mirror how `/catalog` is listed as a live item.)

- [ ] **Step 3: Add a nav/routing test**

In `apps/admin/src/App.test.tsx` add:

```tsx
it('shows the Surveys screen at /surveys and has no Form Builder nav item', () => {
  renderApp(<App />, { route: '/surveys', session: signedInAdmin })  // reuse the file's existing session fixture
  expect(screen.getByText(/surveys/i)).toBeInTheDocument()
  expect(screen.queryByText(/form builder/i)).not.toBeInTheDocument()
})
```

(Use the same signed-in session fixture `App.test.tsx` already uses for its landing test.)

- [ ] **Step 4: Run tests + typecheck**

Run: `pnpm test:admin -- App` then `pnpm --filter admin exec tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/App.tsx apps/admin/src/shell/Sidebar.tsx apps/admin/src/App.test.tsx
git commit -m "W4: route the Surveys area (list/new/edit/assign); drop Form Builder nav

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Frontend - Surveys list screen

**Files:**
- Create: `apps/admin/src/pages/Surveys/SurveyList.tsx`, `SurveyList.module.css`
- Test: `apps/admin/src/pages/Surveys/SurveyList.test.tsx`

**Interfaces:**
- Consumes: `useSurveyList`, `surveyStats`, `Survey` from `./useSurveys`; `Topbar` from `../../shell/Topbar`; `Button`, `Card`, `Icon`, `Chip` from `../../ui`; `useNavigate` from `react-router-dom`; `selectSession`/`useAppSelector` from `../../store`.
- Produces: default export `SurveyList` (route `/surveys`).

**Behavior:** Mirror `Catalog.tsx`'s structure (Topbar with a primary action for admins, a scroll/page wrapper, three `StatTile`s, an `EmptyState`). Three stat tiles: Surveys (`stats.total`), Published (`stats.published`), Draft (`stats.draft`). Rows show name, a status chip (`published` -> green "Published", `draft` -> amber "Draft", `archived` -> grey "Archived"), a version chip `v{latest_version}`, and "Assigned" (accent chip) vs "Not assigned yet" (grey hint) from `assigned`. Row actions by status: published -> `Assign` (`navigate('/surveys/{id}/assign')`) + `Edit` (`navigate('/surveys/{id}/edit')`); draft -> `Continue editing`; archived -> disabled `Edit`. The Topbar's primary "New survey" button (admins only) -> `navigate('/surveys/new')`. Loading -> inline "Loading...". Empty -> an EmptyState inviting "New survey". Non-admins see read-only (no New/Assign/Edit actions).

- [ ] **Step 1: Write the failing test**

Create `apps/admin/src/pages/Surveys/SurveyList.test.tsx`:

```tsx
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import { renderApp } from '../../test/render'
import { adminSession } from '../../test/fixtures' // reuse existing admin session fixture
import SurveyList from './SurveyList'
import * as api from '../../lib/api'

const SURVEYS = [
  { id: 's1', name: 'Velvet Lip Shelf Check', type: null, status: 'published', created_at: '', latest_version: 2, assigned: true },
  { id: 's2', name: 'Spring Reset', type: null, status: 'draft', created_at: '', latest_version: 1, assigned: false },
]

beforeEach(() => {
  vi.spyOn(api, 'apiGet').mockImplementation(async (path: string) => {
    if (path === '/surveys') return { surveys: SURVEYS } as any
    return {} as any
  })
})

describe('SurveyList', () => {
  it('renders surveys with status, version, and assignment', async () => {
    renderApp(<SurveyList />, { session: adminSession })
    expect(await screen.findByText('Velvet Lip Shelf Check')).toBeInTheDocument()
    expect(screen.getByText('Published')).toBeInTheDocument()
    expect(screen.getByText('v2')).toBeInTheDocument()
    expect(screen.getByText(/assigned/i)).toBeInTheDocument()
    expect(screen.getByText('Draft')).toBeInTheDocument()
  })
})
```

(If `apps/admin/src/test/fixtures.ts` lacks an `adminSession` export, add one mirroring the existing Dana fixture used by other tests, with `user.role === 'admin'`.)

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test:admin -- SurveyList`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `SurveyList.tsx` + CSS**

Build the component per the Behavior above, mirroring `Catalog.tsx` (StatTile, EmptyState, Topbar, the `styles.scroll`/`styles.page` wrappers). Create `SurveyList.module.css` mirroring `Catalog.module.css` (stats grid, page wrapper, row styles). Status chip color: `published` -> `<Chip tone="green">`, `draft` -> `<Chip tone="amber">`, `archived` -> `<Chip>` (inspect `Chip`'s prop name in `apps/admin/src/ui/Chip.tsx`; use it consistently).

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test:admin -- SurveyList`
Expected: PASS

- [ ] **Step 5: Typecheck + commit**

```bash
pnpm --filter admin exec tsc --noEmit
git add apps/admin/src/pages/Surveys/SurveyList.tsx apps/admin/src/pages/Surveys/SurveyList.module.css apps/admin/src/pages/Surveys/SurveyList.test.tsx apps/admin/src/test/fixtures.ts
git commit -m "W4: Surveys list screen (stats, status/version/assigned, row actions)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Frontend - PassConditionEditor

**Files:**
- Create: `apps/admin/src/pages/Surveys/PassConditionEditor.tsx`
- Test: covered via `QuestionCard.test.tsx` (Task 7) and the helper tests (Task 3); no separate test file required, but a small render test is welcome.

**Interfaces:**
- Consumes: `BuilderQuestion`, `PassRule`, `OP_LABEL` from `./useSurveys`; `Segmented` from `../../ui`.
- Produces: `export function PassConditionEditor({ q, onChange }: { q: BuilderQuestion; onChange: (q: BuilderQuestion) => void })`.

**Behavior (type-adaptive; sets `q.pass` and, for number, `q.passScope`):**
- `boolean`: a `Segmented` with options `['Pass = Yes', 'Pass = No', 'No condition']` setting `pass` to `{operator:'==', value:true}` / `{operator:'==', value:false}` / `null`.
- `number`: an operator `<select>` (`>=`, `<=`, `>`, `<`, `==`, plus a "No condition" empty option) + a numeric `<input>` for the value -> `{operator, value:Number(...)}` or `null`. If `q.perSku`, also show a `Segmented` `['Each shade on its own', 'One combined total']` setting `passScope` to `each`/`total`, with helper text: total -> "Sums the shades that were answered; blanks are ignored." each -> "Every selected shade must pass on its own."
- `single_choice`: render each option in `q.options` as a toggle chip; selected options form `pass = {operator:'in', value:[...selected]}` (or `null` when none).
- `multi_choice` / `photo` / `text`: render a muted line "No auto-pass condition for this type. The answer is still logged." (no control).

- [ ] **Step 1: Implement the component** (no standalone failing test; it is exercised by Task 7). Build per Behavior, using the `==` operator value for the UI "=" label via `OP_LABEL`.

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter admin exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/admin/src/pages/Surveys/PassConditionEditor.tsx
git commit -m "W4: type-adaptive pass-condition editor

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Frontend - QuestionCard

**Files:**
- Create: `apps/admin/src/pages/Surveys/QuestionCard.tsx`, `QuestionCard.module.css`
- Test: `apps/admin/src/pages/Surveys/QuestionCard.test.tsx`

**Interfaces:**
- Consumes: `BuilderQuestion`, `QType`, `passSummary`, `SCORABLE`, `expandLinesToSkuIds` from `./useSurveys`; `Sku` from `../Catalog/useCatalog`; `PassConditionEditor` from `./PassConditionEditor`; `Icon`, `Chip`, `Button`, `Switch`, `Input` from `../../ui`.
- Produces: `export function QuestionCard({ q, index, total, catalog, onChange, onDelete, onDup, onMove }: {...})` where `onMove(index, dir: -1 | 1)`.

**Behavior:** One question card. Header row: a type badge (icon + label) with a type-change menu (the six types); a "Required" chip when required; a per-product chip when `perSku` ("Per product (N)"); and a clickable pass chip showing `passSummary(q)` or "Set pass condition" (scorable) / "Logged, not scored" (non-scorable). Reorder controls: up/down arrow buttons calling `onMove(index, -1|1)` (disabled at ends). Prompt: an `<input>` bound to `q.prompt`. Type-specific config: for choice types, an editable option list (add/remove options); for number, a "Unit" `<input>` bound to `q.unit`. A settings area (toggle open) with: a "Required to submit" `Switch`; an "Ask per product" `Switch` (`perSku`); when `perSku`, a line-picker (chips for each catalog line; toggling a line updates `q.lines` AND recomputes `q.skuIds = expandLinesToSkuIds(q.lines, catalog)` immediately so the freeze is captured at toggle time), plus a note "1 question expands to N per-product answers" and a red note when `skuIds.length === 0`. The inline `PassConditionEditor` opens from the pass chip. Row actions: duplicate, delete.

**Key wiring (capture sku_ids at line-toggle):**

```tsx
function toggleLine(line: string) {
  const lines = q.lines.includes(line) ? q.lines.filter((l) => l !== line) : [...q.lines, line]
  onChange({ ...q, lines, skuIds: expandLinesToSkuIds(lines, catalog) })
}
```

- [ ] **Step 1: Write the failing test**

Create `apps/admin/src/pages/Surveys/QuestionCard.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { QuestionCard } from './QuestionCard'
import { blankQuestion } from './useSurveys'
import type { Sku } from '../Catalog/useCatalog'

const CATALOG: Sku[] = [
  { id: 'v1', line: 'Velvet Lip', variant: 'Rosewood', upc: '', color: null, status: 'active', reference_images: [], created_at: '' },
  { id: 'v2', line: 'Velvet Lip', variant: 'Mauve', upc: '', color: null, status: 'active', reference_images: [], created_at: '' },
]

it('captures sku ids when a line is toggled on a per-product number question', () => {
  const onChange = vi.fn()
  const q = { ...blankQuestion('number'), prompt: 'Facings?', perSku: true }
  render(<QuestionCard q={q} index={0} total={1} catalog={CATALOG} onChange={onChange} onDelete={() => {}} onDup={() => {}} onMove={() => {}} />)
  fireEvent.click(screen.getByText(/Velvet Lip/i))
  const updated = onChange.mock.calls.at(-1)![0]
  expect(updated.lines).toContain('Velvet Lip')
  expect(updated.skuIds.sort()).toEqual(['v1', 'v2'])
})

it('shows the pass summary chip for a scored question', () => {
  const q = { ...blankQuestion('boolean'), prompt: 'Built?', pass: { operator: '==', value: true } }
  render(<QuestionCard q={q} index={0} total={1} catalog={[]} onChange={() => {}} onDelete={() => {}} onDup={() => {}} onMove={() => {}} />)
  expect(screen.getByText('Pass = Yes')).toBeInTheDocument()
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test:admin -- QuestionCard`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `QuestionCard.tsx` + CSS** per the Behavior, mirroring the prototype's `QuestionCard` look (`formbuilder-parts.jsx`) but using the production UI kit and CSS Modules. Ensure the "Ask per product" toggle is shown for any type but the each/total scope (inside `PassConditionEditor`) only appears for number.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test:admin -- QuestionCard`
Expected: PASS

- [ ] **Step 5: Typecheck + commit**

```bash
pnpm --filter admin exec tsc --noEmit
git add apps/admin/src/pages/Surveys/QuestionCard.tsx apps/admin/src/pages/Surveys/QuestionCard.module.css apps/admin/src/pages/Surveys/QuestionCard.test.tsx
git commit -m "W4: editable question card (types, per-product line picker, pass editor, reorder)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Frontend - Builder screen

**Files:**
- Create: `apps/admin/src/pages/Surveys/Builder.tsx`, `Builder.module.css`
- Test: `apps/admin/src/pages/Surveys/Builder.test.tsx`

**Interfaces:**
- Consumes: `useParams`/`useNavigate` from `react-router-dom`; `useSurvey`, `useCreateSurvey`, `useUpdateVersion`, `usePublish`, `useNewVersion`, `mapToBackendQuestion`, `mapFromBackendQuestion`, `blankQuestion`, `BuilderQuestion`, `QType` from `./useSurveys`; `useSkus` from `../Catalog/useCatalog`; `QuestionCard`; `Topbar`, `Button`, `Card`, `Icon`, `Chip` from the kit/shell.
- Produces: default export `Builder` (routes `/surveys/new` and `/surveys/:id/edit`).

**Behavior:**
- New mode (`/surveys/new`, no `:id`): start with `name=''` and `questions=[]`.
- Edit mode (`/surveys/:id/edit`): `useSurvey(id)`; the editable version is the one with `published_at === null` (the latest); if none (only published), enter "edit a published" state -> show the amber banner and, on the first edit/save, call `useNewVersion(id)` to spin a fresh draft (handle a 409 by re-fetching and editing the existing draft). Load questions via `mapFromBackendQuestion`.
- Question array ops: add (a "+ type" row of the six types -> `blankQuestion(type)`), duplicate, delete, reorder via `onMove`.
- `<Topbar>` title "Form Builder", subtitle = the survey name; the right rail (sticky `Card`s): primary "Publish & assign" + secondary "Save draft" + a "this version" card (status chip + `v{n}`).
- **Validate before Save/Publish** (block + inline message): every question has a non-empty `prompt`; every choice question has >=1 option; every `perSku` question has `skuIds.length > 0`.
- **Save draft:** `questions = builderQuestions.map(mapToBackendQuestion)`. If new (no id yet): `const r = await createSurvey.mutateAsync({ name, questions }); navigate('/surveys/' + r.id + '/edit', { replace: true })`. Else: `updateVersion.mutateAsync({ surveyId, versionId, questions })`.
- **Publish & assign:** Save first (as above, resolving the survey id + that it has a draft), then `await publish.mutateAsync(surveyId)`, read the published version id from the returned `versions` (the one with `published_at` set and the highest `version_number`), then `navigate('/surveys/' + surveyId + '/assign', { state: { versionId, name } })`. A publish-race 409 -> show "Already published; reloading" and refetch.
- Leaving the builder discards unsaved local edits (v1; no confirm guard).

- [ ] **Step 1: Write the failing test**

Create `apps/admin/src/pages/Surveys/Builder.test.tsx`:

```tsx
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import { renderApp } from '../../test/render'
import { adminSession } from '../../test/fixtures'
import Builder from './Builder'
import * as api from '../../lib/api'

beforeEach(() => {
  vi.spyOn(api, 'apiGet').mockImplementation(async (path: string) => {
    if (path === '/skus') return { skus: [{ id: 'v1', line: 'Velvet Lip', variant: 'Rosewood', upc: '', color: null, status: 'active', reference_images: [], created_at: '' }] } as any
    return {} as any
  })
})

it('on first save it POSTs translated questions and navigates to the edit route', async () => {
  const send = vi.spyOn(api, 'apiSend').mockResolvedValue({ id: 'new1', name: 'My Survey', status: 'draft', versions: [{ id: 'ver1', version_number: 1, published_at: null, questions: [] }] } as any)
  renderApp(<Builder />, { route: '/surveys/new', session: adminSession })
  fireEvent.change(screen.getByPlaceholderText(/survey name/i), { target: { value: 'My Survey' } })
  fireEvent.click(screen.getByRole('button', { name: /yes \/ no/i }))            // add a question
  fireEvent.change(screen.getByPlaceholderText(/question/i), { target: { value: 'Built?' } })
  fireEvent.click(screen.getByRole('button', { name: /save draft/i }))
  await waitFor(() => expect(send).toHaveBeenCalledWith('POST', '/surveys', expect.objectContaining({ name: 'My Survey' })))
  const body = send.mock.calls[0][2] as any
  expect(body.questions[0].type).toBe('boolean')   // translated to backend type
})
```

(Routing assertions for the post-save redirect can use the `App`-level test if `renderApp` of a bare `Builder` does not expose the navigation; at minimum assert the `apiSend` POST shape. The full redirect is covered by the AssignPanel/App flow.)

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test:admin -- Builder`
Expected: FAIL.

- [ ] **Step 3: Implement `Builder.tsx` + CSS** per the Behavior.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test:admin -- Builder`
Expected: PASS

- [ ] **Step 5: Typecheck + commit**

```bash
pnpm --filter admin exec tsc --noEmit
git add apps/admin/src/pages/Surveys/Builder.tsx apps/admin/src/pages/Surveys/Builder.module.css apps/admin/src/pages/Surveys/Builder.test.tsx
git commit -m "W4: survey Builder (new/edit, validate, save draft, publish -> assign)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Frontend - PublishConfirm + AssignPanel

**Files:**
- Create: `apps/admin/src/pages/Surveys/PublishConfirm.tsx`
- Create: `apps/admin/src/pages/Surveys/AssignPanel.tsx`, `AssignPanel.module.css`
- Test: `apps/admin/src/pages/Surveys/AssignPanel.test.tsx`

**Interfaces:**
- `PublishConfirm`: `export function PublishConfirm({ open, version, onCancel, onConfirm }: {...})` - a `Modal` with the freeze warning and "Publish v{n}" / "Cancel".
- `AssignPanel` (route `/surveys/:id/assign`): consumes `useParams`/`useLocation`/`useNavigate` (reads `versionId`+`name` from router `state`, falling back to `useSurvey(id)` to find the published version), `useNodes`, `useCreateAssignment`; `Topbar`, `Button`, `Card`, `Switch`, `Segmented`, `Icon`, `Input` from kit/shell.

**Behavior (AssignPanel):**
- Node list from `useNodes()`. The shallowest node (min `level_order`) is the "all stores" target; an "all stores you manage" toggle selects it exclusively. Other nodes (regions/districts) are individually toggleable; selecting "all stores" disables and clears the others.
- Deadline: a date `<input type="date">` + time `<input type="time">`; combine into a UTC ISO instant via `new Date(\`${date}T${time}\`).toISOString()` (the browser's local zone), or `null` if either is blank.
- Timezone basis: a `Segmented` `['Rep-local', 'Corporate (ET)']` -> `'rep-local'` / `'corporate'`, with a helper line "Stored as a preference; it does not change when the deadline lands per store yet."
- "Assign" -> for each selected node id: `await createAssignment.mutateAsync({ survey_version_id: versionId, target_node_id: nodeId, deadline, timezone_basis })`. On success, `navigate('/surveys')`. Show an inline error on failure (e.g. a 404/400).
- No client-side reach estimate (cut). After assigning, the list reflects "Assigned".

- [ ] **Step 1: Write the failing test**

Create `apps/admin/src/pages/Surveys/AssignPanel.test.tsx`:

```tsx
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import { renderApp } from '../../test/render'
import { adminSession } from '../../test/fixtures'
import AssignPanel from './AssignPanel'
import * as api from '../../lib/api'

beforeEach(() => {
  vi.spyOn(api, 'apiGet').mockImplementation(async (path: string) => {
    if (path === '/nodes') return { nodes: [
      { id: 'root', name: 'Lumen Beauty', code: 'lumen', level_order: 0, parent_id: null, path: '/root/' },
      { id: 'west', name: 'West Region', code: 'west', level_order: 1, parent_id: 'root', path: '/root/west/' },
    ] } as any
    if (path.startsWith('/surveys/')) return { id: 's1', name: 'Velvet Lip Shelf Check', status: 'published', versions: [{ id: 'ver1', version_number: 1, published_at: '2026-06-23', questions: [] }] } as any
    return {} as any
  })
})

it('assigns to the selected node then navigates back', async () => {
  const send = vi.spyOn(api, 'apiSend').mockResolvedValue({ id: 'a1' } as any)
  renderApp(<AssignPanel />, { route: '/surveys/s1/assign', session: adminSession })
  // default selection is "all stores" (root); just assign
  fireEvent.click(await screen.findByRole('button', { name: /^assign$/i }))
  await waitFor(() => expect(send).toHaveBeenCalledWith('POST', '/survey-assignments', expect.objectContaining({ target_node_id: 'root', timezone_basis: 'rep-local' })))
})
```

(Note: to read the route param, the test renders the bare component at `route: '/surveys/s1/assign'`; ensure `AssignPanel` reads `useParams().id` and falls back to `useSurvey(id)` for the published version id since router `state` is absent in this isolated render.)

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test:admin -- AssignPanel`
Expected: FAIL.

- [ ] **Step 3: Implement `PublishConfirm.tsx` and `AssignPanel.tsx` + CSS** per the Behavior. (Wire `PublishConfirm` into `Builder` if the publish confirmation is shown there before navigating; otherwise show it at the top of `AssignPanel` before the panel is usable. Per the spec, publish happens in the Builder right before navigating to assign, so `PublishConfirm` is rendered by `Builder`; `AssignPanel` assumes the version is already published.)

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test:admin -- AssignPanel`
Expected: PASS

- [ ] **Step 5: Run the full frontend suite**

Run: `pnpm test:admin`
Expected: all green.

- [ ] **Step 6: Typecheck + build + commit**

```bash
pnpm --filter admin exec tsc --noEmit
pnpm --filter admin build
git add apps/admin/src/pages/Surveys/PublishConfirm.tsx apps/admin/src/pages/Surveys/AssignPanel.tsx apps/admin/src/pages/Surveys/AssignPanel.module.css apps/admin/src/pages/Surveys/AssignPanel.test.tsx
git commit -m "W4: publish confirmation + assign panel (nodes, deadline, timezone)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Docs + final verification

**Files:**
- Modify: `apps/admin/README.md`, `CODEBASE_MAP.md`, `CHECKING_THE_WORK.md`, `START_HERE.md`, `CONTEXT.md`, `ROADMAP.md`, `../hi-fi-intelli/...CHANGELOG` (the prototype handoff CHANGELOG).

- [ ] **Step 1: Update the guides**

- `apps/admin/README.md`: add the `pages/Surveys/` files and their jobs (plain English).
- `CODEBASE_MAP.md`: add a "As of W4" paragraph (the Surveys area: list -> builder -> publish -> assign, on `/surveys`, `/survey-assignments`, `/skus`, `/nodes`).
- `CHECKING_THE_WORK.md`: a walkthrough (log in -> Surveys -> New -> add a Yes/No + a per-product Number with a pass rule -> Publish -> Assign to a node with a deadline -> see it Published + Assigned on the list).
- `START_HERE.md` + `CONTEXT.md`: a "W4 DONE" entry; update the resume prompt's "what's next" to W5 (Responses). **Also fix the stale operator description in `CONTEXT.md`'s 2026-06-16 Phase 4a log:** change `operators: gte, lte, eq, min_choices, max_choices` to `operators: >= <= > < == != in not_in`.
- `ROADMAP.md`: tick **W4** done; note W5 (Responses) next.
- Prototype handoff CHANGELOG: a W4 entry.

- [ ] **Step 2: Final full verification**

Run:
```bash
docker compose up -d
pnpm test:api      # expect all green (190+ plus the 2 new tests)
pnpm test:admin    # expect all green (80+ plus the new tests)
pnpm --filter admin build   # expect a clean build
```
Expected: all three pass.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "W4 docs: Survey builder + assignments complete (guides, roadmap, CHANGELOG)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-review checklist (run before execution)
- **Spec coverage:** list (T5), builder + six types + pass editor + per-product (T6/T7/T8), publish + assign (T9), backend required/unit/lines (T1), latest_version + assigned (T2), translation helpers (T3), routing/nav (T4), docs incl. the operator fix (T10). All covered.
- **Freeze integrity:** sku_ids captured at line-toggle (T7) and sent verbatim by `mapToBackendQuestion` (T3); never re-derived. Covered.
- **Type consistency:** `mapToBackendQuestion`/`mapFromBackendQuestion`/`BuilderQuestion`/`BackendQuestion` names match across T3, T7, T8. `useSurvey`/`useCreateSurvey`/`usePublish` names match across T3 and T8/T9.
- **No placeholders:** backend + helper code is complete; UI tasks give exact behavior, test code, and mirror files (Catalog.tsx / ProductFormModal.tsx / formbuilder-parts.jsx). The one ordering caveat (Task 4 routing references components built in T5/T8/T9) is called out.
