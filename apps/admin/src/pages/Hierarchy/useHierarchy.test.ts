import { describe, it, expect } from 'vitest'
import {
  buildTreeIndex,
  getLevelName,
  isLocked,
  levelChildName,
  filterNodes,
  hierarchyStats,
  getAncestors,
  uniqueChains,
  chainColor,
  computeCoverage,
  parseCsv,
  type OrgNode,
  type OrgLevel,
} from './useHierarchy'
import type { User } from '../Users/useUsers'

const LEVELS: OrgLevel[] = [
  { level_order: 0, name: 'Company', locked: false },
  { level_order: 1, name: 'Region', locked: false },
  { level_order: 2, name: 'District', locked: false },
  { level_order: 3, name: 'Store', locked: true },
]

function mkNode(over: Partial<OrgNode> & { id: string }): OrgNode {
  return {
    name: over.id,
    code: over.id,
    level_order: 0,
    parent_id: null,
    path: over.id,
    chain: null,
    address: null,
    lat: null,
    lng: null,
    tz: null,
    ...over,
  }
}

const FLAT: OrgNode[] = [
  mkNode({ id: 'company', level_order: 0 }),
  mkNode({ id: 'r1', name: 'West', level_order: 1, parent_id: 'company' }),
  mkNode({ id: 'd1', name: 'Bay Area', level_order: 2, parent_id: 'r1' }),
  mkNode({ id: 's1', name: 'Store CVS Palo Alto', level_order: 3, parent_id: 'd1', chain: 'CVS', code: 'ST001' }),
  mkNode({ id: 's2', name: 'Store Walgreens Menlo', level_order: 3, parent_id: 'd1', chain: 'Walgreens', code: 'ST002' }),
]

describe('buildTreeIndex', () => {
  it('maps byId and builds children lists', () => {
    const idx = buildTreeIndex(FLAT)
    expect(idx.byId['r1'].name).toBe('West')
    expect(idx.children['r1']).toContain('d1')
    expect(idx.children['d1'].sort()).toEqual(['s1', 's2'])
  })

  it('roots are nodes with no parent_id', () => {
    const idx = buildTreeIndex(FLAT)
    expect(idx.roots).toEqual(['company'])
  })

  it('roots on the shallowest in-scope node when an ancestor is out of scope', () => {
    // A manager's scoped fetch starts at Central (whose parent, the company
    // root, is above their scope and absent from the set), then its descendants.
    const scoped: OrgNode[] = [
      mkNode({ id: 'central', name: 'Central', level_order: 1, parent_id: 'company' }),
      mkNode({ id: 'chi', name: 'Chicago', level_order: 2, parent_id: 'central' }),
      mkNode({ id: 'chi-store', name: 'Chicago store', level_order: 3, parent_id: 'chi', code: 'ST010' }),
    ]
    const idx = buildTreeIndex(scoped)
    expect(idx.roots).toEqual(['central']) // not dropped just because 'company' is absent
    expect(idx.children['central']).toContain('chi')
    expect(idx.children['chi']).toContain('chi-store')
  })

  it('leaf nodes have an empty children array', () => {
    const idx = buildTreeIndex(FLAT)
    expect(idx.children['s1']).toEqual([])
  })

  it('handles empty input', () => {
    const idx = buildTreeIndex([])
    expect(idx.roots).toEqual([])
  })
})

describe('getLevelName', () => {
  it('returns the level name for a known level_order', () => {
    expect(getLevelName(1, LEVELS)).toBe('Region')
    expect(getLevelName(3, LEVELS)).toBe('Store')
  })

  it('returns a fallback for unknown level_order', () => {
    expect(getLevelName(99, LEVELS)).toBe('Level 99')
  })
})

