import { useState } from 'react'
import { Button, Card, Icon, Segmented } from '@intelli/ui'
import { Topbar } from '../../shell/Topbar'
import { selectSession, useAppSelector } from '../../store'
import {
  catalogStats,
  filterSkus,
  groupByLine,
  useSkus,
  type Sku,
  type StatusFilter,
} from './useCatalog'
import { LineSection } from './LineSection'
import { ProductFormModal } from './ProductFormModal'
import styles from './Catalog.module.css'

const STATUS: { label: string; value: StatusFilter }[] = [
  { label: 'All', value: 'all' },
  { label: 'Active', value: 'active' },
  { label: 'Discontinued', value: 'discontinued' },
]

function StatTile({
  icon,
  value,
  label,
}: {
  icon: 'box' | 'barcode' | 'checkCircle'
  value: number
  label: string
}) {
  return (
    <Card className={styles.stat}>
      <div className={styles.statIcon}>
        <Icon name={icon} size={18} />
      </div>
      <div>
        <div className={styles.statValue}>{value}</div>
        <div className={styles.statLabel}>{label}</div>
      </div>
    </Card>
  )
}

function EmptyState({ isAdmin, onAdd }: { isAdmin: boolean; onAdd: () => void }) {
  return (
    <Card className={styles.empty}>
      <div className={styles.emptyIcon}>
        <Icon name="box" size={26} />
      </div>
      <div className={styles.emptyTitle}>No products yet</div>
      <div className={styles.emptyHint}>Your product catalog is empty.</div>
      {isAdmin && (
        <Button variant="primary" onClick={onAdd}>
          <Icon name="plus" size={14} /> Add product
        </Button>
      )}
    </Card>
  )
}

export default function Catalog() {
  const session = useAppSelector(selectSession)
  const isAdmin = session?.user.role === 'admin'
  const company = session?.user.company_name ?? 'Your company'

  const { data, isLoading } = useSkus()
  const allSkus = data?.skus ?? []

  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [view, setView] = useState<'list' | 'gallery'>('list')
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Sku | null>(null)

  const stats = catalogStats(allSkus)
  const fullGroups = groupByLine(allSkus)
  const lineNames = fullGroups.map((g) => g.line)
  const fullByLine = new Map(fullGroups.map((g) => [g.line, g.skus]))
  const filteredGroups = groupByLine(filterSkus(allSkus, { status, query }))

  const onOpen = isAdmin
    ? (sku: Sku) => {
        setEditing(sku)
        setModalOpen(true)
      }
    : undefined

  function openAdd() {
    setEditing(null)
    setModalOpen(true)
  }

  const empty = !isLoading && allSkus.length === 0
  const noMatch = !isLoading && allSkus.length > 0 && filteredGroups.length === 0
  const statusLabel = STATUS.find((s) => s.value === status)!.label

  return (
    <>
      <Topbar title="Catalog" subtitle={`${company}. Each SKU is one variant.`}>
        <Button size="sm" disabled title="Coming soon">
          <Icon name="upload2" size={14} /> Import SKUs
        </Button>
        <Button size="sm" disabled title="Coming soon">
          <Icon name="download" size={14} /> Export
        </Button>
        {isAdmin && !empty && !modalOpen && (
          <Button size="sm" variant="primary" onClick={openAdd}>
            <Icon name="plus" size={14} /> Add product
          </Button>
        )}
      </Topbar>

      <div className={styles.scroll}>
        <div className={styles.page}>
          <div className={styles.stats}>
            <StatTile icon="box" value={stats.lines} label="Product lines" />
            <StatTile icon="barcode" value={stats.total} label="SKUs (variants)" />
            <StatTile icon="checkCircle" value={stats.active} label="Active SKUs" />
          </div>

          <div className={styles.toolbar}>
            <div className={styles.search}>
              <Icon name="search" size={15} />
              <input
                className={styles.searchInput}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search variant, line, or UPC..."
                aria-label="Search products"
              />
            </div>
            <Segmented
              options={STATUS.map((s) => s.label)}
              value={statusLabel}
              onChange={(label) => setStatus(STATUS.find((s) => s.label === label)!.value)}
            />
            <Segmented
              options={['List', 'Gallery']}
              value={view === 'list' ? 'List' : 'Gallery'}
              onChange={(v) => setView(v === 'List' ? 'list' : 'gallery')}
            />
          </div>

          {empty && <EmptyState isAdmin={!!isAdmin} onAdd={openAdd} />}
          {noMatch && <div className={styles.note}>No products match your search.</div>}

          {!empty && !noMatch && (
            <div className={styles.lines}>
              {filteredGroups.map((g) => (
                <LineSection
                  key={g.line}
                  line={g.line}
                  skus={g.skus}
                  fullSkus={fullByLine.get(g.line) ?? g.skus}
                  view={view}
                  onOpen={onOpen}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {isAdmin && (
        <ProductFormModal
          open={modalOpen}
          sku={editing}
          lines={lineNames}
          onClose={() => setModalOpen(false)}
        />
      )}
    </>
  )
}
