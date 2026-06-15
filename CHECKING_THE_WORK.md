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
another company's data and a manager cannot see a sibling region. If any go red,
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
