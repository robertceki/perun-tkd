import { FormControlLabel, Radio } from '@mui/material'
import { Typography, Box, Alert, Button, TextField } from '@mui/material'
import { SettingsDetail } from './SettingsDetail'
import { DirectoryCard } from './DirectoryCard'
import { CompetitorProfile } from './CompetitorProfile'
import { memberTypeLabels } from '../domain/competitorProfile'
import { useState, type FormEvent } from 'react'
import type { Child, ChildContact, ClubData } from '../domain/types'
import { getMedicalExamDetails, isMedicalExamWarning, validateMedicalExamDate } from '../domain/medicalExam'
import { MedicalExamStatus } from './MedicalExamStatus'
import { validateChild } from '../domain/validation'
import type { ClubController } from '../hooks/useClubData'
import type { Page } from './AppShell'
import { Feedback, Field, FormActions, SelectField } from './Feedback'

export function ChildrenPage({ data, club, navigate, today, openSchedule }: { data: ClubData; club: ClubController; navigate: (page: Page) => void; today: string; openSchedule?: () => void }) {
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('all')
  const [medicalWarningOnly, setMedicalWarningOnly] = useState(false)
  const [memberType, setMemberType] = useState('all')
  const [group, setGroup] = useState('')
  const [draft, setDraft] = useState<Child | null>(null)
  const [links, setLinks] = useState<ChildContact[]>([])
  const [errors, setErrors] = useState<string[]>([])
  const previous = data.children.find(c => c.id === draft?.id)
  function edit(child: Child) {
    const existing = data.children.some(item => item.id === child.id)
    setDraft(existing ? { ...child, member_type: child.member_type ?? 'recreational' } : { ...child })
    setLinks(data.childContacts.filter(link => link.child_id === child.id).map(link => ({ ...link })))
    setErrors([])
  }
  const ready = data.groups.some(g => g.active && g.kind === 'main') && data.contacts.length > 0
  async function submit(event: FormEvent) {
    event.preventDefault(); if (!draft) return
    const value = { ...draft, first_name: draft.first_name.trim(), last_name: draft.last_name.trim(), address: draft.address.trim(), belt: draft.belt.trim(), notes: draft.notes?.trim() ? draft.notes : null }
    const invalid = validateChild(value, links, data, today)
    if (!today && value.medical_exam_date === previous?.medical_exam_date) delete value.medical_exam_date
    const medicalExamError = validateMedicalExamDate(value.medical_exam_date, today)
    if (medicalExamError) invalid.push(medicalExamError)
    setErrors(invalid)
    if (!invalid.length && await club.saveChild(value, links) === 'saved') setDraft(null)
  }
  const filterCount = Number(status !== 'all') + Number(!!group) + Number(memberType !== 'all') + Number(medicalWarningOnly)
  const list = data.children.map(child => ({ child, medicalExam: getMedicalExamDetails(child.medical_exam_date, today) }))
    .filter(({ child: c, medicalExam }) => (memberType === 'all' || (c.member_type ?? 'recreational') === memberType) && (!medicalWarningOnly || isMedicalExamWarning(medicalExam.status)) && `${c.first_name} ${c.last_name}`.toLocaleLowerCase('sr-Latn').includes(query.toLocaleLowerCase('sr-Latn')) && (status === 'all' || c.status === status) && (!group || c.main_group_id === group || c.competition_group_id === group))
  if (draft) return <>
    <SettingsDetail busy={club.busy} backLabel="Nazad na spisak dece" onBack={() => setDraft(null)}><Typography component="h2" variant="h6" sx={{ mb: 1.25 }}>{previous ? 'Uredi dete' : 'Novo dete'}</Typography><Feedback errors={errors} /><form onSubmit={submit} className={draft.member_type === 'competitor' ? 'competitor-form' : undefined}><fieldset disabled={club.busy}>
      {draft.member_type === 'competitor' && <Alert variant="outlined" severity="info" role="note" sx={{ mb: 1.5 }}>Polja označena zvezdicom (*) su obavezna. Potreban je jedan glavni kontakt.</Alert>}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' }, columnGap: 1.5 }}><Field label="Ime deteta" autoComplete="given-name" required value={draft.first_name} onChange={e => setDraft({ ...draft, first_name: e.target.value })} /><Field label="Prezime deteta" autoComplete="family-name" required value={draft.last_name} onChange={e => setDraft({ ...draft, last_name: e.target.value })} /></Box>
      <CompetitorProfile child={draft} previous={previous} data={data} today={today} change={setDraft} openSchedule={openSchedule ?? (() => navigate('Termini'))} />
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
        <Box sx={{ flex: 1, minWidth: 0, '& > *': { mb: 0 } }}>
          <Field label="Datum lekarskog pregleda" type="date" max={today || undefined} value={draft.medical_exam_date ?? ''} onChange={e => setDraft({ ...draft, medical_exam_date: e.target.value || null })} />
        </Box>
        <Button type="button" variant="outlined" color="error"
          style={{ width: 44 }} disabled={!draft.medical_exam_date} aria-label="Obriši datum lekarskog pregleda"
          title="Obriši datum lekarskog pregleda" onClick={() => setDraft({ ...draft, medical_exam_date: null })}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 7h16m-10 4v6m4-6v6M6 7l1 13h10l1-13M9 7V4h6v3" />
          </svg>
        </Button>
      </Box>
      <Box sx={{ mb: 1.5 }}><MedicalExamStatus details={getMedicalExamDetails(draft.medical_exam_date, today)} /></Box>
      <Field label="Adresa" autoComplete="street-address" value={draft.address} onChange={e => setDraft({ ...draft, address: e.target.value })} />
      <Field label="Pojas" value={draft.belt} onChange={e => setDraft({ ...draft, belt: e.target.value })} />
      <Box sx={{ mb: 1.5 }}>
        <TextField label="Napomene" id="child-notes" multiline minRows={2} value={draft.notes ?? ''} onChange={e => setDraft({ ...draft, notes: e.target.value })} />
      </Box>
      <SelectField label="Status deteta" value={draft.status} onChange={e => setDraft({ ...draft, status: e.target.value as Child['status'] })}><option value="active">Aktivno</option><option value="inactive">Neaktivno</option></SelectField>
      <SelectField label="Glavna grupa" required value={draft.main_group_id} onChange={e => setDraft({ ...draft, main_group_id: e.target.value })}><option value="">Izaberite glavnu grupu</option>{data.groups.filter(g => g.kind === 'main' && (g.active || g.id === previous?.main_group_id)).map(g => <option key={g.id} value={g.id}>{g.name}{!g.active ? ' (neaktivna)' : ''}</option>)}</SelectField>
      <Box component="fieldset" sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, p: 1.5, mb: 1.5 }}><Typography component="legend" variant="subtitle1">Kontakti deteta</Typography><Alert variant="outlined" severity="info" role="note" sx={{ mb: 1.5 }}>Izaberite postojeće kontakte, odnos i tačno jedan glavni kontakt.</Alert>
        {links.map((link, index) => <Box key={index} sx={{ borderBottom: '1px solid', borderColor: 'divider', mb: 1.5, pb: 1.5 }}>
          <SelectField label={`Kontakt ${index + 1}`} required value={link.contact_id} onChange={e => setLinks(links.map((item, i) => i === index ? { ...item, contact_id: e.target.value } : item))}><option value="">Izaberite kontakt</option>{data.contacts.filter(c => c.id === link.contact_id || !links.some(item => item.contact_id === c.id)).map(c => <option key={c.id} value={c.id}>{c.first_name} {c.last_name} — {c.phone}</option>)}</SelectField>
          <Field label={`Odnos kontakta ${index + 1} sa detetom`} required placeholder="Npr. majka, otac, staratelj" value={link.relationship} onChange={e => setLinks(links.map((item, i) => i === index ? { ...item, relationship: e.target.value } : item))} />
          <FormControlLabel sx={{ mb: 1 }} label="Glavni kontakt" control={<Radio size="small" name="primary-contact" checked={link.is_primary} onChange={() => setLinks(links.map((item, i) => ({ ...item, is_primary: i === index })))} />} />
          <Button type="button" variant="outlined" onClick={() => setLinks(links.filter((_, i) => i !== index))}>Ukloni vezu sa kontaktom {index + 1}</Button>
        </Box>)}
        <Button type="button" variant="outlined" disabled={links.length >= data.contacts.length} onClick={() => setLinks([...links, { child_id: draft.id, contact_id: '', relationship: '', is_primary: links.length === 0 }])}>Poveži postojeći kontakt</Button>
      </Box><FormActions busy={club.busy} cancel={() => setDraft(null)} />
    </fieldset></form></SettingsDetail>
  </>

  return <><Typography component="h1" variant="h6" sx={{ mb: 1 }}>Deca</Typography>
    {!ready && <Alert variant="outlined" severity="info" sx={{ mb: 1.5 }}>Za novo dete potrebni su aktivna glavna grupa i kontakt. <Button type="button" color="secondary" onClick={() => navigate('Grupe')}>Otvori grupe</Button><Button type="button" color="secondary" onClick={() => navigate('Kontakti')}>Otvori kontakte</Button></Alert>}
    <Button type="button" variant="contained" sx={{ mb: 1.5 }} disabled={club.busy || !ready} onClick={() => edit({ id: crypto.randomUUID(), first_name: '', last_name: '', birth_date: '', address: '', belt: '', status: 'active', main_group_id: '', competition_group_id: null })}>Dodaj dete</Button>

    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
      <Box sx={{ flex: 1, minWidth: 0, '& > *': { mb: 0 } }}>
        <Field label="Pretraži decu" type="search" placeholder="Ime i prezime" value={query} onChange={e => { setQuery(e.target.value) }} />
      </Box>
      <Button type="button" variant="outlined" aria-expanded={filtersOpen} aria-controls="child-filters"
        onClick={() => setFiltersOpen(!filtersOpen)}>Filteri{filterCount > 0 ? ` (${filterCount})` : ''}</Button>
    </Box>
    <Box id="child-filters" hidden={!filtersOpen} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, p: 1.5, mb: 1.5 }}>
      <Box sx={{ display: 'grid', gap: '0 12px', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 135px), 1fr))' }}>
