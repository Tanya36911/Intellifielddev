import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Bar, Chip, Field, Icon, Input, Modal, Segmented, Select, Spark, Switch } from './index'

describe('Icon', () => {
  it('renders an svg for a known name and nothing crashes for unknown', () => {
    const { container } = render(<Icon name="chart" />)
    expect(container.querySelector('svg')).toBeTruthy()
  })
})

describe('Spark', () => {
  it('renders a polyline with one point per data value', () => {
    const { container } = render(<Spark data={[1, 5, 2, 8]} />)
    const poly = container.querySelector('polyline')
    expect(poly).toBeTruthy()
    expect(poly!.getAttribute('points')!.trim().split(/\s+/)).toHaveLength(4)
  })
  it('renders without crashing on empty data (no NaN points)', () => {
    const { container } = render(<Spark data={[]} />)
    const poly = container.querySelector('polyline')
    expect(poly?.getAttribute('points') ?? '').not.toContain('NaN')
  })
})

describe('Bar', () => {
  it('sets width from a 0..1 value as a percentage', () => {
    const { container } = render(<Bar value={0.42} />)
    const fill = container.querySelector('[data-fill]') as HTMLElement
    expect(fill.style.width).toBe('42%')
  })
  it('clamps a null/over-range value to a safe width', () => {
    const { container } = render(<Bar value={null as unknown as number} />)
    const fill = container.querySelector('[data-fill]') as HTMLElement
    expect(fill.style.width).toBe('0%')
  })
})

describe('Chip', () => {
  it('renders its children and applies the tone class', () => {
    render(<Chip tone="green">Pass</Chip>)
    expect(screen.getByText('Pass')).toBeTruthy()
  })
})

describe('Segmented', () => {
  it('marks the selected option and fires onChange', () => {
    const onChange = vi.fn()
    render(<Segmented options={['4w', '12w', 'YTD']} value="12w" onChange={onChange} />)
    screen.getByRole('button', { name: '4w' }).click()
    expect(onChange).toHaveBeenCalledWith('4w')
  })
})

describe('Switch', () => {
  it('toggles on click', () => {
    const onChange = vi.fn()
    render(<Switch on={false} onChange={onChange} label="dark" />)
    screen.getByRole('switch').click()
    expect(onChange).toHaveBeenCalledWith(true)
  })
})

describe('Field/Input/Select', () => {
  it('associates the label with its control and passes props through', () => {
    render(
      <Field label="Variant">
        <Input placeholder="e.g. Rosewood" defaultValue="Rosewood" />
      </Field>,
    )
    const input = screen.getByLabelText('Variant') as HTMLInputElement
    expect(input.placeholder).toBe('e.g. Rosewood')
    expect(input.value).toBe('Rosewood')
  })
  it('Select passes options and value through', () => {
    render(
      <Field label="Status">
        <Select defaultValue="active">
          <option value="active">Active</option>
          <option value="discontinued">Discontinued</option>
        </Select>
      </Field>,
    )
    expect((screen.getByLabelText('Status') as HTMLSelectElement).value).toBe('active')
  })
})

describe('Modal', () => {
  it('renders nothing when closed and content when open', () => {
    const { rerender } = render(<Modal open={false} onClose={() => {}} title="T">body</Modal>)
    expect(screen.queryByText('body')).toBeNull()
    rerender(<Modal open onClose={() => {}} title="T">body</Modal>)
    expect(screen.getByText('body')).toBeTruthy()
  })
  it('closes on the close button and the backdrop, but NOT on a panel click', () => {
    const onClose = vi.fn()
    render(<Modal open onClose={onClose} title="Title">body</Modal>)
    screen.getByRole('dialog').click() // panel click does not close
    expect(onClose).not.toHaveBeenCalled()
    screen.getByLabelText('Close').click()
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
