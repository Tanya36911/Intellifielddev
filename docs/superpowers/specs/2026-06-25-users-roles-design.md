# Users & Roles Screen Design Spec

**Date:** 2026-06-25
**Screen:** Admin Users & Roles (`/users`)
**Status:** Approved (based on users-roles-mockup.html)

---

## What this screen does

The Users & Roles screen lets an admin see their company's team, add a new user,
change someone's role, and move someone's pin to a different org node. It ports
the prototype `apps/admin/screens/users.jsx`, scoped down to what the real backend
supports today. It drops the `comingSoon` flag from the `users` nav item.

Two tabs:

- **People** (default): role-count summary cards, a plain-language banner ("a role
  is *what*, the pin is *where*"), and a table of every user the caller can see.
- **Roles**: a read-only reference of what each of the three fixed roles can do
  (a Full / Scoped / None capability matrix) plus a "custom roles, coming soon" row.

---

## Backend brick (built in the MAIN folder, test-first)

The `users` and `assignments` tables already exist (Phase 1/2). A user's pin is one
row in `assignments` (unique per `tenant_id, user_id`, so each user has at most one
pin). No migration is needed. We add three endpoints, all through the existing
`ScopedRepo` so the scope-follows-pin guard holds.

### GET /users  (any signed-in user; branch-scoped)

Returns the company's users that fall within the caller's scope.

Visibility rule (role-agnostic, consistent with the rest of the app):

- A *pinned* user is visible when their pinned node's `path` starts with the
  caller's `scope_path` (i.e. they are pinned at the caller's node or below it).
- An *unpinned* user (no `assignments` row) is visible only when the caller's
  `scope_path` is the company root path (the `level_order = 0` node). This lets an
  admin pinned at the root see and then pin a newly added unpinned user, while a
  branch manager does not see company-wide unpinned users.
- An unpinned caller (`scope_path` is None) sees no users (returns `[]`), the same
  "sees nothing" rule used everywhere else.

Response:

```
{ "users": [
    { "id", "name", "email", "role",                 // role: "admin"|"manager"|"rep"
      "pinned_node_id", "pinned_node_name",           // null when unpinned
      "pinned_node_level_order" },                     // null when unpinned; frontend maps to a level name via GET /org-levels
    ...
  ],
  "count": <int>
}
```

`pinned_node_level_order` is returned (not the level name) to match how the
Hierarchy screen maps `level_order` to a name via the existing `GET /org-levels`.
No `status` field is returned (there is no status column; see Deferred).

### POST /users  (admin only)

Adds a user and pins them. `require_admin` gates it. Body:

```
{ "name", "email", "role", "password", "node_id" }   // node_id optional (null = no pin)
```

Behaviour:

- `role` is a `Literal["admin","manager","rep"]` (Pydantic), matching the DB CHECK.
- `password` has a minimum length of 8. It is hashed with the existing
  `hash_password` (Argon2) in the router, and only the hash is passed to the repo.
  The plain password is never stored or logged.
- `node_id`, when given, must belong to the caller's tenant and sit within the
  caller's scope (same node-in-scope check the assignment writes use). Out of
  scope or unknown node -> 404.
- A duplicate email in the same company hits the existing
  `users_tenant_id_email_key` unique constraint -> 409 "Email already in use".
- On success the new user is created and (if `node_id` given) an `assignments`
  row pins them. Returns the same row shape as a `GET /users` entry (201).

### PATCH /users/{id}  (admin only)

Edits an existing user's role and/or pin. `require_admin` gates it. Body (all
optional, at least one required):

```
{ "role", "node_id" }     // node_id: a node id to re-pin to, or null to remove the pin
```

Behaviour:

- The target user must be in the caller's tenant -> else 404.
- `role`, when given, is validated like POST.
- `node_id`, when given and not null, must be in the caller's tenant and scope
  (-> 404 otherwise). It upserts the `assignments` row (re-pin). `node_id: null`
  removes the pin (deletes the `assignments` row).
