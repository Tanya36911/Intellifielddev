import { useQuery } from '@tanstack/react-query'
import { apiGet } from '../../lib/api'

export type Range = '4w' | '12w' | 'YTD'

// Turn a range choice into the date_from/date_to the backend expects. 4w/12w are
// rolling windows (28 / 84 days back from now); YTD starts at Jan 1 this year.
export function rangeToDates(range: Range, now = new Date()) {
  const date_to = now.toISOString()
  let from: Date
  if (range === 'YTD') from = new Date(Date.UTC(now.getUTCFullYear(), 0, 1))
  else from = new Date(now.getTime() - (range === '4w' ? 28 : 84) * 86400000)
  return { date_from: from.toISOString(), date_to }
}

export type DashboardCurrent = {
  completion_pct: number | null
  pass_pct: number | null
  expected: number
  responded: number
  scored: number
  passed: number
  surveys_completed: number
  overdue: number
}

export type DashboardData = {
  footprint: { nodes: number; stores: number; reps: number }
  current: DashboardCurrent
  previous: DashboardCurrent | null
  trend: { week_start: string; completion_pct: number | null; responded: number; expected: number }[]
}

export type ComplianceRow = {
  assignment_id: string
  survey_id: string
  survey_name: string
  survey_version_id: string
  target_node_id: string
  target_node_name: string
  expected: number
  responded: number
  scored: number
  passed: number
  completion_pct: number | null
  pass_pct: number | null
}

export type DrillChild = {
  node_id: string
  name: string
  level_order: number
  is_store: boolean
  expected: number
  responded: number
  scored: number
  passed: number
  completion_pct: number | null
  pass_pct: number | null
}

export type DrillResult =
  | { is_store: false; children: DrillChild[] }
  | {
      is_store: true
      responded: boolean
      items?: { name: string; ok: boolean; detail?: string }[]
      questions?: { prompt: string; ok: boolean; answer?: string }[]
      overall?: number | null
    }

// The headline dashboard fetch, re-queried whenever the range changes.
export function useDashboard(range: Range) {
  const { date_from, date_to } = rangeToDates(range)
  return useQuery({
    queryKey: ['dashboard', range],
    queryFn: () =>
      apiGet<DashboardData>(
        `/analytics/dashboard?date_from=${encodeURIComponent(date_from)}&date_to=${encodeURIComponent(date_to)}`,
      ),
  })
}

// The compliance-by-node list (one row per survey assignment).
export function useCompliance() {
  return useQuery({
    queryKey: ['compliance'],
    queryFn: () => apiGet<{ rows: ComplianceRow[]; count: number }>('/analytics/compliance'),
  })
}

// The per-row drill, only fetched once a row is expanded (enabled).
export function useComplianceDrill(
  nodeId: string,
  surveyVersionId: string,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ['compliance-drill', nodeId, surveyVersionId],
    enabled,
    queryFn: () =>
      apiGet<DrillResult>(
        `/analytics/compliance/drill?node_id=${encodeURIComponent(nodeId)}&survey_version_id=${encodeURIComponent(surveyVersionId)}`,
      ),
  })
}
