// The one place the frontend talks to the backend. Screens import these
// helpers; nothing else in the app calls fetch directly.
import { readToken } from './session'

export const API_BASE = 'http://localhost:8000'

export type SessionUser = {
  name: string
  role: string
  company_name?: string | null
  pinned_node_name?: string | null
}
export type LoginResult = { token: string; user: SessionUser }

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

const CANT_REACH = "Can't reach the backend. Is it running? (docker compose up -d)"

export async function login(email: string, password: string): Promise<LoginResult> {
  let res: Response
  try {
    res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
  } catch {
    throw new ApiError(0, CANT_REACH)
  }
  if (!res.ok) {
    const detail = await res
      .json()
      .then((d) => d?.detail)
      .catch(() => null)
    throw new ApiError(
      res.status,
      typeof detail === 'string' ? detail : 'Something went wrong. Try again.',
    )
  }
  return res.json()
}

export async function health(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/health`)
    const data = await res.json()
    return data.status === 'ok'
  } catch {
    return false
  }
}

function authHeaders(): Record<string, string> {
  const token = readToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

// Authenticated GET. Throws ApiError(0) if the backend is unreachable, and
// ApiError(status) on a non-2xx (the caller / Query layer handles 401 by signing
// out; api.ts never imports the store).
export async function apiGet<T = unknown>(path: string): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${API_BASE}${path}`, { headers: { ...authHeaders() } })
  } catch {
    throw new ApiError(0, CANT_REACH)
  }
  if (!res.ok) {
    const detail = await res
      .json()
      .then((d) => d?.detail)
      .catch(() => null)
    throw new ApiError(res.status, typeof detail === 'string' ? detail : 'Request failed.')
  }
  return res.json() as Promise<T>
}

// Authenticated write (POST/PATCH). Mirrors apiGet's token + error handling:
// ApiError(0) when unreachable, ApiError(status) on a non-2xx with the backend's
// detail when present.
export async function apiSend<T = unknown>(
  method: 'POST' | 'PATCH',
  path: string,
  body: unknown,
): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch {
    throw new ApiError(0, CANT_REACH)
  }
  if (!res.ok) {
    const detail = await res
      .json()
      .then((d) => d?.detail)
      .catch(() => null)
    throw new ApiError(res.status, typeof detail === 'string' ? detail : 'Request failed.')
  }
  return res.json() as Promise<T>
}

// Authenticated CSV download. A bare <a download> would 401 (no auth header),
// so fetch with the token, turn the body into a Blob, and click a temporary
// anchor with a client-set filename (Content-Disposition is not honored for
// blob downloads).
export async function downloadCsv(path: string, filename: string): Promise<void> {
  const res = await fetch(`${API_BASE}${path}`, { headers: { ...authHeaders() } })
  if (!res.ok) throw new ApiError(res.status, 'Export failed.')
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
