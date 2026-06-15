# Phase 3a: the product catalog (the written-down plan)

Approved in design by Tanya on 2026-06-15. Phase 3 in the master plan (catalog
+ surveys + versions + assignments + pass conditions) is large, so it is split:
this is **Phase 3a, the catalog**. Surveys and the rest are **Phase 3b**, a
separate later design. Plain-English throughout; technical names explained where
they appear.

## The goal, in one paragraph

Give each company a place to store its products, so that later surveys can ask
questions about specific products. A product entry (a "SKU", meaning one
sellable variant) records the product line, the variant, the barcode (UPC), a
color, whether it is active or discontinued, and an optional list of reference
photo links. Every signed-in person in a company can view that company's
catalog; only an admin can add or change products; and one company can never
see another company's catalog.

## Why a SKU, and why per-variant

The whole product is "per-SKU". Compliance is measured per variant: Lumen's
"Velvet Lip" in "Rosewood" is a different SKU from "Velvet Lip" in "Mauve".
Storing products at the variant level now is what lets later phases count
facings, flag out-of-stock, and score compliance per variant.

## Decisions made with Tanya (2026-06-15)

1. **The catalog is company-wide, not branch-scoped.** Unlike the org tree
   (where you see only your own branch), products are shared reference data:
   every signed-in person in a company sees the full product list. The scope
   guard still keeps it strictly within the one company.
2. **Only admins edit the catalog.** Viewing is open to any signed-in person in
   the company. Adding or editing a product is admin-only; a manager or rep who
   tries gets a polite "not allowed" (a 403). This is the first time the backend
   enforces "only this role can do this action".
3. **Photo links only, no uploads yet.** Reference images are stored as a list
   of links. Uploading or processing image files comes later (it is also the
   future photo-recognition groundwork).

## What gets built

### One new database table: skus
Columns:
- `id`, `tenant_id` (which company).
- `line` (e.g. "Velvet Lip"), `variant` (e.g. "Rosewood").
- `upc` (the barcode number).
- `color` (a display color or name).
- `status` (`active` or `discontinued`, defaults to active).
- `reference_images` (a JSON list of `{url, role, primary}` entries, defaults to
  empty).
- `created_at`.
- Unique per company on `(tenant_id, upc)`: a barcode identifies one product
  within a company.

### The scope guard learns about products
The shared ScopedRepo (the one object allowed to touch scoped tables) gets three
new abilities, all automatically limited to the caller's company:
- `list_skus()`: the company's products (company-wide, not branch-filtered).
- `create_sku(...)`: add a product, stamping it with the caller's company so it
  can never be created into another company.
- `update_sku(id, ...)`: edit a product, but only one belonging to the caller's
  company (editing an id from another company returns "not found").

### A small "admins only" check
A new `require_admin` checkpoint (a FastAPI dependency) reads the caller's role
from their wristband and returns 403 ("not allowed") for non-admins. The two
write addresses use it; the read address does not.

### Three web addresses (a new router, catalog.py)
- `GET /skus`: list the company's catalog (any signed-in person in the company).
- `POST /skus`: add a product (admin only). The body carries line, variant, upc,
  color, optional status, optional reference_images. The company is taken from
  the wristband, never the body.
- `PATCH /skus/{id}`: edit a product (admin only). Any subset of the fields.
  Editing a product that is not in the caller's company returns 404.

Input is validated with Pydantic (FastAPI's built-in checker): upc and line and
variant are required and non-empty on create; status, if given, must be `active`
or `discontinued`.

### Demo products (so tests have something real)
Seed a handful for Lumen (for example Velvet Lip in Rosewood, Mauve, Coral, plus
one Silk Foundation shade) and one for Acme, so the tests can prove one company
never sees another's catalog.

### The tests (the gate for 3a)
- **Company isolation:** a Lumen user lists only Lumen products, never Acme's;
  an Acme user lists only Acme's.
- **Admin can add:** an admin POSTs a product and it then appears in the list,
  stamped to their company.
- **Non-admin refused:** a manager or rep POSTing gets 403.
- **Admin can edit:** an admin PATCHes a product's status and the change shows
  in the list.
- **No cross-company edit:** PATCHing an id from another company returns 404.
- **Auth required:** listing with no wristband returns 401.

## The new and changed files

- `db/migrations/<timestamp>_create_skus.sql`: the skus table (with undo).
- `api/app/catalog.py`: the GET/POST/PATCH /skus router + the Pydantic models
  (new).
- `api/app/scope.py`: add `list_skus`, `create_sku`, `update_sku` to ScopedRepo
  (modify).
- `api/app/security.py`: add the `require_admin` dependency (modify).
- `api/app/main.py`: plug in the catalog router (modify).
- `api/app/seed.py`: add the demo SKUs (modify).
- `api/tests/test_catalog.py`: the tests above (new).
- Docs updated in the same breath: `api/README.md`, `db/README.md`,
  `CODEBASE_MAP.md`, `CHECKING_THE_WORK.md` (note the catalog checks),
  `START_HERE.md`, `CONTEXT.md`, and the prototype handoff CHANGELOG.

## Deliberately NOT in Phase 3a (so nothing is silently missing)

- **Surveys, versions, assignments, pass conditions:** Phase 3b.
- **Bulk import** from a spreadsheet (CSV): a later add-on.
- **Image upload/processing:** links only for now; uploads are future work and
  the photo-recognition groundwork.
- **Delete products:** v1 uses the `discontinued` status instead of deleting, so
  history is never lost.

## How we will know 3a is done

All catalog tests green (company isolation, admin-only writes, no cross-company
edit, auth required), the full backend and frontend test runs still green, a
live `GET /skus` returns the right per-company list, and all guides updated.
