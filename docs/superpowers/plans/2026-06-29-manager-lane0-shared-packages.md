# Manager App Lane 0: Shared Packages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the Admin app's UI kit and API client into two shared workspace packages (`@intelli/ui`, `@intelli/api-client`) that the upcoming Manager app will also import, with the Admin app fully green throughout.

**Architecture:** This is a behavior-preserving refactor (a "move + re-point imports", no feature change). The existing Admin test suite is the safety net: after each move we run the full suite and the build and expect green, rather than writing new failing tests. Packages are source-only TypeScript consumed directly by Vite, mirroring the existing `@intelli/tokens` package (no build step, no per-package test runner). The two existing test files travel into the Admin test folder and re-point to the new package imports, so `pnpm test:admin` keeps running them. The one real change is that the session-storage key becomes per-app configurable (so Admin and a future Manager app never share a login), with Admin keeping its exact current key `intelli-admin-session`.

**Tech Stack:** pnpm workspaces, TypeScript, React 19, Vite 6, Vitest 3, `@testing-library/react`.

## Global Constraints

- No em dashes anywhere (code comments, docs, copy). Use commas, parentheses, or sentences.
- The Admin app must build clean (`tsc --noEmit && vite build`) and pass every existing frontend test after each task. Current baseline: 247 frontend tests green.
- No backend change, no database change in this lane.
- Behavior-preserving: the Admin app's runtime behavior, session key (`intelli-admin-session`), and API base URL are unchanged.
- New packages mirror `@intelli/tokens` exactly: `package.json` with `main`/`types`/`exports` pointing at `src/index.ts`, `"type": "module"`, `"private": true`, no build step, no own test runner.
- Use `git mv` for file moves so history is preserved.
- Commit after each task. Do NOT push (push auto-deploys; Tanya approves pushes).

---

## File Structure

**Created:**
- `packages/ui/package.json` (name `@intelli/ui`)
- `packages/ui/README.md`
- `packages/ui/src/*` (the 14 UI components + CSS modules + `icons.ts` + `index.ts`, moved from `apps/admin/src/ui/`)
- `packages/api-client/package.json` (name `@intelli/api-client`)
- `packages/api-client/README.md`
- `packages/api-client/src/api.ts` (moved from `apps/admin/src/lib/api.ts`)
- `packages/api-client/src/session.ts` (new: configurable-key version of the old `lib/session.ts`)
- `packages/api-client/src/index.ts` (barrel)

**Moved (test files, into the Admin test folder, re-pointed to the package imports):**
- `apps/admin/src/ui/ui.test.tsx` -> `apps/admin/src/test/ui-kit.test.tsx`
- `apps/admin/src/lib/api.test.ts` -> `apps/admin/src/test/api-client.test.ts`

**Modified:**
- `apps/admin/package.json` (add the two `workspace:*` deps)
- `apps/admin/src/main.tsx` (configure the session key at startup)
- `apps/admin/src/test/setup.ts` (configure the session key for tests)
- `apps/admin/src/store/auth.ts` (define `SESSION_KEY` locally instead of importing from `lib/session`)
- `apps/admin/src/test/render.tsx` (import `SESSION_KEY` from `store/auth`)
- ~43 files importing the UI barrel and ~38 importing the api helper (re-pointed by `sed`)

**Deleted (after their contents move):**
- `apps/admin/src/ui/` (empty)
- `apps/admin/src/lib/` (empty)

---

### Task 1: Extract the UI kit into `@intelli/ui`

**Files:**
- Create: `packages/ui/package.json`, `packages/ui/README.md`
- Move: all of `apps/admin/src/ui/` into `packages/ui/src/` (except the test file)
- Move: `apps/admin/src/ui/ui.test.tsx` -> `apps/admin/src/test/ui-kit.test.tsx`
- Modify: `apps/admin/package.json`; every Admin file importing the UI barrel

**Interfaces:**
- Produces: package `@intelli/ui` whose `src/index.ts` barrel exports `Icon`, `ICONS`, `IconShape`, `Spark`, `Bar`, `Chip`, `ChipTone`, `Button`, `ButtonVariant`, `ButtonSize`, `Card`, `Segmented`, `Switch`, `Avatar`, `Modal`, `Field`, `Input`, `Select` (the exact set in the current `apps/admin/src/ui/index.ts`). Consumers import `from '@intelli/ui'`.

- [ ] **Step 1: Create the package manifest**

Create `packages/ui/package.json`:

