import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { loadAuthorizedSession, subscribeToAuthChanges } from './auth'

const api = vi.hoisted(() => {
  const query = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn() }
  return { query, from: vi.fn(), auth: {
    getSession: vi.fn(), signOut: vi.fn(), onAuthStateChange: vi.fn(),
  } }
})
vi.mock('./supabase', () => ({ supabase: api }))
beforeEach(() => {
  api.from.mockReturnValue(api.query)
  api.query.select.mockReturnValue(api.query)
  api.query.eq.mockReturnValue(api.query)
})
afterEach(() => { vi.clearAllMocks(); vi.useRealTimers() })

test('missing session does not query trainers', async () => {
  api.auth.getSession.mockResolvedValue({ data: { session: null }, error: null })
  await expect(loadAuthorizedSession()).resolves.toEqual({ session: null, trainer: null })
  expect(api.from).not.toHaveBeenCalled()
})

test.each([null, { message: 'Database unavailable' }])('denies absent trainer data with lookup error %j', async error => {
  api.auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'synthetic' } } }, error: null })
  api.query.maybeSingle.mockResolvedValue({ data: null, error })
  await expect(loadAuthorizedSession()).rejects.toThrow(/samo aktivnim trenerima/)
  expect(api.query.eq.mock.calls).toEqual([['user_id', 'synthetic'], ['active', true]])
  expect(api.auth.signOut).toHaveBeenCalledWith({ scope: 'local' })
})

test('auth callbacks run after the SDK lock and are discarded after unsubscribe', () => {
  vi.useFakeTimers()
  let emit!: (event: string, session: null) => void
  const unsubscribe = vi.fn()
  api.auth.onAuthStateChange.mockImplementation(callback => {
    emit = callback
    return { data: { subscription: { unsubscribe } } }
  })
  const callback = vi.fn()
  const stop = subscribeToAuthChanges(callback)
  emit('SIGNED_OUT', null)
  expect(callback).not.toHaveBeenCalled()
  vi.runAllTimers()
  expect(callback).toHaveBeenCalledWith('SIGNED_OUT', null)
  emit('SIGNED_OUT', null)
  stop()
  vi.runAllTimers()
  expect(unsubscribe).toHaveBeenCalledOnce()
  expect(callback).toHaveBeenCalledOnce()
})

