import { describe, it, expect } from 'vitest'
import {
  responsesForSurvey,
  countBySurvey,
  responseStatus,
  type ResponseRow,
  type ResponseDetail,
} from './useResponses'
import type { Survey, SurveyVersion } from './useSurveys'

// Helpers to build minimal fixture objects
const ver = (id: string, survey_id: string): SurveyVersion => ({
  id,
  survey_id,
  version_number: 1,
  questions: [],
  published_at: '2026-01-01',
  created_at: '2026-01-01',
})

const survey = (id: string, versionIds: string[]): Survey => ({
  id,
  name: 'Test Survey',
  type: null,
  status: 'published',
  created_at: '',
  latest_version: 1,
  assigned: true,
})

const row = (id: string, survey_version_id: string): ResponseRow => ({
  id,
  survey_version_id,
  store_node_id: 'n1',
  store_path: '/lumen/west/sf/',
  user_id: 'u1',
  online: true,
  submitted_at: '2026-06-01T10:00:00Z',
  created_at: '2026-06-01T10:00:00Z',
  store_name: 'SF Store',
  survey_name: 'Test Survey',
  survey_version_number: 1,
  rep_name: 'Marcus Bell',
  overall: true,
})

const SURVEYS: Survey[] = [
  { id: 's1', name: 'Velvet Lip', type: null, status: 'published', created_at: '', latest_version: 2, assigned: true },
  { id: 's2', name: 'Spring Reset', type: null, status: 'draft', created_at: '', latest_version: 1, assigned: false },
]

// For responsesForSurvey we need versions attached. We use a SurveyDetail-like structure
// but the helper receives a plain Survey + versions array.
describe('responsesForSurvey', () => {
  const v1 = 'v1-id'
  const v2 = 'v2-id'
  const vOther = 'v-other'
  const rows: ResponseRow[] = [
    row('r1', v1),
    row('r2', v2),
    row('r3', vOther),
  ]

  it('filters rows to only those matching the given version ids', () => {
    const result = responsesForSurvey(rows, [v1, v2])
    expect(result.map((r) => r.id)).toEqual(['r1', 'r2'])
  })

  it('returns empty array when no version ids match', () => {
    expect(responsesForSurvey(rows, ['no-match'])).toEqual([])
  })

  it('returns empty array when rows is empty', () => {
    expect(responsesForSurvey([], [v1])).toEqual([])
  })
})

describe('countBySurvey', () => {
  const rows: ResponseRow[] = [
    row('r1', 'v1-id'),
    row('r2', 'v1-id'),
    row('r3', 'v2-id'),
  ]

  it('returns a map of survey id to response count', () => {
    const map = countBySurvey(rows, { s1: ['v1-id', 'v2-id'], s2: [] })
    expect(map['s1']).toBe(3)
    expect(map['s2']).toBe(0)
  })

  it('returns 0 for surveys with no matching responses', () => {
    const map = countBySurvey(rows, { sX: ['v-none'] })
    expect(map['sX']).toBe(0)
  })
})

describe('responseStatus', () => {
  const makeDetail = (questions: Record<string, boolean | null>): ResponseDetail => ({
    id: 'r1',
    survey_version_id: 'v1',
    store_node_id: 'n1',
    store_path: '/lumen/',
    user_id: 'u1',
    online: true,
    submitted_at: '2026-06-01T10:00:00Z',
    created_at: '2026-06-01T10:00:00Z',
    store_name: 'Store',
    survey_name: 'Survey',
    survey_version_number: 1,
    rep_name: 'Rep',
    overall: null,
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
