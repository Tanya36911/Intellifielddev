import type { ReactNode } from 'react'
import type { Sku } from './useCatalog'
import { photoCount } from './useCatalog'
import { SkuThumb } from './SkuThumb'
import { StatusPill } from './StatusPill'
import styles from './SkuCard.module.css'

export function SkuCard({ sku, onOpen }: { sku: Sku; onOpen?: (sku: Sku) => void }) {
  const n = photoCount(sku)
  const content: ReactNode = (
    <>
      <SkuThumb sku={sku} size={124} />
      <div className={styles.row}>
        <span className={styles.dot} style={{ background: sku.color ?? 'var(--border-strong)' }} />
        <span className={styles.variant}>{sku.variant}</span>
      </div>
      <div className={styles.meta}>
        <StatusPill status={sku.status} />
        <span className={styles.count}>{n ? `${n} photos` : 'No photo'}</span>
      </div>
    </>
  )
  if (!onOpen) {
    return (
      <div className={styles.card} data-discontinued={sku.status === 'discontinued' || undefined}>
        {content}
      </div>
    )
  }
  return (
    <button
      type="button"
      className={styles.card}
      data-discontinued={sku.status === 'discontinued' || undefined}
      onClick={() => onOpen(sku)}
    >
      {content}
    </button>
  )
}
