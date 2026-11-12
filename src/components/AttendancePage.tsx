import { allowsCompetitionEnrollment } from '../domain/competitorProfile'
import { useEffect, useRef, useState } from 'react'
import { getMedicalExamDetails } from '../domain/medicalExam'
import { MedicalExamStatus } from './MedicalExamStatus'
import { formatTime } from '../domain/validation'
import type { ClubData } from '../domain/types'
import type { ClubController } from '../hooks/useClubData'
import { repository } from '../lib/repository'
import type { DatedTerm } from './DashboardPage'
import { Check, SelectField } from './Feedback'

const openingTime = new Intl.DateTimeFormat('sr-Latn-RS', {
  timeZone: 'Europe/Belgrade', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
})
const openingDate = new Intl.DateTimeFormat('sr-Latn-RS', {
  timeZone: 'Europe/Belgrade', dateStyle: 'short',
})

export function AttendancePage({ term, data, club, opening, serverInstant, today, authBusy, verifyBoundary, back }: {
  term: DatedTerm; data: ClubData; club: ClubController; opening: number
  serverInstant: number | undefined; today: string; authBusy: boolean
  verifyBoundary: (boundary: number) => Promise<boolean | null>; back: () => void
}) {
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => heading.current?.focus(), [])
  const [presenceDraft, setPresenceDraft] = useState<{ childId: string; value: boolean } | null>(null)
  const [substitute, setSubstitute] = useState('')
  const [attempted, setAttempted] = useState(false)
  const [checking, setChecking] = useState(false)
  const [failure, setFailure] = useState('')
  const session = term.session
  const canStart = !authBusy && serverInstant !== undefined && serverInstant >= opening
  const canCancel = serverInstant !== undefined && serverInstant >= term.startsAt
  const rows = (data.attendance ?? []).filter(row => row.session_id === session?.id)
  const childrenById = new Map(data.children.map(child => [child.id, child]))
  function examWarning(childId: string) {
    const child = childrenById.get(childId)
    return child && <MedicalExamStatus details={getMedicalExamDetails(child.medical_exam_date, today)} warningsOnly />
  }
  const present = rows.filter(row => row.present).length
  const sessionGroup = data.groups.find(group => group.id === session?.group_id)
  const options = data.children.filter(child => child.status === 'active' && allowsCompetitionEnrollment(child, sessionGroup) && !rows.some(row => row.child_id === child.id))
  const preview = !session && !canStart ? data.children.filter(child => data.assignments.some(entry =>
    entry.term_id === term.termId && entry.child_id === child.id && entry.valid_from <= term.date &&
    (!entry.valid_to || entry.valid_to >= term.date) &&
    (!entry.cancelled_at || Date.parse(entry.cancelled_at) > term.startsAt))) : []
  const { busy, ensureSession } = club

  useEffect(() => {
    if (!canStart || session || attempted || busy) return
    setAttempted(true)
    void ensureSession(term.date, term.termId, async () => {
      const verified = await verifyBoundary(opening)
      if (verified === null) throw new Error('Serversko vreme nije dostupno.')
      if (!verified) throw new Error('Prozivka još nije otvorena.')
      return true
    })
  }, [attempted, busy, canStart, ensureSession, opening, session, term.date, term.termId, verifyBoundary])

  async function change(write: () => Promise<void>, cancel = false) {
    if (checking || busy || !canStart || !session || session.cancelled_at) return
    if (cancel && !canCancel) return
    setChecking(true)
    setFailure('')
    try {
      const verified = await verifyBoundary(cancel ? term.startsAt : opening)
      if (verified === null) return
      if (!verified) {
        setFailure(cancel ? 'Trening još nije počeo.' : 'Prozivka još nije otvorena.')
        return
      }
      return await club.save(write)
    } finally {
      setChecking(false)
    }
  }

  async function savePresence(childId: string, value: boolean) {
    if (!session) return
    setPresenceDraft({ childId, value })
    if (await change(() => repository!.setPresence(session.id, childId, value)) === 'saved') setPresenceDraft(null)
  }

  return <section aria-busy={checking || club.saving}>
    <button type="button" className="btn btn-outline-secondary mb-3" onClick={back}>Nazad na termine</button>
    <h1 ref={heading} tabIndex={-1} className="h3">{term.group} · {formatTime(term.start)}–{formatTime(term.end)}</h1>
    <p>{term.date}</p>
    {failure && <p role="alert">{failure}</p>}
    {serverInstant !== undefined && serverInstant < opening && !session?.cancelled_at &&
      <p role="status">Prozivka se otvara u {openingTime.format(opening)} ({openingDate.format(opening)}).</p>}
    {!session && canStart && <div>
      {club.saving || club.loading ? <p role="status">Učitavanje spiska treninga…</p> : attempted &&
        <button type="button" className="btn btn-outline-primary" disabled={busy} onClick={() => setAttempted(false)}>Ponovo otvori trening</button>}
    </div>}
    {!session && !canStart && Number.isFinite(term.startsAt) && <section>
      <h2 className="h5">Planirani spisak</h2>
      {preview.length ? <ul>{preview.map(child => <li key={child.id}>{child.first_name} {child.last_name}{examWarning(child.id)}</li>)}</ul> : <p>Nema planiranih upisa.</p>}
    </section>}
    {session && <>
      {session.cancelled_at && <p role="status">Trening je otkazan. Spisak je dostupan samo za pregled.</p>}
      {session.completed_at && !session.cancelled_at && <p role="status">Prozivka je završena.</p>}
      <p>Prisutno: {present} · Odsutno: {rows.length - present} · Ukupno: {rows.length}</p>
      <fieldset disabled={checking || busy || !canStart || !!session.cancelled_at}>
        <legend className="h5">Spisak prisustva</legend>
        {!rows.length && <p role="status">Na spisku nema dece.</p>}
        {!canStart && rows.length > 0 && <ul>{rows.map(row => <li key={row.child_id}>
          {row.child_first_name} {row.child_last_name}{row.is_substitute ? ' (zamena)' : ''}{examWarning(row.child_id)} · {row.present ? 'Prisutan' : 'Odsutan'}
        </li>)}</ul>}
        {canStart && rows.map(row => <div key={row.child_id} className="d-flex align-items-baseline flex-wrap"><Check
          label={row.child_first_name + ' ' + row.child_last_name + (row.is_substitute ? ' (zamena)' : '')}
          checked={presenceDraft?.childId === row.child_id && !session.cancelled_at ? presenceDraft.value : row.present}
          disabled={!!presenceDraft && presenceDraft.childId !== row.child_id}
          onChange={event => void savePresence(row.child_id, event.currentTarget.checked)} />{examWarning(row.child_id)}</div>)}
        {presenceDraft && !session.cancelled_at && <div className="mb-3">
          <p role="status">{checking || busy ? 'Provera i čuvanje prisustva…' : 'Izmena prisustva još nije potvrđena. Broj prisutnih prikazuje učitano stanje.'}</p>
          {canStart && !checking && !busy && <>
            <button type="button" className="btn btn-outline-primary me-2" onClick={() => void savePresence(presenceDraft.childId, presenceDraft.value)}>Ponovi čuvanje prisustva</button>
            <button type="button" className="btn btn-outline-secondary" onClick={() => setPresenceDraft(null)}>Vrati učitano stanje</button>
          </>}
        </div>}
        {canStart && !session.cancelled_at && <>
          <SelectField label="Dete za zamenu" value={substitute} onChange={event => setSubstitute(event.target.value)}>
            <option value="">Izaberite dete</option>
            {options.map(child => <option key={child.id} value={child.id}>{child.first_name} {child.last_name}</option>)}
          </SelectField>
          <div className="d-flex flex-wrap gap-2">
            <button type="button" className="btn btn-outline-primary" disabled={!!presenceDraft || !options.some(child => child.id === substitute)} onClick={async () => {
              if (await change(() => repository!.addSubstitute(session.id, substitute)) === 'saved') setSubstitute('')
            }}>Dodaj zamenu</button>
            {!session.completed_at && <button type="button" className="btn btn-primary" disabled={!!presenceDraft} onClick={() => void change(() => repository!.completeSession(session.id))}>Završi prozivku</button>}
            {canCancel && <button type="button" className="btn btn-outline-danger" disabled={!!presenceDraft} onClick={() => { if (window.confirm('Otkazivanje zaključava spisak prisustva. Otkaži trening?')) void change(() => repository!.cancelSession(session.id), true) }}>Otkaži trening</button>}
          </div>
        </>}
      </fieldset>
    </>}
  </section>
}



