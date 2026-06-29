import { useMemo, useState } from 'react'
import { Avatar, Button, Card, Chip, Field, Icon, Input, Select } from '@intelli/ui'
import { ApiError } from '../../lib/api'
import { useHierarchy } from '../Hierarchy/useHierarchy'
import { pinOptions } from '../Users/pinOptions'
import { ROLE_META, useCreateUser, type Role, type User } from '../Users/useUsers'
import { StepHead } from './StepHead'
import styles from './steps.module.css'

const ROLES: Role[] = ['admin', 'manager', 'rep']

// Step 5: add people. A form (name, email, role, pin-to-node, starting password)
// creates users via POST /users (useCreateUser) and lists who was added. Real
// emailed invites stay "coming soon"; v1 sets a starting password.
export function StepInvite() {
  const { nodes, levels } = useHierarchy()
  const create = useCreateUser()
  const options = useMemo(() => pinOptions(nodes, levels), [nodes, levels])

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Role>('rep')
  const [nodeId, setNodeId] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [added, setAdded] = useState<User[]>([])

  const ready = name.trim() !== '' && email.trim() !== '' && password.trim() !== ''

  async function add() {
    if (!ready) return
    setError(null)
    try {
      const user = await create.mutateAsync({
        name: name.trim(),
        email: email.trim(),
        role,
        password: password.trim(),
        node_id: nodeId || null,
      })
      setAdded((prev) => [...prev, user])
      setName('')
      setEmail('')
      setPassword('')
      setNodeId('')
      setRole('rep')
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not add this person. Try again.')
    }
  }

  return (
    <div>
      <StepHead
        title="Invite your team"
        sub="Add the first users and pin them to a node. They see everything below their pin. v1 sets a starting password; emailed invites are coming soon."
      />

      <Card className={styles.inviteForm}>
        <Field label="Name">
          <Input
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              setError(null)
            }}
            placeholder="Full name"
          />
        </Field>
        <Field label="Email">
          <Input
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value)
              setError(null)
            }}
            placeholder="name@company.com"
          />
        </Field>
        <Field label="Role">
          <Select value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_META[r].label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Pin to">
          <Select value={nodeId} onChange={(e) => setNodeId(e.target.value)}>
            <option value="">No pin yet</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
        <div className={styles.inviteFull}>
          <Field label="Starting password">
            <Input
              type="text"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value)
                setError(null)
              }}
              placeholder="They change it on first sign-in"
            />
          </Field>
        </div>

        {error && (
          <div className={`${styles.stepError} ${styles.inviteFull}`} role="alert">
            {error}
          </div>
        )}

        <div className={styles.inviteActions}>
          <Button variant="primary" disabled={!ready || create.isPending} onClick={add}>
            <Icon name="plus" size={15} /> Add person
          </Button>
        </div>
      </Card>

      <Card>
        <div className={styles.listHead}>
          <span className={styles.listTitle}>People added</span>
          <Chip tone="accent">{added.length}</Chip>
          <Chip>Emailed invites coming soon</Chip>
        </div>
        {added.length === 0 ? (
          <div className={styles.listEmpty}>
            No one added yet. Add your managers and reps above, or invite them later from Users.
          </div>
        ) : (
          added.map((u) => (
            <div key={u.id} className={styles.personRow}>
              <Avatar name={u.name} size={30} />
              <div>
                <div className={styles.personName}>{u.name}</div>
                <div className={styles.personEmail}>{u.email}</div>
              </div>
              <Chip tone={ROLE_META[u.role].tone}>{ROLE_META[u.role].label}</Chip>
              <span className={styles.personPin}>
                <Icon name="pin" size={13} />
                {u.pinned_node_name ?? 'No pin'}
              </span>
            </div>
          ))
        )}
      </Card>
    </div>
  )
}
