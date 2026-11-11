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

export function TermList({ terms, open }: { terms: DatedTerm[]; open: (term: DatedTerm) => void }) {
  if (!terms.length) return <p role="status">Nema termina za izabrani datum.</p>
  return <ul className="list-group mb-3">{terms.map(term => <li key={term.termId} className="list-group-item">
    <button className="btn btn-outline-primary text-start w-100" type="button" onClick={() => open(term)}>
      {formatTime(term.start)}–{formatTime(term.end)} · {term.group}{term.session?.cancelled_at ? ' · Otkazan' : ''}
    </button>
  </li>)}</ul>
}

