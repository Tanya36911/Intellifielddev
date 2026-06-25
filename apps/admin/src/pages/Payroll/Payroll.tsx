import { Fragment, useEffect, useReducer, useRef, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Avatar, Button, Card, Chip, Icon, Segmented } from '../../ui'
import { Topbar } from '../../shell/Topbar'
import { selectSession, useAppSelector } from '../../store'
import {
  calcStats,
  canSeal,
  exportPayroll,
  formatPeriodLabel,
  formatTs,
  isPayrollDisabled,
  minutesToHours,
  useApproveEntry,
  useAuditLog,
  usePayPeriods,
  useRejectEntry,
  useReopenEntry,
  useSealPeriod,
  useTimeEntries,
  type PayPeriod,
  type TimeEntry,
} from './usePayroll'
import { ReopenModal } from './ReopenModal'
import styles from './Payroll.module.css'

// ---- Countdown hook (ported from dm-payroll.jsx) ----
function useCountdown(targetISO: string) {
  const target = new Date(targetISO).getTime()
  const mount = useRef(Date.now())
  const [, force] = useReducer((x: number) => x + 1, 0)
  useEffect(() => {
    const t = setInterval(force, 1000)
    return () => clearInterval(t)
  }, [])
  const now = Date.now()
  const ms = Math.max(0, target - now)
  const h = Math.floor(ms / 3600000)
  const m = Math.floor((ms % 3600000) / 60000)
  const s = Math.floor((ms % 60000) / 1000)
  return { h, m, s, expired: ms === 0 }
}

const pad = (n: number) => String(n).padStart(2, '0')

// ---- Sub-components ----

function CountdownCard({ period }: { period: PayPeriod }) {
  const { h, m, s } = useCountdown(period.cutoff_iso)
  const urgent = h < 6
  return (
    <Card className={`${styles.countdown} ${urgent ? styles.countdownUrgent : ''}`}>
      <div className={styles.countdownEyebrow}>
        <Icon name="clock" size={13} />
        Period closes in
      </div>
      <div className={styles.timerRow}>
        {([
          [h, 'hrs'],
          [m, 'min'],
          [s, 'sec'],
        ] as [number, string][]).map(([v, l], i) => (
          <Fragment key={l}>
            {i > 0 && <span className={styles.timerColon}>:</span>}
            <div className={styles.timerUnit}>
              <div className={`${styles.timerDigit} ${urgent ? styles.timerDigitUrgent : ''}`}>
                {pad(v)}
              </div>
              <div className={styles.timerLabel}>{l}</div>
            </div>
          </Fragment>
        ))}
      </div>
      <hr className={styles.divider} />
      <div className={styles.countdownMeta}>
        <div className={styles.metaRow}>
          <span className={styles.metaMut}>After cutoff</span>
          <span className={styles.metaVal}>{period.grace_hours}h grace, then hard lock</span>
        </div>
        <div className={styles.metaRow}>
          <span className={styles.metaMut}>Basis</span>
          <span className={styles.metaVal}>
            <Icon name="globe" size={12} /> Rep-local
          </span>
        </div>
      </div>
    </Card>
  )
}

function StatTile({
  label,
  value,
  tone,
}: {
  label: string
  value: string | number
  tone?: 'amber' | 'red' | 'green'
}) {
  return (
    <Card className={styles.statTile}>
      <div className={styles.statTileLabel}>{label}</div>
      <div
        className={`${styles.statTileValue} ${
          tone === 'amber'
            ? styles.toneAmber
            : tone === 'red'
              ? styles.toneRed
              : tone === 'green'
                ? styles.toneGreen
                : ''
        }`}
      >
        {value}
      </div>
    </Card>
  )
}

function HoursCell({ minutes, unit }: { minutes: number; unit: string }) {
  return (
    <span className={styles.mono}>
      {minutesToHours(minutes)}
      <span className={styles.unit}>{unit}</span>
    </span>
  )
}

function StatusChip({ status }: { status: TimeEntry['status'] }) {
  if (status === 'approved') return <Chip tone="green">Approved</Chip>
  if (status === 'flagged') return <Chip tone="red">Flagged</Chip>
  if (status === 'reopened') return <Chip tone="amber">Reopened</Chip>
  return <Chip>Pending</Chip>
}

