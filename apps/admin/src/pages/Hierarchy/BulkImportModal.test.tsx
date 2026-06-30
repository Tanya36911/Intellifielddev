import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import { renderApp } from '../../test/render'
import { adminSession } from '../../test/fixtures'
import BulkImportModal from './BulkImportModal'
import { apiSend } from '@intelli/api-client'

vi.mock('@intelli/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@intelli/api-client')>()
  return { ...actual, apiSend: vi.fn() }
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(apiSend).mockResolvedValue({ created: 2, errors: [] })
})

describe('BulkImportModal', () => {
  it('parses an uploaded CSV and imports the rows', async () => {
    renderApp(<BulkImportModal open onClose={vi.fn()} />, { session: adminSession() })

    const input = screen.getByLabelText('Upload CSV') as HTMLInputElement
    const file = new File(
      ['Level,Name,Parent\nStore,Foo Store,Bay Area\nStore,Bar Store,Bay Area'],
      'stores.csv',
      { type: 'text/csv' },
    )
    fireEvent.change(input, { target: { files: [file] } })

    // FileReader is async; the review appears once the file is parsed.
    await waitFor(() => expect(screen.getByText('2 rows ready to import')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: /import 2 nodes/i }))

    await waitFor(() => expect(screen.getByText('Imported 2 nodes')).toBeTruthy())
    expect(apiSend).toHaveBeenCalledWith('POST', '/nodes/bulk', {
      rows: [
        { level: 'Store', name: 'Foo Store', parent: 'Bay Area' },
        { level: 'Store', name: 'Bar Store', parent: 'Bay Area' },
      ],
    })
  })
})
