import type { SupabaseClient } from '@supabase/supabase-js'
import { expect, test, vi } from 'vitest'
import { createClubRepository } from './repository'

vi.mock('./supabase', () => ({ supabase: null }))

test('sends dated attendance RPCs and preserves server responses and errors', async () => {
  const row = { id: 'session', term_id: 'term', session_date: '2026-07-06' }
  const instant = '2026-07-06T18:00:00Z'
  const cancelled = { code: 'P0001', message: 'Trening je otkazan.' }
  const rpc = vi.fn().mockResolvedValue({ data: null, error: null })
    .mockResolvedValueOnce({ data: row, error: null })
    .mockResolvedValueOnce({ data: instant, error: null })
  const repo = createClubRepository({ rpc } as unknown as SupabaseClient)
  expect(await repo.ensureSession('2026-07-06', 'term')).toBe(row)
  expect(await repo.getServerTime()).toBe(instant)
  await repo.setPresence('session', 'child', false)
  await repo.addSubstitute('session', 'other')
  await repo.completeSession('session')
  await repo.cancelSession('session')
  await repo.cancelEnrollment('term', 'child', '2026-07-13')
  rpc.mockResolvedValueOnce({ data: null, error: cancelled })
  await expect(repo.setPresence('session', 'child', true)).rejects.toBe(cancelled)
  expect(rpc.mock.calls).toEqual([
    ['ensure_session', { p_session_date: '2026-07-06', p_term_id: 'term' }],
    ['get_server_time', {}],
    ['set_presence', { p_session_id: 'session', p_child_id: 'child', p_present: false }],
    ['add_substitute', { p_session_id: 'session', p_child_id: 'other' }],
    ['complete_session', { p_session_id: 'session' }],
    ['cancel_session', { p_session_id: 'session' }],
    ['cancel_enrollment', { p_term_id: 'term', p_child_id: 'child', p_valid_from: '2026-07-13' }],
    ['set_presence', { p_session_id: 'session', p_child_id: 'child', p_present: true }],
  ])
})
