import { useEffect, useState } from 'react'
import { Button, Field, Icon, Input, Modal } from '../../ui'
import { ApiError } from '../../lib/api'
import {
  getLevelName,
  isLocked,
  levelChildName,
  type OrgLevel,
  type OrgNode,
} from './useHierarchy'
import { useCreateNode, useUpdateNode } from './useHierarchy'
import styles from './NodeFormModal.module.css'

// The add/rename modal. In add mode `node` is the PARENT the child is added under;
// in rename mode `node` is the node being edited. `mode` disambiguates the two.
export default function NodeFormModal({
  open,
  mode,
  node,
  levels,
  onClose,
}: {
  open: boolean
  mode: 'add' | 'rename'
  node: OrgNode | null
  levels: OrgLevel[]
  onClose: () => void
}) {
  const adding = mode === 'add'
  const create = useCreateNode()
  const update = useUpdateNode()

  const [name, setName] = useState('')
  const [chain, setChain] = useState('')
  const [address, setAddress] = useState('')
  const [error, setError] = useState<string | null>(null)

  // In add mode the new node sits one level below the parent; in rename mode the
  // node keeps its own level. Chain + address only matter for the store level.
  const effectiveLevelOrder = node
    ? adding
      ? node.level_order + 1
      : node.level_order
    : 0
  const isStoreLevel = isLocked(effectiveLevelOrder, levels)
  const childLevelName = node ? levelChildName(node.level_order, levels) : ''
  const ownLevelName = node ? getLevelName(node.level_order, levels) : ''

  useEffect(() => {
    if (!open) return
    setError(null)
    if (adding) {
      setName('')
      setChain('')
      setAddress('')
    } else if (node) {
      setName(node.name)
      setChain(node.chain ?? '')
      setAddress(node.address ?? '')
    }
  }, [open, adding, node])

  if (!node) return null

  const ready = name.trim() !== ''
  const saving = create.isPending || update.isPending

  async function save() {
    if (!node) return
    setError(null)
    try {
      if (adding) {
        await create.mutateAsync({
          parent_id: node.id,
          name: name.trim(),
          ...(isStoreLevel
            ? { chain: chain.trim() || null, address: address.trim() || null }
            : {}),
        })
      } else {
        await update.mutateAsync({
          id: node.id,
          body: {
            name: name.trim(),
            ...(isStoreLevel
              ? { chain: chain.trim() || null, address: address.trim() || null }
              : {}),
          },
        })
      }
      onClose()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save. Try again.')
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={adding ? `New ${childLevelName}` : `Rename ${ownLevelName}`}
      subtitle={adding ? `Under ${node.name}` : node.name}
      width={460}
    >
      <div className={styles.body}>
        {adding && (
          <div className={styles.context}>
            <Icon name="branch" size={15} style={{ flexShrink: 0, color: 'var(--text-3)' }} />
            <span>
              New <strong>{childLevelName}</strong> under <strong>{node.name}</strong>
            </span>
          </div>
        )}

        <Field label="Name">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={adding ? `e.g. a new ${childLevelName}` : 'Node name'}
            autoFocus
          />
        </Field>

        {isStoreLevel && (
          <>
            <Field label="Chain">
              <Input
                value={chain}
                onChange={(e) => setChain(e.target.value)}
                placeholder="e.g. CVS, Walgreens, Target"
              />
            </Field>
            <Field label="Address">
              <Input
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="Street address"
              />
            </Field>
          </>
        )}

        {error && (
          <div className={styles.error} role="alert">
            {error}
          </div>
        )}
      </div>

      <div className={styles.foot}>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={!ready || saving} onClick={save}>
          <Icon name="check" size={15} /> {adding ? `Add ${childLevelName}` : 'Save changes'}
        </Button>
      </div>
    </Modal>
  )
}
