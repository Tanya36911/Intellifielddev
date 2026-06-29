import { Icon } from '@intelli/ui'
import { Topbar } from '../shell/Topbar'
import styles from './ComingSoon.module.css'

// The shared placeholder for screens that are not built yet. The unbuilt nav
// items route here so nothing dead-ends: a top bar with the screen name and a
// centered card explaining it is on the way.
export default function ComingSoon({ title }: { title: string }) {
  return (
    <>
      <Topbar title={title} />
      <div className={styles.wrap}>
        <div className={styles.card}>
          <div className={styles.iconCircle}>
            <Icon name="sparkles" size={22} />
          </div>
          <div className={styles.name}>{title}</div>
          <div className={styles.line}>This screen is coming soon.</div>
        </div>
      </div>
    </>
  )
}
