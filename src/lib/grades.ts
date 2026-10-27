import type { GradeType } from './types'

export const GRADE_TYPES: Array<{ value: GradeType; label: string; hint: string }> = [
  {
    value: 'stars',
    label: 'Оценки 1–5',
    hint: 'Классическая оценка звёздами',
  },
  {
    value: 'pass_fail',
    label: 'Зачёт / Незачёт',
    hint: 'Две отметки без промежуточных значений',
  },
  {
    value: 'points',
    label: 'Баллы 0–100',
    hint: 'Числовая оценка от 0 до 100',
  },
]

export function normalizeGradeType(value: string | null | undefined): GradeType {
  return value === 'pass_fail' || value === 'points' ? value : 'stars'
}

export function gradeTypeLabel(value: string | null | undefined): string {
  const type = normalizeGradeType(value)
  return GRADE_TYPES.find((item) => item.value === type)?.label ?? 'Оценки 1–5'
}

export function gradeLabel(type: string | null | undefined, grade: number | null): string {
  if (grade == null) return '—'
  const normalized = normalizeGradeType(type)
  if (normalized === 'pass_fail') return grade === 1 ? 'Зачёт' : 'Незачёт'
  if (normalized === 'points') return `${grade} из 100`
  return `${grade} из 5`
}

export function gradeShortLabel(type: string | null | undefined, grade: number | null): string {
  if (grade == null) return '—'
  const normalized = normalizeGradeType(type)
  if (normalized === 'pass_fail') return grade === 1 ? 'Зачёт' : 'Незачёт'
  return String(grade)
}

export function gradeRatio(type: string | null | undefined, grade: number | null): number {
  if (grade == null) return 0
  const normalized = normalizeGradeType(type)
  if (normalized === 'pass_fail') return grade === 1 ? 1 : 0
  if (normalized === 'points') return Math.max(0, Math.min(1, grade / 100))
  return Math.max(0, Math.min(1, grade / 5))
}

export function validateGrade(
  type: string | null | undefined,
  grade: number | null,
): string | null {
  if (grade == null) return null
  if (!Number.isInteger(grade)) return 'Оценка должна быть целым числом'
  const normalized = normalizeGradeType(type)
  if (normalized === 'pass_fail') {
    return grade === 0 || grade === 1 ? null : 'Для зачёта доступны только «Зачёт» и «Незачёт»'
  }
  if (normalized === 'points') {
    return grade >= 0 && grade <= 100 ? null : 'Балл должен быть от 0 до 100'
  }
  return grade >= 1 && grade <= 5 ? null : 'Оценка должна быть от 1 до 5'
}

export function isOverdue(dueAt: string | null | undefined): boolean {
  if (!dueAt) return false
  const time = new Date(dueAt).getTime()
  return !Number.isNaN(time) && time < Date.now()
}

/** Переводит ISO/дату в значение для input[type="datetime-local"] в местном времени. */
export function toDateTimeLocal(value: string | null | undefined): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`
}
