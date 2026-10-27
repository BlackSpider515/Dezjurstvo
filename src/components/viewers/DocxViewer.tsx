import { useEffect, useRef, useState } from 'react'
import { renderAsync } from 'docx-preview'
import { FileWarning, Loader2 } from 'lucide-react'
import type { Annotation } from '../../lib/types'
import { applyTextHighlights, clearTextHighlights, readSelection } from '../../lib/textRanges'

interface DocxViewerProps {
  blob: Blob
  annotations: Annotation[]
  markerActive: boolean
  onPickRange?: (range: { start: number; end: number; text: string }) => void
  onDownload?: () => void
}

export function DocxViewer({
  blob,
  annotations,
  markerActive,
  onPickRange,
  onDownload,
}: DocxViewerProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    const root = rootRef.current
    if (!root) return
    setReady(false)
    setError('')
    root.innerHTML = ''
    const run = async () => {
      try {
        await renderAsync(blob, root, undefined, {
          className: 'docx-preview',
          inWrapper: true,
          breakPages: true,
          useBase64URL: true,
        })
        if (!cancelled) setReady(true)
      } catch (err) {
        if (!cancelled) setError((err as Error).message || 'Не удалось открыть DOCX')
      }
    }
    run()
    return () => {
      cancelled = true
      root.innerHTML = ''
      clearTextHighlights()
    }
  }, [blob])

  useEffect(() => {
    if (ready) applyTextHighlights(rootRef.current, annotations)
  }, [ready, annotations])

  const handleMouseUp = () => {
    if (!markerActive) return
    const selection = readSelection(rootRef.current)
    if (selection) onPickRange?.(selection)
  }

  if (error) {
    return (
      <div className="viewer-fallback">
        <FileWarning size={30} />
        <h3>DOCX не открылся в браузере</h3>
        <p>{error}</p>
        <button type="button" className="btn btn--primary" onClick={onDownload}>
          Скачать файл
        </button>
      </div>
    )
  }

  return (
    <div className={`docx-viewer ${markerActive ? 'is-marking' : ''}`}>
      {!ready ? (
        <div className="viewer-loading">
          <Loader2 className="spin" size={24} /> Готовим документ…
        </div>
      ) : null}
      <div
        ref={rootRef}
        className="docx-root"
        onMouseUp={handleMouseUp}
        data-testid="docx-root"
      />
      {ready && markerActive ? (
        <p className="viewer-tip">Выделите мышью фрагмент текста с ошибкой — появится поле комментария.</p>
      ) : null}
    </div>
  )
}