function OpenTableRow({
  entry,
  isManagerOrAdmin,
  onApprove,
  onFlag,
}: {
  entry: TimeEntry
  isManagerOrAdmin: boolean
  onApprove: (id: string) => void
  onFlag: (id: string) => void
}) {
  const flagged = entry.status === 'flagged'
  return (
    <Fragment>
      <tr className={flagged ? styles.flagRow : undefined}>
        <td className={styles.repCell}>
          <Avatar name={entry.rep_name} color={entry.avatar_color} size={26} />
          <div>
            <div className={styles.repName}>{entry.rep_name}</div>
            <div className={styles.repHint}>
              {entry.region}, {entry.tz_abbr}
            </div>
          </div>
        </td>
        <td>
          <span className={styles.mono}>{entry.visits}</span>
        </td>
        <td>
          <HoursCell minutes={entry.store_minutes} unit="h" />
        </td>
        <td>
          <HoursCell minutes={entry.reset_minutes} unit="h" />
        </td>
        <td>
          <HoursCell minutes={entry.drive_minutes} unit="h" />
        </td>
        <td>
          <span className={styles.mono}>
            {entry.miles}
            <span className={styles.unit}> mi</span>
          </span>
        </td>
        <td>
          <StatusChip status={entry.status} />
        </td>
        <td className={styles.actionCell}>
          {isManagerOrAdmin && (
            <div className={styles.actionGroup}>
              {entry.status === 'flagged' && (
                <Button size="sm" variant="primary" onClick={() => onApprove(entry.id)}>
                  Clear &amp; approve
                </Button>
              )}
              {entry.status !== 'flagged' && entry.status !== 'approved' && (
                <Button size="sm" variant="primary" onClick={() => onApprove(entry.id)}>
                  <Icon name="check" size={12} /> Approve
                </Button>
              )}
              {entry.status !== 'flagged' && (
                <Button
                  size="sm"
                  onClick={() => onFlag(entry.id)}
                  title="Flag for review"
                  aria-label="Flag"
                >
                  <Icon name="alert" size={12} />
                  {entry.status === 'approved' ? ' Flag' : ''}
                </Button>
              )}
            </div>
          )}
        </td>
      </tr>
      {flagged && entry.flag_reason && (
        <tr className={styles.flagRow}>
          <td colSpan={8} className={styles.flagNote}>
            <Icon name="info" size={13} /> {entry.flag_reason}
          </td>
        </tr>
      )}
    </Fragment>
  )
}

function SealedTableRow({
  entry,
  isAdmin,
  onReopen,
}: {
  entry: TimeEntry
  isAdmin: boolean
  onReopen: (entry: TimeEntry) => void
}) {
  const reopened = entry.status === 'reopened'
  return (
    <tr className={reopened ? styles.reopenedRow : undefined}>
      <td className={styles.repCell}>
        <Avatar name={entry.rep_name} color={entry.avatar_color} size={26} />
        <div>
          <div className={styles.repName}>{entry.rep_name}</div>
          <div className={styles.repHint}>
            {entry.region}, {entry.tz_abbr}
          </div>
        </div>
      </td>
      <td>
        <span className={styles.mono}>{entry.visits}</span>
      </td>
      <td>
        <HoursCell minutes={entry.store_minutes} unit="h" />
      </td>
      <td>
        <HoursCell minutes={entry.reset_minutes} unit="h" />
      </td>
      <td>
        <HoursCell minutes={entry.drive_minutes} unit="h" />
      </td>
      <td>
        <span className={styles.mono}>
          {entry.miles}
          <span className={styles.unit}> mi</span>
        </span>
      </td>
      <td>
        <StatusChip status={entry.status} />
      </td>
      <td className={styles.actionCell}>
        {isAdmin && !reopened && (
          <Button size="sm" onClick={() => onReopen(entry)}>
            <Icon name="lock" size={12} /> Reopen
          </Button>
        )}
        {reopened && <Chip tone="amber">Grace window</Chip>}
      </td>
    </tr>
  )
}

// ---- Main page ----

