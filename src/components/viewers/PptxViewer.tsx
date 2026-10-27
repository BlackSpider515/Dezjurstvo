import { useEffect, useState } from 'react'
import JSZip from 'jszip'
import { FileWarning, Loader2, Presentation } from 'lucide-react'

interface SlideText {
  number: number
  lines: string[]
}

interface PptxViewerProps {
  blob: Blob
  onDownload?: () => void
}

export function PptxViewer({ blob, onDownload }: PptxViewerProps) {
  const [slides, setSlides] = useState<SlideText[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    const run = async () => {
      try {
        const zip = await JSZip.loadAsync(blob)
        const slideFiles = Object.keys(zip.files)
          .map((path) => {
            const match = /^ppt\/slides\/slide(\d+)\.xml$/.exec(path)
            return match ? { path, number: Number(match[1]) } : null
          })
          .filter((item): item is { path: string; number: number } => item !== null)
          .sort((a, b) => a.number - b.number)
          .slice(0, 100)

        const parser = new DOMParser()
        const result: SlideText[] = []
        for (const item of slideFiles) {
          const xml = await zip.files[item.path].async('text')
          const document = parser.parseFromString(xml, 'application/xml')
          const lines: string[] = []
          const paragraphs = document.getElementsByTagName('a:p')
          for (let index = 0; index < paragraphs.length; index++) {
            const paragraph = paragraphs[index]
            const runs = paragraph.getElementsByTagName('a:t')
            let text = ''
            for (let run = 0; run < runs.length; run++) text += runs[run].textContent ?? ''
            if (text.trim()) lines.push(text.trim())
          }
          result.push({ number: item.number, lines })
        }
        if (!cancelled) setSlides(result)
      } catch (err) {
        if (!cancelled) setError((err as Error).message || 'Не удалось открыть презентацию')
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
        <Loader2 className="spin" size={24} /> Разбираем презентацию…
      </div>
    )
  }

  if (error) {
    return (
      <div className="viewer-fallback">
        <FileWarning size={30} />
        <h3>PPTX не открылся в браузере</h3>
        <p>{error}</p>
        <button type="button" className="btn btn--primary" onClick={onDownload}>
          Скачать файл
        </button>
      </div>
    )
  }

  return (
    <div className="pptx-viewer">
      <div className="viewer-banner">
        <Presentation size={18} />
        <span>
          Упрощённый просмотр: текст слайдов без оформления. Точный вид — в скачанном файле.
        </span>
      </div>
      {slides.map((slide) => (
        <article className="slide-card" key={slide.number}>
          <span className="slide-card__number">Слайд {slide.number}</span>
          {slide.lines.length ? (
            <div className="slide-card__text">
              {slide.lines.map((line, index) => (
                <p key={index}>{line}</p>
              ))}
            </div>
          ) : (
            <p className="muted">На слайде нет текста (только изображения или фигуры).</p>
          )}
        </article>
      ))}
      {!slides.length ? <p className="muted">Слайды не найдены.</p> : null}
    </div>
  )
}
