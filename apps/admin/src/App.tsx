import { useEffect, useState } from 'react'
import styles from './App.module.css'

type ApiState = 'checking' | 'ok' | 'down'

export default function App() {
  const [api, setApi] = useState<ApiState>('checking')

  useEffect(() => {
    fetch('http://localhost:8000/health')
      .then((r) => r.json())
      .then((d) => setApi(d.status === 'ok' ? 'ok' : 'down'))
      .catch(() => setApi('down'))
  }, [])

  const apiLabel =
    api === 'checking' ? 'checking…' : api === 'ok' ? 'connected' : 'not reachable — run `docker compose up`'

  return (
    <div className={styles.wrap}>
      <div className={styles.card}>
        <span className={styles.badge}>Phase 0</span>
        <h1 className={styles.h1}>Intelli Admin</h1>
        <p className={styles.sub}>
          Production scaffold is live. Shared design tokens, the React + Vite build, and the
          API health check are all wired up. Features get built on top of this, one phase at a time.
        </p>
        <div className={styles.status}>
          <span className={styles.dot} data-state={api} />
          <span>API: {apiLabel}</span>
        </div>
      </div>
    </div>
  )
}
