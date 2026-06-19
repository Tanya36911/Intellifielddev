import { describe, expect, it } from 'vitest'
import { rangeToDates } from './useDashboard'

describe('rangeToDates', () => {
  it('maps 4w to a 28-day window ending now', () => {
    const { date_from, date_to } = rangeToDates('4w', new Date('2026-06-19T00:00:00Z'))
    expect(date_to).toBe('2026-06-19T00:00:00.000Z')
    expect(date_from).toBe('2026-05-22T00:00:00.000Z') // 28 days earlier
  })
  it('maps YTD to Jan 1 of the current year', () => {
    const { date_from } = rangeToDates('YTD', new Date('2026-06-19T00:00:00Z'))
    expect(date_from).toBe('2026-01-01T00:00:00.000Z')
  })
})
