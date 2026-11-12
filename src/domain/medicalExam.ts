const dayInMilliseconds = 86_400_000

function parseCalendarDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000-')) return null
  const date = new Date(value + 'T00:00:00Z')
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? date : null
}

export function validateMedicalExamDate(value: string | null | undefined, today: string): string | null {
  if (!value) return null
  if (!parseCalendarDate(value)) return 'Unesite ispravan datum lekarskog pregleda.'
  if (!parseCalendarDate(today)) return 'Datum lekarskog pregleda nije moguće proveriti bez serverskog vremena.'
  if (value > today) return 'Datum lekarskog pregleda ne može biti u budućnosti.'
  return null
}

export type MedicalExamState = 'valid' | 'expiring' | 'today' | 'expired' | 'missing' | 'unknown'

export function getMedicalExamStatus(value: string | null | undefined, today: string): MedicalExamState {
  return getMedicalExamDetails(value, today).status
}

export type MedicalExamDetails =
  | { status: 'missing' | 'unknown' }
  | { status: 'valid' | 'expiring' | 'today' | 'expired'; expiry: Date; daysRemaining: number }

export function getMedicalExamDetails(value: string | null | undefined, today: string): MedicalExamDetails {
  if (!value) return { status: 'missing' }
  const expiry = parseCalendarDate(value)
  const current = parseCalendarDate(today)
  if (!expiry || !current || expiry > current) return { status: 'unknown' }

  const examDay = expiry.getUTCDate()
  // Day zero of the following month is the last day of the expiry month.
  expiry.setUTCMonth(expiry.getUTCMonth() + 7, 0)
  expiry.setUTCDate(Math.min(examDay, expiry.getUTCDate()))
  const daysRemaining = (expiry.getTime() - current.getTime()) / dayInMilliseconds
  const dates = { expiry, daysRemaining }
  if (daysRemaining < 0) return { status: 'expired', ...dates }
  if (daysRemaining === 0) return { status: 'today', ...dates }
  if (daysRemaining <= 14) return { status: 'expiring', ...dates }
  return { status: 'valid', ...dates }
}

export function isMedicalExamWarning(status: MedicalExamState): boolean {
  return status === 'expiring' || status === 'today' || status === 'expired'
}
