# The ADMIN FRONTEND, explained for a non-coder (apps/admin/)

This is the "dining room" for brand HQ: the screens you see and click in a web
browser. It is built with **React** (a tool for making web screens) and
**Vite** (a tool that builds and serves those screens fast). It talks to the
backend waiter; it never touches the database directly.

It has a working **login screen**, the **app shell** (the persistent left sidebar
and a per-page top bar that frame every screen), a small shared **UI kit**
(reusable building blocks like buttons and cards), and the real screens: the
**Analytics dashboard** (the landing screen at `/`), the **Catalog** (the
company's product list at `/catalog`), the **Surveys** area (build, publish, and
assign checklists at `/surveys`), the **Payroll** screen (pay periods, hours
table, approve/seal/reopen, audit log, CSV download at `/payroll`), the
**Hierarchy** screen (the org tree, expand/collapse, store detail panel, and an
admin-only Edit mode to add/rename/delete nodes at `/hierarchy`), the
**Users & Roles** screen (the team list, role-count cards, a
capability matrix, and admin-only add-a-person / change-a-role / move-a-pin at
`/users`), the **Settings** screen (the company name and a payroll on/off
switch, the rest shown as "coming soon", at `/settings`), and the fullscreen,
admin-only **Setup wizard** (a 5-step guided company-setup flow at `/setup`). All
Admin web sidebar screens are now complete, the Hierarchy screen is editable for
admins, and with the setup wizard done the Admin web app is feature-complete.

