import { useMemo, useState } from 'react'
import { Button, Card, Chip, Field, Icon, Input, Select } from '@intelli/ui'
import { ApiError } from '@intelli/api-client'
import {
  getLevelName,
  isBottomLevel,
  levelChildName,
  levelColor,
  useCreateNode,
  useHierarchy,
} from '../Hierarchy/useHierarchy'
import { pinOptions } from '../Users/pinOptions'
import { StepHead } from './StepHead'
import styles from './steps.module.css'

// Step 4: build the org tree. Shows the live tree and an add form: choose a
// parent, name the child (its level follows the parent), and for store-level
// children collect chain/address. Saves via POST /nodes (useCreateNode). CSV
// import and system sync stay "coming soon".
export function StepTree() {
  const { nodes, levels, isLoading } = useHierarchy()
  const create = useCreateNode()

  // Bottom-level (store) nodes can never accept a child, so a POST under one
  // 400s. Exclude them from the parent choices. While levels are still loading
  // isBottomLevel returns false for everything, so we keep all nodes (the safe
  // fallback) rather than wrongly hiding any.
  const parentNodes = useMemo(
    () => nodes.filter((n) => !isBottomLevel(n.level_order, levels)),
    [nodes, levels],
  )
  const options = useMemo(() => pinOptions(parentNodes, levels), [parentNodes, levels])
  const [parentId, setParentId] = useState('')
  const [name, setName] = useState('')
  const [chain, setChain] = useState('')
  const [address, setAddress] = useState('')
  const [error, setError] = useState<string | null>(null)

  // Default the parent select to the first node (the company root) once loaded.
  const effectiveParentId = parentId || options[0]?.id || ''
  const parentNode = nodes.find((n) => n.id === effectiveParentId)
  const childLevelOrder = parentNode ? parentNode.level_order + 1 : 0
  const childIsStore = parentNode ? isBottomLevel(childLevelOrder, levels) : false
  const childLevelName = parentNode ? levelChildName(parentNode.level_order, levels) : 'node'

  const sortedNodes = useMemo(
    () => [...nodes].sort((a, b) => a.path.localeCompare(b.path)),
    [nodes],
  )

  const ready = name.trim() !== '' && effectiveParentId !== ''
  async function add() {
    if (!ready || !parentNode) return
    setError(null)
    try {
      await create.mutateAsync({
        parent_id: effectiveParentId,
        name: name.trim(),
        ...(childIsStore ? { chain: chain.trim() || null, address: address.trim() || null } : {}),
      })
      setName('')
      setChain('')
      setAddress('')
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not add this node. Try again.')
    }
  }

  return (
    <div>
      <StepHead
        title="Build your tree"
        sub="Add nodes by choosing a parent and naming the child. Its level follows the parent. Store-level rows collect a chain and address."
      />

      <div className={styles.treeLayout}>
        <Card>
          <div className={styles.listHead}>
            <span className={styles.listTitle}>Current tree</span>
            <Chip tone="accent">{nodes.length}</Chip>
          </div>
          <div className={styles.treeList}>
            {isLoading && <div className={styles.emptyTree}>Loading the tree...</div>}
            {!isLoading && sortedNodes.length === 0 && (
              <div className={styles.emptyTree}>
                No nodes yet. Add your first one with the form on the right.
              </div>
            )}
            {!isLoading &&
              sortedNodes.map((n) => {
                const locked = isBottomLevel(n.level_order, levels)
                return (
                  <div
                    key={n.id}
                    className={styles.treeRow}
                    style={{ marginLeft: n.level_order * 16 }}
                  >
                    <span
                      className={styles.treeDot}
                      style={{
                        background: levelColor(n.level_order, locked),
                        borderRadius: locked ? 2 : 99,
                      }}
                    />
                    <span>{n.name}</span>
                    <span className={styles.treeLevelTag}>
                      {getLevelName(n.level_order, levels)}
                    </span>
                  </div>
                )
              })}
          </div>
        </Card>

        <Card className={styles.addForm}>
          <div className={styles.panelTitleRow}>
            <Icon name="plus" size={15} style={{ color: 'var(--accent)' }} />
            <span className={styles.listTitle}>Add a node</span>
          </div>

          <Field label="Parent">
            <Select
              value={effectiveParentId}
              onChange={(e) => {
                setParentId(e.target.value)
                setError(null)
              }}
            >
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>

          <Field label={`New ${childLevelName} name`}>
            <Input
              value={name}
              onChange={(e) => {
                setName(e.target.value)
                setError(null)
              }}
              placeholder={`e.g. a new ${childLevelName}`}
            />
          </Field>

          {childIsStore && (
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
            <div className={styles.stepError} role="alert">
              {error}
            </div>
          )}

          <Button variant="primary" disabled={!ready || create.isPending} onClick={add}>
            <Icon name="plus" size={15} /> Add {childLevelName}
          </Button>

          <div className={styles.soonBox}>
            <div className={styles.soonBoxHead}>
              <span className={styles.soonBoxLabel}>CSV import and system sync</span>
              <Chip>Coming soon</Chip>
            </div>
            <div className={styles.fieldHint}>
              Bulk-load the whole tree from a spreadsheet or sync it from a connected system.
              Type-in works today.
            </div>
          </div>
        </Card>
      </div>
    </div>
  )
}
