import { useState } from 'react'
import { Chip, Icon } from '../../ui'
import type { Sku } from './useCatalog'
import { photoCount } from './useCatalog'
import { SkuThumb } from './SkuThumb'
import { SkuCard } from './SkuCard'
import { StatusPill } from './StatusPill'
import styles from './LineSection.module.css'

export function LineSection({
  line,
  skus,
  fullSkus,
  view,
  onOpen,
}: {
  line: string
  skus: Sku[] // already filtered: what to show
  fullSkus: Sku[] // the whole line: for the swatch stack + total count
  view: 'list' | 'gallery'
  onOpen?: (sku: Sku) => void
}) {
  const [open, setOpen] = useState(true)
  if (skus.length === 0) return null
  const swatches = fullSkus.slice(0, 6)

  return (
    <div className={styles.section}>
      <button type="button" className={styles.header} onClick={() => setOpen((o) => !o)}>
        <Icon name={open ? 'chevD' : 'chevR'} size={16} />
        <span className={styles.swatches}>
          {swatches.map((s, i) => (
            <span
              key={s.id}
              className={styles.swatch}
              style={{ background: s.color ?? 'var(--border-strong)', marginLeft: i === 0 ? 0 : -5 }}
            />
          ))}
        </span>
        <span className={styles.titleWrap}>
          <span className={styles.lineName}>{line}</span>
          <span className={styles.sub}>
            <span className={styles.mono}>{fullSkus.length} SKUs</span>
            <span className={styles.notInSurvey}>Not yet in a survey</span>
          </span>
        </span>
        <Chip>{skus.length !== fullSkus.length ? `${skus.length} / ${fullSkus.length}` : String(skus.length)}</Chip>
      </button>

      {open && view === 'gallery' && (
        <div className={styles.gallery}>
          {skus.map((s) => (
            <SkuCard key={s.id} sku={s} onOpen={onOpen} />
          ))}
        </div>
      )}

      {open && view === 'list' && (
        <table className={styles.tbl}>
          <thead>
            <tr>
              <th className={styles.thumbCol} />
              <th>Variant</th>
              <th className={styles.photoCol}>Photos</th>
              <th className={styles.upcCol}>UPC</th>
              <th className={styles.statusCol}>Status</th>
              {onOpen && <th className={styles.chevCol} />}
            </tr>
          </thead>
          <tbody>
            {skus.map((s) => {
              const n = photoCount(s)
              const clickable = !!onOpen
              return (
                <tr
                  key={s.id}
                  className={clickable ? styles.clickable : undefined}
                  data-discontinued={s.status === 'discontinued' || undefined}
                  onClick={clickable ? () => onOpen!(s) : undefined}
                >
                  <td>
                    <SkuThumb sku={s} size={40} />
                  </td>
                  <td className={styles.variant}>{s.variant}</td>
                  <td className={styles.photoCell}>{n ? `${n} photos` : 'No photo'}</td>
                  <td className={styles.mono}>{s.upc}</td>
                  <td>
                    <StatusPill status={s.status} />
                  </td>
                  {onOpen && (
                    <td>
                      <Icon name="chevR" size={15} />
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}
