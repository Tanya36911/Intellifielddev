# W7 Hierarchy Screen Design Spec

**Date:** 2026-06-25
**Status:** Approved (based on w7-hierarchy-mockup.html)

## What it does

A read-only org-tree screen. The backend returns a flat list of nodes from
GET /nodes; the frontend builds a parent-child tree from the parent_id field.
Level names (Region/District/Store) come from GET /org-levels.

## Backend contracts (frontend reads only)

GET /nodes returns:
{ nodes: [{ id, name, code, level_order, parent_id, path, chain, address, lat, lng, tz }] }

GET /org-levels returns:
{ levels: [{ level_order: number, name: string, locked: boolean }], count: number }

## Screen layout

- Four stat tiles: Org levels, Regions (level_order 1), Districts (level_order 2), Stores (locked level).
- Toolbar: search box, chain filter select, Expand all / Collapse buttons.
- Level legend: one chip per level with a colour dot.
- Info banner: explains Store is a locked level and chain is a store attribute.
- Chain banner: shown when a chain filter is active; shows count + Clear button.
- Org tree card: expand/collapse rows, colour dot per level, chain badge on stores,
  store code in mono, child count on non-store rows, underlined store name opens detail modal.
- Topbar deferred controls: Edit and Export buttons, disabled with "soon" label.

## Deferred (not built, shown as disabled "soon")

- Coverage mode (manager/rep overlay)
- Add / rename / delete nodes
- Bulk CSV import
- Export

## Colour palette (level dots)

- level_order 0 (Company): #1B4F8A (round dot)
- level_order 1 (Region):  #0ea5e9 (round dot)
- level_order 2 (District): #16a34a (round dot)
- level_order 3+ (Store/locked): #d97706 (square dot)

## Store detail modal

Shows: management path (ancestors from root to store, each with level name),
then the store itself. Attributes table: Chain, Store ID (mono), City/Address.
Accent callout: chain is a store attribute, not a management level.
