import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import { renderApp } from '../../test/render'
import { adminSession, repSession } from '../../test/fixtures'
import Payroll from './Payroll'
import { apiGet, apiSend, downloadCsv, ApiError } from '../../lib/api'
import type { PayPeriod, TimeEntry, AuditEntry } from './usePayroll'

vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api')>()
  return { ...actual, apiGet: vi.fn(), apiSend: vi.fn(), downloadCsv: vi.fn() }
})

// ---- Fixtures ----

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

const mkAudit = (over: Partial<AuditEntry>): AuditEntry => ({
  id: 'a1',
  period_id: 'p2',
  who: 'Sarah Mitchell',
  rep_name: 'Devin Walsh',
  reason: 'Corrected mis-logged drive time',
  created_at: '2026-05-20T09:14:00Z',
  ...over,
})

const OPEN_PERIOD = mkPeriod({ id: 'p1', status: 'open' })
const SEALED_PERIOD = mkPeriod({
  id: 'p2',
  status: 'sealed',
  start_date: '2026-05-16',
  end_date: '2026-05-31',
  sealed_at: '2026-06-01T00:04:00Z',
})

const OPEN_ENTRIES = [
  mkEntry({ id: 'e1', rep_name: 'Marcus Bell', status: 'approved', miles: 218 }),
  mkEntry({ id: 'e2', rep_name: 'Aisha Kim', status: 'pending', miles: 109 }),
  mkEntry({ id: 'e3', rep_name: 'Jordan Rivera', status: 'flagged', flag_reason: 'Drive time unusually high', miles: 187 }),
]

const SEALED_ENTRIES = [
  mkEntry({ id: 'e4', period_id: 'p2', rep_name: 'Marcus Bell', status: 'approved', miles: 210 }),
  mkEntry({ id: 'e5', period_id: 'p2', rep_name: 'Devin Walsh', status: 'reopened', miles: 184 }),
]

const AUDIT_ENTRIES = [
  mkAudit({ id: 'a1', who: 'Sarah Mitchell', rep_name: 'Devin Walsh', reason: 'Corrected drive time' }),
]

function mockApiGetBothPeriods() {
  vi.mocked(apiGet).mockImplementation((path: string) => {
    if (path === '/pay-periods') return Promise.resolve({ periods: [OPEN_PERIOD, SEALED_PERIOD] })
    if (path.startsWith('/time-entries') && path.includes('p1')) return Promise.resolve({ entries: OPEN_ENTRIES })
    if (path.startsWith('/time-entries') && path.includes('p2')) return Promise.resolve({ entries: SEALED_ENTRIES })
    if (path.startsWith('/audit')) return Promise.resolve({ entries: AUDIT_ENTRIES })
    return Promise.resolve({ entries: [], periods: [] })
  })
}

function mockApiGetOpenOnly() {
  vi.mocked(apiGet).mockImplementation((path: string) => {
    if (path === '/pay-periods') return Promise.resolve({ periods: [OPEN_PERIOD] })
    if (path.startsWith('/time-entries')) return Promise.resolve({ entries: OPEN_ENTRIES })
    return Promise.resolve({ entries: [] })
  })
}

