import { Navigate, Route, Routes } from 'react-router-dom'
import Shell from './shell/Shell'
import Dashboard from './pages/Dashboard/Dashboard'
import Catalog from './pages/Catalog/Catalog'
import SurveyList from './pages/Surveys/SurveyList'
import Builder from './pages/Surveys/Builder'
import AssignPanel from './pages/Surveys/AssignPanel'
import ComingSoon from './pages/ComingSoon'
import Hierarchy from './pages/Hierarchy/Hierarchy'
import Login from './pages/Login'
import { selectSession, useAppSelector } from './store'

// The doorman: which web address shows which page, and who gets bounced. The
// authenticated area is a layout route that renders the shell (sidebar + topbar)
// with the matched screen in its Outlet; /login stays outside the shell.
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
  return (
    <Routes>
      <Route path="/login" element={<Navigate to="/" replace />} />
      <Route element={<Shell />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/catalog" element={<Catalog />} />
        <Route path="/surveys" element={<SurveyList />} />
        <Route path="/surveys/new" element={<Builder />} />
        <Route path="/surveys/:id/edit" element={<Builder />} />
        <Route path="/surveys/:id/assign" element={<AssignPanel />} />
        <Route path="/hierarchy" element={<Hierarchy />} />
        <Route path="/users" element={<ComingSoon title="Users & Roles" />} />
        <Route path="/settings" element={<ComingSoon title="Settings" />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
