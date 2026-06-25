import { Avatar, Chip, Icon } from '../../ui'
import { getLevelName, type OrgLevel } from '../Hierarchy/useHierarchy'
import { inheritanceText, type User } from './useUsers'
import { RoleSelect } from './RoleSelect'
import styles from './UserTable.module.css'

export function UserTable({
  users, levels, canEdit, onMovePin,
}: { users: User[]; levels: OrgLevel[]; canEdit: boolean; onMovePin: (u: User) => void }) {
  return (
    <div className={styles.card}>
      <table className={styles.tbl}>
        <thead>
          <tr><th>User</th><th>Role</th><th>Pinned node &rarr; inherits</th><th>Status</th></tr>
        </thead>
        <tbody>
          {users.map((u) => {
            const levelName = u.pinned_node_level_order !== null ? getLevelName(u.pinned_node_level_order, levels) : null
            return (
              <tr key={u.id}>
                <td><div className={styles.userCell}>
                  <Avatar name={u.name} />
                  <div><div className={styles.name}>{u.name}</div><div className={styles.email}>{u.email}</div></div>
                </div></td>
                <td><RoleSelect user={u} disabled={!canEdit} /></td>
                <td>
                  {u.pinned_node_name ? (
                    <div className={styles.pinRow}>
                      <Icon name="pin" size={13} /><span className={styles.nodeName}>{u.pinned_node_name}</span>
                      {levelName && <Chip>{levelName}</Chip>}
                      {canEdit && <button className={styles.change} onClick={() => onMovePin(u)}>Change</button>}
                    </div>
                  ) : (
                    <div className={styles.pinRow}>
                      <Chip tone="amber">No pin</Chip>
                      {canEdit && <button className={styles.change} onClick={() => onMovePin(u)}>Set pin</button>}
                    </div>
                  )}
                  <div className={styles.inherit}>&darr; {inheritanceText(u.role, levelName)}</div>
                </td>
                <td><Chip tone="green">Active</Chip></td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
