import { useState } from 'react'
import { Button, Card, Icon, Segmented } from '../../ui'
import { Topbar } from '../../shell/Topbar'
import { downloadCsv } from '../../lib/api'
import { useCompliance, useDashboard, type Range } from './useDashboard'
import KpiCard from './KpiCard'
import TrendChart from './TrendChart'
import ComplianceList from './ComplianceList'
import AiPreview from './AiPreview'
import styles from './Dashboard.module.css'

// no-data glyph for a null value.
const DASH = '—'

export default function Dashboard() {
  const [range, setRange] = useState<Range>('12w')
  const dash = useDashboard(range)
  const comp = useCompliance()

  const c = dash.data?.current
  const p = dash.data?.previous
  // The sparkline rides the completion trend; null weeks are dropped.
  const spark = (dash.data?.trend ?? [])
    .map((t) => t.completion_pct)
    .filter((v): v is number => v != null)

  return (
    <>
      <Topbar title="Analytics" subtitle="All nodes, period to date">
        <Segmented
          options={['4w', '12w', 'YTD']}
          value={range}
          onChange={(r) => setRange(r as Range)}
        />
        <Button
          size="sm"
          onClick={() => downloadCsv('/export/compliance?format=csv', 'intelli_compliance.csv')}
        >
          <Icon name="download" size={14} /> Export
        </Button>
      </Topbar>

      <div className={styles.scroll}>
        <div className={styles.page}>
          <div className={styles.kpis}>
            <KpiCard
              label="Avg. compliance"
              value={c && c.pass_pct != null ? `${Math.round(c.pass_pct)}%` : DASH}
              delta={
                c && p && c.pass_pct != null && p.pass_pct != null
                  ? +(c.pass_pct - p.pass_pct).toFixed(1)
                  : null
              }
              deltaSuffix=" pts"
              spark={spark}
            />
            <KpiCard
              label="Surveys completed"
              value={c ? String(c.surveys_completed) : DASH}
              delta={c && p ? c.surveys_completed - p.surveys_completed : null}
            />
            <KpiCard
              label="Overdue surveys"
              value={c ? String(c.overdue) : DASH}
              delta={c && p ? c.overdue - p.overdue : null}
              goodWhenDown
            />
          </div>

          <div className={styles.row}>
            <Card className={styles.trendCard}>
              <div className={styles.cardTitle}>Completion trend</div>
              <TrendChart points={dash.data?.trend ?? []} />
            </Card>
            <Card className={styles.compCard}>
              <div className={styles.cardTitle}>Compliance by node</div>
              <ComplianceList rows={comp.data?.rows ?? []} />
            </Card>
          </div>

          <AiPreview />
        </div>
      </div>
    </>
  )
}
