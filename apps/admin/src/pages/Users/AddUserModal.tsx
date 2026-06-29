import { useEffect, useState } from 'react'
import { Button, Chip, Field, Icon, Input, Modal, Select } from '@intelli/ui'
import { ApiError } from '../../lib/api'
import { inheritanceText, ROLE_META, useCreateUser, type Role } from './useUsers'
import type { PinOption } from './pinOptions'
import styles from './UserModals.module.css'

export function AddUserModal({
  open, options, onClose,
}: { open: boolean; options: PinOption[]; onClose: () => void }) {
  const create = useCreateUser()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Role>('rep')
  const [nodeId, setNodeId] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setName(''); setEmail(''); setRole('rep'); setNodeId(''); setPassword(''); setError(null)
  }, [open])

  const picked = options.find((o) => o.id === nodeId)
  const ready = name.trim() && email.trim() && nodeId && password.length >= 8
  const preview = picked
    ? `Pinned to ${picked.label.trim()} as ${ROLE_META[role].label}. ${inheritanceText(role, picked.levelName)}`
    : 'Pick a role and a node to see what this person will be able to see.'

  async function save() {
    setError(null)
    try {
      await create.mutateAsync({ name: name.trim(), email: email.trim(), role, password, node_id: nodeId })
      onClose()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not add the user. Try again.')
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Add a user"
      subtitle="Create their login now. You set a starting password and share it. Email invites come later.">
      <div className={styles.body}>
        <Field label="Full name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Jordan Lee" /></Field>
        <Field label="Email"><Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="jordan@lumenbeauty.com" /></Field>
        <Field label="Role">
          <div className={styles.rolePick}>
            {(Object.keys(ROLE_META) as Role[]).map((r) => (
              <button key={r} type="button" className={r === role ? styles.roleSel : styles.roleBtn} onClick={() => setRole(r)}>
                <Chip tone={ROLE_META[r].tone}>{ROLE_META[r].label}</Chip>
              </button>
            ))}
          </div>
        </Field>
        <Field label="Pin to node">
          <Select value={nodeId} onChange={(e) => setNodeId(e.target.value)}>
            <option value="">Select a node...</option>
            {options.map((o) => <option key={o.id} value={o.id}>{o.label} ({o.levelName})</option>)}
          </Select>
        </Field>
        <Field label="Starting password">
          <Input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" />
        </Field>
        <div className={styles.hint}>They use this to log in the first time. Tell them to change it. Stored safely (one-way scramble), never as plain text.</div>
        <div className={styles.preview}><Icon name="pin" size={15} /><span>{preview}</span></div>
        {error && <div className={styles.error} role="alert">{error}</div>}
      </div>
      <div className={styles.foot}>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={!ready || create.isPending} onClick={save}>
          <Icon name="plus" size={15} /> Add user
        </Button>
      </div>
    </Modal>
  )
}
