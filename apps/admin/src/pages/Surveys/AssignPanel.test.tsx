import { describe, expect, it, vi, beforeEach } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import { renderApp } from '../../test/render'
import { adminSession } from '../../test/fixtures'
import AssignPanel from './AssignPanel'
import * as api from '../../lib/api'

beforeEach(() => {
  vi.spyOn(api, 'apiGet').mockImplementation(async (path: string) => {
    if (path === '/nodes') return { nodes: [
      { id: 'root', name: 'Lumen Beauty', code: 'lumen', level_order: 0, parent_id: null, path: '/root/' },
      { id: 'west', name: 'West Region', code: 'west', level_order: 1, parent_id: 'root', path: '/root/west/' },
    ] } as any
    if (path.startsWith('/surveys/')) return { id: 's1', name: 'Velvet Lip Shelf Check', status: 'published', versions: [{ id: 'ver1', version_number: 1, published_at: '2026-06-23', questions: [] }] } as any
    return {} as any
  })
})

it('assigns to the selected node then navigates back', async () => {
  const send = vi.spyOn(api, 'apiSend').mockResolvedValue({ id: 'a1' } as any)
  renderApp(<AssignPanel />, { route: '/surveys/s1/assign', session: adminSession() })
  // default selection is "all stores" (root); just assign
  fireEvent.click(await screen.findByRole('button', { name: /^assign$/i }))
  await waitFor(() => expect(send).toHaveBeenCalledWith('POST', '/survey-assignments', expect.objectContaining({ target_node_id: 'root', timezone_basis: 'rep-local' })))
})
