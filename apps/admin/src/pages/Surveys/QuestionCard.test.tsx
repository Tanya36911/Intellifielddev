import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { QuestionCard } from './QuestionCard'
import { blankQuestion } from './useSurveys'
import type { Sku } from '../Catalog/useCatalog'

const CATALOG: Sku[] = [
  { id: 'v1', line: 'Velvet Lip', variant: 'Rosewood', upc: '', color: null, status: 'active', reference_images: [], created_at: '' },
  { id: 'v2', line: 'Velvet Lip', variant: 'Mauve', upc: '', color: null, status: 'active', reference_images: [], created_at: '' },
]

it('captures sku ids when a line is toggled on a per-product number question', () => {
  const onChange = vi.fn()
  const q = { ...blankQuestion('number'), prompt: 'Facings?', perSku: true }
  render(<QuestionCard q={q} index={0} total={1} catalog={CATALOG} onChange={onChange} onDelete={() => {}} onDup={() => {}} onMove={() => {}} />)
  fireEvent.click(screen.getByText(/Velvet Lip/i))
  const updated = onChange.mock.calls.at(-1)![0]
  expect(updated.lines).toContain('Velvet Lip')
  expect(updated.skuIds.sort()).toEqual(['v1', 'v2'])
})

it('shows the pass summary chip for a scored question', () => {
  const q = { ...blankQuestion('boolean'), prompt: 'Built?', pass: { operator: '==', value: true } }
  render(<QuestionCard q={q} index={0} total={1} catalog={[]} onChange={() => {}} onDelete={() => {}} onDup={() => {}} onMove={() => {}} />)
  expect(screen.getByText('Pass = Yes')).toBeInTheDocument()
})
