import { useRef, useState } from 'react'
import { Button, Chip, Icon, Modal } from '@intelli/ui'
import { parseCsv, useBulkImportNodes, type BulkImportResult, type BulkImportRow } from './useHierarchy'

type Tab = 'csv' | 'api'

export default function BulkImportModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('csv')
  const [rows, setRows] = useState<BulkImportRow[]>([])
  const [fileName, setFileName] = useState('')
  const [result, setResult] = useState<BulkImportResult | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const bulkImport = useBulkImportNodes()

  function reset() {
    setRows([])
    setFileName('')
    setResult(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  function handleClose() {
    reset()
    onClose()
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setFileName(file.name)
    setResult(null)
    const reader = new FileReader()
    reader.onload = () => setRows(parseCsv(String(reader.result ?? '')))
    reader.readAsText(file)
  }

  async function doImport() {
    const res = await bulkImport.mutateAsync(rows)
    setResult(res)
  }

  const preview = rows.slice(0, 8)

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Bulk import nodes"
      subtitle="Add stores and nodes in bulk via CSV or a connected system."
      width={640}
    >
      {/* tabs */}
      <div style={{ display: 'inline-flex', padding: 3, gap: 2, background: 'var(--bg-elev)', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', marginBottom: 16 }}>
        {(['csv', 'api'] as Tab[]).map(t => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            style={{
              border: 'none', height: 28, padding: '0 12px', borderRadius: 'var(--r-xs)',
              fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
              background: tab === t ? 'var(--surface)' : 'transparent',
              color: tab === t ? 'var(--text)' : 'var(--text-2)',
              boxShadow: tab === t ? 'var(--shadow-xs)' : 'none',
            }}
          >
            <Icon name={t === 'csv' ? 'fileCsv' : 'api'} size={13} style={{ marginRight: 5, verticalAlign: '-2px' }} />
            {t === 'csv' ? 'CSV import' : 'API import'}
          </button>
        ))}
      </div>

      {tab === 'api' && (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '14px 16px', background: 'var(--surface-2)', border: '1px dashed var(--border-strong)', borderRadius: 'var(--r-md)' }}>
          <Icon name="api" size={18} style={{ color: 'var(--text-3)', flexShrink: 0, marginTop: 1 }} />
          <div style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.5 }}>
            Connect Workday, Salesforce, or SAP to sync your org structure automatically.
            <span style={{ marginLeft: 8 }}><Chip>Coming soon</Chip></span>
          </div>
        </div>
      )}

      {tab === 'csv' && !result && (
        <>
          {/* upload zone */}
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            style={{
              width: '100%', border: '2px dashed var(--border-strong)', borderRadius: 'var(--r-lg)',
              background: 'var(--surface-2)', padding: '28px 20px', display: 'flex', flexDirection: 'column',
              alignItems: 'center', gap: 10, cursor: 'pointer',
            }}
          >
            <div style={{ width: 44, height: 44, borderRadius: 12, background: 'var(--accent-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="upload2" size={22} style={{ color: 'var(--accent)' }} />
            </div>
            <div style={{ fontWeight: 600, fontSize: 14 }}>
              {fileName ? fileName : 'Drop a CSV or click to upload'}
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--text-3)', textAlign: 'center' }}>
              Columns: <span style={{ fontFamily: 'var(--mono)' }}>Level, Name, Parent</span>, one node per row
            </div>
          </button>
          <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={handleFile} aria-label="Upload CSV" style={{ display: 'none' }} />

          {/* review */}
          {rows.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>{rows.length} row{rows.length !== 1 ? 's' : ''} ready to import</div>
              <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--r-md)', overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                  <thead>
                    <tr style={{ background: 'var(--surface-2)' }}>
                      <th style={{ textAlign: 'left', padding: '8px 12px', fontSize: 11, color: 'var(--text-3)', fontWeight: 600 }}>Level</th>
                      <th style={{ textAlign: 'left', padding: '8px 12px', fontSize: 11, color: 'var(--text-3)', fontWeight: 600 }}>Name</th>
                      <th style={{ textAlign: 'left', padding: '8px 12px', fontSize: 11, color: 'var(--text-3)', fontWeight: 600 }}>Parent</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.map((r, i) => (
                      <tr key={i} style={{ borderTop: '1px solid var(--border-faint)' }}>
                        <td style={{ padding: '8px 12px' }}>{r.level}</td>
                        <td style={{ padding: '8px 12px', fontWeight: 500 }}>{r.name}</td>
                        <td style={{ padding: '8px 12px', color: 'var(--text-3)' }}>{r.parent}</td>
                      </tr>
                    ))}
                    {rows.length > preview.length && (
                      <tr style={{ borderTop: '1px solid var(--border-faint)' }}>
                        <td colSpan={3} style={{ padding: '8px 12px', textAlign: 'center', color: 'var(--text-3)', background: 'var(--surface-2)' }}>
                          + {rows.length - preview.length} more row{rows.length - preview.length !== 1 ? 's' : ''}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
                <Button variant="primary" onClick={doImport} disabled={bulkImport.isPending}>
                  <Icon name="check" size={15} /> {bulkImport.isPending ? 'Importing...' : `Import ${rows.length} node${rows.length !== 1 ? 's' : ''}`}
                </Button>
                <Button variant="ghost" onClick={reset}>Clear</Button>
              </div>
            </div>
          )}
        </>
      )}

      {/* result */}
      {tab === 'csv' && result && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', background: 'var(--green-bg)', borderRadius: 'var(--r-md)', marginBottom: result.errors.length ? 12 : 0 }}>
            <Icon name="checkCircle" size={18} style={{ color: 'var(--green-fg)' }} />
            <span style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--green-fg)' }}>
              Imported {result.created} node{result.created !== 1 ? 's' : ''}
              {result.errors.length > 0 && `, ${result.errors.length} skipped`}
            </span>
          </div>
          {result.errors.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {result.errors.map((er, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px', background: 'var(--red-bg)', border: '1px solid color-mix(in srgb, var(--red) 30%, transparent)', borderRadius: 'var(--r-md)', fontSize: 12.5 }}>
                  <Icon name="alert" size={14} style={{ color: 'var(--red-fg)', flexShrink: 0 }} />
                  <span style={{ color: 'var(--red-fg)' }}>
                    Row {er.row + 1}{er.name ? `: ${er.name}` : ''} — {er.reason}
                  </span>
                </div>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
            <Button variant="primary" onClick={handleClose}>Done</Button>
            <Button variant="ghost" onClick={reset}>Import another file</Button>
          </div>
        </div>
      )}
    </Modal>
  )
}
