# Admin Hierarchy: prototype fidelity pass (2026-06-30)

Screen 1 of the fidelity pass. Bring the Admin Hierarchy screen (`/hierarchy`) up to
the prototype (`../hi-fi-intelli/project/apps/admin/screens/hierarchy.jsx`). Mockup
approved by Tanya (docs/superpowers/mockups/ via artifact). Branch:
`admin-hierarchy-fidelity`.

## In scope

Frontend-only polish (match the prototype exactly):
1. **Chain colour dot.** The chain badge on a store row (and in the store detail
   panel) gets a small coloured dot keyed to the retailer:
   CVS `#cc0000`, Walgreens `#e01a2b`, Walmart `#0071ce`, Target `#cc0000`,
   Rite Aid `#005daa`, fallback `#999`.
2. **Lock icon** on locked-level rows (Company root and Store), and in the level
   legend chip for the locked level. Detect via the level's `locked` flag.
3. **Info banners.** Replace the single banner with the prototype's two: (a) a
   locked-levels note ("Company and Store are locked levels..."), (b) the
   chain-is-an-attribute note. The existing chain-active banner stays.
4. **Search placeholder** ellipsis: "Find a node…" (real ellipsis char).

Coverage mode (frontend-only, reuses `GET /users`):
5. A **Structure / Coverage** segmented toggle in the toolbar. In Coverage mode the
   tree rows show staffing instead of codes/chain:
   - a node with a **manager pinned exactly at it** shows a blue chip with the
     manager's name;
   - **region/district** rows show a rep-count chip: green "N reps" when reps are
     pinned at or under the node, amber "No reps yet" when none;
   - a **summary banner** at the top: green when every district has a rep, amber
     naming the gap count otherwise.
   Adapted to Lumen's real levels (Region / District / Store); the prototype's
   "Territory" level does not exist here, so rep coverage is counted per district.
   Coverage is read-only.

Bulk import (real, end to end):
6. A **Bulk import** pop-up (CSV tab + API-import "coming soon" tab). The CSV tab
   parses the file in the browser into rows `{level, name, parent}`, shows a review
   (valid count, per-row problems the user can skip), then imports.
7. **New backend endpoint** `POST /nodes/bulk` (admin-only, branch-scoped) does the
   real creation. See contract below.

## Out of scope (kept honest)

- The prototype's "API import" (Workday/Salesforce/SAP) stays a styled "coming soon"
  tab; there is no integration backend.
- Re-parenting / moving a node (already deferred).
- The stat tiles (Org levels / Regions / Districts / Stores) are a build extra we
  keep; the prototype has none.

## Backend: `POST /nodes/bulk`

Admin-only (`require_admin`), scoped through the same `ScopedRepo`. Reuses the
existing node-insert logic (level = parent level + 1, auto `code`, `path`).

Request body:
```
{ "rows": [ { "level": "<level name>", "name": "<node name>", "parent": "<parent node name>" }, ... ] }
```

Behaviour (one transaction, commit the valid rows, report the rest):
- Resolve `level` to a `level_order` by matching an org level name (case-insensitive).
  Unknown name -> row error "unknown level".
- A row at level_order 0 (the Company root) is refused ("cannot import the top level").
- Resolve `parent` by name to exactly one in-scope node whose `level_order` is
  `level_order - 1`, considering both pre-existing nodes AND nodes created earlier in
  the same batch (so a District and its Stores can import together). Zero matches ->
  "parent not found"; more than one -> "parent is ambiguous".
- Create valid rows; skip error rows. Out-of-scope parent -> that row errors (the
  scope filter never matches it).

Response:
```
{ "created": <int>, "errors": [ { "row": <0-based index>, "name": "...", "reason": "..." } ] }
```

## Test plan

Backend (`api/tests/test_nodes_bulk.py`):
- happy path: import a District + two Stores under it in one call -> created 3,
  no errors, and they appear in `GET /nodes`.
- in-batch parent: a Store whose parent is a District created in the same batch.
- unknown level name -> row error, others still import.
- parent not found -> row error.
- ambiguous parent (two nodes share the name at the right level) -> row error.
- company-root row refused.
- non-admin (manager/rep) -> 403.
- out-of-scope parent (a manager importing under a node outside their branch) -> row error / 404.
- company isolation: a row cannot attach to another tenant's node.

Frontend (`apps/admin/src/pages/Hierarchy/`):
- pure helpers: a CSV parser (`parseCsv`) and a coverage computation
  (`computeCoverage(users, idx)`), unit-tested.
- the chain colour map, lock icon, and banners render (component tests).
- the Structure/Coverage toggle switches the rendered chips.

## Docs to update in the same change

START_HERE.md, CONTEXT.md, CODEBASE_MAP.md, ROADMAP.md, api/README.md,
apps/admin/README.md, and the prototype handoff CHANGELOG in ../hi-fi-intelli.
