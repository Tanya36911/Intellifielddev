import { useQuery } from '@tanstack/react-query'
import { apiGet } from '../../lib/api'

// ---- Types ----

export type ResponseRow = {
  id: string
  survey_version_id: string
  store_node_id: string
  store_path: string
  user_id: string
  online: boolean
  submitted_at: string
  created_at: string
  store_name: string
  survey_name: string
  survey_version_number: number
  rep_name: string
  overall: boolean | null
}

export type ResponseItem = {
  question_id: string
  sku_id: string | null
  value: unknown
  pass: boolean | null
}

export type ResponseDetail = ResponseRow & {
  items: ResponseItem[]
  questions: Record<string, boolean | null>
}

export type ResponseStatus = {
  pct: number | null
  status: 'pass' | 'partial' | 'fail' | 'na'
  scored: number
  passed: number
}

// ---- Hooks ----

export function useResponses() {
  return useQuery({
    queryKey: ['responses'],
    queryFn: () => apiGet<{ responses: ResponseRow[]; count: number }>('/responses'),
  })
}

export function useResponseDetail(id: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ['response', id],
    queryFn: () => apiGet<ResponseDetail>(`/responses/${id}`),
    enabled: enabled && !!id,
  })
}

// ---- Pure helpers ----

/**
 * Filter a list of response rows to only those belonging to a set of
 * survey version ids (typically all versions of one survey).
 */
export function responsesForSurvey(
  rows: ResponseRow[],
  versionIds: string[],
): ResponseRow[] {
  const set = new Set(versionIds)
  return rows.filter((r) => set.has(r.survey_version_id))
}

/**
 * Build a map of surveyId -> response count for each survey, given a map of
 * surveyId -> its version ids.
 */
export function countBySurvey(
  rows: ResponseRow[],
  surveyVersionMap: Record<string, string[]>,
): Record<string, number> {
  const result: Record<string, number> = {}
  for (const [surveyId, vids] of Object.entries(surveyVersionMap)) {
    result[surveyId] = responsesForSurvey(rows, vids).length
  }
  return result
}

/**
 * Compute a summary status from the per-question verdict map in a
 * ResponseDetail. Mirrors the prototype responseSummary().
 * - questions is a Record<questionId, true|false|null> where null = not scored.
 * - pct is null when no questions are scored.
 * - status: 'na' when scored===0, 'pass' when all pass, 'fail' when all fail,
 *   'partial' otherwise.
 */
export function responseStatus(detail: ResponseDetail): ResponseStatus {
  const verdicts = Object.values(detail.questions)
  const scored = verdicts.filter((v) => v !== null).length
  const passed = verdicts.filter((v) => v === true).length
  const pct = scored === 0 ? null : Math.round((passed / scored) * 100)
  let status: ResponseStatus['status']
  if (scored === 0) status = 'na'
  else if (passed === scored) status = 'pass'
  else if (passed === 0) status = 'fail'
  else status = 'partial'
  return { pct, status, scored, passed }
}
