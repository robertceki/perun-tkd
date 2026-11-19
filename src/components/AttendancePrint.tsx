import { Button } from '@mui/material'
import PrintOutlined from '@mui/icons-material/PrintOutlined'
import { createPortal } from 'react-dom'
import type { SessionAttendance } from '../domain/types'
import { formatTime } from '../domain/validation'
import type { DatedTerm } from './DashboardPage'

export function AttendancePrint({ date, terms, attendance }: {
  date: string
  terms: DatedTerm[]
  attendance: SessionAttendance[]
}) {
  const label = new Intl.DateTimeFormat('sr-Latn-RS', { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(date + 'T00:00:00Z'))
  return <>
    <Button variant="outlined" color="secondary" startIcon={<PrintOutlined />} sx={{ mb: 2 }} onClick={() => window.print()}>
      Štampaj prisustvo
    </Button>
    {createPortal(<article className="attendance-print">
      <header>
        <strong>TKD Perun · Pančevo</strong>
        <h1>Dnevna evidencija prisustva na treninzima</h1>
        <p>Datum: <time dateTime={date}>{label}</time></p>
      </header>
      {!terms.length && <p>Nema termina za izabrani datum.</p>}
      {terms.map(term => {
        const session = term.session
        const roster = session ? attendance.filter(row => row.session_id === session.id) : []
        const completed = !!session?.completed_at
        return <section key={term.termId}>
          <h2>{term.group} · {formatTime(term.start)}–{formatTime(term.end)}</h2>
          {session?.cancelled_at ? <p>Trening je otkazan.</p> : !session ? <p>Prisustvo nije evidentirano.</p> : <>
            {roster.length ? <table>
              <thead><tr><th scope="col">R. br.</th><th scope="col">Ime i prezime</th><th scope="col">Prisustvo</th><th scope="col">Napomena</th></tr></thead>
              <tbody>{roster.map((row, index) => <tr key={row.child_id}>
                <td>{index + 1}</td><td>{row.child_first_name} {row.child_last_name}</td>
                <td>{row.present ? 'Prisutan' : completed ? 'Odsutan' : 'Nije potvrđeno'}</td>
                <td>{row.is_substitute ? 'Zamena' : '—'}</td>
              </tr>)}</tbody>
            </table> : <p>Na spisku nema dece.</p>}
            <p>Prisutno: {roster.filter(row => row.present).length} od {roster.length}</p>
          </>}
        </section>
      })}
      <footer>Datum izdavanja: {new Intl.DateTimeFormat('sr-Latn-RS', { dateStyle: 'short', timeZone: 'Europe/Belgrade' }).format(new Date())}</footer>
    </article>, document.body)}
  </>
}
