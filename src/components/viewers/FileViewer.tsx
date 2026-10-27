import { Component, type ReactNode } from 'react'
import { FileWarning } from 'lucide-react'
import type { Annotation, AnnotationRect } from '../../lib/types'
import { fileKind } from '../../lib/fileTypes'
import { PdfViewer } from './PdfViewer'
import { DocxViewer } from './DocxViewer'
import { XlsxViewer } from './XlsxViewer'
import { PptxViewer } from './PptxViewer'
import { TextViewer } from './TextViewer'
import { ZipViewer } from './ZipViewer'
import { MediaViewer } from './MediaViewer'
import { DownloadViewer } from './DownloadViewer'

interface FileViewerProps {
  blob: Blob
  name: string
  size: number | null
  annotations: Annotation[]
  markerActive: boolean
  onPickRect?: (page: number, rect: AnnotationRect) => void
  onPickRange?: (range: { start: number; end: number; text: string }) => void
  onAnnotationClick?: (annotation: Annotation) => void
  onDownload?: () => void
}

class ViewerBoundary extends Component<
  { children: ReactNode; onDownload?: () => void },
  { failed: boolean }
> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    if (this.state.failed) {
      return (
        <div className="viewer-fallback">
          <FileWarning size={30} />
          <h3>Не удалось показать файл в браузере</h3>
          <p>Скачайте файл и откройте его на устройстве.</p>
          <button type="button" className="btn btn--primary" onClick={this.props.onDownload}>
            Скачать файл
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

export function FileViewer({
  blob,
  name,
  size,
  annotations,
  markerActive,
  onPickRect,
  onPickRange,
  onAnnotationClick,
  onDownload,
}: FileViewerProps) {
  const kind = fileKind(name)
  const textAnnotations = annotations.filter((annotation) => annotation.kind === 'text')
  const pdfAnnotations = annotations.filter((annotation) => annotation.kind === 'pdf')

  let content: ReactNode
  switch (kind.preview) {
    case 'pdf':
      content = (
        <PdfViewer
          blob={blob}
          annotations={pdfAnnotations}
          markerActive={markerActive}
          onPickRect={onPickRect}
          onAnnotationClick={onAnnotationClick}
          onDownload={onDownload}
        />
      )
      break
    case 'docx':
      content = (
        <DocxViewer
          blob={blob}
          annotations={textAnnotations}
          markerActive={markerActive}
          onPickRange={onPickRange}
          onDownload={onDownload}
        />
      )
      break
    case 'txt':
      content = (
        <TextViewer
          blob={blob}
          annotations={textAnnotations}
          markerActive={markerActive}
          onPickRange={onPickRange}
          onDownload={onDownload}
        />
      )
      break
    case 'xlsx':
      content = <XlsxViewer blob={blob} onDownload={onDownload} />
      break
    case 'pptx':
      content = <PptxViewer blob={blob} onDownload={onDownload} />
      break
    case 'zip':
      content = <ZipViewer blob={blob} onDownload={onDownload} />
      break
    case 'video':
      content = <MediaViewer blob={blob} video name={name} />
      break
    case 'image':
      content = <MediaViewer blob={blob} video={false} name={name} />
      break
    default:
      content = (
        <DownloadViewer
          name={name}
          size={size}
          label={kind.label}
          description={
            kind.label === 'RAR'
              ? 'Архив RAR нельзя распаковать в браузере без внешнего сервиса. Скачайте его и откройте в проводнике.'
              : `Формат ${kind.label} не поддерживает просмотр в браузере без сторонних сервисов. Скачайте файл и откройте его в Office.`
          }
          onDownload={onDownload}
        />
      )
  }

  return (
    <ViewerBoundary onDownload={onDownload}>
      <div className="file-viewer-shell" data-file-kind={kind.preview}>
        {content}
      </div>
    </ViewerBoundary>
  )
}
