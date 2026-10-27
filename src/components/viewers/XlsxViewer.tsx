import { useEffect, useState } from 'react'
import * as XLSX from 'xlsx'
import { FileWarning, Loader2, Table2 } from 'lucide-react'

interface SheetData {
  name: string
  rows: string[][]
  colCount: number
  truncated: boolean
}

interface XlsxViewerProps {
  blob: Blob
  onDownload?: () => void
}

const MAX_ROWS = 250
const MAX_COLS = 40

function cellText(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'object') {
    const record = value as { w?: string; v?: unknown }
    if (record.w) return record.w
    if (record.v != null) return String(record.v)
    return ''
  }
  return String(value)
}

export function XlsxViewer({ blob, onDownload }: XlsxViewerProps) {
  const [sheets, setSheets] = useState<SheetData[]>([])
  const [active, setActive] = useState(0)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    const run = async () => {
      try {
        const data = new Uint8Array(await blob.arrayBuffer())
        const workbook = XLSX.read(data, { type: 'array' })
        const next: SheetData[] = []
        for (const name of workbook.SheetNames) {
          const sheet = workbook.Sheets[name]
          if (!sheet) {
            next.push({ name, rows: [], colCount: 0, truncated: false })
            continue
          }
          const ref = sheet['!ref']
          if (!ref) {
            next.push({ name, rows: [], colCount: 0, truncated: false })
            continue
          }
          const range = XLSX.utils.decode_range(ref)
          const endRow = Math.min(range.e.r, MAX_ROWS - 1)
          const endCol = Math.min(range.e.c, MAX_COLS - 1)
          const truncated = range.e.r > endRow || range.e.c > endCol
          const raw = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
            header: 1,
            defval: '',
            raw: false,
            blankrows: false,
            range: { s: { r: 0, c: 0 }, e: { r: endRow, c: endCol } },
          })
          const rows = raw.map((row) => row.map(cellText))
          next.push({
            name,
            rows,
            colCount: endCol + 1,
            truncated,
          })
        }
        if (!cancelled) {
          setSheets(next)
          setActive(0)
        }
      } catch (err) {
        if (!cancelled) setError((err as Error).message || 'Не удалось открыть таблицу')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    run()
    return () => {
      cancelled = true
    }
  }, [blob])

  if (loading) {
    return (
      <div className="viewer-loading">
        <Loader2 className="spin" size={24} /> Открываем таблицу…
      </div>
    )
  }

  if (error) {
    return (
      <div className="viewer-fallback">
        <FileWarning size={30} />
        <h3>Таблица не открылась</h3>
        <p>{error}</p>
        <button type="button" className="btn btn--primary" onClick={onDownload}>
          Скачать файл
        </button>
      </div>
    )
  }

  if (!sheets.length) {
    return (
      <div className="viewer-fallback">
        <Table2 size={30} />
        <h3>В книге нет листов</h3>
      </div>
    )
  }

  const sheet = sheets[active]
  const maxCols = Math.max(sheet.colCount, 1)

  return (
    <div className="xlsx-viewer">
      {sheets.length > 1 ? (
        <div className="sheet-tabs" role="tablist">
          {sheets.map((item, index) => (
            <button
              key={item.name}
              type="button"
              role="tab"
              aria-selected={index === active}
              className={index === active ? 'is-active' : ''}
              onClick={() => setActive(index)}
            >
              {item.name}
            </button>
          ))}
        </div>
      ) : null}
      <div className="table-scroll">
        <table className="sheet-table">
          <thead>
            <tr>
              <th className="row-number">#</th>
              {Array.from({ length: maxCols }, (_, index) => (
                <th key={index}>{XLSX.utils.encode_col(index)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sheet.rows.length ? (
              sheet.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  <th className="row-number">{rowIndex + 1}</th>
                  {Array.from({ length: maxCols }, (_, colIndex) => (
                    <td key={colIndex}>{row[colIndex] ?? ''}</td>
                  ))}
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={maxCols + 1} className="muted">
                  Лист пустой
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {sheet.truncated ? (
        <p className="viewer-tip">
          Показаны первые {MAX_ROWS} строк и {MAX_COLS} столбцов. Полные данные — в скачанном файле.
        </p>
      ) : null}
    </div>
  )
}
