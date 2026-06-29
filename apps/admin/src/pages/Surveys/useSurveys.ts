import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiSend } from '@intelli/api-client'
import type { Sku } from '../Catalog/useCatalog'

export type QType = 'boolean' | 'number' | 'single_choice' | 'multi_choice' | 'photo' | 'text'
export type PassRule = { operator: string; value: boolean | number | string | (string | number)[] }

export type BuilderQuestion = {
  id: string
  type: QType
  prompt: string
  required: boolean
  unit: string
  options: string[]
  perSku: boolean
  lines: string[]
  skuIds: string[]
  passScope: 'each' | 'total'
  pass: PassRule | null
}

export type BackendQuestion = {
  id: string
  prompt: string
  type: QType
  options: string[]
  sku_ids: string[]
  perSku: boolean
  pass: PassRule | null
  passScope: 'each' | 'total'
  required: boolean
  unit: string | null
  lines: string[]
}

export type Survey = {
  id: string; name: string; type: string | null
  status: 'draft' | 'published' | 'archived'
  created_at: string; latest_version: number; assigned: boolean
}
export type SurveyVersion = {
  id: string; survey_id: string; version_number: number
  questions: BackendQuestion[]; published_at: string | null; created_at: string
}
export type SurveyDetail = Omit<Survey, 'latest_version' | 'assigned'> & { versions: SurveyVersion[] }

export type Node = {
  id: string; name: string; code: string; level_order: number
  parent_id: string | null; path: string
}

export const SCORABLE = new Set<QType>(['boolean', 'number', 'single_choice'])
export const OP_LABEL: Record<string, string> = {
  '>=': '>=', '<=': '<=', '>': '>', '<': '<', '==': '=',
}

// ----- hooks -----
export function useSurveyList() {
  return useQuery({ queryKey: ['surveys'], queryFn: () => apiGet<{ surveys: Survey[] }>('/surveys') })
}
export function useSurvey(id: string | undefined) {
  return useQuery({
    queryKey: ['surveys', id],
    queryFn: () => apiGet<SurveyDetail>(`/surveys/${id}`),
    enabled: !!id,
  })
}
export function useNodes() {
  return useQuery({ queryKey: ['nodes'], queryFn: () => apiGet<{ nodes: Node[] }>('/nodes') })
}
export function useCreateSurvey() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { name: string; questions: BackendQuestion[] }) =>
      apiSend<SurveyDetail>('POST', '/surveys', { ...body, type: null }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['surveys'] }),
  })
}
export function useUpdateVersion() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ surveyId, versionId, questions }: { surveyId: string; versionId: string; questions: BackendQuestion[] }) =>
      apiSend<SurveyVersion>('PATCH', `/surveys/${surveyId}/versions/${versionId}`, { questions }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['surveys'] }),
  })
}
export function usePublish() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (surveyId: string) => apiSend<SurveyDetail>('POST', `/surveys/${surveyId}/publish`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['surveys'] }),
  })
}
export function useNewVersion() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (surveyId: string) => apiSend<SurveyVersion>('POST', `/surveys/${surveyId}/versions`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['surveys'] }),
  })
}
export function useCreateAssignment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { survey_version_id: string; target_node_id: string; deadline: string | null; timezone_basis: string }) =>
      apiSend<{ id: string }>('POST', '/survey-assignments', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['surveys'] }),
  })
}

// ----- pure helpers -----

// Pick the published version id with the highest version_number.
// Returns null when no published version exists.
export function pickPublishedVersionId(versions: SurveyVersion[]): string | null {
  const published = versions.filter((v) => v.published_at !== null)
  if (published.length === 0) return null
  return published.reduce((a, b) => (b.version_number > a.version_number ? b : a)).id
}

export function blankQuestion(type: QType): BuilderQuestion {
  return {
    id: 'q' + Math.random().toString(36).slice(2, 9),
    type, prompt: '', required: false, unit: '', options: type === 'single_choice' || type === 'multi_choice' ? ['Option 1'] : [],
    perSku: false, lines: [], skuIds: [], passScope: 'each', pass: null,
  }
}

export function expandLinesToSkuIds(lines: string[], skus: Sku[]): string[] {
  const set = new Set(lines)
  return skus.filter((s) => set.has(s.line) && s.status === 'active').map((s) => s.id)
}

// catalog is accepted for API symmetry (callers may pass it) but sku_ids are
// sent verbatim from the builder state, never re-derived here.
export function mapToBackendQuestion(q: BuilderQuestion, _catalog?: Sku[]): BackendQuestion {
  const isNumber = q.type === 'number'
  const scored = SCORABLE.has(q.type) ? q.pass : null
  return {
    id: q.id,
    prompt: q.prompt,
    type: q.type,
    options: q.type === 'single_choice' || q.type === 'multi_choice' ? q.options : [],
    sku_ids: q.perSku ? q.skuIds : [],
    perSku: q.perSku,
    pass: scored,
    passScope: (isNumber && q.perSku) ? q.passScope : 'each',
    required: q.required,
    unit: isNumber && q.unit.trim() ? q.unit.trim() : null,
    lines: q.perSku ? q.lines : [],
  }
}

export function mapFromBackendQuestion(b: BackendQuestion): BuilderQuestion {
  return {
    id: b.id,
    type: b.type,
    prompt: b.prompt,
    required: b.required ?? false,
    unit: b.unit ?? '',
    options: b.options ?? [],
    perSku: b.perSku ?? false,
    lines: b.lines ?? [],
    skuIds: b.sku_ids ?? [],
    passScope: b.passScope ?? 'each',
    pass: b.pass ?? null,
  }
}

export function passSummary(q: BuilderQuestion): string | null {
  if (!q.pass) return null
  if (q.type === 'boolean') return q.pass.value === true ? 'Pass = Yes' : q.pass.value === false ? 'Pass = No' : null
  if (q.type === 'number') {
    const op = OP_LABEL[q.pass.operator] ?? q.pass.operator
    const unit = q.unit.trim() ? ` ${q.unit.trim()}` : ''
    const scope = q.perSku ? (q.passScope === 'total' ? 'total ' : 'each ') : ''
    return `Pass = ${scope}${op} ${q.pass.value}${unit}`
  }
  if (q.type === 'single_choice') {
    const vals = Array.isArray(q.pass.value) ? q.pass.value : [q.pass.value]
    return vals.length ? `Pass = ${vals.join(' / ')}` : null
  }
  return null
}

export function surveyStats(surveys: Pick<Survey, 'status'>[]): { total: number; published: number; draft: number } {
  return {
    total: surveys.length,
    published: surveys.filter((s) => s.status === 'published').length,
    draft: surveys.filter((s) => s.status === 'draft').length,
  }
}
