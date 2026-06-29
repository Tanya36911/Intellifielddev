import type { ButtonHTMLAttributes } from 'react'
import styles from './Button.module.css'

export type ButtonVariant = 'default' | 'primary' | 'ghost' | 'danger' | 'icon'
export type ButtonSize = 'default' | 'sm' | 'lg'

// The shared button. Ports the prototype .btn variants. Any extra props (onClick,
// type, disabled, aria-*) pass straight through to the underlying <button>.
export function Button({
  variant = 'default',
  size = 'default',
  className,
  ...props
}: {
  variant?: ButtonVariant
  size?: ButtonSize
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  const classes = [styles.btn]
  if (variant !== 'default') classes.push(styles[variant])
  if (size !== 'default') classes.push(styles[size])
  if (className) classes.push(className)
  return <button className={classes.join(' ')} {...props} />
}
