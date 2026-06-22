import { useEffect, useMemo, useState } from 'react'
import { Button, Field, Icon, Input, Modal, Select } from '../../ui'
import { ApiError } from '../../lib/api'
import type { Sku, SkuInput } from './useCatalog'
import { useCreateSku, useUpdateSku } from './useCatalog'
import styles from './ProductFormModal.module.css'

const NEW_LINE = '__new__'

export function ProductFormModal({
  open,
  sku,
  lines,
  onClose,
}: {
  open: boolean
  sku: Sku | null
  lines: string[]
  onClose: () => void
}) {
  const editing = !!sku
  const create = useCreateSku()
  const update = useUpdateSku()

  const [lineSel, setLineSel] = useState('')
  const [newLine, setNewLine] = useState('')
  const [variant, setVariant] = useState('')
  const [upc, setUpc] = useState('')
  const [color, setColor] = useState('#9b5b5b')
  const [status, setStatus] = useState<'active' | 'discontinued'>('active')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setError(null)
    if (sku) {
      setLineSel(sku.line)
      setNewLine('')
      setVariant(sku.variant)
      setUpc(sku.upc)
      setColor(sku.color ?? '#9b5b5b')
      setStatus(sku.status)
    } else {
      setLineSel(lines[0] ?? NEW_LINE)
      setNewLine('')
      setVariant('')
      setUpc('')
      setColor('#9b5b5b')
      setStatus('active')
    }
  }, [open, sku, lines])

  // Existing selection, or the trimmed new-line text (reusing an existing line if
  // it matches case-insensitively, so no near-duplicate lines are created).
  const resolvedLine = useMemo(() => {
    if (lineSel !== NEW_LINE) return lineSel
    const t = newLine.trim()
    return lines.find((l) => l.toLowerCase() === t.toLowerCase()) ?? t
  }, [lineSel, newLine, lines])

  const ready = resolvedLine.trim() !== '' && variant.trim() !== '' && upc.trim() !== ''
  const saving = create.isPending || update.isPending

  async function save() {
    setError(null)
    const body: SkuInput = {
      line: resolvedLine.trim(),
      variant: variant.trim(),
      upc: upc.trim(),
      color,
      status,
    }
    try {
      if (sku) await update.mutateAsync({ id: sku.id, body })
      else await create.mutateAsync(body)
      onClose()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save. Try again.')
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? sku!.variant : 'Add product'}
      subtitle={editing ? sku!.line : 'New SKU (one variant)'}
    >
      <div className={styles.body}>
        <div className={styles.grid}>
          <Field label="Product line">
            <Select value={lineSel} onChange={(e) => setLineSel(e.target.value)}>
              {lines.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
              <option value={NEW_LINE}>+ New line...</option>
            </Select>
          </Field>
          <Field label="Status">
            <Select
              value={status}
              onChange={(e) => setStatus(e.target.value as 'active' | 'discontinued')}
            >
              <option value="active">Active</option>
              <option value="discontinued">Discontinued</option>
            </Select>
          </Field>
          {lineSel === NEW_LINE && (
            <Field label="New line name">
              <Input
                value={newLine}
                onChange={(e) => setNewLine(e.target.value)}
                placeholder="e.g. Velvet Lip"
              />
            </Field>
          )}
          <Field label="Variant">
            <Input
              value={variant}
              onChange={(e) => setVariant(e.target.value)}
              placeholder="e.g. Rosewood"
            />
          </Field>
          <Field label="UPC">
            <Input
              className={styles.mono}
              value={upc}
              onChange={(e) => setUpc(e.target.value)}
              placeholder="040123 1104 5"
            />
          </Field>
          <Field label="Colour">
            <div className={styles.colorRow}>
              <input
                type="color"
                className={styles.colorPicker}
                value={color}
                onChange={(e) => setColor(e.target.value)}
                aria-label="Colour picker"
              />
              <Input className={styles.mono} value={color} onChange={(e) => setColor(e.target.value)} />
            </div>
          </Field>
        </div>

        <div className={styles.defer}>
          <Icon name="image" size={18} />
          <div>
            <div className={styles.deferTitle}>Reference photos</div>
            <div className={styles.deferHint}>Photo upload coming soon.</div>
          </div>
        </div>

        {error && (
          <div className={styles.error} role="alert">
            {error}
          </div>
        )}
      </div>

      <div className={styles.foot}>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={!ready || saving} onClick={save}>
          <Icon name="check" size={15} /> {editing ? 'Save changes' : 'Add product'}
        </Button>
      </div>
    </Modal>
  )
}
