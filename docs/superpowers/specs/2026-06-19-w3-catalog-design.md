# W3: Admin Catalog screen design

Approved in design by Tanya on 2026-06-19 (after reviewing the prototype catalog
screen and an interactive browser mockup at
[docs/superpowers/mockups/w3-catalog-mockup.html](../mockups/w3-catalog-mockup.html)),
then tightened the same day after a 3-reviewer adversarial pass (backend/seed,
frontend/W1-consistency, scope/tests/edge-cases). This is the next step of the
screens-first roadmap (see [ROADMAP.md](../../../ROADMAP.md)), the second real Admin
screen after W1 (the shell + Analytics dashboard). Plain-English throughout.

## The goal, in one paragraph

Give the Admin app a real **Catalog** screen: the company's product list (its SKUs,
meaning one variant such as Velvet Lip in Rosewood), shown grouped by product line,
in both a List view and a Gallery view, with search, a status filter, and admin-only
add and edit. It is a faithful port of the prototype's catalog screen
([catalog.jsx](../../../../hi-fi-intelli/project/apps/admin/screens/catalog.jsx)),
wired to the backend that already exists (`GET/POST/PATCH /skus`), and it reuses W1's
design system exactly: the same shared tokens (`packages/tokens`), the same UI-kit
components (`apps/admin/src/ui`), and the same shell (sidebar + top bar). There is
**no backend API or schema change** (only the demo seed data is enriched, plus a small
new write helper is added to the frontend's one API file). Every product is real and
company-scoped; only admins can add or edit, while managers and reps see the catalog
read-only. The demo seed is enriched so the screen has multiple lines and a
discontinued product to show.

## Decisions made with Tanya (2026-06-19)

1. **Scope: "lean and real".** Build everything the backend already supports for real
   (list, gallery, search, status filter, stat tiles, grouped-by-line, admin add/edit),
   and cleanly defer the rest with honest placeholders. This mirrors how W1 was scoped.
2. **Photo placeholder: a clean colour swatch.** Real photo upload needs object storage
   (deferred work, 5-BE-c), so the photo space shows a tidy placeholder tinted with the
   product's colour plus a small camera icon ("no photo yet"). Any real reference-image
   link already stored on a product still renders as a real image. We do **not** port the
   prototype's synthetic fake-lipstick artwork (it is hardcoded, lipstick-only, and fakes
   a photo that does not exist).
3. **Faithful port of the prototype design system**, identical to how W1 did it: reuse
   `packages/tokens` (deep-ocean accent `#1B4F8A`, the radii/spacing, and the fonts
   Hanken Grotesk body / Space Grotesk headings / JetBrains Mono numbers) and the W1 UI
   kit. "Looks like the prototype" means the same design system and layout, with the
   content deviations enumerated below.
