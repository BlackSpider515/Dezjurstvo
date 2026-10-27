import { useEffect, useRef, useState } from 'react'
import * as pdfjs from 'pdfjs-dist'
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { FileWarning, Loader2 } from 'lucide-react'
import type { Annotation, AnnotationRect } from '../../lib/types'

pdfjs.GlobalWorkerOptions.workerSrc = workerSrc

interface PdfViewerProps {
  blob: Blob
  annotations: Annotation[]
  markerActive: boolean
  onPickRect?: (page: number, rect: AnnotationRect) => void
  onAnnotationClick?: (annotation: Annotation) => void
  onDownload?: () => void
}

interface PageSize {
  width: number
  height: number
}

interface DragState {
  page: number
  startX: number
  startY: number
  x: number
  y: number
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

function PdfCanvas({
  doc,
  pageNumber,
  width,
  height,
}: {
  doc: PDFDocumentProxy
  pageNumber: number
  width: number
  height: number
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    let cancelled = false
    let page: PDFPageProxy | null = null
    let task: ReturnType<PDFPageProxy['render']> | null = null
    const run = async () => {
      page = await doc.getPage(pageNumber)
      if (cancelled || !canvasRef.current) return
      const base = page.getViewport({ scale: 1 })
      const viewport = page.getViewport({ scale: width / base.width })
      const ratio = Math.min(window.devicePixelRatio || 1, 2)
      const canvas = canvasRef.current
      canvas.width = Math.floor(viewport.width * ratio)
      canvas.height = Math.floor(viewport.height * ratio)
      const context = canvas.getContext('2d')
      if (!context) return
      task = page.render({
        canvasContext: context,
        viewport,
        transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined,
      })
      try {
        await task.promise
      } catch {
        // отмена при размонтировании
      }
    }
    run()
    return () => {
      cancelled = true
      if (task) task.cancel()
      if (page) page.cleanup()
    }
  }, [doc, pageNumber, width, height])

  return <canvas ref={canvasRef} className="pdf-canvas" />
}

export function PdfViewer({
  blob,
  annotations,
  markerActive,
  onPickRect,
  onAnnotationClick,
  onDownload,
}: PdfViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  const [sizes, setSizes] = useState<PageSize[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [drag, setDrag] = useState<DragState | null>(null)

  useEffect(() => {
    let cancelled = false
    let loaded: PDFDocumentProxy | null = null
    setLoading(true)
    setError('')
    setDoc(null)
    setSizes([])
    const run = async () => {
      try {
        const data = new Uint8Array(await blob.arrayBuffer())
        const task = pdfjs.getDocument({ data })
        loaded = await task.promise
        if (cancelled) {
          await loaded.destroy()
          return
        }
        setDoc(loaded)
        const containerWidth = containerRef.current?.clientWidth || 760
        const width = Math.max(280, Math.min(containerWidth, 900))
        const nextSizes: PageSize[] = []
        for (let number = 1; number <= loaded.numPages; number++) {
          const page = await loaded.getPage(number)
          const base = page.getViewport({ scale: 1 })
          const scale = Math.max(0.55, (width - 20) / base.width)
          const viewport = page.getViewport({ scale })
          nextSizes.push({ width: viewport.width, height: viewport.height })
        }
        if (!cancelled) setSizes(nextSizes)
      } catch (err) {
        if (!cancelled) setError((err as Error).message || 'Не удалось открыть PDF')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    run()
    return () => {
      cancelled = true
      if (loaded) loaded.destroy().catch(() => undefined)
    }
  }, [blob])

  const pointToNormalized = (event: React.PointerEvent<HTMLDivElement>, page: number) => {
    const rect = event.currentTarget.getBoundingClientRect()
    return {
      page,
      x: clamp01((event.clientX - rect.left) / rect.width),
      y: clamp01((event.clientY - rect.top) / rect.height),
    }
  }

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>, page: number) => {
    if (!markerActive) return
    if (event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    const point = pointToNormalized(event, page)
    setDrag({ ...point, startX: point.x, startY: point.y })
  }

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>, page: number) => {
    if (!drag || drag.page !== page) return
    const point = pointToNormalized(event, page)
    setDrag((current) => (current ? { ...current, x: point.x, y: point.y } : current))
  }

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>, page: number) => {
    if (!drag || drag.page !== page) return
    const point = pointToNormalized(event, page)
    const rect: AnnotationRect = {
      x: Math.min(drag.startX, point.x),
      y: Math.min(drag.startY, point.y),
      w: Math.abs(point.x - drag.startX),
      h: Math.abs(point.y - drag.startY),
    }
    setDrag(null)
    if (rect.w > 0.008 && rect.h > 0.006) onPickRect?.(page, rect)
  }

  if (loading) {
    return (
      <div className="viewer-loading">
        <Loader2 className="spin" size={24} /> Открываем PDF…
      </div>
    )
  }

  if (error) {
    return (
      <div className="viewer-fallback">
        <FileWarning size={30} />
        <h3>PDF не открылся в браузере</h3>
        <p>{error}</p>
        <button type="button" className="btn btn--primary" onClick={onDownload}>
          Скачать файл
        </button>
      </div>
    )
  }

  return (
    <div className={`pdf-viewer ${markerActive ? 'is-marking' : ''}`} ref={containerRef}>
      {doc && sizes.length
        ? sizes.map((size, index) => {
            const pageNumber = index + 1
            return (
              <div
                className="pdf-page-wrap"
                key={pageNumber}
                style={{ width: size.width, height: size.height }}
              >
                <PdfCanvas doc={doc} pageNumber={pageNumber} width={size.width} height={size.height} />
                <div
                  className="pdf-page-overlay"
                  data-page={pageNumber}
                  onPointerDown={(event) => handlePointerDown(event, pageNumber)}
                  onPointerMove={(event) => handlePointerMove(event, pageNumber)}
                  onPointerUp={(event) => handlePointerUp(event, pageNumber)}
                  onPointerCancel={() => setDrag(null)}
                >
                  {annotations
                    .filter(
                      (annotation) => annotation.kind === 'pdf' && annotation.page === pageNumber,
                    )
                    .flatMap((annotation) =>
                      (annotation.rects ?? []).map((rect, rectIndex) => (
                        <button
                          type="button"
                          key={`${annotation.id}-${rectIndex}`}
                          className={`pdf-annotation ${markerActive ? 'is-passive' : ''}`}
                          style={{
                            left: `${rect.x * 100}%`,
                            top: `${rect.y * 100}%`,
                            width: `${rect.w * 100}%`,
                            height: `${rect.h * 100}%`,
                            borderColor: annotation.color,
                            backgroundColor: `${annotation.color}33`,
                          }}
                          title={annotation.comment}
                          aria-label={`Замечание: ${annotation.comment}`}
                          onClick={(event) => {
                            event.stopPropagation()
                            if (!markerActive) onAnnotationClick?.(annotation)
                          }}
                        />
                      )),
                    )}

                  {drag && drag.page === pageNumber ? (
                    <span
                      className="pdf-draft-rect"
                      style={{
                        left: `${Math.min(drag.startX, drag.x) * 100}%`,
                        top: `${Math.min(drag.startY, drag.y) * 100}%`,
                        width: `${Math.abs(drag.x - drag.startX) * 100}%`,
                        height: `${Math.abs(drag.y - drag.startY) * 100}%`,
                      }}
                    />
                  ) : null}
                </div>
                <span className="pdf-page-number">стр. {pageNumber}</span>
              </div>
            )
          })
        : null}
    </div>
  )
}
