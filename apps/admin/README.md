# The ADMIN FRONTEND, explained for a non-coder (apps/admin/)

This is the "dining room" for brand HQ: the screens you see and click in a web
browser. It is built with **React** (a tool for making web screens) and
**Vite** (a tool that builds and serves those screens fast). It talks to the
backend waiter; it never touches the database directly.

So far it has a working **login screen**, the **app shell** (the persistent left
sidebar and a per-page top bar that frame every screen), a small shared **UI kit**
(reusable building blocks like buttons and cards), and its first real screen, the
**Analytics dashboard**. The old welcome page (`Home`) has been replaced by the
dashboard at the `/` address. More Admin screens get added on top in later steps.

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
to your computer, also with the wristband attached). Every screen goes through
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

### ui/  (the shared UI kit, added in W1)
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
  - `ComplianceList.tsx`: the list of how compliant each part of the org is, which
    you click to drill from a region down to a single store and the exact product
    that failed.
  - `AiPreview.tsx`: the AI gap list, clearly badged "preview" (it is a glimpse of
    a later feature, not live yet).
  - `useDashboard.ts`: the "hook" that actually fetches the dashboard numbers from
    the backend's `/analytics/dashboard` address (via `apiGet`) and hands them to
    the screen. Keeping the data-fetching in its own file keeps the screen file
    about layout. Checked by `useDashboard.test.ts`.
  (Each `.tsx` above has a matching `.module.css` for its look.)
- `pages/ComingSoon.tsx` + `ComingSoon.module.css`: the friendly placeholder shown
  for the menu items whose screens we have not built yet.
A `.module.css` file is styling that applies ONLY to its own screen, so two
screens can use the same names without clashing.

### test/  (shared testing helpers)
- `test/setup.ts`: prepares the test robot before each run (tidies up between
  checks).
- `test/fixtures.ts`: small fake data the checks reuse, like a pretend
  wristband and a pretend user named Dana.
- `App.test.tsx`: the big end-to-end check that walks through the whole journey
  (land on login, wrong password shows an error, good login reaches the welcome
  page, sign out returns to login).

---

## How it connects to everything else

The screens here call `lib/api.ts`, which calls the backend in `api/`, which
reads the database whose shape is in `db/`. The colors and fonts come from the
shared `packages/tokens/`. So this folder is purely the "what you see and
click" layer.