function mockApiGetAllApproved() {
  vi.mocked(apiGet).mockImplementation((path: string) => {
    if (path === '/pay-periods') return Promise.resolve({ periods: [OPEN_PERIOD] })
    if (path.startsWith('/time-entries')) {
      return Promise.resolve({
        entries: OPEN_ENTRIES.map((e) => ({ ...e, status: 'approved' as const })),
      })
    }
    return Promise.resolve({ entries: [] })
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ---- Tests ----

describe('Payroll (admin) - open period', () => {
  it('renders period selector, stat tiles, and the hours table', async () => {
    mockApiGetOpenOnly()
    renderApp(<Payroll />, { session: adminSession() })

    // Wait for entries to load (generous timeout since this is the first test)
    expect(await screen.findByText('Marcus Bell', {}, { timeout: 3000 })).toBeTruthy()
    // stat tile labels (multiple "Pending" and "Flagged" expected: label + chip)
    expect(screen.getAllByText('Pending').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Flagged').length).toBeGreaterThan(0)
    expect(screen.getByText('Reimbursable mileage')).toBeTruthy()
    // Jordan's flag sub-row shows the reason
    expect(screen.getByText('Drive time unusually high')).toBeTruthy()
  })

  it('shows Approve button for pending entries and calls the backend on click', async () => {
    mockApiGetOpenOnly()
    vi.mocked(apiSend).mockResolvedValue(mkEntry({ id: 'e2', status: 'approved' }) as never)
    renderApp(<Payroll />, { session: adminSession() })

    await screen.findByText('Aisha Kim')
    // There are multiple approve buttons - click the first one (Aisha's, since Marcus is approved)
    const approveButtons = screen.getAllByRole('button', { name: /approve/i })
    // Filter to the "Approve" buttons in the table (not "Approve all pending")
    const tableApprove = approveButtons.filter((b) => !b.textContent?.includes('all'))
    fireEvent.click(tableApprove[0])

    await waitFor(() =>
      expect(apiSend).toHaveBeenCalledWith('POST', '/time-entries/e2/approve', {}),
    )
  })

  it('shows Clear & approve for flagged entries and calls the backend', async () => {
    mockApiGetOpenOnly()
    vi.mocked(apiSend).mockResolvedValue(mkEntry({ id: 'e3', status: 'approved' }) as never)
    renderApp(<Payroll />, { session: adminSession() })

    await screen.findByText('Jordan Rivera')
    fireEvent.click(screen.getByRole('button', { name: /clear.*approve/i }))

    await waitFor(() =>
      expect(apiSend).toHaveBeenCalledWith('POST', '/time-entries/e3/approve', {}),
    )
  })

  it('shows Approve all pending button when there are pending entries', async () => {
    mockApiGetOpenOnly()
    vi.mocked(apiSend).mockResolvedValue(mkEntry({ status: 'approved' }) as never)
    renderApp(<Payroll />, { session: adminSession() })

    await screen.findByText('Marcus Bell')
    expect(screen.getByRole('button', { name: /approve all pending/i })).toBeTruthy()
  })

  it('Seal period button is disabled when not all approved', async () => {
    mockApiGetOpenOnly()
    renderApp(<Payroll />, { session: adminSession() })

    await screen.findByText('Marcus Bell')
    const sealBtn = screen.getByRole('button', { name: /seal period/i })
    expect(sealBtn).toBeDisabled()
    expect(screen.getByText(/all entries must be approved/i)).toBeTruthy()
  })

  it('Seal period button calls the backend when all entries are approved', async () => {
    mockApiGetAllApproved()
    vi.mocked(apiSend).mockResolvedValue(mkPeriod({ status: 'sealed' }) as never)
    renderApp(<Payroll />, { session: adminSession() })

    await screen.findByText('Marcus Bell')
    const sealBtn = screen.getByRole('button', { name: /seal period/i })
    expect(sealBtn).not.toBeDisabled()
    fireEvent.click(sealBtn)

    await waitFor(() =>
      expect(apiSend).toHaveBeenCalledWith('POST', '/pay-periods/p1/seal', {}),
    )
  })
})

describe('Payroll (admin) - sealed period', () => {
  it('shows the sealed banner and Reopen buttons', async () => {
    mockApiGetBothPeriods()
    renderApp(<Payroll />, { session: adminSession() })

    // Wait for open period to load
    await screen.findByText('Marcus Bell')

    // Click the Sealed segmented button (it contains "Sealed" in text)
    const sealedBtn = screen.getAllByRole('button').find(
      (b) => b.textContent?.startsWith('Sealed'),
    )
    expect(sealedBtn).toBeTruthy()
    fireEvent.click(sealedBtn!)

    // Wait for the sealed banner
    expect(await screen.findByText('Period sealed')).toBeTruthy()
    expect(screen.getByText('Hard lock')).toBeTruthy()

    // Marcus Bell (approved, not reopened) should have a Reopen button
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /reopen/i })).toBeTruthy()
    })
    // Devin Walsh (reopened) should show Grace window chip
    expect(screen.getByText('Grace window')).toBeTruthy()
  })

  it('Reopen modal requires a reason before confirming', async () => {
    mockApiGetBothPeriods()
    renderApp(<Payroll />, { session: adminSession() })

    await screen.findByText('Marcus Bell')
    const sealedBtn = screen.getAllByRole('button').find(
      (b) => b.textContent?.startsWith('Sealed'),
    )
    fireEvent.click(sealedBtn!)

    await screen.findByText('Period sealed')
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /reopen/i })).toBeTruthy()
    })
    fireEvent.click(screen.getByRole('button', { name: /reopen/i }))

    // Modal appears
    expect(await screen.findByRole('dialog')).toBeTruthy()
    const confirmBtn = screen.getByRole('button', { name: /reopen with grace/i })
    expect(confirmBtn).toBeDisabled()

    // Type a reason
    fireEvent.change(screen.getByLabelText('Reopen reason'), {
      target: { value: 'Corrected drive time' },
    })
    expect(screen.getByRole('button', { name: /reopen with grace/i })).not.toBeDisabled()
  })

  it('Reopen confirm calls the backend with reason', async () => {
    mockApiGetBothPeriods()
    vi.mocked(apiSend).mockResolvedValue(mkEntry({ id: 'e4', status: 'reopened' }) as never)
    renderApp(<Payroll />, { session: adminSession() })

    await screen.findByText('Marcus Bell')
    const sealedBtn = screen.getAllByRole('button').find(
      (b) => b.textContent?.startsWith('Sealed'),
    )
    fireEvent.click(sealedBtn!)

    await screen.findByText('Period sealed')
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /reopen/i })).toBeTruthy()
    })
    fireEvent.click(screen.getByRole('button', { name: /reopen/i }))
    await screen.findByRole('dialog')

    fireEvent.change(screen.getByLabelText('Reopen reason'), {
      target: { value: 'Corrected drive time entry' },
    })
    fireEvent.click(screen.getByRole('button', { name: /reopen with grace/i }))

    await waitFor(() =>
      expect(apiSend).toHaveBeenCalledWith(
        'POST',
        '/time-entries/e4/reopen',
        { reason: 'Corrected drive time entry' },
      ),
    )
  })

  it('audit log is visible to admin and shows existing entries', async () => {
    mockApiGetBothPeriods()
    renderApp(<Payroll />, { session: adminSession() })

    await screen.findByText('Marcus Bell')
    const sealedBtn = screen.getAllByRole('button').find(
      (b) => b.textContent?.startsWith('Sealed'),
    )
    fireEvent.click(sealedBtn!)

    await screen.findByText('Period sealed')
    expect(await screen.findByText('Reopen audit trail')).toBeTruthy()
    expect(await screen.findByText('Sarah Mitchell')).toBeTruthy()
  })
})

