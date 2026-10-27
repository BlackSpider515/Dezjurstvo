import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const rawUrl = (import.meta.env.VITE_SUPABASE_URL || '').trim()
const rawKey = (import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim()

export const hasSupabaseConfig =
  /^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(rawUrl) &&
  rawKey.length > 40 &&
  !/YOUR|EXAMPLE|CHANGE_ME/i.test(rawKey)

export const isDemoMode =
  import.meta.env.VITE_DEMO_MODE === 'true' || !hasSupabaseConfig

export const supabase: SupabaseClient | null = isDemoMode
  ? null
  : createClient(rawUrl, rawKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    })

export const supabaseUrl = rawUrl
export const supabaseAnonKey = rawKey
export const defaultSubject =
  (import.meta.env.VITE_SUBJECT_NAME || '').trim() || 'Учебная дисциплина'
export const editingEnabled = import.meta.env.VITE_ENABLE_EDITING === 'true'
export const onlyofficeUrl = (import.meta.env.VITE_ONLYOFFICE_URL || '').trim()
export const uploadLimitBytes = 50 * 1024 * 1024

if (!supabase && !isDemoMode) {
  // Защитная ветка: сюда попасть не должны, но пусть будет явная ошибка.
  console.error('Supabase не настроен и демо-режим выключен')
}
