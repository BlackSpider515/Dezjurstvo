import { useEffect, useState } from 'react'
import { Film, ImageIcon } from 'lucide-react'

interface MediaViewerProps {
  blob: Blob
  video: boolean
  name: string
}

export function MediaViewer({ blob, video, name }: MediaViewerProps) {
  const [url, setUrl] = useState('')

  useEffect(() => {
    const next = URL.createObjectURL(blob)
    setUrl(next)
    return () => URL.revokeObjectURL(next)
  }, [blob])

  if (!url) return null

  if (video) {
    return (
      <div className="media-viewer">
        <video controls playsInline preload="metadata" src={url} className="video-player">
          <track kind="captions" />
        </video>
        <p className="viewer-tip">
          <Film size={14} /> Видео воспроизводится прямо в браузере. Если не открывается —
          скачайте файл.
        </p>
      </div>
    )
  }

  return (
    <div className="media-viewer media-viewer--image">
      <img src={url} alt={name} className="image-preview" />
      <p className="viewer-tip">
        <ImageIcon size={14} /> Изображение открыто в браузере.
      </p>
    </div>
  )
}