<div><SelectField label="Status" value={status} onChange={e => { setStatus(e.target.value) }}><option value="all">Svi statusi</option><option value="active">Aktivna</option><option value="inactive">Neaktivna</option></SelectField></div>
<div><SelectField label="Grupa" value={group} onChange={e => { setGroup(e.target.value) }}><option value="">Sve grupe</option>{data.groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</SelectField></div>
<div><SelectField label="Tip člana" value={memberType} onChange={e => { setMemberType(e.target.value) }}>
      <option value="all">Svi tipovi članova</option>
      <option value="recreational">{memberTypeLabels.recreational}</option>
      <option value="competitor">{memberTypeLabels.competitor}</option>
    </SelectField></div>
<div><SelectField label="Lekarski pregled" value={medicalWarningOnly ? 'warning' : 'all'} onChange={e => { setMedicalWarningOnly(e.target.value === 'warning') }}><option value="all">Svi statusi pregleda</option><option value="warning">Ističe uskoro ili je istekao</option></SelectField></div>
      </Box>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
        <Button type="button" variant="contained" onClick={() => setFiltersOpen(false)}>Prikaži rezultate</Button>
        {filterCount > 0 && <Button type="button" variant="outlined" onClick={() => {
          setStatus('all'); setGroup(''); setMemberType('all'); setMedicalWarningOnly(false)
        }}>Poništi filtere</Button>}
      </Box>
    </Box>
    {!list.length ? <Alert variant="outlined" severity="info" role="status">Nema dece koja odgovaraju izabranim filterima.</Alert> : <>
      <Box component="ul" sx={{ listStyle: 'none', p: 0, mb: 1 }} aria-label="Spisak dece">
        {list.map(({ child, medicalExam }) => <li key={child.id}>
          <DirectoryCard disabled={club.busy}
            onClick={() => edit(child)} label={`Uredi dete ${child.first_name} ${child.last_name}`}>
            <Box component="span" sx={{ display: 'block', flex: 1, minWidth: 0, lineHeight: 1.25, overflowWrap: 'anywhere', '& small': { display: 'block', color: 'text.secondary', fontSize: '.875rem' } }}>
              <strong>{child.first_name} {child.last_name}</strong>
              <small>{data.groups.find(group => group.id === child.main_group_id)?.name}</small></Box>
            <MedicalExamStatus details={medicalExam} warningsOnly />
            {child.status === 'inactive' && <Typography component="span" sx={{ color: 'error.main', fontWeight: 700, fontSize: '1.25rem' }} role="img" aria-label="Neaktivan član" title="Neaktivan član">!</Typography>}
          </DirectoryCard>
        </li>)}</Box>
    </>}
  </>
}
