import { describe, expect, it, vi, beforeEach } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import { renderApp } from '../../test/render'
import { adminSession } from '../../test/fixtures'
import Builder from './Builder'
import * as api from '@intelli/api-client'

beforeEach(() => {
  vi.spyOn(api, 'apiGet').mockImplementation(async (path: string) => {
    if (path === '/skus') return { skus: [{ id: 'v1', line: 'Velvet Lip', variant: 'Rosewood', upc: '', color: null, status: 'active', reference_images: [], created_at: '' }] } as any
    return {} as any
  })
})

it('on first save it POSTs translated questions and navigates to the edit route', async () => {
  const send = vi.spyOn(api, 'apiSend').mockResolvedValue({ id: 'new1', name: 'My Survey', status: 'draft', versions: [{ id: 'ver1', version_number: 1, published_at: null, questions: [] }] } as any)
  renderApp(<Builder />, { route: '/surveys/new', session: adminSession() })
  fireEvent.change(screen.getByPlaceholderText(/survey name/i), { target: { value: 'My Survey' } })
  fireEvent.click(screen.getByRole('button', { name: /yes \/ no/i }))            // add a question
  fireEvent.change(screen.getByPlaceholderText(/question/i), { target: { value: 'Built?' } })
  fireEvent.click(screen.getByRole('button', { name: /save draft/i }))
  await waitFor(() => expect(send).toHaveBeenCalledWith('POST', '/surveys', expect.objectContaining({ name: 'My Survey' })))
  const body = send.mock.calls[0][2] as any
  expect(body.questions[0].type).toBe('boolean')   // translated to backend type
})

it('adding two questions and reordering swaps their display order', async () => {
  vi.spyOn(api, 'apiSend').mockResolvedValue({ id: 'new1', name: 'Test', status: 'draft', versions: [] } as any)
  renderApp(<Builder />, { route: '/surveys/new', session: adminSession() })
  // Add first question: Yes / No
  fireEvent.click(screen.getByRole('button', { name: /yes \/ no/i }))
  const firstInput = screen.getByPlaceholderText(/question/i)
  fireEvent.change(firstInput, { target: { value: 'First question' } })
  // Add second question: Number
  fireEvent.click(screen.getByRole('button', { name: /^number$/i }))
  const inputs = screen.getAllByPlaceholderText(/question/i)
  fireEvent.change(inputs[1], { target: { value: 'Second question' } })
  // Both prompts visible in order
  const before = screen.getAllByPlaceholderText(/question/i)
  expect((before[0] as HTMLInputElement).value).toBe('First question')
  expect((before[1] as HTMLInputElement).value).toBe('Second question')
  // Click "Move down" on the first question (index 0 -> move down)
  const moveDownButtons = screen.getAllByRole('button', { name: /move down/i })
  fireEvent.click(moveDownButtons[0])
  // After swap: second question is now first
  const after = screen.getAllByPlaceholderText(/question/i)
  expect((after[0] as HTMLInputElement).value).toBe('Second question')
  expect((after[1] as HTMLInputElement).value).toBe('First question')
})
