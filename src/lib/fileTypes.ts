export interface FileKindInfo {
  label: string
  accept: boolean
  preview: 'pdf' | 'docx' | 'xlsx' | 'pptx' | 'txt' | 'video' | 'image' | 'zip' | 'download'
  mime: string
}

const MAP: Record<string, FileKindInfo> = {
  pdf: { label: 'PDF', accept: true, preview: 'pdf', mime: 'application/pdf' },
  doc: { label: 'DOC', accept: true, preview: 'download', mime: 'application/msword' },
  docx: {
    label: 'DOCX',
    accept: true,
    preview: 'docx',
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  },
  xls: { label: 'XLS', accept: true, preview: 'download', mime: 'application/vnd.ms-excel' },
  xlsx: {
    label: 'XLSX',
    accept: true,
    preview: 'xlsx',
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  },
  ppt: { label: 'PPT', accept: true, preview: 'download', mime: 'application/vnd.ms-powerpoint' },
  pptx: {
    label: 'PPTX',
    accept: true,
    preview: 'pptx',
    mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  },
  txt: { label: 'TXT', accept: true, preview: 'txt', mime: 'text/plain' },
  zip: { label: 'ZIP', accept: true, preview: 'zip', mime: 'application/zip' },
  rar: { label: 'RAR', accept: true, preview: 'download', mime: 'application/vnd.rar' },
  mp4: { label: 'MP4', accept: true, preview: 'video', mime: 'video/mp4' },
  png: { label: 'PNG', accept: true, preview: 'image', mime: 'image/png' },
  jpg: { label: 'JPG', accept: true, preview: 'image', mime: 'image/jpeg' },
  jpeg: { label: 'JPEG', accept: true, preview: 'image', mime: 'image/jpeg' },
}

export const ACCEPT_EXTENSIONS = Object.keys(MAP).filter((key) => MAP[key].accept)
export const ACCEPT_ATTR = ACCEPT_EXTENSIONS.map((ext) => `.${ext}`).join(',')

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : ''
}

export function fileKind(name: string): FileKindInfo {
  return (
    MAP[extensionOf(name)] ?? {
      label: extensionOf(name).toUpperCase() || 'FILE',
      accept: false,
      preview: 'download',
      mime: 'application/octet-stream',
    }
  )
}

export function isAcceptedFile(file: File): boolean {
  return Boolean(MAP[extensionOf(file.name)]?.accept)
}

export function safeMime(file: File): string {
  const kind = fileKind(file.name)
  return file.type || kind.mime || 'application/octet-stream'
}

export function sanitizeFileName(name: string): string {
  return name
    .normalize('NFKC')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180)
}

export function validateFile(file: File, limitBytes: number): string | null {
  const kind = fileKind(file.name)
  if (!kind.accept) {
    return 'Неподдерживаемый формат. Разрешены: Office, PDF, TXT, ZIP, RAR и MP4.'
  }
  if (file.size > limitBytes) {
    const mb = Math.round(limitBytes / 1024 / 1024)
    return `Файл больше ${mb} МБ. Уменьшите размер и попробуйте снова.`
  }
  if (file.size === 0) return 'Файл пустой. Выберите другой файл.'
  return null
}

export function isVideo(name: string): boolean {
  return fileKind(name).preview === 'video'
}
