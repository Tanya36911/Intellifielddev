import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import { renderApp } from '../../test/render'
import { ProductFormModal } from './ProductFormModal'
import { apiSend, ApiError } from '../../lib/api'

vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api')>()
  return { ...actual, apiSend: vi.fn() }
})

beforeEach(() => vi.clearAllMocks())

describe('ProductFormModal (add mode)', () => {
  it('keeps Save disabled until line, variant and UPC are present, then creates', async () => {
    vi.mocked(apiSend).mockResolvedValue({ id: 'new' } as never)
    const onClose = vi.fn()
    renderApp(<ProductFormModal open sku={null} lines={['Velvet Lip']} onClose={onClose} />)

    const save = screen.getByRole('button', { name: /add product/i })
    expect(save).toBeDisabled() // variant + upc empty
    fireEvent.change(screen.getByLabelText('Variant'), { target: { value: 'Rosewood' } })
    fireEvent.change(screen.getByLabelText('UPC'), { target: { value: 'LUM-VL-ROSE' } })
    expect(save).toBeEnabled()

    save.click()
    await waitFor(() => expect(apiSend).toHaveBeenCalledWith('POST', '/skus', expect.objectContaining({
      line: 'Velvet Lip', variant: 'Rosewood', upc: 'LUM-VL-ROSE',
    })))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('reveals a new-line input when "+ New line" is chosen', () => {
    renderApp(<ProductFormModal open sku={null} lines={['Velvet Lip']} onClose={vi.fn()} />)
    expect(screen.queryByLabelText('New line name')).toBeNull()
    fireEvent.change(screen.getByLabelText('Product line'), { target: { value: '__new__' } })
    expect(screen.getByLabelText('New line name')).toBeTruthy()
  })

  it('shows the backend error inline and stays open on failure', async () => {
    vi.mocked(apiSend).mockRejectedValue(new ApiError(400, 'UPC already exists'))
    const onClose = vi.fn()
    renderApp(<ProductFormModal open sku={null} lines={['Velvet Lip']} onClose={onClose} />)
    fireEvent.change(screen.getByLabelText('Variant'), { target: { value: 'X' } })
    fireEvent.change(screen.getByLabelText('UPC'), { target: { value: 'dup' } })
    screen.getByRole('button', { name: /add product/i }).click()
    expect(await screen.findByText('UPC already exists')).toBeTruthy()
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('ProductFormModal (edit mode)', () => {
  it('pre-fills from the sku and PATCHes on save', async () => {
    vi.mocked(apiSend).mockResolvedValue({ id: '1' } as never)
    const sku = {
      id: '1', line: 'Velvet Lip', variant: 'Rosewood', upc: 'LUM-VL-ROSE',
      color: '#9b5b5b', status: 'active' as const, reference_images: [], created_at: '',
    }
    renderApp(<ProductFormModal open sku={sku} lines={['Velvet Lip']} onClose={vi.fn()} />)
    expect((screen.getByLabelText('Variant') as HTMLInputElement).value).toBe('Rosewood')
    fireEvent.change(screen.getByLabelText('Variant'), { target: { value: 'Rosewood 2' } })
    screen.getByRole('button', { name: /save changes/i }).click()
    await waitFor(() => expect(apiSend).toHaveBeenCalledWith('PATCH', '/skus/1', expect.objectContaining({
      variant: 'Rosewood 2',
    })))
  })
})
