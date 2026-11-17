import { Box, Chip } from '@mui/material'
import { isMedicalExamWarning, type MedicalExamDetails } from '../domain/medicalExam'

const appearance = {
  valid: { color: 'success', text: 'Lekarski pregled važi' },
  expiring: { color: 'warning', text: 'Lekarski pregled ističe uskoro' },
  today: { color: 'warning', text: 'Lekarski pregled ističe danas' },
  expired: { color: 'error', text: 'Lekarski pregled je istekao' },
  missing: { color: 'default', text: 'Lekarski pregled nije unet' },
  unknown: { color: 'default', text: 'Status lekarskog pregleda nije dostupan' },
} as const

const dateFormat = new Intl.DateTimeFormat('sr-Latn', {
  day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC',
})

export function MedicalExamStatus({ details, warningsOnly = false }: { details: MedicalExamDetails; warningsOnly?: boolean }) {
  const { status } = details
  if (warningsOnly && status !== 'missing' && !isMedicalExamWarning(status)) return null
  const { color } = appearance[status]
  let text: string = appearance[status].text
  if (status === 'expiring') {
    const { daysRemaining } = details
    text = `Lekarski pregled ističe za ${daysRemaining} ${daysRemaining === 1 ? 'dan' : 'dana'}`
  } else if (!warningsOnly && (status === 'valid' || status === 'expired')) {
    const expiry = dateFormat.format(details.expiry)
    text = status === 'valid' ? `${text} do ${expiry}` : `${text} ${expiry}`
  }
  if (warningsOnly) return <Box component="span" className="medical-warning" title={text} sx={{ color: color === 'default' ? 'text.secondary' : color === 'warning' ? '#8a5a08' : `${color}.dark` }}>
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <path d="M4 3v7a5 5 0 0 0 10 0V3M4 3h2m6 0h2m-5 12v3a4 4 0 0 0 8 0v-4" />
      <circle cx="17" cy="12" r="2" />
    </svg>
    <Box component="span" sx={{ position: 'absolute', width: '1px', height: '1px', p: 0, overflow: 'hidden', clipPath: 'inset(50%)', whiteSpace: 'nowrap' }}>{text}</Box>
  </Box>
  return <Chip size="small" color={color} label={text} sx={{ maxWidth: '100%', height: 'auto', minHeight: 24, '& .MuiChip-label': { whiteSpace: 'normal' } }} />
}
