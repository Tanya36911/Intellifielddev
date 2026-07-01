import { useQuery } from '@tanstack/react-query'
import { apiGet } from '@intelli/api-client'

// ---- Types ----

export type ResponseRow = {
  id: string
  survey_version_id: string
  survey_id: string
  store_node_id: string
  store_path: string
  user_id: string
  online: boolean
  submitted_at: string
  created_at: string
  store_name: string
  store_chain: string | null
  store_code: string
  store_address: string | null
  survey_name: string
  survey_version_number: number
  rep_name: string
  overall: boolean | null
  scored: number
  passed: number
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
 * Filter a list of response rows to only those belonging to a given survey id.
 * Uses the survey_id field returned directly by the backend on each row.
 */
export function responsesForSurvey(
  rows: ResponseRow[],
  surveyId: string,
): ResponseRow[] {
  return rows.filter((r) => r.survey_id === surveyId)
}

/**
 * Build a map of surveyId -> response count for each survey.
 * Uses the survey_id field on each row, so no version-id lookup is needed.
 */
export function countBySurvey(
  rows: ResponseRow[],
  surveyIds: string[],
): Record<string, number> {
  const result: Record<string, number> = {}
  for (const surveyId of surveyIds) {
    result[surveyId] = responsesForSurvey(rows, surveyId).length
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

/**
 * Count the audited shades (per-SKU items) that failed the facings threshold, for
 * the red "N of M audited shades below the facings threshold" callout. Only items
 * that were actually scored (pass true or false) count toward the total; items
 * without a verdict (no pass rule) are ignored, matching the facings grid.
 */
export function skuGapSummary(detail: ResponseDetail): { gaps: number; total: number } {
  const scoredSkuItems = detail.items.filter(
    (i) => i.sku_id != null && i.pass !== null,
  )
  return {
    gaps: scoredSkuItems.filter((i) => i.pass === false).length,
    total: scoredSkuItems.length,
  }
}
