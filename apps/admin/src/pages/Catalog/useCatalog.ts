import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiSend } from '@intelli/api-client'

export type Sku = {
  id: string
  line: string
  variant: string
  upc: string
  color: string | null
  status: 'active' | 'discontinued'
  reference_images: { url?: string; label?: string }[]
  created_at: string
}

export type SkuInput = {
  line: string
  variant: string
  upc: string
  color?: string | null
  status?: 'active' | 'discontinued'
}

export type StatusFilter = 'all' | 'active' | 'discontinued'
export type LineGroup = { line: string; skus: Sku[] }

// The catalog list. The backend already orders by (line, variant).
export function useSkus() {
  return useQuery({
    queryKey: ['skus'],
    queryFn: () => apiGet<{ skus: Sku[]; count: number }>('/skus'),
  })
}

export function useCreateSku() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: SkuInput) => apiSend<Sku>('POST', '/skus', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['skus'] }),
  })
}

export function useUpdateSku() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<SkuInput> }) =>
      apiSend<Sku>('PATCH', `/skus/${id}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['skus'] }),
  })
}

// ----- pure helpers (unit-tested) -----

export function groupByLine(skus: Sku[]): LineGroup[] {
  const map = new Map<string, Sku[]>()
  for (const s of skus) {
    const arr = map.get(s.line) ?? []
    arr.push(s)
    map.set(s.line, arr)
  }
  return [...map.entries()]
    .map(([line, items]) => ({ line, skus: items }))
    .sort((a, b) => a.line.localeCompare(b.line))
}

export function catalogStats(skus: Sku[]): { lines: number; total: number; active: number } {
  return {
    lines: new Set(skus.map((s) => s.line)).size,
    total: skus.length,
    active: skus.filter((s) => s.status === 'active').length,
  }
}

const normUpc = (s: string) => s.replace(/\s/g, '').toLowerCase()

export function filterSkus(
  skus: Sku[],
  { status, query }: { status: StatusFilter; query: string },
): Sku[] {
  const q = query.trim().toLowerCase()
  const qUpc = normUpc(query)
  return skus.filter((s) => {
    if (status !== 'all' && s.status !== status) return false
    if (!q) return true
    return (
      s.variant.toLowerCase().includes(q) ||
      s.line.toLowerCase().includes(q) ||
      normUpc(s.upc).includes(qUpc)
    )
  })
}

export function photoCount(sku: Sku): number {
  return (sku.reference_images ?? []).filter((p) => p && p.url).length
}
