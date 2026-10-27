import { Stars } from './Stars'
import { normalizeGradeType } from '../lib/grades'
import type { GradeType } from '../lib/types'

interface GradeBadgeProps {
  grade: number | null | undefined
  type?: GradeType | string | null
  size?: number
  variant?: 'inline' | 'cell' | 'plain'
}

export function GradeBadge({
  grade,
  type,
  size = 14,
  variant = 'inline',
}: GradeBadgeProps) {
  if (grade == null) return <span className="muted">—</span>
  const gradeType = normalizeGradeType(type)

  if (gradeType === 'pass_fail') {
    return (
      <span
        className={`grade-badge grade-badge--${
          grade === 1 ? 'pass' : 'fail'
        } grade-badge--${variant}`}
      >
        {grade === 1 ? 'Зачёт' : 'Незачёт'}
      </span>
    )
  }

  if (gradeType === 'points') {
    return (
      <span className={`grade-badge grade-badge--points grade-badge--${variant}`}>
        <b>{grade}</b>
        <small>/100</small>
      </span>
    )
  }

  if (variant === 'cell') {
    return (
      <span className={`grade-value grade-value--${grade}`}>
        {grade}
        <span className="grade-value__star">★</span>
      </span>
    )
  }

  return (
    <span className="inline-grade">
      <Stars value={grade} size={size} />
      <b>{grade}</b>
    </span>
  )
}
