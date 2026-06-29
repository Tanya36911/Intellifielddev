import { Button, Chip, Icon } from '@intelli/ui'
import styles from './AiPreview.module.css'

// The two-tier AI framing from the prototype, trimmed for W1 to the rep-facing
// real-time gap list only. This is a hardcoded sample, clearly badged "preview"
// and wired to nothing (OOS-by-SKU and the aggregate view are deferred).
const GAPS: { variant: string; color: string; issue: string; fix: string; red: boolean }[] = [
  { variant: 'Rosewood', color: '#9b5b5b', issue: '2 facings short of planogram', fix: 'Restock', red: false },
  { variant: 'Mauve', color: '#a9748c', issue: 'Out of stock', fix: 'Replenish', red: true },
  { variant: 'Coral', color: '#e2725b', issue: 'Price tag missing', fix: 'Replace tag', red: false },
]

export default function AiPreview() {
  return (
    <div className={styles.card}>
      <div className={styles.header}>
        <div className={styles.iconBadge}>
          <Icon name="wand" size={16} color="var(--violet)" />
        </div>
        <h3 className={styles.title}>Per-SKU AI intelligence</h3>
        <Chip tone="violet">
          <Icon name="wand" size={11} /> AI fast-follow, preview
        </Chip>
      </div>

      <div className={styles.intro}>
        <Icon name="wand" size={15} color="var(--violet)" />
        <span>Compares shelf photos to the planogram and flags gaps.</span>
      </div>

      <div className={styles.gaps}>
        {GAPS.map((g) => (
          <div key={g.variant} className={styles.gap}>
            <span className={styles.swatch} style={{ background: g.color }} />
            <div className={styles.gapBody}>
              <div className={styles.gapName}>{g.variant}</div>
              <div
                className={styles.gapIssue}
                style={{ color: g.red ? 'var(--red-fg)' : 'var(--amber-fg)' }}
              >
                <Icon name={g.red ? 'xCircle' : 'alert'} size={11} /> {g.issue}
              </div>
            </div>
            <Button size="sm" disabled>
              {g.fix}
            </Button>
          </div>
        ))}
      </div>

      <p className={styles.footer}>Not yet reading live photos.</p>
    </div>
  )
}
