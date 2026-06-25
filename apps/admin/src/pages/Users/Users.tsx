import { useMemo, useState } from 'react'
import { Button, Card, Chip, Icon, Segmented } from '../../ui'
import { selectSession, useAppSelector } from '../../store'
import { useHierarchy } from '../Hierarchy/useHierarchy'
import { roleCounts, ROLE_META, useUsers, type Role, type User } from './useUsers'
import { pinOptions } from './pinOptions'
import { UserTable } from './UserTable'
import { RolesReference } from './RolesReference'
import { AddUserModal } from './AddUserModal'
import { MovePinModal } from './MovePinModal'
import styles from './Users.module.css'

const ROLE_DESC: Record<Role, { desc: string; sees: string }> = {
  admin: { desc: 'Owns the company. Configures hierarchy, surveys, payroll, users.', sees: 'everything in the company' },
  manager: { desc: 'Oversees a branch. Assigns surveys, reviews compliance, approves payroll.', sees: 'their node and everything below it' },
  rep: { desc: 'Field user. Completes assigned surveys at their stores.', sees: 'stores in their node only' },
}

export default function Users() {
  const session = useAppSelector(selectSession)
  const canEdit = session?.user.role === 'admin'
  const usersQ = useUsers()
  const { nodes, levels } = useHierarchy()
  const [tab, setTab] = useState<'people' | 'roles'>('people')
  const [addOpen, setAddOpen] = useState(false)
  const [pinUser, setPinUser] = useState<User | null>(null)

  const users = usersQ.data?.users ?? []
  const counts = roleCounts(users)
  const options = useMemo(() => pinOptions(nodes, levels), [nodes, levels])

  return (
    <>
      <div className={styles.topbar}>
        <div>
          <div className={styles.title}>Users &amp; Roles</div>
          <div className={styles.sub}>{users.length} users: {counts.admin} admin, {counts.manager} manager, {counts.rep} reps.</div>
        </div>
        <div className={styles.sp} />
        <Segmented
          options={['People', 'Roles']}
          value={tab === 'people' ? 'People' : 'Roles'}
          onChange={(v) => setTab(v === 'People' ? 'people' : 'roles')}
        />
        {canEdit && tab === 'people' && (
          <Button variant="primary" onClick={() => setAddOpen(true)}><Icon name="plus" size={15} /> Add user</Button>
        )}
      </div>

      <div className={styles.page}>
        {usersQ.isLoading && <div className={styles.muted}>Loading the team...</div>}
        {usersQ.isError && <div className={styles.error}>Could not load users. Is the backend running?</div>}

        {!usersQ.isLoading && !usersQ.isError && tab === 'people' && (
          <>
            <div className={styles.roleCards}>
              {(Object.keys(ROLE_META) as Role[]).map((r) => (
                <Card key={r} className={styles.roleCard}>
                  <div className={styles.roleCardHead}>
                    <Chip tone={ROLE_META[r].tone}>{ROLE_META[r].label}</Chip>
                    <span className={styles.count}>{counts[r]}</span>
                  </div>
                  <div className={styles.roleDesc}>{ROLE_DESC[r].desc}</div>
                  <div className={styles.roleSees}>Sees: {ROLE_DESC[r].sees}</div>
                </Card>
              ))}
            </div>
            <div className={styles.banner}>
              <div className={styles.bannerIcon}><Icon name="shield" size={16} /></div>
              <div className={styles.bannerText}>
                <strong>A role is what a person can do. Their pin is where they can do it.</strong>{' '}
                Pin someone to a node and they automatically see that node and everything beneath
                it, never a sibling branch and never another company. This is the same rule the
                backend enforces on every request.
              </div>
            </div>
            <UserTable users={users} levels={levels} canEdit={canEdit} onMovePin={setPinUser} />
          </>
        )}

        {!usersQ.isLoading && tab === 'roles' && <RolesReference />}
      </div>

      <AddUserModal open={addOpen} options={options} onClose={() => setAddOpen(false)} />
      <MovePinModal open={pinUser !== null} user={pinUser} options={options} onClose={() => setPinUser(null)} />
    </>
  )
}
