const INPUT_LIMIT_BYTES = 10 * 1024 * 1024
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024
const OUTPUT_SIZE = 512

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      URL.revokeObjectURL(url)
      resolve(image)
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Не удалось прочитать изображение'))
    }
    image.src = url
  })
}

export async function prepareAvatar(file: File): Promise<File> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    throw new Error('Для аватара подойдёт JPG, PNG или WebP')
  }
  if (file.size > INPUT_LIMIT_BYTES) {
    throw new Error('Исходное изображение должно быть меньше 10 МБ')
  }

  const image = await loadImage(file)
  const scale = Math.min(1, OUTPUT_SIZE / Math.max(image.naturalWidth, image.naturalHeight))
  const width = Math.max(1, Math.round(image.naturalWidth * scale))
  const height = Math.max(1, Math.round(image.naturalHeight * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Браузер не смог обработать изображение')

  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, width, height)
  context.drawImage(image, 0, 0, width, height)

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, 'image/jpeg', 0.86)
  })
  if (!blob) throw new Error('Не удалось подготовить аватар')
  if (blob.size > AVATAR_MAX_BYTES) {
    throw new Error('Аватар получился больше 2 МБ. Выберите другое изображение.')
  }

  return new File([blob], 'avatar.jpg', { type: 'image/jpeg' })
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(new Error('Не удалось прочитать файл'))
    reader.readAsDataURL(file)
  })
}