- **Last-admin guard:** changing the role of the company's only remaining admin to
  a non-admin role is refused (-> 409 "Cannot remove the last admin"), so a company
  can never lock itself out.
- Returns the updated row in the `GET /users` shape (200).

### ScopedRepo additions

`list_users()`, `create_user(...)` (takes the already-computed password hash),
`update_user(user_id, fields)`, plus small helpers: `_root_path()` (the tenant's
`level_order = 0` node path) and reuse of the existing in-scope node lookup. All
filtered by `self.tenant_id`; the pin is read via `left join assignments ... left
join nodes`.

### Tests (api/tests/test_users.py)

Company isolation (one company's list never includes another's users); branch
scope (a manager sees only users pinned at/under their node; an unpinned user is
visible only to a root-scoped caller; an unpinned caller sees none); admin-only
POST/PATCH (manager/rep -> 403); duplicate email -> 409; node out of scope on
create/patch -> 404; role enum validation -> 422; password min length -> 422;
re-pin moves the assignment; unpin removes it; the last-admin guard -> 409;
password is stored only as an Argon2 hash (never plain).

---

## Screen layout (frontend)

New folder `apps/admin/src/pages/Users/`:

- `Users.tsx` - the page: topbar (title, People/Roles segmented control, Add user
  button), renders the People view or the Roles view.
- `useUsers.ts` - TypeScript types + the data hook (GET /users) + create/patch
  mutations (via the existing `apiSend`) + pure helpers (`roleCounts`,
  `inheritanceText(role, levelName)`), each unit-tested.
- `UserTable.tsx` - the People table rows (avatar, name, email, inline role
  control, pin cell with the inheritance sentence and a Change action).
- `RoleSelect.tsx` - the inline role chip + dropdown (admin only; read-only chip
  for non-admins).
- `AddUserModal.tsx` - name, email, role picker (3 cards), pin-to-node select
  (fed by the existing `GET /nodes` + `GET /org-levels`), starting-password field,
  and a live "what they will see" inheritance preview.
- `MovePinModal.tsx` - re-pin a user to a different node (or remove the pin), with
  the same inheritance preview.
- `RolesReference.tsx` - the Roles tab: the explainer card + the capability matrix
  (a static, honest reference of built / near-built capabilities) + the "custom
  roles, coming soon" row.
- `*.module.css` + tests.

Data: `useUsers` (GET /users), plus the existing `useNodes`/org-levels data for the
pin picker and level-name mapping. Mutations invalidate the users query on success.

---

## Role rules (frontend gating; backend is the real guard)

| Action | admin | manager | rep |
|---|---|---|---|
| View the screen / list | yes (scoped) | yes (scoped) | yes (scoped) |
| Add a user | yes | no | no |
| Change role / move pin | yes | no | no |

Non-admins see the same screen in read-only mode (no Add button, role shown as a
plain chip, no Change link), matching the Catalog screen's read-only pattern. The
backend enforces the real rule (403 on POST/PATCH for non-admins); the frontend
gating only hides controls. A manager's list is naturally limited to their branch
by the scope guard; a rep effectively sees only themselves.

---

## Deferred (out of scope for this screen, shown honestly)

- **Real emailed invite links** (needs an email system). v1 has the admin set a
  starting password instead. The modal copy says so.
- **Enable / disable a user** (no status column). The screen shows an "Active"
  chip and a disabled "coming soon" action; no fake disable.
- **Manager-scoped invite.** The capability matrix shows Manager as "Scoped" for
  managing users as the intended model, but v1 backend is admin-only for
  POST/PATCH. Manager-scoped writes are a later addition.
- **Custom roles** (the three roles are fixed).
- **Per-user activity / last-active** (no session-tracking data exists).

---

## Known limitation

The sidebar company name and the current user's own role come from the login
response, so a self role change (an edge case the last-admin guard mostly blocks)
or other login-time data refreshes on next sign-in. This screen does not change
the signed-in user's own session.
