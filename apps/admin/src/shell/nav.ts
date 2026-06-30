// The sidebar navigation list, ported from the prototype shell.jsx NAV.
// `path` drives React Router; `comingSoon` flags a not-yet-built screen, which
// the sidebar shows with a "soon" chip instead of a link. `adminOnly` hides an
// item from non-admins (the route still redirects them, the backend still
// guards): used by the Setup wizard.
import { ICONS } from '@intelli/ui'

export type NavItem = {
  id: string
  label: string
  icon: keyof typeof ICONS
  group: 'main' | 'org'
  path: string
  badge?: string
  comingSoon?: boolean
  adminOnly?: boolean
}

export const NAV: NavItem[] = [
  { id: 'dashboard', label: 'Analytics', icon: 'chart', group: 'main', path: '/' },
  // Form Builder is the prototype's AI-draft entry point. It opens the real
  // survey builder; the "describe it and draft" AI assist is a documented
  // fast-follow, so the AI badge is aspirational (the prototype labels it the
  // same way). Kept as its own item to match the prototype sidebar.
  { id: 'forms', label: 'Form Builder', icon: 'sparkles', group: 'main', path: '/surveys/new', badge: 'AI' },
  { id: 'surveys', label: 'Surveys', icon: 'file', group: 'main', path: '/surveys' },
  { id: 'catalog', label: 'Catalog', icon: 'box', group: 'main', path: '/catalog' },
  // Payroll and Setup are real built screens the prototype's sidebar predates;
  // kept here so the working features stay reachable.
  { id: 'payroll', label: 'Payroll', icon: 'dollar', group: 'main', path: '/payroll' },
  { id: 'hierarchy', label: 'Hierarchy', icon: 'tree', group: 'org', path: '/hierarchy' },
  { id: 'users', label: 'Users & Roles', icon: 'users', group: 'org', path: '/users' },
  { id: 'settings', label: 'Settings', icon: 'settings', group: 'org', path: '/settings' },
  { id: 'setup', label: 'Setup', icon: 'wand', group: 'org', path: '/setup', adminOnly: true },
]
