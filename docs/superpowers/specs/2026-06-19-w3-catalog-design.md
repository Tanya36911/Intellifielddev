# W3: Admin Catalog screen design

Approved in design by Tanya on 2026-06-19 (after reviewing the prototype catalog
screen and an interactive browser mockup at
[docs/superpowers/mockups/w3-catalog-mockup.html](../mockups/w3-catalog-mockup.html)).
This is the next step of the screens-first roadmap (see [ROADMAP.md](../../../ROADMAP.md)),
the second real Admin screen after W1 (the shell + Analytics dashboard). Plain-English
throughout.

## The goal, in one paragraph

Give the Admin app a real **Catalog** screen: the company's product list (its SKUs,
meaning one variant such as Velvet Lip in Rosewood), shown grouped by product line,
in both a List view and a Gallery view, with search, a status filter, and admin-only
add and edit. It is a faithful port of the prototype's catalog screen
([catalog.jsx](../../../../hi-fi-intelli/project/apps/admin/screens/catalog.jsx)),
wired to the backend that already exists (`GET/POST/PATCH /skus`), and it reuses W1's
design system exactly: the same shared tokens (`packages/tokens`), the same UI-kit
components (`apps/admin/src/ui`), and the same shell (sidebar + top bar). There is
**no backend API or schema change** (only the demo seed data is enriched): every number
and product is real and company-scoped (one company never sees another's catalog; only
admins can add or edit; managers and reps see it read-only), all enforced by the existing
backend. The demo seed is enriched so the screen has multiple lines and a discontinued
product to show.

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

## What gets built

### Backend API: no change (the seed data is the only backend edit)
The catalog API already provides everything (see
[api/app/catalog.py](../../../api/app/catalog.py) and the `list_skus`/`create_sku`/
`update_sku` methods in [api/app/scope.py](../../../api/app/scope.py)):

- `GET /skus` returns `{ skus: [...], count: n }`. Each product row has:
  `id, line, variant, upc, color, status, reference_images, created_at`.
  Any signed-in user in the company can read it; it is tenant-scoped.
- `POST /skus` (admin only) creates a product (`line, variant, upc, color, status,
  reference_images`).
- `PATCH /skus/{id}` (admin only) updates any of those fields; returns 404 for an id
  outside the company.
- `status` is exactly `"active"` or `"discontinued"`. There is no "new" status (the
  prototype's "New" badge is dropped, see deferred list). "Discontinued" is the
  soft-delete, so there is **no delete endpoint and none is needed**.

### Frontend: the Catalog screen (`apps/admin/src/pages/Catalog/`)
Ported from the prototype `catalog.jsx`, wired to real data, structured the same way as
W1's `Dashboard/` folder (a small folder of focused files, each with a CSS Module and a
test where it has logic):

- **`Catalog.tsx` + `Catalog.module.css`** — the screen. Renders its own
  `<Topbar title="Catalog" subtitle="{company name}. Each SKU is one variant.">` with the
  controls slot holding: an **"Add product"** primary button (admins only) and **Import**
  + **Export** as disabled "coming soon" buttons. Below the top bar: the three stat tiles,
  the toolbar (search input, status `Segmented`, list/gallery `Segmented`), and the list of
  grouped product-line sections. Holds the screen's view/filter/search/modal UI state.
- **`useCatalog.ts` + `useCatalog.test.ts`** — the data layer. A `Sku` type; a
  `useSkus()` query (`useQuery(['skus'], () => apiGet('/skus'))`); `useCreateSku()` and
  `useUpdateSku()` mutations that on success call
  `queryClient.invalidateQueries({ queryKey: ['skus'] })` so the list refreshes itself;
  and pure helpers (`groupByLine`, `catalogStats`, `filterSkus`) that turn the flat
  `/skus` list into line groups, the three stat numbers, and the search/status-filtered
  view. The pure helpers are unit-tested.
- **`LineSection.tsx` + `LineSection.module.css`** — one collapsible product-line section:
  a header (expand chevron, a stacked colour-swatch preview, the line name, the SKU count,
  and a "Not yet in a survey" placeholder where the prototype shows survey usage), then
  either the **List table** (ported from the prototype `.tbl`: thumbnail, Variant, Photos
  column showing "No photo", UPC in mono, status pill, an open chevron) or the **Gallery
  grid** (a card per product). A discontinued product renders dimmed in both views.
- **`SkuThumb.tsx` + `SkuThumb.module.css`** — the photo cell: if the product has a real
  `reference_images[0].url`, show it as an `<img>`; otherwise show the colour-swatch
  placeholder (a tile tinted with `color-mix(... color ...)` plus a camera icon).
- **`SkuCard.tsx` + `SkuCard.module.css`** — one gallery card (large `SkuThumb`, colour
  dot + variant, status pill, "No photo"/"N photos").
- **`ProductFormModal.tsx` + `ProductFormModal.module.css`** — the add/edit modal. Five
  fields: **product line** (a dropdown of the company's existing lines plus a "+ New
  line..." option that reveals a text input, since a line is just a label on products and
  the first product in a new line needs free text), **variant** (text), **UPC** (mono
  text), **colour** (a colour picker plus a hex text field, optional), **status** (Active /
  Discontinued). Save calls `useCreateSku` (add) or `useUpdateSku` (edit). On success the
  modal closes and the list refreshes; on error it shows an inline error message inside the
  modal and stays open. A small, clearly-labelled "Reference photos: coming soon" note sits
  where the prototype's photo uploader is. Status pills reuse the existing `Chip` component
  (green dot "Active"; plain "Discontinued").

