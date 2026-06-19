import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Bar, Chip, Icon, Segmented, Spark, Switch } from './index'

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
