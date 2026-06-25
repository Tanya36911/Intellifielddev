import { describe, it, expect } from 'vitest'
import {
  minutesToHours,
  calcStats,
  canSeal,
  formatPeriodLabel,
  type TimeEntry,
  type PayPeriod,
} from './usePayroll'

const mkEntry = (over: Partial<TimeEntry>): TimeEntry => ({
  id: 'e1',
  period_id: 'p1',
  rep_id: 'r1',
  rep_name: 'Marcus Bell',
  region: 'Southeast',
  tz_abbr: 'CST',
  avatar_color: '#2563eb',
  visits: 18,
  store_minutes: 2490,
  reset_minutes: 360,
  drive_minutes: 270,
  miles: 218,
  status: 'pending',
  flag_reason: null,
  ...over,
})

const mkPeriod = (over: Partial<PayPeriod>): PayPeriod => ({
  id: 'p1',
  label: 'Jun 1 - Jun 15',
  start_date: '2026-06-01',
  end_date: '2026-06-15',
  cutoff_iso: '2026-06-15T23:59:00Z',
  grace_hours: 4,
  status: 'open',
  sealed_at: null,
  ...over,
})

describe('minutesToHours', () => {
  it('converts minutes to hours string with one decimal place', () => {
    expect(minutesToHours(90)).toBe('1.5')
    expect(minutesToHours(2490)).toBe('41.5')
    expect(minutesToHours(0)).toBe('0.0')
  })
})

describe('calcStats', () => {
  it('counts each status bucket and sums miles', () => {
    const entries = [
      mkEntry({ status: 'pending', miles: 100 }),
      mkEntry({ id: 'e2', status: 'flagged', miles: 50 }),
      mkEntry({ id: 'e3', status: 'approved', miles: 218 }),
      mkEntry({ id: 'e4', status: 'pending', miles: 0 }),
    ]
    const stats = calcStats(entries)
    expect(stats.pending).toBe(2)
    expect(stats.flagged).toBe(1)
    expect(stats.approved).toBe(1)
    expect(stats.totalMiles).toBe(368)
  })

  it('counts reopened entries as approved', () => {
    const stats = calcStats([mkEntry({ status: 'reopened', miles: 0 })])
    expect(stats.approved).toBe(1)
  })

  it('returns all zeros for empty list', () => {
    expect(calcStats([])).toEqual({ pending: 0, flagged: 0, approved: 0, totalMiles: 0 })
  })
})

describe('canSeal', () => {
  it('returns false if no entries', () => {
    expect(canSeal([])).toBe(false)
  })

  it('returns false if any entry is pending or flagged', () => {
    expect(canSeal([mkEntry({ status: 'approved' }), mkEntry({ id: 'e2', status: 'pending' })])).toBe(false)
    expect(canSeal([mkEntry({ status: 'approved' }), mkEntry({ id: 'e2', status: 'flagged' })])).toBe(false)
  })

  it('returns true when all entries are approved or reopened', () => {
    expect(canSeal([mkEntry({ status: 'approved' }), mkEntry({ id: 'e2', status: 'reopened' })])).toBe(true)
  })
})

describe('formatPeriodLabel', () => {
  it('formats start and end dates as month + day', () => {
    const label = formatPeriodLabel(mkPeriod({}))
    expect(label).toMatch(/Jun/)
    expect(label).toContain('-')
  })
})
