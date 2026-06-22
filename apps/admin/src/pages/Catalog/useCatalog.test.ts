import { describe, it, expect } from 'vitest'
import { groupByLine, catalogStats, filterSkus, photoCount, type Sku } from './useCatalog'

const mk = (over: Partial<Sku>): Sku => ({
  id: Math.random().toString(),
  line: 'Velvet Lip',
  variant: 'Rosewood',
  upc: 'LUM-VL-ROSE',
  color: '#9b5b5b',
  status: 'active',
  reference_images: [],
  created_at: '2026-01-01T00:00:00Z',
  ...over,
})

describe('groupByLine', () => {
  it('groups by line and orders lines alphabetically; empty -> empty', () => {
    const groups = groupByLine([
      mk({ line: 'Velvet Lip', variant: 'Rosewood' }),
      mk({ line: 'Glow Blush', variant: 'Peach' }),
      mk({ line: 'Velvet Lip', variant: 'Mauve' }),
    ])
    expect(groups.map((g) => g.line)).toEqual(['Glow Blush', 'Velvet Lip'])
    expect(groups[1].skus).toHaveLength(2)
    expect(groupByLine([])).toEqual([])
  })
})

describe('catalogStats', () => {
  it('counts lines, total, and active; empty -> all zero', () => {
    const stats = catalogStats([
      mk({ line: 'A', status: 'active' }),
      mk({ line: 'A', status: 'discontinued' }),
      mk({ line: 'B', status: 'active' }),
    ])
    expect(stats).toEqual({ lines: 2, total: 3, active: 2 })
    expect(catalogStats([])).toEqual({ lines: 0, total: 0, active: 0 })
  })
})

describe('filterSkus', () => {
  const skus = [
    mk({ variant: 'Rosewood', status: 'active', upc: '040123 1104 5' }),
    mk({ variant: 'Bronze', status: 'discontinued', upc: '040123 4404 1', line: 'Glow Blush' }),
  ]
  it('filters by status', () => {
    expect(filterSkus(skus, { status: 'active', query: '' }).map((s) => s.variant)).toEqual(['Rosewood'])
    expect(filterSkus(skus, { status: 'discontinued', query: '' }).map((s) => s.variant)).toEqual(['Bronze'])
  })
  it('searches variant/line case-insensitively and UPC whitespace-insensitively', () => {
    expect(filterSkus(skus, { status: 'all', query: 'rose' }).map((s) => s.variant)).toEqual(['Rosewood'])
    expect(filterSkus(skus, { status: 'all', query: 'glow' }).map((s) => s.variant)).toEqual(['Bronze'])
    expect(filterSkus(skus, { status: 'all', query: '04012311045' }).map((s) => s.variant)).toEqual(['Rosewood'])
  })
})

describe('photoCount', () => {
  it('counts only entries with a url', () => {
    expect(photoCount(mk({ reference_images: [{ url: 'a.jpg' }, { label: 'no-url' }] }))).toBe(1)
    expect(photoCount(mk({ reference_images: [] }))).toBe(0)
  })
})
