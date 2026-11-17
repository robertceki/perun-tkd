import { Alert, Box, Button, ButtonBase, Stack, Typography } from '@mui/material'
import { useCallback, useEffect, useRef, useState } from 'react'
import './App.css'
import { useAuth } from './hooks/useAuth'
import { useClubData } from './hooks/useClubData'
import { AppShell, type Page } from './components/AppShell'
import { AuthScreen } from './components/AuthScreen'
import { AttendancePage } from './components/AttendancePage'
import { TermList, type DatedTerm } from './components/DashboardPage'
import { SettingsPage, type SettingsTab } from './components/SettingsPage'
import { Feedback, Field } from './components/Feedback'
import { belgradeBusinessDate } from './domain/validation'
import type { ClubData } from './domain/types'
import { repository } from './lib/repository'

const localClock = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Belgrade', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
})
const rollCallLeadTime = 3_600_000

function localStart(date: string, time: string) {
  const wall = Date.parse(date + 'T' + (time.length === 5 ? time + ':00' : time) + 'Z')
  if (!Number.isFinite(wall)) return NaN
  const offset = (instant: number) => {
    const parts = Object.fromEntries(localClock.formatToParts(instant).map(part => [part.type, part.value]))
    const local = new Date(0)
    local.setUTCFullYear(+parts.year, +parts.month - 1, +parts.day)
    local.setUTCHours(+parts.hour, +parts.minute, +parts.second)
    return local.getTime() - Math.floor(instant / 1000) * 1000
  }
  const offsets = new Set([offset(wall - 86_400_000), offset(wall + 86_400_000)])
  const candidates = [...offsets].map(value => wall - value)
  const matches = candidates.filter(instant => instant + offset(instant) === wall)
  // PostgreSQL uses the later instant for both a DST gap and a repeated hour.
  return Math.max(...(matches.length ? matches : candidates))
}

function moveDate(date: string, days: number) {
  const value = new Date(date + 'T00:00:00Z')
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}

function weekday(date: string) {
  return new Date(date + 'T00:00:00Z').getUTCDay() || 7
}

function datedTerms(data: ClubData, date: string, today: string): DatedTerm[] {
  const results = new Map<string, DatedTerm>()
  for (const term of data.terms) {
    if (term.weekday !== weekday(date) || term.valid_from > date || (term.valid_to && term.valid_to < date)) continue
    if (date >= today && !term.active) continue
    results.set(term.id, {
      termId: term.id, date, group: data.groups.find(group => group.id === term.group_id)?.name ?? 'Grupa',
      start: term.starts_at, end: term.ends_at, startsAt: localStart(date, term.starts_at),
    })
  }
  for (const session of data.sessions ?? []) {
    if (session.session_date !== date) continue
    results.set(session.term_id, {
      termId: session.term_id, date, group: session.group_name, start: session.starts_at,
      end: session.ends_at, startsAt: Date.parse(session.starts_at_utc), session,
    })
  }
  return [...results.values()].sort((a, b) => a.start.localeCompare(b.start) || a.group.localeCompare(b.group, 'sr-Latn'))
}

function useServerClock(startsAt?: number) {
  const lifecycle = useRef({ active: false, request: null as Promise<number | null> | null })
  const [sample, setSample] = useState<{ instant: number; received: number } | null>(null)
  const [error, setError] = useState(false)
  const refresh = useCallback(() => {
    const clock = lifecycle.current
    if (clock.request) return clock.request
    const request = Promise.resolve().then(async () => {
      try {
        const instant = Date.parse(await repository!.getServerTime())
        if (!Number.isFinite(instant)) throw new Error('Nevažeće serversko vreme')
        if (!clock.active || clock.request !== request) return null
        setSample({ instant, received: performance.now() })
        setError(false)
        return instant
      } catch {
        if (clock.active && clock.request === request) {
          setError(true)
        }
        return null
      } finally {
        if (clock.request === request) clock.request = null
      }
    })
    clock.request = request
    return request
  }, [])
  useEffect(() => {
    const clock = lifecycle.current
    clock.active = true
    void refresh()
    const poll = window.setInterval(() => void refresh(), 60000)
    return () => {
      window.clearInterval(poll)
      clock.active = false
      clock.request = null
    }
  }, [refresh])
  useEffect(() => {
    if (error || !sample || startsAt == null || !Number.isFinite(startsAt)) return
    const opening = startsAt - rollCallLeadTime
    const boundary = sample.instant < opening ? opening : startsAt
    if (boundary <= sample.instant) return
    const now = sample.instant + (performance.now() - sample.received)
    const delay = Math.max(100, boundary - now)
    if (delay > 60000) return
    const timer = window.setTimeout(() => void refresh(), delay)
    return () => window.clearTimeout(timer)
  }, [startsAt, refresh, sample, error])
  const verifyBoundary = useCallback(async (boundary: number) => {
    const instant = await refresh()
    return instant === null ? null : instant >= boundary
  }, [refresh])
  return { instant: error ? undefined : sample?.instant, lastInstant: sample?.instant, error, refresh, verifyBoundary }
}

