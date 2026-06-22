import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { SkuThumb } from './SkuThumb'
import type { Sku } from './useCatalog'

const mk = (over: Partial<Sku>): Sku => ({
  id: '1', line: 'Velvet Lip', variant: 'Rosewood', upc: 'U', color: '#9b5b5b',
  status: 'active', reference_images: [], created_at: '', ...over,
})

describe('SkuThumb', () => {
  it('renders the image when a reference_images url exists', () => {
    const { container } = render(<SkuThumb sku={mk({ reference_images: [{ url: 'a.jpg' }] })} />)
    expect(container.querySelector('img')).toBeTruthy()
  })
  it('renders the swatch placeholder (camera, no img) when there is no usable photo', () => {
    const { container } = render(<SkuThumb sku={mk({ reference_images: [{ label: 'no-url' }] })} />)
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('svg')).toBeTruthy()
  })
  it('does not emit an invalid background when color is null', () => {
    const { container } = render(<SkuThumb sku={mk({ color: null })} />)
    const el = container.firstChild as HTMLElement
    expect(el.getAttribute('style') ?? '').not.toContain('null')
  })
})
