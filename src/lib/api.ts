import { isDemoMode } from './supabase'
import { demoBackend } from './demo/demoBackend'
import { supabaseBackend } from './supabaseBackend'

export const backend = isDemoMode ? demoBackend : supabaseBackend
export const appMode = backend.mode
export { isDemoMode }
