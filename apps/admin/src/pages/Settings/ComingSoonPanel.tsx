import { Card, Chip, Icon, ICONS } from '../../ui'
import styles from './Settings.module.css'

// A reusable placeholder for sections that are designed but not yet built. Shows
// an icon, a title, an honest description, and a "Coming soon" chip.
export function ComingSoonPanel({
  icon,
  title,
  body,
}: {
  icon: keyof typeof ICONS
  title: string
  body: string
}) {
  return (
    <Card>
      <div className={styles.soonPanel}>
        <div className={styles.soonIcon}><Icon name={icon} size={22} /></div>
        <h3 className={styles.soonTitle}>{title}</h3>
        <p className={styles.soonBody}>{body}</p>
        <Chip>Coming soon</Chip>
      </div>
    </Card>
  )
}
