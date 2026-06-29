import { Navigate, Route, Routes } from 'react-router-dom'
import Shell from './shell/Shell'
import Login from './pages/Login'
import NoAccess from './pages/NoAccess'
import ComingSoon from './pages/ComingSoon'
import Dashboard from './pages/Dashboard/Dashboard'
import Compliance from './pages/Compliance/Compliance'
import { selectSession, useAppSelector } from './store'

// The doorman. Unauthenticated visitors get the login screen. A field rep who
// signs in hits the NoAccess wall (the Manager app is managers + admins only).
// Managers and admins get the shell, with each screen rendered in its Outlet.
// The four real screens (Dashboard, Compliance Review, Survey Assignment,
// Payroll Approval) are placeholders until their own lanes land; Route Planning
// and Announcements are placeholders for backends that do not exist yet.
export default function App() {
  const session = useAppSelector(selectSession)

  if (!session) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    )
  }

  // Fail closed: only managers and admins reach the shell. Anyone else (a field
  // rep, or any unexpected role) hits the NoAccess wall. The backend still gates
  // every call on the signed token, so this is the front-door defense, not the
  // security boundary.
  if (session.user.role !== 'manager' && session.user.role !== 'admin') {
    return <NoAccess />
  }

  return (
    <Routes>
      <Route path="/login" element={<Navigate to="/" replace />} />
      <Route element={<Shell />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/compliance" element={<Compliance />} />
        <Route path="/assign" element={<ComingSoon title="Survey Assignment" />} />
        <Route path="/payroll" element={<ComingSoon title="Payroll Approval" />} />
        <Route path="/routes" element={<ComingSoon title="Route Planning" />} />
        <Route path="/announcements" element={<ComingSoon title="Announcements" />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