describe('Payroll (non-admin / manager)', () => {
  it('hides Seal period button for a manager', async () => {
    mockApiGetOpenOnly()
    const managerSession = {
      ...adminSession(),
      user: { ...adminSession().user, role: 'manager' },
    }
    renderApp(<Payroll />, { session: managerSession as NonNullable<Parameters<typeof renderApp>[1]>['session'] })

    await screen.findByText('Marcus Bell')
    expect(screen.queryByRole('button', { name: /seal period/i })).toBeNull()
  })

  it('rep user is redirected to / and sees no payroll table', async () => {
    mockApiGetOpenOnly()
    renderApp(<Payroll />, { session: repSession() })

    // Rep should be redirected - no payroll table should render
    await waitFor(() => {
      expect(screen.queryByText('Marcus Bell')).toBeNull()
      expect(screen.queryByRole('table')).toBeNull()
    })
  })
})

describe('Payroll - payroll disabled (403)', () => {
  it('shows the disabled state when payroll is off for the company', async () => {
    vi.mocked(apiGet).mockRejectedValue(new ApiError(403, 'Payroll not enabled'))
    renderApp(<Payroll />, { session: adminSession() })

    expect(await screen.findByText('Payroll is not enabled for this company')).toBeTruthy()
  })
})

describe('Payroll - empty state', () => {
  it('shows no periods message when list is empty', async () => {
    vi.mocked(apiGet).mockResolvedValue({ periods: [] })
    renderApp(<Payroll />, { session: adminSession() })

    expect(await screen.findByText('No pay periods yet')).toBeTruthy()
  })
})

describe('Payroll - non-403 error state', () => {
  it('shows error card when pay-periods query fails with a non-403 error', async () => {
    vi.mocked(apiGet).mockRejectedValue(new ApiError(500, 'Internal Server Error'))
    renderApp(<Payroll />, { session: adminSession() })

    expect(
      await screen.findByText('Something went wrong loading payroll. Try refreshing.'),
    ).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
  })
})

describe('Payroll - CSV download', () => {
  it('calls downloadCsv when Download CSV is clicked', async () => {
    mockApiGetOpenOnly()
    vi.mocked(downloadCsv).mockResolvedValue(undefined)
    renderApp(<Payroll />, { session: adminSession() })

    await screen.findByText('Marcus Bell')
    fireEvent.click(screen.getByRole('button', { name: /download csv/i }))

    await waitFor(() => expect(downloadCsv).toHaveBeenCalledTimes(1))
  })
})
