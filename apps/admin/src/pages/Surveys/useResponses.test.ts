import { describe, it, expect } from 'vitest'
import {
  responsesForSurvey,
  countBySurvey,
  responseStatus,
  skuGapSummary,
  type ResponseRow,
  type ResponseDetail,
  type ResponseItem,
} from './useResponses'

// Helper to build a minimal ResponseRow fixture
const row = (id: string, survey_id: string, survey_version_id = 'v1-id'): ResponseRow => ({
  id,
  survey_version_id,
  survey_id,
  store_node_id: 'n1',
  store_path: '/lumen/west/sf/',
  user_id: 'u1',
  online: true,
  submitted_at: '2026-06-01T10:00:00Z',
  created_at: '2026-06-01T10:00:00Z',
  store_name: 'SF Store',
  store_chain: 'CVS',
  store_code: 'sf',
  store_address: null,
  survey_name: 'Test Survey',
  survey_version_number: 1,
  rep_name: 'Marcus Bell',
  overall: true,
  scored: 1,
  passed: 1,
})

describe('responsesForSurvey', () => {
  const rows: ResponseRow[] = [
    row('r1', 's1'),
    row('r2', 's1'),
    row('r3', 's2'),
  ]

  it('filters rows to only those matching the given survey id', () => {
    const result = responsesForSurvey(rows, 's1')
    expect(result.map((r) => r.id)).toEqual(['r1', 'r2'])
  })

  it('returns empty array when no rows match the survey id', () => {
    expect(responsesForSurvey(rows, 'no-match')).toEqual([])
  })

  it('returns empty array when rows is empty', () => {
    expect(responsesForSurvey([], 's1')).toEqual([])
  })
})

describe('countBySurvey', () => {
  const rows: ResponseRow[] = [
    row('r1', 's1'),
    row('r2', 's1'),
    row('r3', 's2'),
  ]

  it('returns a map of survey id to response count', () => {
    const map = countBySurvey(rows, ['s1', 's2'])
    expect(map['s1']).toBe(2)
    expect(map['s2']).toBe(1)
  })

  it('returns 0 for surveys with no matching responses', () => {
    const map = countBySurvey(rows, ['sX'])
    expect(map['sX']).toBe(0)
  })
})

describe('responseStatus', () => {
  const makeDetail = (questions: Record<string, boolean | null>): ResponseDetail => ({
    id: 'r1',
    survey_version_id: 'v1',
    survey_id: 's1',
    store_node_id: 'n1',
    store_path: '/lumen/',
    user_id: 'u1',
    online: true,
    submitted_at: '2026-06-01T10:00:00Z',
    created_at: '2026-06-01T10:00:00Z',
    store_name: 'Store',
    store_chain: null,
    store_code: 'x',
    store_address: null,
    survey_name: 'Survey',
    survey_version_number: 1,
    rep_name: 'Rep',
    overall: null,
    scored: 0,
    passed: 0,
    items: [],
    questions,
  })

  it('returns pass when all scored questions pass', () => {
    const r = responseStatus(makeDetail({ q1: true, q2: true }))
    expect(r.status).toBe('pass')
    expect(r.scored).toBe(2)
    expect(r.passed).toBe(2)
    expect(r.pct).toBe(100)
  })

  it('returns fail when all scored questions fail', () => {
    const r = responseStatus(makeDetail({ q1: false, q2: false }))
    expect(r.status).toBe('fail')
    expect(r.pct).toBe(0)
  })

  it('returns partial when some pass and some fail', () => {
    const r = responseStatus(makeDetail({ q1: true, q2: false }))
    expect(r.status).toBe('partial')
    expect(r.pct).toBe(50)
  })

  it('returns na when all questions are null (not scored)', () => {
    const r = responseStatus(makeDetail({ q1: null, q2: null }))
    expect(r.status).toBe('na')
    expect(r.pct).toBeNull()
  })

  it('ignores null questions in scoring', () => {
    // q1=true scored, q2=null not scored
    const r = responseStatus(makeDetail({ q1: true, q2: null }))
    expect(r.status).toBe('pass')
    expect(r.scored).toBe(1)
    expect(r.passed).toBe(1)
    expect(r.pct).toBe(100)
  })
})

describe('skuGapSummary', () => {
  const detailWith = (items: ResponseItem[]): ResponseDetail => ({
    id: 'r1', survey_version_id: 'v1', survey_id: 's1', store_node_id: 'n1',
    store_path: '/lumen/', user_id: 'u1', online: true,
    submitted_at: '2026-06-01T10:00:00Z', created_at: '2026-06-01T10:00:00Z',
    store_name: 'Store', store_chain: null, store_code: 'x', store_address: null,
    survey_name: 'Survey', survey_version_number: 1, rep_name: 'Rep',
    overall: null, scored: 0, passed: 0, items, questions: {},
  })

  it('counts scored per-SKU items that failed the facings threshold', () => {
    const s = skuGapSummary(detailWith([
      { question_id: 'q1', sku_id: 'a', value: 5, pass: true },
      { question_id: 'q1', sku_id: 'b', value: 2, pass: false },
      { question_id: 'q1', sku_id: 'c', value: 1, pass: false },
      { question_id: 'q2', sku_id: null, value: 'Yes', pass: true }, // non-SKU, ignored
    ]))
    expect(s).toEqual({ gaps: 2, total: 3 })
  })

  it('returns zero gaps when every audited shade passes', () => {
    const s = skuGapSummary(detailWith([
      { question_id: 'q1', sku_id: 'a', value: 5, pass: true },
      { question_id: 'q1', sku_id: 'b', value: 6, pass: true },
    ]))
    expect(s).toEqual({ gaps: 0, total: 2 })
  })

  it('ignores per-SKU items with no verdict (unscored)', () => {
    const s = skuGapSummary(detailWith([
      { question_id: 'q1', sku_id: 'a', value: 5, pass: null },
      { question_id: 'q1', sku_id: 'b', value: 2, pass: false },
    ]))
    expect(s).toEqual({ gaps: 1, total: 1 })
  })
})
