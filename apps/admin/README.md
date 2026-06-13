# The ADMIN FRONTEND, explained for a non-coder (apps/admin/)

This is the "dining room" for brand HQ: the screens you see and click in a web
browser. It is built with **React** (a tool for making web screens) and
**Vite** (a tool that builds and serves those screens fast). It talks to the
backend waiter; it never touches the database directly.

So far it has a working **login screen** and a small **welcome page**. More
Admin screens get added on top in later phases.

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
The very first bit of frontend code that runs. It wraps the whole app in three
things every screen needs: the session pocket (who is signed in), the
page-switcher (web addresses), and the brand styles. Then it puts the app on
the page.

### App.tsx  (the route map and doorman)
Decides which screen shows for which web address. `/login` shows the login
screen; `/` shows the welcome page. The "doorman" rule lives here: if you are
not signed in and try to open `/`, it sends you to `/login`; if you are already
signed in and open `/login`, it sends you to `/`.

### index.css  (the baseline look)
A few global style rules: the background color, the body font, and pointing
headings at the heading font. The detailed look of each screen lives in that
screen's own style file (below).

### lib/api.ts  (the one phone line to the backend)
The ONLY file that talks to the backend waiter. It knows the backend's address
and offers two calls: `login` (send email + password, get a wristband back) and
`health` (is the backend awake?). Every screen goes through this file, so the
backend's address is written in exactly one place. It also turns backend
problems into friendly messages ("Invalid email or password", or "Can't reach
the backend").
Its check: `lib/api.test.ts`.

### store/  (the session pocket: who is signed in)
"Store" is the agreed shared memory for the whole app. We use a tool called
Redux Toolkit for it.
- `store/auth.ts`: holds the wristband and the signed-in person's name and
  role. It copies them into the browser's small storage pocket so you stay
  signed in for up to 12 hours even after closing the browser, and it throws
  away an expired wristband when the app starts. Checked by `store/auth.test.ts`.
- `store/index.ts`: wires the pocket together and gives screens a tidy way to
  read from it.

### pages/  (the actual screens)
- `pages/Login.tsx` + `Login.module.css`: the login screen and its looks. The
  form-checker (catching a bad email or empty password before sending) and the
  friendly error messages live here. Checked by `Login.test.tsx`.
- `pages/Home.tsx` + `Home.module.css`: the welcome page after signing in
  (your name, your role, the green "backend is awake" dot, and Sign out).
  Checked by `Home.test.tsx`.
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
