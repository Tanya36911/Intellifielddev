# Showing your supervisors what you have built (meeting guide)

A plain-English guide for a 5 to 10 minute progress demo. First the words to
say, then the things to show, then answers for likely questions.

Before the meeting, make sure things are running (see START_HERE.md):
`docker compose up -d` (backend + database) and `pnpm dev:admin` (the screen).

---

## 1. The one-sentence summary

"We have a working, secure foundation for the real Intelli product: people can
log in, the system keeps every brand's data separate and shows each person only
what they are allowed to see, and the product catalog is in. It is built and
tested properly, one approved step at a time."

## 2. What to TELL them (four talking points)

1. **The foundation is real and working.** This is no longer a clickable mockup.
   There is a real backend, a real database, a real login, and the first
   screens. Three phases are complete.

2. **We built the hardest, most important part first: security.** Intelli is
   meant to host many brands at once (Revlon and others) in one system. The rule
   that keeps each brand's data private, and shows each person only their own
   slice (a regional manager sees only their region, a rep only their stores),
   is built and proven. This is the foundation everything else sits on, so we
   did it first and we did it carefully.

3. **It is built properly, not rushed.** Every feature is designed and approved
   in plain English before any code, built test-first, saved in small reversible
   steps, and documented so the team can follow it. We also already acted on the
   backend team's security review (secrets, time zones, safe database scripts).

4. **We know exactly what is next.** Login and accounts (done), the company org
   structure and the security boundary (done), the product catalog (done). Next
   is surveys (the checks reps run in stores), then reporting, then the mobile
   field app, with the AI shelf-photo feature as a planned fast-follow.

## 3. What to SHOW them (in order of impact)

### Show 1: It is a real app (the login screen)
Open **http://localhost:5173** in a browser. Sign in with
`dana@lumenbeauty.com` / `demo1234`. You land on the welcome page.
Say: "This is the real Admin app. Logging in is real and secure; the password is
never stored in a readable form."

### Show 2: The security boundary, live (the highlight)
In Terminal, from the project folder, run:
```
bash scripts/demo.sh
```
It prints, for four different people, exactly what each is allowed to see.
Point at the result and say: "Dana, the HQ admin, sees all 8 parts of her
company. Sarah, a regional manager, sees only her 3. Marcus, a rep, sees only
his stores. And Avery, who belongs to a different company, sees none of the
first company's data. That separation is what makes Intelli safe to sell to many
brands at once."

### Show 3: Proof that it actually works (the tests)
In Terminal run:
```
pnpm test:api
```
Say: "Every important behavior is checked automatically. These 32 checks include
the ones that prove one company can never see another's data and that only
admins can change the catalog. They run any time and must pass before we build
anything new." (You can also run `pnpm test:admin` for the 27 screen checks.)

### Optional Show 4: The official API view (for a technical supervisor)
Open **http://localhost:8000/docs**. This is the backend's own interactive list
of everything it can do (login, the org tree, the product catalog). It updates
itself automatically as we build.

## 4. If they ask (quick answers)

- **"Can one client see another client's data?"** No. The rule is enforced in
  one central place in the backend and proven by automated tests: a different
  company gets zero rows. Before any real customer data goes in, we also switch
  the security keys to fresh production secrets, which is already planned.

- **"How do you know it works?"** 59 automated checks (32 backend, 27 screen)
  run on demand and must pass, plus we test the live app by hand.

- **"How was this built so quickly?"** With AI assistance (Claude Code) under
  direction, with every feature designed and approved before it was built, and
  every step saved so anything can be undone.

- **"What is left?"** Surveys next, then reporting and payroll, then the mobile
  field app, then the AI shelf-photo feature as a fast-follow (never the
  headline; the differentiator is the configurability and the security you just
  saw).

## 5. The honest framing (so you are never overstating)

What is done: the backend foundation (accounts, the security boundary, the
product catalog) and the Admin login screen. What is not done yet: most of the
visible Admin screens, and the manager and field apps. That is expected; we
built the secure foundation first on purpose, because it is the part that is
expensive to get wrong.
