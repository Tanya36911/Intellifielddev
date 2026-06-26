import styles from './steps.module.css'

// The title + subtitle block at the top of every step body. Ports the
// prototype's StepHead.
export function StepHead({ title, sub }: { title: string; sub: string }) {
  return (
    <div className={styles.head}>
      <h1 className={styles.headTitle}>{title}</h1>
      <p className={styles.headSub}>{sub}</p>
    </div>
  )
}

// Dot colours by depth, matching the Hierarchy legend (company -> store).
export const LEVEL_DOT_COLORS = ['#1B4F8A', '#0ea5e9', '#16a34a', '#d97706', '#71717a']

export function dotColor(index: number): string {
  return LEVEL_DOT_COLORS[Math.min(index, LEVEL_DOT_COLORS.length - 1)]
}
