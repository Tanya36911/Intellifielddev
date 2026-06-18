# How to check the work, Tanya (how to test me)

You asked a great question: how do you know if the code is wrong, or in the
wrong place, without being able to read it yourself? This is your answer. You
do not check by reading code. You run a few checks and watch the app. Each one
below tells you what it proves, what "good" looks like, and what "bad" looks
like.

Run all commands from the project folder (`cd ~/Documents/intelli-app`).

---

## The 4 checks, easiest first

### Check 1: The test robot (catches broken behavior)
A "test" is a tiny robot that uses the app the way a person would and shouts if
something misbehaves. We have 27 of them for the Admin app.

Run:
```
pnpm test:admin
```
- GOOD looks like: `Tests  27 passed (27)` near the bottom, all green ticks.
- BAD looks like: any red `FAIL`, or a number in `failed`. The red text names
  the file and what it expected. You do not need to fix it; copy it to me.

What it proves: the important behaviors still work, for example "a wrong
password is refused", "a good login reaches the welcome page", "sign out really
forgets you". If I ever break one of these by accident, this robot goes red.

The backend now has its own robot too. With the backend running, run
`pnpm test:api` (or `docker compose exec api pytest -q`). GOOD looks like all
tests passing, including the isolation checks that prove one company cannot see
another company's data and a manager cannot see a sibling region. As of Phase 3a
these also cover the product catalog: one company cannot see another's products,
and only admins can add or edit products. As of Phase 3b they also cover surveys:
only admins can build a survey, a published version can never be edited (editing
makes a new version), a manager can assign a survey only inside their own branch,
and "which stores does this cover" is computed from the org tree. If any go red,
copy the text to me.

### Check 2: The build (catches typos and broken wiring)
This assembles the app for real. If any piece is mistyped or points at
something that does not exist, it stops with an error.

Run:
```
pnpm build:admin
```
- GOOD looks like: it ends with `built in ...` and no red error lines.
- BAD looks like: a red error mentioning a file and line. Copy it to me.

What it proves: the code is wired together correctly with no obvious mistakes.

### Check 3: Use the app yourself (the human check)
The robot checks behavior, but only YOU can judge if it looks and feels right.