```json
{
  "name": "@intelli/ui",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  }
}
```

- [ ] **Step 2: Move the UI source files (preserving history)**

Run from the repo root:

```bash
mkdir -p packages/ui/src
git mv apps/admin/src/ui/ui.test.tsx apps/admin/src/test/ui-kit.test.tsx
git mv apps/admin/src/ui/* packages/ui/src/
rmdir apps/admin/src/ui
```

Expected: `packages/ui/src/` now holds `index.ts`, `icons.ts`, the 14 `*.tsx` components, and the `*.module.css` files (including `form.module.css`); `apps/admin/src/ui/` no longer exists; the test now lives at `apps/admin/src/test/ui-kit.test.tsx`.

- [ ] **Step 3: Re-point the moved test to the package import**

In `apps/admin/src/test/ui-kit.test.tsx`, change the component import line:

```typescript
// from:
import { Bar, Chip, Field, Icon, Input, Modal, Segmented, Select, Spark, Switch } from './index'
// to:
import { Bar, Chip, Field, Icon, Input, Modal, Segmented, Select, Spark, Switch } from '@intelli/ui'
```

(Leave the `vitest` and `@testing-library/react` imports as they are.)

- [ ] **Step 4: Re-point every Admin import of the UI barrel**

Run from the repo root:

```bash
grep -rlE "from '(\.\./)+ui'" apps/admin/src \
  | xargs sed -i '' -E "s|from '(\.\./)+ui'|from '@intelli/ui'|g"
```

Then verify nothing relative remains:

```bash
grep -rnE "from '(\.\./)+ui'" apps/admin/src || echo "clean: no relative ui imports left"
```

Expected: `clean: no relative ui imports left`.

- [ ] **Step 5: Add the dependency and install**

In `apps/admin/package.json`, add to `"dependencies"` (keep alphabetical near `@intelli/tokens`):

```json
"@intelli/ui": "workspace:*",
```

Then from the repo root:

```bash
pnpm install
```

Expected: install succeeds; `apps/admin/node_modules/@intelli/ui` is a workspace symlink.

- [ ] **Step 6: Run the Admin build and full test suite**

```bash
pnpm --filter @intelli/admin build
pnpm test:admin
```

Expected: build clean (`tsc --noEmit` + `vite build` both succeed); all 247 tests pass (the moved `ui-kit.test.tsx` now resolves `@intelli/ui`).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor(web): extract UI kit into @intelli/ui shared package

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Extract the API client into `@intelli/api-client` (with a per-app session key)

**Files:**
- Create: `packages/api-client/package.json`, `packages/api-client/README.md`, `packages/api-client/src/session.ts`, `packages/api-client/src/index.ts`
- Move: `apps/admin/src/lib/api.ts` -> `packages/api-client/src/api.ts`
- Move: `apps/admin/src/lib/api.test.ts` -> `apps/admin/src/test/api-client.test.ts`
- Delete: `apps/admin/src/lib/session.ts` (its logic moves into the package)
- Modify: `apps/admin/package.json`, `apps/admin/src/main.tsx`, `apps/admin/src/test/setup.ts`, `apps/admin/src/store/auth.ts`, `apps/admin/src/test/render.tsx`; every Admin file importing the api helper

**Interfaces:**
- Consumes: `@intelli/ui` exists (Task 1).
- Produces: package `@intelli/api-client` whose `src/index.ts` re-exports everything from `api.ts` (`API_BASE`, `SessionUser`, `LoginResult`, `ApiError`, `login`, `health`, `apiGet`, `apiSend`, `apiDelete`, `downloadCsv`) plus `configureSession(key: string): void`, `getSessionKey(): string`, and `readToken(): string | null`. Apps call `configureSession(SESSION_KEY)` once at startup. The Admin app's `SESSION_KEY` constant now lives in and is exported from `apps/admin/src/store/auth.ts` with the unchanged value `'intelli-admin-session'`.

- [ ] **Step 1: Create the package manifest**

Create `packages/api-client/package.json`:

```json
{
  "name": "@intelli/api-client",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  }
}
```

- [ ] **Step 2: Move `api.ts` into the package**

Run from the repo root:

```bash
mkdir -p packages/api-client/src
git mv apps/admin/src/lib/api.ts packages/api-client/src/api.ts
```

`api.ts` keeps its line `import { readToken } from './session'`; the new `session.ts` (next step) sits beside it, so that import still resolves.

- [ ] **Step 3: Create the configurable session module**

