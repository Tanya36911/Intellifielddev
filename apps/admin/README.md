# The ADMIN FRONTEND, explained for a non-coder (apps/admin/)

This is the "dining room" for brand HQ: the screens you see and click in a web
browser. It is built with **React** (a tool for making web screens) and
**Vite** (a tool that builds and serves those screens fast). It talks to the
backend waiter; it never touches the database directly.

So far it has a working **login screen**, the **app shell** (the persistent left
sidebar and a per-page top bar that frame every screen), a small shared **UI kit**
(reusable building blocks like buttons and cards), and three real screens: the
**Analytics dashboard** (the landing screen at `/`), the **Catalog** (the
company's product list at `/catalog`), and the **Surveys** area (build, publish,
and assign checklists at `/surveys`). More Admin screens get added on top in later steps.

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
signed in and open `/login`, it sends you to `/`.

### index.css  (the baseline look)
A few global style rules: the background color, the body font, and pointing
headings at the heading font. The detailed look of each screen lives in that
screen's own style file (below).

### lib/api.ts  (the one phone line to the backend)
The ONLY file that talks to the backend waiter. It knows the backend's address
and offers the calls every screen needs: `login` (send email + password, get a
wristband back), `health` (is the backend awake?), and (added in W1) `apiGet`
(fetch data from any backend address, automatically attaching the login
wristband) and `downloadCsv` (ask the backend for a spreadsheet file and save it
to your computer, also with the wristband attached). Added in W3: `apiSend`
(the write helper, used for POST and PATCH requests that save or update
something, like adding or editing a product). Every screen goes through
this file, so the backend's address is written in exactly one place. It also
turns backend problems into friendly messages ("Invalid email or password", or
"Can't reach the backend").
Its check: `lib/api.test.ts`.

### lib/session.ts  (where the login wristband is read)
A tiny shared helper, added in W1, that knows how to read the saved login
wristband out of the browser's storage pocket. `apiGet` and `downloadCsv` use it
so they can attach the wristband to every request without each screen having to
fish it out itself. One place to read the token means the rule lives in one spot.

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
  bits (no tenant switcher, no "Synced" control; the setup-wizard menu item and
  the notifications bell are "coming soon"). Checked by `Sidebar.test.tsx`.
- `shell/Topbar.tsx` + `Topbar.module.css`: the slim bar across the top of each
  page (the page's title and per-page controls). Checked by `Topbar.test.tsx`.
- `shell/nav.ts`: the plain list of menu items (their names, icons, web
  addresses, and whether each is built yet or still "coming soon"). Keeping the
  menu in one list means the sidebar and the route map agree.

### ui/  (the shared UI kit, added in W1 and extended in W3)
Small reusable building blocks ported from the prototype, so every screen looks
consistent and we are not re-styling a button each time. These are the Lego
bricks the screens are built from.
- `ui/Icon.tsx` + `ui/icons.ts`: the icon drawer (one component that draws any
  named icon, and the list of icon shapes it can draw).
- `ui/Avatar.tsx`, `ui/Chip.tsx`, `ui/Button.tsx`, `ui/Card.tsx`,
  `ui/Segmented.tsx` (a row of buttons where one is selected, like a toggle),
  `ui/Switch.tsx` (an on/off toggle), each with its own `.module.css` look.
- `ui/Spark.tsx` (a tiny inline trend line) and `ui/Bar.tsx` (a simple bar), the
  little charts the dashboard cards use.
- Added in W3: `ui/Modal.tsx` (the pop-up shell used for the add/edit form: a
  darkened backdrop, a centered panel with a title and close button, and a
  scrollable body; closes on the backdrop or the close button); `ui/Field.tsx`
  (a labelled form field wrapper that pairs a label with its input, so the label
  is always correctly wired to what it labels); `ui/Input.tsx` (a text input that
  matches the app's look); `ui/Select.tsx` (a dropdown that also matches the
  look). These four share a `ui/form.module.css` for their styling, and they are
  designed to be reused by every future screen that has a form or a pop-up
  (surveys, payroll, settings, and so on).
- `ui/index.ts`: one tidy front door that re-exports the whole kit, so a screen
  imports all its bricks from one place.
All of the kit is checked together by `ui/ui.test.tsx`.

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
    that shows one response in full. The header shows the rep, store, and a
    verdict badge (percentage and pass/partial/fail/na label). Below that, each
    survey question appears with its answer and a pass/fail result chip. Per-product
    number questions show a color-dot grid: green cell for pass, red cell for fail,
    with the count and a check or X icon. Photo questions show a placeholder.
    Checked by `ResponseDetailModal.test.tsx`.
- `pages/ComingSoon.tsx` + `ComingSoon.module.css`: the friendly placeholder shown
  for the menu items whose screens we have not built yet.
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

The screens here call `lib/api.ts`, which calls the backend in `api/`, which
reads the database whose shape is in `db/`. The colors and fonts come from the
shared `packages/tokens/`. So this folder is purely the "what you see and
click" layer.
