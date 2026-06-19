import { ApiError, apiGet, health, login } from './api'
import { SESSION_KEY, readToken } from './session'

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function setSession(token: string) {
  localStorage.setItem(
    SESSION_KEY,
    JSON.stringify({ token, user: { name: 'Dana', role: 'admin' } }),
  )
}

describe('login', () => {
  it('returns the token and user when the backend accepts', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(200, { token: 'abc', user: { name: 'Dana Whitfield', role: 'admin' } }),
      ),
    )
    const result = await login('dana@lumenbeauty.com', 'demo1234')
    expect(result.token).toBe('abc')
    expect(result.user.name).toBe('Dana Whitfield')
  })

  it('passes through the backend message on a wrong password', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(401, { detail: 'Invalid email or password' })),
    )
    await expect(login('dana@lumenbeauty.com', 'nope')).rejects.toMatchObject({
      status: 401,
      message: 'Invalid email or password',
    })
  })

  it('explains plainly when the backend is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    await expect(login('a@b.com', 'x')).rejects.toMatchObject({
      status: 0,
      message: "Can't reach the backend. Is it running? (docker compose up -d)",
    })
  })
})

describe('health', () => {
  it('is true when the backend answers ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { status: 'ok' })))
    expect(await health()).toBe(true)
  })

  it('is false when the backend is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    expect(await health()).toBe(false)
  })
})

describe('readToken', () => {
  it('returns the token from the stored session', () => {
    setSession('tok-123')
    expect(readToken()).toBe('tok-123')
  })
  it('returns null when there is no session', () => {
    expect(readToken()).toBeNull()
  })
})

describe('apiGet', () => {
  it('attaches the Bearer token and returns parsed JSON', async () => {
    setSession('tok-abc')
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const data = await apiGet('/analytics/dashboard')
    expect(data).toEqual({ ok: true })
    const [, init] = fetchMock.mock.calls[0]
    expect(init.headers.Authorization).toBe('Bearer tok-abc')
  })
  it('throws ApiError(401) on a 401 (the React layer signs out, not api.ts)', async () => {
    setSession('expired')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 401 })))
    await expect(apiGet('/analytics/dashboard')).rejects.toMatchObject({ status: 401 })
    await expect(apiGet('/analytics/dashboard')).rejects.toBeInstanceOf(ApiError)
  })
})
