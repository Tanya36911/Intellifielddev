import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiSend } from '../../lib/api'

export type Role = 'admin' | 'manager' | 'rep'

export type User = {
  id: string
  name: string
  email: string
  role: Role
  pinned_node_id: string | null
  pinned_node_name: string | null
  pinned_node_level_order: number | null
}

export type UserInput = {
  name: string
  email: string
  role: Role
  password: string
  node_id?: string | null
}

export type UserPatch = { role?: Role; node_id?: string | null }

export function useUsers() {
  return useQuery({
    queryKey: ['users'],
    queryFn: () => apiGet<{ users: User[]; count: number }>('/users'),
  })
}

export function useCreateUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: UserInput) => apiSend<User>('POST', '/users', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  })
}

export function useUpdateUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UserPatch }) =>
      apiSend<User>('PATCH', `/users/${id}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  })
}

// ----- pure helpers (unit-tested) -----

export function roleCounts(users: User[]): { admin: number; manager: number; rep: number } {
  return {
    admin: users.filter((u) => u.role === 'admin').length,
    manager: users.filter((u) => u.role === 'manager').length,
    rep: users.filter((u) => u.role === 'rep').length,
  }
}

export function inheritanceText(role: Role, levelName: string | null): string {
  if (!levelName) return 'No pin yet, so this person sees nothing until you pin them.'
  if (role === 'admin' || levelName === 'Company')
    return 'Sees the entire company: every region, district and store.'
  if (levelName === 'Region') return 'Sees all districts and stores in this region.'
  if (levelName === 'District') return 'Sees all stores in this district.'
  return 'Scoped to this node and everything below it.'
}

export const ROLE_META: Record<Role, { label: string; tone: 'violet' | 'blue' | 'green' }> = {
  admin: { label: 'Admin', tone: 'violet' },
  manager: { label: 'Manager', tone: 'blue' },
  rep: { label: 'Rep', tone: 'green' },
}
