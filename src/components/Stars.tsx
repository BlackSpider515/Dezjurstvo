import { Star } from 'lucide-react'

interface StarsProps {
  value: number | null | undefined
  onChange?: (value: number | null) => void
  size?: number
  showEmpty?: boolean
  label?: string
}

export function Stars({ value, onChange, size = 18, showEmpty = false, label }: StarsProps) {
  const interactive = Boolean(onChange)
  if (!interactive && !value && !showEmpty) {
    return <span className="muted">—</span>
  }

  return (
    <span
      className={`stars ${interactive ? 'stars--interactive' : ''}`}
      aria-label={label ?? (value ? `Оценка ${value} из 5` : 'Оценки нет')}
    >
      {[1, 2, 3, 4, 5].map((star) => {
        const filled = Boolean(value && star <= value)
        if (!interactive) {
          return (
            <Star
              key={star}
              size={size}
              className={filled ? 'star star--filled' : 'star star--empty'}
              aria-hidden="true"
            />
          )
        }
        return (
          <button
            key={star}
            type="button"
            className={`star-btn ${filled ? 'star-btn--filled' : ''}`}
            onClick={() => onChange?.(star === value ? null : star)}
            aria-label={star === value ? 'Снять оценку' : `Поставить оценку ${star}`}
            title={star === value ? 'Снять оценку' : `Оценка ${star}`}
          >
            <Star size={size + 4} className={filled ? 'star star--filled' : 'star star--empty'} />
          </button>
        )
      })}
    </span>
  )
}
