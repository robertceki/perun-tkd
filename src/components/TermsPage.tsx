import { useState, type FormEvent } from 'react'
import type { ClubData, TermAssignment, WeeklyTerm } from '../domain/types'
import { enrollmentPeriodsOverlap, formatTime, validateTerm } from '../domain/validation'
import type { ClubController } from '../hooks/useClubData'
import type { Page } from './AppShell'
import { Check, Feedback, Field, FormActions, SelectField } from './Feedback'

const days = ['Ponedeljak', 'Utorak', 'Sreda', 'Četvrtak', 'Petak', 'Subota', 'Nedelja']
export function TermsPage({ data, club, navigate, today }: { data: ClubData; club: ClubController; navigate: (page: Page) => void; today: string }) {
  const [draft, setDraft] = useState<WeeklyTerm | null>(null)
  const [assignments, setAssignments] = useState<TermAssignment[]>([])
  const [errors, setErrors] = useState<string[]>([])
  const previous = data.terms.find(t => t.id === draft?.id)
  const oldRows = data.assignments.filter(a => a.term_id === draft?.id)
  const scheduleLocked = oldRows.length > 0
  const ready = data.groups.some(g => g.active) && !!today
  function edit(term: WeeklyTerm) { setDraft({ ...term }); setAssignments(data.assignments.filter(a => a.term_id === term.id).map(a => ({ ...a }))); setErrors([]) }
  function changeAssignment(index: number, value: Partial<TermAssignment>) { setAssignments(assignments.map((item, i) => i === index ? { ...item, ...value } : item)) }
  async function submit(event: FormEvent) {
    event.preventDefault(); if (!draft) return
    const invalid = validateTerm(draft, assignments, data); setErrors(invalid)
    if (!invalid.length && await club.saveTerm(draft, assignments) === 'saved') setDraft(null)
  }
  const eligible = data.children.filter(c => c.status === 'active' && (c.main_group_id === draft?.group_id || c.competition_group_id === draft?.group_id))
  const enrollmentReady = !!draft && draft.active && data.groups.some(g => g.id === draft.group_id && g.active) && (!draft.trainer_id || data.trainers.some(t => t.id === draft.trainer_id && t.active))
  return <><h1 className="h3">Nedeljni termini</h1><p>Lokacija kluba nije podešena</p><p>Datumi uključuju oba kraja perioda. Za novi raspored povezanog termina napravite novi termin; istorijski upisi ostaju nepromenjeni.</p>
    {!ready && <div className="alert alert-info">Za novi termin potrebni su aktivna grupa i potvrđen serverski datum. <button type="button" className="btn btn-link" onClick={() => navigate('Grupe')}>Otvori grupe</button></div>}
    <button type="button" className="btn btn-primary mb-3" disabled={club.busy || !ready} onClick={() => edit({ id: crypto.randomUUID(), group_id: '', weekday: 1, starts_at: '', ends_at: '', trainer_id: '', valid_from: today, valid_to: null, active: true })}>Dodaj termin</button>
    {draft && <section className="card mb-4"><div className="card-body"><h2 className="h4">{previous ? 'Uredi termin i upise' : 'Novi termin'}</h2><Feedback errors={errors} /><form onSubmit={submit}><fieldset disabled={club.busy}>
      {scheduleLocked && <div className="alert alert-info">Raspored je zaključan jer postoje upisi. Možete završiti upise, promeniti završetak važenja ili deaktivirati termin. Za drugi raspored napravite novi termin.</div>}
      <SelectField label="Grupa termina" required disabled={scheduleLocked} value={draft.group_id} onChange={e => setDraft({ ...draft, group_id: e.target.value })}><option value="">Izaberite grupu</option>{data.groups.filter(g => g.active || g.id === previous?.group_id).map(g => <option key={g.id} value={g.id}>{g.name} ({g.kind === 'main' ? 'glavna' : 'takmičarska'}){!g.active ? ' — neaktivna' : ''}</option>)}</SelectField>
      <SelectField label="Dan u nedelji" disabled={scheduleLocked} value={draft.weekday} onChange={e => setDraft({ ...draft, weekday: Number(e.target.value) })}>{days.map((day, index) => <option key={day} value={index + 1}>{day}</option>)}</SelectField>
      <div className="row"><div className="col-md-6"><Field label="Početak" type="time" step="60" required disabled={scheduleLocked} value={draft.starts_at.slice(0, 5)} onChange={e => setDraft({ ...draft, starts_at: e.target.value })} /></div><div className="col-md-6"><Field label="Završetak" type="time" step="60" required disabled={scheduleLocked} value={draft.ends_at.slice(0, 5)} onChange={e => setDraft({ ...draft, ends_at: e.target.value })} /></div></div>
      <Field label="Važi od" type="date" required disabled={scheduleLocked} value={draft.valid_from} onChange={e => setDraft({ ...draft, valid_from: e.target.value })} />
      <Field label="Važi do (prazno: bez završetka)" type="date" min={draft.valid_from} value={draft.valid_to ?? ''} onChange={e => setDraft({ ...draft, valid_to: e.target.value || null })} />
      <Check label="Aktivan termin" checked={draft.active} onChange={e => setDraft({ ...draft, active: e.target.checked })} />
      <fieldset className="border rounded p-3 mb-3"><legend className="float-none w-auto fs-5 px-1">Upisi dece</legend><p>Postojeći upis završite unosom datuma „Upis do“. Upis se ne briše. Novi period istog deteta mora početi posle završetka prethodnog. Proširenje termina prvo sačuvajte, pa zatim proširite upise.</p>
        {assignments.map((assignment, index) => {
          const old = oldRows.find(a => a.child_id === assignment.child_id && a.valid_from === assignment.valid_from)
          const historical = !!old?.cancelled_at || (!!old?.valid_to && old.valid_to < today)
          const child = data.children.find(c => c.id === assignment.child_id)
          const alreadyEnrolled = (childId: string) => assignments.some((other, otherIndex) =>
            otherIndex !== index && other.child_id === childId &&
            !other.cancelled_at && !oldRows.some(saved => saved.child_id === other.child_id &&
              saved.valid_from === other.valid_from && saved.cancelled_at) &&
            enrollmentPeriodsOverlap(other, assignment))
          const enrollmentConflict = !old && !!assignment.child_id && alreadyEnrolled(assignment.child_id)
          return <div className="border-bottom mb-3 pb-3" key={index}><h3 className="h6">Upis {index + 1}{old?.cancelled_at ? ' — otkazan' : historical ? ' — završen' : ''}</h3>
            {old ? <p>{child?.first_name} {child?.last_name}</p> : <SelectField label={`Dete za upis ${index + 1}`} required value={assignment.child_id} onChange={e => changeAssignment(index, { child_id: e.target.value })}><option value="">Izaberite dete</option>{eligible.map(c => {
              const enrolled = alreadyEnrolled(c.id)
              return <option key={c.id} value={c.id} disabled={enrolled && c.id !== assignment.child_id}>
                {c.first_name} {c.last_name}{enrolled ? ' — već prijavljeno' : ''}
              </option>
            })}</SelectField>}
            {enrollmentConflict && <p className="text-danger" role="alert">Dete je već prijavljeno na ovaj termin u izabranom periodu.</p>}
            <Field label={`Upis ${index + 1} od`} type="date" required readOnly={!!old} min={draft.valid_from} max={draft.valid_to ?? undefined} value={assignment.valid_from} onChange={e => changeAssignment(index, { valid_from: e.target.value })} />
            <Field label={`Upis ${index + 1} do (prazno: bez završetka)`} type="date" readOnly={historical} min={assignment.valid_from} max={draft.valid_to ?? undefined} value={assignment.valid_to ?? ''} onChange={e => changeAssignment(index, { valid_to: e.target.value || null })} />
            {old && !historical && today && old.valid_from > today && <button type="button" className="btn btn-outline-danger btn-sm" onClick={async () => {
              if (!window.confirm('Otkaži budući upis?')) return
              await club.cancelEnrollment(old.term_id, old.child_id, old.valid_from)
            }}>Otkaži budući upis</button>}
            {!old && <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => setAssignments(assignments.filter((_, i) => i !== index))}>Ukloni nesačuvani upis {index + 1}</button>}
          </div>
        })}
        {!eligible.length && <p>U grupi nema aktivne dece. <button type="button" className="btn btn-link" onClick={() => navigate('Deca')}>Otvori decu</button></p>}
        {!enrollmentReady && <p>Novi ili produženi upisi zahtevaju aktivan termin, grupu i trenera.</p>}
        <button type="button" className="btn btn-outline-primary" disabled={!eligible.length || !enrollmentReady} onClick={() => setAssignments([...assignments, { term_id: draft.id, child_id: '', valid_from: draft.valid_from > today ? draft.valid_from : today, valid_to: draft.valid_to }])}>Dodaj upis</button>
      </fieldset><FormActions busy={club.busy} cancel={() => setDraft(null)} />
    </fieldset></form></div></section>}
    {!data.terms.length ? <p role="status">Nema nedeljnih termina. Posle grupa, kontakata i dece dodajte termin i upise.</p> : <div className="table-responsive"><table className="table table-striped"><caption>Nedeljni raspored i upisi (uključujući istoriju)</caption><thead><tr><th scope="col">Dan / vreme</th><th scope="col">Grupa</th><th scope="col">Važenje / status</th><th scope="col">Upisi</th><th scope="col">Radnja</th></tr></thead><tbody>{[...data.terms].sort((a, b) => a.weekday - b.weekday || a.starts_at.localeCompare(b.starts_at)).map(term => <tr key={term.id}><td>{days[term.weekday - 1]}<br />{formatTime(term.starts_at)}–{formatTime(term.ends_at)}</td><td>{data.groups.find(g => g.id === term.group_id)?.name}</td><td>{term.valid_from} – {term.valid_to ?? 'bez završetka'}<br />{term.active ? 'Aktivan' : 'Neaktivan'}</td><td>{data.assignments.filter(a => a.term_id === term.id).map(a => { const c = data.children.find(child => child.id === a.child_id); return <div key={`${a.child_id}-${a.valid_from}`}>{c?.first_name} {c?.last_name}: {a.valid_from} – {a.valid_to ?? 'bez završetka'}{a.cancelled_at ? ' (otkazan)' : a.valid_to && a.valid_to < today ? ' (završen)' : ''}</div> })}</td><td><button type="button" className="btn btn-outline-primary btn-sm" disabled={club.busy} onClick={() => edit(term)} aria-label={`Uredi termin ${days[term.weekday - 1]} ${formatTime(term.starts_at)}`}>Uredi / upisi</button></td></tr>)}</tbody></table></div>}
  </>
}


