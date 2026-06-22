import { Icon } from '../../ui'
import type { Sku } from './useCatalog'
import styles from './SkuThumb.module.css'

// The photo cell: a real reference image if one is stored, else a clean swatch
// placeholder tinted with the product colour (a neutral fallback when colour is
// null, so we never emit an invalid CSS value).
export function SkuThumb({ sku, size = 40 }: { sku: Sku; size?: number }) {
  const primary = (sku.reference_images ?? []).find((p) => p && p.url)
  if (primary?.url) {
    return (
      <div className={styles.tile} style={{ width: size, height: size }}>
        <img src={primary.url} alt={primary.label ?? sku.variant} className={styles.img} />
      </div>
    )
  }
  const tint = sku.color
    ? `color-mix(in srgb, ${sku.color} 13%, var(--surface-2))`
    : 'var(--surface-2)'
  return (
    <div
      className={styles.placeholder}
      style={{ width: size, height: size, background: tint }}
      title="No reference photo yet"
    >
      <Icon name="camera" size={Math.round(size * 0.42)} />
    </div>
  )
}
