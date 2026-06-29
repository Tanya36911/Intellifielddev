import { useNavigate } from 'react-router-dom'
import { Icon } from '@intelli/ui'
import { useAppDispatch } from '../store'
import { signedOut } from '../store/auth'
import styles from './NoAccess.module.css'

// Shown when a field rep signs in to the Manager app. The Manager app is for
// managers and admins only; reps have no web app yet. The backend still
// authenticates the rep, so this is a friendly wall with a way back out, not an
// error.
export default function NoAccess() {
  const dispatch = useAppDispatch()
  const navigate = useNavigate()
  return (
    <div className={styles.wrap}>
      <div className={styles.card}>
        <div className={styles.iconCircle}>
          <Icon name="lock" size={22} />
        </div>
        <div className={styles.title}>This app is for managers</div>
        <div className={styles.line}>
          You are signed in as a field rep. The Manager app is for branch managers and
          admins. The rep field app is coming soon.
        </div>
        <button
          type="button"
          className={styles.signOut}
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
