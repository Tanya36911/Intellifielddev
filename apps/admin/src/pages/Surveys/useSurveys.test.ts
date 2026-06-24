import { describe, expect, it } from 'vitest'
import {
  mapToBackendQuestion,
  mapFromBackendQuestion,
  passSummary,
  expandLinesToSkuIds,
  surveyStats,
  blankQuestion,
  pickPublishedVersionId,
  type BuilderQuestion,
  type SurveyVersion,
} from './useSurveys'
import type { Sku } from '../Catalog/useCatalog'

const sku = (id: string, line: string, status: Sku['status'] = 'active'): Sku => ({
  id, line, variant: id, upc: id, color: null, status, reference_images: [], created_at: '',
})
const CATALOG: Sku[] = [
  sku('v1', 'Velvet Lip'), sku('v2', 'Velvet Lip'), sku('vDISC', 'Velvet Lip', 'discontinued'),
  sku('s1', 'Silk Foundation'),
]

describe('expandLinesToSkuIds', () => {
  it('returns only active sku ids for the chosen lines', () => {
    expect(expandLinesToSkuIds(['Velvet Lip'], CATALOG).sort()).toEqual(['v1', 'v2'])
  })
  it('excludes discontinued and other lines', () => {
    expect(expandLinesToSkuIds(['Velvet Lip'], CATALOG)).not.toContain('vDISC')
    expect(expandLinesToSkuIds(['Velvet Lip'], CATALOG)).not.toContain('s1')
  })
})

describe('mapToBackendQuestion', () => {
  it('maps a Yes pass rule to == true', () => {
    const q: BuilderQuestion = { ...blankQuestion('boolean'), prompt: 'Built?', pass: { operator: '==', value: true } }
    expect(mapToBackendQuestion(q, CATALOG).pass).toEqual({ operator: '==', value: true })
  })
  it('drops the pass rule for logged-only types (multi_choice/photo/text)', () => {
    const q: BuilderQuestion = { ...blankQuestion('multi_choice'), options: ['a'], pass: { operator: 'in', value: ['a'] } }
    expect(mapToBackendQuestion(q, CATALOG).pass).toBeNull()
  })
  it('forces passScope each for a non-number type', () => {
    const q: BuilderQuestion = { ...blankQuestion('single_choice'), perSku: true, passScope: 'total', options: ['a'] }
    expect(mapToBackendQuestion(q, CATALOG).passScope).toBe('each')
  })
  it('sends the captured sku_ids and lines verbatim, never re-deriving', () => {
    const q: BuilderQuestion = { ...blankQuestion('number'), perSku: true, lines: ['Velvet Lip'], skuIds: ['v1', 'v2'] }
    const b = mapToBackendQuestion(q, CATALOG)
    expect(b.sku_ids).toEqual(['v1', 'v2'])
    expect(b.lines).toEqual(['Velvet Lip'])
  })
})

describe('mapFromBackendQuestion round-trips', () => {
  it('restores lines, skuIds, pass, unit, passScope', () => {
    const b = {
      id: 'q1', prompt: 'Facings?', type: 'number' as const, options: [], sku_ids: ['v1', 'v2'],
      perSku: true, pass: { operator: '>=', value: 4 }, passScope: 'each' as const,
      required: true, unit: 'facings', lines: ['Velvet Lip'],
    }
    const q = mapFromBackendQuestion(b)
    expect(q.lines).toEqual(['Velvet Lip'])
    expect(q.skuIds).toEqual(['v1', 'v2'])
    expect(q.pass).toEqual({ operator: '>=', value: 4 })
    expect(q.unit).toBe('facings')
    expect(q.passScope).toBe('each')
    expect(q.required).toBe(true)
  })
})

describe('passSummary', () => {
  it('boolean', () => {
    expect(passSummary({ ...blankQuestion('boolean'), pass: { operator: '==', value: true } })).toBe('Pass = Yes')
  })
  it('per-product number, each', () => {
    const q: BuilderQuestion = { ...blankQuestion('number'), perSku: true, unit: 'facings', passScope: 'each', pass: { operator: '>=', value: 4 } }
    expect(passSummary(q)).toBe('Pass = each >= 4 facings')
  })
  it('single choice', () => {
    expect(passSummary({ ...blankQuestion('single_choice'), options: ['A', 'B'], pass: { operator: 'in', value: ['A'] } })).toBe('Pass = A')
  })
  it('returns null when unscored', () => {
    expect(passSummary(blankQuestion('photo'))).toBeNull()
  })
})

describe('surveyStats', () => {
  it('counts by status', () => {
    const s = surveyStats([
      { status: 'published' }, { status: 'published' }, { status: 'draft' }, { status: 'archived' },
    ] as any)
    expect(s).toEqual({ total: 4, published: 2, draft: 1 })
  })
})

describe('pickPublishedVersionId', () => {
  const ver = (id: string, version_number: number, published_at: string | null): SurveyVersion =>
    ({ id, survey_id: 's1', version_number, questions: [], published_at, created_at: '' })

  it('returns the highest published version_number id', () => {
    const versions = [
      ver('draft1', 3, null),
      ver('pub1', 1, '2026-01-01'),
      ver('pub2', 2, '2026-06-01'),
    ]
    expect(pickPublishedVersionId(versions)).toBe('pub2')
  })

  it('returns null when no published version exists', () => {
    expect(pickPublishedVersionId([ver('draft1', 1, null)])).toBeNull()
  })

  it('returns null for an empty array', () => {
    expect(pickPublishedVersionId([])).toBeNull()
  })
})