function AuthorizedApp({ trainerKey, trainer, logout, authBusy, authError }: {
  trainerKey: string; trainer: string; logout: () => void; authBusy: boolean; authError: string
}) {
  const [page, setPage] = useState<Page>('Početna')
  const [tab, setTab] = useState<SettingsTab>('Deca')
  const [date, setDate] = useState('')
  const [week, setWeek] = useState(false)
  const [selected, setSelected] = useState<DatedTerm | null>(null)
  const termList = useRef<HTMLDivElement>(null)
  const club = useClubData(trainerKey)
  const data = club.data
  const latestTerm = selected && data && datedTerms(data, selected.date, selected.date).find(term => term.termId === selected.termId)
  const clock = useServerClock(latestTerm ? latestTerm.startsAt : selected?.startsAt)
  const today = clock.lastInstant === undefined ? '' : belgradeBusinessDate(new Date(clock.lastInstant))
  const currentDate = date || today
  const activeTerm = selected && data ? datedTerms(data, selected.date, today).find(term => term.termId === selected.termId) : null
  const days = currentDate ? week
    ? Array.from({ length: 7 }, (_, i) => moveDate(currentDate, i + 1 - weekday(currentDate)))
    : [currentDate] : []

  function closeTerm() {
    const list = termList.current
    const target = list?.querySelector<HTMLElement>('.mui-term-button[aria-pressed="true"]:not([hidden] .mui-term-button)')
      ?? list?.querySelector<HTMLElement>('h1:not([hidden] h1)')
    setSelected(null)
    window.requestAnimationFrame(() => target?.focus())
  }

  function navigate(next: Page) {
    if (next === 'Deca' || next === 'Kontakti' || next === 'Grupe') {
      setTab(next)
      setPage('Podešavanja')
    } else setPage(next)
    setSelected(null)
  }

  const todayTerms = data && today ? datedTerms(data, today, today) : []
  const now = clock.lastInstant
  const next = now === undefined ? undefined : todayTerms.find(term => term.startsAt >= now && !term.session?.cancelled_at)?.termId
  const counts = (terms: DatedTerm[]) => Object.fromEntries(terms.map(term => [term.termId,
    term.session ? (data?.attendance ?? []).filter(row => row.session_id === term.session?.id).length
      : new Set(data?.assignments.filter(row => row.term_id === term.termId && row.valid_from <= term.date &&
        (!row.valid_to || row.valid_to >= term.date) && (!row.cancelled_at || Date.parse(row.cancelled_at) > term.startsAt)).map(row => row.child_id)).size,
  ]))
  return <AppShell page={page} navigate={navigate} trainer={trainer} busy={club.saving || authBusy} logout={logout}>
    <Feedback errors={[authError, club.error].filter(Boolean)} message={club.notice} />
    {club.loading && <p role="status">Učitavanje podataka…</p>}
    {club.saving && <p role="status">Obrada zahteva…</p>}
    {club.error && <Button type="button" variant="outlined" sx={{ mb: 2 }} disabled={club.loading || club.saving} onClick={() => void club.reload()}>Ponovo učitaj podatke</Button>}
    {clock.error && <Alert severity="warning" sx={{ mb: 2 }} action={<Button color="inherit" onClick={() => void clock.refresh()}>Ponovo proveri vreme</Button>}>Serversko vreme nije dostupno.</Alert>}
    {clock.instant === undefined && !clock.error && <p role="status">Provera serverskog vremena…</p>}
    {data && <>
      <div className="term-layout">
        <div ref={termList} className={selected ? 'term-list-pane term-list-selected' : 'term-list-pane'} hidden={page === 'Podešavanja'}>
          <div hidden={page !== 'Početna'}>
            <Typography component="h1" tabIndex={-1} variant="h4" sx={{ mb: 2.5, fontSize: { xs: "1.8rem", sm: "2.2rem" } }}>Današnji termini</Typography>
            {today && <TermList terms={todayTerms} open={setSelected} selected={selected} counts={counts(todayTerms)} next={next} />}
          </div>
          <div hidden={page !== 'Termini'}>
            <Typography component="h1" tabIndex={-1} variant="h4" sx={{ mb: 2.5, fontSize: { xs: "1.8rem", sm: "2.2rem" } }}>Termini</Typography>
            <Field label="Datum" type="date" min="0001-01-07" max="9999-12-24" value={currentDate} onChange={event => {
              if (!event.target.value || event.target.validity.valid) setDate(event.target.value)
            }} />
            {currentDate && <Stack direction="row" gap={1} role="group" aria-label="Dani" sx={{ overflowX: 'auto', scrollbarWidth: 'none', mb: 2 }}>
              {['Pon', 'Uto', 'Sre', 'Čet', 'Pet', 'Sub', 'Ned', 'Svi dani'].map((label, index) => {
                const day = index === 7 ? currentDate : moveDate(currentDate, index + 1 - weekday(currentDate))
                const active = index === 7 ? week : !week && day === currentDate
                return <ButtonBase key={label} aria-pressed={active} onClick={() => { setWeek(index === 7); setDate(day) }} sx={{ flexShrink: 0, minHeight: 48, '&.Mui-focusVisible span': { outline: '2px solid', outlineOffset: 2 } }}>
                  <Box component="span" sx={{ display: 'grid', placeItems: 'center', minHeight: 30, px: 1.25, border: '1px solid', borderColor: active ? 'primary.main' : '#ded6c7', bgcolor: active ? 'primary.main' : 'background.paper', borderRadius: '24px', fontSize: '.8125rem', fontWeight: 700 }}>{label}</Box>
                </ButtonBase>
              })}
            </Stack>}
            {days.map(day => {
              const terms = datedTerms(data, day, today)
              return <Box component="section" key={day} sx={{ mb: 2 }}>{week && <Typography component="h2" fontWeight={800}>{day}</Typography>}<TermList terms={terms} open={setSelected} selected={selected} counts={counts(terms)} /></Box>
            })}
          </div>
        </div>
        {selected && activeTerm && <AttendancePage key={selected.date + '/' + selected.termId} term={activeTerm}
          data={data} club={club} opening={activeTerm.startsAt - rollCallLeadTime}
          serverInstant={clock.instant} today={clock.error ? '' : today} authBusy={authBusy}
          verifyBoundary={clock.verifyBoundary} back={closeTerm} />}
        {selected && !activeTerm && <Alert severity="warning" action={<Button color="inherit" onClick={closeTerm}>Nazad na termine</Button>}>Termin više nije dostupan.</Alert>}
      </div>
      <div hidden={page !== 'Podešavanja'}><SettingsPage tab={tab} select={setTab} data={data} club={club} navigate={navigate} today={clock.error ? '' : today} /></div>
    </>}
  </AppShell>
}

export default function App() {
  const auth = useAuth()
  if (auth.status !== 'authorized' || !auth.trainer?.active) return <AuthScreen auth={auth} />
  const trainerKey = auth.trainer.user_id + ':' + auth.trainer.id
  return <AuthorizedApp key={trainerKey} trainerKey={trainerKey} trainer={auth.trainer.full_name}
    logout={() => void auth.logout()} authBusy={auth.busy} authError={auth.error} />
}




