import { ApiError, apiGet, apiSend, health, login } from '@intelli/api-client'
import { getSessionKey, readToken } from '@intelli/api-client'

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function setSession(token: string) {
  localStorage.setItem(
    getSessionKey(),
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

describe('apiSend', () => {
  afterEach(() => vi.restoreAllMocks())

  it('POSTs JSON with the auth header and returns the parsed body', async () => {
    localStorage.setItem(getSessionKey(), JSON.stringify({ token: 't.t.t' }))
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ id: '1', variant: 'Rosewood' }), { status: 200 }),
    )
    const out = await apiSend<{ id: string }>('POST', '/skus', { variant: 'Rosewood' })
    expect(out.id).toBe('1')
    const [, init] = fetchMock.mock.calls[0]
    expect(init?.method).toBe('POST')
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer t.t.t')
    expect((init?.headers as Record<string, string>)['Content-Type']).toBe('application/json')
    expect(init?.body).toBe(JSON.stringify({ variant: 'Rosewood' }))
    localStorage.clear()
  })

  it('throws ApiError(status) with the backend detail on a non-2xx', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ detail: 'UPC already exists' }), { status: 400 }),
    )
    await expect(apiSend('POST', '/skus', {})).rejects.toMatchObject({
      status: 400,
      message: 'UPC already exists',
    })
  })

  it('throws ApiError(0) when the backend is unreachable', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network'))
    await expect(apiSend('PATCH', '/skus/1', {})).rejects.toBeInstanceOf(ApiError)
  })
})
