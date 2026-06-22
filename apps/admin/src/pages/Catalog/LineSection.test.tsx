import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { LineSection } from './LineSection'
import type { Sku } from './useCatalog'

const mk = (over: Partial<Sku>): Sku => ({
  id: Math.random().toString(), line: 'Velvet Lip', variant: 'Rosewood', upc: 'LUM-VL-ROSE',
  color: '#9b5b5b', status: 'active', reference_images: [], created_at: '', ...over,
})

describe('LineSection', () => {
  const skus = [mk({ variant: 'Rosewood' }), mk({ variant: 'Mauve' })]

  it('renders a row per sku in list view', () => {
    render(<LineSection line="Velvet Lip" skus={skus} fullSkus={skus} view="list" onOpen={vi.fn()} />)
    expect(screen.getByText('Rosewood')).toBeTruthy()
    expect(screen.getByText('Mauve')).toBeTruthy()
  })

  it('renders cards in gallery view', () => {
    render(<LineSection line="Velvet Lip" skus={skus} fullSkus={skus} view="gallery" onOpen={vi.fn()} />)
    expect(screen.getByText('Rosewood')).toBeTruthy()
  })

  it('renders nothing when its filtered list is empty', () => {
    const { container } = render(<LineSection line="Velvet Lip" skus={[]} fullSkus={skus} view="list" />)
    expect(container).toBeEmptyDOMElement()
  })

  it('calls onOpen when a row is clicked (admin), and is not clickable without onOpen', () => {
    const onOpen = vi.fn()
    const { rerender } = render(
      <LineSection line="Velvet Lip" skus={[skus[0]]} fullSkus={skus} view="list" onOpen={onOpen} />,
    )
    screen.getByText('Rosewood').click()
    expect(onOpen).toHaveBeenCalledTimes(1)
    rerender(<LineSection line="Velvet Lip" skus={[skus[0]]} fullSkus={skus} view="list" />)
    screen.getByText('Rosewood').click()
    expect(onOpen).toHaveBeenCalledTimes(1) // unchanged: no handler when read-only
  })
})
