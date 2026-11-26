import { useState } from 'react'
import { Alert, Button, Card, Checkbox, Stack, TextField, Typography } from '@mui/material'
import type { ClubData } from '../domain/types'
import type { ClubController } from '../hooks/useClubData'
import { Field, SelectField } from './Feedback'

const monthFormatter = new Intl.DateTimeFormat('sr-Latn', { month: 'long', year: 'numeric', timeZone: 'UTC' })
const formatMonth = (month: string) => monthFormatter.format(new Date(month + 'T00:00:00Z'))

function monthsBetween(first: string, last: string) {
  if (![first, last].every(value => /^\d{4}-(0[1-9]|1[0-2])$/.test(value) && value >= '0001-01')) return []
  const ordinal = (value: string) => Number(value.slice(0, 4)) * 12 + Number(value.slice(5)) - 1
  const from = ordinal(first)
  const length = ordinal(last) - from + 1
  if (length < 1 || length > 120) return []
  return Array.from({ length }, (_, i) => {
    const month = from + i
    return String(Math.floor(month / 12)).padStart(4, '0') + '-' + String(month % 12 + 1).padStart(2, '0') + '-01'
  })
}

export function MembershipFeesPage({ data, club, today, memberId, selectMember }: {
  data: ClubData; club: ClubController; today: string; memberId: string; selectMember: (id: string) => void
}) {
  if (!data.membershipFees || !data.membershipPauses) return <Alert severity="info">Evidencija članarina još nije dostupna u ovoj bazi.</Alert>
  const member = data.children.find(child => child.id === memberId)
  const month = today.slice(0, 7) + '-01'
  const day = Number(today.slice(8, 10))
  const paid = new Set(data.membershipFees.filter(row => row.fee_month === month && row.paid_on).map(row => row.child_id))
  const paused = new Set(data.membershipPauses.filter(row => row.paused_until && row.paused_until >= today).map(row => row.child_id))
  const pending = today && day >= 15
    ? data.children.filter(child => child.status === 'active' && !paid.has(child.id) && !paused.has(child.id))
    : []
  return <>
    <Typography component="h2" variant="h5" sx={{ mb: 1.5 }}>Članarine</Typography>
    {!today && <Alert severity="info">Sačekajte potvrdu današnjeg datuma.</Alert>}
    <SelectField label="Član" value={member?.id ?? ''} onChange={event => selectMember(event.target.value)}>
      <option value="">Izaberite člana</option>
      {[...data.children].sort((a, b) => (a.first_name + ' ' + a.last_name).localeCompare(b.first_name + ' ' + b.last_name, 'sr-Latn')).map(child =>
        <option key={child.id} value={child.id}>{child.first_name} {child.last_name}{child.registration_number ? ' · ' + child.registration_number : ''}</option>)}
    </SelectField>
    {pending.length > 0 && <Card variant="outlined" sx={{ p: 2, mb: 2 }}>
      <Typography component="h3" variant="subtitle1">{day >= 20 ? 'Članovi za upozorenje' : 'Članovi za podsetnik'} ({pending.length})</Typography>
      <Stack direction="row" useFlexGap flexWrap="wrap" gap={0.5}>
        {pending.map(child => <Button key={child.id} color="secondary" onClick={() => selectMember(child.id)}>
          {child.first_name} {child.last_name}
        </Button>)}
      </Stack>
    </Card>}
    {member && today && <MemberFees key={member.id + '/' + month} data={data} club={club} today={today} member={member} />}
  </>
}

