import { Download, FileText, Info } from 'lucide-react'
import { formatSize } from '../../lib/format'

interface DownloadViewerProps {
  name: string
  size: number | null
  label: string
  description: string
  onDownload?: () => void
}

export function DownloadViewer({
  name,
  size,
  label,
  description,
  onDownload,
}: DownloadViewerProps) {
  return (
    <div className="viewer-fallback viewer-fallback--download">
      <span className="viewer-fallback__kind">{label}</span>
      <FileText size={34} />
      <h3>{name}</h3>
      <p>{description}</p>
      <p className="muted">{formatSize(size)}</p>
      <button type="button" className="btn btn--primary" onClick={onDownload}>
        <Download size={17} /> Скачать файл
      </button>
      <div className="hint">
        <Info size={15} />
        <span>
          Файлы старых форматов и RAR не открываются в браузере без внешнего сервера — это
          сделано намеренно, чтобы не передавать работу сторонним онлайн-просмотрщикам.
        </span>
      </div>
    </div>
  )
}
