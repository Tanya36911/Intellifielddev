import { useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { useNavigate } from 'react-router-dom'
import { z } from 'zod'
import { ApiError, login } from '../lib/api'
import { useAppDispatch } from '../store'
import { signedIn } from '../store/auth'
import styles from './Login.module.css'

const schema = z.object({
  email: z
    .string()
    .trim()
    .min(1, 'Enter your email')
    .email('That does not look like an email address'),
  password: z.string().min(1, 'Enter your password'),
})

type FormValues = z.infer<typeof schema>

export default function Login() {
  const dispatch = useAppDispatch()
  const navigate = useNavigate()
  const [serverError, setServerError] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) })

  const onSubmit = handleSubmit(async ({ email, password }) => {
    setServerError(null)
    try {
      const result = await login(email, password)
      dispatch(signedIn({ token: result.token, user: result.user }))
      navigate('/', { replace: true })
    } catch (err) {
      setServerError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.')
    }
  })

  return (
    <div className={styles.wrap}>
      <form className={styles.card} onSubmit={onSubmit} noValidate>
        <div className={styles.wordmark}>
          Intelli <span className={styles.badge}>Admin</span>
        </div>
        <p className={styles.sub}>Sign in to manage your workspace.</p>

        {serverError && (
          <div className={styles.serverError} role="alert">
            {serverError}
          </div>
        )}

        <label className={styles.label} htmlFor="email">
          Email
        </label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          className={styles.input}
          {...register('email')}
        />
        {errors.email && <div className={styles.fieldError}>{errors.email.message}</div>}

        <label className={styles.label} htmlFor="password">
          Password
        </label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          className={styles.input}
          {...register('password')}
        />
        {errors.password && <div className={styles.fieldError}>{errors.password.message}</div>}

        <button className={styles.submit} type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Signing in...' : 'Sign in'}
        </button>

        <div className={styles.devHint}>
          <span className={styles.devTag}>DEV</span>
          <span>
            Demo login: <code>dana@lumenbeauty.com / demo1234</code>
          </span>
        </div>
      </form>
    </div>
  )
}
