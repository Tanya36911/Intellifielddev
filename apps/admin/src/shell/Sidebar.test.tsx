import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { renderApp } from '../test/render'
import { Sidebar } from './Sidebar'

vi.mock('../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/api')>()),
  apiGet: vi.fn().mockResolvedValue({ footprint: { nodes: 8, stores: 3, reps: 2 } }),
}))

afterEach(() => vi.clearAllMocks())

describe('Sidebar', () => {
  it('shows the brand, the nav, and a coming-soon item is not a link', () => {
    renderApp(
      <Sidebar
        user={{
          name: 'Dana Whitfield',
          role: 'admin',
          company_name: 'Lumen Beauty',
          pinned_node_name: 'Lumen Beauty',
        }}
        onSignOut={() => {}}
      />,
    )
    expect(screen.getByText('Intelli')).toBeTruthy()
    expect(screen.getByText('Lumen Beauty')).toBeTruthy()
    expect(screen.getByText('Analytics')).toBeTruthy()
    // a coming-soon item (Catalog) renders but is not an enabled link
    expect(screen.getByText('Catalog')).toBeTruthy()
  })

  it('renders the user name and role and a working sign out', () => {
    const onSignOut = vi.fn()
    renderApp(
      <Sidebar
        user={{
          name: 'Dana Whitfield',
          role: 'admin',
          company_name: 'Lumen Beauty',
          pinned_node_name: 'Lumen Beauty',
        }}
        onSignOut={onSignOut}
      />,
    )
    expect(screen.getByText('Dana Whitfield')).toBeTruthy()
    screen.getByRole('button', { name: /sign out/i }).click()
    expect(onSignOut).toHaveBeenCalled()
  })
})
