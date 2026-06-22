import { Chip } from '../../ui'
import type { Sku } from './useCatalog'

// Active = green dot chip; Discontinued = plain chip. (No "new" status exists.)
export function StatusPill({ status }: { status: Sku['status'] }) {
  if (status === 'discontinued') return <Chip>Discontinued</Chip>
  return (
    <Chip tone="green" dot>
      Active
    </Chip>
  )
}
