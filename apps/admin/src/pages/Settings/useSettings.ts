import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiSend } from '../../lib/api'

export type Tenant = {
  id: string
  name: string
  code: string
  payroll_enabled: boolean
}

export type TenantDraft = { name: string; payroll_enabled: boolean }
export type TenantPatch = Partial<TenantDraft>

export function useTenant() {
  return useQuery({
    queryKey: ['tenant'],
    queryFn: () => apiGet<Tenant>('/tenants'),
  })
}

export function useUpdateTenant() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: TenantPatch) => apiSend<Tenant>('PATCH', '/tenants', body),
    onSuccess: (t) => {
      qc.setQueryData(['tenant'], t)
      qc.invalidateQueries({ queryKey: ['tenant'] })
    },
  })
}

// Only the fields that differ from the saved tenant (so we PATCH the minimum).
export function tenantChanges(current: Tenant, draft: TenantDraft): TenantPatch {
  const out: TenantPatch = {}
  if (draft.name !== current.name) out.name = draft.name
  if (draft.payroll_enabled !== current.payroll_enabled) out.payroll_enabled = draft.payroll_enabled
  return out
}
