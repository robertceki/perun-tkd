import { expect, test } from 'vitest'
import { belgradeBusinessDate, formatTime, normalizeTermTime } from './validation'

test.each([
  ['2026-01-04T22:59:59Z', '2026-01-04'],
  ['2026-01-04T23:00:00Z', '2026-01-05'],
  ['2026-07-05T21:59:59Z', '2026-07-05'],
  ['2026-07-05T22:00:00Z', '2026-07-06'],
  ['2026-07-06T00:00:00+02:00', '2026-07-06'],
])('maps instant %s to Belgrade date %s', (instant, day) => {
  expect(belgradeBusinessDate(new Date(instant))).toBe(day)
})

test('displays legacy seconds and accepts only valid whole-minute new inputs', () => {
  expect(formatTime('18:05:34.123')).toBe('18:05')
  expect(normalizeTermTime('18:05')).toBe('18:05:00')
  expect(normalizeTermTime('18:05:00')).toBe('18:05:00')
  for (const value of ['18:05:01', '18:05:00.1', '24:00', '18:60', '8:05']) {
    expect(normalizeTermTime(value)).toBeNull()
  }
  expect(() => formatTime('24:00')).toThrow()
})

test.each([
  ['2026-03-28T22:59:59Z', '2026-03-28'],
  ['2026-03-28T23:00:00Z', '2026-03-29'],
  ['2026-03-29T00:59:59Z', '2026-03-29'],
  ['2026-03-29T01:00:00Z', '2026-03-29'],
  ['2026-10-25T00:59:59Z', '2026-10-25'],
  ['2026-10-25T01:00:00Z', '2026-10-25'],
  ['2026-10-25T23:00:00Z', '2026-10-26'],
])('keeps the Belgrade business date correct around DST at %s', (instant, day) => {
  expect(belgradeBusinessDate(new Date(instant))).toBe(day)
})
