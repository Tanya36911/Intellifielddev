// The session lives in localStorage (mirrored by the Redux auth slice). This
// tiny module is imported by BOTH api.ts and store/auth.ts so the API client can
// read the token without importing the Redux store (which would be a cycle).
export const SESSION_KEY = 'intelli-admin-session'

export function readToken(): string | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const token = (JSON.parse(raw) as { token?: string })?.token
    return token ?? null
  } catch {
    return null
  }
}