4. **Add/Edit is one shared modal** (the prototype's pattern), not inline editing or a
   separate full page. Five fields: product line, variant, UPC, colour, status.
5. **Import and Export render as disabled "coming soon" buttons** in the top bar (not
   hidden), so the frame matches the prototype and stakeholders see the roadmap, the same
   way W1 shows the notifications bell and setup wizard as "coming soon".
6. **The demo seed is enriched** (additively) to the prototype's six product lines so the
   grouping, gallery, and status filter have real content, including one discontinued
   product.

## Decisions refined after the adversarial review (2026-06-19)

These resolve gaps the reviewers found, so a builder never has to guess:

A. **The page reads the session itself.** Pages today get no session prop (the shell
   passes `session.user` only to the Sidebar and renders pages through a bare
   `<Outlet/>`). So `Catalog.tsx` calls `useAppSelector(selectSession)` and derives
   `isAdmin = session?.user.role === 'admin'` (role values are exactly `admin` /
   `manager` / `rep`). The top-bar subtitle uses `session?.user.company_name ?? 'Your
   company'` (the Sidebar's existing fallback).
B. **A write helper is added to `lib/api.ts`.** It currently has only `apiGet` and
   `downloadCsv`. W3 adds `apiSend<T>(method, path, body)` (used as POST and PATCH),
   mirroring `apiGet` exactly: JSON body, `...authHeaders()`, `Content-Type:
   application/json`, the same unreachable-backend catch (`ApiError(0, ...)`) and the
   same non-ok `detail` extraction (`ApiError(status, ...)`). Nothing else in the app
   calls `fetch` directly; the mutations go through this helper.
C. **All TanStack Query calls use the v5 object form** (the project is on
   `@tanstack/react-query` v5): `useQuery({ queryKey: ['skus'], queryFn: ... })`,
   `useMutation({ mutationFn, onSuccess })`, and `useQueryClient()` for invalidation.
   The positional `useQuery(['skus'], fn)` form is removed in v5 and must not be used.
D. **Non-admins do not open the edit modal.** For a manager/rep the list and gallery are
   purely read-only: rows and cards are not clickable, there is no Add button, and the
   modal never opens (so a 403-on-save path cannot be reached). For an admin, rows/cards
   open the shared add/edit modal.
E. **Empty and all-filtered states are defined.** When `/skus` returns zero products, the
   screen shows an empty state (a box icon, "No products yet", a line of copy, and the
   Add button for admins). When the catalog is non-empty but the current search/status
   filter matches nothing, it shows a "No products match your search" state instead. A
   product line whose filtered SKU list is empty renders nothing (matching the
   prototype's `if (!skus.length) return null`), so a narrow search hides whole sections,
   not just their rows.
F. **Null colour has a fallback.** `color` is nullable. Wherever the prototype tints with
   the colour (the swatch tile via `color-mix`, the line-header swatch stack, the gallery
   colour dot), a missing/empty colour falls back to a neutral `var(--border-strong)` and
   never emits an invalid CSS value.
G. **The add/edit Save rules are explicit.** Save is enabled only when line, variant, and
   UPC are all non-empty after trimming (colour is optional; status defaults to Active).
   The "+ New line..." text is trimmed; if it matches an existing line case-insensitively,
   the existing line's exact label is reused (no near-duplicate lines). On save success
   the modal closes and the list re-reads; on a backend error the modal stays open and
   shows the error message inline.
H. **Photo count means entries that have a URL.** "N photos" counts only
   `reference_images` entries with a truthy `url`; an entry without a `url` shows the
   placeholder and reads "No photo".
I. **UPC search is whitespace-insensitive; variant/line search is case-insensitive**
   (matching the prototype: both the query and the UPC have spaces stripped before
   comparing).

## What gets built

### Backend API: no change (the seed data is the only backend edit)
The catalog API already provides everything (see
[api/app/catalog.py](../../../api/app/catalog.py) and the `list_skus`/`create_sku`/
`update_sku` methods in [api/app/scope.py](../../../api/app/scope.py)):

- `GET /skus` returns `{ skus: [...], count: n }`. Each product row has exactly
  `id, line, variant, upc, color, status, reference_images, created_at` (the `_SKU_COLS`
  list). Any signed-in user in the company can read it; it is tenant-scoped.
- `POST /skus` (admin only, `require_admin`) creates a product (`line, variant, upc,
  color, status, reference_images`). Note: `create_sku` does a plain insert with **no**
  `on conflict`, so a duplicate `(tenant_id, upc)` raises an unhandled error (a 500, not
  a 409). This is why the seed must not reuse a UPC a test creates (see seed section).
- `PATCH /skus/{id}` (admin only) updates any of those fields; returns 404 for an id
  outside the company.
- `status` is exactly `"active"` or `"discontinued"` (enforced by a Pydantic `Literal`
  and a DB check constraint). There is no "new" status. "Discontinued" is the
  soft-delete, so there is **no delete endpoint and none is needed**.
- `reference_images` is a `jsonb` list with **no enforced inner shape** (the API accepts
  `list[dict]`). The frontend treats each element as `{ url?: string; label?: string }`
  and must guard `reference_images[0]?.url` (it may be absent). The seed only ever writes
  `[]`, so the demo path shows the swatch placeholder everywhere.

### Frontend: the one API file gains a write helper (`apps/admin/src/lib/api.ts`)
Add `apiSend<T>(method: 'POST' | 'PATCH', path: string, body: unknown): Promise<T>`
mirroring `apiGet`'s token/error handling (decision B). `useCatalog.ts` uses it for
create and update. This file is in the "changed files" list.

### Frontend: the Catalog screen (`apps/admin/src/pages/Catalog/`)
Ported from the prototype `catalog.jsx`, wired to real data, structured the same way as
W1's `Dashboard/` folder (a small folder of focused files, each with a CSS Module and a
test where it has logic):

- **`Catalog.tsx` + `Catalog.module.css`** — the screen. Reads
  `useAppSelector(selectSession)` (decision A). Renders its own
  `<Topbar title="Catalog" subtitle="{company_name ?? 'Your company'}. Each SKU is one
  variant.">` with the controls slot holding, for admins, an **"Add product"** primary
  button, and for everyone, **Import** + **Export** as disabled "coming soon" buttons.
  Below the top bar: the three stat tiles, the toolbar (search input, status `Segmented`,
  list/gallery `Segmented`), and the list of grouped product-line sections, OR the empty
  state / no-match state (decision E). Holds the screen's view/filter/search/modal UI
  state. Opens the add/edit modal only for admins (decision D).
- **`useCatalog.ts` + `useCatalog.test.ts`** — the data layer (v5 object form, decision
  C). A `Sku` type (with `reference_images: { url?: string; label?: string }[]`);
  `useSkus()` = `useQuery({ queryKey: ['skus'], queryFn: () => apiGet<{ skus: Sku[];
  count: number }>('/skus') })`; `useCreateSku()` and `useUpdateSku()` =
  `useMutation` calling `apiSend('POST'|'PATCH', ...)` whose `onSuccess` calls
  `queryClient.invalidateQueries({ queryKey: ['skus'] })` (via `useQueryClient()`) so the
  list refreshes; and pure, unit-tested helpers:
  - `groupByLine(skus)` -> ordered line groups (handles `[]` -> `[]`).
  - `catalogStats(skus)` -> `{ lines, total, active }` (handles `[]` -> all zero).
  - `filterSkus(skus, { status, query })` -> filtered list: status is `all` |
    `active` | `discontinued` (Active means `status === 'active'`); query matches variant
    or line case-insensitively, or UPC with spaces stripped from both sides (decision I).
- **`LineSection.tsx` + `LineSection.module.css`** — one collapsible product-line section.
  **Renders nothing when its filtered SKU list is empty** (decision E). Otherwise: a
  header (expand chevron, a stacked colour-swatch preview with the null-colour fallback,
  the line name, the SKU count, and a "Not yet in a survey" placeholder where the
  prototype shows survey usage), then either the **List table** (ported from the
  prototype `.tbl`: thumbnail, Variant, Photos column, UPC in mono, status pill, an open
  chevron) or the **Gallery grid** (a card per product). A discontinued product renders
  dimmed in both views. Rows/cards are clickable only for admins (decision D). The
  prototype's per-line `form`/category label (e.g. "Matte Lipstick") is not shown (no
  backend field; see deferrals).
- **`SkuThumb.tsx` + `SkuThumb.module.css`** — the photo cell: if the product has a real
  `reference_images[0]?.url`, show it as an `<img>`; otherwise show the colour-swatch
  placeholder (a tile tinted with `color-mix(... color ...)`, or the neutral fallback when
  colour is null, plus a camera icon). The "N photos"/"No photo" label counts only
  entries with a `url` (decision H).
- **`SkuCard.tsx` + `SkuCard.module.css`** — one gallery card (large `SkuThumb`, colour
  dot with the null fallback + variant, status pill, the photo-count label).
- **`ProductFormModal.tsx` + `ProductFormModal.module.css`** — the add/edit modal. Five
  fields: **product line** (a dropdown of the company's existing lines plus a "+ New
  line..." option that reveals a text input), **variant** (text), **UPC** (mono text),
  **colour** (a colour picker plus a hex text field, optional), **status** (Active /
  Discontinued). Save-enable and new-line rules per decision G. Save calls `useCreateSku`
  (add) or `useUpdateSku` (edit). On success the modal closes and the list refreshes; on
  error it shows an inline error inside the modal and stays open. A clearly-labelled
  "Reference photos: coming soon" note sits where the prototype's photo uploader is.
  Status pills reuse the existing `Chip` (green dot "Active"; plain "Discontinued").

### Frontend: small reusable UI-kit additions (`apps/admin/src/ui/`)
W1 built Button, Card, Chip, Segmented, Switch, Icon, Avatar, Spark, Bar. W3 adds the
pieces the catalog needs, ported from the prototype's
[shared/styles.css](../../../../hi-fi-intelli/project/shared/styles.css) (the `.input`,
`.label`, `.tbl` rules) and the prototype `Modal` shell in
[shared/primitives.jsx](../../../../hi-fi-intelli/project/shared/primitives.jsx#L226),
as React + CSS-Module components (reusable by later screens, W4 survey builder, W6
payroll, Settings, Users, which all need modals and forms):

- **`Modal.tsx` + `Modal.module.css`** — the modal shell (backdrop, centered panel, title +
  subtitle + close button, scrolling body). Closes on backdrop click and on the close
  button; does NOT close when the panel itself is clicked.
- **`Field.tsx`, `Input.tsx`, `Select.tsx`** (+ a shared `form.module.css`) — the labelled
  field wrapper (label associated with its control), the text input (ports `.input`), and
  the dropdown. Extra props pass through to the underlying element, matching the existing
  `Button` convention. None of these names exist in `ui/` today (no conflict).
- The **list table** styling is ported from the prototype `.tbl` into
  `LineSection.module.css` (kept local for now; promotable to a shared `Table` when W5/W6
  need it). No new icons are required (the UI kit's `icons.ts` already has box, barcode,
  grid, list, camera, image, search, plus, edit, chevR, chevD, x).
- All new kit components are exported from `apps/admin/src/ui/index.ts`.

### Frontend: test infrastructure (`apps/admin/src/test/`)
The shared render helper builds a fresh store with **no session**, which is why W1's
Dashboard tests never needed a logged-in user. The Catalog screen is the first page to
read role and company, so:

- Extend the shared render helper (`test/render.tsx`) with an optional `session` (or
  `user`) argument that seeds a session before the store is created (mirroring
  `App.test.tsx`'s approach of setting `localStorage[SESSION_KEY]` before `makeStore()`,
  or dispatching `signedIn`). The Catalog tests render once as an admin and once as a
  rep/manager.
- Add `company_name` (and confirm `role`) to the `dana` fixture in
  `test/fixtures.ts` (or add a small admin fixture) so the subtitle and admin gating are
  testable; add a non-admin fixture (role `rep` or `manager`).

### Frontend: routing and navigation
- **`apps/admin/src/App.tsx`** — line 26 changes from `<ComingSoon title="Catalog" />` to
  `<Catalog />` (inside the existing `<Shell>` layout route).
- **`apps/admin/src/shell/nav.ts`** — the Catalog nav item drops its `comingSoon: true`
  flag so the sidebar no longer shows it as "soon".

### Backend: seed enrichment (`api/app/seed.py`)
Enrich Lumen's catalog **additively** to the prototype's six lines so the screen has real
content, mapping the prototype's "new" status to "active" (the backend has no "new"):

- Keep the existing four SKUs unchanged (Velvet Lip Rosewood/Mauve/Coral, Silk Foundation
  Ivory) so the surveys/responses/analytics seed that references them is untouched.
- Add the remaining prototype shades across: **Velvet Lip** (Brick, Nude Petal, Crimson,
  Plum, Terracotta), **Silk Foundation** (Porcelain, Beige, Sand, Honey, Caramel, Almond,
  Espresso), **Lash Volume** (Blackest Black, Brown-Black, Cocoa), **Glow Blush** (Peach,
  Rose, Berry, and **Bronze as `discontinued`**), **Cushion Compact** (Fair, Light, Medium,
  Tan, Deep), **Brow Define** (Blonde, Taupe, Soft Brown, Dark Brown, Ebony), each with the
  prototype's colour (verify the exact hex values against `catalog.jsx` during the build).
- **Hard requirement: the seeded Velvet Lip "Plum" must use a UPC other than
  `LUM-VL-PLUM`** (e.g. `LUM-VL-PLUM-SEED`). The catalog test `test_admin_can_add_product`
  creates `LUM-VL-PLUM` at runtime, and `create_sku` has no `on conflict`, so a seed
  collision would be an unhandled 500 that reds the gate. All seeded UPCs must be unique
  per company.
- The `_sku` seed helper upserts on `(tenant_id, upc)` (its `on conflict (tenant_id,
  upc) do update`), so the enrichment is genuinely additive and idempotent on re-seed.
- This is additive and `test_catalog.py` already asserts `count >= 4` (not `== 4`) and
  checks specific variants, so it stays green; no test edit is required by the
  enrichment. (Note: `list_skus` orders by `line, variant`, so the new lines shift which
  SKU is `skus[0]`; the one test that uses `skus[0]` only asserts the PATCH result status,
  not identity, so it is unaffected.) Adding non-survey-referenced SKUs does not affect the
  analytics/response/OOS tests (those resolve SKUs by UPC and are status-agnostic).
- Update the seed's printed summary line (currently mentions "4 products") for honesty;
  nothing asserts it.

## Data shapes (for precision, no new types on the wire)

```
Sku = {
  id: string
  line: string
  variant: string
  upc: string
  color: string | null
  status: 'active' | 'discontinued'
  reference_images: { url?: string; label?: string }[]   // inner shape NOT backend-enforced; guard url
  created_at: string
}
GET /skus            -> { skus: Sku[], count: number }
POST /skus  (admin)  body: { line, variant, upc, color?, status?, reference_images? } -> Sku  (500 on dup UPC)
PATCH /skus/{id} (admin) body: any subset of the above -> Sku (404 if outside company)
```
The screen derives everything else (line groups, the three stat numbers, the filtered
view) on the client from this flat list, exactly as the prototype does.

## The tests (the gate for W3)

- **Backend:** no behaviour change, so the full existing suite (183 checks) stays green.
  `test_catalog.py` is unchanged and must remain green after the seed enrichment (it
  asserts `count >= 4` and specific variants, and the `skus[0]` test asserts only status).
  Tenant isolation is a **backend guarantee already covered** by `test_company_isolation_*`
  and `test_no_cross_company_edit`; W3 adds no frontend isolation test and does not claim
  to secure it.
- **Frontend (Vitest + Testing Library):** following W1's `vi.mock('./lib/api',
  importOriginal)` + `QueryClientProvider` (fresh client, retries off) + `Provider` +
  router render-helper style, extended to seed a session (above). The `vi.mock` must stub
  `apiGet` AND the new `apiSend` (create/update). Tests:
  - **`useCatalog.test.ts`** (pure helpers): `groupByLine` groups/orders by line, and
    `groupByLine([])` is `[]`; `catalogStats` returns correct line/total/active counts,
    and `catalogStats([])` is all zero; `filterSkus` filters by status (Active hides the
    discontinued Bronze; Discontinued shows only it) and by search across variant/line
    (case-insensitive) and UPC (whitespace-insensitive: a spaced query matches an unspaced
    UPC).
  - **`Catalog.test.tsx`** (the screen): renders stat tiles, grouped lines, and the list
    view from mocked `/skus`; toggling to Gallery renders cards; the status filter and
    search narrow the rows AND a narrow search hides non-matching line sections entirely;
    an **admin** sees the "Add product" button, opening it shows the modal, Save is
    disabled until line+variant+upc are present, and a successful save calls the mocked
    `apiSend` once and triggers a second `/skus` fetch (the list re-reads) whose result
    includes the new variant; a **non-admin** (role rep/manager) sees no Add button and
    rows that do not open the modal; Import and Export render disabled; the **empty
    catalog** (`/skus` returns `[]`) shows the empty state (with the Add button for an
    admin); a SKU with `color: null` and a SKU with a `reference_images` entry lacking a
    `url` both render without crashing and read "No photo".
  - **`ui/ui.test.tsx`** (the new kit pieces): `Modal` renders when open, is hidden when
    closed, closes on the backdrop and the close button, and does NOT close when the panel
    is clicked; `Field` associates its label with its control; `Input`/`Select` pass extra
    props through.
  - The frontend check count grows (new tests added; none removed). The suite ends green
    and the app builds (`pnpm test:admin`, `pnpm --filter @intelli/admin build`).

## The new and changed files

- `apps/admin/src/lib/api.ts` — add `apiSend` (POST/PATCH write helper). Modify.
- `apps/admin/src/pages/Catalog/Catalog.tsx` + `.module.css` — the screen. New.
- `apps/admin/src/pages/Catalog/useCatalog.ts` + `useCatalog.test.ts` — data + helpers. New.
- `apps/admin/src/pages/Catalog/LineSection.tsx` + `.module.css` — one line section. New.
- `apps/admin/src/pages/Catalog/SkuThumb.tsx` + `.module.css` — the photo cell. New.
- `apps/admin/src/pages/Catalog/SkuCard.tsx` + `.module.css` — a gallery card. New.
- `apps/admin/src/pages/Catalog/ProductFormModal.tsx` + `.module.css` — add/edit. New.
- `apps/admin/src/pages/Catalog/Catalog.test.tsx` — the screen test. New.
- `apps/admin/src/ui/Modal.tsx` + `.module.css` — the modal shell. New.
- `apps/admin/src/ui/Field.tsx`, `Input.tsx`, `Select.tsx` + `form.module.css` — form
  controls. New.
- `apps/admin/src/ui/index.ts` — export the new components. Modify.
- `apps/admin/src/ui/ui.test.tsx` — cover the new components. Modify.
- `apps/admin/src/test/render.tsx` — optional session-seeding for tests. Modify.
- `apps/admin/src/test/fixtures.ts` — add `company_name` to dana + a non-admin fixture. Modify.
- `apps/admin/src/App.tsx` — route `/catalog` to `<Catalog />`. Modify.
- `apps/admin/src/shell/nav.ts` — drop Catalog's `comingSoon`. Modify.
- `api/app/seed.py` — enrich Lumen's catalog to six lines (additive); update the summary
  print. Modify.
- Docs updated in the same breath: `apps/admin/README.md`, `CODEBASE_MAP.md`,
  `CHECKING_THE_WORK.md`, `START_HERE.md`, `CONTEXT.md`, the prototype handoff CHANGELOG,
  and tick W3 in `ROADMAP.md`.

## Deliberately NOT in W3 (so nothing is silently missing)

- **Real photo upload / drag-drop / the photo gallery + primary picker:** needs object
  storage (5-BE-c). W3 shows the swatch placeholder and renders any existing reference-image
  link; the modal shows a "coming soon" note.
- **The rich per-SKU detail modal is replaced by the 5-field add/edit form** (a deliberate
  deviation from the prototype, which opened a photos+fields detail modal on every row).
- **The per-line `form`/category label** (e.g. "Matte Lipstick") shown next to the line
  name in the prototype: dropped (no such field on the backend SKU).
- **CSV import and PIM/API sync (Salsify/SAP):** the prototype's import modal is mocked;
  there is no bulk-import endpoint. Shown as a disabled "Import SKUs" button.
- **Catalog CSV export:** there is no catalog export endpoint (the existing `/export/*` are
  responses/payroll/compliance). Shown as a disabled "Export" button. (A client-side export
  was offered and not chosen for this step.)
- **"Used in N surveys" badge** on each line: needs a survey-usage lookup; the section shows
  "Not yet in a survey" placeholder text instead.
- **The "New" status:** the backend has only active/discontinued; the prototype's "New" pill
  is dropped.
- **Product delete:** none; "discontinued" is the soft-delete.
- **A global toast system:** save feedback is the modal closing + the list refreshing, with
  inline errors in the modal; a toast system is not introduced in W3.

## How we will know W3 is done

The Catalog screen replaces the "coming soon" page at `/catalog` and, inside the existing
shell, shows the real product list grouped by line in both List and Gallery views, with
working search, the status filter, and the three stat tiles, all from the live `/skus`. An
admin can add a product and edit one and see the list update; a non-admin sees it
read-only (no Add, rows do not open). An empty catalog shows the empty state; a narrow
search hides non-matching line sections. Import and Export show as honest "coming soon".
The seed shows the six enriched lines including a discontinued product. Tenant isolation is
unchanged and remains a backend guarantee. The full backend suite stays green (183) and the
frontend suite (with the new tests) ends green and the app builds. A live browser
walk-through (log in as Dana, open Catalog, switch List/Gallery, filter to Discontinued,
search a shade, add a product, edit a product) behaves as described and uses W1's design
system and fonts. All guides are updated.
