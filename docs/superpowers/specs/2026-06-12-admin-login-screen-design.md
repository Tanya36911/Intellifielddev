# The Admin login screen: the written-down plan (approved 2026-06-12)

This file is the design Tanya approved on 2026-06-12, after seeing a picture
mockup of the screens in her browser. We write it down so a brand-new chat (or
a new teammate) can read exactly what was agreed without guessing.

Where this fits: the backend half of logging in already works (the part that
checks your password and hands out the digital wristband). This task builds
the half you can see: the page with the email and password boxes. When it's
done, Phase 1 is finished.

## The goal, in one paragraph

You open the Admin web app. If the app doesn't know who you are, it shows the
login page. You type your email and password and press Sign in. If they're
right, you land on a small welcome page with your name on it. If they're
wrong, you get a polite red message and can try again. Once you're in, you
stay signed in for up to 12 hours, even if you close the browser. There's a
Sign out button when you want to leave on purpose.

## The decisions Tanya made (2026-06-12)

1. **Stay signed in up to 12 hours.** The wristband (the token the backend
   hands out at login) is kept in the browser's small storage pocket, the
   one that survives closing the browser. The wristband has its expiry time
   written inside it. When the app starts, it checks that time; a stale
   wristband is thrown away and you simply see the login page again.
2. **Show a helper note with the demo login.** While we build, the login page
   carries a small dashed box marked DEV with the practice account
   (dana@lumenbeauty.com / demo1234), so Tanya never has to dig for it. It
   gets removed before any real user ever sees this page.
3. **Lay the rails.** While building this one screen, we also install the few
   permanent tools every later screen will reuse (listed below). We chose NOT
   to install everything at once: one tool on the list (a data-fetching
   helper called TanStack Query) only earns its keep when screens start
   pulling lists of data from the backend, so it waits for Phase 2-3.

## New tools being installed (and what each one is, in plain words)

All four were already chosen in the tech decisions file (TECH_STACK.txt);
nothing here is a new pick.

- **React Router**: the page-switcher. It gives each screen its own web
  address (the login page lives at /login, the home page at /), and it works
  as the doorman: if you try to open a page without a valid wristband, it
  walks you back to the login page.
- **react-hook-form + zod**: the form-checker. It watches what you type and
  catches obvious mistakes (an email that isn't shaped like an email, an
  empty password) before anything is sent, showing a small red note under
  the box instead.
- **Redux Toolkit**: the shared session pocket. One agreed place where the
  app keeps "who is signed in right now", so every screen we build later can
  simply look there instead of each keeping its own copy.
- **The brand fonts**: Space Grotesk (headings), Hanken Grotesk (everything
  else), and JetBrains Mono (for code-looking text like the demo login).
  Today the app falls back to plain system lettering; this wires in the real
  ones, fetched from Google Fonts for now (we host the font files ourselves
  later, when we harden things for production).

## The screens, exactly as approved in the mockup

### The login page (web address: /login)
A white card centered on the soft gray background, built from the shared
colors and spacing we copied out of the prototype. On the card, top to
bottom: the Intelli name with a small "Admin" badge, a line that says
"Sign in to manage your workspace.", an Email box, a Password box, a blue
full-width "Sign in" button, and the dashed DEV box with the demo login.

How it behaves:
- While the backend is checking, the button says "Signing in..." and ignores
  extra clicks, so you can't accidentally send it twice.
- Wrong email or password: a red box appears above the form with the
  backend's exact words, "Invalid email or password". What you typed stays
  put so you can fix it.
- Backend not running at all (for example Docker is off): the red box
  instead says "Can't reach the backend. Is it running? (docker compose
  up -d)". Different problem, different message, so you always know which
  one you have.
- Typing mistakes (not-an-email, empty password) get a small red note under
  the box they belong to, before anything is sent.

### The home page (web address: /, only for signed-in people)
A placeholder that the real dashboard will replace in a later phase: a
"Phase 1" chip, "Welcome, Dana" (whatever name the backend returned), a line
saying your role (admin), the familiar green dot showing the backend is
reachable, and a "Sign out" button. Sign out empties the session pocket and
the browser's storage pocket and takes you back to the login page.

The doorman's two rules: no valid wristband means / sends you to /login;
already signed in means /login sends you straight to /.

## How the screen talks to the backend

It sends the email and password to the backend's login door
(POST /auth/login at http://localhost:8000; POST simply means "send
information in", as opposed to asking for information out). A correct pair
comes back as { token, user: { name, role } }: the wristband plus your name
and role. A wrong pair comes back as a 401 ("not allowed") with the message
"Invalid email or password". One small helper file owns this conversation;
screens never talk to the backend directly. That keeps the backend's address
written in exactly one place.

## The new files (where things will live in apps/admin/src)

- lib/api.ts: the one helper that talks to the backend.
- store/auth.ts and store/index.ts: the session pocket (Redux Toolkit), plus
  the mirroring into the browser's storage pocket.
- pages/Login.tsx and Login.module.css: the login page and its looks.
- pages/Home.tsx and Home.module.css: the welcome page and its looks (it
  absorbs the Phase 0 green-dot card).
- App.tsx: becomes the route map (which address shows which page) plus the
  doorman rule.
- main.tsx: the app's front door; it gets wrapped so every screen can reach
  the session pocket and the page-switcher.

## How we prove it works

Two layers.

1. **Automated checks** (using Vitest + React Testing Library, the testing
   tools our tech decisions file picked; think of them as a robot that
   clicks through the screen and complains if anything is off). The robot
   checks: a wrong password shows "Invalid email or password"; a good login
   stores the wristband and lands on the welcome page; opening / without a
   wristband bounces to /login; Sign out really forgets everything; an
   expired wristband counts as signed out.
2. **A live walkthrough**: start the backend and the web app for real, log
   in as Dana, see the welcome page, sign out. Tanya can repeat it with two
   commands from START_HERE.md.

## Deliberately NOT in this round (so nothing is silently missing)

- No "Forgot password" link: the backend has no password-reset door yet, and
  a button that goes nowhere breaks the no-dead-ends rule.
- No "Remember me" checkbox: the 12-hour behavior Tanya chose is simply the
  default.
- No dark mode: the shared colors file is light-only today.
- No TanStack Query (the data-fetching helper): arrives with the first
  screens that actually fetch data, in Phase 2-3.
