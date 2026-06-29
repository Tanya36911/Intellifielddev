# Shared backend helper (packages/api-client/)

This is the one place the web apps talk to the backend (the waiter). Instead of
each screen figuring out how to send a request, attach the login token, and
handle errors, they all call these small helpers:

- `apiGet` (read something), `apiSend` (create or update something), `apiDelete`
  (remove something), and `downloadCsv` (save a spreadsheet file).
- `login` (sign in and get a token) and `health` (is the backend awake?).
- `ApiError`, a tidy error the screens can show a friendly message for.

Both web apps use this one copy: the Admin app today, and the Manager app next,
so the way they talk to the backend can never drift apart.

The name `@intelli/api-client` is how the apps refer to it:

```ts
import { apiGet, apiSend } from '@intelli/api-client'
```

---

## The login (why the session key is configurable)

The helper needs to attach your login token to each request. The token is kept
in the browser under a named slot in `localStorage`. Because the Admin and the
Manager apps can run on the same web address, they must use **different** slots,
or signing into one could leak into the other.

So each app tells the helper its own slot name once, at startup:

```ts
import { configureSession } from '@intelli/api-client'
configureSession('intelli-admin-session') // Admin; Manager uses its own name
```

After that, `readToken` reads from the right slot, and the apps never share a
login.

---

## The files

### src/api.ts
The helpers above. It is the only code that calls `fetch`; nothing else in the
apps talks to the backend directly.

### src/session.ts
The small token reader plus `configureSession` (set the slot name) and
`getSessionKey` (read it back). Kept separate so `api.ts` can read the token
without pulling in any app's session store.

### src/index.ts
The front desk that hands out everything above from `@intelli/api-client`.

### package.json
The ID card that names this shared piece and points to `src/index.ts`.

---

## How it is built

Plain source code (TypeScript), no separate build step; the web apps compile it
together with their own code (via Vite), the same way `@intelli/tokens` and
`@intelli/ui` work.

---

## In short

One shared, safe way for the web apps to talk to the backend, with each app
keeping its own separate login.
