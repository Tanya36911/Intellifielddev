export const HOUR = 60 * 60 * 1000

// A fake (unsigned) wristband whose payload expires at the given moment.
// Only the middle chunk matters to the app; signatures are the backend's job.
export function fakeToken(expiresAtMs: number): string {
  const payload = btoa(JSON.stringify({ exp: Math.floor(expiresAtMs / 1000) }))
  return `header.${payload}.signature`
}

export const dana = {
  name: 'Dana Whitfield',
  role: 'admin',
  company_name: 'Lumen Beauty',
  pinned_node_name: null,
}
export const marcus = {
  name: 'Marcus Bell',
  role: 'rep',
  company_name: 'Lumen Beauty',
  pinned_node_name: 'Bay Area',
}
export function adminSession() {
  return { token: fakeToken(Date.now() + HOUR), user: dana }
}
export function repSession() {
  return { token: fakeToken(Date.now() + HOUR), user: marcus }
}
