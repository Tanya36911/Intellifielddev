import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiSend, ApiError, downloadCsv } from '../../lib/api'

// ---- Types ----

export type PayPeriod = {
  id: string
  label: string
  start_date: string
  end_date: string
  cutoff_iso: string
  grace_hours: number
  status: 'open' | 'sealed'
  sealed_at?: string | null
}

export type EntryStatus = 'pending' | 'approved' | 'flagged' | 'reopened'

export type TimeEntry = {
  id: string
  period_id: string
  rep_id: string
  rep_name: string
  region: string
  tz_abbr: string
  avatar_color: string
  visits: number
  store_minutes: number
  reset_minutes: number
  drive_minutes: number
  miles: number
  status: EntryStatus
  flag_reason: string | null
}

export type AuditEntry = {
  id: string
  period_id: string
  who: string
  rep_name: string
  reason: string
  created_at: string
}

// ---- Pure helpers (unit-tested) ----

export function minutesToHours(minutes: number): string {
  return (minutes / 60).toFixed(1)
}

export type PayrollStats = {
  pending: number
  flagged: number
  approved: number
  totalMiles: number
}

export function calcStats(entries: TimeEntry[]): PayrollStats {
  return {
    pending: entries.filter((e) => e.status === 'pending').length,
    flagged: entries.filter((e) => e.status === 'flagged').length,
    approved: entries.filter((e) => e.status === 'approved' || e.status === 'reopened').length,
    totalMiles: entries.reduce((sum, e) => sum + e.miles, 0),
  }
}

export function canSeal(entries: TimeEntry[]): boolean {
  if (entries.length === 0) return false
  return entries.every((e) => e.status === 'approved' || e.status === 'reopened')
}

export function formatPeriodLabel(period: PayPeriod): string {
  const fmt = (iso: string) => {
    const d = new Date(iso)
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }
  return `${fmt(period.start_date)} - ${fmt(period.end_date)}`
}

export function formatTs(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
    ' ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

// ---- Queries ----

export function usePayPeriods() {
  return useQuery({
    queryKey: ['pay-periods'],
    queryFn: () => apiGet<{ periods: PayPeriod[] }>('/pay-periods'),
  })
}

export function useTimeEntries(periodId: string | null) {
  return useQuery({
    queryKey: ['time-entries', periodId],
    queryFn: () => apiGet<{ entries: TimeEntry[] }>(`/time-entries?period_id=${periodId}`),
    enabled: !!periodId,
  })
}

export function useAuditLog(periodId: string | null) {
  return useQuery({
    queryKey: ['audit', periodId],
    queryFn: () => apiGet<{ entries: AuditEntry[] }>(`/audit?period_id=${periodId}`),
    enabled: !!periodId,
  })
}

// ---- Mutations ----

export function useApproveEntry() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiSend<TimeEntry>('POST', `/time-entries/${id}/approve`, {}),
    onSuccess: (_data, id, _ctx) => {
      qc.invalidateQueries({ queryKey: ['time-entries'] })
    },
  })
}

export function useRejectEntry() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiSend<TimeEntry>('POST', `/time-entries/${id}/reject`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['time-entries'] }),
  })
}

export function useSealPeriod() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (periodId: string) => apiSend<PayPeriod>('POST', `/pay-periods/${periodId}/seal`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pay-periods'] })
      qc.invalidateQueries({ queryKey: ['time-entries'] })
    },
  })
}

export function useReopenEntry() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      apiSend<TimeEntry>('POST', `/time-entries/${id}/reopen`, { reason }),
    onSuccess: (_data, { id: _id }) => {
      qc.invalidateQueries({ queryKey: ['time-entries'] })
      qc.invalidateQueries({ queryKey: ['audit'] })
    },
  })
}

export async function exportPayroll(periodId: string): Promise<void> {
  await downloadCsv(`/export/payroll?format=csv&period_id=${periodId}`, 'payroll.csv')
}

// Check if error is payroll-disabled (403)
export function isPayrollDisabled(err: unknown): boolean {
  return err instanceof ApiError && err.status === 403
}
