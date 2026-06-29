import { useEffect, useState } from 'react'
import { Button, Icon, ICONS } from '@intelli/ui'
import { ApiError } from '@intelli/api-client'
import { selectSession, useAppDispatch, useAppSelector } from '../../store'
import { signedIn } from '../../store/auth'
import { tenantChanges, useTenant, useUpdateTenant } from './useSettings'
import { CompanyPanel } from './CompanyPanel'
import { PayrollPanel } from './PayrollPanel'
import { ComingSoonPanel } from './ComingSoonPanel'
import styles from './Settings.module.css'

type Section = { id: string; label: string; icon: keyof typeof ICONS; soon?: boolean }
const SECTIONS: Section[] = [
  { id: 'company', label: 'Company', icon: 'building' },
  { id: 'payroll', label: 'Payroll', icon: 'dollar' },
  { id: 'workmodel', label: 'Work model', icon: 'target', soon: true },
  { id: 'logos', label: 'Store logos', icon: 'store', soon: true },
  { id: 'audit', label: 'Audit log', icon: 'history', soon: true },
  { id: 'security', label: 'Data & security', icon: 'shield', soon: true },
]

export default function Settings() {
  const session = useAppSelector(selectSession)
  const dispatch = useAppDispatch()
  const canEdit = session?.user.role === 'admin'
  const tenantQ = useTenant()
  const update = useUpdateTenant()

  const [section, setSection] = useState('company')
  const [name, setName] = useState('')
  const [payroll, setPayroll] = useState(true)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  // Seed local edit state once the tenant loads.
  useEffect(() => {
    if (tenantQ.data) { setName(tenantQ.data.name); setPayroll(tenantQ.data.payroll_enabled) }
  }, [tenantQ.data])

  const changes = tenantQ.data ? tenantChanges(tenantQ.data, { name, payroll_enabled: payroll }) : {}
  const dirty = Object.keys(changes).length > 0

  // Editing clears a stale "Saved"/error message.
  function edit(fn: () => void) {
    setSaved(false)
    setSaveError(null)
    fn()
  }

  async function save() {
    if (!dirty) return
    setSaveError(null)
    try {
      const updated = await update.mutateAsync(changes)
      if (session && 'name' in changes) {
        // Refresh the sidebar company name without a re-login.
        dispatch(signedIn({ ...session, user: { ...session.user, company_name: updated.name } }))
      }
      setSaved(true)
    } catch (e) {
      setSaved(false)
      setSaveError(e instanceof ApiError ? e.message : 'Could not save. Try again.')
    }
  }

  return (
    <>
      <div className={styles.topbar}>
        <div>
          <div className={styles.title}>Settings</div>
          <div className={styles.sub}>Company configuration</div>
        </div>
        <div className={styles.sp} />
        {canEdit && (
          <>
            {saveError && <span className={styles.saveError}>{saveError}</span>}
            {!saveError && saved && !dirty && (
              <span className={styles.saved}><Icon name="check" size={13} /> Saved</span>
            )}
            <Button variant="primary" disabled={!dirty || update.isPending} onClick={save}>
              <Icon name="check" size={15} /> Save changes
            </Button>
          </>
        )}
      </div>

      <div className={styles.page}>
        {tenantQ.isLoading && <div>Loading settings...</div>}
        {tenantQ.isError && <div>Could not load settings. Is the backend running?</div>}
        {tenantQ.data && (
          <div className={styles.layout}>
            <div className={styles.secnav}>
              {SECTIONS.map((s, i) => (
                <div key={s.id}>
                  {i === 2 && <div className={styles.secDivider} />}
                  <button
                    className={section === s.id ? styles.secBtnActive : styles.secBtn}
                    onClick={() => setSection(s.id)}
                  >
                    <Icon name={s.icon} size={16} /> {s.label}
                    {s.soon && <span className={styles.secSoon}>soon</span>}
                  </button>
                </div>
              ))}
            </div>
            <div>
              {section === 'company' && (
                <CompanyPanel name={name} code={tenantQ.data.code} canEdit={canEdit}
                  onName={(v) => edit(() => setName(v))} />
              )}
              {section === 'payroll' && (
                <PayrollPanel on={payroll} canEdit={canEdit}
                  onToggle={(v) => edit(() => setPayroll(v))} />
              )}
              {section === 'workmodel' && (
                <ComingSoonPanel icon="target" title="Work model"
                  body="Choose how rep days are planned: assigned routes, flexible self-select, or per-team. This reshapes the manager and field apps, so it lands with those tracks." />
              )}
              {section === 'logos' && (
                <ComingSoonPanel icon="store" title="Store chain logos"
                  body="Upload each retail chain's logo so reps recognise a store at a glance. Needs image storage, which arrives with shelf photos." />
              )}
              {section === 'audit' && (
                <ComingSoonPanel icon="history" title="Audit log"
                  body="A company-wide, append-only history of sensitive changes. The payroll part already exists on the Payroll screen; a unified feed is a fast-follow." />
              )}
              {section === 'security' && (
                <ComingSoonPanel icon="shield" title="Data & security"
                  body="A read-only summary of how your data is isolated: company-scoped queries, node-scoped access, encryption, and an immutable audit trail." />
              )}
            </div>
          </div>
        )}
      </div>
    </>
  )
}
