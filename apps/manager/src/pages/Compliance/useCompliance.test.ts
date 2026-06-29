import { describe, it, expect } from 'vitest'
import { checkCounts, failingItems, valueLabel, type StoreSurveyBlock } from './useCompliance'

const block: StoreSurveyBlock = {
  survey_version_id: 'sv1',
  survey_name: 'Velvet Lip Shelf Check',
  responded: true,
  items: [
    { question_id: 'q1', sku_id: 'sku-1', value: 2, pass: false },
    { question_id: 'q1', sku_id: 'sku-2', value: 0, pass: false },
    { question_id: 'q1', sku_id: 'sku-3', value: 5, pass: true },
    { question_id: 'q2', sku_id: null, value: 'Yes', pass: true },
  ],
  questions: { q1: false, q2: true, q3: null },
  overall: false,
}
const skuMap = {
  'sku-1': { variant: 'Rosewood', color: '#9b5b5b' },
  'sku-2': { variant: 'Mauve', color: '#a9748c' },
}

describe('checkCounts', () => {
  it('counts scored and passed questions, skipping null verdicts', () => {
    expect(checkCounts(block)).toEqual({ passed: 1, scored: 2 })
  })
})

describe('failingItems', () => {
  it('returns only the failing per-SKU items, named from the catalog', () => {
    const f = failingItems(block, skuMap)
    expect(f).toHaveLength(2)
    expect(f[0]).toMatchObject({ variant: 'Rosewood', value: 2 })
    expect(f[1]).toMatchObject({ variant: 'Mauve', value: 0 })
  })
  it('falls back to a safe label when a SKU is missing from the catalog map', () => {
    const f = failingItems(
      { ...block, items: [{ question_id: 'q1', sku_id: 'gone', value: 1, pass: false }] },
      skuMap,
    )
    expect(f[0].variant).toBe('Unknown product')
  })
})

describe('valueLabel', () => {
  it('reads 0 as out of stock and a number as facings', () => {
    expect(valueLabel(0)).toBe('out of stock')
    expect(valueLabel(3)).toBe('3 facings')
    expect(valueLabel('Yes')).toBe('Yes')
    expect(valueLabel(null)).toBe('')
  })
})
