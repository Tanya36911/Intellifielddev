import { useState } from 'react'
import { Chip, Icon } from '../../ui'
import { ROLE_META, useUpdateUser, type Role, type User } from './useUsers'
import styles from './UserTable.module.css'

export function RoleSelect({ user, disabled }: { user: User; disabled: boolean }) {
  const [open, setOpen] = useState(false)
  const update = useUpdateUser()
  const meta = ROLE_META[user.role]

  if (disabled) return <Chip tone={meta.tone}>{meta.label}</Chip>

  async function choose(r: Role) {
    setOpen(false)
    if (r !== user.role) await update.mutateAsync({ id: user.id, body: { role: r } }).catch(() => {})
  }

  return (
    <span className={styles.roleSel}>
      <button className={styles.roleChip} data-tone={meta.tone} onClick={() => setOpen((v) => !v)} aria-label="Change role">
        {meta.label} <Icon name="chevD" size={11} />
      </button>
      {open && (
        <>
          <div className={styles.scrim} onClick={() => setOpen(false)} />
          <div className={styles.menu}>
            {(Object.keys(ROLE_META) as Role[]).map((r) => (
              <button key={r} className={styles.menuItem} onClick={() => choose(r)}>
                <Chip tone={ROLE_META[r].tone}>{ROLE_META[r].label}</Chip>
                {r === user.role && <Icon name="check" size={13} />}
              </button>
            ))}
          </div>
        </>
      )}
    </span>
  )
}
