import type { InputHTMLAttributes } from 'react'
import styles from './form.module.css'

// Text input. Ports the prototype .input. Extra props pass through.
export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={className ? `${styles.input} ${className}` : styles.input} {...props} />
}
