import { NavLink } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Avatar, Chip, Icon } from '@intelli/ui'
import { apiGet, type SessionUser } from '@intelli/api-client'
import { NAV, type NavItem } from './nav'
import styles from './Sidebar.module.css'

// The footprint counts the dashboard endpoint also returns. Reused here so the
// sidebar shows Nodes / Stores / Reps without its own endpoint.
type Footprint = { nodes: number; stores: number; reps: number }

const DASH = '—'

// One nav row. A real screen is a NavLink with active styling; a coming-soon
// item is still a NavLink to its placeholder route (so the ComingSoon page
// shows) but muted and carrying a small "soon" chip.
function NavRow({ item }: { item: NavItem }) {
  return (
    <NavLink
      to={item.path}
      end={item.path === '/'}
      className={({ isActive }) =>
        [styles.navItem, isActive ? styles.active : '', item.comingSoon ? styles.soon : '']
          .filter(Boolean)
          .join(' ')
      }
      title={item.comingSoon ? 'Coming soon' : undefined}
    >
      <Icon name={item.icon} size={17} className={styles.navIcon} />
      <span className={styles.navLabel}>{item.label}</span>
      {item.badge && <Chip tone="accent">{item.badge}</Chip>}
      {item.comingSoon && <span className={styles.soonChip}>soon</span>}
    </NavLink>
  )
}

export function Sidebar({ user, onSignOut }: { user: SessionUser; onSignOut: () => void }) {
  // The footprint comes from the dashboard endpoint; while it loads, show dashes.
  const footprint = useQuery({
    queryKey: ['footprint'],
    queryFn: () => apiGet<{ footprint: Footprint }>('/analytics/dashboard').then((d) => d.footprint),
  })

  const stats: [string, string][] = [
    ['Nodes', footprint.data ? String(footprint.data.nodes) : DASH],
    ['Stores', footprint.data ? String(footprint.data.stores) : DASH],
    ['Reps', footprint.data ? String(footprint.data.reps) : DASH],
  ]

  // Admin-only items (the Setup wizard) are hidden from non-admins; the route
  // still redirects them and the backend still guards.
  const isAdmin = user.role === 'admin'
  const visible = NAV.filter((n) => !n.adminOnly || isAdmin)
  const main = visible.filter((n) => n.group === 'main')
  const org = visible.filter((n) => n.group === 'org')

  return (
    <aside className={styles.sidebar}>
      {/* brand */}
      <div className={styles.brand}>
        <div className={styles.brandMark}>
          <Icon name="layers" size={17} style={{ color: '#fff' }} />
        </div>
        <div className={styles.brandText}>
          <div className={styles.brandName}>Intelli</div>
          <div className={styles.brandSub}>Field Execution</div>
        </div>
      </div>

      {/* company card (static: one company per login, no switcher) */}
      <div className={styles.companyWrap}>
        <div className={styles.company}>
          <div className={styles.companyMark} />
          <div className={styles.companyText}>
            <div className={styles.companyName}>{user.company_name ?? 'Your company'}</div>
          </div>
        </div>
      </div>

      {/* nav */}
      <nav className={styles.nav}>
        {main.map((item) => (
          <NavRow key={item.id} item={item} />
        ))}
        <div className={styles.eyebrow}>Organization</div>
        {org.map((item) => (
          <NavRow key={item.id} item={item} />
        ))}

        {/* The setup wizard, now a real fullscreen flow. Admins only; the
            prominent accent card mirrors the prototype's entry point. */}
        {isAdmin && (
          <div className={styles.wizardWrap}>
            <NavLink to="/setup" className={styles.wizard}>
              <Icon name="wand" size={16} />
              <span className={styles.navLabel}>Set up your workspace</span>
              <Icon name="arrowRight" size={14} />
            </NavLink>
          </div>
        )}
      </nav>

      {/* footprint */}
      <div className={styles.footprint}>
        {stats.map(([label, value]) => (
          <div key={label}>
            <div className={styles.footprintNum}>{value}</div>
            <div className={styles.footprintLabel}>{label}</div>
          </div>
        ))}
      </div>

      {/* user card */}
      <div className={styles.user}>
        <Avatar name={user.name} size={30} />
        <div className={styles.userText}>
          <div className={styles.userName}>{user.name}</div>
          <div className={styles.userMeta}>
            {user.role}, pinned to {user.pinned_node_name ?? 'no pin'}
          </div>
        </div>
        <button
          type="button"
          className={styles.signOut}
          aria-label="Sign out"
          title="Sign out"
          onClick={onSignOut}
        >
          <Icon name="logout" size={15} />
        </button>
      </div>
    </aside>
  )
}
