import { useQuery } from '@tanstack/react-query'
import { apiGet } from '@intelli/api-client'

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

// One scored per-product line: which question + product, the raw answer value,
// and whether it passed (null = no rule / blank, not counted).
export type DrillItem = {
  question_id: string
  sku_id: string | null
  value: unknown
  pass: boolean | null
}

// One row of the "Compliance by node" rollup: an org node with its windowed
// completion %/pass % over the coverage beneath it.
export type NodeComplianceRow = {
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

// A store's per-survey detail when you drill all the way down: one block per
// survey version covering the store. items/questions are ALWAYS present (empty
// when the store has no response in the window).
export type StoreSurveyBlock = {
  survey_version_id: string
  survey_name: string
  responded: boolean
  items: DrillItem[]
  questions: Record<string, boolean | null>
  overall: boolean | null
}

// The node-compliance payload: either a non-store node's children (region ->
// district -> store) or a store's survey blocks. Discriminated on is_store.
export type NodeCompliance =
  | { is_store: false; children: NodeComplianceRow[] }
  | { is_store: true; name: string; surveys: StoreSurveyBlock[] }

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

// The compliance-by-node rollup for a node (omit nodeId for the caller's scope
// root). Windowed with the SAME range the dashboard uses, so the region rows
// aggregate to the headline "Avg. compliance" KPI. Each drill level calls this
// again with the child's node_id.
export function useNodeCompliance(nodeId: string | undefined, range: Range) {
  const { date_from, date_to } = rangeToDates(range)
  const params = new URLSearchParams({ date_from, date_to })
  if (nodeId) params.set('node_id', nodeId)
  return useQuery({
    queryKey: ['node-compliance', range, nodeId ?? 'root'],
    queryFn: () => apiGet<NodeCompliance>('/analytics/compliance/nodes?' + params.toString()),
  })
}
