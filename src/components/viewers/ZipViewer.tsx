import { useEffect, useState } from 'react'
import JSZip from 'jszip'
import { FileArchive, FileText, Folder, Loader2 } from 'lucide-react'
import { formatSize } from '../../lib/format'

interface ZipEntry {
  path: string
  dir: boolean
  size: number
}

interface ZipViewerProps {
  blob: Blob
  onDownload?: () => void
}

export function ZipViewer({ blob, onDownload }: ZipViewerProps) {
  const [entries, setEntries] = useState<ZipEntry[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [truncated, setTruncated] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    const run = async () => {
      try {
        const zip = await JSZip.loadAsync(blob)
        const list: ZipEntry[] = []
        zip.forEach((path, file) => {
          const data = (file as unknown as { _data?: { uncompressedSize?: number } })._data
          list.push({
            path,
            dir: file.dir,
            size: data?.uncompressedSize ?? 0,
          })
        })
        list.sort((a, b) => {
          if (a.dir !== b.dir) return a.dir ? -1 : 1
          return a.path.localeCompare(b.path, 'ru')
        })
        if (!cancelled) {
          setTruncated(list.length > 500)
          setEntries(list.slice(0, 500))
        }
      } catch (err) {
        if (!cancelled) setError((err as Error).message || 'Не удалось прочитать архив')
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
        <Loader2 className="spin" size={24} /> Читаем содержимое архива…
      </div>
    )
  }

  if (error) {
    return (
      <div className="viewer-fallback">
        <FileArchive size={30} />
        <h3>Архив не открылся</h3>
        <p>
          {error}. Возможно, архив защищён паролем. Скачайте файл и откройте его на компьютере.
        </p>
        <button type="button" className="btn btn--primary" onClick={onDownload}>
          Скачать архив
        </button>
      </div>
    )
  }

  return (
    <div className="zip-viewer">
      <div className="viewer-banner">
        <FileArchive size={18} />
        <span>Содержимое архива. Файлы можно посмотреть, скачав архив целиком.</span>
      </div>
      <ul className="zip-list">
        {entries.map((entry) => (
          <li key={entry.path} className={entry.dir ? 'is-dir' : ''}>
            <span className="zip-list__icon">
              {entry.dir ? <Folder size={16} /> : <FileText size={16} />}
            </span>
            <span className="zip-list__path">{entry.path}</span>
            <span className="zip-list__size">{entry.dir ? '' : formatSize(entry.size)}</span>
          </li>
        ))}
      </ul>
      {!entries.length ? <p className="muted">Архив пустой.</p> : null}
      {truncated ? (
        <p className="viewer-tip">Показаны первые 500 элементов. Остальные — в скачанном архиве.</p>
      ) : null}
    </div>
  )
}
