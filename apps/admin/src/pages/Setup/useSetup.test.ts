import { describe, it, expect } from 'vitest'
import {
  TEMPLATES,
  templateToDraftLevels,
  renameLevel,
  addLevelAfter,
  removeLevel,
  moveLevel,
  structuralEditingAllowed,
  draftLevelsToNames,
} from './useSetup'
import type { OrgNode } from '../Hierarchy/useHierarchy'

function node(id: string, parent_id: string | null): OrgNode {
  return {
    id,
    name: id,
    code: id,
    level_order: parent_id === null ? 0 : 1,
    parent_id,
    path: id,
    chain: null,
    address: null,
    lat: null,
    lng: null,
    tz: null,
  }
}

describe('TEMPLATES', () => {
  it('every template has a company top, a store-ish bottom, and 2-7 levels', () => {
    expect(TEMPLATES.length).toBeGreaterThanOrEqual(2)
    for (const t of TEMPLATES) {
      expect(t.levels.length).toBeGreaterThanOrEqual(2)
      expect(t.levels.length).toBeLessThanOrEqual(7)
      expect(t.levels[0]).toBe('Company')
      expect(t.levels[t.levels.length - 1]).toBe('Store')
    }
  })
})

describe('templateToDraftLevels', () => {
  it('locks the first and last entries only', () => {
    const d = templateToDraftLevels(['Company', 'Region', 'Store'])
    expect(d.map((l) => l.locked)).toEqual([true, false, true])
    expect(d.map((l) => l.name)).toEqual(['Company', 'Region', 'Store'])
  })

  it('locks a single entry', () => {
    expect(templateToDraftLevels(['Company']).map((l) => l.locked)).toEqual([true])
  })
})

describe('renameLevel', () => {
  it('renames the targeted level and leaves the rest untouched', () => {
    const d = templateToDraftLevels(['Company', 'Region', 'Store'])
    const out = renameLevel(d, 1, 'Area')
    expect(out[1].name).toBe('Area')
    expect(out[0].name).toBe('Company')
    expect(out[2].name).toBe('Store')
  })

  it('allows renaming a locked level (locked blocks structure, not the name)', () => {
    const d = templateToDraftLevels(['Company', 'Store'])
    const out = renameLevel(d, 0, 'HQ')
    expect(out[0].name).toBe('HQ')
    expect(out[0].locked).toBe(true)
  })
})

describe('addLevelAfter', () => {
  it('inserts an unlocked middle level after the index', () => {
    const d = templateToDraftLevels(['Company', 'Store'])
    const out = addLevelAfter(d, 0)
    expect(out.map((l) => l.name)).toEqual(['Company', 'New level', 'Store'])
    expect(out[1].locked).toBe(false)
  })

  it('refuses to add beyond 7 levels', () => {
    const d = templateToDraftLevels(['Company', 'A', 'B', 'C', 'D', 'E', 'Store'])
    expect(d).toHaveLength(7)
    expect(addLevelAfter(d, 3)).toHaveLength(7)
  })
})

describe('removeLevel', () => {
  it('removes a middle level', () => {
    const d = templateToDraftLevels(['Company', 'Region', 'District', 'Store'])
    const out = removeLevel(d, 1)
    expect(out.map((l) => l.name)).toEqual(['Company', 'District', 'Store'])
  })

  it('never removes the locked top or bottom', () => {
    const d = templateToDraftLevels(['Company', 'Region', 'Store'])
    expect(removeLevel(d, 0)).toHaveLength(3)
    expect(removeLevel(d, 2)).toHaveLength(3)
  })

  it('never drops below 2 levels', () => {
    const d = templateToDraftLevels(['Company', 'Store'])
    expect(removeLevel(d, 0)).toHaveLength(2)
  })
})

describe('moveLevel', () => {
  it('swaps two middle levels', () => {
    const d = templateToDraftLevels(['Company', 'Region', 'District', 'Store'])
    const out = moveLevel(d, 1, 1)
    expect(out.map((l) => l.name)).toEqual(['Company', 'District', 'Region', 'Store'])
  })

  it('does not move a middle level into a locked slot', () => {
    const d = templateToDraftLevels(['Company', 'Region', 'District', 'Store'])
    // moving index 1 (Region) up would land on the locked top -> no-op
    expect(moveLevel(d, 1, -1).map((l) => l.name)).toEqual([
      'Company',
      'Region',
      'District',
      'Store',
    ])
    // moving index 2 (District) down would land on the locked bottom -> no-op
    expect(moveLevel(d, 2, 1).map((l) => l.name)).toEqual([
      'Company',
      'Region',
      'District',
      'Store',
    ])
  })

  it('never moves a locked level', () => {
    const d = templateToDraftLevels(['Company', 'Region', 'Store'])
    expect(moveLevel(d, 0, 1).map((l) => l.name)).toEqual(['Company', 'Region', 'Store'])
  })
})

describe('structuralEditingAllowed', () => {
  it('allows editing with no nodes at all', () => {
    expect(structuralEditingAllowed([])).toBe(true)
  })

  it('allows editing when only the root exists', () => {
    expect(structuralEditingAllowed([node('company', null)])).toBe(true)
  })

  it('refuses editing once a non-root node exists', () => {
    expect(structuralEditingAllowed([node('company', null), node('r1', 'company')])).toBe(false)
  })
})

describe('draftLevelsToNames', () => {
  it('returns trimmed names in order', () => {
    const d = [
      { name: ' Company ', locked: true },
      { name: 'Region', locked: false },
      { name: 'Store', locked: true },
    ]
    expect(draftLevelsToNames(d)).toEqual(['Company', 'Region', 'Store'])
  })
})
