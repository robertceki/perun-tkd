import { Typography, Box, Alert, Button } from '@mui/material'
import { SettingsDetail } from './SettingsDetail'
import { DirectoryCard } from './DirectoryCard'
import { allowsCompetitionEnrollment } from '../domain/competitorProfile'
import { useState, type FormEvent } from 'react'
import type { ClubData, TermAssignment, WeeklyTerm } from '../domain/types'
import { enrollmentPeriodsOverlap, formatTime, validateTerm } from '../domain/validation'
import type { ClubController } from '../hooks/useClubData'
import type { Page } from './AppShell'
import { Check, Feedback, Field, FormActions, SelectField } from './Feedback'

const days = ['Ponedeljak', 'Utorak', 'Sreda', 'Četvrtak', 'Petak', 'Subota', 'Nedelja']
export function TermsPage({ data, club, navigate, today }: { data: ClubData; club: ClubController; navigate: (page: Page) => void; today: string }) {
  const [draft, setDraft] = useState<WeeklyTerm | null>(null)
  const [scheduleDay, setScheduleDay] = useState<number | null>(null)
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
  const draftGroup = data.groups.find(group => group.id === draft?.group_id)
  const eligible = data.children.filter(c => c.status === 'active' && allowsCompetitionEnrollment(c, draftGroup) && (c.main_group_id === draft?.group_id || c.competition_group_id === draft?.group_id))
  const enrollmentReady = !!draft && draft.active && data.groups.some(g => g.id === draft.group_id && g.active) && (!draft.trainer_id || data.trainers.some(t => t.id === draft.trainer_id && t.active))
  const scheduledDays = [...new Set(data.terms.map(term => term.weekday))].sort((a, b) => a - b)
  const selectedDay = scheduleDay !== null && scheduledDays.includes(scheduleDay) ? scheduleDay : scheduledDays[0]
  const visibleTerms = data.terms.filter(term => term.weekday === selectedDay)
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at))

  if (draft) return <>
    <SettingsDetail busy={club.busy} backLabel="Nazad na raspored termina" onBack={() => setDraft(null)}><Typography component="h2" variant="h6" sx={{ mb: 1.25 }}>{previous ? 'Uredi termin i upise' : 'Novi termin'}</Typography><Feedback errors={errors} /><form onSubmit={submit}><fieldset disabled={club.busy}>
      {scheduleLocked && <Alert variant="outlined" severity="info" sx={{ mb: 1.5 }}>Raspored je zaključan jer postoje upisi. Možete završiti upise, promeniti završetak važenja ili deaktivirati termin. Za drugi raspored napravite novi termin.</Alert>}
      <SelectField label="Grupa termina" required disabled={scheduleLocked} value={draft.group_id} onChange={e => setDraft({ ...draft, group_id: e.target.value })}><option value="">Izaberite grupu</option>{data.groups.filter(g => g.active || g.id === previous?.group_id).map(g => <option key={g.id} value={g.id}>{g.name} ({g.kind === 'main' ? 'glavna' : 'takmičarska'}){!g.active ? ' — neaktivna' : ''}</option>)}</SelectField>
      <SelectField label="Dan u nedelji" disabled={scheduleLocked} value={draft.weekday} onChange={e => setDraft({ ...draft, weekday: Number(e.target.value) })}>{days.map((day, index) => <option key={day} value={index + 1}>{day}</option>)}</SelectField>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' }, columnGap: 1.5 }}><Field label="Početak" type="time" step="60" required disabled={scheduleLocked} value={draft.starts_at.slice(0, 5)} onChange={e => setDraft({ ...draft, starts_at: e.target.value })} /><Field label="Završetak" type="time" step="60" required disabled={scheduleLocked} value={draft.ends_at.slice(0, 5)} onChange={e => setDraft({ ...draft, ends_at: e.target.value })} /></Box>
      <Field label="Važi od" type="date" required disabled={scheduleLocked} value={draft.valid_from} onChange={e => setDraft({ ...draft, valid_from: e.target.value })} />
      <Field label="Važi do (prazno: bez završetka)" type="date" min={draft.valid_from} value={draft.valid_to ?? ''} onChange={e => setDraft({ ...draft, valid_to: e.target.value || null })} />
      <Check label="Aktivan termin" checked={draft.active} onChange={e => setDraft({ ...draft, active: e.target.checked })} />
      <Box component="fieldset" sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, p: 1.5, mb: 1.5 }}><Typography component="legend" variant="subtitle1">Upisi dece</Typography><Alert variant="outlined" severity="info" role="note" sx={{ mb: 1.5 }}>Postojeći upis završite unosom datuma „Upis do“. Upis se ne briše. Novi period istog deteta mora početi posle završetka prethodnog. Proširenje termina prvo sačuvajte, pa zatim proširite upise.</Alert>
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
          return <Box key={index} sx={{ borderBottom: '1px solid', borderColor: 'divider', mb: 1.5, pb: 1.5 }}><Typography component="h3" variant="subtitle1">Upis {index + 1}{old?.cancelled_at ? ' — otkazan' : historical ? ' — završen' : ''}</Typography>
            {old ? <p>{child?.first_name} {child?.last_name}</p> : <SelectField label={`Dete za upis ${index + 1}`} required value={assignment.child_id} onChange={e => changeAssignment(index, { child_id: e.target.value })}><option value="">Izaberite dete</option>{eligible.map(c => {
              const enrolled = alreadyEnrolled(c.id)
              return <option key={c.id} value={c.id} disabled={enrolled && c.id !== assignment.child_id}>
                {c.first_name} {c.last_name}{enrolled ? ' — već prijavljeno' : ''}
              </option>
            })}</SelectField>}
            {enrollmentConflict && <Alert severity="error">Dete je već prijavljeno na ovaj termin u izabranom periodu.</Alert>}
            <Field label={`Upis ${index + 1} od`} type="date" required readOnly={!!old} min={draft.valid_from} max={draft.valid_to ?? undefined} value={assignment.valid_from} onChange={e => changeAssignment(index, { valid_from: e.target.value })} />
            <Field label={`Upis ${index + 1} do (prazno: bez završetka)`} type="date" readOnly={historical} min={assignment.valid_from} max={draft.valid_to ?? undefined} value={assignment.valid_to ?? ''} onChange={e => changeAssignment(index, { valid_to: e.target.value || null })} />
            {old && !historical && today && old.valid_from > today && <Button type="button" variant="outlined" color="error" onClick={async () => {
              if (!window.confirm('Otkaži budući upis?')) return
              await club.cancelEnrollment(old.term_id, old.child_id, old.valid_from)
            }}>Otkaži budući upis</Button>}
            {!old && <Button type="button" variant="outlined" onClick={() => setAssignments(assignments.filter((_, i) => i !== index))}>Ukloni nesačuvani upis {index + 1}</Button>}
          </Box>
        })}
        {!eligible.length && <Alert variant="outlined" severity="info" role="note" sx={{ mb: 1.5 }}>U grupi nema dece koja ispunjavaju uslove za upis. <Button type="button" color="secondary" onClick={() => navigate('Deca')}>Otvori decu</Button></Alert>}
        {!enrollmentReady && <Alert variant="outlined" severity="info" role="note" sx={{ mb: 1.5 }}>Novi ili produženi upisi zahtevaju aktivan termin, grupu i trenera.</Alert>}
        <Button type="button" variant="outlined" disabled={!eligible.length || !enrollmentReady} onClick={() => setAssignments([...assignments, { term_id: draft.id, child_id: '', valid_from: draft.valid_from > today ? draft.valid_from : today, valid_to: draft.valid_to }])}>Dodaj upis</Button>
      </Box><FormActions busy={club.busy} cancel={() => setDraft(null)} />
    </fieldset></form></SettingsDetail>
  </>

  return <><Typography component="h1" variant="h6" sx={{ mb: 1 }}>Nedeljni termini</Typography>
    {!ready && <Alert variant="outlined" severity="info" sx={{ mb: 1.5 }}>Za novi termin potrebni su aktivna grupa i potvrđen serverski datum. <Button type="button" color="secondary" onClick={() => navigate('Grupe')}>Otvori grupe</Button></Alert>}
    <Button type="button" variant="contained" sx={{ mb: 1.5 }} disabled={club.busy || !ready} onClick={() => edit({ id: crypto.randomUUID(), group_id: '', weekday: 1, starts_at: '', ends_at: '', trainer_id: '', valid_from: today, valid_to: null, active: true })}>Dodaj termin</Button>
    {!scheduledDays.length ? <Alert variant="outlined" severity="info" role="status">Nema nedeljnih termina.</Alert> : <>
      <SelectField label="Dan rasporeda" value={selectedDay} onChange={event => setScheduleDay(Number(event.target.value))}>
        {scheduledDays.map(day => <option key={day} value={day}>{days[day - 1]}</option>)}
      </SelectField>
      <Box component="ul" sx={{ listStyle: 'none', p: 0, m: 0 }} aria-label="Nedeljni termini">
        {visibleTerms.map(term => <li key={term.id}>
          <DirectoryCard disabled={club.busy} onClick={() => edit(term)}
            label={`Uredi termin ${days[term.weekday - 1]} ${formatTime(term.starts_at)}`}>
            <Box component="span" sx={{ display: 'block', flex: 1, minWidth: 0, lineHeight: 1.25, overflowWrap: 'anywhere', '& small': { display: 'block', color: 'text.secondary', fontSize: '.875rem' } }}>
              <strong>{data.groups.find(group => group.id === term.group_id)?.name ?? 'Grupa'}</strong>
              <small>{formatTime(term.starts_at)}–{formatTime(term.ends_at)}{term.active ? '' : ' · Neaktivan'}</small></Box>
          </DirectoryCard>
        </li>)}</Box>
    </>}
  </>
}
