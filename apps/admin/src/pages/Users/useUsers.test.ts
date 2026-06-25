import { describe, it, expect } from 'vitest'
import { roleCounts, inheritanceText, type User } from './useUsers'

const U = (over: Partial<User>): User => ({
  id: 'x', name: 'X', email: 'x@y.com', role: 'rep',
  pinned_node_id: null, pinned_node_name: null, pinned_node_level_order: null, ...over,
})

describe('roleCounts', () => {
  it('counts each role', () => {
    const c = roleCounts([U({ role: 'admin' }), U({ role: 'manager' }), U({ role: 'rep' }), U({ role: 'rep' })])
    expect(c).toEqual({ admin: 1, manager: 1, rep: 2 })
  })
})

describe('inheritanceText', () => {
  it('admin or company level sees everything', () => {
    expect(inheritanceText('admin', 'Company')).toMatch(/entire company/i)
    expect(inheritanceText('rep', 'Company')).toMatch(/entire company/i)
  })
  it('region/district narrow down', () => {
    expect(inheritanceText('manager', 'Region')).toMatch(/districts and stores/i)
    expect(inheritanceText('rep', 'District')).toMatch(/stores in this district/i)
  })
  it('no level means no pin', () => {
    expect(inheritanceText('rep', null)).toMatch(/no pin/i)
  })
})