export default function Payroll() {
  const session = useAppSelector(selectSession)
  const isAdmin = session?.user.role === 'admin'
  const isManagerOrAdmin = isAdmin || session?.user.role === 'manager'

  // All hooks must come before any conditional return (React rules of hooks)
  const queryClient = useQueryClient()
  const periodsQuery = usePayPeriods()
  const periods = periodsQuery.data?.periods ?? []

  // Tab: which period is selected (we show open vs sealed)
  const openPeriod = periods.find((p) => p.status === 'open') ?? null
  const sealedPeriods = periods.filter((p) => p.status === 'sealed')
  const latestSealed = sealedPeriods[0] ?? null

  const [tab, setTab] = useState<'open' | 'sealed'>('open')
  const activePeriod = tab === 'open' ? openPeriod : latestSealed

  const entriesQuery = useTimeEntries(activePeriod?.id ?? null)
  const entries = entriesQuery.data?.entries ?? []

  const auditQuery = useAuditLog(tab === 'sealed' && isAdmin ? activePeriod?.id ?? null : null)
  const auditEntries = auditQuery.data?.entries ?? []

  const approveEntry = useApproveEntry()
  const rejectEntry = useRejectEntry()
  const sealPeriod = useSealPeriod()
  const reopenEntry = useReopenEntry()

  const [reopenTarget, setReopenTarget] = useState<TimeEntry | null>(null)
  const [csvLoading, setCsvLoading] = useState(false)

  // Fix 1: non-manager/admin reps must not see this screen (guard after all hooks)
  if (!isManagerOrAdmin) {
    return <Navigate to="/" replace />
  }

  // Payroll disabled: 403 from the periods query
  const payrollDisabled =
    isPayrollDisabled(periodsQuery.error) || isPayrollDisabled(entriesQuery.error)

  const stats = calcStats(entries)
  const sealable = canSeal(entries)

  // Fix 2: include reset_minutes in the sealed-period total hours
  const totalHours = (
    entries.reduce((sum, e) => sum + e.store_minutes + e.reset_minutes + e.drive_minutes, 0) / 60
  ).toFixed(1)

  async function handleExport() {
    if (!activePeriod) return
    setCsvLoading(true)
    try {
      await exportPayroll(activePeriod.id)
    } finally {
      setCsvLoading(false)
    }
  }

  // Loading state
  if (periodsQuery.isLoading) {
    return (
      <>
        <Topbar title="Payroll" subtitle="Review and approve rep field time." />
        <div className={styles.scroll}>
          <div className={styles.page}>
            <div className={styles.note}>Loading...</div>
          </div>
        </div>
      </>
    )
  }

  // Fix 3: non-403 error from pay-periods query (e.g. 500/timeout)
  if (periodsQuery.error && !payrollDisabled) {
    return (
      <>
        <Topbar title="Payroll" subtitle="Review and approve rep field time." />
        <div className={styles.scroll}>
          <div className={styles.page}>
            <Card className={styles.empty}>
              <div className={styles.emptyIcon}>
                <Icon name="alert" size={26} />
              </div>
              <div className={styles.emptyTitle}>Something went wrong loading payroll. Try refreshing.</div>
            </Card>
          </div>
        </div>
      </>
    )
  }

  // Payroll feature disabled for this company
  if (payrollDisabled) {
    return (
      <>
        <Topbar title="Payroll" subtitle="Review and approve rep field time." />
        <div className={styles.scroll}>
          <div className={styles.page}>
            <Card className={styles.empty}>
              <div className={styles.emptyIcon}>
                <Icon name="lock" size={26} />
              </div>
              <div className={styles.emptyTitle}>Payroll is not enabled for this company</div>
              <div className={styles.emptyHint}>
                Contact your administrator to enable the payroll feature.
              </div>
            </Card>
          </div>
        </div>
      </>
    )
  }

  // No periods yet
  const noPeriods = !periodsQuery.isLoading && periods.length === 0

  return (
    <>
      <Topbar title="Payroll" subtitle="Review and approve rep field time. Cutoffs are in rep-local time.">
        {tab === 'open' && isManagerOrAdmin && stats.pending > 0 && (
          <Button
            size="sm"
            variant="primary"
            onClick={async () => {
              // Fix 5: batch approvals and do a single cache invalidation afterwards
              const pending = entries.filter((e) => e.status === 'pending')
              await Promise.allSettled(
                pending.map((e) => approveEntry.mutateAsync(e.id)),
              )
              queryClient.invalidateQueries({ queryKey: ['time-entries'] })
            }}
          >
            <Icon name="check" size={14} /> Approve all pending ({stats.pending})
          </Button>
        )}
        <Button size="sm" onClick={handleExport} disabled={!activePeriod || csvLoading}>
          <Icon name="download" size={14} /> {csvLoading ? 'Downloading...' : 'Download CSV'}
        </Button>
      </Topbar>

      <div className={styles.scroll}>
        <div className={styles.page}>
          {noPeriods && (
            <Card className={styles.empty}>
              <div className={styles.emptyIcon}>
                <Icon name="clock" size={26} />
              </div>
              <div className={styles.emptyTitle}>No pay periods yet</div>
              <div className={styles.emptyHint}>Pay periods are created by your administrator.</div>
            </Card>
          )}

          {!noPeriods && (
            <>
              {/* Period selector */}
              <div className={styles.periodSelector}>
                <Segmented
                  options={[
                    openPeriod
                      ? `Open  ${formatPeriodLabel(openPeriod)}`
                      : 'Open',
                    latestSealed
                      ? `Sealed  ${formatPeriodLabel(latestSealed)}`
                      : 'Sealed',
                  ]}
                  value={tab === 'open'
                    ? (openPeriod ? `Open  ${formatPeriodLabel(openPeriod)}` : 'Open')
                    : (latestSealed ? `Sealed  ${formatPeriodLabel(latestSealed)}` : 'Sealed')
                  }
                  onChange={(v) => {
                    // Fix 4: clear reopenTarget when switching tabs so modal can't show stale period
                    setReopenTarget(null)
                    setTab(v.startsWith('Open') ? 'open' : 'sealed')
                  }}
                />
                <span className={styles.periodHint}>
                  {activePeriod ? `${activePeriod.grace_hours}h grace window after cutoff` : ''}
                </span>
              </div>

              {/* Open period view */}
              {tab === 'open' && openPeriod && (
                <>
                  <div className={styles.openTop}>
                    <div className={styles.countdownWrap}>
                      <CountdownCard period={openPeriod} />
                    </div>
                    <div className={styles.statGrid}>
                      <StatTile label="Pending" value={stats.pending} tone="amber" />
                      <StatTile label="Flagged" value={stats.flagged} tone="red" />
                      <StatTile label="Approved" value={stats.approved} tone="green" />
                      <StatTile
                        label="Reimbursable mileage"
                        value={`${stats.totalMiles.toLocaleString()} mi`}
                      />
                    </div>
                  </div>

                  {entriesQuery.isLoading && <div className={styles.note}>Loading entries...</div>}

                  {!entriesQuery.isLoading && entries.length === 0 && (
                    <div className={styles.note}>No entries for this period yet.</div>
                  )}

                  {!entriesQuery.isLoading && entries.length > 0 && (
                    <Card className={styles.tableCard}>
                      <div className={styles.tableScroll}>
                        <table className={styles.table}>
                          <thead>
                            <tr>
                              <th>Rep</th>
                              <th>Visits</th>
                              <th>Store hrs</th>
                              <th>Reset</th>
                              <th>Drive</th>
                              <th>Miles</th>
                              <th>Status</th>
                              <th className={styles.thRight}>Action</th>
                            </tr>
                          </thead>
                          <tbody>
                            {entries.map((entry) => (
                              <OpenTableRow
                                key={entry.id}
                                entry={entry}
                                isManagerOrAdmin={!!isManagerOrAdmin}
                                onApprove={(id) => approveEntry.mutate(id)}
                                onFlag={(id) => rejectEntry.mutate(id)}
                              />
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </Card>
                  )}

                  {isAdmin && (
                    <div className={styles.sealRow}>
                      {!sealable && (
                        <span className={styles.sealHint}>
                          All entries must be approved before you can seal the period.
                        </span>
                      )}
                      <Button
                        disabled={!sealable || sealPeriod.isPending}
                        onClick={() => sealPeriod.mutate(openPeriod.id)}
                      >
                        <Icon name="lock" size={14} />{' '}
                        {sealPeriod.isPending ? 'Sealing...' : 'Seal period'}
                      </Button>
                    </div>
                  )}
                </>
              )}

              {tab === 'open' && !openPeriod && (
                <div className={styles.note}>No open pay period at the moment.</div>
              )}

              {/* Sealed period view */}
              {tab === 'sealed' && latestSealed && (
                <>
                  {/* Sealed banner */}
                  <Card className={styles.sealedBanner}>
                    <div className={styles.lockBadge}>
                      <Icon name="lock" size={20} />
                    </div>
                    <div className={styles.sealedBannerBody}>
                      <div className={styles.sealedBannerTitle}>
                        <h3 className={styles.sealedBannerHeading}>Period sealed</h3>
                        <Chip>Hard lock</Chip>
                      </div>
                      <div className={styles.sealedBannerHint}>
                        {latestSealed.sealed_at
                          ? `Locked ${formatTs(latestSealed.sealed_at)}. `
                          : ''}
                        Grace window elapsed. All {entries.length} entries are final unless
                        individually reopened.
                      </div>
                    </div>
                    <div className={styles.sealedBannerTotals}>
                      <div className={styles.sealedTotalHours}>{totalHours}h</div>
                      <div className={styles.sealedTotalMiles}>
                        {stats.totalMiles.toLocaleString()} mi reimbursable
                      </div>
                    </div>
                  </Card>

                  {entriesQuery.isLoading && <div className={styles.note}>Loading entries...</div>}

                  {!entriesQuery.isLoading && entries.length > 0 && (
                    <Card className={styles.tableCard}>
                      <div className={styles.tableScroll}>
                        <table className={styles.table}>
                          <thead>
                            <tr>
                              <th>Rep</th>
                              <th>Visits</th>
                              <th>Store hrs</th>
                              <th>Reset</th>
                              <th>Drive</th>
                              <th>Miles</th>
                              <th>Status</th>
                              <th className={styles.thRight}>Action</th>
                            </tr>
                          </thead>
                          <tbody>
                            {entries.map((entry) => (
                              <SealedTableRow
                                key={entry.id}
                                entry={entry}
                                isAdmin={!!isAdmin}
                                onReopen={setReopenTarget}
                              />
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </Card>
                  )}

                  {/* Audit log (admin only) */}
                  {isAdmin && (
                    <Card className={styles.auditCard}>
                      <div className={styles.auditHeader}>
                        <Icon name="history" size={15} />
                        <span className={styles.auditTitle}>Reopen audit trail</span>
                        <span className={styles.auditHint}>
                          Every reopen on this period is recorded
                        </span>
                      </div>
                      {auditQuery.isLoading && (
                        <div className={styles.note}>Loading audit log...</div>
                      )}
                      {!auditQuery.isLoading && auditEntries.length === 0 && (
                        <div className={styles.note}>No reopens recorded for this period.</div>
                      )}
                      {auditEntries.map((a, i) => (
                        <div
                          key={a.id}
                          className={`${styles.auditRow} ${i < auditEntries.length - 1 ? styles.auditRowDivider : ''}`}
                        >
                          <div className={styles.auditIcon}>
                            <Icon name="lock" size={14} />
                          </div>
                          <div className={styles.auditBody}>
                            <div className={styles.auditText}>
                              <strong>{a.who}</strong> reopened {a.rep_name}'s entry
                            </div>
                            <div className={styles.auditReason}>"{a.reason}"</div>
                          </div>
                          <Chip tone="violet">Payroll</Chip>
                          <span className={`${styles.mono} ${styles.auditTs}`}>
                            {formatTs(a.created_at)}
                          </span>
                        </div>
                      ))}
                    </Card>
                  )}
                </>
              )}

              {tab === 'sealed' && !latestSealed && (
                <div className={styles.note}>No sealed pay periods yet.</div>
              )}
            </>
          )}
        </div>
      </div>

      <ReopenModal
        open={!!reopenTarget}
        entry={reopenTarget}
        period={activePeriod}
        onClose={() => setReopenTarget(null)}
        onConfirm={(entry, reason) => {
          reopenEntry.mutate(
            { id: entry.id, reason },
            { onSuccess: () => setReopenTarget(null) },
          )
        }}
        isPending={reopenEntry.isPending}
      />
    </>
  )
}
