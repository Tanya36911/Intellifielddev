# Intelli roadmap (revamped 2026-06-18): screens first, so people see results

Read this with [START_HERE.md](START_HERE.md) (how to run it) and
[CONTEXT.md](CONTEXT.md) (what is built). This file is the plan for what we build
next and in what order, rewritten so every step puts something on a screen that
stakeholders can actually look at.

## Why we changed the order

For eight phases we built the engine: login, the org tree, the catalog, surveys,
responses, analytics, payroll, and export, all proven by 169 automated checks.
But the only screen that exists is the login page and a near-empty welcome page.
Leadership and partners read *screens*, not databases, and the thing that sells
Intelli (self-serve configurability) literally *is* the screens: the survey
builder, the catalog, the dashboards. So the plan now is:

1. **Build the Admin web screens first**, over the backend that already exists.
   This is low-risk, high-visibility work: the hard part (the data and the
   security) is done and tested.
2. **Defer the Field mobile app + offline sync (Phase 5)** to after the screens.
   It is the longest, hardest, riskiest stretch in the whole project (months, and
   it needs a second set of expert eyes on the sync logic). Spending months on it
   before anyone has seen a dashboard is the wrong order for what we need now.

Nothing already built is thrown away. The backend (Phases 1 through 4d) and the
one Phase 5 brick we finished (5-BE-a, the idempotency keys) all stay banked and
keep passing their tests. We are changing the order of what comes next, not
redoing anything.

## The two tracks from here

- **Web Screens track (the priority now):** the Admin web app screens, built in
  the order below for the most demo impact. The prototype in `../hi-fi-intelli`
  is the exact visual spec for each one.
- **Field Mobile track (Phase 5, deferred):** the rep's phone app plus offline
  sync. Picks back up after the web screens give us something to show. The
  backend groundwork for it (idempotency keys) is already done.

## The Web Screens sequence (each step is something you can demo)

Every screen goes through the same flow we have used all along: a quick mockup you
approve, then a test-first build, then it is committed. The prototype screen it
ports from is named for each.

**W1: The app shell + a real Home.** The sidebar, the top bar, the brand, and a
Home page that shows your company and a few headline compliance numbers instead
of the empty welcome page. Backend it uses: `/analytics/compliance`, `/nodes`
(both exist). After this: it looks and feels like a real product you log into and
land inside. This is the frame every other screen hangs on, so it goes first.

**W2: The Analytics / Compliance dashboard (the headline screen).** Compliance
percent for each part of the org, drill from a region down to a single store and
the exact product that failed, out-of-stock by product, and a product's shelf
count over time, plus a Download (CSV) button. Backend: `/analytics/compliance`,
`/analytics/compliance/drill`, `/analytics/oos`, `/analytics/trend`,
`/export/compliance` (all exist). After this: the visual proof the platform
works, live numbers and drill-down in front of leadership. Recommended as the
first "wow."

**W3: The Catalog.** Your product list as a list and a gallery, with add and edit.
Backend: `/skus` (exists). After this: a self-managed product catalog, the
foundation surveys point at.

**W4: The Survey builder + assignments (the differentiator).** Build a checklist
(questions, per-product, pass rules), publish it (which freezes that version
forever), and assign it to a part of the org with a deadline. Backend: `/surveys`,
`/survey-assignments`, `/skus` (all exist). After this: self-serve configurability
on screen, the headline selling point. Note: the prototype's "describe it and AI
drafts the survey" is an optional later add (it uses the Claude API and is a
fast-follow); the by-hand builder is the v1 and stands on its own.

**W5: Responses + the response detail.** See what reps submitted, with live
pass/fail and the per-product reason something failed. Backend: `/responses`,
`/responses/{id}` (exist). After this: the field data flowing in and being scored.
(Shelf photos plug in later with 5-BE-c, the photo storage; shown as placeholders
until then.)

**W6: Payroll.** Open a pay period, see logged hours, approve them, seal the
period, and read the audit log, with a Download (CSV) button. Backend:
`/pay-periods`, `/time-entries` (+ approve/reject/seal/reopen), `/audit`,
`/export/payroll` (all exist). After this: the operational payroll flow and the
seal/reopen lock on screen.

**W7: The org hierarchy (view).** The org tree with drill into a store. Backend:
`/nodes` (exists for viewing). After this: the company structure visualized.
Editing the tree on screen needs a small backend addition (see below).

## Small backend bricks to slot in just-in-time

A few screens need a small, quick backend addition first (each one is the same
proven pattern as every backend phase so far, a migration plus a few endpoints
plus tests). We add each only when its screen comes up, so we are never blocked:

- **Users / team screen** needs a list-and-invite endpoint (`GET /users`,
  `POST /users`).
- **Settings screen** (payroll on/off, cutoff) needs a read/update company-config
  endpoint (`GET` / `PATCH /tenants`).
- **Editing the org tree** (add, rename, move a store) needs node add/edit
  endpoints.
- **Shelf photos** in responses need object storage, which is **5-BE-c** in the
  Field track.

## Deliberately later (so nothing is silently dropped)

- **Phase 5: the Field mobile app + offline sync** (the rep's phone app, on-device
  database, the sync engine). The big, hard, last push. 5-BE-a (idempotency keys)
  is done; 5-BE-b (batch sync) and 5-BE-c (photo storage) and the mobile app
  itself (5-M-a through 5-M-d) come after the web screens.
- **The Manager web app.** It reuses most of the same screens and the same backend,
  automatically scoped to a manager's branch (compliance review, survey
  assignment, payroll approval). We stand it up alongside or just after the Admin
  screens; the backend already enforces the scope, so it is mostly screen work.
- **Manager Routes** (route planning) needs a geo/route backend that does not
  exist yet.
- **Announcements / messaging** needs a messages backend that does not exist yet.
- **The AI survey drafting** layer on top of the survey builder (Claude API,
  a fast-follow, never the headline).

## How we will know each step is "done"

Same bar as always: the screen is built test-first, it talks to the real backend
(a manager only ever sees their own branch, enforced by the backend), the
existing automated checks stay green, and there is a live walk-through you can do
in the browser. The difference now is that after each step there is a screen to
show, not just an endpoint to describe.