Create `packages/api-client/src/session.ts` (replaces the old hardcoded-key `lib/session.ts`):

```typescript
// Shared session-token reader. Each app sets its own storage key once at
// startup via configureSession, so the Admin and Manager apps never share a
// login even when served from the same browser origin. Imported by api.ts so
// the client can read the token without importing any app's Redux store.
let sessionKey = 'intelli-session'

export function configureSession(key: string): void {
  sessionKey = key
}

export function getSessionKey(): string {
  return sessionKey
}

export function readToken(): string | null {
  try {
    const raw = localStorage.getItem(sessionKey)
    if (!raw) return null
    const token = (JSON.parse(raw) as { token?: string })?.token
    return token ?? null
  } catch {
    return null
  }
}
```

Then remove the old file:

```bash
git rm apps/admin/src/lib/session.ts
```

- [ ] **Step 4: Create the package barrel**

Create `packages/api-client/src/index.ts`:

```typescript
export * from './api'
export { configureSession, getSessionKey, readToken } from './session'
```

- [ ] **Step 5: Give the Admin app its own SESSION_KEY**

In `apps/admin/src/store/auth.ts`, replace the import-and-re-export of `SESSION_KEY` with a local definition. Change lines 6 to 10 (the `import { SESSION_KEY } from '../lib/session'` block and its re-export comment) to:

```typescript
// The Admin app's session-storage key. The shared API client is told this key
// once at startup (configureSession) so it reads the same localStorage entry.
export const SESSION_KEY = 'intelli-admin-session'
```

Leave the rest of `auth.ts` (which uses `SESSION_KEY` for read/write/remove) unchanged.

- [ ] **Step 6: Re-point the test render helper**

In `apps/admin/src/test/render.tsx`, change:

```typescript
// from:
import { SESSION_KEY } from '../lib/session'
// to:
import { SESSION_KEY } from '../store/auth'
```

- [ ] **Step 7: Re-point every Admin import of the api helper**

Run from the repo root:

```bash
grep -rlE "from '(\.{1,2}/)+lib/api'" apps/admin/src \
  | xargs sed -i '' -E "s|from '(\.{1,2}/)+lib/api'|from '@intelli/api-client'|g"
```

Then verify no app-source imports of the api helper remain (the api test still imports `./api` / `./session` relatively and is handled in Step 8, so exclude it):

```bash
grep -rnE "from '[^']*lib/(api|session)'" apps/admin/src || echo "clean: no relative lib/api imports left"
```

Expected: `clean: no relative lib/api imports left`. (Do not delete `apps/admin/src/lib/` yet; the api test is still there and moves in Step 8.)

- [ ] **Step 8: Move the api-client test, re-point it, then remove the empty lib folder**

```bash
git mv apps/admin/src/lib/api.test.ts apps/admin/src/test/api-client.test.ts
rmdir apps/admin/src/lib
```

In `apps/admin/src/test/api-client.test.ts`, change the two import lines:

```typescript
// from:
import { ApiError, apiGet, apiSend, health, login } from './api'
import { SESSION_KEY, readToken } from './session'
// to:
import { ApiError, apiGet, apiSend, getSessionKey, health, login, readToken } from '@intelli/api-client'
```

Then replace the two uses of `SESSION_KEY` in that file with `getSessionKey()`:

```typescript
// the setSession helper becomes:
function setSession(token: string) {
  localStorage.setItem(
    getSessionKey(),
    JSON.stringify({ token, user: { name: 'Dana', role: 'admin' } }),
  )
}
```

(If `SESSION_KEY` appears anywhere else in this file, replace each with `getSessionKey()`.)

- [ ] **Step 9: Configure the session key at app startup**

In `apps/admin/src/main.tsx`, add the import and the configure call before `createRoot`. After the existing import lines add:

```typescript
import { configureSession } from '@intelli/api-client'
import { SESSION_KEY } from './store/auth'

configureSession(SESSION_KEY)
```

(Place the `configureSession(SESSION_KEY)` line just above the `ReactDOM.createRoot(...)` call.)

- [ ] **Step 10: Configure the session key for tests**

In `apps/admin/src/test/setup.ts`, add the configure call so tests that seed a session read the right key. The file becomes:

```typescript
import '@testing-library/jest-dom/vitest'
import { configureSession } from '@intelli/api-client'
import { SESSION_KEY } from '../store/auth'

configureSession(SESSION_KEY)

afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
})
```

- [ ] **Step 11: Add the dependency and install**

