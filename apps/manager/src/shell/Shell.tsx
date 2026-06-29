import { Outlet, useNavigate } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { selectSession, useAppDispatch, useAppSelector } from '../store'
import { signedOut } from '../store/auth'
import styles from './Shell.module.css'

// The app shell layout route: the persistent sidebar plus a <main> that renders
// whichever authenticated screen the router matched (the Outlet). Sign-out lives
// in the sidebar's user card and clears the session here.
export default function Shell() {
  const session = useAppSelector(selectSession)
  const dispatch = useAppDispatch()
  const navigate = useNavigate()
  // The route guard in App redirects an unauthenticated visitor; this is defensive.
  if (!session) return null
  return (
    <div className={styles.shell}>
      <Sidebar
        user={session.user}
        onSignOut={() => {
          dispatch(signedOut())
          navigate('/login', { replace: true })
        }}
      />
      <main className={styles.main}>
        <Outlet />
      </main>
    </div>
  )
}
