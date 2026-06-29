import { NavLink } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Avatar, Icon } from '@intelli/ui'
import { apiGet, type SessionUser } from '@intelli/api-client'
import { NAV, type NavItem } from './nav'
import styles from './Sidebar.module.css'

// The footprint counts (Nodes / Stores / Reps) come from the same dashboard
// endpoint, branch-scoped to the caller, so a manager sees their own branch's
// numbers, not the whole company's.
type Footprint = { nodes: number; stores: number; reps: number }

const DASH = '—'

// One nav row. A real screen is a NavLink with active styling; a coming-soon
// item still links to its placeholder route (so nothing dead-ends) but is muted
// and carries a small "soon" chip.
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
      {item.comingSoon && <span className={styles.soonChip}>soon</span>}
    </NavLink>
  )
}

export function Sidebar({ user, onSignOut }: { user: SessionUser; onSignOut: () => void }) {
  // The footprint comes from the (branch-scoped) dashboard endpoint; while it
  // loads, show dashes.
  const footprint = useQuery({
    queryKey: ['footprint'],
    queryFn: () => apiGet<{ footprint: Footprint }>('/analytics/dashboard').then((d) => d.footprint),
  })

  const stats: [string, string][] = [
    ['Nodes', footprint.data ? String(footprint.data.nodes) : DASH],
    ['Stores', footprint.data ? String(footprint.data.stores) : DASH],
    ['Reps', footprint.data ? String(footprint.data.reps) : DASH],
  ]

  const main = NAV.filter((n) => n.group === 'main')
  const team = NAV.filter((n) => n.group === 'team')

  // The scope label is the name of the node the person is pinned to: a branch
  // for a manager (e.g. "Central"), the company root for an admin (e.g. "Lumen
  // Beauty"). A caller with no pin sees no data, so we say so honestly rather
  // than implying they see everything.
  const scopeName = user.pinned_node_name ?? 'No branch assigned'

  return (
    <aside className={styles.sidebar}>
      {/* brand */}
      <div className={styles.brand}>
        <div className={styles.brandMark}>
          <Icon name="layers" size={17} style={{ color: '#fff' }} />
        </div>
        <div className={styles.brandText}>
          <div className={styles.brandName}>Intelli</div>
          <div className={styles.brandSub}>Manager</div>
        </div>
      </div>

      {/* company card (locked: a manager cannot switch companies) */}
      <div className={styles.companyWrap}>
        <div className={styles.company}>
          <div className={styles.companyMark} />
          <div className={styles.companyText}>
            <div className={styles.companyName}>{user.company_name ?? 'Your company'}</div>
          </div>
          <Icon name="lock" size={13} className={styles.companyLock} />
        </div>
      </div>

      {/* scope chip: you see only your branch, made loud and constant */}
      <div className={styles.scopeWrap}>
        <div className={styles.scope}>
          <Icon name="pin" size={15} className={styles.scopePin} />
          <div className={styles.scopeText}>
            <div className={styles.scopeEyebrow}>Your scope</div>
            <div className={styles.scopeName}>{scopeName}</div>
          </div>
        </div>
      </div>

      {/* nav */}
      <nav className={styles.nav}>
        {main.map((item) => (
          <NavRow key={item.id} item={item} />
        ))}
        <div className={styles.eyebrow}>Team</div>
        {team.map((item) => (
          <NavRow key={item.id} item={item} />
        ))}
      </nav>

      {/* footprint (branch-scoped) */}
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
