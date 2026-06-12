# START HERE, Tanya

This is your plain-English guide to the Intelli production app. It assumes you
know nothing about backend code, and it explains every tool and step. When you
open a brand-new chat, read this file first (and tell the assistant to, too).

---

## 1. What we've built so far (in plain points)

**Phase 0 - the skeleton (done):**
- A fresh project folder (`intelli-app`) set up to hold all three real apps.
- A **database** is running (Postgres). Think of it as the app's permanent memory.
- A **backend** is running (FastAPI). Think of it as a waiter: the apps ask it
  for things, and it is the only one allowed to talk to the database.
- A **blank Admin web page** that opens in your browser and shows a green dot
  meaning "the web page successfully talked to the backend."
- Your prototype's colors, fonts, and spacing were copied into one shared place
  so every app looks consistent.

**Phase 1 - login, the backend half (done):**
- Two real database tables: **tenants** (a company, e.g. Lumen Beauty) and
  **users** (people who log in, each tied to one company).
- **Passwords are stored safely** as a scrambled one-way code (called a "hash"),
  never as the real password. Even if someone stole the database, they can't read passwords.
- A **login check**: send an email + password, get back a "token" (a digital
  wristband that proves who you are) if correct, or a rejection if wrong.
- A **demo login** to test with:  email `dana@lumenbeauty.com`  password `demo1234`

**What's NEXT:** the login *screen* (the actual form you type your email and
password into), then the rest of the Admin app screens.

---

## 2. The tools you'll use (what each one is for)

| Tool | What it is, in plain terms | When you use it |
|------|----------------------------|-----------------|
| **Terminal** | A text box where you type commands to the computer. | To start/stop the app. |
| **OrbStack** | The program that runs the database + backend "boxes." Must be OPEN. | Leave it running in the background. |
| **Browser** (Chrome/Safari) | Where you see the app and test the backend. | To look at your work. |
| **VS Code / Cursor** | Where you read and edit the code files. | To see the code. |
| **Claude Code** (me) | I write and explain the code with you. | To build features. |

You don't need to memorize commands - section 4 is your copy-paste cheat sheet.

---

## 3. How to turn everything on (do this each time you start working)

1. **Open OrbStack** (from Applications or Spotlight). Wait until it's running.
   This powers the database + backend.
2. **Open Terminal** and go to the project folder:
   ```
   cd ~/Documents/intelli-app
   ```
3. **Start the backend + database:**
   ```
   docker compose up -d
   ```
   (The `-d` means "run in the background.")
4. **Check it's alive** - open these in your browser:
   - http://localhost:8000/health  -> should say `{"status":"ok"}`
   - http://localhost:8000/docs    -> the backend's interactive menu (you can
     test login right here: open `POST /auth/login`, click "Try it out", enter
     the demo email/password, and hit Execute).
5. **Start the web app** (only when you want to see the Admin screens):
   ```
   pnpm dev:admin
   ```
   Then open http://localhost:5173

**To stop for the day:** `docker compose down` (the database remembers its data
for next time).

---

## 4. Command cheat sheet (copy-paste, run from `~/Documents/intelli-app`)

| I want to... | Type this |
|--------------|-----------|
| Start backend + database | `docker compose up -d` |
| Stop backend + database | `docker compose down` |
| See the Admin web app | `pnpm dev:admin` (then open http://localhost:5173) |
| Apply new database changes | `docker compose run --rm migrate up` |
| Re-create the demo user | `docker compose exec api python -m app.seed` |
| Rebuild backend after code changes | `docker compose up -d --build api` |
| See what changed in git | `git status` |

---

## 5. File structure (kept up to date)

```
intelli-app/
├── START_HERE.md        <- THIS FILE (your plain-English guide)
├── CONTEXT.md           Short context + progress log (for a new AI chat)
├── README.md            Quick technical readme
├── docker-compose.yml   Recipe that runs the backend + database together
├── package.json         Project ID card + command shortcuts
│
├── api/                 THE BACKEND (Python). The "waiter" that talks to the DB.
│   ├── Dockerfile       Recipe to build the backend's box
│   ├── pyproject.toml   List of backend libraries it needs
│   └── app/
│       ├── main.py      Starts the backend; lists its web addresses
│       ├── db.py        Connects to the database
│       ├── security.py  Password scrambling (hash) + login wristbands (tokens)
│       ├── auth.py      The /auth/login check
│       └── seed.py      Creates the demo company + user
│
├── db/
│   ├── migrations/      Database change files (each adds/changes tables)
│   └── schema.sql       Auto-generated snapshot of the current DB shape
│
├── packages/
│   └── tokens/          Shared colors/fonts/spacing (one source for all apps)
│
└── apps/
    ├── admin/           ADMIN web app (React). The only app started so far.
    │   └── src/         The screens live here (currently a blank starter page)
    ├── manager/         MANAGER web app  (not created yet)
    └── field/           FIELD mobile app (not created yet)
```

---

## 6. How to resume in a NEW chat (the important part)

When you start a new session, **open Claude Code with the `intelli-app` folder**
(not the prototype folder), and paste this as your first message:

> Read START_HERE.md and CONTEXT.md in this repo first, then TECH_STACK.txt and
> Intelli_Complete_Handoff.md in the sibling ../hi-fi-intelli repo. We just
> finished Phase 1 backend (login works on the API). The next task is the Admin
> login screen. My name is Tanya - always address me as Tanya, explain
> everything in plain non-coder terms, commit to git after each change, no em
> dashes, and keep START_HERE.md's progress + file structure updated.

That paragraph hands the new chat: where the docs are, what's done, what's next,
and how you like to work. With it plus these files, a fresh chat picks up right
where we left off.

---

## 7. Where we are right now
- Backend login: DONE and tested.
- Login screen (frontend): NEXT.
- Everything is committed to git, so any step can be undone.
