import { describe, expect, it } from 'vitest'
import { getMedicalExamDetails, getMedicalExamStatus, isMedicalExamWarning, validateMedicalExamDate } from './medicalExam'

describe('medical exam expiry', () => {
  it.each([
    ['2025-08-31', '2026-02-13', 'valid', false, '2026-02-28', 15],
    ['2025-08-31', '2026-02-14', 'expiring', true, '2026-02-28', 14],
    ['2025-08-31', '2026-02-28', 'today', true, '2026-02-28', 0],
    ['2025-08-31', '2026-03-01', 'expired', true, '2026-02-28', -1],
    ['2023-08-31', '2024-02-28', 'expiring', true, '2024-02-29', 1],
    ['2023-08-31', '2024-02-29', 'today', true, '2024-02-29', 0],
    ['2023-08-31', '2024-03-01', 'expired', true, '2024-02-29', -1],
    ['2024-02-29', '2024-08-29', 'today', true, '2024-08-29', 0],
  ] as const)('classifies exam %s on %s as %s', (exam, today, status, warning, expiry, daysRemaining) => {
    const actual = getMedicalExamStatus(exam, today)
    expect(actual).toBe(status)
    expect(isMedicalExamWarning(actual)).toBe(warning)
    expect(getMedicalExamDetails(exam, today)).toEqual({
      status, expiry: new Date(`${expiry}T00:00:00Z`), daysRemaining,
    })
  })

  it.each([null, undefined, ''])('accepts missing date %s without a warning', exam => {
    expect(validateMedicalExamDate(exam, '2026-07-06')).toBeNull()
    expect(getMedicalExamStatus(exam, '2026-07-06')).toBe('missing')
    expect(getMedicalExamDetails(exam, '2026-07-06')).toEqual({ status: 'missing' })
    expect(isMedicalExamWarning('missing')).toBe(false)
  })

  it('accepts today and rejects future dates', () => {
    expect(validateMedicalExamDate('2026-07-06', '2026-07-06')).toBeNull()
    expect(validateMedicalExamDate('2026-07-07', '2026-07-06'))
      .toBe('Datum lekarskog pregleda ne može biti u budućnosti.')
  })
})
