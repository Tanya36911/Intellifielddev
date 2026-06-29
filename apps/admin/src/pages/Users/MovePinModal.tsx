import { useEffect, useState } from 'react'
import { Button, Icon, Modal, Select } from '@intelli/ui'
import { ApiError } from '@intelli/api-client'
import { inheritanceText, useUpdateUser, type User } from './useUsers'
import type { PinOption } from './pinOptions'
import styles from './UserModals.module.css'

export function MovePinModal({
  open, user, options, onClose,
}: { open: boolean; user: User | null; options: PinOption[]; onClose: () => void }) {
  const update = useUpdateUser()
  const [nodeId, setNodeId] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open && user) { setNodeId(user.pinned_node_id ?? ''); setError(null) }
  }, [open, user])

  const picked = options.find((o) => o.id === nodeId)
  const preview = picked && user
    ? `${picked.label.trim()}. ${inheritanceText(user.role, picked.levelName)}`
    : 'No pin: this person will see nothing until pinned.'

  async function save() {
    if (!user) return
    setError(null)
    try {
      await update.mutateAsync({ id: user.id, body: { node_id: nodeId || null } })
      onClose()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not move the pin. Try again.')
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Move pin"
      subtitle={user ? `Change which node ${user.name} is pinned to.` : ''}>
      <div className={styles.body}>
        <Select value={nodeId} onChange={(e) => setNodeId(e.target.value)}>
          <option value="">No pin (sees nothing)</option>
          {options.map((o) => <option key={o.id} value={o.id}>{o.label} ({o.levelName})</option>)}
        </Select>
        <div className={styles.preview}><Icon name="pin" size={15} /><span>{preview}</span></div>
        {error && <div className={styles.error} role="alert">{error}</div>}
      </div>
      <div className={styles.foot}>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={update.isPending} onClick={save}>Save pin</Button>
      </div>
    </Modal>
  )
}
