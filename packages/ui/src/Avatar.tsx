import styles from './Avatar.module.css'

// A colored circle with a person's initials (first letter of the first two
// words). Defaults to the Intelli accent color and a 28px size.
export function Avatar({
  name,
  color = '#1B4F8A',
  size = 28,
}: {
  name: string
  color?: string
  size?: number
}) {
  const initials = name
    .split(' ')
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
  return (
    <div
      className={styles.avatar}
      style={{ width: size, height: size, background: color, fontSize: size * 0.38 }}
    >
      {initials}
    </div>
  )
}
