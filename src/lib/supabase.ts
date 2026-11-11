import { createClient, type SupabaseClient } from '@supabase/supabase-js'

function configuredClient(): SupabaseClient | null {
  const url = import.meta.env.VITE_SUPABASE_URL
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY
  if (typeof url !== 'string' || typeof key !== 'string') return null
  try {
    const parsed = new URL(url)
    if (!['http:', 'https:'].includes(parsed.protocol)) return null
    // Only browser-safe publishable keys or legacy JWTs explicitly carrying anon role.
    let allowed = /^sb_publishable_[A-Za-z0-9_-]+$/.test(key)
    if (!allowed && key.split('.').length === 3) {
      const payload = JSON.parse(atob(key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))) as { role?: string }
      allowed = payload.role === 'anon'
    }
    if (!allowed) return null
    return createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } })
  } catch {
    return null
  }
}

export const supabase = configuredClient()
