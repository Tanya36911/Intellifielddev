// The one place the frontend talks to the backend. Screens import these
// helpers; nothing else in the app calls fetch directly.
export const API_BASE = 'http://localhost:8000'

export type SessionUser = { name: string; role: string }
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
