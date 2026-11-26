import { PendingStatus } from './Feedback'
import { allowsCompetitionEnrollment } from '../domain/competitorProfile'
import { groupRoster, plannedRoster } from '../domain/attendanceRoster'
import { useEffect, useRef, useState } from 'react'
import { getMedicalExamDetails } from '../domain/medicalExam'
import { MedicalExamStatus } from './MedicalExamStatus'
import { formatTime } from '../domain/validation'
import type { ClubData } from '../domain/types'
import type { ClubController } from '../hooks/useClubData'
import { repository } from '../lib/repository'
import type { DatedTerm } from './DashboardPage'
import { Alert, Box, Button, Card, Checkbox, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField, Typography } from '@mui/material'
import ArrowBack from '@mui/icons-material/ArrowBack'
import Calendar from '@mui/icons-material/CalendarMonthOutlined'

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
  const [substituteOpen, setSubstituteOpen] = useState(false)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [restoreCancellation, setRestoreCancellation] = useState<string | null>(null)
  const [attempted, setAttempted] = useState('')
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
  const preview = !session && !canStart ? plannedRoster(data, term, today) : []
  const missingMemberIds = session && serverInstant !== undefined && serverInstant < term.startsAt &&
    !session.completed_at && !session.cancelled_at
    ? groupRoster(data, session.group_id).filter(child => !rows.some(row => row.child_id === child.id)).map(child => child.id).sort().join(',')
    : ''
  const rosterRequest = !session ? 'new' : missingMemberIds
  const { busy, ensureSession } = club

  useEffect(() => {
    if (!canStart || !rosterRequest || attempted === rosterRequest || busy) return
    setAttempted(rosterRequest)
    void ensureSession(term.date, term.termId, async () => {
      const verified = await verifyBoundary(opening)
      if (verified === null) throw new Error('Serversko vreme nije dostupno.')
      if (!verified) throw new Error('Prozivka još nije otvorena.')
      return true
    })
  }, [attempted, busy, canStart, ensureSession, opening, rosterRequest, term.date, term.termId, verifyBoundary])

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

  return <Box component="section" sx={{ minWidth: 0 }} aria-busy={checking || club.saving}>
    <Button color="secondary" startIcon={<ArrowBack />} onClick={back}>Nazad na termine</Button>
    <Typography ref={heading} tabIndex={-1} component="h1" variant="h4" sx={{ fontSize: { xs: '1.8rem', sm: '2.2rem' } }}>{term.group}</Typography>
    <Typography sx={{ display: 'flex', alignItems: 'center', gap: .75, mt: .5, mb: 2.5, fontSize: 14, fontWeight: 750, fontStyle: 'italic' }}>
      <Calendar sx={{ fontSize: 16 }} /> <span><time dateTime={term.date}>{openingDate.format(term.startsAt)}</time> · {formatTime(term.start)}–{formatTime(term.end)}</span>
    </Typography>
    {failure && <Alert variant="outlined" severity="error" sx={{ mb: 1.5 }}>{failure}</Alert>}
    {serverInstant !== undefined && serverInstant < opening && !session?.cancelled_at &&
      <Alert variant="outlined" severity="info" role="status" sx={{ mb: 1.5 }}>Prozivka se otvara u <strong>{openingTime.format(opening)}</strong> ({openingDate.format(opening)}).</Alert>}
    {rosterRequest && canStart && <div>
      {club.saving || club.loading ? <PendingStatus>Učitavanje spiska treninga…</PendingStatus> : attempted === rosterRequest &&
        <Button type="button" variant="outlined" color="secondary" disabled={busy} onClick={() => setAttempted('')}>{session ? 'Ponovo učitaj spisak' : 'Ponovo otvori trening'}</Button>}
    </div>}
    {!session && !canStart && Number.isFinite(term.startsAt) && <section>
      <Typography component="h2" variant="h6">Planirani spisak</Typography>
      {preview.length ? <ul className="roll-call-list">{preview.map(child => <li key={child.id}><span>{child.first_name} {child.last_name}</span>{examWarning(child.id)}</li>)}</ul> : <Alert variant="outlined" severity="info" role="status">Nema članova na planiranom spisku.</Alert>}
    </section>}
    {session && <>
      {session.cancelled_at && <>
        <Alert variant="outlined" severity="error" role="status" sx={{ mb: 1.5 }}>Trening je otkazan. Spisak je dostupan samo za pregled.</Alert>
        <Button variant="outlined" disabled={authBusy || busy || checking} sx={{ mb: 1.5 }}
          onClick={() => setRestoreCancellation(session.cancelled_at)}>Vrati trening</Button>
        <Dialog open={restoreCancellation !== null} onClose={() => { if (!club.saving) setRestoreCancellation(null) }}
          fullWidth maxWidth="xs" aria-labelledby="restore-training-title" aria-describedby="restore-training-description">
          <DialogTitle id="restore-training-title">Vrati otkazani trening?</DialogTitle>
          <DialogContent>
            <Typography id="restore-training-description">Trening će ponovo biti dostupan za prozivku. Zabeleženo prisustvo i status završetka ostaju sačuvani.</Typography>
            {club.error && <Alert severity="error" sx={{ mt: 1.5 }}>{club.error}</Alert>}
          </DialogContent>
          <DialogActions>
            <Button color="secondary" autoFocus disabled={club.saving} onClick={() => setRestoreCancellation(null)}>Nazad</Button>
            <Button variant="contained" disabled={authBusy || busy || checking} onClick={async () => {
              if (!restoreCancellation) return
              const result = await club.save(() => repository!.restoreSession(session.id, restoreCancellation))
              if (result !== 'failed') setRestoreCancellation(null)
            }}>Vrati trening</Button>
          </DialogActions>
        </Dialog>
      </>}
      {session.completed_at && !session.cancelled_at && <Alert variant="outlined" severity="success" role="status" sx={{ mb: 1.5 }}>Prozivka je završena.</Alert>}
      <Chip label={present + ' od ' + rows.length + ' prisutnih'} sx={{ bgcolor: '#eee3c9', fontWeight: 800, mb: 1.5 }} />
      <fieldset disabled={checking || busy || !canStart || !!session.cancelled_at}>
        <Typography component="legend" variant="h6">Spisak prisustva</Typography>
        {!rows.length && <Alert variant="outlined" severity="info" role="status">Na spisku nema članova.</Alert>}
        {!canStart && rows.length > 0 && <ul className="roll-call-list">{rows.map(row => <li key={row.child_id}>
          <span>{row.child_first_name} {row.child_last_name}{row.is_substitute ? ' (zamena)' : ''} · {row.present ? 'Prisutan' : 'Odsutan'}</span>{examWarning(row.child_id)}
        </li>)}</ul>}
        {canStart && <Stack spacing={1.25}>{rows.map(row => {
          const checked = presenceDraft?.childId === row.child_id && !session.cancelled_at ? presenceDraft.value : row.present
          const name = row.child_first_name + ' ' + row.child_last_name + (row.is_substitute ? ' (zamena)' : '')
          return <Card key={row.child_id} sx={{ bgcolor: checked ? '#f0f4eb' : 'background.paper' }}>
            <Box component="label" sx={{ display: 'flex', alignItems: 'center', gap: .5, minHeight: 46, px: .75, py: .25, cursor: 'pointer' }}>
              <Checkbox size="small" color="secondary" checked={checked} slotProps={{ input: { "aria-label": name } }} sx={{ p: .5, '& svg': { fontSize: 18 } }}
                disabled={checking || busy || !!session.cancelled_at || (!!presenceDraft && presenceDraft.childId !== row.child_id)}
                onChange={event => void savePresence(row.child_id, event.target.checked)} />
              <Typography fontWeight={650} sx={{ flex: 1 }}>{name}</Typography>
              {examWarning(row.child_id)}
            </Box>
          </Card>
        })}</Stack>}
        {presenceDraft && !session.cancelled_at && <Box sx={{ mb: 2 }}>
          {checking || busy ? <PendingStatus>Provera i čuvanje prisustva…</PendingStatus> : <Alert variant="outlined" severity="warning" role="status">Izmena prisustva još nije potvrđena. Broj prisutnih prikazuje učitano stanje.</Alert>}
          {canStart && !checking && !busy && <>
            <Button variant="outlined" color="secondary" sx={{ mr: 1 }} onClick={() => void savePresence(presenceDraft.childId, presenceDraft.value)}>Ponovi čuvanje prisustva</Button>
            <Button variant="outlined" color="secondary" onClick={() => setPresenceDraft(null)}>Vrati učitano stanje</Button>
          </>}
        </Box>}
        {canStart && !session.cancelled_at && <>
          <Stack direction="row" useFlexGap flexWrap="wrap" gap={1} mt={2}>
            {!session.completed_at && <Button variant="contained" disabled={busy || checking || !!presenceDraft} onClick={() => void change(() => repository!.completeSession(session.id))}>Završi prozivku</Button>}
            <Button variant="outlined" color="secondary" disabled={busy || checking || !!presenceDraft} aria-expanded={substituteOpen} onClick={() => setSubstituteOpen(!substituteOpen)}>Dodaj zamenu</Button>
            {canCancel && <Button color="error" aria-label="Otkaži trening" sx={{ ml: 'auto' }} disabled={busy || checking || !!presenceDraft} onClick={() => setConfirmCancel(true)}>Otkaži</Button>}
          </Stack>
          {substituteOpen && <Card sx={{ p: { xs: 2, sm: 3 }, mt: 1.5 }}>
            <Stack spacing={1.25} component="form" onSubmit={async event => {
              event.preventDefault()
              if (presenceDraft || !options.some(child => child.id === substitute)) return
              if (await change(() => repository!.addSubstitute(session.id, substitute)) === 'saved') {
                setSubstitute('')
                setSubstituteOpen(false)
              }
            }}>
              <Typography component="h2" variant="h6" fontWeight={750}>Zamena</Typography>
              <TextField select label="Član" value={substitute} onChange={event => setSubstitute(event.target.value)}
                slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}>
                <option value="">Izaberite člana</option>
                {options.map(child => <option key={child.id} value={child.id}>{child.first_name} {child.last_name}</option>)}
              </TextField>
              <Button variant="contained" type="submit" disabled={busy || checking || !!presenceDraft || !options.some(child => child.id === substitute)}>Dodaj</Button>
            </Stack>
          </Card>}
          <Dialog open={confirmCancel} onClose={() => setConfirmCancel(false)} fullWidth maxWidth="xs" aria-labelledby="cancel-training-title">
            <DialogTitle id="cancel-training-title">Otkaži trening?</DialogTitle>
            <DialogContent>Prozivka će ostati zaključana za izmene.</DialogContent>
            <DialogActions>
              <Button color="secondary" autoFocus onClick={() => setConfirmCancel(false)}>Nazad</Button>
              <Button color="error" disabled={busy || checking || !!presenceDraft || !canCancel} onClick={async () => {
                if (await change(() => repository!.cancelSession(session.id), true) === 'saved') setConfirmCancel(false)
              }}>Otkaži</Button>
            </DialogActions>
          </Dialog>
        </>}
      </fieldset>
    </>}
  </Box>
}
