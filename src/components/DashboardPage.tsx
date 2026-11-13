import { formatTime } from '../domain/validation'
import type { TrainingSession } from '../domain/types'

export interface DatedTerm {
  termId: string
  date: string
  group: string
  start: string
  end: string
  startsAt: number
  session?: TrainingSession
}

export function TermList({ terms, open, selected }: { terms: DatedTerm[]; open: (term: DatedTerm) => void; selected: DatedTerm | null }) {
  if (!terms.length) return <p role="status">Nema termina za izabrani datum.</p>
  return <ul className="term-list mb-3">{terms.map(term => <li key={term.termId}>
    <button className="term-button" type="button" aria-pressed={selected?.termId === term.termId && selected.date === term.date} onClick={() => open(term)}>
      <span>{formatTime(term.start)}–{formatTime(term.end)} · {term.group}{term.session?.cancelled_at ? ' · Otkazan' : ''}</span>
      <span aria-hidden="true">›</span>
    </button>
  </li>)}</ul>
}


