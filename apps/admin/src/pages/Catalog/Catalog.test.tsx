import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent, waitFor, within } from '@testing-library/react'
import { renderApp } from '../../test/render'
import { adminSession, repSession } from '../../test/fixtures'
import Catalog from './Catalog'
import { apiGet, apiSend } from '../../lib/api'
import type { Sku } from './useCatalog'

vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api')>()
  return { ...actual, apiGet: vi.fn(), apiSend: vi.fn() }
})

const mk = (over: Partial<Sku>): Sku => ({
  id: Math.random().toString(), line: 'Velvet Lip', variant: 'Rosewood', upc: 'LUM-VL-ROSE',
  color: '#9b5b5b', status: 'active', reference_images: [], created_at: '', ...over,
})
const SAMPLE = {
  skus: [
    mk({ variant: 'Rosewood' }),
    mk({ variant: 'Bronze', line: 'Glow Blush', status: 'discontinued', upc: 'LUM-GB-BRONZE', color: null }),
    mk({ variant: 'Ivory', line: 'Silk Foundation', upc: 'LUM-SF-IVORY', reference_images: [{ label: 'x' }] }),
  ],
  count: 3,
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(apiGet).mockResolvedValue(SAMPLE)
})

describe('Catalog (admin)', () => {
  it('renders stat tiles, grouped lines, and the list view', async () => {
    renderApp(<Catalog />, { session: adminSession() })
    expect(await screen.findByText('Rosewood')).toBeTruthy()
    expect(screen.getByText('Product lines')).toBeTruthy()
    expect(screen.getByText('Glow Blush')).toBeTruthy() // sorted before Velvet Lip
    // null colour + a ref image with no url both render and read "No photo"
    expect(screen.getAllByText('No photo').length).toBeGreaterThan(0)
  })

  it('filters to Discontinued, hiding non-matching line sections', async () => {
    renderApp(<Catalog />, { session: adminSession() })
    await screen.findByText('Rosewood')
    screen.getByRole('button', { name: 'Discontinued' }).click()
    expect(screen.getByText('Bronze')).toBeTruthy()
    expect(screen.queryByText('Rosewood')).toBeNull()
    expect(screen.queryByText('Velvet Lip')).toBeNull()
  })

  it('opens the add modal and creates, then re-reads the list', async () => {
    vi.mocked(apiSend).mockResolvedValue(mk({ variant: 'Coral' }) as never)
    vi.mocked(apiGet)
      .mockResolvedValueOnce(SAMPLE)
      .mockResolvedValue({ skus: [...SAMPLE.skus, mk({ variant: 'Coral' })], count: 4 })
    renderApp(<Catalog />, { session: adminSession() })
    await screen.findByText('Rosewood')
    screen.getByRole('button', { name: /add product/i }).click()
    fireEvent.change(screen.getByLabelText('Variant'), { target: { value: 'Coral' } })
    fireEvent.change(screen.getByLabelText('UPC'), { target: { value: 'LUM-VL-CORAL' } })
    screen.getByRole('button', { name: /^add product$/i }).click()
    await waitFor(() => expect(apiSend).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(vi.mocked(apiGet).mock.calls.length).toBeGreaterThan(1))
    expect(await screen.findByText('Coral')).toBeTruthy()
  })
})

describe('Catalog (non-admin)', () => {
  it('hides Add and does not open a modal on row click', async () => {
    renderApp(<Catalog />, { session: repSession() })
    await screen.findByText('Rosewood')
    expect(screen.queryByRole('button', { name: /add product/i })).toBeNull()
    screen.getByText('Rosewood').click()
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('Catalog (empty)', () => {
  it('shows the empty state with Add for an admin', async () => {
    vi.mocked(apiGet).mockResolvedValue({ skus: [], count: 0 })
    renderApp(<Catalog />, { session: adminSession() })
    expect(await screen.findByText('No products yet')).toBeTruthy()
    expect(screen.getByRole('button', { name: /add product/i })).toBeTruthy()
  })
})

describe('Catalog (import/export)', () => {
  it('renders Import and Export disabled', async () => {
    renderApp(<Catalog />, { session: adminSession() })
    await screen.findByText('Rosewood')
    expect(screen.getByRole('button', { name: /import skus/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /export/i })).toBeDisabled()
  })
})
