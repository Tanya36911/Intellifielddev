# Admin login screen, design (approved 2026-06-12)

Approved by Tanya on 2026-06-12 after a visual mockup review. This finishes
Phase 1: the backend login check already works; this adds the screen people
actually use, plus the first permanent frontend rails.

## Goal

A person opens the Admin web app, signs in with email + password, and lands on
a small welcome page. Wrong credentials are rejected politely. The signed-in
state survives closing the browser for up to 12 hours. Sign out works.

## Decisions made (with Tanya, 2026-06-12)

1. Stay signed in up to 12 hours. The token from the backend is kept in the
   browser's local storage, so closing the browser does not sign you out. The
   token itself carries its expiry time; on app start an expired token is
   discarded and you land at the login screen.
2. Show a development-only hint on the login screen with the demo credentials
   (dana@lumenbeauty.com / demo1234), visually marked DEV. Remove it before
   any real user sees the screen.
3. "Lay the rails" approach: install only the locked-stack pieces this screen
   needs and that every later screen reuses. Defer TanStack Query (the
   data-fetching library) until Phase 2-3 when screens actually fetch data.

## What gets installed (all from the locked tech stack)

- React Router v7: real page addresses (/login and /), plus a guard that
  bounces visitors without a valid token to /login.
- react-hook-form + zod: form handling and validation (bad email shape or
  empty password is caught before anything is sent).
- Redux Toolkit + react-redux: the shared session pocket. One small "auth"
  slice holds the token and the signed-in user's name and role, mirrored to
  localStorage under one key.
- The two brand fonts (Space Grotesk for headings, Hanken Grotesk for body)
  plus JetBrains Mono, loaded via Google Fonts links in index.html for now;
  self-hosting comes with production hardening, per TECH_STACK.txt.

## The screens

### /login
Centered white card on the gray background, styled entirely from the shared
tokens: Intelli wordmark + "Admin" badge, email box, password box, blue
"Sign in" button (full width), and the dashed DEV hint box underneath with the
demo credentials in mono type. Mockup approved as drawn.

States:
- Checking: button reads "Signing in..." and is disabled (no double submit).
- Wrong credentials (backend says 401): red box above the form with the
  backend's exact words, "Invalid email or password". Typed values stay.
- Backend unreachable: the red box instead says "Can't reach the backend.
  Is it running? (docker compose up -d)".
- Local validation errors appear as small red notes under the relevant box.

### / (home, protected)
Placeholder card until the real dashboard exists: "Phase 1" chip,
"Welcome, {name}" heading, a line naming the role, the green API status dot
(carried over from Phase 0), and a "Sign out" button. Sign out clears the
session pocket and localStorage and returns to /login.

Routing rules: visiting / without a valid token redirects to /login; visiting
/login while already signed in redirects to /.

## How it talks to the backend

POST http://localhost:8000/auth/login with { email, password }.
Success: { token, user: { name, role } }. Failure: 401 with
{ detail: "Invalid email or password" }. One small api helper module owns the
base URL and the fetch call; screens never call fetch directly.

## File plan (apps/admin/src)

- lib/api.ts: base URL + the login request helper.
- store/auth.ts: the auth slice (token, user, expiry handling) + localStorage
  mirror; store/index.ts: the Redux store.
- pages/Login.tsx + Login.module.css: the login screen.
- pages/Home.tsx + Home.module.css: the welcome placeholder (absorbs the
  Phase 0 health-check card).
- routes: App.tsx becomes the route map with the auth guard.
- main.tsx: wraps the app in the Redux provider and the router.

## Testing (new, reused forever)

Vitest + React Testing Library (the locked stack's web test tools), with a
handful of meaningful checks:
- wrong password shows "Invalid email or password",
- good login stores the token and lands on the welcome page,
- visiting / without a token bounces to /login,
- sign out forgets the session,
- an expired token is treated as signed out.
Plus a live end-to-end walkthrough with the real backend before calling it
done.

## Deliberately out of scope

- Forgot password (no backend reset endpoint yet; no dead-end buttons).
- Remember-me checkbox (12-hour behavior is the default).
- Dark mode (tokens are light-only today).
- TanStack Query and the generated API client (arrive with the first real
  data screens).
