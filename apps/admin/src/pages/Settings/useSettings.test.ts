import { describe, it, expect } from 'vitest'
import { tenantChanges, type Tenant } from './useSettings'

const T: Tenant = { id: 't1', name: 'Lumen Beauty', code: 'lumen', payroll_enabled: true }

describe('tenantChanges', () => {
  it('returns nothing when unchanged', () => {
    expect(tenantChanges(T, { name: 'Lumen Beauty', payroll_enabled: true })).toEqual({})
  })
  it('returns only the changed name', () => {
    expect(tenantChanges(T, { name: 'New Co', payroll_enabled: true })).toEqual({ name: 'New Co' })
  })
  it('returns only the changed payroll flag', () => {
    expect(tenantChanges(T, { name: 'Lumen Beauty', payroll_enabled: false })).toEqual({ payroll_enabled: false })
  })
  it('returns both when both change', () => {
    expect(tenantChanges(T, { name: 'New Co', payroll_enabled: false })).toEqual({ name: 'New Co', payroll_enabled: false })
  })
})
