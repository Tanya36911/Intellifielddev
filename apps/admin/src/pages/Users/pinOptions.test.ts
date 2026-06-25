import { describe, it, expect } from 'vitest'
import { pinOptions } from './pinOptions'

const nodes = [
  { id: 'c', name: 'Lumen Beauty', code: 'LB', level_order: 0, parent_id: null, path: 'c/', chain: null, address: null, lat: null, lng: null, tz: null },
  { id: 'w', name: 'West', code: 'W', level_order: 1, parent_id: 'c', path: 'c/w/', chain: null, address: null, lat: null, lng: null, tz: null },
  { id: 'b', name: 'Bay Area', code: 'BA', level_order: 2, parent_id: 'w', path: 'c/w/b/', chain: null, address: null, lat: null, lng: null, tz: null },
]
const levels = [
  { level_order: 0, name: 'Company', locked: false },
  { level_order: 1, name: 'Region', locked: false },
  { level_order: 2, name: 'District', locked: false },
]

describe('pinOptions', () => {
  it('orders by path and labels with level name + indent', () => {
    const opts = pinOptions(nodes, levels)
    expect(opts.map((o) => o.id)).toEqual(['c', 'w', 'b'])
    expect(opts[0].levelName).toBe('Company')
    expect(opts[2].levelName).toBe('District')
    expect(opts[2].label.startsWith(' ')).toBe(true) // indented
  })
})
