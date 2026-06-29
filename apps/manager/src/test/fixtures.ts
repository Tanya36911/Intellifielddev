export const HOUR = 60 * 60 * 1000

// A fake (unsigned) wristband whose payload expires at the given moment.
// Only the middle chunk matters to the app; signatures are the backend's job.
export function fakeToken(expiresAtMs: number): string {
  const payload = btoa(JSON.stringify({ exp: Math.floor(expiresAtMs / 1000) }))
  return `header.${payload}.signature`
}

// Sarah is the demo manager, pinned at the "Central" node (matches the seed:
// the node is named "Central", not "Central Region").
export const sarah = {
  name: 'Sarah Mitchell',
  role: 'manager',
  company_name: 'Lumen Beauty',
  pinned_node_name: 'Central',
}
// An admin can also open the Manager app. The demo admin is pinned at the
// company root node, which is named "Lumen Beauty" (matches the seed), so that
// is the admin's scope label.
export const dana = {
  name: 'Dana Whitfield',
  role: 'admin',
  company_name: 'Lumen Beauty',
  pinned_node_name: 'Lumen Beauty',
}
// A field rep, who must be bounced from the Manager app.
export const marcus = {
  name: 'Marcus Bell',
  role: 'rep',
  company_name: 'Lumen Beauty',
  pinned_node_name: 'Bay Area',
}

export function managerSession() {
  return { token: fakeToken(Date.now() + HOUR), user: sarah }
}
export function adminSession() {
  return { token: fakeToken(Date.now() + HOUR), user: dana }
}
export function repSession() {
  return { token: fakeToken(Date.now() + HOUR), user: marcus }
}
