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
  return <span className={`badge text-bg-${color} ms-2 text-wrap`}>{text}</span>
}
