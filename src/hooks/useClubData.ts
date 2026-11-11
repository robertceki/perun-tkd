import { useCallback, useEffect, useRef, useState } from 'react'
import type { Child, ChildContact, ClubData, Contact, Group, TermAssignment, WeeklyTerm } from '../domain/types'
import { repository } from '../lib/repository'

export type SaveResult = 'saved' | 'refresh-failed' | 'failed'
export function useClubData(trainerKey: string | null) {
  const generation = useRef({ version: 0 })
  const currentKey = useRef(trainerKey)
  currentKey.current = trainerKey
  const locked = useRef(false)
  const refreshRequired = useRef(false)
  const [snapshot, setSnapshot] = useState<{ key: string; data: ClubData } | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [stale, setStale] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const reload = useCallback(async () => {
    if (!trainerKey || !repository || locked.current) return
    const version = ++generation.current.version
    setLoading(true); setError('')
    try {
      const data = await repository.load()
      if (version === generation.current.version && currentKey.current === trainerKey) { refreshRequired.current = false; setStale(false); setSnapshot({ key: trainerKey, data }) }
    } catch {
      if (version === generation.current.version && currentKey.current === trainerKey) setError('Podaci nisu učitani. Proverite vezu i pokušajte ponovo.')
    } finally { if (version === generation.current.version && currentKey.current === trainerKey) setLoading(false) }
  }, [trainerKey])
  useEffect(() => {
    setSnapshot(null); setError(''); setNotice(''); setSaving(false); setLoading(false); locked.current = false; refreshRequired.current = false
    void reload()
    const activeGeneration = generation.current
    return () => { ++activeGeneration.version }
  }, [reload])
  const save = useCallback(async (write: () => Promise<void>, announce = true): Promise<SaveResult> => {
    if (!trainerKey || !repository || locked.current || refreshRequired.current || currentKey.current !== trainerKey) return 'failed'
    locked.current = true; setSaving(true); setError(''); setNotice('')
    const version = ++generation.current.version
    try { await write() } catch (cause) {
      if (currentKey.current === trainerKey && version === generation.current.version) { setError('Čuvanje nije uspelo. ' + (cause && typeof cause === 'object' && 'message' in cause && typeof cause.message === 'string' ? cause.message : 'Proverite vezu i pokušajte ponovo.')); locked.current = false; setSaving(false) }
      return 'failed'
    }
    if (currentKey.current !== trainerKey || version !== generation.current.version) return 'failed'
    try {
      const data = await repository.load()
      if (currentKey.current !== trainerKey || version !== generation.current.version) return 'failed'
      setSnapshot({ key: trainerKey, data }); if (announce) setNotice('Izmene su sačuvane.'); return 'saved'
    } catch {
      if (currentKey.current === trainerKey && version === generation.current.version) { refreshRequired.current = true; setStale(true); setError('Izmene su sačuvane, ali osvežavanje nije uspelo. Ponovo učitajte podatke pre naredne izmene.') }
      return 'refresh-failed'
    } finally { if (currentKey.current === trainerKey && version === generation.current.version) { locked.current = false; setSaving(false) } }
  }, [trainerKey])
  const ensureSession = useCallback((date: string, termId: string, verify: () => Promise<boolean>) => save(async () => {
    if (!await verify()) throw new Error('Početak treninga nije potvrđen.')
    await repository!.ensureSession(date, termId)
  }, false), [save])
  return { save, ensureSession, busy: saving || loading || stale, cancelEnrollment: (termId: string, childId: string, validFrom: string) => save(() => repository!.cancelEnrollment(termId, childId, validFrom)), data: trainerKey && snapshot?.key === trainerKey ? snapshot.data : null, loading, saving, error, notice, reload,
    saveContact: (value: Contact) => save(() => repository!.saveContact(value)), saveGroup: (value: Group) => save(() => repository!.saveGroup(value)), saveChild: (value: Child, links: ChildContact[]) => save(() => repository!.saveChild(value, links)), saveTerm: (value: WeeklyTerm, assignments: TermAssignment[]) => save(() => repository!.saveTerm(value, assignments)) }
}
export type ClubController = ReturnType<typeof useClubData>


