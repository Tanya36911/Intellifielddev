import { Card, Icon, Spark } from '@intelli/ui'
import styles from './KpiCard.module.css'

// One KPI tile: a label, a big value, an optional delta chip (arrow + number,
// colored by whether the move is good), and an optional sparkline. A null value
// is rendered by the caller as the em-dash glyph.
export default function KpiCard({
  label,
  value,
  delta,
  deltaSuffix = '',
  goodWhenDown = false,
  spark,
}: {
  label: string
  value: string
  delta?: number | null
  deltaSuffix?: string
  goodWhenDown?: boolean
  spark?: number[]
}) {
  const showDelta = typeof delta === 'number' && Number.isFinite(delta)
  // A rise is normally good; for "good when down" KPIs (overdue) a fall is good.
  const positive = showDelta ? (goodWhenDown ? delta! < 0 : delta! > 0) : false
  const sparkData = (spark ?? []).map((v) => v / 100)
  const hasSpark = sparkData.filter((v) => Number.isFinite(v)).length >= 2

  return (
    <Card className={styles.card}>
      <div className={styles.label}>{label}</div>
      <div className={styles.body}>
        <div>
          <div className={styles.value}>{value}</div>
          {showDelta && (
            <div className={styles.delta}>
              <Icon
                name={delta! >= 0 ? 'arrowUp' : 'arrowDown'}
                size={12}
                color={positive ? 'var(--green)' : 'var(--red)'}
              />
              <span
                className={styles.deltaNum}
                style={{ color: positive ? 'var(--green-fg)' : 'var(--red-fg)' }}
              >
                {Math.abs(delta!)}
                {deltaSuffix}
              </span>
            </div>
          )}
        </div>
        {hasSpark && (
          <Spark
            data={sparkData}
            color={positive ? 'var(--green)' : 'var(--accent)'}
            w={64}
            h={30}
          />
        )}
      </div>
    </Card>
  )
}