To see it: `pnpm dev:admin`, then open the address it prints (usually
http://localhost:5173). To run its automated checks: `pnpm test:admin`.

---

## How to read this folder

The real screen code lives in `src/`. Everything outside `src/` is setup. A
handy rule we follow: **each test file sits right next to the file it checks**,
with the same name plus `.test`. So `Login.tsx` is the screen and
`Login.test.tsx` is its robot check.

---

## The setup files (outside src/)

| File | In plain words |
|------|----------------|
| `index.html` | The single blank web page the app loads into. It also pulls in the three brand fonts. React fills the empty `<div id="root">` with the actual screens. |
| `package.json` | This app's ID card and its list of needed libraries plus command shortcuts (`dev`, `build`, `test`). |
| `vite.config.ts` | Settings for the build/serve tool, including how the test robot runs. |
| `tsconfig.json` | Settings for TypeScript, the stricter flavor of the language that catches typos before they become bugs. |

---

## The screen code (inside src/)

### main.tsx  (the front door)
The very first bit of frontend code that runs. It wraps the whole app in the
things every screen needs: the session pocket (who is signed in), the
page-switcher (web addresses), the brand styles, and (added in W1) **TanStack
Query**, the tool that fetches data from the backend and remembers it so the same
numbers do not get re-fetched on every click. Then it puts the app on the page.

### App.tsx  (the route map and doorman)
Decides which screen shows for which web address. `/login` shows the login
screen; `/` shows the **dashboard** (inside the app shell); the not-yet-built
screens show a "coming soon" page. The "doorman" rule lives here: if you are not
signed in and try to open a screen, it sends you to `/login`; if you are already
signed in and open `/login`, it sends you to `/`. Added with the setup wizard: a
`/setup` route that lives OUTSIDE the app shell (it is fullscreen, like the login
screen), and it is admin-only (a non-admin who opens it is redirected away).

### index.css  (the baseline look)
A few global style rules: the background color, the body font, and pointing
headings at the heading font. The detailed look of each screen lives in that
screen's own style file (below).

### The backend helper and session (now shared in `@intelli/api-client`)
The one set of calls that talk to the backend waiter used to live in
`apps/admin/src/lib/`. As of the Manager-app groundwork (2026-06-29) they moved
into a shared package, `@intelli/api-client` (in `packages/api-client/`), so the
Admin and the future Manager web app use one copy. A screen pulls them in with
`import { apiGet } from '@intelli/api-client'`. The calls are unchanged: `login`
(send email + password, get a wristband back), `health` (is the backend awake?),
`apiGet` (fetch data, automatically attaching the login wristband), `downloadCsv`
(save a spreadsheet file, wristband attached), `apiSend` (the write helper for
POST / PATCH / PUT that save or update something), and `apiDelete` (remove
something). It is still the one place that knows the backend's address, and it
turns backend problems into friendly messages ("Invalid email or password", or
"Can't reach the backend"). It also reads the saved login wristband out of the
browser's storage pocket; because the Admin and Manager apps could share a web
address, each app tells the helper its own storage slot once at startup (the
Admin app uses `intelli-admin-session`, set in `main.tsx`), so they never share a
login. The package's checks live in `apps/admin/src/test/api-client.test.ts`.
Full guide: `packages/api-client/README.md`.

### store/  (the session pocket: who is signed in)
"Store" is the agreed shared memory for the whole app. We use a tool called
Redux Toolkit for it.
- `store/auth.ts`: holds the wristband and the signed-in person's name and
  role. It copies them into the browser's small storage pocket so you stay
  signed in for up to 12 hours even after closing the browser, and it throws
  away an expired wristband when the app starts. Checked by `store/auth.test.ts`.
- `store/index.ts`: wires the pocket together and gives screens a tidy way to
  read from it.

### shell/  (the frame around every screen, added in W1)
The "shell" is the part of the app that stays on screen no matter which page you
are on: the sidebar down the left and a bar across the top. Every real screen is
shown inside it.
- `shell/Shell.tsx` + `Shell.module.css`: the frame itself. It places the sidebar
  on the left and whatever screen you are on in the main area, with the top bar
  above it. Checked by `Shell.test.tsx`.
- `shell/Sidebar.tsx` + `Sidebar.module.css`: the persistent left sidebar. It
  shows the Intelli brand, your company card (company name + your pinned spot in
  the org tree), the navigation menu (with the not-yet-built screens shown as
  "coming soon" placeholders), your footprint of Nodes/Stores/Reps, and the user
  card with Sign out. The web version deliberately leaves out a few prototype
  bits (no tenant switcher, no "Synced" control; the notifications bell is
  "coming soon"). As of the setup wizard, the sidebar **hides admin-only menu
  items from non-admins** (so a manager or rep does not see the Setup item).
  Checked by `Sidebar.test.tsx`.
- `shell/Topbar.tsx` + `Topbar.module.css`: the slim bar across the top of each
  page (the page's title and per-page controls). Checked by `Topbar.test.tsx`.
- `shell/nav.ts`: the plain list of menu items (their names, icons, web
  addresses, and whether each is built yet or still "coming soon"). Keeping the
  menu in one list means the sidebar and the route map agree. As of the setup
  wizard it includes the admin-only **Setup** item (in the organization group),
  which the sidebar hides from non-admins.

### The shared UI kit (now `@intelli/ui`)
The small reusable building blocks (the Lego bricks the screens are built from,
ported from the prototype so every screen looks consistent) used to live in
`apps/admin/src/ui/`. As of the Manager-app groundwork (2026-06-29) they moved
into a shared package, `@intelli/ui` (in `packages/ui/`), so the Admin and the
future Manager web app use one copy and a button looks and behaves the same in
both. A screen pulls them in with `import { Button, Card, Modal } from '@intelli/ui'`.
The kit holds: the icon drawer (Icon + icons), Avatar, Chip, Button, Card,
Segmented (a toggle row), Switch (an on/off toggle), Spark and Bar (the little
dashboard charts), and the form pieces Modal (the pop-up shell), Field (a labelled
form-field wrapper), Input, and Select (a dropdown), which share one form style.
Its checks live in `apps/admin/src/test/ui-kit.test.tsx`. Full guide:
`packages/ui/README.md`.

### pages/  (the actual screens)
- `pages/Login.tsx` + `Login.module.css`: the login screen and its looks. The
  form-checker (catching a bad email or empty password before sending) and the
  friendly error messages live here. Checked by `Login.test.tsx`.
- `pages/Dashboard/`: the Analytics dashboard, the first real screen (added in
  W1), broken into one folder of small parts:
  - `Dashboard.tsx` + `Dashboard.module.css`: the screen itself, which lays out
    all the pieces below. Checked by `Dashboard.test.tsx`.
  - `KpiCard.tsx`: a single headline card (a number like average compliance, with
    a tiny trend line and an up/down change). The dashboard shows three.
  - `TrendChart.tsx`: the weekly completion-trend line.
  - `ComplianceList.tsx`: the "Compliance by node" card. It lists your org nodes
    (the regions when you are at the company root), and you click a row to drill
    region -> district -> store -> the exact product that failed. Each level fetches
    `/analytics/compliance/nodes` for that node, windowed to the same date range as
    the headline cards so the two always agree.
  - `AiPreview.tsx`: the AI gap list, clearly badged "preview" (it is a glimpse of
    a later feature, not live yet).
  - `useDashboard.ts`: the "hooks" that fetch the screen's numbers from the backend
    (via `apiGet`): `useDashboard` for the headline figures (`/analytics/dashboard`)
    and `useNodeCompliance` for the compliance-by-node rollup
    (`/analytics/compliance/nodes`), both sending the selected date range. Keeping
    the data-fetching in its own file keeps the screen file about layout. Checked by
    `useDashboard.test.ts`.
  (Each `.tsx` above has a matching `.module.css` for its look.)
- `pages/Catalog/`: the Catalog screen, the second real screen (added in W3).
  Shows the company's product list (each product variant, called a SKU, such as
  Velvet Lip in Rosewood) grouped by product line, in either a List view or a
  Gallery view, with search and a status filter. Three stat tiles at the top
  show the number of product lines, total products, and active products. Admins
  can add a new product or edit an existing one via a pop-up form. Managers and
  reps see the same screen but in read-only mode: no Add button, and clicking a
  row does nothing. One company never sees another's products (the backend
  enforces this). The folder contains:
  - `Catalog.tsx` + `Catalog.module.css`: the screen itself. Reads who is
    signed in, shows the three stat tiles, the search bar, the view and status
    controls, and the list of product-line sections. Checked by `Catalog.test.tsx`.
  - `useCatalog.ts`: the data layer. Fetches the product list from the backend
    (`/skus`) and provides helpers for grouping by line, computing the stat
    numbers, and filtering by status or search term. The search matches a
    product's name or line (ignoring upper/lower case) or its UPC barcode
    (ignoring spaces). Checked by `useCatalog.test.ts`.
  - `LineSection.tsx` + `LineSection.module.css`: one collapsible product-line
    section (the header with the line name and product count, then either a list
    table or a gallery grid of that line's products). Hides itself completely
    when no products in that line match the current search or filter.
  - `SkuThumb.tsx` + `SkuThumb.module.css`: the photo cell shown for each
    product. If a real photo link exists it shows the photo; otherwise it shows
    a tidy colour-swatch placeholder tinted with the product's colour (or a
    neutral grey when no colour is set) and a small camera icon. Also shows a
    count of photos ("No photo" or "1 photo" and so on).
  - `SkuCard.tsx` + `SkuCard.module.css`: one gallery card (a large photo or
    swatch, a colour dot, the variant name, and a status pill).
  - `ProductFormModal.tsx` + `ProductFormModal.module.css`: the add/edit
    pop-up form. Five fields: product line (choose an existing line or type a
    new one), variant name, UPC barcode, colour (optional colour picker), and
    status (Active or Discontinued). Save is only enabled once the line, variant,
    and UPC are all filled in. On a successful save the form closes and the
    list refreshes. Real photo upload is noted as "coming soon" (it needs
    cloud photo storage, a later piece of work).
