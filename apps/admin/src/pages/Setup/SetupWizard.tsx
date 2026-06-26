import { useEffect, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { Button, Icon } from '../../ui'
import { ApiError } from '../../lib/api'
import { selectSession, useAppSelector } from '../../store'
import { useHierarchy } from '../Hierarchy/useHierarchy'
import { useTenant, useUpdateTenant } from '../Settings/useSettings'
import {
  TEMPLATES,
  structuralEditingAllowed,
  templateToDraftLevels,
  savedLevelsToDraft,
  draftLevelsToNames,
  useSetOrgLevels,
  type DraftLevel,
} from './useSetup'
import { StepTemplate } from './StepTemplate'
import { StepLevels } from './StepLevels'
import { StepPayroll } from './StepPayroll'
import { StepTree } from './StepTree'
import { StepInvite } from './StepInvite'
import styles from './SetupWizard.module.css'

const STEPS = [
  { id: 1, name: 'Starting point', sub: 'Pick a hierarchy template' },
  { id: 2, name: 'Name your levels', sub: 'Define the org structure' },
  { id: 3, name: 'Payroll', sub: 'Turn the module on or off' },
  { id: 4, name: 'Build the tree', sub: 'Add org nodes' },
  { id: 5, name: 'Invite people', sub: 'Add users to nodes' },
]

// The fullscreen 5-step setup flow. Lives outside the app shell (like /login).
// Admin-only: a non-admin is redirected to the dashboard (the backend is the
// real guard). Saves as it goes: step 2 PUTs /org-levels on Continue, step 3
// PATCHes /tenants on toggle, steps 4 and 5 POST as you add.
export default function SetupWizard() {
  const session = useAppSelector(selectSession)
  const navigate = useNavigate()

  const company = session?.user.company_name ?? 'Your company'

  const { nodes, levels: savedLevels } = useHierarchy()
  const structuralAllowed = structuralEditingAllowed(nodes)

  const tenantQ = useTenant()
  const updateTenant = useUpdateTenant()
  const setOrgLevels = useSetOrgLevels()

  const [step, setStep] = useState(1)
  const [template, setTemplate] = useState(TEMPLATES[0].id)
  const [levels, setLevels] = useState<DraftLevel[]>(() =>
    templateToDraftLevels(TEMPLATES[0].levels),
  )
  // Once the company's real saved levels seed the editable list (or the admin
  // edits it), we stop overwriting it from the server, so their work is kept.
  const [levelsSeeded, setLevelsSeeded] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [levelsError, setLevelsError] = useState<string | null>(null)

  // Seed step 2 from the company's REAL saved levels once they load, so a
  // populated company (like the demo) sees its actual level names instead of a
  // template's placeholders. A truly fresh company (no saved levels yet) keeps
  // the template default. We only seed once.
  useEffect(() => {
    if (levelsSeeded) return
    if (savedLevels.length > 0) {
      setLevels(savedLevelsToDraft(savedLevels))
      setLevelsSeeded(true)
    }
  }, [levelsSeeded, savedLevels])

  const [payrollEnabled, setPayrollEnabled] = useState(false)
  const [payrollError, setPayrollError] = useState<string | null>(null)

  // Seed payroll from the saved tenant once it loads.
  useEffect(() => {
    if (tenantQ.data) setPayrollEnabled(tenantQ.data.payroll_enabled)
  }, [tenantQ.data])

  // Non-admins never reach the wizard.
  if (session && session.user.role !== 'admin') {
    return <Navigate to="/" replace />
  }

  // Editing the levels in step 2 also locks in the seed, so the server effect
  // never overwrites the admin's in-progress edits.
  function editLevels(next: DraftLevel[]) {
    setLevelsSeeded(true)
    setLevels(next)
  }

  function pickTemplate(id: string) {
    const t = TEMPLATES.find((x) => x.id === id)
    if (!t) return
    setTemplate(id)
    // On a populated company the saved level structure is fixed (the backend
    // refuses a re-map), so picking a template must NOT change the level count
    // or structure, only the visual selection. Templates apply to fresh
    // companies only.
    if (structuralAllowed) {
      setLevels(templateToDraftLevels(t.levels))
      setLevelsSeeded(true)
      setConfirmed(false)
      setLevelsError(null)
    }
  }

  async function togglePayroll(next: boolean) {
    // Ignore toggles while a PATCH is in flight, so overlapping saves cannot
    // race or roll back to a stale snapshot.
    if (updateTenant.isPending) return
    setPayrollError(null)
    const previous = payrollEnabled
    setPayrollEnabled(next)
    try {
      await updateTenant.mutateAsync({ payroll_enabled: next })
    } catch (e) {
      setPayrollEnabled(previous)
      setPayrollError(e instanceof ApiError ? e.message : 'Could not save payroll. Try again.')
    }
  }

  // Step 2 saves on Continue; everything else just advances.
  async function goNext() {
    if (step === 2) {
      setLevelsError(null)
      try {
        await setOrgLevels.mutateAsync(draftLevelsToNames(levels))
      } catch (e) {
        setLevelsError(
          e instanceof ApiError ? e.message : 'Could not save the structure. Try again.',
        )
        return
      }
    }
    if (step < 5) setStep(step + 1)
    else navigate('/', { replace: true })
  }

  function goBack() {
    if (step > 1) setStep(step - 1)
    else navigate('/', { replace: true })
  }

  function exit() {
    navigate('/', { replace: true })
  }

  const canContinue = step === 2 ? confirmed && !setOrgLevels.isPending : true
  const lastStep = step === 5

  return (
    <div className={styles.wrap}>
      {/* stepper rail */}
      <div className={styles.rail}>
        <div className={styles.brand}>
          <div className={styles.brandMark}>
            <Icon name="layers" size={17} style={{ color: '#fff' }} />
          </div>
          <div>
            <div className={styles.brandTitle}>Intelli setup</div>
            <div className={styles.brandSub}>{company}</div>
          </div>
        </div>

        <div className={styles.steps}>
          {STEPS.map((s) => {
            const done = s.id < step
            const active = s.id === step
            const clickable = s.id < step
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => clickable && setStep(s.id)}
                aria-current={active ? 'step' : undefined}
                className={[
                  styles.step,
                  active ? styles.stepActive : '',
                  clickable ? styles.stepClickable : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                <span
                  className={[
                    styles.stepBadge,
                    done ? styles.stepBadgeDone : '',
                    active ? styles.stepBadgeActive : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  {done ? <Icon name="check" size={13} /> : s.id}
                </span>
                <div>
                  <div className={active ? styles.stepNameActive : styles.stepName}>{s.name}</div>
                  <div className={styles.stepSub}>{s.sub}</div>
                </div>
              </button>
            )
          })}
        </div>

        <div className={styles.railNote}>
          <Icon name="info" size={15} />
          <p>Setup saves as you go. You can revisit it anytime from the sidebar.</p>
        </div>
        <button type="button" className={styles.exit} onClick={exit}>
          Exit to dashboard
        </button>
      </div>

      {/* content */}
      <div className={styles.content}>
        <div className={styles.scroll}>
          <div className={styles.inner}>
            <div className={styles.eyebrow}>Step {step} of 5</div>
            {step === 1 && (
              <StepTemplate
                selected={template}
                onSelect={pickTemplate}
                structuralAllowed={structuralAllowed}
              />
            )}
            {step === 2 && (
              <StepLevels
                levels={levels}
                setLevels={editLevels}
                confirmed={confirmed}
                setConfirmed={setConfirmed}
                structuralAllowed={structuralAllowed}
                saveError={levelsError}
              />
            )}
            {step === 3 && (
              <StepPayroll
                enabled={payrollEnabled}
                onToggle={togglePayroll}
                saving={updateTenant.isPending}
                saveError={payrollError}
              />
            )}
            {step === 4 && <StepTree />}
            {step === 5 && <StepInvite />}
          </div>
        </div>

        {/* footer */}
        <div className={styles.footer}>
          <Button onClick={goBack}>
            <Icon name="chevL" size={15} /> {step > 1 ? 'Back' : 'Cancel'}
          </Button>
          <div className={styles.spacer} />
          {step === 2 && !confirmed && (
            <span className={styles.footHint}>
              <Icon name="alert" size={14} /> Confirm the structure to continue
            </span>
          )}
          {step === 2 && levelsError && <span className={styles.footError}>{levelsError}</span>}
          <Button variant="primary" size="lg" disabled={!canContinue} onClick={goNext}>
            {lastStep ? (
              <>
                <Icon name="check" size={16} /> Finish setup
              </>
            ) : (
              <>
                Continue <Icon name="arrowRight" size={15} />
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}