function MemberFees({ data, club, today, member }: {
  data: ClubData; club: ClubController; today: string; member: ClubData['children'][number]
}) {
  const currentMonth = today.slice(0, 7)
  const [first, setFirst] = useState(currentMonth)
  const [last, setLast] = useState(currentMonth)
  const [selected, setSelected] = useState<string[]>([])
  const [paidOn, setPaidOn] = useState(today)
  const [copyStatus, setCopyStatus] = useState('')
  const pause = data.membershipPauses?.find(row => row.child_id === member.id)
  const [pausedUntil, setPausedUntil] = useState(pause?.paused_until ?? '')
  const [note, setNote] = useState(pause?.note ?? '')
  const fees = new Map(data.membershipFees?.filter(row => row.child_id === member.id).map(row => [row.fee_month, row.paid_on]))
  const months = last <= currentMonth ? monthsBetween(first, last) : []
  const paused = !!pause?.paused_until && pause.paused_until >= today
  const payment = fees.get(currentMonth + '-01')
  const day = Number(today.slice(8, 10))
  const due = !payment && member.status === 'active' && day >= 15
  const warning = day >= 20
  const primary = data.childContacts.find(link => link.child_id === member.id && link.is_primary)
  const contact = data.contacts.find(item => item.id === primary?.contact_id)
  const message = 'Poštovani, prema evidenciji TKD Perun članarina za ' + formatMonth(currentMonth + '-01') +
    ' za člana ' + member.first_name + ' ' + member.last_name + ' nije evidentirana. ' +
    (warning ? 'Dok se dug ne izmiri, član neće moći da prisustvuje treninzima. Ako trenutno niste u mogućnosti da platite, javite nam se da se dogovorimo.' :
      'Molimo vas da proverite uplatu ili nam se javite ako je već izvršena.') + ' Hvala, TKD Perun.'

  async function savePayments(date: string | null) {
    const monthsToSave = date === null ? selected.filter(month => fees.get(month)) : selected
    if (!monthsToSave.length) return
    if (await club.saveMembershipFees(member.id, monthsToSave, date) !== 'failed') setSelected([])
  }

  return <Stack spacing={2}>
    <Card variant="outlined" sx={{ p: 2 }}>
      <Typography component="h3" variant="h6">Mesečna evidencija</Typography>
      <Typography sx={{ mb: 1.5 }}>Rok za uplatu je 10. u mesecu. Izaberite jedan ili više meseci za unos ili ispravku.</Typography>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
        <Field label="Od meseca" type="month" max={currentMonth} value={first} onChange={event => { setFirst(event.target.value); setSelected([]) }} />
        <Field label="Do meseca" type="month" max={currentMonth} value={last} onChange={event => { setLast(event.target.value); setSelected([]) }} />
      </Stack>
      {!months.length && <Alert severity="info">Izaberite period do tekućeg meseca, najviše 120 meseci.</Alert>}
      <Stack component="ul" spacing={0.5} sx={{ listStyle: 'none', p: 0, mt: 0 }}>
        {months.map(month => <Stack component="li" key={month} direction="row" alignItems="center">
          <Checkbox checked={selected.includes(month)} disabled={club.busy} slotProps={{ input: { 'aria-label': formatMonth(month) } }}
            onChange={event => setSelected(event.target.checked ? [...selected, month] : selected.filter(value => value !== month))} />
          <Typography>{formatMonth(month)} · {fees.get(month) ? 'Plaćeno ' + fees.get(month) :
            month < currentMonth + '-01' || day > 10 ? 'Rok je prošao · uplata nije evidentirana' : 'Uplata nije evidentirana'}</Typography>
        </Stack>)}
      </Stack>
      <Field label="Datum uplate" type="date" max={today} value={paidOn} onChange={event => setPaidOn(event.target.value)} />
      <Stack direction="row" useFlexGap flexWrap="wrap" gap={1}>
        <Button variant="contained" disabled={club.busy || !selected.length || !paidOn || paidOn > today} onClick={() => void savePayments(paidOn)}>Evidentiraj uplatu</Button>
        <Button variant="outlined" disabled={club.busy || !selected.some(month => fees.get(month))} onClick={() => void savePayments(null)}>Poništi evidentiranu uplatu</Button>
      </Stack>
    </Card>
    <Card variant="outlined" sx={{ p: 2 }}>
      <Typography component="h3" variant="h6" sx={{ mb: 1 }}>Podsetnici za {formatMonth(currentMonth + '-01')}</Typography>
      {paused ? <Alert severity="info" sx={{ mb: 1 }}>Obaveštenja su pauzirana do {pause.paused_until}.</Alert> :
        due && <Stack spacing={1} sx={{ mb: 2 }}>
          <Typography>{warning ? 'Upozorenje od 20. u mesecu' : 'Podsetnik od 15. u mesecu'}</Typography>
          <Typography>Glavni kontakt: {contact ? contact.first_name + ' ' + contact.last_name : 'nije unet'}</Typography>
          <TextField label="Pripremljena poruka" multiline fullWidth value={message} slotProps={{ input: { readOnly: true } }} />
          <Button variant="outlined" sx={{ alignSelf: 'flex-start' }} onClick={async () => {
            try { await navigator.clipboard.writeText(message); setCopyStatus('Poruka je kopirana.') }
            catch { setCopyStatus('Označite i kopirajte tekst poruke.') }
          }}>Kopiraj poruku</Button>
          {copyStatus && <Typography role="status">{copyStatus}</Typography>}
        </Stack>}
      {!paused && !due && <Typography sx={{ mb: 1 }}>Trenutno nema podsetnika za ovog člana.</Typography>}
      <Stack component="form" spacing={1} onSubmit={event => {
        event.preventDefault()
        void club.saveMembershipPause(member.id, pausedUntil || null, note)
      }}>
        <Field label="Pauziraj obaveštenja do" type="date" value={pausedUntil} onChange={event => setPausedUntil(event.target.value)} />
        <TextField label="Napomena o dogovoru" multiline value={note} onChange={event => setNote(event.target.value)} />
        <Stack direction="row" useFlexGap flexWrap="wrap" gap={1}>
          <Button type="submit" variant="outlined" disabled={club.busy || !pausedUntil}>Sačuvaj pauzu</Button>
          <Button type="button" disabled={club.busy || !pause?.paused_until} onClick={async () => {
            if (await club.saveMembershipPause(member.id, null, '') !== 'failed') { setPausedUntil(''); setNote('') }
          }}>Ukini pauzu</Button>
        </Stack>
      </Stack>
    </Card>
  </Stack>
}
