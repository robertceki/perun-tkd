import { act, fireEvent, render, screen } from '@testing-library/react'
import type { AuthChangeEvent, Session } from '@supabase/supabase-js'
import { beforeEach, expect, test, vi } from 'vitest'
import App from './App'
import { loadAuthorizedSession, subscribeToAuthChanges, type AuthorizedSession } from './lib/auth'

vi.mock('./lib/supabase', () => ({ supabase: {} }))
vi.mock('./lib/auth', () => ({
  loadAuthorizedSession: vi.fn(), subscribeToAuthChanges: vi.fn(),
  updatePassword: vi.fn(), signInTrainer: vi.fn(), signOutTrainer: vi.fn(), requestPasswordReset: vi.fn(),
}))
vi.mock('./lib/repository', () => ({ repository: { load: async () => ({
  trainers: [], contacts: [], groups: [], children: [], childContacts: [], terms: [],
  assignments: [], sessions: [], attendance: [],
}), getServerTime: async () => '2026-07-06T18:00:00Z' } }))

const session = { user: { id: 'user' } } as Session
const authorized = { session, trainer: { id: 'trainer', user_id: 'user', full_name: 'Test Trainer', active: true } }
let emit: (event: AuthChangeEvent, value: Session | null) => void

function pendingAuthorization() {
  let resolve!: (value: AuthorizedSession) => void
  vi.mocked(loadAuthorizedSession).mockReturnValueOnce(new Promise(value => { resolve = value }))
  return () => act(async () => { resolve(authorized) })
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(loadAuthorizedSession).mockResolvedValue({ session: null, trainer: null })
  vi.mocked(subscribeToAuthChanges).mockImplementation(callback => {
    emit = callback
    return () => undefined
  })
})

test('sign-out supersedes an authorization started after password recovery', async () => {
  render(<App />)
  act(() => emit('PASSWORD_RECOVERY', session))
  vi.mocked(loadAuthorizedSession).mockClear()
  const finish = pendingAuthorization()
  fireEvent.change(screen.getByLabelText(/^Nova lozinka/), { target: { value: 'fixture-password' } })
  fireEvent.change(screen.getByLabelText(/Ponovite novu lozinku/), { target: { value: 'fixture-password' } })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Sačuvaj lozinku' })) })
  expect(loadAuthorizedSession).toHaveBeenCalled()
  act(() => emit('SIGNED_OUT', null))
  await finish()
  expect(screen.getByRole('heading', { name: 'Prijava trenera' })).toBeVisible()
  expect(screen.queryByRole('button', { name: 'Odjavi se' })).not.toBeInTheDocument()
})

test('same-user token refresh keeps the mounted group form and its draft', async () => {
  render(<App />)
  vi.mocked(loadAuthorizedSession).mockResolvedValueOnce(authorized)
  act(() => emit('INITIAL_SESSION', session))
  await screen.findByRole('button', { name: 'Odjavi se' })
  const settings = screen.queryByRole('button', { name: 'Podešavanja' })
  if (settings) fireEvent.click(settings)
  fireEvent.click(await screen.findByRole('button', { name: 'Grupe' }))
  fireEvent.click(await screen.findByRole('button', { name: /Dodaj grupu/ }))
  const name = screen.getByLabelText(/^Naziv(?: grupe)?$/)
  fireEvent.change(name, { target: { value: 'Nesačuvana grupa' } })
  vi.mocked(loadAuthorizedSession).mockClear()
  const finish = pendingAuthorization()
  act(() => emit('TOKEN_REFRESHED', { ...session, access_token: 'refreshed' }))
  expect(loadAuthorizedSession).toHaveBeenCalledOnce()
  const mountedDuringCheck = name.isConnected
  await finish()
  expect(mountedDuringCheck).toBe(true)
  expect(screen.getByLabelText(/^Naziv(?: grupe)?$/)).toBe(name)
  expect(name).toHaveValue('Nesačuvana grupa')
})

test('a denied session or a failed authorization leaves protected UI inaccessible', async () => {
  render(<App />)
  vi.mocked(loadAuthorizedSession).mockResolvedValueOnce({ session, trainer: { ...authorized.trainer, active: false } })
    .mockRejectedValueOnce(new Error('fixture unavailable'))
  await act(async () => emit('INITIAL_SESSION', session))
  expect(screen.getByRole('button', { name: 'Prijavi se' })).toBeEnabled()
  await act(async () => emit('SIGNED_IN', session))
  expect(screen.getByRole('alert')).toHaveTextContent(/provera prava pristupa/i)
  expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
})