In `apps/admin/package.json`, add to `"dependencies"`:

```json
"@intelli/api-client": "workspace:*",
```

Then from the repo root:

```bash
pnpm install
```

- [ ] **Step 12: Run the Admin build and full test suite**

```bash
pnpm --filter @intelli/admin build
pnpm test:admin
```

Expected: build clean; all tests pass, including `store/auth.test.ts` (imports `SESSION_KEY` from `./auth`, unchanged) and the moved `test/api-client.test.ts` (now using `@intelli/api-client` + `getSessionKey()`).

- [ ] **Step 13: Commit**

```bash
git add -A
git commit -m "refactor(web): extract API client into @intelli/api-client with per-app session key

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Document the new packages

**Files:**
- Create: `packages/ui/README.md`, `packages/api-client/README.md`
- Modify: `CODEBASE_MAP.md`

**Interfaces:**
- Consumes: both packages exist (Tasks 1 and 2).
- Produces: nothing code-facing; documentation only.

- [ ] **Step 1: Write `packages/ui/README.md`**

Create `packages/ui/README.md` in plain English (no em dashes), covering: what `@intelli/ui` is (the shared web UI kit, the building blocks like buttons, cards, chips, and pop-ups), that both the Admin and the Manager web apps import it so there is one copy, how to import (`import { Button } from '@intelli/ui'`), and that it is source-only TypeScript with no build step (Vite compiles it), styled by CSS custom properties from `@intelli/tokens`.

- [ ] **Step 2: Write `packages/api-client/README.md`**

Create `packages/api-client/README.md` in plain English (no em dashes), covering: what `@intelli/api-client` is (the one place the web apps talk to the backend: `apiGet`, `apiSend`, `apiDelete`, `downloadCsv`, `login`, `health`, plus the `ApiError` type), the session model (each app calls `configureSession('intelli-<app>-session')` once at startup so the apps never share a login; the client reads the token via `readToken`), and that it is source-only TypeScript with no build step.

- [ ] **Step 3: Update `CODEBASE_MAP.md`**

In `CODEBASE_MAP.md`, in the folder table (section 2) and the `packages/` description, add the two new shared packages: `packages/ui` (the shared web UI kit, used by Admin and the upcoming Manager app) and `packages/api-client` (the shared backend-talking helper, with a per-app session key). Note in plain English that the UI kit and API client moved out of `apps/admin/src/ui` and `apps/admin/src/lib` into shared packages so the Manager app can reuse them, and that this was a behavior-preserving move (the Admin app works exactly as before).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "docs: document @intelli/ui and @intelli/api-client shared packages

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**1. Spec coverage:** The spec's Lane 0 ("extract `@intelli/ui` and `@intelli/api-client` from Admin, re-point Admin's imports, make the session key per-app injectable, verify Admin fully green") is covered by Tasks 1 (UI kit), 2 (api client + configurable session key), and 3 (docs). The spec's login-isolation requirement (per-app session key, Admin keeps `intelli-admin-session`) is Task 2 Steps 3, 5, 9, 10. The "Admin stays green" requirement is the build+test step that ends Tasks 1 and 2. START_HERE / CONTEXT / ROADMAP / handoff CHANGELOG updates are deliberately deferred to when the Manager app itself lands (Lane 0 is internal plumbing with no user-facing change); only CODEBASE_MAP is updated now, because it documents code structure.

**2. Placeholder scan:** No TBD/TODO. Every new file's full content is given; moves use `git mv`; re-points use exact `sed` commands with verification greps; the one behavioral change (configurable session key) shows the complete new `session.ts`.

**3. Type consistency:** `configureSession(key: string): void`, `getSessionKey(): string`, `readToken(): string | null` are defined in Task 2 Step 3 and used identically in Steps 8, 9, 10. `SESSION_KEY` is defined in `store/auth.ts` (Step 5) and imported from there in `render.tsx` (Step 6), `main.tsx` (Step 9), and `setup.ts` (Step 10). The `@intelli/ui` barrel export set matches the current `apps/admin/src/ui/index.ts` verbatim. The `@intelli/api-client` barrel re-exports `api.ts`'s existing public names (verified against the current file) plus the three session functions.

**Note for the executor:** This is a refactor, so the discipline is "the existing suite is the test." Do not write new failing tests first; instead, after each move and re-point, run `pnpm --filter @intelli/admin build` and `pnpm test:admin` and confirm green before committing. If the build or a test goes red, the move or a re-point is the cause; fix it before proceeding.
