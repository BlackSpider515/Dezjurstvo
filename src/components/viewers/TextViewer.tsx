import { useEffect, useRef, useState } from 'react'
import { FileWarning, Loader2 } from 'lucide-react'
import type { Annotation } from '../../lib/types'
import { applyTextHighlights, clearTextHighlights, readSelection } from '../../lib/textRanges'

interface TextViewerProps {
  blob: Blob
  annotations: Annotation[]
  markerActive: boolean
  onPickRange?: (range: { start: number; end: number; text: string }) => void
  onDownload?: () => void
}

export function TextViewer({
  blob,
  annotations,
  markerActive,
  onPickRange,
  onDownload,
}: TextViewerProps) {
  const rootRef = useRef<HTMLPreElement>(null)
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    blob
      .text()
      .then((value) => {
        if (!cancelled) setText(value)
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
      clearTextHighlights()
    }
  }, [blob])

  useEffect(() => {
    if (loading) return
    applyTextHighlights(rootRef.current, annotations)
  }, [loading, text, annotations])

  const handleMouseUp = () => {
    if (!markerActive) return
    const selection = readSelection(rootRef.current)
    if (selection) onPickRange?.(selection)
  }

  if (loading) {
    return (
      <div className="viewer-loading">
        <Loader2 className="spin" size={24} /> Читаем текст…
      </div>
    )
  }

  if (error) {
    return (
      <div className="viewer-fallback">
        <FileWarning size={30} />
        <h3>TXT не открылся</h3>
        <p>{error}</p>
        <button type="button" className="btn btn--primary" onClick={onDownload}>
          Скачать файл
        </button>
      </div>
    )
  }

  return (
    <div className={`txt-viewer ${markerActive ? 'is-marking' : ''}`}>
      <pre ref={rootRef} className="txt-root" onMouseUp={handleMouseUp} data-testid="txt-root">
        {text}
      </pre>
      {markerActive ? (
        <p className="viewer-tip">Выделите мышью фрагмент текста с ошибкой — появится поле комментария.</p>
      ) : null}
    </div>
  )
}
