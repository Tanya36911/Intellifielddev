// The sidebar navigation list, ported from the prototype shell.jsx NAV.
// `path` drives React Router; `comingSoon` flags the not-yet-built screens
// (they route to the shared ComingSoon placeholder and show a "soon" chip).
import { ICONS } from '../ui'

export type NavItem = {
  id: string
  label: string
  icon: keyof typeof ICONS
  group: 'main' | 'org'
  path: string
  badge?: string
  comingSoon?: boolean
}

export const NAV: NavItem[] = [
  { id: 'dashboard', label: 'Analytics', icon: 'chart', group: 'main', path: '/' },
  { id: 'surveys', label: 'Surveys', icon: 'file', group: 'main', path: '/surveys' },
  { id: 'catalog', label: 'Catalog', icon: 'grid', group: 'main', path: '/catalog' },
  { id: 'payroll', label: 'Payroll', icon: 'dollar', group: 'main', path: '/payroll' },
  { id: 'hierarchy', label: 'Hierarchy', icon: 'tree', group: 'org', path: '/hierarchy', comingSoon: true },
  { id: 'users', label: 'Users & Roles', icon: 'users', group: 'org', path: '/users', comingSoon: true },
  { id: 'settings', label: 'Settings', icon: 'settings', group: 'org', path: '/settings', comingSoon: true },
]