### Frontend: small reusable UI-kit additions (`apps/admin/src/ui/`)
W1 built Button, Card, Chip, Segmented, Switch, Icon, Avatar, Spark, Bar. W3 adds the
pieces the prototype catalog needs, ported from the prototype's
[shared/styles.css](../../../../hi-fi-intelli/project/shared/styles.css) and
[shared/primitives.jsx](../../../../hi-fi-intelli/project/shared/primitives.jsx), as React
+ CSS-Module components (so they are reusable by the later screens, W4 survey builder, W6
payroll, Settings, Users, which all need modals and forms):

- **`Modal.tsx` + `Modal.module.css`** — the modal shell (backdrop, centered panel, title +
  subtitle + close button, scrolling body), ported from the prototype `Modal`. Closes on
  backdrop click and on the close button.
- **`Field.tsx`, `Input.tsx`, `Select.tsx`** (+ a shared `form.module.css`) — the labelled
  field wrapper, the text input (ports `.input`), and the dropdown (ports `.input` select
  styling). Extra props pass through to the underlying element, matching the existing
  `Button` convention.
- The **list table** styling is ported from the prototype `.tbl` into
  `LineSection.module.css` (kept local for now; it can be promoted to a shared `Table`
  when W5/W6 need it). No new icons are required (the UI kit's `icons.ts` already has box,
  barcode, grid, list, camera, image, search, plus, edit, chevR, chevD, x).
- All new kit components are exported from `apps/admin/src/ui/index.ts` and covered by the
  existing `ui/ui.test.tsx`.

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
  prototype's colour.
- **UPCs must be unique per company and must NOT collide with `LUM-VL-PLUM`**, which the
  catalog test `test_admin_create_sku` creates at runtime. Use distinct UPCs for the seeded
  rows (e.g. the `LUM-<LINE>-<SHADE>` style already used, with the seeded Plum given a UPC
  other than `LUM-VL-PLUM`). Acme's catalog is unchanged.
- This is additive and `test_catalog.py` already asserts `count >= 4` (not `== 4`) and
  checks specific variants, so it stays green; no test edit is required by the enrichment.
  Adding non-survey-referenced SKUs does not affect the analytics/response/OOS tests.

## Data shapes (for precision, no new types on the wire)

```
Sku = {
  id: string
  line: string
  variant: string
  upc: string
  color: string | null
  status: 'active' | 'discontinued'
  reference_images: { url?: string; label?: string }[]
  created_at: string
}
GET /skus            -> { skus: Sku[], count: number }
POST /skus  (admin)  body: { line, variant, upc, color?, status?, reference_images? } -> Sku
PATCH /skus/{id} (admin) body: any subset of the above -> Sku (404 if outside company)
```
The screen derives everything else (line groups, the three stat numbers, the filtered
view) on the client from this flat list, exactly as the prototype does.

## The tests (the gate for W3)

- **Backend:** no behaviour change, so the full existing suite (183 checks) stays green.
  `test_catalog.py` is unchanged and must remain green after the seed enrichment (it
  asserts `count >= 4` and specific variants). If running the seed in the test DB surfaces
  any count assumption, it is fixed in the same step, but none is expected.
- **Frontend (Vitest + Testing Library):** following W1's established `vi.mock('./lib/api',
  importOriginal)` + `QueryClientProvider` (fresh client, retries off) + `Provider` +
  router render-helper style:
  - **`useCatalog.test.ts`** — the pure helpers: `groupByLine` groups and orders products
    by line; `catalogStats` returns the right line/SKU/active counts; `filterSkus` filters
    by status and by a search across variant/line/UPC.
  - **`Catalog.test.tsx`** — the screen renders the stat tiles, the grouped lines, and the
    list view from mocked `/skus`; toggling to Gallery renders cards; the status filter and
    search narrow the rows; an **admin** sees the "Add product" button and opening it shows
    the modal, and a save calls the mocked create/update and the list re-reads; a
    **non-admin** (role rep/manager) sees **no** Add button and read-only rows; Import and
    Export are present but disabled.
  - The new UI-kit pieces (Modal open/close, Input/Select/Field) are exercised via
    `ui/ui.test.tsx` and the Catalog test.
  - The frontend check count grows (new tests added; none removed). The suite ends green
    and the app builds (`pnpm test:admin`, `pnpm --filter @intelli/admin build`).

## The new and changed files

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
- `apps/admin/src/App.tsx` — route `/catalog` to `<Catalog />`. Modify.
- `apps/admin/src/shell/nav.ts` — drop Catalog's `comingSoon`. Modify.
- `api/app/seed.py` — enrich Lumen's catalog to six lines (additive). Modify.
- Docs updated in the same breath: `apps/admin/README.md`, `CODEBASE_MAP.md`,
  `CHECKING_THE_WORK.md`, `START_HERE.md`, `CONTEXT.md`, the prototype handoff CHANGELOG,
  and tick W3 in `ROADMAP.md`.

## Deliberately NOT in W3 (so nothing is silently missing)

- **Real photo upload / drag-drop / the photo gallery + primary picker:** needs object
  storage (5-BE-c). W3 shows the swatch placeholder and renders any existing reference-image
  link; the modal shows a "coming soon" note.
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
read-only; one company never sees another's catalog (the backend enforces this). Import and
Export show as honest "coming soon". The seed shows the six enriched lines including a
discontinued product. The full backend suite stays green (183) and the frontend suite (with
the new tests) ends green and the app builds. A live browser walk-through (log in as Dana,
open Catalog, switch List/Gallery, filter to Discontinued, search a shade, add a product,
edit a product) behaves as described and uses W1's design system and fonts. All guides are
updated.