1. Make sure the backend is on: `docker compose up -d`
2. Start the screens: `pnpm dev:admin`, then open the address it prints
   (usually http://localhost:5173).
3. Click around: try a wrong password (should show a polite red message), then
   the real demo login (`dana@lumenbeauty.com` / `demo1234`), then Sign out.

What it proves: it actually works end to end, and it looks the way you want. If
anything looks off, that is real feedback. Tell me.

### Check 4: Ask the backend directly (proves the "waiter" is honest)
The backend builds its own clickable test page.

1. With the backend running, open http://localhost:8000/docs
2. Open `POST /auth/login`, click "Try it out", type the demo email and
   password, click Execute.
- GOOD: a green `200` and a token comes back. Try a wrong password: you should
  get a `401` and "Invalid email or password".

What it proves: the backend accepts the right password and refuses wrong ones,
with no frontend involved at all.

### Check 5: Walk a survey through its life (Phase 3b, at /docs)
This proves the surveys engine by hand, no coding. At http://localhost:8000/docs,
first log in: open `POST /auth/login`, "Try it out", use `dana@lumenbeauty.com` /
`demo1234`, Execute, and copy the `token` from the response. Click the green
**Authorize** button at the top right, paste the token, Authorize. Now every
"Try it out" below runs as Dana.

1. `GET /surveys` -> you see "Velvet Lip Shelf Check". GOOD: Acme's "Glow Serum
   Check" is NOT in the list (companies stay separate).
2. `POST /surveys` with a name and a question or two -> GOOD: it comes back with
   `status: draft` and a version 1 whose `published_at` is empty.
3. `POST /surveys/{id}/publish` (use the id from step 2) -> GOOD: `status` is now
   `published` and the version has a `published_at` time.
4. `PATCH /surveys/{id}/versions/{vid}` on that now-published version -> GOOD: it
   is REFUSED with a `409` ("published and cannot be edited"). That is the
   freeze working.
5. `POST /survey-assignments` pointing the published version at a node, then
   `GET /survey-assignments/{id}/stores` -> GOOD: it lists the stores under that
   node. Assigning to a region returns that region's stores only.

What it proves: surveys freeze when published, editing makes a new version, and
assignment coverage is computed from the tree.

### Check 6: Submit and score a response (Phase 4a, at /docs)
This proves that reps' answers are stored and scored correctly, with no coding.
At http://localhost:8000/docs, log in first: open `POST /auth/login`, click
"Try it out", enter email `marcus@lumenbeauty.com` and password `demo1234`,
click Execute. Copy the `token` value from the response. Click the green
**Authorize** button at the top right, paste the token, click Authorize. Now
every "Try it out" below runs as Marcus.

1. `POST /responses` - fill in the store id for the SF store, the id of
   Lumen's published "Velvet Lip Shelf Check" version, and one or two answers.
   - GOOD: you get a `201` response with an `id` and an `overall` field showing
     pass or fail, and each answer has its own `pass` field.
   - BAD: a `400` means an answer shape is wrong; a `403` means you picked a
     store outside Marcus's branch.
2. `GET /responses/{id}` with the id from step 1.
   - GOOD: the full response comes back with `overall` and per-item `pass`
     fields. The scores are computed fresh from the survey's rules, not saved.
3. To confirm branch isolation: log out and log in as `avery@acme.com` /
   `demo1234` (an Acme admin). Try `GET /responses/{id}` using the Lumen
   response id from step 2.
   - GOOD: you get a `404` (Acme cannot read Lumen's responses).

To confirm the automated gate: run `pnpm test:api` (backend must be running).
GOOD looks like `91 passed` at the bottom. If anything goes red, copy the text
to me.

What it proves: reps' answers are stored atomically, scoped to their branch,
scored live from the survey's rules, and never visible across companies.

### Check 7: Read the analytics reports (Phase 4b, at /docs)
This proves that the compliance, out-of-stock, and trend reports are working and
branch-scoped. At http://localhost:8000/docs, log in as Dana (admin, sees all
of Lumen): open `POST /auth/login`, click "Try it out", enter
`dana@lumenbeauty.com` and `demo1234`, click Execute. Copy the `token` value,
click the green **Authorize** button at the top right, paste the token, click
Authorize. Now every "Try it out" below runs as Dana.

1. `GET /analytics/compliance` with no filters.
   - GOOD: you see one or more rows, each with a survey name, an `expected`
     store count, a `responded` count, a `completion_pct`, a `scored` count,
     and a `pass_pct`. These numbers are worked out fresh each time; no stored
     scores exist in the database.
2. `GET /analytics/oos` with `survey_version_id` set to the Lumen "Velvet Lip
   Shelf Check" published version id (you can find this from `GET /surveys`)
   and `question_id` set to `q1`.
   - GOOD: Oakland's Rosewood shade shows as out of stock (count of 0).
3. `GET /analytics/compliance/drill` with a `node_id` set to a region's id
   (find a node id from `GET /nodes`).
   - GOOD: you see rows for that region's districts or stores, with their own
     completion % and pass % numbers.
4. `GET /analytics/compliance/drill` again, this time with a store's `node_id`.
   - GOOD: you see the per-product reason each question failed for that store
     (the "why it failed" view).

To confirm the automated gate: run `pnpm test:api` (backend must be running).
GOOD looks like `111 passed` at the bottom. If anything goes red, copy the
text to me.

What it proves: the response rows correctly power live compliance, out-of-stock,
and trend reports; a manager only sees their own branch; and no report scores
are ever stored in the database.

### Check 8: Walk through payroll (Phase 4c, at /docs)
This proves the payroll engine by hand, with no coding. At
http://localhost:8000/docs, log in as Dana (admin): open `POST /auth/login`,
click "Try it out", enter `dana@lumenbeauty.com` / `demo1234`, click Execute.
Copy the `token` from the response. Click the green **Authorize** button at the
top right, paste the token, click Authorize.

1. `POST /pay-periods` with a start date, end date, and cutoff date.
   - GOOD: a `201` comes back with the new period's id and a status of `open`.
2. Log in as Marcus (a rep) and log hours. Open `POST /auth/login` again,
   use `marcus@lumenbeauty.com` / `demo1234`, authorize.
   `POST /time-entries` with the period id, a store id in Marcus's branch, and
   some minutes/miles.
   - GOOD: a `201` with an entry that has `locked: false` and approval `pending`.
3. Back as Dana: `POST /pay-periods/{id}/seal` (use the period id from step 1).
   - GOOD: a `200` and the period now shows `status: sealed`.
4. Try to edit the entry now: `PATCH /time-entries/{entry_id}` with new values.
   - GOOD: it is REFUSED with a `409`. That is the lock working.
5. Try to approve the entry: `POST /time-entries/{entry_id}/approve`.
   - GOOD: REFUSED with a `409`. Sealed entries cannot be re-approved either.
6. `POST /pay-periods/{id}/reopen` with the rep's user id and a reason (like
   "Miles were entered wrong").
   - GOOD: a `200`. The entry for that rep now has `locked: false` again.
