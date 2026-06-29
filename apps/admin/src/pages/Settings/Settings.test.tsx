import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import { renderApp } from '../../test/render'
import { adminSession, repSession } from '../../test/fixtures'
import Settings from './Settings'
import { apiGet, apiSend } from '@intelli/api-client'

vi.mock('@intelli/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@intelli/api-client')>()
  return { ...actual, apiGet: vi.fn(), apiSend: vi.fn() }
})

const TENANT = { id: 't1', name: 'Lumen Beauty', code: 'lumen', payroll_enabled: true }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(apiGet).mockResolvedValue(TENANT as never)
  vi.mocked(apiSend).mockImplementation((_m, _p, body) =>
    Promise.resolve({ ...TENANT, ...(body as object) } as never))
})

describe('Settings page', () => {
  it('shows the company name and the payroll switch', async () => {
    renderApp(<Settings />, { session: adminSession() })
    const nameInput = await screen.findByDisplayValue('Lumen Beauty')
    expect(nameInput).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /payroll/i }))
    expect(screen.getByRole('switch', { name: /payroll enabled/i })).toBeTruthy()
  })

  it('Save is disabled until something changes, then PATCHes the change', async () => {
    renderApp(<Settings />, { session: adminSession() })
    const nameInput = await screen.findByDisplayValue('Lumen Beauty')
    const save = screen.getByRole('button', { name: /save changes/i }) as HTMLButtonElement
    expect(save.disabled).toBe(true)
    fireEvent.change(nameInput, { target: { value: 'Lumen Beauty Co' } })
    expect(save.disabled).toBe(false)
    fireEvent.click(save)
    await waitFor(() => expect(apiSend).toHaveBeenCalledWith('PATCH', '/tenants', { name: 'Lumen Beauty Co' }))
  })

  it('switching to a coming-soon section shows the placeholder', async () => {
    renderApp(<Settings />, { session: adminSession() })
    await screen.findByDisplayValue('Lumen Beauty')
    fireEvent.click(screen.getByRole('button', { name: /work model/i }))
    expect(await screen.findByText('Coming soon')).toBeTruthy()
  })

  it('is read-only for a rep (no Save, inputs disabled)', async () => {
    renderApp(<Settings />, { session: repSession() })
    const nameInput = await screen.findByDisplayValue('Lumen Beauty') as HTMLInputElement
    expect(nameInput.disabled).toBe(true)
    expect(screen.queryByRole('button', { name: /save changes/i })).toBeNull()
  })
})
