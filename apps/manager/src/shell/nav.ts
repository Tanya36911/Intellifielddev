// The Manager sidebar navigation, ported from the prototype dm-shell.jsx DM_NAV.
// `path` drives React Router; `comingSoon` flags a screen whose backend does not
// exist yet (Route Planning needs geo/routing, Announcements needs messaging),
// shown greyed with a "soon" chip instead of an active link.
import { ICONS } from '@intelli/ui'

export type NavItem = {
  id: string
  label: string
  icon: keyof typeof ICONS
  group: 'main' | 'team'
  path: string
  comingSoon?: boolean
}

export const NAV: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: 'chart', group: 'main', path: '/' },
  { id: 'compliance', label: 'Compliance Review', icon: 'shieldCheck', group: 'main', path: '/compliance' },
  { id: 'assign', label: 'Survey Assignment', icon: 'file', group: 'main', path: '/assign' },
  { id: 'routes', label: 'Route Planning', icon: 'pin', group: 'main', path: '/routes', comingSoon: true },
  { id: 'payroll', label: 'Payroll Approval', icon: 'dollar', group: 'main', path: '/payroll' },
  { id: 'announcements', label: 'Announcements', icon: 'send', group: 'team', path: '/announcements', comingSoon: true },
]
