import { useQuery } from '@tanstack/react-query'
import { apiGet } from '@intelli/api-client'
import {
  useNodeCompliance,
  type NodeCompliance,
  type NodeComplianceRow,
  type StoreSurveyBlock,
  type DrillItem,
  type Range,
} from '../Dashboard/useDashboard'

// Re-export the drill hook + types so the Compliance screen has one import home.
export { useNodeCompliance }
export type { NodeCompliance, NodeComplianceRow, StoreSurveyBlock, DrillItem, Range }

// A crumb in the drill path: the branch root, then each node drilled into.
export type Crumb = { id: string | undefined; name: string }

// A SKU as the catalog returns it; we only need id -> shade name + colour so a
// failing facings item can read "Rosewood (2 facings)" instead of a raw sku id.
type Sku = { id: string; variant: string; color: string | null; line: string }

export type SkuInfo = { variant: string; color: string | null }

// One small /skus fetch, reshaped into a lookup map. The catalog is branch-wide
// reference data (company-scoped), so this is safe and cheap.
export function useSkuMap() {
  return useQuery({
    queryKey: ['skus'],
    queryFn: async (): Promise<Record<string, SkuInfo>> => {
      const data = await apiGet<{ skus: Sku[] }>('/skus')
      const map: Record<string, SkuInfo> = {}
      for (const s of data.skus) map[s.id] = { variant: s.variant, color: s.color }
      return map
    },
  })
}

// How many of a survey block's questions passed vs were scored (a question is
// scored when it has a true/false verdict; null means not-scored, not counted).
export function checkCounts(block: StoreSurveyBlock): { passed: number; scored: number } {
  let passed = 0
  let scored = 0
  for (const verdict of Object.values(block.questions)) {
    if (verdict == null) continue
    scored += 1
    if (verdict) passed += 1
  }
  return { passed, scored }
}

// The failing per-SKU items in a block (pass === false and tied to a SKU),
// enriched with the shade's name + colour for display. These are the actionable
// gaps a manager reviews ("Rosewood: 2", "Mauve: out of stock").
export type FailingItem = {
  sku_id: string
  variant: string
  color: string | null
  value: unknown
}

export function failingItems(
  block: StoreSurveyBlock,
  skuMap: Record<string, SkuInfo>,
): FailingItem[] {
  return block.items
    .filter((it: DrillItem) => it.pass === false && it.sku_id != null)
    .map((it) => {
      const info = skuMap[it.sku_id as string]
      return {
        sku_id: it.sku_id as string,
        variant: info?.variant ?? 'Unknown product',
        color: info?.color ?? null,
        value: it.value,
      }
    })
}

// Render a facings answer as plain text: 0 reads "out of stock", a number reads
// "N facings", anything else falls back to its string form.
export function valueLabel(value: unknown): string {
  if (value === 0 || value === '0') return 'out of stock'
  if (typeof value === 'number') return `${value} facings`
  if (value == null) return ''
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}
