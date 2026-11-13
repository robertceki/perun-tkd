import { isMedicalExamWarning, type MedicalExamDetails } from '../domain/medicalExam'

const appearance = {
  valid: { color: 'success', text: 'Lekarski pregled važi' },
  expiring: { color: 'warning', text: 'Lekarski pregled ističe uskoro' },
  today: { color: 'warning', text: 'Lekarski pregled ističe danas' },
  expired: { color: 'danger', text: 'Lekarski pregled je istekao' },
  missing: { color: 'secondary', text: 'Lekarski pregled nije unet' },
  unknown: { color: 'secondary', text: 'Status lekarskog pregleda nije dostupan' },
}

const dateFormat = new Intl.DateTimeFormat('sr-Latn', {
  day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC',
})

export function MedicalExamStatus({ details, warningsOnly = false }: { details: MedicalExamDetails; warningsOnly?: boolean }) {
  const { status } = details
  if (warningsOnly && status !== 'missing' && !isMedicalExamWarning(status)) return null
  const { color } = appearance[status]
  let { text } = appearance[status]
  if (status === 'expiring') {
    const { daysRemaining } = details
    text = `Lekarski pregled ističe za ${daysRemaining} ${daysRemaining === 1 ? 'dan' : 'dana'}`
  } else if (!warningsOnly && (status === 'valid' || status === 'expired')) {
    const expiry = dateFormat.format(details.expiry)
    text = status === 'valid' ? `${text} do ${expiry}` : `${text} ${expiry}`
  }
  if (warningsOnly) return <span className={`medical-warning text-${color}-emphasis`} title={text}>
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <path d="M4 3v7a5 5 0 0 0 10 0V3M4 3h2m6 0h2m-5 12v3a4 4 0 0 0 8 0v-4" />
      <circle cx="17" cy="12" r="2" />
    </svg>
    <span className="visually-hidden">{text}</span>
  </span>
  return <span className={`badge text-bg-${color} ms-2 text-wrap`}>{text}</span>
}
