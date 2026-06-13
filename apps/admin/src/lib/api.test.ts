import { health, login } from './api'

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
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
