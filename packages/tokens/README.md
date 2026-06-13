# Shared design tokens (packages/tokens/)

"Design tokens" is just a fancy name for the brand's exact colors, fonts,
roundness, spacing, and shadows, written down once in a single place. Every
frontend app (Admin now, Manager and Field later) reads from here, so they all
look identical and a color change happens in one spot instead of twenty.

These values were copied straight from the finished prototype, so the real app
matches the demo.

`packages/` is where shared frontend pieces live. Today there is one shared
piece, `tokens`. The name `@intelli/tokens` is how the apps refer to it.

---

## The files

### src/tokens.css
The colors, fonts, and spacing written as **CSS variables**, the form web pages
use. The Admin app loads this once, and then its screens refer to values like
"the accent color" or "the medium corner radius" by name. Change a value here
and every web screen updates.

### src/index.ts
The same values written as a plain data object, the form the future Field
mobile app (React Native) will use, since phones do not read CSS the same way
the web does. The two files are kept in sync so web and mobile share one look.

### package.json
The little ID card that names this shared piece (`@intelli/tokens`) and points
to the two files above so the apps can find them.

---

## In short

One source of truth for how Intelli looks. Web reads `tokens.css`, mobile reads
`index.ts`, and they hold the same values.