7. `PATCH /time-entries/{entry_id}` with the corrected miles.
   - GOOD: the edit succeeds now.
8. `POST /pay-periods/{id}/seal` again to lock it back up.
9. `GET /audit` to read the logbook.
   - GOOD: you see the reopen action recorded, with the reason you gave, who
     did it, and when.

To confirm the payroll gate is refused for a company with payroll off: log in
as `avery@acme.com` / `demo1234` (Acme has payroll switched off). Try
`GET /pay-periods`. GOOD: refused with a `403`.

To confirm the automated gate: run `pnpm test:api` (backend must be running).
GOOD looks like `132 passed` at the bottom. If anything goes red, copy the
text to me.

What it proves: a sealed period locks all entries against edits and re-approvals,
a reopen frees exactly one rep's hours and writes a permanent logbook entry,
and a company with payroll switched off is turned away at the door.

### Check 9: Pull the data out (Phase 4d export, at /docs)
This proves you can get the field data out of the app as a spreadsheet or as
plain data, with no coding. At http://localhost:8000/docs, log in as Dana
(admin, sees all of Lumen): open `POST /auth/login`, click "Try it out", enter
`dana@lumenbeauty.com` / `demo1234`, click Execute. Copy the `token` from the
response, click the green **Authorize** button at the top right, paste the
token, click Authorize.

1. `GET /export/responses` with no filters and the default `format` (which is
   `json`).
   - GOOD: you get back `{ "rows": [...], "count": N }`, one row per stored
     survey answer in your branch, each with a pass/fail verdict.
2. `GET /export/responses` again, this time set `format` to `csv`.
   - GOOD: the page offers you a file to download (a spreadsheet, called a CSV).
     It is the exact same rows as step 1, just as a file you can open in Excel
     or Google Sheets. `format=csv` gives the download, `format=json` gives the
     data on screen, and both always carry the same columns in the same order.
3. To see that a manager only ever gets their own branch: log out and log in as
   `sarah@lumenbeauty.com` / `demo1234` (a manager pinned to the Central
   region), authorize, then `GET /export/responses` again.
   - GOOD: Sarah's export only shows stores in her own branch, never a sibling
     region's stores and never another company's.

You can do the same with `GET /export/payroll` (the logged hours) and
`GET /export/compliance` (the headline completion and pass numbers).

To confirm the automated gate: run `pnpm test:api` (backend must be running).
GOOD looks like `160 passed` at the bottom. If anything goes red, copy the text
to me.

What it proves: the same field data can be pulled out as a CSV file or as JSON
from one address, the two always match, and the export stays inside the caller's
own branch.

---

## "Is the code in the wrong place?"

Tests and builds catch broken behavior, but not "should this file be over
here?". For that, use these:

- **The guides.** [CODEBASE_MAP.md](CODEBASE_MAP.md) and each folder's
  `README.md` say where things are supposed to live and why. If you find a file
  whose job does not match the README it sits next to, that is worth asking me
  about.
- **The reviewers.** While building, I have separate fresh checkers read the
  work: one confirms it does exactly what was agreed (nothing missing, nothing
  extra), another checks it is well-built and each file has one clear job in the
  right place. That is how the Node 26 test problem got caught and fixed.
- **You approve the plan first.** Before I build, you see a design (you saw the
  login screen as a mockup and approved it). If a plan does not match what you
  want, you stop it before any code is written.

---

## What these checks DO and DO NOT catch (being honest)

They DO catch: broken behavior, typos, things that stop working, a password
check that lets the wrong people in, a screen that crashes.

They DO NOT catch on their own: whether it is the RIGHT feature to build, or
whether it matches your taste. That is what the design approval, your own
click-through, and your team are for. I can be wrong, so the safety net is the
layers above plus the fact that every change is a separate git save you can
undo (see below).

---

## Your ultimate safety net: undo

Every change I make is saved to git as its own labeled step (run `git log
--oneline` to see them). Nothing is ever truly lost. If a change turns out
wrong, it can be undone on its own without disturbing the rest. You do not have
to get this right in the moment; it is all reversible.

---

## How to tell me something is wrong

You do not need the right words. Any of these is perfect:
- "Check 1 went red, here is what it said: [paste]"
- "The login screen looks weird, the button is in the wrong spot"
- "This file says X in its README but seems to do Y"

I will take it from there.
