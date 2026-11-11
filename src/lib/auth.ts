import type { AuthChangeEvent, Session } from '@supabase/supabase-js'
import type { Trainer } from '../domain/types'
import { supabase } from './supabase'

export interface AuthorizedSession { session: Session | null; trainer: Trainer | null }
function client() {
  if (!supabase) throw new Error('Veza sa servisom nije podešena. Obratite se administratoru.')
  return supabase
}
async function authorize(session: Session | null): Promise<AuthorizedSession> {
  if (!session) return { session: null, trainer: null }
  const api = client()
  const { data, error } = await api.from('trainers').select('id,user_id,full_name,active').eq('user_id', session.user.id).eq('active', true).maybeSingle<Trainer>()
  if (error || !data) {
    await api.auth.signOut({ scope: 'local' })
    throw new Error('Pristup je dozvoljen samo aktivnim trenerima. Obratite se administratoru.')
  }
  return { session, trainer: data }
}
export async function loadAuthorizedSession(): Promise<AuthorizedSession> {
  if (!supabase) return { session: null, trainer: null }
  const { data, error } = await supabase.auth.getSession()
  if (error) throw new Error('Sesija nije dostupna. Prijavite se ponovo.')
  return authorize(data.session)
}
export async function signInTrainer(email: string, password: string): Promise<AuthorizedSession> {
  const { data, error } = await client().auth.signInWithPassword({ email: email.trim(), password })
  if (error) throw new Error('Prijava nije uspela. Proverite imejl i lozinku.')
  return authorize(data.session)
}
export async function signOutTrainer(): Promise<void> {
  const { error } = await client().auth.signOut()
  if (error) throw new Error('Odjava nije uspela. Pokušajte ponovo.')
}
export async function requestPasswordReset(email: string): Promise<void> {
  const { error } = await client().auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/` })
  if (error) throw new Error('Zahtev za promenu lozinke nije uspeo. Pokušajte ponovo.')
}
export async function updatePassword(password: string): Promise<void> {
  if (password.length < 8) throw new Error('Lozinka mora imati najmanje 8 znakova.')
  const { error } = await client().auth.updateUser({ password })
  if (error) throw new Error('Promena lozinke nije uspela. Zatražite novi link za oporavak.')
}
export function subscribeToAuthChanges(callback: (event: AuthChangeEvent, session: Session | null) => void): () => void {
  if (!supabase) return () => undefined
  let subscribed = true
  const { data } = supabase.auth.onAuthStateChange((event, session) => {
    // Defer consumer code beyond the auth lock; even an async consumer cannot deadlock it.
    setTimeout(() => { if (subscribed) callback(event, session) }, 0)
  })
  return () => { subscribed = false; data.subscription.unsubscribe() }
}