- `pages/Surveys/`: the Surveys area, the third real screen (added in W4),
  reachable at `/surveys`. Lets admins build, publish, and assign checklists.
  Three panels live in this folder:
  - `SurveyList.tsx` + `SurveyList.module.css`: the surveys list. Shows every
    survey for the company with a status chip (Published / Draft / Archived), a
    version chip, and an Assigned / Not assigned indicator. Three stat tiles at
    the top count all surveys, published surveys, and drafts. Each survey row
    also shows a response-count badge; clicking it opens the responses pop-ups
    described below. Uses `survey.id` (not `survey.name`) to filter and count
    responses, so the numbers are always correct. Checked by `SurveyList.test.tsx`.
  - `Builder.tsx` + `Builder.module.css`: the by-hand survey builder. Lets an
    admin add questions of six types (Yes/No, Number, Single choice, Multiple
    choice, Photo, Short text), mark a question required, set a pass rule for
    scoreable types (Yes/No, Number, Single choice), and ask a question "per
    product" by picking product lines (which freeze to specific product ids when
    the survey is published). Questions can be reordered with up/down arrows.
    A survey name cannot be changed after it is first created (the backend has no
    rename endpoint), so the name field is read-only in edit mode.
  - `QuestionCard.tsx` + `QuestionCard.module.css`: one question row in the
    builder: the question text, type, required toggle, up/down arrows, and the
    per-product and pass-rule sections.
  - `PassConditionEditor.tsx` + `PassConditionEditor.module.css`: the small
    form inside a question card that lets an admin set the pass rule: choose an
    operator (>=, <=, >, <, ==, !=, in, not_in) and a threshold value, and pick
    whether the rule applies to each product or to the total. Only Yes/No,
    Number, and Single choice questions can carry a pass rule.
  - `PublishConfirm.tsx` + `PublishConfirm.module.css`: the publish confirmation
    pop-up. Warns that publishing freezes the version forever and cannot be
    undone, then sends the publish request when the admin confirms.
  - `AssignPanel.tsx` + `AssignPanel.module.css`: the assign panel. Points a
    published survey version at one or more org nodes, with a deadline field
    and a timezone label (rep-local or corporate). The timezone label is stored
    for display only and does not yet shift the deadline per store.
  - `useSurveys.ts`: the data layer for the whole Surveys area. Fetches surveys,
    product lines, and nodes from the backend via the existing `/surveys`,
    `/skus`, and `/nodes` endpoints. Also holds the pure helper functions that
    translate the builder's question shape to and from the backend's format.
    Checked by `useSurveys.test.ts`.
  - `useResponses.ts`: the data layer for responses. Fetches the full list of
    responses the signed-in user can see (`GET /responses`), and on request one
    response in detail (`GET /responses/{id}`). Each row in the list now carries
    `survey_id`, `scored` (questions that had a pass rule and were answered), and
    `passed` (of those, how many passed). Pure helpers: `responsesForSurvey`
    (filter rows to one survey by id), `countBySurvey` (response count per
    survey id), and `responseStatus` (overall pass/partial/fail/na status from a
    detail's questions map). Checked by `useResponses.test.ts`.
  - `ResponsesListModal.tsx` + `ResponsesListModal.module.css`: the pop-up that
    lists all responses for one survey. Each row shows the rep's avatar and name,
    store name, submission date, a real percentage (passed / scored * 100), and a
    Pass / Partial / Fail / Not scored chip. Clicking a row opens the detail
    pop-up. Checked by `ResponsesListModal.test.tsx`.
  - `ResponseDetailModal.tsx` + `ResponseDetailModal.module.css`: the pop-up
    that shows one response in full. The header shows the rep, the store's chain,
    code and address (e.g. "CVS, sf", added in the 2026-07-01 fidelity pass), and a
    verdict badge (percentage and pass/partial/fail/na label). When a store has
    audited shades below the facings threshold, a red **SKU-gap callout** ("N of M
    audited shades below the facings threshold") appears under the verdict, computed
    from the response's per-SKU verdicts by the `skuGapSummary` helper in
    `useResponses.ts`. Below that, each survey question appears with its answer and a
    pass/fail result chip. Per-product number questions show a color-dot grid: green
    cell for pass, red cell for fail, with the count and a check or X icon. Photo
    questions show a placeholder. Checked by `ResponseDetailModal.test.tsx`.
- `pages/Payroll/`: the Payroll screen, added in W6, at `/payroll`. Shows a pay
  period selector and a table of each rep's hours (store/reset/drive minutes,
  miles, approval status) for the selected period. Managers can approve or reject
  individual entries. Admins can seal the period (locks all entries; a padlock icon
  appears plus a per-rep Reopen button) or reopen one rep's entry by typing a
  reason (written to the audit log). A Download CSV button exports the period.
  Role-gating: reps are redirected away entirely, managers approve, admins
  seal/reopen/read-audit. If a company has payroll switched off, the screen shows a
  graceful "payroll not enabled" state. The screen calls the existing backend
  endpoints: `/pay-periods`, `/time-entries` (plus approve/reject/seal/reopen),
  `/audit`, and `/export/payroll`. No new backend endpoints were added. The folder
  contains `Payroll.tsx`, `usePayroll.ts`, `ReopenModal.tsx`, plus tests and CSS.
  Deferred: per-rep hour drill-in, inline editing.
- `pages/Hierarchy/`: the Hierarchy screen, added in W7, at `/hierarchy`. Shows
  the company's org tree in an expand/collapse view. Each row has a colour
  dot, the level name (Region/District/Store from the company's own level
  definitions), a chain badge on stores, the store code, and child counts. A search
  box filters by name or code; a chain filter narrows by chain. Clicking a store
  opens a detail panel with the store's full management path and its attributes.
  Backed by the existing `GET /nodes` endpoint plus a new small read-only
  `GET /org-levels` endpoint (returns the company's level names, tenant-scoped;
  added to `api/app/hierarchy.py` and `api/app/scope.py` with a test). As of the
  editable Hierarchy (2026-06-26, setup-wizard slice 1) the screen has an
  **admin-only Edit mode**: an admin can add a child node under any node (its level
  is set automatically from the parent, so a child of a Region becomes a District,
  and a Store gets no add-child because a store is the bottom of the tree), rename a
  node (and edit a store's chain and address), and delete a node but only when it is
  empty (no child nodes, nobody pinned to it, no surveys assigned, no responses;
  otherwise it refuses and tells you what is blocking the delete). Managers and reps
  still see the screen read-only. The edit actions call three backend endpoints:
  `POST /nodes` (add a child), `PATCH /nodes/{id}` (rename and edit store
  attributes), and `DELETE /nodes/{id}` (delete an empty node), all admin-only and
  branch-scoped, with no database change. The folder contains `Hierarchy.tsx`,
  `useHierarchy.ts`, `TreeNode.tsx`, `StoreDetailModal.tsx`, and (added with edit
  mode) `NodeFormModal.tsx` (the add/rename pop-up form), plus tests and CSS. Edit
  mode also added new mutation hooks plus an `isBottomLevel` helper and a
  `levelChildName` helper in `useHierarchy.ts`, edit-mode wiring in `Hierarchy.tsx`
  and `TreeNode.tsx`, and an `apiDelete` helper in the shared API client.
  As of the prototype fidelity pass (2026-06-30) the screen also matches the prototype
  on: a coloured retailer dot on each chain badge (and in the store detail panel); a
  lock icon on locked rows (Company root and Store) and in the level legend; the
  prototype's two info banners (locked levels, and chain-is-an-attribute); a
  **Structure / Coverage** segmented toggle whose Coverage view shows who manages and
  staffs each node (a manager chip on the node they are pinned to, a rep-count chip on
  regions and districts, and a green/amber "every district has a rep / N have no rep
  yet" summary), adapted to Lumen's Region/District/Store levels and reusing the
  existing `GET /users` (fetched lazily, only when Coverage is opened, via
  `useUsers(enabled)`); and a real **Bulk import** pop-up (`BulkImportModal.tsx`) whose
  CSV tab parses the file in the browser into `{level, name, parent}` rows (the
  `parseCsv` helper), shows a review, then imports through the new admin-only
  `POST /nodes/bulk` endpoint (the `useBulkImportNodes` hook); the API-import tab is a
  styled "coming soon". New pure helpers in `useHierarchy.ts` (`chainColor`,
  `computeCoverage`, `parseCsv`) are unit-tested. The company root no longer offers
  Rename/Delete in edit mode (the company name lives in Settings; the root cannot be
  removed); a store stays editable by design. Deferred: moving a node to a new parent
  (re-parenting), editing the org levels themselves (that comes with the wizard), and
  export.
- `pages/Users/`: the Users & Roles screen, at `/users`. A People tab with three
  role-count cards (Admin / Manager / Rep), a plain-language banner ("a role is what
  a person can do, their pin is where they can do it"), and a team table; a Roles tab
  with a read-only capability matrix (Full / Scoped / None per role). Admins can add
  a person, change a role in the table, and move or remove a pin; managers and reps
  see it read-only. Backed by the new `GET /users` (branch-scoped team list),
  admin-only `POST /users` (add and pin a person), and admin-only `PATCH /users/{id}`
  (change role and/or move-or-remove the pin) endpoints. The folder contains:
  - `Users.tsx` + `Users.module.css`: the screen itself. Reads who is signed in,
    shows the two tabs (People and Roles), the role-count cards, the banner, and the
    team table, and (for admins) the Add-user button.
  - `useUsers.ts`: the data layer. Fetches the team list from the backend (`/users`)
    and the org nodes (`/nodes`), and holds the add-user, change-role, and move-pin
    write calls plus the small pure helpers (such as the role counts).
  - `pinOptions.ts`: builds the list of org-tree spots an admin can pin a person to,
    turning the raw node list into a tidy indented set of choices.
  - `RolesReference.tsx`: the Roles tab, the read-only capability matrix showing
    what each role (Admin / Manager / Rep) can do (Full / Scoped / None).
  - `AddUserModal.tsx`: the add-a-person pop-up form (name, email, role, which node
    to pin to, and a starting password the admin sets). Refuses a duplicate email and
    an out-of-branch node with the backend's message.
  - `MovePinModal.tsx`: the pop-up that moves a person to a different org spot or
    removes their pin entirely.
  - `UserTable.tsx`: the team table (one row per person: name, email, role, and the
    pinned spot with a sentence explaining what that pin lets them see).
  - `RoleSelect.tsx`: the small inline dropdown in a table row that lets an admin
    change a person's role on the spot.
  (Each `.tsx` above has its own `.module.css`, and each is checked by a matching
  test file.) Deferred and noted honestly: real emailed invite links (for now the
  admin sets a starting password), enable/disable a person (no status column yet),
  manager-scoped invites (admin-only for now), and custom roles.
- `pages/Settings/`: the Settings screen, at `/settings`. The company name and a
  payroll on/off switch are real and saved (the switch genuinely turns the Payroll
  screen and its backend actions on or off); five more panels are shown honestly as
  "coming soon". Managers and reps see it read-only. Backed by the new `GET /tenants`
  (read this company's settings) and admin-only `PATCH /tenants` (edit the name and/or
  the payroll switch) endpoints. The folder contains:
  - `Settings.tsx` + `Settings.module.css`: the screen itself, which lays out the
    company panel, the payroll panel, and the coming-soon panels, and reads who is
    signed in to decide editable vs read-only.
  - `useSettings.ts`: the data layer. Fetches this company's settings from the
    backend (`/tenants`) and holds the save call (`PATCH /tenants`).
  - `CompanyPanel.tsx`: the editable company-name panel (the company code is shown
    but cannot be edited).
  - `PayrollPanel.tsx`: the payroll on/off switch panel.
  - `ComingSoonPanel.tsx`: the reusable panel that honestly marks a not-yet-built
    setting (pay-period defaults, work model, store chain logos, audit log, data &
    security) as "coming soon".
  (Each panel has its own `.module.css` and a matching test file.)
- `pages/Setup/`: the Setup wizard, added 2026-06-26, at `/setup`. A fullscreen,
  admin-only, 5-step guided flow that walks an admin through setting up their company
  by reusing the building blocks already shipped. It saves as you go, and Finish or
  Exit returns to the dashboard. It is admin-only (the route redirects non-admins, the
  Setup nav item is hidden from them, and the backend still guards every save). No new
  backend was needed: it reuses `PUT /org-levels`, `PATCH /tenants`, `POST /nodes`, and
  `POST /users`. The folder contains:
  - `SetupWizard.tsx` + CSS: the wizard shell. It frames the five steps, the
    step indicator, the Back / Next / Finish / Exit controls, and reads who is signed
    in to enforce admin-only.
  - `useSetup.ts`: the data layer. Loads the company's current org levels, tree,
    settings, and team, and holds the save calls each step uses (`PUT /org-levels`,
    `PATCH /tenants`, `POST /nodes`, `POST /users`).
  - `StepTemplate.tsx`: step 1, choose a starting point (pick a hierarchy template, a
    ready-made level structure). On a company that is already set up, templates are
    switched off with a note that they are for brand-new companies only.
  - `StepLevels.tsx`: step 2, name your levels. Renames the org levels (and, on a fresh
    company, adds / removes / reorders them), saved via `PUT /org-levels`. On a company
    that already has stores it shows the company's REAL current level names in
    rename-only mode (it will not change the number of levels, which would strand
    existing stores), with a clear note.
  - `StepPayroll.tsx`: step 3, turn the payroll module on or off (saved via
    `PATCH /tenants`). The detailed pay-period settings are shown as "coming soon",
    same as the Settings screen.
  - `StepTree.tsx`: step 4, build the tree, adding org spots (regions, districts,
    stores) via `POST /nodes`. CSV import and system sync are shown as "coming soon".
    A store (the bottom of the tree) is never offered as a parent when adding a spot.
  - `StepInvite.tsx`: step 5, invite people, adding team members and pinning each to a
    spot via `POST /users` (the admin sets a starting password). Real emailed invites
    are shown as "coming soon".
  (Each step has its CSS and a matching test file.) An adversarial review caught and
  fixed three issues before this shipped: step 2 now seeds from the company's real
  saved level names (it had been showing the template's placeholder names on an
  already-set-up company), the payroll on/off switch can no longer fire two saves at
  once, and store-level nodes are no longer offered as parents in step 4.
- `pages/ComingSoon.tsx` + `ComingSoon.module.css`: the friendly placeholder shown
  for any menu items whose screens we have not built yet.
A `.module.css` file is styling that applies ONLY to its own screen, so two
screens can use the same names without clashing.

### test/  (shared testing helpers)
- `test/setup.ts`: prepares the test robot before each run (tidies up between
  checks).
- `test/fixtures.ts`: small fake data the checks reuse, like a pretend
  wristband and a pretend user named Dana. In W3, the Dana fixture gained a
  company name (so the Catalog subtitle is testable), and a second non-admin
  fixture (Marcus, a rep) was added so the read-only mode of the Catalog can
  be checked.
- `test/render.tsx`: the shared helper that puts a screen on the page for a
  test. In W3 it gained an optional session argument, so a test can say "render
  this screen as if Dana is signed in" without any extra setup. Before W3, the
  helper had no signed-in user, which was fine for the Dashboard (it does not
  care who you are), but the Catalog does (admins see the Add button; everyone
  else sees read-only).
- `App.test.tsx`: the big end-to-end check that walks through the whole journey
  (land on login, wrong password shows an error, good login reaches the welcome
  page, sign out returns to login).

---

## How it connects to everything else

The screens here call the shared API client (`@intelli/api-client` in
`packages/api-client/`), which calls the backend in `api/`, which reads the
database whose shape is in `db/`. The shared building blocks come from
`@intelli/ui` (`packages/ui/`) and the colors and fonts from `@intelli/tokens`
(`packages/tokens/`). So this folder is purely the "what you see and click"
layer.
