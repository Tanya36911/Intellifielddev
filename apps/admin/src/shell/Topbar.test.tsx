import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Topbar } from './Topbar'

describe('Topbar', () => {
  it('renders the title, subtitle, and its control children', () => {
    render(
      <Topbar title="Analytics" subtitle="All nodes">
        <button>Export</button>
      </Topbar>,
    )
    expect(screen.getByRole('heading', { name: 'Analytics' })).toBeTruthy()
    expect(screen.getByText('All nodes')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Export' })).toBeTruthy()
  })
})
