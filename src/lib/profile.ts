import type { TeacherProfileInput } from './types'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PHONE_RE = /^[0-9+()\-\s]{5,30}$/

export const PROFILE_LIMITS = {
  email: 150,
  phone: 30,
  bio: 1000,
} as const

export function normalizeTeacherProfile(input: TeacherProfileInput): TeacherProfileInput {
  return {
    contact_email: input.contact_email?.trim() || null,
    phone: input.phone?.trim() || null,
    bio: input.bio?.trim() || null,
  }
}

export function validateTeacherProfile(input: TeacherProfileInput): string | null {
  const value = normalizeTeacherProfile(input)

  if (value.contact_email) {
    if (value.contact_email.length > PROFILE_LIMITS.email) {
      return `Почта должна быть не длиннее ${PROFILE_LIMITS.email} символов`
    }
    if (!EMAIL_RE.test(value.contact_email)) {
      return 'Укажите корректный адрес почты'
    }
  }

  if (value.phone) {
    if (value.phone.length > PROFILE_LIMITS.phone) {
      return `Телефон должен быть не длиннее ${PROFILE_LIMITS.phone} символов`
    }
    if (!PHONE_RE.test(value.phone)) {
      return 'Телефон может содержать цифры, пробелы, скобки, «+» и дефис'
    }
  }

  if (value.bio && value.bio.length > PROFILE_LIMITS.bio) {
    return `Описание должно быть не длиннее ${PROFILE_LIMITS.bio} символов`
  }

  return null
}