describe('isLocked', () => {
  it('returns true for locked levels', () => {
    expect(isLocked(3, LEVELS)).toBe(true)
  })

  it('returns false for unlocked levels', () => {
    expect(isLocked(0, LEVELS)).toBe(false)
    expect(isLocked(2, LEVELS)).toBe(false)
  })

  it('returns false for unknown level_order', () => {
    expect(isLocked(99, LEVELS)).toBe(false)
  })
})

describe('levelChildName', () => {
  it('returns the level name one below the parent (the child you are adding)', () => {
    // Adding under a Company (order 0) makes a Region (order 1)
    expect(levelChildName(0, LEVELS)).toBe('Region')
    // Adding under a District (order 2) makes a Store (order 3)
    expect(levelChildName(2, LEVELS)).toBe('Store')
  })

  it('falls back to a generic name when the child level is unknown', () => {
    // No level order 4 exists, so adding under the Store level has no known child
    expect(levelChildName(3, LEVELS)).toBe('Level 4')
  })
})

describe('hierarchyStats', () => {
  it('counts level count from levels array, regions at order 1, districts at order 2, stores at locked levels', () => {
    const stats = hierarchyStats(FLAT, LEVELS)
    expect(stats.levelCount).toBe(4)
    expect(stats.regionCount).toBe(1)
    expect(stats.districtCount).toBe(1)
    expect(stats.storeCount).toBe(2)
  })

  it('handles empty inputs', () => {
    const stats = hierarchyStats([], [])
    expect(stats).toEqual({ levelCount: 0, regionCount: 0, districtCount: 0, storeCount: 0 })
  })
})

describe('getAncestors', () => {
  it('returns root-first ancestors excluding the node itself', () => {
    const idx = buildTreeIndex(FLAT)
    const ancestors = getAncestors('s1', idx)
    expect(ancestors.map(n => n.id)).toEqual(['company', 'r1', 'd1'])
  })

  it('returns empty array for a root node', () => {
    const idx = buildTreeIndex(FLAT)
    expect(getAncestors('company', idx)).toEqual([])
  })
})

describe('filterNodes', () => {
  it('returns all ids when query and chain are empty', () => {
    const keep = filterNodes(FLAT, '', 'All')
    expect(keep.size).toBe(FLAT.length)
  })

  it('keeps matching nodes and all their ancestors', () => {
    const keep = filterNodes(FLAT, 'palo alto', 'All')
    expect(keep.has('s1')).toBe(true)
    expect(keep.has('d1')).toBe(true)
    expect(keep.has('r1')).toBe(true)
    expect(keep.has('company')).toBe(true)
    expect(keep.has('s2')).toBe(false)
  })

  it('filters by chain — keeps matching stores and ancestors, drops other stores', () => {
    const keep = filterNodes(FLAT, '', 'CVS')
    expect(keep.has('s1')).toBe(true)
    expect(keep.has('d1')).toBe(true)
    expect(keep.has('s2')).toBe(false)
  })

  it('applies both query and chain filters together', () => {
    // chain=CVS but query does not match s1 -> nothing kept
    const keep = filterNodes(FLAT, 'walgreens', 'CVS')
    expect(keep.has('s1')).toBe(false)
    expect(keep.has('s2')).toBe(false)
  })

  it('is case-insensitive', () => {
    const keep = filterNodes(FLAT, 'BAY AREA', 'All')
    expect(keep.has('d1')).toBe(true)
    expect(keep.has('s1')).toBe(true)
  })
})

describe('uniqueChains', () => {
  it('returns sorted unique non-null chains', () => {
    expect(uniqueChains(FLAT)).toEqual(['CVS', 'Walgreens'])
  })

  it('returns empty array when no chains', () => {
    expect(uniqueChains([mkNode({ id: 'x' })])).toEqual([])
  })
})

describe('chainColor', () => {
  it('returns the keyed tone for known chains', () => {
    expect(chainColor('CVS')).toBe('#cc0000')
    expect(chainColor('Walmart')).toBe('#0071ce')
  })

  it('falls back to grey for an unknown chain', () => {
    expect(chainColor('Costco')).toBe('#999999')
  })

  it('falls back to grey for null', () => {
    expect(chainColor(null)).toBe('#999999')
  })
})

