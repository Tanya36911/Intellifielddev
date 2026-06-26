# Set Org Levels Brick Design Spec (Setup Wizard, Slice 1b)

**Date:** 2026-06-26
**Status:** Self-directed (Tanya: "do the best next thing"). Backend-only prerequisite for the wizard's step 2.

## Why

The setup wizard's step 2 ("name your levels") needs to write the company's org
level definitions. Today `org_level_definitions` is created only by the seed and
read only via `GET /org-levels`. This brick adds the one missing write so the
wizard slice that follows is pure UI assembly (it already has nodes, users, and
company/payroll config). No immediate UI; this is plumbing, like the earlier
backend phases.

## Endpoint (MAIN folder, test-first; no migration)

### PUT /org-levels  (admin only)

Replaces the caller's company org level definitions with an ordered top-to-bottom
list. Admin-only (`require_admin`), tenant-scoped through the `ScopedRepo`.

Body:
```
{ "levels": ["Company", "Region", "District", "Store"] }   // 2..7 names, ordered top to bottom
```

Behaviour:
- The list length must be 2 to 7 (a top and a bottom at minimum). Names must be
  non-empty. Otherwise 422.
- The new rows get `level_order` 0..n-1 by position; `locked = (i == 0 or i == n-1)`
  (the top and bottom levels are always locked, matching the seed and the prototype).
- **Re-map safety:** if the company already has any non-root node (a node with a
  parent, i.e. real regions/districts/stores exist), the new list length MUST equal
  the current level count. This permits renaming and reordering labels (which keep
  every node's `level_order` valid) but refuses adding or removing a level (which
  would leave existing nodes at an undefined level). Refused with 409 and a clear
  message ("remove the nodes below the root before changing the number of levels").
  When the tree is empty or only the root exists, any valid list is allowed (the
  fresh-setup path the wizard uses).
- Replace is transactional: delete the tenant's `org_level_definitions`, insert the
  new ordered set. `nodes.level_order` is a plain integer (not a foreign key to
  `org_level_definitions`), so replacing the level rows never breaks node rows.
- Returns the new levels in the `GET /org-levels` shape (200):
  `{ "levels": [{ level_order, name, locked }], "count": n }`.

### ScopedRepo addition
`set_org_levels(names: list[str]) -> list[dict] | None` returning the new levels, or
`None` (mapped to 409 by the router) when the re-map safety rule blocks a structural
change. A small `_non_root_node_count(conn)` helper. Reuses the existing tenant scoping.

## Tests (api/tests/test_org_levels.py)
- Rename-only on a populated company (Lumen): PUT the same 4 levels with new names
  succeeds and `GET /org-levels` reflects them; then restore the original names so
  the session DB is unchanged.
- Structural change on a populated company refused: PUT 5 levels for Lumen returns
  409; `GET /org-levels` is unchanged.
- Fresh/empty company allowed: insert a throwaway empty tenant (root node only) +
  an admin directly via the engine, log in, PUT a 5-level structure, expect 200 and
  the levels created with correct `locked` flags (top + bottom locked).
- Non-admin (manager/rep) PUT returns 403.
- Validation: a 1-element list and an empty name return 422.
- Company isolation: the rename never touches the other tenant's levels.

## Deferred
- Per-level granular endpoints (add-one / remove-one / reorder): the bulk PUT covers
  the wizard's "confirm this structure" action; granular ops are not needed yet.
- Any UI: the wizard slice (next) is the consumer.
