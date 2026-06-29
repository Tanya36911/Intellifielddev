# Shared web UI kit (packages/ui/)

This is the box of small building blocks the web screens are made from: buttons,
cards, chips, pop-ups (modals), form fields, inputs, dropdowns, the icon
renderer, avatars, the on/off switch, the segmented toggle, and the tiny
sparkline and bar charts. They were ported from the finished prototype so the
real app matches the demo.

Both web apps use this one copy: the Admin app today, and the Manager app next.
That means a button looks and behaves the same in both, and a fix happens in one
place instead of two. (The Field mobile app does not use this package, because
phones build their screens from different native pieces; it shares the colors
and fonts in `@intelli/tokens` instead.)

The name `@intelli/ui` is how the apps refer to it. A screen pulls in a piece
like this:

```ts
import { Button, Card, Modal } from '@intelli/ui'
```

---

## How it is built

It is plain source code (TypeScript) with no separate build step. The web apps
compile it together with their own code (via Vite), exactly the way
`@intelli/tokens` works. The look comes from the CSS variables in
`@intelli/tokens`, so this kit holds the shapes and behavior and the tokens hold
the brand colors and spacing.

React is listed as a "peer dependency", which is a plain way of saying "the app
that uses this kit brings its own copy of React, and the kit borrows that one"
so there is never a confusing second copy of React at runtime.

---

## The files

### src/index.ts
The front desk. It lists everything the kit hands out, so an app can import any
piece by name from `@intelli/ui`.

### src/*.tsx and src/*.module.css
One file per building block (for example `Button.tsx` with its `Button.module.css`),
plus `icons.ts`, which holds the icon drawings. `form.module.css` is the shared
styling for the form pieces (Field, Input, Select).

### package.json
The little ID card that names this shared piece (`@intelli/ui`) and points to
`src/index.ts` so the apps can find it.

---

## In short

One shared set of web building blocks, used by both the Admin and Manager apps,
so they look and behave the same and only need fixing once.
