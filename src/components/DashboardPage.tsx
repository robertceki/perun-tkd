import { Alert, Box, ButtonBase, Card, Stack, Typography } from '@mui/material'
import ChevronRight from '@mui/icons-material/ChevronRight'
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

export function TermList({ terms, open, selected, counts, next }: { terms: DatedTerm[]; open: (term: DatedTerm) => void; selected: DatedTerm | null; counts: Record<string, number>; next?: string }) {
  if (!terms.length) return <Alert variant="outlined" severity="info" role="status" sx={{ fontStyle: 'italic' }}>Nema termina za izabrani datum.</Alert>
  return <Stack component="ul" spacing={1.25} sx={{ p: 0, m: 0, listStyle: 'none' }}>{terms.map(term => {
    const active = selected?.termId === term.termId && selected.date === term.date
    const count = counts[term.termId] ?? 0
    return <Card component="li" key={term.termId} sx={{ borderInlineStart: '4px solid', borderInlineStartColor: active || (!selected && next === term.termId) ? 'primary.main' : 'transparent' }}>
      <ButtonBase type="button" className="mui-term-button" aria-pressed={active} onClick={() => open(term)} sx={{ width: '100%', minHeight: 54, px: 1.25, py: .5, display: 'grid', gridTemplateColumns: '55px minmax(0,1fr) auto', gap: 1, textAlign: 'start' }}>
        <Typography aria-hidden="true" fontWeight={800} sx={{ fontVariantNumeric: 'tabular-nums' }}>{formatTime(term.start)}</Typography>
        <Box><Typography fontWeight={750}>{term.group}</Typography>
          <Typography variant="body2" color="text.secondary">{formatTime(term.start)}–{formatTime(term.end)} · {term.session?.cancelled_at ? 'Otkazan' : count + (count === 1 ? ' član' : ' članova')}</Typography></Box>
        <ChevronRight />
      </ButtonBase>
    </Card>
  })}</Stack>
}
