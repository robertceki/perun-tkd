import { useEffect, useRef, useState } from 'react'
import type { Trainer } from '../domain/types'
import { loadAuthorizedSession, signInTrainer, signOutTrainer, requestPasswordReset, updatePassword, subscribeToAuthChanges, type AuthorizedSession } from '../lib/auth'
import { supabase } from '../lib/supabase'

type AuthState = { status: 'loading' | 'signed-out' | 'recovery' | 'authorized' | 'error'; trainer: Trainer | null; error: string }
type Action = 'login' | 'logout' | 'reset' | 'password'
const recoveryUrl = () => new URLSearchParams(window.location.hash.slice(1)).get('type') === 'recovery' || new URLSearchParams(window.location.search).get('type') === 'recovery'
const stateFor = (status: AuthState['status'], error = ''): AuthState => ({ status, trainer: null, error })
const accessError = 'Provera prava pristupa nije uspela. Pristup imaju samo aktivni treneri. Pokušajte ponovo.'
function cleanRecoveryUrl() {
  const url = new URL(window.location.href)
  const hash = new URLSearchParams(url.hash.slice(1))
  if (hash.has('access_token') || hash.has('refresh_token') || hash.has('error') || hash.has('type')) url.hash = ''
  for (const key of ['code', 'type', 'error', 'error_code', 'error_description']) url.searchParams.delete(key)
  window.history.replaceState(null, '', url.pathname + url.search + url.hash)
}
export function useAuth() {
  const lifecycle = useRef({ mounted: false, check: 0, user: undefined as string | null | undefined, recovery: recoveryUrl(), action: null as { kind: Action } | null })
  const [state, setState] = useState<AuthState>(() => stateFor('loading'))
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    const auth = lifecycle.current
    auth.mounted = true
    let subscribed = true
    const invalidate = () => {
      ++auth.check
      auth.action = null
      setBusy(false)
      setMessage('')
    }
    const authorize = async (expected?: string) => {
      const version = ++auth.check
      setState(previous => expected && previous.trainer?.user_id === expected ? previous : stateFor('loading'))
      try {
        const result = await loadAuthorizedSession()
        if (!subscribed || version !== auth.check || auth.recovery) return
        const id = result.session?.user.id
        if (id && result.trainer?.active && result.trainer.user_id === id && (!expected || id === expected)) {
          auth.user = id
          setState({ status: 'authorized', trainer: result.trainer, error: '' })
        } else {
          setState(stateFor('signed-out'))
        }
      } catch {
        if (subscribed && version === auth.check && !auth.recovery) {
          setState(previous => previous.status === 'authorized' && previous.trainer?.user_id === expected
            ? { ...previous, error: accessError } : stateFor('error', accessError))
        }
      }
    }
    const unsubscribe = subscribeToAuthChanges((event, session) => {
      if (!subscribed) return
      const id = session?.user.id ?? null
      if (event === 'PASSWORD_RECOVERY') {
        invalidate()
        auth.user = id
        auth.recovery = true
        cleanRecoveryUrl()
        setState(stateFor('recovery'))
        return
      }
      if (event === 'SIGNED_OUT' || (!id && !auth.recovery)) {
        invalidate()
        auth.user = null
        auth.recovery = false
        setState(stateFor('signed-out'))
        return
      }
      if (!id) return
      if (auth.action?.kind === 'login' && auth.user == null && event === 'SIGNED_IN') {
        auth.user = id
        return
      }
      if (auth.user !== id) {
        if (auth.user !== undefined) {
          invalidate()
          auth.recovery = false
        }
        auth.user = id
      }
      if (!auth.recovery && !auth.action) void authorize(id)
    })
    if (auth.recovery && supabase) {
      const version = ++auth.check
      void supabase.auth.getSession().then(({ data, error }) => {
        if (!subscribed || version !== auth.check) return
        cleanRecoveryUrl()
        if (!error && data.session) {
          auth.user = data.session.user.id
          setState(stateFor('recovery'))
        } else setState(stateFor('error', 'Link za oporavak nije važeći. Zatražite novi link.'))
      }).catch(() => {
        if (subscribed && version === auth.check) setState(stateFor('error', 'Oporavak nije dostupan. Zatražite novi link.'))
      })
    } else void authorize()
    return () => {
      subscribed = false
      auth.mounted = false
      ++auth.check
      auth.action = null
      unsubscribe()
    }
  }, [])

  async function act(kind: Action, email = '', password = '') {
    const auth = lifecycle.current
    if (!auth.mounted || auth.action) return
    const action = { kind }
    auth.action = action
    ++auth.check
    const current = () => auth.mounted && auth.action === action
    const accept = (result: AuthorizedSession) => {
      const id = result.session?.user.id
      if (id && result.trainer?.active && result.trainer.user_id === id && (!auth.user || auth.user === id)) {
        auth.user = id
        setState({ status: 'authorized', trainer: result.trainer, error: '' })
      } else setState(stateFor('signed-out'))
    }
    setBusy(true)
    setMessage('')
    setState(previous => kind === 'login' ? stateFor('loading') : { ...previous, error: '' })
    try {
      if (kind === 'login') {
        const result = await signInTrainer(email, password)
        if (current() && !auth.recovery) accept(result)
      } else if (kind === 'reset') {
        await requestPasswordReset(email)
        if (current()) setMessage('Ako nalog postoji, dobićete uputstvo za promenu lozinke na imejl.')
      } else if (kind === 'password') {
        await updatePassword(password)
        if (!current()) return
        const result = await loadAuthorizedSession()
        if (!current()) return
        auth.recovery = false
        cleanRecoveryUrl()
        accept(result)
        setMessage('Lozinka je promenjena.')
      } else {
        await signOutTrainer()
        if (!current()) return
        auth.user = null
        auth.recovery = false
        setState(stateFor('signed-out'))
      }
    } catch {
      if (!current()) return
      if (kind === 'logout') {
        setState(previous => ({ ...previous, error: 'Odjava nije uspela. Pokušajte ponovo.' }))
      } else {
        const errors = {
          login: 'Prijava nije uspela. Proverite imejl, lozinku i ovlašćenje aktivnog trenera.',
          reset: 'Zahtev nije uspeo. Proverite vezu i pokušajte ponovo.',
          password: 'Promena lozinke ili provera pristupa nije uspela. Pokušajte ponovo ili zatražite novi link.',
        }
        setState(stateFor(kind === 'password' ? 'recovery' : 'error', errors[kind]))
      }
    } finally {
      if (current()) {
        auth.action = null
        setBusy(false)
      }
    }
  }
  return { ...state, busy, message, configured: !!supabase, login: (email: string, password: string) => act('login', email, password), logout: () => act('logout'), reset: (email: string) => act('reset', email), completeRecovery: (password: string) => act('password', '', password) }
}
