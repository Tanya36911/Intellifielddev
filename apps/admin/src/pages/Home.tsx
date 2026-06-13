import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { health } from '../lib/api'
import { selectSession, useAppDispatch, useAppSelector } from '../store'
import { signedOut } from '../store/auth'
import styles from './Home.module.css'

type ApiState = 'checking' | 'ok' | 'down'

export default function Home() {
  const session = useAppSelector(selectSession)
  const dispatch = useAppDispatch()
  const navigate = useNavigate()
  const [api, setApi] = useState<ApiState>('checking')

  useEffect(() => {
    let cancelled = false
    health().then((ok) => {
      if (!cancelled) setApi(ok ? 'ok' : 'down')
    })
    return () => {
      cancelled = true
    }
  }, [])

  const apiLabel =
    api === 'checking'
      ? 'checking...'
      : api === 'ok'
        ? 'connected'
        : 'not reachable (docker compose up -d)'

  const firstName = session?.user.name.split(' ')[0] ?? 'there'

  return (
    <div className={styles.wrap}>
      <div className={styles.card}>
        <span className={styles.chip}>Phase 1</span>
        <h1 className={styles.welcome}>Welcome, {firstName}</h1>
        <p className={styles.sub}>
          You are signed in as <strong>{session?.user.role}</strong>. The real Admin screens get
          built here, one phase at a time.
        </p>
        <div className={styles.status}>
          <span className={styles.dot} data-state={api} />
          <span>API: {apiLabel}</span>
        </div>
        <button
          className={styles.signOut}
          type="button"
          onClick={() => {
            dispatch(signedOut())
            navigate('/login', { replace: true })
          }}
        >
          Sign out
        </button>
      </div>
    </div>
  )
}