describe('computeCoverage', () => {
  function mkUser(over: Partial<User> & { id: string }): User {
    return {
      name: over.id,
      email: `${over.id}@x.com`,
      role: 'rep',
      pinned_node_id: null,
      pinned_node_name: null,
      pinned_node_level_order: null,
      ...over,
    }
  }

  const idx = buildTreeIndex(FLAT)

  it('maps a manager to the node they are pinned to', () => {
    const users = [mkUser({ id: 'm1', name: 'Pat', role: 'manager', pinned_node_id: 'r1' })]
    const cov = computeCoverage(users, idx)
    expect(cov.managerByNode['r1']).toEqual({ name: 'Pat' })
  })

  it('counts a rep at its pinned node and rolls it up to every ancestor', () => {
    const users = [mkUser({ id: 'rep1', role: 'rep', pinned_node_id: 's1' })]
    const cov = computeCoverage(users, idx)
    // s1 is under d1 under r1 under company; the rep counts at each.
    expect(cov.repCountByNode['s1']).toBe(1)
    expect(cov.repCountByNode['d1']).toBe(1)
    expect(cov.repCountByNode['r1']).toBe(1)
    expect(cov.repCountByNode['company']).toBe(1)
  })

  it('counts a rep pinned directly to a district', () => {
    const users = [mkUser({ id: 'rep1', role: 'rep', pinned_node_id: 'd1' })]
    const cov = computeCoverage(users, idx)
    expect(cov.repCountByNode['d1']).toBe(1)
    expect(cov.repCountByNode['s1'] ?? 0).toBe(0)
  })

  it('counts districtGaps as level-2 nodes with no reps', () => {
    // No reps anywhere -> d1 (the only district) is a gap.
    expect(computeCoverage([], idx).districtGaps).toBe(1)
    // A rep under d1 closes the gap.
    const covered = computeCoverage(
      [mkUser({ id: 'rep1', role: 'rep', pinned_node_id: 's1' })],
      idx,
    )
    expect(covered.districtGaps).toBe(0)
  })

  it('ignores users with no pin', () => {
    const users = [mkUser({ id: 'rep1', role: 'rep', pinned_node_id: null })]
    expect(computeCoverage(users, idx).repCountByNode['d1'] ?? 0).toBe(0)
  })
})

describe('parseCsv', () => {
  it('skips a header row when the first cell is "level"', () => {
    const rows = parseCsv('Level,Name,Parent\nStore,CVS Foo,Bay Area')
    expect(rows).toEqual([{ level: 'Store', name: 'CVS Foo', parent: 'Bay Area' }])
  })

  it('keeps the first row when it is not a header', () => {
    const rows = parseCsv('Store,CVS Foo,Bay Area')
    expect(rows).toEqual([{ level: 'Store', name: 'CVS Foo', parent: 'Bay Area' }])
  })

  it('handles a double-quoted field containing a comma', () => {
    const rows = parseCsv('Store,"Foo, Inc",Bay Area')
    expect(rows).toEqual([{ level: 'Store', name: 'Foo, Inc', parent: 'Bay Area' }])
  })

  it('ignores blank lines', () => {
    const rows = parseCsv('\nStore,A,P\n\nStore,B,P\n')
    expect(rows).toEqual([
      { level: 'Store', name: 'A', parent: 'P' },
      { level: 'Store', name: 'B', parent: 'P' },
    ])
  })

  it('trims fields and tolerates fewer or more columns', () => {
    const rows = parseCsv('Region, North \nStore,A,P,extra,cols')
    expect(rows).toEqual([
      { level: 'Region', name: 'North', parent: '' },
      { level: 'Store', name: 'A', parent: 'P' },
    ])
  })
})
