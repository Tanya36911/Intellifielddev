// Shared session-token reader. Each app sets its own storage key once at
// startup via configureSession, so the Admin and Manager apps never share a
// login even when served from the same browser origin. Imported by api.ts so
// the client can read the token without importing any app's Redux store.
let sessionKey = 'intelli-session'

export function configureSession(key: string): void {
  sessionKey = key
}

export function getSessionKey(): string {
  return sessionKey
}

export function readToken(): string | null {
  try {
    const raw = localStorage.getItem(sessionKey)
    if (!raw) return null
    const token = (JSON.parse(raw) as { token?: string })?.token
    return token ?? null
  } catch {
    return null
  }
}
